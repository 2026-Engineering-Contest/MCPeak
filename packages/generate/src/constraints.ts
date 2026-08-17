/**
 * 제약 키워드의 표와 검증. `schema.ts` 와 `synthesize.ts` 가 함께 쓴다.
 *
 * `schema.ts` 에 얹지 않는 이유: 그 파일은 이미 타입·구조·후보 검증을 다 들고 있다. 제약 표와
 * 모순 판정을 더하면 한 파일이 두 가지 판단을 갖는다.
 */

import { fail, type JsonSchema, type SchemaType } from "./schema.js";

/**
 * `format` 표. 표에 있는 것만 지원한다(설계서 §3.3).
 *
 * 값은 전부 문서용으로 예약된 자원이다. `example.com`(RFC 2606), `192.0.2.0/24`(RFC 5737),
 * `2001:db8::/32`(RFC 3849). 실존 자원을 가리키지 않으므로 dry run 이 외부에 부작용을 내지
 * 않는다. UUID 는 버전 4 형식을 만족하는 최소값이다.
 *
 * 삽입 순서가 의미를 갖는다. 화면 문구가 이 순서로 만들어진다.
 */
export const FORMAT_VALUES: ReadonlyMap<string, string> = new Map([
  ["uri", "https://example.com"],
  ["uri-reference", "https://example.com"],
  ["iri", "https://example.com"],
  ["date", "2000-01-01"],
  ["date-time", "2000-01-01T00:00:00Z"],
  ["time", "00:00:00Z"],
  ["duration", "P1D"],
  ["email", "user@example.com"],
  ["idn-email", "user@example.com"],
  ["uuid", "00000000-0000-4000-8000-000000000000"],
  ["hostname", "example.com"],
  ["ipv4", "192.0.2.1"],
  ["ipv6", "2001:db8::1"],
]);

/** 표에 있는 format 인지. 표 밖이면 거절하지 않고 값 출처를 unknownFormat 으로 표시한다. */
export function isKnownFormat(format: string): boolean {
  return FORMAT_VALUES.has(format);
}

/** 유한한 숫자만 받는 키워드. draft-04 의 `exclusiveMinimum: true` 는 여기서 걸린다. */
const NUMERIC_KEYS = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"] as const;

/** 음이 아닌 정수만 받는 키워드. */
const COUNT_KEYS = ["minItems", "maxItems", "minLength", "maxLength"] as const;

const invalid = (path: string, message: string, hint: string): never =>
  fail("INVALID_SCHEMA_CONSTRAINT", path, message, hint);

/** 선언된 값을 읽는다. 키가 없으면 null 이다. 값 검증은 assertConstraints 가 이미 끝냈다. */
const numberAt = (schema: JsonSchema, key: string): number | null =>
  typeof schema[key] === "number" ? (schema[key] as number) : null;

/**
 * 제약 키워드의 값과 상호 모순을 검사한다. 문제가 있으면 `INVALID_SCHEMA_CONSTRAINT` 로 던진다.
 *
 * `UNSUPPORTED_SCHEMA` 와 코드를 나눈다. `baseline.ts` 는 `UNSUPPORTED_SCHEMA` 만 툴 단위로
 * 건너뛰므로(ADR-0036) 같은 코드를 쓰면 깨진 서버 선언이 조용히 건너뛰어진다. "우리가 아직
 * 지원하지 않는다" 는 건너뛰어도 되지만 "선언이 깨졌다" 는 사용자가 알아야 할 결함이다.
 */
export function assertConstraints(schema: JsonSchema, path: string): void {
  for (const key of NUMERIC_KEYS) {
    if (!(key in schema)) continue;
    const value = schema[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      invalid(
        `${path}.${key}`,
        `'${key}' 는 유한한 숫자여야 합니다: ${path}.${key}`,
        "JSON Schema draft-06 이후의 숫자 형식으로 경계를 지정하세요. boolean exclusiveMinimum(draft-04)은 지원하지 않습니다.",
      );
    }
  }
  for (const key of COUNT_KEYS) {
    if (!(key in schema)) continue;
    const value = schema[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      invalid(
        `${path}.${key}`,
        `'${key}' 는 음이 아닌 정수여야 합니다: ${path}.${key}`,
        "0 이상의 정수를 지정하세요.",
      );
    }
  }
  if ("format" in schema && typeof schema.format !== "string") {
    invalid(
      `${path}.format`,
      `'format' 은 문자열이어야 합니다: ${path}.format`,
      "JSON Schema format 이름을 문자열로 지정하세요.",
    );
  }

  assertNoContradiction(schema, path);
}

