import type { ToolDef } from "@ohmymcp/core";
import { describe, expect, it } from "vitest";
import type { JsonObject, TestCaseSpec, TestSuiteSpec } from "../src/index.js";
import { checkInputContract } from "../src/index.js";

const tool = (name: string, inputSchema: unknown): ToolDef => ({ name, inputSchema });

const callTool = (id: string, toolName: string, input: JsonObject): TestCaseSpec => ({
  id,
  name: id,
  operation: { type: "callTool", tool: toolName, input },
  assertions: [{ type: "isError", expected: false }],
});

const suiteOf = (...cases: TestCaseSpec[]): TestSuiteSpec => ({
  schemaVersion: 1,
  id: "suite",
  name: "suite",
  cases,
});

/** 한 케이스 한 툴을 대조하는 가장 흔한 모양. */
const check = (inputSchema: unknown, input: JsonObject) =>
  checkInputContract({
    suite: suiteOf(callTool("case-1", "get_weather", input)),
    tools: [tool("get_weather", inputSchema)],
  });

const objectSchema = (schema: Record<string, unknown>): Record<string, unknown> => ({
  type: "object",
  properties: {},
  ...schema,
});

describe("checkInputContract 입력 대조 (설계 §10.1)", () => {
  it("선언과 완전히 일치하는 입력은 finding 0건", () => {
    const result = check(
      objectSchema({
        properties: { city: { type: "string" }, units: { enum: ["c", "f"] } },
        required: ["city"],
        additionalProperties: false,
      }),
      { city: "서울", units: "c" },
    );
    expect(result).toEqual({ findings: [], totalFindings: 0 });
  });

  it("선언되지 않은 툴을 호출하면 TOOL_NOT_DECLARED 1건, 그 케이스의 다른 finding은 0건", () => {
    const result = checkInputContract({
      suite: suiteOf(callTool("case-1", "get_wether", { nope: 1 })),
      tools: [tool("get_weather", objectSchema({ properties: { city: { type: "string" } } }))],
    });
    expect(result.totalFindings).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      code: "TOOL_NOT_DECLARED",
      severity: "blocking",
      caseId: "case-1",
      actual: "get_wether",
      suggestion: "get_weather",
    });
  });

  it("required 필드가 없으면 REQUIRED_MISSING", () => {
    const result = check(
      objectSchema({ properties: { city: { type: "string" } }, required: ["city"] }),
      {},
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      code: "REQUIRED_MISSING",
      severity: "blocking",
      path: "input.city",
      expected: "city",
    });
  });

  it("required가 없고 입력에 오타 후보가 있으면 suggestion에 그 이름이 들어간다", () => {
    const result = check(
      objectSchema({ properties: { city: { type: "string" } }, required: ["city"] }),
      { citi: "서울" },
    );
    expect(result.findings[0]).toMatchObject({ code: "REQUIRED_MISSING", suggestion: "citi" });
  });

  it("additionalProperties: false 이고 선언에 없는 필드가 있으면 UNDECLARED_FIELD", () => {
    const result = check(
      objectSchema({ properties: { city: { type: "string" } }, additionalProperties: false }),
      { city: "서울", zoom: 3 },
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      code: "UNDECLARED_FIELD",
      severity: "blocking",
      path: "input.zoom",
      actual: "zoom",
    });
  });

  it("additionalProperties가 없으면 선언에 없는 필드가 있어도 finding 0건", () => {
    const result = check(objectSchema({ properties: { city: { type: "string" } } }), {
      city: "서울",
      zoom: 3,
    });
    expect(result).toEqual({ findings: [], totalFindings: 0 });
  });

  it("additionalProperties: true 이면 선언에 없는 필드가 있어도 finding 0건", () => {
    const result = check(
      objectSchema({ properties: { city: { type: "string" } }, additionalProperties: true }),
      { city: "서울", zoom: 3 },
    );
    expect(result).toEqual({ findings: [], totalFindings: 0 });
  });

  it("additionalProperties가 스키마 객체이면 선언에 없는 필드가 있어도 finding 0건", () => {
    const result = check(
      objectSchema({
        properties: { city: { type: "string" } },
        additionalProperties: { type: "string" },
      }),
      { city: "서울", zoom: 3 },
    );
    expect(result).toEqual({ findings: [], totalFindings: 0 });
  });

  it("선언 type이 string인데 숫자를 넣으면 TYPE_MISMATCH", () => {
    const result = check(objectSchema({ properties: { city: { type: "string" } } }), { city: 3 });
    expect(result.findings[0]).toMatchObject({
      code: "TYPE_MISMATCH",
      severity: "blocking",
      path: "input.city",
      expected: "string",
      actual: "number",
    });
  });

  it("선언 type이 integer인데 1.5를 넣으면 TYPE_MISMATCH", () => {
    const result = check(objectSchema({ properties: { days: { type: "integer" } } }), {
      days: 1.5,
    });
    expect(result.findings[0]).toMatchObject({ code: "TYPE_MISMATCH", expected: "integer" });
  });

  it("선언 type이 integer인데 2를 넣으면 finding 0건", () => {
    expect(check(objectSchema({ properties: { days: { type: "integer" } } }), { days: 2 })).toEqual(
      { findings: [], totalFindings: 0 },
    );
  });

  it("선언 type이 number인데 2를 넣으면 finding 0건", () => {
    expect(check(objectSchema({ properties: { days: { type: "number" } } }), { days: 2 })).toEqual({
      findings: [],
      totalFindings: 0,
    });
  });

  it("선언 type이 array인데 객체를 넣으면 TYPE_MISMATCH, actual object", () => {
    const result = check(objectSchema({ properties: { tags: { type: "array" } } }), { tags: {} });
    expect(result.findings[0]).toMatchObject({
      code: "TYPE_MISMATCH",
      expected: "array",
      actual: "object",
    });
  });

  it("null을 넣고 선언이 string이면 TYPE_MISMATCH, actual null", () => {
    const result = check(objectSchema({ properties: { city: { type: "string" } } }), {
      city: null,
    });
    expect(result.findings[0]).toMatchObject({
      code: "TYPE_MISMATCH",
      expected: "string",
      actual: "null",
    });
  });

  it("enum 밖 값이면 ENUM_MISMATCH, expected에 enum 배열 전체", () => {
    const result = check(objectSchema({ properties: { units: { enum: ["c", "f"] } } }), {
      units: "celsius",
    });
    expect(result.findings[0]).toMatchObject({
      code: "ENUM_MISMATCH",
      severity: "blocking",
      path: "input.units",
      expected: ["c", "f"],
      actual: "celsius",
    });
  });

  it("enum 안 값이면 finding 0건", () => {
    expect(
      check(objectSchema({ properties: { units: { enum: ["c", "f"] } } }), { units: "f" }),
    ).toEqual({ findings: [], totalFindings: 0 });
  });

  it('type이 ["string","null"] 이면 그 필드의 타입 검사를 건너뛴다', () => {
    expect(
      check(objectSchema({ properties: { city: { type: ["string", "null"] } } }), { city: 3 }),
    ).toEqual({ findings: [], totalFindings: 0 });
  });

  it("케이스가 listTools면 입력 검사를 하지 않는다", () => {
    const result = checkInputContract({
      suite: suiteOf({
        id: "list",
        name: "list",
        operation: { type: "listTools" },
        assertions: [{ type: "toolExists", tool: "nope" }],
      }),
      tools: [tool("get_weather", objectSchema({ properties: { city: { type: "string" } } }))],
    });
    expect(result).toEqual({ findings: [], totalFindings: 0 });
  });
});

