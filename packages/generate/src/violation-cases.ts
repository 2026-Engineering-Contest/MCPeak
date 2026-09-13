import type { ToolDef } from "@mcpeak/core";
import {
  type ContractAxis,
  type ContractDeclaredType,
  type ContractRange,
  deriveContractAxes,
  type ResponseSchema,
} from "@mcpeak/runner";
import { canonicalJson } from "./canonical.js";
import { integerLowerBound, integerUpperBound } from "./constraints.js";
import { fieldSlug } from "./filename.js";
import {
  GenerateTestsError,
  type JsonObject,
  type JsonSchema,
  type JsonValue,
  plainObject,
} from "./schema.js";
import { synthesizeValue } from "./synthesize.js";

/**
 * 생성한 케이스 한 개. render.ts 의 지역 타입을 이 이름으로 승격시켜 두 파일이 공유한다.
 *
 * assertions 의 expected 를 boolean 으로 넓히지 않는다. 넓히면 정상 케이스에 true 를 넣는
 * 실수를 컴파일러가 못 잡는다.
 */
export interface GeneratedCase {
  readonly id: string;
  readonly name: string;
  readonly operation: {
    readonly type: "callTool";
    readonly tool: string;
    readonly input: JsonObject;
  };
  /**
   * 튜플의 배열 자체에는 readonly 를 걸지 않는다. baseline.ts 가 이 케이스를 runner 의
   * TestSuiteSpec(`cases: TestCaseSpec[]`, 그 안의 `assertions` 도 가변 배열)에 그대로 싣는데,
   * 읽기 전용 배열은 가변 배열에 대입되지 않아 거기서 컴파일이 깨진다.
   * expected 는 요구대로 두 리터럴의 유니온으로 남는다. boolean 으로 넓히면 정상 케이스에
   * true 를 넣는 실수를 컴파일러가 못 잡는다.
   */
  readonly assertions: [
    (
      | { readonly type: "isError"; readonly expected: true }
      | { readonly type: "isError"; readonly expected: false }
    ),
    ...{ readonly type: "structuredContentMatchesSchema"; readonly schema: ResponseSchema }[],
  ];
  /**
   * 이 케이스를 이 케이스이게 하는 필드. 값이 바뀌면 케이스의 목적이 사라진다.
   *
   * AI 사전보완은 이 필드를 채울 후보에서 뺀다. `unit` 을 `"fahrenheit"` 로 고정한 케이스에
   * `"celsius"` 를 넣으면 기준 케이스와 같아지고, 그 케이스가 잡으려던 결함이 사라진다.
   * 나머지 필드는 정상적으로 제안을 받는다. `city` 같은 근거 없는 값은 채워져야 한다.
   *
   * 기준 정상 케이스와 위반 케이스는 빈 배열이다.
   *
   * **명세에는 실리지 않는다.** runner 의 케이스 검증이 모르는 키를 거절하므로
   * (`spec/validation.ts` 의 `unknowns`) `render.ts` 의 `toSuiteCase` 가 벗겨낸다.
   * 이 필드는 생성 단계 안에서만 산다.
   */
  readonly pinnedFields: readonly string[];
}

/**
 * enum 위반값에 쓰는 예약 문자열. 어떤 서버도 이것을 유효한 값으로 선언하지 않을 것을 노린
 * 이름이고, 그래도 겹치면 접미사를 붙여 피한다.
 */
const INVALID_ENUM_VALUE = "__mcpeak_invalid_enum__";

/**
 * 선언 밖 필드 케이스에 쓰는 예약 키. 이름 규칙은 INVALID_ENUM_VALUE 와 같고, 서버가 이 이름을
 * properties 에 선언했으면 접미사를 붙여 피한다.
 */
const UNDECLARED_FIELD_KEY = "__mcpeak_undeclared__";

/**
 * 선언 밖 키 하나를 얹은 입력. 값은 가장 평범한 문자열이다.
 *
 * 값을 이상하게 넣으면 서버가 "선언 밖 키" 가 아니라 "이상한 값" 때문에 거절할 수 있고, 그러면
 * 이 케이스가 통과해도 무엇을 검증한 것인지 알 수 없다. 거절 사유를 키 하나로 좁히려면 값이
 * 눈에 띄지 않아야 한다.
 */
