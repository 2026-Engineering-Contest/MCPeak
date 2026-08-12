import { createHash } from "node:crypto";
import type { McpStdioConnection, ToolDef } from "@ohmymcp/core";
import {
  applyAuthoringChanges,
  createAuthoringDiff,
  createAuthoringSession,
  createBaselineSuite,
  dispatchAuthoringRequest,
  finalizeAuthoringDraft,
  getAuthoringExecutionSuite,
  prepareAuthoringRequest,
  reviewLocalAuthoringCandidate,
} from "@ohmymcp/generate";
import type { TestSuiteSpec } from "@ohmymcp/runner";
import { describe, expect, it, vi } from "vitest";
import {
  type GenerateCommandDependencies,
  parseGenerateCommand,
  runGenerateCommand,
} from "../src/generate-command.js";

const tools: ToolDef[] = [{ name: "weather", inputSchema: { type: "object" } }];
const suite: TestSuiteSpec = {
  schemaVersion: 1,
  id: "weather",
  name: "Weather",
  defaultTimeoutMs: 10000,
  cases: [],
};
const fingerprint = createHash("sha256")
  .update('{"cases":[],"defaultTimeoutMs":10000,"id":"weather","name":"Weather","schemaVersion":1}')
  .digest("hex");

function deps(overrides: Partial<GenerateCommandDependencies> = {}) {
  const events: string[] = [];
  const connection: McpStdioConnection = {
    client: {
      listTools: vi.fn(async () => {
        events.push("listTools");
        return tools;
      }),
      callTool: vi.fn(),
      close: vi.fn(),
    },
    getDiagnostics: vi.fn(),
    close: vi.fn(async () => {
      events.push("close");
    }),
    forceClose: vi.fn(async () => {
      events.push("forceClose");
    }),
  };
  const value: GenerateCommandDependencies = {
    connect: vi.fn(async () => {
      events.push("connect");
      return connection;
    }),
    createBaselineSuite: vi.fn(() => {
      events.push("baseline");
      return {
        suite,
        baselineFingerprint: "baseline",
        suiteFingerprint: "suite",
        policyVersion: "schema-baseline-v1" as const,
      };
    }),
    createAuthoringSession: vi.fn(
      () => ({ approvedDraft: { suite, suiteFingerprint: "suite" } }) as never,
    ),
    finalizeAuthoringDraft: vi.fn(() => {
      events.push("finalize");
      return { finalized: true, snapshot: { fingerprint } } as never;
    }),
    getAuthoringExecutionSuite: vi.fn(() => suite),
    validateSuite: vi.fn(() => ({ valid: true as const, value: suite })),
    exists: vi.fn(async () => false),
    openTemp: vi.fn(async (path: string) => {
      events.push(`open:${path}`);
      return {
        writeFile: vi.fn(async () => {
          events.push("write");
        }),
        sync: vi.fn(async () => {
          events.push("fsync");
        }),
        close: vi.fn(async () => {
          events.push("fileClose");
        }),
      };
    }),
    readFile: vi.fn(async () => {
      events.push("read");
      return new TextEncoder().encode(JSON.stringify(suite));
    }),
    rename: vi.fn(async () => {
      events.push("rename");
    }),
    unlink: vi.fn(async () => {
      events.push("unlink");
    }),
    writeStdout: vi.fn(),
    writeStderr: vi.fn(),
    ...overrides,
  };
  return { value, events, connection };
}

describe("parseGenerateCommand", () => {
  it("generate 필수 값과 반복 arg를 순서대로 파싱한다", () => {
    expect(
      parseGenerateCommand([
        "--suite-id",
        "weather",
        "--name",
        "Weather",
        "--out",
        "out.json",
        "--command",
        "node",
        "--arg",
        "one",
        "--arg",
        "two",
        "--baseline-only",
      ]),
    ).toEqual({
      suiteId: "weather",
      name: "Weather",
      outPath: "out.json",
      command: "node",
      args: ["one", "two"],
      baselineOnly: true,
      provider: undefined,
      model: undefined,
    });
  });
  it("equals 형식, 하이픈 arg와 빈 arg를 보존한다", () => {
    expect(
      parseGenerateCommand([
        "--suite-id=weather",
        "--name=Weather",
        "--out=out.json",
        "--command=node",
        "--arg=-m",
        "--arg=",
      ]),
    ).toMatchObject({ args: ["-m", ""] });
  });
  it("누락·중복·unknown·추가 위치 인자를 사용법 오류로 거절한다", () => {
    for (const argv of [
      ["--name", "n"],
      ["--suite-id", "x", "--suite-id", "y", "--name", "n", "--out", "x.json", "--command", "node"],
      ["--suite-id", "x", "--name", "n", "--out", "x.json", "--command", "node", "--wat"],
      ["--suite-id", "x", "--name", "n", "--out", "x.json", "--command", "--wat"],
      ["--suite-id", "x", "--name", "n", "--out", "x.json", "--command", "--baseline-only"],
      ["--suite-id", "x", "--name", "n", "--out", "x.json", "--command", "node", "extra"],
    ])
      expect(() => parseGenerateCommand(argv)).toThrow();
  });
  it("model 단독과 잘못된 provider를 process 전에 거절한다", async () => {
    for (const argv of [
      [
        "generate",
        "--suite-id",
        "x",
        "--name",
        "n",
        "--out",
        "x.json",
        "--command",
        "node",
        "--model",
        "m",
      ],
      [
        "generate",
        "--suite-id",
        "x",
        "--name",
        "n",
        "--out",
        "x.json",
        "--command",
        "node",
        "--provider",
        "other",
      ],
    ]) {
      const d = deps();
      expect(await runGenerateCommand(argv, d.value)).toBe(1);
      expect(d.value.connect).not.toHaveBeenCalled();
    }
  });
});