/** 만족 가능한 값이 없는 조합. 빈 enum 을 거절하는 기존 판단과 같은 계열이다(설계서 §3.5). */
function assertNoContradiction(schema: JsonSchema, path: string): void {
  const minimum = numberAt(schema, "minimum");
  const maximum = numberAt(schema, "maximum");
  const exclusiveMinimum = numberAt(schema, "exclusiveMinimum");
  const exclusiveMaximum = numberAt(schema, "exclusiveMaximum");

  const conflict = (lowerKey: string, lower: number, upperKey: string, upper: number): never =>
    invalid(
      `${path}.${lowerKey}`,
      `'${lowerKey}' ${lower} 와 '${upperKey}' ${upper} 를 함께 만족하는 값이 없습니다: ${path}`,
      "두 경계 중 하나를 고쳐 만족 가능한 범위로 만드세요.",
    );

  if (minimum !== null && maximum !== null && minimum > maximum)
    conflict("minimum", minimum, "maximum", maximum);
  if (exclusiveMinimum !== null && maximum !== null && exclusiveMinimum >= maximum)
    conflict("exclusiveMinimum", exclusiveMinimum, "maximum", maximum);
  if (minimum !== null && exclusiveMaximum !== null && minimum >= exclusiveMaximum)
    conflict("minimum", minimum, "exclusiveMaximum", exclusiveMaximum);
  if (
    exclusiveMinimum !== null &&
    exclusiveMaximum !== null &&
    exclusiveMinimum >= exclusiveMaximum
  )
    conflict("exclusiveMinimum", exclusiveMinimum, "exclusiveMaximum", exclusiveMaximum);

  const minItems = numberAt(schema, "minItems");
  const maxItems = numberAt(schema, "maxItems");
  if (minItems !== null && maxItems !== null && minItems > maxItems)
    conflict("minItems", minItems, "maxItems", maxItems);

  const minLength = numberAt(schema, "minLength");
  const maxLength = numberAt(schema, "maxLength");
  if (minLength !== null && maxLength !== null && minLength > maxLength)
    conflict("minLength", minLength, "maxLength", maxLength);

  if ((schema.type as SchemaType) !== "integer") return;
  // integer 는 경계 사이에 정수가 없을 수 있다. minimum 1.2 · maximum 1.8 이 그렇다.
  // exclusive 는 경계를 한 칸 좁힌 뒤 본다.
  const lower = integerLowerBound(minimum, exclusiveMinimum);
  const upper = integerUpperBound(maximum, exclusiveMaximum);
  if (lower !== null && upper !== null && lower > upper) {
    invalid(
      path,
      `선언된 범위 안에 정수가 없습니다: ${path}`,
      "type 을 number 로 바꾸거나 정수를 포함하도록 경계를 넓히세요.",
    );
  }
}

/** integer 가 취할 수 있는 최솟값. 둘 다 있으면 더 좁은 쪽을 쓴다. */
export function integerLowerBound(
  minimum: number | null,
  exclusiveMinimum: number | null,
): number | null {
  const bounds: number[] = [];
  if (minimum !== null) bounds.push(Math.ceil(minimum));
  if (exclusiveMinimum !== null) bounds.push(Math.floor(exclusiveMinimum) + 1);
  return bounds.length === 0 ? null : Math.max(...bounds);
}

/** integer 가 취할 수 있는 최댓값. 둘 다 있으면 더 좁은 쪽을 쓴다. */
export function integerUpperBound(
  maximum: number | null,
  exclusiveMaximum: number | null,
): number | null {
  const bounds: number[] = [];
  if (maximum !== null) bounds.push(Math.floor(maximum));
  if (exclusiveMaximum !== null) bounds.push(Math.ceil(exclusiveMaximum) - 1);
  return bounds.length === 0 ? null : Math.min(...bounds);
}