describe("오타 후보 규칙 (설계 §5.4)", () => {
  it("'citi' 와 'city' 는 거리 1이라 후보가 된다", () => {
    const result = check(
      objectSchema({ properties: { city: { type: "string" } }, required: ["city"] }),
      { citi: "서울" },
    );
    expect(result.findings[0]?.suggestion).toBe("citi");
  });

  it("'id' 와 'at' 는 거리 2지만 길이 절반 조건에 걸려 후보가 아니다", () => {
    const result = check(
      objectSchema({ properties: { id: { type: "string" } }, required: ["id"] }),
      {
        at: "x",
      },
    );
    expect(result.findings[0]).toMatchObject({ code: "REQUIRED_MISSING", expected: "id" });
    expect(result.findings[0]).not.toHaveProperty("suggestion");
  });

  it("거리가 같은 후보가 둘이면 UTF-16 코드 단위로 앞선 것을 고른다", () => {
    const result = check(
      objectSchema({ properties: { cat: { type: "string" } }, required: ["cat"] }),
      {
        cot: "x",
        bat: "y",
      },
    );
    expect(result.findings[0]?.suggestion).toBe("bat");
  });

  it("후보가 없으면 suggestion 키가 아예 없다", () => {
    const result = check(
      objectSchema({ properties: { city: { type: "string" } }, required: ["city"] }),
      { elevation: 1 },
    );
    expect(result.findings[0]).not.toHaveProperty("suggestion");
  });

  it("UNDECLARED_FIELD 의 후보군은 입력에 없는 선언 이름이다", () => {
    const result = check(
      objectSchema({ properties: { city: { type: "string" } }, additionalProperties: false }),
      { citi: "서울" },
    );
    expect(result.findings.find((f) => f.code === "UNDECLARED_FIELD")).toMatchObject({
      actual: "citi",
      suggestion: "city",
    });
  });

  it("문자열 enum 이면 ENUM_MISMATCH 에도 후보가 붙는다", () => {
    const result = check(
      objectSchema({ properties: { units: { enum: ["celsius", "fahrenheit"] } } }),
      { units: "celcius" },
    );
    expect(result.findings[0]).toMatchObject({ code: "ENUM_MISMATCH", suggestion: "celsius" });
  });

  it("한 글자 enum 은 길이 절반 조건에 걸려 후보가 붙지 않는다", () => {
    const result = check(objectSchema({ properties: { units: { enum: ["c", "f"] } } }), {
      units: "d",
    });
    expect(result.findings[0]).toMatchObject({ code: "ENUM_MISMATCH", actual: "d" });
    expect(result.findings[0]).not.toHaveProperty("suggestion");
  });
});

