// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  FileContent,
  MockFileEntry,
  SessionEntry,
  SessionInteractionEntry,
} from "../../src/api-types.js";
import { MockBuilder } from "../src/screens/MockBuilder.js";

interface Put {
  readonly url: string;
  readonly body: { content: string; baseMtimeMs: number };
}

let puts: Put[];

const LOADED: FileContent = {
  path: "examples/weather.mock.json",
  content: JSON.stringify({
    tools: [
      {
        name: "get_weather",
        description: "도시의 현재 날씨",
        inputSchema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    ],
    responses: [
      {
        tool: "get_weather",
        args: { city: "Seoul" },
        result: { temperature: 21.5 },
        isError: false,
      },
    ],
  }),
  mtimeMs: 7,
};

/** PUT 응답을 차례대로 돌려준다. GET 은 목 하나 · 녹화본 하나 · 응답 하나다. */
function mockApi(putResponses: Response[]): void {
  puts = [];
  const mocks: MockFileEntry[] = [{ path: LOADED.path, toolCount: 1, responseCount: 1 }];
  const sessions: SessionEntry[] = [
    { path: "weather.session.db", status: "completed", interactionCount: 1 },
  ];
  const interactions: SessionInteractionEntry[] = [
    {
      ordinal: 0,
      method: "GET",
      url: "https://api.open-meteo.com/<redacted>?city=Seoul",
      outcome: {
        kind: "response",
        status: 200,
        body: { temperature: 21.5, next: "https://api.open-meteo.com/v1/page/2?key=abc" },
      },
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
      const url = String(input);
      if (init?.method === "PUT") {
        puts.push({ url, body: JSON.parse(init.body ?? "{}") });
        const next = putResponses.shift();
        if (next === undefined) throw new Error("PUT 응답이 더 없다");
        return next;
      }
      if (url.endsWith("/api/mocks")) return new Response(JSON.stringify(mocks));
      if (url.startsWith("/api/mocks/")) return new Response(JSON.stringify(LOADED));
      if (url.endsWith("/api/sessions")) return new Response(JSON.stringify(sessions));
      if (url.endsWith("/interactions")) return new Response(JSON.stringify(interactions));
      throw new Error(`예상하지 못한 요청: ${url}`);
    }),
  );
}

const saved = (mtimeMs = 1) =>
  new Response(JSON.stringify({ saved: true, mtimeMs }), { status: 200 });
