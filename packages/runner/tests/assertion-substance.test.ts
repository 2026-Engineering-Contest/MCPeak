import { describe, expect, it } from "vitest";
import type { ResponseSchema, TestSuiteSpec, ToolResultAssertionSpec } from "../src/index.js";
import { checkAssertionSubstance } from "../src/index.js";

/** 단언 목록 하나짜리 callTool 케이스로 스위트를 만든다. */
const suiteWith = (assertions: ToolResultAssertionSpec[]): TestSuiteSpec => ({
  schemaVersion: 1,
  id: "weather-suite",
  name: "날씨 서버",
  cases: [
    {
      id: "weather-ok",
      name: "정상 응답",
      operation: { type: "callTool", tool: "get_weather", input: { city: "Seoul" } },
      assertions,
    },
  ],
});

/** bodyMatchesSchema 단언 하나만 있는 스위트. */
const suiteWithSchema = (schema: ResponseSchema): TestSuiteSpec =>
  suiteWith([{ type: "bodyMatchesSchema", schema }]);

/** 깊이 depth의 properties 중첩 스키마. 맨 안쪽만 항상 참인 minLength: 0 이다. */
const deepProperties = (depth: number): ResponseSchema => {
  let schema: ResponseSchema = { type: "string", minLength: 0 };
  for (let index = 0; index < depth; index++) {
    schema = { type: "object", properties: { a: schema } };
  }
  return schema;
};

/** 깊이 depth의 items 중첩 스키마. 맨 안쪽만 항상 참인 minItems: 0 이다. */
const deepItems = (depth: number): ResponseSchema => {
  let schema: ResponseSchema = { type: "array", minItems: 0 };
  for (let index = 0; index < depth; index++) {
    schema = { type: "array", items: schema };
  }
  return schema;
};

/** 깊이 depth의 중첩에서 맨 안쪽 스키마가 갖는 path. */
const leafPath = (depth: number, segment: string): string =>
  `assertions[0].schema${`.${segment}`.repeat(depth)}`;

/** finding을 (code, path) 쌍으로 줄여 비교한다. */
const codesAndPaths = (suite: TestSuiteSpec): [string, string][] =>
  checkAssertionSubstance(suite).findings.map((finding) => [finding.code, finding.path]);

