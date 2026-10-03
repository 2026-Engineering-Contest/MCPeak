// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnalyzeTokensResponse,
  ServerCandidate,
  ServerMeta,
  SourceEditResponse,
} from "../../src/api-types.js";
import { describeChange, formatToolSide } from "../src/analyze/tool-diff.js";
import { AnalyzeView } from "../src/screens/AnalyzeView.js";

const META: ServerMeta = { root: "/tmp/proj" };
/** home.test 의 WEATHER 와 같은 값이다. */
const WEATHER: ServerCandidate = {
  id: "mcp-config:.mcp.json:weather",
  name: "weather",
  command: "node",
  args: ["examples/weather-server/server.mjs", "--port", "3000"],
  source: "mcp-config",
  path: ".mcp.json",
  envNames: ["API_KEY"],
};

/** 도구 a 의 원본. 압축본은 `$schema` 키만 빠진다. */
const SOURCE_A = {
  name: "a",
  description: "A",
  inputSchema: { $schema: "http://json-schema.org/draft-07/schema#", type: "object" },
};

/** WEATHER 후보로 분석할 때 화면이 만드는 argv. */
const WEATHER_ARGV = [
  "--command",
  "node",
  "--arg",
  "examples/weather-server/server.mjs",
  "--arg",
  "--port",
  "--arg",
  "3000",
  "--env",
  "API_KEY",
];

const SCHEMA_CHANGE = { kind: "schema-key-removed", path: "/", key: "$schema" } as const;
const CLEANED_CHANGE = {
  kind: "description-cleaned",
  path: "/",
  before: "A tool.  ",
  after: "A",
} as const;
/** `cleanedResponse()` 의 변경을 도구 이름과 함께 편 것. 화면이 이 순서로 보낸다. */
const CLEANED_EDITS = [
  { tool: "a", change: SCHEMA_CHANGE },
  { tool: "a", change: CLEANED_CHANGE },
];

const NOT_FOUND_DETAIL =
  "소스 파일에서 찾지 못했습니다. SDK 나 라이브러리가 만드는 값이면 소스에서 고칠 수 없습니다.";
const SOURCE_BEFORE =
  'const tools = [\n  {\n    name: "a",\n    description: "A tool.  ",\n  },\n];\n';
const SOURCE_AFTER = SOURCE_BEFORE.replace('"A tool.  "', '"A"');

/** `cleanedResponse()` 에 대한 미리보기. 설명 한 건만 소스에 있다. */
function previewResponse(overrides: Partial<SourceEditResponse> = {}): SourceEditResponse {
  return {
    file: "srv/server.mjs",
    mtimeMs: 10,
    before: SOURCE_BEFORE,
    after: SOURCE_AFTER,
    results: [
      { tool: "a", change: SCHEMA_CHANGE, status: "not-found", detail: NOT_FOUND_DETAIL },
      {
        tool: "a",
        change: CLEANED_CHANGE,
        status: "ready",
        detail: "소스에서 1곳을 찾았습니다.",
      },
    ],
    readyCount: 1,
    applied: false,
    conflict: false,
    ...overrides,
  };
}

const OVERLAY_TEXT = '{\n  "schemaVersion": 1\n}\n';

/** 비교 `<pre>` 의 줄 하나에서 표시 글자(`aria-hidden`)를 뺀 원래 줄. */
function lineText(line: Element): string {
  return [...line.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? "")
    .join("");
}

/** 비교 `<pre>` 를 줄 단위로 읽어 원래 문자열로 되돌린다. */
function preText(pre: Element): string {
  return [...pre.querySelectorAll("[data-diff]")].map(lineText).join("\n");
}

/** 도구 a 의 설명까지 바뀐 응답. 원본에는 지운 줄, 압축에는 바뀐 줄이 생긴다. */
function cleanedResponse(): AnalyzeTokensResponse {
  const base = analyzeResponse();
  const [a, b] = base.overlay.tools;
  if (a === undefined || b === undefined) {
    throw new Error("analyzeResponse 의 도구가 둘이 아니다");
  }
  return {
    ...base,
    overlay: {
      ...base.overlay,
      tools: [
        {
          ...a,
          changes: [
            ...a.changes,
            { kind: "description-cleaned", path: "/", before: "A tool.  ", after: "A" },
          ],
        },
        b,
      ],
    },
    sourceTools: [
      { ...SOURCE_A, description: "A tool.  " },
      { name: "b", inputSchema: {} },
    ],
  };
}

