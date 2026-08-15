import { createHash } from "node:crypto";
import { basename, dirname, normalize } from "node:path";
import { Readable, Writable } from "node:stream";
import type { McpStdioConnection, ToolDef, ToolResult } from "@ohmymcp/core";
import {
  type AuthoringDiffPreview,
  applyAuthoringChanges,
  BASELINE_POLICY_VERSION,
  type BaselineGenerationResult,
  createAuthoringDiff,
  createAuthoringSession,
  createBaselineSuite,
  dispatchAuthoringRequest,
  finalizeAuthoringDraft,
  getAuthoringExecutionSuite,
  type PublicProviderFailure,
  prepareAuthoringRequest,
  reviewLocalAuthoringCandidate,
  type SanitizedAuthoringCandidate,
  sha256,
} from "@ohmymcp/generate";
import type { Cassette } from "@ohmymcp/record";
import type { CallToolCaseSpec, SpecFinding, TestCaseSpec, TestSuiteSpec } from "@ohmymcp/runner";
import { suiteFingerprint, validateMcpSuite } from "@ohmymcp/runner";
import { describe, expect, it, vi } from "vitest";
import {
  type GenerateCommandDependencies,
  nodeReviewIO,
  parseGenerateCommand,
  renderCaseCountNotice,
  renderCoverage,
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
/**
 * 저장된 파일을 다시 읽었을 때의 모습. renderSuite 가 approval 블록을 써넣으므로 왕복
 * 재검증에 들어오는 값에도 그 블록이 있다. 지문 계산은 approval 을 제외하므로 값은 그대로다.
 */
const savedSuite: TestSuiteSpec = { ...suite, approval: { fingerprint } };

/** 임시 파일 이름은 실행마다 고유하므로 open 이벤트의 경로는 비교에서 제외한다. */
const normalizedEvents = (events: readonly string[]): string[] =>
  events.map((event) => (event.startsWith("open:") ? "open" : event));

const openedTempPath = (events: readonly string[]): string => {
  const event = events.find((item) => item.startsWith("open:"));
  if (event === undefined) throw new Error("임시 파일 open 이벤트가 필요합니다.");
  return event.slice("open:".length);
};

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
        policyVersion: "schema-baseline-v2" as const,
        // 이 스텁의 suite 는 케이스가 0개다. 커버리지도 그에 맞춰 비운다.
        coverage: { tools: [], verified: 0, total: 0 },
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
    validateSuite: vi.fn(() => ({ valid: true as const, value: savedSuite })),
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
      return new TextEncoder().encode(JSON.stringify(savedSuite));
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
      dryRun: true,
      cassettePath: undefined,
      forceRecord: false,
      force: false,
      resetCmd: undefined,
      repair: true,
    });
  });
  it("시험 실행 옵션 넷을 파싱한다", () => {
    expect(
      parseGenerateCommand([
        "--suite-id=weather",
        "--name=Weather",
        "--out=out.json",
        "--command=node",
        "--cassette",
        ".ohmymcp/w.json",
        "--record",
        "--reset-cmd",
        "npm run seed",
      ]),
    ).toMatchObject({
      dryRun: true,
      cassettePath: ".ohmymcp/w.json",
      forceRecord: true,
      resetCmd: "npm run seed",
    });
  });
  it("--no-dry-run 은 dryRun 을 끈다", () => {
    expect(
      parseGenerateCommand([
        "--suite-id=weather",
        "--name=Weather",
        "--out=out.json",
        "--command=node",
        "--no-dry-run",
      ]),
    ).toMatchObject({ dryRun: false });
  });
  it("시험 실행 옵션의 사용 오류를 거절한다", () => {
    const base = ["--suite-id=x", "--name=n", "--out=x.json", "--command=node"];
    const cases: readonly (readonly string[])[] = [
      // --no-dry-run 을 두 번
      [...base, "--no-dry-run", "--no-dry-run"],
      // --no-dry-run 과 --cassette
      [...base, "--no-dry-run", "--cassette", "c.json"],
      // --no-dry-run 과 --reset-cmd
      [...base, "--no-dry-run", "--reset-cmd", "npm run seed"],
      // --record 를 --cassette 없이
      [...base, "--record"],
      // --reset-cmd 값이 빈 문자열
      [...base, "--reset-cmd="],
      // --cassette 를 두 번
      [...base, "--cassette", "a.json", "--cassette", "b.json"],
    ];
    for (const argv of cases) expect(() => parseGenerateCommand(argv)).toThrow();
  });
  it("--no-repair 를 두 번 주면 사용 오류다", () => {
    const base = ["--suite-id=x", "--name=n", "--out=x.json", "--command=node"];
    expect(() => parseGenerateCommand([...base, "--no-repair", "--no-repair"])).toThrow();
  });
  it("--no-repair 와 --no-dry-run 을 함께 주면 사용 오류다", () => {
    const base = ["--suite-id=x", "--name=n", "--out=x.json", "--command=node"];
    expect(() => parseGenerateCommand([...base, "--no-repair", "--no-dry-run"])).toThrow();
  });
  it("--no-repair 를 주면 repair 가 꺼진다", () => {
    expect(
      parseGenerateCommand([
        "--suite-id=weather",
        "--name=Weather",
        "--out=out.json",
        "--command=node",
        "--no-repair",
      ]),
    ).toMatchObject({ repair: false, dryRun: true });
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
  const outPath = "/tmp/out.json";
  const argv = [
    "generate",
    "--suite-id",
    "weather",
    "--name",
    "Weather",
    "--out",
    outPath,
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
  /**
   * 저장이 끝난 뒤에 커버리지가 실패하면 저장 실패로 보고하면 안 된다. 그러면 사용자가 저장을
   * 다시 시도하고 이번에는 OUTPUT_EXISTS 를 만난다. 파일은 이미 있다.
   */
  it("커버리지 렌더링이 실패해도 저장은 성공으로 보고한다", async () => {
    const d = deps({
      createBaselineSuite: vi.fn(
        () =>
          ({
            suite,
            baselineFingerprint: "baseline",
            suiteFingerprint: "suite",
            policyVersion: "schema-baseline-v2" as const,
            // renderCoverage 가 순회하다 던지는 모양. tools 가 배열이 아니다.
            coverage: { tools: null, verified: 0, total: 0 },
          }) as never,
      ),
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    d.value.writeStdout = (text) => stdout.push(text);
    d.value.writeStderr = (text) => stderr.push(text);
    expect(await runGenerateCommand(argv, d.value)).toBe(0);
    expect(stdout.join("")).toContain("baseline suite를 저장했습니다");
    const output = stderr.join("");
    expect(output).toContain("GENERATE_COVERAGE_UNAVAILABLE");
    expect(output).toContain("명세는 저장했지만");
    expect(output).not.toContain("GENERATE_FAILED");
    // 저장은 끝까지 갔다. link 와 unlink 가 그 증거다.
    expect(normalizedEvents(d.events)).toContain("link");
    expect(normalizedEvents(d.events)).toContain("unlink");
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
    const opened = openedTempPath(d.events);
    expect(dirname(opened)).toBe(normalize(dirname(outPath)));
    expect(basename(opened)).toMatch(/^\.out\.json\.ohmymcp\./);
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
    expect(output).not.toContain("GENERATE_LINK_UNSUPPORTED");
    expect(output).not.toContain("EXDEV");
  });

  /** link가 지정한 errno로 실패하게 만든 뒤 stderr를 돌려준다. */
  async function linkFailsWith(
    code: string,
  ): Promise<{ output: string; deps: ReturnType<typeof deps> }> {
    const d = deps();
    const stderr: string[] = [];
    d.value.writeStderr = (text) => stderr.push(text);
    d.value.link = vi.fn(async () => {
      const error: NodeJS.ErrnoException = new Error(
        `${code}: RAW_LINK_ERROR_TEXT, link '/tmp/x' -> '/tmp/y'`,
      );
      error.code = code;
      throw error;
    });
    expect(await runGenerateCommand(argv, d.value)).toBe(1);
    return { output: stderr.join(""), deps: d };
  }

  it("hard link를 지원하지 않으면 다른 디렉터리를 쓰도록 안내한다", async () => {
    const { output, deps: d } = await linkFailsWith("EPERM");
    expect(output).toContain("GENERATE_LINK_UNSUPPORTED");
    expect(output).toContain("경로: /tmp/out.json");
    expect(output).toContain("--out");
    expect(output).toContain("(원인: EPERM)");
    expect(output).not.toContain("GENERATE_FAILED");
    expect(output).not.toContain("GENERATE_OUTPUT_EXISTS");
    // 남의 파일을 건드리지 않았고 자기 임시 파일은 치웠다.
    expect(d.value.unlink).toHaveBeenCalledOnce();
  });
  it("ENOTSUP도 같은 안내 경로를 탄다", async () => {
    const { output } = await linkFailsWith("ENOTSUP");
    expect(output).toContain("GENERATE_LINK_UNSUPPORTED");
    expect(output).toContain("(원인: ENOTSUP)");
    expect(output).not.toContain("GENERATE_FAILED");
  });
  it("EEXIST는 여전히 출력 충돌 안내다", async () => {
    const { output } = await linkFailsWith("EEXIST");
    expect(output).toContain("GENERATE_OUTPUT_EXISTS");
    expect(output).not.toContain("GENERATE_LINK_UNSUPPORTED");
  });
  it("link 실패 안내에 원본 오류 문자열과 스택이 노출되지 않는다", async () => {
    const outputs: string[] = [];
    for (const code of ["EPERM", "ENOTSUP", "EEXIST", "EXDEV", "EIO"])
      outputs.push((await linkFailsWith(code)).output);
    const output = outputs.join("");
    expect(output).not.toContain("RAW_LINK_ERROR_TEXT");
    expect(output).not.toContain("EXDEV");
    expect(output).not.toContain("EIO");
    expect(output.split("\n").some((line) => line.trimStart().startsWith("at "))).toBe(false);
  });
  it("임시 파일 이름은 실행마다 다르다", async () => {
    const opened: string[] = [];
    for (let run = 0; run < 2; run += 1) {
      const d = deps();
      await runGenerateCommand(argv, d.value);
      opened.push(openedTempPath(d.events));
    }
    const [first, second] = opened;
    if (first === undefined || second === undefined)
      throw new Error("두 실행의 임시 파일 경로가 필요합니다.");
    expect(first).not.toBe(second);
    for (const tempPath of [first, second]) {
      expect(dirname(tempPath)).toBe(normalize(dirname(outPath)));
      expect(basename(tempPath)).toMatch(/^\.out\.json\.ohmymcp\./);
    }
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
  /** 저장 경로가 실제로 임시 파일에 쓴 텍스트. 키 순서와 approval 블록을 여기서 본다. */
  async function savedText(overrides: Partial<GenerateCommandDependencies> = {}): Promise<string> {
    const writeFile = vi.fn<(data: string, encoding: "utf8") => Promise<void>>(
      async () => undefined,
    );
    const d = deps({
      openTemp: vi.fn(async () => ({ writeFile, sync: vi.fn(), close: vi.fn() })),
      ...overrides,
    });
    await runGenerateCommand(argv, d.value);
    const text = writeFile.mock.calls[0]?.[0];
    if (text === undefined) throw new Error("저장 경로가 임시 파일에 쓰지 않았습니다.");
    return text;
  }

  it("저장 JSON은 고정 필드 순서, 2칸 indent와 마지막 newline을 쓴다", async () => {
    expect(await savedText()).toBe(
      `{\n  "schemaVersion": 1,\n  "id": "weather",\n  "name": "Weather",\n  "approval": {\n    "fingerprint": "${fingerprint}"\n  },\n  "defaultTimeoutMs": 10000,\n  "cases": []\n}\n`,
    );
  });
  it("저장된 JSON의 approval.fingerprint가 finalize가 낸 값과 같다", async () => {
    expect(JSON.parse(await savedText()).approval).toEqual({ fingerprint });
  });
  it("저장된 JSON의 키 순서가 schemaVersion, id, name, approval, defaultTimeoutMs, cases다", async () => {
    expect(Object.keys(JSON.parse(await savedText()))).toEqual([
      "schemaVersion",
      "id",
      "name",
      "approval",
      "defaultTimeoutMs",
      "cases",
    ]);
  });
  /**
   * 실제 baseline 으로 왕복을 본다. 위 `suite` 리터럴은 `cases` 가 비어 있어 스텁이 아닌
   * 진짜 `validateMcpSuite` 를 통과하지 못한다(EMPTY_CASES). 파일 형식 자체를 확인하는
   * 아래 두 단언에는 유효한 명세가 필요하다.
   */
  const baselineSuite = createBaselineSuite(tools, {
    suiteId: "weather",
    suiteName: "Weather",
  }).suite;
  const baselineFingerprint = suiteFingerprint(baselineSuite);
  const baselineOverrides = {
    getAuthoringExecutionSuite: vi.fn(() => baselineSuite),
    finalizeAuthoringDraft: vi.fn(
      () => ({ finalized: true, snapshot: { fingerprint: baselineFingerprint } }) as never,
    ),
  };

  it("저장된 파일을 다시 읽어 validateMcpSuite에 넣으면 valid: true다", async () => {
    const validated = validateMcpSuite(JSON.parse(await savedText(baselineOverrides)));
    expect(validated.valid).toBe(true);
  });
  it("저장 전 지문과 저장된 파일로 계산한 suiteFingerprint가 같다", async () => {
    const validated = validateMcpSuite(JSON.parse(await savedText(baselineOverrides)));
    if (!validated.valid) throw new Error("저장된 파일이 유효해야 합니다.");
    expect(suiteFingerprint(validated.value)).toBe(baselineFingerprint);
    expect(validated.value.approval?.fingerprint).toBe(baselineFingerprint);
  });
  it("renderSuite가 approval에 틀린 값을 쓰면 saveSuite가 link를 부르지 않는다", async () => {
    // renderSuite 는 내부 함수라 직접 못 바꾼다. 다시 읽은 파일의 approval 만 틀리게 만들어
    // 같은 결함(파일에 적힌 지문이 계산값과 다름)을 재현한다. 왕복 재검증의 셋째 조건이
    // 없으면 이 시나리오가 통과해 버린다.
    const d = deps({
      validateSuite: vi.fn(() => ({
        valid: true as const,
        value: { ...suite, approval: { fingerprint: "0".repeat(64) } },
      })),
    });
    expect(await runGenerateCommand(argv, d.value)).toBe(1);
    expect(d.value.link).not.toHaveBeenCalled();
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
  /**
   * 저장 실패 경로만 보는 테스트에 쓴다. 시험 실행을 켜면 확인 하나와 분류 화면이 끼어들어
   * 무엇을 보는 테스트인지 흐려진다. 이 경로의 확인은 §8.5 하나와 저장 확인 하나다.
   */
  const noDryRunArgv = [...interactiveArgv, "--no-dry-run"];
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
  /**
   * 가짜 ReviewIO 의 mock 호출 인자를 문자열로 모은다. reviewDeps 의 vi.fn 은 파라미터를
   * 선언하지 않아 calls 원소가 빈 튜플로 추론된다. 여기서 한 번만 좁힌다.
   */
  const writtenText = (calls: readonly unknown[][]): string =>
    calls.map((call) => String(call[0])).join("");
  const confirmMessages = (calls: readonly unknown[][]): string[] =>
    calls.map((call) => String(call[0]));

  /** 문장 검사에 필요한 필드만 넘기고 나머지는 기본값을 쓴다. */
  const finding = (over: Partial<SpecFinding> & Pick<SpecFinding, "code">): SpecFinding => ({
    severity: "blocking",
    caseId: "seoul-weather",
    path: "input.city",
    ...over,
  });

  /**
   * specFindings 표시 분기만 태우기 위한 준비. candidate 와 diff 를 리터럴로 만들고 주입한다.
   * 실제 generate 함수를 부르면 findings 를 원하는 caseId 로 고정할 수 없고, 이 테스트가
   * 지키려는 것은 표시와 게이트 조건이지 검사 로직이 아니다(그쪽은 runner 테스트가 덮는다).
   *
   * diff 는 change-001(다른 케이스) 과 change-002(seoul-weather) 를 낸다.
   */
  function findingsDeps(
    choices: string[],
    inputs: string[],
    confirms: boolean[],
    specFindings: { inputContract: SpecFinding[]; assertionSubstance: SpecFinding[] },
  ) {
    const d = reviewDeps(choices, inputs, confirms);
    const source = d.baseline.suite.cases[0];
    if (source === undefined) throw new Error("baseline case가 필요합니다.");
    const busan: TestCaseSpec = { ...source, id: "busan-weather" };
    const seoul: TestCaseSpec = { ...source, id: "seoul-weather" };
    const candidate = {
      result: { status: "candidate" as const, suite: d.baseline.suite, questions: [] },
      byteLength: 0,
      redactedPaths: [],
      executable: true,
      requiresApproval: true as const,
      fingerprint: "f".repeat(64),
      specFindings: {
        inputContract: { findings: specFindings.inputContract, totalFindings: 0 },
        assertionSubstance: { findings: specFindings.assertionSubstance, totalFindings: 0 },
      },
      binding: {},
    } as unknown as SanitizedAuthoringCandidate;
    const diff = {
      changes: [
        {
          id: "change-001",
          type: "replaceCase" as const,
          caseId: "busan-weather",
          approvedIndex: 0,
          before: busan,
          after: busan,
        },
        {
          id: "change-002",
          type: "replaceCase" as const,
          caseId: "seoul-weather",
          approvedIndex: 1,
          before: seoul,
          after: seoul,
        },
      ],
      candidate: d.baseline.suite,
      candidateFingerprint: candidate.fingerprint,
      requiresApproval: true as const,
      binding: candidate.binding,
    } as unknown as AuthoringDiffPreview;
    let applied = 0;
    Object.assign(d.value, {
      reviewLocalAuthoringCandidate: vi.fn(() => ({ status: "preview", preview: candidate })),
      createAuthoringDiff: vi.fn(() => diff),
      applyAuthoringChanges: vi.fn(() => {
        applied += 1;
        return { applied: true, draft: { revision: 1 } };
      }),
    });
    d.value.readFile = vi.fn(async () =>
      new TextEncoder().encode(JSON.stringify(d.baseline.suite)),
    );
    return { ...d, appliedCount: () => applied };
  }

  /** seoul-weather 케이스에만 걸린 위반 둘. change-001 쪽 케이스는 깨끗하다. */
  const twoViolations = {
    inputContract: [
      finding({ code: "REQUIRED_MISSING", expected: "city", suggestion: "citi" }),
      finding({ code: "UNDECLARED_FIELD", actual: "citi", suggestion: "city", path: "input.citi" }),
    ],
    assertionSubstance: [],
  };

  it("선택한 change 의 케이스에 걸린 finding 만 센다", async () => {
    // change-001 은 깨끗하고 change-002 만 위반이다. change-001 만 고르면 경고가 없다.
    const d = findingsDeps(
      ["edit", "select", "cancel"],
      ["candidate.json", "change-001"],
      [true],
      twoViolations,
    );
    await runGenerateCommand(interactiveArgv, d.value);
    const out = writtenText(d.io.write.mock.calls);
    expect(out).not.toContain("입력 계약 위반");
    expect(confirmMessages(d.io.confirm.mock.calls)).toEqual(["선택한 변경을 적용할까요?"]);
  });

  it("위반 케이스를 고르면 문장과 재확인이 나온다", async () => {
    const d = findingsDeps(
      ["edit", "select", "cancel"],
      ["candidate.json", "change-002"],
      [true, true],
      twoViolations,
    );
    await runGenerateCommand(interactiveArgv, d.value);
    const out = writtenText(d.io.write.mock.calls);
    expect(out).toContain("입력 계약 위반 2건 (선택한 변경 기준)");
    expect(out).toContain("  → change-002 seoul-weather\n");
    expect(out).toContain("필수 필드 'city' 가 입력에 없습니다. 비슷한 필드: 'citi'");
    expect(out).toContain("'citi' 는 서버가 선언하지 않은 필드입니다. 비슷한 필드: 'city'");
    expect(confirmMessages(d.io.confirm.mock.calls)).toEqual([
      "위반 2건이 남아 있습니다. 그래도 적용합니까?",
      "선택한 변경을 적용할까요?",
    ]);
  });

  it("재확인에서 거부하면 적용하지 않는다", async () => {
    const d = findingsDeps(
      ["edit", "select", "cancel"],
      ["candidate.json", "change-002"],
      [false],
      twoViolations,
    );
    await runGenerateCommand(interactiveArgv, d.value);
    expect(d.appliedCount()).toBe(0);
    expect(confirmMessages(d.io.confirm.mock.calls)).toEqual([
      "위반 2건이 남아 있습니다. 그래도 적용합니까?",
    ]);
  });

  it("SCHEMA_NOT_ANALYZABLE 은 위반 개수에서 빠지고 별도 줄로 나온다", async () => {
    const d = findingsDeps(["edit", "apply-all", "cancel"], ["candidate.json"], [true], {
      inputContract: [
        finding({ code: "SCHEMA_NOT_ANALYZABLE", severity: "advisory", actual: "weather" }),
      ],
      assertionSubstance: [],
    });
    await runGenerateCommand(interactiveArgv, d.value);
    const out = writtenText(d.io.write.mock.calls);
    expect(out).toContain("해석하지 못한 서버 스키마 1건은 검사에서 빠졌습니다.");
    expect(out).not.toContain("입력 계약 위반");
    expect(confirmMessages(d.io.confirm.mock.calls)).toEqual(["선택한 변경을 적용할까요?"]);
  });

  it("finding 이 없으면 아무 줄도 늘지 않는다", async () => {
    const d = findingsDeps(["edit", "apply-all", "cancel"], ["candidate.json"], [true], {
      inputContract: [],
      assertionSubstance: [],
    });
    await runGenerateCommand(interactiveArgv, d.value);
    const out = writtenText(d.io.write.mock.calls);
    expect(out).not.toContain("입력 계약");
    expect(out).not.toContain("검사에서 빠졌습니다");
    expect(confirmMessages(d.io.confirm.mock.calls)).toEqual(["선택한 변경을 적용할까요?"]);
  });

  it("caseId 가 없는 change 만 고르면 경고가 없다", async () => {
    // suiteMetadata · caseOrder 는 caseId 집합에 아무것도 넣지 않는다. 존재하지 않는 change ID
    // 를 골라 같은 상태(빈 집합)를 만든다.
    const d = findingsDeps(
      ["edit", "select", "cancel"],
      ["candidate.json", "change-999"],
      [true],
      twoViolations,
    );
    await runGenerateCommand(interactiveArgv, d.value);
    const out = writtenText(d.io.write.mock.calls);
    expect(out).not.toContain("입력 계약 위반");
  });

  it("단언 실질성 finding 은 입력 계약과 갈라 세고 재확인은 합계로 한 번만 받는다", async () => {
    // VACUOUS_MIN_LENGTH 는 입력 문제가 아니다. '입력 계약 위반' 머리글 아래 붙으면 읽는
    // 사람이 입력을 고치러 간다. 머리글을 갈라 어디를 고쳐야 하는지가 보이게 한다.
    const d = findingsDeps(
      ["edit", "select", "cancel"],
      ["candidate.json", "change-002"],
      [true, true],
      {
        inputContract: [finding({ code: "REQUIRED_MISSING", expected: "city" })],
        assertionSubstance: [
          finding({
            code: "VACUOUS_MIN_LENGTH",
            severity: "advisory",
            path: "assertions[0].schema.minLength",
          }),
        ],
      },
    );
    await runGenerateCommand(interactiveArgv, d.value);
    const out = writtenText(d.io.write.mock.calls);
    expect(out).toContain("입력 계약 위반 1건 (선택한 변경 기준)");
    expect(out).toContain("항상 통과하는 단언 1건 (선택한 변경 기준)");
    expect(out).toContain("필수 필드 'city' 가 입력에 없습니다");
    expect(out).toContain("assertions[0].schema.minLength 는 0이라 모든 문자열이 통과합니다");
    // 입력 계약 블록이 먼저다.
    expect(out.indexOf("입력 계약 위반")).toBeLessThan(out.indexOf("항상 통과하는 단언"));
    // 종류가 둘이어도 판단은 하나다. 확인을 두 번 받지 않는다.
    expect(confirmMessages(d.io.confirm.mock.calls)).toEqual([
      "위반 2건이 남아 있습니다. 그래도 적용합니까?",
      "선택한 변경을 적용할까요?",
    ]);
  });

  it("단언 실질성 finding 만 있으면 입력 계약 머리글이 안 나온다", async () => {
    const d = findingsDeps(
      ["edit", "select", "cancel"],
      ["candidate.json", "change-002"],
      [true, true],
      {
        inputContract: [],
        assertionSubstance: [
          finding({
            code: "VACUOUS_MIN_ITEMS",
            severity: "advisory",
            path: "assertions[0].schema.minItems",
          }),
        ],
      },
    );
    await runGenerateCommand(interactiveArgv, d.value);
    const out = writtenText(d.io.write.mock.calls);
    expect(out).not.toContain("입력 계약 위반");
    expect(out).toContain("항상 통과하는 단언 1건 (선택한 변경 기준)");
    expect(confirmMessages(d.io.confirm.mock.calls)).toEqual([
      "위반 1건이 남아 있습니다. 그래도 적용합니까?",
      "선택한 변경을 적용할까요?",
    ]);
  });

  it("최종 fingerprint 승인 뒤에만 JSON을 저장한다", async () => {
    const d = reviewDeps(["save", "cancel"], [], [false]);
    await runGenerateCommand(interactiveArgv, d.value);
    expect(d.value.openTemp).not.toHaveBeenCalled();
    expect(d.io.confirm).toHaveBeenCalledOnce();
  });
  it("저장하려는 경로에 파일이 있으면 경로와 조치를 안내한다", async () => {
    const d = reviewDeps(["save", "cancel"], [], [true, true]);
    d.value.exists = vi.fn(async () => true);
    await runGenerateCommand(noDryRunArgv, d.value);
    const output = d.stderr.join("");
    expect(output).toContain("GENERATE_OUTPUT_EXISTS");
    expect(output).toContain("경로: /tmp/out.json");
    expect(output).toContain("--out");
    expect(output).not.toContain("GENERATE_SAVE_FAILED");
    expect(d.value.openTemp).not.toHaveBeenCalled();
  });
  it("경로 충돌이 아닌 저장 실패는 기존 문구를 유지한다", async () => {
    const d = reviewDeps(["save", "cancel"], [], [true, true]);
    d.value.openTemp = vi.fn(async () => {
      throw new Error("EACCES");
    });
    await runGenerateCommand(noDryRunArgv, d.value);
    const output = d.stderr.join("");
    expect(output).toContain("GENERATE_SAVE_FAILED");
    expect(output).not.toContain("GENERATE_OUTPUT_EXISTS");
    expect(output).not.toContain("EACCES");
  });
  it("대화형 저장에서도 hard link 불가를 전용 문구로 안내한다", async () => {
    const d = reviewDeps(["save", "cancel"], [], [true, true]);
    // 임시 파일을 실제로 왕복시켜 fingerprint 재검증을 통과시켜야 link 단계까지 간다.
    let written = "";
    d.value.openTemp = vi.fn(async () => ({
      writeFile: vi.fn(async (data: string) => {
        written = data;
      }),
      sync: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    }));
    d.value.readFile = vi.fn(async () => new TextEncoder().encode(written));
    d.value.validateSuite = vi.fn((value) => ({
      valid: true as const,
      value: value as TestSuiteSpec,
    }));
    d.value.link = vi.fn(async () => {
      const error: NodeJS.ErrnoException = new Error("EPERM: RAW_LINK_ERROR_TEXT");
      error.code = "EPERM";
      throw error;
    });
    await runGenerateCommand(noDryRunArgv, d.value);
    const output = d.stderr.join("");
    expect(output).toContain("GENERATE_LINK_UNSUPPORTED");
    expect(output).toContain("경로: /tmp/out.json");
    expect(output).not.toContain("GENERATE_SAVE_FAILED");
    expect(output).not.toContain("RAW_LINK_ERROR_TEXT");
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

describe("커버리지 화면", () => {
  const axis = (
    kind: "HAPPY_PATH" | "REQUIRED_OMITTED" | "TYPE_VIOLATION" | "ENUM_VIOLATION",
    field: string | null,
    caseId: string | null,
  ) => ({ kind, field, caseId });
  const toolCoverage = (
    name: string,
    axes: ReturnType<typeof axis>[],
    extra: { analyzable?: boolean; unanalyzableReason?: string; unanalyzedFields?: string[] } = {},
  ) => ({
    tool: name,
    analyzable: extra.analyzable ?? true,
    unanalyzableReason: extra.unanalyzableReason ?? null,
    axes,
    verified: axes.filter((item) => item.caseId !== null).length,
    total: axes.length,
    unanalyzedFields: extra.unanalyzedFields ?? [],
  });
  const result = (tools: ReturnType<typeof toolCoverage>[]) => ({
    tools,
    verified: tools.reduce((sum, item) => sum + item.verified, 0),
    total: tools.reduce((sum, item) => sum + item.total, 0),
  });
  const verifiedAxes = (count: number) =>
    Array.from({ length: count }, (_, index) => axis("TYPE_VIOLATION", `f${index}`, `c${index}`));

  it("전부 검증되면 한 줄이다", () => {
    const coverage = result([
      toolCoverage("add", verifiedAxes(5)),
      toolCoverage("get_weather", verifiedAxes(3)),
    ]);
    expect(renderCoverage(coverage)).toBe("커버리지  2 tools, 8 axes 전부 검증\n");
  });

  it("미검증이 있으면 툴별 줄이 나오고 미검증 축만 ? 로 들여쓴다", () => {
    const coverage = result([
      toolCoverage("add", verifiedAxes(5)),
      toolCoverage("get_weather", verifiedAxes(3)),
      toolCoverage("search_docs", [
        ...verifiedAxes(4),
        axis("TYPE_VIOLATION", "filters", null),
        axis("ENUM_VIOLATION", "filters", null),
      ]),
    ]);
    expect(renderCoverage(coverage)).toBe(
      [
        "커버리지  3 tools, 12/14 axes 검증",
        "  add           5/5",
        "  get_weather   3/3",
        "  search_docs   4/6",
        "    ? filters 의 타입 위반 거절            미검증",
        "    ? filters 의 선언되지 않은 값 거절     미검증",
        "",
      ].join("\n"),
    );
  });

  it("해석 불가 툴은 사유 괄호가 붙고 커버리지 숫자에서 빠진다", () => {
    const coverage = result([
      toolCoverage("add", verifiedAxes(5)),
      toolCoverage("get_weather", verifiedAxes(3)),
      toolCoverage("search_docs", [], { analyzable: false, unanalyzableReason: "anyOf" }),
    ]);
    expect(renderCoverage(coverage)).toBe(
      [
        "커버리지  3 tools, 8/8 axes 검증",
        "  add           5/5",
        "  get_weather   3/3",
        "  search_docs   해석 불가",
        "    → 입력 스키마를 해석하지 못해 이 툴의 축을 세지 못했습니다 (anyOf)",
        "    → 이 툴은 커버리지 숫자에 들어가지 않습니다",
        "",
      ].join("\n"),
    );
  });

  it("해석 못 한 필드가 있으면 이름을 나열한 줄이 붙는다", () => {
    const coverage = result([
      toolCoverage("search_docs", [...verifiedAxes(4), axis("TYPE_VIOLATION", "query", null)], {
        unanalyzedFields: ["filters"],
      }),
    ]);
    expect(renderCoverage(coverage)).toBe(
      [
        "커버리지  1 tools, 4/5 axes 검증",
        "  search_docs   4/5",
        "    ? query 의 타입 위반 거절     미검증",
        "    → 해석 못 한 필드 1개: filters. 이 필드의 축은 세지 않았습니다",
        "",
      ].join("\n"),
    );
  });

  it("툴이 0개면 아무것도 찍지 않는다", () => {
    expect(renderCoverage(result([]))).toBe("");
  });

  it("축이 0개인 툴만 있으면 전부 검증이라고 쓰지 않는다", () => {
    // 0/0 은 검증이 아니다. verified === total 이 참이어도 "전부 검증" 은 거짓 화면이다.
    const coverage = result([
      toolCoverage("a", [], { analyzable: false, unanalyzableReason: "anyOf" }),
    ]);
    expect(coverage.verified).toBe(coverage.total);
    expect(renderCoverage(coverage)).not.toContain("전부 검증");
    expect(renderCoverage(coverage)).toContain("커버리지  1 tools, 0/0 axes 검증");
  });

  it("HAPPY_PATH 축은 필드 없이 종류만 적는다", () => {
    const coverage = result([toolCoverage("a", [axis("HAPPY_PATH", null, null)])]);
    expect(renderCoverage(coverage)).toContain("? 선언을 지킨 입력에 정상 응답");
  });
});

describe("케이스 수 고지", () => {
  it("1500개 미만이면 고지가 없다", () => {
    expect(renderCaseCountNotice(1499)).toBe("");
  });

  it("1500개 이상이면 두 줄 고지가 나온다", () => {
    expect(renderCaseCountNotice(1842)).toBe(
      [
        "→ 케이스 1842개를 만들었습니다. runner 보고서 상한(1MB)에 가까워 test 실행이",
        "  RunnerPayloadLimitError 로 실패할 수 있습니다.",
        "→ 툴을 나눠 여러 명세 파일로 생성하면 피할 수 있습니다.",
        "",
      ].join("\n"),
    );
  });

  it("고지가 있어도 exit code 는 0 이다", async () => {
    const many: TestCaseSpec[] = Array.from({ length: 1500 }, (_, index) => ({
      id: `case-${index}`,
      name: `case ${index}`,
      operation: { type: "callTool", tool: "weather", input: {} },
      assertions: [{ type: "isError", expected: false }],
    }));
    const bigSuite: TestSuiteSpec = { ...suite, cases: many };
    const stdout: string[] = [];
    const d = deps({
      getAuthoringExecutionSuite: vi.fn(() => bigSuite),
      writeStdout: (text: string) => {
        stdout.push(text);
      },
    });
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
          "--baseline-only",
        ],
        d.value,
      ),
    ).resolves.toBe(0);
    expect(stdout.join("")).toContain("케이스 1500개를 만들었습니다");
  });
});

/**
 * 승인 전 시험 실행 게이트. 실제 `runDryRun`·`reviewDryRun`·`wireCassette` 를 그대로 돌리고
 * 서버와 카세트 파일만 인메모리로 바꾼다. 게이트가 무엇을 묻고 무엇을 저장하는지가 관심사이므로
 * 그 세 모듈을 스텁으로 바꾸면 확인할 것이 남지 않는다.
 */
describe("generate 시험 실행 게이트", () => {
  const gateTools: ToolDef[] = [
    {
      name: "weather",
      inputSchema: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
    },
  ];
  const ok = (): ToolResult => ({
    content: [{ type: "text", text: "ok" }],
    isError: false,
    raw: { ok: true },
  });
  const gateArgv = [
    "generate",
    "--suite-id",
    "weather",
    "--name",
    "Weather",
    "--out",
    "/tmp/gate.json",
    "--command",
    "node",
    "--arg",
    "server.mjs",
  ];

  interface GateOptions {
    readonly choices: string[];
    readonly inputs?: string[];
    readonly confirms?: boolean[];
    /** 인메모리 서버. 기본은 항상 정상 응답이라 위반 케이스가 실패한다. */
    readonly respond?: (name: string, args: unknown, call: number) => ToolResult;
    readonly diagnostics?: () =>
      | never
      | {
          stderr: string;
          stderrTruncated: boolean;
          exitCode: number | null;
          signal: string | null;
        };
    /** 카세트 파일 대용. 두 번의 save 사이에 살아남아야 하므로 밖에서 넘긴다. */
    readonly cassetteStore?: Map<string, Cassette>;
    /** 서버가 선언하는 툴. 교정 대상이 둘 이상인 경우를 만들 때 바꾼다. */
    readonly tools?: ToolDef[];
    /** baseline 생성 결과를 통째로 갈아 끼운다. 본문 단언이 달린 케이스를 만들 때 쓴다. */
    readonly baseline?: BaselineGenerationResult;
    /** AI 제안용 provider. 없으면 교정이 사람 입력만 쓴다. */
    readonly providers?: GenerateCommandDependencies["providers"];
    /** 반영 경로 호출 횟수를 세려고 감싼 구현. */
    readonly applyAuthoringChanges?: typeof applyAuthoringChanges;
    /** `edit` 메뉴가 읽을 로컬 JSON. 경로 `candidate.json` 으로만 읽힌다. */
    readonly localCandidate?: TestSuiteSpec;
  }

  function gateDeps(options: GateOptions) {
    const choices = [...options.choices];
    const inputs = [...(options.inputs ?? [])];
    const confirms = [...(options.confirms ?? [])];
    const screen: string[] = [];
    const stderr: string[] = [];
    const calls: string[] = [];
    let closes = 0;
    let saved = "";
    const io = {
      interactive: true,
      choose: vi.fn(async () => choices.shift() ?? "cancel"),
      input: vi.fn(async (message: string) => {
        screen.push(message);
        return inputs.shift() ?? "";
      }),
      confirm: vi.fn(async (message: string) => {
        screen.push(`${message} [y/N] `);
        return confirms.shift() ?? false;
      }),
      write: vi.fn((text: string) => {
        screen.push(text);
      }),
      close: vi.fn(),
    };
    const serverTools = options.tools ?? gateTools;
    const connection: McpStdioConnection = {
      client: {
        listTools: async () => serverTools,
        callTool: async (name, args) => {
          const call = calls.filter((item) => item === name).length;
          calls.push(name);
          return (options.respond ?? ok)(name, args, call);
        },
        close: async () => undefined,
      },
      getDiagnostics: vi.fn(
        options.diagnostics ??
          (() => ({ stderr: "", stderrTruncated: false, exitCode: null, signal: null })),
      ) as McpStdioConnection["getDiagnostics"],
      close: vi.fn(async () => {
        closes += 1;
      }),
      forceClose: vi.fn(async () => undefined),
    };
    const store = options.cassetteStore ?? new Map<string, Cassette>();
    const value: GenerateCommandDependencies = {
      connect: vi.fn(async () => connection),
      createBaselineSuite:
        options.baseline === undefined
          ? createBaselineSuite
          : () => options.baseline as BaselineGenerationResult,
      createAuthoringSession,
      finalizeAuthoringDraft,
      getAuthoringExecutionSuite,
      validateSuite: validateMcpSuite,
      exists: vi.fn(async () => false),
      openTemp: vi.fn(async () => ({
        writeFile: vi.fn(async (data: string) => {
          saved = data;
        }),
        sync: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
      })),
      readFile: vi.fn(async (path: string) =>
        new TextEncoder().encode(
          path === "candidate.json" && options.localCandidate !== undefined
            ? JSON.stringify(options.localCandidate)
            : saved,
        ),
      ),
      link: vi.fn(async () => undefined),
      unlink: vi.fn(async () => undefined),
      writeStdout: vi.fn(),
      writeStderr: vi.fn((text: string) => {
        stderr.push(text);
      }),
      reviewIO: io,
      prepareAuthoringRequest,
      dispatchAuthoringRequest,
      createAuthoringDiff,
      applyAuthoringChanges: options.applyAuthoringChanges ?? applyAuthoringChanges,
      reviewLocalAuthoringCandidate,
      providers: options.providers,
      cassetteIo: {
        load: async (path) => store.get(path) ?? null,
        save: async (path, cassette) => {
          store.set(path, cassette);
        },
      },
    };
    return {
      value,
      io,
      screen,
      stderr,
      calls,
      store,
      closeCount: () => closes,
      savedSuite: () =>
        saved === ""
          ? undefined
          : (JSON.parse(saved) as TestSuiteSpec & {
              approval: { fingerprint: string; cases?: { id: string; status: string }[] };
            }),
      output: () => screen.join(""),
    };
  }

  /** 이 툴 선언으로 baseline 이 만드는 케이스. 숫자를 테스트에 박지 않는다. */
  const baselineCases = createBaselineSuite(gateTools, {
    suiteId: "weather",
    suiteName: "Weather",
  }).suite.cases;
  /** 정상 응답만 주는 서버에서 실패하는 케이스(위반 케이스)의 수. */
  const failingCases = baselineCases.filter((item) =>
    (item.assertions as readonly { type: string; expected?: unknown }[]).some(
      (assertion) => assertion.type === "isError" && assertion.expected === true,
    ),
  ).length;

  it("기본 경로에서 시험 실행 고지가 나오고 거절하면 저장하지 않는다", async () => {
    const d = gateDeps({ choices: ["save", "cancel"], confirms: [false] });
    await expect(runGenerateCommand(gateArgv, d.value)).resolves.toBe(0);
    expect(d.output()).toContain("실제 서버에 보냅니다");
    expect(d.output()).toContain("이 실행은 서버 상태를 바꿀 수 있습니다.");
    expect(d.calls).toEqual([]);
    expect(d.value.openTemp).not.toHaveBeenCalled();
  });

  it("고지에 케이스 수가 실제 케이스 수와 같게 나온다", async () => {
    const d = gateDeps({ choices: ["save", "cancel"], confirms: [false] });
    await runGenerateCommand(gateArgv, d.value);
    expect(d.output()).toContain(
      `시험 실행: 케이스 ${baselineCases.length}개를 실제 서버에 보냅니다.`,
    );
    expect(d.output()).toContain("  대상: node server.mjs\n");
  });

  it("카세트가 없으면 고지에 카세트 줄이 안 나온다", async () => {
    const d = gateDeps({ choices: ["save", "cancel"], confirms: [false] });
    await runGenerateCommand(gateArgv, d.value);
    expect(d.output()).not.toContain("카세트:");
  });

  it("초기화가 없으면 고지에 초기화 줄이 안 나온다", async () => {
    const d = gateDeps({ choices: ["save", "cancel"], confirms: [false] });
    await runGenerateCommand(gateArgv, d.value);
    expect(d.output()).not.toContain("초기화:");
  });

  it("통과만 있으면 분류를 묻지 않고 저장으로 넘어간다", async () => {
    // 위반 케이스는 서버가 거절해야 통과한다. isError 를 그대로 돌려준다.
    const d = gateDeps({
      choices: ["save"],
      confirms: [true, true],
      respond: (_name, args) =>
        (args as { city?: unknown })?.city === undefined ||
        typeof (args as { city?: unknown }).city !== "string"
          ? { content: [], isError: true, raw: { error: "bad input" } }
          : ok(),
    });
    await expect(runGenerateCommand(gateArgv, d.value)).resolves.toBe(0);
    expect(d.io.input).not.toHaveBeenCalled();
    expect(d.output()).toContain(`  ✓ 통과 ${baselineCases.length}건`);
    expect(d.output()).not.toContain("✗ 실패");
  });

  it("실패 케이스를 serverDefect 로 분류하면 approval.cases 에 실린다", async () => {
    const d = gateDeps({
      choices: ["save"],
      inputs: Array.from({ length: failingCases }, () => "s"),
      confirms: [true, true],
    });
    await expect(runGenerateCommand(gateArgv, d.value)).resolves.toBe(0);
    const cases = d.savedSuite()?.approval.cases ?? [];
    expect(cases.filter((item) => item.status === "serverDefect")).toHaveLength(failingCases);
  });

  it("approval.cases 순서가 suite.cases 순서와 같다", async () => {
    const d = gateDeps({
      choices: ["save"],
      inputs: Array.from({ length: failingCases }, () => "s"),
      confirms: [true, true],
    });
    await runGenerateCommand(gateArgv, d.value);
    const saved = d.savedSuite();
    expect(saved?.approval.cases?.map((item) => item.id)).toEqual(
      saved?.cases.map((item) => item.id),
    );
  });

  it("통과 케이스도 approval.cases 에 passed 로 실린다", async () => {
    const d = gateDeps({
      choices: ["save"],
      inputs: Array.from({ length: failingCases }, () => "s"),
      confirms: [true, true],
    });
    await runGenerateCommand(gateArgv, d.value);
    const cases = d.savedSuite()?.approval.cases ?? [];
    expect(cases).toHaveLength(baselineCases.length);
    expect(cases.filter((item) => item.status === "passed").length).toBe(
      baselineCases.length - failingCases,
    );
  });

  it("specError 가 하나라도 있으면 저장하지 않고 메뉴로 돌아간다", async () => {
    const d = gateDeps({
      choices: ["save", "cancel"],
      inputs: ["m", ...Array.from({ length: failingCases - 1 }, () => "s")],
      confirms: [true],
    });
    await expect(runGenerateCommand(gateArgv, d.value)).resolves.toBe(0);
    expect(d.output()).toContain("명세 오류 1건이 있어 저장할 수 없습니다.");
    expect(d.output()).toContain("검토 메뉴의 revise 또는 edit");
    expect(d.value.openTemp).not.toHaveBeenCalled();
    // 카세트가 없으면 전량이 다시 나간다는 사실을 알려야 한다.
    expect(d.output()).toContain("--cassette 를 쓰세요");
    expect(d.io.choose).toHaveBeenCalledTimes(2);
  });

  it("미분류가 있으면 저장하지 않는다", async () => {
    const d = gateDeps({
      choices: ["save", "cancel"],
      inputs: Array.from({ length: failingCases }, () => "?"),
      confirms: [true],
    });
    await expect(runGenerateCommand(gateArgv, d.value)).resolves.toBe(0);
    expect(d.output()).toContain("분류하지 않은 케이스가 있어 저장할 수 없습니다.");
    expect(d.value.openTemp).not.toHaveBeenCalled();
  });

  it("aborted 면 §8.4 를 찍고 저장하지 않으며 stderr 꼬리가 함께 나온다", async () => {
    const d = gateDeps({
      choices: ["save", "cancel"],
      confirms: [true],
      respond: () => {
        throw new Error("socket hang up");
      },
      diagnostics: () => ({
        stderr: "FATAL: heap out of memory\n",
        stderrTruncated: false,
        exitCode: 1,
        signal: null,
      }),
    });
    await expect(runGenerateCommand(gateArgv, d.value)).resolves.toBe(0);
    expect(d.output()).toContain("✗ 시험 실행을 마치지 못했습니다.");
    expect(d.output()).toContain("케이스에서 연결이 끊겼습니다.");
    expect(d.output()).toContain("툴 'weather' 호출 중 오류가 발생했습니다.");
    expect(d.output()).toContain("FATAL: heap out of memory");
    expect(d.output()).toContain("저장하지 않았습니다. 서버를 고친 뒤 다시 save 를 고르세요.");
    expect(d.value.openTemp).not.toHaveBeenCalled();
  });

  it("--no-dry-run 이면 시험 실행 없이 저장되고 approval.cases 키가 없다", async () => {
    const d = gateDeps({ choices: ["save"], confirms: [true, true] });
    await expect(runGenerateCommand([...gateArgv, "--no-dry-run"], d.value)).resolves.toBe(0);
    expect(d.calls).toEqual([]);
    expect(d.output()).toContain("⚠ 시험 실행을 건너뜁니다.");
    expect(d.savedSuite()?.approval).toEqual({
      fingerprint: expect.any(String) as unknown as string,
    });
  });

  it("--no-dry-run 확인을 거절하면 저장하지 않는다", async () => {
    const d = gateDeps({ choices: ["save", "cancel"], confirms: [false] });
    await expect(runGenerateCommand([...gateArgv, "--no-dry-run"], d.value)).resolves.toBe(0);
    expect(d.value.openTemp).not.toHaveBeenCalled();
  });

  it("--reset-cmd 가 실패하면 시험 실행을 시작하지 않고 저장도 안 한다", async () => {
    const d = gateDeps({ choices: ["save", "cancel"], confirms: [true] });
    await expect(
      runGenerateCommand(
        [...gateArgv, "--reset-cmd", "ohmymcp-존재하지-않는-초기화-명령"],
        d.value,
      ),
    ).resolves.toBe(0);
    expect(d.output()).toContain("✗ 초기화 명령이 실패했습니다.");
    expect(d.calls).toEqual([]);
    expect(d.value.openTemp).not.toHaveBeenCalled();
  });

  it("--reset-cmd 성공 시 초기화 줄이 시험 실행보다 먼저 나온다", async () => {
    const d = gateDeps({
      choices: ["save", "cancel"],
      inputs: Array.from({ length: failingCases }, () => "?"),
      confirms: [true],
    });
    const command = `${process.execPath} -e process.exit(0)`;
    await runGenerateCommand([...gateArgv, "--reset-cmd", command], d.value);
    const output = d.output();
    expect(output).toContain(`  초기화: ${command}\n`);
    expect(output.indexOf(`▸ 초기화: ${command}`)).toBeGreaterThan(-1);
    expect(output.indexOf(`▸ 초기화: ${command}`)).toBeLessThan(
      output.indexOf("▸ 시험 실행 중..."),
    );
  });

  it("--cassette 를 주면 2회차 save 에서 inner 호출이 새 케이스 수만큼만 늘어난다", async () => {
    // 1회차는 파일이 없으므로 record 모드다. 전량이 서버로 나가고 flush 가 카세트를 남긴다.
    const store = new Map<string, Cassette>();
    const first = gateDeps({
      choices: ["save"],
      inputs: Array.from({ length: failingCases }, () => "s"),
      confirms: [true, true],
      cassetteStore: store,
    });
    await expect(
      runGenerateCommand([...gateArgv, "--cassette", ".ohmymcp/w.json"], first.value),
    ).resolves.toBe(0);
    expect(first.calls).toHaveLength(baselineCases.length);
    expect(store.get(".ohmymcp/w.json")?.interactions.length).toBeGreaterThan(0);
    expect(first.output()).toContain("  카세트: .ohmymcp/w.json (신규 녹화)\n");

    // 2회차는 파일이 있으므로 auto 모드다. 명세가 그대로면 새 케이스가 0개이고 서버를 다시
    // 부르지 않는다. exists 는 출력 파일용 스텁이므로 카세트 존재는 따로 알려 준다.
    const second = gateDeps({
      choices: ["save"],
      inputs: Array.from({ length: failingCases }, () => "s"),
      confirms: [true, true],
      cassetteStore: store,
    });
    second.value.exists = vi.fn(async (path: string) => path === ".ohmymcp/w.json");
    await expect(
      runGenerateCommand([...gateArgv, "--cassette", ".ohmymcp/w.json"], second.value),
    ).resolves.toBe(0);
    expect(second.calls).toEqual([]);
    expect(second.output()).toContain("  카세트: .ohmymcp/w.json (재생)\n");
  });

  it("카세트 경고가 화면에 그대로 나온다", async () => {
    let round = 0;
    const d = gateDeps({
      choices: ["save", "save"],
      inputs: [
        ...Array.from({ length: failingCases }, () => "?"),
        ...Array.from({ length: failingCases }, () => "?"),
      ],
      confirms: [true, true],
      // 같은 요청에 회차마다 다른 응답을 준다. record 가 경고를 만든다.
      respond: () => ({
        content: [{ type: "text", text: `round ${round++}` }],
        isError: false,
        raw: { round },
      }),
    });
    await runGenerateCommand([...gateArgv, "--cassette", ".ohmymcp/w.json", "--record"], d.value);
    expect(d.output()).toContain("→ 같은 요청에 다른 응답이 왔습니다: weather(");
  });

  it("회차마다 새 카세트 경고만 나온다", async () => {
    // 배선은 세션당 하나라 warnings 가 누적된다. 회차마다 전량을 다시 찍으면 사용자는 이번에
    // 새로 생긴 경고를 구분할 수 없다.
    const rounds = 3;
    const d = gateDeps({
      choices: Array.from({ length: rounds }, () => "save"),
      inputs: Array.from({ length: rounds * failingCases }, () => "?"),
      confirms: Array.from({ length: rounds }, () => true),
      // 같은 요청에 회차마다 다른 응답을 준다. 2회차부터 회차당 같은 수의 경고가 새로 생긴다.
      respond: (name, _args, call) => ({
        content: [{ type: "text", text: `${name} ${call}` }],
        isError: false,
        raw: { call },
      }),
    });
    await runGenerateCommand([...gateArgv, "--cassette", ".ohmymcp/w.json"], d.value);
    const marker = "→ 같은 요청에 다른 응답이 왔습니다:";
    const perRound = d
      .output()
      .split("▸ 시험 실행 중...")
      .slice(1)
      .map((segment) => segment.split(marker).length - 1);
    expect(perRound).toHaveLength(rounds);
    expect(perRound[1]).toBeGreaterThan(0);
    // 3회차가 2회차보다 많으면 1회차 몫을 다시 찍은 것이다.
    expect(perRound[2]).toBe(perRound[1]);
  });

  it("신규 녹화 중에는 재생된다고 말하지 않는다", async () => {
    // record 모드는 회차마다 전량을 다시 보낸다. auto 로 갈 때만 재생이 일어난다.
    const d = gateDeps({
      choices: ["save", "cancel"],
      inputs: Array.from({ length: failingCases }, () => "?"),
      confirms: [true],
    });
    await runGenerateCommand([...gateArgv, "--cassette", ".ohmymcp/w.json"], d.value);
    const output = d.output();
    expect(output).not.toContain("나머지는 카세트에서 재생됩니다");
    expect(output).toContain(`케이스 ${baselineCases.length}개가 모두 서버에 다시 나갑니다.`);
    // 이미 --cassette 를 쓰는 중이다. 쓰라고 하면 안 된다.
    expect(output).not.toContain("--cassette 를 쓰세요");
  });

  it("카세트를 재생 중이면 고친 케이스만 다시 나간다고 말한다", async () => {
    const store = new Map<string, Cassette>();
    const first = gateDeps({
      choices: ["save"],
      inputs: Array.from({ length: failingCases }, () => "s"),
      confirms: [true, true],
      cassetteStore: store,
    });
    await runGenerateCommand([...gateArgv, "--cassette", ".ohmymcp/w.json"], first.value);

    const second = gateDeps({
      choices: ["save", "cancel"],
      inputs: Array.from({ length: failingCases }, () => "?"),
      confirms: [true],
      cassetteStore: store,
    });
    second.value.exists = vi.fn(async (path: string) => path === ".ohmymcp/w.json");
    await runGenerateCommand([...gateArgv, "--cassette", ".ohmymcp/w.json"], second.value);
    expect(second.output()).toContain("나머지는 카세트에서 재생됩니다");
  });

  it("카세트 저장이 실패해도 명세 저장 실패로 보고하지 않는다", async () => {
    const d = gateDeps({
      choices: ["save"],
      inputs: Array.from({ length: failingCases }, () => "s"),
      confirms: [true, true],
    });
    d.value.cassetteIo = {
      load: async () => null,
      save: async () => {
        throw new Error("EACCES");
      },
    };
    await expect(
      runGenerateCommand([...gateArgv, "--cassette", ".ohmymcp/w.json"], d.value),
    ).resolves.toBe(0);
    expect(d.output()).toContain("⚠ 카세트를 저장하지 못했습니다.");
    expect(d.stderr.join("")).not.toContain("GENERATE_SAVE_FAILED");
    expect(d.value.link).toHaveBeenCalledOnce();
  });

  it("approval.cases 가 실려도 suiteFingerprint 가 안 바뀐다", async () => {
    const d = gateDeps({
      choices: ["save"],
      inputs: Array.from({ length: failingCases }, () => "s"),
      confirms: [true, true],
    });
    await runGenerateCommand(gateArgv, d.value);
    const saved = d.savedSuite();
    if (saved === undefined) throw new Error("저장된 명세가 필요합니다.");
    expect(saved.approval.cases).not.toBeUndefined();
    expect(suiteFingerprint(saved)).toBe(saved.approval.fingerprint);
    const { approval: _approval, ...withoutApproval } = saved;
    expect(suiteFingerprint(withoutApproval as TestSuiteSpec)).toBe(saved.approval.fingerprint);
  });

  it("저장 후 검증 조건 셋이 approval.cases 가 있어도 통과한다", async () => {
    // 조건 셋(validate·지문 재계산·approval.fingerprint 일치)이 하나라도 깨지면 link 까지 못 간다.
    const d = gateDeps({
      choices: ["save"],
      inputs: Array.from({ length: failingCases }, () => "s"),
      confirms: [true, true],
    });
    await expect(runGenerateCommand(gateArgv, d.value)).resolves.toBe(0);
    expect(d.value.link).toHaveBeenCalledOnce();
    expect(validateMcpSuite(d.savedSuite()).valid).toBe(true);
  });

  it("--baseline-only 는 시험 실행을 하지 않고 approval.cases 도 없다", async () => {
    const d = gateDeps({ choices: [] });
    await expect(runGenerateCommand([...gateArgv, "--baseline-only"], d.value)).resolves.toBe(0);
    expect(d.calls).toEqual([]);
    expect(d.savedSuite()?.approval.cases).toBeUndefined();
  });

  it("대화형 경로에서 연결이 검토 종료 시점에 닫힌다", async () => {
    const d = gateDeps({
      choices: ["save"],
      inputs: Array.from({ length: failingCases }, () => "s"),
      confirms: [true, true],
    });
    await runGenerateCommand(gateArgv, d.value);
    expect(d.closeCount()).toBe(1);
  });

  it("검토를 cancel 로 끝내도 연결이 닫힌다", async () => {
    const d = gateDeps({ choices: ["cancel"] });
    await expect(runGenerateCommand(gateArgv, d.value)).resolves.toBe(0);
    expect(d.closeCount()).toBe(1);
  });

  /** 정상 입력 케이스. 단언이 `isError: false` 하나뿐인 것이 그 표시다. */
  const happyCase = baselineCases.find((item) =>
    (item.assertions as readonly { type: string; expected?: unknown }[]).every(
      (assertion) => assertion.type === "isError" && assertion.expected === false,
    ),
  ) as CallToolCaseSpec;
  /** baseline 이 합성한 값. 숫자나 문자열을 테스트에 박지 않는다. */
  const synthesized = happyCase.operation.input.city as string;

  /** 교정 대상이 둘이 되도록 툴을 하나 더 둔 선언. */
  const twoTools: ToolDef[] = [
    ...gateTools,
    {
      name: "forecast",
      inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
    },
  ];

  /**
   * 정상 케이스에 본문 단언을 하나 더 단 baseline. 서버 오류 본문이 위반 줄로 나와야
   * `RepairTarget.serverMessage` 가 차고, 그래야 AI 제안 경로가 돈다(설계 §4.4).
   */
  const bodySchemaBaseline = (): BaselineGenerationResult => {
    const base = createBaselineSuite(gateTools, { suiteId: "weather", suiteName: "Weather" });
    const suite: TestSuiteSpec = {
      ...base.suite,
      cases: base.suite.cases.map((item) =>
        item.id !== happyCase.id
          ? item
          : ({
              ...item,
              assertions: [
                ...item.assertions,
                {
                  type: "bodyMatchesSchema",
                  schema: {
                    type: "object",
                    required: ["temp"],
                    properties: { temp: { type: "number" } },
                  },
                },
              ],
            } as TestCaseSpec),
      ),
    };
    return {
      ...base,
      suite,
      suiteFingerprint: suiteFingerprint(suite),
      baselineFingerprint: sha256(suite),
      policyVersion: BASELINE_POLICY_VERSION,
    };
  };

  /** 정상 케이스의 `city` 만 고쳐 돌려주는 가짜 provider. 프로세스를 띄우지 않는다. */
  const proposingProvider = (
    city: string,
    suiteOf: () => TestSuiteSpec = () => bodySchemaBaseline().suite,
  ): GenerateCommandDependencies["providers"] => ({
    codex: () => ({
      id: "codex" as const,
      model: "test-model",
      author: async () => {
        const base = suiteOf();
        return {
          status: "candidate",
          suite: {
            ...base,
            cases: base.cases.map((item) =>
              item.id !== happyCase.id
                ? item
                : ({
                    ...item,
                    operation: { ...(item as CallToolCaseSpec).operation, input: { city } },
                  } as TestCaseSpec),
            ),
          },
          summary: "입력값을 고쳤습니다.",
          warnings: [],
          questions: [],
        };
      },
    }),
  });

  const proposalArgv = [...gateArgv, "--provider", "codex", "--model", "test-model"];

  /** `city` 가 그 값일 때만 정상 응답. 그 밖에는 오류라서 정상 케이스만 실패한다. */
  const onlyAccepts =
    (city: string, body: unknown = { temp: 20 }) =>
    (_name: string, args: unknown): ToolResult =>
      (args as { city?: unknown })?.city === city
        ? { content: [{ type: "text", text: JSON.stringify(body) }], isError: false, raw: body }
        : {
            content: [
              { type: "text", text: JSON.stringify({ error: "city 는 서울/부산 중 하나입니다." }) },
            ],
            isError: true,
            raw: { error: true },
          };

  describe("generate 교정 경로", () => {
    it("입력값 실패가 교정으로 통과하면 분류를 묻지 않는다", async () => {
      const d = gateDeps({
        choices: ["save"],
        inputs: ["서울"],
        confirms: [true, true],
        respond: onlyAccepts("서울"),
      });
      await expect(runGenerateCommand(gateArgv, d.value)).resolves.toBe(0);
      expect(d.output()).toContain("✓ 통과\n");
      expect(d.output()).not.toContain("[s] 서버 결함");
    });

    it("교정으로 통과한 값이 저장된 명세의 operation.input 에 들어간다", async () => {
      const d = gateDeps({
        choices: ["save"],
        inputs: ["서울"],
        confirms: [true, true],
        respond: onlyAccepts("서울"),
      });
      await runGenerateCommand(gateArgv, d.value);
      const saved = d.savedSuite();
      const item = saved?.cases.find((entry) => entry.id === happyCase.id) as CallToolCaseSpec;
      expect(item.operation.input).toEqual({ city: "서울" });
    });

    it("교정으로 통과한 케이스가 approval.cases 에 passed 로 실린다", async () => {
      const d = gateDeps({
        choices: ["save"],
        inputs: ["서울"],
        confirms: [true, true],
        respond: onlyAccepts("서울"),
      });
      await runGenerateCommand(gateArgv, d.value);
      const cases = d.savedSuite()?.approval.cases ?? [];
      expect(cases.find((item) => item.id === happyCase.id)?.status).toBe("passed");
    });

    it("위반 케이스의 실패는 교정을 시도하지 않고 바로 분류로 간다", async () => {
      // 기본 서버는 항상 정상 응답이라 위반 케이스만 실패한다.
      const d = gateDeps({
        choices: ["save"],
        inputs: Array.from({ length: failingCases }, () => "s"),
        confirms: [true, true],
      });
      await runGenerateCommand(gateArgv, d.value);
      expect(d.output()).not.toContain("입력값이 거절된 것으로 보입니다");
      expect(d.output()).toContain("[s] 서버 결함");
    });

    it("본문 스키마 불일치 실패는 교정을 시도하지 않는다", async () => {
      const d = gateDeps({
        choices: ["save"],
        baseline: bodySchemaBaseline(),
        inputs: Array.from({ length: baselineCases.length }, () => "s"),
        confirms: [true, true],
        // 정상 응답이되 본문에 temp 가 없다. isError 는 통과하고 본문 단언만 깨진다.
        respond: () => ({
          content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
          isError: false,
          raw: { ok: true },
        }),
      });
      await runGenerateCommand(gateArgv, d.value);
      expect(d.output()).not.toContain("입력값이 거절된 것으로 보입니다");
    });

    it("--no-repair 면 실패가 곧바로 분류로 간다", async () => {
      const d = gateDeps({
        choices: ["save"],
        inputs: ["s"],
        confirms: [true, true],
        respond: onlyAccepts("서울"),
      });
      await expect(runGenerateCommand([...gateArgv, "--no-repair"], d.value)).resolves.toBe(0);
      expect(d.output()).not.toContain("입력값이 거절된 것으로 보입니다");
      expect(d.savedSuite()?.approval.cases?.find((item) => item.id === happyCase.id)?.status).toBe(
        "serverDefect",
      );
    });

    it("--no-repair 면 고지에 재호출 줄이 안 나온다", async () => {
      const d = gateDeps({ choices: ["save", "cancel"], confirms: [false] });
      await runGenerateCommand([...gateArgv, "--no-repair"], d.value);
      expect(d.output()).not.toContain("최대 2회까지 다시 호출합니다");

      const on = gateDeps({ choices: ["save", "cancel"], confirms: [false] });
      await runGenerateCommand(gateArgv, on.value);
      expect(on.output()).toContain("  실패한 케이스는 값을 고쳐 최대 2회까지 다시 호출합니다.\n");
    });

    it("provider 가 없으면 AI 제안 없이 사람에게 묻는다", async () => {
      const d = gateDeps({
        choices: ["save"],
        inputs: ["서울"],
        confirms: [true, true],
        respond: onlyAccepts("서울"),
      });
      await runGenerateCommand(gateArgv, d.value);
      expect(d.output()).toContain("서버 응답에 쓸 만한 값이 없어 직접 받습니다");
      expect(d.output()).not.toContain("서버 응답에서 값을 찾았습니다");
    });

    it("교정 0건이면 applyAuthoringChanges 를 부르지 않는다", async () => {
      const apply = vi.fn(applyAuthoringChanges);
      const d = gateDeps({
        choices: ["save"],
        inputs: Array.from({ length: failingCases }, () => "s"),
        confirms: [true, true],
        applyAuthoringChanges: apply,
      });
      await runGenerateCommand(gateArgv, d.value);
      expect(apply).not.toHaveBeenCalled();
    });

    it("교정 2건이어도 applyAuthoringChanges 를 한 번만 부른다", async () => {
      const apply = vi.fn(applyAuthoringChanges);
      const d = gateDeps({
        choices: ["save"],
        tools: twoTools,
        inputs: ["서울", "서울"],
        confirms: [true, true],
        applyAuthoringChanges: apply,
        respond: onlyAccepts("서울"),
      });
      await expect(runGenerateCommand(gateArgv, d.value)).resolves.toBe(0);
      expect(d.output()).not.toContain("[s] 서버 결함");
      expect(apply).toHaveBeenCalledOnce();
    });

    it("재실행이 케이스 하나만 담은 스위트로 나간다", async () => {
      const d = gateDeps({
        choices: ["save"],
        inputs: ["서울"],
        confirms: [true, true],
        respond: onlyAccepts("서울"),
      });
      await runGenerateCommand(gateArgv, d.value);
      // 시험 실행 전량 + 재실행 1건. 스위트를 통째로 다시 돌리면 이 값이 두 배가 된다.
      expect(d.calls).toHaveLength(baselineCases.length + 1);
    });

    it("provenance 가 user 인 케이스는 교정 대상이 아니다", async () => {
      // apply-all 로 반영한 케이스는 origin 이 user 가 된다(설계 §5.2). 사람이 직접 쓴 값을
      // 교정 대상으로 삼으면 사용자가 정한 것을 기계가 되돌린다.
      const base = createBaselineSuite(gateTools, {
        suiteId: "weather",
        suiteName: "Weather",
      }).suite;
      const d = gateDeps({
        choices: ["edit", "apply-all", "save"],
        localCandidate: {
          ...base,
          cases: base.cases.map((item) =>
            item.id !== happyCase.id
              ? item
              : ({
                  ...item,
                  operation: { ...(item as CallToolCaseSpec).operation, input: { city: "부산" } },
                } as TestCaseSpec),
          ),
        },
        // 편집 파일 경로, 분류 한 건.
        inputs: ["candidate.json", "s"],
        confirms: Array.from({ length: 8 }, () => true),
        respond: onlyAccepts("서울"),
      });
      await expect(runGenerateCommand(gateArgv, d.value)).resolves.toBe(0);
      expect(d.output()).not.toContain("입력값이 거절된 것으로 보입니다");
      expect(d.savedSuite()?.approval.cases?.find((item) => item.id === happyCase.id)?.status).toBe(
        "serverDefect",
      );
    });

    it("교정이 두 번 실패하면 분류 화면이 뜨고 시도 이력이 함께 나온다", async () => {
      const d = gateDeps({
        choices: ["save"],
        baseline: bodySchemaBaseline(),
        providers: proposingProvider("부산"),
        // 1회차는 AI 제안에 엔터, 2회차는 사람이 다른 값, 마지막은 분류.
        inputs: ["", "대전", "s"],
        confirms: [true, true],
        respond: onlyAccepts("서울"),
      });
      await expect(runGenerateCommand(proposalArgv, d.value)).resolves.toBe(0);
      expect(d.output()).toContain("서버 응답에서 값을 찾았습니다");
      expect(d.output()).toContain("입력값을 두 번 고쳐 봤지만 결과가 같습니다.");
      expect(d.output()).toContain('city: "부산" → 오류');
      expect(d.output()).toContain('city: "대전" → 오류');
    });

    it("교정이 두 번 실패하면 저장된 입력값이 원래 합성값이다", async () => {
      const d = gateDeps({
        choices: ["save"],
        baseline: bodySchemaBaseline(),
        providers: proposingProvider("부산"),
        inputs: ["", "대전", "s"],
        confirms: [true, true],
        respond: onlyAccepts("서울"),
      });
      await runGenerateCommand(proposalArgv, d.value);
      const item = d.savedSuite()?.cases.find((entry) => entry.id === happyCase.id) as
        | CallToolCaseSpec
        | undefined;
      expect(item?.operation.input).toEqual({ city: synthesized });
    });
  });

  describe("generate 지문 표시", () => {
    const printedFingerprint = (output: string): string =>
      output
        .slice(output.indexOf("Final fingerprint: ") + "Final fingerprint: ".length)
        .split("\n")[0] ?? "";

    it("최종 지문이 시험 실행 뒤에 찍힌다", async () => {
      const d = gateDeps({
        choices: ["save"],
        inputs: Array.from({ length: failingCases }, () => "s"),
        confirms: [true, true],
      });
      await runGenerateCommand(gateArgv, d.value);
      const output = d.output();
      expect(output.indexOf("Final fingerprint: ")).toBeGreaterThan(output.indexOf("시험 실행 중"));
      expect(output.indexOf("Final fingerprint: ")).toBeGreaterThan(
        output.indexOf("[s] 서버 결함"),
      );
    });

    it("교정이 있으면 찍힌 지문이 저장된 approval.fingerprint 와 같다", async () => {
      const d = gateDeps({
        choices: ["save"],
        inputs: ["서울"],
        confirms: [true, true],
        respond: onlyAccepts("서울"),
      });
      await runGenerateCommand(gateArgv, d.value);
      expect(printedFingerprint(d.output())).toBe(d.savedSuite()?.approval.fingerprint);
    });

    it("교정이 없으면 찍힌 지문이 기존과 같은 값이다", async () => {
      const d = gateDeps({
        choices: ["save"],
        inputs: Array.from({ length: failingCases }, () => "s"),
        confirms: [true, true],
      });
      await runGenerateCommand(gateArgv, d.value);
      expect(printedFingerprint(d.output())).toBe(
        createBaselineSuite(gateTools, { suiteId: "weather", suiteName: "Weather" })
          .suiteFingerprint,
      );
    });

    it("--no-dry-run 이어도 지문이 저장 확인 직전에 찍힌다", async () => {
      const d = gateDeps({ choices: ["save"], confirms: [true, true] });
      await expect(runGenerateCommand([...gateArgv, "--no-dry-run"], d.value)).resolves.toBe(0);
      const output = d.output();
      expect(output.indexOf("Final fingerprint: ")).toBeGreaterThan(
        output.indexOf("시험 실행을 건너뜁니다"),
      );
      expect(output.indexOf("Final fingerprint: ")).toBeLessThan(
        output.indexOf("최종 JSON을 저장할까요?"),
      );
    });

    it("반영 요약이 교정 0건이면 안 나온다", async () => {
      const d = gateDeps({
        choices: ["save"],
        inputs: Array.from({ length: failingCases }, () => "s"),
        confirms: [true, true],
      });
      await runGenerateCommand(gateArgv, d.value);
      expect(d.output()).not.toContain("명세에 반영되었습니다");
    });

    it("반영 요약에 필드와 전후 값이 나온다", async () => {
      const d = gateDeps({
        choices: ["save"],
        inputs: ["서울"],
        confirms: [true, true],
        respond: onlyAccepts("서울"),
      });
      await runGenerateCommand(gateArgv, d.value);
      expect(d.output()).toContain("  입력값 교정 1건이 명세에 반영되었습니다.\n");
      expect(d.output()).toContain(`    weather.city: ${JSON.stringify(synthesized)} → "서울"\n`);
    });
  });
});

describe("generate 옵션 파싱", () => {
  const base = ["--suite-id=x", "--name=n", "--out=x.json", "--command=node"];

  it("--force 를 두 번 주면 사용 오류다", () => {
    expect(() => parseGenerateCommand([...base, "--force", "--force"])).toThrow();
  });

  it("--force 에 값을 붙이면 사용 오류다", () => {
    expect(() => parseGenerateCommand([...base, "--force=yes"])).toThrow();
  });

  it("--force 를 주면 force 가 켜진다", () => {
    expect(parseGenerateCommand([...base, "--force"]).force).toBe(true);
  });

  it("--force 가 없으면 force 가 꺼진다", () => {
    expect(parseGenerateCommand(base).force).toBe(false);
  });
});

/**
 * `--out` 은 인자 파싱 때 이미 아는 값이다. 서버에 붙고 AI 를 부르고 사람이 값을 친 뒤에
 * 알려 주면 늦다. 설계 문서 §1·§4.
 */
describe("generate 출력 경로 선검사", () => {
  const outPath = "/tmp/out.json";
  const baseArgv = [
    "generate",
    "--suite-id",
    "weather",
    "--name",
    "Weather",
    "--out",
    outPath,
    "--command",
    "node",
    "--arg",
    "server.mjs",
  ];
  const baselineArgv = [...baseArgv, "--baseline-only"];

  /** TTY 게이트가 대신 끊어 통과하는 일이 없도록 대화형 IO 를 준다. */
  const interactiveIO = () => ({
    input: vi.fn(async () => ""),
    choose: vi.fn(async () => ""),
    confirm: vi.fn(async () => true),
    write: vi.fn(),
    interactive: true,
  });

  it("--out 이 이미 있고 --force 가 없으면 connect 를 부르지 않는다", async () => {
    const d = deps({ exists: vi.fn(async () => true), reviewIO: interactiveIO() });

    expect(await runGenerateCommand(baseArgv, d.value)).toBe(1);
    expect(d.value.connect).not.toHaveBeenCalled();
  });

  it("그때 화면에 시작하지 않았습니다 문안이 나온다", async () => {
    const d = deps({ exists: vi.fn(async () => true), reviewIO: interactiveIO() });
    const stderr: string[] = [];
    d.value.writeStderr = (text) => stderr.push(text);

    await runGenerateCommand(baseArgv, d.value);

    expect(stderr.join("")).toBe(
      `오류 [GENERATE_OUTPUT_EXISTS]: 출력 파일이 이미 있어 시작하지 않았습니다. 경로: ${outPath}\n해결: 다른 \`--out\` 경로를 지정하거나, 기존 파일을 덮어쓰려면 \`--force\` 를 붙이세요.\n`,
    );
  });

  it("선검사의 exists 가 던지면 종료 코드 1 과 오류 문안으로 끝난다", async () => {
    // 편의 검사가 명령 전체를 거절로 끝내면 호출자가 보는 것이 종료 코드가 아니라 예외다.
    const d = deps({
      exists: vi.fn(async () => {
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      }),
      reviewIO: interactiveIO(),
    });
    const stderr: string[] = [];
    d.value.writeStderr = (text) => stderr.push(text);

    expect(await runGenerateCommand(baseArgv, d.value)).toBe(1);
    expect(stderr.join("")).toBe(
      `오류 [GENERATE_OUTPUT_CHECK_FAILED]: 출력 경로를 확인하지 못해 시작하지 않았습니다. 경로: ${outPath} (EACCES)\n해결: 그 경로와 상위 디렉터리의 권한을 확인하세요. 다른 \`--out\` 경로를 지정해도 됩니다.\n`,
    );
    expect(d.value.connect).not.toHaveBeenCalled();
  });

  it("--out 이 없으면 선검사가 통과하고 connect 를 부른다", async () => {
    const d = deps();

    expect(await runGenerateCommand(baselineArgv, d.value)).toBe(0);
    expect(d.value.connect).toHaveBeenCalledTimes(1);
  });

  it("--force 면 --out 이 있어도 connect 를 부른다", async () => {
    const d = deps({ exists: vi.fn(async () => true) });

    expect(await runGenerateCommand([...baselineArgv, "--force"], d.value)).toBe(0);
    expect(d.value.connect).toHaveBeenCalledTimes(1);
  });

  it("--baseline-only 에서도 선검사가 돈다", async () => {
    const d = deps({ exists: vi.fn(async () => true) });

    expect(await runGenerateCommand(baselineArgv, d.value)).toBe(1);
    expect(d.value.connect).not.toHaveBeenCalled();
  });
});

describe("generate 덮어쓰기 저장", () => {
  const outPath = "/tmp/out.json";
  const baselineArgv = [
    "generate",
    "--suite-id",
    "weather",
    "--name",
    "Weather",
    "--out",
    outPath,
    "--command",
    "node",
    "--arg",
    "server.mjs",
    "--baseline-only",
  ];

  /** 지운 경로를 기록하는 unlink. 임시 파일 정리와 출력 경로 삭제를 갈라 보기 위해서다. */
  /**
   * `unlink` 를 가로채되 호출 순서를 잃지 않는다. `events` 를 넘기면 출력 경로를 지운 시점을
   * `unlink:out` 으로 그 배열에 남긴다. `link` 는 `deps` 가 같은 배열에 `link` 를 남기므로
   * 두 사건의 **선후**를 한 배열에서 비교할 수 있다. 각각 불렸는지만 보면 `link` 뒤에
   * `unlink` 하는 회귀도 통과한다.
   */
  const trackingUnlink = (
    behavior: (path: string) => void = () => undefined,
    events?: string[],
  ) => {
    const paths: string[] = [];
    return {
      paths,
      unlink: vi.fn(async (path: string) => {
        paths.push(path);
        events?.push(path === outPath ? "unlink:out" : "unlink");
        behavior(path);
      }),
    };
  };

  it("--force 면 기존 파일이 새 명세로 바뀐다", async () => {
    const events: string[] = [];
    const tracker = trackingUnlink(() => undefined, events);
    const d = deps({ exists: vi.fn(async () => true), unlink: tracker.unlink });
    // deps 가 link 를 자기 events 에 남기므로 같은 배열을 쓰게 바꿔 선후를 한 곳에서 본다.
    d.value.link = vi.fn(async () => {
      events.push("link");
    });
    const stdout: string[] = [];
    d.value.writeStdout = (text) => stdout.push(text);

    expect(await runGenerateCommand([...baselineArgv, "--force"], d.value)).toBe(0);
    expect(stdout.join("")).toContain(`baseline suite를 저장했습니다: ${outPath}`);
    expect(tracker.paths[0]).toBe(outPath);
    // 출력 경로를 지운 뒤 link 한다. 뒤집히면 link 가 EEXIST 로 실패한다. 각각 불렸는지만
    // 보면 link 뒤에 unlink 하는 회귀가 그대로 통과한다.
    const removed = events.indexOf("unlink:out");
    const linked = events.indexOf("link");
    expect(removed).toBeGreaterThan(-1);
    expect(linked).toBeGreaterThan(-1);
    expect(removed).toBeLessThan(linked);
  });

  it("--force 면 저장 직전 exists 검사를 건너뛴다", async () => {
    const exists = vi.fn(async () => true);
    const d = deps({ exists, unlink: trackingUnlink().unlink });

    expect(await runGenerateCommand([...baselineArgv, "--force"], d.value)).toBe(0);
    expect(exists).not.toHaveBeenCalledWith(outPath);
  });

  it("--force 인데 unlink 가 ENOENT 면 저장이 성공한다", async () => {
    const tracker = trackingUnlink((path) => {
      if (path !== outPath) return;
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });
    const d = deps({ exists: vi.fn(async () => true), unlink: tracker.unlink });

    expect(await runGenerateCommand([...baselineArgv, "--force"], d.value)).toBe(0);
  });

  /** `unlink` 가 지정한 코드로 실패하는 deps. 임시 파일 정리는 그대로 성공한다. */
  const failingUnlink = (code: string) =>
    trackingUnlink((path) => {
      if (path !== outPath) return;
      throw Object.assign(new Error(code), { code });
    });

  it("--force 인데 unlink 가 다른 오류면 저장이 실패한다", async () => {
    const d = deps({ exists: vi.fn(async () => true), unlink: failingUnlink("EACCES").unlink });
    const stderr: string[] = [];
    d.value.writeStderr = (text) => stderr.push(text);

    expect(await runGenerateCommand([...baselineArgv, "--force"], d.value)).toBe(1);
    // 출력 충돌도 뭉뚱그린 실패도 아니다. 사용자 조치가 셋 다 다르다.
    expect(stderr.join("")).toContain("GENERATE_OUTPUT_REPLACE_FAILED");
    expect(stderr.join("")).not.toContain("GENERATE_OUTPUT_EXISTS");
    expect(stderr.join("")).not.toContain("GENERATE_FAILED");
  });

  it("--force 인데 unlink 가 EISDIR 이면 저장하지 않고 replace 실패 문안이 나온다", async () => {
    const d = deps({ exists: vi.fn(async () => true), unlink: failingUnlink("EISDIR").unlink });
    const stderr: string[] = [];
    d.value.writeStderr = (text) => stderr.push(text);

    expect(await runGenerateCommand([...baselineArgv, "--force"], d.value)).toBe(1);
    expect(stderr.join("")).toBe(
      `오류 [GENERATE_OUTPUT_REPLACE_FAILED]: 기존 출력 파일을 지우지 못해 저장하지 않았습니다. 경로: ${outPath} (EISDIR)\n해결: 그 경로가 디렉터리이거나 쓰기 권한이 없는지 확인하세요. 다른 \`--out\` 경로를 지정해도 됩니다.\n`,
    );
    expect(d.value.link).not.toHaveBeenCalled();
  });

  it("replace 실패 문안에 시스템 코드가 들어간다", async () => {
    for (const code of ["EISDIR", "EPERM", "EACCES"]) {
      const d = deps({ exists: vi.fn(async () => true), unlink: failingUnlink(code).unlink });
      const stderr: string[] = [];
      d.value.writeStderr = (text) => stderr.push(text);

      expect(await runGenerateCommand([...baselineArgv, "--force"], d.value)).toBe(1);
      expect(stderr.join("")).toContain(`경로: ${outPath} (${code})`);
    }
  });

  it("코드 없는 unlink 오류면 괄호를 빼고 적는다", async () => {
    const d = deps({
      exists: vi.fn(async () => true),
      unlink: trackingUnlink((path) => {
        if (path !== outPath) return;
        throw new Error("알 수 없음");
      }).unlink,
    });
    const stderr: string[] = [];
    d.value.writeStderr = (text) => stderr.push(text);

    expect(await runGenerateCommand([...baselineArgv, "--force"], d.value)).toBe(1);
    expect(stderr.join("")).toContain(`경로: ${outPath}\n`);
    expect(stderr.join("")).not.toContain("(undefined)");
  });

  it("--force 라도 link 가 EEXIST 면 저장하지 않고 저장 실패 문안이 나온다", async () => {
    const d = deps({
      exists: vi.fn(async () => true),
      unlink: trackingUnlink().unlink,
      link: vi.fn(async () => {
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      }),
    });
    const stderr: string[] = [];
    d.value.writeStderr = (text) => stderr.push(text);

    expect(await runGenerateCommand([...baselineArgv, "--force"], d.value)).toBe(1);
    expect(stderr.join("")).toBe(
      `오류 [GENERATE_OUTPUT_EXISTS]: 출력 파일이 이미 있어 저장하지 않았습니다. 경로: ${outPath}\n해결: 다른 \`--out\` 경로를 지정하거나, 기존 파일을 덮어쓰려면 \`--force\` 를 붙이세요.\n`,
    );
  });

  it("--force 가 없으면 저장 단계 동작이 이전과 같다", async () => {
    const d = deps();

    expect(await runGenerateCommand(baselineArgv, d.value)).toBe(0);
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
});
