import { describe, expect, it } from "vitest";
import type { JsonValue, ResponseSchema } from "../src/index.js";
import { matchResponseSchema } from "../src/index.js";

const match = (schema: ResponseSchema, body: JsonValue) => matchResponseSchema(schema, body);

describe("matchResponseSchema 키워드 판정", () => {
  it("type을 만족하면 위반이 없다", () => {
    expect(match({ type: "object" }, {})).toEqual({ violations: [], totalViolations: 0 });
  });

  it("type을 위반하면 TYPE_MISMATCH를 낸다", () => {
    const result = match({ type: "number" }, "21");
    expect(result.violations[0]).toMatchObject({
      code: "TYPE_MISMATCH",
      path: "$",
      expected: "number",
      actual: "21",
    });
  });

  it("const를 만족하면 위반이 없다", () => {
    expect(match({ const: "맑음" }, "맑음").violations).toEqual([]);
  });

  it("const를 위반하면 CONST_MISMATCH를 낸다", () => {
    expect(match({ const: "맑음" }, "흐림").violations[0]).toMatchObject({
      code: "CONST_MISMATCH",
      path: "$",
      expected: "맑음",
      actual: "흐림",
    });
  });

  it("enum을 만족하면 위반이 없다", () => {
    expect(match({ enum: ["맑음", "흐림"] }, "맑음").violations).toEqual([]);
  });

  it("enum을 위반하면 ENUM_MISMATCH를 낸다", () => {
    expect(match({ enum: ["맑음", "흐림"] }, "비").violations[0]).toMatchObject({
      code: "ENUM_MISMATCH",
      path: "$",
      expected: ["맑음", "흐림"],
      actual: "비",
    });
  });

  it("required를 만족하면 위반이 없다", () => {
    expect(match({ type: "object", required: ["temp"] }, { temp: 21 }).violations).toEqual([]);
  });

  it("required를 위반하면 REQUIRED_MISSING을 낸다", () => {
    expect(
      match({ type: "object", required: ["temp"] }, { temperature: 21 }).violations[0],
    ).toMatchObject({
      code: "REQUIRED_MISSING",
      path: "$",
      expected: "temp",
      actual: null,
      observedKeys: ["temperature"],
    });
  });

  it("properties를 만족하면 위반이 없다", () => {
    expect(
      match({ type: "object", properties: { temp: { type: "number" } } }, { temp: 21 }).violations,
    ).toEqual([]);
  });

  it("properties를 위반하면 TYPE_MISMATCH를 낸다", () => {
    expect(
      match({ type: "object", properties: { temp: { type: "number" } } }, { temp: "21" })
        .violations[0],
    ).toMatchObject({
      code: "TYPE_MISMATCH",
      path: "$.temp",
      expected: "number",
      actual: "21",
    });
  });

  it("additionalProperties를 만족하면 위반이 없다", () => {
    expect(
      match(
        { type: "object", properties: { temp: { type: "number" } }, additionalProperties: false },
        { temp: 21 },
      ).violations,
    ).toEqual([]);
  });

  it("additionalProperties를 위반하면 ADDITIONAL_PROPERTY를 낸다", () => {
    expect(
      match(
        { type: "object", properties: { temp: { type: "number" } }, additionalProperties: false },
        { temp: 21, city: "서울" },
      ).violations[0],
    ).toMatchObject({
      code: "ADDITIONAL_PROPERTY",
      path: "$.city",
      expected: null,
      actual: "서울",
    });
  });

  it("items를 만족하면 위반이 없다", () => {
    expect(match({ type: "array", items: { type: "number" } }, [1, 2]).violations).toEqual([]);
  });

  it("items를 위반하면 TYPE_MISMATCH를 낸다", () => {
    expect(
      match({ type: "array", items: { type: "number" } }, [1, "2"]).violations[0],
    ).toMatchObject({
      code: "TYPE_MISMATCH",
      path: "$[1]",
      expected: "number",
      actual: "2",
    });
  });

  it("minItems를 만족하면 위반이 없다", () => {
    expect(match({ type: "array", minItems: 2 }, [1, 2]).violations).toEqual([]);
  });

  it("minItems를 위반하면 MIN_ITEMS를 낸다", () => {
    expect(match({ type: "array", minItems: 2 }, [1]).violations[0]).toMatchObject({
      code: "MIN_ITEMS",
      path: "$",
      expected: 2,
      actual: 1,
    });
  });

  it("minLength를 만족하면 위반이 없다", () => {
    expect(match({ type: "string", minLength: 1 }, "맑음").violations).toEqual([]);
  });

  it("minLength를 위반하면 MIN_LENGTH를 낸다", () => {
    expect(match({ type: "string", minLength: 1 }, "").violations[0]).toMatchObject({
      code: "MIN_LENGTH",
      path: "$",
      expected: 1,
      actual: 0,
    });
  });

  it("maxLength를 만족하면 위반이 없다", () => {
    expect(match({ type: "string", maxLength: 2 }, "맑음").violations).toEqual([]);
  });

  it("maxLength를 위반하면 MAX_LENGTH를 낸다", () => {
    expect(match({ type: "string", maxLength: 2 }, "매우맑음").violations[0]).toMatchObject({
      code: "MAX_LENGTH",
      path: "$",
      expected: 2,
      actual: 4,
    });
  });

  it("stringContains를 만족하면 위반이 없다", () => {
    expect(match({ type: "string", stringContains: "맑" }, "맑음").violations).toEqual([]);
  });

  it("stringContains를 위반하면 STRING_CONTAINS를 낸다", () => {
    expect(match({ type: "string", stringContains: "맑" }, "흐림").violations[0]).toMatchObject({
      code: "STRING_CONTAINS",
      path: "$",
      expected: "맑",
      actual: "흐림",
    });
  });

  it("minimum을 만족하면 위반이 없다", () => {
    expect(match({ type: "number", minimum: 0 }, 21).violations).toEqual([]);
  });

  it("minimum을 위반하면 MINIMUM을 낸다", () => {
    expect(match({ type: "number", minimum: 0 }, -1).violations[0]).toMatchObject({
      code: "MINIMUM",
      path: "$",
      expected: 0,
      actual: -1,
    });
  });

  it("maximum을 만족하면 위반이 없다", () => {
    expect(match({ type: "number", maximum: 100 }, 21).violations).toEqual([]);
  });

  it("maximum을 위반하면 MAXIMUM을 낸다", () => {
    expect(match({ type: "number", maximum: 100 }, 101).violations[0]).toMatchObject({
      code: "MAXIMUM",
      path: "$",
      expected: 100,
      actual: 101,
    });
  });
});

