import { describe, expect, it } from "vitest";
import { judge } from "../src/dependency.js";
import type { ObservedRequest, TraceVia } from "../src/types.js";

// 설계 §6.1 의존 판정. 시각은 판정에 쓰이지 않으므로 고정값이다.

const T = 1_700_000_000_000;

function request(
  url: string,
  extra: {
    readonly seq?: number;
    readonly via?: TraceVia;
    readonly method?: string;
    readonly responseBody?: string;
    readonly responseBodyTruncated?: true;
    readonly location?: string;
    readonly requestHeaders?: Readonly<Record<string, string>>;
    readonly requestBody?: string;
    readonly requestBodyUnknown?: true;
  } = {},
): ObservedRequest {
  return {
    pid: 1,
    seq: extra.seq ?? 1,
    via: extra.via ?? "fetch",
    method: extra.method ?? "GET",
    url,
    ...(extra.requestHeaders === undefined ? {} : { requestHeaders: extra.requestHeaders }),
    ...(extra.requestBody === undefined ? {} : { requestBody: extra.requestBody }),
    ...(extra.requestBodyUnknown === undefined
      ? {}
      : { requestBodyUnknown: extra.requestBodyUnknown }),
    t0: T,
    status: 200,
    ...(extra.location === undefined ? {} : { responseHeaders: { location: extra.location } }),
    ...(extra.responseBody === undefined ? {} : { responseBody: extra.responseBody }),
    ...(extra.responseBodyTruncated === undefined
      ? {}
      : { responseBodyTruncated: extra.responseBodyTruncated }),
    tHeaders: T + 10,
    tEnd: T + 20,
    bodyEnd: true,
  };
}

