// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerCandidate, ServerMeta } from "../../src/api-types.js";
import { GenerateWizard } from "../src/screens/GenerateWizard.js";

const META: ServerMeta = { root: "/repo" };

const WEATHER: ServerCandidate = {
  id: "mcp-config:.mcp.json:weather",
  name: "weather",
  command: "node",
  args: ["examples/weather-server/server.mjs"],
  source: "mcp-config",
  path: ".mcp.json",
  hasEnv: false,
};

const ECHO: ServerCandidate = {
  id: "package-bin:examples/echo-server/package.json:echo",
  name: "echo",
  command: "node",
  args: ["examples/echo-server/server.mjs"],
  source: "package-bin",
  path: "examples/echo-server/package.json",
  hasEnv: false,
};

/**
 * `/api/servers` 와 `/api/meta` 갈래가 **반드시** 있어야 한다. 없으면 마지막 catch-all 이
 * 실행 응답을 주고 후보 목록이 배열이 아닌 값으로 채워진다.
 */
function stubFetch(servers: readonly ServerCandidate[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      return new Response(JSON.stringify({ runId: "run-new" }), { status: 200 });
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

/** 마운트 시의 두 GET 이 상태에 반영될 때까지 기다린다. */
async function renderWizard(
  servers: readonly ServerCandidate[] = [],
): Promise<ReturnType<typeof vi.fn>> {
  const fetchMock = stubFetch(servers);
  render(<GenerateWizard />);
  if (servers.length === 0) {
    // 후보 0 안내에 탐색 루트가 찍히면 `/api/meta` 까지 반영된 것이다.
    await screen.findByText("/repo");
  } else {
    await screen.findByText(`프로젝트에서 ${servers.length}개 찾음`);
  }
  return fetchMock;
}

/** 1단계(서버)를 직접 입력으로 채우고 다음으로 넘어간다. */
function fillStepServer(target: string): void {
  fireEvent.change(screen.getByLabelText("서버 스크립트"), { target: { value: target } });
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
}

/** 2단계(스위트)를 채우고 다음으로 넘어간다. */
function fillStepSuite(): void {
  fireEvent.change(screen.getByLabelText("스위트 ID"), { target: { value: "weather" } });
  fireEvent.change(screen.getByLabelText("스위트 이름"), { target: { value: "날씨 서버" } });
  fireEvent.change(screen.getByLabelText("저장 위치"), {
    target: { value: "examples/weather/suite.json" },
  });
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
}

function clickNext(): void {
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
}

/** POST 된 argv. 첫 POST 호출 하나만 본다. */
function postedArgv(fetchMock: ReturnType<typeof vi.fn>): readonly string[] {
  const call = fetchMock.mock.calls.find(
    (entry) => (entry[1] as RequestInit | undefined)?.method === "POST",
  ) as [string, RequestInit];
  return JSON.parse(String(call[1].body)).argv;
}

describe("GenerateWizard", () => {
  beforeEach(() => {
    window.location.hash = "";
    // Node 25는 메서드 없는 localStorage 껍데기를 전역에 둔다(#212). 지울 것도 없다.
    window.localStorage?.clear?.();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("필수 미입력이면 다음 버튼이 비활성이다", async () => {
    await renderWizard();
    const next = screen.getByRole("button", { name: "다음" });
    expect(next).toHaveProperty("disabled", true);
    expect(screen.getByText("서버를 고르거나 실행 명령을 입력하세요.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("서버 스크립트"), {
      target: { value: "server.js" },
    });
    expect(next).toHaveProperty("disabled", false);
  });

  it("시험 실행 토글을 끄면 4단계의 초기화 입력이 비활성이다", async () => {
    await renderWizard();
    fillStepServer("server.js");
    fillStepSuite();
    clickNext();
    fireEvent.click(screen.getByLabelText("저장 전에 시험 실행으로 검증"));

    expect(screen.getByLabelText("시험 실행 전 초기화 명령 (선택)")).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("4단계에 제거된 Tool 카세트 입력이 없다", async () => {
    await renderWizard();
    fillStepServer("server.js");
    fillStepSuite();
    clickNext();

    expect(screen.queryByLabelText("카세트 저장 위치 (선택)")).toBeNull();
    expect(screen.queryByLabelText("재녹화 (--record)")).toBeNull();
  });

  it("시험 실행을 끄면 이미 입력한 초기화 값이 비워진다", async () => {
    await renderWizard();
    fillStepServer("server.js");
    fillStepSuite();
    clickNext();
    // 4단계에서 초기화 명령을 입력해 두고,
    fireEvent.change(screen.getByLabelText("시험 실행 전 초기화 명령 (선택)"), {
      target: { value: "node scripts/reset.js" },
    });
    // 같은 화면의 시험 실행 토글을 끄면,
    fireEvent.click(screen.getByLabelText("저장 전에 시험 실행으로 검증"));
    // 잠긴 입력에 값이 남아 buildGenerateArgv가 throw하는 함정이 없어야 한다(PR #199).
    expect(screen.getByLabelText("시험 실행 전 초기화 명령 (선택)")).toHaveProperty("value", "");
  });

  it('4단계 완주 후 생성 시작이 조립된 argv로 flow:"generate"를 POST한다', async () => {
    const fetchMock = await renderWizard();
    fillStepServer("server.js");
    fillStepSuite();
    clickNext();
    fireEvent.click(screen.getByRole("button", { name: "생성 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    const call = fetchMock.mock.calls.find(
      (entry) => (entry[1] as RequestInit | undefined)?.method === "POST",
    ) as [string, RequestInit];
    expect(call[0]).toBe("/api/runs");
    // --command는 실행 파일 하나만, 스크립트 경로는 --arg 선두다(CLI 계약).
    expect(JSON.parse(String(call[1].body))).toEqual({
      flow: "generate",
      argv: [
        "--command",
        "node",
        "--arg",
        "server.js",
        "--suite-id",
        "weather",
        "--name",
        "날씨 서버",
        "--out",
        "examples/weather/suite.json",
        "--provider",
        "claude",
      ],
    });
  });

  it("스크립트 경로가 args 선두로 가고 사용자 인자가 그 뒤를 잇는다", async () => {
    const fetchMock = await renderWizard();
    fireEvent.change(screen.getByLabelText("서버 스크립트"), { target: { value: "server.js" } });
    fireEvent.change(screen.getByLabelText("서버 인자"), { target: { value: "--port" } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    clickNext();
    fillStepSuite();
    clickNext();
    fireEvent.click(screen.getByRole("button", { name: "생성 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    expect(postedArgv(fetchMock).slice(0, 6)).toEqual([
      "--command",
      "node",
      "--arg",
      "server.js",
      "--arg",
      "--port",
    ]);
  });

  it("마지막 단계에 조립된 CLI 명령 전문이 보인다", async () => {
    await renderWizard();
    fillStepServer("server.js");
    fillStepSuite();
    clickNext();

    const command = screen.getByText(
      "mcpeak generate --command node --arg server.js --suite-id weather " +
        '--name "날씨 서버" --out examples/weather/suite.json --provider claude',
    );
    expect(command.className).toContain("font-mono");
  });

  it("후보가 있으면 첫 후보가 선택돼 있고 다음 버튼이 활성이다", async () => {
    await renderWizard([WEATHER, ECHO]);

    expect(screen.getByRole("radio", { name: /weather/ })).toHaveProperty("checked", true);
    expect(screen.getByRole("button", { name: "다음" })).toHaveProperty("disabled", false);
    // 후보 갈래는 인자를 편집하지 않으므로 직접 입력 폼이 펼쳐지지 않는다(ADR-0081).
    expect(screen.queryByLabelText("서버 스크립트")).toBeNull();
  });

  it("후보를 고르고 완주하면 후보의 command·args 가 --command/--arg 로 POST 된다", async () => {
    const fetchMock = await renderWizard([WEATHER]);
    clickNext();
    clickNext();
    clickNext();
    fireEvent.click(screen.getByRole("button", { name: "생성 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    expect(postedArgv(fetchMock).slice(0, 10)).toEqual([
      "--command",
      "node",
      "--arg",
      "examples/weather-server/server.mjs",
      "--suite-id",
      "server",
      "--name",
      "server",
      "--out",
      "examples/weather-server/server.suite.json",
    ]);
  });

  it("후보 선택 시 2단계 저장 위치·스위트 ID·이름이 제안돼 있고 힌트가 붙는다", async () => {
    await renderWizard([WEATHER]);
    clickNext();

    expect(screen.getByLabelText("저장 위치")).toHaveProperty(
      "value",
      "examples/weather-server/server.suite.json",
    );
    expect(screen.getByLabelText("스위트 ID")).toHaveProperty("value", "server");
    expect(screen.getByLabelText("스위트 이름")).toHaveProperty("value", "server");
    expect(
      screen.getByText("서버 스크립트 옆에 제안한 값입니다. 바꿔도 됩니다(.json 파일)."),
    ).toBeTruthy();
    expect(screen.getAllByText("저장 위치의 파일명에서 뽑았습니다.").length).toBe(2);
  });

  it("사용자가 고친 스위트 ID 는 서버를 바꿔도 유지된다", async () => {
    await renderWizard([WEATHER, ECHO]);
    clickNext();
    fireEvent.change(screen.getByLabelText("스위트 ID"), { target: { value: "mine" } });

    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    fireEvent.click(screen.getByRole("radio", { name: /echo/ }));
    clickNext();

    expect(screen.getByLabelText("저장 위치")).toHaveProperty(
      "value",
      "examples/echo-server/server.suite.json",
    );
    expect(screen.getByLabelText("스위트 ID")).toHaveProperty("value", "mine");
  });

  it("저장 위치를 고치면 제안값이던 스위트 ID·이름이 새 파일명으로 따라온다", async () => {
    await renderWizard([WEATHER]);
    clickNext();
    fireEvent.change(screen.getByLabelText("저장 위치"), {
      target: { value: "suites/api.suite.json" },
    });

    expect(screen.getByLabelText("스위트 ID")).toHaveProperty("value", "api");
    expect(screen.getByLabelText("스위트 이름")).toHaveProperty("value", "api");
  });

  it("직접 입력을 고르면 StepServer 가 펼쳐지고 스크립트 경로 기준 제안이 그대로다", async () => {
    await renderWizard([WEATHER]);
    fireEvent.click(screen.getByRole("radio", { name: /직접 입력/ }));

    fireEvent.change(screen.getByLabelText("서버 스크립트"), {
      target: { value: "examples/echo-server/server.mjs" },
    });
    clickNext();

    expect(screen.getByLabelText("저장 위치")).toHaveProperty(
      "value",
      "examples/echo-server/server.suite.json",
    );
  });

  it("후보 0 이면 안내 상자와 직접 입력이 펼쳐진 채 시작한다", async () => {
    await renderWizard();

    expect(screen.getByText(/.mcp.json 이나 package.json 의 bin 을 찾지 못했습니다./)).toBeTruthy();
    expect(screen.getByText("/repo")).toBeTruthy();
    expect(screen.getByLabelText("서버 스크립트")).toBeTruthy();
  });

  it("HTTP 를 고르면 후보 목록이 비활성이고 URL 없이는 다음이 막힌다", async () => {
    await renderWizard([WEATHER]);
    fireEvent.click(screen.getByRole("button", { name: "HTTP URL" }));

    expect(screen.getByRole("radio", { name: /weather/ })).toHaveProperty("disabled", true);
    expect(screen.getByText("원격 서버에 붙습니다. 위 서버 명령은 쓰이지 않습니다.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "다음" })).toHaveProperty("disabled", true);
    expect(screen.getByText("URL 을 입력하세요.")).toBeTruthy();
  });

  it("HTTP 로 완주하면 --url 과 --header-env 가 POST 되고 --command 가 없다", async () => {
    const fetchMock = await renderWizard([WEATHER]);
    fireEvent.click(screen.getByRole("button", { name: "HTTP URL" }));
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "http://localhost:3000/mcp" },
    });
    fireEvent.change(screen.getByLabelText("헤더 환경변수"), {
      target: { value: "Authorization=MCP_TOKEN" },
    });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    clickNext();
    fillStepSuite();
    clickNext();
    fireEvent.click(screen.getByRole("button", { name: "생성 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    const argv = postedArgv(fetchMock);
    expect(argv.slice(0, 4)).toEqual([
      "--url",
      "http://localhost:3000/mcp",
      "--header-env",
      "Authorization=MCP_TOKEN",
    ]);
    expect(argv).not.toContain("--command");
  });

  it("3단계에 시험 실행·자동 교정 토글이 없고 4단계에 있다", async () => {
    await renderWizard();
    fillStepServer("server.js");
    fillStepSuite();

    expect(screen.queryByLabelText("저장 전에 시험 실행으로 검증")).toBeNull();
    expect(screen.queryByLabelText("실패한 입력값 자동 교정")).toBeNull();

    clickNext();
    expect(screen.getByLabelText("저장 전에 시험 실행으로 검증")).toBeTruthy();
    expect(screen.getByLabelText("실패한 입력값 자동 교정")).toBeTruthy();
  });

  it("4단계에서 시험 실행을 끄면 초기화 입력이 비활성이고 값이 비워진다", async () => {
    await renderWizard();
    fillStepServer("server.js");
    fillStepSuite();
    clickNext();
    fireEvent.change(screen.getByLabelText("시험 실행 전 초기화 명령 (선택)"), {
      target: { value: "node scripts/reset.js" },
    });
    fireEvent.click(screen.getByLabelText("저장 전에 시험 실행으로 검증"));

    const resetCmd = screen.getByLabelText("시험 실행 전 초기화 명령 (선택)");
    expect(resetCmd).toHaveProperty("disabled", true);
    expect(resetCmd).toHaveProperty("value", "");
    // 나중에 끄려는 쪽이 비활성이고 사유가 힌트로 붙는다(설계 §5-4).
    expect(screen.getByLabelText("실패한 입력값 자동 교정")).toHaveProperty("disabled", true);
    expect(screen.getByText("시험 실행이 꺼져 있어 자동 교정을 끌 수 없습니다.")).toBeTruthy();
  });

  it("4단계 요약의 실행 명령 행이 HTTP 면 원격 URL 을 보여준다", async () => {
    await renderWizard([WEATHER]);
    fireEvent.click(screen.getByRole("button", { name: "HTTP URL" }));
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "http://localhost:3000/mcp" },
    });
    fireEvent.change(screen.getByLabelText("헤더 환경변수"), {
      target: { value: "Authorization=MCP_TOKEN" },
    });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    clickNext();
    fillStepSuite();
    clickNext();

    expect(screen.getByText("원격 http://localhost:3000/mcp (헤더 1개)")).toBeTruthy();
  });

  it("직접 입력 갈래에서만 최근 명령이 저장된다", async () => {
    const RECENT_KEY = "mcpeak-generate-recent-commands";
    const candidateFetch = await renderWizard([WEATHER]);
    clickNext();
    clickNext();
    clickNext();
    fireEvent.click(screen.getByRole("button", { name: "생성 시작" }));
    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    // 후보의 명령은 프로젝트 선언에서 온 것이라 "최근 사용값"이 아니다.
    expect(window.localStorage.getItem(RECENT_KEY)).toBeNull();
    expect(candidateFetch).toHaveBeenCalled();

    cleanup();
    vi.unstubAllGlobals();
    window.location.hash = "";
    await renderWizard();
    fillStepServer("examples/echo-server/server.mjs");
    fillStepSuite();
    clickNext();
    fireEvent.click(screen.getByRole("button", { name: "생성 시작" }));
    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    expect(JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]")).toEqual([
      "examples/echo-server/server.mjs",
    ]);
  });
});
