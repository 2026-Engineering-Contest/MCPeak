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

/**
 * 마스킹 대상 키. 값은 구분자를 지우고 소문자로 맞춘 형태다.
 *
 * `accesstoken` · `refreshtoken` 은 접미 규칙상 `token` 에 이미 걸리지만, ADR-0003 이
 * 열거한 목록이라 그대로 둔다. 근거는 ADR-0039 다.
 */
const SENSITIVE_KEYS = new Set([
  "authorization",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "token",
  "secret",
  "password",
  "cookie",
]);

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

/**
 * 키를 단어로 쪼갠다. `-` · `_` 구분자와 카멜케이스 경계를 함께 본다.
 *
 * `normalizeKey` 를 쓰지 않는 이유는 그쪽이 구분자를 **지우기** 때문이다. 경계 정보가
 * 사라지면 `tokenCount` 와 `accessToken` 을 구분할 수 없다. `normalizeKey` 는
 * `NONDETERMINISTIC_KEYS` 조회와 공유하므로 건드리지 않는다.
 */
const keyWords = (key: string): string[] =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    // 연속 대문자 뒤에 단어가 오는 경우. `APIKey` → `API Key`
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[-_ ]+/)
    // 꼬리 숫자는 떼어 낸다. `apiKey0` 은 여전히 API 키다. 머리 명사를 바꾸지 않으므로
    // `cookieCount2` 가 새로 걸리지도 않는다.
    .map((word) => word.toLowerCase().replace(/[0-9]+$/, ""))
    .filter((word) => word.length > 0);

/**
 * 키의 **접미 단어열**이 목록과 정확히 일치하면 민감으로 본다.
 *
 * 부분 문자열 포함이 아니다. 영어 합성명사는 마지막 단어가 머리라서 `accessToken` 은
 * 토큰의 일종이고 `tokenCount` 는 개수의 일종이다. 포함으로 보면 둘이 구분되지 않아
 * `tokenCount` · `passwordPolicy` · `secretariat` 이 전부 걸린다. 과잉 마스킹은 값을
 * 지우므로, ADR-0041 이후에는 "그 필드를 테스트가 영영 못 본다"가 된다.
 *
 * 접미로 보되 한 단어씩만 보지 않는 이유는 `X-Api-Key` 다. 마지막 단어 `key` 는 목록에
 * 없고 `apikey` 가 있다.
 */
const sensitiveKey = (key: string): boolean => {
  const words = keyWords(key);
  for (let start = words.length - 1; start >= 0; start--) {
    if (SENSITIVE_KEYS.has(words.slice(start).join(""))) return true;
  }
  return false;
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
        return redactTools(cloneJson(cassette.tools, "tools") as ToolDef[]);
      }

      if (mode === "auto" && cassette.tools !== undefined) {
        return redactTools(cloneJson(cassette.tools, "tools") as ToolDef[]);
      }

      const tools = await inner.listTools();
      try {
        cassette.tools = cloneJson(tools, "tools") as ToolDef[];
      } catch (error) {
        recordingFailures.push(cassetteRecordingFailure("listTools()", error));
      }
      // redactTools 는 이름으로만 판정하고 JSON 클론 가능성을 요구하지 않으므로, 위 cloneJson
      // 실패 여부와 무관하게 안전하다 (ADR-0041).
      return redactTools(tools);
    },

    async callTool(toolName, args) {
      let key: string;
      try {
        assertJsonCloneable(args, "args");
        key = matchKey(toolName, args);
      } catch (error) {
        if (mode === "replay") {
          throw cassetteLookupFailure(toolName, args, cassette, options.cassettePath, error);
        }

        const result = await inner.callTool(toolName, args);
        recordingFailures.push(cassetteRecordingFailure(displayRequest(toolName, args), error));
        // 카세트로 클론할 수 없는 응답에 redact(JSON 클론을 전제한다)를 걸면 여기서 다시
        // 던져 실호출 결과를 돌려준다는 이 분기의 존재 이유가 무너진다. 마스킹 없이 원문을
        // 돌려준다 — 녹화 실패는 close() 가 이미 보고한다.
        return result;
      }
      const existing = interactions.get(key);

      if ((mode === "replay" || mode === "auto") && existing !== undefined) {
        return redactToolResult(cloneResponse(existing.response));
      }

      if (mode === "replay") {
        throw new Error(replayMissMessage(toolName, args, key, cassette, options.cassettePath));
      }

      const result = await inner.callTool(toolName, args);
      let next: CassetteInteraction;
      try {
        next = toInteraction(key, toolName, args, result);
      } catch (error) {
        recordingFailures.push(cassetteRecordingFailure(displayRequest(toolName, args), error));
        // 위와 같은 이유로 원문을 돌려준다.
        return result;
      }
      if (existing === undefined) {
        cassette.interactions.push(next);
        interactions.set(key, next);
      } else if (!sameJson(existing.response, next.response)) {
        options.onWarning?.(duplicateResponseMessage(toolName, args, existing, next));
      }
      // toInteraction 이 성공했으므로 content·raw 는 JSON 클론 가능함이 증명됐다 — redact 가
      // 던질 일이 없다.
      return redactToolResult(result);
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

function cassetteLookupFailure(
  toolName: string,
  args: unknown,
  cassette: Cassette,
  cassettePath: string | undefined,
  error: unknown,
): Error {
  const lines = [
    `→ 이 args 로는 카세트를 조회할 수 없습니다: ${displayRequest(toolName, args)}`,
    `  카세트: ${cassetteDescription(cassette, cassettePath)}`,
  ];
  if (error instanceof CassetteJsonError) {
    lines.push(`  조회할 수 없는 값: ${error.path}`);
    if (error.valueKind !== undefined) lines.push(`  값 종류: ${error.valueKind}`);
    lines.push(`  이유: 카세트 JSON에는 ${error.reason}.`);
  } else if (error instanceof Error) {
    lines.push(`  이유: ${error.message}`);
  } else {
    lines.push(`  이유: ${String(error)}`);
  }
  lines.push("  → Date, Map, class instance는 JSON 객체나 문자열로 바꿔 호출하세요.");
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
    ...(cassette.tools === undefined ? {} : { tools: redactTools(cassette.tools) }),
  };
}

