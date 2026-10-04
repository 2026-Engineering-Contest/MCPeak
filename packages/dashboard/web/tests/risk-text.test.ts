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
import { type RiskSubject, riskOf } from "../src/analyze/risk-text.js";

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

/** 규칙의 기본 심각도로 온, 변형이 아닌 발견. */
function plain(ruleId: string): RiskSubject {
  const severity = ALL_RULES.find((rule) => rule.id === ruleId)?.defaultSeverity ?? "medium";
  return { ruleId, severity, message: "" };
}

/**
 * 같은 규칙 id 로 오지만 뜻이 다른 발견. 심각도와 메시지는 `@mcpeak/audit` 의 규칙 코드가 내는 그대로다
 * (`rules/protocol.ts`, `rules/schema.ts`, `rules/behavior.ts`).
 */
const VARIANTS: readonly { readonly name: string; readonly subject: RiskSubject }[] = [
  {
    name: "로컬호스트의 평문 HTTP",
    subject: {
      ruleId: "protocol/plaintext",
      severity: "info",
      message: "평문 HTTP 로 연결합니다: http://127.0.0.1:3000/mcp",
    },
  },
  {
    name: "인증 헤더 없이 점검한 서버",
    subject: {
      ruleId: "protocol/unauthenticated",
      severity: "info",
      message: "인증 없이 열려 있습니다. 로컬 전용이면 정상입니다",
    },
  },
  {
    name: "판정하지 못한 인증 검사",
    subject: {
      ruleId: "protocol/unauthenticated",
      severity: "info",
      message: "확인 안 함: 인증 없이 initialize 를 받아들이는지 판정하지 못했습니다 (시간 초과)",
    },
  },
  {
    name: "판정하지 못한 Origin 검사",
    subject: {
      ruleId: "protocol/origin-check",
      severity: "info",
      message: "확인 안 함: 임의 Origin 의 요청을 거르는지 판정하지 못했습니다 (시간 초과)",
    },
  },
  {
    name: "읽지 못한 OAuth 메타데이터",
    subject: {
      ruleId: "protocol/oauth-endpoint",
      severity: "info",
      message:
        "확인 안 함: OAuth 메타데이터 https://x.test/.well-known/oauth-authorization-server 를 읽지 못했습니다 (시간 초과)",
    },
  },
  {
    name: "인증용 도구의 비밀값 인자",
    subject: {
      ruleId: "schema/secret-field",
      severity: "info",
      message: "비밀값을 인자로 요구합니다: 'password'",
    },
  },
  {
    name: "destructiveHint 가 false 인 도구의 삭제",
    subject: {
      ruleId: "behavior/annotation-violation",
      severity: "high",
      message: "destructiveHint 가 false 인데 호출 중 ~/notes.txt 를 지우려 했습니다",
    },
  },
];

