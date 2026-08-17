import type { McpClient, ToolDef } from "@ohmymcp/core";
import { analyzeToolProvenance, createBaselineSuite, type PreFillResult } from "@ohmymcp/generate";
import type { JsonObject, TestSuiteSpec } from "@ohmymcp/runner";
import { describe, expect, it, vi } from "vitest";
import type { DryRunResult } from "../src/dry-run.js";
import { applyPreFill, dropSkippedTools, unknownFormatSkips } from "../src/pre-fill-wiring.js";

/** 서버를 부르지 않는다. dryRun 주입점이 판정을 대신한다. */
const client = {} as McpClient;

const baselineSuite: TestSuiteSpec = {
  schemaVersion: 1,
  id: "s",
  name: "s",
  cases: [
    {
      id: "c",
      name: "c",
      operation: { type: "callTool", tool: "t", input: { v: "example" } },
      assertions: [{ type: "isError", expected: false }],
    },
    {
      id: "other",
      name: "other",
      operation: { type: "callTool", tool: "t", input: { v: "example" } },
      assertions: [{ type: "isError", expected: true }],
    },
  ],
};

const preFill: PreFillResult = {
  accepted: [{ caseId: "c", field: "v", value: "AI" }],
  discarded: [],
};

/** 케이스 입력의 v 값으로 baseline·AI 회차를 구분해 판정을 돌려준다. */
const fakeDryRun =
  (options: { baselinePasses: boolean; aiPasses: boolean; abort?: boolean }) =>
  async (o: { suite: TestSuiteSpec }): Promise<DryRunResult> => {
    const isAi = o.suite.cases.some(
      (item) =>
        item.operation.type === "callTool" &&
        (item.operation.input as JsonObject | undefined)?.v === "AI",
    );
    const passes = isAi ? options.aiPasses : options.baselinePasses;
    const result: DryRunResult = {
      outcomes: o.suite.cases.map((item) => ({
        caseId: item.id,
        caseName: item.name,
        status: passes ? ("passed" as const) : ("failed" as const),
        detail: "",
      })),
      ...(options.abort === true
        ? { aborted: { reason: "connectionLost" as const, detail: "끊김" } }
        : {}),
    };
    return result;
  };