describe("runGenerateCommand", () => {
  const argv = [
    "generate",
    "--suite-id",
    "weather",
    "--name",
    "Weather",
    "--out",
    "/tmp/out.json",
    "--command",
    "node",
    "--arg",
    "server.mjs",
    "--baseline-only",
  ];
  it("baseline-only는 Core tools/list 뒤 server를 닫고 AI 없이 저장한다", async () => {
    const d = deps();
    const stderr: string[] = [];
    d.value.writeStderr = (text) => stderr.push(text);
    expect(await runGenerateCommand(argv, d.value)).toBe(0);
    expect(d.events).toEqual([
      "connect",
      "listTools",
      "close",
      "baseline",
      "finalize",
      "open:/tmp/.out.json.ohmymcp.tmp",
      "write",
      "fsync",
      "fileClose",
      "read",
      "rename",
    ]);
  });
  it("listTools 실패는 열린 connection을 강제 종료한다", async () => {
    const d = deps();
    d.connection.client.listTools = vi.fn(async () => {
      throw new Error("secret");
    });
    expect(await runGenerateCommand(argv, d.value)).toBe(1);
    expect(d.connection.forceClose).toHaveBeenCalledOnce();
  });
  it("기존 out 파일을 비대화형으로 덮어쓰지 않는다", async () => {
    const d = deps({ exists: vi.fn(async () => true) });
    expect(await runGenerateCommand(argv, d.value)).toBe(1);
    expect(d.value.openTemp).not.toHaveBeenCalled();
    expect(d.value.rename).not.toHaveBeenCalled();
  });
  it("같은 디렉터리 temp write를 다시 읽어 검증한 뒤 rename한다", async () => {
    const d = deps();
    await runGenerateCommand(argv, d.value);
    expect(d.events.slice(-6)).toEqual([
      "open:/tmp/.out.json.ohmymcp.tmp",
      "write",
      "fsync",
      "fileClose",
      "read",
      "rename",
    ]);
    expect(d.value.validateSuite).toHaveBeenCalledOnce();
  });
  it("temp 충돌과 재검증 실패는 목표 파일을 바꾸지 않는다", async () => {
    for (const override of [
      {
        openTemp: vi.fn(async () => {
          throw new Error("EEXIST");
        }),
      },
      { validateSuite: vi.fn(() => ({ valid: false as const, issues: [] })) },
    ]) {
      const d = deps(override);
      expect(await runGenerateCommand(argv, d.value)).toBe(1);
      expect(d.value.rename).not.toHaveBeenCalled();
    }
  });
  it("저장 JSON은 고정 필드 순서, 2칸 indent와 마지막 newline을 쓴다", async () => {
    const writeFile = vi.fn<(data: string, encoding: "utf8") => Promise<void>>(
      async () => undefined,
    );
    const d = deps({ openTemp: vi.fn(async () => ({ writeFile, sync: vi.fn(), close: vi.fn() })) });
    await runGenerateCommand(argv, d.value);
    expect(writeFile.mock.calls[0]?.[0]).toBe(
      '{\n  "schemaVersion": 1,\n  "id": "weather",\n  "name": "Weather",\n  "defaultTimeoutMs": 10000,\n  "cases": []\n}\n',
    );
  });
  it("generate dispatch 실패를 raw 오류 없이 정규화한다", async () => {
    const d = deps({
      connect: vi.fn(async () => {
        throw new Error("SECRET_STACK");
      }),
    });
    await runGenerateCommand(argv, d.value);
    expect(d.value.writeStderr).toHaveBeenCalledWith(expect.not.stringContaining("SECRET_STACK"));
  });
});

