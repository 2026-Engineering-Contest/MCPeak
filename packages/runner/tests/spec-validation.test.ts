import { describe, expect, it } from "vitest";
import {
  defineMcpSuite,
  MCP_SUITE_JSON_SCHEMA,
  type ReadonlyJsonObject,
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

/** 형식만 보는 검사이므로 실제 해시값 대신 형식이 유효한 리터럴을 쓴다. */
const FINGERPRINT = "a".repeat(64);

/** validSuite 에 approval 값 하나만 얹은 스위트를 만든다. */
const approvalSuite = (approval: unknown) => ({ ...validSuite, approval });

describe("approval 검증", () => {
  it("approval 이 없는 기존 명세가 그대로 유효하다", () => {
    expect(validateMcpSuite(validSuite).valid).toBe(true);
  });

  it("64자 소문자 hex 지문을 받는다", () => {
    expect(validateMcpSuite(approvalSuite({ fingerprint: FINGERPRINT })).valid).toBe(true);
  });

  it("approval 이 배열이면 INVALID_TYPE 을 낸다", () => {
    expect(issuesOf(approvalSuite([]))).toContainEqual(
      expect.objectContaining({ code: "INVALID_TYPE", path: "approval" }),
    );
  });

  it("approval 이 문자열이면 INVALID_TYPE 을 낸다", () => {
    expect(issuesOf(approvalSuite(FINGERPRINT))).toContainEqual(
      expect.objectContaining({ code: "INVALID_TYPE", path: "approval" }),
    );
  });

  it("approval 이 null 이면 INVALID_TYPE 을 낸다", () => {
    expect(issuesOf(approvalSuite(null))).toContainEqual(
      expect.objectContaining({ code: "INVALID_TYPE", path: "approval" }),
    );
  });

  it("fingerprint 가 없으면 MISSING_REQUIRED_FIELD 를 낸다", () => {
    expect(issuesOf(approvalSuite({}))).toContainEqual(
      expect.objectContaining({ code: "MISSING_REQUIRED_FIELD", path: "approval.fingerprint" }),
    );
  });

  it("fingerprint 가 문자열이 아니면 INVALID_TYPE 을 낸다", () => {
    expect(issuesOf(approvalSuite({ fingerprint: 1 }))).toContainEqual(
      expect.objectContaining({ code: "INVALID_TYPE", path: "approval.fingerprint" }),
    );
  });

  it("fingerprint 가 63자면 INVALID_VALUE 를 낸다", () => {
    expect(issuesOf(approvalSuite({ fingerprint: "a".repeat(63) }))).toContainEqual(
      expect.objectContaining({ code: "INVALID_VALUE", path: "approval.fingerprint" }),
    );
  });

  it("fingerprint 가 65자면 INVALID_VALUE 를 낸다", () => {
    expect(issuesOf(approvalSuite({ fingerprint: "a".repeat(65) }))).toContainEqual(
      expect.objectContaining({ code: "INVALID_VALUE", path: "approval.fingerprint" }),
    );
  });

  it("fingerprint 에 대문자가 섞이면 INVALID_VALUE 를 낸다", () => {
    expect(issuesOf(approvalSuite({ fingerprint: `A${"a".repeat(63)}` }))).toContainEqual(
      expect.objectContaining({ code: "INVALID_VALUE", path: "approval.fingerprint" }),
    );
  });

  it("fingerprint 에 hex 가 아닌 글자가 있으면 INVALID_VALUE 를 낸다", () => {
    expect(issuesOf(approvalSuite({ fingerprint: `z${"a".repeat(63)}` }))).toContainEqual(
      expect.objectContaining({ code: "INVALID_VALUE", path: "approval.fingerprint" }),
    );
  });

  it("fingerprint 가 빈 문자열이면 INVALID_VALUE 를 낸다", () => {
    expect(issuesOf(approvalSuite({ fingerprint: "" }))).toContainEqual(
      expect.objectContaining({ code: "INVALID_VALUE", path: "approval.fingerprint" }),
    );
  });

  it("approval 안의 모르는 키를 UNKNOWN_FIELD 로 낸다", () => {
    expect(
      issuesOf(approvalSuite({ fingerprint: FINGERPRINT, approvedAt: "2026-08-14" })),
    ).toContainEqual(
      expect.objectContaining({ code: "UNKNOWN_FIELD", path: "approval.approvedAt" }),
    );
  });

  it("approval 이 잘못돼도 cases 검증 결과가 함께 나온다", () => {
    const issues = issuesOf({
      ...validSuite,
      approval: { fingerprint: "" },
      cases: [{ ...validSuite.cases[0], assertions: [] }],
    });
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "INVALID_VALUE", path: "approval.fingerprint" }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "EMPTY_ASSERTIONS", path: "cases[0].assertions" }),
    );
  });
});