function undeclaredFieldInput(
  tool: ToolDef,
  happyInput: JsonObject,
): { readonly key: string; readonly input: JsonObject } {
  const properties = plainObject(tool.inputSchema)
    ? (tool.inputSchema.properties as Record<string, unknown> | undefined)
    : undefined;
  const declared = plainObject(properties) ? properties : {};
  let key = UNDECLARED_FIELD_KEY;
  for (let suffix = 2; Object.hasOwn(declared, key) || Object.hasOwn(happyInput, key); suffix++)
    key = `${UNDECLARED_FIELD_KEY}_${suffix}`;
  return { key, input: { ...happyInput, [key]: "example" } };
}

/**
 * 선언 type 을 어기는 값. 표로 고정한다. 값이 흔들리면 지문이 흔들린다.
 *
 * integer 만 1.5 다. "example" 을 넣으면 `typeof value === "number"` 검사만 있는 서버도
 * 잡히지만, 1.5 는 그 검사를 통과하고 정수 검사가 없는 것까지 잡는다. 더 예리한 위반이다.
 */
const TYPE_VIOLATION_VALUE: Readonly<Record<ContractDeclaredType, JsonValue>> = {
  string: 0,
  number: "example",
  integer: 1.5,
  boolean: "example",
  object: "example",
  array: "example",
  null: "example",
};

/**
 * 선언 enum 밖 값. 선언 type 이 수 계열이면 타입까지 지킨 값을 고르려 최댓값 + 1 을 쓴다.
 * 안전 정수 경계를 넘으면 그 값이 정확히 표현되지 않아 "enum 밖" 이 보장되지 않으므로
 * 문자열 규칙으로 떨어진다.
 */
function enumViolationValue(axis: ContractAxis): JsonValue {
  const allowed = axis.declaredEnum ?? [];
  if (axis.declaredType === "number" || axis.declaredType === "integer") {
    const numbers = allowed.filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    if (numbers.length > 0) {
      const next = Math.max(...numbers) + 1;
      if (Number.isSafeInteger(next)) return next;
    }
  }
  let candidate = INVALID_ENUM_VALUE;
  for (let suffix = 2; allowed.includes(candidate); suffix++)
    candidate = `${INVALID_ENUM_VALUE}_${suffix}`;
  return candidate;
}

/**
 * 길이 L 의 문자열. 정상 경로가 `"example"` 에서 출발하므로 위반도 같은 문자열에서 만든다.
 * 두 값이 한 글자만 다르면 사용자가 무엇을 노린 케이스인지 읽기 쉽다.
 */
const stringOfLength = (length: number): string =>
  "example".padEnd(Math.max(length, 0), "x").slice(0, Math.max(length, 0));

/** 원소 count 개의 배열. 원소는 items 스키마에서 합성하며 전부 같은 값이다(결정론성). */
function arrayOfLength(
  itemsSchema: unknown,
  count: number,
  path: string,
  root: JsonSchema,
): JsonValue {
  if (count <= 0) return [];
  if (!plainObject(itemsSchema)) return Array.from({ length: count }, () => "example");
  return Array.from({ length: count }, () =>
    synthesizeValue(itemsSchema as JsonSchema, `${path}.items`, root),
  );
}

/** 경로 한 조각. 키이거나 배열 원소 단계다. `runner` 의 경로 문법과 같다(#388). */
type PathSegment = { readonly kind: "key"; readonly name: string } | { readonly kind: "item" };

/**
 * 축의 `field` 경로를 조각으로 나눈다. `tags[].id` 는 `tags` · 원소 · `id` 셋이다.
 *
 * 문법의 정의는 `runner` 의 `input-schema.ts` 에 있다. 그쪽이 만든 경로를 여기서 읽기만 한다.
 * 규칙을 여기서 늘리지 마라. 두 패키지가 다른 문법을 말하게 된다.
 */
