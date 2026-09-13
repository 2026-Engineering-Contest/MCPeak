import { readFileSync } from "node:fs";
import type { ToolDef } from "@mcpeak/core";
import type { ResponseSchema, TestCaseSpec } from "@mcpeak/runner";
import { matchCoveredAxes } from "@mcpeak/runner";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/canonical.js";
import type { JsonObject, JsonSchema } from "../src/schema.js";
import { synthesizeValue } from "../src/synthesize.js";
import { buildUpperBoundaryCases, buildViolationCases } from "../src/violation-cases.js";

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

/** 단일 필드 스키마 하나를 위반 케이스로 돌려 첫 케이스의 입력만 본다. */
function inputsFor(inputSchema: unknown, happyInput: JsonObject): readonly JsonObject[] {
  return buildViolationCases({ tool: tool("t", inputSchema), happyInput, baseName: "t" }).map(
    (item) => item.operation.input,
  );
}

describe("buildViolationCases", () => {
  it("get_weather 로 위반 케이스 2개가 나온다", () => {
    expect(
      buildViolationCases({
        tool: weather,
        happyInput: { city: "example" },
        baseName: "get-weather",
      }),
    ).toEqual([
      {
        id: "get-weather-missing-city",
        name: "get_weather가 필수 필드 'city' 누락을 거절한다",
        operation: { type: "callTool", tool: "get_weather", input: {} },
        assertions: [{ type: "isError", expected: true }],
      },
      {
        id: "get-weather-type-city",
        name: "get_weather가 'city' 타입 위반을 거절한다",
        operation: { type: "callTool", tool: "get_weather", input: { city: 0 } },
        assertions: [{ type: "isError", expected: true }],
      },
    ]);
  });

  it("add 로 위반 케이스 4개가 나온다", () => {
    const cases = buildViolationCases({ tool: add, happyInput: { a: 0, b: 0 }, baseName: "add" });
    expect(cases.map((item) => item.id)).toEqual([
      "add-missing-a",
      "add-missing-b",
      "add-type-a",
      "add-type-b",
    ]);
    expect(cases.map((item) => item.name)).toEqual([
      "add가 필수 필드 'a' 누락을 거절한다",
      "add가 필수 필드 'b' 누락을 거절한다",
      "add가 'a' 타입 위반을 거절한다",
      "add가 'b' 타입 위반을 거절한다",
    ]);
    expect(cases.map((item) => item.operation.input)).toEqual([
      { b: 0 },
      { a: 0 },
      { a: "example", b: 0 },
      { a: 0, b: "example" },
    ]);
  });

  it("REQUIRED_OMITTED 케이스의 입력에 나머지 필수 필드는 남아 있다", () => {
    const cases = buildViolationCases({ tool: add, happyInput: { a: 0, b: 0 }, baseName: "add" });
    expect(cases[0]?.operation.input).toEqual({ b: 0 });
    expect(cases[1]?.operation.input).toEqual({ a: 0 });
  });

  it("REQUIRED_OMITTED 필드가 정상 입력에 없으면 케이스를 만들지 않는다", () => {
    // required 에만 있고 properties 에 없는 필드다. 뺄 것이 없으므로 케이스가 없다.
    const cases = buildViolationCases({
      tool: tool("t", { type: "object", properties: {}, required: ["ghost"] }),
      happyInput: {},
      baseName: "t",
    });
    expect(cases).toEqual([]);
  });

  it("TYPE_VIOLATION string 필드에 0 이 들어간다", () => {
    expect(
      inputsFor({ type: "object", properties: { s: { type: "string" } } }, { s: "example" }),
    ).toEqual([{ s: 0 }]);
  });

  it("TYPE_VIOLATION number 필드에 example 이 들어간다", () => {
    expect(inputsFor({ type: "object", properties: { n: { type: "number" } } }, { n: 0 })).toEqual([
      { n: "example" },
    ]);
  });

  it("integer 필드의 타입 위반값은 1.5 다", () => {
    const cases = buildViolationCases({
      tool: tool("t", { type: "object", properties: { n: { type: "integer" } } }),
      happyInput: {},
      baseName: "t",
    });
    expect(cases).toEqual([
      {
        id: "t-type-n",
        name: "t가 'n' 타입 위반을 거절한다",
        operation: { type: "callTool", tool: "t", input: { n: 1.5 } },
        assertions: [{ type: "isError", expected: true }],
      },
    ]);
  });

  it("TYPE_VIOLATION boolean · object · array · null 필드에 example 이 들어간다", () => {
    expect(
      inputsFor(
        {
          type: "object",
          properties: {
            a: { type: "array" },
            b: { type: "boolean" },
            n: { type: "null" },
            o: { type: "object" },
          },
        },
        {},
      ),
    ).toEqual([{ a: "example" }, { b: "example" }, { n: "example" }, { o: "example" }]);
  });

  it("TYPE_VIOLATION 이 optional 필드면 정상 입력에 없던 키가 추가된다", () => {
    expect(
      inputsFor(
        { type: "object", properties: { opt: { type: "string" }, req: { type: "string" } } },
        { req: "example" },
      ),
    ).toEqual([
      // opt 는 정상 입력에 없던 키다. 위반값과 함께 새로 들어간다.
      { opt: 0, req: "example" },
      { req: 0 },
    ]);
  });

  it("문자열 enum 의 위반값은 __mcpeak_invalid_enum__ 이다", () => {
    const cases = buildViolationCases({
      tool: tool("t", { type: "object", properties: { u: { type: "string", enum: ["c", "f"] } } }),
      happyInput: { u: "c" },
      baseName: "t",
    });
    expect(cases.map((item) => [item.id, item.operation.input])).toEqual([
      ["t-type-u", { u: 0 }],
      ["t-enum-u", { u: "__mcpeak_invalid_enum__" }],
    ]);
    expect(cases[1]?.name).toBe("t가 'u' 의 선언되지 않은 값을 거절한다");
  });

  it("enum 에 예약 문자열이 있으면 접미사를 붙인다", () => {
    const cases = buildViolationCases({
      tool: tool("t", {
        type: "object",
        properties: { u: { type: "string", enum: ["__mcpeak_invalid_enum__"] } },
      }),
      happyInput: { u: "__mcpeak_invalid_enum__" },
      baseName: "t",
    });
    expect(cases[1]?.operation.input).toEqual({ u: "__mcpeak_invalid_enum___2" });
  });

  it("숫자 enum 의 위반값은 최댓값 + 1 이다", () => {
    const cases = buildViolationCases({
      tool: tool("t", { type: "object", properties: { n: { type: "number", enum: [1, 2] } } }),
      happyInput: { n: 1 },
      baseName: "t",
    });
    expect(cases[1]?.operation.input).toEqual({ n: 3 });
  });

  it("숫자 enum 의 최댓값이 안전 정수 경계면 문자열 규칙으로 넘어간다", () => {
    const cases = buildViolationCases({
      tool: tool("t", {
        type: "object",
        properties: { n: { type: "number", enum: [Number.MAX_SAFE_INTEGER] } },
      }),
      happyInput: { n: Number.MAX_SAFE_INTEGER },
      baseName: "t",
    });
    expect(cases[1]?.operation.input).toEqual({ n: "__mcpeak_invalid_enum__" });
  });

  it("type 과 enum 이 함께 있는 필드의 두 케이스 입력이 서로 다르다", () => {
    const cases = buildViolationCases({
      tool: tool("t", { type: "object", properties: { n: { type: "number", enum: [1, 2] } } }),
      happyInput: { n: 1 },
      baseName: "t",
    });
    expect(cases[0]?.operation.input).toEqual({ n: "example" });
    expect(cases[1]?.operation.input).toEqual({ n: 3 });
    expect(cases[0]?.operation.input).not.toEqual(cases[1]?.operation.input);
  });

  it("모든 위반 케이스의 단언이 isError true 하나다", () => {
    const cases = [
      ...buildViolationCases({ tool: weather, happyInput: { city: "example" }, baseName: "w" }),
      ...buildViolationCases({ tool: add, happyInput: { a: 0, b: 0 }, baseName: "add" }),
      ...buildViolationCases({
        tool: tool("t", { type: "object", properties: { u: { type: "string", enum: ["c"] } } }),
        happyInput: { u: "c" },
        baseName: "t",
      }),
    ];
    expect(cases.length).toBeGreaterThan(0);
    for (const item of cases)
      expect(item.assertions).toEqual([{ type: "isError", expected: true }]);
  });

  it("슬러그가 충돌하면 -2 가 붙는다", () => {
    const cases = buildViolationCases({
      tool: tool("t", {
        type: "object",
        properties: { "a-b": { type: "string" }, a_b: { type: "string" } },
      }),
      happyInput: {},
      baseName: "t",
    });
    expect(cases.map((item) => item.id)).toEqual(["t-type-a-b", "t-type-a-b-2"]);
    expect(cases.map((item) => item.operation.input)).toEqual([{ "a-b": 0 }, { a_b: 0 }]);
  });

  it("슬러그가 빈 문자열이 되는 필드 이름은 field-<hash> 로 대체된다", () => {
    const cases = buildViolationCases({
      tool: tool("t", { type: "object", properties: { 한국어: { type: "string" } } }),
      happyInput: {},
      baseName: "t",
    });
    expect(cases).toHaveLength(1);
    expect(cases[0]?.id).toMatch(/^t-type-field-[0-9a-f]{8}$/);
  });

  it("해석 불가 툴은 위반 케이스가 0개다", () => {
    expect(
      buildViolationCases({
        tool: tool("t", { anyOf: [{ type: "object" }] }),
        happyInput: {},
        baseName: "t",
      }),
    ).toEqual([]);
  });

  it("두 번 호출한 결과가 동일하다", () => {
    const once = buildViolationCases({ tool: add, happyInput: { a: 0, b: 0 }, baseName: "add" });
    const twice = buildViolationCases({ tool: add, happyInput: { a: 0, b: 0 }, baseName: "add" });
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });
});