/**
 * `tools` 는 데이터가 아니라 스키마라 `redact` 를 그대로 쓸 수 없다. `properties.<name>`
 * 의 이름은 값이 아니라 선언 대상이라, 이름으로 마스킹 여부를 결정하는 `redact` 를 그대로
 * 걸면 `{ type: "string", default: "sk-..." }` 같은 정의 객체 전체가 `"[redacted]"`
 * 문자열로 치환되어 스키마가 부서진다. 근거는 ADR-0040 이다.
 *
 * `name`·`description` 은 선언 대상 자체라 마스킹하지 않는다. `inputSchema` 만
 * 스키마 전용 규칙(`redactSchema`)을 탄다.
 */
function redactTools(tools: readonly ToolDef[]): ToolDef[] {
  return tools.map((tool) => ({
    name: tool.name,
    ...(tool.description === undefined ? {} : { description: tool.description }),
    inputSchema: redactSchema(tool.inputSchema, false),
  }));
}

/**
 * `callTool` 반환값을 마스킹한다. 값이 프로세스 밖으로 나가는 경계 중 하나다 (ADR-0041).
 *
 * 호출자는 `content`·`raw`가 JSON 클론 가능함을 이미 증명한 뒤에만 이 함수를 불러야 한다 —
 * `redact` 는 클론 불가능한 값(Date·순환 참조·비유한수 등)에 던진다. 녹화 실패 fallback
 * 분기(카세트에 담을 수 없는 응답)는 이 함수를 부르지 않고 원문을 그대로 돌려준다.
 */
function redactToolResult(result: ToolResult): ToolResult {
  return { content: redact(result.content), isError: result.isError, raw: redact(result.raw) };
}

/**
 * 스키마를 재귀한다. `sensitive` 는 이 노드가 마스킹 대상 프로퍼티 아래인지를 나타낸다.
 *
 * - `properties` 는 재귀하며, 각 프로퍼티의 민감도는 **그 이름으로 새로 판정하되 부모의
 *   민감도와 OR 로 합친다** (`sensitive || sensitiveKey(name)`). 한번 민감해진 하위
 *   트리는 이름이 안 걸려도 계속 민감하다 — `authorization.properties.value.default`
 *   처럼 감싸는 이름이 비밀값이면 안쪽 값도 비밀값이다. 이름 자체는 절대 마스킹하지
 *   않는다 — 선언 대상이지 값이 아니다.
 * - `items` 는 재귀하되 민감도를 부모에서 그대로 물려받는다. 배열 원소는 이름이 없다.
 * - `default` · `const` 는 단일 값이라 통째로 가린다. `examples` · `enum` 은 배열이라
 *   원소마다 가린다 — 허용값 목록에 실제 키가 들어 있는 경우가 있다.
 * - 그 외 키(`type`·`required`·`description`·`title`·`$schema` 와 ADR-0004 가
 *   해석하지 않는 `allOf`·`anyOf`·`oneOf` 등)는 그대로 둔다. 재귀도, 마스킹도 하지
 *   않는다 — 해석하지 않는 구조에 마스킹만 거는 것은 근거가 없다. **알려진 한계**: 민감한
 *   프로퍼티의 값이 이 미지원 키워드 안에 있으면(예: `apiKey: { anyOf: [{ default: "sk-..." }] }`)
 *   가려지지 않는다. ADR-0040 이 승인한 트레이드오프이고, 지원 범위가 늘어나면 함께 넓힌다.
 */
