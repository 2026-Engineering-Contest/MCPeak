import type { ToolDef } from "@ohmymcp/core";
import { expectedIsError } from "./case-expectation.js";
import type { NormalizedInputSchema } from "./input-schema.js";
import { analyzeInputSchema, judgeField } from "./input-schema.js";
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
  | "ENUM_VIOLATION"; // 선언 enum 밖 값을 거절한다

/** 축 한 개. 같은 툴 안에서 (kind, field) 쌍은 유일하다. */
export interface ContractAxis {
  readonly kind: ContractAxisKind;
  /** 서버가 선언한 툴 이름. 원문 그대로다. */
  readonly tool: string;
  /** 대상 필드. HAPPY_PATH 는 null 이다. */
  readonly field: string | null;
  /** 필드에 선언된 type. TYPE_VIOLATION 에서만 값이 있고 그 밖에는 null 이다. */
  readonly declaredType: ContractDeclaredType | null;
  /** 선언된 enum. ENUM_VIOLATION 에서만 값이 있고 그 밖에는 null 이다. */
  readonly declaredEnum: readonly JsonValue[] | null;
}

export type ContractDeclaredType =
  | "object"
  | "array"
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "null";

export interface ContractAxesResult {
  /** §4.4 순서로 정렬돼 있다. analyzable 이 false 면 빈 배열이다. */
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
   * 해석하지 못해 축을 못 만든 필드 이름. UTF-16 코드 단위 오름차순.
   * 커버리지 분모에 안 들어가므로 이것을 숨기면 "축을 다 덮었다" 로 잘못 읽힌다.
   */
  readonly unanalyzedFields: readonly string[];
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
  ): ContractAxis => ({ kind, tool: tool.name, field, declaredType, declaredEnum });

  const axes: ContractAxis[] = [axis("HAPPY_PATH", null, null, null)];
  // required 는 서버가 준 순서다. 정렬해서 쓴다. cases 배열 순서는 지문에 들어가는 의미이므로
  // 서버가 required 순서를 바꾸는 것만으로 지문이 흔들리면 안 된다.
  //
  // 서버가 같은 이름을 required 에 두 번 적을 수 있다(JSON Schema 가 막지 않는다). 축은
  // (kind, field) 로 유일해야 하므로 여기서 중복을 제거한다. 안 하면 분모가 부풀어 케이스
  // 하나가 덮는 축이 둘로 세어진다.
  for (const name of [...new Set(analysis.schema.required)].sort(byCodeUnit))
    axes.push(axis("REQUIRED_OMITTED", name, null, null));
  // fields 는 analyzeInputSchema 가 이미 코드 단위로 정렬해 넣은 Map 이다. 다시 정렬하지 않는다.
  for (const [name, field] of analysis.schema.fields)
    if (field.type !== null) axes.push(axis("TYPE_VIOLATION", name, field.type, null));
  for (const [name, field] of analysis.schema.fields)
    if (field.enumValues !== null)
      axes.push(axis("ENUM_VIOLATION", name, null, [...field.enumValues]));

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
): ContractAxis => ({ kind, tool: tool.name, field, declaredType, declaredEnum });

/** 입력이 선언을 어긴 지점을 축으로 바꾼다. §4.4 순서로 낸다. */
function violatedAxes(
  tool: ToolDef,
  schema: NormalizedInputSchema,
  input: Record<string, unknown>,
): ContractAxis[] {
  const axes: ContractAxis[] = [];
  // deriveContractAxes 와 같은 이유로 중복을 제거하고 정렬한다. 같은 이름이 required 에 두 번
  // 있어도 덮는 축은 하나다.
  for (const name of [...new Set(schema.required)].sort(byCodeUnit))
    if (!Object.hasOwn(input, name))
      axes.push(contractAxis(tool, "REQUIRED_OMITTED", name, null, null));
  const typeAxes: ContractAxis[] = [];
  const enumAxes: ContractAxis[] = [];
  // fields 는 analyzeInputSchema 가 이미 코드 단위로 정렬해 넣은 Map 이다. 다시 정렬하지 않는다.
  for (const [name, field] of schema.fields) {
    if (!Object.hasOwn(input, name)) continue;
    const code = judgeField(field, input[name] as JsonValue);
    // judgeField 는 타입 위반이면 enum 을 보지 않는다. 그래서 한 케이스가 같은 필드의 타입 축과
    // enum 축을 동시에 덮지 않는다. 우리 생성기도 케이스를 따로 만든다.
    if (code === "TYPE_MISMATCH")
      typeAxes.push(contractAxis(tool, "TYPE_VIOLATION", name, field.type, null));
    else if (code === "ENUM_MISMATCH")
      enumAxes.push(
        contractAxis(tool, "ENUM_VIOLATION", name, null, [...(field.enumValues ?? [])]),
      );
  }
  return [...axes, ...typeAxes, ...enumAxes];
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
