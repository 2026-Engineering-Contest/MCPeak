// @vitest-environment jsdom
import type { AuditReport, Finding, SandboxReport } from "@mcpeak/audit";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnalyzeSecurityResponse,
  RunEventInput,
  SecurityFindingView,
  ServerCandidate,
  ServerMeta,
} from "../../src/api-types.js";
import { SEVERITY_TONE } from "../src/analyze/security-view.js";
import { AnalyzeView } from "../src/screens/AnalyzeView.js";

/** run-view.test 와 같은 방식의 EventSource fake. 네트워크·서버 없음. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  #nextId = 1;

  emit(event: RunEventInput): void {
    const withId = { id: this.#nextId++, ...event };
    this.onmessage?.({ data: JSON.stringify(withId) } as MessageEvent<string>);
  }

  close(): void {
    this.closed = true;
  }
}

function lastSource(): FakeEventSource {
  const source = FakeEventSource.instances.at(-1);
  if (source === undefined) {
    throw new Error("EventSource가 만들어지지 않았습니다.");
  }
  return source;
}

const META: ServerMeta = { root: "/tmp/proj" };
/** home.test 의 WEATHER 와 같은 값이다. */
const WEATHER: ServerCandidate = {
  id: "mcp-config:.mcp.json:weather",
  name: "weather",
  command: "node",
  args: ["examples/weather-server/server.mjs", "--port", "3000"],
  source: "mcp-config",
  path: ".mcp.json",
  envNames: ["API_KEY"],
};

/** WEATHER 후보로 점검할 때 화면이 만드는 argv. 토큰 탭·홈과 같은 배열이다. */
const WEATHER_ARGV = [
  "--command",
  "node",
  "--arg",
  "examples/weather-server/server.mjs",
  "--arg",
  "--port",
  "--arg",
  "3000",
  "--env",
  "API_KEY",
];

/** 숨은 문자가 든 도구 이름. 파일에는 이스케이프로만 적는다. */
const HIDDEN_NAME = "get" + "\u200B" + "time";
/** 서버가 `escapeInvisible` 로 만든 표시용 글자. */
const SHOWN_NAME = "get<U+200B>time";

/** 서버 테스트(§7.3)의 SAMPLE 과 같은 발견 셋. */
const FINDINGS: readonly Finding[] = [
  {
    ruleId: "desc/hidden-unicode",
    severity: "high",
    location: { kind: "tool", toolIndex: 1, toolName: HIDDEN_NAME, path: "name" },
    message: "보이지 않는 문자가 들어 있습니다.",
    fix: "보이지 않는 문자를 지우세요.",
    evidence: ["U+200B", "raw"],
  },
  {
    ruleId: "protocol/plaintext",
    severity: "medium",
    location: { kind: "protocol", path: "" },
    message: "평문 HTTP 로 붙었습니다.",
    fix: "https 를 쓰세요.",
    evidence: [],
  },
  {
    ruleId: "flow/toxic-combination",
    severity: "info",
    location: { kind: "server", path: "" },
    message: "읽기와 보내기 도구가 함께 있습니다.",
    fix: "권한을 나누세요.",
    evidence: [],
  },
];

const VIEWS: readonly SecurityFindingView[] = [
  { where: `도구 '${SHOWN_NAME}' 의 name`, tool: SHOWN_NAME, toolIndex: 1 },
  { where: "프로토콜", tool: null, toolIndex: -1 },
  { where: "서버", tool: null, toolIndex: -1 },
];

const SKIP_REASON = "--baseline 을 주지 않아 도구 표면 변경을 비교하지 않았습니다.";
const LIMITS = [
  "행위 관측(Docker 격리)은 mcpeak audit --sandbox 로 켭니다.",
  "정적 검사는 도구 정의의 글자만 봅니다.",
];
const RENDERED = "mcpeak audit · sample 1.0.0\n\n판정: 심각 1건, 주의 1건, 낮음 0건, 정보 0건\n";

const DOCKER_MISSING_LINE =
  "행위 관측 안 함: Docker 를 찾을 수 없습니다. 서버는 격리 없이 이 머신에서 실행됐습니다. (설치: https://docs.docker.com/get-docker/)";
