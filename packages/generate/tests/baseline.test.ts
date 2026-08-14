import { readFileSync } from "node:fs";
import type { ToolDef } from "@ohmymcp/core";
import { validateMcpSuite } from "@ohmymcp/runner";
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

describe("createBaselineSuite", () => {
  it("툴 순서대로 한 baseline suite와 case를 만든다", () => {
    const result = createBaselineSuite(tools, { suiteId: "weather", suiteName: "날씨" });

    expect(result.suite).toMatchObject({
      schemaVersion: 1,
      id: "weather",
      name: "날씨",
      defaultTimeoutMs: DEFAULT_BASELINE_TIMEOUT_MS,
    });
    expect(result.suite.cases.map((testCase) => testCase.operation)).toEqual([
      { type: "callTool", tool: "get_weather", input: { city: "example" } },
      { type: "callTool", tool: "add", input: { value: 2 } },
    ]);
    expect(
      result.suite.cases.every(
        (testCase) =>
          testCase.assertions[0]?.type === "isError" && testCase.assertions[0].expected === false,
      ),
    ).toBe(true);
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

  it("지원하지 않는 schema는 어떤 산출물보다 먼저 거절한다", () => {
    expect(() =>
      createBaselineSuite(
        [
          tools[0] as ToolDef,
          {
            name: "invalid",
            inputSchema: { type: "object", properties: { q: { type: "string", minLength: 1 } } },
          },
        ],
        { suiteId: "weather", suiteName: "날씨" },
      ),
    ).toThrow(
      expect.objectContaining({
        code: "UNSUPPORTED_SCHEMA",
        path: "tools[1].inputSchema.properties.q.minLength",
      }),
    );
  });

  it("Runner 계약을 복사하지 않고 package dependency로 소비한다", () => {
    const result = createBaselineSuite(tools, { suiteId: "weather", suiteName: "날씨" });
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(validateMcpSuite(result.suite)).toMatchObject({ valid: true });
    expect(packageJson.dependencies?.["@ohmymcp/runner"]).toBe("workspace:*");
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
