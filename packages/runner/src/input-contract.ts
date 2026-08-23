import type { ToolDef } from "@mcpeak/core";
import { expectedIsError } from "./case-expectation.js";
import type { ContractRange } from "./contract-range.js";
import { rangeYieldsViolation, violatesRange } from "./contract-range.js";
import type { InputSchemaAnalysis } from "./input-schema.js";
import { analyzeInputSchema, judgeField } from "./input-schema.js";
import { byCodeUnit } from "./ordering.js";
import { plainObject, typeName } from "./schema-match.js";
import type { JsonValue, TestSuiteSpec } from "./spec/types.js";
import type { SpecFinding, SpecFindingCode, SpecFindingsResult } from "./spec-findings.js";
import { MAX_FINDINGS_PER_CASE } from "./spec-findings.js";

export interface InputContractOptions {
  readonly suite: TestSuiteSpec;
  /** McpClient.listTools()의 결과를 그대로 넘긴다. 순서는 결과에 영향을 주지 않는다. */
  readonly tools: readonly ToolDef[];
}

/**
 * 거절을 기대하는 케이스에서 침묵시키는 코드. ADR-0021.
 *
 * 그 케이스는 선언을 어긴 입력을 보내는 것이 목적이다. 어긴 사실을 위반으로 신고하면 도구가
 * 스스로 만든 케이스를 스스로 고발한다.
 *
 * TOOL_NOT_DECLARED 는 빼지 않는다. 서버가 모르는 툴 이름은 거절 기대와 무관하게 오타다.
 * SCHEMA_NOT_ANALYZABLE 도 빼지 않는다. 위반이 아니라 "검사를 못 했다" 는 보고이고, 삼키면
 * "검사했는데 깨끗함" 과 구분되지 않는다.
 */
const SUPPRESSED_WHEN_REJECTION_EXPECTED: ReadonlySet<SpecFindingCode> = new Set([
  "REQUIRED_MISSING",
  "UNDECLARED_FIELD",
  "TYPE_MISMATCH",
  "ENUM_MISMATCH",
  // 범위 위반도 거절 기대 케이스가 노리는 위반이다. 넣지 않으면 도구가 스스로 만든
  // RANGE_VIOLATION 케이스를 스스로 고발한다.
  "RANGE_MISMATCH",
]);

/** 설계 §9.2 의 검사 종류 순서. 낮을수록 앞에 온다. */
const CODE_ORDER: Record<string, number> = {
  TOOL_NOT_DECLARED: 0,
  SCHEMA_NOT_ANALYZABLE: 1,
  REQUIRED_MISSING: 2,
  UNDECLARED_FIELD: 3,
  TYPE_MISMATCH: 4,
  ENUM_MISMATCH: 5,
  RANGE_MISMATCH: 6,
  REJECTION_WITHOUT_VIOLATION: 7,
};

/** 코드 포인트 기준 레벤슈타인 거리. 두 행만 들고 돌아 입력 길이에 선형인 메모리를 쓴다. */
function levenshtein(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_unused, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const deletion = (previous[j] as number) + 1;
      const insertion = (current[j - 1] as number) + 1;
      current[j] = Math.min(substitution, deletion, insertion);
    }
    previous = current;
  }
  return previous[b.length] as number;
}

/**
 * 오타 후보를 하나만 고른다. 설계 §5.4 의 6 단계 규칙이다.
 * 길이 절반 조건이 없으면 'id' 와 'at' 같은 짧은 이름이 서로 후보가 되고,
 * 동점 처리가 없으면 Object.keys 순서에 결과가 달라져 결정론이 깨진다.
 */
function suggestName(target: string, candidates: readonly string[]): string | undefined {
  let best: { name: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const distance = levenshtein(target, candidate);
    const longer = Math.max(Array.from(target).length, Array.from(candidate).length);
    if (distance > 2 || distance > Math.floor(longer / 2)) continue;
    if (
      best === undefined ||
      distance < best.distance ||
      (distance === best.distance && byCodeUnit(candidate, best.name) < 0)
    )
      best = { name: candidate, distance };
  }
  return best?.name;
}

const NUMERIC_BOUNDS = ["minimum", "exclusiveMinimum", "maximum", "exclusiveMaximum"] as const;
const ITEM_BOUNDS = ["minItems", "maxItems"] as const;
const LENGTH_BOUNDS = ["minLength", "maxLength"] as const;

/**
 * 값의 타입에 적용되는 경계만 고른다. `violatesRange` 가 실제로 본 것과 같은 묶음이다.
 * `{ type: "array", minimum: 1, minItems: 2 }` 에 `[]` 가 오면 어긴 것은 `minItems` 뿐인데
 * `minimum` 까지 실으면 진단이 배열에 적용되지도 않는 "1 이상" 을 서버 선언으로 적는다.
 */
