/**
 * 붙여 넣은 글자 → 점검 대상(계획서 §5.2). 세 꼴을 받는다: mcpServers JSON 조각, 실행 명령 한 줄, URL.
 *
 * env 와 헤더는 **이름만** 남긴다. 값은 여기서 버려지고 요청에도 화면에도 실리지 않는다(ADR-0111).
 * 값이 인자에 실려 나가는 꼴(`sudo KEY=value`, `sh -c "KEY=value ..."`, `export KEY=value && ...`)은 거절하고,
 * `docker run -e KEY=value` 는 그 쌍을 걷어 낸다.
 * 같은 글자를 넣으면 항상 같은 결과다. 엔진마다 다른 `JSON.parse` 오류 문장을 싣지 않는다.
 */

import type { Transport } from "../build-test-argv.js";

export interface PastedServer {
  /** mcpServers 의 키. 명령 한 줄이나 URL 로 왔으면 null. */
  readonly name: string | null;
  readonly transport: Transport;
  /** 실행 파일 하나. http 면 "". */
  readonly command: string;
  readonly args: readonly string[];
  /** 표시용. 요청에 싣지 않는다. */
  readonly envNames: readonly string[];
  /** http 면 주소, 아니면 "". */
  readonly url: string;
  /** 표시용. 요청에 싣지 않는다. */
  readonly headerNames: readonly string[];
}

export type ParsedInput =
  | { readonly ok: true; readonly servers: readonly PastedServer[] }
  | { readonly ok: false; readonly error: string };

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const HTTP_URL = /^https?:\/\//i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(error: string): ParsedInput {
  return { ok: false, error };
}

/**
 * 공백으로 나누되 따옴표 안은 한 토큰이다. 역슬래시 이스케이프는 풀지 않는다. 줄 끝의 `\` 하나는 줄
 * 잇기라 버린다. 따옴표가 닫히지 않으면 null.
 */
function tokenize(line: string): readonly string[] | null {
  const tokens: string[] = [];
  let current = "";
  let started = false;
  let quote: '"' | "'" | null = null;
  for (const char of line) {
    if (quote !== null) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
      continue;
    }
    current += char;
    started = true;
  }
  if (quote !== null) return null;
  if (started) tokens.push(current);
  return tokens.filter((token) => token !== "\\");
}

/** `env` 의 값 없는 옵션. 버려도 뜻이 달라지지 않는다(env 를 넘기지 않으므로). */
const ENV_FLAGS: ReadonlySet<string> = new Set(["-", "-i", "--ignore-environment", "-0", "--null"]);
/**
 * `env` 의 값을 받는 옵션. 다음 토큰까지가 옵션이다. `--unset=NAME` 처럼 붙여 쓴 꼴은 한 토큰이다.
 * `-C`·`--chdir` 는 받지 않는다. 버리면 실행 파일이 다른 작업 디렉터리에서 돌아 뜻이 달라진다.
 */
const ENV_VALUE_OPTIONS: ReadonlySet<string> = new Set(["-u", "--unset"]);
const ENV_JOINED_OPTION = /^--unset=/;

/**
 * 실행 파일 앞에 붙은 환경변수 전달을 걷어 낸다. `KEY=value node s.mjs` 와 `env KEY=value node s.mjs`
 * 두 꼴이다. 이름만 남기고 값은 버린다. `env` 와 그 옵션도 버린다. env 를 넘기지 않으므로 남길 뜻이
 * 없다. 걷어 내지 않으면 값이 args 에 실려 대상 줄과 요청으로 나간다(ADR-0111).
 *
 * `env` 의 옵션은 아는 것만 받는다. 모르는 옵션(`-S`, `-C` 등)을 건너뛰면 그 옵션의 값이 실행 파일로
 * 읽히거나 값이 인자로 샌다. 그때는 null 을 낸다.
 */
