import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createRecordEngine } from "../../src/external/engine.js";
import type {
  NormalizedExternalRequest,
  StoredExternalOutcome,
} from "../../src/external/protocol.js";
import { bodyUrlFingerprints } from "../../src/external/runtime.mjs";
import { createMemorySessionStore } from "../../src/external/session-store.js";
import {
  MAX_BODY_URL_FINGERPRINTS,
  MAX_COORDINATOR_PAYLOAD_BYTES,
  MAX_HTTP_BODY_BYTES,
} from "../../src/shared/limits.mjs";

/**
 * ADR-0062. body 에 남은 URL 을 **지우지 않고 세는** 경로를 본다.
 *
 * 두 층이 있다. `bodyUrlFingerprints` 는 한 body 에서 무엇을 찾는가를 정하고, Engine 은 세션
 * 전체에서 어떻게 세는가를 정한다. 두 층 다 "같은 세션을 두 번 훑으면 같은 숫자" 를 지켜야
 * 하므로 순서에 기대는 자리가 없는지가 이 파일의 요점이다.
 */

const digest = (href: string): string => createHash("sha256").update(href, "utf8").digest("hex");

describe("bodyUrlFingerprints — 한 body 에서 무엇을 찾는가", () => {
  it("중첩 객체와 배열 요소까지 내려가 문자열 값만 본다", () => {
    const found = bodyUrlFingerprints(
      {
        top: "https://a.example/x",
        nested: { deep: ["https://b.example/y", { deeper: "https://c.example/z" }] },
        number: 1,
        nothing: null,
      },
      "/request",
    );

    expect(found.other.size).toBe(3);
    expect(found.echoed.size).toBe(0);
  });

  it("키 이름은 대상이 아니다 — 이름으로 판정하는 일은 redactJson 이 이미 했다", () => {
    const found = bodyUrlFingerprints({ "https://key.example/p": "평범한 값" }, "/request");

    expect(found.other.size).toBe(0);
    expect(found.echoed.size).toBe(0);
  });

  it("문자열 전체가 URL 일 때만 센다 — 문장에 섞인 URL 은 자유 텍스트라 범위 밖이다", () => {
    const found = bodyUrlFingerprints(
      { sentence: "자세히는 https://a.example/x 를 보세요", exact: "https://a.example/x" },
      "/request",
    );

    expect(found.other.size).toBe(1);
  });

  it("http(s) 가 아닌 scheme 은 세지 않는다 — 우리가 지운 적 없는 경로다", () => {
    const found = bodyUrlFingerprints(
      { mail: "mailto:a@b.example", data: "data:text/plain,x", real: "https://a.example/x" },
      "/request",
    );

    expect(found.other.size).toBe(1);
  });

  it("요청 pathname 을 되돌려 담으면 echoed 로 가른다 — query 는 비교에서 뺀다", () => {
    const path = "/services/T00/B00/SECRET";
    const found = bodyUrlFingerprints(
      {
        // pagination 은 경로를 그대로 두고 query 만 바꿔 되돌아온다. query 를 비교에 넣으면
        // 정작 잡아야 할 것을 놓친다.
        next: `https://hooks.example.com${path}?page=2`,
        self: `https://hooks.example.com${path}`,
        elsewhere: "https://other.example/unrelated",
      },
      path,
    );

    expect(found.echoed.size).toBe(2);
    expect(found.other.size).toBe(1);
  });

  it("fragment 도 비교에서 뺀다", () => {
    const found = bodyUrlFingerprints({ a: "https://h.example/p#section" }, "/p");

    expect(found.echoed.size).toBe(1);
  });

  /**
   * `URL` 은 percent-encoding 을 정규화하지 않는다(`/a%7Eb` 와 `/a~b` 가 다르게 남는다).
   * 디코딩해서 맞추면 `%2F` 와 `/` 처럼 RFC 3986 상 **다른 자원**을 같다고 말하게 되므로
   * 그대로 비교한다. 대가는 확실한 갈래를 놓치는 것이고, 그때도 약한 갈래에는 남는다.
   */
  it("인코딩이 다른 되돌림은 echoed 를 놓치되 other 로는 잡힌다", () => {
    const found = bodyUrlFingerprints({ a: "https://h.example/a%7Eb" }, "/a~b");

    expect(found.echoed.size).toBe(0);
    expect(found.other.size).toBe(1);
  });

  /** 값이 나가면 이 기능이 막으려던 유출을 이 기능이 만든다. */
  it("돌려주는 것은 SHA-256 hex 지문뿐이고 URL 원문이 아니다", () => {
    const href = "https://hooks.example.com/services/T00/B00/SECRET";
    const found = bodyUrlFingerprints({ a: href }, "/other");

    expect([...found.other]).toEqual([digest(href)]);
    expect(JSON.stringify([...found.other, ...found.echoed])).not.toContain("SECRET");
  });

  it("같은 URL 이 한 body 에 여러 번 나와도 지문은 하나다", () => {
    const href = "https://a.example/x";
    const found = bodyUrlFingerprints({ a: href, b: href, c: [href] }, "/other");

    expect(found.other.size).toBe(1);
  });

  it("순환 참조가 없는 정상 body 만 다루므로 null 과 빈 body 에서 조용히 0건이다", () => {
    expect(bodyUrlFingerprints(null, "/p").other.size).toBe(0);
    expect(bodyUrlFingerprints({}, "/p").other.size).toBe(0);
  });
});

