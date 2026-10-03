// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnalyzeTokensResponse,
  PutFileResponse,
  ServerCandidate,
  ServerMeta,
} from "../../src/api-types.js";
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

const OVERLAY_TEXT = '{\n  "schemaVersion": 1\n}\n';

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
          inputSchema: {},
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
  };
}

/** home.test 의 stubFetch 와 같은 방식. POST·PUT 응답만 이 화면의 것으로 바꿔 둔다. */
function stubFetch(
  options: {
    readonly servers?: readonly ServerCandidate[];
    readonly analyze?: { readonly status: number; readonly body: unknown };
    readonly put?: PutFileResponse;
  } = {},
): ReturnType<typeof vi.fn> {
  const servers = options.servers ?? [WEATHER];
  const analyze = options.analyze ?? { status: 200, body: analyzeResponse() };
  const put: PutFileResponse = options.put ?? { saved: true, mtimeMs: 1 };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST" && url === "/api/analyze/tokens") {
      return new Response(JSON.stringify(analyze.body), { status: analyze.status });
    }
    if (init?.method === "PUT" && url.startsWith("/api/overlays/")) {
      return new Response(JSON.stringify(put), { status: 200 });
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

function sentBody(fetchMock: ReturnType<typeof vi.fn>, method: string): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === method);
  return JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>;
}

/** 첫 후보가 선택될 때까지 기다린 뒤 분석을 시작하고 결과 요약이 뜰 때까지 기다린다. */
async function analyze(): Promise<void> {
  await screen.findByRole("radio", { name: /^weather/ });
  fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));
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

  it("보안 탭은 준비 중 안내와 토큰 탭 링크를 보인다", () => {
    stubFetch();
    render(<AnalyzeView tab="security" />);

    expect(screen.getByText("보안 탭은 준비 중입니다.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /토큰 탭으로/ }).getAttribute("href")).toBe(
      "#/analyze/tokens",
    );
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
      ["a", "600", "400", "33.3%", "1"],
      ["b", "400", "360", "10.0%", "0"],
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

  it("오버레이 저장은 overlayText 를 baseMtimeMs 0 으로 PUT 하고 결과 문장을 보인다", async () => {
    const fetchMock = stubFetch({ put: { saved: true, mtimeMs: 1 } });
    render(<AnalyzeView tab="tokens" />);
    await analyze();

    expect(await screen.findByLabelText("저장 경로 (프로젝트 루트 기준)")).toHaveProperty(
      "value",
      "server.optimize.json",
    );
    fireEvent.click(screen.getByRole("button", { name: "오버레이 저장" }));

    const status = await screen.findByRole("status");
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(put?.[0]).toBe("/api/overlays/server.optimize.json");
    expect(sentBody(fetchMock, "PUT")).toEqual({ content: OVERLAY_TEXT, baseMtimeMs: 0 });
    expect(status.textContent).toContain("저장했습니다: server.optimize.json");
    expect(status.textContent).toContain("mcpeak-optimize-proxy server.optimize.json");
  });

  it("이미 있는 파일이면 다른 경로를 권한다", async () => {
    stubFetch({ put: { saved: false, reason: "conflict", mtimeMs: 5 } });
    render(<AnalyzeView tab="tokens" />);
    await analyze();

    fireEvent.click(await screen.findByRole("button", { name: "오버레이 저장" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("이미 있는 파일입니다: server.optimize.json");
  });
});
