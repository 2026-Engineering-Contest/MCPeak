import { describe, expect, it } from "vitest";
import {
  defineMcpSuite,
  SuiteValidationError,
  type TestSuiteSpec,
  validateMcpSuite,
} from "../src/index.js";

const validSuite = {
  schemaVersion: 1,
  id: "weather-server",
  name: "날씨 MCP 서버",
  defaultTimeoutMs: 10_000,
  cases: [
    {
      id: "tools",
      name: "툴",
      operation: { type: "listTools" },
      assertions: [{ type: "toolExists", tool: "weather" }],
    },
    {
      id: "call",
      name: "호출",
      timeoutMs: 30_000,
      operation: { type: "callTool", tool: "weather", input: { city: "서울" } },
      assertions: [{ type: "isError", expected: false }],
    },
  ],
} as const;

describe("MCP suite validation", () => {
  it("유효한 listTools와 callTool 명세를 검증한다", () => {
    expect(validateMcpSuite(validSuite)).toEqual({ valid: true, value: validSuite });
  });

  it("명세의 구조 오류를 결정된 순서로 모두 반환한다", () => {
    const result = validateMcpSuite({
      schemaVersion: 2,
      id: "suite",
      name: "suite",
      extra: true,
      defaultTimeoutMs: 0,
      cases: [
        {
          id: "duplicate",
          name: "first",
          operation: { type: "listTools" },
          assertions: [{ type: "isError", expected: false }],
        },
        {
          id: "duplicate",
          name: "second",
          operation: { type: "callTool", input: {} },
          assertions: [],
        },
      ],
    });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unexpected valid suite");
    expect(result.issues.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: "UNSUPPORTED_SCHEMA_VERSION", path: "schemaVersion" },
      { code: "INVALID_TIMEOUT", path: "defaultTimeoutMs" },
      { code: "UNKNOWN_FIELD", path: "extra" },
      { code: "INCOMPATIBLE_ASSERTION", path: "cases[0].assertions[0]" },
      { code: "DUPLICATE_CASE_ID", path: "cases[1].id" },
      { code: "MISSING_REQUIRED_FIELD", path: "cases[1].operation.tool" },
      { code: "EMPTY_ASSERTIONS", path: "cases[1].assertions" },
    ]);
  });

  it("필수 필드와 공백뿐인 식별자와 이름을 거절한다", () => {
    const absent = validateMcpSuite({});
    expect(absent).toMatchObject({
      valid: false,
      issues: [
        { code: "MISSING_REQUIRED_FIELD", path: "schemaVersion" },
        { code: "MISSING_REQUIRED_FIELD", path: "id" },
        { code: "MISSING_REQUIRED_FIELD", path: "name" },
        { code: "MISSING_REQUIRED_FIELD", path: "cases" },
      ],
    });
    const blank = validateMcpSuite({
      ...validSuite,
      id: " ",
      name: "\t",
      cases: [{ ...validSuite.cases[0], id: " ", name: "\n" }],
    });
    expect(blank).toMatchObject({
      valid: false,
      issues: [
        { code: "INVALID_VALUE", path: "id" },
        { code: "INVALID_VALUE", path: "name" },
        { code: "INVALID_VALUE", path: "cases[0].id" },
        { code: "INVALID_VALUE", path: "cases[0].name" },
      ],
    });
  });

  it("중첩 unknown field와 assertion 조합을 거절한다", () => {
    const result = validateMcpSuite({
      ...validSuite,
      cases: [{ ...validSuite.cases[0], operation: { type: "listTools", toolNmae: "x" } }],
    });
    expect(result).toMatchObject({
      valid: false,
      issues: [{ code: "UNKNOWN_FIELD", path: "cases[0].operation.toolNmae" }],
    });
  });

  it("operation type 누락은 근본 원인 하나만 보고한다", () => {
    const result = validateMcpSuite({
      ...validSuite,
      cases: [
        {
          id: "missing-operation-type",
          name: "operation type 누락",
          operation: { tool: "weather", input: {} },
          assertions: [{ type: "isError", expected: false }],
        },
      ],
    });

    expect(result).toMatchObject({
      valid: false,
      issues: [{ code: "MISSING_REQUIRED_FIELD", path: "cases[0].operation.type" }],
    });
  });

  it("operation type이 없어도 assertion 자체의 구조는 검증한다", () => {
    const result = validateMcpSuite({
      ...validSuite,
      cases: [
        {
          id: "missing-operation-and-assertion-type",
          name: "operation과 assertion type 누락",
          operation: {},
          assertions: [{}, { type: "isError", expected: "false" }],
        },
      ],
    });

    expect(result).toMatchObject({
      valid: false,
      issues: [
        { code: "MISSING_REQUIRED_FIELD", path: "cases[0].operation.type" },
        { code: "MISSING_REQUIRED_FIELD", path: "cases[0].assertions[0].type" },
        { code: "INVALID_TYPE", path: "cases[0].assertions[1].expected" },
      ],
    });
  });

  it.each([0, -1, 1.5, 2_147_483_648])(
    "timeout %p을 거절하고 최대 양 경계는 허용한다",
    (timeoutMs) => {
      expect(validateMcpSuite({ ...validSuite, defaultTimeoutMs: timeoutMs }).valid).toBe(false);
      expect(validateMcpSuite({ ...validSuite, defaultTimeoutMs: 2_147_483_647 }).valid).toBe(true);
    },
  );

  it.each([NaN, Infinity, -Infinity])("유한하지 않은 JSON 숫자 %p를 거절한다", (number) => {
    const result = validateMcpSuite({
      ...validSuite,
      cases: [
        {
          ...validSuite.cases[1],
          operation: { type: "callTool", tool: "weather", input: { number } },
        },
      ],
    });
    expect(result).toMatchObject({
      valid: false,
      issues: [{ code: "INVALID_JSON_VALUE", path: "cases[0].operation.input.number" }],
    });
  });

  it("null-prototype과 공유 JSON 객체를 허용하고 class와 cycle을 거절한다", () => {
    const nullObject = Object.assign(Object.create(null), { city: "서울" });
    expect(
      validateMcpSuite({
        ...validSuite,
        cases: [
          {
            ...validSuite.cases[1],
            operation: { type: "callTool", tool: "weather", input: nullObject },
          },
        ],
      }).valid,
    ).toBe(true);
    const shared = { city: "서울" };
    expect(
      validateMcpSuite({
        ...validSuite,
        cases: [
          {
            ...validSuite.cases[1],
            operation: { type: "callTool", tool: "weather", input: { a: shared, b: shared } },
          },
        ],
      }).valid,
    ).toBe(true);
    class Input {
      city = "서울";
    }
    expect(
      validateMcpSuite({
        ...validSuite,
        cases: [
          {
            ...validSuite.cases[1],
            operation: { type: "callTool", tool: "weather", input: new Input() },
          },
        ],
      }),
    ).toMatchObject({
      valid: false,
      issues: [{ code: "INVALID_JSON_VALUE", path: "cases[0].operation.input" }],
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(
      validateMcpSuite({
        ...validSuite,
        cases: [
          {
            ...validSuite.cases[1],
            operation: { type: "callTool", tool: "weather", input: circular },
          },
        ],
      }),
    ).toMatchObject({
      valid: false,
      issues: [{ code: "INVALID_JSON_VALUE", path: "cases[0].operation.input.self" }],
    });
  });

  it("깊게 중첩된 JSON 입력도 예외 없이 검증한다", () => {
    let input: Record<string, unknown> = { end: true };
    for (let depth = 0; depth < 10_000; depth++) input = { next: input };

    expect(() =>
      validateMcpSuite({
        ...validSuite,
        cases: [
          {
            ...validSuite.cases[1],
            operation: { type: "callTool", tool: "weather", input },
          },
        ],
      }),
    ).not.toThrow();
    expect(
      validateMcpSuite({
        ...validSuite,
        cases: [
          {
            ...validSuite.cases[1],
            operation: { type: "callTool", tool: "weather", input },
          },
        ],
      }).valid,
    ).toBe(true);
  });

  it("기존 isError 전용 스위트가 그대로 통과한다", () => {
    expect(validateMcpSuite(validSuite).valid).toBe(true);
  });

  it("defineMcpSuite는 identity를 보존하고 구조화된 오류를 던진다", () => {
    const definedInput: TestSuiteSpec = {
      schemaVersion: 1,
      id: "suite",
      name: "Suite",
      cases: [
        {
          id: "case",
          name: "Case",
          operation: { type: "listTools" },
          assertions: [{ type: "toolExists", tool: "x" }],
        },
      ],
    };
    const defined = defineMcpSuite(definedInput);
    expect(defined).toBe(definedInput);
    try {
      defineMcpSuite({ ...definedInput, cases: [] } as TestSuiteSpec);
    } catch (error) {
      expect(error).toBeInstanceOf(SuiteValidationError);
      expect((error as SuiteValidationError).issues).toHaveLength(1);
      return;
    }
    throw new Error("expected SuiteValidationError");
  });
});

