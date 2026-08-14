import type { McpStdioConnection, ToolDef } from "@ohmymcp/core";
import type {
  RunnerExecution,
  RunnerReport,
  TestCaseResult,
  TestCaseSpec,
  TestSuiteSpec,
} from "@ohmymcp/runner";
import { suiteFingerprint } from "@ohmymcp/runner";
import { describe, expect, it, vi } from "vitest";
import { parseTestCommand, runCli, type TestCommandDependencies } from "../src/test-command.js";

const suite: TestSuiteSpec = { schemaVersion: 1, id: "suite", name: "Suite", cases: [] };
/**
 * 지문은 상수로 박지 않고 계산해서 쓴다. 위 명세 리터럴이 바뀌면 단언도 같이 깨져야 한다.
 * approval 은 계산에서 제외되므로 approval 을 붙인 명세도 같은 값을 낸다.
 */
const fingerprint = suiteFingerprint(suite);
const WRONG_FINGERPRINT = "0".repeat(64);
const approvedSuite = (approvalFingerprint: string): TestSuiteSpec => ({
  ...suite,
  approval: { fingerprint: approvalFingerprint },
});
/**
 * 지문이 없는 기본 명세로 --json 을 돌렸을 때의 spec 블록.
 * `findings` 는 억제 규칙과 무관하게 항상 있으므로 빈 배열도 들어간다. 키 순서는 구현의
 * 삽입 순서와 같아야 한다. jsonOut 이 문자열을 그대로 비교한다.
 */
