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
});
