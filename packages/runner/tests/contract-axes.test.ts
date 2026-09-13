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
        bound: null,
      },
      {
        kind: "REQUIRED_OMITTED",
        tool: "get_weather",
        field: "city",
        declaredType: null,
        declaredEnum: null,
        declaredRange: null,
        bound: null,
      },
      {
        kind: "TYPE_VIOLATION",
        tool: "get_weather",
        field: "city",
        declaredType: "string",
        declaredEnum: null,
        declaredRange: null,
        bound: null,
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
    // type 이 배열이면 합집합이라 그 경로를 통째로 포기한다. 사용자가 볼 때 "우리가 못 읽는
    // 선언" 이라는 점이 anyOf 와 같아 사유를 같이 묶는다(#388).
    expect(result.unanalyzedFields).toEqual([{ path: "city", reason: "blockingKeyword" }]);
  });

  it("필드에 anyOf 가 있으면 그 필드만 축에서 빠지고 unanalyzedFields 에 들어간다", () => {
    const result = deriveContractAxes(
      tool("t", {
        type: "object",
        properties: { a: { type: "string" }, b: { anyOf: [{ type: "string" }] } },
        required: ["a", "b"],
      }),
    );
    expect(result.unanalyzedFields).toEqual([{ path: "b", reason: "blockingKeyword" }]);
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
        bound: null,
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
        bound: null,
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
        bound: null,
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
        bound: null,
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

  it("한 필드에 상·하한이 함께 있으면 축이 둘이다", () => {
    expect(
      rangeAxes({ count: { type: "integer", minimum: 1, maximum: 10 } }, ["count"]).map(
        (a) => a.bound,
      ),
    ).toEqual(["lower", "upper"]);
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

describe("RANGE_VIOLATION 축이 상·하한으로 갈린다", () => {
  const ranged = (props: Record<string, unknown>, required: string[] = []): ToolDef =>
    tool("t", { type: "object", required, properties: props });
  const bounds = (props: Record<string, unknown>, required: string[] = []) =>
    deriveContractAxes(ranged(props, required))
      .axes.filter((a) => a.kind === "RANGE_VIOLATION")
      .map((a) => a.bound);

  it("minimum 과 maximum 이 함께 있으면 축이 둘이고 lower 가 먼저다", () => {
    const axes = deriveContractAxes(
      ranged({ n: { type: "integer", minimum: 1, maximum: 10 } }, ["n"]),
    ).axes.filter((a) => a.kind === "RANGE_VIOLATION");
    expect(axes.map((a) => a.bound)).toEqual(["lower", "upper"]);
    expect(axes.map((a) => a.field)).toEqual(["n", "n"]);
    expect(axes[0]?.declaredRange).toEqual(axes[1]?.declaredRange);
  });

  it("minimum 만 있으면 lower 축 하나다", () => {
    expect(bounds({ n: { type: "integer", minimum: 1 } })).toEqual(["lower"]);
  });

  it("maximum 만 있으면 upper 축 하나다", () => {
    expect(bounds({ n: { type: "integer", maximum: 10 } })).toEqual(["upper"]);
  });

  it("minItems: 0 단독은 축을 만들지 않는다", () => {
    expect(bounds({ xs: { type: "array", minItems: 0 } })).toEqual([]);
  });

  it("maxItems: 0 은 upper 축을 만든다", () => {
    expect(bounds({ xs: { type: "array", maxItems: 0 } })).toEqual(["upper"]);
  });

  it("enum 이 함께 선언되면 범위 축을 만들지 않는다", () => {
    expect(bounds({ n: { type: "integer", enum: [1, 5], minimum: 1, maximum: 10 } })).toEqual([]);
  });

  it("RANGE_VIOLATION 이 아닌 축의 bound 는 전부 null 이다", () => {
    const axes = deriveContractAxes(
      ranged({ n: { type: "integer", minimum: 1, maximum: 10 } }, ["n"]),
    ).axes;
    for (const axis of axes) if (axis.kind !== "RANGE_VIOLATION") expect(axis.bound).toBeNull();
  });
});

describe("matchCoveredAxes 가 위반한 쪽 축만 덮는다", () => {
  const bounded = tool("t", {
    type: "object",
    required: ["n"],
    properties: { n: { type: "integer", minimum: 1, maximum: 10 } },
  });
  const rejection = (input: JsonObject, toolDef: ToolDef = bounded) =>
    matchCoveredAxes({
      testCase: {
        id: "c",
        name: "c",
        operation: { type: "callTool", tool: "t", input },
        assertions: [{ type: "isError", expected: true }],
      },
      tool: toolDef,
    });

  it("하한 미만 입력은 lower 축만 덮는다", () => {
    expect(rejection({ n: 0 }).map((a) => [a.kind, a.bound])).toEqual([
      ["RANGE_VIOLATION", "lower"],
    ]);
  });

  it("상한 초과 입력은 upper 축만 덮는다", () => {
    expect(rejection({ n: 11 }).map((a) => [a.kind, a.bound])).toEqual([
      ["RANGE_VIOLATION", "upper"],
    ]);
  });

  it("범위 안 입력은 어느 범위 축도 안 덮는다", () => {
    const testCase: TestCaseSpec = {
      id: "c",
      name: "c",
      operation: { type: "callTool", tool: "t", input: { n: 5 } },
      assertions: [{ type: "isError", expected: false }],
    };
    expect(matchCoveredAxes({ testCase, tool: bounded }).map((a) => a.kind)).toEqual([
      "HAPPY_PATH",
    ]);
  });

  it("만족 불가능한 선언에서는 한 값이 양쪽을 덮는다", () => {
    const impossible = tool("t", {
      type: "object",
      required: ["n"],
      properties: { n: { type: "number", minimum: 10, maximum: 1 } },
    });
    expect(rejection({ n: 5 }, impossible).map((a) => a.bound)).toEqual(["lower", "upper"]);
  });

  it("문자열 길이도 방향이 갈린다", () => {
    const strings = tool("t", {
      type: "object",
      required: ["s"],
      properties: { s: { type: "string", minLength: 3, maxLength: 5 } },
    });
    expect(rejection({ s: "ab" }, strings).map((a) => a.bound)).toEqual(["lower"]);
    expect(rejection({ s: "abcdef" }, strings).map((a) => a.bound)).toEqual(["upper"]);
  });

  it("배열 길이도 방향이 갈린다", () => {
    const arrays = tool("t", {
      type: "object",
      required: ["xs"],
      properties: { xs: { type: "array", minItems: 2, maxItems: 3 } },
    });
    expect(rejection({ xs: [1] }, arrays).map((a) => a.bound)).toEqual(["lower"]);
    expect(rejection({ xs: [1, 2, 3, 4] }, arrays).map((a) => a.bound)).toEqual(["upper"]);
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

describe("nullable anyOf 필드 (#426)", () => {
  const nullableTool = (v: Record<string, unknown>) =>
    tool("get_weather", { type: "object", properties: { note: v } });
  const axesOf = (v: Record<string, unknown>) => deriveContractAxes(nullableTool(v));
  const kindsFor = (v: Record<string, unknown>, field: string) =>
    axesOf(v)
      .axes.filter((axis) => axis.field === field)
      .map((axis) => axis.kind);

  it("anyOf [string, null] 필드는 TYPE_VIOLATION 축을 얻는다", () => {
    const result = axesOf({ anyOf: [{ type: "string" }, { type: "null" }] });
    expect(result.unanalyzedFields).toEqual([]);
    expect(result.axes.filter((axis) => axis.field === "note")).toEqual([
      {
        kind: "TYPE_VIOLATION",
        tool: "get_weather",
        field: "note",
        declaredType: "string",
        declaredEnum: null,
        declaredRange: null,
        bound: null,
      },
    ]);
  });

  it("oneOf [null, integer] 도 같다", () => {
    const result = axesOf({ oneOf: [{ type: "null" }, { type: "integer" }] });
    expect(result.unanalyzedFields).toEqual([]);
    expect(result.axes.filter((axis) => axis.field === "note")).toEqual([
      {
        kind: "TYPE_VIOLATION",
        tool: "get_weather",
        field: "note",
        declaredType: "integer",
        declaredEnum: null,
        declaredRange: null,
        bound: null,
      },
    ]);
  });

  it("값 갈래의 enum 과 범위도 읽는다", () => {
    expect(
      kindsFor({ anyOf: [{ type: "string", enum: ["x", "y"] }, { type: "null" }] }, "note"),
    ).toEqual(["TYPE_VIOLATION", "ENUM_VIOLATION"]);
    expect(
      kindsFor({ anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] }, "note"),
    ).toEqual(["TYPE_VIOLATION", "RANGE_VIOLATION"]);
  });

  it("값 갈래가 둘이면 종전대로 포기한다", () => {
    expect(axesOf({ anyOf: [{ type: "string" }, { type: "number" }] }).unanalyzedFields).toEqual([
      { path: "note", reason: "blockingKeyword" },
    ]);
  });

  it("값 갈래가 둘이고 null 도 있으면 포기한다", () => {
    expect(
      axesOf({ anyOf: [{ type: "string" }, { type: "number" }, { type: "null" }] })
        .unanalyzedFields,
    ).toEqual([{ path: "note", reason: "blockingKeyword" }]);
  });

  it("null 갈래가 없으면 포기한다", () => {
    expect(axesOf({ anyOf: [{ type: "string" }] }).unanalyzedFields).toEqual([
      { path: "note", reason: "blockingKeyword" },
    ]);
    expect(axesOf({ anyOf: [{ type: "string", minLength: 1 }] }).unanalyzedFields).toEqual([
      { path: "note", reason: "blockingKeyword" },
    ]);
  });

  it("값 갈래에 차단 키워드가 있으면 포기한다", () => {
    expect(
      axesOf({ anyOf: [{ type: "string", not: {} }, { type: "null" }] }).unanalyzedFields,
    ).toEqual([{ path: "note", reason: "blockingKeyword" }]);
  });

  it("anyOf 와 oneOf 가 함께 있으면 포기한다", () => {
    expect(
      axesOf({
        anyOf: [{ type: "string" }, { type: "null" }],
        oneOf: [{ type: "string" }, { type: "null" }],
      }).unanalyzedFields,
    ).toEqual([{ path: "note", reason: "blockingKeyword" }]);
  });

  it("루트 anyOf 는 여전히 해석 불가다", () => {
    const result = deriveContractAxes(
      tool("get_weather", { anyOf: [{ type: "object", properties: {} }] }),
    );
    expect(result.analyzable).toBe(false);
    expect(result.unanalyzableReason).toBe("anyOf");
  });

  it("matchCoveredAxes: null 입력은 nullable 필드의 어떤 축도 어기지 않는다", () => {
    const covered = matchCoveredAxes({
      testCase: callCase("null-ok", { note: null }, false),
      tool: nullableTool({ anyOf: [{ type: "string", minLength: 3 }, { type: "null" }] }),
    });
    expect(covered.map((axis) => axis.kind)).toEqual(["HAPPY_PATH"]);
  });

  it("matchCoveredAxes: nullable 필드의 타입 위반값은 TYPE_VIOLATION 을 덮는다", () => {
    const covered = matchCoveredAxes({
      testCase: callCase("type-bad", { note: 0 }, true),
      tool: nullableTool({ anyOf: [{ type: "string" }, { type: "null" }] }),
    });
    expect(covered.map((axis) => axis.kind)).toEqual(["TYPE_VIOLATION"]);
  });
});

describe("UNDECLARED_FIELD 축 (#427)", () => {
  const strict = tool("get_weather", {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
    additionalProperties: false,
  });
  const withAdditional = (additionalProperties?: unknown) =>
    tool("get_weather", {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
      ...(additionalProperties === undefined ? {} : { additionalProperties }),
    });

  it("additionalProperties: false 면 UNDECLARED_FIELD 축이 마지막에 하나 있다", () => {
    const axes = deriveContractAxes(strict).axes;
    expect(axes.map((axis) => axis.kind)).toEqual([
      "HAPPY_PATH",
      "REQUIRED_OMITTED",
      "TYPE_VIOLATION",
      "UNDECLARED_FIELD",
    ]);
    expect(axes[axes.length - 1]).toEqual({
      kind: "UNDECLARED_FIELD",
      tool: "get_weather",
      field: null,
      declaredType: null,
      declaredEnum: null,
      declaredRange: null,
      bound: null,
    });
  });

  it.each([
    ["없으면", undefined],
    ["true 면", true],
    ["스키마 객체면", { type: "number" }],
  ])("additionalProperties 가 %s 축이 없다", (_label, additionalProperties) => {
    const axes = deriveContractAxes(withAdditional(additionalProperties)).axes;
    expect(axes.some((axis) => axis.kind === "UNDECLARED_FIELD")).toBe(false);
  });

  it("matchCoveredAxes: 선언 밖 키를 넣은 거절 기대 케이스가 UNDECLARED_FIELD 를 덮는다", () => {
    const covered = matchCoveredAxes({
      testCase: callCase("extra", { city: "서울", extra: 1 }, true),
      tool: strict,
    });
    expect(covered.map((axis) => axis.kind)).toEqual(["UNDECLARED_FIELD"]);
  });

  it("matchCoveredAxes: 선언 밖 키가 둘이어도 축은 하나다", () => {
    const covered = matchCoveredAxes({
      testCase: callCase("extra2", { city: "서울", a: 1, b: 2 }, true),
      tool: strict,
    });
    expect(covered.map((axis) => axis.kind)).toEqual(["UNDECLARED_FIELD"]);
  });

  it("matchCoveredAxes: 선언 밖 키가 있는 정상 기대 케이스는 아무 축도 덮지 않는다", () => {
    expect(
      matchCoveredAxes({
        testCase: callCase("ok", { city: "서울", extra: 1 }, false),
        tool: strict,
      }),
    ).toEqual([]);
  });

  it("matchCoveredAxes: additionalProperties 가 없으면 선언 밖 키가 있어도 HAPPY_PATH 를 덮는다", () => {
    const covered = matchCoveredAxes({
      testCase: callCase("ok", { city: "서울", extra: 1 }, false),
      tool: withAdditional(),
    });
    expect(covered.map((axis) => axis.kind)).toEqual(["HAPPY_PATH"]);
  });
});

describe("중첩 경로 축 도출", () => {
  /** 축을 `종류:경로` 문자열로 납작하게 본다. 경로가 붙은 것만 고른다. */
  const pathsOf = (inputSchema: unknown, kind: string) =>
    deriveContractAxes(tool("t", inputSchema))
      .axes.filter((axis) => axis.kind === kind)
      .map((axis) => axis.field);

  const userSchema = {
    type: "object",
    required: ["user"],
    properties: {
      user: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    },
  };

  it("user 와 user.name 이 모두 축을 갖는다", () => {
    expect(pathsOf(userSchema, "REQUIRED_OMITTED")).toEqual(["user", "user.name"]);
    expect(pathsOf(userSchema, "TYPE_VIOLATION")).toEqual(["user", "user.name"]);
  });

  it("배열 원소가 축을 갖는다", () => {
    const schema = {
      type: "object",
      properties: { tags: { type: "array", items: { type: "string", minLength: 3 } } },
    };
    expect(pathsOf(schema, "TYPE_VIOLATION")).toEqual(["tags", "tags[]"]);
    const range = deriveContractAxes(tool("t", schema)).axes.filter(
      (axis) => axis.kind === "RANGE_VIOLATION",
    );
    expect(range.map((axis) => `${axis.field}:${axis.bound}`)).toEqual(["tags[]:lower"]);
  });

  it("배열 원소 경로는 REQUIRED_OMITTED 축을 안 만든다", () => {
    // 원소가 없는 것은 minItems 위반이고 그것은 이미 그 배열의 RANGE_VIOLATION 축이다.
    const schema = {
      type: "object",
      required: ["tags"],
      properties: {
        tags: {
          type: "array",
          minItems: 1,
          items: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        },
      },
    };
    const required = pathsOf(schema, "REQUIRED_OMITTED");
    expect(required).toEqual(["tags", "tags[].id"]);
    expect(required).not.toContain("tags[]");
  });

  it("tags 의 minItems 와 tags[] 의 minLength 가 섞이지 않는다", () => {
    const schema = {
      type: "object",
      properties: {
        tags: { type: "array", minItems: 2, items: { type: "string", minLength: 3 } },
      },
    };
    const ranges = deriveContractAxes(tool("t", schema)).axes.filter(
      (axis) => axis.kind === "RANGE_VIOLATION",
    );
    const tags = ranges.find((axis) => axis.field === "tags");
    const items = ranges.find((axis) => axis.field === "tags[]");
    expect(tags?.declaredRange?.minItems).toBe(2);
    expect(tags?.declaredRange?.minLength).toBeNull();
    expect(items?.declaredRange?.minLength).toBe(3);
    expect(items?.declaredRange?.minItems).toBeNull();
  });

  const deep = (leaf: unknown) => ({
    type: "object",
    properties: {
      user: {
        type: "object",
        properties: { address: { type: "object", properties: { city: leaf } } },
      },
    },
  });

  it("깊이 3 까지 내려간다", () => {
    expect(pathsOf(deep({ type: "string" }), "TYPE_VIOLATION")).toEqual([
      "user",
      "user.address",
      "user.address.city",
    ]);
  });

  it("깊이 4 는 depthLimit 으로 표시한다", () => {
    const schema = deep({ type: "object", properties: { zip: { type: "string" } } });
    const result = deriveContractAxes(tool("t", schema));
    expect(result.unanalyzedFields).toContainEqual({
      path: "user.address.city.zip",
      reason: "depthLimit",
    });
    // 그보다 얕은 축은 정상적으로 있다.
    expect(
      result.axes.filter((axis) => axis.kind === "TYPE_VIOLATION").map((a) => a.field),
    ).toEqual(["user", "user.address", "user.address.city"]);
  });

  it("경로 수 상한을 넘으면 pathLimit 으로 표시한다", () => {
    const properties = Object.fromEntries(
      // 코드 단위 정렬이 안정적이도록 자릿수를 맞춘다.
      Array.from({ length: 100 }, (_, index) => [
        `f${String(index).padStart(3, "0")}`,
        { type: "string" },
      ]),
    );
    const result = deriveContractAxes(tool("t", { type: "object", properties }));
    const types = result.axes.filter((axis) => axis.kind === "TYPE_VIOLATION");
    expect(types).toHaveLength(64);
    const limited = result.unanalyzedFields.filter((item) => item.reason === "pathLimit");
    expect(limited).toHaveLength(36);
    expect(limited[0]?.path).toBe("f064");
  });

  it("properties 없는 객체는 noProperties 다", () => {
    const result = deriveContractAxes(
      tool("t", { type: "object", properties: { user: { type: "object" } } }),
    );
    expect(result.unanalyzedFields).toEqual([{ path: "user", reason: "noProperties" }]);
    // 그 경로 자신의 type 축은 남는다. user 가 객체인지는 여전히 요구할 수 있다.
    expect(result.axes.map((axis) => `${axis.kind}:${axis.field ?? ""}`)).toContain(
      "TYPE_VIOLATION:user",
    );
  });

  it("튜플 items 는 tupleItems 다", () => {
    const result = deriveContractAxes(
      tool("t", {
        type: "object",
        properties: { pair: { type: "array", items: [{ type: "string" }, { type: "number" }] } },
      }),
    );
    expect(result.unanalyzedFields).toEqual([{ path: "pair", reason: "tupleItems" }]);
    expect(result.axes.some((axis) => axis.field === "pair[]")).toBe(false);
  });

  it("items 가 없으면 표시하지 않는다", () => {
    // 못 읽은 것이 아니라 적히지 않은 것이다.
    const result = deriveContractAxes(
      tool("t", { type: "object", properties: { tags: { type: "array" } } }),
    );
    expect(result.unanalyzedFields).toEqual([]);
    expect(result.axes.some((axis) => axis.field === "tags[]")).toBe(false);
  });

  it("중첩 anyOf 는 blockingKeyword 이고 그 아래는 안 본다", () => {
    const result = deriveContractAxes(
      tool("t", {
        type: "object",
        properties: {
          user: { anyOf: [{ type: "object", properties: { a: { type: "string" } } }, { b: 1 }] },
        },
      }),
    );
    expect(result.unanalyzedFields).toEqual([{ path: "user", reason: "blockingKeyword" }]);
    expect(result.axes.some((axis) => axis.field === "user.a")).toBe(false);
  });

  it("nullable 형태는 풀어서 내려간다", () => {
    const result = deriveContractAxes(
      tool("t", {
        type: "object",
        properties: {
          user: {
            anyOf: [{ type: "object", properties: { name: { type: "string" } } }, { type: "null" }],
          },
        },
      }),
    );
    expect(result.axes.map((axis) => axis.field)).toContain("user.name");
  });

  it("순환 $ref 는 깊이 상한 전에 끊긴다", () => {
    const result = deriveContractAxes(
      tool("t", {
        type: "object",
        properties: { node: { type: "object", properties: { next: { $ref: "#" } } } },
      }),
    );
    expect(result.axes.length).toBeLessThan(10);
    expect(result.unanalyzedFields).toContainEqual({
      path: "node.next",
      reason: "blockingKeyword",
    });
  });
});

describe("경로 충돌", () => {
  const collidingSchema = {
    type: "object",
    properties: {
      "user.name": { type: "string" },
      user: { type: "object", properties: { name: { type: "string" } } },
    },
  };

  it("'user.name' 최상위 필드는 빠지고 user 객체의 name 은 남는다", () => {
    // #388 T4 전에는 둘이 같은 경로를 만들어 pathCollision 으로 **양쪽**이 빠졌다. 이제는
    // 최상위 `"user.name"` 이라는 이름 자체가 읽을 수 없어 경로를 만들기 전에 빠지고, 충돌할
    // 짝이 없어진 `user` 객체의 `name` 은 정상적으로 축을 갖는다.
    const result = deriveContractAxes(tool("t", collidingSchema));
    expect(result.unanalyzedFields).toContainEqual({
      path: "user.name",
      reason: "unreadablePath",
    });
    expect(result.axes.map((axis) => axis.field)).toContain("user.name");
    expect(result.axes.map((axis) => axis.field)).toContain("user");
  });

  it("읽을 수 없는 이름 아래는 안 내려가고 진짜 경로는 끝까지 내려간다", () => {
    const result = deriveContractAxes(
      tool("t", {
        type: "object",
        properties: {
          "user.name": { type: "object", properties: { first: { type: "string" } } },
          user: {
            type: "object",
            properties: { name: { type: "object", properties: { first: { type: "string" } } } },
          },
        },
      }),
    );
    // 최상위 "user.name" 은 그 아래로 내려가지 않는다. 그 아래 경로도 같은 이유로 못 읽는다.
    expect(result.unanalyzedFields).toEqual([{ path: "user.name", reason: "unreadablePath" }]);
    // user 객체 쪽은 깊이 3 까지 그대로 내려간다.
    expect(result.axes.map((axis) => axis.field)).toContain("user.name.first");
  });

  it("'a.b' 최상위 필드만 있고 a 객체가 없으면 충돌이 아니다", () => {
    // 충돌이 아닌 것은 그대로 맞다. 사유가 pathCollision 이 아니라 unreadablePath 다.
    // 축이 안 생기는 것은 아래 describe 가 따로 본다.
    const result = deriveContractAxes(
      tool("t", { type: "object", properties: { "a.b": { type: "string" } } }),
    );
    expect(result.unanalyzedFields).toEqual([{ path: "a.b", reason: "unreadablePath" }]);
  });
});

describe("matchCoveredAxes 가 중첩 경로를 덮는다", () => {
  const nested = tool("get_weather", {
    type: "object",
    required: ["user"],
    properties: {
      user: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    },
  });
  const coveredBy = (input: JsonObject, expected: boolean) =>
    matchCoveredAxes({ testCase: callCase("c", input, expected), tool: nested });

  it("{ user: {} } 는 user.name 의 REQUIRED_OMITTED 만 덮는다", () => {
    const covered = coveredBy({ user: {} }, true);
    expect(covered.map((axis) => `${axis.kind}:${axis.field}`)).toEqual([
      "REQUIRED_OMITTED:user.name",
    ]);
  });

  it("{} 는 user 의 REQUIRED_OMITTED 만 덮는다", () => {
    // 이 구분이 없으면 케이스 하나가 축 둘을 덮어 커버리지가 부풀어 오른다.
    const covered = coveredBy({}, true);
    expect(covered.map((axis) => `${axis.kind}:${axis.field}`)).toEqual(["REQUIRED_OMITTED:user"]);
  });

  it("{ user: { name: 0 } } 는 user.name 의 TYPE_VIOLATION 만 덮는다", () => {
    const covered = coveredBy({ user: { name: 0 } }, true);
    expect(covered.map((axis) => `${axis.kind}:${axis.field}`)).toEqual([
      "TYPE_VIOLATION:user.name",
    ]);
  });

  it("{ user: 0 } 은 user 의 TYPE_VIOLATION 만 덮는다", () => {
    const covered = coveredBy({ user: 0 }, true);
    expect(covered.map((axis) => `${axis.kind}:${axis.field}`)).toEqual(["TYPE_VIOLATION:user"]);
  });

  it("배열 원소 하나만 위반이어도 그 축을 덮는다", () => {
    const tagged = tool("get_weather", {
      type: "object",
      properties: { tags: { type: "array", items: { type: "string", minLength: 3 } } },
    });
    const covered = matchCoveredAxes({
      testCase: callCase("c", { tags: ["ab", "example"] }, true),
      tool: tagged,
    });
    expect(covered.map((axis) => `${axis.kind}:${axis.field}:${axis.bound}`)).toEqual([
      "RANGE_VIOLATION:tags[]:lower",
    ]);
  });

  it("정상 입력은 HAPPY_PATH 만 덮는다", () => {
    const covered = coveredBy({ user: { name: "example" } }, false);
    expect(covered.map((axis) => axis.kind)).toEqual(["HAPPY_PATH"]);
  });
});

describe("unanalyzedFields 사유", () => {
  it("경로 코드 단위 오름차순이다", () => {
    const result = deriveContractAxes(
      tool("t", {
        type: "object",
        properties: {
          zeta: { anyOf: [{ type: "string" }] },
          alpha: { anyOf: [{ type: "string" }] },
          mid: {},
        },
      }),
    );
    expect(result.unanalyzedFields.map((item) => item.path)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("차단 키워드와 근거 없음을 다른 사유로 낸다", () => {
    const result = deriveContractAxes(
      tool("t", {
        type: "object",
        properties: { blocked: { allOf: [{ type: "string" }] }, bare: {} },
      }),
    );
    expect(result.unanalyzedFields).toEqual([
      { path: "bare", reason: "noGround" },
      { path: "blocked", reason: "blockingKeyword" },
    ]);
  });
});

describe("이름에 경로 문자가 든 필드는 축을 만들지 않는다", () => {
  const fieldsOf = (inputSchema: unknown) => deriveContractAxes(tool("t", inputSchema));

  it("'a.b' 최상위 필드는 unreadablePath 로 빠진다", () => {
    // 축을 만들면 valuesAtPath 가 a → b 로 읽어 input["a.b"] 를 못 찾는다. 어떤 입력도 못
    // 덮는 축이 분모에 남는다. 못 만드는 축을 분모에 넣지 않는 기존 규칙과 같다.
    const result = fieldsOf({
      type: "object",
      required: ["a.b"],
      properties: { "a.b": { type: "string" } },
    });
    expect(result.axes.map((axis) => axis.kind)).toEqual(["HAPPY_PATH"]);
    expect(result.axes.some((axis) => axis.field === "a.b")).toBe(false);
    expect(result.unanalyzedFields).toEqual([{ path: "a.b", reason: "unreadablePath" }]);
  });

  it("'xs[0]' 처럼 대괄호가 든 이름도 빠진다", () => {
    const result = fieldsOf({ type: "object", properties: { "xs[0]": { type: "string" } } });
    expect(result.axes.map((axis) => axis.kind)).toEqual(["HAPPY_PATH"]);
    expect(result.unanalyzedFields).toEqual([{ path: "xs[0]", reason: "unreadablePath" }]);
  });

  it("중첩 이름에도 적용된다", () => {
    const result = fieldsOf({
      type: "object",
      properties: {
        user: { type: "object", required: ["a.b"], properties: { "a.b": { type: "string" } } },
      },
    });
    expect(result.axes.some((axis) => axis.field === "user.a.b")).toBe(false);
    expect(result.unanalyzedFields).toEqual([{ path: "user.a.b", reason: "unreadablePath" }]);
    // 부모는 읽을 수 있는 이름이라 그대로 축을 갖는다.
    expect(result.axes.map((axis) => axis.field)).toContain("user");
  });

  it("그 아래로 내려가지 않는다", () => {
    // 그 아래 경로도 같은 이유로 읽을 수 없다. 내려가면 못 덮는 축이 더 생긴다.
    const result = fieldsOf({
      type: "object",
      properties: {
        "a.b": { type: "object", properties: { inner: { type: "string" } } },
      },
    });
    expect(result.axes.some((axis) => axis.field?.startsWith("a.b"))).toBe(false);
    expect(result.unanalyzedFields).toEqual([{ path: "a.b", reason: "unreadablePath" }]);
  });

  it("pathCollision 과 다른 사유다", () => {
    // 충돌은 두 선언이 같은 경로를 가리켜 어느 쪽이 맞는지 모르는 것이고, unreadablePath 는
    // 선언이 하나인데 우리가 못 읽는 것이다. 사용자가 할 일이 다르다.
    const result = fieldsOf({
      type: "object",
      properties: {
        "user.name": { type: "string" },
        user: { type: "object", properties: { name: { type: "string" } } },
        "x[0]": { type: "string" },
      },
    });
    const byPath = new Map(result.unanalyzedFields.map((item) => [item.path, item.reason]));
    expect(byPath.get("user.name")).toBe("unreadablePath");
    expect(byPath.get("x[0]")).toBe("unreadablePath");
    // user 객체 쪽 name 은 남는다. 충돌할 짝이 사라졌기 때문이다.
    expect(result.axes.map((axis) => axis.field)).toContain("user.name");
  });

  it("평범한 이름은 영향이 없다", () => {
    const result = fieldsOf({
      type: "object",
      required: ["city"],
      properties: { city: { type: "string" }, user_id: { type: "integer", minimum: 1 } },
    });
    expect(result.unanalyzedFields).toEqual([]);
    expect(result.axes.map((axis) => `${axis.kind}:${axis.field ?? ""}`)).toEqual([
      "HAPPY_PATH:",
      "REQUIRED_OMITTED:city",
      "TYPE_VIOLATION:city",
      "TYPE_VIOLATION:user_id",
      "RANGE_VIOLATION:user_id",
    ]);
  });
});
