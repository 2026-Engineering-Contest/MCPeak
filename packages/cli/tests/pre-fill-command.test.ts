import type { McpStdioConnection, ToolDef, ToolResult } from "@ohmymcp-hsu/core";
import {
  applyAuthoringChanges,
  createAuthoringDiff,
  createAuthoringSession,
  createBaselineSuite,
  dispatchAuthoringRequest,
  dispatchPreFillRequest,
  finalizeAuthoringDraft,
  getAuthoringExecutionSuite,
  type PreFillProvider,
  prepareAuthoringRequest,
  preparePreFillRequest,
  previewPreFillRequest,
  reviewLocalAuthoringCandidate,
} from "@ohmymcp-hsu/generate";
import type { JsonObject } from "@ohmymcp-hsu/runner";
import { validateMcpSuite } from "@ohmymcp-hsu/runner";
import { describe, expect, it, vi } from "vitest";
import type { GenerateCommandDependencies, ReviewIO } from "../src/generate-command.js";
import { runGenerateCommand } from "../src/generate-command.js";

/** `timezone` 만 근거가 없다. 실측의 `mcp-server-time` 이 이 모양이었다. */
const needsHelp: ToolDef = {
  name: "needs_help",
  inputSchema: {
    type: "object",
    required: ["timezone"],
    properties: { timezone: { type: "string" } },
  },
};

/** 전 필드가 근거 있는 값이다. 사전보완 대상이 아니다. */
const allDeclared: ToolDef = {
  name: "all_declared",
  inputSchema: {
    type: "object",
    required: ["url"],
    properties: { url: { type: "string", format: "uri" } },
  },
};

/** 표 밖 format 이라 AI 없이는 채울 수 없다. */
const unknownFormatTool: ToolDef = {
  name: "lookup_host",
  inputSchema: {
    type: "object",
    required: ["pointer"],
    properties: { pointer: { type: "string", format: "json-pointer" } },
  },
};

/** `isError` 를 빼면 단언이 `undefined !== false` 로 실패해 두 회차가 다 실패로 보인다. */
const ok = (): ToolResult => ({ content: [{ type: "text", text: "ok" }], isError: false, raw: {} });
const failed = (): ToolResult => ({
  content: [{ type: "text", text: "no" }],
  isError: true,
  raw: {},
});

/**
 * `timezone` 이 `example` 이면 실패하고 그 밖이면 통과하는 서버. 실측에서 AI 층이 필요했던
 * 상황(`description` 에만 IANA 이름이라 적힌 필드)을 그대로 재현한다.
 */
function fakeConnection(events: string[]): McpStdioConnection {
  return {
    client: {
      listTools: vi.fn(async () => [needsHelp]),
      callTool: vi.fn(async (_name: string, input: JsonObject) => {
        events.push(`callTool:${JSON.stringify(input)}`);
        return input.timezone === "example" ? failed() : ok();
      }),
      close: vi.fn(),
    } as never,
    getDiagnostics: vi.fn(),
    close: vi.fn(async () => undefined),
    forceClose: vi.fn(async () => undefined),
  } as never;
}

const reviewIO = (interactive: boolean, lines: string[]): ReviewIO => ({
  interactive,
  input: vi.fn(async () => ""),
  // 사전보완은 검토 메뉴 앞에서 돈다. 메뉴에 닿으면 바로 빠져나온다.
  choose: vi.fn(async () => "cancel"),
  confirm: vi.fn(async () => true),
  write: (text) => lines.push(text),
});

