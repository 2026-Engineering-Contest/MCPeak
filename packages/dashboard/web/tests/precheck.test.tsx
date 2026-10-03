// @vitest-environment jsdom
import type { AuditReport, Finding, SandboxReport, Severity } from "@mcpeak/audit";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyzeSecurityResponse, RunEventInput } from "../../src/api-types.js";
import { REMOTE_SANDBOX_HINT } from "../src/analyze/SecurityPanel.js";
import { PreCheck } from "../src/screens/PreCheck.js";

/** security-panel.test 와 같은 방식의 EventSource fake. 네트워크·서버 없음. */
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

/** 계획서 §5.2 표의 첫 줄. env 값 `v` 가 들어 있다. */
const MCP_SERVERS_JSON =
  '{"mcpServers":{"a":{"command":"npx","args":["-y","pkg"],"env":{"KEY":"v"}}}}';
/** 표의 둘째 줄. 첫째는 stdio, 둘째는 헤더가 있는 http 다. */
const TWO_SERVERS_JSON =
  '{"a":{"command":"node","args":["s.mjs"]},"b":{"url":"https://x.test/mcp","headers":{"Authorization":"t"}}}';
const NPX_LINE = "npx -y pkg";
const NPX_ARGV = ["--command", "npx", "--arg", "-y", "--arg", "pkg"];
/** 화면에 새면 바로 눈에 띄는 비밀값. `v` 한 글자로는 새는지 가릴 수 없다. */
const SECRET = "s3cr3t-value";

const INPUT_LABEL = "서버 설정 또는 실행 명령";
const SANDBOX_LABEL = "Docker 격리 안에서 실행 (권장)";
const BACK_LABEL = "← 서버 다시 붙여넣기";
const EMPTY_REASON = "서버 설정이나 실행 명령을 붙여 넣으세요.";
const SANDBOX_ON_HINT =
  "격리 이미지는 node, npx, npm 으로 띄우는 서버만 실행합니다. Docker 가 없거나 그 밖의 명령이면 서버가 이 머신에서 직접 실행되고, 결과 위에 그 사실이 표시됩니다.";
const SANDBOX_OFF_HINT = "격리를 끄면 서버가 이 머신에서 사용자 권한으로 실행됩니다.";
const DOCKER_MISSING_LINE =
  "행위 관측 안 함: Docker 를 찾을 수 없습니다. 서버는 격리 없이 이 머신에서 실행됐습니다. (설치: https://docs.docker.com/get-docker/)";

function finding(severity: Severity, fix: string): Finding {
  return {
    ruleId: "desc/hidden-unicode",
    severity,
    location: { kind: "server", path: "" },
    message: `${fix} 의 메시지`,
    fix,
    evidence: [],
  };
}

/** 같은 해결 문장의 심각 둘 사이에 다른 문장의 주의 하나. 요약은 심각을 먼저 낸다. */
const FINDINGS: readonly Finding[] = [
  finding("high", "보이지 않는 문자를 지우세요."),
  finding("medium", "https 를 쓰세요."),
  finding("high", "보이지 않는 문자를 지우세요."),
];

function securityResponse(
  findings: readonly Finding[] = FINDINGS,
  overrides: Partial<AnalyzeSecurityResponse> & { readonly sandbox?: SandboxReport } = {},
): AnalyzeSecurityResponse {
  const { sandbox, ...rest } = overrides;
  const count = (severity: Severity): number =>
    findings.filter((entry) => entry.severity === severity).length;
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
    probedTools: [],
    ...(sandbox === undefined ? {} : { sandbox }),
    findings,
    skipped: [],
    counts: {
      high: count("high"),
      medium: count("medium"),
      low: count("low"),
      info: count("info"),
    },
    exitCode: findings.length === 0 ? 0 : 2,
  };
  return {
    report,
    reportText: `${JSON.stringify(report, null, 2)}\n`,
    rendered: "mcpeak audit · sample 1.0.0\n",
    views: findings.map(() => ({ where: "서버", tool: null, toolIndex: -1 })),
    sandboxLine: null,
    limits: ["정적 검사는 도구 정의의 글자만 봅니다."],
    exitCode: report.exitCode,
    cleanupError: "",
    ...rest,
  };
}

