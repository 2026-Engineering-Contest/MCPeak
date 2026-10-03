import type { McpHttpConnection, McpServerInfo, McpStdioConnection, ToolDef } from "@mcpeak/core";
import { optimize, renderReport } from "@mcpeak/optimize";
import { describe, expect, it, vi } from "vitest";
import { OPTIMIZE_USAGE, OPTIMIZE_USAGE_HINT } from "../src/help.js";
import { nodeOptimizeDependencies } from "../src/index.js";
import {
  type OptimizeCommandDependencies,
  parseOptimizeCommand,
  runOptimizeCommand,
} from "../src/optimize-command.js";
import { parseTestCommand } from "../src/test-command.js";

/**
 * 계획서 §8.6 의 파서 단언과, 서버 없이 확인할 수 있는 실행 경로. 실제 서버를 띄우는 경로는
 * optimize-e2e.test.ts 에 있다.
 */

const TOOLS: ToolDef[] = [
  {
    name: "get_item",
    description: "Fetch one item (https://example.com/docs).",
    inputSchema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: { id: { type: "string" } },
    },
  },
];

type Connection = McpStdioConnection & McpServerInfo;

function fakeConnection(overrides: Partial<McpServerInfo> & { tools?: ToolDef[] } = {}): {
  connection: Connection;
  closed: () => number;
} {
  let closed = 0;
  const connection: Connection = {
    client: {
      listTools: async () => overrides.tools ?? TOOLS,
      callTool: async () => {
        throw new Error("optimize 는 tools/call 을 부르지 않는다");
      },
      close: async () => {},
    },
    getDiagnostics: () => ({ stderr: "", stderrTruncated: false, exitCode: null, signal: null }),
    close: async () => {
      closed += 1;
    },
    forceClose: async () => {},
    instructions: "instructions" in overrides ? overrides.instructions : "Item store.",
    capabilityKeys: overrides.capabilityKeys ?? ["tools"],
  };
  return { connection, closed: () => closed };
}

function harness(connection: Connection, extra: Partial<OptimizeCommandDependencies> = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const files = new Map<string, string>();
  const connectStdio = vi.fn(async () => connection);
  const deps: OptimizeCommandDependencies = {
    connectStdio,
    optimize,
    renderReport,
    generatorVersion: "9.9.9",
    writeFile: async (path, text) => {
      files.set(path, text);
    },
    writeStdout: (text) => stdout.push(text),
    writeStderr: (text) => stderr.push(text),
    ...extra,
  };
  return {
    deps,
    connectStdio,
    files,
    stdout: () => stdout.join(""),
    stderr: () => stderr.join(""),
  };
}

/** `parseTestCommand` 가 같은 대상 인자에 대해 내는 문장. 이 명령이 그것을 그대로 쓰는지 본다. */
function testCommandMessage(targetArgv: readonly string[]): string {
  try {
    parseTestCommand(["suite.json", ...targetArgv]);
  } catch (error) {
    return (error as { failure: { message: string } }).failure.message;
  }
  throw new Error("parseTestCommand 가 이 대상을 받아들였다");
}

