import { describe, expect, it } from "vitest";
import type { SessionInteractionEntry } from "../../src/api-types.js";
import { describeInteraction, interactionsPath } from "../src/mock-builder/interactions.js";

const base = { ordinal: 0, method: "GET", url: "https://api.open-meteo.com/<redacted>?city=Seoul" };

describe("describeInteraction", () => {
  it("응답은 고를 수 있고 method · url · status 를 보여준다", () => {
    const entry: SessionInteractionEntry = {
      ...base,
      outcome: { kind: "response", status: 200, body: { temperature: 21.5 } },
    };
    expect(describeInteraction(entry)).toEqual({
      pickable: true,
      label: "GET https://api.open-meteo.com/<redacted>?city=Seoul · 200",
      body: { temperature: 21.5 },
    });
  });

  it("fetch 실패는 고를 수 없고 failureKind · code 를 말한다", () => {
    expect(
      describeInteraction({
        ...base,
        outcome: { kind: "throw", failureKind: "dns", code: "ENOTFOUND" },
      }),
    ).toEqual({
      pickable: false,
      label: "GET https://api.open-meteo.com/<redacted>?city=Seoul",
      reason:
        "→ 이 호출은 응답 본문이 없어 목의 답으로 쓸 수 없습니다 — fetch 가 실패했습니다 (dns · ENOTFOUND)",
    });
  });

  it("code 가 없으면 failureKind 만 말한다", () => {
    const view = describeInteraction({ ...base, outcome: { kind: "throw", failureKind: "abort" } });
    expect(view.pickable === false && view.reason).toBe(
      "→ 이 호출은 응답 본문이 없어 목의 답으로 쓸 수 없습니다 — fetch 가 실패했습니다 (abort)",
    );
  });

  it("끝나지 않은 호출은 고를 수 없다", () => {
    expect(describeInteraction({ ...base, outcome: { kind: "incomplete" } })).toEqual({
      pickable: false,
      label: "GET https://api.open-meteo.com/<redacted>?city=Seoul",
      reason: "→ 녹화가 끝나지 않은 호출입니다. 응답이 저장되지 않아 목의 답으로 쓸 수 없습니다.",
    });
  });
});

describe("interactionsPath", () => {
  it("세션 경로를 한 세그먼트로 인코딩한다", () => {
    expect(interactionsPath("recordings/weather.session.db")).toBe(
      "/api/sessions/recordings%2Fweather.session.db/interactions",
    );
  });
});
