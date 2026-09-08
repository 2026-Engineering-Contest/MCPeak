/**
 * 조합 키(`$ref` · `anyOf` · `oneOf`)를 한 겹 푸는 자리. 설계 §5.5 의 병합 표가 여기 전부다.
 *
 * 세 호출자(`validateSchema` · `synthesizeValue` · `tallyField`)가 같은 순서로 같은 유효
 * 스키마를 보게 하려고 한 모듈에 모았다. 셋이 각자 풀면 "검증은 통과했는데 합성이 다른 갈래를
 * 골랐다" 가 조용히 생긴다.
 */

import { canonicalJson } from "./canonical.js";
import { fail, type JsonSchema, plainObject } from "./schema.js";

/** 한 겹 푼 결과 하나. `target` 은 `$ref` 로 해석한 대상 객체이고 순환 판정의 키다. */
export interface ExpandedSchema {
  readonly schema: JsonSchema;
  readonly path: string;
  readonly target: object | null;
}

/** 큰 값을 남기는 하한 키워드. */
const MAX_OF_KEYS = new Set(["minimum", "exclusiveMinimum", "minItems", "minLength"]);
/** 작은 값을 남기는 상한 키워드. */
const MIN_OF_KEYS = new Set(["maximum", "exclusiveMaximum", "maxItems", "maxLength"]);
/** `outer` 를 그대로 두는 키워드. 설명용이거나 참조를 루트에서만 풀기 때문이다. */
const OUTER_KEYS = new Set([
  "title",
  "description",
  "$schema",
  "$defs",
  "definitions",
  "default",
  "examples",
]);
/** 다음 재귀가 풀 키워드. `outer` 의 것은 이미 풀린 뒤라 여기 오지 않는다. */
const INNER_KEYS = new Set(["$ref", "anyOf", "oneOf"]);

/** JSON 값으로 같은지. 키 순서에 좌우되지 않아야 해서 정규화한 문자열로 비교한다. */
function jsonEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    // JSON 으로 표현할 수 없는 값은 같다고 볼 수 없다. 충돌로 보고하는 편이 안전하다.
    return false;
  }
}

function conflict(path: string, key: string): never {
  return fail(
    "UNSUPPORTED_SCHEMA",
    path,
    `'${key}' 가 갈래와 바깥 스키마에 서로 다르게 선언돼 합칠 수 없습니다: ${path}`,
    "한쪽에만 선언하거나 같은 값으로 맞추세요.",
  );
}

/**
 * 스키마가 조합 키를 갖는지. `$ref` → `anyOf` → `oneOf` 순으로 첫 것을 돌려준다.
 * 없으면 null. 세 호출자(validate · synthesize · provenance)가 같은 순서를 쓰게 하는 장치다.
 */
export function compositionKey(schema: JsonSchema): "$ref" | "anyOf" | "oneOf" | null {
  if ("$ref" in schema) return "$ref";
  if ("anyOf" in schema) return "anyOf";
  if ("oneOf" in schema) return "oneOf";
  return null;
}

/** `#` 로 시작하는 JSON Pointer 를 루트에서 푼다. 실패는 전부 UNSUPPORTED_SCHEMA. */
export function resolveLocalRef(ref: unknown, root: JsonSchema, path: string): JsonSchema {
  if (typeof ref !== "string" || !ref.startsWith("#") || (ref.length > 1 && ref[1] !== "/")) {
    return fail(
      "UNSUPPORTED_SCHEMA",
      `${path}.$ref`,
      `루트 스키마 밖을 가리키는 $ref 는 지원하지 않습니다: ${path}.$ref = ${JSON.stringify(ref)}`,
      "'#/$defs/이름' 또는 '#/definitions/이름' 처럼 '#' 로 시작하는 참조만 지원합니다.",
    );
  }

  const pointer = ref.slice(1);
  const segments = pointer === "" ? [] : pointer.slice(1).split("/").map(decodeSegment);
  let current: unknown = root;
  for (const segment of segments) {
    current = childAt(current, segment);
    if (current === undefined) break;
  }
  if (!plainObject(current)) {
    const last = segments[segments.length - 1] ?? ref;
    return fail(
      "UNSUPPORTED_SCHEMA",
      `${path}.$ref`,
      `$ref 대상을 찾지 못했습니다: ${path}.$ref = ${JSON.stringify(ref)}`,
      `루트 스키마의 $defs 또는 definitions 에 '${last}' 을 스키마 객체로 선언하세요.`,
    );
  }
  return current as JsonSchema;
}

/** 포인터 조각을 되돌린다. 순서가 사양이다: 퍼센트 → `~1` → `~0`(설계 §5.3). */
function decodeSegment(segment: string): string {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // 퍼센트 인코딩이 아니면 원문 그대로 쓴다. 그 자체는 참조 실패 사유가 아니다.
  }
  return decoded.replaceAll("~1", "/").replaceAll("~0", "~");
}

