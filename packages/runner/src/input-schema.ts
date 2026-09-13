/**
 * 서버가 선언한 툴 입력 스키마를 우리가 이해하는 구조로 줄인다.
 *
 * 이 파일은 패키지 내부 전용이다. `index.ts` 로 내보내지 않는다. 여기 담긴 판단(부분 성공은
 * 없다, type 이 배열이면 그 필드를 통째로 포기한다)은 ADR-0015 의 결정이고 공개 API 가 되면
 * 고칠 수 없다.
 */

import type { ContractRange } from "./contract-range.js";
import { readContractRange } from "./contract-range.js";
import { byCodeUnit } from "./ordering.js";
import { matchResponseSchema, plainObject } from "./schema-match.js";
import type { JsonValue, ResponseSchema } from "./spec/types.js";

export type DeclaredType =
  | "object"
  | "array"
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "null";

export interface NormalizedField {
  /** 선언된 타입. 판정하지 않기로 한 필드는 null이다. */
  readonly type: DeclaredType | null;
  /** 선언된 enum. 없거나 판정하지 않기로 했으면 null이다. */
  readonly enumValues: readonly JsonValue[] | null;
  /** 선언된 범위. 없거나 판정하지 않기로 했으면 null 이다. */
  readonly range: ContractRange | null;
  /**
   * nullable 형태(`anyOf`/`oneOf` 의 null 갈래 + 값 갈래 하나)를 풀어 읽은 필드인지.
   *
   * true 면 `null` 은 이 필드의 어떤 축도 어기지 않는다. 선언상 유효한 값이기 때문이다.
   * 이것을 안 들고 다니면 `{ note: null }` 을 TYPE_MISMATCH 로 잡는 오탐이 난다(#426).
   */
  readonly nullable: boolean;
}

/**
 * 경로 문법. 세 패키지의 공용어다(#388).
 *
 * | 형태 | 뜻 |
 * |---|---|
 * | `user` | 최상위 프로퍼티 |
 * | `user.name` | 객체 안의 프로퍼티 |
 * | `tags[]` | 배열의 원소. 모든 원소가 items 스키마를 공유한다 |
 * | `tags[].id` | 배열 원소가 객체일 때 그 안의 프로퍼티 |
 *
 * 문자열을 손으로 이어 붙이는 자리를 만들지 마라. 문법이 갈리면 세 패키지가 서로 다른 경로를
 * 말하게 되고, 그 어긋남은 "축이 안 덮였다" 는 조용한 오탐으로만 드러난다.
 */
export const childPath = (parent: string, name: string): string =>
  parent === "" ? name : `${parent}.${name}`;

/** 배열 원소 경로. */
export const itemPath = (parent: string): string => `${parent}[]`;

/**
 * 내려가는 최대 깊이. `user.address.city` 까지다.
 *
 * 실제 MCP 도구 스키마에서 그보다 깊은 필수 경로는 관측된 적이 없고, 깊어질수록 "이 경로가
 * 왜 실패했는지" 를 사람이 읽기 어려워진다. 상한에 걸린 경로는 조용히 사라지지 않고
 * unanalyzedFields 에 depthLimit 으로 들어간다(#388).
 */
const MAX_DEPTH = 3;

/**
 * 툴 하나의 최대 경로 수. 위반 케이스가 경로마다 최대 4개(required·type·enum·range) 나므로
 * 툴 하나가 256 케이스를 넘지 않게 묶는다. 넘은 경로는 pathLimit 으로 표시한다(#388).
 */
const MAX_PATHS = 64;

/** 축을 못 만든 사유. 화면이 경로 옆에 그대로 찍는다. */
export type UnanalyzedReason =
  | "blockingKeyword" // anyOf/oneOf/allOf/not/$ref (nullable 형태는 푼 뒤 다시 본다)
  | "noProperties" // properties 가 없거나 객체가 아닌 object
  | "tupleItems" // items 가 배열이라 원소마다 스키마가 다르다
  | "depthLimit" // MAX_DEPTH 초과
  | "pathLimit" // MAX_PATHS 초과
  | "pathCollision" // 경로 문자열이 다른 필드와 충돌
  | "unreadablePath" // 이름에 . 또는 [ 가 들어 경로로 읽으면 다른 자리를 가리킨다
  | "noGround"; // type·enum·range 를 하나도 못 읽어 요구할 근거가 없다

