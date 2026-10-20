// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyzePerfRequest, AnalyzePerfResponse } from "../../src/api-types.js";
import { usePerformanceAnalysis } from "../src/analyze/use-performance-analysis.js";
import {
  FakeEventSource,
  installFakeEventSource,
  lastSource,
  perfResultRequests,
  postedBodies,
  stubFetch,
} from "./analyze-fixtures.js";

const REQUEST: AnalyzePerfRequest = {
  argv: ["--command", "node"],
  serverId: "weather",
  suitePath: "examples/weather-server/server.suite.json",
  repeat: 3,
};

/** 훅은 응답을 읽지 않고 그대로 싣는다. 형식만 맞춘다. */
const RESPONSE: AnalyzePerfResponse = {
  report: {
    schemaVersion: 1,
    generator: { name: "@mcpeak/perf", version: "0.0.0" },
    server: { command: "node s.mjs", toolCount: 1 },
    settings: { repeat: 3, intervalMs: 0, caseCount: 0, observation: "preload" },
    coldStart: { connectMs: 80, listToolsMs: 3 },
    cases: [],
    findings: [],
    undecidedCases: 0,
    aborted: null,
    exitCode: 0,
  },
  rendered: "",
  exitCode: 0,
  abortedLine: null,
  limits: [],
};

describe("usePerformanceAnalysis", () => {
  beforeEach(() => {
    installFakeEventSource();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("start 는 /api/analyze/perf 로 본문을 보내고 running 이 된다", async () => {
    const fetchMock = stubFetch();
    const { result } = renderHook(() => usePerformanceAnalysis());

    let started = false;
    await act(async () => {
      started = await result.current.start(REQUEST);
    });

    expect(started).toBe(true);
    const bodies = postedBodies(fetchMock, "/api/analyze/perf");
    expect(bodies).toHaveLength(1);
    expect(JSON.stringify(bodies[0])).toBe(JSON.stringify(REQUEST));
    expect(result.current.state.kind).toBe("running");
    expect(result.current.sent).toEqual(REQUEST);
  });

  it("run 이 끝나면 결과를 한 번 읽고 done 이 된다", async () => {
    const fetchMock = stubFetch({ perfResult: { status: 200, body: RESPONSE } });
    const { result } = renderHook(() => usePerformanceAnalysis());

    await act(async () => {
      await result.current.start(REQUEST);
    });
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
    act(() => {
      lastSource().emit({ kind: "done", exitCode: 0 });
    });

    await waitFor(() => expect(result.current.state.kind).toBe("done"));
    expect(perfResultRequests(fetchMock)).toEqual(["/api/analyze/perf/p1"]);
    expect(result.current.state).toEqual({ kind: "done", result: RESPONSE, serial: 1 });
  });

  it("첫 시작 실패는 failed 이고 서버 문장을 그대로 싣는다", async () => {
    stubFetch({ perfStart: { status: 400, body: { error: "E" } } });
    const { result } = renderHook(() => usePerformanceAnalysis());

    let started = true;
    await act(async () => {
      started = await result.current.start(REQUEST);
    });

    expect(started).toBe(false);
    expect(result.current.state).toEqual({ kind: "failed", error: "E" });
  });

  it("결과 읽기 400 은 failed 다", async () => {
    stubFetch({ perfResult: { status: 400, body: { error: "오류 [PERF_X]: 문장" } } });
    const { result } = renderHook(() => usePerformanceAnalysis());

    await act(async () => {
      await result.current.start(REQUEST);
    });
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
    act(() => {
      lastSource().emit({ kind: "done", exitCode: 1 });
    });

    await waitFor(() => expect(result.current.state.kind).toBe("failed"));
    expect(result.current.state).toEqual({ kind: "failed", error: "오류 [PERF_X]: 문장" });
  });
});
