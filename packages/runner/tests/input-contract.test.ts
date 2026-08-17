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

describe("리뷰 회귀: type 배열과 중복 툴 이름", () => {
  it("type 이 배열이면 enum 검사도 건너뛴다", () => {
    // 합집합의 다른 갈래가 그 값을 허용할 수 있으므로 판정하지 않는다.
    const result = check(
      objectSchema({ properties: { v: { type: ["string", "null"], enum: ["x"] } } }),
      { v: 3 },
    );
    expect(result.findings).toEqual([]);
  });

  it("type 이 배열이 아니면 enum 검사는 그대로 한다", () => {
    const result = check(objectSchema({ properties: { v: { type: "string", enum: ["x"] } } }), {
      v: "y",
    });
    expect(result.findings.map((f) => f.code)).toEqual(["ENUM_MISMATCH"]);
  });

  it("같은 이름의 툴이 두 번 선언되면 해석 불가로 처리한다", () => {
    const tools = [
      tool("dup", objectSchema({ properties: { a: { type: "string" } }, required: ["a"] })),
      tool("dup", objectSchema({ properties: { b: { type: "number" } }, required: ["b"] })),
    ];
    const suite = suiteOf(callTool("case-1", "dup", { a: "값" }));
    const result = checkInputContract({ suite, tools });
    expect(result.findings.map((f) => f.code)).toEqual(["SCHEMA_NOT_ANALYZABLE"]);
  });

  it("중복 선언의 순서를 뒤집어도 결과가 같다", () => {
    const first = tool("dup", objectSchema({ properties: { a: { type: "string" } } }));
    const second = tool("dup", objectSchema({ properties: { b: { type: "number" } } }));
    const suite = suiteOf(callTool("case-1", "dup", { a: "값" }));
    expect(JSON.stringify(checkInputContract({ suite, tools: [first, second] }))).toBe(
      JSON.stringify(checkInputContract({ suite, tools: [second, first] })),
    );
  });
});