describe("RANGE_VIOLATION 위반 케이스", () => {
  /** 범위 축 케이스 하나의 위반 필드 값만 본다. */
  const rangeValue = (v: Record<string, unknown>, happy: JsonObject): unknown => {
    const cases = buildViolationCases({
      tool: tool("t", { type: "object", required: ["v"], properties: { v } }),
      happyInput: happy,
      baseName: "t",
    }).filter((item) => item.id.includes("-range-"));
    return (cases[0]?.operation.input as JsonObject | undefined)?.v;
  };

  it.each([
    [{ type: "integer", minimum: 1 }, 0],
    [{ type: "integer", minimum: 0 }, -1],
    [{ type: "integer", minimum: -3 }, -4],
    [{ type: "integer", exclusiveMinimum: 0 }, 0],
    [{ type: "integer", maximum: 10 }, 11],
    [{ type: "integer", exclusiveMaximum: 100 }, 100],
    // 경계가 소수인 integer. 정상 경로가 올림한 값에서 출발하므로 위반도 그 한 칸 아래다.
    // 소수 값을 내면 type 까지 어겨 TYPE_VIOLATION 축을 덮고 범위 축이 영원히 미검증으로 남는다.
    [{ type: "integer", minimum: 1.2 }, 1],
    [{ type: "integer", exclusiveMinimum: 1.2 }, 1],
    [{ type: "integer", maximum: 1.8 }, 2],
    [{ type: "integer", exclusiveMaximum: 1.8 }, 2],
  ])("%j → 위반 값 %s", (schema, expected) => {
    expect(rangeValue(schema, { v: 1 })).toBe(expected);
  });

  it("소수 경계 integer 의 위반 케이스가 범위 축을 덮는다", () => {
    const declaration = tool("t", {
      type: "object",
      required: ["v"],
      properties: { v: { type: "integer", minimum: 1.2 } },
    });
    const rangeCase = buildViolationCases({
      tool: declaration,
      happyInput: { v: 2 },
      baseName: "t",
    }).find((item) => item.id === "t-range-lower-v");
    const covered = matchCoveredAxes({
      testCase: rangeCase as unknown as TestCaseSpec,
      tool: declaration,
    });
    expect(covered.map((axis) => axis.kind)).toContain("RANGE_VIOLATION");
  });

  it("minItems: 2 는 원소 1개다", () => {
    expect(
      rangeValue(
        { type: "array", items: { type: "string" }, minItems: 2 },
        {
          v: ["example", "example"],
        },
      ),
    ).toEqual(["example"]);
  });

  it("maxItems: 1 (하한 없음) 은 원소 2개다", () => {
    expect(
      rangeValue({ type: "array", items: { type: "string" }, maxItems: 1 }, { v: ["example"] }),
    ).toEqual(["example", "example"]);
  });

  it("minLength: 3 은 길이 2 문자열이다", () => {
    expect(String(rangeValue({ type: "string", minLength: 3 }, { v: "example" }))).toHaveLength(2);
  });

  it("maxLength: 3 (하한 없음) 은 길이 4 문자열이다", () => {
    expect(String(rangeValue({ type: "string", maxLength: 3 }, { v: "exa" }))).toHaveLength(4);
  });

  it("위반 값을 만들 수 없는 범위는 케이스가 없다", () => {
    expect(
      rangeValue({ type: "array", items: { type: "string" }, minItems: 0 }, { v: ["example"] }),
    ).toBeUndefined();
  });

  it("거절을 기대하는 케이스다", () => {
    const cases = buildViolationCases({
      tool: tool("t", {
        type: "object",
        required: ["v"],
        properties: { v: { type: "integer", minimum: 1 } },
      }),
      happyInput: { v: 1 },
      baseName: "t",
    }).filter((item) => item.id.includes("-range-"));
    expect(cases).toHaveLength(1);
    expect(cases[0]?.id).toBe("t-range-lower-v");
    expect(cases[0]?.name).toBe("t가 'v' 하한 미만 값을 거절한다");
    expect(cases[0]?.assertions).toContainEqual({ type: "isError", expected: true });
  });

  it("두 번 생성해도 같다", () => {
    const schema = { type: "integer", minimum: 1, maximum: 10 };
    expect(JSON.stringify(rangeValue(schema, { v: 1 }))).toBe(
      JSON.stringify(rangeValue(schema, { v: 1 })),
    );
  });
});

