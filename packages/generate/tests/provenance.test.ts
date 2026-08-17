import type { ToolDef } from "@ohmymcp/core";
import { describe, expect, it } from "vitest";
import { analyzeToolProvenance } from "../src/provenance.js";

const tool = (v: Record<string, unknown>): ToolDef => ({
  name: "t",
  inputSchema: { type: "object", required: ["v"], properties: { v } },
});

describe("필드 단위 출처", () => {
  it.each([
    [{ type: "string" }, "placeholder"],
    [{ type: "integer" }, "placeholder"],
    [{ type: "string", format: "uri" }, "declared"],
    [{ type: "string", format: "hostname" }, "declared"],
    [{ type: "string", format: "json-pointer" }, "unknownFormat"],
    [{ type: "integer", minimum: 1 }, "declared"],
    [{ type: "integer", maximum: 10 }, "declared"],
    [{ type: "string", minLength: 3 }, "declared"],
    [{ type: "boolean" }, "declared"],
    [{ type: "null" }, "declared"],
    [{ type: "string", const: "x" }, "declared"],
    [{ type: "string", default: "x" }, "declared"],
    [{ type: "string", enum: ["a", "b"] }, "declared"],
    [{ type: "string", examples: ["a"] }, "declared"],
  ])("%j → %s", (schema, expected) => {
    const result = analyzeToolProvenance(tool(schema));
    if (expected === "declared") {
      expect(result.declared).toBe(1);
      expect(result.placeholder).toBe(0);
      expect(result.unknownFormatFields).toEqual([]);
    } else if (expected === "placeholder") {
      expect(result.placeholder).toBe(1);
      expect(result.declared).toBe(0);
    } else {
      expect(result.unknownFormatFields).toEqual(["v"]);
      expect(result.declared).toBe(0);
      expect(result.placeholder).toBe(0);
    }
  });

  it("툴 이름을 그대로 싣는다", () => {
    expect(analyzeToolProvenance(tool({ type: "string" })).tool).toBe("t");
  });
});

describe("needsAssist 판정", () => {
  it("전 필드가 declared 면 false", () => {
    expect(analyzeToolProvenance(tool({ type: "integer", minimum: 1 })).needsAssist).toBe(false);
  });

  it("placeholder 가 하나라도 있으면 true", () => {
    const t: ToolDef = {
      name: "t",
      inputSchema: {
        type: "object",
        required: ["a", "b"],
        properties: { a: { type: "integer", minimum: 1 }, b: { type: "string" } },
      },
    };
    expect(analyzeToolProvenance(t).needsAssist).toBe(true);
  });

  it("unknownFormat 이 있으면 true", () => {
    expect(
      analyzeToolProvenance(tool({ type: "string", format: "json-pointer" })).needsAssist,
    ).toBe(true);
  });

  it("필수 필드가 없는 객체는 declared 다", () => {
    const t: ToolDef = { name: "t", inputSchema: { type: "object", required: [], properties: {} } };
    const result = analyzeToolProvenance(t);
    expect(result.needsAssist).toBe(false);
    expect(result.declared).toBe(1);
  });
});

describe("중첩 집계", () => {
  it("배열은 items 의 출처를 물려받는다", () => {
    const t = tool({ type: "array", items: { type: "string" }, minItems: 2 });
    expect(analyzeToolProvenance(t).placeholder).toBe(1);
  });

  it("배열 원소가 근거 있는 값이면 declared 다", () => {
    const t = tool({ type: "array", items: { type: "string", format: "uri" } });
    expect(analyzeToolProvenance(t).declared).toBe(1);
  });

  it("객체는 required 필드를 재귀로 센다", () => {
    const t = tool({
      type: "object",
      required: ["x", "y"],
      properties: { x: { type: "string" }, y: { type: "integer", minimum: 1 } },
    });
    const result = analyzeToolProvenance(t);
    expect(result.placeholder).toBe(1);
    expect(result.declared).toBe(1);
  });

  it("중첩 필드 경로가 점 표기다", () => {
    const t = tool({
      type: "object",
      required: ["x"],
      properties: { x: { type: "string", format: "json-pointer" } },
    });
    expect(analyzeToolProvenance(t).unknownFormatFields).toEqual(["v.x"]);
  });

  it("unknownFormatFields 가 코드 단위 오름차순이다", () => {
    const t: ToolDef = {
      name: "t",
      inputSchema: {
        type: "object",
        required: ["b", "a"],
        properties: {
          b: { type: "string", format: "json-pointer" },
          a: { type: "string", format: "relative-json-pointer" },
        },
      },
    };
    expect(analyzeToolProvenance(t).unknownFormatFields).toEqual(["a", "b"]);
  });
});