function parsePath(path: string): readonly PathSegment[] {
  const segments: PathSegment[] = [];
  for (const part of path.split(".")) {
    let name = part;
    let items = 0;
    while (name.endsWith("[]")) {
      name = name.slice(0, -2);
      items++;
    }
    if (name !== "") segments.push({ kind: "key", name });
    for (let index = 0; index < items; index++) segments.push({ kind: "item" });
  }
  return segments;
}

/**
 * 경로 한 단계에서 우리가 아는 것. `walkPath` 가 스키마를 한 번 따라 내려가며 모은다.
 * 판정 재료를 따로 순회해 모으면 두 순회가 갈린다.
 */
interface PathStep {
  readonly segment: PathSegment;
  /** 이 단계가 가리키는 선언 스키마. 못 찾으면 null 이다. */
  readonly schema: unknown;
  /** 이 단계를 담는 스키마. 배열 원소 단계에서 maxItems 를 보려면 필요하다. */
  readonly container: unknown;
  /** 키 단계가 부모의 required 에 **없는지**. 배열 원소 단계는 false 다(원소에 required 가 없다). */
  readonly optional: boolean;
}

/** 경로를 따라 선언 스키마를 내려가며 단계별 재료를 모은다. */
function walkPath(root: JsonSchema, path: string): readonly PathStep[] {
  const steps: PathStep[] = [];
  let current: unknown = root;
  for (const segment of parsePath(path)) {
    const container = current;
    const node = plainObject(current) ? unwrapNullable(current) : null;
    let next: unknown = null;
    let optional = false;
    if (node !== null) {
      if (segment.kind === "item") next = node.items ?? null;
      else {
        const properties = node.properties;
        next = plainObject(properties) ? (properties[segment.name] ?? null) : null;
        const required = Array.isArray(node.required) ? node.required : [];
        optional = !required.includes(segment.name);
      }
    }
    steps.push({ segment, schema: next, container, optional });
    current = next;
  }
  return steps;
}

/**
 * 없는 중간 자리를 채울 값. 만들 수 없으면 undefined 다.
 *
 * `-branch-with-*`(#401)와 **같은 `synthesizeValue`** 를 쓴다. 두 케이스가 같은 필드에 다른
 * 값을 넣으면 사용자가 왜 다른지 알 수 없다.
 *
 * `GenerateTestsError` 만 삼킨다. 그 밖의 오류는 우리 결함이므로 그대로 올린다. 전부 삼키면
 * 우리 버그가 "케이스 못 만듦" 으로 위장돼 조용히 유지된다.
 */
function synthesizeFiller(schema: unknown, path: string, root: JsonSchema): JsonValue | undefined {
  if (!plainObject(schema)) return undefined;
  try {
    return synthesizeValue(schema as JsonSchema, path, root);
  } catch (error) {
    if (!(error instanceof GenerateTestsError)) throw error;
    return undefined;
  }
}

/**
 * 경로가 가리키는 자리의 값을 바꾼 새 값. 원본을 바꾸지 않는다.
 *
 * **배열 원소 경로는 첫 원소만 바꾼다.** 전부 바꾸면 "서버가 첫 원소만 검사한다" 는 결함을
 * 못 잡는다(설계 §4.1).
 *
 * 경로 중간이 없어도 그 단계가 **선택 필드면 채워서 내려간다**(#388 T5). 안 채우면 선택 필드
 * 아래의 축은 어떤 케이스로도 못 덮여 분모에 영원히 못 채우는 빈틈으로 남는다. 선택 필드가
 * 있다는 사실 자체는 선언을 지키므로 거절 사유는 여전히 마지막 한 자리로 좁혀진다.
 *
 * **required 인 중간 필드가 없으면 undefined 다.** 그 경우는 기준 정상 입력 자체가 깨진
 * 것이고, 지어내면 정상 입력과 두 군데가 달라져 무엇을 검증하는지 알 수 없어진다.
 *
 * 마지막 조각은 없어도 넣는다.
 */
