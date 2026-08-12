import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ToolDef } from "@ohmymcp/core";
import type { TestCaseSpec, TestSuiteSpec } from "@ohmymcp/runner";

export type {
  AuthoringDispatchResult,
  AuthoringProviderResult,
  AuthoringRequest,
  AuthoringRequestBinding,
  AuthoringRequestMode,
  AuthoringRequestPreview,
  McpToolContext,
  PublicProviderFailure,
  TestAuthoringProvider,
} from "./authoring-request.js";
export {
  DEFAULT_MAX_RESULT_BYTES,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  dispatchAuthoringRequest,
  MAX_PROMPT_BYTES,
  MAX_PROVIDER_TIMEOUT_MS,
  MAX_REQUEST_BYTES,
  MAX_TOOLS_BYTES,
  prepareAuthoringRequest,
  validateAuthoringProviderResult,
} from "./authoring-request.js";
export { AUTHORING_OUTPUT_SCHEMA, PROVIDER_OUTPUT_SCHEMA } from "./authoring-schema.js";
export {
  applyAuthoringChanges,
  createAuthoringDiff,
  createAuthoringSession,
  finalizeAuthoringDraft,
  getAuthoringExecutionSuite,
  reviewLocalAuthoringCandidate,
} from "./authoring-session.js";
export type {
  ApplyAuthoringChangesResult,
  AuthoringChange,
  AuthoringDiffPreview,
  AuthoringDraft,
  AuthoringExecutionSnapshot,
  AuthoringSessionView,
  CaseProvenance,
  GenerateReviewApproval,
  SanitizedAuthoringCandidate,
} from "./authoring-types.js";
export {
  BASELINE_POLICY_VERSION,
  type BaselineGenerationResult,
  type BaselineSuiteOptions,
  createBaselineSuite,
  DEFAULT_BASELINE_TIMEOUT_MS,
} from "./baseline.js";
export type {
  AuthoringProviderFailureCode,
  ProviderProcessChild,
  ProviderProcessDeps,
  ProviderProcessResult,
  ProviderProcessSpec,
} from "./provider-process.js";
export {
  createClaudeAuthoringProvider,
  createClaudeProvider,
  createCodexAuthoringProvider,
  createCodexProvider,
  PROVIDER_ENV_ALLOWLIST,
} from "./providers.js";

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };
type GeneratedSuiteSpec = TestSuiteSpec;

/** 테스트 코드를 생성할 때의 옵션. */
export interface GenerateOptions {
  outDir: string;
}

export type GenerateTestsErrorCode =
  | "INVALID_OPTIONS"
  | "INVALID_TOOL"
  | "UNSUPPORTED_SCHEMA"
  | "GENERATED_SUITE_INVALID";

/** 생성 전에 발견한 입력 또는 스키마 오류. */
export class GenerateTestsError extends Error {
  override readonly name = "GenerateTestsError";

  constructor(
    readonly code: GenerateTestsErrorCode,
    readonly path: string,
    message: string,
    readonly hint: string,
  ) {
    super(message);
  }
}

type JsonSchema = Record<string, unknown>;
type SchemaType = "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";

const SCHEMA_TYPES = new Set<SchemaType>([
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
]);
const SUPPORTED_SCHEMA_KEYS = new Set([
  "type",
  "required",
  "properties",
  "items",
  "enum",
  "const",
  "default",
  "examples",
  // 설명용 annotation은 입력값 합성에 영향을 주지 않으므로 안전하게 무시한다.
  "description",
  "title",
]);
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

const plainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function fail(code: GenerateTestsErrorCode, path: string, message: string, hint: string): never {
  throw new GenerateTestsError(code, path, message, hint);
}