describe("matchResponseSchema 평가 순서와 상한", () => {
  it("type 위반이면 같은 노드의 minimum을 평가하지 않는다", () => {
    const result = match({ type: "number", minimum: 0 }, "21");
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.code).toBe("TYPE_MISMATCH");
  });

  it("const 위반이면 하위 properties를 평가하지 않는다", () => {
    const result = match(
      { type: "object", const: { temp: 21 }, properties: { temp: { type: "number" } } },
      { temp: "21" },
    );
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.code).toBe("CONST_MISMATCH");
  });

  it("한 필드가 종료해도 형제 필드를 계속 평가한다", () => {
    const result = match(
      {
        type: "object",
        properties: {
          temp: { type: "number", minimum: 0 },
          condition: { type: "string" },
        },
      },
      { temp: "21", condition: 5 },
    );
    expect(result.violations).toHaveLength(2);
    expect(result.violations.map((violation) => violation.path)).toEqual(["$.temp", "$.condition"]);
  });

  it("required는 Object.hasOwn으로 판정한다", () => {
    expect(match({ type: "object", required: ["toString"] }, {}).violations[0]).toMatchObject({
      code: "REQUIRED_MISSING",
      path: "$",
      expected: "toString",
    });
  });

  it("required는 값이 null이어도 존재로 본다", () => {
    expect(match({ type: "object", required: ["temp"] }, { temp: null }).violations).toEqual([]);
  });

  it("observedKeys를 정렬해 담는다", () => {
    expect(
      match({ type: "object", required: ["temp"] }, { c: 1, b: 2, a: 3 }).violations[0]
        ?.observedKeys,
    ).toEqual(["a", "b", "c"]);
  });

  it("additionalProperties false 위반 키를 정렬해 보고한다", () => {
    const result = match({ type: "object", additionalProperties: false }, { c: 1, b: 2, a: 3 });
    expect(result.violations.map((violation) => violation.path)).toEqual(["$.a", "$.b", "$.c"]);
  });

  it("additionalProperties 스키마 순회 순서가 고정이다", () => {
    const schema: ResponseSchema = {
      type: "object",
      additionalProperties: { type: "number" },
    };
    expect(match(schema, { a: "x", b: "y" }).violations).toEqual(
      match(schema, { b: "y", a: "x" }).violations,
    );
  });

  it("응답 키 순서를 뒤집어도 위반 목록 바이트가 같다", () => {
    const schema: ResponseSchema = {
      type: "object",
      required: ["temp"],
      properties: { condition: { type: "string" }, humidity: { type: "number" } },
    };
    const forward = match(schema, { condition: 1, humidity: "x" });
    const reversed = match(schema, { humidity: "x", condition: 1 });
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
  });

  it("위반 25건이면 10건만 담고 총합은 25다", () => {
    const body = Array.from({ length: 25 }, (_, index) => `값${index}`);
    const result = match({ type: "array", items: { type: "number" } }, body);
    expect(result.violations).toHaveLength(10);
    expect(result.totalViolations).toBe(25);
  });

  it("깊이 1000 중첩에서 스택이 넘치지 않는다", () => {
    let schema: ResponseSchema = { type: "number" };
    let body: JsonValue = 21;
    for (let depth = 0; depth < 1000; depth++) {
      schema = { type: "object", properties: { next: schema } };
      body = { next: body };
    }
    expect(() => match(schema, body)).not.toThrow();
    expect(match(schema, body).violations).toEqual([]);
  });

  it("items가 모든 원소를 검사한다", () => {
    expect(match({ type: "array", items: { type: "number" } }, [1, "2", "3"]).totalViolations).toBe(
      2,
    );
  });

  it("문자열 본문에 stringContains를 적용한다", () => {
    expect(
      match({ type: "string", stringContains: "서울" }, "→ 사용 가능한 도시: 서울").violations,
    ).toEqual([]);
  });
});
