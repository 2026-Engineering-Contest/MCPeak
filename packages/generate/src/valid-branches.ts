/**
 * 정상 입력의 분기를 케이스로 만든다(이슈 #401).
 *
 * **`violation-cases.ts` 에 얹지 않는다.** 한 파일에 "거절을 기대하는 것" 과 "정상을 기대하는
 * 것" 이 섞이면 단언을 반대로 다는 실수를 컴파일러가 못 잡는다. 여기서 만드는 케이스는 전부
 * `isError: false` 다.
 */

import type { ToolDef } from "@mcpeak/core";
import type { ResponseSchema } from "@mcpeak/runner";
import { canonicalJson } from "./canonical.js";
import { fieldSlug } from "./filename.js";
import {
  GenerateTestsError,
  type JsonObject,
  type JsonSchema,
  type JsonValue,
  plainObject,
} from "./schema.js";
import { synthesizeValue } from "./synthesize.js";
import type { GeneratedCase } from "./violation-cases.js";

/** 밟지 않은 정상 분기 한 건. render.ts 의 OutputContractSkip 과 같은 계열이다. */
export interface ValidBranchSkip {
  readonly tool: string;
  readonly field: string;
  /** 화면에 그대로 찍는 한 문장. 무엇을 안 밟았고 왜인지가 다 들어 있다. */
  readonly reason: string;
}

export interface ValidBranchResult {
  readonly cases: readonly GeneratedCase[];
  readonly skips: readonly ValidBranchSkip[];
}

/**
 * UTF-16 코드 단위 안정 비교. `coverage.ts` 와 같은 이유로 `localeCompare` 를 쓰지 않는다.
 * 결과가 로캘과 ICU 데이터에 따라 달라지면 케이스 배열이 기계마다 다르게 나온다.
 */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 화면에 그대로 찍는 문장들. 표로 고정한다. 문안이 흔들리면 사용자가 같은 상황을 다른 것으로
 * 읽는다.
 */
const SKIP_REASON = {
  composition: "anyOf/oneOf/$ref 가 선언돼 있어 갈래별 정상 입력을 만들지 않았습니다.",
  optionalValueBranch: "선택 필드라 '있음' 케이스만 만들고 값 분기는 만들지 않았습니다.",
  nestedObject: "중첩 객체 안의 분기는 아직 생성하지 않습니다.",
  sameAsHappy: "변형 값이 기준 정상 입력과 같아 케이스를 만들지 않았습니다.",
  enumTruncated: (count: number): string =>
    `enum 값 ${count}개 중 3개만 실행했습니다. 첫 값·두 번째 값·마지막 값만 밟습니다.`,
  optionalValue: (message: string): string => `선택 필드 값을 만들지 못했습니다: ${message}`,
} as const;

/** 갈래가 여럿인 선언. 어느 갈래의 정상 입력을 만들어야 하는지 우리가 정할 수 없다. */
const hasComposition = (schema: Record<string, unknown>): boolean =>
  "$ref" in schema || "anyOf" in schema || "oneOf" in schema;

/**
 * 한 도구의 정상 분기 케이스 전량. 기준 정상 케이스는 포함하지 않는다(render.ts 가 만든다).
 *
 * 필드 순회는 `properties` 의 선언 순서가 아니라 코드 단위 오름차순이다. 서버가 순서를 바꾸는
 * 것만으로 케이스 배열이 흔들리면 결정론성이 깨진다.
 */