function assertJsonValue(value: unknown, path: string): asserts value is JsonValue {
  type Frame = { value: unknown; path: string; leave?: object };
  const active = new Set<object>();
  const frames: Frame[] = [{ value, path }];

  while (frames.length > 0) {
    const frame = frames.pop();
    if (frame === undefined) break;
    if (frame.leave !== undefined) {
      active.delete(frame.leave);
      continue;
    }
    const current = frame.value;
    if (current === null || typeof current === "string" || typeof current === "boolean") continue;
    if (typeof current === "number" && Number.isFinite(current)) continue;
    if (!Array.isArray(current) && !plainObject(current)) {
      fail(
        "UNSUPPORTED_SCHEMA",
        frame.path,
        `JSON으로 표현할 수 없는 스키마 값이 있습니다: ${frame.path}`,
        "문자열, 유한한 숫자, boolean, null, 배열 또는 일반 객체를 사용하세요.",
      );
    }
    if (active.has(current)) {
      fail(
        "UNSUPPORTED_SCHEMA",
        frame.path,
        `순환 참조가 있는 스키마 값은 생성할 수 없습니다: ${frame.path}`,
        "순환 참조를 제거하고 JSON 값으로 전달하세요.",
      );
    }
    active.add(current);
    frames.push({ value: undefined, path: frame.path, leave: current });
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index--) {
        if (!(index in current)) {
          fail(
            "UNSUPPORTED_SCHEMA",
            `${frame.path}[${index}]`,
            `비어 있는 배열 슬롯은 JSON 입력값으로 사용할 수 없습니다: ${frame.path}[${index}]`,
            "배열의 모든 위치에 JSON 값을 지정하세요.",
          );
        }
        frames.push({ value: current[index], path: `${frame.path}[${index}]` });
      }
    } else {
      const keys = Object.keys(current).sort().reverse();
      for (const key of keys) {
        frames.push({ value: current[key], path: `${frame.path}.${key}` });
      }
    }
  }
}

function schemaType(schema: JsonSchema, path: string): SchemaType {
  const type = schema.type;
  if (typeof type !== "string" || !SCHEMA_TYPES.has(type as SchemaType)) {
    return fail(
      "UNSUPPORTED_SCHEMA",
      `${path}.type`,
      `지원하는 단일 JSON Schema type이 필요합니다: ${path}.type`,
      "string, number, integer, boolean, object, array, null 중 하나를 지정하세요.",
    );
  }
  return type as SchemaType;
}

