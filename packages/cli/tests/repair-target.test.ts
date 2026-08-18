import type { McpClient, ToolDef, ToolResult } from "@ohmymcp-hsu/core";
import type {
  JsonObject,
  TestCaseSpec,
  TestSuiteSpec,
  ToolResultAssertionSpec,
} from "@ohmymcp-hsu/runner";
import { describe, expect, it } from "vitest";
import { runDryRun } from "../src/dry-run.js";
import { selectRepairTargets } from "../src/repair-target.js";

/** 서버를 띄우지 않는다. 툴 선언은 이 파일 안에서 만든 인메모리 값이다. */
const tools: ToolDef[] = [
  {
    name: "get_weather",
    description: "날씨를 조회한다",
    inputSchema: { type: "object", properties: { city: { type: "string" } } },
  },
];

const okResult = (tool: string): ToolResult => ({
  content: [{ type: "text", text: `${tool} ok` }],
  isError: false,
  raw: { ok: true },
});

const errorResult = (text: string): ToolResult => ({
  content: [{ type: "text", text }],
  isError: true,
  raw: { ok: false },
});

/**
 * 본문을 꺼낼 수 없는 오류 응답. `content` 가 배열이 아니라 추출이 실패하고, 그러면
 * 진단이 서버 본문을 싣지 않는다(ADR-0027). 케이스는 여전히 `isError` 로 실패한다.
 */
const unreadableErrorResult = (): ToolResult => ({
  content: null,
  isError: true,
  raw: { ok: false },
});

/** 툴 이름별 응답을 미리 정해 두는 가짜 클라이언트. 지정이 없으면 정상 응답이다. */
const fakeClient = (responses: Readonly<Record<string, ToolResult>> = {}): McpClient => ({
  async listTools() {
    return tools;
  },
  async callTool(name) {
    return responses[name] ?? okResult(name);
  },
  async close() {},
});

const callCase = (
  id: string,
  tool: string,
  input: JsonObject,
  assertions: ToolResultAssertionSpec[] = [{ type: "isError", expected: false }],
): TestCaseSpec => ({
  id,
  name: `${tool} 케이스 ${id}`,
  operation: { type: "callTool", tool, input },
  assertions,
});

const listToolsCase = (id: string, tool: string): TestCaseSpec => ({
  id,
  name: `${tool} 선언 케이스 ${id}`,
  operation: { type: "listTools" },
  assertions: [{ type: "toolExists", tool }],
});

const suiteOf = (cases: readonly TestCaseSpec[]): TestSuiteSpec => ({
  schemaVersion: 1,
  id: "repair-target-suite",
  name: "교정 대상 스위트",
  cases: [...cases],
});

/**
 * 실제 실행을 거쳐 `outcomes` 를 만든다. `detail` 을 손으로 적으면 렌더러가 바뀌었을 때
 * 테스트만 통과하고 제품이 깨진다.
 */
const select = async (
  cases: readonly TestCaseSpec[],
  origins: ReadonlyMap<string, "schemaBaseline" | "ai" | "user"> = new Map(),
  responses: Readonly<Record<string, ToolResult>> = {},
) => {
  const suite = suiteOf(cases);
  const result = await runDryRun({ client: fakeClient(responses), suite });
  return selectRepairTargets({ suite, outcomes: result.outcomes, origins });
};

/** 오류 응답을 돌려주는 툴 하나짜리 응답표. */
const rejects = (tool: string, text: string): Readonly<Record<string, ToolResult>> => ({
  [tool]: errorResult(text),
});

