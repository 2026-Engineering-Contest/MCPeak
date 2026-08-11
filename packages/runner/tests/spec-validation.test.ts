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
