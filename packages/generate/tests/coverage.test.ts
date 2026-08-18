import { readFileSync } from "node:fs";
import type { ToolDef } from "@ohmymcp-hsu/core";
import type { TestSuiteSpec } from "@ohmymcp-hsu/runner";
import { describe, expect, it } from "vitest";
import { computeCoverage } from "../src/coverage.js";
import { buildViolationCases } from "../src/index.js";
import type { JsonObject } from "../src/schema.js";

const fixture = JSON.parse(
  readFileSync(new URL("../../../fixtures/tools-list.sample.json", import.meta.url), "utf8"),
) as { tools: ToolDef[] };

function fixtureTool(name: string): ToolDef {
  const found = fixture.tools.find((item) => item.name === name);
  if (found === undefined) throw new Error(`픽스처에 도구가 없습니다: ${name}`);
  return found;
}

function tool(name: string, inputSchema: unknown): ToolDef {
  return { name, inputSchema };
}

const weather = fixtureTool("get_weather");
const add = fixtureTool("add");

const HAPPY_INPUT: Record<string, JsonObject> = {
  get_weather: { city: "example" },
  add: { a: 0, b: 0 },
};
const BASE_NAME: Record<string, string> = { get_weather: "get-weather", add: "add" };

/** §5.5 의 8케이스 스위트를 조립한다. 정상 케이스 + T6 의 위반 케이스다. */
function suiteOf(tools: readonly ToolDef[]): TestSuiteSpec {
  const cases = tools.flatMap((item) => {
    const happyInput = HAPPY_INPUT[item.name] ?? {};
    const baseName = BASE_NAME[item.name] ?? item.name;
    return [
      {
        id: `${baseName}-success`,
        name: `${item.name}가 오류 없이 응답한다`,
        operation: { type: "callTool" as const, tool: item.name, input: happyInput },
        assertions: [{ type: "isError" as const, expected: false }],
      },
      ...buildViolationCases({ tool: item, happyInput, baseName }).map((violation) => ({
        id: violation.id,
        name: violation.name,
        operation: {
          type: "callTool" as const,
          tool: violation.operation.tool,
          input: violation.operation.input,
        },
        assertions: [...violation.assertions],
      })),
    ];
  });
  return { schemaVersion: 1, id: "s", name: "s", defaultTimeoutMs: 1000, cases };
}

function caseOf(
  id: string,
  toolName: string,
  input: JsonObject,
  expected: boolean,
): TestSuiteSpec["cases"][number] {
  return {
    id,
    name: id,
    operation: { type: "callTool", tool: toolName, input },
    assertions: [{ type: "isError", expected }],
  } as TestSuiteSpec["cases"][number];
}

function suiteWith(cases: TestSuiteSpec["cases"]): TestSuiteSpec {
  return { schemaVersion: 1, id: "s", name: "s", defaultTimeoutMs: 1000, cases };
}