describe("selectRepairTargets", () => {
  it("통과한 케이스는 대상이 아니다", async () => {
    const targets = await select([callCase("c1", "get_weather", { city: "서울" })]);

    expect(targets).toEqual([]);

    // 위는 detail 이 비어 있어 다른 규칙에도 걸린다. 상태만으로도 걸러지는지 따로 못 박는다.
    // 그러지 않으면 status 검사를 지워도 테스트가 통과한다.
    const suite = suiteOf([callCase("c1", "get_weather", { city: "서울" })]);
    const failing = await runDryRun({
      client: fakeClient(rejects("get_weather", "city 가 필요합니다.")),
      suite,
    });
    const relabelled = failing.outcomes.map((outcome) => ({
      ...outcome,
      status: "passed" as const,
    }));

    expect(selectRepairTargets({ suite, outcomes: relabelled, origins: new Map() })).toEqual([]);
  });

  it("listTools 케이스는 대상이 아니다", async () => {
    const targets = await select([listToolsCase("c1", "없는_툴")]);

    expect(targets).toEqual([]);
  });

  it("입력이 빈 객체면 대상이 아니다", async () => {
    const targets = await select(
      [callCase("c1", "get_weather", {})],
      new Map(),
      rejects("get_weather", "city 가 필요합니다."),
    );

    expect(targets).toEqual([]);
  });

  it("origin 이 user 면 대상이 아니다", async () => {
    const targets = await select(
      [callCase("c1", "get_weather", { city: "서울" })],
      new Map([["c1", "user"]]),
      rejects("get_weather", "city 가 필요합니다."),
    );

    expect(targets).toEqual([]);
  });

  it("origins 에 없는 caseId 는 schemaBaseline 으로 보고 대상이 된다", async () => {
    const targets = await select(
      [callCase("c1", "get_weather", { city: "서울" })],
      new Map(),
      rejects("get_weather", "city 가 필요합니다."),
    );

    expect(targets.map((target) => target.caseId)).toEqual(["c1"]);
  });

  it("isError expected true 인 위반 케이스는 대상이 아니다", async () => {
    // 오류를 기대했는데 정상 응답이 왔다. 실패했고 isError 줄도 있지만 교정 대상은 아니다.
    const targets = await select([
      callCase("c1", "get_weather", { city: "서울" }, [{ type: "isError", expected: true }]),
    ]);

    expect(targets).toEqual([]);
  });

  it("본문 스키마 불일치로만 실패한 케이스는 대상이 아니다", async () => {
    const targets = await select([
      callCase("c1", "get_weather", { city: "서울" }, [
        {
          type: "bodyMatchesSchema",
          schema: { type: "object", required: ["temp"], properties: { temp: { type: "number" } } },
        },
      ]),
    ]);

    expect(targets).toEqual([]);
  });

  it("isError 로 실패한 baseline 케이스는 대상이다", async () => {
    const targets = await select(
      [callCase("c1", "get_weather", { city: "서울" })],
      new Map([["c1", "schemaBaseline"]]),
      rejects("get_weather", "city 가 필요합니다."),
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]?.caseId).toBe("c1");
    expect(targets[0]?.caseName).toBe("get_weather 케이스 c1");
    expect(targets[0]?.tool).toBe("get_weather");
    expect(targets[0]?.input).toEqual({ city: "서울" });
  });

  it("input 의 키 순서가 명세 순서와 같다", async () => {
    const targets = await select(
      [callCase("c1", "get_weather", { city: "서울", unit: "c", days: 3 })],
      new Map(),
      rejects("get_weather", "city 가 필요합니다."),
    );

    expect(Object.keys(targets[0]?.input ?? {})).toEqual(["city", "unit", "days"]);
  });

  it("serverMessage 에 서버 오류 본문이 들어간다", async () => {
    const targets = await select(
      [
        callCase("c1", "get_weather", { city: "서울" }, [
          { type: "isError", expected: false },
          {
            type: "bodyMatchesSchema",
            schema: {
              type: "object",
              required: ["temp"],
              properties: { temp: { type: "number" } },
            },
          },
        ]),
      ],
      new Map(),
      rejects("get_weather", "city 는 서울/부산 중 하나여야 합니다."),
    );

    expect(targets[0]?.serverMessage).toContain("city 는 서울/부산 중 하나여야 합니다.");
  });

  it("isError 단언만 있어도 serverMessage 에 서버 응답 본문이 들어간다", async () => {
    // 위의 `serverMessage 에 서버 오류 본문이 들어간다` 는 본문 단언이 붙은 케이스를 본다.
    // 여기는 단언이 isError 하나뿐인 베이스라인 케이스다. 생성기가 만드는 정상 케이스가
    // 이 모양이고, 진단이 본문을 싣기 시작하면서 열린 경로다(ADR-0027).
    const targets = await select(
      [callCase("c1", "get_weather", { city: "example" })],
      new Map(),
      rejects("get_weather", "알 수 없는 도시: example"),
    );

    expect(targets[0]?.serverMessage).toContain("알 수 없는 도시: example");
  });

  it("서버 오류 본문이 없으면 serverMessage 가 빈 문자열이다", async () => {
    const targets = await select([callCase("c1", "get_weather", { city: "서울" })], new Map(), {
      get_weather: unreadableErrorResult(),
    });

    expect(targets).toHaveLength(1);
    expect(targets[0]?.serverMessage).toBe("");
  });

  it("반환 순서가 outcomes 순서와 같다", async () => {
    const targets = await select(
      [
        callCase("c1", "get_weather", { city: "서울" }),
        callCase("c2", "reject_all", { city: "부산" }),
        callCase("c3", "reject_all", { city: "대구" }),
      ],
      new Map(),
      rejects("reject_all", "city 가 필요합니다."),
    );

    expect(targets.map((target) => target.caseId)).toEqual(["c2", "c3"]);
  });
});
