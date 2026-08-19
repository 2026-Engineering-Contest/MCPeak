// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GenerateWizard } from "../src/screens/GenerateWizard.js";

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => {
    return new Response(JSON.stringify({ runId: "run-new" }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** 1단계(서버)를 채우고 다음으로 넘어간다. */
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

describe("GenerateWizard", () => {
  beforeEach(() => {
    window.location.hash = "";
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("필수 미입력이면 다음 버튼이 비활성이다", () => {
    render(<GenerateWizard />);
    const next = screen.getByRole("button", { name: "다음" });
    expect(next).toHaveProperty("disabled", true);
    expect(screen.getByText("실행 명령을 입력하세요.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("서버 스크립트"), {
      target: { value: "server.js" },
    });
    expect(next).toHaveProperty("disabled", false);
  });

  it("시험 실행 토글을 끄면 4단계의 카세트·초기화 입력이 비활성이다", () => {
    render(<GenerateWizard />);
    fillStepServer("server.js");
    fillStepSuite();
    fireEvent.click(screen.getByLabelText("저장 전에 시험 실행으로 검증"));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    expect(screen.getByLabelText("카세트 저장 위치 (선택)")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("시험 실행 전 초기화 명령 (선택)")).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("재녹화 체크는 카세트 경로가 비어 있으면 비활성이다", () => {
    render(<GenerateWizard />);
    fillStepServer("server.js");
    fillStepSuite();
    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    const record = screen.getByLabelText("재녹화 (--record)");
    expect(record).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("카세트 저장 위치 (선택)"), {
      target: { value: "cassette.json" },
    });
    expect(record).toHaveProperty("disabled", false);
  });

  it('4단계 완주 후 생성 시작이 조립된 argv로 flow:"generate"를 POST한다', async () => {
    const fetchMock = stubFetch();
    render(<GenerateWizard />);
    fillStepServer("server.js");
    fillStepSuite();
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("button", { name: "생성 시작" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/runs/run-new");
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/runs");
    expect(init.method).toBe("POST");
    // --command는 실행 파일 하나만, 스크립트 경로는 --arg 선두다(CLI 계약).
    expect(JSON.parse(String(init.body))).toEqual({
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
    const fetchMock = stubFetch();
    render(<GenerateWizard />);
    fireEvent.change(screen.getByLabelText("서버 스크립트"), { target: { value: "server.js" } });
    fireEvent.change(screen.getByLabelText("서버 인자"), { target: { value: "--port" } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fillStepSuite();
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("button", { name: "생성 시작" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.argv.slice(0, 6)).toEqual([
      "--command",
      "node",
      "--arg",
      "server.js",
      "--arg",
      "--port",
    ]);
  });

  it("마지막 단계에 조립된 CLI 명령 전문이 보인다", () => {
    render(<GenerateWizard />);
    fillStepServer("server.js");
    fillStepSuite();
    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    const command = screen.getByText(
      "ohmymcp generate --command node --arg server.js --suite-id weather " +
        '--name "날씨 서버" --out examples/weather/suite.json --provider claude',
    );
    expect(command.className).toContain("font-mono");
  });
});
