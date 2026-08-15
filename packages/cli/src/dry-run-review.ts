import type { SuiteCaseApproval } from "@ohmymcp/runner";
import type { DryRunCaseOutcome, DryRunResult } from "./dry-run.js";
import type { ReviewIO } from "./generate-command.js";

/**
 * 시험 실행에서 실패한 케이스를 사람이 분류하는 화면. 문안은 설계 문서 §8.3 이 전량 고정한다.
 *
 * 이 모듈은 저장 여부만 판정한다. 저장도 화면 안내(카세트 유무에 따라 갈리는 마지막 줄)도
 * 호출 측의 몫이다. 여기서는 분류 요약 한 줄까지만 찍는다.
 */

/** 사람이 실패 케이스에 내리는 판정. `specError` 는 저장되지 않고 저장을 막는 사유가 된다. */
export type CaseClassification = "passed" | "serverDefect" | "specError";

export interface DryRunReviewResult {
  /** 저장을 진행해도 되는가. false 면 검토 메뉴로 돌아간다. */
  readonly cleared: boolean;
  /** `cleared` 가 true 일 때만 채워진다. 케이스 전량이 들어 있다. */
  readonly approvals: readonly SuiteCaseApproval[];
  /** 사용자가 `specError` 로 표시한 케이스. 저장을 막는 사유가 된다. */
  readonly specErrors: readonly string[];
}

/** 선택지 한 글자와 화면 문안. 배열 순서가 곧 화면 순서다. */
const CHOICES: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly help: string;
}> = [
  { key: "s", label: "서버 결함", help: "명세가 옳다. 이 케이스를 회귀 테스트로 남긴다" },
  { key: "m", label: "명세 오류", help: "추측이 틀렸다. 저장 전에 고친다" },
  { key: "?", label: "판단 보류", help: "분류를 미룬다. 저장은 막힌다" },
];

/** 보류. 판정이 아니므로 `CaseClassification` 에 대응하는 값이 없다. */
const DEFERRED = "?";

/** 요약 줄의 항목 순서. 0건인 종류는 빼고 찍는다. */
const SUMMARY_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["s", "서버 결함"],
  ["m", "명세 오류"],
  [DEFERRED, "판단 보류"],
];

/** 실패 케이스인가. 통과가 아닌 것은 전부 사람의 판단이 필요하다. */
const isFailure = (outcome: DryRunCaseOutcome): boolean => outcome.status !== "passed";

const writeSummary = (io: ReviewIO, chosen: readonly string[]): void => {
  const parts = SUMMARY_LABELS.filter(([key]) => chosen.includes(key)).map(([key, label]) => {
    const count = chosen.filter((value) => value === key).length;
    return `${label} ${count}건`;
  });
  io.write(`  분류: ${parts.join(", ")}\n`);
};

/**
 * 한 글자를 받는다. 대소문자를 구분하지 않고 앞뒤 공백을 버린다. 아는 글자가 나올 때까지
 * 같은 질문을 다시 묻는다. 기본값으로 넘기지 않는다. 모르는 채로 눌린 엔터가 없는 버그를
 * 회귀 테스트로 굳히면 안 된다.
 */
const askChoice = async (io: ReviewIO): Promise<string> => {
  for (const choice of CHOICES) {
    io.write(`      [${choice.key}] ${choice.label}  ${choice.help}\n`);
  }
  for (;;) {
    const answer = (await io.input("      선택: ")).trim().toLowerCase();
    if (CHOICES.some((choice) => choice.key === answer)) return answer;
  }
};

/**
 * 실패 케이스를 분류하고 저장 가능 여부를 판정한다.
 *
 * `cleared` 가 false 면 `approvals` 를 비운다. 반쯤 채워 넘기면 호출 측이 그것을 저장할 여지가
 * 생기고, 그 파일은 사람이 판단하지 않은 판정을 담게 된다.
 */
export async function reviewDryRun(
  io: ReviewIO,
  result: DryRunResult,
): Promise<DryRunReviewResult> {
  const blocked: DryRunReviewResult = { cleared: false, approvals: [], specErrors: [] };
  // 끝까지 못 간 실행은 분류할 대상이 아니다. 남은 케이스가 통과인지 아닌지를 모른다.
  if (result.aborted !== undefined) return blocked;

  const failures = result.outcomes.filter(isFailure);
  const passedAll = (): readonly SuiteCaseApproval[] =>
    result.outcomes.map((outcome) => ({ id: outcome.caseId, status: "passed" as const }));
  if (failures.length === 0) return { cleared: true, approvals: passedAll(), specErrors: [] };

  const chosen: string[] = [];
  for (const [index, outcome] of failures.entries()) {
    // 실패 사유는 여기서 다시 찍지 않는다. 바로 앞의 결과 화면(§8.2)이 같은 번호로 이미
    // 보여줬고, 실패가 한 건일 때는 같은 블록이 연달아 두 번 나와 중복으로 읽힌다. 번호와
    // 이름만 다시 적어 어느 케이스를 묻는지 고정한다.
    io.write(`  [${index + 1}] ${outcome.caseName}\n`);
    chosen.push(await askChoice(io));
    io.write("\n");
  }
  writeSummary(io, chosen);

  const specErrors = failures
    .filter((_, index) => chosen[index] === "m")
    .map((outcome) => outcome.caseId);
  if (chosen.some((value) => value !== "s")) {
    return { ...blocked, specErrors };
  }

  const defects = new Set(failures.map((outcome) => outcome.caseId));
  return {
    cleared: true,
    approvals: result.outcomes.map((outcome) => ({
      id: outcome.caseId,
      status: defects.has(outcome.caseId) ? ("serverDefect" as const) : ("passed" as const),
    })),
    specErrors: [],
  };
}
