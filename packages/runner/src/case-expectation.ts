/**
 * 케이스가 오류 응답을 기대하는지 판독한다.
 *
 * 이 파일은 패키지 내부 전용이다. `index.ts` 로 내보내지 않는다.
 */

import type { TestCaseSpec } from "./spec/types.js";

/**
 * isError 단언이 여러 개이고 expected 가 서로 다르면 null 이다. 그런 명세는 모순이고, 어느
 * 쪽으로 읽어도 틀린다. 모순을 임의로 한쪽으로 해석하면 그 사실이 숨는다.
 * isError 단언이 하나도 없어도 null 이다.
 */
export function expectedIsError(testCase: TestCaseSpec): boolean | null {
  let seen: boolean | null = null;
  for (const assertion of testCase.assertions) {
    if (assertion.type !== "isError") continue;
    if (seen === null) seen = assertion.expected;
    else if (seen !== assertion.expected) return null;
  }
  return seen;
}
