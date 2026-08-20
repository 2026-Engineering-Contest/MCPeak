import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteFile,
  listCassettes,
  listSuites,
  readFileContent,
  writeFileContent,
} from "../src/server/files.js";

const VALID_SUITE = {
  schemaVersion: 1,
  id: "fixture-suite",
  name: "fixture suite",
  defaultTimeoutMs: 10000,
  cases: [
    {
      id: "case-1",
      name: "케이스 1",
      operation: { type: "listTools" },
      assertions: [{ type: "toolExists", tool: "get_weather" }],
    },
  ],
};

const VALID_CASSETTE = { version: 1, interactions: [] };
const readdirControl = vi.hoisted(() => ({ deniedDirectory: "" }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readdir: async (path: string) => {
      if (path === readdirControl.deniedDirectory) {
        const error = new Error("권한이 없습니다.") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }
      return actual.readdir(path, { withFileTypes: true });
    },
  };
});

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mcpeak-dashboard-files-"));
});

afterEach(async () => {
  readdirControl.deniedDirectory = "";
  await rm(root, { recursive: true, force: true });
});

describe("files.ts", () => {
  it("suites 목록이 유효 스위트만 담는다", async () => {
    await writeFile(join(root, "valid.json"), JSON.stringify(VALID_SUITE), "utf8");
    await writeFile(join(root, "invalid.json"), JSON.stringify({ not: "a suite" }), "utf8");

    const entries = await listSuites(root);
    expect(entries).toEqual([{ path: "valid.json" }]);
  });

  it("suites 목록 탐색은 node_modules·.git·dist를 건너뛴다", async () => {
    await writeFile(join(root, "valid.json"), JSON.stringify(VALID_SUITE), "utf8");
    await mkdir(join(root, "node_modules"));
    await writeFile(
      join(root, "node_modules", "also-valid.json"),
      JSON.stringify(VALID_SUITE),
      "utf8",
    );

    const entries = await listSuites(root);
    expect(entries).toEqual([{ path: "valid.json" }]);
  });

  it("읽을 수 없는 디렉터리를 건너뛰고 다른 경로의 유효 스위트를 반환한다", async () => {
    const readableDirectory = join(root, "readable");
    const deniedDirectory = join(root, "denied");
    await mkdir(readableDirectory);
    await mkdir(deniedDirectory);
    await writeFile(join(readableDirectory, "valid.json"), JSON.stringify(VALID_SUITE), "utf8");

    readdirControl.deniedDirectory = deniedDirectory;

    await expect(listSuites(root)).resolves.toEqual([{ path: "readable/valid.json" }]);
  });

  it("cassettes 목록이 카세트만 담는다", async () => {
    await writeFile(join(root, "cassette.json"), JSON.stringify(VALID_CASSETTE), "utf8");
    await writeFile(join(root, "not-cassette.json"), JSON.stringify({ hello: "world" }), "utf8");

    const entries = await listCassettes(root);
    expect(entries).toEqual([{ path: "cassette.json" }]);
  });

  it("mtime이 같으면 저장되고 새 mtime을 준다", async () => {
    const path = join(root, "suite.json");
    await writeFile(path, JSON.stringify(VALID_SUITE), "utf8");
    const before = await readFileContent(root, path);

    const result = await writeFileContent(path, `${JSON.stringify(VALID_SUITE)}\n`, before.mtimeMs);
    expect(result.saved).toBe(true);
    if (result.saved) expect(typeof result.mtimeMs).toBe("number");

    const after = await readFile(path, "utf8");
    expect(after).toBe(`${JSON.stringify(VALID_SUITE)}\n`);
  });

  it("mtime이 다르면 conflict를 주고 파일을 건드리지 않는다", async () => {
    const path = join(root, "suite.json");
    const original = JSON.stringify(VALID_SUITE);
    await writeFile(path, original, "utf8");
    const before = await readFileContent(root, path);
    const bytesBefore = await readFile(path);

    const result = await writeFileContent(path, "{}", before.mtimeMs - 1000);
    expect(result.saved).toBe(false);
    if (!result.saved) expect(result.reason).toBe("conflict");

    const bytesAfter = await readFile(path);
    expect(bytesAfter).toEqual(bytesBefore);
  });

  it("DELETE가 파일을 지우고 204다", async () => {
    const path = join(root, "cassette.json");
    await writeFile(path, JSON.stringify(VALID_CASSETTE), "utf8");

    await deleteFile(path);

    await expect(stat(path)).rejects.toThrow();
  });
});