export interface UnanalyzedField {
  readonly path: string;
  readonly reason: UnanalyzedReason;
}

export interface NormalizedInputSchema {
  /** 키가 위 경로 문법의 경로다. 코드 단위 오름차순으로 넣는다. */
  readonly fields: ReadonlyMap<string, NormalizedField>;
  /**
   * 필수인 **경로**. 최상위 required 뿐 아니라 중첩 객체의 required 도 경로로 편다.
   *
   * `user.name` 이 여기 있다는 것은 "user 가 객체로 있으면 그 안에 name 이 있어야 한다" 는
   * 뜻이다. user 자체가 없는 입력은 `user` 경로의 누락이지 `user.name` 의 누락이 아니다.
   * 판정은 `requiredPathOmitted` 한 곳에서만 한다.
   */
  readonly required: readonly string[];
  /** 루트의 additionalProperties 가 정확히 false 일 때만 true. 중첩은 보지 않는다. */
  readonly rejectsUndeclared: boolean;
}

export interface InputSchemaAnalysis {
  /** 해석하지 못했으면 null 이다. 부분 성공은 없다. */
  readonly schema: NormalizedInputSchema | null;
  /** 해석을 포기한 사유. 해석했으면 null 이다. */
  readonly unanalyzableReason: string | null;
  /** 스키마는 읽었지만 축을 못 만든 경로와 그 사유. path 코드 단위 오름차순이다. */
  readonly unanalyzedFields: readonly UnanalyzedField[];
}

/**
 * 이것이 하나라도 있으면 해석을 포기한다. 조합자·참조 계열은 "이 필드는 없어도 된다" 를
 * 말하고 있을 수 있고, 무시하면 스키마의 뜻이 뒤집혀 오탐이 된다. ADR-0015 참고.
 * 루트에 있으면 그 툴 전체를, 필드 안에 있으면 그 필드만 포기한다.
 */
const BLOCKING_KEYWORDS = [
  "anyOf",
  "oneOf",
  "allOf",
  "not",
  "if",
  "then",
  "else",
  "$ref",
  "$dynamicRef",
  "patternProperties",
  "dependentSchemas",
  "dependentRequired",
  "propertyNames",
  "unevaluatedProperties",
] as const;

const DECLARED_TYPES = [
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null",
] as const;

const hasBlockingKeyword = (schema: Record<string, unknown>): boolean =>
  BLOCKING_KEYWORDS.some((keyword) => Object.hasOwn(schema, keyword));

const declaredType = (value: unknown): DeclaredType | null =>
  DECLARED_TYPES.includes(value as DeclaredType) ? (value as DeclaredType) : null;

/**
 * nullable 형태만 푼 유효 필드 스키마. 그 형태가 아니면 null 이고 호출자가 종전대로 포기한다.
 *
 * **유니온 전반을 풀지 않는 이유.** `anyOf: [string, number]` 에서 첫 갈래의 타입 위반값 `0` 을
 * 둘째 갈래가 받아들이면, 우리가 만든 거절 기대 케이스에 서버가 정상 응답해 오탐이 된다.
 * ADR-0015 는 오탐 1건이 미탐 1건보다 비싸다고 정했다. 값 갈래가 정확히 하나일 때만 그런 자리가
 * 없다. 실측(#426)의 대상은 전부 Python 의 `Optional[X]`, 즉 `[X, { type: "null" }]` 이다.
 *
 * 값 갈래가 하나뿐이므로 `generate` 가 선언 순서 첫 성공 갈래를 고르는 규칙(ADR-0086)과 여기서
 * 고르는 갈래가 항상 같다. 두 패키지가 다른 스키마를 가정하는 자리가 생기지 않는다.
 */
