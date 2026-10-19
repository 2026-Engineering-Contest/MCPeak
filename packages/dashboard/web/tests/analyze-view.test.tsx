// @vitest-environment jsdom
import type { RenderResult } from "@testing-library/react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceEditResponse } from "../../src/api-types.js";
import { describeChange, formatToolSide } from "../src/analyze/tool-diff.js";
import { readRecentCommands } from "../src/recent-commands.js";
import { AnalyzeView } from "../src/screens/AnalyzeView.js";
import {
  analyzeResponse,
  CLEANED_CHANGE,
  CLEANED_EDITS,
  cleanedResponse,
  costCard,
  finishSecurityRun,
  installFakeEventSource,
  lineText,
  NOT_FOUND_DETAIL,
  PENDING,
  postedBodies,
  preText,
  previewResponse,
  runAll,
  SCHEMA_CHANGE,
  SOURCE_A,
  SOURCE_AFTER,
  SOURCE_BEFORE,
  type StubResponse,
  securityCard,
  showDetail,
  stubFetch,
  WEATHER,
  WEATHER_ARGV,
  waitTokensSettled,
} from "./analyze-fixtures.js";

/** 토큰 응답을 기다려 비용 상세를 열고 `MCP 수정하기` 를 눌러 미리보기가 뜰 때까지 기다린다. */
async function openPreview(rerender: RenderResult["rerender"]): Promise<void> {
  await waitTokensSettled();
  showDetail(rerender, "tokens");
  fireEvent.click(await screen.findByRole("button", { name: "MCP 수정하기" }));
  await screen.findByRole("list", { name: "변경별 상태" });
}