function stripEnv(tokens: readonly string[]): {
  readonly envNames: readonly string[];
  readonly rest: readonly string[];
} | null {
  const envNames: string[] = [];
  let index = 0;
  for (;;) {
    const token = tokens[index];
    if (token === undefined) break;
    if (ENV_ASSIGNMENT.test(token)) {
      envNames.push(token.slice(0, token.indexOf("=")));
      index += 1;
      continue;
    }
    if (token !== "env" && !token.endsWith("/env")) break;
    // `env` 뒤의 옵션과 할당까지가 env 의 몫이다. 그다음 토큰이 실행 파일이다.
    index += 1;
    for (;;) {
      const option = tokens[index];
      if (option === undefined || !option.startsWith("-")) break;
      if (ENV_FLAGS.has(option) || ENV_JOINED_OPTION.test(option)) index += 1;
      else if (ENV_VALUE_OPTIONS.has(option)) index += 2;
      else return null;
    }
  }
  return { envNames, rest: tokens.slice(index) };
}

/** 셸 안에서만 뜻이 있는 명령. 실행 파일이 아니라 띄울 수 없다. */
const SHELL_BUILTINS: ReadonlySet<string> = new Set(["export", "set"]);
/** 토큰 하나로 온 셸 연산자. 명령 한 줄이 실은 셸 스크립트라는 뜻이다. */
const SHELL_OPERATORS: ReadonlySet<string> = new Set(["&&", "||", ";", "|", "&"]);
/** 뒤에 `KEY=value 명령` 을 받는 실행 파일. 그 할당은 값이 인자로 나가는 꼴이다. */
const WRAPPERS: ReadonlySet<string> = new Set([
  "sudo",
  "doas",
  "env",
  "cross-env",
  "cross-env-shell",
  "nohup",
  "time",
  "command",
  "exec",
  "nice",
]);
const SHELLS: ReadonlySet<string> = new Set(["sh", "bash", "zsh", "dash"]);
/** `-c`, `-lc` 처럼 코드를 인자로 받는 셸 옵션. */
const SHELL_CODE_OPTION = /^-[a-z]*c$/;
/** 셸 코드 안의 할당. 줄 처음이나 공백·연산자 뒤의 `이름=` 이다. `--mode=dev` 는 걸리지 않는다. */
const ASSIGNMENT_IN_CODE = /(?:^|[\s;&|])([A-Za-z_][A-Za-z0-9_]*)=/;
const CONTAINER_CLIS: ReadonlySet<string> = new Set(["docker", "podman"]);
/** `docker run` 의 환경변수 옵션. `-e KEY=v`, `--env KEY=v`, `-eKEY=v`, `--env=KEY=v` 네 꼴이다. */
const CONTAINER_ENV_OPTIONS: ReadonlySet<string> = new Set(["-e", "--env"]);
const CONTAINER_ENV_JOINED = /^(?:-e|--env=)([A-Za-z_][A-Za-z0-9_]*)=/;

const NO_VALUES = "사전 점검은 환경변수 값을 넘기지 않습니다.";

/** 경로와 앞의 `\` 를 뗀 실행 파일 이름. `/usr/bin/sudo` 와 `\env` 를 `sudo`, `env` 로 본다. */
function programOf(token: string): string {
  return token.slice(token.lastIndexOf("/") + 1).replace(/^\\/, "");
}

function nameOf(assignment: string): string {
  return assignment.slice(0, assignment.indexOf("="));
}

/**
 * `stripEnv` 뒤에 남은 명령에서 값이 인자로 나가는 꼴을 본다. 고칠 수 없는 꼴은 문장을 내고, `docker` 의
 * 환경변수 옵션은 그 쌍을 걷어 내 이름만 남긴다. 문장에는 이름만 싣고 값은 싣지 않는다.
 *
 * 실행 파일 뒤의 `KEY=value` 꼴 인자(`node s.mjs --define MODE=dev`)는 인자일 뿐이라 건드리지 않는다.
 * 그래서 아는 꼴만 본다. `sudo -u 사용자 KEY=value` 처럼 옵션의 값이 사이에 낀 꼴은 놓친다.
 */