const RAN_LINE =
  "격리 실행: Docker 컨테이너 안에서 서버를 띄웠습니다 · 네트워크 실제 전달 · 이미지 mcpeak-audit:abc";

const RAN: SandboxReport = {
  status: "ran",
  backend: "docker",
  image: "mcpeak-audit:abc",
  network: "live",
  compareHost: false,
  callCount: 3,
  declaredHosts: ["api.example.com"],
  requests: [
    { host: "api.example.com", port: 443, method: "GET", path: "/v1", count: 2, declared: true },
    { host: "evil.example.net", port: 80, method: "POST", path: "/x", count: 1, declared: false },
  ],
};

function securityResponse(
  overrides: Partial<AnalyzeSecurityResponse> & {
    readonly findings?: readonly Finding[];
    readonly sandbox?: SandboxReport;
  } = {},
): AnalyzeSecurityResponse {
  const { findings = FINDINGS, sandbox, ...rest } = overrides;
  const report: AuditReport = {
    schemaVersion: 1,
    generator: { name: "@mcpeak/audit", version: "0.0.0" },
    server: {
      name: "sample",
      version: "1.0.0",
      toolCount: 2,
      promptCount: 0,
      resourceCount: 0,
      hasInstructions: false,
      capabilityKeys: ["tools"],
    },
    probe: "readonly",
    probedTools: ["add"],
    ...(sandbox === undefined ? {} : { sandbox }),
    findings,
    skipped: [{ family: "surface", reason: SKIP_REASON }],
    counts: { high: 1, medium: 1, low: 0, info: 0 },
    exitCode: 2,
  };
  return {
    report,
    reportText: `${JSON.stringify(report, null, 2)}\n`,
    rendered: RENDERED,
    views: VIEWS,
    sandboxLine: null,
    limits: LIMITS,
    exitCode: 2,
    cleanupError: "",
    ...rest,
  };
}

interface StubResponse {
  readonly status: number;
  readonly body: unknown;
}

/**
 * home.test 의 stubFetch 와 같은 방식. 시작(POST)과 결과(GET) 응답만 이 화면의 것으로 바꿔 둔다.
 * 배열로 주면 요청 순서대로 하나씩 쓰고, 다 쓰면 마지막 것을 되풀이한다.
 */
