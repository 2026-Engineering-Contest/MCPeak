import type { AuditReport, Finding, RuleInfo, SandboxReport } from "@mcpeak/audit";
import * as realAudit from "@mcpeak/audit";
import { describe, expect, it } from "vitest";
import { passedRules, RULE_CATALOG_KEYS, ruleCatalog } from "../src/server/passed-rules.js";

function rule(id: RuleInfo["id"], summary: string = id): RuleInfo {
  const family = id.slice(0, id.indexOf("/")) as RuleInfo["family"];
  return { id, family, defaultSeverity: "low", summary };
}

function finding(ruleId: Finding["ruleId"]): Finding {
  return {
    ruleId,
    severity: "high",
    location: { kind: "server", path: "" },
    message: ruleId,
    fix: "",
    evidence: [],
  };
}

/** 통과 계산이 읽는 필드(findings·skipped·sandbox)만 바꾼다. 나머지는 고정이다. */
function report(
  overrides: {
    readonly findings?: readonly Finding[];
    readonly skipped?: AuditReport["skipped"];
    readonly sandbox?: SandboxReport;
  } = {},
): AuditReport {
  return {
    schemaVersion: 1,
    generator: { name: "@mcpeak/audit", version: "0.0.0" },
    server: {
      name: "sample",
      version: "1.0.0",
      toolCount: 1,
      promptCount: 0,
      resourceCount: 0,
      hasInstructions: false,
      capabilityKeys: ["tools"],
    },
    probe: "readonly",
    probedTools: [],
    ...(overrides.sandbox === undefined ? {} : { sandbox: overrides.sandbox }),
    findings: overrides.findings ?? [],
    skipped: overrides.skipped ?? [],
    counts: { high: 0, medium: 0, low: 0, info: 0 },
    exitCode: 0,
  };
}

const CATALOG: readonly RuleInfo[] = [
  rule("desc/injection", "설명에 지시문이 있는지 본다."),
  rule("desc/hidden-unicode", "보이지 않는 문자를 본다."),
  rule("surface/changed", "기준 파일과 비교한다."),
  rule("result/oversized", "결과 크기를 본다."),
];

/** 격리 관측 규칙이 섞인 카탈로그. 행위·네트워크 규칙은 격리가 실제로 돈 실행에서만 통과 후보다. */
const OBSERVED_CATALOG: readonly RuleInfo[] = [
  rule("desc/injection"),
  rule("behavior/child-process"),
  rule("network/undeclared-destination"),
];

const RAN: SandboxReport = {
  status: "ran",
  backend: "docker",
  image: "mcpeak-audit:abc",
  network: "live",
  compareHost: false,
  callCount: 1,
  declaredHosts: [],
  requests: [],
};