function setAtSteps(
  node: JsonValue,
  steps: readonly PathStep[],
  value: JsonValue,
  root: JsonSchema,
  label: string,
): JsonValue | undefined {
  const head = steps[0];
  if (head === undefined) return value;
  const rest = steps.slice(1);
  if (head.segment.kind === "item") {
    if (!Array.isArray(node)) return undefined;
    let items: readonly JsonValue[] = node;
    if (items.length === 0) {
      // 빈 배열이면 원소를 하나 합성한다. maxItems: 0 이면 원소를 넣는 순간 그 제약까지
      // 어겨 케이스가 축 둘을 덮으므로 만들지 않는다.
      const container = plainObject(head.container) ? unwrapNullable(head.container) : null;
      if (container?.maxItems === 0) return undefined;
      const filled = synthesizeFiller(head.schema, `${label}.items`, root);
      if (filled === undefined) return undefined;
      items = [filled];
    }
    const replaced = setAtSteps(items[0] as JsonValue, rest, value, root, label);
    return replaced === undefined ? undefined : [replaced, ...items.slice(1)];
  }
  if (!plainObject(node)) return undefined;
  const name = head.segment.name;
  if (rest.length === 0) return { ...node, [name]: value };
  let child = node[name] as JsonValue | undefined;
  if (!Object.hasOwn(node, name)) {
    if (!head.optional) return undefined;
    child = synthesizeFiller(head.schema, `${label}.${name}`, root);
    if (child === undefined) return undefined;
  }
  const replaced = setAtSteps(child as JsonValue, rest, value, root, label);
  return replaced === undefined ? undefined : { ...node, [name]: replaced };
}

/** 경로가 가리키는 자리의 값을 바꾼 새 입력. 만들 수 없으면 undefined 다. */
function withValueAt(
  input: JsonObject,
  path: string,
  value: JsonValue,
  root: JsonSchema,
): JsonObject | undefined {
  const replaced = setAtSteps(input, walkPath(root, path), value, root, `properties.${path}`);
  return plainObject(replaced) ? (replaced as JsonObject) : undefined;
}

/**
 * 경로가 가리키는 키를 지운 새 값. 중간 규칙은 `setAtSteps` 와 같다. 선택 필드인 중간은
 * 채워서 내려가고, 그 키가 원래 없으면 지울 것이 없어 undefined 다.
 */
function deleteAtSteps(
  node: JsonValue,
  steps: readonly PathStep[],
  root: JsonSchema,
  label: string,
): JsonValue | undefined {
  const head = steps[0];
  if (head === undefined) return undefined;
  const rest = steps.slice(1);
  if (head.segment.kind === "item") {
    if (!Array.isArray(node)) return undefined;
    let items: readonly JsonValue[] = node;
    if (items.length === 0) {
      const container = plainObject(head.container) ? unwrapNullable(head.container) : null;
      if (container?.maxItems === 0) return undefined;
      const filled = synthesizeFiller(head.schema, `${label}.items`, root);
      if (filled === undefined) return undefined;
      items = [filled];
    }
    const replaced = deleteAtSteps(items[0] as JsonValue, rest, root, label);
    return replaced === undefined ? undefined : [replaced, ...items.slice(1)];
  }
  if (!plainObject(node)) return undefined;
  const name = head.segment.name;
  if (rest.length === 0) {
    if (!Object.hasOwn(node, name)) return undefined;
    const next = { ...node };
    delete next[name];
    return next;
  }
  let child = node[name] as JsonValue | undefined;
  if (!Object.hasOwn(node, name)) {
    if (!head.optional) return undefined;
    child = synthesizeFiller(head.schema, `${label}.${name}`, root);
    if (child === undefined) return undefined;
  }
  const replaced = deleteAtSteps(child as JsonValue, rest, root, label);
  return replaced === undefined ? undefined : { ...node, [name]: replaced };
}

/** 경로가 가리키는 키를 지운 새 입력. REQUIRED_OMITTED 케이스에 쓴다. */
function withoutValueAt(input: JsonObject, path: string, root: JsonSchema): JsonObject | undefined {
  const removed = deleteAtSteps(input, walkPath(root, path), root, `properties.${path}`);
  return plainObject(removed) ? (removed as JsonObject) : undefined;
}