export function buildValidBranchCases(options: {
  readonly tool: ToolDef;
  /** 기준 정상 입력. render.ts 의 synthesizeValue 결과를 그대로 받는다. */
  readonly happyInput: JsonObject;
  /** 케이스 id 접두사. render.ts 의 baseName 과 같은 값이다. */
  readonly baseName: string;
  /** 출력 계약이 지원되면 그 스키마. 아니면 null. 기준 정상 케이스와 같은 단언을 붙인다. */
  readonly responseSchema: ResponseSchema | null;
}): ValidBranchResult {
  const { tool, happyInput, baseName, responseSchema } = options;
  const cases: GeneratedCase[] = [];
  const skips: ValidBranchSkip[] = [];

  const inputSchema = plainObject(tool.inputSchema) ? tool.inputSchema : null;
  // 루트 자체가 갈래를 가지면 아무것도 만들지 않는다. 어느 갈래의 정상 입력인지 모르는데
  // required 를 루트의 required 배열로만 판정하면, 갈래에서 필수인 필드를 "선택 필드" 로
  // 잘못 읽어 엉뚱한 케이스를 만든다. runner 도 이런 툴을 해석 불가로 보고 축을 내지 않는다
  // (커버리지의 unanalyzableReason 이 "anyOf" 다). 그쪽과 판단을 맞춘다.
  //
  // skip 을 남기지 않는다. ValidBranchSkip 은 필드 단위인데 여기서 못 밟은 것은 툴 전체이고,
  // 커버리지가 unanalyzableReason 으로 이미 고지한다. 같은 사실을 두 모양으로 두 번 말하지
  // 않는다. 이 줄이 없으면 다음 사람이 누락으로 읽고 skip 을 넣는다.
  if (inputSchema !== null && hasComposition(inputSchema)) return { cases, skips };
  const properties = inputSchema === null ? undefined : inputSchema.properties;
  if (!plainObject(properties)) return { cases, skips };
  // $ref 가 든 선택 필드 값을 만들려면 루트가 필요하다. 필드 스키마만으로는 참조를 못 푼다.
  const root = (inputSchema ?? {}) as JsonSchema;
  const required = new Set(
    Array.isArray(inputSchema?.required)
      ? inputSchema.required.filter((name): name is string => typeof name === "string")
      : [],
  );

  const skip = (field: string, reason: string): void => {
    skips.push({ tool: tool.name, field, reason });
  };

  // id 중복 회피는 violation-cases.ts 의 uniqueId 와 같은 규칙이다. 접두사가 branch-* 라
  // 다른 계열과 겹치지 않으므로 이 파일 안의 지역 Set 으로 충분하다.
  const usedIds = new Set<string>();
  const uniqueId = (initial: string): string => {
    let id = initial;
    for (let occurrence = 2; usedIds.has(id); occurrence++) id = `${initial}-${occurrence}`;
    usedIds.add(id);
    return id;
  };

  const branchCase = (
    initialId: string,
    name: string,
    field: string,
    value: JsonValue,
    pinnedFields: readonly string[],
  ): GeneratedCase => ({
    id: uniqueId(initialId),
    name,
    operation: { type: "callTool", tool: tool.name, input: { ...happyInput, [field]: value } },
    assertions: [
      { type: "isError", expected: false },
      ...(responseSchema === null
        ? []
        : [{ type: "structuredContentMatchesSchema" as const, schema: responseSchema }]),
    ],
    pinnedFields,
  });

  /**
   * 변형 값이 기준과 같으면 케이스가 아니라 중복이다. `===` 로 비교하지 않는다. enum 값이
   * 배열이나 객체일 수 있다(JSON Schema 가 막지 않는다).
   */
  const sameAsHappy = (field: string, value: JsonValue): boolean =>
    canonicalJson(value) === canonicalJson(happyInput[field] ?? null);

  for (const field of Object.keys(properties).sort(byCodeUnit)) {
    const schema = properties[field];
    // 스키마가 객체가 아니면 읽을 선언이 없다. skip 도 안 넣는다. 안 밟은 분기가 아니라
    // 분기랄 것이 없는 선언이다.
    if (!plainObject(schema)) continue;
    if (hasComposition(schema)) {
      skip(field, SKIP_REASON.composition);
      continue;
    }
    // const 는 값이 하나로 못 박혀 있다. 분기가 없다.
    if ("const" in schema) continue;

    if (!required.has(field)) {
      // 선택 필드는 "있음" 케이스만 만든다. 값 분기까지 만들면 한 케이스가 "필드가 있다" 와
      // "값이 저것이다" 를 동시에 검증해, 실패했을 때 둘 중 무엇 때문인지 알 수 없다.
      let value: JsonValue;
      try {
        value = synthesizeValue(schema as JsonSchema, `properties.${field}`, root);
      } catch (error) {
        // GenerateTestsError 만 삼킨다. 그 밖의 오류는 우리 결함이므로 그대로 올린다.
        // 전부 삼키면 우리 버그가 "분기 못 만듦" 으로 위장돼 조용히 유지된다.
        if (!(error instanceof GenerateTestsError)) throw error;
        skip(field, SKIP_REASON.optionalValue(error.message));
        continue;
      }
      // pinnedFields 가 빈 배열이다. 이 케이스의 정체성은 값이 아니라 **그 키가 있다는 사실**
      // 이다. 값 자체는 근거 없는 합성값이라 AI 사전보완이 그럴듯한 값으로 바꿔 주는 편이
      // 낫다. 필드가 사라지지만 않으면 케이스는 자기 일을 한다.
      cases.push(
        branchCase(
          `${baseName}-branch-with-${fieldSlug(field)}`,
          `${tool.name}가 선택 필드 '${field}' 를 받아 정상 응답한다`,
          field,
          value,
          [],
        ),
      );
      if (Array.isArray(schema.enum) || schema.type === "boolean")
        skip(field, SKIP_REASON.optionalValueBranch);
      continue;
    }

    if (Array.isArray(schema.enum)) {
      const values = schema.enum as readonly JsonValue[];
      if (values.length < 2) continue;
      const variants: {
        readonly suffix: string;
        readonly label: string;
        readonly value: JsonValue;
      }[] = [{ suffix: "2", label: "다른 선언값", value: values[1] as JsonValue }];
      if (values.length >= 3)
        variants.push({
          suffix: "last",
          label: "마지막 선언값",
          value: values[values.length - 1] as JsonValue,
        });
      for (const variant of variants) {
        if (sameAsHappy(field, variant.value)) {
          skip(field, SKIP_REASON.sameAsHappy);
          continue;
        }
        cases.push(
          branchCase(
            `${baseName}-branch-enum-${fieldSlug(field)}-${variant.suffix}`,
            `${tool.name}가 '${field}' 의 ${variant.label}에 정상 응답한다`,
            field,
            variant.value,
            [field],
          ),
        );
      }
      // 값이 셋이면 첫·두 번째·마지막이 곧 전부다. 다 밟았는데 "3개만 실행했습니다" 를 찍으면
      // 화면이 거짓말을 한다. 그래서 조건이 4 이상이다.
      if (values.length >= 4) skip(field, SKIP_REASON.enumTruncated(values.length));
      continue;
    }

    if (schema.type === "boolean") {
      // 기준이 이미 false 면 만들 분기가 없다. default: false 가 선언된 필드가 그렇다.
      if (happyInput[field] !== true) continue;
      cases.push(
        branchCase(
          `${baseName}-branch-false-${fieldSlug(field)}`,
          `${tool.name}가 '${field}' 가 false 인 입력에 정상 응답한다`,
          field,
          false,
          [field],
        ),
      );
      continue;
    }

    if (schema.type === "object" && plainObject(schema.properties))
      skip(field, SKIP_REASON.nestedObject);
  }

  return { cases, skips };
}
