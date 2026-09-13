import type { ToolDef } from "@mcpeak/core";
import { expectedIsError } from "./case-expectation.js";
import type { ContractRange, ContractRangeBound } from "./contract-range.js";
import {
  hasUpperBound,
  hasUsableLowerBound,
  rangeYieldsViolation,
  violatedBounds,
} from "./contract-range.js";
import type {
  DeclaredType,
  NormalizedInputSchema,
  UnanalyzedField,
  UnanalyzedReason,
} from "./input-schema.js";
import {
  analyzeInputSchema,
  judgeField,
  nullSatisfiesField,
  requiredPathOmitted,
  valuesAtPath,
} from "./input-schema.js";
import { byCodeUnit } from "./ordering.js";
import { plainObject } from "./schema-match.js";
import type { JsonValue, TestCaseSpec } from "./spec/types.js";

/**
 * 서버 선언에서 도출되는 검증 축의 종류.
 * 선언에 근거가 있는 것만 넣는다. "이 툴은 느릴 것이다" 같은 추측은 축이 아니다.
 */
export type ContractAxisKind =
  | "HAPPY_PATH" // 선언을 지킨 입력에 정상 응답한다
  | "REQUIRED_OMITTED" // 필수 필드를 뺀 입력을 거절한다
  | "TYPE_VIOLATION" // 선언 type 을 어긴 값을 거절한다
  | "ENUM_VIOLATION" // 선언 enum 밖 값을 거절한다
  | "RANGE_VIOLATION" // 선언된 범위 밖 값을 거절한다
  | "UNDECLARED_FIELD"; // 선언에 없는 필드를 넣은 입력을 거절한다

/** 축 한 개. 같은 툴 안에서 (kind, field, bound) 셋은 유일하다. */
export interface ContractAxis {
  readonly kind: ContractAxisKind;
  /** 서버가 선언한 툴 이름. 원문 그대로다. */
  readonly tool: string;
  /**
   * 대상 필드의 **경로**. HAPPY_PATH 와 UNDECLARED_FIELD 는 null 이다.
   * 최상위 필드는 이름 그대로이고, 중첩은 `user.name` · `tags[]` · `tags[].id` 다(#388).
   */
  readonly field: string | null;
  /** 필드에 선언된 type. TYPE_VIOLATION 에서만 값이 있고 그 밖에는 null 이다. */
  readonly declaredType: ContractDeclaredType | null;
  /** 선언된 enum. ENUM_VIOLATION 에서만 값이 있고 그 밖에는 null 이다. */
  readonly declaredEnum: readonly JsonValue[] | null;
  /** 선언된 범위. RANGE_VIOLATION 에서만 값이 있고 그 밖에는 null 이다. */
  readonly declaredRange: ContractRange | null;
  /**
   * 범위의 어느 쪽 경계를 보는 축인지. RANGE_VIOLATION 에서만 값이 있고 그 밖에는 null 이다.
   * 축 정체성은 이제 (kind, field, bound) 다. 이것을 키에서 빼면 한쪽 경계만 검사한 스위트가
   * 범위 전체를 덮은 것으로 세어진다(이슈 #387).
   */
  readonly bound: ContractRangeBound | null;
}

/**
 * 축이 싣는 선언 타입. 값의 출처는 `analyzeInputSchema` 이므로 그쪽 유니온이 곧 정의다.
 *
 * 같은 목록을 여기 다시 적어 두면 한쪽이 늘 때 다른 쪽을 손으로 맞춰야 하고, 그것을
 * 잊으면 값을 넘기는 자리에서야 타입 오류가 난다(이슈 #154). 이름은 `generate` 가
 * 공개 API 로 쓰고 있으므로 별칭으로 남긴다.
 */
export type ContractDeclaredType = DeclaredType;

/**
 * 축을 못 만든 경로와 사유. `input-schema.ts` 는 패키지 내부 전용이라 그쪽을 직접 내보내지
 * 않고 여기서 다시 낸다. `ContractDeclaredType` 이 `DeclaredType` 을 다시 내는 것과 같다.
 */
export type { UnanalyzedField, UnanalyzedReason };

