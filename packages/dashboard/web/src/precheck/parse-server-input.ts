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

function entryOf(name: string | null, value: unknown): PastedServer | string {
  const label = name === null ? "설정" : `'${name}' 항목`;
  if (!isRecord(value)) return `${label}이 객체가 아닙니다.`;
  if (typeof value.command === "string" && value.command.trim() !== "") {
    const args = value.args ?? [];
    if (!Array.isArray(args) || !args.every((arg): arg is string => typeof arg === "string")) {
      return `${label}의 args 는 문자열 배열이어야 합니다.`;
    }
    return {
      name,
      transport: "stdio",
      command: value.command.trim(),
      args,
      envNames: isRecord(value.env) ? Object.keys(value.env) : [],
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
  // 명령 앞의 `KEY=value` 는 env 다. 이름만 남긴다.
  let index = 0;
  const envNames: string[] = [];
  while (index < tokens.length && ENV_ASSIGNMENT.test(tokens[index] as string)) {
    const token = tokens[index] as string;
    envNames.push(token.slice(0, token.indexOf("=")));
    index += 1;
  }
  const command = tokens[index];
  if (command === undefined) return fail("실행 명령이 없습니다. 환경변수 뒤에 명령을 적으세요.");
  return {
    ok: true,
    servers: [
      {
        name: null,
        transport: "stdio",
        command,
        args: tokens.slice(index + 1),
        envNames,
        url: "",
        headerNames: [],
      },
    ],
  };
}