/**
 * nullable 형태를 한 겹 푼 스키마. `runner` 가 축을 만들 때 이미 푼 것을 여기서도 따라간다.
 * 안 풀면 `{ user: { anyOf: [객체, null] } }` 의 `user.name` 경로에서 선언을 못 찾는다.
 */
function unwrapNullable(schema: Record<string, unknown>): Record<string, unknown> {
  for (const key of ["anyOf", "oneOf"] as const) {
    const branches = schema[key];
    if (!Array.isArray(branches)) continue;
    const values = branches.filter(
      (branch) => plainObject(branch) && (branch as Record<string, unknown>).type !== "null",
    );
    if (values.length === 1) return values[0] as Record<string, unknown>;
  }
  return schema;
}

/**
 * 경로가 가리키는 값. 배열 원소 경로는 **첫 원소**다. `withValueAt` 이 바꾸는 자리와 같은
 * 원소를 봐야 "기준과 같은지" 판정이 맞는다. 중간이 없으면 undefined 다.
 */
function valueAtPath(input: JsonObject, path: string): JsonValue | undefined {
  let current: JsonValue = input;
  for (const segment of parsePath(path)) {
    if (segment.kind === "item") {
      if (!Array.isArray(current) || current.length === 0) return undefined;
      current = current[0] as JsonValue;
      continue;
    }
    if (!plainObject(current) || !Object.hasOwn(current, segment.name)) return undefined;
    current = current[segment.name] as JsonValue;
  }
  return current;
}

/** 경로가 가리키는 선언 스키마. 못 찾으면 null 이다. `walkPath` 의 마지막 단계다. */
function schemaAtPath(root: JsonSchema, path: string): unknown {
  const steps = walkPath(root, path);
  return steps[steps.length - 1]?.schema ?? null;
}

/** $ref 가 든 원소를 만들려면 루트가 필요하다. items 스키마만으로는 참조를 못 푼다. */
const rootSchema = (tool: ToolDef): JsonSchema =>
  plainObject(tool.inputSchema) ? (tool.inputSchema as JsonSchema) : {};

/**
 * 범위 **하한**을 한 칸 밖으로 넘긴 값. 하한 축(`bound === "lower"`)의 위반 값이다.
 *
 * 하한이 `0` 이고 타입이 `integer` 면 위반 값은 `-1` 이다. 음수를 못 받는 서버가 있을 수 있으나
 * 그것이 곧 검증 대상이다.
 *
 * 만들 수 없으면 undefined 다. 호출자가 그 축의 케이스를 만들지 않는다. `deriveContractAxes` 가
 * 이미 같은 규칙으로 축을 거르므로 여기 도달하는 것은 전부 만들 수 있는 축이다.
 */
function lowerViolationValue(
  range: ContractRange,
  fieldSchema: unknown,
  path: string,
  root: JsonSchema,
): JsonValue | undefined {
  // integer 는 경계가 소수일 수 있다. minimum: 1.2 에 -1 을 하면 0.2 가 나와 자기 type 을 어긴다.
  // 그러면 그 케이스는 TYPE_VIOLATION 축을 덮고 RANGE_VIOLATION 축은 영원히 미검증으로 남는다.
  // 정상 경로가 integerLowerBound 를 쓰므로 위반도 같은 계산에서 한 칸 내려간다.
  if (plainObject(fieldSchema) && fieldSchema.type === "integer") {
    const lower = integerLowerBound(range.minimum, range.exclusiveMinimum);
    if (lower !== null) return lower - 1;
  }
  if (range.minimum !== null) return range.minimum - 1;
  if (range.exclusiveMinimum !== null) return range.exclusiveMinimum;
  if (range.minItems !== null && range.minItems >= 1)
    return arrayOfLength(
      plainObject(fieldSchema) ? fieldSchema.items : null,
      range.minItems - 1,
      path,
      root,
    );
  if (range.minLength !== null && range.minLength >= 1) return stringOfLength(range.minLength - 1);
  return undefined;
}

/**
 * 범위 **상한**을 한 칸 밖으로 넘긴 값. 상한 축(`bound === "upper"`)의 위반 값이다.
 * 하한 쪽과 대칭이고, 만들 수 없으면 undefined 다.
 */