export interface ContractAxesResult {
  /**
   * §4.4 순서로 정렬돼 있다. analyzable 이 false 면 빈 배열이다.
   * 순서는 HAPPY_PATH · REQUIRED_OMITTED · TYPE · ENUM · RANGE · UNDECLARED_FIELD 다.
   */
  readonly axes: readonly ContractAxis[];
  /**
   * 스키마를 해석했는지. false 면 축을 하나도 세지 않는다.
   * checkInputContract 가 SCHEMA_NOT_ANALYZABLE 을 내는 조건과 정확히 같다.
   */
  readonly analyzable: boolean;
  /**
   * analyzable 이 false 인 사유. true 면 null 이다.
   * 차단 키워드면 그 키워드 이름("anyOf"), 루트 type 이 object 가 아니면 "type",
   * properties 가 없거나 객체가 아니면 "properties", 스키마가 객체가 아니면 "schema",
   * 툴 이름이 중복 선언이면 "duplicateTool" 이다. 화면이 §7.3 의 괄호에 그대로 넣는다.
   * 사유를 안 적으면 사용자가 자기 서버의 어디를 볼지 모른다.
   */
  readonly unanalyzableReason: string | null;
  /**
   * 해석하지 못해 축을 못 만든 경로와 그 사유. path 코드 단위 오름차순.
   * 커버리지 분모에 안 들어가므로 이것을 숨기면 "축을 다 덮었다" 로 잘못 읽힌다.
   */
  readonly unanalyzedFields: readonly UnanalyzedField[];
}

/**
 * 툴 하나의 선언에서 축을 도출한다. 서버를 호출하지 않는다.
 *
 * duplicated 는 호출자가 `tools` 배열 전체를 보고 판정해 넘긴다. 같은 이름이 두 번 선언됐다는
 * 사실은 툴 하나만 봐서는 알 수 없다. true 면 analyzable false, unanalyzableReason
 * "duplicateTool" 로 끝낸다. 호출자가 ContractAxesResult 를 손으로 만들지 않게 하려고
 * 파라미터로 받는다.
 */
export function deriveContractAxes(
  tool: ToolDef,
  options?: { readonly duplicated?: boolean },
): ContractAxesResult {
  const unanalyzable = (reason: string): ContractAxesResult => ({
    axes: [],
    analyzable: false,
    unanalyzableReason: reason,
    unanalyzedFields: [],
  });
  // 중복 선언은 툴 하나만 봐서는 알 수 없다. 호출자가 tools 배열 전체를 보고 넘긴다.
  if (options?.duplicated === true) return unanalyzable("duplicateTool");
  const analysis = analyzeInputSchema(tool.inputSchema);
  if (analysis.schema === null) return unanalyzable(analysis.unanalyzableReason ?? "schema");

  const axis = (
    kind: ContractAxisKind,
    field: string | null,
    declaredType: ContractDeclaredType | null,
    declaredEnum: readonly JsonValue[] | null,
    declaredRange: ContractRange | null = null,
    bound: ContractRangeBound | null = null,
  ): ContractAxis => ({
    kind,
    tool: tool.name,
    field,
    declaredType,
    declaredEnum,
    declaredRange,
    bound,
  });

  const axes: ContractAxis[] = [axis("HAPPY_PATH", null, null, null)];
  // required 는 서버가 준 순서다. 정렬해서 쓴다. cases 배열 순서는 지문에 들어가는 의미이므로
  // 서버가 required 순서를 바꾸는 것만으로 지문이 흔들리면 안 된다.
  //
  // 서버가 같은 이름을 required 에 두 번 적을 수 있다(JSON Schema 가 막지 않는다). 축은
  // (kind, field) 로 유일해야 하므로 여기서 중복을 제거한다. 안 하면 분모가 부풀어 케이스
  // 하나가 덮는 축이 둘로 세어진다.
  //
  // tags[] 는 부모 배열의 required 에 들어갈 수 없다. 원소가 없는 것은 minItems 위반이고
  // 그것은 이미 tags 의 RANGE_VIOLATION 축이다.
  for (const path of [...new Set(analysis.schema.required)].sort(byCodeUnit))
    if (!path.endsWith("[]")) axes.push(axis("REQUIRED_OMITTED", path, null, null));
  // fields 는 analyzeInputSchema 가 이미 코드 단위로 정렬해 넣은 Map 이다. 다시 정렬하지 않는다.
  for (const [name, field] of analysis.schema.fields)
    if (field.type !== null) axes.push(axis("TYPE_VIOLATION", name, field.type, null));
  for (const [name, field] of analysis.schema.fields)
    if (field.enumValues !== null)
      axes.push(axis("ENUM_VIOLATION", name, null, [...field.enumValues]));
  // 위반 값을 만들 수 없는 범위는 축이 아니다. minItems: 0 단독이 그렇다(설계서 §5.2).
  //
  // enum 이 함께 선언된 필드도 만들 수 없다. 범위를 어긴 값은 enum 밖이기도 해서 위반 분류가
  // ENUM_VIOLATION 으로 먼저 잡힌다(violatedAxes 의 단락 순서). 그러면 이 축은 어떤 케이스로도
  // 안 덮여 영원히 못 채우는 빈틈이 분모에 남는다. enum 이 이미 허용 집합을 못 박고 있으므로
  // 거절 검증은 ENUM_VIOLATION 축이 대신한다.
  //
  // 한 필드의 상한과 하한은 서로 다른 축이다. 한쪽만 검사한 스위트가 범위 전체를 덮은 것으로
  // 세어지면 안 된다(이슈 #387). 한 필드 안에서는 lower 가 upper 보다 먼저다.
  for (const [name, field] of analysis.schema.fields) {
    if (field.enumValues !== null || field.range === null) continue;
    if (hasUsableLowerBound(field.range))
      axes.push(axis("RANGE_VIOLATION", name, null, null, field.range, "lower"));
    if (hasUpperBound(field.range))
      axes.push(axis("RANGE_VIOLATION", name, null, null, field.range, "upper"));
  }
  // additionalProperties 가 정확히 false 일 때만이다. JSON Schema 의 기본값이 "허용" 이라
  // 없거나 true 이거나 스키마 객체면 거절을 기대할 근거가 없다(#427). field 는 null 이다.
  // 선언 밖 키가 여럿이어도 축은 하나라 필드로 나눌 수 없고, 나눌 이유도 없다.
  if (analysis.schema.rejectsUndeclared) axes.push(axis("UNDECLARED_FIELD", null, null, null));

  return {
    axes,
    analyzable: true,
    unanalyzableReason: null,
    unanalyzedFields: analysis.unanalyzedFields,
  };
}