describe("validateMcpSuite / approval.cases", () => {
  /** 지문은 유효한 값으로 고정한다. 이 블록의 관심사는 cases 하나다. */
  const withCases = (cases: unknown) => approvalSuite({ fingerprint: FINGERPRINT, cases });

  it("approval.cases 가 없으면 valid 다", () => {
    expect(validateMcpSuite(approvalSuite({ fingerprint: FINGERPRINT })).valid).toBe(true);
  });

  it("approval.cases 가 빈 배열이면 valid 다", () => {
    expect(validateMcpSuite(withCases([])).valid).toBe(true);
  });

  it("id 가 문자열이 아니면 INVALID_VALUE 이고 path 가 approval.cases[0].id 다", () => {
    expect(issuesOf(withCases([{ id: 1, status: "passed" }]))).toContainEqual(
      expect.objectContaining({ code: "INVALID_VALUE", path: "approval.cases[0].id" }),
    );
  });

  it("status 가 passed·serverDefect 밖이면 INVALID_VALUE 다", () => {
    expect(issuesOf(withCases([{ id: "a", status: "unknown" }]))).toContainEqual(
      expect.objectContaining({ code: "INVALID_VALUE", path: "approval.cases[0].status" }),
    );
  });

  it("status 가 없으면 INVALID_VALUE 다", () => {
    expect(issuesOf(withCases([{ id: "a" }]))).toContainEqual(
      expect.objectContaining({ code: "INVALID_VALUE", path: "approval.cases[0].status" }),
    );
  });

  it("중복 id 가 있으면 INVALID_VALUE 다", () => {
    expect(
      issuesOf(
        withCases([
          { id: "a", status: "passed" },
          { id: "a", status: "passed" },
        ]),
      ),
    ).toContainEqual(
      expect.objectContaining({ code: "INVALID_VALUE", path: "approval.cases[1].id" }),
    );
  });

  it("cases 가 배열이 아니면 INVALID_VALUE 다", () => {
    expect(issuesOf(withCases({ a: "passed" }))).toContainEqual(
      expect.objectContaining({ code: "INVALID_VALUE", path: "approval.cases" }),
    );
  });

  it("approval.cases[].id 가 cases 에 없어도 valid 다", () => {
    // 케이스를 지우는 정상 편집이 파일을 깨진 것으로 만들면 안 된다. 설계 문서 §7.3.
    expect(validateMcpSuite(withCases([{ id: "없는-케이스", status: "serverDefect" }])).valid).toBe(
      true,
    );
  });

  it("passed 와 serverDefect 를 모두 받는다", () => {
    expect(
      validateMcpSuite(
        withCases([
          { id: "tools", status: "passed" },
          { id: "call", status: "serverDefect" },
        ]),
      ).valid,
    ).toBe(true);
  });

  it("항목 안의 모르는 키를 UNKNOWN_FIELD 로 낸다", () => {
    expect(
      issuesOf(withCases([{ id: "a", status: "passed", approvedAt: "2026-08-15" }])),
    ).toContainEqual(
      expect.objectContaining({ code: "UNKNOWN_FIELD", path: "approval.cases[0].approvedAt" }),
    );
  });

  it("MCP_SUITE_JSON_SCHEMA 가 approval.cases 를 기술하고 status 의 enum 이 둘이다", () => {
    const defs = MCP_SUITE_JSON_SCHEMA.$defs as ReadonlyJsonObject;
    const approval = defs.suiteApproval as ReadonlyJsonObject;
    const properties = approval.properties as ReadonlyJsonObject;
    expect(properties.cases).toEqual({
      type: "array",
      items: { $ref: "#/$defs/suiteCaseApproval" },
    });
    const item = defs.suiteCaseApproval as ReadonlyJsonObject;
    expect(item.required).toEqual(["id", "status"]);
    expect((item.properties as ReadonlyJsonObject).status).toEqual({
      enum: ["passed", "serverDefect"],
    });
  });
});

/**
 * 이슈 #352 — 검증 문장이 코드와 무관하게 같던 것을 코드별 문안으로 가른 뒤의 계약.
 *
 * 옛 `issue()` 는 모든 코드에 `명세 필드 'X'가 유효하지 않습니다.` 하나를 붙였다. 필드가 *없는*
 * 것과 값이 *틀린* 것과 단언이 operation 과 *안 맞는* 것이 화면에서 구분되지 않았다.
 */
const OLD_FIXED_HINT = "명세 계약에 맞게 필드와 값을 확인하세요.";