describe("$ref 가 든 배열의 위반 값", () => {
  it("items 가 $ref 인 배열의 범위 위반 값을 만든다", () => {
    const declaration = tool("t", {
      type: "object",
      required: ["v"],
      properties: { v: { type: "array", items: { $ref: "#/$defs/Inner" }, maxItems: 1 } },
      $defs: {
        Inner: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
      },
    });
    const cases = buildViolationCases({
      tool: declaration,
      happyInput: { v: [{ name: "example" }] },
      baseName: "t",
    }).filter((item) => item.id.includes("-range-"));

    expect((cases[0]?.operation.input as JsonObject | undefined)?.v).toEqual([
      { name: "example" },
      { name: "example" },
    ]);
  });
});

describe("선언 밖 필드 케이스 (#427)", () => {
  const strict = (properties: Record<string, unknown>) => ({
    type: "object",
    required: ["x"],
    properties,
    additionalProperties: false,
  });

  it("additionalProperties: false 면 선언 밖 키 케이스가 마지막에 하나 생긴다", () => {
    const cases = buildViolationCases({
      tool: tool("t", strict({ x: { type: "string" } })),
      happyInput: { x: "example" },
      baseName: "t",
    });

    const last = cases[cases.length - 1];
    expect(last?.id).toBe("t-undeclared");
    expect(last?.name).toBe("t가 선언되지 않은 필드 '__mcpeak_undeclared__' 를 거절한다");
    expect(last?.operation.input).toEqual({ x: "example", __mcpeak_undeclared__: "example" });
    expect(last?.assertions).toEqual([{ type: "isError", expected: true }]);
  });

  it("additionalProperties 가 없으면 그 케이스가 없다", () => {
    const cases = buildViolationCases({
      tool: tool("t", { type: "object", required: ["x"], properties: { x: { type: "string" } } }),
      happyInput: { x: "example" },
      baseName: "t",
    });
    expect(cases.some((item) => item.id === "t-undeclared")).toBe(false);
  });

  it("예약 키가 properties 에 이미 있으면 접미사를 붙인다", () => {
    const cases = buildViolationCases({
      tool: tool("t", strict({ x: { type: "string" }, __mcpeak_undeclared__: { type: "string" } })),
      happyInput: { x: "example" },
      baseName: "t",
    });

    const last = cases[cases.length - 1];
    expect(last?.operation.input).toEqual({
      x: "example",
      __mcpeak_undeclared___2: "example",
    });
  });
});

