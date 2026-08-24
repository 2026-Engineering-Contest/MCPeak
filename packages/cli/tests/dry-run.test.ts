import { readFileSync } from "node:fs";
import type { McpClient, ToolDef, ToolResult } from "@mcpeak/core";
import type { TestCaseSpec, TestSuiteSpec } from "@mcpeak/runner";
import { renderReport, runSuite } from "@mcpeak/runner";
import { describe, expect, it } from "vitest";
import { runDryRun } from "../src/dry-run.js";

/** 툴 선언은 저장소 공용 샘플을 쓴다. 서버를 띄우지 않는다. */
const tools = (
  JSON.parse(
    readFileSync(new URL("../../../fixtures/tools-list.sample.json", import.meta.url), "utf8"),
  ) as { tools: ToolDef[] }
).tools;

interface FakeClientOptions {
  /** 툴 이름별 응답. 없으면 정상 응답을 만든다. */
  readonly responses?: Readonly<Record<string, ToolResult>>;
  /**
   * 이 툴을 부르면 던진다. **서버는 살아 있다** — 코드 없는 오류라 러너는 연결 상실로 보지
   * 않고 다음 케이스로 간다(ADR-0073).
   */
  readonly throwOn?: string;
  /**
   * 이 횟수만큼 호출이 지나면 그다음부터 프로세스 사망 오류로 던진다. 서버가 도중에 죽는
   * 상황이다. 죽은 뒤에는 어느 툴을 부르든 같은 오류가 난다.
   */
  readonly killAfter?: number;
  /** `killAfter` 가 낸 오류에 실을 종료 코드. 생략하면 종료 코드를 관측하지 못한 상황이다. */
  readonly killExitCode?: number;
  /** 이 툴을 부르면 늦게 응답한다. 제한 시간 초과를 흉내 낸다. */
  readonly hangOn?: string;
  /** `hangOn` 이 응답하기까지의 시간. 생략하면 끝내 응답하지 않는다. */
  readonly hangMs?: number;
}

interface FakeClient extends McpClient {
  /** 호출 순서 기록. `callTool` 은 툴 이름, `listTools` 는 그 문자열로 남는다. */
  readonly calls: string[];
  /** 실제로 응답까지 끝난 호출. 러너가 기다리기를 그만둔 뒤에도 여기에 추가된다. */
  readonly settled: string[];
}

/**
 * core 가 프로세스 사망 뒤의 호출에 붙이는 오류. 러너는 클래스 정체가 아니라 이 **구조**를 보고
 * 연결 상실을 판정하므로(`classifyConnectionLoss`) 구조만 흉내 낸다.
 */
const processExitedError = (exitCode?: number): Error =>
  Object.assign(new Error("Not connected"), {
    code: "PROCESS_EXITED",
    diagnostics: { transport: "stdio", exitCode: exitCode ?? null, signal: null, stderr: "" },
  });

const okResult = (tool: string): ToolResult => ({
  content: [{ type: "text", text: `${tool} ok` }],
  isError: false,
  raw: { ok: true },
});

const fakeClient = (options: FakeClientOptions = {}): FakeClient => {
  const calls: string[] = [];
  const settled: string[] = [];
  return {
    calls,
    settled,
    async listTools() {
      calls.push("listTools");
      settled.push("listTools");
      return tools;
    },
    async callTool(name) {
      calls.push(name);
      // 죽은 뒤가 먼저다. 서버가 이미 죽었으면 그 툴이 무엇이었는지는 더 이상 중요하지 않다.
      if (options.killAfter !== undefined && calls.length > options.killAfter)
        throw processExitedError(options.killExitCode);
      if (options.throwOn === name) throw new Error("socket hang up");
      if (options.hangOn === name) {
        await new Promise<void>((resolve) => {
          if (options.hangMs !== undefined) setTimeout(resolve, options.hangMs);
        });
      }
      settled.push(name);
      return options.responses?.[name] ?? okResult(name);
    },
    async close() {},
  };
};

const callCase = (id: string, tool: string, expectedError = false): TestCaseSpec => ({
  id,
  name: `${tool} 케이스 ${id}`,
  operation: { type: "callTool", tool, input: { city: id } },
  assertions: [{ type: "isError", expected: expectedError }],
});

const suiteOf = (cases: readonly TestCaseSpec[]): TestSuiteSpec => ({
  schemaVersion: 1,
  id: "dry-run-suite",
  name: "시험 실행 스위트",
  cases: [...cases],
});

/**
 * `renderReport` 출력에서 케이스 id 로 블록을 찾는다. 구현과 다른 방식(위치가 아니라 id 검색)
 * 으로 찾아 두 경로가 우연히 같은 실수를 하지 않게 한다.
 */
const blockOf = (rendered: string, caseId: string): string => {
  const lines = rendered.split("\n");
  const header = lines.findIndex((line) => line.includes(` ${caseId} `) && !line.startsWith("  "));
  const body: string[] = [];
  for (const line of lines.slice(header + 1)) {
    if (!line.startsWith("    ")) break;
    body.push(line);
  }
  return body.join("\n");
};

