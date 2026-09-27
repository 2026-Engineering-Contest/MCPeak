import type { TestCaseResult } from "./executor.js";

/**
 * 거절을 기대한 케이스에 서버가 정상 응답했는가. 보고서만 본다.
 * isError 단언 중 실패했고, 진단 코드가 IS_ERROR_MISMATCH 이며, 진단의 expected 가 true,
 * actual 이 false 인 것이 하나라도 있으면 true 다. 호출이 던졌거나 시간 초과면 false 다.
 *
 * 명세와 응답에서 다시 계산하지 않는다. 소비자(cli)가 이미 보고서를 들고 있고, 같은 사실을
 * 두 곳에서 계산하면 두 판정이 갈릴 수 있다(설계 §3.2).
 */
export function rejectionAccepted(result: TestCaseResult): boolean {
  return result.assertions.some(
    (assertion) =>
      assertion.spec.type === "isError" &&
      assertion.status === "failed" &&
      assertion.diagnostic?.code === "IS_ERROR_MISMATCH" &&
      assertion.diagnostic.expected === true &&
      assertion.diagnostic.actual === false,
  );
}
