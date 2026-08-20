import type { ToolDef } from "@mcpeak/core";
import { describe, expect, it } from "vitest";
import type { JsonObject, TestCaseSpec } from "../src/index.js";
import { checkInputContract, deriveContractAxes, matchCoveredAxes } from "../src/index.js";

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
        declaredRange: null,
      },
      {
        kind: "REQUIRED_OMITTED",
        tool: "get_weather",
        field: "city",
        declaredType: null,
        declaredEnum: null,
        declaredRange: null,
      },
      {
        kind: "TYPE_VIOLATION",
        tool: "get_weather",
        field: "city",
        declaredType: "string",
        declaredEnum: null,
        declaredRange: null,
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

const callCase = (id: string, input: JsonObject, expected: boolean): TestCaseSpec => ({
  id,
  name: id,
  operation: { type: "callTool", tool: "get_weather", input },
  assertions: [{ type: "isError", expected }],
});

/** enum 축과 필수 둘을 함께 보기 위한 툴. 이름은 케이스의 tool 과 맞춰야 한다. */
const units = tool("get_weather", {
  type: "object",
  properties: {
    a: { type: "string" },
    b: { type: "string" },
    units: { type: "string", enum: ["c", "f"] },
  },
  required: ["a", "b"],
});

describe("matchCoveredAxes", () => {
  it("선언을 지킨 입력 + isError false 는 HAPPY_PATH 를 덮는다", () => {
    const covered = matchCoveredAxes({
      testCase: callCase("ok", { city: "서울" }, false),
      tool: weather,
    });
    expect(covered).toEqual([
      {
        kind: "HAPPY_PATH",
        tool: "get_weather",
        field: null,
        declaredType: null,
        declaredEnum: null,
        declaredRange: null,
      },
    ]);
  });

  it("선언을 어긴 입력 + isError false 는 아무 축도 덮지 않는다", () => {
    expect(matchCoveredAxes({ testCase: callCase("bad", {}, false), tool: weather })).toEqual([]);
  });

  it("required 를 뺀 입력 + isError true 는 REQUIRED_OMITTED 를 덮는다", () => {
    const covered = matchCoveredAxes({ testCase: callCase("miss", {}, true), tool: weather });
    expect(covered).toEqual([
      {
        kind: "REQUIRED_OMITTED",
        tool: "get_weather",
        field: "city",
        declaredType: null,
        declaredEnum: null,
        declaredRange: null,
      },
    ]);
  });

  it("타입을 어긴 입력 + isError true 는 TYPE_VIOLATION 을 덮는다", () => {
    const covered = matchCoveredAxes({
      testCase: callCase("type", { city: 0 }, true),
      tool: weather,
    });
    expect(covered).toEqual([
      {
        kind: "TYPE_VIOLATION",
        tool: "get_weather",
        field: "city",
        declaredType: "string",
        declaredEnum: null,
        declaredRange: null,
      },
    ]);
  });

  it("enum 밖 값 + isError true 는 ENUM_VIOLATION 을 덮는다", () => {
    const covered = matchCoveredAxes({
      testCase: callCase("enum", { a: "x", b: "y", units: "k" }, true),
      tool: units,
    });
    expect(covered).toEqual([
      {
        kind: "ENUM_VIOLATION",
        tool: "get_weather",
        field: "units",
        declaredType: null,
        declaredEnum: ["c", "f"],
        declaredRange: null,
      },
    ]);
  });

  it("필수 필드 둘을 동시에 뺀 케이스는 REQUIRED_OMITTED 둘을 덮는다", () => {
    const covered = matchCoveredAxes({ testCase: callCase("miss2", {}, true), tool: units });
    expect(covered.map((axis) => `${axis.kind}:${axis.field ?? ""}`)).toEqual([
      "REQUIRED_OMITTED:a",
      "REQUIRED_OMITTED:b",
    ]);
  });

  it("반환 배열이 kind 우선, 같은 kind 안에서 field 코드 단위 순서다", () => {
    const covered = matchCoveredAxes({
      testCase: callCase("mixed", { b: 0, units: "k" }, true),
      tool: units,
    });
    expect(covered.map((axis) => `${axis.kind}:${axis.field ?? ""}`)).toEqual([
      "REQUIRED_OMITTED:a",
      "TYPE_VIOLATION:b",
      "ENUM_VIOLATION:units",
    ]);
  });

  it("isError 단언이 없으면 빈 배열이다", () => {
    const testCase: TestCaseSpec = {
      id: "no-iserror",
      name: "no-iserror",
      operation: { type: "callTool", tool: "get_weather", input: { city: "서울" } },
      assertions: [{ type: "bodyMatchesSchema", schema: { type: "object" } }],
    };
    expect(matchCoveredAxes({ testCase, tool: weather })).toEqual([]);
  });

  it("isError expected 가 서로 다른 단언이 둘 있으면 빈 배열이다", () => {
    const testCase: TestCaseSpec = {
      id: "contradiction",
      name: "contradiction",
      operation: { type: "callTool", tool: "get_weather", input: {} },
      assertions: [
        { type: "isError", expected: true },
        { type: "isError", expected: false },
      ],
    };
    expect(matchCoveredAxes({ testCase, tool: weather })).toEqual([]);
  });

  it("listTools 케이스는 빈 배열이다", () => {
    const testCase: TestCaseSpec = {
      id: "list",
      name: "list",
      operation: { type: "listTools" },
      assertions: [{ type: "toolExists", tool: "get_weather" }],
    };
    expect(matchCoveredAxes({ testCase, tool: weather })).toEqual([]);
  });

  it("다른 툴을 부르는 케이스는 빈 배열이다", () => {
    const other = tool("get_forecast", {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    });
    expect(matchCoveredAxes({ testCase: callCase("miss", {}, true), tool: other })).toEqual([]);
  });

  it("해석하지 못하는 스키마의 툴이면 빈 배열이다", () => {
    const opaque = tool("get_weather", { anyOf: [{ type: "object" }] });
    expect(matchCoveredAxes({ testCase: callCase("miss", {}, true), tool: opaque })).toEqual([]);
  });

  it("checkInputContract 가 침묵하는 케이스에서도 축을 낸다", () => {
    const testCase = callCase("miss", {}, true);
    const suite = {
      schemaVersion: 1 as const,
      id: "s",
      name: "s",
      defaultTimeoutMs: 1000,
      cases: [testCase],
    };
    expect(checkInputContract({ suite, tools: [weather] }).findings).toEqual([]);
    expect(matchCoveredAxes({ testCase, tool: weather })).toHaveLength(1);
  });
});

describe("RANGE_VIOLATION 축 도출", () => {
  const ranged = (props: Record<string, unknown>, required: string[]): ToolDef =>
    tool("t", { type: "object", required, properties: props });
  const rangeAxes = (props: Record<string, unknown>, required: string[]) =>
    deriveContractAxes(ranged(props, required)).axes.filter((a) => a.kind === "RANGE_VIOLATION");

  it("minimum 이 있으면 축을 만든다", () => {
    const axes = rangeAxes({ count: { type: "integer", minimum: 1 } }, ["count"]);
    expect(axes).toHaveLength(1);
    expect(axes[0]?.field).toBe("count");
    expect(axes[0]?.declaredRange?.minimum).toBe(1);
    expect(axes[0]?.declaredType).toBeNull();
    expect(axes[0]?.declaredEnum).toBeNull();
  });

  it("minimum 이 0 이어도 축을 만든다", () => {
    expect(rangeAxes({ count: { type: "integer", minimum: 0 } }, ["count"])).toHaveLength(1);
  });

  it("minItems: 0 단독은 축이 아니다", () => {
    expect(
      rangeAxes({ tags: { type: "array", items: { type: "string" }, minItems: 0 } }, ["tags"]),
    ).toHaveLength(0);
  });

  it("minItems: 0 이라도 maxItems 가 있으면 축이다", () => {
    expect(
      rangeAxes({ tags: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 3 } }, [
        "tags",
      ]),
    ).toHaveLength(1);
  });

  it("minLength: 0 단독은 축이 아니다", () => {
    expect(rangeAxes({ q: { type: "string", minLength: 0 } }, ["q"])).toHaveLength(0);
  });

  it("범위가 없으면 축이 아니다", () => {
    expect(rangeAxes({ count: { type: "integer" } }, ["count"])).toHaveLength(0);
  });

  it("한 필드에 축은 하나다", () => {
    expect(
      rangeAxes({ count: { type: "integer", minimum: 1, maximum: 10 } }, ["count"]),
    ).toHaveLength(1);
  });

  it("기존 축은 declaredRange 가 null 이다", () => {
    const axes = deriveContractAxes(
      ranged({ count: { type: "integer", minimum: 1 } }, ["count"]),
    ).axes;
    for (const axis of axes)
      if (axis.kind !== "RANGE_VIOLATION") expect(axis.declaredRange).toBeNull();
  });

  it("축 순서가 결정론적이고 RANGE_VIOLATION 이 마지막이다", () => {
    const schema = ranged(
      { b: { type: "integer", minimum: 1 }, a: { type: "integer", minimum: 1 } },
      ["b", "a"],
    );
    const first = deriveContractAxes(schema).axes.map((a) => `${a.kind}:${a.field}`);
    const second = deriveContractAxes(schema).axes.map((a) => `${a.kind}:${a.field}`);
    expect(first).toEqual(second);
    expect(first).toEqual([
      "HAPPY_PATH:null",
      "REQUIRED_OMITTED:a",
      "REQUIRED_OMITTED:b",
      "TYPE_VIOLATION:a",
      "TYPE_VIOLATION:b",
      "RANGE_VIOLATION:a",
      "RANGE_VIOLATION:b",
    ]);
  });
});

