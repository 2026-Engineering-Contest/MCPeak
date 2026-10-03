import type { Finding, RawTool, RuleInfo, Severity } from "../types.js";

export const SCHEMA_RULES: readonly RuleInfo[] = [
  {
    id: "schema/secret-field",
    family: "schema",
    defaultSeverity: "medium",
    summary: "비밀값(비밀번호·토큰·키)을 인자로 받는 속성",
  },
  {
    id: "schema/exfil-channel",
    family: "schema",
    defaultSeverity: "medium",
    summary: "항상 채우라고 요구하는 제약 없는 자유 문자열 속성",
  },
  {
    id: "schema/annotation-mismatch",
    family: "schema",
    defaultSeverity: "high",
    summary: "readOnlyHint 가 true 인데 이름·설명이 상태 변경을 말하는 도구",
  },
  {
    id: "schema/missing-destructive-hint",
    family: "schema",
    defaultSeverity: "low",
    summary: "파괴적 이름인데 destructiveHint 를 선언하지 않은 도구",
  },
  {
    id: "schema/over-broad",
    family: "schema",
    defaultSeverity: "medium",
    summary: "명령·경로·URL·질의를 제약 없이 받는 입력",
  },
] as const;

/** 소문자로 접고 영숫자가 아닌 글자에서 나눈다. `[_\- ]` 와 문장부호·개행을 함께 경계로 본다. */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
/** 단어 경계 정규식용: 토큰을 공백으로 잇는다. `set_credentials` → `set credentials`. */
const spaced = (text: string): string => tokens(text).join(" ");
/** 이름 정확 일치용: 토큰을 `_` 로 잇는다. `API-Key` → `api_key`. */
const snake = (text: string): string => tokens(text).join("_");

const SECRET_FIELDS = new Set(
  (
    "password passwd pwd secret api_key apikey access_token auth_token bearer_token refresh_token " +
    "private_key ssh_key client_secret credentials credential token session_token aws_secret_access_key"
  ).split(" "),
);
const AUTH_TOOL = /\b(auth|login|authenticate|connect|configure|set_?credentials?|rotate|token)\b/;

const EXFIL_FIELDS = new Set(
  (
    "note notes sidenote feedback details extra additional metadata debug context " +
    "annotation reasoning remark remarks comment comments memo"
  ).split(" "),
);
const DEMAND =
  /\b(always|must|should|be sure to|make sure to|remember to) (include|pass|provide|fill|populate|attach|add)\b/;

const DESTRUCTIVE_VERB =
  /\b(delete|remove|destroy|wipe|erase|drop|truncate|purge|write|overwrite|modify|update|create|insert|mutate|change|reset|revoke|kill|terminate|send|post|publish|transfer|pay|commit|push|deploy)\b/;
const READ_VERB = /^(list|get|read|fetch|show|describe|search|find|query|check)$/;
const DESTRUCTIVE_FIRST =
  /^(delete|remove|destroy|wipe|erase|drop|truncate|purge|reset|revoke|kill|terminate)$/;

const BROAD_TOOL = /\b(shell|command|exec|execute|run|eval|script|sql|query|url|path|file)\b/;
const BROAD_FIELD = /^(command|cmd|shell|script|sql|query|url|path|file_?path|filename)$/;

const FIX = {
  secret: "비밀은 인자가 아니라 서버 환경변수로 받아야 합니다. 모델 컨텍스트에 비밀이 실립니다.",
  exfil: "모델이 대화 내용을 이 필드에 담아 보낼 수 있습니다. 필수가 아니면 요구 문장을 빼세요.",
  mismatch:
    "클라이언트는 readOnlyHint 를 보고 확인 없이 실행합니다. 주석을 false 로 고치거나 이름을 바꾸세요.",
  destructive:
    "주석을 쓰는 서버라면 destructiveHint: true 를 선언하세요. 클라이언트가 확인을 띄우는 근거입니다.",
  broad: "명령·경로·URL 은 enum·pattern 으로 좁히세요. 주입(CVE-2025-68144 류)의 입구입니다.",
} as const;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 걸린 키워드를 `<명령|경로|URL|질의>` 로 옮긴다. */
function broadKind(keyword: string): string {
  if (/^(sql|query)$/.test(keyword)) return "질의";
  if (keyword === "url") return "URL";
  if (/^(path|file|file_?path|filename)$/.test(keyword)) return "경로";
  return "명령";
}

interface Property {
  readonly name: string;
  readonly path: string;
  readonly schema: Json;
}

