import type { CollectedString, Location, RawTool } from "./types.js";

/**
 * JSON Schema 2020-12 의 알려진 키워드(§3.2 `desc/non-standard-field`). 수집기는 스키마 자리의
 * 이 키 이름은 구조라 수집하지 않고, 규칙은 이 밖의 키에 실린 긴 문자열을 본다.
 */
export const KNOWN_SCHEMA_KEYWORDS: ReadonlySet<string> = new Set(
  `$schema $id $ref $defs $comment $anchor $dynamicRef $dynamicAnchor $vocabulary
type enum const default examples title description deprecated readOnly writeOnly
properties patternProperties additionalProperties unevaluatedProperties propertyNames required
minProperties maxProperties dependentRequired dependentSchemas
items prefixItems additionalItems unevaluatedItems contains minContains maxContains minItems maxItems uniqueItems
allOf anyOf oneOf not if then else
minimum maximum exclusiveMinimum exclusiveMaximum multipleOf
minLength maxLength pattern format contentEncoding contentMediaType contentSchema
definitions nullable discriminator`.split(/\s+/),
);

/** 값이 이름→스키마 사전인 키워드. 사전의 키는 속성 이름이라 수집한다. */
const SCHEMA_MAP_KEYWORDS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
]);

/** 값이 스키마 하나(또는 스키마 배열)인 키워드. */
const SCHEMA_VALUE_KEYWORDS = new Set([
  "items",
  "additionalProperties",
  "unevaluatedProperties",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
  "contains",
  "additionalItems",
  "unevaluatedItems",
  "contentSchema",
  "allOf",
  "anyOf",
  "oneOf",
  "prefixItems",
]);

/**
 * 수집된 문자열이 스키마 안의 어디에 있었는지. `CollectedString` 타입(§5.1)을 바꾸지 않으려고
 * 객체 동일성으로 붙여 둔다. `collectStrings` 가 만든 객체를 그대로 넘겨야 규칙이 볼 수 있다.
 */
export interface StringContext {
  /** 스키마 객체에 바로 실린 문자열 값이면 그 키 이름. */
  readonly schemaKey?: string;
  /** 이 문자열을 품은 가장 가까운 스키마의 `format`. default·examples 안에서만 채운다. */
  readonly enclosingFormat?: string;
}

const CONTEXT = new WeakMap<CollectedString, StringContext>();

export function stringContext(entry: CollectedString): StringContext {
  return CONTEXT.get(entry) ?? {};
}

type Mode = "schema" | "map" | "data";

interface Task {
  readonly value: unknown;
  readonly path: string;
  readonly mode: Mode;
  /** data 자리에서 키 이름도 모을지. `_meta` 는 값만 모은다(§3.0.2). */
  readonly dataKeys: boolean;
  /** default·examples 아래면 그 스키마의 format. */
  readonly format?: string;
  /** 스키마 객체에 바로 실린 문자열이면 그 키. */
  readonly schemaKey?: string;
  /** 키 이름 자체를 내보내는 작업이면 true. */
  readonly emitKey?: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const join = (path: string, key: string) => (path === "" ? key : `${path}.${key}`);

/**
 * 값 하나를 깊이 제한 없이 걷는다. 재귀 대신 스택을 쓴다. 서버가 보낸 수만 겹의 중첩이 호출
 * 스택을 넘겨 점검 도구 자체를 죽이지 못하게 하려는 것이다. 순서는 문서 순서(깊이 우선)다.
 */
function walk(root: Task, location: (path: string) => Location, out: CollectedString[]): void {
  const stack: Task[] = [root];
  while (stack.length > 0) {
    const task = stack.pop() as Task;
    const { value, path, mode } = task;
    if (task.emitKey === true || typeof value === "string") {
      const entry: CollectedString = {
        location: location(path),
        raw: value as string,
        isKey: task.emitKey === true,
      };
      const context: StringContext = {
        ...(task.schemaKey === undefined ? {} : { schemaKey: task.schemaKey }),
        ...(task.format === undefined ? {} : { enclosingFormat: task.format }),
      };
      if (context.schemaKey !== undefined || context.enclosingFormat !== undefined)
        CONTEXT.set(entry, context);
      out.push(entry);
      continue;
    }
    const children: Task[] = [];
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        children.push({ ...task, value: item, path: `${path}[${index}]`, schemaKey: undefined });
      });
    } else if (isObject(value)) {
      for (const [key, child] of Object.entries(value)) {
        const childPath = join(path, key);
        if (mode === "map") {
          children.push({
            value: key,
            path: `${childPath}(key)`,
            mode,
            dataKeys: false,
            emitKey: true,
          });
          children.push({ value: child, path: childPath, mode: "schema", dataKeys: task.dataKeys });
          continue;
        }
        if (mode === "schema") {
          if (!KNOWN_SCHEMA_KEYWORDS.has(key))
            children.push({
              value: key,
              path: `${childPath}(key)`,
              mode,
              dataKeys: false,
              emitKey: true,
            });
          const nextMode: Mode = SCHEMA_MAP_KEYWORDS.has(key)
            ? "map"
            : SCHEMA_VALUE_KEYWORDS.has(key)
              ? "schema"
              : "data";
          const format =
            (key === "default" || key === "examples") && typeof value.format === "string"
              ? value.format
              : undefined;
          children.push({
            value: child,
            path: childPath,
            mode: nextMode,
            dataKeys: true,
            ...(format === undefined ? {} : { format }),
            ...(typeof child === "string" ? { schemaKey: key } : {}),
          });
          continue;
        }
        if (task.dataKeys)
          children.push({
            value: key,
            path: `${childPath}(key)`,
            mode,
            dataKeys: false,
            emitKey: true,
          });
        children.push({ ...task, value: child, path: childPath, schemaKey: undefined });
      }
    }
    for (let index = children.length - 1; index >= 0; index -= 1)
      stack.push(children[index] as Task);
  }
}