describe("AI 대화형 검토", () => {
  function reviewDeps(choices: string[], inputs: string[] = [], confirms: boolean[] = []) {
    const d = deps();
    const stderr: string[] = [];
    d.value.writeStderr = (text) => stderr.push(text);
    const baseline = createBaselineSuite(tools, { suiteId: "weather", suiteName: "Weather" });
    const io = {
      interactive: true,
      choose: vi.fn(async () => choices.shift() ?? "cancel"),
      input: vi.fn(async () => inputs.shift() ?? ""),
      confirm: vi.fn(async () => confirms.shift() ?? false),
      write: vi.fn(),
      close: vi.fn(),
    };
    const requests: unknown[] = [];
    const provider = {
      id: "codex" as const,
      model: "gpt-5.6-luna",
      author: vi.fn(async (request: unknown) => {
        requests.push(request);
        return {
          status: "candidate" as const,
          suite: { ...baseline.suite, name: "AI Weather" },
          summary: "candidate",
          warnings: [],
          questions: [],
        };
      }),
    };
    Object.assign(d.value, {
      createBaselineSuite: vi.fn(() => baseline),
      createAuthoringSession,
      finalizeAuthoringDraft,
      getAuthoringExecutionSuite,
      prepareAuthoringRequest,
      dispatchAuthoringRequest,
      createAuthoringDiff,
      applyAuthoringChanges,
      reviewLocalAuthoringCandidate,
      reviewIO: io,
      providers: { codex: vi.fn(() => provider) },
    });
    return { ...d, io, provider, baseline, requests, stderr };
  }
  const interactiveArgv = [
    "generate",
    "--suite-id",
    "weather",
    "--name",
    "Weather",
    "--out",
    "/tmp/out.json",
    "--command",
    "node",
  ];
  it("비대화형 AI mode를 provider 호출 전에 거절한다", async () => {
    const d = deps();
    await expect(
      runGenerateCommand(
        [
          "generate",
          "--suite-id",
          "weather",
          "--name",
          "Weather",
          "--out",
          "/tmp/out.json",
          "--command",
          "node",
        ],
        d.value,
      ),
    ).resolves.toBe(1);
    expect(d.value.connect).not.toHaveBeenCalled();
  });
  it("provider와 model을 사용자가 선택한다", async () => {
    const d = reviewDeps(["codex", "cancel"], ["gpt-5.6-luna", "request"]);
    await expect(
      runGenerateCommand(
        [...interactiveArgv, "--provider", "codex", "--model", "gpt-5.6-luna"],
        d.value,
      ),
    ).resolves.toBe(0);
    expect(d.value.providers?.codex).toHaveBeenCalledWith("gpt-5.6-luna");
  });
  it("provider unavailable이면 자동 fallback하지 않는다", async () => {
    const d = reviewDeps(["codex", "cancel"], ["request"]);
    d.value.providers = { codex: vi.fn(() => undefined), claude: vi.fn() };
    await expect(runGenerateCommand(interactiveArgv, d.value)).resolves.toBe(0);
    expect(d.value.providers.claude).not.toHaveBeenCalled();
  });
  it("AI 호출마다 정제된 request preview와 fingerprint 승인을 받는다", async () => {
    const d = reviewDeps(["codex", "codex", "cancel"], ["", "first", "", "second"], [false, true]);
    await expect(runGenerateCommand(interactiveArgv, d.value)).resolves.toBe(0);
    expect(d.provider.author).toHaveBeenCalledOnce();
    expect(d.io.confirm).toHaveBeenCalledTimes(2);
    expect(d.io.write).toHaveBeenCalledWith(expect.stringContaining("Fingerprint:"));
  });
  it("candidate diff를 전체 적용해 revision을 증가시킨다", async () => {
    const d = reviewDeps(["codex", "apply-all", "cancel"], ["", "request"], [true, true]);
    await runGenerateCommand(interactiveArgv, d.value);
    expect(d.io.write).toHaveBeenCalledWith("revision 1을 승인했습니다.\n");
  });
  it("선택 change ID만 적용한다", async () => {
    const d = reviewDeps(["codex", "select", "cancel"], ["", "request", "unknown"], [true, true]);
    await runGenerateCommand(interactiveArgv, d.value);
    expect(d.io.write).toHaveBeenCalledWith("변경을 적용하지 않았습니다: unknownChange\n");
  });
  it("호환되지 않는 order 선택은 draft를 바꾸지 않고 안내한다", async () => {
    const d = reviewDeps(
      ["codex", "select", "cancel"],
      ["", "request", "change-002"],
      [true, true],
    );
    const original = d.baseline.suite.cases[0];
    if (original === undefined) throw new Error("baseline case가 필요합니다.");
    d.provider.author.mockResolvedValueOnce({
      status: "candidate",
      suite: {
        ...d.baseline.suite,
        cases: [{ ...original, id: "additional-case" }, original],
      },
      summary: "candidate",
      warnings: [],
      questions: [],
    });
    await runGenerateCommand(interactiveArgv, d.value);
    expect(d.io.write).toHaveBeenCalledWith("변경을 적용하지 않았습니다: incompatibleSelection\n");
  });
  it("검토 중 피드백으로 AI를 재호출한다", async () => {
    const d = reviewDeps(["codex", "revise", "cancel"], ["", "first", "second"], [true, true]);
    await runGenerateCommand(interactiveArgv, d.value);
    expect(d.provider.author).toHaveBeenCalledTimes(2);
    expect(d.requests[1]).toMatchObject({ mode: "revise", candidate: { name: "AI Weather" } });
  });
  it("questions 결과를 표시하고 답변으로 새 요청을 만든다", async () => {
    const d = reviewDeps(
      ["codex", "codex", "cancel"],
      ["", "answer", "", "answer with context"],
      [true, true],
    );
    d.value.dispatchAuthoringRequest = vi
      .fn()
      .mockResolvedValueOnce({ status: "questions", questions: ["어느 city를 사용할까요?"] })
      .mockImplementation(dispatchAuthoringRequest);
    await runGenerateCommand(interactiveArgv, d.value);
    expect(d.value.dispatchAuthoringRequest).toHaveBeenCalledTimes(2);
    expect(d.io.write).toHaveBeenCalledWith(expect.stringContaining("어느 city를 사용할까요?"));
  });
  it("provider 실패 뒤 자동 재시도하지 않고 메뉴로 돌아간다", async () => {
    const d = reviewDeps(["codex", "cancel"], ["", "request"], [true]);
    d.provider.author.mockRejectedValueOnce(new Error("PROMPT_STDOUT_STDERR_STACK"));
    await runGenerateCommand(interactiveArgv, d.value);
    expect(d.provider.author).toHaveBeenCalledOnce();
    expect(d.stderr.join("\n")).toContain("PROVIDER_FAILED");
  });
  it("편집한 JSON 파일도 같은 diff와 승인 경계를 거친다", async () => {
    const d = reviewDeps(["edit", "apply-all", "cancel"], ["candidate.json"], [true]);
    d.value.readFile = vi.fn(async () =>
      new TextEncoder().encode(JSON.stringify({ ...d.baseline.suite, name: "Edited" })),
    );
    await runGenerateCommand(interactiveArgv, d.value);
    expect(d.provider.author).not.toHaveBeenCalled();
    expect(d.io.write).toHaveBeenCalledWith("revision 1을 승인했습니다.\n");
  });
  it("result redaction candidate를 저장하거나 적용하지 않는다", async () => {
    const d = reviewDeps(["edit", "apply-all", "cancel"], ["candidate.json"], [true]);
    const redactedCandidate = {
      ...d.baseline.suite,
      cases: d.baseline.suite.cases.map((item) => ({
        ...item,
        operation:
          item.operation.type === "callTool"
            ? { ...item.operation, input: { token: "secret" } }
            : item.operation,
      })),
    };
    d.value.readFile = vi.fn(async () =>
      new TextEncoder().encode(JSON.stringify(redactedCandidate)),
    );
    d.value.reviewLocalAuthoringCandidate = (options) =>
      reviewLocalAuthoringCandidate({ ...options, sensitiveValues: ["secret"] });
    await runGenerateCommand(interactiveArgv, d.value);
    expect(d.io.write).toHaveBeenCalledWith("변경을 적용하지 않았습니다: redactionRequired\n");
    expect(d.value.openTemp).not.toHaveBeenCalled();
  });
  it("최종 fingerprint 승인 뒤에만 JSON을 저장한다", async () => {
    const d = reviewDeps(["save", "cancel"], [], [false]);
    await runGenerateCommand(interactiveArgv, d.value);
    expect(d.value.openTemp).not.toHaveBeenCalled();
    expect(d.io.confirm).toHaveBeenCalledOnce();
  });
  it("사용자 취소는 provider·파일 쓰기 없이 종료 코드 0이다", async () => {
    const d = reviewDeps(["cancel"]);
    await expect(runGenerateCommand(interactiveArgv, d.value)).resolves.toBe(0);
    expect(d.provider.author).not.toHaveBeenCalled();
    expect(d.value.openTemp).not.toHaveBeenCalled();
    expect(d.io.close).toHaveBeenCalledOnce();
  });
  it("failure 출력에 prompt stdout stderr native stack을 넣지 않는다", async () => {
    const d = reviewDeps(["codex", "cancel"], ["", "request"], [true]);
    d.value.dispatchAuthoringRequest = vi.fn(async () => {
      throw new Error("prompt stdout stderr NATIVE_STACK");
    });
    await runGenerateCommand(interactiveArgv, d.value);
    const output = d.stderr.join("");
    expect(output).toContain("PROVIDER_FAILED");
    expect(output).not.toMatch(/prompt|stdout|stderr|NATIVE_STACK/);
  });
});