function guardArgs(
  command: string,
  args: readonly string[],
):
  | { readonly ok: true; readonly args: readonly string[]; readonly envNames: readonly string[] }
  | { readonly ok: false; readonly error: string } {
  const program = programOf(command);
  if (SHELL_BUILTINS.has(program)) {
    return {
      ok: false,
      error: `'${program}' 는 셸 안에서만 도는 명령이라 사전 점검이 띄울 수 없습니다. '${program} 이름=값' 은 빼고 서버를 띄우는 명령만 붙여 넣으세요.`,
    };
  }
  const operator = args.find((arg) => SHELL_OPERATORS.has(arg));
  if (operator !== undefined) {
    return {
      ok: false,
      error: `셸 연산자 '${operator}' 가 있습니다. 사전 점검은 명령 하나만 띄웁니다. 서버를 띄우는 명령 하나만 붙여 넣으세요.`,
    };
  }
  const tokens = [command, ...args];
  for (const [index, token] of tokens.entries()) {
    const wrapper = programOf(token);
    if (!WRAPPERS.has(wrapper)) continue;
    let next = index + 1;
    while (tokens[next]?.startsWith("-") === true) next += 1;
    const assignment = tokens[next];
    if (assignment !== undefined && ENV_ASSIGNMENT.test(assignment)) {
      const name = nameOf(assignment);
      return {
        ok: false,
        error: `'${wrapper}' 뒤에 환경변수 할당(${name})이 있습니다. ${NO_VALUES} '${name}=...' 을 지우고 다시 붙여 넣으세요.`,
      };
    }
  }
  if (SHELLS.has(program)) {
    const option = args.findIndex((arg) => SHELL_CODE_OPTION.test(arg));
    const name = option < 0 ? undefined : ASSIGNMENT_IN_CODE.exec(args[option + 1] ?? "")?.[1];
    if (name !== undefined) {
      return {
        ok: false,
        error: `'${program} ${args[option]}' 의 코드에 환경변수 할당(${name})이 있습니다. ${NO_VALUES} '${name}=...' 을 지우고 다시 붙여 넣으세요.`,
      };
    }
  }
  if (!CONTAINER_CLIS.has(program)) return { ok: true, args, envNames: [] };
  const kept: string[] = [];
  const envNames: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    const value = args[index + 1];
    if (CONTAINER_ENV_OPTIONS.has(arg) && value !== undefined && ENV_ASSIGNMENT.test(value)) {
      envNames.push(nameOf(value));
      index += 1;
      continue;
    }
    const joined = CONTAINER_ENV_JOINED.exec(arg)?.[1];
    if (joined !== undefined) {
      envNames.push(joined);
      continue;
    }
    kept.push(arg);
  }
  return { ok: true, args: kept, envNames };
}

/** 적힌 순서를 지키며 겹친 이름을 한 번만 남긴다. */
function unique(names: readonly string[]): readonly string[] {
  return [...new Set(names)];
}

function entryOf(name: string | null, value: unknown): PastedServer | string {
  const label = name === null ? "설정" : `'${name}' 항목`;
  if (!isRecord(value)) return `${label}이 객체가 아닙니다.`;
  if (typeof value.command === "string" && value.command.trim() !== "") {
    // `"command": "API_KEY=x node"`, `"command": "env 'API_KEY=x' node"` 처럼 셸 줄을 통째로 적은 설정.
    // command 한 칸은 실행 파일 하나라 나눠 읽지 않는다. 받아들이면 그 값이 대상 줄과 요청에 실린다.
    // 따옴표를 벗겨서 본다. 값은 문장에 싣지 않는다.
    const commandTokens = tokenize(value.command.trim());
    if (commandTokens === null) return `${label}의 command 에 닫히지 않은 따옴표가 있습니다.`;
    if (commandTokens.some((token) => ENV_ASSIGNMENT.test(token))) {
      return `${label}의 command 에 환경변수 할당이 있습니다. 값은 env 칸으로 옮기고 command 에는 실행 파일만 적으세요.`;
    }
    const args = value.args ?? [];
    if (!Array.isArray(args) || !args.every((arg): arg is string => typeof arg === "string")) {
      return `${label}의 args 는 문자열 배열이어야 합니다.`;
    }
    // `{"command":"env","args":["API_KEY=x","node","s.mjs"]}` 꼴. 값이 args 에 실리지 않게 걷어 낸다.
    const stripped = stripEnv([value.command.trim(), ...args]);
    if (stripped === null) {
      return `${label}의 env 옵션을 읽지 못했습니다. env 를 빼고 command 에 실행 파일만 적으세요.`;
    }
    const command = stripped.rest[0];
    if (command === undefined) {
      return `${label}에 실행 명령이 없습니다. 환경변수 뒤에 명령을 적으세요.`;
    }
    const guarded = guardArgs(command, stripped.rest.slice(1));
    if (!guarded.ok) return name === null ? guarded.error : `${label}: ${guarded.error}`;
    const declared = isRecord(value.env) ? Object.keys(value.env) : [];
    return {
      name,
      transport: "stdio",
      command,
      args: guarded.args,
      envNames: unique([...declared, ...stripped.envNames, ...guarded.envNames]),
      url: "",
      headerNames: [],
    };
  }
  if (typeof value.url === "string" && HTTP_URL.test(value.url.trim())) {
    return {
      name,
      transport: "http",
      command: "",
      args: [],
      envNames: [],
      url: value.url.trim(),
      headerNames: isRecord(value.headers) ? Object.keys(value.headers) : [],
    };
  }
  return `${label}에 command 도 http(s) url 도 없습니다.`;
}

