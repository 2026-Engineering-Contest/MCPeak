/**
 * §3.7 의 호출 인자 생성. `required` 속성만 채우고 타입별 자리값을 쓴다. 값은 입력 스키마만으로
 * 정해지므로 같은 스키마에는 언제나 같은 인자가 나온다(결정론).
 */

type Schema = Record<string, unknown>;

const isObject = (value: unknown): value is Schema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 생성 실패. 메시지는 리포트의 "인자를 만들 수 없어 호출하지 않음" 뒤에 붙는 원인 한 줄이다. */
class CannotProbe extends Error {}

/** `$ref` 를 따라가는 최대 깊이. 자기 참조 스키마가 끝없이 펼쳐지지 않게 한다. */
const MAX_DEPTH = 32;

const STRING_BY_FORMAT: Readonly<Record<string, string>> = {
  uri: "https://example.invalid/mcpeak",
  url: "https://example.invalid/mcpeak",
  email: "mcpeak@example.invalid",
  "date-time": "2026-01-01T00:00:00Z",
};

/** 같은 문서 안의 JSON 포인터(`#/$defs/x`)만 푼다. 원격·상대 참조는 풀지 않는다. */
function resolveRef(root: Schema, ref: string): Schema {
  if (!ref.startsWith("#"))
    throw new CannotProbe(`$ref '${ref}' 는 문서 밖을 가리켜 풀 수 없습니다`);
  let node: unknown = root;
  for (const raw of ref
    .slice(1)
    .split("/")
    .filter((part) => part !== "")) {
    const part = decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~");
    node = isObject(node) ? node[part] : undefined;
  }
  if (!isObject(node)) throw new CannotProbe(`$ref '${ref}' 가 가리키는 스키마가 없습니다`);
  return node;
}

/** 스키마의 타입 하나. 배열이면 null 이 아닌 첫 값. 없으면 다른 키워드로 짐작한다. */
function typeOf(schema: Schema): string | undefined {
  const declared = schema.type;
  if (typeof declared === "string") return declared;
  if (Array.isArray(declared)) {
    const first = declared.find((value) => value !== "null") ?? declared[0];
    return typeof first === "string" ? first : undefined;
  }
  if (isObject(schema.properties) || Array.isArray(schema.required)) return "object";
  if ("items" in schema) return "array";
  return undefined;
}

function numberFor(schema: Schema, integer: boolean): number {
  const minimum = typeof schema.minimum === "number" ? schema.minimum : undefined;
  const exclusive =
    typeof schema.exclusiveMinimum === "number" ? schema.exclusiveMinimum : undefined;
  const maximum = typeof schema.maximum === "number" ? schema.maximum : undefined;
  // §3.7 은 `minimum ?? 0` 이다. exclusiveMinimum 만 있으면 그보다 1 크게, 0 이 maximum 을 넘으면
  // maximum 으로 맞춘다. 그대로 두면 서버가 검증 오류로 거절해 응답 본문을 볼 수 없다.
  let value = minimum ?? (exclusive !== undefined ? exclusive + 1 : 0);
  if (maximum !== undefined && value > maximum) value = maximum;
  return integer ? Math.ceil(value) : value;
}

function stringFor(schema: Schema): string {
  const format = typeof schema.format === "string" ? STRING_BY_FORMAT[schema.format] : undefined;
  let value = format ?? "mcpeak";
  const minLength = typeof schema.minLength === "number" ? schema.minLength : 0;
  const maxLength = typeof schema.maxLength === "number" ? schema.maxLength : undefined;
  if (value.length < minLength) value = value.padEnd(minLength, "x");
  if (maxLength !== undefined && value.length > maxLength) value = value.slice(0, maxLength);
  return value;
}

function valueFor(root: Schema, input: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) throw new CannotProbe("$ref 가 너무 깊거나 자기 자신을 가리킵니다");
  if (input === true || input === undefined) return "mcpeak";
  if (!isObject(input)) throw new CannotProbe("스키마가 객체가 아닙니다");
  let schema = input;
  if (typeof schema.$ref === "string") schema = resolveRef(root, schema.$ref);
  if (schema !== input) return valueFor(root, schema, depth + 1);

  if ("const" in schema) return schema.const;
  if (Array.isArray(schema.enum)) {
    if (schema.enum.length === 0) throw new CannotProbe("enum 이 비어 있습니다");
    return schema.enum[0];
  }
  for (const key of ["anyOf", "oneOf"] as const) {
    const branches = schema[key];
    if (Array.isArray(branches) && branches.length > 0)
      return valueFor(root, branches[0], depth + 1);
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    // allOf 는 갈래를 하나로 합쳐 본다. 객체 갈래의 properties·required 를 모으는 얕은 병합이다.
    const { allOf, ...merged } = schema as Schema & { allOf: unknown[] };
    const properties: Schema = isObject(schema.properties) ? { ...schema.properties } : {};
    const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);
    for (const branch of allOf) {
      const resolved =
        isObject(branch) && typeof branch.$ref === "string"
          ? resolveRef(root, branch.$ref)
          : branch;
      if (!isObject(resolved)) continue;
      for (const [key, value] of Object.entries(resolved))
        if (key !== "properties" && key !== "required" && !(key in merged)) merged[key] = value;
      if (isObject(resolved.properties)) Object.assign(properties, resolved.properties);
      if (Array.isArray(resolved.required))
        for (const name of resolved.required) if (typeof name === "string") required.add(name);
    }
    return valueFor(root, { ...merged, properties, required: [...required] }, depth + 1);
  }

  switch (typeOf(schema)) {
    case "string":
      return stringFor(schema);
    case "integer":
      return numberFor(schema, true);
    case "number":
      return numberFor(schema, false);
    case "boolean":
      return false;
    case "null":
      return null;
    case "array": {
      const minItems = typeof schema.minItems === "number" ? schema.minItems : 0;
      if (minItems < 1) return [];
      // §3.7 은 "items 로 하나" 다. minItems 가 2 이상이면 하나로는 검증을 못 넘으므로 그 수만큼 채운다.
      const item = valueFor(
        root,
        Array.isArray(schema.items) ? schema.items[0] : schema.items,
        depth + 1,
      );
      return Array.from({ length: minItems }, () => item);
    }
    case "object":
      return objectFor(root, schema, depth);
    case undefined:
      return "mcpeak";
    default:
      throw new CannotProbe(`알 수 없는 타입 '${String(schema.type)}' 입니다`);
  }
}

function objectFor(root: Schema, schema: Schema, depth: number): Record<string, unknown> {
  const properties = isObject(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const result: Record<string, unknown> = {};
  for (const name of required) {
    if (typeof name !== "string") continue;
    if (!(name in properties))
      throw new CannotProbe(`필수 속성 '${name}' 의 스키마가 properties 에 없습니다`);
    result[name] = valueFor(root, properties[name], depth + 1);
  }
  return result;
}

export function probeArguments(
  inputSchema: unknown,
): { ok: true; args: Record<string, unknown> } | { ok: false; reason: string } {
  if (inputSchema === undefined) return { ok: true, args: {} };
  if (!isObject(inputSchema)) return { ok: false, reason: "inputSchema 가 객체가 아닙니다" };
  try {
    const value = valueFor(inputSchema, inputSchema, 0);
    if (!isObject(value))
      return { ok: false, reason: "inputSchema 의 최상위가 객체 타입이 아닙니다" };
    return { ok: true, args: value };
  } catch (error) {
    if (error instanceof CannotProbe) return { ok: false, reason: error.message };
    throw error;
  }
}