const boundsFor = (value: JsonValue): readonly (keyof ContractRange)[] => {
  if (typeof value === "number" && Number.isFinite(value)) return NUMERIC_BOUNDS;
  if (typeof value === "string") return LENGTH_BOUNDS;
  if (Array.isArray(value)) return ITEM_BOUNDS;
  return [];
};

/**
 * 선언된 범위를 finding 의 `expected` 에 실을 JSON 값으로 줄인다. 선언되지 않은 항목과 이 값에
 * 적용되지 않는 항목은 키 자체를 만들지 않는다. 남기면 `describeSpecFinding` 이 서버가 적지
 * 않았거나 이 타입과 무관한 경계를 서버 선언으로 적는다. 키 순서는 배열 순서라 결정론적이다.
 */
const declaredRangeValue = (range: ContractRange, checked: JsonValue): JsonValue => {
  const value: Record<string, number> = {};
  for (const key of boundsFor(checked)) {
    const bound = range[key];
    if (bound !== null) value[key] = bound;
  }
  return value;
};

/** suggestion 이 없으면 키 자체를 만들지 않는다. 소비자가 존재 여부로 분기한다. */
const withSuggestion = (finding: SpecFinding, suggestion: string | undefined): SpecFinding =>
  suggestion === undefined ? finding : { ...finding, suggestion };

/**
 * 명세의 callTool 입력을 서버가 선언한 inputSchema와 대조한다. 서버를 호출하지 않는다.
 * 해석하지 못하는 스키마는 SCHEMA_NOT_ANALYZABLE 하나만 내고 그 툴의 다른 검사를 전부 건너뛴다.
 *
 * 판정이 애매하면 finding 을 내지 않는다. 이 결과가 승인 차단 근거로 쓰이므로 오탐 1 건이
 * 미탐 1 건보다 비싸다(ADR-0015).
 */