describe("후보 채택 규칙", () => {
  it.each([
    ["baseline 통과 + AI 통과", true, true, "baseline"],
    ["baseline 통과 + AI 실패", true, false, "baseline"],
    ["baseline 실패 + AI 통과", false, true, "ai"],
    ["baseline 실패 + AI 실패", false, false, "baseline"],
  ])("%s → %s 채택", async (_label, baselinePasses, aiPasses, expected) => {
    const result = await applyPreFill({
      client,
      preFill,
      baseline: baselineSuite,
      dryRun: fakeDryRun({ baselinePasses, aiPasses }),
    });
    expect(result.cases[0]?.source).toBe(expected);
  });

  it("baseline 실패 + AI 실패면 분류 대상으로 남는다", async () => {
    const result = await applyPreFill({
      client,
      preFill,
      baseline: baselineSuite,
      dryRun: fakeDryRun({ baselinePasses: false, aiPasses: false }),
    });
    expect(result.cases[0]?.needsClassification).toBe(true);
  });

  it("채택하면 그 케이스의 입력만 바뀐다", async () => {
    const result = await applyPreFill({
      client,
      preFill,
      baseline: baselineSuite,
      dryRun: fakeDryRun({ baselinePasses: false, aiPasses: true }),
    });
    const [first, second] = result.suite.cases;
    expect(first?.operation.type === "callTool" && first.operation.input).toEqual({ v: "AI" });
    // 위반 케이스는 제안 대상이 아니므로 그대로다.
    expect(second?.operation.type === "callTool" && second.operation.input).toEqual({
      v: "example",
    });
    expect(result.adopted).toBe(1);
    expect(result.notAdopted).toBe(0);
  });

  it("채택이 없으면 명세를 그대로 돌려준다", async () => {
    const result = await applyPreFill({
      client,
      preFill,
      baseline: baselineSuite,
      dryRun: fakeDryRun({ baselinePasses: true, aiPasses: true }),
    });
    expect(result.suite).toBe(baselineSuite);
    expect(result.adopted).toBe(0);
    expect(result.notAdopted).toBe(1);
  });

  it("시험 실행이 중단되면 baseline 을 유지한다", async () => {
    // 끊긴 연결에서 나온 실패를 근거로 AI 값을 채택하면 서버가 옳은데 우리가 바꾸는 것이 된다.
    const result = await applyPreFill({
      client,
      preFill,
      baseline: baselineSuite,
      dryRun: fakeDryRun({ baselinePasses: false, aiPasses: true, abort: true }),
    });
    expect(result.cases[0]?.source).toBe("baseline");
    expect(result.cases[0]?.needsClassification).toBe(false);
  });

  it("제안이 없으면 서버를 부르지 않는다", async () => {
    const dryRun = vi.fn();
    const result = await applyPreFill({
      client,
      preFill: { accepted: [], discarded: [] },
      baseline: baselineSuite,
      dryRun,
    });
    expect(dryRun).not.toHaveBeenCalled();
    expect(result.cases).toEqual([]);
    expect(result.suite).toBe(baselineSuite);
  });

  it("명세에 없는 caseId 제안은 실행 대상이 아니다", async () => {
    const dryRun = vi.fn();
    const result = await applyPreFill({
      client,
      preFill: { accepted: [{ caseId: "ghost", field: "v", value: "AI" }], discarded: [] },
      baseline: baselineSuite,
      dryRun,
    });
    expect(dryRun).not.toHaveBeenCalled();
    expect(result.cases).toEqual([]);
  });

  it("대상 케이스만 두 번 실행한다", async () => {
    const dryRun = vi.fn(fakeDryRun({ baselinePasses: true, aiPasses: true }));
    await applyPreFill({ client, preFill, baseline: baselineSuite, dryRun });
    expect(dryRun).toHaveBeenCalledTimes(2);
    for (const call of dryRun.mock.calls)
      expect((call[0] as { suite: TestSuiteSpec }).suite.cases.map((item) => item.id)).toEqual([
        "c",
      ]);
  });
});

describe("표 밖 format 툴 건너뛰기", () => {
  const lookupHost: ToolDef = {
    name: "lookup_host",
    inputSchema: {
      type: "object",
      required: ["pointer"],
      properties: { pointer: { type: "string", format: "json-pointer" } },
    },
  };
  const ok: ToolDef = {
    name: "ok",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: { url: { type: "string", format: "uri" } },
    },
  };

  it("표 밖 format 을 가진 툴만 고른다", () => {
    const skips = unknownFormatSkips(
      [lookupHost, ok],
      [analyzeToolProvenance(lookupHost), analyzeToolProvenance(ok)],
    );
    expect(skips).toEqual([{ tool: "lookup_host", field: "pointer", format: "json-pointer" }]);
  });

  it("표 안 format 만 있으면 건너뛸 툴이 없다", () => {
    expect(unknownFormatSkips([ok], [analyzeToolProvenance(ok)])).toEqual([]);
  });

  it("건너뛴 툴의 케이스를 명세에서 뺀다", () => {
    const baseline = createBaselineSuite([lookupHost, ok], { suiteId: "s", suiteName: "s" });
    const skips = unknownFormatSkips([lookupHost, ok], baseline.provenance);
    const suite = dropSkippedTools(baseline.suite, skips);
    const tools = suite.cases.map((item) =>
      item.operation.type === "callTool" ? item.operation.tool : "",
    );
    expect(tools).not.toContain("lookup_host");
    expect(tools).toContain("ok");
  });

  it("건너뛸 것이 없으면 같은 명세를 그대로 돌려준다", () => {
    const baseline = createBaselineSuite([ok], { suiteId: "s", suiteName: "s" });
    expect(dropSkippedTools(baseline.suite, [])).toBe(baseline.suite);
  });
});
