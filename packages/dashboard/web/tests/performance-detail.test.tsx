// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const UNAPPROVED_SUITE = "examples/weather-server/draft.suite.json";
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

    fireEvent.click(await screen.findByRole("radio", { name: SUITE }));
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
});