function analyzeResponse(
  otherCapabilities: AnalyzeTokensResponse["overlay"]["source"]["otherCapabilities"] = [],
): AnalyzeTokensResponse {
  return {
    overlay: {
      schemaVersion: 1,
      generator: { name: "@mcpeak/optimize", version: "0.0.0" },
      source: {
        toolCount: 2,
        toolNames: ["a", "b"],
        instructions: "",
        bytes: 1000,
        otherCapabilities,
      },
      instructions: "",
      tools: [
        {
          name: "a",
          description: "A",
          inputSchema: { type: "object" },
          bytes: { before: 600, after: 400 },
          changes: [{ kind: "schema-key-removed", path: "/", key: "$schema" }],
        },
        { name: "b", inputSchema: {}, bytes: { before: 400, after: 360 }, changes: [] },
      ],
      totals: {
        bytesBefore: 1000,
        bytesAfter: 700,
        bytesAfterWithInstructions: 760,
        promotedParameters: 2,
      },
    },
    overlayText: OVERLAY_TEXT,
    report: "REPORT\n",
    sourceTools: [SOURCE_A, { name: "b", inputSchema: {} }],
  };
}

interface StubResponse {
  readonly status: number;
  readonly body: unknown;
}

/**
 * home.test 의 stubFetch 와 같은 방식. POST 응답만 이 화면의 것으로 바꿔 둔다. 배열로 주면 요청
 * 순서대로 하나씩 쓰고, 다 쓰면 마지막 것을 되풀이한다.
 */
function stubFetch(
  options: {
    readonly servers?: readonly ServerCandidate[];
    readonly analyze?: StubResponse | readonly StubResponse[];
    readonly sourceEdits?: readonly StubResponse[];
  } = {},
): ReturnType<typeof vi.fn> {
  const servers = options.servers ?? [WEATHER];
  const analyzeQueue: readonly StubResponse[] = [
    options.analyze ?? { status: 200, body: analyzeResponse() },
  ].flat();
  const sourceEditQueue = options.sourceEdits ?? [{ status: 200, body: previewResponse() }];
  let analyzeCount = 0;
  let sourceEditCount = 0;
  const take = (queue: readonly StubResponse[], index: number): Response => {
    const picked = queue[Math.min(index, queue.length - 1)];
    return new Response(JSON.stringify(picked?.body), { status: picked?.status ?? 500 });
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST" && url === "/api/analyze/tokens") {
      analyzeCount += 1;
      return take(analyzeQueue, analyzeCount - 1);
    }
    if (init?.method === "POST" && url === "/api/analyze/source-edits") {
      sourceEditCount += 1;
      return take(sourceEditQueue, sourceEditCount - 1);
    }
    if (url === "/api/servers") {
      return new Response(JSON.stringify(servers), { status: 200 });
    }
    if (url === "/api/meta") {
      return new Response(JSON.stringify(META), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** `url` 로 보낸 POST 본문을 보낸 순서대로. */
function postedBodies(
  fetchMock: ReturnType<typeof vi.fn>,
  url: string,
): readonly Record<string, unknown>[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => String(input) === url && init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>, method: string): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === method);
  return JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>;
}

/** 첫 후보가 선택될 때까지 기다린 뒤 분석을 시작하고 결과 요약이 뜰 때까지 기다린다. */
async function analyze(): Promise<void> {
  await screen.findByRole("radio", { name: /^weather/ });
  fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));
}

/** `aria-current="step"` 인 단계의 이름. 번호 칸을 빼고 라벨(마지막 span)만 읽는다. */
function currentStep(): string | null {
  return document.querySelector('[aria-current="step"] > span:last-child')?.textContent ?? null;
}