function upperViolationValue(
  range: ContractRange,
  fieldSchema: unknown,
  path: string,
  root: JsonSchema,
): JsonValue | undefined {
  // integer 는 경계가 소수일 수 있다. maximum: 1.8 에 +1 을 하면 2.8 이 나와 자기 type 을 어긴다.
  // 그러면 그 케이스는 TYPE_VIOLATION 축을 덮고 RANGE_VIOLATION 축은 영원히 미검증으로 남는다.
  // 정상 경로가 integerUpperBound 를 쓰므로 위반도 같은 계산에서 한 칸 올라간다.
  if (plainObject(fieldSchema) && fieldSchema.type === "integer") {
    const upper = integerUpperBound(range.maximum, range.exclusiveMaximum);
    if (upper !== null) return upper + 1;
  }
  if (range.maximum !== null) return range.maximum + 1;
  if (range.exclusiveMaximum !== null) return range.exclusiveMaximum;
  if (range.maxItems !== null)
    return arrayOfLength(
      plainObject(fieldSchema) ? fieldSchema.items : null,
      range.maxItems + 1,
      path,
      root,
    );
  if (range.maxLength !== null) return stringOfLength(range.maxLength + 1);
  return undefined;
}

/**
 * 상한 **바로 안쪽** 의 정상 값. 상한 경계 정상 케이스에 쓴다. 만들 수 없으면 undefined 다.
 */
function upperBoundaryValue(
  range: ContractRange,
  fieldSchema: unknown,
  path: string,
  root: JsonSchema,
): JsonValue | undefined {
  // 위반 값과 같은 이유로 integer 를 먼저 본다. 경계가 소수여도 자기 type 을 지킨 값을 낸다.
  if (plainObject(fieldSchema) && fieldSchema.type === "integer") {
    const upper = integerUpperBound(range.maximum, range.exclusiveMaximum);
    if (upper !== null) return upper;
  }
  if (range.maximum !== null) return range.maximum;
  if (range.maxItems !== null)
    return arrayOfLength(
      plainObject(fieldSchema) ? fieldSchema.items : null,
      range.maxItems,
      path,
      root,
    );
  if (range.maxLength !== null) return stringOfLength(range.maxLength);
  // exclusiveMaximum 만 있는 non-integer 는 만들지 않는다. 실수에서 "경계 바로 안쪽" 이
  // 정의되지 않는다. exclusiveMaximum: 10 의 정상 최댓값은 10 도 9 도 아니다. 지어낸 값이
  // 거절당하면 서버 결함인지 우리 값이 나쁜 건지 구분할 수 없다.
  return undefined;
}

