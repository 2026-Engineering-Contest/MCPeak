import type { McpStdioConnection } from "@ohmymcp/core";
import type { RunnerExecution, RunnerReport, TestSuiteSpec } from "@ohmymcp/runner";
import { describe, expect, it, vi } from "vitest";
import { parseTestCommand, runCli, type TestCommandDependencies } from "../src/test-command.js";

const suite: TestSuiteSpec = { schemaVersion: 1, id: "suite", name: "Suite", cases: [] };
const report = (status: RunnerReport["status"] = "passed"): RunnerReport => ({
  schemaVersion: 1,
  suite: { id: "suite", name: "Suite" },
  status,
  cases: [],
  summary: { total: 0, passed: 0, failed: 0, timedOut: 0, cancelled: 0, notRun: 0 },
});
/** 주입한 renderReport 가 돌려주는 값. 렌더링 문안은 runner 의 reporter.test.ts 가 고정한다. */
const RENDERED = "렌더링 결과\n";
const connection = (): McpStdioConnection => ({
  client: {
    listTools: async () => [],
    callTool: async () => ({ content: [], isError: false, raw: null }),
    close: async () => {},
  },
  getDiagnostics: () => ({
    state: "open",
    pid: null,
    exitCode: null,
    signal: null,
    stderr: "",
    stderrTruncated: false,
  }),
  close: vi.fn(async () => {}),
  forceClose: vi.fn(async () => {}),
});
function deps(overrides: Partial<TestCommandDependencies> = {}) {
  const writes = { out: [] as string[], err: [] as string[], events: [] as string[] };
  const conn = connection();
  const execution: RunnerExecution = {
    report: Promise.resolve(report()),
    drain: Promise.resolve({ status: "settled" }),
  };
  const value: TestCommandDependencies = {
    readFile: vi.fn(async () => new TextEncoder().encode(JSON.stringify(suite))),
    validateSuite: vi.fn(() => ({ valid: true as const, value: suite })),
    connect: vi.fn(async () => {
      writes.events.push("connect");
      return conn;
    }),
    startRunner: vi.fn(() => {
      writes.events.push("start");
      return execution;
    }),
    finalize: vi.fn(async () => {
      writes.events.push("finalize");
      return report();
    }),
    renderReport: vi.fn(() => RENDERED),
    colorEnabled: false,
    writeStdout: (text) => writes.out.push(text),
    writeStderr: (text) => writes.err.push(text),
    ...overrides,
  };
  return { value, writes, conn, execution };
}

describe("parseTestCommand", () => {
  it("test 명세, command와 반복 arg를 입력 순서대로 파싱한다", () => {
    const input = parseTestCommand(["suite.json", "--command", "node", "--arg", "a", "--arg", "b"]);
    expect(input).toEqual({
      suitePath: "suite.json",
      command: "node",
      args: ["a", "b"],
      json: false,
    });
    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(input.args)).toBe(true);
  });
  it("equals 형식과 하이픈·빈 문자열 arg를 보존한다", () => {
    expect(parseTestCommand(["suite.json", "--command=node", "--arg=-m", "--arg="])).toEqual({
      suitePath: "suite.json",
      command: "node",
      args: ["-m", ""],
      json: false,
    });
  });
  it("parseTestCommand가 json 기본값 false를 낸다", () => {
    expect(parseTestCommand(["suite.json", "--command", "node"]).json).toBe(false);
  });
  it("parseTestCommand가 json true를 낸다", () => {
    expect(parseTestCommand(["suite.json", "--command", "node", "--json"]).json).toBe(true);
  });
});

