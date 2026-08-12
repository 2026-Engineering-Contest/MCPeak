import { createHash } from "node:crypto";
import { Readable, Writable } from "node:stream";
import type { McpStdioConnection, ToolDef } from "@ohmymcp/core";
import {
  applyAuthoringChanges,
  createAuthoringDiff,
  createAuthoringSession,
  createBaselineSuite,
  dispatchAuthoringRequest,
  finalizeAuthoringDraft,
  getAuthoringExecutionSuite,
  type PublicProviderFailure,
  prepareAuthoringRequest,
  reviewLocalAuthoringCandidate,
} from "@ohmymcp/generate";
import type { CallToolCaseSpec, TestCaseSpec, TestSuiteSpec } from "@ohmymcp/runner";
import { describe, expect, it, vi } from "vitest";
import {
  type GenerateCommandDependencies,
  nodeReviewIO,
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

  async function failWith(failure: PublicProviderFailure): Promise<string> {
    const d = reviewDeps(["codex", "cancel"], ["", "INSTRUCTION_PAYLOAD_TEXT"], [true]);
    d.value.dispatchAuthoringRequest = vi.fn(async () => ({
      status: "providerFailed" as const,
      failure,
    }));
    await runGenerateCommand(interactiveArgv, d.value);
    return d.stderr.join("");
  }
  const base = { providerId: "codex" as const, timeoutMs: 120_000 };

  it("providerUnavailable이면 CLI 설치와 PATH 확인을 안내한다", async () => {
    const output = await failWith({ ...base, code: "providerUnavailable" });
    expect(output).toContain("GENERATE_PROVIDER_UNAVAILABLE");
    expect(output).toContain("--version");
  });
  it("nonZeroExit이면 로그인 상태 확인을 안내하고 exit code를 보여준다", async () => {
    const output = await failWith({ ...base, code: "nonZeroExit", exitCode: 1 });
    expect(output).toContain("GENERATE_PROVIDER_EXIT");
    expect(output).toContain("코드 1로");
  });
  it("exitCode를 모르면 코드 없이 종료 사실만 안내한다", async () => {
    const output = await failWith({ ...base, code: "nonZeroExit" });
    expect(output).toContain("GENERATE_PROVIDER_EXIT");
    expect(output).not.toContain("코드 undefined");
  });
  it("timedOut이면 timeout 값과 함께 조치를 안내한다", async () => {
    const output = await failWith({ ...base, code: "timedOut" });
    expect(output).toContain("GENERATE_PROVIDER_TIMEOUT");
    expect(output).toContain("120000ms");
  });
  it("schemaMismatch면 재요청과 provider 전환을 안내한다", async () => {
    const output = await failWith({ ...base, code: "schemaMismatch" });
    expect(output).toContain("GENERATE_PROVIDER_SCHEMA");
  });
  it("cancelled면 메뉴에서 다시 요청하도록 안내한다", async () => {
    const output = await failWith({ ...base, code: "cancelled" });
    expect(output).toContain("GENERATE_PROVIDER_CANCELLED");
  });
  it("internal 등 그 외 코드는 기존 문구를 유지한다", async () => {
    const output = await failWith({ ...base, code: "internal" });
    expect(output).toContain("GENERATE_PROVIDER_FAILED");
  });
  it("실패 메시지에 prompt·stdout·stderr·stack·인증정보가 노출되지 않는다", async () => {
    const codes: PublicProviderFailure["code"][] = [
      "providerUnavailable",
      "nonZeroExit",
      "timedOut",
      "schemaMismatch",
      "cancelled",
      "outputLimitExceeded",
      "invalidUtf8",
      "invalidJson",
      "internal",
    ];
    const outputs: string[] = [];
    for (const code of codes)
      outputs.push(
        await failWith({
          ...base,
          code,
          exitCode: 1,
          stderr: { captured: true, truncated: true },
        }),
      );
    const output = outputs.join("");
    expect(output).not.toContain("ANTHROPIC_API_KEY");
    expect(output).not.toContain("OPENAI_API_KEY");
    expect(output).not.toContain("INSTRUCTION_PAYLOAD_TEXT");
    expect(output.split("\n").some((line) => line.trimStart().startsWith("at "))).toBe(false);
  });

  function inputClosedError(): Error {
    const error = new Error("readline was closed");
    error.name = "Error [ERR_USE_AFTER_CLOSE]";
    Object.assign(error, { code: "ERR_USE_AFTER_CLOSE" });
    error.stack =
      "Error [ERR_USE_AFTER_CLOSE]: readline was closed\n    at [kQuestion] (node:internal/readline/interface:441:13)";
    return error;
  }
  function closedIODeps() {
    const d = reviewDeps(["codex", "cancel"], ["", "request"], [true]);
    const stdout: string[] = [];
    d.value.writeStdout = (text) => stdout.push(text);
    return { ...d, stdout };
  }
  function assertClosedExit(d: { stdout: string[]; stderr: string[] }): void {
    const output = [...d.stdout, ...d.stderr].join("");
    expect(output).toContain("입력이 종료되어 검토를 취소했습니다");
    expect(output).not.toContain("ERR_USE_AFTER_CLOSE");
    expect(output).not.toContain("node:internal");
    expect(output.split("\n").some((line) => line.trimStart().startsWith("at "))).toBe(false);
  }

  it("검토 중 입력이 닫히면 스택 없이 취소로 종료한다", async () => {
    const d = closedIODeps();
    d.io.choose = vi.fn(async () => {
      throw inputClosedError();
    });
    await expect(runGenerateCommand(interactiveArgv, d.value)).resolves.toBe(0);
    expect(d.stdout.join("")).toContain("입력이 종료되어 검토를 취소했습니다");
    assertClosedExit(d);
    expect(d.value.openTemp).not.toHaveBeenCalled();
    expect(d.value.rename).not.toHaveBeenCalled();
    expect(d.io.close).toHaveBeenCalledOnce();
  });
  it("입력 닫힘이 아닌 오류는 삼키지 않는다", async () => {
    const d = closedIODeps();
    d.io.choose = vi.fn(async () => {
      throw new Error("REVIEW_IO_BOOM");
    });
    await expect(runGenerateCommand(interactiveArgv, d.value)).rejects.toThrow("REVIEW_IO_BOOM");
    expect(d.stdout.join("")).not.toContain("입력이 종료되어 검토를 취소했습니다");
  });
  it("input과 confirm에서 닫혀도 같은 경로로 종료한다", async () => {
    for (const stage of ["input", "confirm"] as const) {
      const d = closedIODeps();
      d.io[stage] = vi.fn(async () => {
        throw inputClosedError();
      }) as never;
      await expect(runGenerateCommand(interactiveArgv, d.value)).resolves.toBe(0);
      assertClosedExit(d);
      expect(d.value.openTemp).not.toHaveBeenCalled();
      expect(d.value.rename).not.toHaveBeenCalled();
      expect(d.io.close).toHaveBeenCalledOnce();
    }
  });
  it("실제 readline도 EOF에서 스택 없이 취소로 끝난다", async () => {
    const written: string[] = [];
    const io = nodeReviewIO(
      Readable.from([]),
      new Writable({
        write(chunk, _encoding, callback) {
          written.push(String(chunk));
          callback();
        },
      }),
    );
    const d = closedIODeps();
    d.value.reviewIO = { ...io, interactive: true };
    await expect(runGenerateCommand(interactiveArgv, d.value)).resolves.toBe(0);
    const output = [...d.stdout, ...d.stderr, ...written].join("");
    expect(output).toContain("입력이 종료되어 검토를 취소했습니다");
    expect(output).not.toContain("ERR_USE_AFTER_CLOSE");
    expect(output).not.toContain("node:internal");
    expect(output.split("\n").some((line) => line.trimStart().startsWith("at "))).toBe(false);
    expect(d.value.openTemp).not.toHaveBeenCalled();
  });

  /** candidate suite 하나를 provider 응답으로 넣고 showDiff 출력만 뽑는다. */
  async function diffOutput(
    makeCandidate: (baselineSuite: TestSuiteSpec) => TestSuiteSpec,
    options: { menu?: string[]; inputs?: string[]; confirms?: boolean[] } = {},
  ): Promise<string> {
    const d = reviewDeps(
      options.menu ?? ["codex", "cancel"],
      options.inputs ?? ["", "request"],
      options.confirms ?? [true],
    );
    d.provider.author.mockResolvedValueOnce({
      status: "candidate",
      suite: makeCandidate(d.baseline.suite),
      summary: "candidate",
      warnings: [],
      questions: [],
    });
    await runGenerateCommand(interactiveArgv, d.value);
    return d.io.write.mock.calls.map((call) => String(call[0])).join("");
  }
  /** showDiff가 낸 줄만 남긴다(헤더 + 두 칸 들여쓴 본문). */
  const diffLines = (output: string): string[] =>
    output.split("\n").filter((line) => /^change-\d{3} /.test(line) || line.startsWith("  "));
  /** 지정한 type의 change 하나만 골라 그 본문 줄(들여쓰기 제거)을 돌려준다. */
  const blockBody = (output: string, type: string): string[] => {
    const lines = diffLines(output);
    const start = lines.findIndex((line) => new RegExp(`^change-\\d{3} ${type}\\b`).test(line));
    if (start < 0) throw new Error(`${type} change가 출력에 없습니다.`);
    const body: string[] = [];
    for (const line of lines.slice(start + 1)) {
      if (!line.startsWith("  ")) break;
      body.push(line.slice(2));
    }
    return body;
  };
  const baseCase = (suite: TestSuiteSpec): TestCaseSpec => {
    const first = suite.cases[0];
    if (first === undefined) throw new Error("baseline case가 필요합니다.");
    return first;
  };
  const isCallTool = (value: TestCaseSpec): value is CallToolCaseSpec =>
    value.operation.type === "callTool";
  /** baseline의 callTool 케이스에 다른 input을 끼운 케이스를 만든다. */
  const withInput = (
    suite: TestSuiteSpec,
    input: CallToolCaseSpec["operation"]["input"],
  ): CallToolCaseSpec => {
    const first = suite.cases[0];
    if (first === undefined || !isCallTool(first))
      throw new Error("callTool baseline case가 필요합니다.");
    return { ...first, operation: { ...first.operation, input } };
  };

  it("replaceCase는 바뀐 leaf 경로만 - 와 + 로 보여준다", async () => {
    const output = await diffOutput((suite) => {
      const cases: TestCaseSpec[] = [withInput(suite, { city: "서울" })];
      return { ...suite, cases };
    });
    expect(output).toContain('+ operation.input.city: "서울"');
    expect(output).not.toContain("assertions[0].expected");
    expect(output).not.toContain("operation.tool");
  });
  it("addCase는 모든 leaf 경로를 + 로 보여준다", async () => {
    const output = await diffOutput((suite) => {
      const original = baseCase(suite);
      return { ...suite, cases: [original, { ...original, id: "add-negative" }] };
    });
    const body = blockBody(output, "addCase");
    expect(body).toContain('+ id: "add-negative"');
    expect(body).toContain('+ operation.type: "callTool"');
    expect(body).toContain('+ operation.tool: "weather"');
    expect(body).toContain('+ assertions[0].type: "isError"');
    expect(body.some((line) => line.startsWith("-"))).toBe(false);
  });
  it("removeCase는 모든 leaf 경로를 - 로 보여준다", async () => {
    const output = await diffOutput((suite) => {
      const original = baseCase(suite);
      return {
        ...suite,
        cases: [{ ...original, id: "kept-case" }],
      };
    });
    expect(output).toContain('- id: "weather-success"');
    expect(output).toContain('- operation.tool: "weather"');
    expect(output).toContain("- assertions[0].expected: false");
  });
  it("caseOrder는 before와 after 순서를 한 줄씩 보여준다", async () => {
    const output = await diffOutput((suite) => {
      const original = baseCase(suite);
      const extra = { ...original, id: "add-success" };
      return { ...suite, cases: [extra, original] };
    });
    expect(output).toContain("- weather-success");
    expect(output).toContain("+ add-success, weather-success");
  });
  it("배열 인덱스 경로를 쓴다", async () => {
    const output = await diffOutput((suite) => {
      const original = baseCase(suite);
      return { ...suite, cases: [original, { ...original, id: "add-negative" }] };
    });
    expect(output).toContain("assertions[0].");
    expect(output).not.toContain("assertions.0.");
  });
  it("같은 입력은 항상 같은 출력을 낸다", async () => {
    const make = (suite: TestSuiteSpec): TestSuiteSpec => {
      const original = baseCase(suite);
      return { ...suite, cases: [original, { ...original, id: "add-negative" }] };
    };
    const first = diffLines(await diffOutput(make)).join("\n");
    const second = diffLines(await diffOutput(make)).join("\n");
    expect(first).toBe(second);
    expect(first).not.toBe("");
  });
  it("본문이 40줄을 넘으면 잘라내고 생략 줄을 붙인다", async () => {
    const output = await diffOutput((suite) => {
      const input: Record<string, number> = {};
      for (let index = 0; index < 50; index += 1) input[`field${index}`] = index;
      const cases: TestCaseSpec[] = [
        baseCase(suite),
        { ...withInput(suite, input), id: "add-wide" },
      ];
      return { ...suite, cases };
    });
    const body = blockBody(output, "addCase");
    expect(body).toHaveLength(41);
    const last = body.at(-1) ?? "";
    expect(last).toContain("이하");
    expect(last).toContain("줄 생략");
  });
  it("변경이 없으면 아무것도 쓰지 않는다", async () => {
    const output = await diffOutput((suite) => suite);
    expect(diffLines(output)).toEqual([]);
  });
  it("select 메뉴에서도 각 change의 내용이 보인다", async () => {
    const d = reviewDeps(
      ["codex", "select", "cancel"],
      ["", "request", "change-001"],
      [true, true],
    );
    const writes: string[] = [];
    d.io.write = vi.fn((text: string) => {
      writes.push(text);
    });
    d.provider.author.mockResolvedValueOnce({
      status: "candidate",
      suite: (() => {
        const original = d.baseline.suite.cases[0];
        if (original === undefined) throw new Error("baseline case가 필요합니다.");
        return { ...d.baseline.suite, cases: [original, { ...original, id: "add-negative" }] };
      })(),
      summary: "candidate",
      warnings: [],
      questions: [],
    });
    await runGenerateCommand(interactiveArgv, d.value);
    const beforePrompt = writes.join("");
    expect(beforePrompt).toContain('+ id: "add-negative"');
    expect(d.io.input).toHaveBeenCalledWith("적용할 change ID를 쉼표로 입력하세요: ");
  });
  it("provider가 돌려준 candidate의 민감 키는 redaction된 값이 보인다", async () => {
    const output = await diffOutput((suite) => {
      const cases: TestCaseSpec[] = [withInput(suite, { token: "hunter2" })];
      return { ...suite, cases };
    });
    expect(output).toContain('+ operation.input.token: "[REDACTED]"');
    expect(output).not.toContain("hunter2");
  });
  it("redaction 대상이 아닌 필드는 원문이 그대로 보인다", async () => {
    const output = await diffOutput((suite) => {
      const original = baseCase(suite);
      return {
        ...suite,
        cases: [{ ...original, name: "PLAINTEXT_CASE_NAME" }],
      };
    });
    expect(output).toContain('+ name: "PLAINTEXT_CASE_NAME"');
  });
});