describe("거절 기대 케이스 제외 (설계 §10.3, ADR-0021)", () => {
  const weather = tool(
    "get_weather",
    objectSchema({
      properties: { city: { type: "string" }, units: { enum: ["c", "f"] } },
      required: ["city"],
      additionalProperties: false,
    }),
  );

  /** 거절을 기대하는 케이스 하나짜리 스위트. */
  const rejecting = (input: JsonObject): TestSuiteSpec =>
    suiteOf({
      id: "reject",
      name: "reject",
      operation: { type: "callTool", tool: "get_weather", input },
      assertions: [{ type: "isError", expected: true }],
    });

  const codesOf = (suite: TestSuiteSpec, tools: ToolDef[] = [weather]) =>
    checkInputContract({ suite, tools }).findings.map((finding) => finding.code);

  it("isError true 케이스는 REQUIRED_MISSING 을 내지 않는다", () => {
    const result = checkInputContract({ suite: rejecting({}), tools: [weather] });
    expect(result.findings).toEqual([]);
    expect(result.totalFindings).toBe(0);
  });

  it("isError true 케이스는 TYPE_MISMATCH 를 내지 않는다", () => {
    expect(codesOf(rejecting({ city: 0 }))).toEqual([]);
  });

  it("isError true 케이스는 ENUM_MISMATCH 를 내지 않는다", () => {
    expect(codesOf(rejecting({ city: "서울", units: "k" }))).toEqual([]);
  });

  it("isError true 케이스는 UNDECLARED_FIELD 를 내지 않는다", () => {
    expect(codesOf(rejecting({ city: "서울", nope: 1 }))).toEqual([]);
  });

  it("isError true 케이스도 TOOL_NOT_DECLARED 는 낸다", () => {
    const tools = [tool("other", objectSchema({}))];
    expect(codesOf(rejecting({ city: "서울" }), tools)).toEqual(["TOOL_NOT_DECLARED"]);
  });

  it("isError true 케이스도 SCHEMA_NOT_ANALYZABLE 은 낸다", () => {
    const tools = [tool("get_weather", { anyOf: [{ type: "object" }] })];
    expect(codesOf(rejecting({ city: "서울" }), tools)).toEqual(["SCHEMA_NOT_ANALYZABLE"]);
  });

  it("isError false 케이스는 기존과 같이 전부 낸다", () => {
    const suite = suiteOf({
      id: "accept",
      name: "accept",
      operation: { type: "callTool", tool: "get_weather", input: {} },
      assertions: [{ type: "isError", expected: false }],
    });
    expect(codesOf(suite)).toEqual(["REQUIRED_MISSING"]);
  });

  it("isError 단언이 없는 케이스는 기존과 같이 전부 낸다", () => {
    const suite = suiteOf({
      id: "no-iserror",
      name: "no-iserror",
      operation: { type: "callTool", tool: "get_weather", input: {} },
      assertions: [{ type: "bodyMatchesSchema", schema: { type: "object" } }],
    });
    expect(codesOf(suite)).toEqual(["REQUIRED_MISSING"]);
  });

  it("expected 가 서로 다른 isError 단언이 한 케이스에 있으면 전부 낸다", () => {
    const suite = suiteOf({
      id: "contradiction",
      name: "contradiction",
      operation: { type: "callTool", tool: "get_weather", input: {} },
      assertions: [
        { type: "isError", expected: true },
        { type: "isError", expected: false },
      ],
    });
    expect(codesOf(suite)).toEqual(["REQUIRED_MISSING"]);
  });

  it("침묵시킨 finding 은 totalFindings 에도 남지 않는다", () => {
    // 필수 누락 + 선언되지 않은 필드 + enum 위반이 한 케이스에 겹친 입력이다.
    const result = checkInputContract({
      suite: rejecting({ units: "k", nope: 1 }),
      tools: [weather],
    });
    expect(result).toEqual({ findings: [], totalFindings: 0 });
  });

  /**
   * 이슈 #94. 거절을 기대하는데 입력이 선언을 하나도 안 어기면, 그 케이스는 무엇을
   * 거절받으려는지 알 수 없다. 억제한 위반이 0건일 때만 advisory 하나로 알린다.
   */
  describe("REJECTION_WITHOUT_VIOLATION (#94)", () => {
    it("정상 입력에 isError true 를 기대하면 advisory 1건", () => {
      const result = checkInputContract({
        suite: rejecting({ city: "서울" }),
        tools: [weather],
      });
      expect(result.totalFindings).toBe(1);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toEqual({
        code: "REJECTION_WITHOUT_VIOLATION",
        severity: "advisory",
        caseId: "reject",
        path: "operation.input",
      });
    });

    it("선언 밖 필드를 허용하는 툴에서 오타 필드만 보낸 케이스를 잡는다", () => {
      // units 는 optional 이고 additionalProperties 제약이 없어 'unitz' 는 아무 선언도 안 어긴다.
      const lenient = tool(
        "get_weather",
        objectSchema({ properties: { units: { enum: ["c", "f"] } } }),
      );
      expect(codesOf(rejecting({ unitz: "c" }), [lenient])).toEqual([
        "REJECTION_WITHOUT_VIOLATION",
      ]);
    });

    it("required 필드 오타는 누락 위반이 억제된 것이므로 내지 않는다 (A안의 한계)", () => {
      // { citi } 는 'city' 를 빠뜨린 입력이기도 하다. REQUIRED_MISSING 이 억제 목록에 남으므로
      // 위반 0건이 아니다. 이 미탐은 설계에서 감수했다.
      expect(codesOf(rejecting({ citi: "서울" }))).toEqual([]);
    });

    it("additionalProperties false 툴에 선언 밖 필드를 보내는 정당한 위반 케이스에는 내지 않는다", () => {
      expect(codesOf(rejecting({ city: "서울", nope: 1 }))).toEqual([]);
    });

    it("TOOL_NOT_DECLARED 가 있으면 내지 않는다", () => {
      const tools = [tool("other", objectSchema({}))];
      expect(codesOf(rejecting({ city: "서울" }), tools)).toEqual(["TOOL_NOT_DECLARED"]);
    });

    it("SCHEMA_NOT_ANALYZABLE 이면 내지 않는다", () => {
      const tools = [tool("get_weather", { anyOf: [{ type: "object" }] })];
      expect(codesOf(rejecting({ city: "서울" }), tools)).toEqual(["SCHEMA_NOT_ANALYZABLE"]);
    });

    it("isError false 케이스에는 내지 않는다", () => {
      const suite = suiteOf({
        id: "accept",
        name: "accept",
        operation: { type: "callTool", tool: "get_weather", input: { city: "서울" } },
        assertions: [{ type: "isError", expected: false }],
      });
      expect(codesOf(suite)).toEqual([]);
    });

    it("expected 가 서로 다른 isError 단언이 둘이면 내지 않는다", () => {
      const suite = suiteOf({
        id: "contradiction",
        name: "contradiction",
        operation: { type: "callTool", tool: "get_weather", input: { city: "서울" } },
        assertions: [
          { type: "isError", expected: true },
          { type: "isError", expected: false },
        ],
      });
      expect(codesOf(suite)).toEqual([]);
    });

    it("같은 입력 2회 호출의 결과가 동일하다", () => {
      const once = checkInputContract({ suite: rejecting({ city: "서울" }), tools: [weather] });
      const twice = checkInputContract({ suite: rejecting({ city: "서울" }), tools: [weather] });
      expect(twice).toEqual(once);
    });
  });

  /**
   * 두 패키지를 잇는 계약 테스트다. 설계서 §5.5 의 케이스 8개를 리터럴로 적는다.
   * `generate` 를 import 하면 의존 방향이 뒤집히므로 같은 값을 두 곳에 두는 것이 의도이고,
   * 어긋나면 이 테스트가 깨져 알린다.
   */
  it("buildViolationCases 가 만드는 케이스 전량을 넣으면 finding 이 0건이다", () => {
    const sampleTools = [
      tool(
        "get_weather",
        objectSchema({ properties: { city: { type: "string" } }, required: ["city"] }),
      ),
      tool(
        "add",
        objectSchema({
          properties: { a: { type: "number" }, b: { type: "number" } },
          required: ["a", "b"],
        }),
      ),
    ];
    const violationCase = (
      id: string,
      toolName: string,
      input: JsonObject,
      expected: boolean,
    ): TestCaseSpec => ({
      id,
      name: id,
      operation: { type: "callTool", tool: toolName, input },
      assertions: [{ type: "isError", expected }],
    });
    const suite = suiteOf(
      violationCase("get-weather-success", "get_weather", { city: "example" }, false),
      violationCase("get-weather-missing-city", "get_weather", {}, true),
      violationCase("get-weather-type-city", "get_weather", { city: 0 }, true),
      violationCase("add-success", "add", { a: 0, b: 0 }, false),
      violationCase("add-missing-a", "add", { b: 0 }, true),
      violationCase("add-missing-b", "add", { a: 0 }, true),
      violationCase("add-type-a", "add", { a: "example", b: 0 }, true),
      violationCase("add-type-b", "add", { a: 0, b: "example" }, true),
    );
    expect(checkInputContract({ suite, tools: sampleTools })).toEqual({
      findings: [],
      totalFindings: 0,
    });
  });
});
