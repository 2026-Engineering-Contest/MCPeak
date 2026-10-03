import type { CollectedString, SandboxOptions } from "../types.js";

/** 선언된 목적지 목록. 소문자, 중복 제거, 정렬. 본문은 T3 가 채운다. */
export function extractDeclaredHosts(input: {
  readonly allowHosts: readonly string[];
  readonly surfaceStrings: readonly CollectedString[];
  readonly declarationTexts: SandboxOptions["declarationTexts"];
}): readonly string[] {
  throw new Error("not implemented");
}
