import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ToolDef } from "@ohmymcp/core";
import { safeBaseName } from "./filename.js";
import { renderTool } from "./render.js";
import { fail } from "./schema.js";

export type { GenerateTestsErrorCode } from "./schema.js";
export { GenerateTestsError } from "./schema.js";

/** 테스트 코드를 생성할 때의 옵션. */
export interface GenerateOptions {
  outDir: string;
}

type GeneratedDraft = {
  fileName: string;
  source: string;
};

function createDrafts(tools: ToolDef[]): GeneratedDraft[] {
  const usedNames = new Set<string>();

  return tools.map((tool, index) => {
    const initialName = safeBaseName(typeof tool?.name === "string" ? tool.name : "", index);
    let baseName = initialName;
    for (let occurrence = 2; usedNames.has(baseName); occurrence++) {
      baseName = `${initialName}-${occurrence}`;
    }
    usedNames.add(baseName);

    return {
      fileName: `${baseName}.generated.ts`,
      source: renderTool(tool, index, baseName),
    };
  });
}

/**
 * 도구 스키마마다 Runner의 선언형 suite 파일을 만들고 생성한 절대 경로를 반환한다.
 * 모든 스키마를 먼저 검증하므로 스키마 오류로 일부 파일만 생성되지 않는다.
 */
export async function generateTests(tools: ToolDef[], options: GenerateOptions): Promise<string[]> {
  if (!Array.isArray(tools)) {
    fail(
      "INVALID_TOOL",
      "tools",
      "tools는 ToolDef 배열이어야 합니다.",
      "도구 목록 배열을 전달하세요.",
    );
  }
  if (typeof options?.outDir !== "string" || !/\S/.test(options.outDir)) {
    fail(
      "INVALID_OPTIONS",
      "options.outDir",
      "출력 디렉터리가 비어 있습니다.",
      "생성 파일을 저장할 디렉터리를 지정하세요.",
    );
  }
  if (tools.length === 0) return [];

  const drafts = createDrafts(tools);
  const outDir = resolve(options.outDir);
  const paths = drafts.map(({ fileName }) => join(outDir, fileName));

  await mkdir(outDir, { recursive: true });
  await Promise.all(
    drafts.map(({ source }, index) => writeFile(paths[index] as string, source, "utf8")),
  );
  return paths;
}
