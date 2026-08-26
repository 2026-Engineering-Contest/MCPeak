// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "../../src/api-types.js";
import { formatRecordedAt, ReplayView } from "../src/screens/ReplayView.js";
import { saveSessionOrigin } from "../src/session-origin.js";

/**
 * Replay 화면. **이 화면이 지키는 약속은 두 가지다** — 출처를 아는 녹화본은 클릭 한 번으로
 * 재생되고, 모르는 녹화본도 막히지 않는다(입력을 받아 재생한다).
 */

const session = (overrides: Partial<SessionEntry> = {}): SessionEntry => ({
  path: "tmp/weather.db",
  status: "completed",
  interactionCount: 12,
  recordedAt: "2026-08-25T14:32:40.123Z",
  ...overrides,
});

let fetchMock: ReturnType<typeof vi.fn>;
/** `POST /api/runs` 로 간 요청 본문. 원클릭이 무엇을 실행했는지 여기서 본다. */
let started: { flow: string; argv: string[] }[];

function mockApi(sessions: readonly SessionEntry[]): void {
  started = [];
  fetchMock = vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    if (url.endsWith("/api/sessions")) {
      return new Response(JSON.stringify(sessions), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/api/runs") && init?.method === "POST") {
      started.push(JSON.parse(init.body ?? "{}"));
      return new Response(JSON.stringify({ runId: "run-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`예상하지 못한 요청: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("formatRecordedAt", () => {
  /** ADR-0069: `toLocale*` 금지, UTC 명시, 밀리초 제거. */
  it("ISO 를 UTC 표기로 자른다", () => {
    expect(formatRecordedAt("2026-08-25T14:32:40.123Z")).toBe("2026-08-25 14:32 UTC");
  });

  it("모양이 다르면 원문을 그대로 준다", () => {
    expect(formatRecordedAt("언제인지 모름")).toBe("언제인지 모름");
  });
});

describe("Replay 화면", () => {
  it("녹화본 목록을 시각·호출 수와 함께 보여준다", async () => {
    mockApi([session()]);

    render(<ReplayView />);

    expect(await screen.findByText("tmp/weather.db")).toBeTruthy();
    expect(screen.getByText("2026-08-25 14:32 UTC 녹화")).toBeTruthy();
    expect(screen.getByText("외부 호출 12건")).toBeTruthy();
  });

  /**
   * 이 화면의 요점이다. 출처를 알면 묻지 않고 실행한다 — `--session` 이 실린 argv 가
   * 그대로 나가고 실행 화면으로 옮겨간다.
   */
  it("출처를 아는 녹화본은 재생 한 번으로 실행된다", async () => {
    mockApi([session()]);
    saveSessionOrigin("tmp/weather.db", {
      command: "node",
      args: ["examples/weather/server.js"],
      suitePath: "examples/weather/weather.suite.json",
    });

    render(<ReplayView />);
    fireEvent.click(await screen.findByRole("button", { name: "재생" }));

    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toEqual({
      flow: "test",
      argv: [
        "examples/weather/weather.suite.json",
        "--command",
        "node",
        "--arg",
        "examples/weather/server.js",
        "--session",
        "tmp/weather.db",
        // 번들은 항상 켠다(ADR-0080). 경로 규칙은 `effectiveRepairBundlePath` 가 정한다.
        "--repair-bundle",
        ".mcpeak/repair/examples__weather__weather.suite.repair-bundle.json",
      ],
    });
    await waitFor(() => expect(window.location.hash).toBe("#/runs/run-1"));
  });

  /**
   * ADR-0085. 세션 파일이 출처를 담고 있으면 이 브라우저가 녹화한 적 없어도(CLI 녹화,
   * 다른 기계) 원클릭이 된다 — localStorage 는 비어 있는 상태로 검증한다.
   */
  it("세션 파일의 출처만으로 원클릭 재생이 된다", async () => {
    mockApi([
      session({
        origin: { command: "node", args: ["srv.mjs"], suitePath: "file.suite.json" },
      }),
    ]);

    render(<ReplayView />);
    fireEvent.click(await screen.findByRole("button", { name: "재생" }));

    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]?.argv.slice(0, 5)).toEqual([
      "file.suite.json",
      "--command",
      "node",
      "--arg",
      "srv.mjs",
    ]);
  });

  /** 세션의 출처가 정본이다. 폴백이 이기면 재녹화 후에도 이 브라우저는 옛 값을 보여준다. */
  it("세션 파일의 출처가 브라우저 폴백보다 우선한다", async () => {
    mockApi([
      session({
        origin: { command: "node", args: [], suitePath: "from-file.suite.json" },
      }),
    ]);
    saveSessionOrigin("tmp/weather.db", {
      command: "python",
      args: ["old.py"],
      suitePath: "from-browser.suite.json",
    });

    render(<ReplayView />);
    fireEvent.click(await screen.findByRole("button", { name: "재생" }));

    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]?.argv[0]).toBe("from-file.suite.json");
  });

  it("출처를 모르면 실행하지 않고 입력을 연다", async () => {
    mockApi([session()]);

    render(<ReplayView />);
    fireEvent.click(await screen.findByRole("button", { name: "재생" }));

    expect(started).toHaveLength(0);
    expect(screen.getByLabelText("서버 명령")).toBeTruthy();
    expect(screen.getByLabelText("스위트 경로")).toBeTruthy();
  });

  it("입력을 채우면 그 값으로 재생한다", async () => {
    mockApi([session()]);

    render(<ReplayView />);
    fireEvent.click(await screen.findByRole("button", { name: "재생" }));
    fireEvent.change(screen.getByLabelText("서버 명령"), { target: { value: "node" } });
    fireEvent.change(screen.getByLabelText("스위트 경로"), { target: { value: "a.suite.json" } });
    fireEvent.click(screen.getByRole("button", { name: "이 값으로 재생" }));

    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]?.argv).toContain("--session");
    expect(started[0]?.argv).toContain("tmp/weather.db");
  });

  /**
   * 열린 패널에서 값을 지워 실행할 수 없게 된 상태다. 그때 재생 클릭이 패널을 **닫으면**
   * 사용자는 고치던 입력 앞에서 화면이 접히는 것을 본다 — 열려 있어야 한다.
   */
  it("실행할 수 없는 재생 클릭이 열린 패널을 닫지 않는다", async () => {
    mockApi([session()]);

    render(<ReplayView />);
    fireEvent.click(await screen.findByRole("button", { name: "재생" }));
    expect(screen.getByLabelText("스위트 경로")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "재생" }));

    expect(started).toHaveLength(0);
    expect(screen.getByLabelText("스위트 경로")).toBeTruthy();
  });

  /**
   * 녹화가 끝나지 않은 세션은 record 가 재생을 거절한다(`REPLAY_SOURCE_INVALID`).
   * 실행해 보고 알게 하지 않는다 — 버튼이 먼저 막고 사유를 말한다.
   */
  it("녹화가 끝나지 않은 세션은 재생할 수 없고 사유를 말한다", async () => {
    mockApi([session({ status: "running" })]);

    render(<ReplayView />);

    const button = await screen.findByRole("button", { name: "재생" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/녹화가 끝나지 않은 세션입니다/)).toBeTruthy();
  });

  /** 「명세 확인」(스위트 목록)과 같은 라벨 토글이다 — 열림 여부를 아이콘이 아니라 문구가 말한다. */
  it("경로 고치기 버튼이 패널을 열고 닫는다", async () => {
    mockApi([session()]);

    render(<ReplayView />);
    fireEvent.click(await screen.findByRole("button", { name: "경로 고치기" }));
    expect(screen.getByLabelText("스위트 경로")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));

    expect(screen.queryByLabelText("스위트 경로")).toBeNull();
  });

  it("녹화본이 없으면 만드는 방법을 알려준다", async () => {
    mockApi([]);

    render(<ReplayView />);

    expect(await screen.findByText(/외부 호출 녹화/)).toBeTruthy();
  });

  it("상호작용이 없는 세션은 시각을 적지 않는다", async () => {
    const { recordedAt, ...withoutTime } = session({ interactionCount: 0 });
    mockApi([withoutTime]);

    render(<ReplayView />);

    expect(await screen.findByText("외부 호출 0건")).toBeTruthy();
    expect(screen.queryByText(/UTC 녹화/)).toBeNull();
  });
});
