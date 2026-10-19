// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyzeSecurityResponse } from "../../src/api-types.js";
import { firstLine } from "../src/analyze/pillar-state.js";
import { SEVERITY_TONE } from "../src/analyze/security-view.js";
import { AnalyzeView } from "../src/screens/AnalyzeView.js";
import {
  DOCKER_MISSING_LINE,
  FakeEventSource,
  FINDINGS,
  findingOf,
  finishSecurityRun,
  installFakeEventSource,
  LIMITS,
  lastSource,
  lineOf,
  postedBodies,
  RAN,
  RAN_LINE,
  RENDERED,
  resultRequests,
  runAll,
  SKIP_REASON,
  type StubResponse,
  sectionOf,
  securityCard,
  securityResponse,
  showDetail,
  stubFetch,
  WEATHER,
  WEATHER_ARGV,
} from "./analyze-fixtures.js";

/** 없는 run 의 summary 응답과 그때 화면이 보이는 문장. 옛 "없는 run 이면 …" 테스트가 인라인으로 쓰던 값 그대로다. */
const MISSING_SUMMARY_STUB: StubResponse = { status: 404, body: { error: "그런 run이 없습니다." } };
const MISSING_MESSAGE =
  "그런 run이 없습니다.\n" +
  "→ 대시보드는 실행 이력을 메모리에만 둡니다. 서버를 다시 시작했다면 이전 run 은 남아 있지 않습니다.\n" +
  "→ Runs 목록에서 살아 있는 run 을 고르거나, 새 실행을 시작하세요.";

/** 한 번에 분석을 누르고 보안 run 을 끝까지 돌려 보안 상세를 연다. */
async function runToResult(
  response: AnalyzeSecurityResponse = securityResponse(),
): Promise<ReturnType<typeof vi.fn>> {
  const fetchMock = stubFetch({ result: { status: 200, body: response } });
  const { rerender } = render(<AnalyzeView pillar={null} />);
  await runAll();
  await finishSecurityRun(response.exitCode);
  showDetail(rerender, "security");
  return fetchMock;
}

