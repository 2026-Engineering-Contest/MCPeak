import type { McpClient, ToolDef } from "@mcpeak/core";
import { analyzeToolProvenance, createBaselineSuite, type PreFillResult } from "@mcpeak/generate";
import type { JsonObject, TestSuiteSpec } from "@mcpeak/runner";
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

/** baseline 에 listTools 케이스를 하나 더한 명세. callTool 이 아닌 제안을 제외로 세는지 본다. */
const withListToolsCase: TestSuiteSpec = {
  ...baselineSuite,
  cases: [
    ...baselineSuite.cases,
    { id: "list-a", name: "list-a", operation: { type: "listTools" }, assertions: [] },
  ],
};

/**
 * 케이스 입력으로 baseline·AI 회차를 구분해 판정을 돌려준다.
 * v 가 "AI" 이거나 baseline 에 없는 expression 필드가 얹혀 있으면 AI 회차다.
 */
const fakeDryRun =
  (options: {
    baselinePasses: boolean;
    aiPasses: boolean;
    abort?: boolean;
    /** AI 회차의 실패 상세. 서버 위반 줄 추출을 검증할 때 쓴다. */
    aiDetail?: string;
  }) =>
  async (o: { suite: TestSuiteSpec }): Promise<DryRunResult> => {
    const isAi = o.suite.cases.some((item) => {
      if (item.operation.type !== "callTool") return false;
      const input = item.operation.input as JsonObject | undefined;
      return input?.v === "AI" || input?.expression !== undefined;
    });
    const passes = isAi ? options.aiPasses : options.baselinePasses;
    const result: DryRunResult = {
      outcomes: o.suite.cases.map((item) => ({
        caseId: item.id,
        caseName: item.name,
        status: passes ? ("passed" as const) : ("failed" as const),
        detail: isAi ? (options.aiDetail ?? "") : "",
        rejectionBasis: "notApplicable" as const,
        operationFailed: false,
        failureLine: "",
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

  it("보류는 미채택에 포함하되 따로 센다", async () => {
    const bothProposed: PreFillResult = {
      accepted: [
        { caseId: "c", field: "v", value: "AI" },
        { caseId: "other", field: "v", value: "AI" },
      ],
      discarded: [],
    };
    // c 는 baseline 도 제안도 실패해 보류이고, other 는 baseline 이 이미 통과한다.
    const dryRun = async (o: { suite: TestSuiteSpec }): Promise<DryRunResult> => ({
      outcomes: o.suite.cases.map((item) => ({
        caseId: item.id,
        caseName: item.name,
        status: item.id === "other" ? ("passed" as const) : ("failed" as const),
        detail: "",
        rejectionBasis: "notApplicable" as const,
        operationFailed: false,
        failureLine: "",
      })),
    });
    const result = await applyPreFill({
      client,
      preFill: bothProposed,
      baseline: baselineSuite,
      dryRun,
    });
    expect(result.adopted).toBe(0);
    expect(result.notAdopted).toBe(2);
    expect(result.held).toBe(1);
  });

  it("제안이 없으면 보류도 0이다", async () => {
    const result = await applyPreFill({
      client,
      preFill: { accepted: [], discarded: [] },
      baseline: baselineSuite,
      dryRun: vi.fn(),
    });
    expect(result.held).toBe(0);
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
    expect(result.excluded).toEqual([
      { caseId: "ghost", field: "v", reason: "명세에 없는 케이스" },
    ]);
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

  it("보류 케이스에 제안 값과 서버 위반 줄을 싣는다", async () => {
    const result = await applyPreFill({
      client,
      preFill: { accepted: [{ caseId: "c", field: "expression", value: "2" }], discarded: [] },
      baseline: baselineSuite,
      dryRun: fakeDryRun({
        baselinePasses: false,
        aiPasses: false,
        aiDetail: [
          "    isError  정상 응답을 기대했지만 오류 응답을 받았습니다.",
          "    → 식을 해석할 수 없습니다: '2'",
          "    해결: 툴 입력값과 서버의 오류 응답을 확인하세요.",
        ].join("\n"),
      }),
    });
    expect(result.cases[0]?.proposedFields).toEqual([{ field: "expression", value: "2" }]);
    expect(result.cases[0]?.serverMessage).toBe("식을 해석할 수 없습니다: '2'");
  });

  it("보류가 아닌 케이스에는 제안 값 키가 없다", async () => {
    const result = await applyPreFill({
      client,
      preFill,
      baseline: baselineSuite,
      dryRun: fakeDryRun({ baselinePasses: false, aiPasses: true }),
    });
    expect("proposedFields" in (result.cases[0] ?? {})).toBe(false);
    expect("serverMessage" in (result.cases[0] ?? {})).toBe(false);
  });

  it("위반 줄이 없으면 첫 본문 줄을 서버 응답으로 쓴다", async () => {
    const result = await applyPreFill({
      client,
      preFill,
      baseline: baselineSuite,
      dryRun: fakeDryRun({
        baselinePasses: false,
        aiPasses: false,
        aiDetail: "    툴 'x' 호출 중 오류가 발생했습니다.",
      }),
    });
    expect(result.cases[0]?.serverMessage).toBe("툴 'x' 호출 중 오류가 발생했습니다.");
  });

  it("detail 이 비면 서버 응답이 빈 문자열이다", async () => {
    const result = await applyPreFill({
      client,
      preFill,
      baseline: baselineSuite,
      dryRun: fakeDryRun({ baselinePasses: false, aiPasses: false }),
    });
    expect(result.cases[0]?.serverMessage).toBe("");
  });

  it("callTool 이 아닌 케이스의 제안은 제외로 센다", async () => {
    const dryRun = vi.fn();
    const result = await applyPreFill({
      client,
      preFill: { accepted: [{ caseId: "list-a", field: "query", value: "AI" }], discarded: [] },
      baseline: withListToolsCase,
      dryRun,
    });
    expect(result.excluded).toEqual([
      { caseId: "list-a", field: "query", reason: "callTool 이 아닌 케이스" },
    ]);
    expect(result.cases).toEqual([]);
    expect(result.adopted).toBe(0);
    expect(result.notAdopted).toBe(0);
  });

  it("명세에 없는 케이스의 제안은 제외로 센다", async () => {
    const result = await applyPreFill({
      client,
      preFill: { accepted: [{ caseId: "ghost", field: "v", value: "AI" }], discarded: [] },
      baseline: baselineSuite,
      dryRun: vi.fn(),
    });
    expect(result.excluded[0]?.reason).toBe("명세에 없는 케이스");
  });

  it("제안이 전부 제외되면 서버를 부르지 않는다", async () => {
    const dryRun = vi.fn();
    await applyPreFill({
      client,
      preFill: {
        accepted: [
          { caseId: "ghost", field: "v", value: "AI" },
          { caseId: "list-a", field: "query", value: "AI" },
        ],
        discarded: [],
      },
      baseline: withListToolsCase,
      dryRun,
    });
    expect(dryRun).toHaveBeenCalledTimes(0);
  });

  it("정상 대상이 있으면 제외와 함께 센다", async () => {
    const result = await applyPreFill({
      client,
      preFill: {
        accepted: [
          { caseId: "c", field: "v", value: "AI" },
          { caseId: "list-a", field: "query", value: "AI" },
        ],
        discarded: [],
      },
      baseline: withListToolsCase,
      dryRun: fakeDryRun({ baselinePasses: true, aiPasses: true }),
    });
    expect(result.cases.length).toBe(1);
    expect(result.excluded.length).toBe(1);
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
