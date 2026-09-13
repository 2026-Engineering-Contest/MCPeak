import type { McpClient, ToolDef } from "@mcpeak/core";
import { analyzeToolProvenance, createBaselineSuite, type PreFillResult } from "@mcpeak/generate";
import type { JsonObject, TestSuiteSpec } from "@mcpeak/runner";
import { describe, expect, it, vi } from "vitest";
import type { DryRunResult } from "../src/dry-run.js";
import { applyPreFill, dropSkippedTools, unknownFormatSkips } from "../src/pre-fill-wiring.js";
import type { ResetGrade } from "../src/reset-hook.js";

/** 서버를 부르지 않는다. dryRun 주입점이 판정을 대신한다. */
const client = {} as McpClient;

/**
 * 비교가 성립하는 초기화. 아래 채택표 테스트들은 **초기화가 됐다는 전제**에서 어느 값을
 * 고르는지를 본다. 초기화 자체의 규칙은 `후보 비교가 같은 초기 상태에서 돈다` 가 따로 본다.
 */
const okReset = async (): Promise<ResetGrade> => "commandOnly";

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
      reset: okReset,
    });
    expect(result.cases[0]?.source).toBe(expected);
  });

  it("baseline 실패 + AI 실패면 분류 대상으로 남는다", async () => {
    const result = await applyPreFill({
      client,
      preFill,
      baseline: baselineSuite,
      dryRun: fakeDryRun({ baselinePasses: false, aiPasses: false }),
      reset: okReset,
    });
    expect(result.cases[0]?.needsClassification).toBe(true);
  });

  it("채택하면 그 케이스의 입력만 바뀐다", async () => {
    const result = await applyPreFill({
      client,
      preFill,
      baseline: baselineSuite,
      dryRun: fakeDryRun({ baselinePasses: false, aiPasses: true }),
      reset: okReset,
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
      reset: okReset,
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
      reset: okReset,
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
      reset: okReset,
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
      reset: okReset,
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
      reset: okReset,
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
      reset: okReset,
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
      reset: okReset,
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
      reset: okReset,
    });
    expect(result.cases[0]?.serverMessage).toBe("툴 'x' 호출 중 오류가 발생했습니다.");
  });

  it("detail 이 비면 서버 응답이 빈 문자열이다", async () => {
    const result = await applyPreFill({
      client,
      preFill,
      baseline: baselineSuite,
      dryRun: fakeDryRun({ baselinePasses: false, aiPasses: false }),
      reset: okReset,
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
      reset: okReset,
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
      reset: okReset,
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
      reset: okReset,
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

/**
 * 상태를 바꾸는 서버를 흉내 내는 인메모리 fixture. **실제 프로세스를 띄우지 않는다.**
 *
 * 첫 호출은 실패하고 두 번째부터 성공한다. 초기화가 불리면 카운터가 0 으로 돌아간다.
 * 이 모양이 이 이슈의 증상을 그대로 재현한다. 초기화가 없으면 baseline 회차가 첫 호출을
 * 써 버려 AI 회차만 통과하고, 그러면 "입력이 좋아서" 가 아니라 "앞 실행이 상태를 바꿔서"
 * 채택된다(이슈 #399).
 */
function statefulFixture() {
  let calls = 0;
  const resets: ResetGrade[] = [];
  return {
    resets,
    dryRun: async (o: { suite: TestSuiteSpec }): Promise<DryRunResult> => {
      calls += 1;
      const passes = calls > 1;
      return {
        outcomes: o.suite.cases.map((item) => ({
          caseId: item.id,
          caseName: item.name,
          status: passes ? ("passed" as const) : ("failed" as const),
          detail: "",
          rejectionBasis: "notApplicable" as const,
          operationFailed: false,
          failureLine: "",
        })),
      };
    },
    /** 이 등급을 내는 초기화. 불릴 때마다 카운터를 0 으로 되돌린다. */
    resetWith: (grades: readonly ResetGrade[]) => {
      let index = 0;
      return async (): Promise<ResetGrade> => {
        const grade = grades[Math.min(index, grades.length - 1)] as ResetGrade;
        index += 1;
        resets.push(grade);
        calls = 0;
        return grade;
      };
    },
  };
}

describe("후보 비교가 같은 초기 상태에서 돈다", () => {
  it("초기화 없이 돌리면 상태 차이로 AI 가 통과하지만 채택하지 않는다 (회귀 재현)", async () => {
    // **이 테스트는 고친 뒤에도 남긴다.** 초기화가 왜 필요한지가 여기 적혀 있다.
    //
    // 계획서는 이 자리에서 `adopted 1` 을 기대했는데, 같은 계획서 §3 이 "reset 이 undefined
    // 면 none 과 같이 다룬다. 비교하지 않는다" 고 정한다. 둘은 함께 참일 수 없다. 사양 쪽을
    // 따랐다. 재현하려는 **기전**(baseline 실패·AI 통과가 입력이 아니라 상태 때문이다)은
    // 그대로 두고, 이제 그것을 근거로 채택하지 않는다는 것을 단언한다.
    const fixture = statefulFixture();
    const result = await applyPreFill({
      client,
      preFill,
      baseline: baselineSuite,
      dryRun: fixture.dryRun,
    });
    expect(result.compared).toBe(false);
    expect(result.adopted).toBe(0);
    expect(result.suite).toBe(baselineSuite);
    expect(result.skippedReason).toContain("같은 초기 상태에서 실행할 수 없습니다");
  });

  it("초기화를 넣으면 둘 다 실패해 held 가 된다", async () => {
    // 두 회차가 같은 자리에서 출발하므로 AI 회차도 첫 호출이다. 둘 다 실패한다.
    const fixture = statefulFixture();
    const result = await applyPreFill({
      client,
      preFill,
      baseline: baselineSuite,
      dryRun: fixture.dryRun,
      reset: fixture.resetWith(["commandOnly"]),
    });
    expect(result.compared).toBe(true);
    expect(result.adopted).toBe(0);
    expect(result.held).toBe(1);
    expect(result.suite).toBe(baselineSuite);
  });

  it("reset 을 후보 실행 앞과 사이에 각각 부른다", async () => {
    const fixture = statefulFixture();
    await applyPreFill({
      client,
      preFill,
      baseline: baselineSuite,
      dryRun: fixture.dryRun,
      reset: fixture.resetWith(["commandOnly"]),
    });
    expect(fixture.resets).toHaveLength(2);
  });

  it("앞 초기화가 none 이면 비교하지 않는다", async () => {
    const fixture = statefulFixture();
    const result = await applyPreFill({
      client,
      preFill,
      baseline: baselineSuite,
      dryRun: fixture.dryRun,
      reset: fixture.resetWith(["none", "commandOnly"]),
    });
    expect(result.compared).toBe(false);
    expect(result.adopted).toBe(0);
    expect(result.skippedReason).toContain("초기화 수단이 없습니다");
  });

  it("사이 초기화가 failed 면 비교하지 않는다", async () => {
    const fixture = statefulFixture();
    const result = await applyPreFill({
      client,
      preFill,
      baseline: baselineSuite,
      dryRun: fixture.dryRun,
      reset: fixture.resetWith(["commandOnly", "failed"]),
    });
    expect(result.compared).toBe(false);
    expect(result.adopted).toBe(0);
    expect(result.skippedReason).toContain("초기화 명령이 실패했습니다");
  });

  it("등급이 둘 다 나쁘면 두 문장을 다 찍는다", async () => {
    // failed 가 none 보다 약하다고 보지 않는다. 둘은 다음에 할 일이 다르다.
    const fixture = statefulFixture();
    const result = await applyPreFill({
      client,
      preFill,
      baseline: baselineSuite,
      dryRun: fixture.dryRun,
      reset: fixture.resetWith(["none", "failed"]),
    });
    expect(result.skippedReason).toContain("초기화 수단이 없습니다");
    expect(result.skippedReason).toContain("초기화 명령이 실패했습니다");
  });

  it("같은 등급이 두 번이면 문장을 한 번만 찍는다", async () => {
    const fixture = statefulFixture();
    const result = await applyPreFill({
      client,
      preFill,
      baseline: baselineSuite,
      dryRun: fixture.dryRun,
      reset: fixture.resetWith(["none"]),
    });
    const lines = (result.skippedReason ?? "").split("\n");
    expect(lines.filter((line) => line.includes("초기화 수단이 없습니다"))).toHaveLength(1);
  });

  it("commandOnly 두 번이면 비교한다", async () => {
    const result = await applyPreFill({
      client,
      preFill,
      baseline: baselineSuite,
      dryRun: fakeDryRun({ baselinePasses: false, aiPasses: true }),
      reset: async () => "commandOnly",
    });
    expect(result.compared).toBe(true);
    expect(result.skippedReason).toBeUndefined();
    expect(result.adopted).toBe(1);
  });

  it("aborted 면 종전대로 전부 baseline 을 유지한다", async () => {
    const result = await applyPreFill({
      client,
      preFill,
      baseline: baselineSuite,
      dryRun: fakeDryRun({ baselinePasses: false, aiPasses: true, abort: true }),
      reset: okReset,
    });
    // 비교 자체는 성립했다. 끊긴 연결의 판정을 안 믿는 것은 다른 규칙이다.
    expect(result.compared).toBe(true);
    expect(result.adopted).toBe(0);
    expect(result.cases[0]?.source).toBe("baseline");
  });

  it("제안이 없으면 초기화를 아예 안 부른다", async () => {
    // 부를 이유가 없는 호출은 만들지 않는다. 초기화는 사용자 명령을 실행하는 일이다.
    const fixture = statefulFixture();
    const result = await applyPreFill({
      client,
      preFill: { accepted: [], discarded: [] },
      baseline: baselineSuite,
      dryRun: fixture.dryRun,
      reset: fixture.resetWith(["commandOnly"]),
    });
    expect(fixture.resets).toHaveLength(0);
    expect(result.compared).toBe(true);
  });
});