/** 최상위의 정해진 필드만 문자열이면 수집한다. */
function collectField(
  source: Record<string, unknown>,
  path: string,
  location: (path: string) => Location,
  out: CollectedString[],
): void {
  const parts = path.split(".");
  let value: unknown = source;
  for (const part of parts) value = isObject(value) ? value[part] : undefined;
  if (typeof value === "string") out.push({ location: location(path), raw: value, isKey: false });
}

/** §3.0.2. desc 규칙이 보는 문자열 전체를 결정론적 순서로 모은다. */
export function collectStrings(input: {
  tools: readonly RawTool[];
  prompts: readonly Record<string, unknown>[];
  resources: readonly Record<string, unknown>[];
  instructions: string | undefined;
}): CollectedString[] {
  const out: CollectedString[] = [];

  input.tools.forEach((tool, toolIndex) => {
    const toolName = typeof tool.name === "string" ? tool.name : "";
    const location = (path: string): Location => ({ kind: "tool", toolIndex, toolName, path });
    for (const field of ["name", "title", "description", "annotations.title"])
      collectField(tool, field, location, out);
    for (const field of ["inputSchema", "outputSchema"] as const)
      if (field in tool)
        walk({ value: tool[field], path: field, mode: "schema", dataKeys: true }, location, out);
    if ("_meta" in tool)
      walk({ value: tool._meta, path: "_meta", mode: "data", dataKeys: false }, location, out);
  });

  for (const prompt of input.prompts) {
    const name = typeof prompt.name === "string" ? prompt.name : "";
    const location = (path: string): Location => ({ kind: "prompt", name, path });
    for (const field of ["name", "title", "description"])
      collectField(prompt, field, location, out);
    if (Array.isArray(prompt.arguments))
      prompt.arguments.forEach((argument, index) => {
        if (!isObject(argument)) return;
        for (const field of ["name", "description"])
          if (typeof argument[field] === "string")
            out.push({
              location: location(`arguments[${index}].${field}`),
              raw: argument[field],
              isKey: false,
            });
      });
  }

  for (const resource of input.resources) {
    const uri = typeof resource.uri === "string" ? resource.uri : "";
    const location = (path: string): Location => ({ kind: "resource", uri, path });
    for (const field of ["name", "title", "description", "uri", "mimeType"])
      collectField(resource, field, location, out);
  }

  if (input.instructions !== undefined && input.instructions !== "")
    out.push({
      location: { kind: "instructions", path: "" },
      raw: input.instructions,
      isKey: false,
    });

  return out;
}