describe("상한 (설계 §9.3)", () => {
  it("한 케이스에서 위반 12건이면 findings는 10건, totalFindings는 12", () => {
    const input: JsonObject = {};
    for (let index = 0; index < 12; index++) input[`extra${index}`] = index;
    const result = check(
      objectSchema({ properties: { city: { type: "string" } }, additionalProperties: false }),
      input,
    );
    expect(result.findings).toHaveLength(10);
    expect(result.totalFindings).toBe(12);
    expect(result.findings.every((f) => f.code === "UNDECLARED_FIELD")).toBe(true);
  });
});

describe("해석 불가 처리 (설계 §10.3, ADR-0015)", () => {
  const blocking = [
    "anyOf",
    "oneOf",
    "allOf",
    "not",
    "if",
    "then",
    "else",
    "$ref",
    "$dynamicRef",
    "patternProperties",
    "dependentSchemas",
    "dependentRequired",
    "propertyNames",
    "unevaluatedProperties",
  ];

  for (const keyword of blocking) {
    it(`루트에 ${keyword} 가 있으면 SCHEMA_NOT_ANALYZABLE 1건만 나고 다른 코드는 0건`, () => {
      const result = check(
        objectSchema({
          properties: { city: { type: "string" } },
          required: ["city"],
          additionalProperties: false,
          [keyword]: keyword === "$ref" ? "#/defs/x" : [{ required: ["city"] }],
        }),
        { citi: 3 },
      );
      expect(result.findings).toHaveLength(1);
      expect(result.totalFindings).toBe(1);
      expect(result.findings[0]).toMatchObject({
        code: "SCHEMA_NOT_ANALYZABLE",
        severity: "advisory",
        actual: "get_weather",
      });
    });
  }

  it('루트 type 이 "object" 가 아니면 SCHEMA_NOT_ANALYZABLE', () => {
    const result = check({ type: "array", properties: { city: { type: "string" } } }, { city: 3 });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.code).toBe("SCHEMA_NOT_ANALYZABLE");
  });

  it("properties 가 없으면 SCHEMA_NOT_ANALYZABLE", () => {
    const result = check({ type: "object", required: ["city"] }, {});
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.code).toBe("SCHEMA_NOT_ANALYZABLE");
  });

  it("inputSchema 가 null 이면 SCHEMA_NOT_ANALYZABLE", () => {
    const result = check(null, { city: 3 });
    expect(result.findings[0]?.code).toBe("SCHEMA_NOT_ANALYZABLE");
  });

  it("inputSchema 가 문자열이면 SCHEMA_NOT_ANALYZABLE", () => {
    const result = check("object", { city: 3 });
    expect(result.findings[0]?.code).toBe("SCHEMA_NOT_ANALYZABLE");
  });

  it("SCHEMA_NOT_ANALYZABLE 의 severity 는 advisory 다", () => {
    expect(check(null, {}).findings[0]?.severity).toBe("advisory");
  });

  it("필드 하나에만 anyOf 가 있으면 그 필드만 건너뛰고 다른 필드의 REQUIRED_MISSING 은 난다", () => {
    const result = check(
      objectSchema({
        properties: {
          city: { type: "string" },
          when: { anyOf: [{ type: "string" }, { type: "number" }] },
        },
        required: ["city"],
      }),
      { when: true },
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ code: "REQUIRED_MISSING", expected: "city" });
  });

  it("설계 §4.1 의 anyOf 예시에 { lat, lon } 을 주면 SCHEMA_NOT_ANALYZABLE 1건뿐이다", () => {
    const result = check(
      {
        type: "object",
        properties: { city: { type: "string" } },
        anyOf: [{ required: ["city"] }, { required: ["lat", "lon"] }],
        additionalProperties: false,
      },
      { lat: 37.5, lon: 127 },
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.code).toBe("SCHEMA_NOT_ANALYZABLE");
    expect(result.findings.some((f) => f.code === "UNDECLARED_FIELD")).toBe(false);
  });
});