describe("parseOptimizeCommand", () => {
  it("--out 이 없으면 CLI_USAGE 와 §7.4 문장", async () => {
    const { deps, stderr, connectStdio } = harness(fakeConnection().connection);

    expect(await runOptimizeCommand(["optimize", "--", "node", "server.mjs"], deps)).toBe(1);

    expect(stderr()).toBe(
      "오류 [CLI_USAGE]: --out <overlay.json> 이 필요합니다. 오버레이를 어디에 쓸지 이 도구는 정하지 않습니다.\n" +
        "해결: mcpeak optimize --out ./server.optimize.json -- <서버 명령>\n",
    );
    // 사용법 오류에서 서버를 띄우지 않는다.
    expect(connectStdio).not.toHaveBeenCalled();
  });

  it("-- 뒤 명령과 --command/--arg 를 함께 쓰면 connect-target 의 기존 문장", async () => {
    const { deps, stderr } = harness(fakeConnection().connection);
    const target = ["--command", "node", "--arg", "a.mjs", "--", "node", "server.mjs"];

    expect(await runOptimizeCommand(["optimize", "--out", "o.json", ...target], deps)).toBe(1);

    const expected = testCommandMessage(target);
    expect(expected).toContain("`--command` 와 `--` 를 함께 쓸 수 없습니다.");
    // 문장은 test 의 것 그대로이고, 해결 줄만 이 명령의 사용법이다.
    expect(stderr()).toBe(`오류 [CLI_USAGE]: ${expected}\n해결: ${OPTIMIZE_USAGE_HINT}\n`);
  });

  it("--url 과 --env 를 함께 쓰면 connect-target 의 기존 문장", async () => {
    const { deps, stderr } = harness(fakeConnection().connection);
    const target = ["--url", "https://mcp.example.com/v1", "--env", "API_KEY"];

    expect(await runOptimizeCommand(["optimize", "--out", "o.json", ...target], deps)).toBe(1);

    const expected = testCommandMessage(target);
    expect(expected).toContain("`--env` 는 `--url` 과 함께 쓸 수 없습니다.");
    expect(stderr()).toBe(`오류 [CLI_USAGE]: ${expected}\n해결: ${OPTIMIZE_USAGE_HINT}\n`);
  });

  it("사용법 문장이 §7.4 와 글자 단위로 같다", () => {
    expect(OPTIMIZE_USAGE).toBe(
      "사용법: mcpeak optimize --out <overlay.json> (-- <executable> [args...] | --command <executable> [--arg <value> ...] [--env <NAME> ...] | --url <URL> [--header-env <헤더이름>=<환경변수이름> ...]) [--json]",
    );
  });

  it("test 전용 옵션은 optimize 이름으로 거절한다", () => {
    for (const option of ["--junit", "--determinism", "--session=s.db"]) {
      expect(() => parseOptimizeCommand(["--out", "o.json", option, "--", "node"])).toThrow(
        `지원하지 않는 optimize 옵션 '${option.split("=")[0]}'입니다.`,
      );
    }
  });

  it("--arg 의 값이 옵션처럼 생겨도 서버 인자로 넘긴다", () => {
    const input = parseOptimizeCommand(["--out", "o.json", "--command", "srv", "--arg", "--junit"]);
    expect(input.target).toMatchObject({ transport: "stdio", command: "srv", args: ["--junit"] });
  });

  it("-- 뒤의 --json 과 --out 은 서버 인자다", () => {
    const input = parseOptimizeCommand(["--out", "o.json", "--", "srv", "--json", "--out", "x"]);
    expect(input).toMatchObject({
      outPath: "o.json",
      json: false,
      target: { transport: "stdio", command: "srv", args: ["--json", "--out", "x"] },
    });
  });
});

