import type { ToolDef } from "@ohmymcp/core";
import { describe, expect, it } from "vitest";
import { deriveContractAxes } from "../src/index.js";

const tool = (name: string, inputSchema: unknown): ToolDef => ({ name, inputSchema });
const weather = tool("get_weather", {
  type: "object",
  properties: { city: { type: "string" } },
  required: ["city"],
});

describe("deriveContractAxes", () => {
  it("required 하나와 type 하나인 툴은 축 3개를 낸다", () => {
    const result = deriveContractAxes(weather);
    expect(result.analyzable).toBe(true);
    expect(result.unanalyzableReason).toBeNull();
    expect(result.unanalyzedFields).toEqual([]);
    expect(result.axes).toEqual([
      {
        kind: "HAPPY_PATH",
        tool: "get_weather",
        field: null,
        declaredType: null,
        declaredEnum: null,
      },
      {
        kind: "REQUIRED_OMITTED",
        tool: "get_weather",
        field: "city",
        declaredType: null,
        declaredEnum: null,
      },
      {
        kind: "TYPE_VIOLATION",
        tool: "get_weather",
        field: "city",
        declaredType: "string",
        declaredEnum: null,
      },
    ]);
  });

  it("properties 가 없는 object 스키마는 analyzable false 다", () => {
    const result = deriveContractAxes(tool("t", { type: "object" }));
    expect(result.analyzable).toBe(false);
    expect(result.unanalyzableReason).toBe("properties");
    expect(result.axes).toEqual([]);
  });

  it("required 가 빈 배열이면 축은 HAPPY_PATH 와 TYPE_VIOLATION 뿐이다", () => {
    const result = deriveContractAxes(
      tool("t", { type: "object", properties: { city: { type: "string" } }, required: [] }),
    );
    expect(result.axes.map((axis) => axis.kind)).toEqual(["HAPPY_PATH", "TYPE_VIOLATION"]);
  });

  it("optional 필드에도 TYPE_VIOLATION 축이 생긴다", () => {
    const result = deriveContractAxes(
      tool("t", { type: "object", properties: { units: { type: "string" } } }),
    );
    expect(result.axes.map((axis) => `${axis.kind}:${axis.field ?? ""}`)).toEqual([
      "HAPPY_PATH:",
      "TYPE_VIOLATION:units",
    ]);
  });

  it("type 과 enum 을 함께 선언한 필드는 축이 둘 생긴다", () => {
    const result = deriveContractAxes(
      tool("t", { type: "object", properties: { units: { type: "string", enum: ["c", "f"] } } }),
    );
    expect(result.axes.map((axis) => axis.kind)).toEqual([
      "HAPPY_PATH",
      "TYPE_VIOLATION",
      "ENUM_VIOLATION",
    ]);
    expect(result.axes[2]?.declaredEnum).toEqual(["c", "f"]);
  });

  it("enum 만 있고 type 이 없는 필드는 ENUM_VIOLATION 축만 생긴다", () => {
    const result = deriveContractAxes(
      tool("t", { type: "object", properties: { units: { enum: ["c", "f"] } } }),
    );
    expect(result.axes.map((axis) => axis.kind)).toEqual(["HAPPY_PATH", "ENUM_VIOLATION"]);
    expect(result.unanalyzedFields).toEqual([]);
  });

  it('type 이 ["string","null"] 인 필드는 축이 없고 unanalyzedFields 에 들어간다', () => {
    const result = deriveContractAxes(
      tool("t", { type: "object", properties: { city: { type: ["string", "null"] } } }),
    );
    expect(result.analyzable).toBe(true);
    expect(result.axes.map((axis) => axis.kind)).toEqual(["HAPPY_PATH"]);
    expect(result.unanalyzedFields).toEqual(["city"]);
  });

  it("필드에 anyOf 가 있으면 그 필드만 축에서 빠지고 unanalyzedFields 에 들어간다", () => {
    const result = deriveContractAxes(
      tool("t", {
        type: "object",
        properties: { a: { type: "string" }, b: { anyOf: [{ type: "string" }] } },
        required: ["a", "b"],
      }),
    );
    expect(result.unanalyzedFields).toEqual(["b"]);
    expect(result.axes.map((axis) => `${axis.kind}:${axis.field ?? ""}`)).toEqual([
      "HAPPY_PATH:",
      "REQUIRED_OMITTED:a",
      "REQUIRED_OMITTED:b",
      "TYPE_VIOLATION:a",
    ]);
  });

  it("required 에 있지만 properties 에 없는 필드는 REQUIRED_OMITTED 축만 생긴다", () => {
    const result = deriveContractAxes(
      tool("t", {
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a", "ghost"],
      }),
    );
    expect(result.axes.map((axis) => `${axis.kind}:${axis.field ?? ""}`)).toEqual([
      "HAPPY_PATH:",
      "REQUIRED_OMITTED:a",
      "REQUIRED_OMITTED:ghost",
      "TYPE_VIOLATION:a",
    ]);
    expect(result.unanalyzedFields).toEqual([]);
  });

  it("required 에 같은 이름이 두 번이면 REQUIRED_OMITTED 축이 하나만 생긴다", () => {
    const result = deriveContractAxes(
      tool("t", { type: "object", properties: { a: { type: "string" } }, required: ["a", "a"] }),
    );
    expect(result.axes.filter((axis) => axis.kind === "REQUIRED_OMITTED")).toHaveLength(1);
  });

  it("required 가 중복이어도 축은 HAPPY_PATH, REQUIRED_OMITTED, TYPE_VIOLATION 셋이다", () => {
    const result = deriveContractAxes(
      tool("t", { type: "object", properties: { a: { type: "string" } }, required: ["a", "a"] }),
    );
    expect(result.axes.map((axis) => `${axis.kind}:${axis.field ?? ""}`)).toEqual([
      "HAPPY_PATH:",
      "REQUIRED_OMITTED:a",
      "TYPE_VIOLATION:a",
    ]);
  });

  it("루트에 anyOf 가 있으면 축을 세지 않고 사유가 anyOf 다", () => {
    const result = deriveContractAxes(tool("t", { anyOf: [{ type: "object" }] }));
    expect(result).toEqual({
      axes: [],
      analyzable: false,
      unanalyzableReason: "anyOf",
      unanalyzedFields: [],
    });
  });

  it("루트 type 이 object 가 아니면 analyzable false 이고 사유가 type 이다", () => {
    const result = deriveContractAxes(tool("t", { type: "array", properties: {} }));
    expect(result.analyzable).toBe(false);
    expect(result.unanalyzableReason).toBe("type");
    expect(result.axes).toEqual([]);
  });

  it("inputSchema 가 null 이면 analyzable false 이고 사유가 schema 다", () => {
    const result = deriveContractAxes(tool("t", null));
    expect(result.analyzable).toBe(false);
    expect(result.unanalyzableReason).toBe("schema");
    expect(result.axes).toEqual([]);
  });

  it("axes 가 kind 우선, 같은 kind 안에서 field 코드 단위 오름차순이다", () => {
    const result = deriveContractAxes(
      tool("t", {
        type: "object",
        properties: {
          b: { type: "string", enum: ["x"] },
          A: { type: "number" },
          a: { type: "string", enum: ["y"] },
        },
        required: ["b", "a", "A"],
      }),
    );
    expect(result.axes.map((axis) => `${axis.kind}:${axis.field ?? ""}`)).toEqual([
      "HAPPY_PATH:",
      "REQUIRED_OMITTED:A",
      "REQUIRED_OMITTED:a",
      "REQUIRED_OMITTED:b",
      "TYPE_VIOLATION:A",
      "TYPE_VIOLATION:a",
      "TYPE_VIOLATION:b",
      "ENUM_VIOLATION:a",
      "ENUM_VIOLATION:b",
    ]);
  });

  it("required 배열 순서를 뒤집어도 결과가 같다", () => {
    const forward = deriveContractAxes(
      tool("t", {
        type: "object",
        properties: { a: { type: "string" }, b: { type: "string" } },
        required: ["a", "b"],
      }),
    );
    const backward = deriveContractAxes(
      tool("t", {
        type: "object",
        properties: { a: { type: "string" }, b: { type: "string" } },
        required: ["b", "a"],
      }),
    );
    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward));
  });

  it("duplicated 를 넘기면 사유가 duplicateTool 이다", () => {
    expect(deriveContractAxes(weather, { duplicated: true })).toEqual({
      axes: [],
      analyzable: false,
      unanalyzableReason: "duplicateTool",
      unanalyzedFields: [],
    });
  });

  it("같은 툴로 두 번 호출한 결과가 동일하다", () => {
    expect(JSON.stringify(deriveContractAxes(weather))).toBe(
      JSON.stringify(deriveContractAxes(weather)),
    );
  });

  it("declaredType 은 TYPE_VIOLATION 에서만, declaredEnum 은 ENUM_VIOLATION 에서만 값이 있다", () => {
    const result = deriveContractAxes(
      tool("t", {
        type: "object",
        properties: { units: { type: "string", enum: ["c", "f"] } },
        required: ["units"],
      }),
    );
    for (const axis of result.axes) {
      if (axis.kind === "TYPE_VIOLATION") expect(axis.declaredType).toBe("string");
      else expect(axis.declaredType).toBeNull();
      if (axis.kind === "ENUM_VIOLATION") expect(axis.declaredEnum).toEqual(["c", "f"]);
      else expect(axis.declaredEnum).toBeNull();
    }
  });

  it("analyzable 이 true 면 unanalyzableReason 이 null 이다", () => {
    expect(deriveContractAxes(weather).unanalyzableReason).toBeNull();
  });
});
