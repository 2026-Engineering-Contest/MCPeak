// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry, RunSummary, ServerCandidate, ServerMeta } from "../../src/api-types.js";
import { DEFAULT_TEST_OPTIONS } from "../src/build-test-argv.js";
import { Home } from "../src/screens/Home.js";

const SUITES: readonly FileEntry[] = [{ path: "examples/weather/suite.json" }];
const META: ServerMeta = { root: "/tmp/proj" };
const RUNS: readonly RunSummary[] = [
  { runId: "run-7", flow: "generate", status: "done", exitCode: 0 },
];
const WEATHER: ServerCandidate = {
  id: "mcp-config:.mcp.json:weather",
  name: "weather",
  command: "node",
  args: ["examples/weather-server/server.mjs", "--port", "3000"],
  source: "mcp-config",
  path: ".mcp.json",
  hasEnv: false,
};
const CANDIDATES: readonly ServerCandidate[] = [
  WEATHER,
  {
    id: "package-bin:examples/weather-server/package.json:weather-server",
    name: "examples/weather-server",
    command: "node",
    args: ["examples/weather-server/server.mjs"],
    source: "package-bin",
    path: "examples/weather-server/package.json",
    hasEnv: true,
  },
];

/**
 * `/api/meta` 갈래가 **반드시** 있어야 한다. 없으면 마지막 catch-all 이 `[]` 를 주고
 * `meta.root` 가 undefined 가 되어, 빈 목록 안내가 조용히 경로 없는 갈래로 샌다(#296).
 * `meta` 인자로 그 실패를 일부러 만들 수 있다.
 */
