import { describe, expect, it } from "vitest";
import { suiteFingerprint, type TestSuiteSpec } from "../src/index.js";

const FINGERPRINT = "a".repeat(64);

const baseSuite = (): TestSuiteSpec => ({
  schemaVersion: 1,
  id: "weather",
  name: "날씨 서버 회귀",
  defaultTimeoutMs: 5_000,
  cases: [
    {
      id: "tools",
      name: "툴 목록",
      operation: { type: "listTools" },
      assertions: [{ type: "toolExists", tool: "get_weather" }],
    },
    {
      id: "call",
      name: "호출",
      operation: { type: "callTool", tool: "get_weather", input: { city: "서울" } },
      assertions: [{ type: "isError", expected: false }],
    },
  ],
});

describe("suiteFingerprint", () => {
  it("반환이 /^[0-9a-f]{64}$/ 를 만족한다", () => {
    expect(suiteFingerprint(baseSuite())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("approval 이 없는 suite 와 approval 을 붙인 같은 suite 의 지문이 같다", () => {
    // 승인 이전에 계산한 값과 저장 이후에 계산한 값이 같아야 한다. 설계 문서 §4.2.
    expect(suiteFingerprint({ ...baseSuite(), approval: { fingerprint: FINGERPRINT } })).toBe(
      suiteFingerprint(baseSuite()),
    );
  });

  it("approval.fingerprint 값만 다른 두 suite 의 지문이 같다", () => {
    expect(suiteFingerprint({ ...baseSuite(), approval: { fingerprint: FINGERPRINT } })).toBe(
      suiteFingerprint({ ...baseSuite(), approval: { fingerprint: "b".repeat(64) } }),
    );
  });

  it("cases 안의 문자열 한 글자를 바꾸면 지문이 달라진다", () => {
    const changed = baseSuite();
    changed.cases[0] = { ...(changed.cases[0] as TestSuiteSpec["cases"][number]), name: "툴 목룍" };
    expect(suiteFingerprint(changed)).not.toBe(suiteFingerprint(baseSuite()));
  });

  it("name 을 바꾸면 지문이 달라진다", () => {
    expect(suiteFingerprint({ ...baseSuite(), name: "날씨 서버 회귀 2" })).not.toBe(
      suiteFingerprint(baseSuite()),
    );
  });

  it("id 를 바꾸면 지문이 달라진다", () => {
    expect(suiteFingerprint({ ...baseSuite(), id: "weather-2" })).not.toBe(
      suiteFingerprint(baseSuite()),
    );
  });

  it("defaultTimeoutMs 를 바꾸면 지문이 달라진다", () => {
    expect(suiteFingerprint({ ...baseSuite(), defaultTimeoutMs: 5_001 })).not.toBe(
      suiteFingerprint(baseSuite()),
    );
  });

  it("키 순서만 다른 동등한 두 suite 의 지문이 같다", () => {
    const suite = baseSuite();
    const reordered = {
      cases: suite.cases,
      defaultTimeoutMs: suite.defaultTimeoutMs,
      name: suite.name,
      id: suite.id,
      schemaVersion: suite.schemaVersion,
    } as TestSuiteSpec;
    expect(suiteFingerprint(reordered)).toBe(suiteFingerprint(suite));
  });

  it("cases 배열 순서를 바꾸면 지문이 달라진다", () => {
    // 케이스 순서는 상태를 바꾸는 서버에서 결과를 바꾸므로 의미 변경이다. 설계 문서 §4.3.
    const reversed = baseSuite();
    reversed.cases = [...reversed.cases].reverse();
    expect(suiteFingerprint(reversed)).not.toBe(suiteFingerprint(baseSuite()));
  });

  it("같은 suite 로 2회 호출한 결과가 동일하다", () => {
    const suite = baseSuite();
    expect(suiteFingerprint(suite)).toBe(suiteFingerprint(suite));
  });

  it("호출 후 인자 객체가 변형되지 않는다", () => {
    const suite: TestSuiteSpec = { ...baseSuite(), approval: { fingerprint: FINGERPRINT } };
    suiteFingerprint(suite);
    expect(suite.approval).toEqual({ fingerprint: FINGERPRINT });
  });

  it("Object.freeze 한 suite 에 호출해도 던지지 않는다", () => {
    // generate 가 넘기는 draft suite 는 동결돼 있다. delete 로 approval 을 빼면 여기서 깨진다.
    const frozen = Object.freeze({ ...baseSuite(), approval: { fingerprint: FINGERPRINT } });
    expect(() => suiteFingerprint(frozen)).not.toThrow();
  });

  it("깊이 20000 스키마를 담은 suite 에서도 지문을 낸다", () => {
    // validateMcpSuite 가 통과시키는 깊이다. 지문 계산만 죽으면 정상 명세가 실행되지 않는다.
    let schema: Record<string, unknown> = { type: "string" };
    for (let depth = 0; depth < 20_000; depth++)
      schema = { type: "object", properties: { next: schema } };
    const suite = baseSuite();
    suite.cases = [
      {
        id: "body",
        name: "본문",
        operation: { type: "callTool", tool: "get_weather", input: { city: "서울" } },
        assertions: [{ type: "bodyMatchesSchema", schema }],
      } as unknown as TestSuiteSpec["cases"][number],
    ];

    expect(suiteFingerprint(suite)).toMatch(/^[0-9a-f]{64}$/);
  });
});
