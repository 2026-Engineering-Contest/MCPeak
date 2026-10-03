import { createHash } from "node:crypto";
import {
  AUDIT_SCHEMA_VERSION,
  type AuditBaseline,
  AuditError,
  type BaselineTool,
  type Finding,
  type RawTool,
  type RuleInfo,
} from "../types.js";

export const SURFACE_RULES: readonly RuleInfo[] = [
  {
    id: "surface/baseline-created",
    family: "surface",
    defaultSeverity: "info",
    summary: "기준 파일이 없어 지금 도구 표면으로 새로 만들었음을 알린다.",
  },
  {
    id: "surface/changed",
    family: "surface",
    defaultSeverity: "high",
    summary: "도구 정의가 기준 파일과 달라졌는지(러그풀) 도구·필드 단위로 본다.",
  },
] as const;

type Field = "title" | "description" | "inputSchema" | "outputSchema" | "annotations";
type Fields = NonNullable<BaselineTool["fields"]>;
type Hints = Fields["hints"];

/** 필드 비교 순서. 출력 순서는 §3.0 정렬(evidence 첫 값)이 정한다. */
const FIELDS: readonly Field[] = [
  "title",
  "description",
  "inputSchema",
  "outputSchema",
  "annotations",
];
const HINT_KEYS = ["readOnlyHint", "destructiveHint", "openWorldHint"] as const;

const CHANGED_FIX =
  "서버 갱신이 의도된 것이라면 --update-baseline 으로 기준을 갱신하세요. 아니면 등록하지 마세요.";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** 키를 코드 단위 순서로 정렬한 사본. 배열 순서는 의미가 있으므로 그대로 둔다. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function collapse(value: unknown): unknown {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : value;
}

/** §3.5 의 표면 정규화. 없는 필드는 null 로 자리를 지켜 필드 이동이 해시를 비껴가지 못하게 한다. */
function normalizeTool(tool: RawTool): Record<"name" | Field, unknown> {
  return {
    name: tool.name,
    title: collapse(tool.title) ?? null,
    description: collapse(tool.description) ?? null,
    inputSchema: canonical(tool.inputSchema) ?? null,
    outputSchema: canonical(tool.outputSchema) ?? null,
    annotations: canonical(tool.annotations) ?? null,
  };
}

function hintsOf(annotations: unknown): Hints {
  const hints: { -readonly [K in keyof Hints]: Hints[K] } = {};
  if (annotations === null || typeof annotations !== "object") return hints;
  for (const key of HINT_KEYS) {
    const value = (annotations as Record<string, unknown>)[key];
    if (typeof value === "boolean") hints[key] = value;
  }
  return hints;
}

function fieldsOf(tool: RawTool, normalized: Record<"name" | Field, unknown>): Fields {
  const hash = (field: Field) =>
    tool[field] === undefined ? "" : sha256(JSON.stringify(normalized[field]));
  return {
    title: hash("title"),
    description: hash("description"),
    inputSchema: hash("inputSchema"),
    outputSchema: hash("outputSchema"),
    annotations: hash("annotations"),
    hints: hintsOf(tool.annotations),
  };
}

function byCodeUnit(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

/**
 * 도구 표면의 해시. `server` 는 반환에 실어 `compareBaseline` 이 기준 파일의 서버와 대조하게 한다
 * (계획서 §5.2 시그니처에서 넓힌 부분. 오케스트레이터 승인).
 */
export function computeSurface(
  tools: readonly RawTool[],
  server: { name: string; version: string },
): {
  readonly tools: readonly BaselineTool[];
  readonly surfaceHash: string;
  readonly server: { readonly name: string; readonly version: string };
} {
  const baselineTools = [...tools]
    .sort((a, b) => byCodeUnit(a.name, b.name))
    .map((tool): BaselineTool => {
      const normalized = normalizeTool(tool);
      return {
        name: tool.name,
        hash: sha256(JSON.stringify(normalized)),
        fields: fieldsOf(tool, normalized),
      };
    });
  return {
    tools: baselineTools,
    surfaceHash: sha256(baselineTools.map((tool) => tool.hash).join("\n")),
    server: { name: server.name, version: server.version },
  };
}

/** 기준 파일의 형식 오류. 메시지는 §6.3 의 "<원인 한 줄>" 자리에 그대로 들어간다. */
function unreadable(cause: string): never {
  throw new AuditError("BASELINE_UNREADABLE", cause);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const HEX64 = /^[0-9a-f]{64}$/;

function readString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    unreadable(`${where}${key} 가 문자열이 아닙니다(${describe(value)}).`);
  }
  return value;
}

function readHash(record: Record<string, unknown>, key: string, where: string): string {
  const value = readString(record, key, where);
  if (!HEX64.test(value)) {
    unreadable(`${where}${key} 가 sha256 hex(64자 소문자)가 아닙니다: "${value.slice(0, 80)}"`);
  }
  return value;
}

