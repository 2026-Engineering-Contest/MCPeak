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
  sha256,
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

/** 임시 파일 이름은 실행마다 고유하므로 open 이벤트의 경로는 비교에서 제외한다. */
const normalizedEvents = (events: readonly string[]): string[] =>
  events.map((event) => (event.startsWith("open:") ? "open" : event));

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
    link: vi.fn(async () => {
      events.push("link");
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
    expect(normalizedEvents(d.events)).toEqual([
      "connect",
      "listTools",
      "close",
      "baseline",
      "finalize",
      "open",
      "write",
      "fsync",
      "fileClose",
      "read",
      "link",
      "unlink",
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
    const stderr: string[] = [];
    d.value.writeStderr = (text) => stderr.push(text);
    expect(await runGenerateCommand(argv, d.value)).toBe(1);
    expect(d.value.openTemp).not.toHaveBeenCalled();
    expect(d.value.link).not.toHaveBeenCalled();
    const output = stderr.join("");
    expect(output).toContain("GENERATE_OUTPUT_EXISTS");
    expect(output).toContain("경로: /tmp/out.json");
    expect(output).not.toContain("GENERATE_FAILED");
  });
  it("같은 디렉터리 temp write를 다시 읽어 검증한 뒤 link로 커밋한다", async () => {
    const d = deps();
    await runGenerateCommand(argv, d.value);
    expect(normalizedEvents(d.events).slice(-7)).toEqual([
      "open",
      "write",
      "fsync",
      "fileClose",
      "read",
      "link",
      "unlink",
    ]);
    expect(d.value.validateSuite).toHaveBeenCalledOnce();
    // 임시 파일은 출력 경로와 같은 디렉터리에 있어야 link가 같은 파일시스템 안에서 끝난다.
    const opened = d.events.find((event) => event.startsWith("open:")) ?? "";
    expect(opened).toMatch(/^open:\/tmp\/\.out\.json\.ohmymcp\./);
  });
  it("선검사 뒤 커밋 직전에 파일이 생겨도 덮어쓰지 않는다", async () => {
    // 경쟁 조건 재현. exists()는 없다고 답했지만 link 시점에는 이미 다른 프로세스가 만들어 뒀다.
    const d = deps({ exists: vi.fn(async () => false) });
    const stderr: string[] = [];
    d.value.writeStderr = (text) => stderr.push(text);
    d.value.link = vi.fn(async () => {
      const error: NodeJS.ErrnoException = new Error("EEXIST: file already exists");
      error.code = "EEXIST";
      throw error;
    });
    expect(await runGenerateCommand(argv, d.value)).toBe(1);
    const output = stderr.join("");
    expect(output).toContain("GENERATE_OUTPUT_EXISTS");
    expect(output).toContain("경로: /tmp/out.json");
    expect(output).not.toContain("GENERATE_FAILED");
    // 남의 파일을 건드리지 않았고, 자기 임시 파일은 치웠다.
    expect(d.value.unlink).toHaveBeenCalledOnce();
    expect(normalizedEvents(d.events)).toContain("unlink");
  });
  it("커밋 실패가 EEXIST가 아니면 출력 충돌로 오인하지 않는다", async () => {
    const d = deps();
    const stderr: string[] = [];
    d.value.writeStderr = (text) => stderr.push(text);
    d.value.link = vi.fn(async () => {
      const error: NodeJS.ErrnoException = new Error("EXDEV: cross-device link");
      error.code = "EXDEV";
      throw error;
    });
    expect(await runGenerateCommand(argv, d.value)).toBe(1);
    const output = stderr.join("");
    expect(output).toContain("GENERATE_FAILED");
    expect(output).not.toContain("GENERATE_OUTPUT_EXISTS");
    expect(output).not.toContain("EXDEV");
  });
  it("임시 파일 이름은 실행마다 다르다", async () => {
    const opened: string[] = [];
    for (let run = 0; run < 2; run += 1) {
      const d = deps();
      await runGenerateCommand(argv, d.value);
      opened.push(d.events.find((event) => event.startsWith("open:")) ?? "");
    }
    expect(opened[0]).not.toBe(opened[1]);
    expect(opened[0]).toMatch(/^open:\/tmp\/\.out\.json\.ohmymcp\./);
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
      expect(d.value.link).not.toHaveBeenCalled();
    }
  });
  it("baseline 저장 경로의 fingerprint가 교체 전후로 동일하다", async () => {
    // 기대값은 cli의 옛 지역 구현이 내던 값이다. 문자열로 박아 두어 generate의 sha256으로
    // 갈아탄 뒤에도 같은 값이 나오는지 고정한다. 달라지면 승인 검증이 조용히 깨진다.
    const expected = "dd42ff3ee4b40db6ea0416a3c9794da2d8e599f661a3ee0d3c39179dd266152c";
    expect(fingerprint).toBe(expected);
    expect(sha256(suite)).toBe(expected);
    const d = deps();
    // finalize가 이 fingerprint를 내면 saveSuite의 재검증이 통과해야 한다.
    expect(await runGenerateCommand(argv, d.value)).toBe(0);
    expect(d.value.link).toHaveBeenCalledOnce();
  });
  it("저장된 suite의 fingerprint가 다르면 커밋하지 않는다", async () => {
    const d = deps({
      finalizeAuthoringDraft: vi.fn(
        () => ({ finalized: true, snapshot: { fingerprint: "다른값" } }) as never,
      ),
    });
    expect(await runGenerateCommand(argv, d.value)).toBe(1);
    expect(d.value.link).not.toHaveBeenCalled();
  });
  it("키 순서가 다른 동등한 suite는 같은 fingerprint를 낸다", () => {
    const permuted: TestSuiteSpec = {
      cases: [],
      defaultTimeoutMs: 10000,
      name: "Weather",
      id: "weather",
      schemaVersion: 1,
    };
    expect(sha256(permuted)).toBe(sha256(suite));
    expect(sha256(permuted)).toBe(fingerprint);
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
  it("저장하려는 경로에 파일이 있으면 경로와 조치를 안내한다", async () => {
    const d = reviewDeps(["save", "cancel"], [], [true]);
    d.value.exists = vi.fn(async () => true);
    await runGenerateCommand(interactiveArgv, d.value);
    const output = d.stderr.join("");
    expect(output).toContain("GENERATE_OUTPUT_EXISTS");
    expect(output).toContain("경로: /tmp/out.json");
    expect(output).toContain("--out");
    expect(output).not.toContain("GENERATE_SAVE_FAILED");
    expect(d.value.openTemp).not.toHaveBeenCalled();
  });
  it("경로 충돌이 아닌 저장 실패는 기존 문구를 유지한다", async () => {
    const d = reviewDeps(["save", "cancel"], [], [true]);
    d.value.openTemp = vi.fn(async () => {
      throw new Error("EACCES");
    });
    await runGenerateCommand(interactiveArgv, d.value);
    const output = d.stderr.join("");
    expect(output).toContain("GENERATE_SAVE_FAILED");
    expect(output).not.toContain("GENERATE_OUTPUT_EXISTS");
    expect(output).not.toContain("EACCES");
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
    expect(output).toContain("종료 코드: 1");
  });
  it("exitCode가 없으면 종료 코드 라벨 자체를 빼고 안내한다", async () => {
    const output = await failWith({ ...base, code: "nonZeroExit" });
    expect(output).toContain("GENERATE_PROVIDER_EXIT");
    expect(output).not.toContain("코드 undefined");
    expect(output).not.toContain("종료 코드:");
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

  /** provider와 모델을 지정해 실패를 태우고 stderr를 돌려준다. */
  async function failOn(
    providerId: "codex" | "claude",
    model: string,
    failure: Omit<PublicProviderFailure, "providerId">,
  ): Promise<string> {
    const d = reviewDeps([providerId, "cancel"], [model, "INSTRUCTION_PAYLOAD_TEXT"], [true]);
    const provider = { id: providerId, model, author: vi.fn() };
    d.value.providers = { codex: vi.fn(() => provider), claude: vi.fn(() => provider) };
    d.value.dispatchAuthoringRequest = vi.fn(async () => ({
      status: "providerFailed" as const,
      failure: { ...failure, providerId },
    }));
    await runGenerateCommand(interactiveArgv, d.value);
    return d.stderr.join("");
  }
  const exited = { code: "nonZeroExit" as const, timeoutMs: 120_000, exitCode: 1 };

  it("unknownModel이면 모델 이름과 기본값을 알려준다", async () => {
    const output = await failOn("codex", "gpt-nonexistent", {
      ...exited,
      reason: "unknownModel",
    });
    expect(output).toContain("GENERATE_PROVIDER_MODEL");
    expect(output).toContain("모델: gpt-nonexistent");
    expect(output).toContain("gpt-5.6-luna");
  });
  it("모델 이름 뒤에 조사를 붙이지 않는다", async () => {
    // 받침 있는 이름("넷")과 없는 이름("쿠"). 을/를을 고정하면 한쪽은 반드시 틀린다.
    for (const model of ["sonnet", "haiku"]) {
      const output = await failOn("claude", model, { ...exited, reason: "unknownModel" });
      expect(output).not.toContain("'을 사용할");
      expect(output).not.toContain("'를 사용할");
      expect(output).toContain(`모델: ${model}`);
    }
  });
  it("명령 뒤에 조사를 붙이지 않는다", async () => {
    for (const providerId of ["codex", "claude"] as const)
      for (const reason of ["notAuthenticated", undefined] as const) {
        const output = await failOn(providerId, "haiku", { ...exited, reason });
        expect(output).not.toContain("status`으로");
        expect(output).not.toContain("status`로");
        expect(output).toContain("` 명령으로");
      }
  });
  it("notAuthenticated면 provider에 맞는 인증 확인 명령만 안내한다", async () => {
    const codex = await failOn("codex", "gpt-5.6-luna", { ...exited, reason: "notAuthenticated" });
    expect(codex).toContain("GENERATE_PROVIDER_AUTH");
    expect(codex).toContain("codex login status");
    expect(codex).not.toContain("claude /status");
    const claude = await failOn("claude", "haiku", { ...exited, reason: "notAuthenticated" });
    expect(claude).toContain("GENERATE_PROVIDER_AUTH");
    expect(claude).toContain("claude /status");
    expect(claude).not.toContain("codex login status");
  });
  it("rateLimited면 재시도와 payload 축소를 안내한다", async () => {
    const output = await failOn("codex", "gpt-5.6-luna", { ...exited, reason: "rateLimited" });
    expect(output).toContain("GENERATE_PROVIDER_RATE_LIMIT");
    expect(output).toContain("잠시 뒤 다시 요청하세요");
    expect(output).toContain("payload");
  });
  it("badRequest면 모델과 schema 두 가지를 확인하도록 안내한다", async () => {
    const output = await failOn("codex", "gpt-weird", { ...exited, reason: "badRequest" });
    expect(output).toContain("GENERATE_PROVIDER_REQUEST");
    expect(output).toContain("schema");
    expect(output).toContain("gpt-weird");
    expect(output).toContain("gpt-5.6-luna");
  });
  it("serverError면 재시도를 안내한다", async () => {
    const output = await failOn("claude", "haiku", { ...exited, reason: "serverError" });
    expect(output).toContain("GENERATE_PROVIDER_SERVER");
    expect(output).toContain("잠시 뒤 다시 요청하세요");
  });
  it("reason이 없으면 기존 EXIT 문구에 모델을 붙여 안내한다", async () => {
    const output = await failOn("codex", "gpt-5.6-luna", exited);
    expect(output).toContain("GENERATE_PROVIDER_EXIT");
    expect(output).toContain("종료 코드: 1");
    expect(output).toContain("모델: gpt-5.6-luna");
    expect(output).toContain("codex login status");
    expect(output).not.toContain("claude /status");
  });
  it("exitCode가 없어도 provider에 맞는 명령과 모델 이름은 안내한다", async () => {
    const output = await failOn("claude", "haiku", { code: "nonZeroExit", timeoutMs: 120_000 });
    expect(output).toContain("GENERATE_PROVIDER_EXIT");
    expect(output).not.toContain("코드 undefined");
    expect(output).toContain("모델: haiku");
    expect(output).toContain("claude /status");
  });
  it("reason은 nonZeroExit 밖에서 무시된다", async () => {
    const output = await failOn("codex", "gpt-5.6-luna", {
      code: "timedOut",
      timeoutMs: 120_000,
      reason: "unknownModel",
    });
    expect(output).toContain("GENERATE_PROVIDER_TIMEOUT");
    expect(output).not.toContain("GENERATE_PROVIDER_MODEL");
  });
  it("어떤 reason에서도 prompt·stdout·stderr·stack·인증정보가 노출되지 않는다", async () => {
    const reasons: (PublicProviderFailure["reason"] | undefined)[] = [
      "notAuthenticated",
      "unknownModel",
      "rateLimited",
      "badRequest",
      "serverError",
      undefined,
    ];
    const outputs: string[] = [];
    for (const reason of reasons)
      outputs.push(
        await failOn("codex", "gpt-5.6-luna", {
          ...exited,
          reason,
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
    expect(d.value.link).not.toHaveBeenCalled();
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
      expect(d.value.link).not.toHaveBeenCalled();
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
  it("nodeReviewIO는 질문하기 전에는 readline을 만들지 않는다", async () => {
    // createInterface는 만드는 즉시 입력 스트림에 리스너를 건다. 리스너 수가 곧 생성 여부다.
    // EOF로 끝나는 스트림은 만들자마자 닫혀 리스너가 사라지므로 열린 채로 두는 스트림을 쓴다.
    const input = new Readable({ read: () => undefined });
    const output = new Writable({ write: (_chunk, _encoding, callback) => callback() });
    const listeners = () => input.listenerCount("data") + input.listenerCount("end");
    const before = listeners();
    const io = nodeReviewIO(input, output);
    expect(listeners()).toBe(before);
    // 만들지 않았으므로 닫을 것도 없다.
    expect(() => io.close?.()).not.toThrow();
    const pending = io.input("질문: ");
    expect(listeners()).toBeGreaterThan(before);
    io.close?.();
    await expect(pending).rejects.toBeInstanceOf(Error);
  });
  it("baseline-only는 reviewIO에 아무것도 묻지 않는다", async () => {
    const d = deps();
    const io = {
      interactive: true,
      choose: vi.fn(),
      input: vi.fn(),
      confirm: vi.fn(),
      write: vi.fn(),
      close: vi.fn(),
    };
    d.value.reviewIO = io as never;
    expect(await runGenerateCommand([...interactiveArgv, "--baseline-only"], d.value)).toBe(0);
    expect(io.choose).not.toHaveBeenCalled();
    expect(io.input).not.toHaveBeenCalled();
    expect(io.confirm).not.toHaveBeenCalled();
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
