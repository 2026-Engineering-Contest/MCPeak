import type { TestCaseOrigin } from "@mcpeak/generate";
import type { JsonValue, TestCaseSpec, TestSuiteSpec } from "@mcpeak/runner";
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
  /** 그 케이스의 실제 실패 첫 줄. `DryRunCaseOutcome.failureLine` 을 그대로 옮긴다. */
  readonly failureLine: string;
}

/**
 * 호출 자체가 끝나지 못한 케이스. 입력값을 고쳐도 결과가 안 바뀌므로 교정 대상이 아니다.
 * 화면에는 §4.2 고지로 따로 나온다(설계 §3.3).
 */
export interface ThrownCase {
  readonly caseId: string;
  readonly caseName: string;
  readonly failureLine: string;
  readonly serverMessage: string;
}

/** 한 번 순회해 가른 결과. 두 배열 모두 `outcomes` 순서다. */
export interface RepairSelection {
  readonly targets: readonly RepairTarget[];
  readonly thrown: readonly ThrownCase[];
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
  /**
   * 유니온을 손으로 복제하지 않는다. 복제해 두면 `generate` 가 값을 늘려도 여기는 모르고,
   * vitest 는 초록인데 typecheck 만 빨강인 상태가 만들어진다(웨이브 1 실측).
   */
  readonly origins: ReadonlyMap<string, TestCaseOrigin>;
}

/** `renderReport` 가 케이스 본문 줄에 쓰는 들여쓰기. dry-run.ts 의 INDENT 와 같은 값이다. */
const INDENT = "    ";

/** 단언 진단의 위반 줄 표시. 이 줄에만 서버가 돌려준 값이 실려 있다. */
const VIOLATION_MARK = "→ ";

/** 실패 사유 판정에 쓰는 단언 타입. 이 줄이 있어야 "정상 응답을 기대했는데 오류" 다. */
const IS_ERROR = "isError";

/** `renderReport` 가 건너뛴 단언 줄에 붙이는 표시. 건너뛴 단언은 실패가 아니다. */
const SKIPPED_MARK = "(건너뜀) ";

/** 케이스 본문 줄에서 들여쓰기를 벗긴다. 들여쓰기가 없는 줄은 본문이 아니다. */
const bodyLines = (detail: string): readonly string[] =>
  detail
    .split("\n")
    .filter((line) => line.startsWith(INDENT))
    .map((line) => line.slice(INDENT.length));

/**
 * 실패 사유가 `isError` 단언인가. 단언 줄은 타입 이름으로 시작하고, 진단 문장과 해결 줄은
 * 그렇지 않다.
 *
 * **`(건너뜀) ` 이 붙은 줄은 실패가 아니다.** 호출이 끝나지 못하면 단언이 전부 건너뛰기로
 * 그려지는데, 그것을 실패로 읽어 못 고칠 케이스를 교정 대상에 올리던 것이 이번 결함이다.
 * 앞단에서 `operationFailed` 로 이미 가르지만 여기서도 방어적으로 뺀다.
 */
const failedByIsError = (detail: string): boolean =>
  bodyLines(detail).some((line) => line.startsWith(IS_ERROR) && !line.includes(SKIPPED_MARK));

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

/**
 * 교정 갈래와 고지 갈래가 **공유하는** 앞단 조건. 둘로 나눠 쓰면 조건이 갈리는 날 어느
 * 케이스가 양쪽에 다 들어가거나 어디에도 안 들어간다.
 */
const eligible = (
  spec: TestCaseSpec,
  outcome: DryRunCaseOutcome,
  origins: SelectRepairTargetsOptions["origins"],
): boolean => {
  if (outcome.status === "passed") return false;
  if (spec.operation.type !== "callTool") return false;
  if (Object.keys(spec.operation.input).length === 0) return false;
  // origins 에 없는 caseId 는 schemaBaseline 으로 본다. 호출 측이 provenance 를 못 구한
  // 경우이고, 그때 교정을 막으면 기능이 통째로 안 도는 쪽이 더 나쁘다.
  if (origins.get(outcome.caseId) === "user") return false;
  if (expectsError(spec)) return false;
  return true;
};

/**
 * 교정 대상과 못 고칠 실패를 한 번 순회해 가른다. 두 배열 모두 `outcomes` 순서다.
 * 정렬하지 않는다. 순서를 바꾸면 화면 번호가 앞선 결과 화면과 어긋난다.
 */
export function selectRepairTargets(options: SelectRepairTargetsOptions): RepairSelection {
  const specs = new Map(options.suite.cases.map((spec) => [spec.id, spec]));
  const targets: RepairTarget[] = [];
  const thrown: ThrownCase[] = [];
  for (const outcome of options.outcomes) {
    const spec = specs.get(outcome.caseId);
    // 명세에 없는 caseId 는 판별할 근거가 없다. 입력도 단언도 모르는 채로 고칠 수 없다.
    if (spec === undefined) continue;
    if (!eligible(spec, outcome, options.origins)) continue;
    // 호출이 끝나지 못한 케이스는 입력값을 무엇으로 바꿔도 같은 자리에서 죽는다(설계 §3.3).
    if (outcome.operationFailed) {
      thrown.push({
        caseId: outcome.caseId,
        caseName: outcome.caseName,
        failureLine: outcome.failureLine,
        serverMessage: serverMessageOf(outcome.detail),
      });
      continue;
    }
    if (!failedByIsError(outcome.detail)) continue;
    if (spec.operation.type !== "callTool") continue;
    targets.push({
      caseId: outcome.caseId,
      caseName: outcome.caseName,
      tool: spec.operation.tool,
      input: spec.operation.input,
      serverMessage: serverMessageOf(outcome.detail),
      failureLine: outcome.failureLine,
    });
  }
  return { targets, thrown };
}