function redactSchema(schema: unknown, sensitive: boolean): unknown {
  if (!plainObject(schema)) return schema;

  const output: Record<string, unknown> = {};
  for (const key of Object.keys(schema)) {
    const value = schema[key];

    if (key === "properties" && plainObject(value)) {
      const nested: Record<string, unknown> = {};
      for (const name of Object.keys(value)) {
        nested[name] = redactSchema(value[name], sensitive || sensitiveKey(name));
      }
      output[key] = nested;
      continue;
    }
    if (key === "items") {
      output[key] = redactSchema(value, sensitive);
      continue;
    }
    if (sensitive && (key === "default" || key === "const")) {
      output[key] = REDACTED;
      continue;
    }
    if (sensitive && (key === "examples" || key === "enum") && Array.isArray(value)) {
      output[key] = value.map(() => REDACTED);
      continue;
    }
    output[key] = value;
  }
  return output;
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
  key: string,
  cassette: Cassette,
  cassettePath?: string,
): string {
  const display = displayRequest(toolName, args);
  const lines = [
    `→ 카세트에 없는 호출입니다: ${display}`,
    `  카세트: ${cassetteDescription(cassette, cassettePath)}`,
  ];
  const visibleArgs = redact(args === undefined ? {} : args);
  const sameTool = cassette.interactions
    .filter((interaction) => interaction.request.toolName === toolName)
    .map((interaction) => {
      const storedArgs = redact(interaction.request.args);
      return {
        interaction,
        storedArgs,
        differenceCount: countJsonDiffs(visibleArgs, storedArgs),
        display: displayRequest(interaction.request.toolName, storedArgs),
      };
    })
    .sort((left, right) => left.differenceCount - right.differenceCount);

  const nearest = sameTool[0];
  if (nearest !== undefined) {
    lines.push(`  가장 가까운 저장 요청: ${nearest.display}`);
    if (nearest.differenceCount === 0) {
      lines.push("  표시상 동일합니다. 마스킹된 비밀값이 다르거나 카세트의 key가 어긋났습니다.");
      lines.push(
        `  요청 key: ${key.slice(0, 8)} / 저장 key: ${nearest.interaction.key.slice(0, 8)}`,
      );
    } else {
      const displayDiffs = describeJsonDiffs(visibleArgs, nearest.storedArgs, "args");
      lines.push(
        ...displayDiffs.map(
          (diff) =>
            `  요청 ${diff.path}: ${formatDiffValue(
              diff.left,
              diff.leftMissing,
            )} / 저장 ${diff.path}: ${formatDiffValue(diff.right, diff.rightMissing)}`,
        ),
      );
    }
    if (sameTool.length > 1) {
      lines.push(
        `  같은 툴의 다른 저장된 요청: ${sameTool
          .slice(1, 4)
          .map((candidate) => candidate.display)
          .join(", ")}`,
      );
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
  /**
   * 이 지점이 마스킹 대상 키 아래인가. 차이 판정은 원문으로 하고 표시만 마스킹하는데,
   * 잎 값까지 내려오면 키를 알 수 없다. 그래서 수집 시점에 들고 나온다.
   */
  sensitive?: boolean;
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
              diff.sensitive,
            )} / 2회차 ${diff.path}: ${formatDiffValue(
              diff.right,
              diff.rightMissing,
              diff.sensitive,
            )}`,
        )
      : [
          `  1회차 응답: ${formatDiffValue(existing.response)}`,
          `  2회차 응답: ${formatDiffValue(next.response)}`,
        ];

  /**
   * 표시된 줄을 보고 판단한다. 폴백 가지(응답 전체 출력)도 값 안쪽이 마스킹되므로
   * `diffs` 만 봐서는 놓친다. 이 문장이 없으면 양쪽이 똑같이 `[redacted]` 로 보여
   * 거짓 양성처럼 읽힌다.
   */
  const masked = diffLines.some((line) => line.includes(REDACTED));

  return [
    `→ 같은 요청에 다른 응답이 왔습니다: ${displayRequest(toolName, args)}`,
    ...diffLines,
    ...(masked ? ["  → 위 값은 마스킹되어 표시됩니다. 실제 값은 서로 다릅니다."] : []),
    "  → 시세나 시간처럼 매번 바뀌는 값이라면 이 툴은 오라클로 쓸 수 없습니다.",
    "  → 의도된 변화라면 --record 로 카세트를 다시 만드세요.",
  ].join("\n");
}

function describeJsonDiffs(left: unknown, right: unknown, path: string): JsonDiff[] {
  const diffs: JsonDiff[] = [];
  collectJsonDiffs(left, right, path, diffs);
  return diffs;
}

function countJsonDiffs(left: unknown, right: unknown): number {
  if (sameJson(left, right)) return 0;

  if (plainObject(left) && plainObject(right)) {
    let count = 0;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      const leftHas = Object.hasOwn(left, key);
      const rightHas = Object.hasOwn(right, key);
      count += !leftHas || !rightHas ? 1 : countJsonDiffs(left[key], right[key]);
    }
    return count;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    let count = 0;
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index++) {
      const leftHas = Object.hasOwn(left, index);
      const rightHas = Object.hasOwn(right, index);
      count += !leftHas || !rightHas ? 1 : countJsonDiffs(left[index], right[index]);
    }
    return count;
  }

  return 1;
}

function collectJsonDiffs(
  left: unknown,
  right: unknown,
  path: string,
  diffs: JsonDiff[],
  sensitive = false,
): void {
  if (diffs.length >= MAX_DIFF_LINES || sameJson(left, right)) return;

  if (plainObject(left) && plainObject(right)) {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      if (diffs.length >= MAX_DIFF_LINES) return;
      const leftHas = Object.hasOwn(left, key);
      const rightHas = Object.hasOwn(right, key);
      const nextPath = jsonPath(path, key);
      // 상위가 민감하면 하위도 민감하다. redact 는 민감 키의 하위 트리를 통째로 지운다.
      const nextSensitive = sensitive || sensitiveKey(key);
      if (!leftHas || !rightHas) {
        diffs.push({
          path: nextPath,
          left: leftHas ? left[key] : undefined,
          right: rightHas ? right[key] : undefined,
          leftMissing: !leftHas,
          rightMissing: !rightHas,
          sensitive: nextSensitive,
        });
        continue;
      }
      collectJsonDiffs(left[key], right[key], nextPath, diffs, nextSensitive);
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
          sensitive,
        });
        continue;
      }
      collectJsonDiffs(left[index], right[index], nextPath, diffs, sensitive);
    }
    return;
  }

  diffs.push({ path, left, right, sensitive });
}

function jsonPath(base: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`;
}