const conflict = (mtimeMs: number) =>
  new Response(JSON.stringify({ saved: false, reason: "conflict", mtimeMs }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function startNew(): Promise<void> {
  render(<MockBuilder />);
  fireEvent.click(await screen.findByRole("button", { name: "시작" }));
}

async function openLoaded(): Promise<void> {
  render(<MockBuilder />);
  fireEvent.click(await screen.findByRole("button", { name: `${LOADED.path} 열기` }));
  await screen.findByText(`편집 중: ${LOADED.path}`);
}

/** 도구 하나 · 응답 하나를 폼으로 채운다. */
function fillWeather(): void {
  fireEvent.click(screen.getByRole("button", { name: "도구 추가" }));
  fireEvent.change(screen.getByLabelText("도구 이름"), { target: { value: "get_weather" } });
  fireEvent.click(screen.getByRole("button", { name: "필드 추가" }));
  fireEvent.change(screen.getByLabelText("필드 1 이름"), { target: { value: "city" } });
  fireEvent.click(screen.getByLabelText("필드 1 필수"));
  fireEvent.click(screen.getByRole("button", { name: "응답 추가" }));
  fireEvent.change(screen.getByLabelText("args (JSON)"), { target: { value: '{"city":"Seoul"}' } });
  fireEvent.change(screen.getByLabelText("result (JSON)"), {
    target: { value: '{"temperature":21.5}' },
  });
}

const WEATHER_SCHEMA = {
  type: "object",
  properties: { city: { type: "string" } },
  required: ["city"],
};

const NEW_BYTES = `${JSON.stringify(
  {
    tools: [{ name: "get_weather", inputSchema: WEATHER_SCHEMA }],
    responses: [{ tool: "get_weather", args: { city: "Seoul" }, result: { temperature: 21.5 } }],
  },
  null,
  2,
)}\n`;

const LOADED_BYTES = `${JSON.stringify(
  {
    tools: [{ name: "get_weather", description: "도시의 현재 날씨", inputSchema: WEATHER_SCHEMA }],
    responses: [{ tool: "get_weather", args: { city: "Seoul" }, result: { temperature: 21.5 } }],
  },
  null,
  2,
)}\n`;

describe("MockBuilder — 새로 만들기", () => {
  it("폼으로 채워 저장한다. 처음은 baseMtimeMs 0, 저장 뒤에는 받은 mtime 이 기준이다", async () => {
    mockApi([saved(1), saved(2)]);
    await startNew();
    fillWeather();
    fireEvent.change(screen.getByLabelText("저장 위치"), {
      target: { value: "mocks/weather.mock.json" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText("저장했습니다 — mocks/weather.mock.json")).toBeTruthy();
    expect(screen.getByText("편집 중: mocks/weather.mock.json")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts).toEqual([
      { url: "/api/mocks/mocks%2Fweather.mock.json", body: { content: NEW_BYTES, baseMtimeMs: 0 } },
      { url: "/api/mocks/mocks%2Fweather.mock.json", body: { content: NEW_BYTES, baseMtimeMs: 1 } },
    ]);
  });

  it("경로에 파일이 있으면 '이미 파일이 있습니다' 로 묻고, 받은 mtime 으로 다시 보낸다", async () => {
    mockApi([conflict(42), saved()]);
    await startNew();
    fillWeather();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText("이미 파일이 있습니다 — mock.json. 덮어쓸까요?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "덮어쓰기" }));
    expect(await screen.findByText("저장했습니다 — mock.json")).toBeTruthy();
    expect(puts.map((put) => put.body.baseMtimeMs)).toEqual([0, 42]);
  });

  it("서버가 거절하면 그 문장을 줄 그대로 보여준다", async () => {
    const message = [
      "→ 올바르지 않은 목 정의입니다 — mock.json: responses[0] 의 툴 'x' 이 tools 에 없습니다. 있는 툴: get_weather",
      '→ 형식: { "tools": [ { "name": ..., "inputSchema": ... } ], "responses": [ { "tool": ..., "result": ... } ] }',
    ].join("\n");
    mockApi([new Response(JSON.stringify({ error: message }), { status: 400 })]);
    await startNew();
    fillWeather();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect((await screen.findByRole("alert")).textContent).toBe(message);
  });

  it("조립할 수 없으면 PUT 하지 않고 문제를 전부 적는다", async () => {
    mockApi([]);
    await startNew();
    fireEvent.click(screen.getByRole("button", { name: "도구 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "응답 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    const alert = await screen.findByRole("alert");
    expect(Array.from(alert.querySelectorAll("li")).map((li) => li.textContent)).toEqual([
      "도구 1번의 이름이 비어 있습니다. 목이 tools/list 로 내보낼 이름을 적으세요.",
      "응답 1번의 도구를 고르세요.",
    ]);
    expect(puts).toEqual([]);
  });

  it("카드 머리가 도구와 응답이 무엇인지 말하고, 새 응답은 첫 도구의 입력 필드로 args 를 채운다", async () => {
    mockApi([]);
    await startNew();
    expect(
      screen.getByText(
        '목 서버가 "이런 도구가 있다" 고 알려 주는 목록입니다. 입력 필드는 그 도구를 부를 때 넘기는 값입니다.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "도구가 불렸을 때 목이 돌려줄 답입니다. 도구와 args 가 호출과 똑같을 때 그 줄의 result 를 돌려줍니다.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "도구 추가" }));
    fireEvent.change(screen.getByLabelText("도구 이름"), { target: { value: "get_weather" } });
    fireEvent.click(screen.getByRole("button", { name: "필드 추가" }));
    fireEvent.change(screen.getByLabelText("필드 1 이름"), { target: { value: "city" } });
    fireEvent.click(screen.getByLabelText("필드 1 필수"));
    fireEvent.click(screen.getByRole("button", { name: "응답 추가" }));
    expect((screen.getByLabelText("args (JSON)") as HTMLTextAreaElement).value).toBe('{"city":""}');
  });
});

describe("MockBuilder — 기존 목 수정", () => {
  it("파일 내용으로 폼을 채우고, 같은 경로에 열 때 받은 mtime 으로 저장한다", async () => {
    mockApi([saved()]);
    await openLoaded();
    expect((screen.getByLabelText("도구 이름") as HTMLInputElement).value).toBe("get_weather");
    expect((screen.getByLabelText("설명") as HTMLInputElement).value).toBe("도시의 현재 날씨");
    expect((screen.getByLabelText("저장 위치") as HTMLInputElement).value).toBe(LOADED.path);

    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      url: "/api/mocks/examples%2Fweather.mock.json",
      body: { content: LOADED_BYTES, baseMtimeMs: 7 },
    });
  });

  it("열어 둔 사이 파일이 바뀌었으면 '불러온 뒤에 바뀌었습니다' 로 묻는다", async () => {
    mockApi([conflict(9), saved()]);
    await openLoaded();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(
      await screen.findByText(`이 파일이 불러온 뒤에 바뀌었습니다 — ${LOADED.path}. 덮어쓸까요?`),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "덮어쓰기" }));
    await waitFor(() => expect(puts.map((put) => put.body.baseMtimeMs)).toEqual([7, 9]));
  });

  it("저장 위치를 다른 경로로 바꾸면 새 파일처럼 0 을 보낸다", async () => {
    mockApi([saved()]);
    await openLoaded();
    fireEvent.change(screen.getByLabelText("저장 위치"), { target: { value: "copy.mock.json" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(puts[0]?.body.baseMtimeMs).toBe(0));
  });
});

describe("MockBuilder — 녹화본 가져오기 · 처음으로", () => {
  it("응답 카드에서 녹화본을 가져오면 result 가 채워져 강조되고, 출처와 URL 경고가 뜬다", async () => {
    mockApi([saved()]);
    await startNew();
    fireEvent.click(screen.getByRole("button", { name: "도구 추가" }));
    fireEvent.change(screen.getByLabelText("도구 이름"), { target: { value: "get_weather" } });
    fireEvent.click(screen.getByRole("button", { name: "응답 추가" }));
    expect(screen.queryByRole("button", { name: "녹화본 보기" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "녹화본에서 가져오기" }));
    fireEvent.click(await screen.findByRole("button", { name: "이걸로 채우기" }));

    expect((screen.getByLabelText("result (JSON)") as HTMLTextAreaElement).value).toBe(
      JSON.stringify(
        { temperature: 21.5, next: "https://api.open-meteo.com/v1/page/2?key=abc" },
        null,
        2,
      ),
    );
    expect(
      screen.getByLabelText("result (JSON)").closest("fieldset")?.getAttribute("data-highlighted"),
    ).toBe("true");
    expect(
      screen.getByText(
        "weather.session.db 의 1번째 외부 호출(GET api.open-meteo.com)에서 가져왔습니다.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "→ 서버가 바깥 API 에게서 받은 응답을 그대로 가져왔습니다. 서버가 사용자에게 돌려주는 답이 아닙니다.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "→ 실제 서버가 이 응답에서 값을 꺼내 다른 모양으로 답한다면, result 도 그 모양으로 고쳐 쓰세요.",
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText("녹화본")).toBeNull(); // 채우면 선택 창을 닫는다
    expect(
      screen.getByText(
        "→ 이 응답 본문에 URL 이 1개 있습니다. 녹화 때 가려지지 않는 자리라 자격증명이 담겼을 수 있습니다.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "→ 녹화본에서 가져온 result 에 URL 이 1개 있습니다. 녹화 때 가려지지 않는 자리라 자격증명이 담겼을 수 있습니다.",
      ),
    ).toBeTruthy();

    // 경고는 저장을 막지 않는다.
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(puts).toHaveLength(1));
  });

  it("선택 창은 한 카드에서만 열린다", async () => {
    mockApi([]);
    await startNew();
    fireEvent.click(screen.getByRole("button", { name: "응답 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "응답 추가" }));
    const [first, second] = screen.getAllByRole("button", { name: "녹화본에서 가져오기" });
    fireEvent.click(first as HTMLElement);
    await screen.findByLabelText("녹화본");
    fireEvent.click(second as HTMLElement);
    await screen.findByLabelText("녹화본");
    expect(screen.getAllByLabelText("녹화본")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "녹화본 닫기" })).toHaveLength(1);
  });

  it("고친 뒤 처음으로 가려면 버릴지 묻는다. 고치지 않았으면 바로 간다", async () => {
    mockApi([]);
    await startNew();
    fireEvent.click(screen.getByRole("button", { name: "← 처음으로" }));
    expect(await screen.findByRole("button", { name: "시작" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    fireEvent.click(await screen.findByRole("button", { name: "도구 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "← 처음으로" }));
    expect(screen.getByText("→ 지금 폼의 내용을 버리고 처음으로 돌아갑니다.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "버리고 돌아가기" }));
    expect(await screen.findByRole("button", { name: "시작" })).toBeTruthy();
  });
});