/**
 * 축 객체 하나를 만든다. `tool` 을 인자로 받는다. 모듈 수준 클로저로 툴을 잡아 두면
 * 두 공개 함수가 서로의 상태를 보게 된다.
 */
const contractAxis = (
  tool: ToolDef,
  kind: ContractAxisKind,
  field: string | null,
  declaredType: ContractDeclaredType | null,
  declaredEnum: readonly JsonValue[] | null,
  declaredRange: ContractRange | null = null,
  bound: ContractRangeBound | null = null,
): ContractAxis => ({
  kind,
  tool: tool.name,
  field,
  declaredType,
  declaredEnum,
  declaredRange,
  bound,
});

/** 입력이 선언을 어긴 지점을 축으로 바꾼다. §4.4 순서로 낸다. */
function violatedAxes(
  tool: ToolDef,
  schema: NormalizedInputSchema,
  input: Record<string, unknown>,
): ContractAxis[] {
  const axes: ContractAxis[] = [];
  // deriveContractAxes 와 같은 이유로 중복을 제거하고 정렬한다. 같은 경로가 required 에 두 번
  // 있어도 덮는 축은 하나다. 누락 판정은 requiredPathOmitted 한 곳에서만 한다. 규칙을 여기
  // 손으로 다시 적으면 input-contract.ts 와 갈린다(#388).
  for (const path of [...new Set(schema.required)].sort(byCodeUnit))
    if (requiredPathOmitted(input as JsonValue, path))
      axes.push(contractAxis(tool, "REQUIRED_OMITTED", path, null, null));
  const typeAxes: ContractAxis[] = [];
  const enumAxes: ContractAxis[] = [];
  const rangeAxes: ContractAxis[] = [];
  // fields 는 analyzeInputSchema 가 이미 코드 단위로 정렬해 넣은 Map 이다. 다시 정렬하지 않는다.
  for (const [path, field] of schema.fields) {
    // 배열 원소 경로는 값이 여럿이다. 하나라도 위반이면 그 축을 덮은 것이다(설계 §4.1).
    const values = valuesAtPath(input as JsonValue, path);
    if (values.length === 0) continue;
    const codes = values.map((value) => judgeField(field, value));
    // judgeField 는 타입 위반이면 enum 을 보지 않는다. 그래서 한 케이스가 같은 경로의 타입 축과
    // enum 축을 동시에 덮지 않는다. 값이 여럿일 때도 같은 단락 순서를 경로 단위로 유지한다.
    // 원소 하나는 타입 위반이고 다른 하나는 범위 위반인 입력이 축 둘을 덮으면, 우리 생성기가
    // 케이스를 따로 만드는 것과 어긋나 커버리지가 부풀어 오른다.
    if (codes.includes("TYPE_MISMATCH"))
      typeAxes.push(contractAxis(tool, "TYPE_VIOLATION", path, field.type, null));
    else if (codes.includes("ENUM_MISMATCH"))
      enumAxes.push(
        contractAxis(tool, "ENUM_VIOLATION", path, null, [...(field.enumValues ?? [])]),
      );
    else if (rangeYieldsViolation(field.range)) {
      // 어긴 쪽 경계의 축만 덮는다. 만족 불가능한 선언에서는 한 값이 양쪽을 다 덮는다.
      // 값이 여럿이면 경계를 모아 두고 한 번씩만 낸다. 축은 경로 하나에 경계 하나다.
      const bounds = new Set<ContractRangeBound>();
      for (const value of values) {
        // nullable 필드의 null 은 선언을 지킨 값이다. 범위 판정은 judgeField 를 거치지 않으므로
        // 여기서 따로 걸러야 한다(#426).
        if (nullSatisfiesField(field, value)) continue;
        for (const bound of violatedBounds(field.range, value)) bounds.add(bound);
      }
      // 순서는 늘 lower 다음 upper 다. Set 의 삽입 순서에 기대면 값 순서가 축 순서를 바꾼다.
      for (const bound of ["lower", "upper"] as const)
        if (bounds.has(bound))
          rangeAxes.push(
            contractAxis(tool, "RANGE_VIOLATION", path, null, null, field.range, bound),
          );
    }
  }
  // 선언 밖 키가 여럿이어도 축은 하나다. field 가 null 이라 구분할 수 없고 구분할 이유도 없다.
  const undeclaredAxes: ContractAxis[] =
    schema.rejectsUndeclared && Object.keys(input).some((key) => !schema.fields.has(key))
      ? [contractAxis(tool, "UNDECLARED_FIELD", null, null, null)]
      : [];
  return [...axes, ...typeAxes, ...enumAxes, ...rangeAxes, ...undeclaredAxes];
}

