import { describe, expect, it } from "vitest";
import { matchResponseSchema, type ResponseSchema, validateMcpSuite } from "../src/index.js";

/** 깊이 depth의 서로 다른 중첩 배열을 만든다. 잎의 값이 leaf라 두 구조가 절대 같지 않다. */
const deepArray = (depth: number, leaf: number): unknown => {
  let value: unknown = leaf;
  for (let index = 0; index < depth; index++) value = [value];
  return value;
};

/** 깊이 depth의 서로 다른 중첩 객체를 만든다. */
const deepObject = (depth: number, leaf: number): unknown => {
  let value: unknown = leaf;
  for (let index = 0; index < depth; index++) value = { next: value };
  return value;
};

const bodySuite = (schema: unknown) => ({
  schemaVersion: 1,
  id: "suite",
  name: "Suite",
  cases: [
    {
      id: "call",
      name: "호출",
      operation: { type: "callTool", tool: "weather", input: { city: "서울" } },
      assertions: [{ type: "bodyMatchesSchema", schema }],
    },
  ],
});

describe("결함 1: 깊은 const와 enum 비교가 스택을 넘기지 않는다", () => {
  it("깊이 10000 배열 const 비교에서 예외가 없다", () => {
    const schema = { type: "array", const: deepArray(10_000, 1) } as unknown as ResponseSchema;
    const body = deepArray(10_000, 2) as never;
    expect(() => matchResponseSchema(schema, body)).not.toThrow();
    expect(matchResponseSchema(schema, body).violations[0]?.code).toBe("CONST_MISMATCH");
  });

  it("깊이 20000 객체 const 비교에서 예외가 없다", () => {
    const schema = { type: "object", const: deepObject(20_000, 1) } as unknown as ResponseSchema;
    const body = deepObject(20_000, 2) as never;
    expect(() => matchResponseSchema(schema, body)).not.toThrow();
    expect(matchResponseSchema(schema, body).violations[0]?.code).toBe("CONST_MISMATCH");
  });

  it("깊이 10000 enum 비교에서 예외가 없다", () => {
    const schema = {
      type: "array",
      enum: [deepArray(10_000, 1)],
    } as unknown as ResponseSchema;
    const body = deepArray(10_000, 2) as never;
    expect(() => matchResponseSchema(schema, body)).not.toThrow();
    expect(matchResponseSchema(schema, body).violations[0]?.code).toBe("ENUM_MISMATCH");
  });

  it("깊이 10000 구조가 서로 같으면 위반이 없다", () => {
    const schema = { type: "array", const: deepArray(10_000, 7) } as unknown as ResponseSchema;
    const body = deepArray(10_000, 7) as never;
    expect(matchResponseSchema(schema, body).violations).toEqual([]);
  });

  it("깊은 비교의 단락 동작을 유지한다", () => {
    const schema = { type: "array", const: [1, 2, 3] } as unknown as ResponseSchema;
    expect(matchResponseSchema(schema, [1, 2] as never).violations[0]?.code).toBe("CONST_MISMATCH");
    const keys = { type: "object", const: { a: 1, b: 2 } } as unknown as ResponseSchema;
    expect(matchResponseSchema(keys, { a: 1, c: 2 } as never).violations[0]?.code).toBe(
      "CONST_MISMATCH",
    );
    expect(matchResponseSchema(keys, { b: 2, a: 1 } as never).violations).toEqual([]);
  });
});

describe("결함 2: 순환 스키마를 거부한다", () => {
  it("자기 자신을 가리키는 properties를 거부한다", () => {
    const schema: Record<string, unknown> = { type: "object", properties: {} };
    (schema.properties as Record<string, unknown>).self = schema;

    expect(() => validateMcpSuite(bodySuite(schema))).not.toThrow();
    const result = validateMcpSuite(bodySuite(schema));
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("유효하지 않은 명세를 기대했습니다.");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "INVALID_JSON_VALUE",
        path: "cases[0].assertions[0].schema.properties.self",
      }),
    );
  });

  it("items와 additionalProperties의 순환도 거부한다", () => {
    for (const key of ["items", "additionalProperties"] as const) {
      const schema: Record<string, unknown> = { type: key === "items" ? "array" : "object" };
      schema[key] = schema;
      const result = validateMcpSuite(bodySuite(schema));
      expect(result.valid).toBe(false);
      if (result.valid) throw new Error("유효하지 않은 명세를 기대했습니다.");
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: "INVALID_JSON_VALUE",
          path: `cases[0].assertions[0].schema.${key}`,
        }),
      );
    }
  });

  it("같은 하위 스키마를 여러 자리에 공유하는 것은 순환이 아니다", () => {
    const shared = { type: "number", minimum: 0 };
    expect(
      validateMcpSuite(bodySuite({ type: "object", properties: { a: shared, b: shared } })).valid,
    ).toBe(true);
  });
});
