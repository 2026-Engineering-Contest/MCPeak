import type { ToolResult } from "@ohmymcp/core";

/** 녹화된 상호작용의 묶음. 매칭 키 · 비결정 필드 처리는 ADR-0003 에서 결정한다. */
export interface Cassette {
  version: number;
  interactions: unknown[];
}

export interface RecordOptions {
  path: string;
}

/**
 * 상호작용을 카세트로 녹화한다.
 * 아직 구현되지 않음 — `record` 오너가 채운다.
 */
export function record(options: RecordOptions): Promise<Cassette> {
  throw new Error("not implemented");
}

/**
 * 카세트를 재생한다.
 * 아직 구현되지 않음 — `record` 오너가 채운다.
 */
export function replay(cassette: Cassette): Promise<void> {
  throw new Error("not implemented");
}

/**
 * 툴 결과(`raw` 기준)를 계약 스냅샷으로 만든다.
 * 아직 구현되지 않음 — `record` 오너가 채운다.
 */
export function snapshotContract(result: ToolResult): unknown {
  throw new Error("not implemented");
}
