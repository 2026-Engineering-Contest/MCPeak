import { readFileSync } from "node:fs";
import type { ToolDef } from "@mcpeak/core";
import { validateMcpSuite } from "@mcpeak/runner";
import { describe, expect, it } from "vitest";
import {
  BASELINE_POLICY_VERSION,
  createBaselineSuite,
  DEFAULT_BASELINE_TIMEOUT_MS,
  GenerateTestsError,
  sha256,
} from "../src/index.js";

const tools: ToolDef[] = [
  {
    name: "get_weather",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
  {
    name: "add",
    inputSchema: {
      type: "object",
      properties: { value: { type: "integer", examples: [2] } },
      required: ["value"],
    },
  },
];

const fixturePath = new URL("../../../fixtures/tools-list.sample.json", import.meta.url);

function fixtureTools(): ToolDef[] {
  return (JSON.parse(readFileSync(fixturePath, "utf8")) as { tools: ToolDef[] }).tools;
}

describe("createBaselineSuite", () => {
  it("fixtures 두 툴로 만든 baseline 은 케이스 8개다", () => {
    const result = createBaselineSuite(fixtureTools(), {
      suiteId: "weather",
      suiteName: "Weather",
    });
    expect(result.suite.cases.map((item) => item.id)).toEqual([
      "get-weather-success",
      "get-weather-missing-city",
      "get-weather-type-city",
      "add-success",
      "add-missing-a",
      "add-missing-b",
      "add-type-a",
      "add-type-b",
    ]);
  });

  it("정책 버전이 v2 다", () => {
    expect(BASELINE_POLICY_VERSION).toBe("schema-baseline-v2");
  });

  /**
   * 미지원 키워드 툴의 격리. 도그푸딩 실측: 공식 서버 7개 중 5개가 툴 하나의
   * maximum·minItems·exclusiveMaximum·anyOf 때문에 전체 거절됐다. 그 툴만 건너뛰고
   * 나머지를 생성하면 다섯 서버가 전부 후보로 돌아온다.
   */
  describe("미지원 스키마 툴 건너뛰기", () => {
    const unsupported: ToolDef = {
      name: "count_things",
      inputSchema: {
        type: "object",
        // maximum 은 이제 지원한다. 부분 생성 자체는 살아 있어야 하므로 여전히 지원하지
        // 않는 키워드(pattern)로 바꿔 유지한다.
        properties: { count: { type: "string", pattern: "^a$" } },
        required: ["count"],
      },
    };

    it("미지원 키워드 툴만 빼고 생성하고 건너뛴 사실을 결과에 싣는다", () => {
      const result = createBaselineSuite([tools[0] as ToolDef, unsupported], {
        suiteId: "mixed",
        suiteName: "Mixed",
      });
      expect(result.suite.cases.map((c) => c.id)).toEqual([
        "get-weather-success",
        "get-weather-missing-city",
        "get-weather-type-city",
      ]);
      expect(result.skippedTools).toEqual([
        {
          index: 1,
          name: "count_things",
          path: "tools[1].inputSchema.properties.count.pattern",
          message: "지원하지 않는 JSON Schema 키워드 'pattern'가 있습니다.",
        },
      ]);
    });

    it("커버리지는 생성한 툴만 센다", () => {
      const result = createBaselineSuite([tools[0] as ToolDef, unsupported], {
        suiteId: "mixed",
        suiteName: "Mixed",
      });
      expect(result.coverage.tools.map((t) => t.tool)).toEqual(["get_weather"]);
      expect(result.coverage.verified).toBe(result.coverage.total);
    });

    it("이름이 같은 지원 툴과 미지원 툴을 인덱스로 구분한다", () => {
      // 소비자가 이름으로 제외하면 동명의 지원 툴 커버리지까지 사라진다. computeCoverage 는
      // 중복 이름을 duplicateTool 로 명시 처리하므로 중복은 이 저장소가 실제로 다루는 경우다.
      const sameName: ToolDef = { ...unsupported, name: "get_weather" };
      const result = createBaselineSuite([tools[0] as ToolDef, sameName], {
        suiteId: "dup",
        suiteName: "Dup",
      });
      expect(result.skippedTools.map((tool) => tool.index)).toEqual([1]);
      expect(result.coverage.tools.map((tool) => tool.tool)).toEqual(["get_weather"]);
    });

    it("전 툴이 미지원이면 종전대로 던진다", () => {
      expect(() =>
        createBaselineSuite([unsupported], { suiteId: "none", suiteName: "None" }),
      ).toThrow(GenerateTestsError);
    });

    it("건너뛴 툴이 있어도 전 툴 지원 서버의 지문은 바뀌지 않는다", () => {
      // 건너뜀 정보는 suite 밖에 실린다. 전 툴 지원 서버의 출력 바이트가 같아야
      // 기존 승인 지문이 깨지지 않는다(#88).
      const before = createBaselineSuite(tools, { suiteId: "s", suiteName: "S" });
      const again = createBaselineSuite(tools, { suiteId: "s", suiteName: "S" });
      expect(again.baselineFingerprint).toBe(before.baselineFingerprint);
      expect(again.skippedTools).toEqual([]);
    });

    it("UNSUPPORTED_SCHEMA 가 아닌 오류는 격리하지 않고 그대로 던진다", () => {
      const broken: ToolDef = { name: "", inputSchema: { type: "object" } } as ToolDef;
      expect(() =>
        createBaselineSuite([tools[0] as ToolDef, broken], { suiteId: "s", suiteName: "S" }),
      ).toThrow(GenerateTestsError);
    });
  });

  it("baseline 결과에 커버리지가 실리고 전부 검증된다", () => {
    const result = createBaselineSuite(fixtureTools(), {
      suiteId: "weather",
      suiteName: "Weather",
    });
    expect(result.coverage.verified).toBe(result.coverage.total);
    expect(result.coverage.total).toBe(8);
  });

  it("범위와 format 이 있는 툴도 baselineFingerprint 가 재현된다", () => {
    const ranged: ToolDef[] = [
      {
        name: "t",
        inputSchema: {
          type: "object",
          required: ["count", "url", "tags"],
          properties: {
            count: { type: "integer", minimum: 1, maximum: 10 },
            url: { type: "string", format: "uri" },
            tags: { type: "array", items: { type: "string" }, minItems: 2 },
          },
        },
      },
    ];
    const first = createBaselineSuite(ranged, { suiteId: "s", suiteName: "s" });
    const second = createBaselineSuite(ranged, { suiteId: "s", suiteName: "s" });
    expect(first.baselineFingerprint).toBe(second.baselineFingerprint);
    expect(JSON.stringify(first.suite)).toBe(JSON.stringify(second.suite));
    expect(JSON.stringify(first.suite)).toContain('"count":1');
    expect(JSON.stringify(first.suite)).toContain('"url":"https://example.com"');
  });

  it("provenance 를 더해도 명세 파일은 그대로다", () => {
    // 출처는 명세 파일에 들어가지 않으므로 지문 계산 대상이 아니다.
    const t: ToolDef[] = [
      {
        name: "t",
        inputSchema: { type: "object", required: ["v"], properties: { v: { type: "string" } } },
      },
    ];
    const result = createBaselineSuite(t, { suiteId: "s", suiteName: "s" });
    expect(JSON.stringify(result.suite)).not.toContain("provenance");
    expect(JSON.stringify(result.suite)).not.toContain("placeholder");
    expect(result.provenance).toEqual([
      { tool: "t", declared: 0, placeholder: 1, unknownFormatFields: [], needsAssist: true },
    ]);
  });

  it("건너뛴 툴은 provenance 에 들어가지 않는다", () => {
    const skipped: ToolDef = {
      name: "count_things",
      inputSchema: {
        type: "object",
        properties: { count: { type: "string", pattern: "^a$" } },
        required: ["count"],
      },
    };
    const result = createBaselineSuite([tools[0] as ToolDef, skipped], {
      suiteId: "mixed",
      suiteName: "Mixed",
    });
    expect(result.provenance.map((item) => item.tool)).toEqual(["get_weather"]);
  });

  it("생성한 suite 가 validateMcpSuite 를 통과한다", () => {
    const result = createBaselineSuite(fixtureTools(), {
      suiteId: "weather",
      suiteName: "Weather",
    });
    expect(validateMcpSuite(result.suite).valid).toBe(true);
  });

  it("두 번 만든 suite 가 바이트로 같다", () => {
    const options = { suiteId: "weather", suiteName: "Weather" };
    expect(JSON.stringify(createBaselineSuite(fixtureTools(), options).suite)).toBe(
      JSON.stringify(createBaselineSuite(fixtureTools(), options).suite),
    );
  });

  it("툴 순서대로 한 baseline suite와 case를 만든다", () => {
    const result = createBaselineSuite(tools, { suiteId: "weather", suiteName: "날씨" });

    expect(result.suite).toMatchObject({
      schemaVersion: 1,
      id: "weather",
      name: "날씨",
      defaultTimeoutMs: DEFAULT_BASELINE_TIMEOUT_MS,
    });
    // 툴마다 정상 케이스 1개와 위반 케이스가 따라온다(§5.2). 툴 순서는 그대로다.
    expect(result.suite.cases.map((testCase) => testCase.operation)).toEqual([
      { type: "callTool", tool: "get_weather", input: { city: "example" } },
      { type: "callTool", tool: "get_weather", input: {} },
      { type: "callTool", tool: "get_weather", input: { city: 0 } },
      { type: "callTool", tool: "add", input: { value: 2 } },
      { type: "callTool", tool: "add", input: {} },
      { type: "callTool", tool: "add", input: { value: 1.5 } },
    ]);
    // 정상 케이스는 isError false, 위반 케이스는 isError true 하나씩이다.
    expect(result.suite.cases.map((testCase) => [testCase.id, testCase.assertions])).toEqual([
      ["get-weather-success", [{ type: "isError", expected: false }]],
      ["get-weather-missing-city", [{ type: "isError", expected: true }]],
      ["get-weather-type-city", [{ type: "isError", expected: true }]],
      ["add-success", [{ type: "isError", expected: false }]],
      ["add-missing-value", [{ type: "isError", expected: true }]],
      ["add-type-value", [{ type: "isError", expected: true }]],
    ]);
    expect(validateMcpSuite(result.suite).valid).toBe(true);
  });

  it("명시한 baseline timeout과 suite identity를 보존한다", () => {
    expect(
      createBaselineSuite(tools, {
        suiteId: "server-id",
        suiteName: "서버 이름",
        defaultTimeoutMs: 30_000,
      }).suite,
    ).toMatchObject({ id: "server-id", name: "서버 이름", defaultTimeoutMs: 30_000 });

    for (const options of [
      { suiteId: "", suiteName: "valid" },
      { suiteId: "valid", suiteName: "" },
      { suiteId: "valid", suiteName: "valid", defaultTimeoutMs: 0 },
    ]) {
      expect(() => createBaselineSuite(tools, options)).toThrow(GenerateTestsError);
    }
  });

  it("같은 입력과 정책에 같은 fingerprint를 만든다", () => {
    const first = createBaselineSuite(tools, { suiteId: "weather", suiteName: "날씨" });
    const sameSchemaDifferentKeyOrder: ToolDef[] = [
      {
        name: "get_weather",
        inputSchema: {
          required: ["city"],
          properties: { city: { type: "string" } },
          type: "object",
        },
      },
      tools[1] as ToolDef,
    ];
    const second = createBaselineSuite(sameSchemaDifferentKeyOrder, {
      suiteId: "weather",
      suiteName: "날씨",
    });

    expect(first).toEqual(second);
    expect(first.policyVersion).toBe(BASELINE_POLICY_VERSION);
    expect(first.suiteFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first.baselineFingerprint).toBe(second.baselineFingerprint);
  });

  it("baseline 결과와 중첩 suite를 재귀 동결한다", () => {
    const source = structuredClone(tools);
    const result = createBaselineSuite(source, { suiteId: "weather", suiteName: "날씨" });
    (
      source[0] as { inputSchema: { properties: { city: { type: string } } } }
    ).inputSchema.properties.city.type = "number";

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.suite)).toBe(true);
    expect(Object.isFrozen(result.suite.cases)).toBe(true);
    const firstCase = result.suite.cases[0];
    if (firstCase?.operation.type !== "callTool") throw new Error("callTool case가 필요합니다.");
    expect(Object.isFrozen(firstCase.operation.input)).toBe(true);
    expect(Object.isFrozen(result.suite.cases[0]?.assertions)).toBe(true);
    expect(result.suite.cases[0]?.operation).toEqual({
      type: "callTool",
      tool: "get_weather",
      input: { city: "example" },
    });
  });

  it("지원하지 않는 schema는 그 툴만 건너뛰고 위치를 알린다", () => {
    // 종전에는 전체를 거절했다. 툴 단위 격리로 바꾼 이유와 근거는 ADR-0004 개정 단락.
    const result = createBaselineSuite(
      [
        tools[0] as ToolDef,
        {
          name: "invalid",
          // minLength 는 이제 지원한다. 여전히 막히는 키워드로 바꿔 유지한다.
          inputSchema: { type: "object", properties: { q: { type: "string", pattern: "^a$" } } },
        },
      ],
      { suiteId: "weather", suiteName: "날씨" },
    );
    expect(
      result.suite.cases.every(
        (c) => c.operation.type === "callTool" && c.operation.tool === "get_weather",
      ),
    ).toBe(true);
    expect(result.skippedTools).toEqual([
      {
        index: 1,
        name: "invalid",
        path: "tools[1].inputSchema.properties.q.pattern",
        message: "지원하지 않는 JSON Schema 키워드 'pattern'가 있습니다.",
      },
    ]);
  });

  it("Runner 계약을 복사하지 않고 package dependency로 소비한다", () => {
    const result = createBaselineSuite(tools, { suiteId: "weather", suiteName: "날씨" });
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(validateMcpSuite(result.suite)).toMatchObject({ valid: true });
    expect(packageJson.dependencies?.["@mcpeak/runner"]).toBe("workspace:*");
  });

  // sha256 자체의 동작 단언은 packages/runner/tests/canonical.test.ts 로 옮겼다.
  // 구현이 runner 로 이관됐기 때문이다. 아래는 baseline 이 그 함수로 지문을 만든다는
  // baseline 자신의 단언이라 여기 남긴다.
  it("baseline의 suiteFingerprint는 suite의 sha256과 같다", () => {
    const suite = createBaselineSuite(tools, { suiteId: "weather", suiteName: "날씨" }).suite;
    expect(sha256(suite)).toBe(
      suite &&
        createBaselineSuite(tools, {
          suiteId: "weather",
          suiteName: "날씨",
        }).suiteFingerprint,
    );
  });
});