/**
 * 사용자에게 보여줄 값 하나를 만든다.
 *
 * 차이 판정은 이미 원문으로 끝난 뒤다. 표시 시점에만 마스킹하는 이유는, 마스킹한 값으로
 * 비교하면 서로 다른 두 비밀값이 같아 보여 "같은 요청에 다른 응답" 자체를 놓치기 때문이다.
 * ADR-0003 이 이 경고에 기대한 효용(비결정 서버가 드러난다)이 거기서 죽는다.
 *
 * `sensitive` 는 값이 놓인 자리가 비밀값 자리라는 뜻이다. 그 외에는 값 안쪽의 민감 키만
 * 지운다. 잎 값에 `redact` 를 그냥 부르면 키가 없어 아무것도 마스킹되지 않는다.
 */
function formatDiffValue(value: unknown, missing = false, sensitive = false): string {
  if (missing) return "<없음>";
  let text: string;
  try {
    text = stableStringify(sensitive ? REDACTED : redact(value));
  } catch {
    // redact 는 Date·순환 참조·비유한수에 throw 한다. 한 줄 때문에 경고 전체를 잃지 않는다.
    return "<표시할 수 없는 값>";
  }
  return text.length <= MAX_VALUE_DISPLAY ? text : `${text.slice(0, MAX_VALUE_DISPLAY - 1)}…`;
}

function displayRequest(toolName: string, args: unknown): string {
  try {
    return `${toolName}(${stableStringify(redact(args === undefined ? {} : args))})`;
  } catch {
    return `${toolName}(<표시할 수 없는 인자>)`;
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}
