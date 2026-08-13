import type { ToolDef } from "@ohmymcp/core";
import type { TestSuiteSpec } from "./spec/types.js";
import type { SpecFindingsResult } from "./spec-findings.js";

export interface InputContractOptions {
  readonly suite: TestSuiteSpec;
  /** McpClient.listTools()의 결과를 그대로 넘긴다. 순서는 결과에 영향을 주지 않는다. */
  readonly tools: readonly ToolDef[];
}

/**
 * 명세의 callTool 입력을 서버가 선언한 inputSchema와 대조한다. 서버를 호출하지 않는다.
 * 해석하지 못하는 스키마는 SCHEMA_NOT_ANALYZABLE 하나만 내고 그 툴의 다른 검사를 전부 건너뛴다.
 *
 * 아직 구현하지 않았다. 설계 문서 §4 · §5.1~§5.6 · §9 가 Task T2 에서 채워진다.
 */
export function checkInputContract(options: InputContractOptions): SpecFindingsResult {
  throw new Error("not implemented");
}