function stubFetch(
  options: {
    readonly suites?: readonly FileEntry[];
    readonly meta?: ServerMeta | null;
    readonly servers?: readonly ServerCandidate[];
  } = {},
): ReturnType<typeof vi.fn> {
  const suites = options.suites ?? SUITES;
  const meta = options.meta === undefined ? META : options.meta;
  const servers = options.servers ?? [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      return new Response(JSON.stringify({ runId: "run-new" }), { status: 200 });
    }
    if (url === "/api/suites") {
      return new Response(JSON.stringify(suites), { status: 200 });
    }
    if (url === "/api/runs") {
      return new Response(JSON.stringify(RUNS), { status: 200 });
    }
    if (url === "/api/servers") {
      return new Response(JSON.stringify(servers), { status: 200 });
    }
    if (url === "/api/meta") {
      return meta === null
        ? new Response(JSON.stringify({ error: "메타를 읽지 못했습니다." }), { status: 500 })
        : new Response(JSON.stringify(meta), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Home", () => {
  beforeEach(() => {
    window.location.hash = "";
    // 지난 실행값은 이 화면의 초기 선택을 바꾼다. 앞 케이스가 남긴 값이 다음 케이스의
    // 시작 상태가 되면 케이스 순서에 따라 결과가 달라진다(결정론).
    window.localStorage.clear();
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

  /**
   * 이 이슈의 본체다(#296). 고치기 전에는 "스위트가 없습니다." 한 줄이라, 도구가 어느
   * 디렉터리를 뒤졌는지 사용자가 알 방법이 없었다.
   */
  it("스위트가 0건이면 어느 디렉터리를 뒤졌는지 말한다", async () => {
    stubFetch({ suites: [] });
    render(<Home />);
    await waitFor(() => {
      expect(screen.getByText(/스위트를 찾지 못했습니다/)).toBeTruthy();
    });
    expect(screen.getByText("/tmp/proj")).toBeTruthy();
  });

  it("스위트가 0건이면 고치는 방법 두 갈래를 함께 말한다", async () => {
    stubFetch({ suites: [] });
    render(<Home />);
    await waitFor(() => {
      expect(screen.getByText(/다시 띄우거나/)).toBeTruthy();
    });
    // cwd 말고 두 번째 원인 — 형식 불통과·제외 디렉터리
    expect(screen.getByText(/node_modules/)).toBeTruthy();
  });

  /** 루트를 못 받아도 목록 화면 자체는 살아야 한다. 경로만 빠지고 나머지 안내는 나간다. */
  it("메타를 못 받으면 경로 없이 나머지 안내만 낸다", async () => {
    stubFetch({ suites: [], meta: null });
    render(<Home />);
    await waitFor(() => {
      expect(screen.getByText(/스위트를 찾지 못했습니다/)).toBeTruthy();
    });
    expect(screen.queryByText("/tmp/proj")).toBeNull();
    expect(screen.getByText(/다시 띄우거나/)).toBeTruthy();
  });

  it("스위트가 있으면 빈 목록 안내는 안 나온다", async () => {
    stubFetch();
    render(<Home />);
    await waitFor(() => {
      expect(screen.getByText("examples/weather/suite.json")).toBeTruthy();
    });
    expect(screen.queryByText(/스위트를 찾지 못했습니다/)).toBeNull();
  });
  /** POST 한 argv. 여러 케이스가 같은 자리를 본다. */
  const postedArgv = (fetchMock: ReturnType<typeof vi.fn>): readonly string[] =>
    JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body))
      .argv;

  const preview = (): string => screen.getByText(/^mcpeak test /).textContent ?? "";

  it("실행을 누르면 버튼이 닫기로 바뀌고 다시 누르면 폼이 닫힌다", async () => {
    stubFetch({ servers: CANDIDATES });
    render(<Home />);
    const open = await screen.findByRole("button", { name: "실행" });
    expect(open.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(open);

    const close = screen.getByRole("button", { name: "닫기" });
    expect(close.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(close);

    expect(screen.getByRole("button", { name: "실행" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "실행 시작" })).toBeNull();
  });

  it("첫 후보가 자동 선택되고 미리보기가 mcpeak test 로 시작하는 전문이다", async () => {
    stubFetch({ servers: CANDIDATES });
    render(<Home />);
    fireEvent.click(await screen.findByRole("button", { name: "실행" }));

    expect(screen.getByRole("radio", { name: /^weather/ })).toHaveProperty("checked", true);
    expect(preview()).toBe(
      "mcpeak test examples/weather/suite.json --command node --arg examples/weather-server/server.mjs --arg --port --arg 3000",
    );
  });

  it("후보를 고르면 인자 칩이 채워지고 칩을 지우면 argv 에서 빠진다", async () => {
    stubFetch({ servers: CANDIDATES });
    render(<Home />);
    fireEvent.click(await screen.findByRole("button", { name: "실행" }));
    fireEvent.click(screen.getByRole("radio", { name: /^examples\/weather-server/ }));

    const chip = screen.getByRole("button", {
      name: "인자 examples/weather-server/server.mjs 제거",
    });
    expect(preview()).toBe(
      "mcpeak test examples/weather/suite.json --command node --arg examples/weather-server/server.mjs",
    );

    fireEvent.click(chip);

    expect(preview()).toBe("mcpeak test examples/weather/suite.json --command node");
  });

  it("직접 입력을 고르면 StepServer 가 펼쳐지고 서버 스크립트 라벨이 보인다", async () => {
    stubFetch({ servers: CANDIDATES });
    render(<Home />);
    fireEvent.click(await screen.findByRole("button", { name: "실행" }));
    expect(screen.queryByLabelText("서버 스크립트")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /직접 입력/ }));

    expect(screen.getByLabelText("서버 스크립트")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Node 스크립트" })).toBeTruthy();
  });

  it("후보가 없으면 안내가 나오고 직접 입력이 펼쳐져 있다", async () => {
    stubFetch({ servers: [] });
    render(<Home />);
    fireEvent.click(await screen.findByRole("button", { name: "실행" }));

    expect(screen.getByText(/bin 을 찾지 못했습니다/)).toBeTruthy();
    expect(screen.getByText(/다음부터 목록에 나타납니다/)).toBeTruthy();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByLabelText("서버 스크립트")).toBeTruthy();
  });

  it("옵션에서 결정론 검사를 켜면 POST argv 에 --determinism 이 들어간다", async () => {
    const fetchMock = stubFetch({ servers: CANDIDATES });
    render(<Home />);
    fireEvent.click(await screen.findByRole("button", { name: "실행" }));
    fireEvent.click(screen.getByRole("button", { name: /테스트 옵션/ }));
    fireEvent.click(screen.getByLabelText("결정론 검사"));
    fireEvent.click(screen.getByRole("button", { name: "실행 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    expect(postedArgv(fetchMock)).toContain("--determinism");
  });

  it("HTTP 를 고르면 POST argv 가 --url 로 시작하고 --command 가 없다", async () => {
    const fetchMock = stubFetch({ servers: CANDIDATES });
    render(<Home />);
    fireEvent.click(await screen.findByRole("button", { name: "실행" }));
    fireEvent.click(screen.getByRole("button", { name: /테스트 옵션/ }));
    fireEvent.click(screen.getByRole("button", { name: "HTTP URL" }));
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://example.test/mcp" },
    });
    fireEvent.click(screen.getByRole("button", { name: "실행 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    const argv = postedArgv(fetchMock);
    expect(argv.slice(0, 3)).toEqual([
      "examples/weather/suite.json",
      "--url",
      "https://example.test/mcp",
    ]);
    expect(argv).not.toContain("--command");
    expect(argv).not.toContain("--arg");
  });

  it("실행 시작 후 지난 실행값이 저장되고 다시 열면 그 값이 선택돼 있다", async () => {
    stubFetch({ servers: [] });
    render(<Home />);
    fireEvent.click(await screen.findByRole("button", { name: "실행" }));
    fireEvent.change(screen.getByLabelText("서버 스크립트"), { target: { value: "server.js" } });
    fireEvent.click(screen.getByRole("button", { name: "실행 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    fireEvent.click(screen.getByRole("button", { name: "실행" }));

    expect(screen.getByRole("radio", { name: /지난 실행/ })).toHaveProperty("checked", true);
    expect(preview()).toBe(
      "mcpeak test examples/weather/suite.json --command node --arg server.js",
    );
  });

  it("지난 실행이 스캔 후보와 같으면 지난 실행 항목이 없고 그 후보가 선택된다", async () => {
    window.localStorage.setItem(
      "mcpeak-home-last-run",
      JSON.stringify({
        "examples/weather/suite.json": {
          command: WEATHER.command,
          args: WEATHER.args,
          options: DEFAULT_TEST_OPTIONS,
        },
      }),
    );
    stubFetch({ servers: CANDIDATES });
    render(<Home />);
    fireEvent.click(await screen.findByRole("button", { name: "실행" }));

    expect(screen.queryByRole("radio", { name: /지난 실행/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /^weather/ })).toHaveProperty("checked", true);
  });

  it("조립 실패 사유가 미리보기 자리에 나오고 시작 버튼이 비활성이다", async () => {
    stubFetch({ servers: CANDIDATES });
    render(<Home />);
    fireEvent.click(await screen.findByRole("button", { name: "실행" }));
    fireEvent.click(screen.getByRole("button", { name: "외부 호출 녹화" }));

    expect(screen.getByText("세션 파일 경로를 입력하세요.")).toBeTruthy();
    expect(screen.queryByText(/^mcpeak test /)).toBeNull();
    expect(screen.getByRole("button", { name: "실행 시작" })).toHaveProperty("disabled", true);
  });
});