describe("matchCoveredAxes 가 RANGE_VIOLATION 을 덮은 것으로 센다", () => {
  const ranged = tool("t", {
    type: "object",
    required: ["count"],
    properties: { count: { type: "integer", minimum: 1 } },
  });
  const rejection = (input: JsonObject): TestCaseSpec => ({
    id: "c",
    name: "c",
    operation: { type: "callTool", tool: "t", input },
    assertions: [{ type: "isError", expected: true }],
  });

  it("범위 밖 값을 보낸 거절 기대 케이스가 축을 덮는다", () => {
    const covered = matchCoveredAxes({ testCase: rejection({ count: 0 }), tool: ranged });
    expect(covered.map((a) => a.kind)).toEqual(["RANGE_VIOLATION"]);
    expect(covered[0]?.declaredRange?.minimum).toBe(1);
  });

  it("타입 위반이면 범위 축을 덮지 않는다", () => {
    const covered = matchCoveredAxes({ testCase: rejection({ count: "x" }), tool: ranged });
    expect(covered.map((a) => a.kind)).toEqual(["TYPE_VIOLATION"]);
  });

  it("범위 안 값이면 HAPPY_PATH 다", () => {
    const testCase: TestCaseSpec = {
      id: "c",
      name: "c",
      operation: { type: "callTool", tool: "t", input: { count: 1 } },
      assertions: [{ type: "isError", expected: false }],
    };
    expect(matchCoveredAxes({ testCase, tool: ranged }).map((a) => a.kind)).toEqual(["HAPPY_PATH"]);
  });
});

describe("enum 과 범위가 함께 선언된 필드", () => {
  const enumRanged = tool("t", {
    type: "object",
    required: ["count"],
    properties: { count: { type: "integer", enum: [1, 2], minimum: 1 } },
  });

  it("범위 축을 만들지 않는다", () => {
    // 범위를 어긴 값은 enum 밖이기도 해서 ENUM_VIOLATION 으로 먼저 분류된다. 축을 만들면
    // 어떤 케이스로도 못 덮는 빈틈이 분모에 남는다.
    expect(deriveContractAxes(enumRanged).axes.map((a) => a.kind)).toEqual([
      "HAPPY_PATH",
      "REQUIRED_OMITTED",
      "TYPE_VIOLATION",
      "ENUM_VIOLATION",
    ]);
  });

  it("범위 밖 값은 ENUM_VIOLATION 으로 덮인다", () => {
    const testCase: TestCaseSpec = {
      id: "c",
      name: "c",
      operation: { type: "callTool", tool: "t", input: { count: 0 } },
      assertions: [{ type: "isError", expected: true }],
    };
    expect(matchCoveredAxes({ testCase, tool: enumRanged }).map((a) => a.kind)).toEqual([
      "ENUM_VIOLATION",
    ]);
  });
});