function resolveNullableField(field: Record<string, unknown>): Record<string, unknown> | null {
  const present = BLOCKING_KEYWORDS.filter((keyword) => Object.hasOwn(field, keyword));
  const key = present[0];
  // 차단 키워드가 정확히 하나여야 한다. anyOf 와 oneOf 가 함께 있거나 다른 것이 섞이면 포기다.
  if (present.length !== 1 || (key !== "anyOf" && key !== "oneOf")) return null;

  const branches = field[key];
  if (!Array.isArray(branches) || branches.length < 2) return null;
  if (!branches.every((branch) => plainObject(branch))) return null;

  const valueBranches = branches.filter(
    (branch) => (branch as Record<string, unknown>).type !== "null",
  );
  // null 갈래가 없으면 풀지 않는다. 갈래 하나짜리 anyOf 를 굳이 풀 이유가 없고 규칙이 단순해진다.
  if (valueBranches.length !== 1 || valueBranches.length === branches.length) return null;

  const branch = valueBranches[0] as Record<string, unknown>;
  if (hasBlockingKeyword(branch) || Array.isArray(branch.type)) return null;

  const outer = { ...field };
  delete outer[key];
  // 값 갈래가 이긴다. 바깥에 남은 description 같은 키는 그대로 딸려 온다.
  return { ...outer, ...branch };
}

/**
 * 서버가 선언한 임의의 JSON Schema 를 우리가 이해하는 구조로 줄인다.
 * 줄이면서 정보를 잃으면 그 부분의 검사를 포기한다. 부분 성공은 없고 해석 불가면 schema 가
 * null 이다. 설계 §4.2 · §4.3, ADR-0015.
 *
 * 루트의 판정(차단 키워드 · type · properties)은 종전과 같다. 달라진 것은 그 아래로 경로를
 * 만들며 내려간다는 것뿐이다(#388).
 */