describe("riskOf", () => {
  it("audit 의 규칙 목록이 비어 있지 않다", () => {
    expect(ALL_RULES.length).toBeGreaterThan(40);
  });

  it.each(ALL_RULES.map((rule) => rule.id))("%s 에 규칙 전용 문장이 있다", (id) => {
    const family = id.slice(0, id.indexOf("/"));
    const risk = riskOf(plain(id));
    expect(
      risk,
      `'${id}' 의 위험 설명이 없습니다. risk-text.ts 의 RISK_BY_RULE 에 더하세요.`,
    ).not.toBeNull();
    // 가족 문장으로 떨어지지 않았다. 같은 가족의 모르는 규칙이 받는 문장과 달라야 한다.
    expect(
      risk,
      `'${id}' 가 가족 문장으로 떨어졌습니다. risk-text.ts 의 RISK_BY_RULE 에 전용 문장을 더하세요.`,
    ).not.toBe(riskOf(plain(`${family}/__unknown__`)));
  });

  it.each(ALL_RULES.map((rule) => rule.id))("%s 의 문장은 고치라고 말하지 않는다", (id) => {
    const risk = riskOf(plain(id)) ?? "";
    for (const word of IMPERATIVES) {
      expect(
        risk.includes(word),
        `'${id}' 의 위험 설명에 명령문 '${word}' 가 있습니다: ${risk}`,
      ).toBe(false);
    }
    expect(risk.includes("—")).toBe(false);
  });

  describe("같은 규칙 id 의 변형", () => {
    it.each(VARIANTS)("$name 은 기본 발견과 다른 문장을 받는다", ({ subject }) => {
      const risk = riskOf(subject);
      expect(risk).not.toBeNull();
      expect(
        risk,
        `'${subject.ruleId}' 의 변형이 기본 문장을 그대로 받았습니다. risk-text.ts 의 RISK_VARIANTS 를 보세요.`,
      ).not.toBe(riskOf(plain(subject.ruleId)));
    });

    it.each(VARIANTS)("$name 의 문장은 고치라고 말하지 않는다", ({ subject }) => {
      const risk = riskOf(subject) ?? "";
      for (const word of IMPERATIVES) {
        expect(risk.includes(word), `명령문 '${word}' 가 있습니다: ${risk}`).toBe(false);
      }
      expect(risk.includes("—")).toBe(false);
    });

    it("로컬호스트의 평문 HTTP 는 내용이 컴퓨터 밖으로 나가지 않는다고 말한다", () => {
      expect(riskOf(VARIANTS[0]?.subject as RiskSubject)).toBe(
        "암호화되지 않은 HTTP 로 연결하지만 대상이 이 컴퓨터 안의 주소입니다. 주고받는 내용이 이 컴퓨터 밖으로 나가지 않아 보통은 문제가 되지 않습니다.",
      );
    });

    it("판정하지 못한 검사는 규칙이 달라도 같은 문장이고 위험이 발견됐다고 말하지 않는다", () => {
      const unverified = VARIANTS.filter(({ subject }) =>
        subject.message.startsWith("확인 안 함:"),
      );
      expect(unverified).toHaveLength(3);
      for (const { subject } of unverified) {
        expect(riskOf(subject), subject.ruleId).toBe(
          "이 항목은 점검하지 못했습니다. 문제가 있는지 없는지 알 수 없다는 뜻이고, 위험이 발견된 것은 아닙니다.",
        );
      }
    });

    it("인증 검사는 받아들인 경우와 헤더 없이 점검한 경우를 가른다", () => {
      expect(
        riskOf({
          ruleId: "protocol/unauthenticated",
          severity: "medium",
          message: "인증 헤더 없이도 initialize 를 받아들입니다",
        }),
      ).toBe(riskOf(plain("protocol/unauthenticated")));
    });

    it("readOnlyHint 를 어긴 발견은 기본 문장을 받는다", () => {
      expect(
        riskOf({
          ruleId: "behavior/annotation-violation",
          severity: "high",
          message: "readOnlyHint 가 true 인데 호출 중 프로세스를 띄웠습니다: sh -c id",
        }),
      ).toBe(riskOf(plain("behavior/annotation-violation")));
    });

    it("변형이 없는 규칙은 심각도와 메시지가 달라도 같은 문장이다", () => {
      expect(
        riskOf({ ruleId: "desc/injection", severity: "info", message: "확인 안 함: 아무 글자" }),
      ).toBe(riskOf(plain("desc/injection")));
    });
  });

  it("규칙 목록에 없는 surface/environment-dependent 도 전용 문장을 받는다", () => {
    const risk = riskOf({
      ruleId: "surface/environment-dependent",
      severity: "high",
      message: "",
    });
    expect(risk).toBe(
      "MCP 가 격리된 점검 환경과 이 컴퓨터에서 서로 다른 도구 정의를 내주었습니다. 점검받을 때와 실제로 쓸 때 다른 모습을 보인다는 뜻이고, 이 점검 결과가 실제 동작을 대변하지 못합니다.",
    );
  });

  it("모르는 규칙은 가족 문장을 낸다", () => {
    expect(riskOf(plain("desc/__unknown__"))).toBe(
      "도구 설명은 AI 모델이 그대로 읽습니다. 설명에 든 내용이 모델의 행동을 바꿀 수 있습니다.",
    );
  });

  it("모르는 가족은 null 이다", () => {
    expect(riskOf(plain("nope/x"))).toBeNull();
    expect(riskOf(plain("no-slash"))).toBeNull();
    expect(riskOf(plain(""))).toBeNull();
  });

  it("같은 입력은 같은 결과다", () => {
    expect(riskOf(plain("desc/injection"))).toBe(riskOf(plain("desc/injection")));
  });
});
