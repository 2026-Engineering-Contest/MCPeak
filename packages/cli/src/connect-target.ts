/**
 * 서브커맨드가 "어디에 붙을지" 를 한 모양으로 들고 다니기 위한 모듈. 이슈 #137.
 *
 * `core` 는 stdio 와 Streamable HTTP 두 transport 를 이미 내보내는데(`connectStdio` ·
 * `connectHttp`, ADR-0020) CLI 가 stdio 만 배선하고 있었다. transport 분기를 서브커맨드마다
 * 되풀이하지 않도록 **파서가 여기서 대상을 확정하고, 그 아래로는 태그만 흐른다.**
 *
 * 검증 함수는 던지지 않고 결과를 돌려준다. 서브커맨드마다 사용법 hint 가 달라서 오류 문장을
 * 만드는 일은 각자의 `fail()` 에 남겨야 하기 때문이다.
 */

import type { McpClient, McpHttpConnection, McpStdioConnection } from "@mcpeak/core";
import { escapeTerminalText } from "./repair-render.js";

/** 파서가 확정한 연결 대상. */
export type ConnectTarget =
  | {
      readonly transport: "stdio";
      readonly command: string;
      readonly args: readonly string[];
    }
  | {
      readonly transport: "http";
      readonly url: string;
      /**
       * 헤더 이름 → 그 값을 담은 **환경변수 이름**. 값 자체는 여기에도 argv 에도 없다.
       *
       * 평문 `--header 'Authorization: Bearer …'` 를 두지 않은 이유가 이 타입이다. 토큰을
       * argv 에 실으면 `ps` 목록과 셸 히스토리에 그대로 남고, 그건 우리가 만든 노출이다.
       */
      readonly headerEnv: Readonly<Record<string, string>>;
    };

/**
 * `McpStdioConnection` 과 `McpHttpConnection` 을 CLI 한 자리로 좁힌 모양.
 *
 * `getDiagnostics` 를 `unknown` 으로 두는 것이 핵심이다. 호출부는 이미 `processDiagnostics()`
 * 구조 가드를 통과시키고 있고(`test-command.ts`), 여기에 `httpDiagnostics()` 가 짝으로 붙는다.
 * 타입을 stdio 쪽으로 좁혀 두면 HTTP 진단이 stdio 블록으로 렌더될 길이 열린다.
 */
export interface CliConnection {
  readonly client: McpClient;
  getDiagnostics(): unknown;
  close(): Promise<void>;
  /**
   * HTTP 에는 죽일 프로세스가 없어 `close` 로 접는다. `McpHttpConnection` 에 `forceClose` 가
   * 없는 것과 같은 이유다(ADR-0020 설계 §9). 호출부의 타임아웃·강제 종료 경로가 transport 를
   * 되묻지 않게 하려고 이 자리에서 흡수한다.
   */
  forceClose(): Promise<void>;
}

export interface ConnectDependencies {
  connectStdio(options: {
    command: string;
    args: readonly string[];
    env?: Readonly<Record<string, string>>;
  }): Promise<McpStdioConnection>;
  /**
   * 없으면 원격 대상을 열 수 없다. 진입점이 `core` 를 로드하지 못한 경로와 대시보드처럼
   * stdio 만 배선한 호출자가 있어 선택 사항으로 둔다. 없을 때는 조용히 stdio 로 떨어지지
   * 않고 무엇이 없는지 말하고 멈춘다.
   */
  connectHttp?(options: {
    url: string;
    headers?: Readonly<Record<string, string>>;
  }): Promise<McpHttpConnection>;
  /**
   * `process.env` 를 읽는 주입점. CLI 코드는 `process` 를 직접 읽지 않는다(ADR-0013).
   * `--header-env` 를 쓰지 않으면 한 번도 불리지 않는다.
   */
  readEnv?(name: string): string | undefined;
}

/** 검증 결과. 실패 문장은 서브커맨드가 자기 hint 를 붙여 던진다. */
export type TargetResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const ok = <T>(value: T): TargetResult<T> => ({ ok: true, value });
const err = <T>(message: string): TargetResult<T> => ({ ok: false, message });

/** RFC 9110 의 field-name token. `core/src/options.ts` 의 같은 이름 상수와 같은 집합이다. */
const HTTP_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * POSIX 환경변수 이름. 이 검사가 `--header-env` 를 값이 아니라 **이름** 자리로 못박는다.
 *
 * `--header-env Authorization="Bearer abc123"` 처럼 값을 바로 넣으려는 시도가 공백과 따옴표
 * 때문에 여기서 걸린다. 걸리지 않으면 우리가 막으려던 그 노출(`ps` · 셸 히스토리)이 그대로
 * 일어나므로, 이 정규식은 편의가 아니라 이 옵션의 안전 근거다.
 */
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 되짚어 준 값 하나의 표시 상한. `process-diagnostics.ts` 의 `MAX_LINE_CHARACTERS` 와 같다. */
const MAX_ECHOED_CHARACTERS = 200;

