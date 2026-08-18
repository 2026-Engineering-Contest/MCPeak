import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { loadCassette } from "@ohmymcp-hsu/record";
import { validateMcpSuite } from "@ohmymcp-hsu/runner";
import type { FileContent, FileEntry, PutFileResponse } from "../api-types.js";

const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist"]);

/** 루트 아래 `.json` 파일 절대경로 전부. 제외 디렉터리는 내려가지 않는다. */
async function walkJsonFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      results.push(...(await walkJsonFiles(join(dir, entry.name))));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
      results.push(join(dir, entry.name));
    }
  }
  return results;
}

/** OS 구분자와 무관하게 항상 `/`로 이어진 상대경로를 준다. */
function toRelative(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join("/");
}

/** `**\/*.json` 중 `validateMcpSuite`를 통과하는 파일만 목록에 담는다. */
export async function listSuites(root: string): Promise<FileEntry[]> {
  const files = await walkJsonFiles(root);
  const results: FileEntry[] = [];
  for (const absolute of files) {
    try {
      const parsed: unknown = JSON.parse(await readFile(absolute, "utf8"));
      if (validateMcpSuite(parsed).valid) results.push({ path: toRelative(root, absolute) });
    } catch {
      // 무효 JSON·읽기 실패는 조용히 제외한다. 목록은 유효한 것만 보여준다.
    }
  }
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

/** `loadCassette`가 null이 아닌 파일만 담는다. */
export async function listCassettes(root: string): Promise<FileEntry[]> {
  const files = await walkJsonFiles(root);
  const results: FileEntry[] = [];
  for (const absolute of files) {
    try {
      if ((await loadCassette(absolute)) !== null)
        results.push({ path: toRelative(root, absolute) });
    } catch {
      // 읽기 실패는 조용히 제외한다.
    }
  }
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

/** 파일을 읽어 `FileContent`로 준다. 파일이 없으면 던진다(호출부가 404로 옮긴다). */
export async function readFileContent(root: string, absolute: string): Promise<FileContent> {
  const [content, stats] = await Promise.all([readFile(absolute, "utf8"), stat(absolute)]);
  return { path: toRelative(root, absolute), content, mtimeMs: stats.mtimeMs };
}

/**
 * mtime이 기대값과 다르면 파일을 건드리지 않고 `conflict`를 준다. 파일이 아직 없으면
 * (신규 저장) 충돌이 아니라고 본다.
 */
export async function writeFileContent(
  absolute: string,
  content: string,
  baseMtimeMs: number,
): Promise<PutFileResponse> {
  const currentMtimeMs = await stat(absolute)
    .then((stats) => stats.mtimeMs)
    .catch(() => baseMtimeMs);
  if (currentMtimeMs !== baseMtimeMs) {
    return { saved: false, reason: "conflict", mtimeMs: currentMtimeMs };
  }
  await writeFile(absolute, content, "utf8");
  const stats = await stat(absolute);
  return { saved: true, mtimeMs: stats.mtimeMs };
}

/** 파일이 없으면 던진다(호출부가 404로 옮긴다). */
export async function deleteFile(absolute: string): Promise<void> {
  await rm(absolute);
}
