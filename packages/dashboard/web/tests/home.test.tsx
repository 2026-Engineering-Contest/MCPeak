// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry, ServerCandidate, ServerMeta } from "../../src/api-types.js";
import { DEFAULT_TEST_OPTIONS } from "../src/build-test-argv.js";
import { managedRepairBundlePath } from "../src/repair-bundle-path.js";
import { Home } from "../src/screens/Home.js";

const SUITE = "examples/weather-server/server.suite.json";
const SUITE_SHOW = "examples/weather-server/server.suite_show.json";
const OTHER_SUITE = "examples/other/suite.json";
const SUITES: readonly FileEntry[] = [{ path: SUITE }, { path: SUITE_SHOW }, { path: OTHER_SUITE }];
/** 홈의 test 실행은 항상 이 두 토큰으로 끝난다(ADR-0080). 미리보기에도 같은 문자열이 붙는다. */
const BUNDLE_ARGV = ["--repair-bundle", managedRepairBundlePath(SUITE)];
const BUNDLE_PREVIEW = ` --repair-bundle ${managedRepairBundlePath(SUITE)}`;
const META: ServerMeta = { root: "/tmp/proj" };
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
    /** `/api/suites/<path>` 가 돌려줄 파일 내용. 없는 경로는 404. */
    readonly suiteContents?: Readonly<Record<string, string>>;
  } = {},
): ReturnType<typeof vi.fn> {
  const suites = options.suites ?? SUITES;
  const meta = options.meta === undefined ? META : options.meta;
  const servers = options.servers ?? CANDIDATES;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      return new Response(JSON.stringify({ runId: "run-new" }), { status: 200 });
    }
    if (url === "/api/suites") {
      return new Response(JSON.stringify(suites), { status: 200 });
    }
    if (url.startsWith("/api/suites/")) {
      const path = decodeURIComponent(url.slice("/api/suites/".length));
      const content = options.suiteContents?.[path];
      return content === undefined
        ? new Response(JSON.stringify({ error: "파일을 찾을 수 없습니다." }), { status: 404 })
        : new Response(JSON.stringify({ path, content, mtimeMs: 1 }), { status: 200 });
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

/** POST 한 argv. 여러 케이스가 같은 자리를 본다. */
const postedArgv = (fetchMock: ReturnType<typeof vi.fn>): readonly string[] =>
  JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body))
    .argv;

const preview = (): string => screen.getByText(/^mcpeak test /).textContent ?? "";

const next = (): void => {
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
};

/** 1단계(첫 후보 선택됨) → 2단계 → 스위트 선택 → 3단계. 대부분의 케이스가 여기서 시작한다. */
async function goToOptions(suitePath: string = SUITE): Promise<void> {
  await screen.findByRole("radio", { name: /^weather/ });
  next();
  fireEvent.click(await screen.findByRole("radio", { name: suitePath }));
  next();
}