/** 한 도구의 위반 케이스 전량. 정상 케이스는 포함하지 않는다. */
export function buildViolationCases(options: {
  readonly tool: ToolDef;
  /** 정상 경로 입력. render.ts 의 synthesizeValue 결과를 그대로 받는다. */
  readonly happyInput: JsonObject;
  /** 케이스 id 접두사. render.ts 의 baseName 과 같은 값이다. */
  readonly baseName: string;
}): readonly GeneratedCase[] {
  const { tool, happyInput, baseName } = options;
  const { axes } = deriveContractAxes(tool);
  // 경로 헬퍼가 선택 필드를 채우려면 루트 선언이 필요하다. 축마다 다시 만들지 않는다.
  const root = rootSchema(tool);
  // ENUM_VIOLATION 축의 declaredType 은 설계상 null 이라 같은 필드의 TYPE_VIOLATION 축에서
  // 가져온다. ContractAxis 는 runner 공개 타입이므로 여기서 의미를 늘리지 않는다.
  const declaredTypeByField = new Map<string, ContractDeclaredType>();
  for (const axis of axes)
    if (axis.kind === "TYPE_VIOLATION" && axis.field !== null && axis.declaredType !== null)
      declaredTypeByField.set(axis.field, axis.declaredType);

  const usedIds = new Set<string>();
  const uniqueId = (prefix: string, field: string): string => {
    const initial = `${baseName}-${prefix}-${fieldSlug(field)}`;
    let id = initial;
    for (let occurrence = 2; usedIds.has(id); occurrence++) id = `${initial}-${occurrence}`;
    usedIds.add(id);
    return id;
  };
  const violation = (id: string, name: string, input: JsonObject): GeneratedCase => ({
    id,
    name,
    operation: { type: "callTool", tool: tool.name, input },
    assertions: [{ type: "isError", expected: true }],
    // 위반 케이스는 사전보완이 애초에 안 고른다(isHappyPath 가 isError:false 만 본다).
    // 고정할 것이 없다.
    pinnedFields: [],
  });

  const cases: GeneratedCase[] = [];
  for (const axis of axes) {
    const field = axis.field;
    // UNDECLARED_FIELD 는 대상 필드가 없다(선언 밖 키가 여럿이어도 축은 하나다). HAPPY_PATH 를
    // 거르는 아래 분기보다 먼저 잡아야 한다.
    if (axis.kind === "UNDECLARED_FIELD") {
      const { key, input } = undeclaredFieldInput(tool, happyInput);
      const id = `${baseName}-undeclared`;
      usedIds.add(id);
      cases.push(violation(id, `${tool.name}가 선언되지 않은 필드 '${key}' 를 거절한다`, input));
      continue;
    }
    if (field === null) continue; // HAPPY_PATH 는 render.ts 가 만든다
    if (axis.kind === "REQUIRED_OMITTED") {
      // 정상 입력에 그 키가 없으면 뺄 것이 없다. 그대로 만들면 정상 케이스와 입력이 같은데
      // 단언만 isError: true 인 케이스가 되어 항상 실패한다. 서버가 옳은데 우리가 틀린 것이다.
      // 이 축은 케이스 없이 남고 커버리지가 미검증으로 보고한다. 그것이 정직한 상태다.
      //
      // 이 상황은 required 에 있지만 properties 에 없는 필드에서 나온다. generate 의
      // validateSchema 는 그런 스키마를 거부하지만(schema.ts 의 required 검사) runner 의 축
      // 도출은 허용하므로 손으로 쓴 명세나 AI 경로에서 도달할 수 있다.
      //
      // 중첩 경로도 같다. `{ user: {} }` 는 `user.name` 의 누락이지만, 정상 입력에 `user` 가
      // 없으면 `user.name` 에서 지울 것이 없어 undefined 다.
      const input = withoutValueAt(happyInput, field, root);
      if (input === undefined) continue;
      cases.push(
        violation(
          uniqueId("missing", field),
          `${tool.name}가 필수 필드 '${field}' 누락을 거절한다`,
          input,
        ),
      );
    } else if (axis.kind === "TYPE_VIOLATION") {
      const value = TYPE_VIOLATION_VALUE[axis.declaredType as ContractDeclaredType];
      const input = withValueAt(happyInput, field, value, root);
      if (input === undefined) continue;
      cases.push(
        violation(uniqueId("type", field), `${tool.name}가 '${field}' 타입 위반을 거절한다`, input),
      );
    } else if (axis.kind === "ENUM_VIOLATION") {
      const value = enumViolationValue({
        ...axis,
        declaredType: declaredTypeByField.get(field) ?? null,
      });
      const input = withValueAt(happyInput, field, value, root);
      if (input === undefined) continue;
      cases.push(
        violation(
          uniqueId("enum", field),
          `${tool.name}가 '${field}' 의 선언되지 않은 값을 거절한다`,
          input,
        ),
      );
    } else if (axis.kind === "RANGE_VIOLATION" && axis.declaredRange !== null) {
      // 방향을 모르는 축에 값을 지어내지 않는다. T1 이후 bound 가 null 인 RANGE_VIOLATION 축은
      // 나오지 않지만, 나오더라도 케이스를 만들지 않는 것이 정직하다.
      if (axis.bound === null) continue;
      const fieldSchema = schemaAtPath(root, field);
      // 이 path 는 합성 오류 문장에만 쓰인다. $ref 는 root 로 푼다.
      const path = `properties.${field}`;
      const value =
        axis.bound === "lower"
          ? lowerViolationValue(axis.declaredRange, fieldSchema, path, root)
          : upperViolationValue(axis.declaredRange, fieldSchema, path, root);
      if (value === undefined) continue;
      const input = withValueAt(happyInput, field, value, root);
      if (input === undefined) continue;
      const prefix = axis.bound === "lower" ? "range-lower" : "range-upper";
      const direction = axis.bound === "lower" ? "하한 미만" : "상한 초과";
      cases.push(
        violation(
          uniqueId(prefix, field),
          `${tool.name}가 '${field}' ${direction} 값을 거절한다`,
          input,
        ),
      );
    }
  }
  return cases;
}

