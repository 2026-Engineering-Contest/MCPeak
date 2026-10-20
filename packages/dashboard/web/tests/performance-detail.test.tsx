// @vitest-environment jsdom
import type { CaseResult, PerfReport } from "@mcpeak/perf";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyzePerfResponse } from "../../src/api-types.js";
import {
  buildPerfRequest,
  INITIAL_PERF_FORM,
  performanceUnavailable,
  perfStartNotice,
} from "../src/analyze/build-perf-request.js";
import { AnalyzeView } from "../src/screens/AnalyzeView.js";
import {
  costCard,
  FakeEventSource,
  finishSecurityRun,
  installFakeEventSource,
  lastSource,
  PENDING,
  postedBodies,
  runAll,
  securityCard,
  showDetail,
  stubFetch,
  WEATHER,
  WEATHER_ARGV,
  waitTokensSettled,
} from "./analyze-fixtures.js";

/**
 * 성능 상세의 행동(구현계획 §5.3). DOM 구조·문구를 고정하지 않는다. 문장은 계약 함수에서 꺼내 비교하고,
 * 요소는 역할과 이름의 첫 글자로만 찾는다.
 */

const SUITE = "examples/weather-server/server.suite.json";
// 두 명세 모두 weather 서버(`examples/weather-server/server.mjs`)에 딸린 이름이라 펼치지 않아도 보인다.
const UNAPPROVED_SUITE = "examples/weather-server/server.suite.draft.json";
const OTHER_SUITE = "docs/x.suite.json";
const SPEC = { server: { command: "node" }, cases: [] };

const SUITES = {
  suites: [{ path: SUITE }, { path: UNAPPROVED_SUITE }],
  suiteContent: { [SUITE]: { ...SPEC, approval: {} }, [UNAPPROVED_SUITE]: SPEC },
} as const;

type StubOptions = Parameters<typeof stubFetch>[0];

/** 분석하기 뒤 보안·토큰을 끝내고 성능 상세를 연다. */
async function openPerformance(options: StubOptions = {}): Promise<ReturnType<typeof vi.fn>> {
  const fetchMock = stubFetch({ ...SUITES, ...options });
  const { rerender } = render(<AnalyzeView pillar={null} />);
  await runAll();
  await finishSecurityRun();
  await waitTokensSettled();
  showDetail(rerender, "performance");
  return fetchMock;
}

function perfCase(id: string, p50: number | undefined): CaseResult {
  return {
    id,
    tool: id,
    n: p50 === undefined ? 0 : 5,
    outcomes:
      p50 === undefined
        ? { ok: 0, isError: 0, empty: 0, threw: 5, skipped: 0, missingTool: 0 }
        : { ok: 5, isError: 0, empty: 0, threw: 0, skipped: 0, missingTool: 0 },
    ...(p50 === undefined ? {} : { total: { p50, p95: p50, min: p50, max: p50 } }),
    dependency: { dependent: 0, independent: 0, unknown: 0 },
    requestSummaries: [],
  };
}

/** 측정 두 케이스와 측정 안 된 한 케이스. `rendered` 는 CLI 원문 흉내이고 화면에 나오면 안 된다. */
function perfResponse(abortedLine: string | null = null): AnalyzePerfResponse {
  const report: PerfReport = {
    schemaVersion: 1,
    generator: { name: "@mcpeak/perf", version: "0.0.0" },
    server: { command: "node s.mjs", toolCount: 3 },
    settings: { repeat: 5, intervalMs: 0, caseCount: 3, observation: "preload" },
    coldStart: { connectMs: 80, listToolsMs: 3 },
    cases: [perfCase("a", 412.4), perfCase("b", 600.6), perfCase("c", undefined)],
    findings: [],
    undecidedCases: 0,
    aborted: null,
    exitCode: 0,
  };
  return {
    report,
    rendered: "mcpeak perf 결과\n서버 node s.mjs\n",
    exitCode: 0,
    abortedLine,
    limits: ["한계 문장"],
  };
}

