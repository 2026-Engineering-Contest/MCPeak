import { describe, expect, it } from "vitest";
import { summarizeSuite } from "../src/suite-summary.js";

const SUITE = JSON.stringify({
  schemaVersion: 1,
  id: "weather",
  name: "Weather 예제",
  cases: [
    {
      id: "tools-listed",
      name: "툴 목록",
      operation: { type: "listTools" },
      assertions: [
        { type: "toolExists", tool: "get_weather" },
        { type: "toolExists", tool: "add" },
      ],
    },
    {
      id: "get-weather-success",
      name: "성공",
      operation: { type: "callTool", tool: "get_weather", input: { city: "서울" } },
      assertions: [{ type: "isError", expected: false }],
    },
    {
      id: "body-shape",
      name: "본문",
      operation: { type: "callTool", tool: "get_weather", input: { city: "부산" } },
      assertions: [{ type: "bodyMatchesSchema", schema: { type: "object" } }],
    },
  ],
});

describe("summarizeSuite", () => {
  it("케이스당 한 줄로 id · 조작 · 단언을 적는다 (CLI show 와 같은 모양)", () => {
    const result = summarizeSuite(SUITE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toMatchObject({ id: "weather", name: "Weather 예제", caseCount: 3 });
    expect(result.summary.lines).toEqual([
      "  1. tools-listed  listTools  → toolExists get_weather, toolExists add",
      '  2. get-weather-success  callTool get_weather {"city":"서울"}  → isError=false',
      '  3. body-shape  callTool get_weather {"city":"부산"}  → bodyMatchesSchema',
    ]);
  });

  it("입력 JSON 이 80자를 넘으면 자른다", () => {
    const long = JSON.stringify({
      id: "s",
      name: "s",
      cases: [
        {
          id: "c",
          operation: { type: "callTool", tool: "t", input: { text: "x".repeat(200) } },
          assertions: [],
        },
      ],
    });
    const result = summarizeSuite(long);
    if (!result.ok) throw new Error(result.reason);
    const line = result.summary.lines[0] ?? "";
    expect(line).toContain("…");
    expect(line.length).toBeLessThan(120);
  });

  it("JSON 이 아니면 이유를 말하고 죽지 않는다", () => {
    expect(summarizeSuite("{not json")).toEqual({ ok: false, reason: "올바른 JSON 이 아닙니다." });
  });

  it("cases 가 없으면 스위트가 아니라고 말한다", () => {
    expect(summarizeSuite(JSON.stringify({ id: "x" }))).toEqual({
      ok: false,
      reason: "스위트 형식이 아닙니다. cases 배열이 없습니다.",
    });
  });

  it("케이스 수가 10 을 넘으면 번호 폭을 맞춘다", () => {
    const many = JSON.stringify({
      id: "s",
      name: "s",
      cases: Array.from({ length: 12 }, (_, i) => ({
        id: `c${i}`,
        operation: { type: "listTools" },
        assertions: [],
      })),
    });
    const result = summarizeSuite(many);
    if (!result.ok) throw new Error(result.reason);
    expect(result.summary.lines[0]).toMatch(/^ {3}1\. /);
    expect(result.summary.lines[11]).toMatch(/^ {2}12\. /);
  });
});