/**
 * 오류 문장에 되짚어 넣는 **사용자 입력**을 무해하게 만든다.
 *
 * 값 단위로만 건다. 문장 전체에 걸면 우리가 쓴 개행(`\n→ …`)까지 이스케이프되어 안내가 한 줄로
 * 뭉개진다 — #289 가 정확히 그 결함이었다.
 *
 * 거는 이유는 `format()` 이 더 이상 `failure.message` 를 통째로 이스케이프하지 않기 때문이다.
 * `mcpeak test s.json --url $'\e[2J…'` 처럼 ANSI 를 실은 인자가 그대로 터미널에 닿을 수 있다.
 */
function echoValue(value: string): string {
  const escaped = escapeTerminalText(value);
  return escaped.length <= MAX_ECHOED_CHARACTERS
    ? escaped
    : `${escaped.slice(0, MAX_ECHOED_CHARACTERS)}…`;
}

/**
 * 비밀값을 셸 히스토리에 남기지 않고 환경변수에 넣는 방법. 안내 문장이 되풀이해 쓴다.
 *
 * **`MCP_TOKEN='Bearer …' mcpeak …` 를 예시로 쓰지 않는다.** 그 한 줄은 환경변수를 쓰긴 하지만
 * 명령 자체가 히스토리 파일에 토큰째로 남아, 이 옵션이 막으려던 노출의 절반을 그대로 만든다.
 * 우리가 권하는 예시가 우리 근거를 깎으면 안 된다.
 */
const SECRET_INPUT_HINT =
  "값은 셸 히스토리에 남지 않게 넣으세요. 예: `read -rs MCP_TOKEN; export MCP_TOKEN`";

/**
 * `--url` 값을 검증한다.
 *
 * 스킴을 http·https 로 제한한다. `file:` 이나 `ws:` 를 넘기면 `core` 의 SDK 안쪽에서
 * 엉뚱한 문장으로 실패하고, 그 문장은 우리가 고칠 수 없는 자리에서 나온다.
 */
export function parseUrlOption(raw: string): TargetResult<string> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return err(
      `\`--url\` 값이 올바른 URL 이 아닙니다: '${echoValue(raw)}'\n` +
        "→ 스킴을 포함한 절대 URL 이어야 합니다. 예: https://mcp.example.com/v1",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return err(
      `\`--url\` 은 http 또는 https 만 받습니다. 받은 스킴: '${echoValue(url.protocol.replace(":", ""))}'\n` +
        "→ Streamable HTTP MCP 서버의 엔드포인트를 넘기세요.",
    );
  if (url.username !== "" || url.password !== "")
    return err(
      "`--url` 에 자격증명을 넣지 마세요.\n" +
        "→ URL 에 넣은 자격증명은 셸 히스토리와 `ps` 목록에 그대로 남습니다.\n" +
        "→ 인증이 필요하면 `--header-env <헤더이름>=<환경변수이름>` 을 쓰세요.",
    );
  return ok(url.toString());
}

/**
 * `--header-env` 한 건을 파싱한다. 형식은 `<헤더이름>=<환경변수이름>` 이다.
 *
 * 값을 읽지 않는다. 이 함수는 argv 만 본다.
 */
export function parseHeaderEnvOption(
  raw: string,
): TargetResult<{ header: string; envName: string }> {
  const separator = raw.indexOf("=");
  if (separator <= 0)
    return err(
      `\`--header-env\` 값의 형식이 올바르지 않습니다: '${echoValue(raw)}'\n` +
        "→ `<헤더이름>=<환경변수이름>` 형식이어야 합니다. 예: --header-env Authorization=MCP_TOKEN",
    );
  const header = raw.slice(0, separator);
  const envName = raw.slice(separator + 1);
  if (!HTTP_TOKEN_PATTERN.test(header))
    return err(
      `\`--header-env\` 의 헤더 이름에 쓸 수 없는 문자가 있습니다: '${echoValue(header)}'\n` +
        "→ 헤더 이름은 공백 없는 토큰이어야 합니다. 예: Authorization, X-Api-Key",
    );
  if (!ENV_NAME_PATTERN.test(envName))
    return err(
      `\`--header-env\` 의 '${echoValue(header)}' 자리에 환경변수 **이름**이 아닌 값이 온 것 같습니다: '${echoValue(envName)}'\n` +
        "→ 이 옵션은 헤더 값을 직접 받지 않습니다. 값을 argv 에 실으면 `ps` 목록과 셸 히스토리에 남습니다.\n" +
        `→ 값은 환경변수에 넣고 그 이름만 넘기세요. ${SECRET_INPUT_HINT}`,
    );
  return ok({ header, envName });
}

