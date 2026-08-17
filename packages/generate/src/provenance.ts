/**
 * 합성한 값에 근거가 있는지 판정한다. 이 판정이 AI 사전보완 대상 선정의 유일한 입력이다.
 *
 * 실측(설계서 §1.3): 전 필드가 근거 있는 값인 툴의 실행 실패는 0건이었고, 실패 23건은 전부
 * 근거 없는 값을 가진 쪽에 몰렸다. 즉 "근거 없는 값이 있으면 AI 를 부른다" 는 규칙은 미탐이
 * 없다.
 */

import type { ToolDef } from "@ohmymcp/core";
import { isKnownFormat } from "./constraints.js";
import { type JsonSchema, plainObject, type SchemaType } from "./schema.js";

/** 합성한 값의 근거. */
export type ValueProvenance = "declared" | "placeholder" | "unknownFormat";

/** 툴 하나의 출처 집계. */
export interface ToolProvenance {
  readonly tool: string;
  readonly declared: number;
  readonly placeholder: number;
  /** 표 밖 format 을 만난 필드 경로. 코드 단위 오름차순이다. */
  readonly unknownFormatFields: readonly string[];
  /** placeholder 또는 unknownFormat 이 하나라도 있으면 true. AI 사전보완 대상 판정이다. */
  readonly needsAssist: boolean;
}

/** UTF-16 코드 단위 안정 비교. `coverage.ts` 의 것과 같은 이유로 의도된 중복이다. */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 값의 근거가 되는 범위 제약이 선언됐는지. **그 type 에 적용되는 키워드만 본다.**
 *
 * `{ type: "integer", minLength: 3 }` 의 `minLength` 는 정수 값에 적용되지 않는다. 근거로 세면
 * 합성값은 제약이 안 걸린 `0` 인데 `needsAssist` 가 false 가 되어 AI 사전보완 대상에서 빠진다.
 * 개수 제약(`minItems` 등)은 배열 자신이 아니라 원소 값을 봐야 하므로 여기 오지 않는다.
 */
const hasApplicableRangeKeyword = (schema: JsonSchema, type: SchemaType): boolean => {
  const keys =
    type === "number" || type === "integer"
      ? ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"]
      : type === "string"
        ? ["minLength", "maxLength"]
        : [];
  return keys.some((key) => typeof schema[key] === "number");
};

/** 후보 키워드가 값을 못 박고 있는지. 이것들은 서버가 직접 적은 값이라 근거가 있다. */
const hasCandidate = (schema: JsonSchema): boolean =>
  "const" in schema ||
  "default" in schema ||
  (Array.isArray(schema.examples) && schema.examples.length > 0) ||
  (Array.isArray(schema.enum) && schema.enum.length > 0);

interface Tally {
  declared: number;
  placeholder: number;
  unknownFormatFields: string[];
}

/**
 * 필드 하나의 출처를 세어 집계에 더한다.
 *
 * 객체와 배열은 자기 자신을 세지 않고 안쪽으로 내려간다. `{ type: "array", minItems: 2 }` 는
 * 개수만 근거가 있고 **원소 값에는 근거가 없다.** 개수를 근거로 declared 라고 세면 AI 가 채워야
 * 할 원소 값이 대상에서 빠진다.
 *
 * `seen` 은 순환 방어다. 이 함수는 `analyzeToolProvenance` 로 공개돼 있어 `validateSchema` 를
 * 거치지 않은 `inputSchema` 도 받는다. 자기를 참조하는 객체가 오면 스택을 넘기는 대신
 * placeholder 로 세고 멈춘다. 값을 못 정하는 필드이므로 근거 없음이 맞는 판정이다.
 */
function tallyField(
  schema: unknown,
  path: string,
  tally: Tally,
  seen: Set<object> = new Set(),
): void {
  if (!plainObject(schema)) {
    tally.placeholder += 1;
    return;
  }
  if (seen.has(schema)) {
    tally.placeholder += 1;
    return;
  }
  // 형제끼리 같은 스키마 객체를 공유하는 것은 순환이 아니다. 조상만 담은 사본을 내려보낸다.
  const ancestors = new Set(seen).add(schema);
  if (hasCandidate(schema)) {
    tally.declared += 1;
    return;
  }
  const type = schema.type as SchemaType;
  if (type === "object") {
    const properties = ("properties" in schema ? schema.properties : {}) as Record<
      string,
      JsonSchema
    >;
    const required = ("required" in schema ? schema.required : []) as string[];
    // 필수 필드가 없는 객체는 빈 객체 하나로 끝난다. 후보가 하나뿐이라 AI 가 개선할 여지가 없다.
    if (required.length === 0) {
      tally.declared += 1;
      return;
    }
    for (const key of required)
      tallyField(properties[key], path === "" ? key : `${path}.${key}`, tally, ancestors);
    return;
  }
  if (type === "array") {
    tallyField(schema.items, path, tally, ancestors);
    return;
  }
  // format 은 문자열에만 적용된다. 다른 type 에 붙은 format 은 값의 근거가 아니다.
  const format = schema.format;
  if (type === "string" && typeof format === "string") {
    if (isKnownFormat(format)) tally.declared += 1;
    else tally.unknownFormatFields.push(path);
    return;
  }
  // boolean 과 null 은 후보가 사실상 하나뿐이라 AI 가 개선할 여지가 없다.
  if (type === "boolean" || type === "null") {
    tally.declared += 1;
    return;
  }
  if (hasApplicableRangeKeyword(schema, type)) {
    tally.declared += 1;
    return;
  }
  tally.placeholder += 1;
}

/**
 * 툴 하나의 값 출처를 집계한다. 서버를 호출하지 않고 결정론적이다.
 * 같은 선언이면 같은 대상 목록이 나온다(설계서 §4.1).
 */
export function analyzeToolProvenance(tool: ToolDef): ToolProvenance {
  const tally: Tally = { declared: 0, placeholder: 0, unknownFormatFields: [] };
  tallyField(tool.inputSchema, "", tally);
  const unknownFormatFields = [...tally.unknownFormatFields].sort(byCodeUnit);
  return {
    tool: tool.name,
    declared: tally.declared,
    placeholder: tally.placeholder,
    unknownFormatFields,
    needsAssist: tally.placeholder > 0 || unknownFormatFields.length > 0,
  };
}