const request = (matchKey: string): NormalizedExternalRequest => ({
  protocol: "http",
  interactionSchemaVersion: 1,
  matchKey,
  display: {
    method: "GET",
    url: `https://example.com/${matchKey}`,
    headers: {},
    body: { kind: "none" },
  },
});

const outcome = (): StoredExternalOutcome => ({
  kind: "response",
  status: 200,
  statusText: "OK",
  headers: [],
  url: "https://example.com/x",
  body: null,
});

/** 한 interaction 을 녹화하고 그 지문을 실어 보낸다. */
const record = (
  engine: ReturnType<typeof createRecordEngine>,
  matchKey: string,
  bodyUrls: { echoed: string[]; other: string[]; truncated?: boolean },
): void => {
  const reservation = engine.begin(request(matchKey));
  engine.complete({ interactionId: reservation.interactionId, outcome: outcome(), bodyUrls });
};

describe("Record Engine — 세션 전체에서 어떻게 세는가", () => {
  const A = digest("https://a.example/1");
  const B = digest("https://b.example/2");

  it("서로 다른 지문의 개수를 센다 — 반복 호출로 같은 URL 이 여러 번 나와도 1건이다", () => {
    const engine = createRecordEngine({ sessionId: "s", store: createMemorySessionStore() });
    record(engine, "a", { echoed: [], other: [A] });
    record(engine, "b", { echoed: [], other: [A] });
    record(engine, "c", { echoed: [], other: [A, B] });

    expect(engine.finish("completed").bodyUrls).toEqual({ echoed: 0, other: 2, truncated: false });
  });

  it("지문을 안 보낸 interaction 은 셀 것이 없는 것으로 다룬다", () => {
    const engine = createRecordEngine({ sessionId: "s", store: createMemorySessionStore() });
    const reservation = engine.begin(request("a"));
    engine.complete({ interactionId: reservation.interactionId, outcome: outcome() });

    expect(engine.finish("completed").bodyUrls).toEqual({ echoed: 0, other: 0, truncated: false });
  });

  it("한 지문은 정확히 한 갈래에만 센다 — 두 갈래에 중복으로 세지 않는다", () => {
    const engine = createRecordEngine({ sessionId: "s", store: createMemorySessionStore() });
    record(engine, "a", { echoed: [A], other: [A] });

    expect(engine.finish("completed").bodyUrls).toEqual({ echoed: 1, other: 0, truncated: false });
  });

  /**
   * 이 파일에서 가장 중요한 단언이다. 같은 URL 이 어떤 interaction 에서는 그 요청 경로와 맞고
   * 다른 interaction 에서는 안 맞을 수 있다. **먼저 본 쪽을 쓰면 interaction 순서에 따라 숫자가
   * 달라진다** — 결정론성이 깨진 것이다. 합집합으로 판정하므로 순서와 무관해야 한다.
   */
  it("같은 지문이 두 갈래로 나뉘어 와도 순서와 무관하게 echoed 가 이긴다", () => {
    const echoedFirst = createRecordEngine({ sessionId: "s", store: createMemorySessionStore() });
    record(echoedFirst, "a", { echoed: [A], other: [] });
    record(echoedFirst, "b", { echoed: [], other: [A] });

    const otherFirst = createRecordEngine({ sessionId: "s", store: createMemorySessionStore() });
    record(otherFirst, "a", { echoed: [], other: [A] });
    record(otherFirst, "b", { echoed: [A], other: [] });

    const expected = { echoed: 1, other: 0, truncated: false };
    expect(echoedFirst.finish("completed").bodyUrls).toEqual(expected);
    expect(otherFirst.finish("completed").bodyUrls).toEqual(expected);
  });

  it("세션 요약에 값이 아니라 개수만 실린다", () => {
    const engine = createRecordEngine({ sessionId: "s", store: createMemorySessionStore() });
    record(engine, "a", { echoed: [A], other: [B] });

    const summary = engine.finish("completed");

    expect(summary.bodyUrls).toEqual({ echoed: 1, other: 1, truncated: false });
    // 지문조차 요약에 남지 않는다 — 개수만이 사용자에게 간다.
    expect(JSON.stringify(summary)).not.toContain(A);
  });
});