/** callTool 케이스 하나짜리 스위트를 만든다. 단언 배열만 바꿔가며 검증한다. */
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

/** bodyMatchesSchema 단언 하나만 담은 스위트를 만든다. */
const bodySuite = (schema: unknown) => callToolSuite([{ type: "bodyMatchesSchema", schema }]);

const issuesOf = (input: unknown) => {
  const result = validateMcpSuite(input);
  if (result.valid) throw new Error("유효하지 않은 명세를 기대했습니다.");
  return result.issues;
};

const SCHEMA_PATH = "cases[0].assertions[0].schema";

describe("bodyMatchesSchema 단언 검증", () => {
  it("bodyMatchesSchema를 callTool 케이스에서 허용한다", () => {
    expect(
      validateMcpSuite(
        bodySuite({ type: "object", required: ["temp"], properties: { temp: { type: "number" } } }),
      ).valid,
    ).toBe(true);
  });

  it("bodyMatchesSchema를 listTools 케이스에서 거부한다", () => {
    expect(
      issuesOf({
        schemaVersion: 1,
        id: "suite",
        name: "Suite",
        cases: [
          {
            id: "tools",
            name: "툴",
            operation: { type: "listTools" },
            assertions: [{ type: "bodyMatchesSchema", schema: { type: "object" } }],
          },
        ],
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "INCOMPATIBLE_ASSERTION",
        path: "cases[0].assertions[0]",
      }),
    );
  });

  it("isError와 bodyMatchesSchema를 한 배열에 함께 허용한다", () => {
    const result = validateMcpSuite(
      callToolSuite([
        { type: "isError", expected: false },
        { type: "bodyMatchesSchema", schema: { type: "object" } },
      ]),
    );
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("유효한 명세를 기대했습니다.");
    expect(result.value.cases[0]?.assertions).toHaveLength(2);
  });

  it("schema가 없으면 거부한다", () => {
    expect(issuesOf(callToolSuite([{ type: "bodyMatchesSchema" }]))).toContainEqual(
      expect.objectContaining({ code: "MISSING_REQUIRED_FIELD", path: SCHEMA_PATH }),
    );
  });

  it("schema가 객체가 아니면 거부한다", () => {
    expect(issuesOf(bodySuite("object"))).toContainEqual(
      expect.objectContaining({ code: "INVALID_TYPE", path: SCHEMA_PATH }),
    );
  });

  it("단언에 알 수 없는 필드가 있으면 거부한다", () => {
    expect(
      issuesOf(
        callToolSuite([
          { type: "bodyMatchesSchema", schema: { type: "object" }, source: "content" },
        ]),
      ),
    ).toContainEqual(
      expect.objectContaining({
        code: "UNKNOWN_FIELD",
        path: "cases[0].assertions[0].source",
      }),
    );
  });

  it("지원하지 않는 스키마 키워드를 거부한다", () => {
    expect(issuesOf(bodySuite({ type: "number", multipleOf: 2 }))).toContainEqual(
      expect.objectContaining({
        code: "UNSUPPORTED_SCHEMA_KEYWORD",
        path: `${SCHEMA_PATH}.multipleOf`,
        message: "지원하지 않는 스키마 키워드입니다.",
      }),
    );
  });

  it("중첩된 properties의 알 수 없는 키워드도 거부한다", () => {
    expect(
      issuesOf(
        bodySuite({
          type: "object",
          properties: { temp: { type: "number", multipleOf: 2 } },
        }),
      ),
    ).toContainEqual(
      expect.objectContaining({
        code: "UNSUPPORTED_SCHEMA_KEYWORD",
        path: `${SCHEMA_PATH}.properties.temp.multipleOf`,
      }),
    );
  });

  it("type 값이 목록 밖이면 거부한다", () => {
    expect(issuesOf(bodySuite({ type: "json" }))).toContainEqual(
      expect.objectContaining({ code: "INVALID_VALUE", path: `${SCHEMA_PATH}.type` }),
    );
  });

  it("minimum에 type이 없으면 거부한다", () => {
    const issues = issuesOf(bodySuite({ minimum: 0 }));
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "SCHEMA_KEYWORD_REQUIRES_TYPE",
        path: `${SCHEMA_PATH}.minimum`,
      }),
    );
    expect(issues.find((entry) => entry.path === `${SCHEMA_PATH}.minimum`)?.message).toContain(
      "number 또는 integer",
    );
  });

  it("required에 type object가 없으면 거부한다", () => {
    expect(issuesOf(bodySuite({ required: ["temp"] }))).toContainEqual(
      expect.objectContaining({
        code: "SCHEMA_KEYWORD_REQUIRES_TYPE",
        path: `${SCHEMA_PATH}.required`,
      }),
    );
  });

  it("stringContains에 type string이 있으면 통과한다", () => {
    expect(validateMcpSuite(bodySuite({ type: "string", stringContains: "맑음" })).valid).toBe(
      true,
    );
  });

  it("minItems가 음수이면 거부한다", () => {
    expect(issuesOf(bodySuite({ type: "array", minItems: -1 }))).toContainEqual(
      expect.objectContaining({ code: "INVALID_VALUE", path: `${SCHEMA_PATH}.minItems` }),
    );
  });

  it("minItems가 소수이면 거부한다", () => {
    expect(issuesOf(bodySuite({ type: "array", minItems: 1.5 }))).toContainEqual(
      expect.objectContaining({ code: "INVALID_VALUE", path: `${SCHEMA_PATH}.minItems` }),
    );
  });

  it("minimum이 NaN이면 거부한다", () => {
    expect(issuesOf(bodySuite({ type: "number", minimum: NaN }))).toContainEqual(
      expect.objectContaining({ code: "INVALID_VALUE", path: `${SCHEMA_PATH}.minimum` }),
    );
  });

  it("enum이 빈 배열이면 거부한다", () => {
    expect(issuesOf(bodySuite({ enum: [] }))).toContainEqual(
      expect.objectContaining({ code: "INVALID_TYPE", path: `${SCHEMA_PATH}.enum` }),
    );
  });

  it("stringContains가 빈 문자열이면 거부한다", () => {
    expect(issuesOf(bodySuite({ type: "string", stringContains: "" }))).toContainEqual(
      expect.objectContaining({ code: "INVALID_VALUE", path: `${SCHEMA_PATH}.stringContains` }),
    );
  });

  it("required 원소가 문자열이 아니면 거부한다", () => {
    expect(issuesOf(bodySuite({ type: "object", required: [1] }))).toContainEqual(
      expect.objectContaining({ code: "INVALID_TYPE", path: `${SCHEMA_PATH}.required[0]` }),
    );
  });

  it("additionalProperties에 스키마를 쓸 수 있다", () => {
    expect(
      validateMcpSuite(bodySuite({ type: "object", additionalProperties: { type: "string" } }))
        .valid,
    ).toBe(true);
  });

  it("additionalProperties 스키마의 오류도 잡는다", () => {
    expect(
      issuesOf(bodySuite({ type: "object", additionalProperties: { multipleOf: 2 } })),
    ).toContainEqual(
      expect.objectContaining({
        code: "UNSUPPORTED_SCHEMA_KEYWORD",
        path: `${SCHEMA_PATH}.additionalProperties.multipleOf`,
      }),
    );
  });

  it("items 스키마의 오류도 잡는다", () => {
    expect(issuesOf(bodySuite({ type: "array", items: { multipleOf: 2 } }))).toContainEqual(
      expect.objectContaining({
        code: "UNSUPPORTED_SCHEMA_KEYWORD",
        path: `${SCHEMA_PATH}.items.multipleOf`,
      }),
    );
  });

  it("깊이 500 중첩 스키마에서 스택이 넘치지 않는다", () => {
    let schema: Record<string, unknown> = { type: "string" };
    for (let depth = 0; depth < 500; depth++)
      schema = { type: "object", properties: { next: schema } };

    expect(() => validateMcpSuite(bodySuite(schema))).not.toThrow();
    expect(validateMcpSuite(bodySuite(schema)).valid).toBe(true);
  });

  it("이슈 순서가 properties, additionalProperties, items 순이다", () => {
    const issues = issuesOf(
      bodySuite({
        type: "object",
        properties: { a: { multipleOf: 1 }, b: { multipleOf: 1 } },
        additionalProperties: { multipleOf: 1 },
        items: { multipleOf: 1 },
      }),
    );
    expect(issues.map((entry) => entry.path)).toEqual([
      `${SCHEMA_PATH}.items`,
      `${SCHEMA_PATH}.properties.a.multipleOf`,
      `${SCHEMA_PATH}.properties.b.multipleOf`,
      `${SCHEMA_PATH}.additionalProperties.multipleOf`,
      `${SCHEMA_PATH}.items.multipleOf`,
    ]);
  });
});
