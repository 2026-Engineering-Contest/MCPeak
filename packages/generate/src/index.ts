import type { ToolDef } from "@mcptest/core";

/** 테스트 코드를 생성할 때의 옵션. */
export interface GenerateOptions {
  outDir: string;
}

/**
 * 툴 스키마 목록에서 테스트 소스를 생성하고, 생성된 파일 경로를 반환한다.
 *
 * 아직 구현되지 않음 — `generate` 오너가 채운다.
 */
export function generateTests(tools: ToolDef[], options: GenerateOptions): Promise<string[]> {
  throw new Error("not implemented");
}