const absentSpec = { approval: "absent", fingerprint, findings: [] };
const jsonOut = (value: RunnerReport, spec: unknown = absentSpec): string =>
  `${JSON.stringify({ ...value, spec }, null, 2)}\n`;
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
type Diagnostics = ReturnType<McpStdioConnection["getDiagnostics"]>;
/** 진단 시나리오용. 지정하지 않은 필드는 정상 종료값이다. */
const diagnostics = (overrides: Partial<Diagnostics> = {}): Diagnostics => ({
  stderr: "",
  stderrTruncated: false,
  exitCode: 0,
  signal: null,
  ...overrides,
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
      stderrLines: 20,
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
      stderrLines: 20,
    });
  });
  it("parseTestCommand가 json 기본값 false를 낸다", () => {
    expect(parseTestCommand(["suite.json", "--command", "node"]).json).toBe(false);
  });
  it("parseTestCommand가 json true를 낸다", () => {
    expect(parseTestCommand(["suite.json", "--command", "node", "--json"]).json).toBe(true);
  });
  it("--stderr-lines 를 파싱한다", () => {
    expect(
      parseTestCommand(["suite.json", "--command", "node", "--stderr-lines", "5"]).stderrLines,
    ).toBe(5);
  });
  it("--stderr-lines=N 형태를 파싱한다", () => {
    expect(
      parseTestCommand(["suite.json", "--command", "node", "--stderr-lines=5"]).stderrLines,
    ).toBe(5);
  });
  it("기본값은 20 이다", () => {
    expect(parseTestCommand(["suite.json", "--command", "node"]).stderrLines).toBe(20);
  });
  it("0 을 허용한다", () => {
    expect(
      parseTestCommand(["suite.json", "--command", "node", "--stderr-lines", "0"]).stderrLines,
    ).toBe(0);
  });
  it("값이 없으면 CLI_USAGE 로 실패한다", () => {
    expect(() => parseTestCommand(["suite.json", "--command", "node", "--stderr-lines"])).toThrow(
      "`--stderr-lines` 옵션 값이 필요합니다.",
    );
  });
  it("중복 지정을 거절한다", () => {
    expect(() =>
      parseTestCommand([
        "suite.json",
        "--command",
        "node",
        "--stderr-lines",
        "5",
        "--stderr-lines",
        "6",
      ]),
    ).toThrow("`--stderr-lines`는 한 번만 사용할 수 있습니다.");
  });
  it("정수가 아니면 거절한다", () => {
    for (const value of ["1.5", "abc", ""])
      expect(() =>
        parseTestCommand(["suite.json", "--command", "node", "--stderr-lines", value]),
      ).toThrow("`--stderr-lines` 값은 0 이상의 정수여야 합니다.");
  });
  it("음수를 거절한다", () => {
    expect(() =>
      parseTestCommand(["suite.json", "--command", "node", "--stderr-lines", "-1"]),
    ).toThrow("`--stderr-lines` 값은 0 이상의 정수여야 합니다.");
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
        `오류 [CLI_USAGE]: ${message}\n해결: 사용법: ohmymcp test <suite.json> --command <executable> [--arg <value> ...] [--json] [--stderr-lines <N>]\n`,
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
      expect(d.writes.out.join("")).toBe(jsonOut(report(status)));
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
    expect(d.writes.out.join("")).toBe(jsonOut(report()));
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
  it("실패가 있으면 stderr 에 진단 블록을 쓴다", async () => {
    const d = deps({ finalize: async () => report("failed") });
    d.conn.getDiagnostics = () => diagnostics({ exitCode: 1, stderr: "boom\n" });
    expect(await runCli(["test", "x.json", "--command", "node"], d.value)).toBe(1);
    const text = d.writes.err.join("");
    expect(text).toContain("서버 프로세스 진단");
    expect(text).toContain("종료 코드: 1");
    expect(text).toContain("boom");
  });
  it("전부 통과하고 정상 종료면 아무것도 쓰지 않는다", async () => {
    const d = deps();
    d.conn.getDiagnostics = () => diagnostics({ exitCode: 0, signal: null });
    expect(await runCli(["test", "x.json", "--command", "node"], d.value)).toBe(0);
    expect(d.writes.err).toEqual([]);
  });
  it("실패해도 진단이 비어 있으면 쓰지 않는다", async () => {
    const d = deps({ finalize: async () => report("failed") });
    d.conn.getDiagnostics = () =>
      diagnostics({ stderr: "", stderrTruncated: false, exitCode: 0, signal: null });
    expect(await runCli(["test", "x.json", "--command", "node"], d.value)).toBe(1);
    expect(d.writes.err).toEqual([]);
  });
  it("전부 통과여도 비정상 종료면 쓴다", async () => {
    const d = deps();
    d.conn.getDiagnostics = () => diagnostics({ exitCode: null, signal: "SIGSEGV" });
    expect(await runCli(["test", "x.json", "--command", "node"], d.value)).toBe(0);
    expect(d.writes.err.join("")).toContain("시그널: SIGSEGV");
  });
  it("--stderr-lines 0 이면 실패해도 쓰지 않는다", async () => {
    const d = deps({ finalize: async () => report("failed") });
    d.conn.getDiagnostics = () => diagnostics({ exitCode: 1, stderr: "boom\n" });
    expect(
      await runCli(["test", "x.json", "--command", "node", "--stderr-lines", "0"], d.value),
    ).toBe(1);
    expect(d.writes.err).toEqual([]);
  });
  it("--json 의 stdout 을 바꾸지 않는다", async () => {
    const d = deps({ finalize: async () => report("failed") });
    d.conn.getDiagnostics = () => diagnostics({ exitCode: 1, stderr: "boom\n" });
    await runCli(["test", "x.json", "--command", "node", "--json"], d.value);
    expect(d.writes.out.join("")).toBe(jsonOut(report("failed")));
    expect(() => JSON.parse(d.writes.out.join(""))).not.toThrow();
    expect(d.writes.err.join("")).toContain("서버 프로세스 진단");
  });
  it("RUNNER_EXECUTION_FAILED 경로에도 붙인다", async () => {
    const d = deps({
      startRunner: () => {
        throw new Error("start");
      },
    });
    d.conn.getDiagnostics = () => diagnostics({ exitCode: 1, stderr: "boom\n" });
    expect(await runCli(["test", "x.json", "--command", "node"], d.value)).toBe(1);
    const text = d.writes.err.join("");
    expect(text).toContain("RUNNER_EXECUTION_FAILED");
    expect(text).toContain("서버 프로세스 진단");
  });
  it("실행 실패 경로는 forceClose 이전 진단을 쓴다", async () => {
    const d = deps({
      startRunner: () => {
        throw new Error("start");
      },
    });
    // forceClose 는 우리가 SIGKILL 을 보내는 경로다. 그 뒤의 값을 쓰면 서버 탓으로 오인시킨다.
    let killed = false;
    d.conn.forceClose = vi.fn(async () => {
      killed = true;
    });
    d.conn.getDiagnostics = () =>
      killed
        ? diagnostics({ exitCode: null, signal: "SIGKILL", stderr: "boom\n" })
        : diagnostics({ exitCode: null, signal: null, stderr: "boom\n" });
    expect(await runCli(["test", "x.json", "--command", "node"], d.value)).toBe(1);
    expect(d.conn.forceClose).toHaveBeenCalledTimes(1);
    const text = d.writes.err.join("");
    expect(text).toContain("종료 코드: 없음  시그널: 없음");
    expect(text).not.toContain("SIGKILL");
  });
  it("실행 실패 경로의 사전 스냅샷이 실패하면 다시 읽지 않는다", async () => {
    const d = deps({
      startRunner: () => {
        throw new Error("start");
      },
    });
    // 첫 호출(forceClose 이전)은 던지고, 두 번째는 우리가 죽인 뒤의 값을 준다.
    // 다시 읽으면 그 값이 출력돼 서버 탓으로 오인시킨다.
    let calls = 0;
    d.conn.getDiagnostics = () => {
      calls += 1;
      if (calls === 1) throw new Error("diagnostics unavailable");
      return diagnostics({ exitCode: null, signal: "SIGKILL", stderr: "boom\n" });
    };
    expect(await runCli(["test", "x.json", "--command", "node"], d.value)).toBe(1);
    const text = d.writes.err.join("");
    expect(text).toContain("RUNNER_EXECUTION_FAILED");
    expect(text).not.toContain("서버 프로세스 진단");
    expect(calls).toBe(1);
  });
  it("RUNNER_FINALIZATION_FAILED 경로에도 붙인다", async () => {
    const d = deps({
      finalize: async () => {
        throw new Error("finish");
      },
    });
    d.conn.getDiagnostics = () => diagnostics({ exitCode: 1, stderr: "boom\n" });
    expect(await runCli(["test", "x.json", "--command", "node"], d.value)).toBe(1);
    const text = d.writes.err.join("");
    expect(text).toContain("RUNNER_FINALIZATION_FAILED");
    expect(text).toContain("서버 프로세스 진단");
  });
  it("연결 실패 오류에 담긴 진단을 쓴다", async () => {
    const d = deps({
      connect: async () =>
        Promise.reject({
          name: "McpClientError" as const,
          code: "PROCESS_EXITED",
          message: "요청 완료 전 MCP 서버가 종료되었습니다.",
          hint: "exit code, signal, bounded stderr를 확인하세요.",
          diagnostics: {
            stderr: "ERR_MODULE_NOT_FOUND\n",
            stderrTruncated: false,
            exitCode: 1,
            signal: null,
          },
        }),
    });
    expect(await runCli(["test", "x.json", "--command", "node"], d.value)).toBe(1);
    const text = d.writes.err.join("");
    expect(text).toContain("MCP_CONNECTION_FAILED/PROCESS_EXITED");
    expect(text).toContain("ERR_MODULE_NOT_FOUND");
  });
  it("진단이 비어 있으면 연결 실패에 블록을 붙이지 않는다", async () => {
    const d = deps({
      connect: async () =>
        Promise.reject({
          name: "McpClientError" as const,
          code: "PROCESS_START_FAILED",
          message: "MCP 서버 프로세스를 시작하지 못했습니다.",
          hint: "command 실행 권한을 확인하세요.",
          diagnostics: { stderr: "", stderrTruncated: false, exitCode: null, signal: null },
        }),
    });
    expect(await runCli(["test", "x.json", "--command", "node"], d.value)).toBe(1);
    const text = d.writes.err.join("");
    expect(text).toContain("MCP_CONNECTION_FAILED/PROCESS_START_FAILED");
    expect(text).not.toContain("서버 프로세스 진단");
  });
  it("McpClientError 가 아닌 거절에는 붙지 않는다", async () => {
    const d = deps({ connect: async () => Promise.reject(new Error("boom")) });
    expect(await runCli(["test", "x.json", "--command", "node"], d.value)).toBe(1);
    expect(d.writes.err.join("")).not.toContain("서버 프로세스 진단");
  });
  it("오류 메시지와 진단 사이에 빈 줄을 둔다", async () => {
    const d = deps({
      startRunner: () => {
        throw new Error("start");
      },
    });
    d.conn.getDiagnostics = () => diagnostics({ exitCode: 1, stderr: "boom\n" });
    await runCli(["test", "x.json", "--command", "node"], d.value);
    expect(d.writes.err.join("")).toContain("\n\n서버 프로세스 진단");
  });
  it("종료 코드는 진단 유무와 무관하다", async () => {
    const passed = deps();
    passed.conn.getDiagnostics = () => diagnostics({ exitCode: null, signal: "SIGSEGV" });
    expect(await runCli(["test", "x.json", "--command", "node"], passed.value)).toBe(0);
    expect(passed.writes.err.join("")).toContain("서버 프로세스 진단");
    const failed = deps({ finalize: async () => report("failed") });
    failed.conn.getDiagnostics = () => diagnostics({ exitCode: 1, stderr: "boom\n" });
    expect(await runCli(["test", "x.json", "--command", "node"], failed.value)).toBe(1);
    expect(failed.writes.err.join("")).toContain("서버 프로세스 진단");
  });
});