describe("checkAssertionSubstance (설계 문서 §5.7)", () => {
  it("제약이 없는 schema {} 는 finding 이 없다", () => {
    // 제약 없는 스키마 코드를 제거한 뒤의 사양이다. 이 스키마는 validateMcpSuite 가 이미 거부한다.
    expect(codesAndPaths(suiteWithSchema({}))).toEqual([]);
  });

  it('schema { type: "array" } 는 finding 0건', () => {
    expect(checkAssertionSubstance(suiteWithSchema({ type: "array" })).findings).toEqual([]);
  });

  it("schema { required: [] } 는 finding 이 없다", () => {
    expect(codesAndPaths(suiteWithSchema({ required: [] }))).toEqual([]);
  });

  it("schema { properties: {} } 는 finding 이 없다", () => {
    expect(codesAndPaths(suiteWithSchema({ properties: {} }))).toEqual([]);
  });

  it("schema { minLength: 0 } 은 type 없이도 VACUOUS_MIN_LENGTH", () => {
    // hasConstraint 게이트를 없앤 결과다. 검증을 안 거친 입력에서만 도달하며,
    // 그 경우에도 '이 단언은 아무것도 안 한다'가 참이므로 알리는 편이 맞다.
    expect(codesAndPaths(suiteWithSchema({ minLength: 0 }))).toEqual([
      ["VACUOUS_MIN_LENGTH", "assertions[0].schema.minLength"],
    ]);
  });

  it("type 이 있는 schema 의 minLength: 0 은 VACUOUS_MIN_LENGTH", () => {
    expect(codesAndPaths(suiteWithSchema({ type: "string", minLength: 0 }))).toEqual([
      ["VACUOUS_MIN_LENGTH", "assertions[0].schema.minLength"],
    ]);
  });

  it('schema { type: "array", minItems: 0 } 는 VACUOUS_MIN_ITEMS', () => {
    expect(codesAndPaths(suiteWithSchema({ type: "array", minItems: 0 }))).toEqual([
      ["VACUOUS_MIN_ITEMS", "assertions[0].schema.minItems"],
    ]);
  });

  it('schema { type: "array", minItems: 1 } 는 finding 0건', () => {
    expect(
      checkAssertionSubstance(suiteWithSchema({ type: "array", minItems: 1 })).findings,
    ).toEqual([]);
  });

  it("schema { additionalProperties: false } 는 finding 0건", () => {
    expect(
      checkAssertionSubstance(suiteWithSchema({ additionalProperties: false })).findings,
    ).toEqual([]);
  });

  it("중첩 properties 의 제약 없는 스키마도 finding 이 없다", () => {
    expect(codesAndPaths(suiteWithSchema({ type: "object", properties: { temp: {} } }))).toEqual(
      [],
    );
  });

  it("items 의 제약 없는 스키마도 finding 이 없다", () => {
    expect(codesAndPaths(suiteWithSchema({ type: "array", items: {} }))).toEqual([]);
  });

  it("중첩 properties 안의 VACUOUS_MIN_LENGTH 를 잡고 path 가 중첩 경로다", () => {
    // 중첩을 실제로 순회한다는 증거를 남긴다. 빈 스키마로는 더 이상 확인할 수 없다.
    expect(
      codesAndPaths(
        suiteWithSchema({
          type: "object",
          properties: { temp: { type: "string", minLength: 0 } },
        }),
      ),
    ).toEqual([["VACUOUS_MIN_LENGTH", "assertions[0].schema.properties.temp.minLength"]]);
  });

  it("items 안의 VACUOUS_MIN_ITEMS 도 잡는다", () => {
    expect(
      codesAndPaths(suiteWithSchema({ type: "array", items: { type: "array", minItems: 0 } })),
    ).toEqual([["VACUOUS_MIN_ITEMS", "assertions[0].schema.items.minItems"]]);
  });

  it("VACUOUS_MIN_LENGTH 가 VACUOUS_MIN_ITEMS 보다 앞에 온다", () => {
    const schema: ResponseSchema = {
      type: "object",
      properties: {
        b: { type: "array", minItems: 0 },
        a: { type: "string", minLength: 0 },
      },
    };
    expect(codesAndPaths(suiteWithSchema(schema))).toEqual([
      ["VACUOUS_MIN_LENGTH", "assertions[0].schema.properties.a.minLength"],
      ["VACUOUS_MIN_ITEMS", "assertions[0].schema.properties.b.minItems"],
    ]);
  });

  it("isError 단언만 있는 케이스는 finding 0건", () => {
    const result = checkAssertionSubstance(suiteWith([{ type: "isError", expected: false }]));
    expect(result.findings).toEqual([]);
    expect(result.totalFindings).toBe(0);
  });

  it("toolExists 단언만 있는 케이스는 finding 0건", () => {
    const suite: TestSuiteSpec = {
      schemaVersion: 1,
      id: "weather-suite",
      name: "날씨 서버",
      cases: [
        {
          id: "tools-listed",
          name: "툴 목록",
          operation: { type: "listTools" },
          assertions: [{ type: "toolExists", tool: "get_weather" }],
        },
      ],
    };
    expect(checkAssertionSubstance(suite).findings).toEqual([]);
  });

  it("깊이 20000 properties 중첩 스키마에서 예외가 없다", () => {
    const suite = suiteWithSchema(deepProperties(20_000));
    expect(() => checkAssertionSubstance(suite)).not.toThrow();
    // 맨 안쪽 스키마까지 실제로 순회했다는 증거다.
    expect(checkAssertionSubstance(suite).findings).toEqual([
      {
        code: "VACUOUS_MIN_LENGTH",
        severity: "advisory",
        caseId: "weather-ok",
        path: `${leafPath(20_000, "properties.a")}.minLength`,
      },
    ]);
  });

  it("깊이 10000 items 중첩 스키마에서 예외가 없다", () => {
    const suite = suiteWithSchema(deepItems(10_000));
    expect(() => checkAssertionSubstance(suite)).not.toThrow();
    expect(checkAssertionSubstance(suite).findings).toEqual([
      {
        code: "VACUOUS_MIN_ITEMS",
        severity: "advisory",
        caseId: "weather-ok",
        path: `${leafPath(10_000, "items")}.minItems`,
      },
    ]);
  });

  it('모든 finding 의 severity 가 "advisory"', () => {
    const suite = suiteWithSchema({
      type: "object",
      minLength: 0,
      minItems: 0,
      properties: { temp: {}, unit: { type: "string", minLength: 0 } },
    });
    const { findings } = checkAssertionSubstance(suite);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.severity === "advisory")).toBe(true);
  });
});