function stubFetch(
  options: {
    readonly servers?: readonly ServerCandidate[];
    readonly start?: StubResponse | readonly StubResponse[];
    readonly result?: StubResponse | readonly StubResponse[];
    /** 주면 `GET /api/runs/<id>` 가 이것을 돌려준다. 없으면 도는 run 의 summary 다. */
    readonly summary?: StubResponse;
  } = {},
): ReturnType<typeof vi.fn> {
  const servers = options.servers ?? [WEATHER];
  const startQueue: readonly StubResponse[] = [
    options.start ?? { status: 200, body: { runId: "r1" } },
  ].flat();
  const resultQueue: readonly StubResponse[] = [
    options.result ?? { status: 200, body: securityResponse() },
  ].flat();
  let startCount = 0;
  let resultCount = 0;
  const take = (queue: readonly StubResponse[], index: number): Response => {
    const picked = queue[Math.min(index, queue.length - 1)];
    return new Response(JSON.stringify(picked?.body), { status: picked?.status ?? 500 });
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST" && url === "/api/analyze/security") {
      startCount += 1;
      return take(startQueue, startCount - 1);
    }
    if (url.startsWith("/api/analyze/security/")) {
      resultCount += 1;
      return take(resultQueue, resultCount - 1);
    }
    // 훅이 마운트마다 run 의 summary 를 한 번 읽는다(#295).
    if (/^\/api\/runs\/[^/]+$/.test(url)) {
      if (options.summary !== undefined) {
        return take([options.summary], 0);
      }
      const runId = decodeURIComponent(url.slice("/api/runs/".length));
      return new Response(
        JSON.stringify({ runId, flow: "audit", status: "running", exitCode: null, argv: [] }),
        { status: 200 },
      );
    }
    if (url === "/api/servers") {
      return new Response(JSON.stringify(servers), { status: 200 });
    }
    if (url === "/api/meta") {
      return new Response(JSON.stringify(META), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** `POST /api/analyze/security` 로 보낸 본문을 보낸 순서대로. */
function postedBodies(fetchMock: ReturnType<typeof vi.fn>): readonly Record<string, unknown>[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => String(input) === "/api/analyze/security" && init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
}

/** 결과를 읽은 요청의 주소를 보낸 순서대로. */
function resultRequests(fetchMock: ReturnType<typeof vi.fn>): readonly string[] {
  return fetchMock.mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.startsWith("/api/analyze/security/"));
}

/** `aria-current="step"` 인 단계의 이름. 번호 칸을 빼고 라벨(마지막 span)만 읽는다. */
function currentStep(): string | null {
  return document.querySelector('[aria-current="step"] > span:last-child')?.textContent ?? null;
}

/** `container` 안에서 글자 전체(자식 요소의 글자 포함)가 `text` 인 `<p>`. 한 줄이 여러 조각으로 나뉜 자리에 쓴다. */
function lineOf(container: HTMLElement, text: string): HTMLElement {
  return within(container).getByText(
    (_, element) => element?.tagName === "P" && element.textContent === text,
  );
}

/** 규칙 id 가 `ruleId` 인 발견의 `<li>`. */
function findingOf(ruleId: string): HTMLElement {
  const item = screen.getByText(ruleId).closest("li");
  if (item === null) {
    throw new Error(`발견이 <li> 안에 없다: ${ruleId}`);
  }
  return item;
}

/** 첫 후보가 선택될 때까지 기다린 뒤 점검을 시작하고 이벤트 스트림이 열릴 때까지 기다린다. */
async function start(): Promise<FakeEventSource> {
  await screen.findByRole("radio", { name: /^weather/ });
  const before = FakeEventSource.instances.length;
  fireEvent.click(screen.getByRole("button", { name: "점검 시작" }));
  await waitFor(() => {
    expect(FakeEventSource.instances.length).toBe(before + 1);
  });
  return lastSource();
}

/** 보안 탭을 그리고 점검을 끝까지 돌려 결과 화면을 띄운다. */
async function runToResult(
  response: AnalyzeSecurityResponse = securityResponse(),
): Promise<ReturnType<typeof vi.fn>> {
  const fetchMock = stubFetch({ result: { status: 200, body: response } });
  render(<AnalyzeView tab="security" />);
  const source = await start();
  act(() => {
    source.emit({ kind: "done", exitCode: response.exitCode });
  });
  await screen.findByText(/^판정: /);
  return fetchMock;
}

/** 제목이 `name` 인 구획(`<section>`). */
function sectionOf(name: string | RegExp): HTMLElement {
  const section = screen.getByRole("heading", { level: 3, name }).closest("section");
  if (section === null) {
    throw new Error(`구획을 찾지 못했습니다: ${String(name)}`);
  }
  return section;
}

describe("SecurityPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    FakeEventSource.instances = [];
  });

  it("보안 탭은 접속 폼과 점검 옵션을 보인다", async () => {
    stubFetch();
    render(<AnalyzeView tab="security" />);

    expect(await screen.findByRole("radio", { name: /^weather/ })).toHaveProperty("checked", true);
    expect(screen.getByRole("button", { name: "점검 시작" })).toBeTruthy();
    expect(screen.getByText("호출 정책")).toBeTruthy();
    expect(screen.getByRole("button", { name: "자동" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Docker 격리 안에서 실행 (행위 관측)")).toBeTruthy();
    expect(currentStep()).toBe("서버 선택");
    // 준비 중 안내는 없어졌다.
    expect(screen.queryByText("보안 탭은 준비 중입니다.")).toBeNull();
  });

  it("토큰 탭에서 고른 서버가 보안 탭에 남는다", async () => {
    stubFetch({ servers: [] });
    const { rerender } = render(<AnalyzeView tab="tokens" />);
    fireEvent.change(await screen.findByLabelText("서버 스크립트"), {
      target: { value: "server.js" },
    });

    rerender(<AnalyzeView tab="security" />);

    expect(screen.getByLabelText("서버 스크립트")).toHaveProperty("value", "server.js");
    expect(screen.getByRole("button", { name: "점검 시작" })).toHaveProperty("disabled", false);

    // 돌아가도 남아 있다.
    rerender(<AnalyzeView tab="tokens" />);
    expect(screen.getByLabelText("서버 스크립트")).toHaveProperty("value", "server.js");
  });

  it("점검 시작이 올바른 본문을 POST 하고 이벤트 스트림을 연다", async () => {
    const fetchMock = stubFetch();
    render(<AnalyzeView tab="security" />);

    const source = await start();

    expect(postedBodies(fetchMock)).toEqual([{ argv: WEATHER_ARGV, serverId: WEATHER.id }]);
    expect(source.url).toBe("/api/runs/r1/events");
  });

  it("점검 시작을 누르면 점검 단계로 넘어가고 폼이 사라진다", async () => {
    stubFetch();
    render(<AnalyzeView tab="security" />);
    expect(
      [...document.querySelectorAll("ol > li > span:last-child")].map((step) => step.textContent),
    ).toEqual(["서버 선택", "점검", "결과"]);

    await start();

    expect(currentStep()).toBe("점검");
    expect(screen.queryByRole("button", { name: "점검 시작" })).toBeNull();
    expect(screen.queryByRole("button", { name: "점검 중…" })).toBeNull();
    expect(screen.queryByRole("radio", { name: /^weather/ })).toBeNull();
    expect(screen.queryByText("호출 정책")).toBeNull();
    expect(screen.getByText("진행")).toBeTruthy();
  });

  it("점검 단계는 점검 중인 서버를 보인다", async () => {
    stubFetch();
    render(<AnalyzeView tab="security" />);

    await start();

    expect(
      screen.getByText("점검 대상: node examples/weather-server/server.mjs --port 3000"),
    ).toBeTruthy();
  });

  it("점검 단계에서 서버 다시 고르기를 누르면 서버 선택으로 돌아가고 고른 값이 남는다", async () => {
    const fetchMock = stubFetch();
    render(<AnalyzeView tab="security" />);
    await screen.findByRole("radio", { name: /^weather/ });
    fireEvent.click(screen.getByRole("button", { name: "전부" }));
    const source = await start();
    expect(screen.getByText("점검은 중단되지 않고 끝까지 돕니다.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "← 서버 다시 고르기" }));

    expect(currentStep()).toBe("서버 선택");
    expect(screen.getByRole("button", { name: "점검 시작" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: "전부" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("radio", { name: /^weather/ })).toHaveProperty("checked", true);
    expect(screen.queryByText("진행")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    // 진행 스트림은 닫힌다. 떠난 run 이 끝나도 결과를 읽지 않는다.
    expect(source.closed).toBe(true);
    act(() => {
      source.emit({ kind: "done", exitCode: 2 });
    });
    expect(resultRequests(fetchMock)).toEqual([]);
    expect(currentStep()).toBe("서버 선택");
  });

  it("점검 옵션을 요청 본문의 필드로 싣는다", async () => {
    const fetchMock = stubFetch();
    render(<AnalyzeView tab="security" />);
    await screen.findByRole("radio", { name: /^weather/ });

    fireEvent.click(screen.getByRole("button", { name: "호출 안 함" }));
    fireEvent.change(screen.getByLabelText("기준 파일 (프로젝트 루트 기준, 선택)"), {
      target: { value: "b.json" },
    });
    fireEvent.click(screen.getByLabelText("기준 파일을 지금 표면으로 갱신"));
    fireEvent.click(screen.getByLabelText("Docker 격리 안에서 실행 (행위 관측)"));
    fireEvent.click(screen.getByLabelText("이 머신에서 받은 도구 표면과 비교 (--compare-host)"));
    await start();

    expect(postedBodies(fetchMock)).toEqual([
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

  it("대상이 비면 버튼이 비활성이고 사유를 보인다", async () => {
    stubFetch({ servers: [] });
    render(<AnalyzeView tab="security" />);
    await screen.findByLabelText("서버 스크립트");

    expect(screen.getByRole("button", { name: "점검 시작" })).toHaveProperty("disabled", true);
    expect(screen.getByText("서버를 고르거나 실행 명령을 입력하세요.")).toBeTruthy();
  });

  it("기준 파일 경로가 비면 갱신 체크박스가 비활성이다", async () => {
    stubFetch();
    render(<AnalyzeView tab="security" />);
    await screen.findByRole("radio", { name: /^weather/ });

    const update = screen.getByLabelText("기준 파일을 지금 표면으로 갱신");
    expect(update).toHaveProperty("disabled", true);

    const path = screen.getByLabelText("기준 파일 (프로젝트 루트 기준, 선택)");
    expect(path.getAttribute("placeholder")).toBe(".mcpeak/audit-baseline.json");
    fireEvent.change(path, { target: { value: "b.json" } });
    expect(update).toHaveProperty("disabled", false);

    // .json 이 아닌 경로는 버튼을 막고 사유를 보인다.
    fireEvent.change(path, { target: { value: "b.txt" } });
    expect(screen.getByRole("button", { name: "점검 시작" })).toHaveProperty("disabled", true);
    expect(screen.getByText("기준 파일 경로는 .json 으로 끝나야 합니다.")).toBeTruthy();
  });

  it("http 대상이면 격리 체크박스가 비활성이고 이유를 보인다", async () => {
    stubFetch();
    render(<AnalyzeView tab="security" />);
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
    render(<AnalyzeView tab="security" />);
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
    render(<AnalyzeView tab="security" />);
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

  it("없는 run 이면 서버 선택 단계로 돌아가 다시 시작할 수 있다", async () => {
    stubFetch({ summary: { status: 404, body: { error: "그런 run이 없습니다." } } });
    render(<AnalyzeView tab="security" />);
    await screen.findByRole("radio", { name: /^weather/ });

    fireEvent.click(screen.getByRole("button", { name: "점검 시작" }));

    // 버튼이 돌아온 뒤에 본다. 그 전의 alert 는 점검 단계가 잠깐 보이는 같은 문장이다.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "점검 시작" })).toHaveProperty("disabled", false);
    });
    expect(currentStep()).toBe("서버 선택");
    const alert = screen.getByRole("alert");
    expect(alert.tagName).toBe("PRE");
    expect(alert.textContent).toBe(
      "그런 run이 없습니다.\n" +
        "→ 대시보드는 실행 이력을 메모리에만 둡니다. 서버를 다시 시작했다면 이전 run 은 남아 있지 않습니다.\n" +
        "→ Runs 목록에서 살아 있는 run 을 고르거나, 새 실행을 시작하세요.",
    );
    expect(screen.queryByText("진행")).toBeNull();
    expect(lastSource().closed).toBe(true);
  });

  it("run 조회만 실패하면 문장을 보이고 진행을 유지한다", async () => {
    stubFetch({ summary: { status: 500, body: { error: "서버 오류" } } });
    render(<AnalyzeView tab="security" />);
    await start();

    expect((await screen.findByRole("alert")).textContent).toContain("서버 오류");
    expect(screen.getByText("진행")).toBeTruthy();
    expect(currentStep()).toBe("점검");
  });

  it("진행 문장을 로그 패널에 보인다", async () => {
    stubFetch();
    render(<AnalyzeView tab="security" />);
    const source = await start();

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
    expect(currentStep()).toBe("점검");
  });

  it("done 뒤 결과를 읽으면 결과 단계다", async () => {
    const fetchMock = stubFetch();
    render(<AnalyzeView tab="security" />);
    const source = await start();
    expect(resultRequests(fetchMock)).toEqual([]);

    act(() => {
      source.emit({ kind: "stderr", html: "점검합니다." });
      // 종료 코드 2 는 "발견이 있다" 이다. 실패로 그리지 않는다.
      source.emit({ kind: "done", exitCode: 2 });
    });

    expect((await screen.findByText(/^판정: /)).textContent).toBe(
      "판정: 심각 1건, 주의 1건, 낮음 0건, 정보 0건",
    );
    // 결과는 한 번만 읽는다.
    expect(resultRequests(fetchMock)).toEqual(["/api/analyze/security/r1"]);
    expect(currentStep()).toBe("결과");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("sample 1.0.0")).toBeTruthy();
    expect(screen.getByText("2개")).toBeTruthy();
    expect(screen.getByText("readonly (호출한 도구 1개)")).toBeTruthy();
    // 결과를 받은 뒤에는 스트림을 닫는다.
    expect(source.closed).toBe(true);
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
    render(<AnalyzeView tab="security" />);
    await screen.findByRole("radio", { name: /^weather/ });
    fireEvent.change(screen.getByLabelText("기준 파일 (프로젝트 루트 기준, 선택)"), {
      target: { value: "b.json" },
    });
    const source = await start();
    act(() => {
      source.emit({ kind: "done", exitCode: 2 });
    });

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

  it("결과 요청이 400 이면 서버 선택 단계로 돌아가 error 문장을 그대로 보인다", async () => {
    const error = "오류 [CONNECT_FAILED]: x\n해결: y";
    stubFetch({ result: { status: 400, body: { error } } });
    render(<AnalyzeView tab="security" />);
    const source = await start();
    expect(currentStep()).toBe("점검");

    act(() => {
      source.emit({ kind: "done", exitCode: 1 });
    });

    expect((await screen.findByRole("alert")).textContent).toBe(error);
    expect(currentStep()).toBe("서버 선택");
    expect(screen.getByRole("button", { name: "점검 시작" })).toHaveProperty("disabled", false);
  });

  it("시작 요청이 400 이면 서버 선택 단계에 머문다", async () => {
    const error = "기준 파일이 아닌 파일은 덮어쓰지 않습니다: package.json\n→ 다른 경로를 쓰세요.";
    stubFetch({ start: { status: 400, body: { error } } });
    render(<AnalyzeView tab="security" />);
    await screen.findByRole("radio", { name: /^weather/ });

    fireEvent.click(screen.getByRole("button", { name: "점검 시작" }));

    expect((await screen.findByRole("alert")).textContent).toBe(error);
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(currentStep()).toBe("서버 선택");
    expect(screen.getByRole("button", { name: "점검 시작" })).toHaveProperty("disabled", false);
  });

  it("다시 점검은 점검 단계로 간다", async () => {
    const fetchMock = stubFetch({
      start: [
        { status: 200, body: { runId: "r1" } },
        { status: 200, body: { runId: "r2" } },
      ],
    });
    render(<AnalyzeView tab="security" />);
    const first = await start();
    act(() => {
      first.emit({ kind: "done", exitCode: 2 });
    });
    await screen.findByText(/^판정: /);

    fireEvent.click(screen.getByRole("button", { name: "다시 점검" }));

    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(2);
    });
    const bodies = postedBodies(fetchMock);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(lastSource().url).toBe("/api/runs/r2/events");
    expect(currentStep()).toBe("점검");
    expect(screen.queryByText(/^판정: /)).toBeNull();
    // 앞 run 의 완료 상태로 새 run 의 결과를 미리 읽지 않는다.
    expect(resultRequests(fetchMock)).toEqual(["/api/analyze/security/r1"]);

    act(() => {
      lastSource().emit({ kind: "done", exitCode: 2 });
    });
    await screen.findByText(/^판정: /);
    expect(resultRequests(fetchMock)).toEqual([
      "/api/analyze/security/r1",
      "/api/analyze/security/r2",
    ]);
  });

  it("서버 다시 고르기를 누르면 폼으로 돌아오고 점검 옵션이 남는다", async () => {
    stubFetch();
    render(<AnalyzeView tab="security" />);
    await screen.findByRole("radio", { name: /^weather/ });
    fireEvent.click(screen.getByRole("button", { name: "전부" }));
    const source = await start();
    act(() => {
      source.emit({ kind: "done", exitCode: 2 });
    });
    await screen.findByText(/^판정: /);

    fireEvent.click(screen.getByRole("button", { name: "← 서버 다시 고르기" }));

    expect(currentStep()).toBe("서버 선택");
    expect(screen.getByRole("button", { name: "점검 시작" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: "전부" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("radio", { name: /^weather/ })).toHaveProperty("checked", true);
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
});