function validateSchema(
  schema: unknown,
  path: string,
  active: Set<object>,
): asserts schema is JsonSchema {
  if (!plainObject(schema)) {
    fail(
      "UNSUPPORTED_SCHEMA",
      path,
      `스키마가 일반 객체가 아닙니다: ${path}`,
      "JSON Schema 객체를 전달하세요.",
    );
  }
  if (active.has(schema)) {
    fail(
      "UNSUPPORTED_SCHEMA",
      path,
      `순환 참조가 있는 스키마는 지원하지 않습니다: ${path}`,
      "$ref 대신 첫 버전이 지원하는 인라인 스키마를 사용하세요.",
    );
  }
  active.add(schema);
  try {
    const unsupported = Object.keys(schema)
      .filter((key) => !SUPPORTED_SCHEMA_KEYS.has(key))
      .sort()[0];
    if (unsupported !== undefined) {
      fail(
        "UNSUPPORTED_SCHEMA",
        `${path}.${unsupported}`,
        `지원하지 않는 JSON Schema 키워드 '${unsupported}'가 있습니다.`,
        `첫 버전은 ${[...SUPPORTED_SCHEMA_KEYS].join(", ")}를 지원합니다.`,
      );
    }

    const type = schemaType(schema, path);
    for (const annotation of ["description", "title"] as const) {
      if (annotation in schema && typeof schema[annotation] !== "string") {
        fail(
          "UNSUPPORTED_SCHEMA",
          `${path}.${annotation}`,
          `'${annotation}' annotation은 문자열이어야 합니다.`,
          `문자열 ${annotation}을 사용하거나 해당 필드를 제거하세요.`,
        );
      }
    }
    for (const candidate of ["const", "default"] as const) {
      if (candidate in schema) assertJsonValue(schema[candidate], `${path}.${candidate}`);
    }
    for (const candidates of ["examples", "enum"] as const) {
      if (!(candidates in schema)) continue;
      const value = schema[candidates];
      if (!Array.isArray(value)) {
        fail(
          "UNSUPPORTED_SCHEMA",
          `${path}.${candidates}`,
          `'${candidates}'는 배열이어야 합니다.`,
          `JSON 값 배열로 ${candidates}을 지정하세요.`,
        );
      }
      if (candidates === "enum" && value.length === 0) {
        fail(
          "UNSUPPORTED_SCHEMA",
          `${path}.enum`,
          "빈 enum에서는 실행 가능한 값을 선택할 수 없습니다.",
          "enum에 한 개 이상의 JSON 값을 지정하세요.",
        );
      }
      assertJsonValue(value, `${path}.${candidates}`);
    }

    if (type === "object") {
      if ("items" in schema) {
        fail(
          "UNSUPPORTED_SCHEMA",
          `${path}.items`,
          "object 스키마에는 items를 사용할 수 없습니다.",
          "items는 array 스키마에서만 사용하세요.",
        );
      }
      const properties = "properties" in schema ? schema.properties : {};
      if (!plainObject(properties)) {
        fail(
          "UNSUPPORTED_SCHEMA",
          `${path}.properties`,
          "properties는 스키마 객체의 맵이어야 합니다.",
          "각 프로퍼티 이름에 JSON Schema 객체를 지정하세요.",
        );
      }
      for (const key of Object.keys(properties).sort()) {
        validateSchema(properties[key], `${path}.properties.${key}`, active);
      }
      const required = "required" in schema ? schema.required : [];
      if (!Array.isArray(required) || required.some((key) => typeof key !== "string")) {
        fail(
          "UNSUPPORTED_SCHEMA",
          `${path}.required`,
          "required는 프로퍼티 이름 문자열의 배열이어야 합니다.",
          "필수 프로퍼티 이름만 required에 지정하세요.",
        );
      }
      const seen = new Set<string>();
      for (let index = 0; index < required.length; index++) {
        const key = required[index] as string;
        if (seen.has(key) || !(key in properties)) {
          fail(
            "UNSUPPORTED_SCHEMA",
            `${path}.required[${index}]`,
            `필수 프로퍼티 '${key}'를 결정론적으로 생성할 수 없습니다.`,
            "required 이름을 중복 없이 properties에 선언하세요.",
          );
        }
        seen.add(key);
      }
    } else if ("properties" in schema || "required" in schema) {
      const keyword = "properties" in schema ? "properties" : "required";
      fail(
        "UNSUPPORTED_SCHEMA",
        `${path}.${keyword}`,
        `'${keyword}'는 object 스키마에서만 사용할 수 있습니다.`,
        `type을 object로 변경하거나 '${keyword}'를 제거하세요.`,
      );
    }

    if (type === "array") {
      if (!("items" in schema)) {
        fail(
          "UNSUPPORTED_SCHEMA",
          `${path}.items`,
          "array 입력값을 생성하려면 items 스키마가 필요합니다.",
          "생성할 배열 원소의 스키마를 items에 지정하세요.",
        );
      }
      validateSchema(schema.items, `${path}.items`, active);
    } else if ("items" in schema) {
      fail(
        "UNSUPPORTED_SCHEMA",
        `${path}.items`,
        "items는 array 스키마에서만 사용할 수 있습니다.",
        "type을 array로 변경하거나 items를 제거하세요.",
      );
    }
  } finally {
    active.delete(schema);
  }
}

function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonEqual(value, right[index] as JsonValue))
    );
  }
  if (plainObject(left) && plainObject(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] && jsonEqual(left[key] as JsonValue, right[key] as JsonValue),
      )
    );
  }
  return false;
}