describe("Home 실행 마법사", () => {
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

  it("1단계에서 첫 후보가 자동 선택된다", async () => {
    stubFetch();
    render(<Home />);

    expect(await screen.findByRole("radio", { name: /^weather/ })).toHaveProperty("checked", true);
    // 스위트 목록은 아직 안 보인다. 서버가 먼저다.
    expect(screen.queryByText(SUITE)).toBeNull();
  });

  it("후보가 없으면 안내가 나오고 직접 입력이 펼쳐져 있다", async () => {
    stubFetch({ servers: [] });
    render(<Home />);

    expect(await screen.findByText(/bin 을 찾지 못했습니다/)).toBeTruthy();
    expect(screen.getByText(/다음부터 목록에 나타납니다/)).toBeTruthy();
    expect(screen.getByLabelText("서버 스크립트")).toBeTruthy();
  });

  it("명령이 비면 다음이 비활성이고 사유가 옆에 있다", async () => {
    stubFetch({ servers: [] });
    render(<Home />);
    await screen.findByLabelText("서버 스크립트");

    expect(screen.getByRole("button", { name: "다음" })).toHaveProperty("disabled", true);
    expect(screen.getByText("서버를 고르거나 실행 명령을 입력하세요.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("서버 스크립트"), { target: { value: "server.js" } });

    expect(screen.getByRole("button", { name: "다음" })).toHaveProperty("disabled", false);
  });

  /** 이 마법사의 요점이다. 서버를 고르면 그 서버가 만든 스위트가 위로 온다. */
  it("2단계는 고른 서버의 스위트를 펴고 나머지는 접는다", async () => {
    stubFetch();
    render(<Home />);
    await screen.findByRole("radio", { name: /^weather/ });
    next();

    expect(await screen.findByText("이 서버의 스위트 (2)")).toBeTruthy();
    expect(screen.getByRole("radio", { name: SUITE })).toBeTruthy();
    expect(screen.getByRole("radio", { name: SUITE_SHOW })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: OTHER_SUITE })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /다른 스위트 보기 \(1\)/ }));

    expect(screen.getByRole("radio", { name: OTHER_SUITE })).toBeTruthy();
  });

  it("스위트를 안 고르면 다음이 비활성이다", async () => {
    stubFetch();
    render(<Home />);
    await screen.findByRole("radio", { name: /^weather/ });
    next();
    await screen.findByRole("radio", { name: SUITE });

    expect(screen.getByRole("button", { name: "다음" })).toHaveProperty("disabled", true);
    expect(screen.getByText("스위트를 고르세요.")).toBeTruthy();
  });

  /** 매칭이 0건인데 나머지까지 접으면 화면이 빈다. 그때는 처음부터 펴 둔다. */
  it("맞는 스위트가 없으면 전체 목록이 펼쳐진 채로 시작한다", async () => {
    stubFetch({ servers: [] });
    render(<Home />);
    fireEvent.change(await screen.findByLabelText("서버 스크립트"), {
      target: { value: "somewhere/else.js" },
    });
    next();

    expect(await screen.findByText("이 서버의 스위트 (0)")).toBeTruthy();
    expect(screen.getByText(/맞는 스위트가 없습니다/)).toBeTruthy();
    expect(screen.getByRole("radio", { name: OTHER_SUITE })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /다른 스위트 보기/ })).toBeNull();
  });

  /**
   * 이 이슈의 본체다(#296). 고치기 전에는 "스위트가 없습니다." 한 줄이라, 도구가 어느
   * 디렉터리를 뒤졌는지 사용자가 알 방법이 없었다.
   */
  it("스위트가 0건이면 어느 디렉터리를 뒤졌는지와 고치는 방법 두 갈래를 말한다", async () => {
    stubFetch({ suites: [] });
    render(<Home />);
    await screen.findByRole("radio", { name: /^weather/ });
    next();

    expect(await screen.findByText(/스위트를 찾지 못했습니다/)).toBeTruthy();
    expect(screen.getByText("/tmp/proj")).toBeTruthy();
    expect(screen.getByText(/다시 띄우거나/)).toBeTruthy();
    // cwd 말고 두 번째 원인 — 형식 불통과·제외 디렉터리
    expect(screen.getByText(/node_modules/)).toBeTruthy();
  });

  /** 루트를 못 받아도 화면 자체는 살아야 한다. 경로만 빠지고 나머지 안내는 나간다. */
  it("메타를 못 받으면 경로 없이 나머지 안내만 낸다", async () => {
    stubFetch({ suites: [], meta: null });
    render(<Home />);
    await screen.findByRole("radio", { name: /^weather/ });
    next();

    expect(await screen.findByText(/스위트를 찾지 못했습니다/)).toBeTruthy();
    expect(screen.queryByText("/tmp/proj")).toBeNull();
    expect(screen.getByText(/다시 띄우거나/)).toBeTruthy();
  });

  it("명세 확인를 누르면 파일을 읽어 케이스당 한 줄로 보여주고, 다시 누르면 닫힌다", async () => {
    const content = JSON.stringify({
      schemaVersion: 1,
      id: "weather",
      name: "Weather 예제",
      cases: [
        {
          id: "get-weather-success",
          name: "성공",
          operation: { type: "callTool", tool: "get_weather", input: { city: "서울" } },
          assertions: [{ type: "isError", expected: false }],
        },
      ],
    });
    const fetchMock = stubFetch({ suiteContents: { [SUITE]: content } });
    render(<Home />);
    await screen.findByRole("radio", { name: /^weather/ });
    next();
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "명세 확인" }))[0] as HTMLElement,
    );

    expect(await screen.findByText("Weather 예제 (id weather) · 케이스 1건")).toBeTruthy();
    const pre = screen.getByText(
      (_content, element) =>
        element?.tagName === "PRE" && (element.textContent ?? "").includes("get-weather-success"),
    );
    expect(pre.textContent).toBe(
      '  1. get-weather-success  callTool get_weather {"city":"서울"}  → isError=false',
    );
    expect(
      fetchMock.mock.calls.some(
        ([input]) =>
          String(input) === `/api/suites/${encodeURIComponent(SUITE)}`.replace(/%2F/g, "%2F"),
      ),
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "명세 닫기" }));

    expect(screen.queryByText("Weather 예제 (id weather) · 케이스 1건")).toBeNull();
  });

  it("명세 확인가 파일을 못 읽으면 그 이유를 행 안에 적는다", async () => {
    stubFetch();
    render(<Home />);
    await screen.findByRole("radio", { name: /^weather/ });
    next();
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "명세 확인" }))[0] as HTMLElement,
    );

    expect(
      await screen.findByText("명세를 읽지 못했습니다: 파일을 찾을 수 없습니다."),
    ).toBeTruthy();
  });

  it("3단계 미리보기가 mcpeak test 로 시작하는 전문이다", async () => {
    stubFetch();
    render(<Home />);
    await goToOptions();

    expect(preview()).toBe(
      `mcpeak test ${SUITE} --command node --arg examples/weather-server/server.mjs --arg --port --arg 3000${BUNDLE_PREVIEW}`,
    );
  });

  it('실행 제출이 flow:"test"와 --command/--arg 분해 argv를 POST한다', async () => {
    const fetchMock = stubFetch();
    render(<Home />);
    await goToOptions();
    fireEvent.click(screen.getByRole("button", { name: "실행 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(post?.[0]).toBe("/api/runs");
    // --command는 실행 파일 하나만, 나머지 토큰은 각각 --arg다(CLI parseTestCommand 계약).
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      flow: "test",
      argv: [
        SUITE,
        "--command",
        "node",
        "--arg",
        "examples/weather-server/server.mjs",
        "--arg",
        "--port",
        "--arg",
        "3000",
        ...BUNDLE_ARGV,
      ],
    });
  });

  it("공백이 든 경로가 인자 하나로 그대로 간다", async () => {
    const fetchMock = stubFetch({ servers: [] });
    render(<Home />);
    // 이슈 #223 의 재현 입력. 한 칸에 받아 공백으로 쪼개던 시절에는
    // --command node --arg "my --arg server.js" 로 깨졌다.
    fireEvent.change(await screen.findByLabelText("서버 스크립트"), {
      target: { value: "my server.js" },
    });
    next();
    fireEvent.click(await screen.findByRole("radio", { name: OTHER_SUITE }));
    next();
    fireEvent.click(screen.getByRole("button", { name: "실행 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    expect(postedArgv(fetchMock)).toEqual([
      OTHER_SUITE,
      "--command",
      "node",
      "--arg",
      "my server.js",
      "--repair-bundle",
      managedRepairBundlePath(OTHER_SUITE),
    ]);
  });

  it("3단계에서 인자 칩을 지우면 argv 에서 빠진다", async () => {
    const fetchMock = stubFetch();
    render(<Home />);
    await goToOptions();
    expect(screen.getByText("선택한 서버의 인자를 가져왔습니다. 고칠 수 있습니다.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "인자 --port 제거" }));
    fireEvent.click(screen.getByRole("button", { name: "인자 3000 제거" }));
    fireEvent.click(screen.getByRole("button", { name: "실행 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    expect(postedArgv(fetchMock)).toEqual([
      SUITE,
      "--command",
      "node",
      "--arg",
      "examples/weather-server/server.mjs",
      ...BUNDLE_ARGV,
    ]);
  });

  it("3단계에서 인자를 더하면 스크립트 뒤에 순서대로 붙는다", async () => {
    const fetchMock = stubFetch({ servers: [] });
    render(<Home />);
    fireEvent.change(await screen.findByLabelText("서버 스크립트"), {
      target: { value: "server.js" },
    });
    next();
    fireEvent.click(await screen.findByRole("radio", { name: OTHER_SUITE }));
    next();
    for (const value of ["--port", "3000"]) {
      fireEvent.change(screen.getByLabelText("서버 인자"), { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: "추가" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "실행 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    expect(postedArgv(fetchMock)).toEqual([
      OTHER_SUITE,
      "--command",
      "node",
      "--arg",
      "server.js",
      "--arg",
      "--port",
      "--arg",
      "3000",
      "--repair-bundle",
      managedRepairBundlePath(OTHER_SUITE),
    ]);
  });

  /**
   * ADR-0066 후속. argv 조립 자체는 `build-test-argv.test.ts` 가 전량 단언하므로, 여기서는
   * **화면에서 그 폼에 닿을 수 있는가** 만 본다.
   */
  it("기본은 세션을 쓰지 않는다 — 경로 칸도 없다", async () => {
    stubFetch();
    render(<Home />);
    await goToOptions();

    expect(screen.getByRole("button", { name: "사용 안 함" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.queryByLabelText("세션 파일 경로")).toBeNull();
  });

  it("녹화를 고르고 경로를 적으면 argv 에 --record-session 이 실린다", async () => {
    const fetchMock = stubFetch();
    render(<Home />);
    await goToOptions();
    fireEvent.click(screen.getByRole("button", { name: "외부 호출 녹화" }));
    fireEvent.change(screen.getByLabelText("세션 파일 경로"), { target: { value: "tmp/s.db" } });
    fireEvent.click(screen.getByRole("button", { name: "실행 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    const argv = postedArgv(fetchMock);
    expect(argv).toContain("--record-session");
    expect(argv).toContain("tmp/s.db");
  });

  /**
   * 재생은 이 화면에서 고르지 않는다. 출발점이 스위트가 아니라 녹화본이라 Replay 탭이
   * 목록에서 시작하고, 거기서는 서버·스위트가 세션의 출처로 채워진다(ADR-0085). 여기 남겨
   * 두면 같은 일을 하는 자리가 둘이 되고 그중 하나는 경로를 손으로 적어야 하는 쪽이다.
   *
   * `--session` 을 싣는 계약 자체는 `build-test-argv.test.ts` 가 본다 — Replay 탭이 쓴다.
   */
  it("실행 옵션에 재생 선택지가 없다", async () => {
    stubFetch();
    render(<Home />);
    await goToOptions();

    expect(screen.getByRole("button", { name: "사용 안 함" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "외부 호출 녹화" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "녹화본 재생" })).toBeNull();
  });

  it("조립 실패 사유가 미리보기 자리에 나오고 실행 버튼이 비활성이다", async () => {
    stubFetch();
    render(<Home />);
    await goToOptions();
    fireEvent.click(screen.getByRole("button", { name: "외부 호출 녹화" }));

    expect(screen.getByText("세션 파일 경로를 입력하세요.")).toBeTruthy();
    expect(screen.queryByText(/^mcpeak test /)).toBeNull();
    expect(screen.getByRole("button", { name: "실행 시작" })).toHaveProperty("disabled", true);
  });

  it("기본값이면 POST argv 에 --repair-bundle 관리 경로가 붙고 옵션 요약은 바꾼 것 없음이다", async () => {
    const fetchMock = stubFetch();
    render(<Home />);
    await goToOptions();

    expect(screen.getByText("기본값 · 바꾼 것 없음")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "실행 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    const argv = postedArgv(fetchMock);
    expect(argv.slice(-2)).toEqual(BUNDLE_ARGV);
    expect(argv.filter((token) => token === "--repair-bundle")).toHaveLength(1);
  });

  it("Repair 번들을 직접 적으면 그 경로가 나가고 관리 경로는 나가지 않는다", async () => {
    const fetchMock = stubFetch();
    render(<Home />);
    await goToOptions();
    fireEvent.click(screen.getByRole("button", { name: /테스트 옵션/ }));
    fireEvent.change(screen.getByLabelText("Repair 번들"), { target: { value: "out/b.json" } });

    expect(screen.getByText("1개 바꿈")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "실행 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    const argv = postedArgv(fetchMock);
    expect(argv.slice(-2)).toEqual(["--repair-bundle", "out/b.json"]);
    expect(argv).not.toContain(BUNDLE_ARGV[1]);
  });

  it("옵션에서 결정론 검사를 켜면 POST argv 에 --determinism 이 들어간다", async () => {
    const fetchMock = stubFetch();
    render(<Home />);
    await goToOptions();
    fireEvent.click(screen.getByRole("button", { name: /테스트 옵션/ }));
    fireEvent.click(screen.getByLabelText("결정론 검사"));
    fireEvent.click(screen.getByRole("button", { name: "실행 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    expect(postedArgv(fetchMock)).toContain("--determinism");
  });

  it("1단계에서 HTTP 를 고르면 서버 목록과 직접 입력이 비활성이다", async () => {
    stubFetch({ servers: [] });
    render(<Home />);
    await screen.findByLabelText("서버 스크립트");
    fireEvent.click(screen.getByRole("button", { name: "HTTP URL" }));

    expect(screen.getByLabelText("서버 스크립트")).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Node 스크립트" })).toHaveProperty("disabled", true);
    // URL 이 비면 1단계를 통과할 수 없다.
    expect(screen.getByRole("button", { name: "다음" })).toHaveProperty("disabled", true);
    expect(screen.getByText("URL 을 입력하세요.")).toBeTruthy();
  });

  it("HTTP 를 고르면 POST argv 가 --url 로 시작하고 --command 가 없다", async () => {
    const fetchMock = stubFetch();
    render(<Home />);
    await screen.findByRole("radio", { name: /^weather/ });
    fireEvent.click(screen.getByRole("button", { name: "HTTP URL" }));
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://example.test/mcp" },
    });
    next();
    // 스크립트 인자가 없으니 매칭은 0건이고 목록은 펼쳐진 채로 온다.
    fireEvent.click(await screen.findByRole("radio", { name: SUITE }));
    next();
    fireEvent.click(screen.getByRole("button", { name: "실행 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    const argv = postedArgv(fetchMock);
    expect(argv.slice(0, 3)).toEqual([SUITE, "--url", "https://example.test/mcp"]);
    expect(argv).not.toContain("--command");
    expect(argv).not.toContain("--arg");
  });

  it("HTTP 로 바꾸면 stderr 줄 수가 비워지고 세션이 꺼진다", async () => {
    // 둘 다 HTTP 에서 비활성이라 값이 남으면 사용자가 풀 수 없다. 거절 문장만 보이고 막힌다.
    const fetchMock = stubFetch();
    render(<Home />);
    await goToOptions();
    fireEvent.click(screen.getByRole("button", { name: "외부 호출 녹화" }));
    fireEvent.change(screen.getByLabelText("세션 파일 경로"), { target: { value: "tmp/s.db" } });
    fireEvent.click(screen.getByRole("button", { name: /테스트 옵션/ }));
    fireEvent.change(screen.getByLabelText("서버 stderr 줄 수"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    fireEvent.click(screen.getByRole("button", { name: "HTTP URL" }));
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://example.test/mcp" },
    });
    next();
    fireEvent.click(await screen.findByRole("radio", { name: SUITE }));
    next();

    expect(screen.getByRole("button", { name: "실행 시작" })).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("button", { name: "실행 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    const argv = postedArgv(fetchMock);
    expect(argv).not.toContain("--stderr-lines");
    expect(argv).not.toContain("--record-session");
  });

  it("지난 실행값에는 관리 경로가 아니라 사용자 값이 저장된다", async () => {
    stubFetch();
    render(<Home />);
    await goToOptions();
    fireEvent.click(screen.getByRole("button", { name: "실행 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    const saved = JSON.parse(window.localStorage.getItem("mcpeak-home-last-run") ?? "{}");
    expect(saved[SUITE].options.repairBundlePath).toBe("");
    expect(saved[SUITE].command).toBe("node");
  });

  /**
   * 지난 실행은 스위트 경로로 저장된다. 그래서 서버를 먼저 고르는 이 마법사에서는
   * 1단계의 갈래가 아니라 3단계의 되돌리기 버튼으로 나온다.
   */
  it("지난 실행이 지금 고른 서버와 다르면 3단계에서 되돌릴 수 있다", async () => {
    window.localStorage.setItem(
      "mcpeak-home-last-run",
      JSON.stringify({
        [SUITE]: {
          command: "python",
          args: ["old-server.py"],
          options: DEFAULT_TEST_OPTIONS,
        },
      }),
    );
    stubFetch();
    render(<Home />);
    await goToOptions();

    expect(screen.getByText("python old-server.py")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "지난 실행값 쓰기" }));

    expect(preview()).toBe(
      `mcpeak test ${SUITE} --command python --arg old-server.py${BUNDLE_PREVIEW}`,
    );
    // 되돌렸으니 알림은 사라진다.
    expect(screen.queryByRole("button", { name: "지난 실행값 쓰기" })).toBeNull();
  });

  it("지난 실행이 지금 고른 서버와 같으면 되돌리기 버튼이 없다", async () => {
    window.localStorage.setItem(
      "mcpeak-home-last-run",
      JSON.stringify({
        [SUITE]: { command: WEATHER.command, args: WEATHER.args, options: DEFAULT_TEST_OPTIONS },
      }),
    );
    stubFetch();
    render(<Home />);
    await goToOptions();

    expect(screen.queryByRole("button", { name: "지난 실행값 쓰기" })).toBeNull();
  });

  it("지난 실행 옵션이 3단계 기본값으로 채워진다", async () => {
    window.localStorage.setItem(
      "mcpeak-home-last-run",
      JSON.stringify({
        [SUITE]: {
          command: WEATHER.command,
          args: WEATHER.args,
          options: { ...DEFAULT_TEST_OPTIONS, junitPath: "out/j.xml" },
        },
      }),
    );
    const fetchMock = stubFetch();
    render(<Home />);
    await goToOptions();

    expect(screen.getByText("1개 바꿈")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "실행 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    expect(postedArgv(fetchMock)).toContain("out/j.xml");
  });

  /**
   * 응답 순서가 뒤집혀도 열린 행의 명세만 그린다. A 를 누르고 곧바로 B 를 누르면 A 의 응답이
   * 늦게 도착하는데, 그것을 B 행 자리에 그리면 사용자는 다른 스위트를 보고 실행을 결정한다.
   */
  it("늦게 온 명세 응답은 버린다", async () => {
    const specOf = (id: string): string =>
      JSON.stringify({
        schemaVersion: 1,
        id,
        name: id,
        cases: [
          {
            id: `${id}-case`,
            name: id,
            operation: { type: "callTool", tool: "t", input: {} },
            assertions: [{ type: "isError", expected: false }],
          },
        ],
      });
    const resolvers: Array<() => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/suites") {
          return new Response(JSON.stringify(SUITES), { status: 200 });
        }
        if (url === "/api/servers") {
          return new Response(JSON.stringify(CANDIDATES), { status: 200 });
        }
        if (url === "/api/meta") {
          return new Response(JSON.stringify(META), { status: 200 });
        }
        if (url.startsWith("/api/suites/")) {
          const path = decodeURIComponent(url.slice("/api/suites/".length));
          // 두 요청 모두 잡아 두었다가 눌린 순서의 역순으로 푼다.
          return await new Promise<Response>((resolve) => {
            resolvers.push(() =>
              resolve(
                new Response(JSON.stringify({ path, content: specOf(path), mtimeMs: 1 }), {
                  status: 200,
                }),
              ),
            );
          });
        }
        return new Response("[]", { status: 200 });
      }),
    );
    render(<Home />);
    await screen.findByRole("radio", { name: /^weather/ });
    next();
    const buttons = await screen.findAllByRole("button", { name: "명세 확인" });
    fireEvent.click(buttons[0] as HTMLElement);
    fireEvent.click(screen.getAllByRole("button", { name: "명세 확인" })[0] as HTMLElement);

    await waitFor(() => {
      expect(resolvers).toHaveLength(2);
    });
    // 늦게 누른 쪽(SUITE_SHOW)을 먼저, 먼저 누른 쪽(SUITE)을 나중에 푼다.
    await act(async () => {
      resolvers[1]?.();
      resolvers[0]?.();
    });

    expect(await screen.findByText(`${SUITE_SHOW} (id ${SUITE_SHOW}) · 케이스 1건`)).toBeTruthy();
    expect(screen.queryByText(`${SUITE} (id ${SUITE}) · 케이스 1건`)).toBeNull();
  });

  /** `chooseSuite` 와 같은 규칙이다. 접속은 1단계 소관이라 3단계 버튼이 덮으면 안 된다. */
  it("지난 실행값 쓰기가 1단계에서 고른 HTTP 접속을 덮지 않는다", async () => {
    window.localStorage.setItem(
      "mcpeak-home-last-run",
      JSON.stringify({
        [SUITE]: { command: "python", args: ["old.py"], options: DEFAULT_TEST_OPTIONS },
      }),
    );
    const fetchMock = stubFetch();
    render(<Home />);
    await screen.findByRole("radio", { name: /^weather/ });
    fireEvent.click(screen.getByRole("button", { name: "HTTP URL" }));
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://example.test/mcp" },
    });
    next();
    fireEvent.click(await screen.findByRole("radio", { name: SUITE }));
    next();

    // HTTP 는 명령을 argv 에 싣지 않으므로 되돌릴 것이 없다. 그래서 알림도 안 뜬다.
    expect(screen.queryByRole("button", { name: "지난 실행값 쓰기" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "실행 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    expect(postedArgv(fetchMock).slice(0, 3)).toEqual([SUITE, "--url", "https://example.test/mcp"]);
  });
});
