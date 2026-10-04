import {
  BEHAVIOR_RULES,
  DESC_RULES,
  FLOW_RULES,
  LAUNCH_RULES,
  NETWORK_RULES,
  PROTOCOL_RULES,
  RESULT_RULES,
  SCHEMA_RULES,
  SECRET_RULES,
  SURFACE_RULES,
} from "@mcpeak/audit";
import { describe, expect, it } from "vitest";
import { riskOf } from "../src/analyze/risk-text.js";

/** `@mcpeak/audit` 가 가진 규칙 전부. 규칙이 늘면 이 목록도 따라 늘어난다. */
const ALL_RULES = [
  ...DESC_RULES,
  ...SCHEMA_RULES,
  ...LAUNCH_RULES,
  ...PROTOCOL_RULES,
  ...SURFACE_RULES,
  ...SECRET_RULES,
  ...RESULT_RULES,
  ...FLOW_RULES,
  ...BEHAVIOR_RULES,
  ...NETWORK_RULES,
];

/** 사용자에게 무엇을 하라고 시키는 말. 위험 설명은 설명만 한다. */
const IMPERATIVES = [
  "하세요",
  "마세요",
  "고치",
  "바꾸세요",
  "빼세요",
  "쓰세요",
  "확인하세요",
  "알리세요",
];

describe("riskOf", () => {
  it("audit 의 규칙 목록이 비어 있지 않다", () => {
    expect(ALL_RULES.length).toBeGreaterThan(40);
  });

  it.each(ALL_RULES.map((rule) => rule.id))("%s 에 규칙 전용 문장이 있다", (id) => {
    const family = id.slice(0, id.indexOf("/"));
    const risk = riskOf(id);
    expect(
      risk,
      `'${id}' 의 위험 설명이 없습니다. risk-text.ts 의 RISK_BY_RULE 에 더하세요.`,
    ).not.toBeNull();
    // 가족 문장으로 떨어지지 않았다. 같은 가족의 모르는 규칙이 받는 문장과 달라야 한다.
    expect(
      risk,
      `'${id}' 가 가족 문장으로 떨어졌습니다. risk-text.ts 의 RISK_BY_RULE 에 전용 문장을 더하세요.`,
    ).not.toBe(riskOf(`${family}/__unknown__`));
  });

  it.each(ALL_RULES.map((rule) => rule.id))("%s 의 문장은 고치라고 말하지 않는다", (id) => {
    const risk = riskOf(id) ?? "";
    for (const word of IMPERATIVES) {
      expect(
        risk.includes(word),
        `'${id}' 의 위험 설명에 명령문 '${word}' 가 있습니다: ${risk}`,
      ).toBe(false);
    }
    expect(risk.includes("—")).toBe(false);
  });

  it("모르는 규칙은 가족 문장을 낸다", () => {
    expect(riskOf("desc/__unknown__")).toBe(
      "도구 설명은 AI 모델이 그대로 읽습니다. 설명에 든 내용이 모델의 행동을 바꿀 수 있습니다.",
    );
  });

  it("모르는 가족은 null 이다", () => {
    expect(riskOf("nope/x")).toBeNull();
    expect(riskOf("no-slash")).toBeNull();
    expect(riskOf("")).toBeNull();
  });

  it("같은 입력은 같은 결과다", () => {
    expect(riskOf("desc/injection")).toBe(riskOf("desc/injection"));
  });
});
