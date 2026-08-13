import type { TestSuiteSpec } from "./spec/types.js";
import type { SpecFindingsResult } from "./spec-findings.js";

/**
 * 통과가 보장된 단언을 찾는다. 명세만 보고 판정하며 서버도 tools도 필요하지 않다.
 *
 * 아직 구현하지 않았다. 설계 문서 §5.7 이 Task T3 에서 채워진다.
 */
export function checkAssertionSubstance(suite: TestSuiteSpec): SpecFindingsResult {
  throw new Error("not implemented");
}