/** 대상을 사람이 읽는 한 조각으로 만든다. 오류 문장이 무엇에 붙으려 했는지 말할 때 쓴다. */
export function describeTarget(target: ConnectTarget): string {
  return target.transport === "stdio" ? [target.command, ...target.args].join(" ") : target.url;
}

/** `openConnection` 이 연결 전에 멈춘 경우. 서브커맨드가 자기 오류 코드로 옮긴다. */
export class ConnectTargetError extends Error {}

/**
 * 대상을 열어 `CliConnection` 을 돌려준다. `core` 가 던지는 `McpClientError` 는 그대로
 * 통과시킨다 — 그 오류의 진단과 문장이 기존 실패 경로가 기대하는 값이다.
 *
 * `env` 는 stdio 전용이다. External 배선이 만든 자식 환경 변수라 띄울 프로세스가 있어야
 * 뜻이 있고, 파서가 `--url` 과 External 세션 옵션의 동시 사용을 이미 막는다.
 */
export async function openConnection(
  target: ConnectTarget,
  dependencies: ConnectDependencies,
  options?: { readonly env?: Readonly<Record<string, string>> },
): Promise<CliConnection> {
  if (target.transport === "stdio") {
    const connection = await dependencies.connectStdio({
      command: target.command,
      args: target.args,
      ...(options?.env === undefined ? {} : { env: options.env }),
    });
    return connection;
  }

  const connectHttp = dependencies.connectHttp;
  if (connectHttp === undefined)
    throw new ConnectTargetError(
      "이 진입점은 원격(Streamable HTTP) 서버를 지원하지 않습니다.\n" +
        "→ `--url` 대신 `--command` 로 서버를 직접 띄우세요.",
    );

  const headers = resolveHeaders(target.headerEnv, dependencies.readEnv);
  if (!headers.ok) throw new ConnectTargetError(headers.message);

  const connection = await connectHttp({
    url: target.url,
    ...(Object.keys(headers.value).length === 0 ? {} : { headers: headers.value }),
  });
  return {
    client: connection.client,
    getDiagnostics: () => connection.getDiagnostics(),
    close: () => connection.close(),
    // 죽일 프로세스가 없다. 위 인터페이스 주석의 근거.
    forceClose: () => connection.close(),
  };
}

/**
 * 환경변수에서 헤더 값을 읽는다.
 *
 * **실패 문장에 값을 싣지 않는다.** 환경변수 이름만 말한다. 값이 비었다는 사실을 알리려다
 * 값을 화면에 찍으면 이 옵션이 존재하는 이유가 없어진다.
 */
function resolveHeaders(
  headerEnv: Readonly<Record<string, string>>,
  readEnv: ConnectDependencies["readEnv"],
): TargetResult<Record<string, string>> {
  const entries = Object.entries(headerEnv);
  if (entries.length === 0) return ok({});
  if (readEnv === undefined)
    return err(
      "이 진입점은 `--header-env` 를 지원하지 않습니다 (환경변수를 읽을 수 없습니다).\n" +
        "→ 인증이 필요 없는 엔드포인트인지 확인하거나 터미널에서 `mcpeak` 을 직접 실행하세요.",
    );
  /**
   * **null 프로토타입으로 만든다.** 평범한 `{}` 에 `headers["__proto__"] = …` 를 하면 값이
   * 조용히 사라진다(프로토타입 설정으로 해석되고 문자열이라 무시된다). `__proto__` 는 RFC 9110
   * 토큰을 통과하는 유효한 헤더 이름이므로, 그대로 두면 사용자가 지정한 헤더가 아무 말 없이
   * 빠진 채 요청이 나간다.
   */
  const headers: Record<string, string> = Object.create(null);
  for (const [header, envName] of entries) {
    const value = readEnv(envName);
    if (value === undefined || value === "")
      return err(
        `환경변수 '${echoValue(envName)}' 이 비어 있어 '${echoValue(header)}' 헤더를 만들 수 없습니다.\n` +
          `→ ${SECRET_INPUT_HINT}`,
      );
    // 값에 개행이 섞이면 요청을 쪼갤 수 있다. `core` 도 같은 검사를 하지만, 그쪽 문장은
    // 환경변수를 모르므로 무엇을 고쳐야 하는지 말해 주지 못한다.
    if (/[\r\n\0]/.test(value))
      return err(
        `환경변수 '${echoValue(envName)}' 의 값에 개행이나 NUL 이 들어 있어 '${echoValue(header)}' 헤더로 쓸 수 없습니다.\n` +
          "→ 값 끝의 줄바꿈이 흔한 원인입니다. 값을 확인하고 다시 실행하세요.",
      );
    headers[header] = value;
  }
  return ok(headers);
}
