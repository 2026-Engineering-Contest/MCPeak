import { isJsonObject, type JsonObject } from "./normalize.js";
import { OptimizeError, type OptimizeOverlay, OVERLAY_SCHEMA_VERSION } from "./types.js";

const CAPABILITIES: ReadonlySet<string> = new Set([
  "resources",
  "prompts",
  "logging",
  "completions",
]);
const CHANGE_KINDS: ReadonlySet<string> = new Set([
  "schema-key-removed",
  "description-cleaned",
  "description-removed",
]);

function describeValue(value: unknown): string {
  if (value === undefined) return "(없음)";
  if (Array.isArray(value)) return "배열";
  if (isJsonObject(value)) return "객체";
  return JSON.stringify(value);
}

/**
 * 형식 검사 실패. 문장은 한 줄이다. 프록시(계획서 §6)가 §7.3 의 "<원인 한 줄>" 자리에 그대로 넣고,
 * 파일 경로와 해결 문장은 그쪽이 붙인다. 필드 이름에 조사를 붙이지 않는 형태로 쓴다.
 */
function invalid(sourceLabel: string, field: string, expected: string, actual: unknown): never {
  throw new OptimizeError(
    "OVERLAY_INVALID",
    `${sourceLabel}: '${field}' 값이 형식에 맞지 않습니다. 기대: ${expected}, 실제: ${describeValue(actual)}`,
  );
}

class Reader {
  constructor(private readonly sourceLabel: string) {}

  object(value: unknown, field: string): JsonObject {
    return isJsonObject(value) ? value : invalid(this.sourceLabel, field, "객체", value);
  }

  string(value: unknown, field: string): string {
    return typeof value === "string" ? value : invalid(this.sourceLabel, field, "문자열", value);
  }

  count(value: unknown, field: string): number {
    return Number.isInteger(value) && (value as number) >= 0
      ? (value as number)
      : invalid(this.sourceLabel, field, "0 이상의 정수", value);
  }

  array(value: unknown, field: string): unknown[] {
    return Array.isArray(value) ? value : invalid(this.sourceLabel, field, "배열", value);
  }
}

function checkTool(read: Reader, sourceLabel: string, raw: unknown, field: string): void {
  const tool = read.object(raw, field);
  read.string(tool.name, `${field}.name`);
  if (tool.description !== undefined) read.string(tool.description, `${field}.description`);
  if (!Object.hasOwn(tool, "inputSchema")) {
    invalid(sourceLabel, `${field}.inputSchema`, "스키마", undefined);
  }
  read.array(tool.changes, `${field}.changes`).forEach((rawChange, index) => {
    const change = read.object(rawChange, `${field}.changes.${index}`);
    const kind = read.string(change.kind, `${field}.changes.${index}.kind`);
    if (!CHANGE_KINDS.has(kind)) {
      invalid(sourceLabel, `${field}.changes.${index}.kind`, [...CHANGE_KINDS].join(" | "), kind);
    }
    read.string(change.path, `${field}.changes.${index}.path`);
  });
  const bytes = read.object(tool.bytes, `${field}.bytes`);
  read.count(bytes.before, `${field}.bytes.before`);
  read.count(bytes.after, `${field}.bytes.after`);
}

/** 오버레이 JSON 을 읽어 형식을 검사한다. 실패하면 OptimizeError(OVERLAY_INVALID). */
export function parseOverlay(raw: unknown, sourceLabel: string): OptimizeOverlay {
  const read = new Reader(sourceLabel);
  const root = read.object(raw, "최상위");
  if (root.schemaVersion !== OVERLAY_SCHEMA_VERSION) {
    invalid(sourceLabel, "schemaVersion", String(OVERLAY_SCHEMA_VERSION), root.schemaVersion);
  }
  const generator = read.object(root.generator, "generator");
  if (generator.name !== "@mcpeak/optimize") {
    invalid(sourceLabel, "generator.name", '"@mcpeak/optimize"', generator.name);
  }
  read.string(generator.version, "generator.version");

  const source = read.object(root.source, "source");
  read.count(source.toolCount, "source.toolCount");
  read.array(source.toolNames, "source.toolNames").forEach((name, index) => {
    read.string(name, `source.toolNames.${index}`);
  });
  read.string(source.instructions, "source.instructions");
  read.count(source.bytes, "source.bytes");
  read.array(source.otherCapabilities, "source.otherCapabilities").forEach((cap, index) => {
    if (typeof cap !== "string" || !CAPABILITIES.has(cap)) {
      invalid(sourceLabel, `source.otherCapabilities.${index}`, [...CAPABILITIES].join(" | "), cap);
    }
  });

  read.string(root.instructions, "instructions");
  const tools = read.array(root.tools, "tools");
  tools.forEach((tool, index) => {
    checkTool(read, sourceLabel, tool, `tools.${index}`);
  });
  if (tools.length !== source.toolCount) {
    invalid(
      sourceLabel,
      "tools.length",
      `source.toolCount 와 같은 ${source.toolCount}`,
      tools.length,
    );
  }

  const totals = read.object(root.totals, "totals");
  for (const key of [
    "bytesBefore",
    "bytesAfter",
    "bytesAfterWithInstructions",
    "promotedParameters",
  ] as const) {
    read.count(totals[key], `totals.${key}`);
  }
  return root as unknown as OptimizeOverlay;
}
