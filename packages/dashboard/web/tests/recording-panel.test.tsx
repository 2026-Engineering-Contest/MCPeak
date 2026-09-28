// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JsonValue, SessionEntry, SessionInteractionEntry } from "../../src/api-types.js";
import type { PickedResponse } from "../src/mock-builder/draft.js";
import { RecordingPanel, type ResponseTarget } from "../src/mock-builder/RecordingPanel.js";

const SESSION = "recordings/weather.session.db";

const INTERACTIONS: SessionInteractionEntry[] = [
  {
    ordinal: 0,
    method: "GET",
    url: "https://api.open-meteo.com/<redacted>?city=Seoul",
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

let requested: string[];

function mockApi(options: { sessions?: SessionEntry[]; interactions?: () => Response } = {}): void {
  requested = [];
  const sessions = options.sessions ?? [
    { path: SESSION, status: "completed", interactionCount: 3 },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("/api/sessions")) return new Response(JSON.stringify(sessions));
      if (url.endsWith("/interactions")) {
        return options.interactions?.() ?? new Response(JSON.stringify(INTERACTIONS));
      }
      throw new Error(`예상하지 못한 요청: ${url}`);
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface Calls {
  readonly added: PickedResponse[];
  readonly replaced: [number, JsonValue][];
}

function renderPanel(responses: readonly ResponseTarget[] = []): Calls {
  const calls: Calls = { added: [], replaced: [] };
  render(
    <RecordingPanel
      toolNames={["get_weather"]}
      responses={responses}
      onAdd={(pick) => calls.added.push(pick)}
      onReplaceResult={(index, body) => calls.replaced.push([index, body])}
    />,
  );
  return calls;
}

async function openSession(): Promise<void> {
  await screen.findByRole("option", { name: `${SESSION} · 외부 호출 3건` });
  fireEvent.change(screen.getByLabelText("녹화본"), { target: { value: SESSION } });
  await screen.findByText("GET https://api.open-meteo.com/<redacted>?city=Seoul · 200");
}

describe("RecordingPanel", () => {
  it("녹화본을 고르면 세 갈래를 보여주고, 응답만 쓸 수 있다", async () => {
    mockApi();
    renderPanel();
    await openSession();

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
    expect(screen.getAllByRole("button", { name: "새 응답으로 추가" })).toHaveLength(1);
    expect(requested).toContain("/api/sessions/recordings%2Fweather.session.db/interactions");
  });

  it("새 응답으로 추가: 도구 이름과 인자를 적어 넣고, 넣으면 입력 칸을 닫는다", async () => {
    mockApi();
    const calls = renderPanel();
    await openSession();
    fireEvent.click(screen.getByRole("button", { name: "새 응답으로 추가" }));
    fireEvent.change(screen.getByLabelText("어느 도구의 답인가"), {
      target: { value: "get_weather" },
    });
    fireEvent.change(screen.getByLabelText("어떤 인자일 때 (JSON)"), {
      target: { value: '{"city":"Seoul"}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "목에 넣기" }));

    expect(calls.added).toEqual([
      { tool: "get_weather", argsJson: '{"city":"Seoul"}', body: { temperature: 21.5 } },
    ]);
    expect(screen.queryByRole("button", { name: "목에 넣기" })).toBeNull();
  });

  it("인자 무관으로 넣으면 argsJson 이 null 이다", async () => {
    mockApi();
    const calls = renderPanel();
    await openSession();
    fireEvent.click(screen.getByRole("button", { name: "새 응답으로 추가" }));
    fireEvent.change(screen.getByLabelText("어느 도구의 답인가"), {
      target: { value: "get_weather" },
    });
    fireEvent.click(screen.getByLabelText("인자 무관으로 넣기"));
    fireEvent.click(screen.getByRole("button", { name: "목에 넣기" }));
    expect(calls.added[0]?.argsJson).toBeNull();
  });

  it("도구 이름이 비면 넣지 않고 말한다", async () => {
    mockApi();
    const calls = renderPanel();
    await openSession();
    fireEvent.click(screen.getByRole("button", { name: "새 응답으로 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "목에 넣기" }));
    expect(calls.added).toEqual([]);
    expect(
      screen.getByText("어느 도구의 답인지 적으세요. 폼에 없는 도구면 이름만 채워 새로 만듭니다."),
    ).toBeTruthy();
  });

  it("result 로 넣기: 비어 있는 줄은 확인 없이 바꾼다", async () => {
    mockApi();
    const calls = renderPanel([
      { label: "응답 1 (get_weather)", resultJson: '{"temperature":1}' },
      { label: "응답 2 (get_weather)", resultJson: "{}" },
    ]);
    await openSession();
    fireEvent.change(screen.getByLabelText("넣을 응답"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "result 로 넣기" }));
    expect(calls.replaced).toEqual([[1, { temperature: 21.5 }]]);
  });

  it("result 로 넣기: 값이 있는 줄은 확인을 받는다", async () => {
    mockApi();
    const calls = renderPanel([{ label: "응답 1 (get_weather)", resultJson: '{"temperature":1}' }]);
    await openSession();
    fireEvent.click(screen.getByRole("button", { name: "result 로 넣기" }));
    expect(calls.replaced).toEqual([]);
    expect(
      screen.getByText(
        "응답 1 (get_weather) 의 result 를 이 본문으로 바꿉니다. 지금 적힌 값은 사라집니다.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "바꾸기" }));
    expect(calls.replaced).toEqual([[0, { temperature: 21.5 }]]);
  });

  it("폼에 응답이 없으면 result 로 넣기가 없다", async () => {
    mockApi();
    renderPanel([]);
    await openSession();
    expect(screen.queryByRole("button", { name: "result 로 넣기" })).toBeNull();
  });

  it("녹화본을 읽을 수 없으면 서버 문장을 줄 그대로 보여준다", async () => {
    const message = [
      `→ 이 녹화본을 읽을 수 없습니다 — ${SESSION}`,
      "→ MCPeak 이 녹화한 세션 파일인지 확인하세요. 목록에는 읽을 수 있는 파일만 나옵니다.",
    ].join("\n");
    mockApi({
      interactions: () => new Response(JSON.stringify({ error: message }), { status: 404 }),
    });
    renderPanel();
    await screen.findByRole("option", { name: `${SESSION} · 외부 호출 3건` });
    fireEvent.change(screen.getByLabelText("녹화본"), { target: { value: SESSION } });
    expect((await screen.findByRole("alert")).textContent).toBe(message);
  });

  it("녹화본이 없으면 어떻게 만드는지 말한다", async () => {
    mockApi({ sessions: [] });
    renderPanel();
    expect(
      await screen.findByText(
        "이 디렉터리 아래에 녹화본이 없습니다. mcpeak test --record-session <path> 로 녹화한 파일이 여기에 나옵니다.",
      ),
    ).toBeTruthy();
  });
});