function deps(options: {
  readonly tools: readonly ToolDef[];
  readonly provider?: PreFillProvider;
  readonly connection?: McpStdioConnection;
  readonly io?: ReviewIO;
  readonly stdout?: string[];
  readonly sessionSpy?: typeof createAuthoringSession;
}): GenerateCommandDependencies {
  const stdout = options.stdout ?? [];
  let written = "{}";
  return {
    connect: vi.fn(async () => options.connection ?? (fakeConnection([]) as never)),
    createBaselineSuite: (tools, suiteOptions) => createBaselineSuite(tools, suiteOptions),
    createAuthoringSession: options.sessionSpy ?? createAuthoringSession,
    finalizeAuthoringDraft,
    getAuthoringExecutionSuite,
    // 검토 메뉴는 이 넷이 다 있어야 열린다. 사전보완은 그 앞에서 도는지 보는 것이 목적이라
    // 실제 구현을 그대로 주입하고 메뉴에서는 바로 빠져나온다.
    prepareAuthoringRequest,
    dispatchAuthoringRequest,
    createAuthoringDiff,
    applyAuthoringChanges,
    reviewLocalAuthoringCandidate,
    validateSuite: validateMcpSuite,
    exists: vi.fn(async () => false),
    // 저장 경로는 쓴 것을 그대로 다시 읽는다. 저장 후 재검증이 실제 바이트를 보게 한다.
    openTemp: vi.fn(async () => ({
      writeFile: vi.fn(async (data: string) => {
        written = data;
      }),
      sync: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    })),
    readFile: vi.fn(async () => new TextEncoder().encode(written)),
    link: vi.fn(async () => undefined),
    unlink: vi.fn(async () => undefined),
    writeStdout: (text) => stdout.push(text),
    writeStderr: (text) => stdout.push(text),
    reviewIO: options.io,
    preparePreFillRequest,
    previewPreFillRequest,
    dispatchPreFillRequest,
    ...(options.provider === undefined
      ? {}
      : { preFillProviders: { codex: () => options.provider } }),
  };
}

const argv = (outPath: string, extra: readonly string[]) => [
  "--suite-id",
  "s",
  "--name",
  "s",
  "--out",
  outPath,
  "--command",
  "server",
  ...extra,
];

describe("provider 를 못 부르는 경로", () => {
  it("--baseline-only 면 사전보완을 건너뛴다", async () => {
    const preFill = vi.fn(async () => ({ proposals: [] }));
    const connection = fakeConnection([]);
    connection.client.listTools = vi.fn(async () => [needsHelp]) as never;
    const code = await runGenerateCommand(
      argv("/tmp/ohmymcp-pre-fill-1.json", ["--baseline-only", "--provider", "codex"]),
      deps({
        tools: [needsHelp],
        connection,
        provider: { id: "codex", model: "m", preFill },
      }),
    );
    expect(code).toBe(0);
    expect(preFill).not.toHaveBeenCalled();
  });

  it("사전보완 대상이 없으면 provider 를 안 부른다", async () => {
    const preFill = vi.fn(async () => ({ proposals: [] }));
    const connection = fakeConnection([]);
    connection.client.listTools = vi.fn(async () => [allDeclared]) as never;
    const stdout: string[] = [];
    const code = await runGenerateCommand(
      argv("/tmp/ohmymcp-pre-fill-2.json", ["--provider", "codex", "--model", "m"]),
      deps({
        tools: [allDeclared],
        connection,
        provider: { id: "codex", model: "m", preFill },
        io: reviewIO(true, []),
        stdout,
      }),
    );
    expect(code).toBe(0);
    expect(preFill).not.toHaveBeenCalled();
  });

  it("provider 주입이 없으면 조용히 건너뛰고 생성은 계속한다", async () => {
    const connection = fakeConnection([]);
    connection.client.listTools = vi.fn(async () => [needsHelp]) as never;
    const code = await runGenerateCommand(
      argv("/tmp/ohmymcp-pre-fill-3.json", ["--provider", "codex", "--model", "m"]),
      deps({ tools: [needsHelp], connection, io: reviewIO(true, []) }),
    );
    expect(code).toBe(0);
  });
});

describe("--baseline-only 에서 표 밖 format 툴 건너뛰기", () => {
  it("그 툴의 케이스를 빼고 해결 수단을 고지한다", async () => {
    const connection = fakeConnection([]);
    connection.client.listTools = vi.fn(async () => [unknownFormatTool, allDeclared]) as never;
    const stdout: string[] = [];
    const sessionSpy = vi.fn(createAuthoringSession);
    const code = await runGenerateCommand(
      argv("/tmp/ohmymcp-pre-fill-4.json", ["--baseline-only"]),
      deps({
        tools: [unknownFormatTool, allDeclared],
        connection,
        stdout,
        sessionSpy: sessionSpy as never,
      }),
    );
    expect(code).toBe(0);
    const text = stdout.join("");
    expect(text).toContain("lookup_host");
    expect(text).toContain("json-pointer");
    // "지원하지 않는다" 로 끝내면 사용자가 할 수 있는 일이 없다.
    expect(text).toContain("--baseline-only 없이");

    const passed = sessionSpy.mock.calls[0]?.[0];
    const toolsInSuite = (passed?.suite.cases ?? []).map((item) =>
      item.operation.type === "callTool" ? item.operation.tool : "",
    );
    expect(toolsInSuite).not.toContain("lookup_host");
    expect(toolsInSuite).toContain("all_declared");
  });
});

