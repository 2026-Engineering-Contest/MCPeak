import { readFileSync } from "node:fs";
import type { McpClient, ToolDef, ToolResult } from "@ohmymcp/core";
import type { TestCaseSpec, TestSuiteSpec } from "@ohmymcp/runner";
import { renderReport, runSuite } from "@ohmymcp/runner";
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
}

interface FakeClient extends McpClient {
  /** 호출 순서 기록. `callTool` 은 툴 이름, `listTools` 는 그 문자열로 남는다. */
  readonly calls: string[];
}

const okResult = (tool: string): ToolResult => ({
  content: [{ type: "text", text: `${tool} ok` }],
  isError: false,
  raw: { ok: true },
});

const fakeClient = (options: FakeClientOptions = {}): FakeClient => {
  const calls: string[] = [];
  return {
    calls,
    async listTools() {
      calls.push("listTools");
      return tools;
    },
    async callTool(name) {
      calls.push(name);
      if (options.throwOn === name) throw new Error("socket hang up");
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

  it("RunnerPayloadLimitError 면 aborted.reason 이 payloadLimit 이고 1MB 문장이 들어간다", async () => {
    // 케이스 하나가 상한을 넘으면 runSuite 가 보고서 대신 RunnerPayloadLimitError 를 낸다.
    const huge: TestCaseSpec = {
      ...callCase("a", "get_weather"),
      name: "긴".repeat(70_000),
    };
    const result = await runDryRun({ client: fakeClient(), suite: suiteOf([huge]) });
    expect(result.aborted?.reason).toBe("payloadLimit");
    expect(result.aborted?.detail).toBe(
      "보고서가 1MB 상한을 넘었습니다. 케이스 수를 줄인 뒤 다시 시도하세요.",
    );
    expect(result.outcomes).toEqual([]);
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
