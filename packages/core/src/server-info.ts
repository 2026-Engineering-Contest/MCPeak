import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

export interface McpServerInfo {
  /** 서버가 initialize 응답에 실은 instructions. 없으면 undefined. */
  readonly instructions: string | undefined;
  /** 서버가 광고한 능력의 키를 정렬한 목록. 예: ["resources", "tools"]. */
  readonly capabilityKeys: readonly string[];
}

/** 순수 함수. SDK Client 에서 읽기만 한다. 인메모리 트랜스포트로 단언할 수 있게 분리했다. */
export function readServerInfo(sdk: Client): McpServerInfo {
  return {
    instructions: sdk.getInstructions(),
    capabilityKeys: Object.keys(sdk.getServerCapabilities() ?? {}).sort(),
  };
}
