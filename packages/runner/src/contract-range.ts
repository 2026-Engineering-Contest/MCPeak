/**
 * 서버 선언의 범위 제약을 읽고, 값이 그 범위를 벗어나는지 판정한다.
 *
 * `input-schema.ts` 와 `contract-axes.ts` 가 함께 쓴다. 한쪽에 두면 다른 쪽이 역참조한다.
 */

import type { JsonValue } from "./spec/types.js";

/**
 * 선언된 범위 제약. 없는 항목은 null 이다.
 * 이 타입은 generate 가 소비한다(ADR-0009 승인 목록 대상).
 */
export interface ContractRange {
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly exclusiveMinimum: number | null;
  readonly exclusiveMaximum: number | null;
  readonly minItems: number | null;
  readonly maxItems: number | null;
  readonly minLength: number | null;
  readonly maxLength: number | null;
}

/** 유한한 숫자만 받는다. boolean 은 typeof 로 걸러진다(draft-04 의 exclusiveMinimum: true). */
const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** 개수와 길이는 음이 아닌 정수만 받는다. */
const countValue = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

/** 범위가 하나라도 있으면 true. */
export function hasRange(range: ContractRange | null): range is ContractRange {
  if (range === null) return false;
  return (
    range.minimum !== null ||
    range.maximum !== null ||
    range.exclusiveMinimum !== null ||
    range.exclusiveMaximum !== null ||
    range.minItems !== null ||
    range.maxItems !== null ||
    range.minLength !== null ||
    range.maxLength !== null
  );
}

/**
 * 스키마 객체에서 범위를 읽는다. 하나도 없으면 null 을 돌려준다.
 *
 * 값이 우리가 다루는 형태가 아니면 그 항목만 null 로 둔다. runner 는 해석기이지 검증기가
 * 아니다. 깨진 선언을 거절하는 것은 generate 의 몫이다(설계서 §3.1).
 */
export function readContractRange(schema: Record<string, unknown>): ContractRange | null {
  const range: ContractRange = {
    minimum: finiteNumber(schema.minimum),
    maximum: finiteNumber(schema.maximum),
    exclusiveMinimum: finiteNumber(schema.exclusiveMinimum),
    exclusiveMaximum: finiteNumber(schema.exclusiveMaximum),
    minItems: countValue(schema.minItems),
    maxItems: countValue(schema.maxItems),
    minLength: countValue(schema.minLength),
    maxLength: countValue(schema.maxLength),
  };
  return hasRange(range) ? range : null;
}

/**
 * 하한을 한 칸 밖으로 넘긴 값이 존재하는지. `minItems: 0` · `minLength: 0` 은 원소 -1 개와
 * 길이 -1 을 요구해 위반 값을 만들 수 없으므로 쓸 수 있는 하한이 아니다.
 */
export const hasUsableLowerBound = (range: ContractRange): boolean =>
  range.minimum !== null ||
  range.exclusiveMinimum !== null ||
  (range.minItems !== null && range.minItems >= 1) ||
  (range.minLength !== null && range.minLength >= 1);

/** 상한이 하나라도 있는지. 하한이 없을 때 위반 값을 만들 수 있는 근거다. */
export const hasUpperBound = (range: ContractRange): boolean =>
  range.maximum !== null ||
  range.exclusiveMaximum !== null ||
  range.maxItems !== null ||
  range.maxLength !== null;

/**
 * 위반 값을 만들 수 있는 범위인지. 만들 수 없으면 축이 아니다(설계서 §5.2).
 * 못 만드는 축을 분모에 넣으면 영원히 못 채우는 빈틈이 생긴다.
 */
export const rangeYieldsViolation = (range: ContractRange | null): range is ContractRange =>
  range !== null && (hasUsableLowerBound(range) || hasUpperBound(range));

/** UTF-16 코드 단위가 아니라 코드 포인트로 센다. JSON Schema 의 minLength 정의다. */
const charLength = (value: string): number => Array.from(value).length;

/**
 * 값이 선언된 범위를 벗어나는지. 값의 타입에 해당하지 않는 항목은 보지 않는다.
 * 숫자가 아닌 값에 minimum 을 적용하면 타입 위반과 범위 위반이 겹쳐 보고된다.
 */
export function violatesRange(range: ContractRange, value: JsonValue): boolean {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (range.minimum !== null && value < range.minimum) return true;
    if (range.maximum !== null && value > range.maximum) return true;
    if (range.exclusiveMinimum !== null && value <= range.exclusiveMinimum) return true;
    if (range.exclusiveMaximum !== null && value >= range.exclusiveMaximum) return true;
    return false;
  }
  if (typeof value === "string") {
    const length = charLength(value);
    if (range.minLength !== null && length < range.minLength) return true;
    if (range.maxLength !== null && length > range.maxLength) return true;
    return false;
  }
  if (Array.isArray(value)) {
    if (range.minItems !== null && value.length < range.minItems) return true;
    if (range.maxItems !== null && value.length > range.maxItems) return true;
    return false;
  }
  return false;
}
