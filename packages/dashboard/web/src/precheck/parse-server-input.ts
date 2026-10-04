/**
 * 붙여 넣은 글자 → 점검 대상(계획서 §5.2). 세 꼴을 받는다: mcpServers JSON 조각, 실행 명령 한 줄, URL.
 *
 * env 와 헤더는 **이름만** 남긴다. 값은 여기서 버려지고 요청에도 화면에도 실리지 않는다(ADR-0111).
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

/**
 * 실행 파일 앞에 붙은 환경변수 전달을 걷어 낸다. `KEY=value node s.mjs` 와 `env KEY=value node s.mjs`
 * 두 꼴이다. 이름만 남기고 값은 버린다. `env` 와 그 옵션(`-i` 등)도 버린다. env 를 넘기지 않으므로
 * 남길 뜻이 없다. 걷어 내지 않으면 값이 args 에 실려 대상 줄과 요청으로 나간다(ADR-0111).
 */
function stripEnv(tokens: readonly string[]): {
  readonly envNames: readonly string[];
  readonly rest: readonly string[];
} {
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
    while (tokens[index]?.startsWith("-") === true) index += 1;
  }
  return { envNames, rest: tokens.slice(index) };
}

function entryOf(name: string | null, value: unknown): PastedServer | string {
  const label = name === null ? "설정" : `'${name}' 항목`;
  if (!isRecord(value)) return `${label}이 객체가 아닙니다.`;
  if (typeof value.command === "string" && value.command.trim() !== "") {
    // `"command": "API_KEY=x node"`, `"command": "env API_KEY=x node"` 처럼 셸 줄을 통째로 적은 설정.
    // command 한 칸은 실행 파일 하나라 나눠 읽지 않는다. 받아들이면 그 값이 대상 줄과 요청에 실린다.
    // 값은 문장에 싣지 않는다.
    if (
      value.command
        .trim()
        .split(/\s+/)
        .some((token) => ENV_ASSIGNMENT.test(token))
    ) {
      return `${label}의 command 에 환경변수 할당이 있습니다. 값은 env 칸으로 옮기고 command 에는 실행 파일만 적으세요.`;
    }
    const args = value.args ?? [];
    if (!Array.isArray(args) || !args.every((arg): arg is string => typeof arg === "string")) {
      return `${label}의 args 는 문자열 배열이어야 합니다.`;
    }
    // `{"command":"env","args":["API_KEY=x","node","s.mjs"]}` 꼴. 값이 args 에 실리지 않게 걷어 낸다.
    const stripped = stripEnv([value.command.trim(), ...args]);
    const command = stripped.rest[0];
    if (command === undefined) {
      return `${label}에 실행 명령이 없습니다. 환경변수 뒤에 명령을 적으세요.`;
    }
    const declared = isRecord(value.env) ? Object.keys(value.env) : [];
    return {
      name,
      transport: "stdio",
      command,
      args: stripped.rest.slice(1),
      envNames: [...declared, ...stripped.envNames.filter((key) => !declared.includes(key))],
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
  const { envNames, rest } = stripEnv(tokens);
  const command = rest[0];
  if (command === undefined) return fail("실행 명령이 없습니다. 환경변수 뒤에 명령을 적으세요.");
  return {
    ok: true,
    servers: [
      {
        name: null,
        transport: "stdio",
        command,
        args: rest.slice(1),
        envNames,
        url: "",
        headerNames: [],
      },
    ],
  };
}
