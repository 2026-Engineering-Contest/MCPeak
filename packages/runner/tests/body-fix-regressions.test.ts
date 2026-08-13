import { describe, expect, it } from "vitest";
import {
  bodyExtractionFailedDiagnostic,
  bodySchemaMismatchDiagnostic,
  extractResponseBody,
  MAX_VALUE_STRING_CHARS,
  matchResponseSchema,
  type ResponseSchema,
  type RunnerRedactionOptions,
  type SchemaViolation,
  validateMcpSuite,
} from "../src/index.js";

const callToolSuite = (assertions: unknown) => ({
  schemaVersion: 1,
  id: "suite",
  name: "Suite",
  cases: [
    {
      id: "call",
      name: "호출",
      operation: { type: "callTool", tool: "weather", input: { city: "서울" } },
      assertions,
    },
  ],
});

const bodySuite = (schema: unknown) => callToolSuite([{ type: "bodyMatchesSchema", schema }]);

const first = (violation: SchemaViolation, options?: RunnerRedactionOptions) => {
  const entry = bodySchemaMismatchDiagnostic(
    { violations: [violation], totalViolations: 1 },
    options,
  ).violations?.[0];
  if (entry === undefined) throw new Error("위반 진단 하나를 기대했습니다.");
  return entry;
};

const resultOf = (content: unknown) => ({ content, isError: false, raw: null });

describe("결함 1: operation.type이 프로토타입 키여도 던지지 않는다", () => {
  it.each(["toString", "constructor", "valueOf", "hasOwnProperty"])(
    "operation.type이 %p여도 TypeError를 던지지 않고 이슈로 보고한다",
    (type) => {
      const suite = {
        schemaVersion: 1,
        id: "suite",
        name: "Suite",
        cases: [
          {
            id: "case",
            name: "케이스",
            operation: { type },
            assertions: [{ type: "isError", expected: false }],
          },
        ],
      };
      expect(() => validateMcpSuite(suite)).not.toThrow();
      const result = validateMcpSuite(suite);
      expect(result.valid).toBe(false);
      if (result.valid) throw new Error("유효하지 않은 명세를 기대했습니다.");
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: "INCOMPATIBLE_ASSERTION",
          path: "cases[0].assertions[0]",
        }),
      );
    },
  );
});

describe("결함 2: CONST와 ENUM은 차이를 보여준다", () => {
  it("객체 const 위반이 기대와 실제를 구분해 보여준다", () => {
    const message = first({
      code: "CONST_MISMATCH",
      path: "$",
      expected: { city: "서울", temp: 21 },
      actual: { city: "서울", temp: 22 },
    }).message;
    expect(message).toContain('{"city":"서울","temp":21}');
    expect(message).toContain('{"city":"서울","temp":22}');
  });

  it("배열 enum 위반이 후보와 실제를 구분해 보여준다", () => {
    const message = first({
      code: "ENUM_MISMATCH",
      path: "$.hourly",
      expected: [[1, 2], [3]],
      actual: [9],
    }).message;
    expect(message).toContain("[1,2] | [3]");
    expect(message).toContain("실제: [9]");
  });
});

describe("결함 3: 조상 키가 민감하면 값이 남지 않는다", () => {
  it("중첩 경로의 조상 키가 민감하면 REDACTED다", () => {
    expect(
      first({ code: "TYPE_MISMATCH", path: "$.token.value", expected: "number", actual: "sk-abc" })
        .actual,
    ).toBe("[REDACTED]");
  });

  it("배열 인덱스를 거친 경로도 조상 키를 본다", () => {
    expect(
      first(
        {
          code: "TYPE_MISMATCH",
          path: "$.credentials[0].id",
          expected: "number",
          actual: "sk-abc",
        },
        { sensitiveKeys: ["credentials"] },
      ).actual,
    ).toBe("[REDACTED]");
  });

  it("민감하지 않은 경로는 값을 그대로 둔다", () => {
    expect(
      first({ code: "TYPE_MISMATCH", path: "$.city.name", expected: "number", actual: "서울" })
        .actual,
    ).toBe("서울");
  });
});