describe("승인 지문 대조 표시", () => {
  /** 지문 시나리오는 validateSuite 가 돌려주는 명세에 approval 을 붙이거나 빼서 만든다. */
  const specDeps = (value: TestSuiteSpec, status: RunnerReport["status"] = "passed") =>
    deps({
      validateSuite: vi.fn(() => ({ valid: true as const, value })),
      finalize: async () => report(status),
    });
  const runText = async (value: TestSuiteSpec, status: RunnerReport["status"] = "passed") => {
    const d = specDeps(value, status);
    const code = await runCli(["test", "x.json", "--command", "node"], d.value);
    return { code, out: d.writes.out.join(""), err: d.writes.err.join("") };
  };

  it("전부 통과 + 지문 일치면 stdout 에 명세 줄이 없다", async () => {
    expect((await runText(approvedSuite(fingerprint))).out).not.toContain("명세:");
  });
  it("전부 통과 + 지문 없음이면 stdout 에 명세 줄이 없다", async () => {
    expect((await runText(suite)).out).not.toContain("명세:");
  });
  it("전부 통과 + 지문 불일치면 변경 사실을 알린다", async () => {
    expect((await runText(approvedSuite(WRONG_FINGERPRINT))).out).toContain(
      "승인 시점 이후 변경됨",
    );
  });
  it("실패가 있으면 지문이 일치해도 알린다", async () => {
    expect((await runText(approvedSuite(fingerprint), "failed")).out).toContain("승인 시점과 동일");
  });
  it("실패가 있으면 지문이 없다는 사실도 알린다", async () => {
    expect((await runText(suite, "failed")).out).toContain("승인 지문이 없습니다 (미고정)");
  });
  it("실패 + 지문 불일치면 승인 값과 현재 값을 각각 앞 12자로 찍는다", async () => {
    const { out } = await runText(approvedSuite(WRONG_FINGERPRINT), "failed");
    expect(out).toContain(
      `승인 ${WRONG_FINGERPRINT.slice(0, 12)}…   현재 ${fingerprint.slice(0, 12)}…`,
    );
    expect(out).not.toContain(WRONG_FINGERPRINT);
    expect(out).not.toContain(fingerprint);
  });
  it("명세 줄은 보고서 뒤에 오고 그 앞에 빈 줄이 하나 있다", async () => {
    const { out } = await runText(suite, "failed");
    expect(out.startsWith(RENDERED)).toBe(true);
    expect(out).toBe(
      `${RENDERED}\n명세: 승인 지문이 없습니다 (미고정)\n  → ohmymcp generate 로 승인한 명세가 아니거나 승인 이전 버전으로 만든 파일입니다.\n`,
    );
  });
  it("명세 줄은 stdout 이고 stderr 에 없다", async () => {
    const { err } = await runText(approvedSuite(WRONG_FINGERPRINT), "failed");
    expect(err).not.toContain("명세:");
  });
});