/**
 * 케이스 하나가 어느 축을 덮는지 판정한다. 서버를 호출하지 않는다.
 * 판정 규칙은 §6.2 다. 덮는 축이 없으면 빈 배열이다.
 *
 * checkInputContract 의 결과를 재료로 쓰지 않는다. 그쪽은 §11.1 규칙 때문에 거절 기대 케이스의
 * REQUIRED_MISSING · TYPE_MISMATCH · ENUM_MISMATCH 를 내지 않는데, 커버리지가 판정해야 하는 것이
 * 정확히 그 케이스들이다. 두 함수가 analyzeInputSchema 와 필드 판정을 내부에서 공유하고
 * 출력만 다르게 낸다.
 */
export function matchCoveredAxes(options: {
  readonly testCase: TestCaseSpec;
  readonly tool: ToolDef;
}): readonly ContractAxis[] {
  const { testCase, tool } = options;
  if (testCase.operation.type !== "callTool") return [];
  if (testCase.operation.tool !== tool.name) return [];
  // isError 단언이 없거나 expected 가 서로 다른 단언이 둘 있으면 이 케이스는 서버가 거절했는지를
  // 판정하지 않는다. 어떤 축도 덮지 못한다.
  const expected = expectedIsError(testCase);
  if (expected === null) return [];
  const analysis = analyzeInputSchema(tool.inputSchema);
  if (analysis.schema === null) return [];
  const input = testCase.operation.input;
  if (!plainObject(input)) return [];
  const violated = violatedAxes(tool, analysis.schema, input);
  if (expected === false)
    return violated.length === 0 ? [contractAxis(tool, "HAPPY_PATH", null, null, null)] : [];
  return violated;
}
