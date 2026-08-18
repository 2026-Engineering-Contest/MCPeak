import { readFileSync } from "node:fs";
import type { McpClient, ToolDef, ToolResult } from "@ohmymcp-hsu/core";
import type { TestCaseSpec, TestSuiteSpec } from "@ohmymcp-hsu/runner";
import { renderReport, runSuite } from "@ohmymcp-hsu/runner";
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
  /** 이 툴을 부르면 던진다. 서버가 죽은 상황을 흉내 낸다. */
  readonly throwOn?: string;
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

  it("client.callTool 이 던지면 aborted.reason 이 connectionLost 이고 툴 이름이 detail 에 있다", async () => {
    const suite = suiteOf([callCase("a", "get_weather"), callCase("b", "add")]);
    const result = await runDryRun({ client: fakeClient({ throwOn: "add" }), suite });
    expect(result.aborted?.reason).toBe("connectionLost");
    expect(result.aborted?.detail).toContain("add");
  });

  it("aborted 여도 그때까지 끝난 케이스가 outcomes 에 남는다", async () => {
    const suite = suiteOf([
      callCase("a", "get_weather"),
      callCase("b", "add"),
      callCase("c", "get_weather"),
    ]);
    const result = await runDryRun({ client: fakeClient({ throwOn: "add" }), suite });
    expect(result.outcomes.map((outcome) => outcome.caseId)).toEqual(["a", "b"]);
    expect(result.outcomes[0]?.status).toBe("passed");
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
