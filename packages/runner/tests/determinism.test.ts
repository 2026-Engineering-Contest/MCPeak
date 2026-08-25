import { describe, expect, it } from "vitest";
import {
  checkDeterminism,
  type DeterminismCaseObservation,
  describeDeterminismDifference,
} from "../src/determinism.js";

/** 관찰 픽스처. response 는 키 자체를 생략할 수 있어야 하므로 spread 로 만든다. */
const observation = (
  overrides: Partial<DeterminismCaseObservation> & { readonly response?: unknown },
): DeterminismCaseObservation => ({
  caseId: "case-1",
  caseName: "정상 조회",
  toolName: "get_weather",
  status: "passed",
  assertionStatuses: ["passed"],
  ...overrides,
});

/** 힌트 판정은 첫 차이 지점의 원본 값으로 한다. 값을 content[0].text 자리에 넣는다. */
const withText = (text: unknown): unknown => ({
  content: [{ type: "text", text }],
  isError: false,
  raw: {},
});

describe("checkDeterminism", () => {
  it("모든 케이스가 같고 복원 있음이면 deterministic 을 낸다", () => {
    const both = [
      observation({ caseId: "case-1", response: withText("a") }),
      observation({ caseId: "case-2", response: withText("b") }),
    ];
    const result = checkDeterminism({ first: both, second: both, stateRestored: true });
    expect(result.conclusion).toBe("deterministic");
    expect(result.differences).toHaveLength(0);
    expect(result.compared).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it("모든 케이스가 같고 복원 없음이면 consistentWithoutReset 을 낸다", () => {
    const both = [observation({ response: withText("a") })];
    const result = checkDeterminism({ first: both, second: both, stateRestored: false });
    expect(result.conclusion).toBe("consistentWithoutReset");
    expect(result.differences).toHaveLength(0);
  });

  it("응답 필드 값이 다르면 경로와 양쪽 값을 짚는다", () => {
    const result = checkDeterminism({
      first: [
        observation({ response: { content: [], isError: false, raw: { result: { value: 1 } } } }),
      ],
      second: [
        observation({ response: { content: [], isError: false, raw: { result: { value: 2 } } } }),
      ],
      stateRestored: true,
    });
    expect(result.differences).toHaveLength(1);
    expect(result.differences[0]).toMatchObject({
      kind: "response",
      path: "raw.result.value",
      firstValue: "1",
      secondValue: "2",
    });
    expect(result.conclusion).toBe("nondeterministic");
  });

  it("중첩 배열 원소가 다르면 인덱스 경로를 만든다", () => {
    const result = checkDeterminism({
      first: [observation({ response: withText("a") })],
      second: [observation({ response: withText("b") })],
      stateRestored: true,
    });
    expect(result.differences).toHaveLength(1);
    expect(result.differences[0]).toMatchObject({
      kind: "response",
      path: "content[0].text",
      firstValue: '"a"',
      secondValue: '"b"',
    });
  });

  it("배열 순서만 달라도 차이다", () => {
    const result = checkDeterminism({
      first: [observation({ response: { content: [], isError: false, raw: { items: [1, 2] } } })],
      second: [observation({ response: { content: [], isError: false, raw: { items: [2, 1] } } })],
      stateRestored: true,
    });
    expect(result.differences).toHaveLength(1);
    expect(result.differences[0]?.path).toBe("raw.items[0]");
  });

  it("객체 키 순서만 다르면 차이가 아니다", () => {
    const result = checkDeterminism({
      first: [observation({ response: { b: 2, a: 1 } })],
      second: [observation({ response: { a: 1, b: 2 } })],
      stateRestored: true,
    });
    expect(result.differences).toHaveLength(0);
    expect(result.conclusion).toBe("deterministic");
  });

  it("한쪽에만 있는 키를 짚는다", () => {
    const result = checkDeterminism({
      first: [observation({ response: { raw: { a: 1, extra: "x" } } })],
      second: [observation({ response: { raw: { a: 1 } } })],
      stateRestored: true,
    });
    expect(result.differences).toHaveLength(1);
    expect(result.differences[0]).toMatchObject({
      kind: "response",
      path: "raw.extra",
      firstValue: '"x"',
      secondValue: "(없음)",
    });
  });

  it("status 가 다르면 status 차이만 보고하고 응답은 안 본다", () => {
    const result = checkDeterminism({
      first: [observation({ status: "passed", response: { v: 1 } })],
      second: [observation({ status: "failed", response: { v: 2 } })],
      stateRestored: false,
    });
    expect(result.differences).toHaveLength(1);
    expect(result.differences[0]?.kind).toBe("status");
    expect(result.differences[0]?.path).toBeUndefined();
    expect(result.differences[0]).toMatchObject({ firstValue: "passed", secondValue: "failed" });
  });

  it("단언 status 가 다르면 assertion 차이를 보고한다", () => {
    const result = checkDeterminism({
      first: [observation({ assertionStatuses: ["passed", "passed"], response: withText("a") })],
      second: [observation({ assertionStatuses: ["passed", "failed"], response: withText("a") })],
      stateRestored: true,
    });
    expect(result.differences).toHaveLength(1);
    expect(result.differences[0]).toMatchObject({
      kind: "assertion",
      path: "assertions[1]",
      firstValue: "passed",
      secondValue: "failed",
    });
  });

  it("한쪽만 응답이 없으면 차이다", () => {
    const result = checkDeterminism({
      first: [observation({ response: withText("a") })],
      second: [observation({})],
      stateRestored: true,
    });
    expect(result.differences).toHaveLength(1);
    expect(result.differences[0]?.kind).toBe("response");
    expect(result.differences[0]?.secondValue).toBe("(응답 없음)");
  });

  it("양쪽 다 notRun 이면 제외로 센다", () => {
    const result = checkDeterminism({
      first: [observation({ status: "notRun", assertionStatuses: ["notRun"] })],
      second: [observation({ status: "notRun", assertionStatuses: ["notRun"] })],
      stateRestored: true,
    });
    expect(result.skipped).toBe(1);
    expect(result.compared).toBe(0);
    expect(result.differences).toHaveLength(0);
  });

  it("케이스 수가 다르면 던진다", () => {
    expect(() =>
      checkDeterminism({ first: [observation({})], second: [], stateRestored: true }),
    ).toThrow("관찰한 케이스 수가 다릅니다");
  });

  it("ISO 타임스탬프 쌍에 timestamp 힌트를 단다", () => {
    const result = checkDeterminism({
      first: [observation({ response: withText("2026-08-18T14:03:11Z") })],
      second: [observation({ response: withText("2026-08-18T14:03:12Z") })],
      stateRestored: true,
    });
    expect(result.differences[0]?.hint).toBe("timestamp");
  });

  it("UUID 쌍에 randomId 힌트를 단다", () => {
    const result = checkDeterminism({
      first: [observation({ response: withText("3f2504e0-4f89-11d3-9a0c-0305e82c3301") })],
      second: [observation({ response: withText("21ec2020-3aea-4069-a2dd-08002b30309d") })],
      stateRestored: true,
    });
    expect(result.differences[0]?.hint).toBe("randomId");
  });

  it("숫자 쌍에 numericDrift 힌트를 단다", () => {
    const result = checkDeterminism({
      first: [observation({ response: withText(24) })],
      second: [observation({ response: withText(25) })],
      stateRestored: true,
    });
    expect(result.differences[0]?.hint).toBe("numericDrift");
  });

  // 아래는 실서버 기본 형태다(#293). 서버는 결과를 JSON 으로 만들어 text 블록에 문자열로 감싸
  // 보내므로, 비교 지점이 값 하나가 아니라 JSON 전문 한 덩어리가 된다.
  it("JSON 전문 문자열 안의 타임스탬프가 달라지면 timestamp 를 단다", () => {
    const run1 = '{"label":"example","timestamp":"2026-08-22T16:59:59.929Z","seq":1}';
    const run2 = '{"label":"example","timestamp":"2026-08-22T17:00:00.034Z","seq":1}';
    const result = checkDeterminism({
      first: [observation({ response: withText(run1) })],
      second: [observation({ response: withText(run2) })],
      stateRestored: true,
    });
    expect(result.differences[0]?.hint).toBe("timestamp");
  });

  it("JSON 전문 문자열 안의 UUID 가 달라지면 randomId 를 단다", () => {
    const run1 = '{"user":"example","token":"a2901751-fafb-4942-8ecd-52d019cd7865"}';
    const run2 = '{"user":"example","token":"f480ac48-a7f3-4698-a557-d5ff48785907"}';
    const result = checkDeterminism({
      first: [observation({ response: withText(run1) })],
      second: [observation({ response: withText(run2) })],
      stateRestored: true,
    });
    expect(result.differences[0]?.hint).toBe("randomId");
  });

  it("JSON 전문 문자열 안의 숫자가 달라지면 numericDrift 를 단다", () => {
    const result = checkDeterminism({
      first: [observation({ response: withText('{"sensor":"example","value":22.92}') })],
      second: [observation({ response: withText('{"sensor":"example","value":21.64}') })],
      stateRestored: true,
    });
    expect(result.differences[0]?.hint).toBe("numericDrift");
  });

  it("원시 숫자 문자열 쌍에 numericDrift 를 단다", () => {
    // text 블록은 언제나 string 이라 typeof number 분기로는 이 자리에 닿지 못했다.
    const result = checkDeterminism({
      first: [observation({ response: withText("23.41") })],
      second: [observation({ response: withText("24.35") })],
      stateRestored: true,
    });
    expect(result.differences[0]?.hint).toBe("numericDrift");
  });

  it("타임스탬프와 숫자가 함께 달라지면 timestamp 를 단다", () => {
    const run1 = '{"at":"2026-08-22T16:59:59Z","value":22.92}';
    const run2 = '{"at":"2026-08-22T17:00:00Z","value":21.64}';
    const result = checkDeterminism({
      first: [observation({ response: withText(run1) })],
      second: [observation({ response: withText(run2) })],
      stateRestored: true,
    });
    expect(result.differences[0]?.hint).toBe("timestamp");
  });

  it("UUID 는 같고 숫자만 달라지면 randomId 가 아니라 numericDrift 를 단다", () => {
    const run1 = '{"token":"a2901751-fafb-4942-8ecd-52d019cd7865","seq":1}';
    const run2 = '{"token":"a2901751-fafb-4942-8ecd-52d019cd7865","seq":2}';
    const result = checkDeterminism({
      first: [observation({ response: withText(run1) })],
      second: [observation({ response: withText(run2) })],
      stateRestored: true,
    });
    expect(result.differences[0]?.hint).toBe("numericDrift");
  });

  it("타임스탬프는 같고 숫자만 달라지면 timestamp 를 달지 않는다", () => {
    // 앵커 없는 test() 로 판정하던 시절의 오귀속. 시간은 그대로인데 시간 탓을 했다.
    const run1 = '{"at":"2026-08-22T16:59:59Z","seq":1}';
    const run2 = '{"at":"2026-08-22T16:59:59Z","seq":2}';
    const result = checkDeterminism({
      first: [observation({ response: withText(run1) })],
      second: [observation({ response: withText(run2) })],
      stateRestored: true,
    });
    expect(result.differences[0]?.hint).toBe("numericDrift");
  });

  it("패턴 밖 차이가 함께 있으면 힌트를 달지 않는다", () => {
    // 짚어준 값을 고쳐도 여전히 다르다. 그럴 때는 원인을 단정하지 않는다.
    const run1 = '{"token":"a2901751-fafb-4942-8ecd-52d019cd7865","city":"서울"}';
    const run2 = '{"token":"f480ac48-a7f3-4698-a557-d5ff48785907","city":"부산"}';
    const result = checkDeterminism({
      first: [observation({ response: withText(run1) })],
      second: [observation({ response: withText(run2) })],
      stateRestored: true,
    });
    expect(result.differences).toHaveLength(1);
    expect(result.differences[0]?.hint).toBeUndefined();
  });

  it("마스크와 같은 토큰이 본문에 있어도 없는 원인을 지목하지 않는다", () => {
    // 마스크가 고정값이면 여기서 두 문자열이 마스킹 후 같아져 randomId 가 나온다. 실제로는
    // UUID 와 그 토큰의 자리가 맞바뀐 것이라 UUID 하나로 설명되는 차이가 아니다.
    const token = "\uFFFFr";
    const run1 = `{"a":"a2901751-fafb-4942-8ecd-52d019cd7865","b":"${token}"}`;
    const run2 = `{"a":"${token}","b":"f480ac48-a7f3-4698-a557-d5ff48785907"}`;
    const result = checkDeterminism({
      first: [observation({ response: withText(run1) })],
      second: [observation({ response: withText(run2) })],
      stateRestored: true,
    });
    expect(result.differences).toHaveLength(1);
    expect(result.differences[0]?.hint).toBeUndefined();
  });

  it("패턴 자리 수가 다르면 힌트를 달지 않는다", () => {
    const run1 = '{"ids":["a2901751-fafb-4942-8ecd-52d019cd7865"]}';
    const run2 =
      '{"ids":["f480ac48-a7f3-4698-a557-d5ff48785907","3f2504e0-4f89-11d3-9a0c-0305e82c3301"]}';
    const result = checkDeterminism({
      first: [observation({ response: withText(run1) })],
      second: [observation({ response: withText(run2) })],
      stateRestored: true,
    });
    expect(result.differences[0]?.hint).toBeUndefined();
  });

  it("패턴 밖 문자열 쌍에는 힌트가 없다", () => {
    const result = checkDeterminism({
      first: [observation({ response: withText("서울") })],
      second: [observation({ response: withText("부산") })],
      stateRestored: true,
    });
    expect(result.differences).toHaveLength(1);
    expect(result.differences[0]?.hint).toBeUndefined();
  });

  it("한쪽만 타임스탬프 패턴이면 힌트가 없다", () => {
    const result = checkDeterminism({
      first: [observation({ response: withText("2026-08-18T14:03:11Z") })],
      second: [observation({ response: withText("알 수 없음") })],
      stateRestored: true,
    });
    expect(result.differences).toHaveLength(1);
    expect(result.differences[0]?.hint).toBeUndefined();
  });

  it("깊이 1500 응답에서 죽지 않는다", () => {
    // canonical.ts 전례 회귀. 재귀 구현이면 여기서 RangeError 로 죽는다.
    const deep = (leaf: unknown): unknown => {
      let value = leaf;
      for (let i = 0; i < 1500; i += 1) value = { nested: value };
      return value;
    };
    const result = checkDeterminism({
      first: [observation({ response: deep("a") })],
      second: [observation({ response: deep("b") })],
      stateRestored: true,
    });
    expect(result.differences[0]?.path).toBe("nested.".repeat(1500).slice(0, -1));
  });
});

describe("describeDeterminismDifference", () => {
  it("describeDeterminismDifference 가 §8 케이스 블록을 만든다", () => {
    const text = describeDeterminismDifference(
      {
        caseId: "case-3",
        caseName: "정상 조회",
        toolName: "get_weather",
        kind: "response",
        path: "content[0].text",
        firstValue: '"{\\"fetchedAt\\":\\"2026-08-18T14:03:11Z\\"}"',
        secondValue: '"{\\"fetchedAt\\":\\"2026-08-18T14:03:12Z\\"}"',
        hint: "timestamp",
      },
      { stateRestored: true },
    );
    expect(text).toContain("get_weather / 정상 조회 (case-3)");
    expect(text).toContain("→ 다른 지점: content[0].text");
    expect(text).toContain("1회차:");
    expect(text).toContain("2회차:");
    expect(text).toContain("시간 의존으로 보입니다");
  });
});

describe("checkDeterminism 의 표시값 redaction", () => {
  it("민감 키 자리의 값이 다르면 양쪽 표시값을 가린다", () => {
    const result = checkDeterminism({
      first: [
        observation({ response: { content: [], isError: false, raw: { sessionToken: "s-1" } } }),
      ],
      second: [
        observation({ response: { content: [], isError: false, raw: { sessionToken: "s-2" } } }),
      ],
      stateRestored: true,
      redaction: {},
    });
    expect(result.differences[0]).toMatchObject({
      path: "raw.sessionToken",
      firstValue: "[REDACTED]",
      secondValue: "[REDACTED]",
    });
  });

  it("민감 키를 가려도 비결정 판정 자체는 그대로 낸다", () => {
    const result = checkDeterminism({
      first: [
        observation({ response: { content: [], isError: false, raw: { sessionToken: "s-1" } } }),
      ],
      second: [
        observation({ response: { content: [], isError: false, raw: { sessionToken: "s-2" } } }),
      ],
      stateRestored: true,
      redaction: {},
    });
    expect(result.conclusion).toBe("nondeterministic");
    expect(result.differences).toHaveLength(1);
  });

  it("조상이 민감 키면 그 아래 값도 가린다", () => {
    const result = checkDeterminism({
      first: [
        observation({ response: { content: [], isError: false, raw: { token: { value: "a" } } } }),
      ],
      second: [
        observation({ response: { content: [], isError: false, raw: { token: { value: "b" } } } }),
      ],
      stateRestored: true,
      redaction: {},
    });
    expect(result.differences[0]).toMatchObject({
      path: "raw.token.value",
      firstValue: "[REDACTED]",
      secondValue: "[REDACTED]",
    });
  });

  it("배열 인덱스를 거친 경로도 조상 키로 가린다", () => {
    const result = checkDeterminism({
      first: [observation({ response: { content: [], isError: false, raw: { token: ["a"] } } })],
      second: [observation({ response: { content: [], isError: false, raw: { token: ["b"] } } })],
      stateRestored: true,
      redaction: {},
    });
    expect(result.differences[0]).toMatchObject({
      path: "raw.token[0]",
      firstValue: "[REDACTED]",
      secondValue: "[REDACTED]",
    });
  });

  it("sensitiveKeys 로 넘긴 이름도 가린다", () => {
    const result = checkDeterminism({
      first: [observation({ response: { content: [], isError: false, raw: { tenantId: "t-1" } } })],
      second: [
        observation({ response: { content: [], isError: false, raw: { tenantId: "t-2" } } }),
      ],
      stateRestored: true,
      redaction: { sensitiveKeys: ["tenantId"] },
    });
    expect(result.differences[0]).toMatchObject({ firstValue: "[REDACTED]" });
  });

  it("한쪽만 응답이 있으면 그 응답 안의 민감 키를 구조적으로 가린다", () => {
    const result = checkDeterminism({
      first: [
        observation({ response: { content: [], isError: false, raw: { sessionToken: "s-1" } } }),
      ],
      second: [observation({ response: undefined })],
      stateRestored: true,
      redaction: {},
    });
    const difference = result.differences[0];
    expect(difference?.firstValue).toContain("[REDACTED]");
    expect(difference?.firstValue).not.toContain("s-1");
    expect(difference?.secondValue).toBe("(응답 없음)");
  });

  it("민감하지 않은 자리는 값을 그대로 보여준다", () => {
    const result = checkDeterminism({
      first: [observation({ response: withText("a") })],
      second: [observation({ response: withText("b") })],
      stateRestored: true,
      redaction: {},
    });
    expect(result.differences[0]).toMatchObject({
      path: "content[0].text",
      firstValue: '"a"',
      secondValue: '"b"',
    });
  });
});