describe("AnalyzeView 보안 상세", () => {
  beforeEach(() => {
    window.localStorage.clear();
    installFakeEventSource();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("점검 옵션을 요청 본문의 필드로 싣는다", async () => {
    const fetchMock = stubFetch();
    render(<AnalyzeView pillar={null} />);
    await screen.findByRole("radio", { name: /^weather/ });

    fireEvent.click(screen.getByRole("button", { name: "호출 안 함" }));
    fireEvent.change(screen.getByLabelText("기준 파일 (프로젝트 루트 기준, 선택)"), {
      target: { value: "b.json" },
    });
    fireEvent.click(screen.getByLabelText("기준 파일을 지금 표면으로 갱신"));
    fireEvent.click(screen.getByLabelText("Docker 격리 안에서 실행 (행위 관측)"));
    fireEvent.click(screen.getByLabelText("이 머신에서 받은 도구 표면과 비교 (--compare-host)"));
    await runAll();

    expect(postedBodies(fetchMock, "/api/analyze/security")).toEqual([
      {
        argv: WEATHER_ARGV,
        serverId: WEATHER.id,
        probe: "none",
        baselinePath: "b.json",
        updateBaseline: true,
        sandbox: { compareHost: true, allowHosts: [] },
      },
    ]);
  });

  it("기준 파일 경로가 비면 갱신 체크박스가 비활성이다", async () => {
    stubFetch();
    render(<AnalyzeView pillar={null} />);
    await screen.findByRole("radio", { name: /^weather/ });

    const update = screen.getByLabelText("기준 파일을 지금 표면으로 갱신");
    expect(update).toHaveProperty("disabled", true);

    const path = screen.getByLabelText("기준 파일 (프로젝트 루트 기준, 선택)");
    expect(path.getAttribute("placeholder")).toBe(".mcpeak/audit-baseline.json");
    fireEvent.change(path, { target: { value: "b.json" } });
    expect(update).toHaveProperty("disabled", false);

    // .json 이 아닌 경로는 버튼을 막고 사유를 보인다.
    fireEvent.change(path, { target: { value: "b.txt" } });
    expect(screen.getByRole("button", { name: "한 번에 분석" })).toHaveProperty("disabled", true);
    expect(screen.getByText("기준 파일 경로는 .json 으로 끝나야 합니다.")).toBeTruthy();
  });

  it("http 대상이면 격리 체크박스가 비활성이고 이유를 보인다", async () => {
    stubFetch();
    render(<AnalyzeView pillar={null} />);
    await screen.findByRole("radio", { name: /^weather/ });
    const sandbox = screen.getByLabelText("Docker 격리 안에서 실행 (행위 관측)");
    expect(sandbox).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("button", { name: "HTTP URL" }));

    expect(sandbox).toHaveProperty("disabled", true);
    expect(
      screen.getByText(
        "원격 서버는 격리할 수 없습니다. 격리는 프로세스를 띄우는 대상에만 적용됩니다.",
      ),
    ).toBeTruthy();
  });

  it("격리를 켜면 실행할 수 있는 명령을 말한다", async () => {
    stubFetch();
    render(<AnalyzeView pillar={null} />);
    await screen.findByRole("radio", { name: /^weather/ });
    expect(screen.queryByText(/격리 이미지는 node, npx, npm 으로/)).toBeNull();

    fireEvent.click(screen.getByLabelText("Docker 격리 안에서 실행 (행위 관측)"));

    expect(
      screen.getByText("격리 이미지는 node, npx, npm 으로 띄우는 서버만 실행합니다."),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "서버를 이 머신에서 한 번 더 띄워 tools/list 만 받습니다. 도구는 호출하지 않습니다.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("--allow-host")).toBeTruthy();
  });

  it("허용 호스트 입력은 자기 문장을 쓴다", async () => {
    stubFetch({ servers: [] });
    render(<AnalyzeView pillar={null} />);
    // 직접 입력 갈래라 접속 폼에 "서버 인자" 입력이 하나 있다.
    await screen.findByLabelText("서버 스크립트");
    expect(screen.getAllByLabelText("서버 인자")).toHaveLength(1);
    expect(screen.queryByLabelText("허용 호스트")).toBeNull();

    fireEvent.click(screen.getByLabelText("Docker 격리 안에서 실행 (행위 관측)"));

    const input = screen.getByLabelText("허용 호스트");
    expect(input.getAttribute("placeholder")).toBe("호스트 이름 하나씩 추가 (예: api.example.com)");
    expect(screen.getAllByText("허용 호스트")).toHaveLength(1);
    expect(screen.getAllByLabelText("서버 인자")).toHaveLength(1);

    fireEvent.change(input, { target: { value: "a.example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByRole("button", { name: "허용 호스트 a.example.com 제거" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "인자 a.example.com 제거" })).toBeNull();
  });

  it("run 조회만 실패하면 문장을 보이고 진행을 유지한다", async () => {
    stubFetch({ summary: { status: 500, body: { error: "서버 오류" } } });
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    showDetail(rerender, "security");

    expect((await screen.findByRole("alert")).textContent).toContain("서버 오류");
    expect(screen.getByText("진행")).toBeTruthy();
    expect(within(securityCard()).getByText("점검 중…")).toBeTruthy();
  });

  it("진행 문장을 로그 패널에 보인다", async () => {
    stubFetch();
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    showDetail(rerender, "security");
    const source = lastSource();

    act(() => {
      source.emit({ kind: "stderr", html: "격리 컨테이너를 준비합니다." });
    });

    expect(screen.getByText("격리 컨테이너를 준비합니다.")).toBeTruthy();
    expect(screen.getByText("진행")).toBeTruthy();
    expect(
      screen.getByText(
        "격리 실행은 이미지를 처음 만들 때 몇 분이 걸립니다. 도는 동안 대시보드를 끄면 격리 자원이 남습니다(치우는 법: packages/audit/README.md).",
      ),
    ).toBeTruthy();
    // 진행 문장만으로는 결과를 읽지 않는다.
    expect(within(securityCard()).getByText("점검 중…")).toBeTruthy();
  });

  it("판정 줄의 글자는 CLI 판정 줄과 같다", async () => {
    await runToResult();

    const verdict = screen.getByText(/^판정: /);
    expect(verdict.textContent).toBe("판정: 심각 1건, 주의 1건, 낮음 0건, 정보 0건");
    // 집계마다 칩 하나다. 0건인 칩은 정보 톤으로 흐리다.
    const chips = [...verdict.querySelectorAll<HTMLElement>("[data-severity]")];
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "심각 1건",
      "주의 1건",
      "낮음 0건",
      "정보 0건",
    ]);
    expect(chips.map((chip) => chip.style.color)).toEqual([
      SEVERITY_TONE.high.fg,
      SEVERITY_TONE.medium.fg,
      SEVERITY_TONE.info.fg,
      SEVERITY_TONE.info.fg,
    ]);
  });

  it("발견은 심각도 배지·규칙·위치·메시지·해결을 보인다", async () => {
    await runToResult();

    const item = findingOf("desc/hidden-unicode");
    const badge = within(item).getByText("심각");
    expect(badge.style.color).toBe(SEVERITY_TONE.high.fg);
    expect(badge.style.background).toBe(SEVERITY_TONE.high.bg);
    expect(within(item).getByText("도구 'get<U+200B>time' 의 name")).toBeTruthy();
    expect(within(item).getByText("→ 보이지 않는 문자가 들어 있습니다.")).toBeTruthy();
    expect(lineOf(item, "해결: 보이지 않는 문자를 지우세요.")).toBeTruthy();
    // 왼쪽 띠가 심각도 색이다.
    expect(item.style.borderLeftColor).toBe(SEVERITY_TONE.high.fg);

    const medium = findingOf("protocol/plaintext");
    expect(within(medium).getByText("주의").style.color).toBe(SEVERITY_TONE.medium.fg);
    expect(within(medium).getByText("프로토콜")).toBeTruthy();
    expect(medium.style.borderLeftColor).toBe(SEVERITY_TONE.medium.fg);

    // 기본은 심각도별 구획이다.
    expect(
      screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent),
    ).toEqual([
      "심각 1건",
      "주의 1건",
      "권한 조합 경고 (결함이 아닙니다)",
      "검사하지 않은 것",
      "이 점검의 한계",
    ]);
    // 심각도별 보기의 구획 제목은 그 심각도의 색이다.
    expect(screen.getByRole("heading", { level: 3, name: "심각 1건" }).style.color).toBe(
      SEVERITY_TONE.high.fg,
    );
  });

  it("근거는 조각마다 따로 보인다", async () => {
    await runToResult();

    const item = findingOf("desc/hidden-unicode");
    expect(within(item).getByText("근거")).toBeTruthy();
    expect([...item.querySelectorAll("code")].map((piece) => piece.textContent)).toEqual([
      "U+200B",
      "raw",
    ]);

    // 근거가 없는 발견에는 그 줄이 없다.
    const plain = findingOf("protocol/plaintext");
    expect(within(plain).queryByText("근거")).toBeNull();
    expect(plain.querySelector("code")).toBeNull();
  });

  it("도구별로 바꾸면 도구 제목 구획으로 묶인다", async () => {
    await runToResult();

    fireEvent.click(screen.getByRole("button", { name: "도구별" }));

    expect(
      screen
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent)
        .slice(0, 2),
    ).toEqual(["서버 전체 (실행 명령·프로토콜·도구 표면) · 1건", "도구 'get<U+200B>time' · 1건"]);
    expect(
      within(sectionOf("도구 'get<U+200B>time' · 1건")).getByText("desc/hidden-unicode"),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 3, name: "심각 1건" })).toBeNull();
  });

  it("flow 발견은 '권한 조합 경고 (결함이 아닙니다)' 구획에만 있다", async () => {
    await runToResult();

    const section = sectionOf("권한 조합 경고 (결함이 아닙니다)");
    expect(within(section).getByText("→ 읽기와 보내기 도구가 함께 있습니다.")).toBeTruthy();
    expect(lineOf(section, "해결: 권한을 나누세요.")).toBeTruthy();
    // 화면 전체에 한 번뿐이다. 결함 목록에는 없다.
    expect(screen.getAllByText("→ 읽기와 보내기 도구가 함께 있습니다.")).toHaveLength(1);
    expect(screen.queryByText("flow/toxic-combination")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "도구별" }));
    expect(screen.getAllByText("→ 읽기와 보내기 도구가 함께 있습니다.")).toHaveLength(1);
  });

  it("결함이 없으면 그렇다고 말하고 묶음 전환을 내지 않는다", async () => {
    await runToResult(securityResponse({ findings: [], views: [] }));

    expect(screen.getByText("결함 발견이 없습니다.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "도구별" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "권한 조합 경고 (결함이 아닙니다)" })).toBeNull();
  });

  it("격리를 쓰지 못했으면 그 문장을 alert 로 보인다", async () => {
    await runToResult(
      securityResponse({
        sandbox: { status: "unavailable", reason: { code: "docker-missing", detail: "" } },
        sandboxLine: DOCKER_MISSING_LINE,
      }),
    );

    expect(screen.getByRole("alert").textContent).toBe(DOCKER_MISSING_LINE);
    expect(screen.queryByRole("heading", { name: "격리 안에서 관측한 것" })).toBeNull();
  });

  it("격리가 돌았으면 그 줄을 status 로 보이고 요청 표를 그린다", async () => {
    await runToResult(securityResponse({ sandbox: RAN, sandboxLine: RAN_LINE }));

    expect(screen.getByRole("status").textContent).toBe(RAN_LINE);
    expect(screen.queryByRole("alert")).toBeNull();

    const section = sectionOf("격리 안에서 관측한 것");
    expect(within(section).getByText("호출 3회 · 선언된 목적지 1곳")).toBeTruthy();
    const table = screen.getByRole("table", { name: "격리 안에서 나간 요청" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["호스트", "포트", "메서드", "경로", "횟수", "선언"]);
    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent),
      );
    expect(rows).toEqual([
      ["api.example.com", "443", "GET", "/v1", "2", "선언됨"],
      ["evil.example.net", "80", "POST", "/x", "1", "선언 없음"],
    ]);
    // 선언 없는 목적지가 눈에 띈다.
    expect(within(table).getByText("선언 없음").style.color).toBe("var(--status-failed-fg)");
    expect(within(table).getByText("선언됨").style.color).toBe("");
  });

  it("cleanupError 가 있으면 alert 로 보인다", async () => {
    const cleanupError = "오류 [SANDBOX_CLEANUP]: 컨테이너를 지우지 못했습니다.\n해결: docker rm";
    await runToResult(securityResponse({ exitCode: 1, cleanupError }));

    expect(screen.getByRole("alert").textContent).toBe(cleanupError);
  });

  it("기준 파일을 보냈으면 그 상태를 한 줄로 보인다", async () => {
    stubFetch();
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await screen.findByRole("radio", { name: /^weather/ });
    fireEvent.change(screen.getByLabelText("기준 파일 (프로젝트 루트 기준, 선택)"), {
      target: { value: "b.json" },
    });
    await runAll();
    await finishSecurityRun();
    showDetail(rerender, "security");

    expect(await screen.findByText("기준 파일과 같습니다: b.json")).toBeTruthy();
  });

  it("limits 와 CLI 리포트 원문을 보인다", async () => {
    await runToResult();

    const limits = sectionOf("이 점검의 한계");
    expect(
      within(limits)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(LIMITS);
    expect(
      within(sectionOf("검사하지 않은 것"))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([`surface: ${SKIP_REASON}`]);

    const details = screen.getByText("CLI 리포트 원문").closest("details");
    expect(details?.querySelector("pre")?.textContent).toBe(RENDERED);
  });

  it("서버가 보낸 글자를 HTML 로 해석하지 않는다", async () => {
    const [first, ...rest] = FINDINGS;
    if (first === undefined) {
      throw new Error("FINDINGS 가 비어 있다");
    }
    await runToResult(
      securityResponse({
        findings: [{ ...first, message: "<img src=x>", fix: "<b>fix</b>" }, ...rest],
        limits: ["<script>limit</script>"],
        rendered: "<img src=y>\n",
      }),
    );

    expect(screen.getByText("→ <img src=x>")).toBeTruthy();
    expect(lineOf(document.body, "해결: <b>fix</b>")).toBeTruthy();
    expect(screen.getByText("<script>limit</script>")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
  });

  it("처음에는 대상 폼과 보안 옵션이 펼쳐져 있다", async () => {
    stubFetch();
    render(<AnalyzeView pillar={null} />);

    expect(await screen.findByRole("radio", { name: /^weather/ })).toHaveProperty("checked", true);
    expect(screen.getByRole("button", { name: "한 번에 분석" })).toBeTruthy();
    expect(screen.getByText("호출 정책")).toBeTruthy();
    expect(screen.getByRole("button", { name: "자동" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Docker 격리 안에서 실행 (행위 관측)")).toBeTruthy();
    // 준비 중 안내는 없어졌다.
    expect(screen.queryByText("보안 탭은 준비 중입니다.")).toBeNull();
  });

  it("상세를 바꿔도 입력한 서버가 남는다", async () => {
    stubFetch({ servers: [] });
    const { rerender } = render(<AnalyzeView pillar="tokens" />);
    fireEvent.change(await screen.findByLabelText("서버 스크립트"), {
      target: { value: "server.js" },
    });

    showDetail(rerender, "security");

    expect(screen.getByLabelText("서버 스크립트")).toHaveProperty("value", "server.js");
    expect(screen.getByRole("button", { name: "한 번에 분석" })).toHaveProperty("disabled", false);

    // 돌아가도 남아 있다.
    showDetail(rerender, "tokens");
    expect(screen.getByLabelText("서버 스크립트")).toHaveProperty("value", "server.js");
  });

  it("한 번에 분석이 보안 본문을 POST 하고 이벤트 스트림을 연다", async () => {
    const fetchMock = stubFetch();
    render(<AnalyzeView pillar={null} />);

    await runAll();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    expect(postedBodies(fetchMock, "/api/analyze/security")).toEqual([
      { argv: WEATHER_ARGV, serverId: WEATHER.id },
    ]);
    expect(lastSource().url).toBe("/api/runs/r1/events");
  });

  it("점검 중에 대상 바꾸기를 누르면 폼이 펼쳐지고 고른 값이 남으며 점검은 계속된다", async () => {
    const fetchMock = stubFetch();
    render(<AnalyzeView pillar={null} />);
    await screen.findByRole("radio", { name: /^weather/ });
    fireEvent.click(screen.getByRole("button", { name: "전부" }));
    await runAll();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = lastSource();
    await waitFor(() => expect(screen.queryByRole("radio", { name: /^weather/ })).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "대상 바꾸기" }));

    expect(screen.getByRole("button", { name: "전부" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("radio", { name: /^weather/ })).toHaveProperty("checked", true);
    expect(within(securityCard()).getByText("점검 중…")).toBeTruthy();
    expect(source.closed).toBe(false);
    act(() => {
      source.emit({ kind: "done", exitCode: 2 });
    });
    // 떠나지 않았으므로 결과를 읽는다.
    await waitFor(() => expect(resultRequests(fetchMock)).toHaveLength(1));
  });

  it("run 이 없다고 확인되면 카드가 실패이고 대상 영역은 접힌 채다", async () => {
    stubFetch({ summary: MISSING_SUMMARY_STUB });
    render(<AnalyzeView pillar={null} />);
    await runAll();

    await within(securityCard()).findByText("실패");
    expect(within(securityCard()).getByText(firstLine(MISSING_MESSAGE))).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /^weather/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "대상 바꾸기" }));

    expect(screen.getByRole("button", { name: "한 번에 분석" })).toHaveProperty("disabled", false);
  });

  it("done 뒤 결과를 읽으면 카드가 요약을 보이고 상세에 결과가 있다", async () => {
    const fetchMock = stubFetch();
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();

    const source = await finishSecurityRun();

    expect(resultRequests(fetchMock)).toEqual(["/api/analyze/security/r1"]);
    expect(within(securityCard()).getByText("조치 필요")).toBeTruthy();
    expect(within(securityCard()).getByText("건 발견 · 도구 2개 점검")).toBeTruthy();
    showDetail(rerender, "security");
    expect(screen.getByText(/^판정: /)).toBeTruthy();
    expect(source.closed).toBe(true);
    expect(screen.getByText(/^판정: /).textContent).toBe(
      "판정: 심각 1건, 주의 1건, 낮음 0건, 정보 0건",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("sample 1.0.0")).toBeTruthy();
    expect(screen.getByText("2개")).toBeTruthy();
    expect(screen.getByText("readonly (호출한 도구 1개)")).toBeTruthy();
  });

  it("GET 결과가 실패하면 보안 카드가 실패이고 상세에 문장 전문이 있다", async () => {
    stubFetch({ result: { status: 400, body: { error: "리포트 없음\n둘째" } } });
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();

    await finishSecurityRun();

    expect(within(securityCard()).getByText("실패")).toBeTruthy();
    expect(within(securityCard()).getByText("리포트 없음")).toBeTruthy();
    expect(within(securityCard()).queryByText(/둘째/)).toBeNull();
    showDetail(rerender, "security");
    expect(screen.getByRole("alert").textContent).toBe("리포트 없음\n둘째");
  });

  it("상세를 닫은 채 run 이 끝나도 보안 카드가 요약을 보인다", async () => {
    stubFetch();
    render(<AnalyzeView pillar={null} />);
    await runAll();
    expect(screen.queryByRole("tabpanel")).toBeNull();

    await finishSecurityRun();

    expect(within(securityCard()).getByText("조치 필요")).toBeTruthy();
    // counts 1+1
    expect(within(securityCard()).getByText("2")).toBeTruthy();
    expect(within(securityCard()).getByText("건 발견 · 도구 2개 점검")).toBeTruthy();
    expect(within(securityCard()).getByText(/흐름 경고/).textContent).toBe("흐름 경고 1");
    expect(within(securityCard()).getByText(/도구 1개 호출 \(probe readonly\)/)).toBeTruthy();
  });

  it("첫 시작 요청이 실패하면 보안 카드가 실패이고 첫 줄을 보인다", async () => {
    stubFetch({ start: { status: 400, body: { error: "시작 실패\n해결: x" } } });
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();

    await within(securityCard()).findByText("실패");
    expect(within(securityCard()).getByText("시작 실패")).toBeTruthy();
    expect(within(securityCard()).getByText("전문은 상세에서 봅니다")).toBeTruthy();
    expect(FakeEventSource.instances).toHaveLength(0);
    showDetail(rerender, "security");
    expect(screen.getByRole("alert").textContent).toBe("시작 실패\n해결: x");
  });

  it("다시 점검은 sent 요청을 그대로 다시 POST 하고 앞 결과를 내린다", async () => {
    const fetchMock = stubFetch({
      start: [
        { status: 200, body: { runId: "r1" } },
        { status: 200, body: { runId: "r2" } },
      ],
    });
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await finishSecurityRun();
    showDetail(rerender, "security");

    fireEvent.click(screen.getByRole("button", { name: "다시 점검" }));

    // POST 가 resolve 된 뒤에 열린다.
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    expect(lastSource().url).toBe("/api/runs/r2/events");
    const [first, second] = postedBodies(fetchMock, "/api/analyze/security");
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(within(securityCard()).getByText("점검 중…")).toBeTruthy();
    // 앞 결과가 내려갔다.
    expect(screen.queryByText(/^판정: /)).toBeNull();
  });

  it("다시 점검의 시작 요청이 실패하면 앞 결과가 남고 startError 만 보인다", async () => {
    stubFetch({
      start: [
        { status: 200, body: { runId: "r1" } },
        { status: 400, body: { error: "시작 실패" } },
      ],
    });
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await runAll();
    await finishSecurityRun();
    showDetail(rerender, "security");

    fireEvent.click(screen.getByRole("button", { name: "다시 점검" }));

    expect((await screen.findByRole("alert")).textContent).toBe("시작 실패");
    expect(within(securityCard()).getByText("조치 필요")).toBeTruthy();
    expect(screen.getByText(/^판정: /)).toBeTruthy();
  });

  it("결과 뒤 대상 바꾸기를 누르면 폼이 펼쳐지고 보안 옵션과 결과가 남는다", async () => {
    stubFetch();
    const { rerender } = render(<AnalyzeView pillar={null} />);
    await screen.findByRole("radio", { name: /^weather/ });
    fireEvent.click(screen.getByRole("button", { name: "전부" }));
    await runAll();
    await finishSecurityRun();
    showDetail(rerender, "security");

    fireEvent.click(screen.getByRole("button", { name: "대상 바꾸기" }));

    expect(screen.getByRole("button", { name: "전부" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(securityCard()).getByText("조치 필요")).toBeTruthy();
    expect(screen.getByRole("tabpanel")).toBeTruthy();
  });
});
