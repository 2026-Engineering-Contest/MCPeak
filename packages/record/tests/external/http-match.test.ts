import { describe, expect, it } from "vitest";
import {
  encodeHttpResponse,
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