function valueMatchesSchema(value: JsonValue, schema: JsonSchema): boolean {
  const type = schema.type as SchemaType;
  const typeMatches =
    type === "null"
      ? value === null
      : type === "array"
        ? Array.isArray(value)
        : type === "object"
          ? plainObject(value)
          : type === "integer"
            ? typeof value === "number" && Number.isInteger(value)
            : type === "number"
              ? typeof value === "number" && Number.isFinite(value)
              : typeof value === type;
  if (!typeMatches) return false;
  if ("const" in schema && !jsonEqual(value, schema.const as JsonValue)) return false;
  if (
    Array.isArray(schema.enum) &&
    schema.enum.length > 0 &&
    !schema.enum.some((candidate) => jsonEqual(value, candidate as JsonValue))
  )
    return false;
  if (type === "object" && plainObject(value)) {
    const properties = ("properties" in schema ? schema.properties : {}) as Record<
      string,
      JsonSchema
    >;
    const required = ("required" in schema ? schema.required : []) as string[];
    if (required.some((key) => !(key in value))) return false;
    return Object.keys(value).every(
      (key) =>
        properties[key] === undefined ||
        valueMatchesSchema(value[key] as JsonValue, properties[key]),
    );
  }
  if (type === "array" && Array.isArray(value)) {
    return value.every((item) => valueMatchesSchema(item, schema.items as JsonSchema));
  }
  return true;
}

function synthesizeValue(schema: JsonSchema, path: string): JsonValue {
  let value: JsonValue;
  if ("const" in schema) value = schema.const as JsonValue;
  else if ("default" in schema) value = schema.default as JsonValue;
  else if (Array.isArray(schema.examples) && schema.examples.length > 0)
    value = schema.examples[0] as JsonValue;
  else if (Array.isArray(schema.enum)) value = schema.enum[0] as JsonValue;
  else {
    switch (schema.type as SchemaType) {
      case "string":
        value = "example";
        break;
      case "number":
      case "integer":
        value = 0;
        break;
      case "boolean":
        value = true;
        break;
      case "null":
        value = null;
        break;
      case "array":
        value = [synthesizeValue(schema.items as JsonSchema, `${path}.items`)];
        break;
      case "object": {
        const properties = ("properties" in schema ? schema.properties : {}) as Record<
          string,
          JsonSchema
        >;
        const required = ("required" in schema ? schema.required : []) as string[];
        value = Object.fromEntries(
          required.map((key) => [
            key,
            synthesizeValue(properties[key] as JsonSchema, `${path}.properties.${key}`),
          ]),
        );
        break;
      }
    }
  }
  if (!valueMatchesSchema(value, schema)) {
    fail(
      "UNSUPPORTED_SCHEMA",
      path,
      `선택한 입력 후보가 스키마 제약을 만족하지 않습니다: ${path}`,
      "const, default, examples[0], enum[0] 또는 타입 제약을 확인하세요.",
    );
  }
  return value;
}

export function safeGeneratedBaseName(name: string, index: number): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug.length === 0 || WINDOWS_RESERVED_NAMES.test(slug) ? `tool-${index + 1}` : slug;
}