export function checkInputContract(options: InputContractOptions): SpecFindingsResult {
  const { suite, tools } = options;

  // 이름으로만 조회한다. 배열 순서를 쓰지 않아야 tools 순서가 결과를 바꾸지 않는다.
  //
  // 같은 이름이 두 번 오면 첫 선언을 쓰는 것이 순서 의존이다. 두 선언의 inputSchema 가 다르면
  // tools 를 뒤집는 것만으로 blocking 과 advisory 가 뒤바뀐다. 어느 선언이 참인지 알 방법이
  // 없으므로 해석 불가로 처리한다. 모르면 침묵한다는 ADR-0015 의 원칙과 같다.
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) duplicated.add(tool.name);
    seen.add(tool.name);
  }
  const declaredTools = new Map<string, ToolDef>();
  for (const tool of tools) if (!declaredTools.has(tool.name)) declaredTools.set(tool.name, tool);
  const toolNames = [...declaredTools.keys()].sort(byCodeUnit);
  /** 같은 툴을 여러 케이스가 쓰므로 분석을 한 번만 한다. 실패 사유도 함께 캐시한다. */
  const analyses = new Map<string, InputSchemaAnalysis>();
  const analyzeOnce = (tool: ToolDef): InputSchemaAnalysis => {
    const cached = analyses.get(tool.name);
    if (cached !== undefined) return cached;
    const analysis = duplicated.has(tool.name)
      ? { schema: null, unanalyzableReason: "duplicateTool", unanalyzedFields: [] }
      : analyzeInputSchema(tool.inputSchema);
    analyses.set(tool.name, analysis);
    return analysis;
  };

  const findings: SpecFinding[] = [];
  let totalFindings = 0;

  for (const testCase of suite.cases) {
    // listTools 는 입력이 없어서 대조할 계약이 없다.
    if (testCase.operation.type !== "callTool") continue;
    const caseId = testCase.id;
    const toolName = testCase.operation.tool;
    const caseFindings: SpecFinding[] = [];
    /** 대조를 끝까지 수행했는지. 툴 미선언·해석 불가·비객체 입력이면 판정 자체가 없던 것이다. */
    let contractChecked = false;

    const tool = declaredTools.get(toolName);
    if (tool === undefined) {
      caseFindings.push(
        withSuggestion(
          {
            code: "TOOL_NOT_DECLARED",
            severity: "blocking",
            caseId,
            path: "operation.tool",
            actual: toolName,
          },
          suggestName(toolName, toolNames),
        ),
      );
    } else {
      const analysis = analyzeOnce(tool);
      const schema = analysis.schema;
      if (schema === null) {
        caseFindings.push({
          code: "SCHEMA_NOT_ANALYZABLE",
          severity: "advisory",
          caseId,
          path: "operation.tool",
          actual: toolName,
          reason: analysis.unanalyzableReason ?? "schema",
        });
      } else {
        const input = testCase.operation.input;
        // 입력이 객체가 아니면 대조할 키가 없다. validateMcpSuite 가 형식을 따로 잡는다.
        if (plainObject(input)) {
          contractChecked = true;
          const inputKeys = Object.keys(input).sort(byCodeUnit);
          const undeclaredKeys = inputKeys.filter((key) => !schema.fields.has(key));
          const declaredNames = [...schema.fields.keys()];

          for (const name of schema.required) {
            if (Object.hasOwn(input, name)) continue;
            caseFindings.push(
              withSuggestion(
                {
                  code: "REQUIRED_MISSING",
                  severity: "blocking",
                  caseId,
                  path: `input.${name}`,
                  expected: name,
                },
                suggestName(name, undeclaredKeys),
              ),
            );
          }

          // JSON Schema 의 기본값이 "허용" 이라 정확히 false 일 때만 본다. 반대로 잡으면 오탐이 쏟아진다.
          if (schema.rejectsUndeclared)
            for (const key of undeclaredKeys)
              caseFindings.push(
                withSuggestion(
                  {
                    code: "UNDECLARED_FIELD",
                    severity: "blocking",
                    caseId,
                    path: `input.${key}`,
                    actual: key,
                  },
                  suggestName(
                    key,
                    declaredNames.filter((name) => !Object.hasOwn(input, name)),
                  ),
                ),
              );

          for (const key of inputKeys) {
            const field = schema.fields.get(key);
            if (field === undefined) continue;
            const value = input[key] as JsonValue;
            const code = judgeField(field, value);
            if (code === "TYPE_MISMATCH")
              caseFindings.push({
                code,
                severity: "blocking",
                caseId,
                path: `input.${key}`,
                expected: field.type,
                actual: typeName(value),
              });
            else if (code === "ENUM_MISMATCH") {
              const allowed = field.enumValues ?? [];
              caseFindings.push(
                withSuggestion(
                  {
                    code,
                    severity: "blocking",
                    caseId,
                    path: `input.${key}`,
                    expected: [...allowed],
                    actual: value,
                  },
                  typeof value === "string"
                    ? suggestName(
                        value,
                        allowed.filter((item): item is string => typeof item === "string"),
                      )
                    : undefined,
                ),
              );
            } else if (rangeYieldsViolation(field.range) && violatesRange(field.range, value)) {
              // 타입·enum 을 이미 어긴 값에는 범위를 보지 않는다. judgeField 의 단락 순서와 같다.
              // 문장은 describeSpecFinding 이 만든다. expected 에는 가공하지 않은 범위만 싣는다.
              caseFindings.push({
                code: "RANGE_MISMATCH",
                // 비차단이다. 통과·실패 판정을 바꾸지 않는다.
                severity: "advisory",
                caseId,
                path: `input.${key}`,
                expected: declaredRangeValue(field.range, value),
                actual: value,
              });
            }
          }
        }
      }
    }

    // expectedIsError 가 null 이면(isError 단언이 없거나 expected 가 서로 다른 단언이 둘인
    // 모순된 명세) 침묵시키지 않는다. 모순을 숨기지 않는다.
    const rejectionExpected = expectedIsError(testCase) === true;

    // 이슈 #94. 거절을 기대하는데 억제할 위반이 하나도 없으면, 그 케이스는 무엇을 거절받으려는지
    // 알 수 없다(오타로 정상 입력이 됐거나, expected 를 잘못 적었거나, 선언 밖 제약을 노린 것이다).
    // ADR-0021 의 침묵과 반대 방향이라 충돌하지 않는다. 그쪽은 "어긴 것을 신고하지 않는다" 이고
    // 이쪽은 "어긴 것이 하나도 없다" 를 알린다. 대조를 끝까지 못 한 케이스에는 내지 않는다 —
    // 모르면 침묵한다(ADR-0015). 마지막 갈래(선언 밖 제약)가 정당하므로 advisory 다.
    if (rejectionExpected && contractChecked && caseFindings.length === 0)
      caseFindings.push({
        code: "REJECTION_WITHOUT_VIOLATION",
        severity: "advisory",
        caseId,
        path: "operation.input",
      });

    const kept = rejectionExpected
      ? caseFindings.filter((finding) => !SUPPRESSED_WHEN_REJECTION_EXPECTED.has(finding.code))
      : caseFindings;

    kept.sort(
      (left, right) =>
        (CODE_ORDER[left.code] ?? 0) - (CODE_ORDER[right.code] ?? 0) ||
        byCodeUnit(left.path, right.path),
    );
    // 총합은 침묵 후 개수다. 침묵시킨 것을 총합에 남기면 소비자가 "위반 N건이 있는데 목록은
    // 비어 있다" 를 보고 버그로 읽는다.
    totalFindings += kept.length;
    // 상한을 넘으면 목록에서 자르되 총합은 자르기 전 개수로 센다.
    findings.push(...kept.slice(0, MAX_FINDINGS_PER_CASE));
  }

  return { findings, totalFindings };
}
