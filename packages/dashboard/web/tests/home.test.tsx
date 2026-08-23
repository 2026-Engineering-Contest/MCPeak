// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry, RunSummary } from "../../src/api-types.js";
import { Home } from "../src/screens/Home.js";

const SUITES: readonly FileEntry[] = [{ path: "examples/weather/suite.json" }];
const RUNS: readonly RunSummary[] = [
  { runId: "run-7", flow: "generate", status: "done", exitCode: 0 },
];

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      return new Response(JSON.stringify({ runId: "run-new" }), { status: 200 });
    }
    if (url === "/api/suites") {
      return new Response(JSON.stringify(SUITES), { status: 200 });
    }
    if (url === "/api/runs") {
      return new Response(JSON.stringify(RUNS), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Home", () => {
  beforeEach(() => {
    window.location.hash = "";
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("suites 목록이 경로 mono로 렌더된다", async () => {
    stubFetch();
    render(<Home />);
    const path = await screen.findByText("examples/weather/suite.json");
    expect(path.className).toContain("font-mono");
  });

  it('실행 제출이 flow:"test"와 --command/--arg 분해 argv를 POST한다', async () => {
    const fetchMock = stubFetch();
    render(<Home />);
    fireEvent.click(await screen.findByRole("button", { name: "실행" }));
    // 빈 입력이면 시작 버튼이 비활성이다.
    expect(screen.getByRole("button", { name: "실행 시작" })).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("서버 스크립트"), { target: { value: "server.js" } });
    fireEvent.click(screen.getByRole("button", { name: "실행 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(post?.[0]).toBe("/api/runs");
    // --command는 실행 파일 하나만, 나머지 토큰은 각각 --arg다(CLI parseTestCommand 계약).
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      flow: "test",
      argv: ["examples/weather/suite.json", "--command", "node", "--arg", "server.js"],
    });
  });

  it("공백이 든 경로가 인자 하나로 그대로 간다", async () => {
    const fetchMock = stubFetch();
    render(<Home />);
    fireEvent.click(await screen.findByRole("button", { name: "실행" }));
    // 이슈 #223 의 재현 입력. 한 칸에 받아 공백으로 쪼개던 시절에는
    // --command node --arg "my --arg server.js" 로 깨졌다.
    fireEvent.change(screen.getByLabelText("서버 스크립트"), {
      target: { value: "my server.js" },
    });
    fireEvent.click(screen.getByRole("button", { name: "실행 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      flow: "test",
      argv: ["examples/weather/suite.json", "--command", "node", "--arg", "my server.js"],
    });
  });

  it("서버 인자를 칩으로 더하면 스크립트 뒤에 순서대로 붙는다", async () => {
    const fetchMock = stubFetch();
    render(<Home />);
    fireEvent.click(await screen.findByRole("button", { name: "실행" }));
    fireEvent.change(screen.getByLabelText("서버 스크립트"), { target: { value: "server.js" } });

    for (const value of ["--port", "3000"]) {
      fireEvent.change(screen.getByLabelText("서버 인자"), { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: "추가" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "실행 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      flow: "test",
      argv: [
        "examples/weather/suite.json",
        "--command",
        "node",
        "--arg",
        "server.js",
        "--arg",
        "--port",
        "--arg",
        "3000",
      ],
    });
  });

  /**
   * ADR-0066 후속. argv 조립 자체는 `build-test-argv.test.ts` 가 전량 단언하므로, 여기서는
   * **화면에서 그 폼에 닿을 수 있는가** 만 본다 — 지금까지는 API 를 직접 부르지 않으면 녹화를
   * 켤 방법이 없었다.
   */
  const openFormWithServer = async (): Promise<void> => {
    fireEvent.click(await screen.findByRole("button", { name: "실행" }));
    fireEvent.change(screen.getByLabelText("서버 스크립트"), { target: { value: "server.js" } });
  };

  it("기본은 세션을 쓰지 않는다 — 경로 칸도 없다", async () => {
    stubFetch();
    render(<Home />);
    await openFormWithServer();

    expect(screen.getByRole("button", { name: "사용 안 함" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.queryByLabelText("세션 파일 경로")).toBeNull();
  });

  it("녹화를 고르고 경로를 적으면 argv 에 --record-session 이 실린다", async () => {
    const fetchMock = stubFetch();
    render(<Home />);
    await openFormWithServer();
    fireEvent.click(screen.getByRole("button", { name: "외부 호출 녹화" }));
    fireEvent.change(screen.getByLabelText("세션 파일 경로"), { target: { value: "tmp/s.db" } });
    fireEvent.click(screen.getByRole("button", { name: "실행 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body)).argv).toEqual([
      "examples/weather/suite.json",
      "--command",
      "node",
      "--arg",
      "server.js",
      "--record-session",
      "tmp/s.db",
    ]);
  });

  it("재생을 고르면 --session 으로 간다 — 두 옵션이 함께 실리지 않는다", async () => {
    const fetchMock = stubFetch();
    render(<Home />);
    await openFormWithServer();
    // 녹화를 먼저 골랐다가 재생으로 바꾼다. 세그먼트라 앞 선택이 남으면 안 된다.
    fireEvent.click(screen.getByRole("button", { name: "외부 호출 녹화" }));
    fireEvent.click(screen.getByRole("button", { name: "녹화본 재생" }));
    fireEvent.change(screen.getByLabelText("세션 파일 경로"), { target: { value: "tmp/s.db" } });
    fireEvent.click(screen.getByRole("button", { name: "실행 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    const argv: readonly string[] = JSON.parse(
      String(fetchMock.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body),
    ).argv;
    expect(argv).toContain("--session");
    expect(argv).not.toContain("--record-session");
  });

  it("세션을 켰는데 경로가 비면 실행 버튼이 비활성이다", async () => {
    stubFetch();
    render(<Home />);
    await openFormWithServer();
    // 명령은 다 찼으므로, 비활성의 사유는 세션 경로뿐이다.
    expect(screen.getByRole("button", { name: "실행 시작" })).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("button", { name: "외부 호출 녹화" }));

    expect(screen.getByRole("button", { name: "실행 시작" })).toHaveProperty("disabled", true);
  });

  it("최근 실행 행이 flow 칩과 상태 뱃지를 함께 그린다", async () => {
    stubFetch();
    render(<Home />);
    const row = (await screen.findByText("run-7")).closest("a");
    expect(row).not.toBeNull();
    expect(row?.getAttribute("href")).toBe("#/runs/run-7");
    expect(row?.textContent).toContain("generate");
    expect(row?.textContent).toContain("완료 · exit 0");
  });
});
