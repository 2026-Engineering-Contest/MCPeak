// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerCandidate } from "../../src/api-types.js";
import { DEFAULT_TEST_OPTIONS } from "../src/build-test-argv.js";
import type { ServerChoice } from "../src/components/ServerPicker.js";
import { ServerPicker } from "../src/components/ServerPicker.js";
import type { LastRun } from "../src/last-run.js";

/**
 * 서버 선택(설계 §5-2). **후보가 없을 때 무엇을 하면 되는지 말하는가** 가 이 파일이 지키는
 * 절반이다. "없습니다" 한 줄이면 도구가 어디를 뒤졌는지도, 다음에 뜨게 하려면 무엇을
 * 두어야 하는지도 알 수 없다(#296 과 같은 이유).
 */

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
    id: "mcp-config:.mcp.json:secret",
    name: "secret",
    command: "node",
    args: ["secret.mjs"],
    source: "mcp-config",
    path: ".mcp.json",
    hasEnv: true,
  },
];

const LAST_RUN: LastRun = {
  command: "node",
  args: ["server.mjs", "--port", "3100"],
  options: DEFAULT_TEST_OPTIONS,
};

const renderPicker = (
  overrides: Partial<Parameters<typeof ServerPicker>[0]> = {},
): ReturnType<typeof render> =>
  render(
    <ServerPicker
      candidates={CANDIDATES}
      lastRun={null}
      choice={{ kind: "candidate", id: WEATHER.id } satisfies ServerChoice}
      onChoose={vi.fn()}
      root="/tmp/proj"
      {...overrides}
    />,
  );

afterEach(cleanup);

describe("서버 선택", () => {
  it("후보가 name·명령 전문·출처 배지와 함께 라디오로 그려진다", () => {
    renderPicker();

    const radio = screen.getByRole("radio", { name: /^weather/ });
    const name = radio.getAttribute("aria-label") ?? radio.closest("label")?.textContent ?? "";
    expect(name).toContain("weather");
    expect(name).toContain("node examples/weather-server/server.mjs --port 3000");
    expect(name).toContain(".mcp.json");
    expect(screen.getByText("프로젝트에서 2개 찾음")).toBeTruthy();
  });

  it("hasEnv 후보에 env 안내 문장이 붙는다", () => {
    renderPicker();

    expect(
      screen.getByText("env 는 대시보드가 넘기지 못합니다. 셸에서 미리 내보내세요."),
    ).toBeTruthy();
  });

  it('지난 실행이 있으면 첫 항목이고 배지가 "이 브라우저" 다', () => {
    renderPicker({ lastRun: LAST_RUN, choice: { kind: "last-run" } });

    const [first] = screen.getAllByRole("radio");
    const label = first?.closest("label")?.textContent ?? "";
    expect(label).toContain("지난 실행");
    expect(label).toContain("이 브라우저");
    expect(label).toContain("node server.mjs --port 3100");
    expect(first).toHaveProperty("checked", true);
  });

  it("후보 0·지난 실행 없음이면 root 를 담은 안내가 나오고 라디오가 없다", () => {
    renderPicker({ candidates: [], choice: { kind: "manual" } });

    expect(screen.getByText("/tmp/proj")).toBeTruthy();
    expect(screen.getByText(/bin 을 찾지 못했습니다/)).toBeTruthy();
    expect(
      screen.getByText("아래에 직접 적거나, 루트에 .mcp.json 을 두면 다음부터 목록에 나타납니다."),
    ).toBeTruthy();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("root 가 null 이면 경로 없이 안내가 나온다", () => {
    renderPicker({ candidates: [], choice: { kind: "manual" }, root: null });

    expect(screen.queryByText("/tmp/proj")).toBeNull();
    expect(screen.getByText(/bin 을 찾지 못했습니다/)).toBeTruthy();
    expect(screen.getByText(/다음부터 목록에 나타납니다/)).toBeTruthy();
  });

  it("radioName 을 주면 모든 라디오의 name 이 그 값이다", () => {
    renderPicker({ radioName: "generate-server" });

    const radios = screen.getAllByRole("radio");
    expect(radios.length).toBeGreaterThan(0);
    for (const radio of radios) {
      expect(radio.getAttribute("name")).toBe("generate-server");
    }
  });

  it("radioName 을 안 주면 home-run-server 다", () => {
    renderPicker();

    const radios = screen.getAllByRole("radio");
    expect(radios.length).toBeGreaterThan(0);
    for (const radio of radios) {
      expect(radio.getAttribute("name")).toBe("home-run-server");
    }
  });

  it("disabled 면 모든 라디오가 비활성이고 disabledHint 가 보인다", () => {
    renderPicker({
      disabled: true,
      disabledHint: "원격 서버에 붙습니다. 위 서버 명령은 쓰이지 않습니다.",
    });

    const radios = screen.getAllByRole("radio");
    expect(radios.length).toBeGreaterThan(0);
    for (const radio of radios) {
      expect(radio).toHaveProperty("disabled", true);
    }
    expect(screen.getByText("원격 서버에 붙습니다. 위 서버 명령은 쓰이지 않습니다.")).toBeTruthy();
  });
});