describe("AnalyzeView 비용 상세", () => {
  beforeEach(() => {
    window.localStorage.clear();
    installFakeEventSource();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("명령이 비면 버튼이 비활성이고 사유를 보인다", async () => {
    stubFetch({ servers: [] });
    render(<AnalyzeView pillar={null} />);

    await screen.findByText(/bin 을 찾지 못했습니다/);
    expect(screen.getByRole("button", { name: "한 번에 분석" })).toHaveProperty("disabled", true);
    expect(screen.getByText("서버를 고르거나 실행 명령을 입력하세요.")).toBeTruthy();
  });

  it("성공 응답의 숫자를 요약과 표에 보이고 CLI 리포트 원문을 담는다", async () => {
    stubFetch();
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await waitTokensSettled();
    showDetail(rerender, "tokens");

    expect(await screen.findByText("1000 바이트 (~250 토큰)")).toBeTruthy();
    expect(screen.getByText("760 바이트 (~190 토큰, 24.0% 감소)")).toBeTruthy();
    expect(screen.getByText("2개 (공통 파라미터 2개 승격)")).toBeTruthy();

    const table = screen.getByRole("table", { name: "도구별 감소" });
    const rows = within(table).getAllByRole("row").slice(1);
    const cells = rows.map((row) =>
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    );
    expect(cells).toEqual([
      ["a", "600", "400", "33.3%", "1", "변경사항"],
      ["b", "400", "360", "10.0%", "0", "변경 없음"],
    ]);
    expect(screen.getByText("REPORT", { selector: "pre" })).toBeTruthy();
    // otherCapabilities 가 비었으면 주의 문장이 없다.
    expect(screen.queryByText(/^주의:/)).toBeNull();
  });

  it("otherCapabilities 가 있으면 주의 문장을 보인다", async () => {
    stubFetch({ analyze: { status: 200, body: analyzeResponse(["resources"]) } });
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await waitTokensSettled();
    showDetail(rerender, "tokens");

    const notice = await screen.findByText(/^주의:/);
    expect(notice.textContent).toContain("주의: 서버가 resources 능력도 광고합니다.");
    expect(notice.textContent).toBe(
      "주의: 서버가 resources 능력도 광고합니다. 프록시는 tools 만 중계하므로 그 능력은\n클라이언트에 보이지 않습니다.",
    );
  });

  it("실패 응답의 error 문장을 그대로 보인다", async () => {
    const error = "오류 [MCP_CONNECTION_FAILED]: x\n해결: y";
    stubFetch({ analyze: { status: 400, body: { error } } });
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await waitTokensSettled();
    showDetail(rerender, "tokens");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(error);
    expect(screen.queryByRole("table", { name: "도구별 감소" })).toBeNull();
  });

  it("변경사항을 누르면 원본·압축 JSON 과 변경 목록이 보이고 다시 누르면 사라진다", async () => {
    stubFetch();
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await waitTokensSettled();
    showDetail(rerender, "tokens");

    const table = await screen.findByRole("table", { name: "도구별 감소" });
    const rowA = within(table).getAllByRole("row")[1] as HTMLElement;
    const toggle = within(rowA).getByRole("button", { name: "변경사항" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const panelId = toggle.getAttribute("aria-controls") ?? "";
    const panel = document.getElementById(panelId) as HTMLElement;
    expect(panel).toBeTruthy();
    expect(within(panel).getByText("원본 (600 바이트)")).toBeTruthy();
    expect(within(panel).getByText("압축 (400 바이트)")).toBeTruthy();
    const pres = panel.querySelectorAll("pre");
    expect([...pres].map(preText)).toEqual([
      formatToolSide(SOURCE_A),
      formatToolSide({ name: "a", description: "A", inputSchema: { type: "object" } }),
    ]);
    const list = within(panel).getByRole("list", { name: "a 변경 목록" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([describeChange({ kind: "schema-key-removed", path: "/", key: "$schema" })]);
    // 경로는 <code> 안에 있고, 화면에 백틱 문자가 그대로 보이지 않는다.
    expect([...list.querySelectorAll("li > code")].map((code) => code.textContent)).toEqual(["/"]);
    expect(list.textContent).not.toContain("`");

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById(panelId)).toBeNull();
  });

  it("펼치면 원본 칸에 removed 줄, 압축 칸에 added 줄이 표시된다", async () => {
    stubFetch({ analyze: { status: 200, body: cleanedResponse() } });
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await waitTokensSettled();
    showDetail(rerender, "tokens");

    const toggle = await screen.findByRole("button", { name: "변경사항" });
    fireEvent.click(toggle);

    const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    const [beforePre, afterPre] = [...(panel?.querySelectorAll("pre") ?? [])];
    if (beforePre === undefined || afterPre === undefined) {
      throw new Error("비교 <pre> 가 둘이 아니다");
    }

    const removed = [...beforePre.querySelectorAll('[data-diff="removed"]')];
    expect(removed.map(lineText)).toEqual([
      '  "description": "A tool.  ",',
      '    "$schema": "http://json-schema.org/draft-07/schema#",',
    ]);
    expect(beforePre.querySelectorAll('[data-diff="added"]')).toHaveLength(0);
    const added = [...afterPre.querySelectorAll('[data-diff="added"]')];
    expect(added.map(lineText)).toEqual(['  "description": "A",']);
    expect(afterPre.querySelectorAll('[data-diff="removed"]')).toHaveLength(0);

    // 줄 앞 표시 글자는 한 칸이고 읽기 도구에는 숨긴다.
    const marks = (lines: readonly Element[]): readonly (string | null)[] =>
      lines.map((line) => line.querySelector('[aria-hidden="true"]')?.textContent ?? null);
    expect(marks(removed)).toEqual(["-", "-"]);
    expect(marks(added)).toEqual(["+"]);
    expect(marks([...afterPre.querySelectorAll('[data-diff="same"]')].slice(0, 1))).toEqual([" "]);
    // 색은 기존 상태 토큰이다.
    expect((removed[0] as HTMLElement).style.backgroundColor).toBe("var(--status-failed-bg)");
    expect((removed[0] as HTMLElement).style.color).toBe("var(--status-failed-fg)");
    expect((added[0] as HTMLElement).style.backgroundColor).toBe("var(--status-done-bg)");
    expect((added[0] as HTMLElement).style.color).toBe("var(--status-done-fg)");
    // 강조가 들어가도 줄을 이으면 원래 JSON 이다.
    expect(preText(beforePre)).toBe(formatToolSide({ ...SOURCE_A, description: "A tool.  " }));
  });

  it("변경사항 버튼은 접히면 on-accent, 펼치면 primary 다", async () => {
    stubFetch();
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await waitTokensSettled();
    showDetail(rerender, "tokens");

    const toggle = await screen.findByRole("button", { name: "변경사항" });
    expect(toggle.className).toContain("border-accent-border");
    expect(toggle.className.split(" ")).not.toContain("bg-accent");

    fireEvent.click(toggle);

    expect(toggle.className.split(" ")).toContain("bg-accent");
    expect(toggle.className).not.toContain("border-accent-border");

    fireEvent.click(toggle);

    expect(toggle.className).toContain("border-accent-border");
  });

  it("원본을 찾지 못하면 그 자리에 안내 문장을 보인다", async () => {
    stubFetch({ analyze: { status: 200, body: { ...analyzeResponse(), sourceTools: [] } } });
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await waitTokensSettled();
    showDetail(rerender, "tokens");

    fireEvent.click(await screen.findByRole("button", { name: "변경사항" }));

    expect(screen.getByText("원본 정의를 찾지 못했습니다.")).toBeTruthy();
    // 견줄 원본이 없으니 압축 칸은 강조 없이 그린다.
    const pres = document.querySelectorAll('td[id^="analyze-diff-"] pre');
    expect(pres).toHaveLength(1);
    const kinds = [...(pres[0]?.querySelectorAll("[data-diff]") ?? [])].map((line) =>
      line.getAttribute("data-diff"),
    );
    expect(kinds.length).toBeGreaterThan(0);
    expect(new Set(kinds)).toEqual(new Set(["same"]));
  });

  it("변경이 없는 도구는 변경 없음 버튼이 비활성이다", async () => {
    stubFetch();
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await waitTokensSettled();
    showDetail(rerender, "tokens");

    expect(await screen.findByRole("button", { name: "변경 없음" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("상세에 저장 경로와 오버레이 저장 버튼이 없다", async () => {
    const fetchMock = stubFetch();
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await waitTokensSettled();
    showDetail(rerender, "tokens");

    await screen.findByRole("table", { name: "도구별 감소" });
    expect(screen.queryByLabelText(/저장 경로/)).toBeNull();
    expect(screen.queryByRole("button", { name: "오버레이 저장" })).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "MCP 수정하기" })).toBeTruthy();
    expect(
      screen.getByText(
        "압축 변경을 서버 소스 파일에 직접 반영합니다. 적용 전에 바뀔 줄을 먼저 보여 줍니다.",
      ),
    ).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });

  it("MCP 수정하기를 누르면 argv 와 변경 목록을 POST 하고 미리보기를 보인다", async () => {
    const fetchMock = stubFetch({ analyze: { status: 200, body: cleanedResponse() } });
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await openPreview(rerender);

    expect(postedBodies(fetchMock, "/api/analyze/source-edits")).toEqual([
      { argv: WEATHER_ARGV, edits: CLEANED_EDITS },
    ]);
    const file = screen.getByText("srv/server.mjs", { selector: "code" });
    expect(file.parentElement?.textContent).toBe("파일: srv/server.mjs");
    expect(screen.getByText("적용 가능 1건 / 전체 2건")).toBeTruthy();

    const items = within(screen.getByRole("list", { name: "변경별 상태" })).getAllByRole(
      "listitem",
    );
    // 줄은 묶음마다 하나이고 ready 묶음이 먼저다.
    expect(items.map((item) => item.getAttribute("data-status"))).toEqual(["ready", "not-found"]);
    expect(items[0]?.textContent).toContain('설명을 정리했습니다: "A tool.  " → "A"');
    expect(items[0]?.textContent).toContain("1건 · a");
    expect(items[0]?.textContent).toContain("소스에서 1곳을 찾았습니다.");
    expect((items[0] as HTMLElement).style.color).toBe("var(--status-done-fg)");
    expect(items[1]?.querySelector("code")?.textContent).toBe("/");
    expect(items[1]?.textContent).toContain(
      "에서 '$schema' 키를 지웠습니다. 검증 의미는 같습니다.",
    );
    expect(items[1]?.textContent).toContain("1건 · a");
    expect(items[1]?.textContent).toContain(NOT_FOUND_DETAIL);
    expect(items[1]?.className).toContain("text-ink-muted");
    // 도구가 하나뿐인 묶음에는 펼침이 없다.
    expect(items[0]?.querySelector("details")).toBeNull();
    expect(items[1]?.querySelector("details")).toBeNull();

    const preview = screen.getByLabelText("파일 변경 미리보기");
    const pres = preview.querySelectorAll("pre");
    expect(pres).toHaveLength(1);
    const removed = [...preview.querySelectorAll('[data-diff="removed"]')];
    const added = [...preview.querySelectorAll('[data-diff="added"]')];
    expect(removed.map(lineText)).toEqual(['    description: "A tool.  ",']);
    expect(added.map(lineText)).toEqual(['    description: "A",']);
    // 줄 번호는 지운 줄이 원본 기준, 바뀐 줄이 고친 파일 기준이다.
    expect(removed[0]?.querySelector("[data-line-no]")?.textContent?.trim()).toBe("4");
    expect(added[0]?.querySelector("[data-line-no]")?.textContent?.trim()).toBe("4");
    // 앞뒤 문맥은 2줄씩이다.
    expect(preText(pres[0] as Element)).toBe(
      [
        "  {",
        '    name: "a",',
        '    description: "A tool.  ",',
        '    description: "A",',
        "  },",
        "];",
      ].join("\n"),
    );
    expect(screen.getByRole("button", { name: "적용" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: "취소" })).toBeTruthy();
  });

  it("적용을 누르면 baseMtimeMs 를 실어 보내고 결과 문장과 다시 분석 버튼을 보인다", async () => {
    const fetchMock = stubFetch({
      analyze: { status: 200, body: cleanedResponse() },
      sourceEdits: [
        { status: 200, body: previewResponse() },
        {
          status: 200,
          body: previewResponse({ applied: true, mtimeMs: 20, before: SOURCE_AFTER }),
        },
      ],
    });
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await openPreview(rerender);

    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe(
      "srv/server.mjs 에 1건을 적용했습니다. 다시 분석하면 줄어든 결과를 확인할 수 있습니다.",
    );
    expect(postedBodies(fetchMock, "/api/analyze/source-edits")).toEqual([
      { argv: WEATHER_ARGV, edits: CLEANED_EDITS },
      { argv: WEATHER_ARGV, edits: CLEANED_EDITS, apply: { baseMtimeMs: 10 } },
    ]);
    // 미리보기는 닫힌다.
    expect(screen.queryByRole("list", { name: "변경별 상태" })).toBeNull();
    expect(screen.queryByLabelText("파일 변경 미리보기")).toBeNull();
    expect(screen.queryByRole("button", { name: "적용" })).toBeNull();
    expect(screen.getByRole("button", { name: "다시 분석" })).toBeTruthy();
  });

  it("다시 분석을 누르면 같은 argv 로 POST /api/analyze/tokens 를 다시 보낸다", async () => {
    const fetchMock = stubFetch({
      analyze: [
        { status: 200, body: cleanedResponse() },
        { status: 200, body: analyzeResponse() },
      ],
      sourceEdits: [
        { status: 200, body: previewResponse() },
        { status: 200, body: previewResponse({ applied: true, mtimeMs: 20 }) },
      ],
    });
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await openPreview(rerender);
    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    fireEvent.click(await screen.findByRole("button", { name: "다시 분석" }));

    await waitFor(() => {
      expect(postedBodies(fetchMock, "/api/analyze/tokens")).toHaveLength(2);
    });
    const [first, second] = postedBodies(fetchMock, "/api/analyze/tokens");
    expect(first).toEqual({ argv: WEATHER_ARGV, serverId: WEATHER.id });
    expect(second).toEqual(first);
    // 새 결과가 오면 카드는 처음 상태로 돌아간다. 결과 단계를 떠나지 않는다.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "다시 분석" })).toBeNull();
    });
    expect(screen.getByRole("button", { name: "MCP 수정하기" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(within(costCard()).getByText("24.0% 줄일 수 있음")).toBeTruthy();
  });

  it("다시 분석이 실패하면 상세에 머물고 CLI 문장을 보인다", async () => {
    const error = "오류 [MCP_CONNECTION_FAILED]: x\n해결: y";
    stubFetch({
      analyze: [
        { status: 200, body: cleanedResponse() },
        { status: 400, body: { error } },
      ],
      sourceEdits: [
        { status: 200, body: previewResponse() },
        { status: 200, body: previewResponse({ applied: true, mtimeMs: 20 }) },
      ],
    });
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await openPreview(rerender);
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    fireEvent.click(await screen.findByRole("button", { name: "다시 분석" }));

    const alert = await screen.findByRole("alert");
    expect(alert.tagName).toBe("PRE");
    expect(alert.textContent).toBe(error);
    expect(within(costCard()).queryByText("실패")).toBeNull();
    // 이전 결과는 그대로다.
    expect(screen.getByRole("table", { name: "도구별 감소" })).toBeTruthy();
  });

  it("conflict 면 다시 계산했다는 문장을 보이고 미리보기를 바꾼다", async () => {
    const changedBefore = `// 새 주석\n${SOURCE_BEFORE}`;
    const changedAfter = `// 새 주석\n${SOURCE_AFTER}`;
    const fetchMock = stubFetch({
      analyze: { status: 200, body: cleanedResponse() },
      sourceEdits: [
        { status: 200, body: previewResponse() },
        {
          status: 200,
          body: previewResponse({
            conflict: true,
            mtimeMs: 30,
            before: changedBefore,
            after: changedAfter,
          }),
        },
        { status: 200, body: previewResponse({ applied: true, mtimeMs: 40 }) },
      ],
    });
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await openPreview(rerender);

    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "미리보기 뒤에 srv/server.mjs 이 바뀌었습니다. 바뀐 내용으로 다시 계산했으니 확인하고 적용하세요.",
    );
    // 미리보기가 응답의 것으로 바뀌었다. 줄 번호가 한 줄 밀린다.
    const removed = screen
      .getByLabelText("파일 변경 미리보기")
      .querySelector('[data-diff="removed"]');
    expect(removed?.querySelector("[data-line-no]")?.textContent?.trim()).toBe("5");
    expect(screen.queryByRole("status")).toBeNull();

    // 다시 적용하면 새 미리보기의 mtime 을 싣는다.
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    await screen.findByRole("status");
    expect(postedBodies(fetchMock, "/api/analyze/source-edits")[2]).toEqual({
      argv: WEATHER_ARGV,
      edits: CLEANED_EDITS,
      apply: { baseMtimeMs: 30 },
    });
  });

  /** 소스에서 하나도 못 고치는 미리보기. `results` 만 바꿔 쓴다. */
  function noReadyPreview(results: SourceEditResponse["results"]): StubResponse {
    return {
      status: 200,
      body: previewResponse({ after: SOURCE_BEFORE, results, readyCount: 0 }),
    };
  }

  const PROXY_GUIDE =
    "소스에서 고칠 수 있는 변경이 없습니다. 전부 SDK 나 라이브러리가 만드는 값으로 보입니다. 이런 값은 서버 소스가 아니라 프록시(mcpeak-optimize-proxy)로 줄입니다.";
  const REASON_GUIDE = "소스에서 고칠 수 있는 변경이 없습니다. 위 사유를 확인하세요.";

  it("ready 가 0 이면 적용 버튼이 없고 닫기로 미리보기를 닫는다", async () => {
    stubFetch({
      sourceEdits: [
        noReadyPreview([
          { tool: "a", change: SCHEMA_CHANGE, status: "not-found", detail: NOT_FOUND_DETAIL },
        ]),
      ],
    });
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await openPreview(rerender);

    expect(screen.getByText("적용 가능 0건 / 전체 1건")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "적용" })).toBeNull();
    expect(screen.queryByRole("button", { name: "취소" })).toBeNull();
    expect(screen.queryByLabelText("파일 변경 미리보기")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));

    expect(screen.queryByRole("list", { name: "변경별 상태" })).toBeNull();
    expect(screen.getByRole("button", { name: "MCP 수정하기" })).toHaveProperty("disabled", false);
  });

  it("같은 사유의 변경은 한 줄로 묶어 건수와 도구를 보인다", async () => {
    stubFetch({
      sourceEdits: [
        noReadyPreview(
          ["a", "b", "c"].map((tool) => ({
            tool,
            change: SCHEMA_CHANGE,
            status: "not-found" as const,
            detail: NOT_FOUND_DETAIL,
          })),
        ),
      ],
    });
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await openPreview(rerender);

    // 건수는 묶음 수가 아니라 변경 수다.
    expect(screen.getByText("적용 가능 0건 / 전체 3건")).toBeTruthy();
    const items = within(screen.getByRole("list", { name: "변경별 상태" })).getAllByRole(
      "listitem",
    );
    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item?.getAttribute("data-status")).toBe("not-found");
    expect(item?.querySelector("code")?.textContent).toBe("/");
    expect(item?.textContent).toContain("에서 '$schema' 키를 지웠습니다. 검증 의미는 같습니다.");
    expect(within(item as HTMLElement).getByText("3건 · a 외 2개").tagName).toBe("SPAN");
    expect(item?.textContent).toContain(NOT_FOUND_DETAIL);
    const details = item?.querySelector("details");
    expect(details?.querySelector("summary")?.textContent).toBe("도구 3개 보기");
    expect(within(details as HTMLElement).getByText("a, b, c")).toBeTruthy();
  });

  it("전부 not-found 면 프록시 안내를 보이고 적용 버튼이 없다", async () => {
    stubFetch({
      sourceEdits: [
        noReadyPreview([
          { tool: "a", change: SCHEMA_CHANGE, status: "not-found", detail: NOT_FOUND_DETAIL },
          { tool: "b", change: CLEANED_CHANGE, status: "not-found", detail: NOT_FOUND_DETAIL },
        ]),
      ],
    });
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await openPreview(rerender);

    expect(screen.getByText(PROXY_GUIDE).tagName).toBe("P");
    expect(screen.queryByText(REASON_GUIDE)).toBeNull();
    expect(screen.queryByRole("button", { name: "적용" })).toBeNull();
    expect(screen.getByRole("button", { name: "닫기" })).toBeTruthy();
  });

  it("not-found 가 아닌 사유가 섞이면 사유 확인 안내를 보인다", async () => {
    stubFetch({
      sourceEdits: [
        noReadyPreview([
          { tool: "a", change: SCHEMA_CHANGE, status: "not-found", detail: NOT_FOUND_DETAIL },
          {
            tool: "b",
            change: CLEANED_CHANGE,
            status: "ambiguous",
            detail: "같은 문자열을 서로 다르게 바꾸는 변경이 있어 건드리지 않습니다.",
          },
        ]),
      ],
    });
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await openPreview(rerender);

    expect(screen.getByText(REASON_GUIDE).tagName).toBe("P");
    expect(screen.queryByText(PROXY_GUIDE)).toBeNull();
    expect(screen.queryByRole("button", { name: "적용" })).toBeNull();
    expect(screen.getByRole("button", { name: "닫기" })).toBeTruthy();
  });

  it("취소를 누르면 미리보기가 닫힌다", async () => {
    stubFetch({ analyze: { status: 200, body: cleanedResponse() } });
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await openPreview(rerender);

    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(screen.queryByRole("list", { name: "변경별 상태" })).toBeNull();
    expect(screen.queryByLabelText("파일 변경 미리보기")).toBeNull();
    expect(screen.queryByRole("button", { name: "적용" })).toBeNull();
    expect(screen.getByRole("button", { name: "MCP 수정하기" })).toHaveProperty("disabled", false);
  });

  it("요청이 실패하면 error 문장을 그대로 보인다", async () => {
    const error =
      "실행 명령에서 프로젝트 안의 서버 소스 파일을 찾지 못했습니다.\n해결: 인자에 스크립트 경로가 있어야 합니다(예: node ./server.mjs).";
    stubFetch({ sourceEdits: [{ status: 400, body: { error } }] });
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await waitTokensSettled();
    showDetail(rerender, "tokens");

    fireEvent.click(await screen.findByRole("button", { name: "MCP 수정하기" }));

    const alert = await screen.findByRole("alert");
    expect(alert.tagName).toBe("P");
    expect(alert.textContent).toBe(error);
    expect(alert.className).toContain("whitespace-pre-line");
    expect(screen.queryByRole("list", { name: "변경별 상태" })).toBeNull();
    // 다시 시도할 수 있다.
    expect(screen.getByRole("button", { name: "MCP 수정하기" })).toHaveProperty("disabled", false);
  });

  it("적용 요청이 실패하면 error 문장을 보이고 미리보기는 남는다", async () => {
    stubFetch({
      analyze: { status: 200, body: cleanedResponse() },
      sourceEdits: [
        { status: 200, body: previewResponse() },
        { status: 400, body: { error: "적용할 수 있는 변경이 없습니다." } },
      ],
    });
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await openPreview(rerender);

    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("적용할 수 있는 변경이 없습니다.");
    expect(screen.getByRole("list", { name: "변경별 상태" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("변경이 없는 결과에서는 반영할 변경이 없습니다 를 보인다", async () => {
    const base = analyzeResponse();
    const fetchMock = stubFetch({
      analyze: {
        status: 200,
        body: {
          ...base,
          overlay: {
            ...base.overlay,
            tools: base.overlay.tools.map((tool) => ({ ...tool, changes: [] })),
          },
        },
      },
    });
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await waitTokensSettled();
    showDetail(rerender, "tokens");

    expect(await screen.findByText("반영할 변경이 없습니다.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "MCP 수정하기" })).toBeNull();
    expect(postedBodies(fetchMock, "/api/analyze/source-edits")).toEqual([]);
  });
});

describe("AnalyzeView 개요", () => {
  beforeEach(() => {
    window.localStorage.clear();
    installFakeEventSource();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("처음에는 대상 폼이 펼쳐져 있고 세 카드가 idle 이다", async () => {
    stubFetch();
    render(<AnalyzeView pillar={null} />);
    await screen.findByRole("radio", { name: /^weather/ });

    const tabs = within(screen.getByRole("tablist", { name: "분석 축" })).getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    // 보안 옵션도 펼쳐져 있다.
    expect(screen.getByText("호출 정책")).toBeTruthy();
    expect(screen.getAllByText("아직 분석하지 않았습니다")).toHaveLength(2);
    expect(screen.getByText("아직 연결되지 않았습니다")).toBeTruthy();
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });

  it("성능 카드는 비활성이고 눌러도 해시가 바뀌지 않는다", async () => {
    stubFetch();
    window.location.hash = "#/analyze";
    render(<AnalyzeView pillar={null} />);

    const card = await screen.findByRole("tab", { name: /^성능 효율성/ });
    expect(card.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(card);
    // jsdom 의 fragment 이동은 비동기다.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(window.location.hash).toBe("#/analyze");
  });

  it("첫 후보가 초기 선택이고 한 번에 분석이 두 요청을 같은 틱에 보낸다", async () => {
    const fetchMock = stubFetch({ analyze: PENDING, start: PENDING });
    render(<AnalyzeView pillar={null} />);
    await runAll();

    const posts = fetchMock.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([url]) => String(url));
    // 순서까지(설계 §1.3).
    expect(posts).toEqual(["/api/analyze/tokens", "/api/analyze/security"]);
    expect(postedBodies(fetchMock, "/api/analyze/tokens")[0]).toEqual({
      argv: WEATHER_ARGV,
      serverId: WEATHER.id,
    });
    expect(postedBodies(fetchMock, "/api/analyze/security")[0]).toEqual({
      argv: WEATHER_ARGV,
      serverId: WEATHER.id,
    });
  });

  it("기준 파일이 .json 이 아니면 버튼이 비활성이고 그 사유를 보인다", async () => {
    stubFetch();
    render(<AnalyzeView pillar={null} />);
    await screen.findByRole("radio", { name: /^weather/ });

    fireEvent.change(screen.getByLabelText("기준 파일 (프로젝트 루트 기준, 선택)"), {
      target: { value: "b.txt" },
    });

    expect(screen.getByRole("button", { name: "한 번에 분석" })).toHaveProperty("disabled", true);
    expect(screen.getByText("기준 파일 경로는 .json 으로 끝나야 합니다.")).toBeTruthy();
  });

  it("토큰 응답이 오면 비용 카드가 요약을 보이고 보안 카드는 점검 중이다", async () => {
    stubFetch();
    render(<AnalyzeView pillar={null} />);
    await runAll();

    await within(costCard()).findByText("24.0% 줄일 수 있음");
    expect(within(costCard()).getByText("−24.0%")).toBeTruthy();
    expect(within(costCard()).getByText(/^분석한 대상: weather · /)).toBeTruthy();
    // 두 POST 의 resolve 순서는 정해지지 않는다.
    await within(securityCard()).findByText("점검 중…");
    expect(within(securityCard()).getByText("진행은 상세에서 봅니다")).toBeTruthy();
  });

  it("토큰이 실패해도 보안은 점검 중이고 비용 카드는 실패와 첫 줄을 보인다", async () => {
    stubFetch({ analyze: { status: 400, body: { error: "첫 줄\n둘째 줄" } } });
    render(<AnalyzeView pillar={null} />);
    await runAll();

    await within(costCard()).findByText("실패");
    expect(within(costCard()).getByText("첫 줄")).toBeTruthy();
    expect(within(costCard()).queryByText(/둘째 줄/)).toBeNull();
    expect(within(costCard()).getByText("전문은 상세에서 봅니다")).toBeTruthy();
    await within(securityCard()).findByText("점검 중…");
  });

  it("하나라도 시작되면 대상 영역이 접히고 대상 바꾸기가 펼친다", async () => {
    stubFetch();
    render(<AnalyzeView pillar={null} />);
    await runAll();

    await within(costCard()).findByText("24.0% 줄일 수 있음");
    expect(screen.queryByRole("radio", { name: /^weather/ })).toBeNull();
    // 서버 칸
    expect(screen.getByText("weather")).toBeTruthy();
    expect(screen.getByText(/probe auto · 기준 파일 없음/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "대상 바꾸기" }));

    expect(await screen.findByRole("radio", { name: /^weather/ })).toHaveProperty("checked", true);
    // 결과는 그대로다.
    expect(within(costCard()).getByText("24.0% 줄일 수 있음")).toBeTruthy();
  });

  it("보안이 먼저 시작되면 토큰 응답 전에도 대상 영역이 접힌다", async () => {
    stubFetch({ analyze: PENDING });
    render(<AnalyzeView pillar={null} />);
    await runAll();

    await waitFor(() => expect(screen.queryByRole("radio", { name: /^weather/ })).toBeNull());
    expect(within(costCard()).getByText("분석 중…")).toBeTruthy();
  });

  it("하나라도 시작되면 최근 명령을 한 번 저장한다", async () => {
    stubFetch({ servers: [] });
    render(<AnalyzeView pillar={null} />);
    fireEvent.change(await screen.findByLabelText("서버 스크립트"), {
      target: { value: "server.js" },
    });
    fireEvent.click(screen.getByRole("button", { name: "한 번에 분석" }));

    await waitTokensSettled();
    await finishSecurityRun();
    // rememberCommand 는 state.target(스크립트)만 저장한다(use-analyze-target.ts 142행).
    expect(readRecentCommands()).toEqual(["server.js"]);
  });

  it("둘 다 시작에 실패하면 대상 영역은 펼친 채고 두 카드가 실패다", async () => {
    stubFetch({
      servers: [],
      analyze: { status: 400, body: { error: "토큰 실패" } },
      start: { status: 400, body: { error: "보안 실패\n둘째" } },
    });
    render(<AnalyzeView pillar={null} />);
    fireEvent.change(await screen.findByLabelText("서버 스크립트"), {
      target: { value: "server.js" },
    });
    fireEvent.click(screen.getByRole("button", { name: "한 번에 분석" }));

    await within(costCard()).findByText("실패");
    await within(securityCard()).findByText("실패");
    expect(within(securityCard()).getByText("보안 실패")).toBeTruthy();
    // 펼친 채다.
    expect(screen.getByLabelText("서버 스크립트")).toHaveProperty("value", "server.js");
    expect(readRecentCommands()).toEqual([]);
  });

  it("분석이 도는 동안 한 번에 분석은 비활성이고 사유가 분석이 돌고 있습니다 다", async () => {
    stubFetch({ analyze: PENDING });
    render(<AnalyzeView pillar={null} />);
    await runAll();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "분석 중…" })).toHaveProperty("disabled", true),
    );
    expect(screen.getByText("분석이 돌고 있습니다")).toBeTruthy();
  });

  it("카드를 누르면 해시가 바뀐다", async () => {
    stubFetch();
    window.location.hash = "#/analyze";
    render(<AnalyzeView pillar={null} />);
    await screen.findByRole("radio", { name: /^weather/ });

    fireEvent.click(costCard());

    // jsdom 의 fragment 이동은 비동기다.
    await waitFor(() => expect(window.location.hash).toBe("#/analyze/tokens"));
    // 다음 테스트에 남기지 않는다.
    window.location.hash = "#/analyze";
  });

  it("pillar 가 tokens 면 비용 상세가 펼쳐지고 카드는 선택 상태다", async () => {
    stubFetch();
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await screen.findByRole("radio", { name: /^weather/ });

    showDetail(rerender, "tokens");

    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByRole("heading", { name: "비용 최적화 상세" })).toBeTruthy();
    expect(
      within(panel).getByText(
        "아직 분석하지 않았습니다. 위에서 서버를 고르고 한 번에 분석을 누르세요.",
      ),
    ).toBeTruthy();
    expect(costCard().getAttribute("aria-selected")).toBe("true");
    expect(panel.getAttribute("id")).toBe("panel-tokens");
  });

  it("같은 응답을 다시 받아도 카드 글자가 같다", async () => {
    // "다시 분석" 버튼은 SourceEditCard 가 적용(applied)을 마친 뒤에만 보인다(SourceEditCard.tsx 194행).
    // 그래서 진입은 기존 "다시 분석을 누르면 같은 argv 로 …" 테스트와 같다(openPreview → 적용).
    stubFetch({
      analyze: [
        { status: 200, body: cleanedResponse() },
        { status: 200, body: cleanedResponse() },
      ],
      sourceEdits: [
        { status: 200, body: previewResponse() },
        { status: 200, body: previewResponse({ applied: true, mtimeMs: 20 }) },
      ],
    });
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await waitTokensSettled();
    const before = costCard().textContent;

    await openPreview(rerender);
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    fireEvent.click(await screen.findByRole("button", { name: "다시 분석" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "다시 분석" })).toBeNull());

    expect(costCard().textContent).toBe(before);
  });
});
