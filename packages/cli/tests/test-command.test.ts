import type { McpStdioConnection, ToolDef } from "@mcpeak/core";
import type {
  DeterminismResult,
  RunnerExecution,
  RunnerReport,
  TestCaseResult,
  TestCaseSpec,
  TestSuiteSpec,
} from "@mcpeak/runner";
import { suiteFingerprint } from "@mcpeak/runner";
import { describe, expect, it, vi } from "vitest";
import { TEST_USAGE_HINT } from "../src/help.js";
import { ResetCommandError } from "../src/reset-hook.js";
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
  summary: {
    total: 0,
    passed: 0,
    failed: 0,
    timedOut: 0,
    cancelled: 0,
    notRun: 0,
    rejectionUnverified: 0,
  },
});
/** 주입한 renderReport 가 돌려주는 값. 렌더링 문안은 runner 의 reporter.test.ts 가 고정한다. */
const RENDERED = "렌더링 결과\n";
/** 주입한 renderJUnit 이 돌려주는 값. XML 문법은 runner 의 junit.test.ts 가 고정한다. */
const XML = "<testsuites/>\n";
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
    renderJUnit: vi.fn(() => XML),
    writeFile: vi.fn(async () => {}),
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
      junitPath: undefined,
      determinism: false,
      resetCmd: undefined,
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
      junitPath: undefined,
      determinism: false,
      resetCmd: undefined,
      stderrLines: 20,
    });
  });
  it("공백 형식의 arg 도 하이픈 값을 보존한다", () => {
    // 서버 인자는 대부분 플래그 모양이다(-y, --with, --db-path). generate 는 이미 받는데
    // test 만 거절하면 같은 서버를 generate 로 만들고 test 로 못 돌린다. 도그푸딩 실측.
    const input = parseTestCommand([
      "suite.json",
      "--command",
      "npx",
      "--arg",
      "-y",
      "--arg",
      "@modelcontextprotocol/server-memory",
    ]);
    expect(input.args).toEqual(["-y", "@modelcontextprotocol/server-memory"]);
  });
  it("parseTestCommand가 json 기본값 false를 낸다", () => {
    expect(parseTestCommand(["suite.json", "--command", "node"]).json).toBe(false);
  });
  it("parseTestCommand가 json true를 낸다", () => {
    expect(parseTestCommand(["suite.json", "--command", "node", "--json"]).json).toBe(true);
  });
  it("--junit <path> 를 파싱한다", () => {
    expect(
      parseTestCommand(["suite.json", "--command", "node", "--junit", "reports/junit.xml"])
        .junitPath,
    ).toBe("reports/junit.xml");
  });
  it("--junit=<path> 형태를 파싱한다", () => {
    expect(
      parseTestCommand(["suite.json", "--command", "node", "--junit=reports/junit.xml"]).junitPath,
    ).toBe("reports/junit.xml");
  });
  it("--junit 을 주지 않으면 junitPath 가 undefined 다", () => {
    expect(parseTestCommand(["suite.json", "--command", "node"]).junitPath).toBeUndefined();
  });
  it("--junit 중복 지정을 거절한다", () => {
    expect(() =>
      parseTestCommand(["suite.json", "--command", "node", "--junit", "a.xml", "--junit", "b.xml"]),
    ).toThrow("`--junit`은 한 번만 사용할 수 있습니다.");
  });
  it("--junit 값이 없거나 비어 있거나 플래그면 거절한다", () => {
    for (const argv of [
      ["suite.json", "--command", "node", "--junit"],
      ["suite.json", "--command", "node", "--junit="],
      // 경로 자리의 플래그는 값을 빠뜨린 오타다. `--json` 이라는 이름의 파일을 만들지 않는다.
      ["suite.json", "--command", "node", "--junit", "--json"],
    ])
      expect(() => parseTestCommand(argv)).toThrow("`--junit` 옵션 값이 필요합니다.");
  });
  it("--repair-bundle out.json 과 --repair-bundle=out.json 이 같게 파싱된다", () => {
    const spaced = parseTestCommand([
      "suite.json",
      "--command",
      "node",
      "--repair-bundle",
      "out.json",
    ]);
    const equals = parseTestCommand([
      "suite.json",
      "--command",
      "node",
      "--repair-bundle=out.json",
    ]);
    expect(spaced.repairBundlePath).toBe("out.json");
    expect(equals.repairBundlePath).toBe("out.json");
    expect(spaced).toEqual(equals);
  });
  it("--repair-bundle 을 두 번 쓰면 CLI_USAGE 다", () => {
    expect(() =>
      parseTestCommand([
        "suite.json",
        "--command",
        "node",
        "--repair-bundle",
        "a.json",
        "--repair-bundle",
        "b.json",
      ]),
    ).toThrow("`--repair-bundle`은 한 번만 사용할 수 있습니다.");
  });
  it("--repair-bundle 값이 없으면 CLI_USAGE 다", () => {
    for (const argv of [
      ["suite.json", "--command", "node", "--repair-bundle"],
      ["suite.json", "--command", "node", "--repair-bundle="],
    ])
      expect(() => parseTestCommand(argv)).toThrow("`--repair-bundle` 옵션 값이 필요합니다.");
  });
  it("--repair-bundle --json 처럼 값 자리에 플래그가 오면 CLI_USAGE 다", () => {
    expect(() =>
      parseTestCommand(["suite.json", "--command", "node", "--repair-bundle", "--json"]),
    ).toThrow("`--repair-bundle` 옵션 값이 필요합니다.");
  });
  it("--repair-bundle 없이 파싱하면 repairBundlePath 가 undefined 다", () => {
    expect(parseTestCommand(["suite.json", "--command", "node"]).repairBundlePath).toBeUndefined();
  });
  it("--json 과 --junit 을 함께 파싱한다", () => {
    const input = parseTestCommand([
      "suite.json",
      "--command",
      "node",
      "--json",
      "--junit",
      "out.xml",
    ]);
    expect(input.json).toBe(true);
    expect(input.junitPath).toBe("out.xml");
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
    // 빈 argv 는 여기 없다. 명령 이름 자체가 없는 경우라 힌트가 `test` 사용법이 아니라
    // 명령 목록이다. 아래 "명령을 아예 안 주면 명령 목록만 준다" 가 따로 덮는다.
    const cases: ReadonlyArray<readonly [readonly string[], string]> = [
      [["test"], "테스트 명세 JSON 경로가 필요합니다."],
      [["test", "suite.json"], "`--command` 옵션이 필요합니다."],
      [
        ["test", "suite.json", "--command", "a", "--command", "b"],
        "`--command`는 한 번만 사용할 수 있습니다.",
      ],
      [["test", "suite.json", "--command"], "`--command` 옵션 값이 필요합니다."],
      [["test", "suite.json", "--command", "a", "--arg"], "`--arg` 옵션 값이 필요합니다."],
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
        `오류 [CLI_USAGE]: ${message}\n해결: ${TEST_USAGE_HINT}\n`,
      );
      expect(d.value.readFile).not.toHaveBeenCalled();
      expect(d.value.connect).not.toHaveBeenCalled();
    }
  });
  it("알 수 없는 옵션·추가 위치 인자에 실린 제어 문자를 이스케이프한다(#289)", async () => {
    const option = deps();
    await runCli(["test", "suite.json", "--command", "a", "--bad\n"], option.value);
    expect(option.writes.err.join("")).toContain("--bad\\u000a");

    // 옵션(`-` 로 시작)과 위치 인자는 서로 다른 분기(parseTestCommand 의 두 fail 호출)라
    // 옵션 쪽만 확인하면 위치 인자 분기가 이스케이프를 놓쳐도 잡히지 않는다.
    const positional = deps();
    await runCli(["test", "suite.json", "--command", "a", "extra\n"], positional.value);
    expect(positional.writes.err.join("")).toContain("extra\\u000a");
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
  it("record·mock 도 아직 구현되지 않은 것으로 안내하고, 사라진 replay 를 사용 가능한 명령에 넣지 않는다(#289)", async () => {
    for (const name of ["record", "mock"]) {
      const d = deps();
      await runCli([name], d.value);
      const err = d.writes.err.join("");
      expect(err).toContain("COMMAND_NOT_IMPLEMENTED");
      expect(err).toContain(`'${name}' 명령은 아직 구현되지 않았습니다`);
      // ADR-0059 로 걷힌 명령이다. 사용 가능하다고 안내하면 사용자를 다시 막다른 곳으로 보낸다.
      expect(err).not.toContain("replay");
    }
  });
  // #289. format() 이 예전에는 message·hint 를 통째로 이스케이프해, 우리가 3줄로 쓴 설명이
  // 화면에서 이스케이프 시퀀스 두 개로 이어진 한 줄이 됐다. 여기는 이스케이프 대상이 될
  // 신뢰 못 할 값이 전혀 없는, 순수하게 우리가 쓴 정적 문구다 - 실제 개행으로 나가야 한다.
  it("--determinism 과 세션 옵션 충돌 안내가 실제 개행으로 여러 줄에 나간다", async () => {
    const d = deps();
    await runCli(
      ["test", "suite.json", "--command", "node", "--determinism", "--session", "x.db"],
      d.value,
    );
    const err = d.writes.err.join("");
    expect(err).toContain("`--determinism`은 External 세션 옵션과 함께 쓸 수 없습니다.\n");
    expect(err).toContain("→ `--determinism`은 서버에 2회 연결하지만");
    expect(err).not.toContain("\\u000a");
  });
  it("제거된 verify 는 오타가 아니라 제거됐다고 말하고 갈아탈 곳을 알려준다(ADR-0059)", async () => {
    // 발행본 0.9.0 에 나갔던 명령이다. "알 수 없는 명령" 으로 끝내면 오타와 구분되지 않아,
    // 스크립트가 깨진 사용자가 무엇을 고쳐야 하는지 알 수 없다.
    const d = deps();

    expect(await runCli(["verify", "c.json", "--command", "node"], d.value)).toBe(1);

    const err = d.writes.err.join("");
    expect(err).toContain("제거되었습니다");
    expect(err).toContain("ADR-0059");
    // 갈아탈 곳 둘 — 목적에 따라 갈린다.
    expect(err).toContain("mcpeak test");
    expect(err).toContain("--record-session");
    // 재생 쪽 안내가 지워져도 --record-session 단언만으로는 통과한다. 둘 다 고정한다.
    expect(err).toContain("--session");
    expect(err).not.toContain("알 수 없는 CLI 명령");
  });

  it("제거된 replay 도 제거 사실과 갈아탈 곳을 알려준다(ADR-0059)", async () => {
    const d = deps();

    expect(await runCli(["replay", "s.json", "--cassette", "c.json"], d.value)).toBe(1);

    const err = d.writes.err.join("");
    expect(err).toContain("제거되었습니다");
    expect(err).toContain("ADR-0059");
    // 목적에 따라 갈아탈 곳이 둘이다 — 서버 대체는 mock, 외부 호출 차단은 세션.
    expect(err).toContain("mcpeak-mock");
    expect(err).toContain("--record-session");
    expect(err).toContain("--session");
    expect(err).not.toContain("알 수 없는 CLI 명령");
  });

  it("명령 이름이 틀리면 명령 목록만 주고 test 의 플래그는 주지 않는다", async () => {
    const d = deps();
    expect(await runCli(["tset"], d.value)).toBe(1);
    const err = d.writes.err.join("");
    expect(err).toContain("알 수 없는 CLI 명령 'tset'입니다.");
    expect(err).toContain("사용 가능한 명령: test, generate, repair");
    // 오타는 "어느 옵션을 쓰나" 가 아니라 "어떤 명령이 있나" 를 모르는 상태다.
    // test 사용법을 붙이면 묻지도 않은 명령의 플래그 11개를 먼저 읽게 된다.
    expect(err).not.toContain("--determinism");
    expect(err).not.toContain("--record-session");
    expect(err).not.toContain("<suite.json>");
  });

  it("명령을 아예 안 주면 명령 목록만 준다 (라이브러리 진입점 `runCli`)", async () => {
    // 이 갈래는 `mcpeak` 바이너리로는 안 닿는다. `run()` 이 argv 0개를 먼저 가로채
    // GLOBAL_HELP 를 찍고 0 을 낸다 — 그게 맞는 동작이라 여기서 바꾸지 않는다.
    // 닿는 것은 `@mcpeak/cli/commands` 의 공개 `runCli` 다. 대시보드가 그 문으로 들어온다.
    const d = deps();
    expect(await runCli([], d.value)).toBe(1);
    const err = d.writes.err.join("");
    expect(err).toContain("실행할 CLI 명령이 없습니다.");
    expect(err).toContain("사용 가능한 명령: test, generate, repair");
    expect(err).not.toContain("--determinism");
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
  it("--junit 이면 renderJUnit 결과를 그 경로에 쓴다", async () => {
    const d = deps();
    expect(
      await runCli(["test", "x.json", "--command", "node", "--junit", "out.xml"], d.value),
    ).toBe(0);
    expect(d.value.renderJUnit).toHaveBeenCalledWith(report());
    expect(d.value.writeFile).toHaveBeenCalledTimes(1);
    expect(d.value.writeFile).toHaveBeenCalledWith("out.xml", XML);
  });
  it("--junit 이어도 stdout 은 사람용 보고서 그대로다", async () => {
    const d = deps();
    await runCli(["test", "x.json", "--command", "node", "--junit", "out.xml"], d.value);
    expect(d.writes.out.join("")).toBe(RENDERED);
    expect(d.writes.err).toEqual([]);
  });
  it("--json 과 --junit 은 함께 쓸 수 있다. stdout 은 JSON, XML 은 파일이다", async () => {
    const d = deps();
    expect(
      await runCli(
        ["test", "x.json", "--command", "node", "--json", "--junit", "out.xml"],
        d.value,
      ),
    ).toBe(0);
    expect(d.writes.out.join("")).toBe(jsonOut(report()));
    expect(d.value.writeFile).toHaveBeenCalledWith("out.xml", XML);
  });
  it("--junit 없이는 renderJUnit 도 writeFile 도 부르지 않는다", async () => {
    const d = deps();
    await runCli(["test", "x.json", "--command", "node"], d.value);
    expect(d.value.renderJUnit).not.toHaveBeenCalled();
    expect(d.value.writeFile).not.toHaveBeenCalled();
  });
  it("XML 파일을 stdout 보다 먼저 쓴다", async () => {
    // stdout 이 EPIPE 로 깨져도 사용자가 요청한 산출물은 이미 디스크에 있다. ADR-0019.
    const order: string[] = [];
    const d = deps({
      writeFile: async () => {
        order.push("writeFile");
      },
      writeStdout: () => {
        order.push("writeStdout");
      },
    });
    await runCli(["test", "x.json", "--command", "node", "--junit", "out.xml"], d.value);
    expect(order).toEqual(["writeFile", "writeStdout"]);
  });
  it("writeFile 이 실패해도 결과를 출력하고 경로·errno와 JUNIT_WRITE_FAILED로 1을 낸다", async () => {
    const d = deps({
      writeFile: async () => {
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      },
    });
    expect(
      await runCli(["test", "x.json", "--command", "node", "--junit", "out.xml"], d.value),
    ).toBe(1);
    expect(d.writes.err.join("")).toBe(
      "오류 [JUNIT_WRITE_FAILED]: JUnit XML 파일을 쓰지 못했습니다: out.xml\n" +
        "  errno: EACCES\n" +
        "해결: `--junit` 경로의 디렉터리가 존재하는지와 쓰기 권한을 확인하세요.\n",
    );
    expect(d.writes.out.join("")).toBe(RENDERED);
  });
  it("JUnit 쓰기 실패 뒤에도 비정상 종료 진단을 출력한다", async () => {
    const d = deps({
      writeFile: async () => {
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      },
    });
    d.conn.getDiagnostics = () => diagnostics({ exitCode: 1, stderr: "server boom\n" });
    expect(
      await runCli(["test", "x.json", "--command", "node", "--junit", "out.xml"], d.value),
    ).toBe(1);
    const stderr = d.writes.err.join("");
    expect(stderr).toContain("서버 프로세스 진단");
    expect(stderr).toContain("server boom");
    expect(stderr).toContain("JUNIT_WRITE_FAILED");
  });
  it("renderJUnit 이 던지면 CLI_INTERNAL_ERROR 가 되고 파일을 쓰지 않는다", async () => {
    const d = deps({
      renderJUnit: () => {
        throw new Error("JUNIT_SECRET_STACK");
      },
    });
    expect(
      await runCli(["test", "x.json", "--command", "node", "--junit", "out.xml"], d.value),
    ).toBe(1);
    expect(d.writes.err.join("")).toContain("CLI_INTERNAL_ERROR");
    expect(d.writes.err.join("")).not.toContain("JUNIT_SECRET_STACK");
    expect(d.value.writeFile).not.toHaveBeenCalled();
  });
  it("쓰기가 성공하면 종료 코드는 보고서 상태를 따른다", async () => {
    const passed = deps();
    expect(
      await runCli(["test", "x.json", "--command", "node", "--junit", "out.xml"], passed.value),
    ).toBe(0);
    const failed = deps({ finalize: async () => report("failed") });
    expect(
      await runCli(["test", "x.json", "--command", "node", "--junit", "out.xml"], failed.value),
    ).toBe(1);
    expect(failed.value.writeFile).toHaveBeenCalledWith("out.xml", XML);
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
  /**
   * `@mcpeak/core` 의 실제 McpClientError 문구는 전부 고정 열거형이라 지금은 제어 문자가
   * 실릴 수 없다. 다만 `format()` 이 더 이상 message·hint 를 통째로 이스케이프하지 않으므로
   * (#289), `coreError()` 가 돌려주는 값을 여기서 직접 걸지 않으면 core 쪽에 다치는 값이
   * 생기는 순간 화면이 깨진다 — 그 계약을 이 테스트가 고정한다.
   */
  it("core 오류의 message·hint 에 실린 제어 문자도 이스케이프한다", async () => {
    const error = {
      name: "McpClientError" as const,
      code: "PROCESS_START_FAILED",
      message: "연결 실패\n주입된 줄",
      hint: "설정을 확인하세요.",
    };
    const d = deps({ connect: async () => Promise.reject(error) });
    await runCli(["test", "x.json", "--command", "node"], d.value);
    const text = d.writes.err.join("");
    expect(text).toContain("\\u000a");
    expect(text).not.toContain("연결 실패\n주입된 줄");
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
  it("전부 통과 + 지문 불일치면 현재 명세와 저장된 지문의 불일치를 알린다", async () => {
    const { out } = await runText(approvedSuite(WRONG_FINGERPRINT));
    expect(out).toContain("현재 명세와 저장된 approval.fingerprint가 불일치함");
    expect(out).toContain("승인받지 않은 현재 명세로 모든 테스트가 통과했습니다.");
    expect(out).not.toContain("실패 원인");
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
    expect(out).toContain("실패 원인에서 명세 변경을 배제할 수 없습니다.");
    expect(out).not.toContain("모든 테스트가 통과했습니다");
    expect(out).toContain("지문만으로는 변경 내용을 알 수 없습니다.");
    expect(out).toContain("mcpeak generate 를 다시 실행하고 --force 로 재승인하세요.");
  });
  it("명세 줄은 보고서 뒤에 오고 그 앞에 빈 줄이 하나 있다", async () => {
    const { out } = await runText(suite, "failed");
    expect(out.startsWith(RENDERED)).toBe(true);
    expect(out).toBe(
      `${RENDERED}\n명세: 승인 지문이 없습니다 (미고정)\n  → mcpeak generate 로 승인한 명세가 아니거나 승인 이전 버전으로 만든 파일입니다.\n`,
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
  /** 한 케이스가 입력 계약과 단언 실질성에 동시에 걸린다. 머리글이 둘 다 나와야 한다. */
  const suiteWithBothKinds = suiteOf(callCase("both-case", { citi: "Seoul" }, 0));
  /**
   * 루트에 `anyOf` 가 있으면 이 툴의 입력 검사를 통째로 건너뛴다(ADR-0015). 그 결과가
   * SCHEMA_NOT_ANALYZABLE 하나이고 다른 입력 계약 finding 은 나오지 않는다. 직접 확인했다.
   */
  const unanalyzableTools: ToolDef[] = [
    { name: "get_weather", inputSchema: { anyOf: [{ type: "object" }] } },
  ];
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
      rejectionBasis: "notApplicable",
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
        rejectionUnverified: 0,
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
    expect(out.stdout).toContain("참고: vacuous-case 의 단언은 무엇이 와도 통과합니다");
    expect(out.stdout).toContain("는 0이라 모든 문자열이 통과합니다");
    // 입력 문제가 아니므로 입력 머리글이 붙으면 읽는 사람이 입력을 고치러 간다.
    expect(out.stdout).not.toContain("의 입력이 서버 선언과 다릅니다");
  });
  it("거절 기대 케이스의 입력이 선언을 안 어기면 전용 머리글로 알린다 (#94)", async () => {
    // 선언에 맞는 입력에 isError true 를 기대한다. 서버가 거절하지 않아 실패했을 때가
    // 정확히 이 신호가 필요한 순간이다. '입력이 서버 선언과 다릅니다' 는 정반대 상황이라 못 쓴다.
    const rejectClean: TestCaseSpec = {
      id: "reject-clean",
      name: "reject-clean",
      operation: { type: "callTool", tool: "get_weather", input: { city: "Seoul" } },
      assertions: [{ type: "isError", expected: true }],
    };
    const out = await runTest({
      suite: suiteOf(rejectClean),
      tools: weatherTools,
      statuses: { "reject-clean": "failed" },
    });
    expect(out.stdout).toContain("참고: reject-clean 는 거절을 기대하지만 선언을 어기지 않습니다");
    expect(out.stdout).toContain(
      "→ 거절을 기대하지만 입력이 서버 선언을 어기지 않습니다. 서버가 선언 밖 제약으로 거절한다면 그대로 두고, 아니라면 입력을 확인하세요",
    );
    expect(out.stdout).not.toContain("의 입력이 서버 선언과 다릅니다");
  });
  it("한 케이스에 둘 다 있으면 머리글을 갈라 찍고 입력 계약이 먼저다", async () => {
    const out = await runTest({
      suite: suiteWithBothKinds,
      tools: weatherTools,
      statuses: { "both-case": "failed" },
    });
    const input = out.stdout.indexOf("참고: both-case 의 입력이 서버 선언과 다릅니다");
    const substance = out.stdout.indexOf("참고: both-case 의 단언은 무엇이 와도 통과합니다");
    expect(input).toBeGreaterThan(0);
    expect(substance).toBeGreaterThan(input);
    // 각 finding 이 맞는 머리글 아래에 있어야 한다. 블록 경계로 잘라 확인한다.
    const inputBlock = out.stdout.slice(input, substance);
    const substanceBlock = out.stdout.slice(substance);
    expect(inputBlock).toContain("필수 필드 'city' 가 입력에 없습니다. 비슷한 필드: 'citi'");
    expect(inputBlock).toContain("'citi' 는 서버가 선언하지 않은 필드입니다. 비슷한 필드: 'city'");
    expect(inputBlock).not.toContain("모든 문자열이 통과합니다");
    expect(substanceBlock).toContain(
      "assertions[0].schema.minLength 는 0이라 모든 문자열이 통과합니다",
    );
    expect(substanceBlock).not.toContain("입력에 없습니다");
  });
  it("해석하지 못한 스키마는 건너뜀 머리글만 낸다", async () => {
    // 명세가 틀린 것이 아니라 서버 스키마를 못 읽은 것이다. 입력 머리글 아래 두면 읽는 사람이
    // 고칠 것도 없는 입력을 고치러 간다.
    const out = await runTest({
      suite: suiteOf(callCase("skipped-case", { city: "Seoul" }, 1)),
      tools: unanalyzableTools,
      statuses: { "skipped-case": "failed" },
    });
    expect(out.stdout).toContain("참고: skipped-case 의 입력 검사를 건너뛰었습니다");
    expect(out.stdout).toContain(
      "→ 'get_weather' 의 입력 스키마를 해석하지 못해 이 툴의 입력 검사를 건너뜁니다",
    );
    expect(out.stdout).not.toContain("의 입력이 서버 선언과 다릅니다");
  });
  it("건너뜀 블록은 단언 실질성 블록 뒤에 온다", async () => {
    const out = await runTest({
      suite: suiteOf(callCase("skipped-case", { city: "Seoul" }, 0)),
      tools: unanalyzableTools,
      statuses: { "skipped-case": "failed" },
    });
    const substance = out.stdout.indexOf("참고: skipped-case 의 단언은 무엇이 와도 통과합니다");
    const skipped = out.stdout.indexOf("참고: skipped-case 의 입력 검사를 건너뛰었습니다");
    expect(substance).toBeGreaterThan(0);
    expect(skipped).toBeGreaterThan(substance);
  });
  it("케이스 사이 순서는 검사 종류와 무관하게 보고서의 케이스 순서다", async () => {
    // 두 검사 결과를 이어 붙이는 순서로 블록을 만들면, 앞 케이스에 단언 finding 만 있고 뒤
    // 케이스에 입력 계약 finding 이 있을 때 뒤 케이스가 먼저 나온다. 케이스 순서는 검사
    // 종류가 아니라 보고서가 정한다.
    const out = await runTest({
      suite: suiteOf(
        callCase("first-case", { city: "Seoul" }, 0),
        callCase("second-case", { citi: "Busan" }, 1),
      ),
      tools: weatherTools,
      statuses: { "first-case": "failed", "second-case": "failed" },
    });
    const first = out.stdout.indexOf("참고: first-case");
    const second = out.stdout.indexOf("참고: second-case");
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(0);
    expect(first).toBeLessThan(second);
  });
  it("케이스가 여럿이면 케이스별로 세 머리글이 각자 나온다", async () => {
    // 한 케이스는 툴 하나만 부르므로 위반과 건너뜀이 같은 케이스에 함께 오지 않는다.
    // 그래서 세 머리글의 순서는 케이스를 갈라 확인한다.
    const out = await runTest({
      suite: suiteOf(callCase("both-case", { citi: "Seoul" }, 0)),
      tools: weatherTools,
      statuses: { "both-case": "failed" },
    });
    const skippedOut = await runTest({
      suite: suiteOf(callCase("skipped-case", { city: "Seoul" }, 1)),
      tools: unanalyzableTools,
      statuses: { "skipped-case": "failed" },
    });
    expect(out.stdout).toContain("참고: both-case 의 입력이 서버 선언과 다릅니다");
    expect(out.stdout).toContain("참고: both-case 의 단언은 무엇이 와도 통과합니다");
    expect(out.stdout).not.toContain("건너뛰었습니다");
    expect(skippedOut.stdout).toContain("참고: skipped-case 의 입력 검사를 건너뛰었습니다");
  });
  it("--json 의 findings 는 한 배열로 그대로 둔다", async () => {
    // 머리글을 갈라도 기계가 읽는 출력은 나누지 않는다. 기계는 code 로 분기한다.
    const out = await runTest({
      json: true,
      suite: suiteWithBothKinds,
      tools: weatherTools,
      statuses: { "both-case": "failed" },
    });
    expect(JSON.parse(out.stdout).spec.findings.map((f: { code: string }) => f.code)).toEqual([
      "REQUIRED_MISSING",
      "UNDECLARED_FIELD",
      "VACUOUS_MIN_LENGTH",
    ]);
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

describe("test 보고서 / 승인 시점 서버 결함 표시", () => {
  const NOTE =
    "참고: 승인 시점에 서버 결함으로 표시된 케이스입니다. 서버가 아직 고쳐지지 않았습니다.";
  const caseSpec = (id: string): TestCaseSpec => ({
    id,
    name: id,
    operation: { type: "listTools" },
    assertions: [{ type: "toolExists", tool: "get_weather" }],
  });
  /** 케이스 둘 중 하나만 서버 결함으로 표시한 명세. 지문은 명세에서 계산한다. */
  const defectSuite = (
    approvalCases: readonly { id: string; status: "passed" | "serverDefect" }[],
    approvalFingerprint?: string,
  ): TestSuiteSpec => {
    const base: TestSuiteSpec = {
      schemaVersion: 1,
      id: "suite",
      name: "Suite",
      cases: [caseSpec("ok-case"), caseSpec("broken-case")],
    };
    return {
      ...base,
      approval: {
        fingerprint: approvalFingerprint ?? suiteFingerprint(base),
        cases: approvalCases,
      },
    };
  };
  const reportOf = (
    value: TestSuiteSpec,
    statuses: Record<string, TestCaseResult["status"]>,
  ): RunnerReport => {
    const cases: TestCaseResult[] = value.cases.map((spec) => ({
      spec,
      status: statuses[spec.id] ?? "passed",
      operation: { status: "completed" },
      assertions: [],
      rejectionBasis: "notApplicable",
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
        rejectionUnverified: 0,
      },
    };
  };
  const run = async (options: {
    suite: TestSuiteSpec;
    statuses: Record<string, TestCaseResult["status"]>;
    json?: boolean;
  }) => {
    const finalReport = reportOf(options.suite, options.statuses);
    const d = deps({
      validateSuite: vi.fn(() => ({ valid: true as const, value: options.suite })),
      finalize: async () => finalReport,
    });
    const exitCode = await runCli(
      ["test", "x.json", "--command", "node", ...(options.json === true ? ["--json"] : [])],
      d.value,
    );
    return { exitCode, stdout: d.writes.out.join("") };
  };
  const defectApproval = [
    { id: "ok-case", status: "passed" },
    { id: "broken-case", status: "serverDefect" },
  ] as const;

  it("serverDefect 케이스가 실패하면 참고 줄이 붙는다", async () => {
    const out = await run({
      suite: defectSuite(defectApproval),
      statuses: { "broken-case": "failed" },
    });
    expect(out.stdout).toContain(`    ${NOTE}\n`);
  });

  it("serverDefect 케이스가 통과하면 참고 줄이 안 붙는다", async () => {
    const out = await run({
      suite: defectSuite(defectApproval),
      statuses: { "ok-case": "failed" },
    });
    expect(out.stdout).not.toContain(NOTE);
  });

  it("passed 케이스가 실패하면 참고 줄이 안 붙는다", async () => {
    const out = await run({
      suite: defectSuite([{ id: "ok-case", status: "passed" }]),
      statuses: { "ok-case": "failed" },
    });
    expect(out.stdout).not.toContain(NOTE);
  });

  it("지문이 불일치면 참고 줄이 안 붙는다", async () => {
    // 현재 명세와 저장된 승인 지문이 어긋나면 승인 시점 판정이 지금 케이스에 해당하는지
    // 알 수 없다. 설계 문서 §9.
    const out = await run({
      suite: defectSuite(defectApproval, WRONG_FINGERPRINT),
      statuses: { "broken-case": "failed" },
    });
    expect(out.stdout).not.toContain(NOTE);
    expect(out.stdout).toContain("현재 명세와 저장된 approval.fingerprint가 불일치함");
  });

  it("참고 줄이 붙어도 종료 코드가 그대로다", async () => {
    const withNote = await run({
      suite: defectSuite(defectApproval),
      statuses: { "broken-case": "failed" },
    });
    const withoutNote = await run({
      suite: defectSuite([{ id: "broken-case", status: "passed" }]),
      statuses: { "broken-case": "failed" },
    });
    expect(withNote.stdout).toContain(NOTE);
    expect(withoutNote.stdout).not.toContain(NOTE);
    expect(withNote.exitCode).toBe(1);
    expect(withNote.exitCode).toBe(withoutNote.exitCode);
  });

  it("--json 에 spec.cases 가 실린다", async () => {
    const out = await run({
      suite: defectSuite(defectApproval),
      statuses: { "broken-case": "failed" },
      json: true,
    });
    expect(JSON.parse(out.stdout).spec.cases).toEqual([
      { id: "ok-case", status: "passed" },
      { id: "broken-case", status: "serverDefect" },
    ]);
    expect(out.stdout).not.toContain(NOTE);
  });

  it("지문이 불일치여도 --json 의 spec.cases 는 그대로다", async () => {
    // 텍스트 참고 문장의 억제 규칙은 사람이 읽는 화면의 것이다. 기계는 spec.approval 로 안다.
    const out = await run({
      suite: defectSuite(defectApproval, WRONG_FINGERPRINT),
      statuses: { "broken-case": "failed" },
      json: true,
    });
    expect(JSON.parse(out.stdout).spec.cases).toHaveLength(2);
  });

  it("approval.cases 가 없으면 --json 에 spec.cases 키가 없다", async () => {
    const out = await run({ suite, statuses: {}, json: true });
    expect(Object.hasOwn(JSON.parse(out.stdout).spec, "cases")).toBe(false);
  });
});

/**
 * 결정론성 확인(설계 §5.2 · §7 · §8). 가짜 의존성으로 2회 실행 배선·문구·비차단성을 고정한다.
 * `checkDeterminism` 은 주입 지점으로 대체한다. 비교 의미론 자체는 runner 의
 * `determinism.test.ts` 가 고정하고, 여기서는 배선과 화면만 본다.
 */
describe("결정론성 확인", () => {
  const differenceResult = (): DeterminismResult => ({
    compared: 12,
    skipped: 0,
    differences: [
      {
        caseId: "case-3",
        caseName: "정상 조회",
        toolName: "get_weather",
        kind: "response",
        path: "content[0].text",
        firstValue: '"a"',
        secondValue: '"b"',
        hint: "timestamp",
      },
      {
        caseId: "case-9",
        caseName: "새 파일",
        toolName: "create_file",
        kind: "status",
        firstValue: "passed",
        secondValue: "failed",
      },
    ],
    conclusion: "nondeterministic",
  });
  const sameResult = (
    conclusion: DeterminismResult["conclusion"],
    skipped = 0,
  ): DeterminismResult => ({ compared: 12, skipped, differences: [], conclusion });

  /** 실행 순서를 events 에 남기는 의존성. reset 은 주입한 가짜다. */
  const determinismDeps = (
    overrides: Partial<TestCommandDependencies> = {},
  ): ReturnType<typeof deps> => {
    const base = deps(overrides);
    return base;
  };

  it("--determinism 이 스위트를 2회 실행한다", async () => {
    const d = determinismDeps({ checkDeterminism: vi.fn(() => sameResult("deterministic")) });
    const code = await runCli(
      ["test", "suite.json", "--command", "node", "--determinism"],
      d.value,
    );
    expect(code).toBe(0);
    expect(d.value.connect).toHaveBeenCalledTimes(2);
    expect(d.value.startRunner).toHaveBeenCalledTimes(2);
    expect(d.value.finalize).toHaveBeenCalledTimes(2);
    expect(d.value.checkDeterminism).toHaveBeenCalledTimes(1);
  });

  it("--reset-cmd 와 함께면 각 회차 전에 복원한다", async () => {
    const order: string[] = [];
    const d = deps({
      runResetCommand: vi.fn(async () => {
        order.push("reset");
      }),
      checkDeterminism: vi.fn(() => sameResult("deterministic")),
    });
    const startRunner = d.value.startRunner;
    d.value.startRunner = vi.fn((options) => {
      order.push("run");
      return startRunner(options);
    });
    await runCli(
      ["test", "suite.json", "--command", "node", "--determinism", "--reset-cmd", "git checkout ."],
      d.value,
    );
    expect(order).toEqual(["reset", "run", "reset", "run"]);
  });

  it("--reset-cmd 단독이면 1회 실행 전 1번 복원한다", async () => {
    const d = deps({ runResetCommand: vi.fn(async () => {}) });
    const code = await runCli(
      ["test", "suite.json", "--command", "node", "--reset-cmd", "git checkout ."],
      d.value,
    );
    expect(code).toBe(0);
    expect(d.value.runResetCommand).toHaveBeenCalledTimes(1);
    expect(d.value.startRunner).toHaveBeenCalledTimes(1);
    expect(d.writes.out.join("")).toBe(RENDERED);
  });

  it("복원 실패면 실행을 시작하지 않는다", async () => {
    const d = deps({
      runResetCommand: vi.fn(async () => {
        throw new ResetCommandError("git checkout .", 128, "fatal: not a git repository\n");
      }),
    });
    const code = await runCli(
      ["test", "suite.json", "--command", "node", "--reset-cmd", "git checkout ."],
      d.value,
    );
    expect(code).toBe(1);
    expect(d.value.startRunner).not.toHaveBeenCalled();
    expect(d.value.connect).not.toHaveBeenCalled();
    const err = d.writes.err.join("");
    expect(err).toContain("오류 [RESET_COMMAND_FAILED]");
    expect(err).toContain("git checkout .");
    expect(err).toContain("128");
    expect(err).toContain("fatal: not a git repository");
    // #289 — 진단과 다음 행동을 한 줄에 눌러 담지 않는다. 예전에는 stderr 꼬리 바로 뒤에
    // hint 문장이 경계 없이 붙어 `... repository 명령이 단독으로` 처럼 읽혔다.
    expect(err).toContain("종료 코드: 128");
    expect(err).toContain("stderr 마지막 3줄: fatal: not a git repository");
    // 부재 확인만으로는 두 문자열이 다른 이유로 안 붙어 있어도(예: 사이에 그냥 이스케이프
    // 시퀀스만 남아도) 통과한다. 경계 자체가 실제 개행인지 직접 확인한다.
    expect(err).toContain("fatal: not a git repository\n해결:");
    // 진단은 message 에, hint 는 다음 행동 한 문장만 — 사전값이 갖고 있던 플래그 이름이
    // 동적 안내에서 빠졌던 것도 이 조합이 복원한다.
    expect(err).toContain("`--reset-cmd` 명령이 단독으로 성공하는지 확인한 뒤 다시 실행하세요.");
  });

  it("복원이 ResetCommandError 가 아닌 오류로 죽어도 사전 문장으로 나간다", async () => {
    // 다시 던지면 이 경로만 스택 트레이스가 화면에 나간다. 2회차의 같은 지점은 모든
    // 오류를 미완주로 삼키므로 처리도 갈린다.
    const d = deps({
      runResetCommand: vi.fn(async () => {
        throw new TypeError("spawn 인자가 비어 있습니다.");
      }),
    });
    const code = await runCli(
      ["test", "suite.json", "--command", "node", "--reset-cmd", "reset.sh"],
      d.value,
    );
    expect(code).toBe(1);
    expect(d.value.startRunner).not.toHaveBeenCalled();
    expect(d.value.connect).not.toHaveBeenCalled();
    const err = d.writes.err.join("");
    expect(err).toContain("오류 [CLI_INTERNAL_ERROR]");
    expect(err).not.toContain("TypeError");
  });

  it("2회차 미완주면 비교 없이 사유와 프로세스 진단을 찍는다", async () => {
    const check = vi.fn(() => sameResult("deterministic"));
    let call = 0;
    const d = deps({ checkDeterminism: check });
    d.value.finalize = vi.fn(async () => {
      call += 1;
      return call === 1 ? report() : report("aborted");
    });
    d.conn.getDiagnostics = () => diagnostics({ exitCode: 1, stderr: "EADDRINUSE\n" });
    const code = await runCli(
      ["test", "suite.json", "--command", "node", "--determinism"],
      d.value,
    );
    expect(code).toBe(0); // 1회차 판정만 반영한다
    expect(check).not.toHaveBeenCalled();
    const out = d.writes.out.join("");
    expect(out).toContain("결정론성 확인");
    expect(out).toContain("2회차 실행이 완주하지 못해 비교할 수 없습니다.");
    expect(out).toContain("서버가 반복 실행 자체에 취약할 수 있습니다");
    expect(out).toContain("서버 프로세스 진단");
    expect(out).toContain("EADDRINUSE");
  });

  it("2회차 연결 실패도 미완주로 다루고 종료 코드를 바꾸지 않는다", async () => {
    const check = vi.fn(() => sameResult("deterministic"));
    let call = 0;
    const d = deps({ checkDeterminism: check });
    const connect = d.value.connect;
    d.value.connect = vi.fn(async (options) => {
      call += 1;
      if (call === 2) throw new Error("spawn ENOENT");
      return connect(options);
    });
    const code = await runCli(
      ["test", "suite.json", "--command", "node", "--determinism"],
      d.value,
    );
    expect(code).toBe(0);
    expect(check).not.toHaveBeenCalled();
    expect(d.writes.out.join("")).toContain("2회차 실행이 완주하지 못해 비교할 수 없습니다.");
  });

  it("checkDeterminism 이 던지면 내부 오류 한 줄만 남기고 판정을 유지한다", async () => {
    const d = deps({
      checkDeterminism: vi.fn(() => {
        throw new Error("관찰한 케이스 수가 다릅니다: 1회차 3개, 2회차 2개.");
      }),
    });
    const code = await runCli(
      ["test", "suite.json", "--command", "node", "--determinism"],
      d.value,
    );
    expect(code).toBe(0);
    const out = d.writes.out.join("");
    expect(out).toContain("결정론성 확인");
    expect(out).toContain("예상하지 못한 CLI 내부 오류");
    expect(out).toContain("1회차");
  });

  it("판정·종료 코드가 1회차를 따른다", async () => {
    const d = deps({ checkDeterminism: vi.fn(differenceResult) });
    const code = await runCli(
      ["test", "suite.json", "--command", "node", "--determinism"],
      d.value,
    );
    expect(code).toBe(0);
    const out = d.writes.out.join("");
    expect(out).toContain("2/12 케이스에서 2회 실행 결과가 다릅니다.");
    expect(out).toContain("get_weather / 정상 조회 (case-3)");
    expect(out).toContain("시간 의존으로 보입니다");
    expect(out).toContain("create_file / 새 파일 (case-9)");
  });

  it("차이 0 과 복원 유무로 결론 문장이 갈린다", async () => {
    const withReset = deps({
      runResetCommand: vi.fn(async () => {}),
      checkDeterminism: vi.fn(() => sameResult("deterministic")),
    });
    await runCli(
      ["test", "suite.json", "--command", "node", "--determinism", "--reset-cmd", "reset.sh"],
      withReset.value,
    );
    expect(withReset.writes.out.join("")).toContain(
      "같은 초기 상태에서 2회 실행한 결과가 모든 케이스에서 같습니다. (12/12)",
    );

    const withoutReset = deps({
      checkDeterminism: vi.fn(() => sameResult("consistentWithoutReset")),
    });
    await runCli(["test", "suite.json", "--command", "node", "--determinism"], withoutReset.value);
    const out = withoutReset.writes.out.join("");
    expect(out).toContain("2회 실행 결과가 같았습니다. (12/12)");
    expect(out).toContain("상태를 복원하지 않았으므로 결정론성 확인은 아닙니다");
    expect(out).toContain("--reset-cmd");
  });

  it("비교 제외가 있으면 개수 뒤에 덧붙인다", async () => {
    const d = deps({ checkDeterminism: vi.fn(() => sameResult("consistentWithoutReset", 2)) });
    await runCli(["test", "suite.json", "--command", "node", "--determinism"], d.value);
    expect(d.writes.out.join("")).toContain("(12/12, 제외 2: 실행되지 않은 케이스)");
  });

  it("JUnit 과 repair 번들이 1회차 보고서로 만들어진다", async () => {
    let call = 0;
    const first = report("failed");
    const d = deps({ checkDeterminism: vi.fn(differenceResult) });
    d.value.finalize = vi.fn(async () => {
      call += 1;
      return call === 1 ? first : report();
    });
    const code = await runCli(
      [
        "test",
        "suite.json",
        "--command",
        "node",
        "--determinism",
        "--junit",
        "out.xml",
        "--repair-bundle",
        "bundle.json",
      ],
      d.value,
    );
    expect(code).toBe(1); // 1회차가 failed 다
    expect(d.value.renderJUnit).toHaveBeenCalledTimes(1);
    expect(d.value.renderJUnit).toHaveBeenCalledWith(first);
  });

  it("--json 에 determinism 키가 실린다", async () => {
    const result = sameResult("deterministic");
    const d = deps({ checkDeterminism: vi.fn(() => result) });
    await runCli(["test", "suite.json", "--command", "node", "--determinism", "--json"], d.value);
    const parsed = JSON.parse(d.writes.out.join(""));
    expect(parsed.determinism).toEqual(result);
  });

  it("--determinism 없으면 --json 출력이 바이트 단위로 같다", async () => {
    const d = deps();
    await runCli(["test", "suite.json", "--command", "node", "--json"], d.value);
    expect(d.writes.out.join("")).toBe(jsonOut(report()));
    expect(Object.hasOwn(JSON.parse(d.writes.out.join("")), "determinism")).toBe(false);
  });

  it("--determinism 없으면 텍스트 출력이 바이트 단위로 같다", async () => {
    const d = deps();
    const code = await runCli(["test", "suite.json", "--command", "node"], d.value);
    expect(code).toBe(0);
    expect(d.writes.out.join("")).toBe(RENDERED);
    expect(d.writes.err.join("")).toBe("");
  });

  it("--determinism 없으면 캡처 래퍼를 만들지 않는다", async () => {
    const d = deps();
    await runCli(["test", "suite.json", "--command", "node"], d.value);
    const [options] = vi.mocked(d.value.startRunner).mock.calls[0] ?? [];
    // 래퍼를 만들었다면 client 가 감싸진 객체이고 onEvent 가 붙는다.
    expect(options?.client).toBe(d.conn.client);
    expect(options?.onEvent).toBeUndefined();
  });

  it("--determinism 이면 캡처 래퍼로 감싸고 onEvent 를 배선한다", async () => {
    const d = deps({ checkDeterminism: vi.fn(() => sameResult("deterministic")) });
    await runCli(["test", "suite.json", "--command", "node", "--determinism"], d.value);
    const [options] = vi.mocked(d.value.startRunner).mock.calls[0] ?? [];
    expect(options?.client).not.toBe(d.conn.client);
    expect(typeof options?.onEvent).toBe("function");
  });

  it("--determinism 과 --reset-cmd 를 파싱한다", () => {
    const input = parseTestCommand([
      "suite.json",
      "--command",
      "node",
      "--determinism",
      "--reset-cmd",
      "git checkout .",
    ]);
    expect(input.determinism).toBe(true);
    expect(input.resetCmd).toBe("git checkout .");
    expect(
      parseTestCommand(["suite.json", "--command=node", "--reset-cmd=reset.sh"]).resetCmd,
    ).toBe("reset.sh");
    expect(parseTestCommand(["suite.json", "--command", "node"]).determinism).toBe(false);
    expect(parseTestCommand(["suite.json", "--command", "node"]).resetCmd).toBeUndefined();
  });

  it("--reset-cmd 값 누락·중복과 --determinism 값 지정을 거절한다", () => {
    for (const argv of [
      ["suite.json", "--command", "node", "--reset-cmd"],
      ["suite.json", "--command", "node", "--reset-cmd="],
      ["suite.json", "--command", "node", "--reset-cmd", "--json"],
    ])
      expect(() => parseTestCommand(argv)).toThrow("`--reset-cmd` 옵션 값이 필요합니다.");
    expect(() =>
      parseTestCommand(["suite.json", "--command", "node", "--reset-cmd", "a", "--reset-cmd", "b"]),
    ).toThrow("`--reset-cmd`는 한 번만 사용할 수 있습니다.");
    expect(() => parseTestCommand(["suite.json", "--command", "node", "--determinism=1"])).toThrow(
      "`--determinism`은 값을 받지 않습니다.",
    );
  });
});

/**
 * 실환경 회귀. `finalizeRunnerExecution` 은 `runSuite` 에 넘긴 client 와
 * `shutdown.client` 가 **같은 객체**일 것을 요구하고, 아니면 TypeError 를 던진다
 * (`runner/src/shutdown.ts` 의 `boundClient` 검사). 캡처 래퍼를 물리면서 한쪽만 감싸면
 * 1회차 finalize 가 통째로 실패하고 연결이 안 닫혀 좀비 프로세스가 남는다. 가짜 finalize
 * 로는 이 계약이 검증되지 않으므로 호출 인자의 동일성을 여기서 직접 단언한다.
 */
describe("결정론성 확인 — 종료 절차 계약", () => {
  const sameClientResult: DeterminismResult = {
    compared: 1,
    skipped: 0,
    differences: [],
    conclusion: "consistentWithoutReset",
  };

  it("각 회차의 runSuite client 와 shutdown.client 가 같은 객체다", async () => {
    const d = deps({ checkDeterminism: vi.fn(() => sameClientResult) });
    await runCli(["test", "suite.json", "--command", "node", "--determinism"], d.value);
    const started = vi.mocked(d.value.startRunner).mock.calls;
    const finalized = vi.mocked(d.value.finalize).mock.calls;
    expect(started).toHaveLength(2);
    expect(finalized).toHaveLength(2);
    for (let index = 0; index < 2; index += 1)
      expect(finalized[index]?.[0]?.shutdown.client).toBe(started[index]?.[0]?.client);
  });

  it("플래그가 없을 때도 같은 계약을 지킨다", async () => {
    const d = deps();
    await runCli(["test", "suite.json", "--command", "node"], d.value);
    const [started] = vi.mocked(d.value.startRunner).mock.calls;
    const [finalized] = vi.mocked(d.value.finalize).mock.calls;
    expect(finalized?.[0]?.shutdown.client).toBe(started?.[0]?.client);
    expect(started?.[0]?.client).toBe(d.conn.client);
  });

  it("1회차 연결을 닫은 뒤에 2회차 연결을 연다", async () => {
    const order: string[] = [];
    const d = deps({ checkDeterminism: vi.fn(() => sameClientResult) });
    const connect = d.value.connect;
    d.value.connect = vi.fn(async (options) => {
      order.push("connect");
      return connect(options);
    });
    // 실제 finalize 는 shutdown.close() 를 부른다. 가짜에서도 같은 자리에 넣어 순서를 본다.
    d.value.finalize = vi.fn(async ({ shutdown }) => {
      await shutdown.close();
      order.push("close");
      return report();
    });
    await runCli(["test", "suite.json", "--command", "node", "--determinism"], d.value);
    expect(order).toEqual(["connect", "close", "connect", "close"]);
    expect(d.conn.close).toHaveBeenCalledTimes(2);
  });

  it("2회차 finalize 가 실패하면 연결을 강제로 닫는다", async () => {
    let call = 0;
    const d = deps({ checkDeterminism: vi.fn(() => sameClientResult) });
    d.value.finalize = vi.fn(async () => {
      call += 1;
      if (call === 2) throw new Error("finalize 실패");
      return report();
    });
    const code = await runCli(
      ["test", "suite.json", "--command", "node", "--determinism"],
      d.value,
    );
    expect(code).toBe(0);
    // 좀비 프로세스를 남기지 않는다. 2회차 연결은 우리가 책임지고 닫는다.
    expect(d.conn.forceClose).toHaveBeenCalledTimes(1);
    expect(d.writes.out.join("")).toContain("2회차 실행 또는 서버 종료 실패");
  });
});