function fromJson(text: string): ParsedInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail("JSON 으로 읽지 못했습니다. 중괄호와 따옴표, 쉼표를 확인하세요.");
  }
  if (!isRecord(parsed)) return fail("JSON 최상위가 객체가 아닙니다.");
  // 한 서버의 설정만 붙여 넣은 경우.
  if (typeof parsed.command === "string" || typeof parsed.url === "string") {
    const entry = entryOf(null, parsed);
    return typeof entry === "string" ? fail(entry) : { ok: true, servers: [entry] };
  }
  // `{"mcpServers": {...}}` 이거나, 그 안쪽 `{이름: {...}}` 만 붙여 넣은 경우.
  const map = isRecord(parsed.mcpServers) ? parsed.mcpServers : parsed;
  const servers: PastedServer[] = [];
  for (const [name, value] of Object.entries(map)) {
    const entry = entryOf(name, value);
    if (typeof entry === "string") return fail(entry);
    servers.push(entry);
  }
  if (servers.length === 0) return fail("설정에 서버가 없습니다.");
  return { ok: true, servers };
}

export function parseServerInput(text: string): ParsedInput {
  const trimmed = text.trim();
  if (trimmed === "") return fail("서버 설정이나 실행 명령을 붙여 넣으세요.");
  if (trimmed.startsWith("{")) return fromJson(trimmed);
  if (HTTP_URL.test(trimmed)) {
    if (/\s/.test(trimmed)) return fail("URL 에 공백이 있습니다. 주소 하나만 붙여 넣으세요.");
    return {
      ok: true,
      servers: [
        {
          name: null,
          transport: "http",
          command: "",
          args: [],
          envNames: [],
          url: trimmed,
          headerNames: [],
        },
      ],
    };
  }
  const tokens = tokenize(trimmed);
  if (tokens === null) return fail("따옴표가 닫히지 않았습니다.");
  // 명령 앞의 `KEY=value` 와 `env KEY=value` 는 env 다. 이름만 남긴다.
  const stripped = stripEnv(tokens);
  if (stripped === null) {
    return fail("env 의 옵션을 읽지 못했습니다. env 를 빼고 실행 명령만 붙여 넣으세요.");
  }
  const { envNames, rest } = stripped;
  const command = rest[0];
  if (command === undefined) return fail("실행 명령이 없습니다. 환경변수 뒤에 명령을 적으세요.");
  const guarded = guardArgs(command, rest.slice(1));
  if (!guarded.ok) return fail(guarded.error);
  return {
    ok: true,
    servers: [
      {
        name: null,
        transport: "stdio",
        command,
        args: guarded.args,
        envNames: unique([...envNames, ...guarded.envNames]),
        url: "",
        headerNames: [],
      },
    ],
  };
}
