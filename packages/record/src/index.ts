import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { McpClient, ToolDef, ToolResult } from "@ohmymcp/core";

export const CASSETTE_VERSION = 1 as const;
export const REDACTED = "[redacted]";

export type CassetteMode = "record" | "replay" | "auto";

export interface CassetteInteraction {
  key: string;
  request: {
    toolName: string;
    args: unknown;
  };
  response: {
    content: unknown;
    isError: boolean;
    raw: unknown;
  };
}

export interface Cassette {
  version: typeof CASSETTE_VERSION;
  interactions: CassetteInteraction[];
  tools?: ToolDef[];
}

export interface CassetteClientOptions {
  cassette: Cassette | null;
  /** 생략하면 auto 모드로 동작한다. */
  mode?: CassetteMode;
  /** 사용자 메시지에 표시할 카세트 파일 경로. */
  cassettePath?: string;
  /** close() 시 호출한다. 테스트에서는 인메모리 flush 함수를 넣으면 된다. */
  onFlush?: (cassette: Cassette) => Promise<void>;
  /** 같은 키에 다른 응답이 녹화될 때 호출한다. */
  onWarning?: (message: string) => void;
}

const NONDETERMINISTIC_KEYS = new Set([
  "id",
  "requestid",
  "sessionid",
  "timestamp",
  "createdat",
  "updatedat",
  "expiresat",
]);

const SENSITIVE_KEY_PARTS = [
  "authorization",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "token",
  "secret",
  "password",
];

const plainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

class CassetteJsonError extends TypeError {
  constructor(
    readonly path: string,
    readonly reason: string,
    readonly valueKind?: string,
  ) {
    super(`카세트 JSON에는 ${reason}: ${path}`);
    this.name = "CassetteJsonError";
  }
}

const normalizeKey = (key: string): string => key.replace(/[-_]/g, "").toLowerCase();

const sensitiveKey = (key: string): boolean => {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
};

/**
 * 객체 키 순서를 고정하고 객체의 undefined 필드를 제거하는 JSON 문자열화.
 *
 * 배열 순서는 보존한다. 배열의 undefined 원소는 JSON 직렬화와 같은 null로 남겨 인덱스 의미를
 * 유지한다.
 */
export function stableStringify(value: unknown): string {
  type Frame =
    | { type: "visit"; value: unknown }
    | { type: "arrayElement"; array: unknown[]; index: number }
    | { type: "emit"; text: string }
    | { type: "leave"; value: object };

  const active = new Set<object>();
  const parts: string[] = [];
  const frames: Frame[] = [{ type: "visit", value }];

  while (frames.length > 0) {
    const frame = frames.pop();
    if (frame === undefined) break;

    if (frame.type === "emit") {
      parts.push(frame.text);
      continue;
    }

    if (frame.type === "leave") {
      active.delete(frame.value);
      continue;
    }

    if (frame.type === "arrayElement") {
      if (!Object.hasOwn(frame.array, frame.index)) {
        throw new TypeError("stable JSON에는 sparse array를 사용할 수 없습니다.");
      }
      const element = frame.array[frame.index];
      frames.push({ type: "visit", value: element === undefined ? null : element });
      continue;
    }

    const current = frame.value;
    if (current === undefined) {
      parts.push("null");
      continue;
    }
    if (current === null || typeof current === "boolean" || typeof current === "string") {
      parts.push(JSON.stringify(current));
      continue;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new TypeError("stable JSON에는 유한한 숫자만 사용할 수 있습니다.");
      }
      parts.push(JSON.stringify(current));
      continue;
    }
    if (!Array.isArray(current) && !plainObject(current)) {
      throw new TypeError("stable JSON에는 JSON 객체, 배열, 원시값만 사용할 수 있습니다.");
    }
    if (active.has(current)) {
      throw new TypeError("stable JSON에는 순환 참조를 사용할 수 없습니다.");
    }
    active.add(current);

    if (Array.isArray(current)) {
      parts.push("[");
      frames.push({ type: "emit", text: "]" });
      frames.push({ type: "leave", value: current });
      for (let index = current.length - 1; index >= 0; index--) {
        frames.push({ type: "arrayElement", array: current, index });
        if (index > 0) frames.push({ type: "emit", text: "," });
      }
      continue;
    }

    parts.push("{");
    const keys = Object.keys(current)
      .filter((key) => current[key] !== undefined)
      .sort();
    frames.push({ type: "emit", text: "}" });
    frames.push({ type: "leave", value: current });
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index];
      if (key === undefined) continue;
      frames.push({ type: "visit", value: current[key] });
      frames.push({ type: "emit", text: `${JSON.stringify(key)}:` });
      if (index > 0) frames.push({ type: "emit", text: "," });
    }
  }

  return parts.join("");
}

