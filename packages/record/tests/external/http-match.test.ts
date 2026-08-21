import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { HttpMatchV1 } from "../../src/external/protocol.js";
import {
  encodeHttpResponse,
  encodeHttpThrow,
  HTTP_INTERACTION_SCHEMA_VERSION,
  HTTP_MATCH_KEY_DOMAIN,
  httpMatchKey,
  normalizeHttpRequest,
  restoreHttpOutcome,
  stableStringify,
} from "../../src/external/runtime.mjs";

describe("normalizeHttpRequest", () => {
  it("JSON 객체 키 순서가 달라도 같은 matchKey를 만든다", async () => {
    const left = await normalizeHttpRequest(
      new Request("https://EXAMPLE.com:443/weather?city=seoul", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ city: "seoul", unit: "c" }),
      }),
    );
    const right = await normalizeHttpRequest(
      new Request("https://example.com/weather?city=seoul", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ unit: "c", city: "seoul" }),
      }),
    );

    expect(left.matchKey).toBe(right.matchKey);
    expect(left.match.url).toBe("https://example.com/weather?city=seoul");
  });

  it("stable JSON은 undefined와 -0을 고정하고 sparse array를 거절한다", () => {
    expect(stableStringify({ b: undefined, a: -0, values: [undefined] })).toBe(
      '{"a":0,"values":[null]}',
    );
    const sparse = [1, 2];
    delete sparse[0];
    expect(() => stableStringify(sparse)).toThrowError(
      expect.objectContaining({ code: "REQUEST_INVALID" }),
    );
  });

  it("query 순서는 보존해서 다른 순서를 false hit로 합치지 않는다", async () => {
    const left = await normalizeHttpRequest(new Request("https://example.com/search?a=1&b=2"));
    const right = await normalizeHttpRequest(new Request("https://example.com/search?b=2&a=1"));

    expect(left.matchKey).not.toBe(right.matchKey);
  });

  it("민감 query와 JSON 값은 matchKey 계산 전에 마스킹한다", async () => {
    const make = (token: string) =>
      normalizeHttpRequest(
        new Request(`https://example.com/data?access_token=${token}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ nested: { apiKey: token }, visible: "same" }),
        }),
      );

    const left = await make("secret-left");
    const right = await make("secret-right");

    expect(left.matchKey).toBe(right.matchKey);
    expect(JSON.stringify(left)).not.toContain("secret-left");
    expect(left.match.url).toContain("%5Bredacted%5D");
    expect(left.match.body).toEqual({
      kind: "json",
      value: { nested: { apiKey: "[redacted]" }, visible: "same" },
    });
  });

  it("allowlist 밖 헤더는 매칭에서 제외하고 allowlist 헤더는 포함한다", async () => {
    const base = "https://example.com/data";
    const first = await normalizeHttpRequest(
      new Request(base, { headers: { accept: "application/json", "user-agent": "first" } }),
    );
    const ignored = await normalizeHttpRequest(
      new Request(base, { headers: { accept: "application/json", "user-agent": "second" } }),
    );
    const meaningful = await normalizeHttpRequest(
      new Request(base, { headers: { accept: "application/problem+json" } }),
    );

    expect(first.matchKey).toBe(ignored.matchKey);
    expect(first.matchKey).not.toBe(meaningful.matchKey);
  });

  it("JSON이 아닌 request body와 1 MiB 초과 body를 실제 호출 전에 거절한다", async () => {
    await expect(
      normalizeHttpRequest(
        new Request("https://example.com/data", {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: "plain text",
        }),
      ),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_HTTP_BODY" });

    const oversized = JSON.stringify({ value: "x".repeat(1024 * 1024) });
    await expect(
      normalizeHttpRequest(
        new Request("https://example.com/data", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: oversized,
        }),
      ),
    ).rejects.toMatchObject({ code: "HTTP_BODY_TOO_LARGE" });
  });

  it("Replay Response의 url과 표준 관찰값을 함께 복원한다", async () => {
    const restored = restoreHttpOutcome({
      kind: "response",
      status: 201,
      statusText: "Created",
      headers: [["content-type", "application/json"]],
      url: "https://example.com/final",
      body: { ok: true },
    });

    expect(restored).toBeInstanceOf(Response);
    expect(restored.status).toBe(201);
    expect(restored.ok).toBe(true);
    expect(restored.url).toBe("https://example.com/final");
    expect(await restored.json()).toEqual({ ok: true });
  });

  it("저장할 response의 URL, 헤더, JSON body에서 민감 값을 제거한다", async () => {
    const response = new Response(JSON.stringify({ nested: { accessToken: "body-secret" } }), {
      headers: {
        "content-type": "application/json",
        "set-cookie": "session=header-secret",
      },
    });
    Object.defineProperty(response, "url", {
      value: "https://example.com/final?apiKey=url-secret",
      configurable: true,
    });

    const stored = await encodeHttpResponse(response);

    expect(stored.url).toBe("https://example.com/final?apiKey=%5Bredacted%5D");
    expect(stored.body).toEqual({ nested: { accessToken: "[redacted]" } });
    expect(stored.headers).toContainEqual(["set-cookie", "[redacted]"]);
    expect(JSON.stringify(stored)).not.toContain("secret");
  });
});

describe("matchKey envelope", () => {
  it("domain과 schemaVersion을 해시 입력에 넣는다 — match만 해싱하지 않는다", async () => {
    const request = new Request("https://example.com/weather?city=seoul");
    const normalized = await normalizeHttpRequest(request);

    const withEnvelope = createHash("sha256")
      .update(
        stableStringify({
          domain: HTTP_MATCH_KEY_DOMAIN,
          schemaVersion: HTTP_INTERACTION_SCHEMA_VERSION,
          match: normalized.match,
        }),
        "utf8",
      )
      .digest("hex");
    const bareMatch = createHash("sha256")
      .update(stableStringify(normalized.match), "utf8")
      .digest("hex");

    expect(normalized.matchKey).toBe(withEnvelope);
    // envelope 없이 해싱하던 시절의 값과는 반드시 달라야 한다. 같아지면 schema version 이
    // 올라가도 키 공간이 갈라지지 않아 version 1 세션에 version 2 요청이 hit 한다.
    expect(normalized.matchKey).not.toBe(bareMatch);
  });

  it("schemaVersion이 다르면 같은 요청이라도 다른 키가 된다", () => {
    const match: HttpMatchV1 = {
      method: "GET",
      url: "https://example.com/weather",
      headers: {},
      body: { kind: "none" },
    };
    const keyOf = (schemaVersion: number) =>
      createHash("sha256")
        .update(stableStringify({ domain: HTTP_MATCH_KEY_DOMAIN, schemaVersion, match }), "utf8")
        .digest("hex");

    expect(keyOf(1)).toBe(httpMatchKey(match));
    expect(keyOf(2)).not.toBe(httpMatchKey(match));
  });

  it("domain이 다르면 다른 키가 된다 — legacy 카세트와 해시 공간을 나눈다", () => {
    const match: HttpMatchV1 = {
      method: "GET",
      url: "https://example.com/weather",
      headers: {},
      body: { kind: "none" },
    };
    const legacyish = createHash("sha256")
      .update(
        stableStringify({
          domain: "mcpeak.legacy.tool",
          schemaVersion: HTTP_INTERACTION_SCHEMA_VERSION,
          match,
        }),
        "utf8",
      )
      .digest("hex");

    expect(httpMatchKey(match)).not.toBe(legacyish);
  });
});

describe("encodeHttpThrow", () => {
  it("원본 message를 저장하지 않는다 — 자유 텍스트에는 마스킹이 걸리지 않는다", () => {
    const error = new Error(
      "request to https://api.example.com/v1?api_key=super-secret failed, reason: connect ECONNREFUSED",
    );
    error.stack = "Error: ... https://api.example.com/v1?api_key=super-secret";

    const stored = encodeHttpThrow(error);

    expect(stored).not.toHaveProperty("message");
    expect(stored).not.toHaveProperty("stack");
    expect(stored).not.toHaveProperty("cause");
    expect(JSON.stringify(stored)).not.toContain("super-secret");
    expect(JSON.stringify(stored)).not.toContain("api.example.com");
  });

  it("허용된 code는 failureKind로 분류해 저장한다", () => {
    const cases: readonly (readonly [string, string])[] = [
      ["ECONNREFUSED", "connection"],
      ["ENOTFOUND", "dns"],
      ["ETIMEDOUT", "timeout"],
      ["CERT_HAS_EXPIRED", "tls"],
      ["ABORT_ERR", "abort"],
    ];
    for (const [code, failureKind] of cases) {
      const error = Object.assign(new Error("아무 문구나"), { code });
      expect(encodeHttpThrow(error)).toEqual({ kind: "throw", failureKind, name: "Error", code });
    }
  });

  it("목록에 없는 code는 저장하지 않는다 — code 자체가 자유 텍스트일 수 있다", () => {
    const error = Object.assign(new Error("boom"), { code: "E_SECRET_abc123" });

    const stored = encodeHttpThrow(error);

    expect(stored).not.toHaveProperty("code");
    expect(JSON.stringify(stored)).not.toContain("abc123");
  });

  it("code가 없으면 name으로 가른다", () => {
    const abort = Object.assign(new Error("x"), { name: "AbortError" });
    expect(encodeHttpThrow(abort)).toEqual({
      kind: "throw",
      failureKind: "abort",
      name: "AbortError",
    });
    expect(encodeHttpThrow(new TypeError("fetch failed"))).toEqual({
      kind: "throw",
      failureKind: "network",
      name: "TypeError",
    });
  });

  it("Error가 아닌 값도 안전한 envelope가 된다", () => {
    expect(encodeHttpThrow("문자열이 던져졌다")).toEqual({
      kind: "throw",
      failureKind: "unknown",
      name: "Error",
    });
  });

  it("복원 문장은 저장본이 아니라 failureKind에서 만든다", () => {
    const stored = encodeHttpThrow(
      Object.assign(new Error("원본 문구는 사라진다"), { code: "ENOTFOUND" }),
    );

    expect(() => restoreHttpOutcome(stored)).toThrow(/host 이름을 찾지 못했습니다/);
    expect(() => restoreHttpOutcome(stored)).not.toThrow(/원본 문구/);
  });
});