function childAt(current: unknown, segment: string): unknown {
  if (Array.isArray(current)) {
    if (!/^(0|[1-9]\d*)$/.test(segment)) return undefined;
    return current[Number(segment)];
  }
  if (plainObject(current) && Object.hasOwn(current, segment)) return current[segment];
  return undefined;
}

/** 조합 키 하나를 푼 바깥 스키마와 갈래(또는 $ref 대상)를 AND 로 합친다. 충돌이면 UNSUPPORTED_SCHEMA. */
export function mergeSchemas(outer: JsonSchema, inner: JsonSchema, path: string): JsonSchema {
  const merged: Record<string, unknown> = { ...outer };
  for (const key of Object.keys(inner)) {
    if (!Object.hasOwn(outer, key)) {
      merged[key] = inner[key];
      continue;
    }
    merged[key] = mergeKey(key, outer[key], inner[key], path);
  }
  return merged;
}

function mergeKey(key: string, outerValue: unknown, innerValue: unknown, path: string): unknown {
  const keyPath = `${path}.${key}`;
  if (key === "required") return mergeRequired(outerValue, innerValue, keyPath, key);
  if (key === "properties") return mergeProperties(outerValue, innerValue, keyPath);
  if (key === "enum") return mergeEnum(outerValue, innerValue, keyPath);
  if (MAX_OF_KEYS.has(key)) return mergeBound(outerValue, innerValue, keyPath, key, Math.max);
  if (MIN_OF_KEYS.has(key)) return mergeBound(outerValue, innerValue, keyPath, key, Math.min);
  if (OUTER_KEYS.has(key)) return outerValue;
  if (INNER_KEYS.has(key)) return innerValue;
  // type · const · format · pattern · items · additionalProperties 와 표 밖 키가 여기 온다.
  if (!jsonEqual(outerValue, innerValue)) conflict(keyPath, key);
  return outerValue;
}

/** 합집합. `outer` 순서 뒤에 `inner` 의 새 이름. 중복은 뺀다. */
function mergeRequired(
  outerValue: unknown,
  innerValue: unknown,
  path: string,
  key: string,
): unknown {
  if (!Array.isArray(outerValue) || !Array.isArray(innerValue)) {
    if (!jsonEqual(outerValue, innerValue)) conflict(path, key);
    return outerValue;
  }
  const merged = [...outerValue];
  for (const name of innerValue)
    if (!merged.some((item) => jsonEqual(item, name))) merged.push(name);
  return merged;
}

/** 이름 단위 합집합. 같은 이름이 양쪽에 있으면 JSON 으로 같을 때만 허용한다. */
function mergeProperties(outerValue: unknown, innerValue: unknown, path: string): unknown {
  if (!plainObject(outerValue) || !plainObject(innerValue)) {
    if (!jsonEqual(outerValue, innerValue)) conflict(path, "properties");
    return outerValue;
  }
  const merged: Record<string, unknown> = { ...outerValue };
  for (const name of Object.keys(innerValue)) {
    if (!Object.hasOwn(outerValue, name)) {
      merged[name] = innerValue[name];
      continue;
    }
    if (!jsonEqual(outerValue[name], innerValue[name])) conflict(`${path}.${name}`, "properties");
  }
  return merged;
}

/** JSON 동등 기준 교집합, `outer` 순서. 비면 충돌이다(만족할 값이 없다). */
function mergeEnum(outerValue: unknown, innerValue: unknown, path: string): unknown {
  if (!Array.isArray(outerValue) || !Array.isArray(innerValue)) {
    if (!jsonEqual(outerValue, innerValue)) conflict(path, "enum");
    return outerValue;
  }
  const kept = outerValue.filter((item) => innerValue.some((other) => jsonEqual(item, other)));
  if (kept.length === 0) conflict(path, "enum");
  return kept;
}

function mergeBound(
  outerValue: unknown,
  innerValue: unknown,
  path: string,
  key: string,
  pick: (left: number, right: number) => number,
): unknown {
  if (typeof outerValue === "number" && typeof innerValue === "number")
    return pick(outerValue, innerValue);
  if (!jsonEqual(outerValue, innerValue)) conflict(path, key);
  return outerValue;
}

/**
 * 조합 키 하나를 푼 유효 스키마 목록. `$ref` 면 1개, `anyOf`/`oneOf` 면 갈래 수만큼.
 * 병합 충돌은 그 갈래의 오류로 던지지 않고 목록에서 뺀다. 전부 빠지면 첫 충돌 오류를 던진다.
 */
export function expandComposition(
  schema: JsonSchema,
  root: JsonSchema,
  path: string,
): readonly ExpandedSchema[] {
  const key = compositionKey(schema);
  // anyOf · oneOf 는 T4 가 더한다. 그때까지 두 키는 미지원 키워드로 먼저 걸린다.
  if (key !== "$ref") return [];

  const outer: Record<string, unknown> = { ...schema };
  delete outer.$ref;
  const target = resolveLocalRef(schema.$ref, root, path);
  return [{ schema: mergeSchemas(outer, target, `${path}.$ref`), path, target }];
}