function buildSuite(tool: ToolDef, index: number, baseName: string): GeneratedSuiteSpec {
  const toolPath = `tools[${index}]`;
  if (!plainObject(tool)) {
    fail(
      "INVALID_TOOL",
      toolPath,
      `도구 정의가 객체가 아닙니다: ${toolPath}`,
      "name과 inputSchema가 있는 ToolDef 객체를 전달하세요.",
    );
  }
  if (typeof tool.name !== "string" || !/\S/.test(tool.name)) {
    fail(
      "INVALID_TOOL",
      `${toolPath}.name`,
      `도구 이름이 비어 있습니다: ${toolPath}.name`,
      "비어 있지 않은 MCP 도구 이름을 지정하세요.",
    );
  }
  validateSchema(tool.inputSchema, `${toolPath}.inputSchema`, new Set());
  if ((tool.inputSchema as JsonSchema).type !== "object") {
    fail(
      "UNSUPPORTED_SCHEMA",
      `${toolPath}.inputSchema.type`,
      `도구 입력 스키마의 루트는 object여야 합니다: ${tool.name}`,
      "MCP 도구 인자를 object JSON Schema로 선언하세요.",
    );
  }
  const input = synthesizeValue(tool.inputSchema as JsonSchema, `${toolPath}.inputSchema`);
  if (!plainObject(input)) {
    fail(
      "GENERATED_SUITE_INVALID",
      `${toolPath}.inputSchema`,
      `도구 입력을 JSON 객체로 생성하지 못했습니다: ${tool.name}`,
      "입력 스키마의 루트 type과 required 프로퍼티를 확인하세요.",
    );
  }
  return {
    schemaVersion: 1,
    id: `${baseName}-generated`,
    name: `${tool.name} 생성 테스트`,
    defaultTimeoutMs: 10_000,
    cases: [
      {
        id: `${baseName}-success`,
        name: `${tool.name}가 오류 없이 응답한다`,
        operation: { type: "callTool", tool: tool.name, input: input as JsonObject },
        assertions: [{ type: "isError", expected: false }],
      },
    ],
  };
}

/** 기존 파일 생성과 baseline이 함께 쓰는 단일 도구 case 합성 단계다. */
export function createGeneratedCase(tool: ToolDef, index: number, baseName: string): TestCaseSpec {
  return buildSuite(tool, index, baseName).cases[0] as TestCaseSpec;
}

function renderSuite(suite: GeneratedSuiteSpec): string {
  return [
    'import { defineMcpSuite } from "@ohmymcp/runner";',
    "",
    "// 이 파일은 @ohmymcp/generate가 생성했습니다. 실제 client는 별도 실행 진입점에서 주입하세요.",
    `export const generatedSuite = defineMcpSuite(${JSON.stringify(suite, null, 2)});`,
    "",
  ].join("\n");
}

/**
 * 도구 스키마마다 Runner의 선언형 suite 파일을 만들고 생성한 절대 경로를 반환한다.
 * 모든 스키마를 먼저 검증하므로 스키마 오류로 일부 파일만 생성되지 않는다.
 */
export async function generateTests(tools: ToolDef[], options: GenerateOptions): Promise<string[]> {
  if (!Array.isArray(tools)) {
    fail(
      "INVALID_TOOL",
      "tools",
      "tools는 ToolDef 배열이어야 합니다.",
      "도구 목록 배열을 전달하세요.",
    );
  }
  if (typeof options?.outDir !== "string" || !/\S/.test(options.outDir)) {
    fail(
      "INVALID_OPTIONS",
      "options.outDir",
      "출력 디렉터리가 비어 있습니다.",
      "생성 파일을 저장할 디렉터리를 지정하세요.",
    );
  }
  if (tools.length === 0) return [];

  const usedNames = new Set<string>();
  const drafts = tools.map((tool, index) => {
    const initialName = safeGeneratedBaseName(
      typeof tool?.name === "string" ? tool.name : "",
      index,
    );
    let baseName = initialName;
    for (let occurrence = 2; usedNames.has(baseName); occurrence++) {
      baseName = `${initialName}-${occurrence}`;
    }
    usedNames.add(baseName);
    const suite = buildSuite(tool, index, baseName);
    return { fileName: `${baseName}.generated.ts`, source: renderSuite(suite) };
  });

  const outDir = resolve(options.outDir);
  await mkdir(outDir, { recursive: true });
  const paths = drafts.map(({ fileName }) => join(outDir, fileName));
  await Promise.all(
    drafts.map(({ source }, index) => writeFile(paths[index] as string, source, "utf8")),
  );
  return paths;
}
