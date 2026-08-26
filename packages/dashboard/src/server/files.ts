import { mkdir, open, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { validateMcpSuite } from "@mcpeak/runner";
import type {
  FileContent,
  FileEntry,
  PutFileResponse,
  ServerCandidate,
  SessionEntry,
} from "../api-types.js";

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

const MCP_SDK_PACKAGE = "@modelcontextprotocol/sdk";

/**
 * MCP SDK 를 직접 의존하는 패키지인지 본다. `bin` 은 "실행 진입점" 이지 "MCP 서버" 라는 뜻이
 * 아니라, 이 저장소만 해도 CLI 와 대시보드의 `bin` 이 함께 잡힌다. 그것을 서버로 고르면 CLI 가
 * CLI 에 붙으려 하고, 대시보드는 포트를 잡은 채 응답 없이 걸린다. 서버인지는 띄워 봐야 알지만
 * 그것은 금지이므로(ADR-0079), 이미 읽은 파일 한 장에서 가장 잘 갈리는 신호를 쓴다.
 */
function dependsOnMcpSdk(pkg: Record<string, unknown>): boolean {
  return ["dependencies", "peerDependencies"].some((field) => {
    const dependencies = asRecord(pkg[field]);
    return dependencies !== null && MCP_SDK_PACKAGE in dependencies;
  });
}

/**
 * `package.json` 의 `bin` 을 후보로 옮긴다. 확장자가 `.js`·`.mjs`·`.cjs` 면 `node` 로 띄우고,
 * 그 밖은 파일 자체를 실행 파일로 본다. 무엇으로 띄울지는 파일을 실행하지 않고 정한다(ADR-0079).
 * MCP SDK 를 직접 의존하지 않는 패키지는 후보로 올리지 않는다(`dependsOnMcpSdk`).
 */
function packageBinCandidates(
  parsed: unknown,
  path: string,
  root: string,
  absolute: string,
): ServerCandidate[] {
  const pkg = asRecord(parsed);
  if (pkg === null || pkg.bin === undefined || !dependsOnMcpSdk(pkg)) return [];
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

/**
 * `@mcpeak/record/external` 은 **녹화본을 실제로 읽을 때만** 부른다.
 *
 * 정적 import 로 두면 `node:sqlite` 가 대시보드를 띄우는 것만으로 로드되고, Node 22.x 는
 * 그때 `ExperimentalWarning` 을 stderr 에 찍는다. CLI 가 같은 이유로 지연 로딩을 택했다
 * (`cli/src/external-wiring.ts`). Replay 를 열지 않는 사용자는 그 비용을 내지 않는다.
 */
const loadExternal = () => import("@mcpeak/record/external");

/** SQLite 파일의 첫 16바이트. 이 값으로 후보를 좁힌 뒤에야 파일을 DB 로 연다. */
const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "utf8");

/**
 * 첫 16바이트가 SQLite 헤더인지 본다. **DB 로 열기 전에 거르는 것이 요점이다** — 세션은
 * 확장자가 정해져 있지 않아(`--record-session <path>` 는 임의 경로를 받는다) 루트 아래
 * 모든 파일이 후보이고, 그것을 전부 `DatabaseSync` 로 열어 보는 것은 너무 비싸다.
 */
async function hasSqliteHeader(absolute: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(absolute, "r");
    const buffer = Buffer.alloc(SQLITE_MAGIC.length);
    const { bytesRead } = await handle.read(buffer, 0, SQLITE_MAGIC.length, 0);
    return bytesRead === SQLITE_MAGIC.length && buffer.equals(SQLITE_MAGIC);
  } catch {
    // 못 여는 파일은 후보가 아니다(`listSuites` 와 같은 정책).
    return false;
  } finally {
    await handle?.close();
  }
}

/**
 * 루트 아래 녹화본 목록. **우리 세션인지는 `loadSession` 이 판정한다** — 열 이름이 같아도
 * store_version 이 다른 파일은 우리 것이 아니고, 그 규칙은 record 안에 있어야 한다.
 * 여기서 스키마를 읽기 시작하면 마이그레이션의 자유가 사라진다.
 *
 * 못 읽는 파일은 조용히 제외한다(`listSuites` 와 같은 정책). 녹화가 끝나지 않은 세션은
 * **제외하지 않는다** — 재생은 거절되지만(`REPLAY_SOURCE_INVALID`), 목록에서 빼면 사용자는
 * 파일이 있는데 왜 안 보이는지 알 수 없다. 담되 `status` 로 가른다.
 */
export async function listSessions(root: string): Promise<SessionEntry[]> {
  const candidates = await walkFiles(root, () => true);
  const { loadSession } = await loadExternal();
  const results: SessionEntry[] = [];
  for (const absolute of candidates) {
    if (!(await hasSqliteHeader(absolute))) continue;
    const snapshot = loadSession(absolute);
    if (snapshot === null) continue;
    // `interactions` 는 ordinal 순이므로 첫 항목이 가장 먼저 녹화된 것이다(ADR-0069).
    // 없는 것을 지금 시각으로 채우지 않는다 — 채우면 같은 세션이 볼 때마다 달라진다.
    const first = snapshot.interactions[0];
    results.push({
      path: toRelative(root, absolute),
      status: snapshot.status,
      interactionCount: snapshot.interactions.length,
      ...(first === undefined ? {} : { recordedAt: first.recordedAt }),
      // 세션에 저장된 녹화 출처(ADR-0085). v1 세션에는 없고, 없으면 필드도 없다.
      ...(snapshot.origin === undefined ? {} : { origin: snapshot.origin }),
    });
  }
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

/** 프론트의 REPAIR_BUNDLE_DIR 와 같은 값. 두 곳에 있는 이유는 web 이 src 를 import 하지 않기 때문이다. */
export const REPAIR_BUNDLE_DIR = ".mcpeak/repair";

/**
 * `<root>/.mcpeak/repair/` 를 만들고 `<root>/.mcpeak/.gitignore` 가 없으면 `*\n` 을 쓴다.
 * 멱등이다. 실패는 던진다(호출부가 실행을 시작하지 않고 500 으로 옮긴다).
 *
 * 루트 `.gitignore` 를 고치지 않는 이유는 대시보드가 어느 저장소에서 떠도 사용자 저장소의
 * 파일을 건드리지 않기 위해서다. 자기 디렉터리 안에 자기 규칙을 둔다(ADR-0080). `*` 는 이
 * `.gitignore` 자신도 무시하므로 `.mcpeak/` 아래가 통째로 추적되지 않는다.
 */
export async function ensureRepairBundleDir(root: string): Promise<void> {
  await mkdir(join(root, REPAIR_BUNDLE_DIR), { recursive: true });
  try {
    // `wx`: 없을 때만 만든다. 이미 있으면 사용자가 고쳤을 수 있으므로 내용을 보지 않고 둔다.
    await writeFile(join(root, ".mcpeak", ".gitignore"), "*\n", { flag: "wx" });
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
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
