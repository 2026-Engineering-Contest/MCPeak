import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { validateMcpSuite } from "@mcpeak/runner";
import type { FileContent, FileEntry, PutFileResponse, ServerCandidate } from "../api-types.js";

const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist"]);

/** 루트 아래 파일 중 `accept`가 참인 것의 절대경로. 제외 디렉터리는 내려가지 않는다. */
async function walkFiles(dir: string, accept: (name: string) => boolean): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (entries === null) return [];
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      results.push(...(await walkFiles(join(dir, entry.name), accept)));
      continue;
    }
    if (entry.isFile() && accept(entry.name)) {
      results.push(join(dir, entry.name));
    }
  }
  return results;
}

/** 루트 아래 `.json` 파일 절대경로 전부. */
function walkJsonFiles(dir: string): Promise<string[]> {
  return walkFiles(dir, (name) => name.toLowerCase().endsWith(".json"));
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

const NODE_ENTRY_EXTENSIONS = [".js", ".mjs", ".cjs"];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** `.mcp.json` 의 `mcpServers` 를 후보로 옮긴다. 형이 어긋나는 항목은 조용히 제외한다. */
function mcpConfigCandidates(parsed: unknown, path: string): ServerCandidate[] {
  const servers = asRecord(asRecord(parsed)?.mcpServers);
  if (servers === null) return [];
  const results: ServerCandidate[] = [];
  for (const [name, raw] of Object.entries(servers)) {
    const entry = asRecord(raw);
    if (entry === null) continue;
    // `url` 만 있는 원격 항목은 `command` 가 없어 여기서 걸러진다.
    if (!isNonEmptyString(entry.command)) continue;
    let args: string[] = [];
    if (entry.args !== undefined) {
      if (!Array.isArray(entry.args) || !entry.args.every((item) => typeof item === "string")) {
        continue;
      }
      args = [...(entry.args as string[])];
    }
    const env = asRecord(entry.env);
    results.push({
      id: `mcp-config:${path}:${name}`,
      name,
      command: entry.command,
      args,
      source: "mcp-config",
      path,
      hasEnv: env !== null && Object.keys(env).length > 0,
    });
  }
  return results;
}

/**
 * `package.json` 의 `bin` 을 후보로 옮긴다. 확장자가 `.js`·`.mjs`·`.cjs` 면 `node` 로 띄우고,
 * 그 밖은 파일 자체를 실행 파일로 본다. 무엇으로 띄울지는 파일을 실행하지 않고 정한다(ADR-0079).
 */
function packageBinCandidates(
  parsed: unknown,
  path: string,
  root: string,
  absolute: string,
): ServerCandidate[] {
  const pkg = asRecord(parsed);
  if (pkg === null || pkg.bin === undefined) return [];
  const packageName = isNonEmptyString(pkg.name) ? pkg.name : basename(dirname(absolute));
  const entries: [string, unknown][] =
    typeof pkg.bin === "string"
      ? [[packageName, pkg.bin]]
      : Object.entries(asRecord(pkg.bin) ?? {});
  const results: ServerCandidate[] = [];
  for (const [name, target] of entries) {
    if (!isNonEmptyString(target)) continue;
    const relativeTarget = toRelative(root, resolve(dirname(absolute), target));
    const runsOnNode = NODE_ENTRY_EXTENSIONS.some((extension) =>
      relativeTarget.toLowerCase().endsWith(extension),
    );
    results.push({
      id: `package-bin:${path}:${name}`,
      name,
      command: runsOnNode ? "node" : relativeTarget,
      args: runsOnNode ? [relativeTarget] : [],
      source: "package-bin",
      path,
      hasEnv: false,
    });
  }
  return results;
}

/**
 * 루트 아래 `.mcp.json` 과 `package.json` 에서만 서버 후보를 읽는다. 목록을 만들려고
 * 사용자 코드를 실행하지 않는다(ADR-0079). 정렬은 `path` 다음 `name` 이라 파일 안의 키
 * 순서가 결과에 영향을 주지 않는다.
 */
export async function listServerCandidates(root: string): Promise<ServerCandidate[]> {
  const files = await walkFiles(root, (name) => name === ".mcp.json" || name === "package.json");
  const results: ServerCandidate[] = [];
  for (const absolute of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(absolute, "utf8"));
    } catch {
      // 무효 JSON·읽기 실패는 조용히 제외한다(`listSuites` 와 같은 정책).
      continue;
    }
    const path = toRelative(root, absolute);
    results.push(
      ...(basename(absolute) === ".mcp.json"
        ? mcpConfigCandidates(parsed, path)
        : packageBinCandidates(parsed, path, root, absolute)),
    );
  }
  return results.sort((a, b) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name));
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
