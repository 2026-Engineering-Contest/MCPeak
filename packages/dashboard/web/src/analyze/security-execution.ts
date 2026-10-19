import type { AnalyzeSecurityResponse } from "../../../src/api-types.js";
import { firstLine } from "./pillar-state.js";

/** 격리가 실제로 돈 실행. */
export const SANDBOX_RAN_LABEL = "격리 실행(Docker)";

/**
 * 격리를 요청하지 않은 실행의 사유. 대시보드가 대상을 보고 격리를 싣지 않은 경우(원격 서버, 격리 이미지가
 * 실행하지 않는 명령)라 응답에 사유 글자가 없다. 그래서 이 문장만 화면이 정한다.
 */
export const NOT_SANDBOXABLE_REASON = "격리할 수 없는 대상입니다";

/**
 * 보안 점검이 어디서 돌았는가(ADR-0117). 분석하기는 격리를 자동으로 시도하므로 같은 서버라도 Docker 상태에
 * 따라 관측 범위가 달라진다. 카드 요약 줄과 상세 머리가 이 글자를 보여 결과를 비교할 근거를 남긴다.
 *
 * 응답만 본다. 사유는 응답에 이미 있는 글자(`sandboxLine`, `report.sandbox.reason.detail`,
 * `sandboxFallbackReason`)의 첫 줄이다. 격리 밖의 호출 정책은 리포트의 `probe` 다.
 */
export function securityExecution(response: AnalyzeSecurityResponse): string {
  const { sandbox, probe } = response.report;
  if (sandbox?.status === "ran") return SANDBOX_RAN_LABEL;
  const local = `로컬 실행(${probe})`;
  if (sandbox?.status === "unavailable")
    return `${local}: ${firstLine(response.sandboxLine ?? sandbox.reason.detail)}`;
  if (response.sandboxFallbackReason !== null)
    return `${local}: ${firstLine(response.sandboxFallbackReason)}`;
  return `${local}: ${NOT_SANDBOXABLE_REASON}`;
}