describe("결정론성 (설계 §10.4)", () => {
  const schema = objectSchema({
    properties: { city: { type: "string" }, units: { enum: ["c", "f"] } },
    required: ["city"],
    additionalProperties: false,
  });
  const options = {
    suite: suiteOf(
      callTool("case-1", "get_weather", { citi: "서울", units: "celsius" }),
      callTool("case-2", "get_forecast", { days: "3" }),
      callTool("case-3", "unknown_tool", {}),
    ),
    tools: [
      tool("get_weather", schema),
      tool("get_forecast", objectSchema({ properties: { days: { type: "integer" } } })),
    ],
  };

  it("같은 (suite, tools) 로 2회 호출한 결과가 JSON.stringify 기준 동일", () => {
    const first = JSON.stringify(checkInputContract(options));
    const second = JSON.stringify(checkInputContract(options));
    expect(first).toBe(second);
  });

  it("tools 배열 순서를 뒤집어도 결과가 동일", () => {
    const forward = JSON.stringify(checkInputContract(options));
    const reversed = JSON.stringify(
      checkInputContract({ suite: options.suite, tools: [...options.tools].reverse() }),
    );
    expect(reversed).toBe(forward);
  });

  it("케이스 3개 각각에 위반이 있으면 findings 가 케이스 인덱스 순으로 정렬돼 있다", () => {
    const result = checkInputContract(options);
    const seen: string[] = [];
    for (const finding of result.findings)
      if (seen[seen.length - 1] !== finding.caseId) seen.push(finding.caseId);
    expect(seen).toEqual(["case-1", "case-2", "case-3"]);
  });

  it("한 케이스 안에서 REQUIRED_MISSING 이 TYPE_MISMATCH 보다 앞에 온다", () => {
    const result = check(
      objectSchema({
        properties: { city: { type: "string" }, units: { type: "string" } },
        required: ["city"],
      }),
      { units: 3 },
    );
    expect(result.findings.map((f) => f.code)).toEqual(["REQUIRED_MISSING", "TYPE_MISMATCH"]);
  });

  it("path 가 다른 같은 코드의 finding 이 UTF-16 코드 단위 순으로 정렬돼 있다", () => {
    const result = check(
      objectSchema({
        properties: {
          alpha: { type: "string" },
          beta: { type: "string" },
          gamma: { type: "string" },
        },
        required: ["gamma", "alpha", "beta"],
      }),
      {},
    );
    expect(result.findings.map((f) => f.path)).toEqual([
      "input.alpha",
      "input.beta",
      "input.gamma",
    ]);
  });
});
