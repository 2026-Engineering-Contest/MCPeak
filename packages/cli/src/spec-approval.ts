import type { CaseApprovalStatus, TestSuiteSpec } from "@ohmymcp/runner";
import { suiteFingerprint } from "@ohmymcp/runner";

export type SpecApprovalState = "matched" | "mismatched" | "absent";

export interface SpecApprovalResult {
  readonly state: SpecApprovalState;
  /** 실행 시점에 계산한 지문. 항상 있다. hex 64자. */
  readonly fingerprint: string;
  /** 파일에 적힌 지문. state 가 "absent" 면 없다. */
  readonly approvedFingerprint?: string;
}

/** 표시용 축약 길이. 64자는 줄을 넘겨 읽히지 않고, 12자면 눈으로 다르다는 것을 알 수 있다. */
const DISPLAY_LENGTH = 12;
const short = (value: string): string => `${value.slice(0, DISPLAY_LENGTH)}…`;

export function checkSpecApproval(suite: TestSuiteSpec): SpecApprovalResult {
  const fingerprint = suiteFingerprint(suite);
  const approved = suite.approval?.fingerprint;
  if (approved === undefined) return { state: "absent", fingerprint };
  return {
    state: approved === fingerprint ? "matched" : "mismatched",
    fingerprint,
    approvedFingerprint: approved,
  };
}

/**
 * 승인 시점 케이스 판정의 조회표. `approval.cases` 가 없으면 빈 표다.
 * 케이스마다 배열을 훑지 않으려고 한 번만 만든다.
 *
 * 실재하지 않는 id 가 들어 있어도 그대로 담는다. 검증이 이미 그것을 통과시켰고(설계 문서 §7.3),
 * 조회하는 쪽은 보고서의 케이스 id 로만 묻기 때문에 여분 항목은 닿지 않는다.
 */
export function caseApprovalStatuses(
  suite: TestSuiteSpec,
): ReadonlyMap<string, CaseApprovalStatus> {
  return new Map((suite.approval?.cases ?? []).map((entry) => [entry.id, entry.status]));
}

/** 케이스 하나의 승인 시점 판정. 없으면 undefined 다. */
export function caseApprovalStatus(
  suite: TestSuiteSpec,
  caseId: string,
): CaseApprovalStatus | undefined {
  return caseApprovalStatuses(suite).get(caseId);
}

/**
 * `serverDefect` 로 표시된 케이스가 다시 실패했을 때 붙이는 한 줄. 설계 문서 §9.
 * 들여쓰기는 보고서의 케이스 블록과 맞춘다. 개행으로 끝나고 호출자가 앞에 빈 줄을 붙인다.
 *
 * 종료 코드는 바뀌지 않는다. 알려진 결함이어도 실패는 실패이고, 초록으로 만들면 고칠 이유가
 * 사라진다.
 */
export const SERVER_DEFECT_NOTE_LINE =
  "    참고: 승인 시점에 서버 결함으로 표시된 케이스입니다. 서버가 아직 고쳐지지 않았습니다.\n";

/**
 * 표시 여부. 설계 문서 §7.1.
 * 전부 통과일 때는 불일치만 알린다. 매 실행 한 줄은 손으로 명세를 쓰는 사용자에게 영구
 * 소음이고, 그러면 정작 필요할 때 그 줄을 안 읽는다.
 * 전부 통과 + 불일치만 예외인 이유는 승인받지 않은 명세로 초록불이 뜬 상태라서다.
 */
export function shouldShowSpecApproval(result: SpecApprovalResult, allPassed: boolean): boolean {
  return allPassed ? result.state === "mismatched" : true;
}

/** 반환은 개행으로 끝난다. 호출자가 앞에 빈 줄을 붙인다. 설계 문서 §7.2. */
export function renderSpecApproval(result: SpecApprovalResult): string {
  if (result.state === "matched") return `명세: 승인 시점과 동일 (${short(result.fingerprint)})\n`;
  if (result.state === "absent")
    return (
      "명세: 승인 지문이 없습니다 (미고정)\n" +
      "  → ohmymcp generate 로 승인한 명세가 아니거나 승인 이전 버전으로 만든 파일입니다.\n"
    );
  return (
    "명세: 승인 시점 이후 변경됨\n" +
    `  → 승인 ${short(result.approvedFingerprint ?? "")}   현재 ${short(result.fingerprint)}\n` +
    "  → 실패 원인에서 명세 변경을 배제할 수 없습니다. 명세 diff 를 먼저 확인하세요.\n"
  );
}
