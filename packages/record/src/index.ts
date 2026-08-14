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
  mode: CassetteMode;
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
  const mode = options.mode;
  if (mode !== "record" && mode !== "replay" && mode !== "auto") {
    throw new TypeError(`알 수 없는 카세트 모드입니다: ${String(mode)}`);
  }

  const cassette =
    mode === "record" ? emptyCassette() : cloneCassette(options.cassette ?? emptyCassette());
  const interactions = indexInteractions(cassette);

  return {
    async listTools() {
      if (mode === "replay") {
        if (cassette.tools === undefined) {
          throw new Error(
            "→ 카세트에 listTools 응답이 없습니다.\n  → --record 로 한 번 실행해 tools 목록을 녹화하세요.",
          );
        }
        return cloneJson(cassette.tools) as ToolDef[];
      }

      if (mode === "auto" && cassette.tools !== undefined) {
        return cloneJson(cassette.tools) as ToolDef[];
      }

      const tools = await inner.listTools();
      cassette.tools = cloneJson(tools) as ToolDef[];
      return tools;
    },

    async callTool(toolName, args) {
      const key = matchKey(toolName, args);
      const existing = interactions.get(key);

      if ((mode === "replay" || mode === "auto") && existing !== undefined) {
        return cloneResponse(existing.response);
      }

      if (mode === "replay") {
        throw new Error(replayMissMessage(toolName, args, cassette));
      }

      const result = await inner.callTool(toolName, args);
      const next = toInteraction(key, toolName, args, result);
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
        await options.onFlush?.(cloneCassette(cassette));
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
      content: redact(result.content),
      isError: result.isError,
      raw: redact(result.raw),
    },
  };
}

function cloneResponse(response: CassetteInteraction["response"]): ToolResult {
  return {
    content: cloneJson(response.content),
    isError: response.isError,
    raw: cloneJson(response.raw),
  };
}

function cloneCassette(cassette: Cassette): Cassette {
  assertCassette(cassette, "cassette");
  return cloneJson(cassette) as Cassette;
}

function cloneJson(value: unknown): unknown {
  return JSON.parse(stableStringify(value)) as unknown;
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
    ...(cassette.tools === undefined ? {} : { tools: cloneJson(cassette.tools) as ToolDef[] }),
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
        return current.map((item, index) => {
          if (!Object.hasOwn(current, index)) {
            throw new TypeError("카세트 JSON에는 sparse array를 사용할 수 없습니다.");
          }
          const next = visit(item);
          return next === undefined ? null : next;
        });
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

function replayMissMessage(toolName: string, args: unknown, cassette: Cassette): string {
  const display = displayRequest(toolName, args);
  const lines = [
    `→ 카세트에 없는 호출입니다: ${display}`,
    `  카세트 상호작용: ${cassette.interactions.length}개`,
  ];
  const sameTool = cassette.interactions
    .filter((interaction) => interaction.request.toolName === toolName)
    .map((interaction) => displayRequest(interaction.request.toolName, interaction.request.args));

  if (sameTool.length > 0) {
    lines.push(`  같은 툴의 저장된 요청: ${sameTool.slice(0, 3).join(", ")}`);
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

function duplicateResponseMessage(
  toolName: string,
  args: unknown,
  existing: CassetteInteraction,
  next: CassetteInteraction,
): string {
  return [
    `→ 같은 요청에 다른 응답이 왔습니다: ${displayRequest(toolName, args)}`,
    `  기존 응답: ${stableStringify(existing.response)}`,
    `  새 응답: ${stableStringify(next.response)}`,
    "  → 시세나 시간처럼 매번 바뀌는 값이라면 이 툴은 오라클로 쓸 수 없습니다.",
    "  → 의도된 변화라면 --record 로 카세트를 다시 만드세요.",
  ].join("\n");
}

function displayRequest(toolName: string, args: unknown): string {
  return `${toolName}(${stableStringify(redact(args === undefined ? {} : args))})`;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}