/**
 * 지문 개수 상한(#316 리뷰). 1 MiB 를 통과하는 정상 body 가 고유 URL 을 5만 개 가까이 담을
 * 수 있고, 그 지문을 전부 실으면 Coordinator payload 상한을 넘겨 **정상 녹화가 실패한다** —
 * 알리자고 만든 기능이 녹화를 깨뜨리는 회귀였다. 상한이 실제로 그것을 막는지 본다.
 */
describe("지문 개수 상한", () => {
  it("상한을 넘는 지문은 잘라내고 truncated 로 표시한다", () => {
    const engine = createRecordEngine({ sessionId: "s", store: createMemorySessionStore() });
    const many = Array.from({ length: MAX_BODY_URL_FINGERPRINTS + 5 }, (_, n) =>
      digest(`https://a.example/${n}`),
    );
    record(engine, "a", { echoed: [], other: many.slice(0, MAX_BODY_URL_FINGERPRINTS) });
    record(engine, "b", { echoed: [], other: [digest("https://b.example/x")], truncated: true });

    const summary = engine.finish("completed");

    expect(summary.bodyUrls.truncated).toBe(true);
    // 잘렸어도 센 것은 그대로 보고한다 — "최소 N건" 의 N 이다.
    expect(summary.bodyUrls.other).toBe(MAX_BODY_URL_FINGERPRINTS + 1);
  });

  it("한 interaction 이라도 잘렸으면 세션 전체가 truncated 다", () => {
    const engine = createRecordEngine({ sessionId: "s", store: createMemorySessionStore() });
    record(engine, "a", { echoed: [], other: [digest("https://a.example/1")] });
    record(engine, "b", { echoed: [], other: [digest("https://b.example/2")], truncated: true });
    record(engine, "c", { echoed: [], other: [digest("https://c.example/3")] });

    expect(engine.finish("completed").bodyUrls.truncated).toBe(true);
  });

  /**
   * 상한이 실제로 payload 를 지키는지 — 계산이 아니라 직렬화 크기로 확인한다. 상한이 헐거워지면
   * 이 단언이 먼저 깨진다.
   */
  it("상한만큼의 지문은 Coordinator 여유분 안에 든다", () => {
    const full = Array.from({ length: MAX_BODY_URL_FINGERPRINTS }, (_, n) =>
      n.toString(16).padStart(64, "0"),
    );
    const bytes = Buffer.byteLength(JSON.stringify({ echoed: [], other: full, truncated: true }));

    // 여유분은 payload 상한에서 body 상한을 뺀 만큼이다. 그 안에 메타데이터도 들어가야 하므로
    // 지문이 여유분의 절반을 넘지 않아야 한다.
    expect(bytes).toBeLessThan((MAX_COORDINATOR_PAYLOAD_BYTES - MAX_HTTP_BODY_BYTES) / 2);
  });
});