describe("범위 위반을 상한과 하한으로 나눠 만든다", () => {
  const counting = (properties: Record<string, unknown>): ToolDef =>
    tool("count_things", { type: "object", required: Object.keys(properties), properties });

  /** 범위 축 케이스만 골라 id 로 찾는다. */
  const rangeCases = (declaration: ToolDef, happyInput: JsonObject) =>
    buildViolationCases({ tool: declaration, happyInput, baseName: "c" }).filter((item) =>
      item.id.includes("-range-"),
    );
  const fieldValue = (
    cases: readonly ReturnType<typeof buildViolationCases>[number][],
    id: string,
    field: string,
  ): unknown =>
    (cases.find((item) => item.id === id)?.operation.input as JsonObject | undefined)?.[field];

  const bothBounds = counting({ n: { type: "integer", minimum: 1, maximum: 10 } });

  it("하한 미만과 상한 초과를 각각 만든다", () => {
    const cases = rangeCases(bothBounds, { n: 1 });
    expect(cases.map((item) => item.id)).toEqual(["c-range-lower-n", "c-range-upper-n"]);
    expect(fieldValue(cases, "c-range-lower-n", "n")).toBe(0);
    expect(fieldValue(cases, "c-range-upper-n", "n")).toBe(11);
    for (const item of cases)
      expect(item.assertions).toEqual([{ type: "isError", expected: true }]);
  });

  it("케이스 이름이 방향을 말한다", () => {
    const cases = rangeCases(bothBounds, { n: 1 });
    expect(cases.find((item) => item.id === "c-range-lower-n")?.name).toBe(
      "count_things가 'n' 하한 미만 값을 거절한다",
    );
    expect(cases.find((item) => item.id === "c-range-upper-n")?.name).toBe(
      "count_things가 'n' 상한 초과 값을 거절한다",
    );
  });

  it("minimum 만 있으면 하한 케이스만 만든다", () => {
    const cases = rangeCases(counting({ n: { type: "integer", minimum: 1 } }), { n: 1 });
    expect(cases.map((item) => item.id)).toEqual(["c-range-lower-n"]);
    expect(fieldValue(cases, "c-range-lower-n", "n")).toBe(0);
  });

  it("maximum 만 있으면 상한 케이스만 만든다", () => {
    const cases = rangeCases(counting({ n: { type: "integer", maximum: 10 } }), { n: 10 });
    expect(cases.map((item) => item.id)).toEqual(["c-range-upper-n"]);
    expect(fieldValue(cases, "c-range-upper-n", "n")).toBe(11);
  });

  it("exclusive 경계도 방향이 갈린다", () => {
    const declaration = counting({
      n: { type: "number", exclusiveMinimum: 1, exclusiveMaximum: 10 },
    });
    // 정상값을 손으로 적지 않는다. 합성 규칙이 바뀌면 이 테스트가 같이 움직여야 한다.
    const happyInput = synthesizeValue(
      declaration.inputSchema as JsonSchema,
      "inputSchema",
    ) as JsonObject;
    const cases = rangeCases(declaration, happyInput);
    expect(fieldValue(cases, "c-range-lower-n", "n")).toBe(1);
    expect(fieldValue(cases, "c-range-upper-n", "n")).toBe(10);
  });

  it("문자열 길이가 양쪽으로 갈린다", () => {
    const cases = rangeCases(counting({ s: { type: "string", minLength: 3, maxLength: 5 } }), {
      s: "exa",
    });
    expect(String(fieldValue(cases, "c-range-lower-s", "s"))).toHaveLength(2);
    expect(String(fieldValue(cases, "c-range-upper-s", "s"))).toHaveLength(6);
  });

  it("배열 길이가 양쪽으로 갈린다", () => {
    const cases = rangeCases(
      counting({ xs: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 3 } }),
      { xs: ["example", "example"] },
    );
    expect(fieldValue(cases, "c-range-lower-xs", "xs")).toHaveLength(1);
    expect(fieldValue(cases, "c-range-upper-xs", "xs")).toHaveLength(4);
  });

  it("정수 경계가 소수여도 자기 type 을 안 어긴다", () => {
    const cases = rangeCases(counting({ n: { type: "integer", minimum: 1.2, maximum: 8.7 } }), {
      n: 2,
    });
    const lower = fieldValue(cases, "c-range-lower-n", "n");
    const upper = fieldValue(cases, "c-range-upper-n", "n");
    expect(lower).toBe(1);
    expect(upper).toBe(9);
    expect(Number.isInteger(lower)).toBe(true);
    expect(Number.isInteger(upper)).toBe(true);
  });

  it("두 케이스가 runner 의 서로 다른 축을 덮는다", () => {
    const cases = rangeCases(bothBounds, { n: 1 });
    const boundsOf = (id: string) =>
      matchCoveredAxes({
        testCase: cases.find((item) => item.id === id) as unknown as TestCaseSpec,
        tool: bothBounds,
      }).map((axis) => axis.bound);
    expect(boundsOf("c-range-lower-n")).toEqual(["lower"]);
    expect(boundsOf("c-range-upper-n")).toEqual(["upper"]);
  });
});