/** 코드마다 한 번씩은 나오도록 고른 표본. 13개 코드를 모두 덮는다. */
const SAMPLES: readonly unknown[] = [
  // MISSING_REQUIRED_FIELD · INCOMPATIBLE_ASSERTION — 이슈 본문의 재현 명세 그대로다.
  {
    id: "noschema",
    name: "버전없음",
    cases: [
      {
        id: "c1",
        name: "t",
        operation: { type: "listTools" },
        assertions: [{ type: "isError", expected: false }],
      },
    ],
  },
  // UNSUPPORTED_SCHEMA_VERSION · UNKNOWN_FIELD · INVALID_VALUE · INVALID_TYPE ·
  // INVALID_TIMEOUT · DUPLICATE_CASE_ID · EMPTY_ASSERTIONS
  {
    schemaVersion: 2,
    id: "",
    name: 42,
    extra: true,
    defaultTimeoutMs: 0,
    cases: [
      {
        id: "dup",
        name: "a",
        operation: { type: "callTool", tool: "t", input: {} },
        assertions: [{ type: "isError", expected: false }],
      },
      { id: "dup", name: "b", timeoutMs: -1, operation: { type: "listTools" }, assertions: [] },
    ],
  },
  // EMPTY_CASES
  { schemaVersion: 1, id: "s", name: "s", cases: [] },
  // INVALID_JSON_VALUE
  callToolSuite([
    { type: "isError", expected: false },
    { type: "isError", expected: false },
  ]),
  {
    schemaVersion: 1,
    id: "s",
    name: "s",
    cases: [
      {
        id: "c",
        name: "c",
        operation: { type: "callTool", tool: "t", input: { bad: Number.NaN } },
        assertions: [{ type: "isError", expected: false }],
      },
    ],
  },
  // UNSUPPORTED_SCHEMA_KEYWORD · SCHEMA_KEYWORD_REQUIRES_TYPE
  bodySuite({ wat: 1, minLength: 1 }),
];

/** 코드별로 처음 나온 문안. 표본 전체를 훑어 모은다. */
const firstTextByCode = () => {
  const texts = new Map<string, { message: string; hint: string }>();
  for (const sample of SAMPLES) {
    const result = validateMcpSuite(sample);
    if (result.valid) continue;
    for (const entry of result.issues)
      if (!texts.has(entry.code))
        texts.set(entry.code, { message: entry.message, hint: entry.hint });
  }
  return texts;
};