/** `inputSchema.properties` 최상위와 그 아래 중첩 `properties` 를 선언 순서대로 걷는다. */
function walkProperties(schema: Json, path: string, out: Property[]): Property[] {
  const properties = schema.properties;
  if (!isObject(properties)) return out;
  for (const [name, child] of Object.entries(properties)) {
    if (!isObject(child)) continue;
    const childPath = `${path}.properties.${name}`;
    out.push({ name, path: childPath, schema: child });
    walkProperties(child, childPath, out);
  }
  return out;
}

export function runSchemaRules(tools: readonly RawTool[]): Finding[] {
  const findings: Finding[] = [];
  tools.forEach((tool, toolIndex) => {
    const at = (path: string) => ({ kind: "tool", toolIndex, toolName: tool.name, path }) as const;
    const push = (
      ruleId: Finding["ruleId"],
      severity: Severity,
      path: string,
      message: string,
      fix: string,
      evidence: string[],
    ) => findings.push({ ruleId, severity, location: at(path), message, fix, evidence });

    const inputSchema = isObject(tool.inputSchema) ? tool.inputSchema : {};
    const annotations = isObject(tool.annotations) ? tool.annotations : undefined;
    const description = str(tool.description);
    const nameTokens = tokens(tool.name);
    const properties = walkProperties(inputSchema, "inputSchema", []);

    // schema/secret-field
    const authTool = AUTH_TOOL.test(tool.name.toLowerCase()) || AUTH_TOOL.test(spaced(tool.name));
    for (const p of properties) {
      if (!SECRET_FIELDS.has(snake(p.name))) continue;
      const message = `비밀값을 인자로 요구합니다: '${p.name}'`;
      push("schema/secret-field", authTool ? "info" : "medium", p.path, message, FIX.secret, [
        p.name,
      ]);
    }

    // schema/exfil-channel
    for (const p of properties) {
      if (!EXFIL_FIELDS.has(snake(p.name))) continue;
      const s = p.schema;
      if (s.type !== "string" || "enum" in s || "pattern" in s || "maxLength" in s) continue;
      const demand = DEMAND.exec(spaced(str(s.description))) ?? DEMAND.exec(spaced(description));
      if (!demand) continue;
      const message = `자유 문자열 필드 '${p.name}' 를 항상 채우라고 요구합니다`;
      push("schema/exfil-channel", "medium", p.path, message, FIX.exfil, [p.name, demand[0]]);
    }

    // schema/annotation-mismatch
    if (annotations?.readOnlyHint === true) {
      let verb: string | undefined;
      if (nameTokens.some((t) => READ_VERB.test(t))) {
        const first = nameTokens[0] ?? "";
        verb = DESTRUCTIVE_VERB.test(first) ? first : undefined;
      } else {
        const texts = [tool.name, str(tool.title), str(annotations.title), description];
        verb = texts.map((t) => DESTRUCTIVE_VERB.exec(spaced(t))?.[1]).find(Boolean);
      }
      if (verb) {
        const message = `readOnlyHint 가 true 인데 이름·설명이 '${verb}' 를 말합니다`;
        push("schema/annotation-mismatch", "high", "annotations", message, FIX.mismatch, [verb]);
      }
    }

    // schema/missing-destructive-hint
    const first = nameTokens[0] ?? "";
    if (
      annotations &&
      annotations.readOnlyHint !== true &&
      DESTRUCTIVE_FIRST.test(first) &&
      annotations.destructiveHint !== true
    ) {
      const message = "파괴적 이름인데 destructiveHint 가 없습니다";
      push("schema/missing-destructive-hint", "low", "annotations", message, FIX.destructive, [
        first,
      ]);
    }

    // schema/over-broad
    const top = inputSchema.properties;
    const noProperties = !isObject(top) || Object.keys(top).length === 0;
    const open =
      inputSchema.additionalProperties === undefined || inputSchema.additionalProperties === true;
    const broad = BROAD_TOOL.exec(spaced(tool.name)) ?? BROAD_TOOL.exec(spaced(description));
    if (noProperties && open && broad?.[1]) {
      const message = `입력 제약이 없는 ${broadKind(broad[1])} 인자입니다: 'inputSchema'`;
      push("schema/over-broad", "medium", "inputSchema", message, FIX.broad, [broad[1]]);
    }
    for (const p of properties) {
      const field = snake(p.name);
      const s = p.schema;
      if (!BROAD_FIELD.test(field) || s.type !== "string") continue;
      if ("pattern" in s || "enum" in s || "format" in s) continue;
      const message = `입력 제약이 없는 ${broadKind(field)} 인자입니다: '${p.name}'`;
      push("schema/over-broad", "info", p.path, message, FIX.broad, [p.name]);
    }
  });
  return findings;
}