describe("사전보완 채택", () => {
  it("baseline 이 실패하고 제안이 통과하면 AI 값을 쓰고 출처를 남긴다", async () => {
    const events: string[] = [];
    const connection = fakeConnection(events);
    const stdout: string[] = [];
    const sessionSpy = vi.fn(createAuthoringSession);
    const code = await runGenerateCommand(
      argv("/tmp/ohmymcp-pre-fill-5.json", ["--provider", "codex", "--model", "m"]),
      deps({
        tools: [needsHelp],
        connection,
        stdout,
        io: reviewIO(true, stdout),
        sessionSpy: sessionSpy as never,
        provider: {
          id: "codex",
          model: "m",
          preFill: vi.fn(async () => ({
            proposals: [{ caseId: "needs-help-success", field: "timezone", value: "Asia/Seoul" }],
          })),
        },
      }),
    );
    expect(code).toBe(0);

    // baseline 값과 AI 값 두 벌이 실제로 서버에 나갔다.
    expect(events).toContain('callTool:{"timezone":"example"}');
    expect(events).toContain('callTool:{"timezone":"Asia/Seoul"}');

    expect(stdout.join("")).toContain("  채택 1");
    const [passed, sessionOptions] = sessionSpy.mock.calls[0] ?? [];
    const happy = passed?.suite.cases.find((item) => item.id === "needs-help-success");
    expect(happy?.operation.type === "callTool" && happy.operation.input).toEqual({
      timezone: "Asia/Seoul",
    });
    // 값이 규칙만으로 재현되지 않으므로 출처를 baseline 으로 적으면 거짓이 된다.
    expect(sessionOptions?.preFilledCaseIds).toEqual(["needs-help-success"]);

    const text = stdout.join("");
    expect(text).toContain("AI 사전보완");
    expect(text).toContain("채택 1");
  });

  it("전송을 승인하지 않으면 baseline 값 그대로 간다", async () => {
    const events: string[] = [];
    const connection = fakeConnection(events);
    const stdout: string[] = [];
    const io = reviewIO(true, stdout);
    io.confirm = vi.fn(async () => false);
    const preFill = vi.fn(async () => ({ proposals: [] }));
    const sessionSpy = vi.fn(createAuthoringSession);
    await runGenerateCommand(
      argv("/tmp/ohmymcp-pre-fill-6.json", ["--provider", "codex", "--model", "m"]),
      deps({
        tools: [needsHelp],
        connection,
        stdout,
        io,
        sessionSpy: sessionSpy as never,
        provider: { id: "codex", model: "m", preFill },
      }),
    );
    expect(preFill).not.toHaveBeenCalled();
    expect(sessionSpy.mock.calls[0]?.[1]?.preFilledCaseIds).toEqual([]);
  });

  it("provider 가 죽어도 툴을 건너뛰지 않고 baseline 으로 진행한다", async () => {
    const stdout: string[] = [];
    const connection = fakeConnection([]);
    const sessionSpy = vi.fn(createAuthoringSession);
    const code = await runGenerateCommand(
      argv("/tmp/ohmymcp-pre-fill-7.json", ["--provider", "codex", "--model", "m"]),
      deps({
        tools: [needsHelp],
        connection,
        stdout,
        io: reviewIO(true, stdout),
        sessionSpy: sessionSpy as never,
        provider: {
          id: "codex",
          model: "m",
          preFill: vi.fn(async () => {
            throw new Error("provider 죽음");
          }),
        },
      }),
    );
    expect(code).toBe(0);
    // provider 실패는 사용자 서버의 문제가 아니다. 케이스를 잃지 않는다.
    const passed = sessionSpy.mock.calls[0]?.[0];
    expect(passed?.suite.cases.some((item) => item.id === "needs-help-success")).toBe(true);
    expect(stdout.join("")).toContain("baseline 값으로 진행합니다");
  });
});