export function analyzeInputSchema(schema: unknown): InputSchemaAnalysis {
  const fail = (reason: string): InputSchemaAnalysis => ({
    schema: null,
    unanalyzableReason: reason,
    unanalyzedFields: [],
  });
  if (!plainObject(schema)) return fail("schema");
  // BLOCKING_KEYWORDS 배열 순서로 첫 것을 고른다. Object.keys 순서를 쓰면 사유가 흔들린다.
  const blocking = BLOCKING_KEYWORDS.find((keyword) => Object.hasOwn(schema, keyword));
  if (blocking !== undefined) return fail(blocking);
  // MCP 의 툴 입력은 객체지만 서버가 다르게 선언할 자유가 있다. 객체가 아니면 대조할 수 없다.
  if (schema.type !== "object") return fail("type");
  const properties = schema.properties;
  if (!plainObject(properties)) return fail("properties");

  const fields = new Map<string, NormalizedField>();
  const required: string[] = [];
  // 경로마다 사유는 하나다. Map 이라 같은 경로가 두 번 들어가지 않는다.
  const unanalyzed = new Map<string, UnanalyzedReason>();
  // 경로 충돌은 경로 집합을 **전부 만든 뒤에** 판정한다. 이름만 보고 미리 거르면
  // `"a.b"` 라는 최상위 필드가 있어도 `a` 라는 객체 필드가 없는 경우까지 함께 지워진다.
  const collided = new Set<string>();
  let pathCount = 0;

  const mark = (path: string, reason: UnanalyzedReason): void => {
    if (!unanalyzed.has(path)) unanalyzed.set(path, reason);
  };
  const setField = (path: string, field: NormalizedField): void => {
    if (fields.has(path)) collided.add(path);
    fields.set(path, field);
  };
  const stringsOf = (value: unknown): readonly string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  /**
   * 이름 자체에 경로 문자가 든 프로퍼티인지. 그런 이름은 경로로 읽으면 **다른 자리**를 가리킨다.
   * `"a.b"` 라는 최상위 필드는 `a` 객체의 `b` 로 읽혀 입력의 `input["a.b"]` 를 못 찾는다.
   *
   * 축을 만들면 어떤 입력도 그것을 못 덮어 분모에 영원히 못 채우는 빈틈이 남는다.
   * `contract-range.ts` 의 `rangeYieldsViolation` 이 범위에 대해 정한 것과 같은 규칙이다.
   *
   * `pathCollision` 과 사유를 나눈다. 충돌은 **두 선언이 같은 경로를 가리켜** 어느 쪽이 맞는지
   * 모르는 것이고, 이쪽은 **선언이 하나인데 우리가 못 읽는** 것이다. 사용자가 할 일이 다르다.
   * 전자는 둘 중 하나를 고쳐야 하고, 후자는 그 이름을 바꾸거나 그 필드의 검증을 포기해야 한다.
   *
   * 판정은 경로가 아니라 **이름**으로 한다. `childPath` 가 만든 경로에는 당연히 `.` 이 있다.
   */
  const unreadableName = (name: string): boolean => name.includes(".") || name.includes("[");

  /**
   * 경로 하나를 읽고 필요하면 그 아래로 내려간다.
   *
   * `active` 에는 지금 해석 중인 스키마 객체가 담긴다. 깊이 상한에만 기대면 순환이 상한까지
   * 같은 축을 만들어 낸다. `synthesize.ts` 의 `active` 와 같은 방식이다.
   */
  const visit = (
    raw: unknown,
    path: string,
    depth: number,
    active: Set<object>,
    /** 이 단계의 프로퍼티 이름. 배열 원소 단계는 이름이 없어 null 이다. */
    name: string | null,
  ): void => {
    if (depth > MAX_DEPTH) {
      mark(path, "depthLimit");
      return;
    }
    if (pathCount >= MAX_PATHS) {
      mark(path, "pathLimit");
      return;
    }
    // 읽을 수 없는 이름은 경로를 만들지 않는다. 아래로 내려가지도 않는다. 그 아래 경로도
    // 같은 이유로 읽을 수 없다. 경로 수에도 세지 않는다. 만들지 않은 경로다.
    if (name !== null && unreadableName(name)) {
      mark(path, "unreadablePath");
      return;
    }
    pathCount++;

    // nullable 형태면 값 갈래를 유효 스키마로 삼는다. 그 밖의 조합은 종전대로 포기한다(#426).
    const resolved = plainObject(raw) ? resolveNullableField(raw) : null;
    const field = resolved ?? raw;
    // 필드 스키마가 객체가 아니거나 차단 키워드를 쓰면 그 경로만 포기한다. required 검사는 계속한다.
    // type 이 배열이면(["string","null"]) 합집합이라 그 경로를 통째로 포기한다.
    // type 만 끄고 enum 을 남기면 { type: ["string","null"], enum: ["x"] } 에 3 을 넣었을 때
    // ENUM_MISMATCH 가 난다. 합집합의 다른 갈래가 그 값을 허용할 수 있으므로 오탐이다.
    //
    // 이미 해석 중인 객체를 다시 만난 것도 여기로 묶는다. 사용자가 볼 때 "우리가 못 읽는
    // 선언" 이라는 점이 같다.
    if (
      !plainObject(field) ||
      hasBlockingKeyword(field) ||
      Array.isArray(field.type) ||
      active.has(field)
    ) {
      setField(path, { type: null, enumValues: null, range: null, nullable: false });
      mark(path, "blockingKeyword");
      return;
    }

    const type = declaredType(field.type);
    const rawEnum = field.enum;
    const enumValues =
      Array.isArray(rawEnum) && rawEnum.length > 0 ? (rawEnum as readonly JsonValue[]) : null;
    // 범위 키워드는 BLOCKING_KEYWORDS 에 없어 지금까지 조용히 무시되고 있었다. 읽기만 한다.
    const range = readContractRange(field);
    setField(path, { type, enumValues, range, nullable: resolved !== null });
    // type 도 enum 도 범위도 못 읽었으면 이 경로에는 요구할 근거가 없다. 축을 못 만드는 자리다.
    if (type === null && enumValues === null && range === null) mark(path, "noGround");

    const nested = new Set(active).add(field);
    if (type === "object") {
      const childProperties = field.properties;
      if (!plainObject(childProperties)) {
        mark(path, "noProperties");
        return;
      }
      // 중첩 required 를 경로로 편다. 선언에 없는 이름이 섞여 있어도 그대로 둔다. 루트의
      // required 가 properties 밖 이름을 담을 수 있는 것과 같은 사정이다.
      //
      // 읽을 수 없는 이름은 required 에도 넣지 않는다. properties 에 그 이름이 없어 visit 이
      // 안 도는 경우에도 축이 생기면 안 된다.
      for (const childName of stringsOf(field.required)) {
        const childRequiredPath = childPath(path, childName);
        if (unreadableName(childName)) mark(childRequiredPath, "unreadablePath");
        else required.push(childRequiredPath);
      }
      for (const childName of Object.keys(childProperties).sort(byCodeUnit))
        visit(childProperties[childName], childPath(path, childName), depth + 1, nested, childName);
      return;
    }
    if (type === "array") {
      const items = field.items;
      // 튜플은 원소마다 스키마가 다르다. 원소 경로 하나로 묶을 수 없다.
      if (Array.isArray(items)) {
        mark(path, "tupleItems");
        return;
      }
      // items 가 없으면 원소에 대한 선언 자체가 없다. 못 읽은 것이 아니라 적히지 않은 것이라
      // 표시하지 않는다.
      if (!plainObject(items)) return;
      // tags 의 minItems 는 tags 의 range 이고 tags[] 의 minLength 는 tags[] 의 range 다.
      // items 스키마를 그대로 넘기므로 둘이 섞이지 않는다.
      visit(items, itemPath(path), depth + 1, nested, null);
    }
  };

  const rootActive = new Set<object>([schema]);
  for (const name of stringsOf(schema.required)) {
    if (unreadableName(name)) mark(name, "unreadablePath");
    else required.push(name);
  }
  for (const name of Object.keys(properties).sort(byCodeUnit))
    visit(properties[name], name, 1, rootActive, name);

  // 충돌한 경로는 지운다. 한쪽을 고르지 않는다. 어느 쪽이 맞는지 알 수 없다.
  //
  // 2026-09-13 현재 이 분기에 닿는 입력이 없다. 이름에 `.`·`[` 가 든 프로퍼티는 unreadablePath
  // 로 먼저 빠지고, properties 는 JS 객체라 같은 키가 두 번 올 수 없다. 방어로 남긴다.
  // 지우면, 판정이 틀렸을 때 두 선언이 조용히 하나로 접히고 아무도 모른다.
  //
  // 테스트가 없는 것은 그래서다. 지우지 마라. #387 의 `axis.bound === null` 방어 continue 와
  // 같은 계열이다.
  if (collided.size > 0) {
    const under = (path: string, root: string): boolean =>
      path === root || path.startsWith(`${root}.`) || path.startsWith(`${root}[`);
    for (const root of collided)
      for (const path of [...fields.keys()])
        if (under(path, root)) {
          fields.delete(path);
          unanalyzed.set(path, "pathCollision");
        }
  }
  const collidedRequired = (path: string): boolean =>
    [...collided].some(
      (root) => path === root || path.startsWith(`${root}.`) || path.startsWith(`${root}[`),
    );

  return {
    schema: {
      fields,
      required: collided.size === 0 ? required : required.filter((path) => !collidedRequired(path)),
      rejectsUndeclared: schema.additionalProperties === false,
    },
    unanalyzableReason: null,
    unanalyzedFields: [...unanalyzed]
      .sort((left, right) => byCodeUnit(left[0], right[0]))
      .map(([path, reason]) => ({ path, reason })),
  };
}