interface StubResponse {
  readonly status: number;
  readonly body: unknown;
}

/** security-panel.test 의 stubFetch 와 같은 방식. 시작(POST)과 결과(GET) 응답만 바꿔 둔다. */
function stubFetch(
  options: {
    readonly start?: StubResponse;
    readonly result?: StubResponse;
    /** 주면 `GET /api/runs/<id>` 가 이것을 돌려준다. 없으면 도는 run 의 summary 다. */
    readonly summary?: StubResponse;
  } = {},
): ReturnType<typeof vi.fn> {
  const start = options.start ?? { status: 200, body: { runId: "r1" } };
  const result = options.result ?? { status: 200, body: securityResponse() };
  const respond = (stub: StubResponse): Response =>
    new Response(JSON.stringify(stub.body), { status: stub.status });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST" && url === "/api/analyze/security") {
      return respond(start);
    }
    if (url.startsWith("/api/analyze/security/")) {
      return respond(result);
    }
    // 훅이 마운트마다 run 의 summary 를 한 번 읽는다(#295).
    if (/^\/api\/runs\/[^/]+$/.test(url)) {
      if (options.summary !== undefined) {
        return respond(options.summary);
      }
      const runId = decodeURIComponent(url.slice("/api/runs/".length));
      return respond({
        status: 200,
        body: { runId, flow: "audit", status: "running", exitCode: null, argv: [] },
      });
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

function input(): HTMLTextAreaElement {
  return screen.getByLabelText(INPUT_LABEL) as HTMLTextAreaElement;
}

function paste(text: string): void {
  fireEvent.change(input(), { target: { value: text } });
}

function sandboxToggle(): HTMLInputElement {
  return screen.getByRole("checkbox", { name: SANDBOX_LABEL }) as HTMLInputElement;
}

function startButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "점검 시작" }) as HTMLButtonElement;
}

/** 입력 칸을 뺀 화면의 글자 전부. 붙여 넣은 값이 입력 칸 밖으로 새는지 볼 때 쓴다. */
function textOutsideInput(): string {
  const copy = document.body.cloneNode(true) as HTMLElement;
  for (const area of copy.querySelectorAll("textarea")) {
    area.remove();
  }
  return copy.textContent ?? "";
}

/** 점검을 시작하고 이벤트 스트림이 열릴 때까지 기다린다. */
async function start(): Promise<FakeEventSource> {
  const before = FakeEventSource.instances.length;
  fireEvent.click(startButton());
  await waitFor(() => {
    expect(FakeEventSource.instances.length).toBe(before + 1);
  });
  return lastSource();
}

/** 화면을 그리고 `text` 를 붙여 넣어 점검을 끝까지 돌려 결과 화면을 띄운다. */
async function runToResult(
  response: AnalyzeSecurityResponse = securityResponse(),
  text: string = NPX_LINE,
): Promise<ReturnType<typeof vi.fn>> {
  const fetchMock = stubFetch({ result: { status: 200, body: response } });
  render(<PreCheck />);
  paste(text);
  const source = await start();
  act(() => {
    source.emit({ kind: "done", exitCode: response.exitCode });
  });
  await screen.findByText(/^판정: /);
  return fetchMock;
}

/** "먼저 할 일" 카드. 제목을 감싼 가장 가까운 `<div>` 다. */
function summaryCard(): HTMLElement {
  const card = screen.getByRole("heading", { level: 2, name: "먼저 할 일" }).closest("div");
  if (card === null) {
    throw new Error("먼저 할 일 카드를 찾지 못했습니다.");
  }
  return card;
}