export function matchKey(toolName: string, args: unknown): string {
  return createHash("sha256")
    .update(stableStringify({ args: args === undefined ? {} : args, toolName }))
    .digest("hex");
}

export function redact(value: unknown): unknown {
  return transformJson(value, { redactSecrets: true, removeNondeterministic: false });
}

export function snapshotContract(result: ToolResult): unknown {
  return transformJson(result.raw, { redactSecrets: true, removeNondeterministic: true });
}

export async function loadCassette(path: string): Promise<Cassette | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }

  const parsed = JSON.parse(text) as unknown;
  assertCassette(parsed, path);
  return cloneCassette(parsed);
}

export async function saveCassette(path: string, cassette: Cassette): Promise<void> {
  const prepared = prepareCassetteForWrite(cassette);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${stableStringify(prepared)}\n`, "utf8");
}

export function cassetteClient(inner: McpClient, options: CassetteClientOptions): McpClient {
  const mode = options.mode ?? "auto";
  if (mode !== "record" && mode !== "replay" && mode !== "auto") {
    throw new TypeError(`알 수 없는 카세트 모드입니다: ${String(mode)}`);
  }

  const cassette =
    mode === "record" ? emptyCassette() : cloneCassette(options.cassette ?? emptyCassette());
  const interactions = indexInteractions(cassette);
  const recordingFailures: Error[] = [];

  return {
    async listTools() {
      if (mode === "replay") {
        if (cassette.tools === undefined) {
          throw new Error(
            [
              "→ 카세트에 listTools 응답이 없습니다.",
              `  카세트: ${cassetteDescription(cassette, options.cassettePath)}`,
              "  → --record 로 한 번 실행해 tools 목록을 녹화하세요.",
            ].join("\n"),
          );
        }
        return cloneJson(cassette.tools, "tools") as ToolDef[];
      }

      if (mode === "auto" && cassette.tools !== undefined) {
        return cloneJson(cassette.tools, "tools") as ToolDef[];
      }

      const tools = await inner.listTools();
      try {
        cassette.tools = cloneJson(tools, "tools") as ToolDef[];
      } catch (error) {
        recordingFailures.push(cassetteRecordingFailure("listTools()", error));
      }
      return tools;
    },

    async callTool(toolName, args) {
      const key = matchKey(toolName, args);
      const existing = interactions.get(key);

      if ((mode === "replay" || mode === "auto") && existing !== undefined) {
        return cloneResponse(existing.response);
      }

      if (mode === "replay") {
        throw new Error(replayMissMessage(toolName, args, cassette, options.cassettePath));
      }

      const result = await inner.callTool(toolName, args);
      let next: CassetteInteraction;
      try {
        next = toInteraction(key, toolName, args, result);
      } catch (error) {
        recordingFailures.push(cassetteRecordingFailure(displayRequest(toolName, args), error));
        return result;
      }
      if (existing === undefined) {
        cassette.interactions.push(next);
        interactions.set(key, next);
      } else if (!sameJson(existing.response, next.response)) {
        options.onWarning?.(duplicateResponseMessage(toolName, args, existing, next));
      }
      return result;
    },

    async close() {
      try {
        if (recordingFailures.length > 0) throw mergeRecordingFailures(recordingFailures);
        await options.onFlush?.(prepareCassetteForWrite(cassette));
      } finally {
        await inner.close();
      }
    },
  };
}

function emptyCassette(): Cassette {
  return { version: CASSETTE_VERSION, interactions: [] };
}

function indexInteractions(cassette: Cassette): Map<string, CassetteInteraction> {
  const map = new Map<string, CassetteInteraction>();
  for (const interaction of cassette.interactions) {
    if (!map.has(interaction.key)) map.set(interaction.key, interaction);
  }
  return map;
}

function toInteraction(
  key: string,
  toolName: string,
  args: unknown,
  result: ToolResult,
): CassetteInteraction {
  return {
    key,
    request: { toolName, args: redact(args === undefined ? {} : args) },
    response: {
      content: cloneJson(result.content, "response.content"),
      isError: result.isError,
      raw: cloneJson(result.raw, "response.raw"),
    },
  };
}

function cloneResponse(response: CassetteInteraction["response"]): ToolResult {
  return {
    content: cloneJson(response.content, "response.content"),
    isError: response.isError,
    raw: cloneJson(response.raw, "response.raw"),
  };
}

function cloneCassette(cassette: Cassette): Cassette {
  assertCassette(cassette, "cassette");
  return cloneJson(cassette, "cassette") as Cassette;
}

function cloneJson(value: unknown, path: string): unknown {
  assertJsonCloneable(value, path);
  return JSON.parse(stableStringify(value)) as unknown;
}

function assertJsonCloneable(value: unknown, path: string): void {
  const active = new Set<object>();
  const visit = (current: unknown, currentPath: string): void => {
    if (current === undefined || current === null || typeof current === "boolean") return;
    if (typeof current === "string") return;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new CassetteJsonError(currentPath, "유한한 숫자만 사용할 수 있습니다");
      }
      return;
    }
    if (!Array.isArray(current) && !plainObject(current)) {
      throw new CassetteJsonError(
        currentPath,
        "JSON 객체, 배열, 원시값만 사용할 수 있습니다",
        valueKind(current),
      );
    }
    if (active.has(current)) {
      throw new CassetteJsonError(currentPath, "순환 참조를 사용할 수 없습니다");
    }

    active.add(current);
    try {
      if (Array.isArray(current)) {
        for (let index = 0; index < current.length; index++) {
          const nextPath = `${currentPath}[${index}]`;
          if (!Object.hasOwn(current, index)) {
            throw new CassetteJsonError(nextPath, "sparse array를 사용할 수 없습니다");
          }
          visit(current[index], nextPath);
        }
        return;
      }

      for (const key of Object.keys(current).sort()) {
        const next = current[key];
        if (next !== undefined) visit(next, jsonPath(currentPath, key));
      }
    } finally {
      active.delete(current);
    }
  };

  visit(value, path);
}

function cassetteRecordingFailure(operation: string, error: unknown): Error {
  const lines = [`→ 카세트 녹화에 실패했습니다: ${operation}`, "  실제 MCP 호출은 성공했습니다."];
  if (error instanceof CassetteJsonError) {
    lines.push(`  기록할 수 없는 값: ${error.path}`);
    if (error.valueKind !== undefined) lines.push(`  값 종류: ${error.valueKind}`);
    lines.push(`  이유: 카세트 JSON에는 ${error.reason}.`);
  } else if (error instanceof Error) {
    lines.push(`  이유: ${error.message}`);
  } else {
    lines.push(`  이유: ${String(error)}`);
  }
  lines.push("  → Date, Map, class instance는 JSON 객체나 문자열로 바꿔 반환하세요.");
  return new Error(lines.join("\n"), { cause: error });
}

function mergeRecordingFailures(failures: readonly Error[]): Error {
  const first = failures[0];
  if (failures.length === 1 && first !== undefined) return first;
  return new AggregateError(
    failures,
    [
      `카세트 녹화에 실패한 호출이 ${failures.length}개 있습니다.`,
      ...failures.map((failure, index) => `  ${index + 1}. ${failure.message.split("\n")[0]}`),
      "  → 위 오류를 고친 뒤 --record 로 카세트를 다시 만드세요.",
    ].join("\n"),
  );
}

function valueKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value !== "object") return typeof value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null) return "null-prototype object";
  const name = (prototype as { constructor?: { name?: unknown } }).constructor?.name;
  return typeof name === "string" && name.length > 0 ? name : "object";
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

function prepareCassetteForWrite(cassette: Cassette): Cassette {
  assertCassette(cassette, "cassette");
  return {
    version: CASSETTE_VERSION,
    interactions: cassette.interactions.map((interaction) => ({
      key: interaction.key,
      request: {
        toolName: interaction.request.toolName,
        args: redact(interaction.request.args),
      },
      response: {
        content: redact(interaction.response.content),
        isError: interaction.response.isError,
        raw: redact(interaction.response.raw),
      },
    })),
    ...(cassette.tools === undefined ? {} : { tools: redact(cassette.tools) as ToolDef[] }),
  };
}

function transformJson(
  value: unknown,
  options: { redactSecrets: boolean; removeNondeterministic: boolean },
): unknown {
  const active = new Set<object>();
  const visit = (current: unknown, key?: string): unknown => {
    if (key !== undefined && options.redactSecrets && sensitiveKey(key)) return REDACTED;
    if (current === undefined) return undefined;
    if (typeof current === "string") {
      return transformJsonString(current, visit);
    }
    if (current === null || typeof current === "boolean") {
      return current;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new TypeError("카세트 JSON에는 유한한 숫자만 사용할 수 있습니다.");
      }
      return current;
    }
    if (!Array.isArray(current) && !plainObject(current)) {
      throw new TypeError("카세트 JSON에는 JSON 객체, 배열, 원시값만 사용할 수 있습니다.");
    }
    if (active.has(current)) {
      throw new TypeError("카세트 JSON에는 순환 참조를 사용할 수 없습니다.");
    }
    active.add(current);
    try {
      if (Array.isArray(current)) {
        const output: unknown[] = [];
        for (let index = 0; index < current.length; index++) {
          if (!Object.hasOwn(current, index)) {
            throw new TypeError("카세트 JSON에는 sparse array를 사용할 수 없습니다.");
          }
          const next = visit(current[index]);
          output.push(next === undefined ? null : next);
        }
        return output;
      }

      const output: Record<string, unknown> = {};
      for (const objectKey of Object.keys(current).sort()) {
        if (options.removeNondeterministic && NONDETERMINISTIC_KEYS.has(normalizeKey(objectKey))) {
          continue;
        }
        const next = visit(current[objectKey], objectKey);
        if (next !== undefined) output[objectKey] = next;
      }
      return output;
    } finally {
      active.delete(current);
    }
  };

  return visit(value);
}

function transformJsonString(
  text: string,
  visit: (value: unknown, key?: string) => unknown,
): string {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return text;
  }

  const before = stableStringify(parsed);
  const after = stableStringify(visit(parsed));
  return before === after ? text : after;
}

function assertCassette(value: unknown, source: string): asserts value is Cassette {
  const fail = (message: string): never => {
    throw new Error(`→ ${source} 이(가) 올바른 카세트가 아닙니다: ${message}`);
  };

  if (!plainObject(value)) fail("객체가 아닙니다");
  const cassette = value as Record<string, unknown>;
  if (cassette.version !== CASSETTE_VERSION) fail("version 이 1 이 아닙니다");
  const interactions = arrayOrFail(cassette.interactions, () =>
    fail("interactions 가 배열이 아닙니다"),
  );

  for (const [index, interaction] of interactions.entries()) {
    if (!plainObject(interaction)) fail(`interactions[${index}] 가 객체가 아닙니다`);
    const item = interaction as Record<string, unknown>;
    if (typeof item.key !== "string") fail(`interactions[${index}].key 가 문자열이 아닙니다`);
    if (!plainObject(item.request)) fail(`interactions[${index}].request 가 객체가 아닙니다`);
    const request = item.request as Record<string, unknown>;
    if (typeof request.toolName !== "string") {
      fail(`interactions[${index}].request.toolName 이 문자열이 아닙니다`);
    }
    if (!("args" in request)) fail(`interactions[${index}].request.args 가 없습니다`);
    if (!plainObject(item.response)) fail(`interactions[${index}].response 가 객체가 아닙니다`);
    const response = item.response as Record<string, unknown>;
    if (!("content" in response)) fail(`interactions[${index}].response.content 가 없습니다`);
    if (typeof response.isError !== "boolean") {
      fail(`interactions[${index}].response.isError 가 boolean 이 아닙니다`);
    }
    if (!("raw" in response)) fail(`interactions[${index}].response.raw 가 없습니다`);
  }

  const toolsValue = cassette.tools;
  if (toolsValue !== undefined) {
    const tools = arrayOrFail(toolsValue, () => fail("tools 가 배열이 아닙니다"));
    for (const [index, tool] of tools.entries()) {
      if (!plainObject(tool)) fail(`tools[${index}] 가 객체가 아닙니다`);
      const item = tool as Record<string, unknown>;
      if (typeof item.name !== "string") fail(`tools[${index}].name 이 문자열이 아닙니다`);
      if ("description" in item && typeof item.description !== "string") {
        fail(`tools[${index}].description 이 문자열이 아닙니다`);
      }
      if (!("inputSchema" in item)) fail(`tools[${index}].inputSchema 가 없습니다`);
    }
  }
}

function arrayOrFail(value: unknown, fail: () => never): unknown[] {
  if (!Array.isArray(value)) fail();
  return value as unknown[];
}

function cassetteDescription(cassette: Cassette, cassettePath?: string): string {
  const count = `상호작용 ${cassette.interactions.length}개`;
  return cassettePath === undefined ? count : `${cassettePath} (${count})`;
}

function replayMissMessage(
  toolName: string,
  args: unknown,
  cassette: Cassette,
  cassettePath?: string,
): string {
  const display = displayRequest(toolName, args);
  const lines = [
    `→ 카세트에 없는 호출입니다: ${display}`,
    `  카세트: ${cassetteDescription(cassette, cassettePath)}`,
  ];
  const sameTool = cassette.interactions
    .filter((interaction) => interaction.request.toolName === toolName)
    .map((interaction) => displayRequest(interaction.request.toolName, interaction.request.args));

  if (sameTool.length > 0) {
    lines.push(`  비슷한 키: ${sameTool[0]}`);
    if (sameTool.length > 1) {
      lines.push(`  같은 툴의 다른 저장된 요청: ${sameTool.slice(1, 4).join(", ")}`);
    }
  } else {
    const tools = [
      ...new Set(cassette.interactions.map((interaction) => interaction.request.toolName)),
    ];
    lines.push(
      tools.length > 0
        ? `  저장된 툴: ${tools.map((tool) => `'${tool}'`).join(", ")}`
        : "  저장된 툴: 없음",
    );
  }
  lines.push("  → 케이스를 새로 추가했다면 --record 로 한 번 실행해 카세트를 갱신하세요.");
  return lines.join("\n");
}

interface JsonDiff {
  path: string;
  left: unknown;
  right: unknown;
  leftMissing?: boolean;
  rightMissing?: boolean;
}

const MAX_DIFF_LINES = 5;
const MAX_VALUE_DISPLAY = 160;

function duplicateResponseMessage(
  toolName: string,
  args: unknown,
  existing: CassetteInteraction,
  next: CassetteInteraction,
): string {
  const rawDiffs = describeJsonDiffs(existing.response.raw, next.response.raw, "raw");
  const contentDiffs =
    rawDiffs.length === 0
      ? describeJsonDiffs(existing.response.content, next.response.content, "content")
      : [];
  const responseDiffs =
    rawDiffs.length === 0 && contentDiffs.length === 0
      ? describeJsonDiffs(existing.response, next.response, "response")
      : [];
  const diffs = [...rawDiffs, ...contentDiffs, ...responseDiffs];
  const diffLines =
    diffs.length > 0
      ? diffs.map(
          (diff) =>
            `  1회차 ${diff.path}: ${formatDiffValue(
              diff.left,
              diff.leftMissing,
            )} / 2회차 ${diff.path}: ${formatDiffValue(diff.right, diff.rightMissing)}`,
        )
      : [
          `  1회차 응답: ${formatDiffValue(existing.response)}`,
          `  2회차 응답: ${formatDiffValue(next.response)}`,
        ];

  return [
    `→ 같은 요청에 다른 응답이 왔습니다: ${displayRequest(toolName, args)}`,
    ...diffLines,
    "  → 시세나 시간처럼 매번 바뀌는 값이라면 이 툴은 오라클로 쓸 수 없습니다.",
    "  → 의도된 변화라면 --record 로 카세트를 다시 만드세요.",
  ].join("\n");
}

function describeJsonDiffs(left: unknown, right: unknown, path: string): JsonDiff[] {
  const diffs: JsonDiff[] = [];
  collectJsonDiffs(left, right, path, diffs);
  return diffs;
}

function collectJsonDiffs(left: unknown, right: unknown, path: string, diffs: JsonDiff[]): void {
  if (diffs.length >= MAX_DIFF_LINES || sameJson(left, right)) return;

  if (plainObject(left) && plainObject(right)) {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      if (diffs.length >= MAX_DIFF_LINES) return;
      const leftHas = Object.hasOwn(left, key);
      const rightHas = Object.hasOwn(right, key);
      const nextPath = jsonPath(path, key);
      if (!leftHas || !rightHas) {
        diffs.push({
          path: nextPath,
          left: leftHas ? left[key] : undefined,
          right: rightHas ? right[key] : undefined,
          leftMissing: !leftHas,
          rightMissing: !rightHas,
        });
        continue;
      }
      collectJsonDiffs(left[key], right[key], nextPath, diffs);
    }
    return;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index++) {
      if (diffs.length >= MAX_DIFF_LINES) return;
      const leftHas = Object.hasOwn(left, index);
      const rightHas = Object.hasOwn(right, index);
      const nextPath = `${path}[${index}]`;
      if (!leftHas || !rightHas) {
        diffs.push({
          path: nextPath,
          left: leftHas ? left[index] : undefined,
          right: rightHas ? right[index] : undefined,
          leftMissing: !leftHas,
          rightMissing: !rightHas,
        });
        continue;
      }
      collectJsonDiffs(left[index], right[index], nextPath, diffs);
    }
    return;
  }

  diffs.push({ path, left, right });
}

function jsonPath(base: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`;
}

function formatDiffValue(value: unknown, missing = false): string {
  if (missing) return "<없음>";
  const text = stableStringify(value);
  return text.length <= MAX_VALUE_DISPLAY ? text : `${text.slice(0, MAX_VALUE_DISPLAY - 1)}…`;
}

function displayRequest(toolName: string, args: unknown): string {
  return `${toolName}(${stableStringify(redact(args === undefined ? {} : args))})`;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}