/** 경로 한 조각. 키이거나 배열 원소 단계다. */
type PathSegment = { readonly kind: "key"; readonly name: string } | { readonly kind: "item" };

/**
 * 경로를 조각으로 나눈다. `tags[].id` 는 `tags` · 원소 · `id` 셋이다.
 *
 * 이름 안에 `.` 이나 `[]` 가 든 선언은 여기서 잘못 나뉜다. 그래서 `analyzeInputSchema` 가
 * 그런 이름을 `unreadablePath` 로 빼 경로 자체를 안 만든다(#388 T4). 여기 도달하는 경로는
 * 전부 우리가 만든 것이다.
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

/** 조각 목록이 가리키는 값들. 중간이 없거나 객체가 아니면 빈 배열이다. */
function valuesAtSegments(
  input: JsonValue,
  segments: readonly PathSegment[],
): readonly JsonValue[] {
  let current: readonly JsonValue[] = [input];
  for (const segment of segments) {
    const next: JsonValue[] = [];
    for (const value of current) {
      if (segment.kind === "item") {
        if (Array.isArray(value)) next.push(...value);
        continue;
      }
      if (plainObject(value) && Object.hasOwn(value, segment.name))
        next.push(value[segment.name] as JsonValue);
    }
    if (next.length === 0) return [];
    current = next;
  }
  return current;
}