describe("runOptimizeCommand", () => {
  it("오버레이를 2칸 들여쓰기 JSON 과 끝 개행으로 쓰고 리포트를 stdout 에 낸다", async () => {
    const fake = fakeConnection();
    const { deps, files, stdout, stderr } = harness(fake.connection);

    expect(await runOptimizeCommand(["optimize", "--out", "o.json", "--", "srv"], deps)).toBe(0);

    const overlay = optimize(
      { tools: TOOLS, instructions: "Item store.", otherCapabilities: [] },
      "9.9.9",
    );
    expect(files.get("o.json")).toBe(`${JSON.stringify(overlay, null, 2)}\n`);
    expect(stdout()).toBe(renderReport(overlay));
    expect(stderr()).toBe("");
    // 도구 목록을 읽은 뒤 서버를 닫는다.
    expect(fake.closed()).toBe(1);
  });

  it("--json 이면 stdout 이 파일과 같은 오버레이 JSON 하나다", async () => {
    const { deps, files, stdout } = harness(fakeConnection().connection);

    expect(
      await runOptimizeCommand(["optimize", "--out", "o.json", "--json", "--", "srv"], deps),
    ).toBe(0);

    expect(stdout()).toBe(files.get("o.json"));
    expect(JSON.parse(stdout())).toMatchObject({ schemaVersion: 1 });
  });

  it("instructions 가 없으면 빈 문자열로, tools 외 능력은 네 종류만 기록한다", async () => {
    const { deps, files } = harness(
      fakeConnection({
        instructions: undefined,
        capabilityKeys: ["experimental", "logging", "prompts", "resources", "tools"],
      }).connection,
    );

    expect(await runOptimizeCommand(["optimize", "--out", "o.json", "--", "srv"], deps)).toBe(0);

    const overlay = JSON.parse(files.get("o.json") as string);
    expect(overlay.source.instructions).toBe("");
    expect(overlay.source.otherCapabilities).toEqual(["logging", "prompts", "resources"]);
  });

  it("게이트 A 가 실패하면 §7.1 문장을 내고 파일을 쓰지 않는다", async () => {
    const { OptimizeError } = await import("@mcpeak/optimize");
    const block =
      "→ 압축 결과가 원본과 다른 입력을 받게 됩니다. 이것은 mcpeak optimize 의 결함입니다.";
    const { deps, files, stdout, stderr } = harness(fakeConnection().connection, {
      optimize: () => {
        throw new OptimizeError("LOSSLESS_VIOLATION", block);
      },
    });

    expect(await runOptimizeCommand(["optimize", "--out", "o.json", "--", "srv"], deps)).toBe(1);

    expect(stderr()).toBe(`오류 [LOSSLESS_VIOLATION]: 오버레이를 쓰지 않았습니다.\n${block}\n`);
    expect(files.size).toBe(0);
    expect(stdout()).toBe("");
  });

  it("파일을 쓰지 못하면 경로와 원인 코드를 말하고 stdout 에 아무것도 내지 않는다", async () => {
    const { deps, stdout, stderr } = harness(fakeConnection().connection, {
      writeFile: async () => {
        throw Object.assign(new Error("no such dir"), { code: "ENOENT" });
      },
    });

    expect(await runOptimizeCommand(["optimize", "--out", "no/o.json", "--", "srv"], deps)).toBe(1);

    expect(stderr()).toBe(
      "오류 [OVERLAY_WRITE_FAILED]: 오버레이 파일을 쓰지 못했습니다 (ENOENT). 경로: no/o.json\n" +
        "해결: `--out` 경로의 디렉터리가 있는지와 쓰기 권한을 확인하세요.\n",
    );
    expect(stdout()).toBe("");
  });

  it("--url 대상은 connectHttp 로 붙고 그 서버 정보를 쓴다", async () => {
    const fake = fakeConnection({ instructions: "Remote." });
    const remote: McpHttpConnection & McpServerInfo = {
      client: fake.connection.client,
      getDiagnostics: () => ({
        url: "https://mcp.example.com/v1",
        status: 200,
        statusText: "OK",
        sessionId: null,
      }),
      close: async () => {},
      instructions: fake.connection.instructions,
      capabilityKeys: fake.connection.capabilityKeys,
    };
    const connectHttp = vi.fn(async () => remote);
    const { deps, files, connectStdio } = harness(fake.connection, { connectHttp });

    expect(
      await runOptimizeCommand(
        ["optimize", "--out", "o.json", "--url", "https://mcp.example.com/v1"],
        deps,
      ),
    ).toBe(0);

    expect(connectStdio).not.toHaveBeenCalled();
    expect(connectHttp).toHaveBeenCalledWith({ url: "https://mcp.example.com/v1" });
    expect(JSON.parse(files.get("o.json") as string).source.instructions).toBe("Remote.");
  });
});

describe("nodeOptimizeDependencies", () => {
  it("core 의 두 연결 함수와 optimize 의 두 함수, 환경 읽기를 배선한다", async () => {
    const [core, optimizePackage] = await Promise.all([
      import("@mcpeak/core"),
      import("@mcpeak/optimize"),
    ]);
    const deps = nodeOptimizeDependencies(core, optimizePackage);

    expect(deps.connectStdio).toBe(core.connectStdio);
    expect(deps.connectHttp).toBe(core.connectHttp);
    expect(deps.optimize).toBe(optimizePackage.optimize);
    expect(deps.renderReport).toBe(optimizePackage.renderReport);
    expect(deps.readEnv).toBeTypeOf("function");
    // generator 는 @mcpeak/optimize 이므로 그 패키지의 버전이어야 한다. cli 버전이 아니다.
    const { default: optimizeMetadata } = await import("../../optimize/package.json");
    expect(deps.generatorVersion).toBe(optimizeMetadata.version);
  });
});