function describe(value: unknown): string {
  if (value === undefined) return "없음";
  if (value === null) return "null";
  if (Array.isArray(value)) return "배열";
  return typeof value === "object" ? "객체" : `${typeof value} ${JSON.stringify(value)}`;
}

function readFields(value: unknown, where: string): Fields {
  if (!isRecord(value)) unreadable(`${where}fields 가 객체가 아닙니다(${describe(value)}).`);
  const fieldWhere = `${where}fields.`;
  const hashes = {} as Record<Field, string>;
  for (const field of FIELDS) {
    const hash = readString(value, field, fieldWhere);
    if (hash !== "" && !HEX64.test(hash)) {
      unreadable(
        `${fieldWhere}${field} 가 sha256 hex 도 빈 문자열도 아닙니다: "${hash.slice(0, 80)}"`,
      );
    }
    hashes[field] = hash;
  }
  const rawHints = value.hints;
  if (!isRecord(rawHints))
    unreadable(`${fieldWhere}hints 가 객체가 아닙니다(${describe(rawHints)}).`);
  const hints: { -readonly [K in keyof Hints]: Hints[K] } = {};
  for (const key of HINT_KEYS) {
    const hint = rawHints[key];
    if (hint === undefined) continue;
    if (typeof hint !== "boolean") {
      unreadable(`${fieldWhere}hints.${key} 가 true/false 가 아닙니다(${describe(hint)}).`);
    }
    hints[key] = hint;
  }
  return {
    title: hashes.title,
    description: hashes.description,
    inputSchema: hashes.inputSchema,
    outputSchema: hashes.outputSchema,
    annotations: hashes.annotations,
    hints,
  };
}

function readLaunch(value: unknown): NonNullable<AuditBaseline["launch"]> {
  if (!isRecord(value)) unreadable(`launch 가 객체가 아닙니다(${describe(value)}).`);
  const command = readString(value, "command", "launch.");
  const args = value.args;
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    unreadable("launch.args 가 문자열 배열이 아닙니다.");
  }
  if (value.package === undefined) return { command, args };
  const pkg = value.package;
  if (!isRecord(pkg)) unreadable(`launch.package 가 객체가 아닙니다(${describe(pkg)}).`);
  const manager = pkg.manager;
  if (manager !== "npm" && manager !== "pypi") {
    unreadable(
      `launch.package.manager 는 "npm" 또는 "pypi" 여야 하는데 ${describe(manager)} 입니다.`,
    );
  }
  const name = readString(pkg, "name", "launch.package.");
  if (pkg.version === undefined) return { command, args, package: { manager, name } };
  const version = readString(pkg, "version", "launch.package.");
  return { command, args, package: { manager, name, version } };
}

/**
 * 기준 파일 문자열을 읽는다. 실패하면 AuditError("BASELINE_UNREADABLE"). 반환 객체의 키 순서는
 * §5.1 선언 순서라 그대로 `JSON.stringify` 하면 같은 파일이 나온다. 모르는 키는 버린다.
 */
export function parseBaseline(text: string): AuditBaseline {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    unreadable(`JSON 으로 읽을 수 없습니다: ${reason}`);
  }
  if (!isRecord(data)) unreadable(`최상위가 객체가 아닙니다(${describe(data)}).`);
  if (data.schemaVersion !== AUDIT_SCHEMA_VERSION) {
    unreadable(
      `schemaVersion 이 ${AUDIT_SCHEMA_VERSION} 이어야 하는데 ${describe(data.schemaVersion)} 입니다. 다른 버전의 mcpeak 이 만든 기준 파일입니다.`,
    );
  }
  const server = data.server;
  if (!isRecord(server)) unreadable(`server 가 객체가 아닙니다(${describe(server)}).`);
  const serverInfo = {
    name: readString(server, "name", "server."),
    version: readString(server, "version", "server."),
  };
  if (!Array.isArray(data.tools)) unreadable(`tools 가 배열이 아닙니다(${describe(data.tools)}).`);
  const tools = data.tools.map((tool, index): BaselineTool => {
    const where = `tools[${index}].`;
    if (!isRecord(tool)) unreadable(`tools[${index}] 가 객체가 아닙니다(${describe(tool)}).`);
    const name = readString(tool, "name", where);
    const hash = readHash(tool, "hash", where);
    if (tool.fields === undefined) return { name, hash };
    return { name, hash, fields: readFields(tool.fields, where) };
  });
  const surfaceHash = readHash(data, "surfaceHash", "");
  const base = { schemaVersion: AUDIT_SCHEMA_VERSION, server: serverInfo, tools, surfaceHash };
  return data.launch === undefined ? base : { ...base, launch: readLaunch(data.launch) };
}

function changed(
  name: string,
  what: string,
  severity: Finding["severity"],
  evidence: string,
): Finding {
  return {
    ruleId: "surface/changed",
    severity,
    location: { kind: "surface", path: "" },
    message: `도구 '${name}' 의 ${what} 가 기준과 다릅니다`,
    fix: CHANGED_FIX,
    evidence: [evidence],
  };
}

