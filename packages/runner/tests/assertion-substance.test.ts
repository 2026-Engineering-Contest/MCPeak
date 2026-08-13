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

/** 깊이 depth의 properties 중첩 스키마. 맨 안쪽만 빈 스키마다. */
const deepProperties = (depth: number): ResponseSchema => {
  let schema: ResponseSchema = {};
  for (let index = 0; index < depth; index++) {
    schema = { type: "object", properties: { a: schema } };
  }
  return schema;
};

/** 깊이 depth의 items 중첩 스키마. 맨 안쪽만 빈 스키마다. */
const deepItems = (depth: number): ResponseSchema => {
  let schema: ResponseSchema = {};
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
  it("schema {} 는 UNCONSTRAINED_SCHEMA", () => {
    expect(codesAndPaths(suiteWithSchema({}))).toEqual([
      ["UNCONSTRAINED_SCHEMA", "assertions[0].schema"],
    ]);
  });

  it('schema { type: "array" } 는 finding 0건', () => {
    expect(checkAssertionSubstance(suiteWithSchema({ type: "array" })).findings).toEqual([]);
  });

  it("schema { required: [] } 는 UNCONSTRAINED_SCHEMA", () => {
    expect(codesAndPaths(suiteWithSchema({ required: [] }))).toEqual([
      ["UNCONSTRAINED_SCHEMA", "assertions[0].schema"],
    ]);
  });

  it("schema { properties: {} } 는 UNCONSTRAINED_SCHEMA", () => {
    expect(codesAndPaths(suiteWithSchema({ properties: {} }))).toEqual([
      ["UNCONSTRAINED_SCHEMA", "assertions[0].schema"],
    ]);
  });

  it("schema { minLength: 0 } 는 UNCONSTRAINED_SCHEMA 만, VACUOUS_MIN_LENGTH 는 안 난다", () => {
    expect(codesAndPaths(suiteWithSchema({ minLength: 0 }))).toEqual([
      ["UNCONSTRAINED_SCHEMA", "assertions[0].schema"],
    ]);
  });

  it('schema { type: "string", minLength: 0 } 는 VACUOUS_MIN_LENGTH 만 난다', () => {
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

  it("중첩 properties 안의 빈 스키마도 잡고 path 가 assertions[0].schema.properties.temp 다", () => {
    expect(codesAndPaths(suiteWithSchema({ type: "object", properties: { temp: {} } }))).toEqual([
      ["UNCONSTRAINED_SCHEMA", "assertions[0].schema.properties.temp"],
    ]);
  });

  it("items 안의 빈 스키마도 잡는다", () => {
    expect(codesAndPaths(suiteWithSchema({ type: "array", items: {} }))).toEqual([
      ["UNCONSTRAINED_SCHEMA", "assertions[0].schema.items"],
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
    // 맨 안쪽 빈 스키마까지 실제로 순회했다는 증거다.
    expect(checkAssertionSubstance(suite).findings).toEqual([
      {
        code: "UNCONSTRAINED_SCHEMA",
        severity: "advisory",
        caseId: "weather-ok",
        path: leafPath(20_000, "properties.a"),
      },
    ]);
  });

  it("깊이 10000 items 중첩 스키마에서 예외가 없다", () => {
    const suite = suiteWithSchema(deepItems(10_000));
    expect(() => checkAssertionSubstance(suite)).not.toThrow();
    expect(checkAssertionSubstance(suite).findings).toEqual([
      {
        code: "UNCONSTRAINED_SCHEMA",
        severity: "advisory",
        caseId: "weather-ok",
        path: leafPath(10_000, "items"),
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
