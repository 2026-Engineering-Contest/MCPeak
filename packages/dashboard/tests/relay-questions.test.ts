import { describe, expect, it } from "vitest";
import { planRelayCases } from "../src/server/relay-questions.js";

const SUITE = JSON.stringify({
  id: "weather",
  name: "날씨 서버",
  cases: [
    {
      id: "get-weather-success",
      operation: { type: "callTool", tool: "get_weather", input: { city: "서울" } },
      assertions: [{ type: "isError", expected: false }],
    },
    { id: "tools-exist", operation: { type: "listTools" }, assertions: [] },
    {
      id: "add-missing-a",
      operation: { type: "callTool", tool: "add", input: { b: 2 } },
      assertions: [{ type: "isError", expected: true }],
    },
  ],
});

describe("중계 케이스 계획", () => {
  it("callTool 케이스마다 꼬리표·툴·입력을 파일 순서 그대로 낸다", () => {
    const plan = planRelayCases(SUITE);
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;
    expect(plan.cases).toEqual([
      { id: "get-weather-success", tag: "c1", tool: "get_weather", input: { city: "서울" } },
      { id: "add-missing-a", tag: "c2", tool: "add", input: { b: 2 } },
    ]);
  });

  it("질문을 못 지은 케이스를 조용히 버리지 않고 센다", () => {
    const plan = planRelayCases(SUITE);
    if ("error" in plan) throw new Error("계획이 서야 한다");
    expect(plan.skipped).toEqual(["tools-exist"]);
  });

  it("같은 스위트는 항상 같은 질문을 같은 순서로 낸다", () => {
    const first = planRelayCases(SUITE);
    const second = planRelayCases(SUITE);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("질문에 툴 이름과 입력이 그대로 실린다", () => {
    const plan = planRelayCases(SUITE);
    if ("error" in plan) throw new Error("계획이 서야 한다");
    expect(plan.prompts.c1).toContain("get_weather");
    expect(plan.prompts.c1).toContain('{"city":"서울"}');
  });

  it("JSON 이 아니면 고치는 방법까지 말한다", () => {
    const result = planRelayCases("{ 아님");
    expect(result).toEqual({
      error:
        "→ 스위트 파일이 올바른 JSON 이 아닙니다.\n→ 2 단계에서 고른 파일을 열어 JSON 형식을 확인하세요.",
    });
  });

  it("cases 배열이 없으면 무엇이 없는지 말한다", () => {
    expect(planRelayCases(JSON.stringify({ id: "x" }))).toEqual({
      error:
        "→ 스위트에 cases 배열이 없습니다.\n→ mcpeak generate 가 만든 스위트 파일인지 확인하세요.",
    });
  });

  it("callTool 케이스가 하나도 없으면 띄울 것이 없다고 말한다", () => {
    const result = planRelayCases(
      JSON.stringify({ cases: [{ id: "only-list", operation: { type: "listTools" } }] }),
    );
    expect(result).toEqual({
      error:
        "→ 이 스위트에는 툴을 부르는 케이스가 없습니다. 실제 응답을 볼 대상이 없습니다.\n" +
        "→ 건너뛴 케이스 1 건: only-list\n" +
        "→ operation.type 이 callTool 인 케이스가 있는 스위트를 고르세요.",
    });
  });
});
