import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listServerCandidates,
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
});

describe("listServerCandidates", () => {
  it(".mcp.json 의 mcpServers 항목이 command·args 그대로 후보가 된다", async () => {
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: { weather: { command: "node", args: ["server.mjs", "--port", "0"] } },
      }),
      "utf8",
    );

    const candidates = await listServerCandidates(root);
    expect(candidates).toEqual([
      {
        id: "mcp-config:.mcp.json:weather",
        name: "weather",
        command: "node",
        args: ["server.mjs", "--port", "0"],
        source: "mcp-config",
        path: ".mcp.json",
        hasEnv: false,
      },
    ]);
  });

  it("args 가 없으면 빈 배열이고 문자열 배열이 아니면 그 항목은 제외된다", async () => {
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          "a-no-args": { command: "weather-server" },
          "b-args-string": { command: "node", args: "server.mjs" },
          "c-args-mixed": { command: "node", args: ["server.mjs", 3] },
        },
      }),
      "utf8",
    );

    const candidates = await listServerCandidates(root);
    expect(candidates.map((candidate) => [candidate.name, candidate.args])).toEqual([
      ["a-no-args", []],
    ]);
  });

  it("url 만 있는 항목은 제외된다", async () => {
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          remote: { url: "https://example.test/mcp" },
          local: { command: "node", args: ["server.mjs"] },
        },
      }),
      "utf8",
    );

    const candidates = await listServerCandidates(root);
    expect(candidates.map((candidate) => candidate.name)).toEqual(["local"]);
  });

  it("env 가 비어 있지 않으면 hasEnv 가 true 다", async () => {
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          "with-env": { command: "node", args: ["server.mjs"], env: { API_KEY: "x" } },
          "empty-env": { command: "node", args: ["server.mjs"], env: {} },
          "no-env": { command: "node", args: ["server.mjs"] },
        },
      }),
      "utf8",
    );

    const candidates = await listServerCandidates(root);
    expect(candidates.map((candidate) => [candidate.name, candidate.hasEnv])).toEqual([
      ["empty-env", false],
      ["no-env", false],
      ["with-env", true],
    ]);
  });

  it("package.json 의 bin 이 문자열이면 name 필드가 이름이고 경로는 루트 기준 / 구분이다", async () => {
    const packageDirectory = join(root, "examples", "weather-server");
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(
      join(packageDirectory, "package.json"),
      JSON.stringify({ name: "example-weather-server", bin: "./server.mjs" }),
      "utf8",
    );

    const candidates = await listServerCandidates(root);
    expect(candidates).toEqual([
      {
        id: "package-bin:examples/weather-server/package.json:example-weather-server",
        name: "example-weather-server",
        command: "node",
        args: ["examples/weather-server/server.mjs"],
        source: "package-bin",
        path: "examples/weather-server/package.json",
        hasEnv: false,
      },
    ]);
  });

  it("package.json 의 bin 이 객체면 키마다 후보가 된다", async () => {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "tools",
        bin: { "mcpeak-mock": "./dist/stdio.mjs", mcpeak: "./bin/cli.mjs" },
      }),
      "utf8",
    );

    const candidates = await listServerCandidates(root);
    expect(candidates.map((candidate) => candidate.name)).toEqual(["mcpeak", "mcpeak-mock"]);
    expect(candidates.map((candidate) => candidate.args)).toEqual([
      ["bin/cli.mjs"],
      ["dist/stdio.mjs"],
    ]);
  });

  it("bin 이 .js·.mjs·.cjs 면 command 가 node 이고 경로가 args 선두다", async () => {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "entries",
        bin: { a: "./a.js", b: "./b.mjs", c: "./c.cjs" },
      }),
      "utf8",
    );

    const candidates = await listServerCandidates(root);
    expect(candidates.map((candidate) => [candidate.command, candidate.args])).toEqual([
      ["node", ["a.js"]],
      ["node", ["b.mjs"]],
      ["node", ["c.cjs"]],
    ]);
  });

  it("bin 이 확장자 없는 실행 파일이면 command 가 그 경로이고 args 가 비어 있다", async () => {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "shell-entry", bin: { "shell-server": "./bin/shell-server" } }),
      "utf8",
    );

    const candidates = await listServerCandidates(root);
    expect(candidates).toEqual([
      {
        id: "package-bin:package.json:shell-server",
        name: "shell-server",
        command: "bin/shell-server",
        args: [],
        source: "package-bin",
        path: "package.json",
        hasEnv: false,
      },
    ]);
  });

  it("bin 이 없는 package.json 은 후보를 만들지 않는다", async () => {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "no-bin", version: "1.0.0" }),
      "utf8",
    );

    await expect(listServerCandidates(root)).resolves.toEqual([]);
  });

  it("node_modules·.git·dist 아래는 보지 않는다", async () => {
    const config = JSON.stringify({ mcpServers: { hidden: { command: "node" } } });
    for (const directory of ["node_modules", ".git", "dist"]) {
      await mkdir(join(root, directory));
      await writeFile(join(root, directory, ".mcp.json"), config, "utf8");
    }
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify({ mcpServers: { visible: { command: "node" } } }),
      "utf8",
    );

    const candidates = await listServerCandidates(root);
    expect(candidates.map((candidate) => candidate.name)).toEqual(["visible"]);
  });

  it("깨진 JSON 은 조용히 건너뛴다", async () => {
    await writeFile(join(root, ".mcp.json"), "{ not json", "utf8");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "ok", bin: "./cli.mjs" }),
      "utf8",
    );

    const candidates = await listServerCandidates(root);
    expect(candidates.map((candidate) => candidate.name)).toEqual(["ok"]);
  });

  it("정렬은 path 다음 name 이며 파일 안 키 순서와 무관하다", async () => {
    // 키 순서를 일부러 뒤집어 둔다. 정렬이 없으면 파일의 키 순서가 그대로 새어 나온다.
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: { zebra: { command: "node" }, alpha: { command: "node" } },
      }),
      "utf8",
    );
    await mkdir(join(root, "sub"));
    await writeFile(
      join(root, "sub", ".mcp.json"),
      JSON.stringify({
        mcpServers: { delta: { command: "node" }, beta: { command: "node" } },
      }),
      "utf8",
    );

    const candidates = await listServerCandidates(root);
    expect(candidates.map((candidate) => [candidate.path, candidate.name])).toEqual([
      [".mcp.json", "alpha"],
      [".mcp.json", "zebra"],
      ["sub/.mcp.json", "beta"],
      ["sub/.mcp.json", "delta"],
    ]);
  });

  it("id 는 source:path:name 이다", async () => {
    await mkdir(join(root, "sub"));
    await writeFile(
      join(root, "sub", ".mcp.json"),
      JSON.stringify({ mcpServers: { weather: { command: "node" } } }),
      "utf8",
    );
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "root-pkg", bin: "./cli.mjs" }),
      "utf8",
    );

    const candidates = await listServerCandidates(root);
    expect(candidates.map((candidate) => candidate.id)).toEqual([
      "package-bin:package.json:root-pkg",
      "mcp-config:sub/.mcp.json:weather",
    ]);
  });
});
