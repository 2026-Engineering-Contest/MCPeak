import { describe, expect, it } from "vitest";
import {
  bodyUrlWarning,
  countBodyUrls,
  recordingUrlCount,
  responseUrlCount,
} from "../src/mock-builder/body-urls.js";
import { newResponseDraft } from "../src/mock-builder/draft.js";

describe("countBodyUrls", () => {
  it("중첩 객체와 배열 안의 http(s) 절대 URL 을 센다", () => {
    expect(
      countBodyUrls({
        forecast: { next: "https://api.example.com/v1/page/2?token=abc" },
        links: ["http://a.example/x", { self: "https://b.example/y" }],
      }),
    ).toBe(3);
  });

  it("같은 URL 은 한 번만 센다", () => {
    expect(countBodyUrls(["https://a.example/x", { again: "https://a.example/x" }])).toBe(1);
  });

  it("상대경로 · 문장에 섞인 URL · http(s) 가 아닌 scheme · 키 이름은 세지 않는다", () => {
    expect(
      countBodyUrls({
        path: "/v1/forecast",
        note: "자세한 건 https://a.example/docs 를 보세요",
        mail: "mailto:ops@example.com",
        label: "note:hello",
        "https://key.example/": 1,
      }),
    ).toBe(0);
  });

  it("스칼라 · null", () => {
    expect(countBodyUrls(null)).toBe(0);
    expect(countBodyUrls(21.5)).toBe(0);
    expect(countBodyUrls("https://a.example/")).toBe(1);
  });
});

describe("bodyUrlWarning", () => {
  it("0 이면 아무 줄도 없다", () => {
    expect(bodyUrlWarning(0, "response")).toEqual([]);
  });

  it("응답 한 줄에 대한 경고 전문", () => {
    expect(bodyUrlWarning(2, "response")).toEqual([
      "→ 이 응답 본문에 URL 이 2개 있습니다. 녹화 때 가려지지 않는 자리라 자격증명이 담겼을 수 있습니다.",
      "→ 저장 전에 result 에서 해당 값을 확인하세요.",
    ]);
  });

  it("저장 직전 경고 전문. 막지 않는다고 말한다", () => {
    expect(bodyUrlWarning(3, "definition")).toEqual([
      "→ 녹화본에서 가져온 result 에 URL 이 3개 있습니다. 녹화 때 가려지지 않는 자리라 자격증명이 담겼을 수 있습니다.",
      "→ 저장은 막지 않습니다. 값을 확인한 뒤 저장하세요.",
    ]);
  });
});

describe("초안 단위 개수", () => {
  it("녹화 응답만, 여러 응답에 걸쳐 서로 다른 URL 을 센다. 읽을 수 없는 result 는 건너뛴다", () => {
    const recorded = (resultJson: string) => ({
      ...newResponseDraft("t"),
      resultJson,
      origin: "recording" as const,
    });
    expect(
      recordingUrlCount({
        tools: [],
        responses: [
          recorded('{"a":"https://a.example/"}'),
          recorded('{"b":"https://a.example/","c":"https://c.example/"}'),
          recorded("{ 깨진"),
          { ...newResponseDraft("t"), resultJson: '{"d":"https://d.example/"}' },
        ],
        extra: {},
      }),
    ).toBe(2);
  });

  it("responseUrlCount 는 읽을 수 없으면 0 이다", () => {
    expect(responseUrlCount('{"a":"https://a.example/"}')).toBe(1);
    expect(responseUrlCount("{ 깨진")).toBe(0);
  });
});