describe("승인 지문은 판정을 바꾸지 않는다", () => {
  const run = async (value: TestSuiteSpec, status: RunnerReport["status"]) =>
    runCli(
      ["test", "x.json", "--command", "node"],
      deps({
        validateSuite: vi.fn(() => ({ valid: true as const, value })),
        finalize: async () => report(status),
      }).value,
    );

  it("지문 불일치 + 전부 통과면 종료 코드가 0 이다", async () => {
    expect(await run(approvedSuite(WRONG_FINGERPRINT), "passed")).toBe(0);
  });
  it("지문 일치 + 실패가 있으면 종료 코드가 1 이다", async () => {
    expect(await run(approvedSuite(fingerprint), "failed")).toBe(1);
  });
  it("같은 케이스 결과에서 지문 상태만 바꿔도 종료 코드가 같다", async () => {
    for (const status of ["passed", "failed"] as const) {
      const codes = [
        await run(suite, status),
        await run(approvedSuite(fingerprint), status),
        await run(approvedSuite(WRONG_FINGERPRINT), status),
      ];
      expect(new Set(codes).size).toBe(1);
    }
  });
});

describe("승인 지문의 --json 출력", () => {
  const runJson = async (value: TestSuiteSpec, status: RunnerReport["status"] = "passed") => {
    const d = deps({
      validateSuite: vi.fn(() => ({ valid: true as const, value })),
      finalize: async () => report(status),
    });
    await runCli(["test", "x.json", "--command", "node", "--json"], d.value);
    const text = d.writes.out.join("");
    return { text, parsed: JSON.parse(text) };
  };

  it("spec.approval 이 세 상태 중 하나다", async () => {
    for (const [value, expected] of [
      [suite, "absent"],
      [approvedSuite(fingerprint), "matched"],
      [approvedSuite(WRONG_FINGERPRINT), "mismatched"],
    ] as const)
      expect((await runJson(value)).parsed.spec.approval).toBe(expected);
  });
  it("전부 통과 + 일치여도 spec 키가 있다", async () => {
    const { parsed } = await runJson(approvedSuite(fingerprint));
    expect(parsed.spec).toEqual({
      approval: "matched",
      fingerprint,
      approvedFingerprint: fingerprint,
      findings: [],
    });
  });
  it("absent 일 때 approvedFingerprint 키가 없다", async () => {
    const { parsed } = await runJson(suite);
    expect(Object.hasOwn(parsed.spec, "approvedFingerprint")).toBe(false);
  });
  it("spec.fingerprint 가 64자 hex 다", async () => {
    expect((await runJson(suite)).parsed.spec.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
  it("기존 키를 그대로 둔다", async () => {
    const { parsed } = await runJson(approvedSuite(fingerprint), "failed");
    const { spec: _spec, ...rest } = parsed;
    expect(rest).toEqual(report("failed"));
  });
  it("--json 이면 명세 텍스트 줄을 쓰지 않는다", async () => {
    expect((await runJson(approvedSuite(WRONG_FINGERPRINT), "failed")).text).not.toContain("명세:");
  });
});

describe("입력 계약 참고 문장", () => {
  /**
   * `additionalProperties: false` 가 없으면 선언 밖 필드는 위반이 아니라서 UNDECLARED_FIELD 가
   * 나지 않는다. 아래 기대값은 checkInputContract 를 이 입력으로 직접 불러 확인한 값이다.
   */
  const weatherTools: ToolDef[] = [
    {
      name: "get_weather",
      inputSchema: {
        type: "object",
        properties: { city: { type: "string" }, units: { enum: ["c", "f"] } },
        required: ["city"],
        additionalProperties: false,
      },
    },
  ];
  const callCase = (
    id: string,
    input: Record<string, string>,
    minLength: number,
  ): TestCaseSpec => ({
    id,
    name: id,
    operation: { type: "callTool", tool: "get_weather", input },
    assertions: [{ type: "bodyMatchesSchema", schema: { type: "string", minLength } }],
  });
  const suiteOf = (...cases: TestCaseSpec[]): TestSuiteSpec => ({
    schemaVersion: 1,
    id: "suite",
    name: "Suite",
    cases,
  });
  /** 'city' 를 'citi' 로 잘못 쓴 케이스와 올바른 케이스가 함께 있다. */
  const seoulSuiteWithTypo = suiteOf(
    callCase("seoul-weather", { citi: "Seoul" }, 1),
    callCase("busan-weather", { city: "Busan" }, 1),
  );
  const suiteWithVacuousAssertion = suiteOf(callCase("vacuous-case", { city: "Seoul" }, 0));
  const cleanSuite = suiteOf(callCase("clean-case", { city: "Seoul" }, 1));
  /** 케이스별 status 만 주면 나머지는 그 결과에서 따라 나온다. */
  const reportWith = (
    value: TestSuiteSpec,
    statuses: Record<string, TestCaseResult["status"]>,
  ): RunnerReport => {
    const cases: TestCaseResult[] = value.cases.map((spec) => ({
      spec,
      status: statuses[spec.id] ?? "passed",
      operation: { status: "completed" },
      assertions: [],
    }));
    const failed = cases.filter((item) => item.status !== "passed").length;
    return {
      schemaVersion: 1,
      suite: { id: value.id, name: value.name },
      status: failed === 0 ? "passed" : "failed",
      cases,
      summary: {
        total: cases.length,
        passed: cases.length - failed,
        failed,
        timedOut: 0,
        cancelled: 0,
        notRun: 0,
      },
    };
  };
  const runTest = async (options: {
    suite: TestSuiteSpec;
    statuses: Record<string, TestCaseResult["status"]>;
    tools?: readonly ToolDef[];
    listTools?: () => Promise<ToolDef[]>;
    json?: boolean;
  }) => {
    const finalReport = reportWith(options.suite, options.statuses);
    const d = deps({
      validateSuite: vi.fn(() => ({ valid: true as const, value: options.suite })),
      finalize: async () => finalReport,
    });
    d.conn.client.listTools = options.listTools ?? (async () => [...(options.tools ?? [])]);
    const exitCode = await runCli(
      ["test", "x.json", "--command", "node", ...(options.json === true ? ["--json"] : [])],
      d.value,
    );
    return { exitCode, stdout: d.writes.out.join(""), stderr: d.writes.err.join("") };
  };

  it("실패한 케이스에만 참고 문장을 붙인다", async () => {
    const out = await runTest({
      suite: seoulSuiteWithTypo,
      tools: weatherTools,
      statuses: { "seoul-weather": "failed", "busan-weather": "passed" },
    });
    expect(out.stdout).toContain("참고: seoul-weather 의 입력이 서버 선언과 다릅니다");
    expect(out.stdout).toContain("→ 필수 필드 'city' 가 입력에 없습니다. 비슷한 필드: 'citi'");
    expect(out.stdout).toContain(
      "→ 'citi' 는 서버가 선언하지 않은 필드입니다. 비슷한 필드: 'city'",
    );
    expect(out.stdout).not.toContain("busan-weather 의 입력이");
    expect(out.exitCode).toBe(1);
  });
  it("전부 통과면 참고 문장이 없다", async () => {
    const out = await runTest({
      suite: seoulSuiteWithTypo,
      tools: weatherTools,
      statuses: { "seoul-weather": "passed", "busan-weather": "passed" },
    });
    expect(out.stdout).not.toContain("참고:");
    expect(out.exitCode).toBe(0);
  });
  it("listTools 가 던지면 추가 줄이 없고 판정도 그대로다", async () => {
    const out = await runTest({
      suite: seoulSuiteWithTypo,
      listTools: () => Promise.reject(new Error("boom")),
      statuses: { "seoul-weather": "failed" },
    });
    expect(out.stdout).not.toContain("입력이 서버 선언과 다릅니다");
    expect(out.exitCode).toBe(1);
  });
  it("listTools 가 빈 배열이면 입력 계약 대조를 건너뛴다", async () => {
    // 빈 목록으로 대조하면 모든 케이스가 TOOL_NOT_DECLARED 로 걸려 소음만 남는다.
    const out = await runTest({
      suite: seoulSuiteWithTypo,
      tools: [],
      statuses: { "seoul-weather": "failed" },
    });
    expect(out.stdout).not.toContain("입력이 서버 선언과 다릅니다");
  });
  it("항상 참인 단언은 툴 목록 없이도 참고 문장이 나온다", async () => {
    const out = await runTest({
      suite: suiteWithVacuousAssertion,
      listTools: () => Promise.reject(new Error("boom")),
      statuses: { "vacuous-case": "failed" },
    });
    expect(out.stdout).toContain("는 0이라 모든 문자열이 통과합니다");
  });
  it("참고 문장은 보고서 뒤, 명세 승인 블록 앞이다", async () => {
    const out = await runTest({
      suite: seoulSuiteWithTypo,
      tools: weatherTools,
      statuses: { "seoul-weather": "failed" },
    });
    expect(out.stdout.startsWith(RENDERED)).toBe(true);
    // indexOf 만 비교하면 참고 문장이 아예 없을 때(-1) 도 통과한다. 존재를 먼저 고정한다.
    const note = out.stdout.indexOf("참고: seoul-weather");
    const approval = out.stdout.indexOf("명세:");
    expect(note).toBeGreaterThan(0);
    expect(approval).toBeGreaterThan(0);
    expect(note).toBeLessThan(approval);
  });
  it("참고 문장은 stdout 이고 stderr 에 없다", async () => {
    const out = await runTest({
      suite: seoulSuiteWithTypo,
      tools: weatherTools,
      statuses: { "seoul-weather": "failed" },
    });
    expect(out.stderr).not.toContain("참고:");
  });
  it("--json 은 findings 를 구조로 담고 문장을 담지 않는다", async () => {
    const out = await runTest({
      json: true,
      suite: seoulSuiteWithTypo,
      tools: weatherTools,
      statuses: { "seoul-weather": "failed", "busan-weather": "passed" },
    });
    expect(JSON.parse(out.stdout).spec.findings).toEqual([
      {
        code: "REQUIRED_MISSING",
        severity: "blocking",
        caseId: "seoul-weather",
        path: "input.city",
      },
      {
        code: "UNDECLARED_FIELD",
        severity: "blocking",
        caseId: "seoul-weather",
        path: "input.citi",
      },
    ]);
    expect(out.stdout).not.toContain("비슷한 필드");
  });
  it("--json 의 findings 키는 finding 이 없어도 있다", async () => {
    const out = await runTest({
      json: true,
      suite: cleanSuite,
      tools: weatherTools,
      statuses: { "clean-case": "passed" },
    });
    expect(JSON.parse(out.stdout).spec.findings).toEqual([]);
  });
  it("참고 문장 유무가 exit code 를 바꾸지 않는다", async () => {
    const withFindings = await runTest({
      suite: seoulSuiteWithTypo,
      tools: weatherTools,
      statuses: { "seoul-weather": "failed" },
    });
    const withoutFindings = await runTest({
      suite: cleanSuite,
      tools: weatherTools,
      statuses: { "clean-case": "failed" },
    });
    expect(withFindings.stdout).toContain("참고:");
    expect(withoutFindings.stdout).not.toContain("참고:");
    expect(withFindings.exitCode).toBe(withoutFindings.exitCode);
  });
  it("caseId 의 제어 문자를 이스케이프한다", async () => {
    // caseId 는 남이 쓴 명세에서 온다. 다른 표시 항목과 같은 규칙을 쓴다.
    const suite = suiteOf(callCase("bad\nid", { citi: "Seoul" }, 1));
    const out = await runTest({ suite, tools: weatherTools, statuses: { "bad\nid": "failed" } });
    expect(out.stdout).toContain("참고: bad\\u000aid 의 입력이");
  });
});