/** 성능 상세를 열고 명세를 골라 시작한 뒤 run 을 끝내 결과까지 간다. */
async function measureToDone(response: AnalyzePerfResponse): Promise<ReturnType<typeof vi.fn>> {
  const fetchMock = await openPerformance({ perfResult: { status: 200, body: response } });
  fireEvent.click(await screen.findByRole("radio", { name: SUITE }));
  await waitFor(() => expect(startButton().disabled).toBe(false));
  fireEvent.click(startButton());
  await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
  const source = lastSource();
  act(() => {
    source.emit({ kind: "done", exitCode: 0 });
  });
  await screen.findByRole("table", { name: /케이스별/ });
  return fetchMock;
}

function startButton(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>("button", { name: /^측정/ });
}

function perfPosts(fetchMock: ReturnType<typeof vi.fn>): readonly Record<string, unknown>[] {
  return postedBodies(fetchMock, "/api/analyze/perf");
}

function pageText(): string {
  return document.body.textContent ?? "";
}

describe("AnalyzeView 성능 상세", () => {
  beforeEach(() => {
    window.localStorage.clear();
    installFakeEventSource();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("분석하기는 성능 요청을 보내지 않는다", async () => {
    const fetchMock = stubFetch(SUITES);
    render(<AnalyzeView pillar={null} />);
    await runAll();
    await finishSecurityRun();
    await waitTokensSettled();

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.filter((url) => url.startsWith("/api/analyze/perf"))).toEqual([]);
  });

  it("명세를 고르고 시작하면 성능 요청이 한 번 나간다", async () => {
    const fetchMock = await openPerformance({ perfStart: PENDING });

    fireEvent.click(await screen.findByRole("radio", { name: SUITE }));
    await waitFor(() => expect(startButton().disabled).toBe(false));
    fireEvent.click(startButton());

    await waitFor(() => expect(perfPosts(fetchMock)).toHaveLength(1));
    expect(JSON.stringify(perfPosts(fetchMock)[0])).toBe(
      JSON.stringify(
        buildPerfRequest(WEATHER_ARGV, WEATHER.id, "stdio", {
          ...INITIAL_PERF_FORM,
          suitePath: SUITE,
        }),
      ),
    );
  });

  it("원격 대상이면 성능 요청이 나가지 않는다", async () => {
    const fetchMock = stubFetch(SUITES);
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await screen.findByRole("radio", { name: /^weather/ });
    fireEvent.click(screen.getByRole("button", { name: "HTTP URL" }));
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://example.test/mcp" },
    });
    fireEvent.click(screen.getByRole("button", { name: "분석하기" }));
    await finishSecurityRun();
    await waitTokensSettled();
    showDetail(rerender, "performance");

    // HTTP 대상에는 스크립트 인자가 없어 딸린 명세가 없다. 접힌 목록을 펴서 고른다.
    fireEvent.click(await screen.findByRole("button", { name: /다른 명세 보기/ }));
    fireEvent.click(screen.getByRole("radio", { name: SUITE }));
    expect(startButton().disabled).toBe(true);
    fireEvent.click(startButton());
    const reason = performanceUnavailable("http");
    expect(reason).not.toBeNull();
    expect(pageText()).toContain(reason);
    expect(perfPosts(fetchMock)).toHaveLength(0);
  });

  it("미승인 명세면 미승인 고지가 보인다", async () => {
    await openPerformance();
    const unapproved = perfStartNotice(5, false)[2];
    expect(unapproved).toBeDefined();

    fireEvent.click(await screen.findByRole("radio", { name: UNAPPROVED_SUITE }));
    await waitFor(() => expect(pageText()).toContain(unapproved));

    fireEvent.click(screen.getByRole("radio", { name: SUITE }));
    await waitFor(() => expect(pageText()).not.toContain(unapproved));
    // 승인된 명세에도 앞의 두 줄은 그대로 보인다.
    for (const line of perfStartNotice(5, true)) {
      expect(pageText()).toContain(line);
    }
  });

  it("성능이 실패해도 다른 카드는 제 상태다", async () => {
    await openPerformance({ perfStart: { status: 400, body: { error: "측정 시작 실패" } } });
    const securityBefore = securityCard().textContent;
    const costBefore = costCard().textContent;

    fireEvent.click(await screen.findByRole("radio", { name: SUITE }));
    await waitFor(() => expect(startButton().disabled).toBe(false));
    fireEvent.click(startButton());

    const performance = screen.getByRole("tab", { name: /^성능 효율성/ });
    await waitFor(() => expect(performance.textContent).toContain("측정 시작 실패"));
    expect(securityCard().textContent).toBe(securityBefore);
    expect(costCard().textContent).toBe(costBefore);
  });

  it("다른 축이 도는 동안 성능을 시작할 수 없다", async () => {
    const fetchMock = stubFetch(SUITES);
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    // 보안 run 의 done 을 보내지 않는다. 보안은 running 그대로다.
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    await waitTokensSettled();
    showDetail(rerender, "performance");

    fireEvent.click(await screen.findByRole("radio", { name: SUITE }));
    // 명세 내용이 도착할 시간을 준 뒤에도 비활성이다.
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith("/api/suites/"))).toBe(
        true,
      ),
    );
    expect(startButton().disabled).toBe(true);
    fireEvent.click(startButton());
    expect(perfPosts(fetchMock)).toHaveLength(0);
  });

  it("성능이 도는 동안 분석하기를 누를 수 없다", async () => {
    const fetchMock = await openPerformance();

    fireEvent.click(await screen.findByRole("radio", { name: SUITE }));
    await waitFor(() => expect(startButton().disabled).toBe(false));
    fireEvent.click(startButton());
    await waitFor(() => expect(perfPosts(fetchMock)).toHaveLength(1));
    // 성능 run 의 스트림이 열렸다. done 은 보내지 않는다.
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "대상 바꾸기" }));
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /^분석/ }).disabled).toBe(true);
  });

  it("고른 서버에 딸린 명세만 먼저 보인다", async () => {
    await openPerformance({ suites: [{ path: SUITE }, { path: OTHER_SUITE }] });

    expect(await screen.findByRole("radio", { name: SUITE })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: OTHER_SUITE })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /다른 명세 보기/ }));
    expect(screen.getByRole("radio", { name: OTHER_SUITE })).toBeTruthy();
  });

  it("딸린 명세가 없으면 생성 화면 링크가 보인다", async () => {
    await openPerformance({ suites: [{ path: OTHER_SUITE }] });

    const link = await screen.findByRole("link", { name: /명세 만들기/ });
    expect(link.getAttribute("href")).toBe("#/generate");
    expect(startButton().disabled).toBe(true);
  });
  it("done 이면 CLI 원문 대신 케이스 표를 보인다", async () => {
    const response = perfResponse();
    await measureToDone(response);

    expect(pageText()).not.toContain("mcpeak perf 결과");
    const table = screen.getByRole("table", { name: /케이스별/ });
    const bodyRows = within(table).getAllByRole("row").length - 1;
    expect(bodyRows).toBe(response.report.cases.filter((entry) => entry.n > 0).length);
  });

  it("중단 줄이 있으면 alert 로 그 글자를 보인다", async () => {
    const line = "측정 중단: 'a' 호출이 10000ms 안에 끝나지 않아 남은 호출을 하지 않았습니다.";
    await measureToDone(perfResponse(line));

    const alerts = screen.getAllByRole("alert").map((element) => element.textContent);
    expect(alerts).toContain(line);
  });

  it("명세 바꾸기를 누르면 명세 선택이 다시 보인다", async () => {
    await measureToDone(perfResponse());
    expect(screen.queryByRole("radio", { name: SUITE })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^명세 바꾸기/ }));
    expect(screen.getByRole("radio", { name: SUITE })).toBeTruthy();
  });

  it("다시 측정은 같은 본문으로 한 번 더 보낸다", async () => {
    const fetchMock = await measureToDone(perfResponse());

    fireEvent.click(screen.getByRole("button", { name: /^다시 측정/ }));
    await waitFor(() => expect(perfPosts(fetchMock)).toHaveLength(2));
    expect(JSON.stringify(perfPosts(fetchMock)[1])).toBe(JSON.stringify(perfPosts(fetchMock)[0]));
  });
});
