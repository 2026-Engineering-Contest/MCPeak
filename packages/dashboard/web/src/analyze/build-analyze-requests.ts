import type {
  AnalyzeSecurityRequest,
  AnalyzeTokensRequest,
  ServerCandidate,
} from "../../../src/api-types.js";
import { describeRun } from "../run-target.js";
import {
  buildSecurityRequest,
  INITIAL_SECURITY_FORM,
  type SecurityForm,
} from "./build-security-request.js";
import type { AnalyzeTarget } from "./use-analyze-target.js";

/**
 * 격리 이미지가 실행하는 명령의 basename. `@mcpeak/audit` 의 Docker 백엔드 `commands`(`sandbox/docker.ts`)와
 * 리포트의 `SANDBOX_COMMANDS`(`report.ts`)와 같은 목록이다. audit 도 같은 판정으로 격리를 건너뛰지만, CLI 는
 * 그보다 앞서 마운트 범위를 정하므로 격리할 수 없는 명령에 `--sandbox` 를 실으면 범위 판정에서 거절될 수
 * 있다. 그래서 여기서 먼저 거른다.
 */
const SANDBOX_COMMANDS: ReadonlySet<string> = new Set(["node", "npx", "npm"]);

/**
 * 뗄 윈도우 실행 파일 확장자. `@mcpeak/audit` 의 `sandbox/command-name.ts` 와 같은 목록이어야 한다.
 *
 * `.com` 과 `.ps1` 은 넣지 않는다 — 전자는 `mcp-server.com` 같은 도메인 꼴 이름을 엉뚱하게 자르고,
 * 후자는 명령 자리에 그대로 올 수 없다.
 */
const EXECUTABLE_EXTENSIONS = [".exe", ".cmd", ".bat"] as const;

/**
 * 격리 이미지가 실행할 명령의 이름. `@mcpeak/audit` 의 `commandName`
 * (`packages/audit/src/sandbox/command-name.ts`)과 **같은 값을 내야 한다** — 그 파일이 이 규칙의
 * 정본이고, 판단 근거도 거기 적혀 있다.
 *
 * 경로를 떼고(`/`·`\` 둘 다), 윈도우 실행 파일 확장자도 뗀다. 윈도우에서 node 는 `node.exe` 이고
 * npm·npx 는 `npm.cmd`·`npx.cmd` 다. 확장자를 떼지 않으면 `SANDBOX_COMMANDS` 를 통과하지 못해
 * **윈도우 사용자는 격리를 시도조차 받지 못한다.** audit 은 적어도 `unsupported-command` 사유를
 * 리포트에 남기지만 이 판정은 그보다 앞서 조용히 갈라진다.
 *
 * 이 파일은 브라우저 번들이라 `@mcpeak/audit` 를 런타임으로 불러올 수 없다(그 패키지는 `node:`
 * 모듈을 끌고 온다). 그래서 규칙을 복제한다. 복제가 조용히 어긋나는 것을 막는 것은 아래 주석이
 * 아니라 `web/tests/build-analyze-requests.test.ts` 의 케이스 표다.
 *
 * `process.platform` 을 보지 않고 글자로만 판정한다. 플랫폼으로 갈리면 같은 입력이 머신마다 다른
 * 결과를 낸다.
 */
const commandName = (command: string): string => {
  const base = command.split(/[\\/]/).pop() || command;
  const lowered = base.toLowerCase();
  const extension = EXECUTABLE_EXTENSIONS.find((candidate) => lowered.endsWith(candidate));
  // 확장자가 이름 전체면(`.exe`) 떼지 않는다. 빈 이름은 어느 목록에도 들지 못한다.
  if (extension === undefined || lowered === extension) return base;
  return base.slice(0, -extension.length);
};

/** 분석하기의 보안 폼. 격리를 늘 시도한다(ADR-0117). 나머지는 기본값이다. */
const SANDBOX_SECURITY_FORM: SecurityForm = { ...INITIAL_SECURITY_FORM, sandbox: true };

/**
 * 분석하기의 두 요청. 버튼 비활성 판정·사유·제출이 같은 함수를 쓴다(기존 두 패널의 규율).
 * 점검 옵션이 없다(ADR-0117). 격리할 수 있는 대상(stdio 이고 명령이 node·npx·npm)이면 보안 요청에
 * `sandbox`(`compareHost: false`, `allowHosts: []`)와 `sandboxOptional: true` 를 싣는다. Docker 를 못 쓰거나
 * 격리 범위를 정하지 못하면 서버·CLI 가 격리 없이(readonly) 돈다. 그 밖의 대상은 `{ argv, serverId? }` 다.
 * 대상 오류가 유일한 오류 갈래다. 토큰 요청은 던지지 않는다.
 */
export function buildAnalyzeRequests(
  target: AnalyzeTarget,
):
  | { readonly tokens: AnalyzeTokensRequest; readonly security: AnalyzeSecurityRequest }
  | { readonly error: string } {
  if (!("argv" in target.argv)) {
    return { error: target.argv.error };
  }
  const { argv } = target.argv;
  const { serverId } = target;
  // 후보 갈래면 id 를 함께 보낸다. 서버가 그 후보의 env 값을 채운다(Home 과 같다).
  const tokens: AnalyzeTokensRequest = {
    argv,
    ...(serverId === undefined ? {} : { serverId }),
  };
  const { transport } = target.state;
  // stdio 대상의 argv 는 늘 `--command <명령>` 으로 시작한다(build-analyze-argv.ts).
  const sandboxable =
    transport === "stdio" &&
    argv[0] === "--command" &&
    SANDBOX_COMMANDS.has(commandName(argv[1] ?? ""));
  if (!sandboxable) {
    return {
      tokens,
      security: buildSecurityRequest(argv, serverId, transport, INITIAL_SECURITY_FORM),
    };
  }
  return {
    tokens,
    security: {
      ...buildSecurityRequest(argv, serverId, transport, SANDBOX_SECURITY_FORM),
      sandboxOptional: true,
    },
  };
}

/**
 * "분석한 대상: <이름>". 성공한 요청에서 구한다(설계 §3.2). serverId 가 후보에 있으면 그 name,
 * 아니면 describeRun("audit", argv).server, 그것도 없으면 빈 문자열. 폼과 비교하지 않는다. 비교하면 같은
 * 결과를 두 번 그릴 때 글자가 달라진다.
 */
export function describeTarget(
  candidates: readonly ServerCandidate[],
  request: { readonly argv: readonly string[]; readonly serverId?: string },
): string {
  const candidate =
    request.serverId === undefined
      ? undefined
      : candidates.find((item) => item.id === request.serverId);
  return candidate?.name ?? describeRun("audit", request.argv).server ?? "";
}