describe("상한 경계 정상 케이스", () => {
  const boundary = (
    properties: Record<string, unknown>,
    happyInput: JsonObject,
    responseSchema: ResponseSchema | null = null,
  ) =>
    buildUpperBoundaryCases({
      tool: tool("count_things", {
        type: "object",
        required: Object.keys(properties),
        properties,
      }),
      happyInput,
      baseName: "c",
      responseSchema,
    });

  it("상·하한이 함께 있으면 상한 경계 정상 케이스를 만든다", () => {
    const cases = boundary({ n: { type: "integer", minimum: 1, maximum: 10 } }, { n: 1 });
    expect(cases).toHaveLength(1);
    expect(cases[0]?.id).toBe("c-bound-upper-n");
    expect(cases[0]?.name).toBe("count_things가 'n' 상한 경계값에 정상 응답한다");
    expect(cases[0]?.operation.input).toEqual({ n: 10 });
    expect(cases[0]?.assertions[0]).toEqual({ type: "isError", expected: false });
  });

  it("출력 계약이 지원되면 정상 케이스와 같은 단언을 붙인다", () => {
    const schema: ResponseSchema = { type: "object", required: ["ok"] };
    const withSchema = boundary(
      { n: { type: "integer", minimum: 1, maximum: 10 } },
      { n: 1 },
      schema,
    );
    expect(withSchema[0]?.assertions).toEqual([
      { type: "isError", expected: false },
      { type: "structuredContentMatchesSchema", schema },
    ]);
    const without = boundary({ n: { type: "integer", minimum: 1, maximum: 10 } }, { n: 1 });
    expect(without[0]?.assertions).toHaveLength(1);
  });

  it("상한만 있으면 만들지 않는다", () => {
    // 정상 케이스가 이미 10 을 밟고 있다. 같은 입력이 두 번 나가지 않는다.
    expect(boundary({ n: { type: "integer", maximum: 10 } }, { n: 10 })).toEqual([]);
  });

  it("exclusiveMaximum 만 있는 non-integer 는 만들지 않는다", () => {
    expect(boundary({ n: { type: "number", minimum: 1, exclusiveMaximum: 10 } }, { n: 1 })).toEqual(
      [],
    );
  });

  it("exclusiveMaximum 이어도 integer 면 만든다", () => {
    const cases = boundary({ n: { type: "integer", minimum: 1, exclusiveMaximum: 10 } }, { n: 1 });
    expect((cases[0]?.operation.input as JsonObject | undefined)?.n).toBe(9);
  });

  it("문자열·배열 경계값을 만든다", () => {
    const strings = boundary({ s: { type: "string", minLength: 3, maxLength: 5 } }, { s: "exa" });
    expect(String((strings[0]?.operation.input as JsonObject | undefined)?.s)).toHaveLength(5);
    const arrays = boundary(
      { xs: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 3 } },
      { xs: ["example", "example"] },
    );
    expect((arrays[0]?.operation.input as JsonObject | undefined)?.xs).toHaveLength(3);
  });

  it("정상 입력이 이미 상한 경계면 문자열도 만들지 않는다", () => {
    // minLength:3 · maxLength:5 는 synthesize 가 "example" 을 5자로 잘라 "examp" 를 낸다.
    // 그것이 곧 상한 경계값이라 정상 케이스가 이미 그 경계를 밟고 있다. 실제 렌더 경로에서
    // 이 필드의 bound-upper 케이스가 안 생기는 것이 옳다. === 가 아니라 canonicalJson 으로
    // 비교하므로 문자열에서도 걸린다.
    const inputSchema = {
      type: "object",
      required: ["s"],
      properties: { s: { type: "string", minLength: 3, maxLength: 5 } },
    };
    const happyInput = synthesizeValue(inputSchema as JsonSchema, "inputSchema") as JsonObject;
    expect(happyInput.s).toBe("examp");
    expect(boundary(inputSchema.properties, happyInput)).toEqual([]);
  });

  it("이 케이스는 새 축을 만들지 않는다", () => {
    const declaration = tool("count_things", {
      type: "object",
      required: ["n"],
      properties: { n: { type: "integer", minimum: 1, maximum: 10 } },
    });
    const cases = buildUpperBoundaryCases({
      tool: declaration,
      happyInput: { n: 1 },
      baseName: "c",
      responseSchema: null,
    });
    const covered = matchCoveredAxes({
      testCase: cases[0] as unknown as TestCaseSpec,
      tool: declaration,
    });
    expect(covered.map((axis) => axis.kind)).toEqual(["HAPPY_PATH"]);
  });
});

describe("생성 결과가 결정론적이다", () => {
  const declaration = tool("count_things", {
    type: "object",
    required: ["n", "s", "xs"],
    properties: {
      n: { type: "integer", minimum: 1, maximum: 10 },
      s: { type: "string", minLength: 3, maxLength: 5 },
      xs: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 3 },
    },
  });
  const happyInput: JsonObject = { n: 1, s: "exa", xs: ["example", "example"] };

  it("같은 도구로 두 번 만든 케이스 배열이 canonicalJson 기준으로 같다", () => {
    const build = () => [
      ...buildUpperBoundaryCases({
        tool: declaration,
        happyInput,
        baseName: "c",
        responseSchema: null,
      }),
      ...buildViolationCases({ tool: declaration, happyInput, baseName: "c" }),
    ];
    expect(canonicalJson(build())).toBe(canonicalJson(build()));
  });
});