describe("runCli", () => {
  it("각 사용법 오류를 고정 message와 usage hint로 출력하고 읽기 전에 종료한다", async () => {
    const cases: ReadonlyArray<readonly [readonly string[], string]> = [
      [[], "실행할 CLI 명령이 없습니다."],
      [["test"], "테스트 명세 JSON 경로가 필요합니다."],
      [["test", "suite.json"], "`--command` 옵션이 필요합니다."],
      [
        ["test", "suite.json", "--command", "a", "--command", "b"],
        "`--command`는 한 번만 사용할 수 있습니다.",
      ],
      [["test", "suite.json", "--command"], "`--command` 옵션 값이 필요합니다."],
      [["test", "suite.json", "--command", "a", "--arg"], "`--arg` 옵션 값이 필요합니다."],
      [["test", "x.json", "--command", "a", "--arg", "-m"], "`--arg` 옵션 값이 필요합니다."],
      [["test", "suite.json", "--command", "a", "--wat"], "지원하지 않는 test 옵션 '--wat'입니다."],
      [
        ["test", "suite.json", "--command", "a", "extra"],
        "추가 위치 인자 'extra'는 허용되지 않습니다.",
      ],
    ];
    for (const [argv, message] of cases) {
      const d = deps();
      expect(await runCli(argv, d.value)).toBe(1);
      expect(d.writes.out).toEqual([]);
      expect(d.writes.err.join("")).toBe(
        `오류 [CLI_USAGE]: ${message}\n해결: 사용법: ohmymcp test <suite.json> --command <executable> [--arg <value> ...]\n`,
      );
      expect(d.value.readFile).not.toHaveBeenCalled();
      expect(d.value.connect).not.toHaveBeenCalled();
    }
  });
  it("중복 command, 값 없는 option, 알 수 없는 option과 추가 위치 인자를 거절한다", async () => {
    for (const argv of [
      ["test", "x.json", "--command", "a", "--command", "b"],
      ["test", "x.json", "--command"],
      ["test", "x.json", "--command", "a", "--arg"],
      ["test", "x.json", "--command", "a", "--wat"],
      ["test", "x.json", "--command", "a", "extra"],
    ]) {
      const d = deps();
      expect(await runCli(argv, d.value)).toBe(1);
      expect(d.writes.err.join("")).toContain("CLI_USAGE");
      expect(d.value.readFile).not.toHaveBeenCalled();
    }
  });
  it("아직 구현되지 않은 알려진 명령과 제어 문자를 구분한다", async () => {
    const known = deps();
    await runCli(["generate"], known.value);
    expect(known.writes.err.join("")).toContain("COMMAND_NOT_IMPLEMENTED");
    const unknown = deps();
    await runCli(["bad\n\u001b"], unknown.value);
    expect(unknown.writes.err.join("")).toContain("\\u000a");
    expect(unknown.writes.err.join("")).toContain("\\u001b");
  });
  it("C1 제어 문자도 이스케이프한다", async () => {
    // U+009B 는 8비트 CSI 다. 렌더러의 escapeTerminalText 와 같은 범위를 막아야 한다.
    const d = deps();
    await runCli([`bad${String.fromCodePoint(0x9b)}`], d.value);
    expect(d.writes.err.join("")).toContain("\\u009b");
    expect(d.writes.err.join("")).not.toContain(String.fromCodePoint(0x9b));
  });
  it("JSON이 아닌 확장자를 파일 읽기 전에 거절하고 대문자 JSON은 그대로 읽는다", async () => {
    for (const path of ["suite.ts", "suite.js", "suite.yaml"]) {
      const d = deps();
      await runCli(["test", path, "--command", "node"], d.value);
      expect(d.value.readFile).not.toHaveBeenCalled();
      expect(d.value.connect).not.toHaveBeenCalled();
    }
    const d = deps();
    await runCli(["test", "relative/SUITE.JSON", "--command", "node"], d.value);
    expect(d.value.readFile).toHaveBeenCalledWith("relative/SUITE.JSON");
  });
  it("read, UTF-8, JSON parse와 validation 실패를 connect 전에 구분한다", async () => {
    const cases: Array<[Partial<TestCommandDependencies>, string]> = [
      [
        {
          readFile: async () => {
            throw new Error("SECRET_STACK");
          },
        },
        "SUITE_READ_FAILED",
      ],
      [{ readFile: async () => new Uint8Array([0xc3, 0x28]) }, "SUITE_ENCODING_INVALID"],
      [{ readFile: async () => new TextEncoder().encode("{") }, "SUITE_JSON_INVALID"],
      [
        {
          validateSuite: () => ({
            valid: false,
            issues: [{ code: "INVALID_VALUE", path: "x\n\u001b", message: "bad\t", hint: "fix\r" }],
          }),
        },
        "SUITE_VALIDATION_FAILED",
      ],
    ];
    for (const [override, code] of cases) {
      const d = deps(override);
      await runCli(["test", "x.json", "--command", "node"], d.value);
      expect(d.writes.err.join("")).toContain(code);
      expect(d.value.connect).not.toHaveBeenCalled();
    }
  });
  it("검증된 suite를 같은 client로 connect, Runner, finalizer 순서로 조립한다", async () => {
    const d = deps();
    await runCli(["test", "x.json", "--command", "node", "--arg", "server.mjs"], d.value);
    expect(d.writes.events).toEqual(["connect", "start", "finalize"]);
    expect(d.value.connect).toHaveBeenCalledWith({ command: "node", args: ["server.mjs"] });
    expect(d.value.startRunner).toHaveBeenCalledWith({ client: d.conn.client, suite });
    expect(
      (d.value.finalize as ReturnType<typeof vi.fn>).mock.calls.at(0)?.at(0).shutdown.client,
    ).toBe(d.conn.client);
  });
  it("통과, 실패와 중단 report를 stdout으로만 출력한다", async () => {
    for (const status of ["passed", "failed", "aborted"] as const) {
      const d = deps({ finalize: async () => report(status) });
      expect(await runCli(["test", "x.json", "--command", "node", "--json"], d.value)).toBe(
        status === "passed" ? 0 : 1,
      );
      expect(d.writes.out.join("")).toBe(`${JSON.stringify(report(status), null, 2)}\n`);
      expect(d.writes.err).toEqual([]);
    }
  });
  it("--json 없이 renderReport 결과를 stdout에 쓴다", async () => {
    const d = deps();
    await runCli(["test", "x.json", "--command", "node"], d.value);
    expect(d.writes.out.join("")).toBe(RENDERED);
    expect(d.writes.err).toEqual([]);
  });
  it("--json이면 기존 JSON 바이트를 쓴다", async () => {
    const d = deps();
    await runCli(["test", "x.json", "--command", "node", "--json"], d.value);
    expect(d.writes.out.join("")).toBe(`${JSON.stringify(report(), null, 2)}\n`);
  });
  it("--json이면 renderReport를 호출하지 않는다", async () => {
    const d = deps();
    await runCli(["test", "x.json", "--command", "node", "--json"], d.value);
    expect(d.value.renderReport).not.toHaveBeenCalled();
  });
  it("colorEnabled를 renderReport에 그대로 넘긴다", async () => {
    const d = deps({ colorEnabled: true });
    await runCli(["test", "x.json", "--command", "node"], d.value);
    expect(d.value.renderReport).toHaveBeenCalledWith(report(), { color: true });
  });
  it("colorEnabled가 false면 그대로 넘긴다", async () => {
    const d = deps({ colorEnabled: false });
    await runCli(["test", "x.json", "--command", "node"], d.value);
    expect(d.value.renderReport).toHaveBeenCalledWith(report(), { color: false });
  });
  it("--json을 두 번 쓰면 거절한다", async () => {
    const d = deps();
    expect(await runCli(["test", "x.json", "--command", "node", "--json", "--json"], d.value)).toBe(
      1,
    );
    expect(d.writes.err.join("")).toContain("`--json`은 한 번만 사용할 수 있습니다.");
  });
  it("--json=true를 거절한다", async () => {
    const d = deps();
    expect(await runCli(["test", "x.json", "--command", "node", "--json=true"], d.value)).toBe(1);
    expect(d.writes.err.join("")).toContain("`--json`은 값을 받지 않습니다.");
  });
  it("--json은 순서와 무관하다", async () => {
    const before = deps();
    await runCli(["test", "x.json", "--json", "--command", "node"], before.value);
    const after = deps();
    await runCli(["test", "x.json", "--command", "node", "--json"], after.value);
    expect(before.writes.out.join("")).toBe(after.writes.out.join(""));
  });
  it("종료 코드는 --json 여부와 무관하다", async () => {
    const plain = deps({ finalize: async () => report("failed") });
    expect(await runCli(["test", "x.json", "--command", "node"], plain.value)).toBe(1);
    const json = deps({ finalize: async () => report("failed") });
    expect(await runCli(["test", "x.json", "--command", "node", "--json"], json.value)).toBe(1);
  });
  it("renderReport가 던지면 CLI_INTERNAL_ERROR가 된다", async () => {
    const d = deps({
      renderReport: () => {
        throw new Error("RENDER_SECRET_STACK");
      },
    });
    expect(await runCli(["test", "x.json", "--command", "node"], d.value)).toBe(1);
    expect(d.writes.err.join("")).toContain("CLI_INTERNAL_ERROR");
    expect(d.writes.err.join("")).not.toContain("RENDER_SECRET_STACK");
    expect(d.writes.out).toEqual([]);
  });
  it("Core 오류만 안전하게 연결 실패로 출력한다", async () => {
    const error = {
      name: "McpClientError" as const,
      code: "PROCESS_START_FAILED",
      message: "연결 실패",
      hint: "설정을 확인하세요.",
      diagnostics: { stderr: "SECRET_STDERR" },
      cause: new Error("SECRET_CAUSE"),
    };
    const d = deps({
      connect: async () => {
        throw new AggregateError([new Error("noise"), error], "outer");
      },
    });
    await runCli(["test", "x.json", "--command", "secret-command"], d.value);
    const text = d.writes.err.join("");
    expect(text).toContain("MCP_CONNECTION_FAILED/PROCESS_START_FAILED");
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("secret-command");
  });
  it("Runner 시작 실패에는 force cleanup만 하고 finalizer 실패 뒤 추가 종료하지 않는다", async () => {
    const start = deps({
      startRunner: () => {
        throw new Error("start");
      },
    });
    await runCli(["test", "x.json", "--command", "node"], start.value);
    expect(start.conn.forceClose).toHaveBeenCalledTimes(1);
    expect(start.conn.close).not.toHaveBeenCalled();
    expect(start.value.finalize).not.toHaveBeenCalled();
    const finish = deps({
      finalize: async () => {
        throw new Error("finish");
      },
    });
    await runCli(["test", "x.json", "--command", "node"], finish.value);
    expect(finish.conn.close).not.toHaveBeenCalled();
    expect(finish.conn.forceClose).not.toHaveBeenCalled();
    expect(finish.writes.out).toEqual([]);
    expect(finish.writes.err.join("")).toContain("RUNNER_FINALIZATION_FAILED");
  });
  it("validation issue 전부를 입력 순서와 안전한 escape로 출력한다", async () => {
    const issues = [
      {
        code: "INVALID_VALUE" as const,
        path: "cases\nfirst",
        message: "message\rfirst",
        hint: "hint\tfirst",
      },
      {
        code: "UNKNOWN_FIELD" as const,
        path: "cases\u001bsecond",
        message: "message\u2028second",
        hint: "hint\u2029second",
      },
    ];
    const d = deps({ validateSuite: () => ({ valid: false, issues }) });
    await runCli(["test", "x.json", "--command", "node"], d.value);
    expect(d.writes.err.join("")).toBe(
      "오류 [SUITE_VALIDATION_FAILED]: MCP 테스트 명세가 유효하지 않습니다.\n해결: 아래 명세 오류를 모두 수정하세요.\n- [INVALID_VALUE] cases\\u000afirst: message\\u000dfirst\n  해결: hint\\u0009first\n- [UNKNOWN_FIELD] cases\\u001bsecond: message\\u2028second\n  해결: hint\\u2029second\n",
    );
    expect(d.value.connect).not.toHaveBeenCalled();
  });
  it("direct, nested, 순환 AggregateError에서 DFS 첫 Core 오류를 사용한다", async () => {
    const first = {
      name: "McpClientError" as const,
      code: "PROCESS_START_FAILED",
      message: "process",
      hint: "hint",
    };
    const later = {
      name: "McpClientError" as const,
      code: "HANDSHAKE_FAILED",
      message: "handshake",
      hint: "hint",
    };
    const cyclic = new AggregateError([], "cyclic");
    cyclic.errors.push(cyclic, later);
    const errors: ReadonlyArray<readonly [unknown, string]> = [
      [first, "PROCESS_START_FAILED"],
      [
        new AggregateError(
          [new Error("noise"), new AggregateError([first, later], "inner"), later],
          "outer",
        ),
        "PROCESS_START_FAILED",
      ],
      [cyclic, "HANDSHAKE_FAILED"],
    ];
    for (const [error, expectedCode] of errors) {
      const d = deps({ connect: async () => Promise.reject(error) });
      await runCli(["test", "x.json", "--command", "node"], d.value);
      expect(d.writes.err.join("")).toContain(`MCP_CONNECTION_FAILED/${expectedCode}`);
    }
  });
  it("Core 오류가 없는 arbitrary와 undefined 연결 reject는 일반 dictionary를 사용한다", async () => {
    for (const rejection of [new Error("SECRET_STACK"), undefined]) {
      const d = deps({ connect: async () => Promise.reject(rejection) });
      await runCli(["test", "x.json", "--command", "node"], d.value);
      expect(d.writes.err.join("")).toBe(
        "오류 [MCP_CONNECTION_FAILED]: MCP 서버 연결에 실패했습니다.\n해결: command 실행 가능 여부와 stdio MCP 서버 설정을 확인하세요.\n",
      );
    }
  });
  it("startRunner와 forceClose가 함께 실패해도 primary 실행 오류만 출력한다", async () => {
    const d = deps({
      startRunner: () => {
        throw new Error("START_SECRET");
      },
    });
    d.conn.forceClose = vi.fn(async () => {
      throw new Error("CLEANUP_SECRET");
    });
    await runCli(["test", "x.json", "--command", "node"], d.value);
    expect(d.writes.err.join("")).toBe(
      "오류 [RUNNER_EXECUTION_FAILED]: Runner 실행을 시작하지 못했습니다.\n해결: 테스트 명세와 Runner 설정을 확인하세요.\n",
    );
    expect(d.writes.out).toEqual([]);
    expect(d.conn.forceClose).toHaveBeenCalledTimes(1);
  });
  it("read 실패에는 native secret, stack과 absolute path를 출력하지 않는다", async () => {
    const d = deps({
      readFile: async () => Promise.reject(new Error("SECRET /absolute/path Error: stack")),
    });
    await runCli(["test", "relative.json", "--command", "node"], d.value);
    const text = d.writes.err.join("");
    expect(text).toContain("SUITE_READ_FAILED");
    expect(text).not.toMatch(/SECRET|absolute|Error:|stack/);
  });
  it("validator가 반환한 valid suite reference를 startRunner에 그대로 전달한다", async () => {
    const validSuite: TestSuiteSpec = {
      schemaVersion: 1,
      id: "reference",
      name: "Reference",
      cases: [],
    };
    const d = deps({ validateSuite: () => ({ valid: true, value: validSuite }) });
    await runCli(["test", "x.json", "--command", "node"], d.value);
    expect((d.value.startRunner as ReturnType<typeof vi.fn>).mock.calls.at(0)?.at(0).suite).toBe(
      validSuite,
    );
  });
  it("분류되지 않은 output dependency 실패를 stack 없이 CLI_INTERNAL_ERROR로 정규화한다", async () => {
    const d = deps({
      writeStdout: () => {
        throw new Error("OUTPUT_SECRET_STACK");
      },
    });
    await runCli(["test", "x.json", "--command", "node"], d.value);
    expect(d.writes.err.join("")).toBe(
      "오류 [CLI_INTERNAL_ERROR]: 예상하지 못한 CLI 내부 오류가 발생했습니다.\n해결: 다시 실행한 뒤 재현 정보와 함께 이슈를 보고하세요.\n",
    );
    expect(d.writes.err.join("")).not.toContain("OUTPUT_SECRET_STACK");
  });
});
