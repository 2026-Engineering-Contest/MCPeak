import type { AdvertiseOptions, McpClient, McpServerInfo, McpServerSurface } from "@mcpeak/core";
import type { AuditOptions, AuditReport, AuditTarget } from "./types.js";

/** `audit` 가 쓰는 연결. core 의 connectStdio·connectHttp 결과가 이 꼴을 만족한다. */
export type AuditConnection = McpServerInfo &
  McpServerSurface & {
    readonly client: McpClient;
    close(): Promise<void>;
  };

/** 바깥 세계와 닿는 모든 것. 테스트는 인메모리로 바꿔 끼운다. 시계(now)는 두지 않는다(결정론). */
export interface AuditDependencies {
  connect(
    target: AuditTarget,
    env: Readonly<Record<string, string>>,
    advertise: AdvertiseOptions,
  ): Promise<AuditConnection>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, text: string): Promise<void>;
  readonly fetch: typeof globalThis.fetch;
  random(): string;
}

export async function audit(
  _options: AuditOptions,
  _deps: AuditDependencies,
): Promise<AuditReport> {
  throw new Error("not implemented");
}