describe("runDryRun", () => {
  it("통과 케이스만 있는 스위트는 outcomes 전부 passed 이고 aborted 가 없다", async () => {
    const suite = suiteOf([callCase("a", "get_weather"), callCase("b", "add")]);
    const result = await runDryRun({ client: fakeClient(), suite });
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(["passed", "passed"]);
    expect(result.aborted).toBeUndefined();
  });

  it("통과 케이스의 detail 이 빈 문자열이다", async () => {
    const suite = suiteOf([callCase("a", "get_weather")]);
    const result = await runDryRun({ client: fakeClient(), suite });
    expect(result.outcomes[0]?.detail).toBe("");
  });

  it("실패 케이스의 detail 이 renderReport 의 그 케이스 블록과 문자열로 같다", async () => {
    // isError true 를 기대하지만 서버는 정상 응답을 준다.
    const suite = suiteOf([callCase("a", "get_weather"), callCase("b", "add", true)]);
    const result = await runDryRun({ client: fakeClient(), suite });
    const report = await runSuite({ client: fakeClient(), suite }).report;
    const expected = blockOf(renderReport(report), "b");

    expect(expected).not.toBe("");
    expect(result.outcomes[1]?.status).toBe("failed");
    expect(result.outcomes[1]?.detail).toBe(expected);
  });

  it("케이스 실행 순서가 suite.cases 순서와 같다", async () => {
    const client = fakeClient();
    const suite = suiteOf([
      callCase("a", "get_weather"),
      callCase("b", "add"),
      callCase("c", "get_weather"),
    ]);
    await runDryRun({ client, suite });
    expect(client.calls).toEqual(["get_weather", "add", "get_weather"]);
  });

  it("outcomes 순서가 suite.cases 순서와 같다", async () => {
    const suite = suiteOf([
      callCase("a", "get_weather"),
      callCase("b", "add"),
      callCase("c", "get_weather"),
    ]);
    const result = await runDryRun({ client: fakeClient(), suite });
    expect(result.outcomes.map((outcome) => outcome.caseId)).toEqual(["a", "b", "c"]);
  });

  it("서버가 죽으면 aborted.reason 이 connectionLost 이고 사유와 종료 코드를 말한다", async () => {
    const suite = suiteOf([callCase("a", "get_weather"), callCase("b", "add")]);
    const client = fakeClient({ killAfter: 1, killExitCode: 42 });
    const result = await runDryRun({ client, suite });
    expect(result.aborted?.reason).toBe("connectionLost");
    // 사유·종료 코드가 문장에 있어야 사용자가 다음에 무엇을 볼지 안다. "실행이 중단됐습니다" 로
    // 뭉개면 취소 신호와 구분되지 않는다.
    expect(result.aborted?.detail).toBe(
      "케이스 'add 케이스 b' 에서 서버 프로세스가 종료됐습니다 (종료 코드 42). 남은 케이스는 실행되지 않았습니다.",
    );
  });

  it("종료 코드를 관측하지 못했으면 괄호를 만들지 않는다", async () => {
    // `(종료 코드 없음)` 은 관측하지 못한 것을 관측했다고 말하는 것이다.
    const suite = suiteOf([callCase("a", "get_weather"), callCase("b", "add")]);
    const result = await runDryRun({ client: fakeClient({ killAfter: 1 }), suite });
    expect(result.aborted?.detail).toBe(
      "케이스 'add 케이스 b' 에서 서버 프로세스가 종료됐습니다. 남은 케이스는 실행되지 않았습니다.",
    );
  });

  it("연결이 끊겨도 그때까지 끝난 케이스가 outcomes 에 남는다", async () => {
    const suite = suiteOf([
      callCase("a", "get_weather"),
      callCase("b", "add"),
      callCase("c", "get_weather"),
    ]);
    const result = await runDryRun({ client: fakeClient({ killAfter: 1 }), suite });
    // 끊긴 케이스 b 는 남는다. 그 호출은 실제로 나갔고 실패는 사실이다. c 는 안 돌았다.
    expect(result.outcomes.map((outcome) => outcome.caseId)).toEqual(["a", "b"]);
    expect(result.outcomes[0]?.status).toBe("passed");
    expect(result.outcomes.some((outcome) => outcome.status === "notRun")).toBe(false);
  });

  it("서버가 살아서 낸 툴 오류는 중단이 아니다", async () => {
    // 오류를 던진 호출과 죽은 서버는 다르다. 이것을 섞으면 툴 하나가 오류를 낼 때마다 시험
    // 실행이 통째로 중단되고, 사용자는 멀쩡한 뒤 케이스의 판정을 못 본다.
    const suite = suiteOf([
      callCase("a", "get_weather"),
      callCase("b", "add"),
      callCase("c", "get_weather"),
    ]);
    const result = await runDryRun({ client: fakeClient({ throwOn: "add" }), suite });
    expect(result.aborted).toBeUndefined();
    expect(result.outcomes.map((outcome) => outcome.caseId)).toEqual(["a", "b", "c"]);
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
      "passed",
      "failed",
      "passed",
    ]);
  });

  it("앞선 툴 오류가 있어도 실제로 끊긴 지점에서 자른다", async () => {
    // 예전 휴리스틱은 진단 코드가 `OPERATION_FAILED` 인 **첫** 케이스에서 잘랐다. 그 코드는
    // 살아 있는 서버의 툴 오류에도 붙으므로, 케이스 a 에서 자르고 b·c 의 판정을 버렸다.
    const suite = suiteOf([
      callCase("a", "add"),
      callCase("b", "get_weather"),
      callCase("c", "get_weather"),
      callCase("d", "get_weather"),
    ]);
    const client = fakeClient({ throwOn: "add", killAfter: 2, killExitCode: 1 });
    const result = await runDryRun({ client, suite });
    expect(result.outcomes.map((outcome) => outcome.caseId)).toEqual(["a", "b", "c"]);
    expect(result.aborted?.reason).toBe("connectionLost");
    expect(result.aborted?.detail).toContain("get_weather 케이스 c");
  });

  it("케이스 하나가 상한을 넘으면 그 케이스를 줄이라고 안내한다", async () => {
    // 케이스 하나가 상한을 넘으면 runSuite 가 보고서 대신 RunnerPayloadLimitError 를 낸다.
    // 이때 케이스 수를 줄이라고 하면 안 된다. 나머지를 다 지워도 같은 오류가 그대로 난다.
    const huge: TestCaseSpec = {
      ...callCase("a", "get_weather"),
      name: "긴".repeat(70_000),
    };
    const result = await runDryRun({ client: fakeClient(), suite: suiteOf([huge]) });
    expect(result.aborted?.reason).toBe("payloadLimit");
    expect(result.aborted?.detail).toBe(
      "케이스 'a' 가 상한을 넘었습니다. 그 케이스의 이름·입력·단언을 줄인 뒤 다시 시도하세요.",
    );
    expect(result.outcomes).toEqual([]);
  });

  it("보고서가 상한을 넘으면 케이스 수를 줄이라고 안내한다", async () => {
    // 케이스는 저마다 상한 아래인데 합이 보고서 상한을 넘는 경우다. 손댈 것이 케이스 수뿐이다.
    const cases = Array.from({ length: 40 }, (_, index) => ({
      ...callCase(`c${index}`, "get_weather"),
      name: `${"긴".repeat(20_000)}${index}`,
    }));
    const result = await runDryRun({ client: fakeClient(), suite: suiteOf(cases) });
    expect(result.aborted?.reason).toBe("payloadLimit");
    expect(result.aborted?.detail).toBe(
      "보고서가 1MB 상한을 넘었습니다. 케이스 수를 줄인 뒤 다시 시도하세요.",
    );
  });

  it("제한 시간 초과로 러너가 멈추면 aborted.reason 이 stopped 다", async () => {
    // 러너는 케이스가 제한 시간을 넘기면 남은 케이스를 실행하지 않고 notRun 으로 채운다.
    // 그것을 aborted 로 옮기지 않으면 서버에 보낸 적도 없는 케이스가 분류 화면으로 간다.
    const suite = suiteOf([
      { ...callCase("a", "get_weather"), timeoutMs: 50 },
      { ...callCase("b", "add"), timeoutMs: 50 },
      { ...callCase("c", "get_weather"), timeoutMs: 50 },
    ]);
    const result = await runDryRun({ client: fakeClient({ hangOn: "add", hangMs: 200 }), suite });
    expect(result.aborted?.reason).toBe("stopped");
    expect(result.aborted?.detail).toContain("제한 시간");
    expect(result.aborted?.detail).toContain("add 케이스 b");
    // 실행된 두 건만 남는다. notRun 인 c 는 판정이 아니다.
    expect(result.outcomes.map((outcome) => outcome.caseId)).toEqual(["a", "b"]);
    expect(result.outcomes.some((outcome) => outcome.status === "notRun")).toBe(false);
  });

  it("남은 호출이 끝난 뒤에 반환한다", async () => {
    // 늦게 도착한 응답이 다음 회차의 녹화에 섞이면 같은 입력에 카세트가 달라진다.
    const client = fakeClient({ hangOn: "add", hangMs: 150 });
    const suite = suiteOf([
      { ...callCase("a", "get_weather"), timeoutMs: 30 },
      { ...callCase("b", "add"), timeoutMs: 30 },
    ]);
    await runDryRun({ client, suite });
    expect(client.settled).toEqual(["get_weather", "add"]);
  });

  it("같은 입력으로 2회 실행한 DryRunResult 가 JSON.stringify 기준 동일하다", async () => {
    const suite = suiteOf([callCase("a", "get_weather"), callCase("b", "add", true)]);
    const first = await runDryRun({ client: fakeClient(), suite });
    const second = await runDryRun({ client: fakeClient(), suite });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("caseName 이 spec 의 name 과 같다", async () => {
    const suite = suiteOf([callCase("a", "get_weather")]);
    const result = await runDryRun({ client: fakeClient(), suite });
    expect(result.outcomes[0]?.caseName).toBe("get_weather 케이스 a");
  });
});