describe("PreCheck", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    FakeEventSource.instances = [];
  });

  it("제목과 입력, 켜진 격리 토글을 보인다", () => {
    stubFetch();
    render(<PreCheck />);

    expect(screen.getByRole("heading", { level: 1, name: "사전 점검" })).toBeTruthy();
    expect(
      screen.getByText("등록하기 전에 MCP 서버를 한 번 띄워 도구 정의와 행동을 점검합니다."),
    ).toBeTruthy();
    expect(input().tagName).toBe("TEXTAREA");
    expect(input().id).toBe("precheck-input");
    expect(
      screen.getByText(
        "README 의 mcpServers JSON, 실행 명령 한 줄(npx -y <패키지>), 또는 서버 URL 을 붙여 넣으세요.",
      ),
    ).toBeTruthy();
    expect(sandboxToggle().checked).toBe(true);
    expect(currentStep()).toBe("서버 붙여넣기");
    expect(
      [...document.querySelectorAll("ol > li > span:last-child")].map((step) => step.textContent),
    ).toEqual(["서버 붙여넣기", "점검", "결과"]);
  });

  it("입력이 비면 버튼이 비활성이고 사유를 보인다", () => {
    stubFetch();
    render(<PreCheck />);

    expect(startButton().disabled).toBe(true);
    expect(screen.getByText(EMPTY_REASON)).toBeTruthy();
    expect(screen.queryByText(/^점검 대상: /)).toBeNull();
  });

  it("읽지 못하는 입력이면 그 사유를 보이고 버튼이 비활성이다", () => {
    stubFetch();
    render(<PreCheck />);

    paste('node "s.mjs');

    expect(startButton().disabled).toBe(true);
    expect(screen.getByText("따옴표가 닫히지 않았습니다.")).toBeTruthy();
  });

  it("명령 한 줄을 붙여 넣으면 대상 줄을 보이고 버튼이 켜진다", () => {
    stubFetch();
    render(<PreCheck />);

    paste(NPX_LINE);

    expect(screen.getByText("점검 대상: npx -y pkg")).toBeTruthy();
    expect(startButton().disabled).toBe(false);
    expect(screen.queryByText(EMPTY_REASON)).toBeNull();
    // 서버가 하나면 고르는 칸이 없다.
    expect(screen.queryByLabelText("점검할 서버")).toBeNull();
    expect(screen.queryByText(/환경변수/)).toBeNull();
    expect(screen.queryByText(/헤더/)).toBeNull();
  });

  it("env 가 있는 설정이면 넘기지 않는다고 말한다", () => {
    stubFetch();
    render(<PreCheck />);

    paste(MCP_SERVERS_JSON);

    expect(
      screen.getByText(
        "이 설정의 환경변수 1개(KEY)는 서버에 넘기지 않습니다. 사전 점검은 실제 비밀값 없이 돕니다.",
      ),
    ).toBeTruthy();
    expect(textOutsideInput()).not.toContain("KEY=");
    expect(textOutsideInput()).not.toContain('"v"');

    // 값이 한 글자면 새는지 가릴 수 없어서 눈에 띄는 값으로 한 번 더 본다. 이름은 적힌 순서다.
    paste(`{"a":{"command":"node","env":{"API_KEY":"${SECRET}","TOKEN":"${SECRET}"}}}`);

    expect(
      screen.getByText(
        "이 설정의 환경변수 2개(API_KEY, TOKEN)는 서버에 넘기지 않습니다. 사전 점검은 실제 비밀값 없이 돕니다.",
      ),
    ).toBeTruthy();
    expect(textOutsideInput()).not.toContain(SECRET);

    paste(`API_KEY=${SECRET} node server.mjs`);

    expect(screen.getByText("점검 대상: node server.mjs")).toBeTruthy();
    expect(textOutsideInput()).not.toContain(SECRET);
  });

  it("헤더가 있는 원격 설정이면 보내지 않는다고 말한다", () => {
    stubFetch();
    render(<PreCheck />);

    paste(`{"b":{"url":"https://x.test/mcp","headers":{"Authorization":"Bearer ${SECRET}"}}}`);

    expect(screen.getByText("점검 대상: https://x.test/mcp")).toBeTruthy();
    expect(
      screen.getByText(
        "이 설정의 헤더 1개(Authorization)는 보내지 않습니다. 인증이 필요한 서버는 접속 실패로 끝날 수 있습니다.",
      ),
    ).toBeTruthy();
    expect(textOutsideInput()).not.toContain(SECRET);
  });

  it("서버가 둘이면 고르게 하고 둘째를 고르면 대상 줄이 바뀐다", () => {
    stubFetch();
    render(<PreCheck />);

    paste(TWO_SERVERS_JSON);

    const select = screen.getByLabelText("점검할 서버") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(select.id).toBe("precheck-server");
    expect([...select.options].map((option) => option.textContent)).toEqual(["a", "b"]);
    expect(screen.getByText("점검 대상: node s.mjs")).toBeTruthy();

    fireEvent.change(select, { target: { value: "1" } });

    expect(screen.getByText("점검 대상: https://x.test/mcp")).toBeTruthy();
    expect(screen.queryByText("점검 대상: node s.mjs")).toBeNull();
  });

  it("입력을 바꾸면 고른 서버가 첫째로 돌아간다", () => {
    stubFetch();
    render(<PreCheck />);
    paste(TWO_SERVERS_JSON);
    fireEvent.change(screen.getByLabelText("점검할 서버"), { target: { value: "1" } });

    paste('{"c":{"command":"node","args":["c.mjs"]},"d":{"command":"node","args":["d.mjs"]}}');

    expect((screen.getByLabelText("점검할 서버") as HTMLSelectElement).value).toBe("0");
    expect(screen.getByText("점검 대상: node c.mjs")).toBeTruthy();
  });

  it("원격 대상이면 격리 토글이 꺼지고 비활성이다", () => {
    stubFetch();
    render(<PreCheck />);

    paste("https://x.test/mcp");

    expect(sandboxToggle().checked).toBe(false);
    expect(sandboxToggle().disabled).toBe(true);
    expect(screen.getByText(REMOTE_SANDBOX_HINT)).toBeTruthy();
    expect(screen.queryByText(SANDBOX_ON_HINT)).toBeNull();
  });

  it("격리를 끄면 이 머신에서 실행된다고 말한다", () => {
    stubFetch();
    render(<PreCheck />);
    paste(NPX_LINE);

    expect(screen.getByText(SANDBOX_ON_HINT)).toBeTruthy();

    fireEvent.click(sandboxToggle());

    expect(sandboxToggle().checked).toBe(false);
    expect(screen.getByText(SANDBOX_OFF_HINT)).toBeTruthy();
    expect(screen.queryByText(SANDBOX_ON_HINT)).toBeNull();
  });

  it("점검 시작이 env 없는 본문을 POST 한다", async () => {
    const fetchMock = stubFetch();
    render(<PreCheck />);
    paste(MCP_SERVERS_JSON);

    await start();

    expect(postedBodies(fetchMock)).toEqual([
      { argv: NPX_ARGV, sandbox: { compareHost: false, allowHosts: [] } },
    ]);
    // 최근 명령 목록을 비롯해 브라우저 저장소에 아무것도 쓰지 않는다.
    expect(window.localStorage.length).toBe(0);
  });

  it("격리를 끄고 시작하면 argv 만 보낸다", async () => {
    const fetchMock = stubFetch();
    render(<PreCheck />);
    paste(NPX_LINE);
    fireEvent.click(sandboxToggle());

    await start();

    expect(postedBodies(fetchMock)).toEqual([{ argv: NPX_ARGV }]);
  });

  it("헤더가 있는 원격 설정은 주소만 보낸다", async () => {
    const fetchMock = stubFetch();
    render(<PreCheck />);
    paste(`{"b":{"url":"https://x.test/mcp","headers":{"Authorization":"Bearer ${SECRET}"}}}`);

    await start();

    expect(postedBodies(fetchMock)).toEqual([{ argv: ["--url", "https://x.test/mcp"] }]);
  });

  it("점검 시작을 누르면 점검 단계로 넘어가고 입력이 사라진다", async () => {
    stubFetch();
    render(<PreCheck />);
    paste(NPX_LINE);

    const source = await start();

    expect(currentStep()).toBe("점검");
    expect(screen.queryByLabelText(INPUT_LABEL)).toBeNull();
    expect(document.querySelector("textarea")).toBeNull();
    expect(screen.getByRole("button", { name: BACK_LABEL })).toBeTruthy();
    expect(screen.getByText("점검은 중단되지 않고 끝까지 돕니다.")).toBeTruthy();
    expect(screen.getByText("점검 대상: npx -y pkg")).toBeTruthy();
    expect(screen.getByText("진행")).toBeTruthy();
    expect(source.url).toContain("r1");
  });

  it("done 뒤 결과를 읽으면 결과 단계다", async () => {
    const fetchMock = await runToResult();

    expect(resultRequests(fetchMock)).toEqual(["/api/analyze/security/r1"]);
    expect(currentStep()).toBe("결과");
    expect(screen.getByText(/^판정: /)).toBeTruthy();
    expect(screen.getByRole("button", { name: BACK_LABEL })).toBeTruthy();
    expect(screen.getByRole("button", { name: "다시 점검" })).toBeTruthy();
  });

  it("심각·주의 발견이 있으면 먼저 할 일 카드가 해결 문장을 보인다", async () => {
    await runToResult();

    const card = summaryCard();
    const lines = within(card).getAllByRole("listitem");
    expect(lines).toHaveLength(2);
    expect(lines[0]?.textContent).toBe("심각보이지 않는 문자를 지우세요. (발견 2건)");
    expect(lines[1]?.textContent).toBe("주의https 를 쓰세요.");
    const chips = [...card.querySelectorAll<HTMLElement>("[data-severity]")];
    expect(chips.map((chip) => chip.dataset.severity)).toEqual(["high", "medium"]);
    expect(chips.map((chip) => chip.textContent)).toEqual(["심각", "주의"]);
    // 카드는 결과(판정 줄)보다 위에 있다.
    const verdict = screen.getByText(/^판정: /);
    expect(card.compareDocumentPosition(verdict) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("심각·주의 발견이 없으면 먼저 할 일 카드가 없다", async () => {
    await runToResult(securityResponse([finding("low", "설명을 줄이세요.")]));

    expect(screen.queryByRole("heading", { name: "먼저 할 일" })).toBeNull();
    expect(screen.getByText(/^판정: /)).toBeTruthy();
  });

  it("격리를 쓰지 못했으면 그 문장을 alert 로 보인다", async () => {
    await runToResult(
      securityResponse(FINDINGS, {
        sandbox: { status: "unavailable", reason: { code: "docker-missing", detail: "" } },
        sandboxLine: DOCKER_MISSING_LINE,
      }),
    );

    expect(screen.getByRole("alert").textContent).toBe(DOCKER_MISSING_LINE);
  });

  it("결과 요청이 400 이면 붙여넣기 단계로 돌아가 error 문장을 그대로 보인다", async () => {
    const error = "점검이 리포트를 내지 못했습니다.\n→ 서버에 연결하지 못했습니다.";
    stubFetch({ result: { status: 400, body: { error } } });
    render(<PreCheck />);
    paste(NPX_LINE);
    const source = await start();

    act(() => {
      source.emit({ kind: "done", exitCode: 1 });
    });

    const alert = await screen.findByRole("alert");
    expect(alert.tagName).toBe("PRE");
    expect(alert.textContent).toBe(error);
    expect(currentStep()).toBe("서버 붙여넣기");
    expect(input().value).toBe(NPX_LINE);
    expect(startButton().disabled).toBe(false);
  });

  it("시작 요청이 400 이면 붙여넣기 단계에 머물고 error 문장을 그대로 보인다", async () => {
    const error = "argv 가 올바르지 않습니다.";
    stubFetch({ start: { status: 400, body: { error } } });
    render(<PreCheck />);
    paste(NPX_LINE);

    fireEvent.click(startButton());

    expect((await screen.findByRole("alert")).textContent).toBe(error);
    expect(currentStep()).toBe("서버 붙여넣기");
    expect(input().value).toBe(NPX_LINE);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("없는 run 이면 붙여넣기 단계로 돌아가 문장을 보인다", async () => {
    stubFetch({ summary: { status: 404, body: { error: "그런 run이 없습니다." } } });
    render(<PreCheck />);
    paste(NPX_LINE);

    fireEvent.click(startButton());

    // 버튼이 돌아온 뒤에 본다. 그 전의 alert 는 점검 단계가 잠깐 보이는 같은 문장이다.
    await waitFor(() => {
      expect(startButton().disabled).toBe(false);
    });
    expect(currentStep()).toBe("서버 붙여넣기");
    expect(screen.getByRole("alert").textContent).toContain("그런 run이 없습니다.");
    expect(input().value).toBe(NPX_LINE);
    expect(screen.queryByText("진행")).toBeNull();
  });

  it("서버 다시 붙여넣기를 누르면 입력과 격리 선택이 남는다", async () => {
    stubFetch();
    render(<PreCheck />);
    paste(TWO_SERVERS_JSON);
    fireEvent.change(screen.getByLabelText("점검할 서버"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("점검할 서버"), { target: { value: "0" } });
    fireEvent.click(sandboxToggle());
    await start();

    fireEvent.click(screen.getByRole("button", { name: BACK_LABEL }));

    expect(currentStep()).toBe("서버 붙여넣기");
    expect(input().value).toBe(TWO_SERVERS_JSON);
    expect(sandboxToggle().checked).toBe(false);
    expect((screen.getByLabelText("점검할 서버") as HTMLSelectElement).value).toBe("0");
    expect(screen.queryByText("진행")).toBeNull();
  });

  it("결과 단계에서 서버 다시 붙여넣기를 누르면 입력이 남고 결과가 사라진다", async () => {
    await runToResult();

    fireEvent.click(screen.getByRole("button", { name: BACK_LABEL }));

    expect(currentStep()).toBe("서버 붙여넣기");
    expect(input().value).toBe(NPX_LINE);
    expect(sandboxToggle().checked).toBe(true);
    expect(screen.queryByText(/^판정: /)).toBeNull();
    expect(screen.queryByRole("heading", { name: "먼저 할 일" })).toBeNull();
  });

  it("점검 단계를 떠난 뒤에 도착한 결과는 버린다", async () => {
    const fetchMock = stubFetch();
    render(<PreCheck />);
    paste(NPX_LINE);
    const source = await start();
    act(() => {
      source.emit({ kind: "done", exitCode: 2 });
    });

    // 결과 응답이 도착하기 전에 떠난다.
    fireEvent.click(screen.getByRole("button", { name: BACK_LABEL }));
    await waitFor(() => {
      expect(resultRequests(fetchMock)).toHaveLength(1);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(currentStep()).toBe("서버 붙여넣기");
    expect(screen.queryByText(/^판정: /)).toBeNull();
  });

  it("다시 점검은 같은 본문을 다시 POST 한다", async () => {
    const fetchMock = await runToResult();

    fireEvent.click(screen.getByRole("button", { name: "다시 점검" }));

    await waitFor(() => {
      expect(postedBodies(fetchMock)).toHaveLength(2);
    });
    const bodies = postedBodies(fetchMock);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[1]).toEqual({
      argv: NPX_ARGV,
      sandbox: { compareHost: false, allowHosts: [] },
    });
    await waitFor(() => {
      expect(currentStep()).toBe("점검");
    });
  });

  it("해결 문장을 HTML 로 해석하지 않는다", async () => {
    const markup = "<img src=x onerror=1>";
    await runToResult(securityResponse([finding("high", markup)]));

    expect(document.querySelector("img")).toBeNull();
    expect(within(summaryCard()).getByText(markup)).toBeTruthy();
  });
});