describe("명세 검증 문안 (이슈 #352)", () => {
  it("없는 필드와 안 맞는 단언이 서로 다른 문장으로 나오고, 넣어야 할 값과 대조 대상을 싣는다", () => {
    const issues = issuesOf(SAMPLES[0]);
    const missing = issues.find((entry) => entry.code === "MISSING_REQUIRED_FIELD");
    const incompatible = issues.find((entry) => entry.code === "INCOMPATIBLE_ASSERTION");

    // schemaVersion 은 받는 값이 1 하나뿐이라 그대로 말할 수 있다.
    expect(missing?.message).toBe("'schemaVersion' 필드가 없습니다. 받는 값: 1.");
    // 대조의 양쪽 — operation 종류와 그 종류가 허용하는 단언 — 이 둘 다 실린다.
    expect(incompatible?.message).toBe(
      "'listTools' operation 은 'isError' 단언을 받지 않습니다. 허용: toolExists",
    );
    expect(missing?.message).not.toBe(incompatible?.message);
    expect(missing?.hint).not.toBe(incompatible?.hint);
  });

  it("13개 코드가 저마다 다른 문장을 낸다", () => {
    const texts = firstTextByCode();
    // 표본이 코드를 다 덮지 못하면 이 테스트가 통과해도 의미가 없다. 덮는지부터 고정한다.
    expect(texts.size).toBe(13);
    expect(new Set([...texts.values()].map((text) => text.message)).size).toBe(13);
  });

  it("옛 고정 문안이 어디에도 남아 있지 않다", () => {
    for (const [code, text] of firstTextByCode()) {
      expect(text.message, code).not.toMatch(/명세 필드 '.*'가 유효하지 않습니다\./);
      expect(text.hint, code).not.toBe(OLD_FIXED_HINT);
    }
  });

  it("모르는 필드는 그 자리가 받는 필드 목록을 함께 낸다", () => {
    const unknown = issuesOf({ ...validSuite, wheather: true }).find(
      (entry) => entry.code === "UNKNOWN_FIELD",
    );
    expect(unknown?.path).toBe("wheather");
    expect(unknown?.hint).toBe(
      "오타가 아니면 지우세요. 이 자리가 받는 필드: approval, cases, defaultTimeoutMs, id, name, schemaVersion",
    );
  });

  it("단언 type 이 문자열이 아니면 무엇을 받는지로 말을 바꾼다", () => {
    const issues = issuesOf(callToolSuite([{ expected: false }]));
    expect(issues.find((entry) => entry.code === "INCOMPATIBLE_ASSERTION")?.message).toBe(
      "단언에 type 이 없거나 문자열이 아닙니다. 'callTool' operation 이 받는 단언: isError, bodyMatchesSchema",
    );
  });

  it("모르는 operation 종류에서는 대조할 오른쪽이 없다고 말한다", () => {
    // operation.type 이 목록 밖이면 허용 단언 목록 자체가 없다. 없는 목록을 지어내지 않는다.
    const issues = issuesOf({
      schemaVersion: 1,
      id: "s",
      name: "s",
      cases: [
        {
          id: "c",
          name: "c",
          operation: { type: "nope" },
          assertions: [{ type: "isError", expected: false }],
        },
      ],
    });
    const incompatible = issues.find((entry) => entry.code === "INCOMPATIBLE_ASSERTION");
    expect(incompatible?.message).toBe(
      "'nope' operation 은 아는 종류가 아니라 단언을 대조할 수 없습니다.",
    );
    expect(incompatible?.hint).toBe("operation.type 을 listTools 또는 callTool 로 바꾸세요.");
  });

  it("타임아웃은 받는 범위를 낸다", () => {
    const timeout = issuesOf({ ...validSuite, defaultTimeoutMs: 0 }).find(
      (entry) => entry.code === "INVALID_TIMEOUT",
    );
    expect(timeout?.message).toBe("'defaultTimeoutMs' 필드가 타임아웃 값이 아닙니다. 받은 값: 0.");
    expect(timeout?.hint).toBe("1 이상 2147483647 이하의 정수 밀리초를 넣으세요.");
  });

  it("긴 값과 지문은 화면에 싣지 않는다", () => {
    // 33자 이상 문자열은 타입 이름으로 줄인다. 한 줄이 값 하나에 먹히면 안 된다.
    const long = issuesOf({ ...validSuite, id: `  ${" ".repeat(40)}` }).find(
      (entry) => entry.code === "INVALID_VALUE",
    );
    expect(long?.message).toBe("'id' 필드의 값이 계약을 벗어납니다. 받은 값: string.");

    // 지문은 64자다. 형식만 말하고 값은 싣지 않는다.
    const fingerprint = issuesOf(approvalSuite({ fingerprint: "A".repeat(64) })).find(
      (entry) => entry.path === "approval.fingerprint",
    );
    expect(fingerprint?.message).toBe("'approval.fingerprint' 필드의 값이 계약을 벗어납니다.");
    expect(fingerprint?.hint).toBe(
      "'approval.fingerprint' 필드가 받는 값: sha256 hex 64자 (소문자)",
    );
  });

  it("JSON 이 담지 못하는 값은 원인마다 다른 문장으로 나온다", () => {
    const suite = (input: unknown) => ({
      schemaVersion: 1,
      id: "s",
      name: "s",
      cases: [
        {
          id: "c",
          name: "c",
          operation: { type: "callTool", tool: "t", input },
          assertions: [{ type: "isError", expected: false }],
        },
      ],
    });
    const messageOf = (input: unknown) =>
      issuesOf(suite(input)).find((entry) => entry.code === "INVALID_JSON_VALUE")?.message;

    expect(messageOf({ n: Number.NaN })).toBe(
      "'cases[0].operation.input.n' 자리에 JSON 이 담지 못하는 수가 있습니다. 받은 값: NaN.",
    );
    expect(messageOf({ fn: () => 1 })).toBe(
      "'cases[0].operation.input.fn' 자리에 JSON 으로 옮길 수 없는 값이 있습니다. 받은 값: function.",
    );
    expect(messageOf(7)).toBe(
      "'cases[0].operation.input' 자리가 받는 값은 JSON 객체 하나입니다. 받은 값: number.",
    );

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(messageOf(cyclic)).toBe(
      "'cases[0].operation.input.self' 자리에서 값이 자기 자신을 참조해 순환합니다.",
    );
  });

  it("issueWith 로 이미 전용 문안을 쓰던 자리는 글자 그대로 남는다", () => {
    const issues = issuesOf(bodySuite({ wat: 1, minLength: 1 }));
    expect(issues.find((entry) => entry.code === "UNSUPPORTED_SCHEMA_KEYWORD")?.message).toBe(
      "지원하지 않는 스키마 키워드입니다.",
    );
    expect(issues.find((entry) => entry.code === "SCHEMA_KEYWORD_REQUIRES_TYPE")?.message).toBe(
      "'minLength'은 type이 string일 때만 쓸 수 있습니다.",
    );
  });

  it("같은 입력에 같은 문안이 나온다", () => {
    for (const sample of SAMPLES) {
      const first = validateMcpSuite(sample);
      const second = validateMcpSuite(sample);
      expect(first).toEqual(second);
    }
  });
});
