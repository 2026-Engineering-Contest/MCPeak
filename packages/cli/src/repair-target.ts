import type { JsonValue, TestCaseSpec, TestSuiteSpec } from "@ohmymcp/runner";
import type { DryRunCaseOutcome } from "./dry-run.js";

/**
 * 시험 실행에서 실패한 케이스 중 입력값 교정을 시도할 수 있는 것만 가려낸다.
 * 판별 규칙 전량은 설계 문서 §4.2 다. 순수 함수이고 서버를 부르지 않는다.
 */

/** 교정을 시도할 수 있는 실패 케이스. 설계 문서 §4.2 를 전부 만족한 것만 만들어진다. */
export interface RepairTarget {
  readonly caseId: string;
  readonly caseName: string;
  readonly tool: string;
  /** 현재 입력값. 키 순서는 명세에 적힌 순서다. */
  readonly input: Readonly<Record<string, JsonValue>>;
  /** 서버가 돌려준 오류 본문. 제안과 화면의 근거다. 없으면 빈 문자열이다. */
  readonly serverMessage: string;
}

/** 한 케이스에 대해 시도한 값의 이력. 분류 화면(§8.7)이 쓴다. */
export interface RepairAttempt {
  readonly field: string;
  readonly value: JsonValue;
  readonly passed: boolean;
}

export interface SelectRepairTargetsOptions {
  readonly suite: TestSuiteSpec;
  readonly outcomes: readonly DryRunCaseOutcome[];
  readonly origins: ReadonlyMap<string, "schemaBaseline" | "ai" | "user">;
}

/** `renderReport` 가 케이스 본문 줄에 쓰는 들여쓰기. dry-run.ts 의 INDENT 와 같은 값이다. */
const INDENT = "    ";

/** 단언 진단의 위반 줄 표시. 이 줄에만 서버가 돌려준 값이 실려 있다. */
const VIOLATION_MARK = "→ ";

/** 실패 사유 판정에 쓰는 단언 타입. 이 줄이 있어야 "정상 응답을 기대했는데 오류" 다. */
const IS_ERROR = "isError";

/** 케이스 본문 줄에서 들여쓰기를 벗긴다. 들여쓰기가 없는 줄은 본문이 아니다. */
const bodyLines = (detail: string): readonly string[] =>
  detail
    .split("\n")
    .filter((line) => line.startsWith(INDENT))
    .map((line) => line.slice(INDENT.length));

/**
 * 실패 사유가 `isError` 단언인가. 단언 줄은 타입 이름으로 시작하고, 진단 문장과 해결 줄은
 * 그렇지 않다. 통과한 단언은 애초에 그려지지 않으므로 존재 자체가 실패의 근거다.
 */
const failedByIsError = (detail: string): boolean =>
  bodyLines(detail).some((line) => line.startsWith(IS_ERROR));

/**
 * 서버가 돌려준 오류 본문을 뽑는다. 문장을 새로 만들지 않고 위반 줄을 그대로 옮긴다.
 * `isError` 진단에는 값이 실리지 않으므로 근거가 되는 것은 본문 단언의 위반 줄뿐이다.
 * 뽑을 것이 없으면 빈 문자열이고, 그때 호출 측은 사람 입력으로 간다(§4.4).
 */
const serverMessageOf = (detail: string): string =>
  bodyLines(detail)
    .filter((line) => line.startsWith(VIOLATION_MARK))
    .map((line) => line.slice(VIOLATION_MARK.length))
    .join("\n");

/**
 * 위반 케이스인가. ADR-0022 가 만드는 케이스는 입력을 일부러 어긋나게 만든 것이라
 * 고치면 케이스의 목적이 사라진다. 판별은 `isError` 단언의 `expected` 로 한다.
 */
const expectsError = (spec: TestCaseSpec): boolean =>
  spec.assertions.some((assertion) => assertion.type === "isError" && assertion.expected === true);

const toTarget = (
  spec: TestCaseSpec,
  outcome: DryRunCaseOutcome,
  origins: SelectRepairTargetsOptions["origins"],
): RepairTarget | undefined => {
  if (outcome.status === "passed") return undefined;
  if (spec.operation.type !== "callTool") return undefined;
  if (Object.keys(spec.operation.input).length === 0) return undefined;
  // origins 에 없는 caseId 는 schemaBaseline 으로 본다. 호출 측이 provenance 를 못 구한
  // 경우이고, 그때 교정을 막으면 기능이 통째로 안 도는 쪽이 더 나쁘다.
  if (origins.get(outcome.caseId) === "user") return undefined;
  if (expectsError(spec)) return undefined;
  if (!failedByIsError(outcome.detail)) return undefined;

  return {
    caseId: outcome.caseId,
    caseName: outcome.caseName,
    tool: spec.operation.tool,
    input: spec.operation.input,
    serverMessage: serverMessageOf(outcome.detail),
  };
};

/**
 * 교정 대상을 고른다. 반환 배열은 `outcomes` 순서다. 정렬하지 않는다.
 * 순서를 바꾸면 화면 번호가 앞선 결과 화면과 어긋난다.
 */
export function selectRepairTargets(options: SelectRepairTargetsOptions): readonly RepairTarget[] {
  const specs = new Map(options.suite.cases.map((spec) => [spec.id, spec]));
  const targets: RepairTarget[] = [];
  for (const outcome of options.outcomes) {
    const spec = specs.get(outcome.caseId);
    // 명세에 없는 caseId 는 판별할 근거가 없다. 입력도 단언도 모르는 채로 고칠 수 없다.
    if (spec === undefined) continue;
    const target = toTarget(spec, outcome, options.origins);
    if (target !== undefined) targets.push(target);
  }
  return targets;
}