describe("결함 4: 검사할 제약이 없는 스키마를 거부한다", () => {
  it("빈 스키마를 거부한다", () => {
    const result = validateMcpSuite(bodySuite({}));
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("유효하지 않은 명세를 기대했습니다.");
    expect(result.issues[0]?.code).toBe("INVALID_VALUE");
    expect(result.issues[0]?.path).toBe("cases[0].assertions[0].schema");
    expect(result.issues[0]?.message).toContain("검사할 제약이 없습니다");
  });

  it("properties가 비어 있으면 거부한다", () => {
    const result = validateMcpSuite(bodySuite({ type: "object", properties: {} }));
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("유효하지 않은 명세를 기대했습니다.");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "INVALID_VALUE",
        path: "cases[0].assertions[0].schema.properties",
      }),
    );
  });

  it("required가 비어 있으면 거부한다", () => {
    const result = validateMcpSuite(bodySuite({ type: "object", required: [] }));
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("유효하지 않은 명세를 기대했습니다.");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "INVALID_VALUE",
        path: "cases[0].assertions[0].schema.required",
      }),
    );
  });

  it("중첩된 빈 스키마도 거부한다", () => {
    const result = validateMcpSuite(bodySuite({ type: "object", properties: { temp: {} } }));
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("유효하지 않은 명세를 기대했습니다.");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "INVALID_VALUE",
        path: "cases[0].assertions[0].schema.properties.temp",
      }),
    );
  });

  it("제약이 하나라도 있으면 통과한다", () => {
    expect(validateMcpSuite(bodySuite({ type: "object" })).valid).toBe(true);
    expect(
      validateMcpSuite(bodySuite({ type: "object", properties: { temp: { type: "number" } } }))
        .valid,
    ).toBe(true);
  });
});

describe("결함 5: text 필드 문제를 전용 코드로 알린다", () => {
  it("text 필드가 없으면 CONTENT_TEXT_MISSING이다", () => {
    expect(extractResponseBody(resultOf([{ type: "text" }]))).toEqual({
      ok: false,
      failure: { code: "CONTENT_TEXT_MISSING", actual: "undefined" },
    });
  });

  it("text 필드가 문자열이 아니면 CONTENT_TEXT_MISSING이다", () => {
    expect(extractResponseBody(resultOf([{ type: "text", text: 42 }]))).toEqual({
      ok: false,
      failure: { code: "CONTENT_TEXT_MISSING", actual: "number" },
    });
  });

  it("CONTENT_TEXT_MISSING 문장이 text 필드를 가리킨다", () => {
    const diagnostic = bodyExtractionFailedDiagnostic({
      code: "CONTENT_TEXT_MISSING",
      actual: "number",
    });
    expect(diagnostic.code).toBe("BODY_EXTRACTION_FAILED");
    expect(diagnostic.message).toContain("text 필드");
    expect(diagnostic.message).toContain("실제 타입: number");
    expect(diagnostic.message).not.toContain("실제 type:");
  });
});

describe("결함 6: __proto__ 키를 잃지 않는다", () => {
  it("응답의 __proto__ 값이 요약에서 사라지지 않는다", () => {
    const body = JSON.parse('{"__proto__":"oops"}');
    const schema: ResponseSchema = { type: "object", additionalProperties: { type: "number" } };
    const violations = matchResponseSchema(schema, body).violations;
    expect(violations[0]?.path).toBe("$.__proto__");
    const entry = first(violations[0] as SchemaViolation);
    expect(entry.actual).toBe("oops");
    expect(entry.message).toContain("실제: string");
  });

  it("__proto__를 가진 객체의 키 개수를 제대로 센다", () => {
    const actual = JSON.parse('{"__proto__":"oops","a":1}');
    expect(first({ code: "TYPE_MISMATCH", path: "$", expected: "array", actual }).actual).toEqual({
      kind: "object",
      keys: 2,
    });
  });
});

describe("결함 7: 문자열 렌더가 이스케이프와 말줄임을 붙인다", () => {
  it("따옴표와 개행을 이스케이프한다", () => {
    const message = first({
      code: "CONST_MISMATCH",
      path: "$",
      expected: "정상",
      actual: '깨\n"짐"',
    }).message;
    expect(message).not.toContain("\n");
    expect(message).toContain('\\n\\"짐\\"');
  });

  it("잘린 문자열에 말줄임과 원본 길이를 붙인다", () => {
    const entry = first({
      code: "CONST_MISMATCH",
      path: "$",
      expected: "짧은 값",
      actual: "가".repeat(812),
    });
    expect(Array.from(entry.actual as string)).toHaveLength(MAX_VALUE_STRING_CHARS);
    expect(entry.actualChars).toBe(812);
    expect(entry.message).toContain("…(총 812자)");
  });
});
