import { sha256 } from "./canonical.js";
import type { TestSuiteSpec } from "./spec/types.js";

/**
 * 승인 지문. approval 블록을 제외한 명세 전체의 sha256 hex 64자다.
 *
 * approval 을 제외하는 이유는 자기참조 회피다. 지문을 파일에 적으면 다음 계산의 대상 안에
 * 지문 자신이 들어가고, 그러면 승인 시점의 값과 절대 같아질 수 없다. 설계 문서 §4.
 *
 * **이 함수 밖에서 명세 지문을 계산하지 마라.** 저장 경로와 실행 경로가 각자 제외 규칙을
 * 구현하면 한쪽만 고쳐졌을 때 지문이 영원히 불일치하고 원인이 안 보인다.
 *
 * 전제: validateMcpSuite 를 통과한 객체를 넘긴다. canonicalJson 은 undefined · 비유한 수 ·
 * 순환 참조 · sparse array 에서 던지는데, 검증을 통과한 명세에는 그것들이 없다.
 */
export function suiteFingerprint(suite: TestSuiteSpec): string {
  const { approval: _approval, ...rest } = suite;
  return sha256(rest);
}
