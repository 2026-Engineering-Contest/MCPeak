import type { McpStdioConnection } from "@mcpeak/core";
import type { RunnerExecution, RunnerReport, TestSuiteSpec } from "@mcpeak/runner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCli, type TestCommandDependencies } from "../src/test-command.js";

/**
 * `runCli` 이 세션을 **무엇으로 닫는가**만 본다(ADR-0094).
 *
 * 녹화의 완료 여부는 어댑터와 Coordinator 가 끝까지 정상 동작했는가로만 정한다. 테스트 판정은
 * 녹화본의 완전성과 무관하므로, 케이스가 실패한 실행도 `finish("completed")` 로 닫혀야 한다.
 * 그 규칙이 깨지면 의도적으로 실패하는 회귀 케이스를 가진 명세는 재생 원본을 영영 만들 수 없다.
 *
 * 배선을 통째로 갈아 `finish` 에 들어온 인자만 잡는다. 실제 Coordinator 도 SQLite 도 뜨지
 * 않으므로 빠르고 결정론적이다. 여기서 보고 싶은 것은 인자 하나이지 저장소의 동작이 아니다.
 */

const finished: string[] = [];

vi.mock("../src/external-wiring.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/external-wiring.js")>()),
  startExternalWiring: async () => ({
    env: {},
    finish: async (status: string) => {
      finished.push(status);
      return {
        mode: "record",
        sessionId: "default",
        status: "completed",
        interactionCount: 0,
        consumedCount: 0,
        unusedCount: 0,
      };
    },
  }),
}));

const SESSION = "tmp/finish.db";
const suite: TestSuiteSpec = { schemaVersion: 1, id: "suite", name: "Suite", cases: [] };
const report = (): RunnerReport => ({
  schemaVersion: 1,
  suite: { id: "suite", name: "Suite" },
  status: "passed",
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
  close: async () => {},
  forceClose: async () => {},
});

/** 정상적으로 통과하는 실행의 의존성. 케이스는 비어 있어도 경로는 끝까지 간다. */
function deps(overrides: Partial<TestCommandDependencies> = {}): TestCommandDependencies {
  const execution: RunnerExecution = {
    report: Promise.resolve(report()),
    drain: Promise.resolve({ status: "settled" }),
  };
  return {
    readFile: async () => new TextEncoder().encode(JSON.stringify(suite)),
    validateSuite: () => ({ valid: true as const, value: suite }),
    connect: async () => connection(),
    startRunner: () => execution,
    finalize: async () => report(),
    renderReport: () => "렌더링 결과\n",
    renderJUnit: () => "<testsuites/>\n",
    writeFile: async () => {},
    colorEnabled: false,
    writeStdout: () => {},
    writeStderr: () => {},
    ...overrides,
  };
}

const argv = ["test", "suite.json", "--command", "node", "--record-session", SESSION];

describe("녹화 세션을 무엇으로 닫는가 (ADR-0094)", () => {
  beforeEach(() => {
    finished.length = 0;
  });

  it("실패한 실행도 녹화는 완료로 닫는다", async () => {
    // 명세 파일을 읽지 못하는 실행이다. 판정은 실패하지만 녹화 자체는 정상으로 끝났다.
    const exitCode = await runCli(
      argv,
      deps({
        readFile: async () => {
          throw Object.assign(new Error("no such file"), { code: "ENOENT" });
        },
      }),
    );

    expect(exitCode).not.toBe(0);
    expect(finished).toEqual(["completed"]);
  });

  it("성공한 실행도 완료로 닫는다", async () => {
    const exitCode = await runCli(argv, deps());

    expect(exitCode).toBe(0);
    expect(finished).toEqual(["completed"]);
  });

  /**
   * 예외는 다르다. 그 경로는 실행이 어디까지 갔는지 알 수 없어 녹화의 온전함을 주장할 근거가
   * 없다. `runCli` 의 `catch` 는 `runCliCore` 가 던진 모든 것을 잡으므로, 원인이 무엇이든
   * 경로는 하나다.
   *
   * 주입점은 `writeFailure` 가 부르는 `writeStderr` 다. 보고 경로의 `writeStdout` 은
   * `CLI_INTERNAL_ERROR` 갈래가 통째로 감싸고 있어 밖으로 나오지 못하고, 그러면 이 케이스가
   * 검사하려던 경로 자체를 타지 않는다.
   */
  it("예외로 끝난 실행은 실패로 닫는다", async () => {
    const boom = new Error("stderr 가 터졌다");

    await expect(
      runCli(
        argv,
        deps({
          readFile: async () => {
            throw Object.assign(new Error("no such file"), { code: "ENOENT" });
          },
          writeStderr: () => {
            throw boom;
          },
        }),
      ),
    ).rejects.toBe(boom);
    expect(finished).toEqual(["failed"]);
  });
});