describe("computeCoverage", () => {
  it("§5.5 의 8케이스 스위트는 verified 와 total 이 8 로 같다", () => {
    const suite = suiteOf([weather, add]);
    expect(suite.cases).toHaveLength(8);
    const coverage = computeCoverage({ suite, tools: [weather, add] });
    expect(coverage.verified).toBe(8);
    expect(coverage.total).toBe(8);
  });

  it("REQUIRED_OMITTED 케이스를 지우면 그 축의 caseId 가 null 이고 verified 가 1 줄어든다", () => {
    const full = suiteOf([weather, add]);
    const suite = { ...full, cases: full.cases.filter((item) => item.id !== "add-missing-b") };
    const coverage = computeCoverage({ suite, tools: [weather, add] });
    expect(coverage.verified).toBe(7);
    expect(coverage.total).toBe(8);
    const addCoverage = coverage.tools.find((item) => item.tool === "add");
    expect(
      addCoverage?.axes.find((axis) => axis.field === "b" && axis.kind === "REQUIRED_OMITTED")
        ?.caseId,
    ).toBeNull();
  });

  it("손으로 쓴 이름의 케이스도 입력 내용으로 축이 잡힌다", () => {
    const suite = suiteWith([caseOf("내가-쓴-케이스", "get_weather", {}, true)]);
    const coverage = computeCoverage({ suite, tools: [weather] });
    expect(coverage.tools[0]?.axes.find((axis) => axis.kind === "REQUIRED_OMITTED")?.caseId).toBe(
      "내가-쓴-케이스",
    );
  });

  it("isError 단언이 없는 케이스는 어떤 축도 덮지 않는다", () => {
    const suite = suiteWith([
      {
        id: "no-assertion",
        name: "no-assertion",
        operation: { type: "callTool", tool: "get_weather", input: {} },
        assertions: [{ type: "bodyContains", value: "x" }],
      } as unknown as TestSuiteSpec["cases"][number],
    ]);
    const coverage = computeCoverage({ suite, tools: [weather] });
    expect(coverage.verified).toBe(0);
    expect(coverage.total).toBe(3);
  });

  it("isError expected false 이고 입력이 선언을 어긴 케이스는 HAPPY_PATH 를 덮지 않는다", () => {
    const suite = suiteWith([caseOf("bad-happy", "get_weather", { city: 0 }, false)]);
    const coverage = computeCoverage({ suite, tools: [weather] });
    expect(coverage.tools[0]?.axes.find((axis) => axis.kind === "HAPPY_PATH")?.caseId).toBeNull();
    expect(coverage.verified).toBe(0);
  });

  it("필수 필드 둘을 동시에 뺀 케이스 하나가 REQUIRED_OMITTED 축 둘을 덮는다", () => {
    const suite = suiteWith([caseOf("both-missing", "add", {}, true)]);
    const coverage = computeCoverage({ suite, tools: [add] });
    const covered = coverage.tools[0]?.axes.filter(
      (axis) => axis.kind === "REQUIRED_OMITTED" && axis.caseId === "both-missing",
    );
    expect(covered?.map((axis) => axis.field)).toEqual(["a", "b"]);
  });

  it("같은 축을 두 케이스가 덮으면 caseId 가 suite.cases 순서상 첫 케이스다", () => {
    const suite = suiteWith([
      caseOf("first", "get_weather", {}, true),
      caseOf("second", "get_weather", {}, true),
    ]);
    const coverage = computeCoverage({ suite, tools: [weather] });
    expect(coverage.tools[0]?.axes.find((axis) => axis.kind === "REQUIRED_OMITTED")?.caseId).toBe(
      "first",
    );
  });

  it("해석 불가 툴은 total 0, verified 0, axes 빈 배열이고 사유가 실린다", () => {
    const opaque = tool("t", { anyOf: [{ type: "object" }] });
    const suite = suiteWith([caseOf("c", "t", {}, true)]);
    const coverage = computeCoverage({ suite, tools: [opaque] });
    expect(coverage.tools[0]).toEqual({
      tool: "t",
      analyzable: false,
      unanalyzableReason: "anyOf",
      axes: [],
      verified: 0,
      total: 0,
      unanalyzedFields: [],
    });
    expect(coverage.verified).toBe(0);
    expect(coverage.total).toBe(0);
  });

  it("중복 선언된 툴은 analyzable false 이고 사유가 duplicateTool 이다", () => {
    const suite = suiteOf([weather]);
    const coverage = computeCoverage({ suite, tools: [weather, weather] });
    expect(coverage.tools).toHaveLength(1);
    expect(coverage.tools[0]?.analyzable).toBe(false);
    expect(coverage.tools[0]?.unanalyzableReason).toBe("duplicateTool");
    // 축이 없으므로 케이스가 있어도 분자가 늘지 않는다.
    expect(coverage.verified).toBe(0);
    expect(coverage.total).toBe(0);
  });

  it("unanalyzedFields 가 결과에 그대로 실린다", () => {
    const partial = tool("t", {
      type: "object",
      properties: { ok: { type: "string" }, weird: { anyOf: [{ type: "string" }] } },
    });
    const coverage = computeCoverage({ suite: suiteWith([]), tools: [partial] });
    expect(coverage.tools[0]?.analyzable).toBe(true);
    expect(coverage.tools[0]?.unanalyzedFields).toEqual(["weird"]);
  });

  it("tools 배열 순서를 뒤집어도 결과가 동일하다", () => {
    const suite = suiteOf([weather, add]);
    const forward = computeCoverage({ suite, tools: [weather, add] });
    const backward = computeCoverage({ suite, tools: [add, weather] });
    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward));
  });

  it("tools 가 툴 이름 코드 단위 오름차순으로 정렬돼 있다", () => {
    const suite = suiteWith([]);
    const coverage = computeCoverage({
      suite,
      tools: [tool("b", { type: "object", properties: {} }), tool("A", {}), weather, add],
    });
    expect(coverage.tools.map((item) => item.tool)).toEqual(["A", "add", "b", "get_weather"]);
  });

  it("명세에 있지만 서버가 선언하지 않은 툴은 결과에 안 들어간다", () => {
    const suite = suiteWith([caseOf("ghost", "unknown_tool", {}, true)]);
    const coverage = computeCoverage({ suite, tools: [weather] });
    expect(coverage.tools.map((item) => item.tool)).toEqual(["get_weather"]);
    expect(coverage.verified).toBe(0);
  });

  it("모든 툴이 해석 불가면 total 이 0 이다", () => {
    // 0/0 이다. 이것을 "전부 검증" 으로 읽지 않는 것은 화면의 일이고, 계산은 숫자만 낸다.
    const coverage = computeCoverage({
      suite: suiteWith([]),
      tools: [tool("t", { anyOf: [{ type: "object" }] })],
    });
    expect(coverage.total).toBe(0);
    expect(coverage.verified).toBe(0);
  });

  it("같은 입력으로 2회 호출한 결과가 동일하다", () => {
    const suite = suiteOf([weather, add]);
    const once = computeCoverage({ suite, tools: [weather, add] });
    const twice = computeCoverage({ suite, tools: [weather, add] });
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });
});

describe("커버리지에 RANGE_VIOLATION 이 들어간다", () => {
  const ranged = tool("t", {
    type: "object",
    required: ["v"],
    properties: { v: { type: "integer", minimum: 1 } },
  });
  const emptySuite: TestSuiteSpec = { schemaVersion: 1, id: "s", name: "s", cases: [] };

  it("범위 축이 분모에 포함된다", () => {
    const coverage = computeCoverage({ tools: [ranged], suite: emptySuite });
    expect(coverage.tools[0]?.axes.some((axis) => axis.kind === "RANGE_VIOLATION")).toBe(true);
    expect(coverage.verified).toBe(0);
  });

  it("위반 케이스가 있으면 덮인 것으로 센다", () => {
    const cases = buildViolationCases({ tool: ranged, happyInput: { v: 1 }, baseName: "t" });
    const suite: TestSuiteSpec = { schemaVersion: 1, id: "s", name: "s", cases: [...cases] };
    const coverage = computeCoverage({ tools: [ranged], suite });
    const rangeAxis = coverage.tools[0]?.axes.find((axis) => axis.kind === "RANGE_VIOLATION");
    expect(rangeAxis?.caseId).toBe("t-range-v");
  });
});
