import { describe, expect, it } from "vitest";
import { MCP_SUITE_JSON_SCHEMA, type ReadonlyJsonObject, validateMcpSuite } from "../src/index.js";
import { evaluateSchema } from "./helpers/schema-evaluator.js";

const valid = {
  schemaVersion: 1,
  id: "suite",
  name: "Suite",
  cases: [
    {
      id: "case",
      name: "Case",
      operation: { type: "callTool", tool: "x", input: { values: [null, true, 1, "x"] } },
      assertions: [{ type: "isError", expected: false }],
    },
  ],
};
const invalid = { ...valid, cases: [{ ...valid.cases[0], assertions: [] }] };

/** bodyMatchesSchema 단언 하나만 담은 callTool 스위트를 만든다. */
const bodyFixture = (schema: unknown) => ({
  schemaVersion: 1,
  id: "suite",
  name: "Suite",
  cases: [
    {
      id: "case",
      name: "Case",
      operation: { type: "callTool", tool: "weather", input: { city: "서울" } },
      assertions: [{ type: "bodyMatchesSchema", schema }],
    },
  ],
});

describe("MCP_SUITE_JSON_SCHEMA", () => {
  it("공개 JSON Schema와 validator의 fixture 판정이 일치한다", () => {
    for (const fixture of [
      valid,
      invalid,
      { ...valid, name: " " },
      { ...valid, defaultTimeoutMs: 2_147_483_648 },
      { ...valid, defaultTimeoutMs: 10_000 },
      { ...valid, defaultTimeoutMs: 2_147_483_647 },
    ]) {
      expect(evaluateSchema(MCP_SUITE_JSON_SCHEMA, fixture).valid).toBe(
        validateMcpSuite(fixture).valid,
      );
    }
  });
  it("계약 키와 중첩 객체를 재귀적으로 동결한다", () => {
    expect(MCP_SUITE_JSON_SCHEMA.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(Object.isFrozen(MCP_SUITE_JSON_SCHEMA)).toBe(true);
    expect(Object.isFrozen(MCP_SUITE_JSON_SCHEMA.$defs as object)).toBe(true);
    expect(Object.isFrozen((MCP_SUITE_JSON_SCHEMA.$defs as ReadonlyJsonObject).jsonValue)).toBe(
      true,
    );
    expect(
      Object.isFrozen(
        ((MCP_SUITE_JSON_SCHEMA.$defs as ReadonlyJsonObject).jsonValue as ReadonlyJsonObject)
          .oneOf as readonly unknown[],
      ),
    ).toBe(true);
  });
  it("깨진 local ref와 oneOf 0개 또는 2개 match를 evaluator 오류로 보고한다", () => {
    const broken = structuredClone(MCP_SUITE_JSON_SCHEMA) as unknown as {
      properties: Record<string, unknown>;
      $defs: Record<string, unknown>;
    };
    const firstBranch = (broken.properties.cases as { items: { oneOf: Array<{ $ref: string }> } })
      .items.oneOf[0];
    if (firstBranch === undefined) throw new Error("expected listTools branch");
    firstBranch.$ref = "#/$defs/missingCase";
    expect(evaluateSchema(broken as unknown as ReadonlyJsonObject, valid).errors).toContainEqual(
      expect.objectContaining({ code: "UNRESOLVED_REF" }),
    );
    const zero = { oneOf: [{ const: 1 }, { const: 2 }] } as unknown as ReadonlyJsonObject;
    const two = { oneOf: [{ type: "number" }, { minimum: 0 }] } as unknown as ReadonlyJsonObject;
    expect(evaluateSchema(zero, 3).errors).toContainEqual(
      expect.objectContaining({ code: "ONE_OF_MATCH_COUNT" }),
    );
    expect(evaluateSchema(two, 1).errors).toContainEqual(
      expect.objectContaining({ code: "ONE_OF_MATCH_COUNT" }),
    );
  });

  it("앞선 형제 오류가 이후 oneOf 분기 판정을 오염시키지 않는다", () => {
    const schema = {
      type: "object",
      properties: {
        bad: { const: "expected" },
        variant: { oneOf: [{ const: "match" }, { const: "other" }] },
      },
    } as unknown as ReadonlyJsonObject;

    const result = evaluateSchema(schema, { bad: "actual", variant: "match" });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "INSTANCE_MISMATCH" }));
    expect(result.errors).not.toContainEqual(
      expect.objectContaining({ code: "ONE_OF_MATCH_COUNT" }),
    );
  });

  it("bodyMatchesSchema valid fixture가 두 계약에서 같은 판정을 낸다", () => {
    const fixture = bodyFixture({
      type: "object",
      required: ["temp"],
      properties: { temp: { type: "number", minimum: -100, maximum: 100 } },
    });
    expect(validateMcpSuite(fixture).valid).toBe(true);
    expect(evaluateSchema(MCP_SUITE_JSON_SCHEMA, fixture).valid).toBe(true);
  });

  it("알 수 없는 키워드 fixture가 두 계약에서 같은 판정을 낸다", () => {
    const fixture = bodyFixture({ type: "number", multipleOf: 2 });
    expect(validateMcpSuite(fixture).valid).toBe(false);
    expect(evaluateSchema(MCP_SUITE_JSON_SCHEMA, fixture).valid).toBe(false);
  });

  it("listTools에 bodyMatchesSchema를 넣은 fixture가 두 계약에서 같은 판정을 낸다", () => {
    const fixture = {
      schemaVersion: 1,
      id: "suite",
      name: "Suite",
      cases: [
        {
          id: "case",
          name: "Case",
          operation: { type: "listTools" },
          assertions: [{ type: "bodyMatchesSchema", schema: { type: "object" } }],
        },
      ],
    };
    expect(validateMcpSuite(fixture).valid).toBe(false);
    expect(evaluateSchema(MCP_SUITE_JSON_SCHEMA, fixture).valid).toBe(false);
  });

  it("재귀 responseSchema를 evaluator가 해석한다", () => {
    const fixture = bodyFixture({
      type: "object",
      properties: {
        forecast: {
          type: "object",
          properties: { days: { type: "array", items: { type: "string", minLength: 1 } } },
        },
      },
    });
    expect(evaluateSchema(MCP_SUITE_JSON_SCHEMA, fixture).valid).toBe(true);
  });

  it("안전 정수 상한을 두 계약이 같이 본다", () => {
    // 런타임 검증은 Number.isSafeInteger를 쓴다. 공개 스키마에 maximum이 없으면
    // 2^53이 공개 스키마만 통과해 두 계약이 갈린다.
    const beyond = bodyFixture({ type: "array", minItems: 2 ** 53 });
    expect(validateMcpSuite(beyond).valid).toBe(false);
    expect(evaluateSchema(MCP_SUITE_JSON_SCHEMA, beyond).valid).toBe(false);

    const boundary = bodyFixture({ type: "array", minItems: Number.MAX_SAFE_INTEGER });
    expect(validateMcpSuite(boundary).valid).toBe(true);
    expect(evaluateSchema(MCP_SUITE_JSON_SCHEMA, boundary).valid).toBe(true);
  });

  it("타입 짝 요구는 대조 대상이 아니다", () => {
    // 설계 문서 §10.5: 키워드와 type의 짝 요구는 if/then이 필요해 공개 JSON Schema에
    // 표현하지 않는다. validator만 잡고 evaluator는 통과시키는 의도적 불일치다.
    const fixture = bodyFixture({ minimum: 0 });
    expect(validateMcpSuite(fixture).valid).toBe(false);
    expect(evaluateSchema(MCP_SUITE_JSON_SCHEMA, fixture).valid).toBe(true);
  });
});