/** §3.5: readOnlyHint true→false·사라짐, destructiveHint false→true, openWorldHint false→true. */
function relaxed(before: Hints, after: Hints): boolean {
  return (
    (before.readOnlyHint === true && after.readOnlyHint !== true) ||
    (before.destructiveHint === false && after.destructiveHint === true) ||
    (before.openWorldHint === false && after.openWorldHint === true)
  );
}

function fieldSeverity(field: Field, before: Fields, after: Fields): Finding["severity"] {
  switch (field) {
    case "title":
    case "description":
      return "high";
    case "inputSchema":
    case "outputSchema":
      return "medium";
    case "annotations":
      return relaxed(before.hints, after.hints) ? "high" : "low";
  }
}

function compareTool(name: string, before: BaselineTool, after: BaselineTool): Finding[] {
  // 필드 해시가 없는 기준 파일은 어느 필드가 바뀌었는지 모른다. 가장 무거운 경우로 본다.
  if (before.fields === undefined || after.fields === undefined) {
    return [changed(name, "정의", "high", `${name}.정의`)];
  }
  const beforeFields = before.fields;
  const afterFields = after.fields;
  const findings = FIELDS.filter((field) => beforeFields[field] !== afterFields[field]).map(
    (field) =>
      changed(name, field, fieldSeverity(field, beforeFields, afterFields), `${name}.${field}`),
  );
  // 도구 해시는 다른데 필드 해시가 모두 같으면 정규화 규칙이 바뀐 것이다. 조용히 넘기지 않는다.
  return findings.length > 0 ? findings : [changed(name, "정의", "high", `${name}.정의`)];
}

/**
 * 기준 파일과 지금 표면을 비교한다. 서버 이름이 다르면 AuditError("BASELINE_SERVER_MISMATCH").
 * 버전 차이는 정상 갱신이라 대조하지 않는다. `tools` 는 시그니처 호환을 위해 받지만 쓰지 않는다
 * (필드 비교 재료가 `current.tools[].fields` 에 이미 있다).
 */
export function compareBaseline(
  baseline: AuditBaseline,
  current: ReturnType<typeof computeSurface>,
  _tools: readonly RawTool[],
): Finding[] {
  if (baseline.server.name !== current.server.name) {
    throw new AuditError(
      "BASELINE_SERVER_MISMATCH",
      `기준 파일은 서버 '${baseline.server.name}' 의 것인데 지금 서버는 '${current.server.name}' 입니다.`,
    );
  }
  if (baseline.surfaceHash === current.surfaceHash) return [];

  const before = new Map(baseline.tools.map((tool) => [tool.name, tool]));
  const after = new Map(current.tools.map((tool) => [tool.name, tool]));
  const findings: Finding[] = [];
  for (const [name, tool] of before) {
    const now = after.get(name);
    if (now === undefined) {
      findings.push({
        ruleId: "surface/changed",
        severity: "medium",
        location: { kind: "surface", path: "" },
        message: `기준에 있던 도구 '${name}' 이 없어졌습니다`,
        fix: CHANGED_FIX,
        evidence: [name, "removed"],
      });
    } else if (now.hash !== tool.hash) {
      findings.push(...compareTool(name, tool, now));
    }
  }
  for (const name of after.keys()) {
    if (before.has(name)) continue;
    findings.push({
      ruleId: "surface/changed",
      severity: "low",
      location: { kind: "surface", path: "" },
      message: `기준에 없던 도구 '${name}' 이 생겼습니다`,
      fix: CHANGED_FIX,
      evidence: [name, "added"],
    });
  }
  // 모든 발견이 같은 ruleId·path 라 §3.0 정렬은 evidence 첫 값(도구 이름 기반)이 정한다.
  return findings.sort((a, b) => byCodeUnit(a.evidence[0] ?? "", b.evidence[0] ?? ""));
}

/** 지금 표면으로 기준 파일 내용을 만든다. 키 순서는 §5.1 선언 순서이고 `launch` 는 있을 때만 둔다. */
export function buildBaseline(
  current: ReturnType<typeof computeSurface>,
  launch?: AuditBaseline["launch"],
): AuditBaseline {
  const base = {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    server: { name: current.server.name, version: current.server.version },
    tools: current.tools,
    surfaceHash: current.surfaceHash,
  };
  return launch === undefined ? base : { ...base, launch };
}

/**
 * 기준 파일 문자열. §4 에 따라 types.ts 선언 순서의 키로 `JSON.stringify(value, null, 2)` 뒤 개행 하나.
 * 호출자가 키 순서가 다른 객체를 넘겨도 같은 글자가 나오도록 `parseBaseline` 과 같은 경로로 다시 세운다.
 */
export function serializeBaseline(baseline: AuditBaseline): string {
  return `${JSON.stringify(parseBaseline(JSON.stringify(baseline)), null, 2)}\n`;
}