/**
 * 경로가 가리키는 값들. 배열 원소 경로는 값이 여럿일 수 있다.
 *
 * 중간에 객체가 아니거나 키가 없으면 빈 배열이다. "값이 없다" 와 "값이 null 이다" 는 다르다.
 * 전자는 판정 대상이 아니고 후자는 nullable 판정을 거친다.
 */
export const valuesAtPath = (input: JsonValue, path: string): readonly JsonValue[] =>
  valuesAtSegments(input, parsePath(path));

/**
 * 이 경로가 누락인지. `violatedAxes` 와 `input-contract.ts` 가 **같은 규칙**을 써야 한다.
 * 갈리면 커버리지가 덮었다고 세는 케이스를 승인 화면이 결함으로 보고한다.
 *
 * 부모가 가리키는 값이 있고, 그 값이 객체이고, 그 객체에 마지막 조각의 키가 없으면 누락이다.
 * 부모가 가리키는 값이 없으면 판정하지 않는다. `{}` 는 `user` 의 누락이지 `user.name` 의
 * 누락이 아니다. 이 구분이 없으면 케이스 하나가 축 둘을 덮어 커버리지가 부풀어 오른다.
 *
 * 부모가 배열 원소 경로면 원소마다 보고 하나라도 누락이면 누락이다. 축은 경로 하나당 하나다.
 */
export function requiredPathOmitted(input: JsonValue, path: string): boolean {
  const segments = parsePath(path);
  const last = segments[segments.length - 1];
  // 배열 원소 경로는 부모 배열의 required 에 들어갈 수 없다. 원소가 없는 것은 minItems 위반이고
  // 그것은 이미 그 배열의 RANGE_VIOLATION 축이다.
  if (last === undefined || last.kind !== "key") return false;
  const parents = valuesAtSegments(input, segments.slice(0, -1));
  return parents.some((parent) => plainObject(parent) && !Object.hasOwn(parent, last.name));
}

/**
 * 선언한 type 과 enum 판정을 schema-match.ts 에 위임한다. 두 벌을 두면 null·배열 판정과
 * 깊은 비교가 갈라진다. 위임하면 type 위반 시 enum 을 보지 않는 단락 순서까지 그대로 따른다.
 */
export function judgeField(
  field: NormalizedField,
  value: JsonValue,
): "TYPE_MISMATCH" | "ENUM_MISMATCH" | null {
  if (nullSatisfiesField(field, value)) return null;
  const probe: ResponseSchema = {};
  if (field.type !== null) probe.type = field.type;
  if (field.enumValues !== null) probe.enum = [...field.enumValues];
  if (probe.type === undefined && probe.enum === undefined) return null;

  const violation = matchResponseSchema(probe, value).violations[0];
  if (violation === undefined) return null;
  return violation.code === "TYPE_MISMATCH" ? "TYPE_MISMATCH" : "ENUM_MISMATCH";
}

/**
 * `null` 이 이 필드의 선언을 지키는지. nullable 로 푼 필드에서만 참이다.
 *
 * 범위 판정은 `judgeField` 를 거치지 않고 따로 돌므로 그쪽도 이 함수를 봐야 한다. 손으로 쓴
 * 명세가 `{ note: null }` 을 보내는 것은 정당한 입력이고, 그것을 위반으로 잡으면 오탐이다.
 */
export const nullSatisfiesField = (field: NormalizedField, value: JsonValue): boolean =>
  value === null && field.nullable;