describe("AnalyzeView", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("토큰 탭이 기본이고 탭 둘이 tablist 에 있다", async () => {
    stubFetch();
    render(<AnalyzeView tab="tokens" />);

    const tablist = screen.getByRole("tablist", { name: "분석 종류" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["토큰", "보안"]);
    expect(screen.getByRole("tab", { name: "토큰" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "보안" }).getAttribute("aria-selected")).toBe("false");
    await screen.findByRole("radio", { name: /^weather/ });
  });

  it("첫 후보가 초기 선택이고 분석 시작이 올바른 본문을 POST 한다", async () => {
    const fetchMock = stubFetch();
    render(<AnalyzeView tab="tokens" />);

    expect(await screen.findByRole("radio", { name: /^weather/ })).toHaveProperty("checked", true);
    fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => url === "/api/analyze/tokens" && init?.method === "POST",
        ),
      ).toBe(true);
    });
    expect(sentBody(fetchMock, "POST")).toEqual({
      argv: [
        "--command",
        "node",
        "--arg",
        "examples/weather-server/server.mjs",
        "--arg",
        "--port",
        "--arg",
        "3000",
        "--env",
        "API_KEY",
      ],
      serverId: WEATHER.id,
    });
  });

  it("명령이 비면 버튼이 비활성이고 사유를 보인다", async () => {
    stubFetch({ servers: [] });
    render(<AnalyzeView tab="tokens" />);

    await screen.findByText(/bin 을 찾지 못했습니다/);
    expect(screen.getByRole("button", { name: "분석 시작" })).toHaveProperty("disabled", true);
    expect(screen.getByText("서버를 고르거나 실행 명령을 입력하세요.")).toBeTruthy();
  });

  it("성공 응답의 숫자를 요약과 표에 보이고 CLI 리포트 원문을 담는다", async () => {
    stubFetch();
    render(<AnalyzeView tab="tokens" />);
    await analyze();

    expect(await screen.findByText("1000 바이트 (~250 토큰)")).toBeTruthy();
    expect(screen.getByText("760 바이트 (~190 토큰, 24.0% 감소)")).toBeTruthy();
    expect(screen.getByText("2개 (공통 파라미터 2개 승격)")).toBeTruthy();

    const table = screen.getByRole("table", { name: "도구별 감소" });
    const rows = within(table).getAllByRole("row").slice(1);
    const cells = rows.map((row) =>
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    );
    expect(cells).toEqual([
      ["a", "600", "400", "33.3%", "1", "변경사항"],
      ["b", "400", "360", "10.0%", "0", "변경 없음"],
    ]);
    expect(screen.getByText("REPORT", { selector: "pre" })).toBeTruthy();
    // otherCapabilities 가 비었으면 주의 문장이 없다.
    expect(screen.queryByText(/^주의:/)).toBeNull();
  });

  it("otherCapabilities 가 있으면 주의 문장을 보인다", async () => {
    stubFetch({ analyze: { status: 200, body: analyzeResponse(["resources"]) } });
    render(<AnalyzeView tab="tokens" />);
    await analyze();

    const notice = await screen.findByText(/^주의:/);
    expect(notice.textContent).toContain("주의: 서버가 resources 능력도 광고합니다.");
    expect(notice.textContent).toBe(
      "주의: 서버가 resources 능력도 광고합니다. 프록시는 tools 만 중계하므로 그 능력은\n클라이언트에 보이지 않습니다.",
    );
  });

  it("실패 응답의 error 문장을 그대로 보인다", async () => {
    const error = "오류 [MCP_CONNECTION_FAILED]: x\n해결: y";
    stubFetch({ analyze: { status: 400, body: { error } } });
    render(<AnalyzeView tab="tokens" />);
    await analyze();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(error);
    expect(screen.queryByRole("table", { name: "도구별 감소" })).toBeNull();
  });

  it("처음에는 서버 선택 단계다", async () => {
    stubFetch();
    render(<AnalyzeView tab="tokens" />);
    await screen.findByRole("radio", { name: /^weather/ });

    expect(currentStep()).toBe("서버 선택");
    expect(screen.queryByRole("table", { name: "도구별 감소" })).toBeNull();
  });

  it("성공하면 결과 단계로 넘어가 폼이 사라진다", async () => {
    stubFetch();
    render(<AnalyzeView tab="tokens" />);
    await analyze();

    await screen.findByRole("table", { name: "도구별 감소" });
    expect(currentStep()).toBe("결과");
    expect(screen.queryByRole("button", { name: "분석 시작" })).toBeNull();
  });

  it("실패하면 서버 선택 단계에 머문다", async () => {
    stubFetch({ analyze: { status: 400, body: { error: "오류 [X]: a\n해결: b" } } });
    render(<AnalyzeView tab="tokens" />);
    await analyze();

    await screen.findByRole("alert");
    expect(currentStep()).toBe("서버 선택");
    expect(screen.getByRole("button", { name: "분석 시작" })).toBeTruthy();
  });

  it("서버 다시 고르기를 누르면 폼으로 돌아온다", async () => {
    stubFetch();
    render(<AnalyzeView tab="tokens" />);
    await analyze();

    fireEvent.click(await screen.findByRole("button", { name: "← 서버 다시 고르기" }));

    expect(currentStep()).toBe("서버 선택");
    expect(screen.queryByRole("table", { name: "도구별 감소" })).toBeNull();
    // 폼 상태는 유지된다. 고른 후보가 그대로다.
    expect(screen.getByRole("radio", { name: /^weather/ })).toHaveProperty("checked", true);
    expect(screen.getByRole("button", { name: "분석 시작" })).toHaveProperty("disabled", false);
  });

  it("변경사항을 누르면 원본·압축 JSON 과 변경 목록이 보이고 다시 누르면 사라진다", async () => {
    stubFetch();
    render(<AnalyzeView tab="tokens" />);
    await analyze();

    const table = await screen.findByRole("table", { name: "도구별 감소" });
    const rowA = within(table).getAllByRole("row")[1] as HTMLElement;
    const toggle = within(rowA).getByRole("button", { name: "변경사항" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const panelId = toggle.getAttribute("aria-controls") ?? "";
    const panel = document.getElementById(panelId) as HTMLElement;
    expect(panel).toBeTruthy();
    expect(within(panel).getByText("원본 (600 바이트)")).toBeTruthy();
    expect(within(panel).getByText("압축 (400 바이트)")).toBeTruthy();
    const pres = panel.querySelectorAll("pre");
    expect([...pres].map(preText)).toEqual([
      formatToolSide(SOURCE_A),
      formatToolSide({ name: "a", description: "A", inputSchema: { type: "object" } }),
    ]);
    const list = within(panel).getByRole("list", { name: "a 변경 목록" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([describeChange({ kind: "schema-key-removed", path: "/", key: "$schema" })]);
    // 경로는 <code> 안에 있고, 화면에 백틱 문자가 그대로 보이지 않는다.
    expect([...list.querySelectorAll("li > code")].map((code) => code.textContent)).toEqual(["/"]);
    expect(list.textContent).not.toContain("`");

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById(panelId)).toBeNull();
  });

  it("펼치면 원본 칸에 removed 줄, 압축 칸에 added 줄이 표시된다", async () => {
    stubFetch({ analyze: { status: 200, body: cleanedResponse() } });
    render(<AnalyzeView tab="tokens" />);
    await analyze();

    const toggle = await screen.findByRole("button", { name: "변경사항" });
    fireEvent.click(toggle);

    const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    const [beforePre, afterPre] = [...(panel?.querySelectorAll("pre") ?? [])];
    if (beforePre === undefined || afterPre === undefined) {
      throw new Error("비교 <pre> 가 둘이 아니다");
    }

    const removed = [...beforePre.querySelectorAll('[data-diff="removed"]')];
    expect(removed.map(lineText)).toEqual([
      '  "description": "A tool.  ",',
      '    "$schema": "http://json-schema.org/draft-07/schema#",',
    ]);
    expect(beforePre.querySelectorAll('[data-diff="added"]')).toHaveLength(0);
    const added = [...afterPre.querySelectorAll('[data-diff="added"]')];
    expect(added.map(lineText)).toEqual(['  "description": "A",']);
    expect(afterPre.querySelectorAll('[data-diff="removed"]')).toHaveLength(0);

    // 줄 앞 표시 글자는 한 칸이고 읽기 도구에는 숨긴다.
    const marks = (lines: readonly Element[]): readonly (string | null)[] =>
      lines.map((line) => line.querySelector('[aria-hidden="true"]')?.textContent ?? null);
    expect(marks(removed)).toEqual(["-", "-"]);
    expect(marks(added)).toEqual(["+"]);
    expect(marks([...afterPre.querySelectorAll('[data-diff="same"]')].slice(0, 1))).toEqual([" "]);
    // 색은 기존 상태 토큰이다.
    expect((removed[0] as HTMLElement).style.backgroundColor).toBe("var(--status-failed-bg)");
    expect((removed[0] as HTMLElement).style.color).toBe("var(--status-failed-fg)");
    expect((added[0] as HTMLElement).style.backgroundColor).toBe("var(--status-done-bg)");
    expect((added[0] as HTMLElement).style.color).toBe("var(--status-done-fg)");
    // 강조가 들어가도 줄을 이으면 원래 JSON 이다.
    expect(preText(beforePre)).toBe(formatToolSide({ ...SOURCE_A, description: "A tool.  " }));
  });

  it("변경사항 버튼은 접히면 on-accent, 펼치면 primary 다", async () => {
    stubFetch();
    render(<AnalyzeView tab="tokens" />);
    await analyze();

    const toggle = await screen.findByRole("button", { name: "변경사항" });
    expect(toggle.className).toContain("border-accent-border");
    expect(toggle.className.split(" ")).not.toContain("bg-accent");

    fireEvent.click(toggle);

    expect(toggle.className.split(" ")).toContain("bg-accent");
    expect(toggle.className).not.toContain("border-accent-border");

    fireEvent.click(toggle);

    expect(toggle.className).toContain("border-accent-border");
  });

  it("원본을 찾지 못하면 그 자리에 안내 문장을 보인다", async () => {
    stubFetch({ analyze: { status: 200, body: { ...analyzeResponse(), sourceTools: [] } } });
    render(<AnalyzeView tab="tokens" />);
    await analyze();

    fireEvent.click(await screen.findByRole("button", { name: "변경사항" }));

    expect(screen.getByText("원본 정의를 찾지 못했습니다.")).toBeTruthy();
    // 견줄 원본이 없으니 압축 칸은 강조 없이 그린다.
    const pres = document.querySelectorAll('td[id^="analyze-diff-"] pre');
    expect(pres).toHaveLength(1);
    const kinds = [...(pres[0]?.querySelectorAll("[data-diff]") ?? [])].map((line) =>
      line.getAttribute("data-diff"),
    );
    expect(kinds.length).toBeGreaterThan(0);
    expect(new Set(kinds)).toEqual(new Set(["same"]));
  });

  it("변경이 없는 도구는 변경 없음 버튼이 비활성이다", async () => {
    stubFetch();
    render(<AnalyzeView tab="tokens" />);
    await analyze();

    expect(await screen.findByRole("button", { name: "변경 없음" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("결과 단계에 저장 경로와 오버레이 저장 버튼이 없다", async () => {
    const fetchMock = stubFetch();
    render(<AnalyzeView tab="tokens" />);
    await analyze();

    await screen.findByRole("table", { name: "도구별 감소" });
    expect(screen.queryByLabelText(/저장 경로/)).toBeNull();
    expect(screen.queryByRole("button", { name: "오버레이 저장" })).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "MCP 수정하기" })).toBeTruthy();
    expect(
      screen.getByText(
        "압축 변경을 서버 소스 파일에 직접 반영합니다. 적용 전에 바뀔 줄을 먼저 보여 줍니다.",
      ),
    ).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });

  /** 분석을 끝내고 `MCP 수정하기` 를 눌러 미리보기가 뜰 때까지 기다린다. */
  async function openPreview(): Promise<void> {
    await analyze();
    fireEvent.click(await screen.findByRole("button", { name: "MCP 수정하기" }));
    await screen.findByRole("list", { name: "변경별 상태" });
  }

  it("MCP 수정하기를 누르면 argv 와 변경 목록을 POST 하고 미리보기를 보인다", async () => {
    const fetchMock = stubFetch({ analyze: { status: 200, body: cleanedResponse() } });
    render(<AnalyzeView tab="tokens" />);
    await openPreview();

    expect(postedBodies(fetchMock, "/api/analyze/source-edits")).toEqual([
      { argv: WEATHER_ARGV, edits: CLEANED_EDITS },
    ]);
    const file = screen.getByText("srv/server.mjs", { selector: "code" });
    expect(file.parentElement?.textContent).toBe("파일: srv/server.mjs");
    expect(screen.getByText("적용 가능 1건 / 전체 2건")).toBeTruthy();

    const items = within(screen.getByRole("list", { name: "변경별 상태" })).getAllByRole(
      "listitem",
    );
    // 줄은 묶음마다 하나이고 ready 묶음이 먼저다.
    expect(items.map((item) => item.getAttribute("data-status"))).toEqual(["ready", "not-found"]);
    expect(items[0]?.textContent).toContain('설명을 정리했습니다: "A tool.  " → "A"');
    expect(items[0]?.textContent).toContain("1건 · a");
    expect(items[0]?.textContent).toContain("소스에서 1곳을 찾았습니다.");
    expect((items[0] as HTMLElement).style.color).toBe("var(--status-done-fg)");
    expect(items[1]?.querySelector("code")?.textContent).toBe("/");
    expect(items[1]?.textContent).toContain(
      "에서 '$schema' 키를 지웠습니다. 검증 의미는 같습니다.",
    );
    expect(items[1]?.textContent).toContain("1건 · a");
    expect(items[1]?.textContent).toContain(NOT_FOUND_DETAIL);
    expect(items[1]?.className).toContain("text-ink-muted");
    // 도구가 하나뿐인 묶음에는 펼침이 없다.
    expect(items[0]?.querySelector("details")).toBeNull();
    expect(items[1]?.querySelector("details")).toBeNull();

    const preview = screen.getByLabelText("파일 변경 미리보기");
    const pres = preview.querySelectorAll("pre");
    expect(pres).toHaveLength(1);
    const removed = [...preview.querySelectorAll('[data-diff="removed"]')];
    const added = [...preview.querySelectorAll('[data-diff="added"]')];
    expect(removed.map(lineText)).toEqual(['    description: "A tool.  ",']);
    expect(added.map(lineText)).toEqual(['    description: "A",']);
    // 줄 번호는 지운 줄이 원본 기준, 바뀐 줄이 고친 파일 기준이다.
    expect(removed[0]?.querySelector("[data-line-no]")?.textContent?.trim()).toBe("4");
    expect(added[0]?.querySelector("[data-line-no]")?.textContent?.trim()).toBe("4");
    // 앞뒤 문맥은 2줄씩이다.
    expect(preText(pres[0] as Element)).toBe(
      [
        "  {",
        '    name: "a",',
        '    description: "A tool.  ",',
        '    description: "A",',
        "  },",
        "];",
      ].join("\n"),
    );
    expect(screen.getByRole("button", { name: "적용" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: "취소" })).toBeTruthy();
  });

  it("적용을 누르면 baseMtimeMs 를 실어 보내고 결과 문장과 다시 분석 버튼을 보인다", async () => {
    const fetchMock = stubFetch({
      analyze: { status: 200, body: cleanedResponse() },
      sourceEdits: [
        { status: 200, body: previewResponse() },
        {
          status: 200,
          body: previewResponse({ applied: true, mtimeMs: 20, before: SOURCE_AFTER }),
        },
      ],
    });
    render(<AnalyzeView tab="tokens" />);
    await openPreview();

    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe(
      "srv/server.mjs 에 1건을 적용했습니다. 다시 분석하면 줄어든 결과를 확인할 수 있습니다.",
    );
    expect(postedBodies(fetchMock, "/api/analyze/source-edits")).toEqual([
      { argv: WEATHER_ARGV, edits: CLEANED_EDITS },
      { argv: WEATHER_ARGV, edits: CLEANED_EDITS, apply: { baseMtimeMs: 10 } },
    ]);
    // 미리보기는 닫힌다.
    expect(screen.queryByRole("list", { name: "변경별 상태" })).toBeNull();
    expect(screen.queryByLabelText("파일 변경 미리보기")).toBeNull();
    expect(screen.queryByRole("button", { name: "적용" })).toBeNull();
    expect(screen.getByRole("button", { name: "다시 분석" })).toBeTruthy();
  });

  it("다시 분석을 누르면 같은 argv 로 POST /api/analyze/tokens 를 다시 보낸다", async () => {
    const fetchMock = stubFetch({
      analyze: [
        { status: 200, body: cleanedResponse() },
        { status: 200, body: analyzeResponse() },
      ],
      sourceEdits: [
        { status: 200, body: previewResponse() },
        { status: 200, body: previewResponse({ applied: true, mtimeMs: 20 }) },
      ],
    });
    render(<AnalyzeView tab="tokens" />);
    await openPreview();
    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    fireEvent.click(await screen.findByRole("button", { name: "다시 분석" }));

    await waitFor(() => {
      expect(postedBodies(fetchMock, "/api/analyze/tokens")).toHaveLength(2);
    });
    const [first, second] = postedBodies(fetchMock, "/api/analyze/tokens");
    expect(first).toEqual({ argv: WEATHER_ARGV, serverId: WEATHER.id });
    expect(second).toEqual(first);
    // 새 결과가 오면 카드는 처음 상태로 돌아간다. 결과 단계를 떠나지 않는다.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "다시 분석" })).toBeNull();
    });
    expect(screen.getByRole("button", { name: "MCP 수정하기" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(currentStep()).toBe("결과");
  });

  it("다시 분석이 실패하면 결과 단계에 머물고 CLI 문장을 보인다", async () => {
    const error = "오류 [MCP_CONNECTION_FAILED]: x\n해결: y";
    stubFetch({
      analyze: [
        { status: 200, body: cleanedResponse() },
        { status: 400, body: { error } },
      ],
      sourceEdits: [
        { status: 200, body: previewResponse() },
        { status: 200, body: previewResponse({ applied: true, mtimeMs: 20 }) },
      ],
    });
    render(<AnalyzeView tab="tokens" />);
    await openPreview();
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    fireEvent.click(await screen.findByRole("button", { name: "다시 분석" }));

    const alert = await screen.findByRole("alert");
    expect(alert.tagName).toBe("PRE");
    expect(alert.textContent).toBe(error);
    expect(currentStep()).toBe("결과");
    // 이전 결과는 그대로다.
    expect(screen.getByRole("table", { name: "도구별 감소" })).toBeTruthy();
  });

  it("conflict 면 다시 계산했다는 문장을 보이고 미리보기를 바꾼다", async () => {
    const changedBefore = `// 새 주석\n${SOURCE_BEFORE}`;
    const changedAfter = `// 새 주석\n${SOURCE_AFTER}`;
    const fetchMock = stubFetch({
      analyze: { status: 200, body: cleanedResponse() },
      sourceEdits: [
        { status: 200, body: previewResponse() },
        {
          status: 200,
          body: previewResponse({
            conflict: true,
            mtimeMs: 30,
            before: changedBefore,
            after: changedAfter,
          }),
        },
        { status: 200, body: previewResponse({ applied: true, mtimeMs: 40 }) },
      ],
    });
    render(<AnalyzeView tab="tokens" />);
    await openPreview();

    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "미리보기 뒤에 srv/server.mjs 이 바뀌었습니다. 바뀐 내용으로 다시 계산했으니 확인하고 적용하세요.",
    );
    // 미리보기가 응답의 것으로 바뀌었다. 줄 번호가 한 줄 밀린다.
    const removed = screen
      .getByLabelText("파일 변경 미리보기")
      .querySelector('[data-diff="removed"]');
    expect(removed?.querySelector("[data-line-no]")?.textContent?.trim()).toBe("5");
    expect(screen.queryByRole("status")).toBeNull();

    // 다시 적용하면 새 미리보기의 mtime 을 싣는다.
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    await screen.findByRole("status");
    expect(postedBodies(fetchMock, "/api/analyze/source-edits")[2]).toEqual({
      argv: WEATHER_ARGV,
      edits: CLEANED_EDITS,
      apply: { baseMtimeMs: 30 },
    });
  });

  /** 소스에서 하나도 못 고치는 미리보기. `results` 만 바꿔 쓴다. */
  function noReadyPreview(results: SourceEditResponse["results"]): StubResponse {
    return {
      status: 200,
      body: previewResponse({ after: SOURCE_BEFORE, results, readyCount: 0 }),
    };
  }

  const PROXY_GUIDE =
    "소스에서 고칠 수 있는 변경이 없습니다. 전부 SDK 나 라이브러리가 만드는 값으로 보입니다. 이런 값은 서버 소스가 아니라 프록시(mcpeak-optimize-proxy)로 줄입니다.";
  const REASON_GUIDE = "소스에서 고칠 수 있는 변경이 없습니다. 위 사유를 확인하세요.";

  it("ready 가 0 이면 적용 버튼이 없고 닫기로 미리보기를 닫는다", async () => {
    stubFetch({
      sourceEdits: [
        noReadyPreview([
          { tool: "a", change: SCHEMA_CHANGE, status: "not-found", detail: NOT_FOUND_DETAIL },
        ]),
      ],
    });
    render(<AnalyzeView tab="tokens" />);
    await openPreview();

    expect(screen.getByText("적용 가능 0건 / 전체 1건")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "적용" })).toBeNull();
    expect(screen.queryByRole("button", { name: "취소" })).toBeNull();
    expect(screen.queryByLabelText("파일 변경 미리보기")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));

    expect(screen.queryByRole("list", { name: "변경별 상태" })).toBeNull();
    expect(screen.getByRole("button", { name: "MCP 수정하기" })).toHaveProperty("disabled", false);
  });

  it("같은 사유의 변경은 한 줄로 묶어 건수와 도구를 보인다", async () => {
    stubFetch({
      sourceEdits: [
        noReadyPreview(
          ["a", "b", "c"].map((tool) => ({
            tool,
            change: SCHEMA_CHANGE,
            status: "not-found" as const,
            detail: NOT_FOUND_DETAIL,
          })),
        ),
      ],
    });
    render(<AnalyzeView tab="tokens" />);
    await openPreview();

    // 건수는 묶음 수가 아니라 변경 수다.
    expect(screen.getByText("적용 가능 0건 / 전체 3건")).toBeTruthy();
    const items = within(screen.getByRole("list", { name: "변경별 상태" })).getAllByRole(
      "listitem",
    );
    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item?.getAttribute("data-status")).toBe("not-found");
    expect(item?.querySelector("code")?.textContent).toBe("/");
    expect(item?.textContent).toContain("에서 '$schema' 키를 지웠습니다. 검증 의미는 같습니다.");
    expect(within(item as HTMLElement).getByText("3건 · a 외 2개").tagName).toBe("SPAN");
    expect(item?.textContent).toContain(NOT_FOUND_DETAIL);
    const details = item?.querySelector("details");
    expect(details?.querySelector("summary")?.textContent).toBe("도구 3개 보기");
    expect(within(details as HTMLElement).getByText("a, b, c")).toBeTruthy();
  });

  it("전부 not-found 면 프록시 안내를 보이고 적용 버튼이 없다", async () => {
    stubFetch({
      sourceEdits: [
        noReadyPreview([
          { tool: "a", change: SCHEMA_CHANGE, status: "not-found", detail: NOT_FOUND_DETAIL },
          { tool: "b", change: CLEANED_CHANGE, status: "not-found", detail: NOT_FOUND_DETAIL },
        ]),
      ],
    });
    render(<AnalyzeView tab="tokens" />);
    await openPreview();

    expect(screen.getByText(PROXY_GUIDE).tagName).toBe("P");
    expect(screen.queryByText(REASON_GUIDE)).toBeNull();
    expect(screen.queryByRole("button", { name: "적용" })).toBeNull();
    expect(screen.getByRole("button", { name: "닫기" })).toBeTruthy();
  });

  it("not-found 가 아닌 사유가 섞이면 사유 확인 안내를 보인다", async () => {
    stubFetch({
      sourceEdits: [
        noReadyPreview([
          { tool: "a", change: SCHEMA_CHANGE, status: "not-found", detail: NOT_FOUND_DETAIL },
          {
            tool: "b",
            change: CLEANED_CHANGE,
            status: "ambiguous",
            detail: "같은 문자열을 서로 다르게 바꾸는 변경이 있어 건드리지 않습니다.",
          },
        ]),
      ],
    });
    render(<AnalyzeView tab="tokens" />);
    await openPreview();

    expect(screen.getByText(REASON_GUIDE).tagName).toBe("P");
    expect(screen.queryByText(PROXY_GUIDE)).toBeNull();
    expect(screen.queryByRole("button", { name: "적용" })).toBeNull();
    expect(screen.getByRole("button", { name: "닫기" })).toBeTruthy();
  });

  it("취소를 누르면 미리보기가 닫힌다", async () => {
    stubFetch({ analyze: { status: 200, body: cleanedResponse() } });
    render(<AnalyzeView tab="tokens" />);
    await openPreview();

    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(screen.queryByRole("list", { name: "변경별 상태" })).toBeNull();
    expect(screen.queryByLabelText("파일 변경 미리보기")).toBeNull();
    expect(screen.queryByRole("button", { name: "적용" })).toBeNull();
    expect(screen.getByRole("button", { name: "MCP 수정하기" })).toHaveProperty("disabled", false);
  });

  it("요청이 실패하면 error 문장을 그대로 보인다", async () => {
    const error =
      "실행 명령에서 프로젝트 안의 서버 소스 파일을 찾지 못했습니다.\n해결: 인자에 스크립트 경로가 있어야 합니다(예: node ./server.mjs).";
    stubFetch({ sourceEdits: [{ status: 400, body: { error } }] });
    render(<AnalyzeView tab="tokens" />);
    await analyze();

    fireEvent.click(await screen.findByRole("button", { name: "MCP 수정하기" }));

    const alert = await screen.findByRole("alert");
    expect(alert.tagName).toBe("P");
    expect(alert.textContent).toBe(error);
    expect(alert.className).toContain("whitespace-pre-line");
    expect(screen.queryByRole("list", { name: "변경별 상태" })).toBeNull();
    // 다시 시도할 수 있다.
    expect(screen.getByRole("button", { name: "MCP 수정하기" })).toHaveProperty("disabled", false);
  });

  it("적용 요청이 실패하면 error 문장을 보이고 미리보기는 남는다", async () => {
    stubFetch({
      analyze: { status: 200, body: cleanedResponse() },
      sourceEdits: [
        { status: 200, body: previewResponse() },
        { status: 400, body: { error: "적용할 수 있는 변경이 없습니다." } },
      ],
    });
    render(<AnalyzeView tab="tokens" />);
    await openPreview();

    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("적용할 수 있는 변경이 없습니다.");
    expect(screen.getByRole("list", { name: "변경별 상태" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("변경이 없는 결과에서는 반영할 변경이 없습니다 를 보인다", async () => {
    const base = analyzeResponse();
    const fetchMock = stubFetch({
      analyze: {
        status: 200,
        body: {
          ...base,
          overlay: {
            ...base.overlay,
            tools: base.overlay.tools.map((tool) => ({ ...tool, changes: [] })),
          },
        },
      },
    });
    render(<AnalyzeView tab="tokens" />);
    await analyze();

    expect(await screen.findByText("반영할 변경이 없습니다.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "MCP 수정하기" })).toBeNull();
    expect(postedBodies(fetchMock, "/api/analyze/source-edits")).toEqual([]);
  });
});