describe("judge", () => {
  it("응답 문자열 값이 다음 URL 에 있으면 dependent", () => {
    const a = request("https://h.example/list", { responseBody: '{"id":"abc123"}' });
    const b = request("https://h.example/item/abc123", { seq: 2 });
    expect(judge(b, a, {})).toBe("dependent");
  });

  it("응답 숫자 값이 다음 URL 에 있으면 dependent", () => {
    const a = request("https://geo.example/search?name=Busan", {
      responseBody: '{"results":[{"latitude":35.1028,"longitude":129.04}]}',
    });
    const b = request("https://api.example/forecast?latitude=35.1028&longitude=129.04", {
      seq: 2,
    });
    expect(judge(b, a, { city: "Busan" })).toBe("dependent");
  });

  it("입력에서 온 값은 의존이 아니다", () => {
    const a = request("https://h.example/lookup", { responseBody: '{"city":"Busan"}' });
    const b = request("https://h.example/search?q=Busan", { seq: 2 });
    expect(judge(b, a, { city: "Busan" })).toBe("independent");
  });

  it("자기 요청에 있던 값은 의존이 아니다", () => {
    const a = request("https://h.example/kinds?name=forecast", {
      responseBody: '{"kind":"forecast"}',
    });
    const b = request("https://h.example/forecast", { seq: 2 });
    expect(judge(b, a, {})).toBe("independent");
  });

  it("Authorization 헤더로 넘어가는 토큰은 dependent", () => {
    const a = request("https://auth.example/token", {
      method: "POST",
      requestBody: "grant_type=client_credentials",
      responseBody: '{"access_token":"tok_9f8e7d6c"}',
    });
    const b = request("https://api.example/me", {
      seq: 2,
      requestHeaders: { authorization: "Bearer tok_9f8e7d6c" },
    });
    expect(judge(b, a, {})).toBe("dependent");
  });

  it("accept 같은 고정 헤더는 입력이 아니다", () => {
    // 프리로드는 accept 를 담지 않으므로 B 에는 헤더 기록이 없다.
    const a = request("https://h.example/meta", { responseBody: '{"format":"application/json"}' });
    const b = request("https://h.example/data", { seq: 2 });
    expect(judge(b, a, {})).toBe("independent");
  });

  it("Location 헤더는 출력이다", () => {
    const a = request("https://h/start", { responseBody: "", location: "https://h/next/77abcd" });
    const b = request("https://h/next/77abcd", { seq: 2 });
    expect(judge(b, a, {})).toBe("dependent");
  });

  it("앞 요청 본문이 없거나 잘렸으면 unknown", () => {
    const viaHttp = request("https://h.example/a", { via: "node:http" });
    const truncated = request("https://h.example/a", {
      responseBody: '{"id":"abc123"',
      responseBodyTruncated: true,
    });
    const b = request("https://h.example/item/abc123", { seq: 2 });
    expect(judge(b, viaHttp, {})).toBe("unknown");
    expect(judge(b, truncated, {})).toBe("unknown");
  });

  it("뒤 요청 본문을 못 봤으면 unknown", () => {
    const a = request("https://h.example/a", { responseBody: '{"id":"abc123"}' });
    const b = request("https://h.example/b", {
      seq: 2,
      via: "undici",
      method: "POST",
      requestBodyUnknown: true,
    });
    expect(judge(b, a, {})).toBe("unknown");
  });

  it("JSON 이 아닌 본문은 8자 이상 토큰만", () => {
    const a = request("https://h.example/a", { responseBody: "token=abcdefgh1234&x=ab" });
    expect(judge(request("https://h.example/abcdefgh1234", { seq: 2 }), a, {})).toBe("dependent");
    expect(judge(request("https://h.example/ab", { seq: 2 }), a, {})).toBe("independent");
  });

  it("뒤 요청 본문에 든 값도 입력이다", () => {
    const a = request("https://h.example/a", { responseBody: '{"cursor":"cur_5566aa"}' });
    const b = request("https://h.example/b", {
      seq: 2,
      method: "POST",
      requestBody: '{"after":"cur_5566aa"}',
    });
    expect(judge(b, a, {})).toBe("dependent");
  });

  it("같은 earlier 를 여러 later 와 비교해도 쌍마다 답이 같다", () => {
    // earlier 의 걸러 낸 출력과 later 의 입력은 한 번만 계산해 둔다. 순서가 바뀌어도 답은 같아야 한다.
    const a = request("https://h.example/a", { responseBody: '{"id":"abc123","x":"zzzz9"}' });
    const hit = request("https://h.example/item/abc123", { seq: 2 });
    const miss = request("https://h.example/item/other", { seq: 3 });
    const viaBody = request("https://h.example/b", {
      seq: 4,
      method: "POST",
      requestBody: '{"ref":"zzzz9"}',
    });
    for (let round = 0; round < 2; round += 1) {
      expect(judge(hit, a, {})).toBe("dependent");
      expect(judge(miss, a, {})).toBe("independent");
      expect(judge(viaBody, a, {})).toBe("dependent");
    }
    // 같은 later 를 다른 earlier 와 비교해도 입력 문자열이 섞이지 않는다.
    const b = request("https://h.example/c", { seq: 5, responseBody: '{"id":"other"}' });
    expect(judge(miss, b, {})).toBe("dependent");
    expect(judge(hit, b, {})).toBe("independent");
  });

  it("호출 입력이 다르면 입력 반향 제외를 다시 계산한다", () => {
    const a = request("https://h.example/lookup", { responseBody: '{"city":"Busan"}' });
    const b = request("https://h.example/search?q=Busan", { seq: 2 });
    expect(judge(b, a, { city: "Busan" })).toBe("independent");
    expect(judge(b, a, { city: "Seoul" })).toBe("dependent");
    expect(judge(b, a, { city: "Busan" })).toBe("independent");
  });

  it("조각보다 짧은 Location 도 출력이다", () => {
    const a = request("https://h/start", { responseBody: "", location: "/z9" });
    expect(judge(request("https://h/next/z9", { seq: 2 }), a, {})).toBe("dependent");
    expect(judge(request("https://h/next/z8", { seq: 3 }), a, {})).toBe("independent");
  });

  it("토큰의 첫 조각과 끝 조각이 입력에 따로 있어도 토큰이 없으면 독립이다", () => {
    // 조각 검사는 거르기만 한다. 두 조각이 떨어져 있으면 본문을 훑어 독립으로 판정한다.
    const a = request("https://h.example/a", { responseBody: '{"id":"abcdefgh"}' });
    const b = request("https://h.example/abcd/x/efgh", { seq: 2 });
    expect(judge(b, a, {})).toBe("independent");
  });

  it("URL 디코딩이 실패하면 원문으로 본다", () => {
    const a = request("https://h.example/a", { responseBody: '{"id":"abc123"}' });
    expect(judge(request("https://h.example/%E0%A4%A/abc123", { seq: 2 }), a, {})).toBe(
      "dependent",
    );
    // 자기 요청 반향 제외도 원문으로 본다.
    const self = request("https://h.example/%E0%A4%A?k=abc123", {
      responseBody: '{"id":"abc123"}',
    });
    expect(judge(request("https://h.example/item/abc123", { seq: 2 }), self, {})).toBe(
      "independent",
    );
  });
});
