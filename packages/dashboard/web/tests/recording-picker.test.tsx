// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JsonValue, SessionEntry, SessionInteractionEntry } from "../../src/api-types.js";
import { RecordingPicker, recordedFromNote } from "../src/mock-builder/RecordingPicker.js";

const SESSION = "recordings/weather.session.db";
const OTHER = "recordings/other.session.db";
const LONG_URL =
  "https://api.open-meteo.com/<redacted>?latitude=36.3809&longitude=128.3681&current=temperature_2m%2Cweather_code";

const INTERACTIONS: SessionInteractionEntry[] = [
  {
    ordinal: 0,
    method: "GET",
    url: LONG_URL,
    outcome: { kind: "response", status: 200, body: { temperature: 21.5 } },
  },
  {
    ordinal: 1,
    method: "GET",
    url: "https://nowhere.invalid/<redacted>",
    outcome: { kind: "throw", failureKind: "dns", code: "ENOTFOUND" },
  },
  {
    ordinal: 2,
    method: "GET",
    url: "https://api.example.com/<redacted>",
    outcome: { kind: "incomplete" },
  },
];

function mockApi(sessions: SessionEntry[], interactions?: () => Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/api/sessions")) return new Response(JSON.stringify(sessions));
      if (url.endsWith("/interactions")) {
        return interactions?.() ?? new Response(JSON.stringify(INTERACTIONS));
      }
      throw new Error(`예상하지 못한 요청: ${url}`);
    }),
  );
}

const ONE: SessionEntry[] = [{ path: SESSION, status: "completed", interactionCount: 3 }];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPicker(resultJson = "{}"): [JsonValue, string][] {
  const picks: [JsonValue, string][] = [];
  render(
    <RecordingPicker
      id="response-0"
      resultJson={resultJson}
      onPick={(b, n) => picks.push([b, n])}
    />,
  );
  return picks;
}

describe("RecordingPicker", () => {
  it("출처 문장은 사람이 세는 순서(1부터)로 쓴다", () => {
    expect(recordedFromNote(SESSION, 0)).toBe(
      "recordings/weather.session.db 의 1번째 외부 호출에서 가져왔습니다.",
    );
  });

  it("녹화본이 하나면 골라 두고 세 갈래를 보여준다. 긴 URL 은 줄을 바꾼다", async () => {
    mockApi(ONE);
    renderPicker();
    const label = await screen.findByText(`GET ${LONG_URL} · 200`);
    expect(label.className.split(" ")).toContain("break-all");
    expect(
      screen.getByText(
        "→ 이 호출은 응답 본문이 없어 목의 답으로 쓸 수 없습니다 — fetch 가 실패했습니다 (dns · ENOTFOUND)",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "→ 녹화가 끝나지 않은 호출입니다. 응답이 저장되지 않아 목의 답으로 쓸 수 없습니다.",
      ),
    ).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "이걸로 채우기" })).toHaveLength(1);
  });

  it("녹화본이 여럿이면 고를 때까지 목록을 부르지 않는다", async () => {
    mockApi([...ONE, { path: OTHER, status: "completed", interactionCount: 0 }]);
    renderPicker();
    await screen.findByRole("option", { name: `${OTHER} · 외부 호출 0건` });
    expect(screen.queryByRole("button", { name: "이걸로 채우기" })).toBeNull();
    fireEvent.change(screen.getByLabelText("녹화본"), { target: { value: SESSION } });
    expect(await screen.findByRole("button", { name: "이걸로 채우기" })).toBeTruthy();
  });

  it("result 가 비었으면 바로 채운다", async () => {
    mockApi(ONE);
    const picks = renderPicker("{}");
    fireEvent.click(await screen.findByRole("button", { name: "이걸로 채우기" }));
    expect(picks).toEqual([
      [{ temperature: 21.5 }, "recordings/weather.session.db 의 1번째 외부 호출에서 가져왔습니다."],
    ]);
  });

  it("result 에 값이 있으면 확인을 받는다", async () => {
    mockApi(ONE);
    const picks = renderPicker('{"temperature":1}');
    fireEvent.click(await screen.findByRole("button", { name: "이걸로 채우기" }));
    expect(picks).toEqual([]);
    expect(
      screen.getByText("지금 적힌 result 를 이 본문으로 바꿉니다. 지금 값은 사라집니다."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "바꾸기" }));
    expect(picks).toHaveLength(1);
  });

  it("녹화본을 읽을 수 없으면 서버 문장을 줄 그대로 보여준다", async () => {
    const message = [
      `→ 이 녹화본을 읽을 수 없습니다 — ${SESSION}`,
      "→ MCPeak 이 녹화한 세션 파일인지 확인하세요. 목록에는 읽을 수 있는 파일만 나옵니다.",
    ].join("\n");
    mockApi(ONE, () => new Response(JSON.stringify({ error: message }), { status: 404 }));
    renderPicker();
    expect((await screen.findByRole("alert")).textContent).toBe(message);
  });

  it("녹화본이 없으면 어떻게 만드는지 말한다", async () => {
    mockApi([]);
    renderPicker();
    expect(
      await screen.findByText(
        "이 디렉터리 아래에 녹화본이 없습니다. mcpeak test --record-session <path> 로 녹화한 파일이 여기에 나옵니다.",
      ),
    ).toBeTruthy();
  });
});