/**
 * 한 도구의 상한 경계 **정상** 케이스 전량. 상한 바로 안쪽 값이 거절당하지 않는지 본다.
 *
 * 위반 케이스가 아니므로 단언은 정상 케이스와 같다. 상한 축이 있어도 정상 케이스가 이미 그
 * 경계를 밟고 있으면 만들지 않는다. 같은 입력이 두 번 나가면 어느 쪽이 무엇을 검증한 것인지
 * 읽을 수 없다.
 */
export function buildUpperBoundaryCases(options: {
  readonly tool: ToolDef;
  /** 정상 경로 입력. render.ts 의 synthesizeValue 결과를 그대로 받는다. */
  readonly happyInput: JsonObject;
  /** 케이스 id 접두사. render.ts 의 baseName 과 같은 값이다. */
  readonly baseName: string;
  /** 출력 계약이 지원되면 그 스키마. 아니면 null. 정상 케이스와 같은 단언을 붙인다. */
  readonly responseSchema: ResponseSchema | null;
}): readonly GeneratedCase[] {
  const { tool, happyInput, baseName, responseSchema } = options;
  const { axes } = deriveContractAxes(tool);
  // id 중복 회피는 buildViolationCases 와 별도 Set 으로 한다. 접두사가 bound-upper 라
  // range-* 와 겹치지 않는다.
  const usedIds = new Set<string>();
  const cases: GeneratedCase[] = [];
  for (const axis of axes) {
    if (axis.kind !== "RANGE_VIOLATION" || axis.bound !== "upper") continue;
    const field = axis.field;
    if (field === null || axis.declaredRange === null) continue;
    const root = rootSchema(tool);
    const value = upperBoundaryValue(
      axis.declaredRange,
      schemaAtPath(root, field),
      `properties.${field}`,
      root,
    );
    if (value === undefined) continue;
    // 정상 케이스가 이미 그 경계를 밟고 있으면 건너뛴다. 하한 없이 상한만 선언된 필드가 여기
    // 해당한다(synthesize.ts 가 상한을 정상값으로 쓴다). === 로 비교하면 배열·문자열에서
    // 틀리므로 canonicalJson 으로 본다.
    //
    // 경로로 읽는다. `happyInput[field]` 로 직접 읽으면 `user.age` 같은 경로에서 늘 undefined 라
    // 중복 회피가 안 걸리고, 아래에서 `"user.age"` 라는 **최상위 키**를 만든 엉뚱한 케이스가
    // 나간다(#388).
    const current = valueAtPath(happyInput, field);
    if (current !== undefined && canonicalJson(current) === canonicalJson(value)) continue;
    const input = withValueAt(happyInput, field, value, root);
    if (input === undefined) continue;
    const initial = `${baseName}-bound-upper-${fieldSlug(field)}`;
    let id = initial;
    for (let occurrence = 2; usedIds.has(id); occurrence++) id = `${initial}-${occurrence}`;
    usedIds.add(id);
    cases.push({
      id,
      name: `${tool.name}가 '${field}' 상한 경계값에 정상 응답한다`,
      operation: { type: "callTool", tool: tool.name, input },
      assertions: [
        { type: "isError", expected: false },
        ...(responseSchema === null
          ? []
          : [{ type: "structuredContentMatchesSchema" as const, schema: responseSchema }]),
      ],
      // 경계값 자체가 이 케이스의 정체성이다. 사전보완이 이 값을 바꾸면 상한 off-by-one 이
      // 있는 서버에서 케이스가 통과해 결함이 사라진다(설계서 §5.5).
      pinnedFields: [field],
    });
  }
  return cases;
}