describe("passedRules", () => {
  it("sandbox 가 없으면 behavior·network 규칙은 통과가 아니다", () => {
    expect(passedRules(report(), OBSERVED_CATALOG).map((p) => p.id)).toEqual(["desc/injection"]);
  });

  it("sandbox 가 unavailable 이면 behavior·network 규칙은 통과가 아니다", () => {
    const out = passedRules(
      report({
        sandbox: { status: "unavailable", reason: { code: "daemon-down", detail: "" } },
      }),
      OBSERVED_CATALOG,
    );
    expect(out.map((p) => p.id)).toEqual(["desc/injection"]);
  });

  it("격리가 실제로 돌았고 발견이 없으면 behavior·network 규칙도 통과다", () => {
    expect(passedRules(report({ sandbox: RAN }), OBSERVED_CATALOG).map((p) => p.id)).toEqual([
      "desc/injection",
      "behavior/child-process",
      "network/undeclared-destination",
    ]);
  });

  it("실제 카탈로그로도 격리 없는 실행에는 behavior·network 통과가 없다", () => {
    const out = passedRules(report(), ruleCatalog(realAudit));
    expect(out.some((p) => p.family === "behavior" || p.family === "network")).toBe(false);
    const ran = passedRules(report({ sandbox: RAN }), ruleCatalog(realAudit));
    expect(ran.some((p) => p.family === "behavior")).toBe(true);
    expect(ran.some((p) => p.family === "network")).toBe(true);
  });

  it("발견도 건너뜀도 없으면 카탈로그 전부가 통과다", () => {
    expect(passedRules(report(), CATALOG)).toEqual([
      { id: "desc/injection", family: "desc", summary: "설명에 지시문이 있는지 본다." },
      { id: "desc/hidden-unicode", family: "desc", summary: "보이지 않는 문자를 본다." },
      { id: "surface/changed", family: "surface", summary: "기준 파일과 비교한다." },
      { id: "result/oversized", family: "result", summary: "결과 크기를 본다." },
    ]);
  });

  it("skipped 에 있는 family 의 규칙은 통과가 아니다", () => {
    const out = passedRules(
      report({ skipped: [{ family: "surface", reason: "--baseline 을 주지 않았습니다." }] }),
      CATALOG,
    );
    expect(out.map((p) => p.id)).toEqual([
      "desc/injection",
      "desc/hidden-unicode",
      "result/oversized",
    ]);
  });

  it("findings 에 있는 ruleId 는 빠지고 같은 family 의 다른 규칙은 남는다", () => {
    const out = passedRules(report({ findings: [finding("desc/hidden-unicode")] }), CATALOG);
    expect(out.map((p) => p.id)).toEqual(["desc/injection", "surface/changed", "result/oversized"]);
  });

  it("같은 ruleId 의 발견이 여럿이어도 한 번만 뺀다", () => {
    const out = passedRules(
      report({ findings: [finding("result/oversized"), finding("result/oversized")] }),
      CATALOG,
    );
    expect(out.map((p) => p.id)).toEqual([
      "desc/injection",
      "desc/hidden-unicode",
      "surface/changed",
    ]);
  });

  it("순서는 카탈로그 순서이고 findings 순서와 무관하다", () => {
    const out = passedRules(
      report({ findings: [finding("surface/changed"), finding("desc/injection")] }),
      [...CATALOG].reverse(),
    );
    expect(out.map((p) => p.id)).toEqual(["result/oversized", "desc/hidden-unicode"]);
  });

  it("같은 입력이면 JSON.stringify 가 같다", () => {
    const input = report({
      findings: [finding("desc/injection")],
      skipped: [{ family: "result", reason: "호출하지 않았습니다." }],
    });
    expect(JSON.stringify(passedRules(input, CATALOG))).toBe(
      JSON.stringify(passedRules(input, CATALOG)),
    );
  });

  it("결과에는 id·family·summary 만 있다", () => {
    const [first] = passedRules(report(), CATALOG);
    expect(Object.keys(first ?? {})).toEqual(["id", "family", "summary"]);
  });
});

describe("ruleCatalog", () => {
  it("audit 가 공개하는 RULES 상수를 정한 순서대로 이은 것이다", () => {
    expect(RULE_CATALOG_KEYS).toEqual([
      "DESC_RULES",
      "SCHEMA_RULES",
      "LAUNCH_RULES",
      "PROTOCOL_RULES",
      "SURFACE_RULES",
      "SECRET_RULES",
      "RESULT_RULES",
      "FLOW_RULES",
      "BEHAVIOR_RULES",
      "NETWORK_RULES",
    ]);
    const catalog = ruleCatalog(realAudit);
    // 규칙 id 는 카탈로그 안에서 유일하다. 겹치면 통과 목록에 같은 줄이 두 번 나온다.
    expect(new Set(catalog.map((r) => r.id)).size).toBe(catalog.length);
    expect(catalog.length).toBeGreaterThan(0);
  });

  it("실제 카탈로그로도 skipped family 는 통째로 빠진다", () => {
    const out = passedRules(
      report({ skipped: [{ family: "surface", reason: "x" }] }),
      ruleCatalog(realAudit),
    );
    expect(out.some((p) => p.family === "surface")).toBe(false);
    expect(out.some((p) => p.id === "desc/hidden-unicode")).toBe(true);
  });
});
