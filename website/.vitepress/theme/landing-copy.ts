// 첫 페이지(HomeLanding.vue)의 문구. 영어 · 한국어 두 벌을 같은 모양으로 둔다.
// 터미널 출력은 CLI 가 실제로 찍는 한국어 그대로이므로 언어와 상관없이 하나다.

export interface LandingLink {
  readonly text: string;
  readonly link: string;
}

export interface LandingCard {
  readonly icon: LandingIcon;
  readonly title: string;
  /** `code` 조각은 `` ` `` 로 감싼다. 컴포넌트가 <code> 로 바꿔 그린다. */
  readonly details: string;
}

export interface LandingStep {
  readonly title: string;
  readonly details: string;
  readonly command: string;
}

export interface LandingDocCard {
  readonly icon: "bolt" | "book" | "code" | "gear";
  readonly title: string;
  readonly details: string;
  readonly link: string;
}

export type LandingIcon = "terminal" | "file" | "repeat" | "server" | "record" | "shield";

export interface LandingCopy {
  readonly heroLine1: string;
  readonly heroLine2: string;
  readonly heroLead: string;
  readonly primary: LandingLink;
  readonly copyLabel: string;
  readonly copiedLabel: string;
  readonly terminalCaption: string;
  readonly statement: {
    readonly strong: string;
    readonly rest: string;
    readonly code: string;
    readonly tail: string;
  };
  readonly checks: readonly string[];
  readonly features: {
    readonly eyebrow: string;
    readonly title: string;
    readonly lead: string;
    readonly cards: readonly LandingCard[];
  };
  readonly dashboard: {
    readonly eyebrow: string;
    readonly title: readonly [string, string];
    readonly lead: string;
    readonly points: readonly string[];
    readonly menu: readonly string[];
    readonly suitesLabel: string;
    readonly statusPassed: string;
    readonly statusFailed: string;
    readonly statusNotRun: string;
    readonly runLabel: string;
  };
  readonly steps: {
    readonly eyebrow: string;
    readonly title: string;
    readonly items: readonly LandingStep[];
  };
  readonly docs: {
    readonly eyebrow: string;
    readonly title: string;
    readonly cards: readonly LandingDocCard[];
  };
  readonly footer: {
    readonly tagline: string;
    readonly columns: readonly { readonly title: string; readonly links: readonly LandingLink[] }[];
    readonly bottom: string;
  };
}

const REPO = "https://github.com/2026-Engineering-Contest/MCPeak";
const NPM = "https://www.npmjs.com/package";

const packagesColumn = (title: string) => ({
  title,
  links: [
    { text: "@mcpeak/cli", link: `${NPM}/@mcpeak/cli` },
    { text: "@mcpeak/mock", link: `${NPM}/@mcpeak/mock` },
    { text: "@mcpeak/dashboard", link: `${NPM}/@mcpeak/dashboard` },
    { text: "@mcpeak/optimize", link: `${NPM}/@mcpeak/optimize` },
  ],
});

export const REPO_URL = REPO;
export const INSTALL_COMMAND = "npm install -g @mcpeak/cli";

const ko: LandingCopy = {
  heroLine1: "MCP 서버 테스트,",
  heroLine2: "실패하면 이유를 문장으로",
  heroLead:
    "MCP 서버를 코드로 자동 테스트한다. 서버를 띄우고, 응답을 검증하고, 외부 호출을 녹화·재생하고, 목 서버로 대체하는 것을 하나의 도구로 한다.",
  primary: { text: "빠른 시작", link: "/ko/quick-start" },
  copyLabel: "설치 명령 복사",
  copiedLabel: "복사했습니다",
  terminalCaption: "실패한 케이스는 무엇이 다른지, 왜 다른지, 어떻게 고치는지를 찍는다",
  statement: {
    strong: "실패 메시지가 곧 제품이다.",
    rest: " 테스트 도구의 화면은 실패했을 때 터미널에 찍히는 문장이다. ",
    code: "expected true, got false",
    tail: " 로 끝내지 않고, 무엇이 왜 다른지와 어떻게 고치는지까지 쓴다.",
  },
  checks: [
    "같은 입력, 같은 결과",
    "사람이 승인한 명세만 고정",
    "외부 호출은 한 번만 녹화",
    "MIT 오픈소스",
  ],
  features: {
    eyebrow: "왜 MCPeak 인가",
    title: "서버를 띄우는 것부터 판정까지, 도구 하나로",
    lead: "명세를 만들고, 서버를 띄우고, 외부 호출을 고정하고, 실패를 문장으로 읽는다.",
    cards: [
      {
        icon: "terminal",
        title: "실패 메시지가 곧 제품",
        details:
          "어느 단언이 무엇과 왜 다른지, 어떻게 고치는지를 터미널에 문장으로 찍는다. 실행 자체가 실패해도 원인 코드와 해결 방법이 나온다.",
      },
      {
        icon: "file",
        title: "스키마에서 명세를 만든다",
        details:
          "서버의 `tools/list` 를 읽어 정상 케이스와 위반 케이스를 결정론적으로 합성하고, 사람이 승인한 명세에만 지문을 찍는다.",
      },
      {
        icon: "repeat",
        title: "같은 입력, 같은 결과",
        details:
          "같은 명세를 두 번 돌려 결과가 같은지 확인한다. 타임스탬프나 실행 순서에 따라 흔들리는 테스트를 먼저 찾아낸다.",
      },
      {
        icon: "server",
        title: "목 서버",
        details:
          "테스트할 서버가 아직 없어도 된다. 목 정의 JSON 하나로 같은 명세를 그대로 통과하는 서버를 띄운다.",
      },
      {
        icon: "record",
        title: "외부 호출 녹화·재생",
        details:
          "서버가 유료 API 를 부른다면 그 HTTP 호출을 한 번만 녹화한다. 이후 실행은 녹화본을 재생해 네트워크 없이 같은 응답을 받는다.",
      },
      {
        icon: "shield",
        title: "Audit · Optimize",
        details:
          "남이 만든 서버를 등록하기 전에 보안 위험을 점검하고, 길어진 도구 정의를 줄여 토큰을 아낀다.",
      },
    ],
  },
  dashboard: {
    eyebrow: "대시보드",
    title: ["터미널 대신", "브라우저에서"],
    lead: "로컬 웹 UI 에서 명세를 고르고 실행하고, `generate` 승인과 `repair` 검토까지 클릭으로 진행한다. 판정은 CLI 와 같은 함수를 부르므로 어느 쪽으로 돌려도 결과가 같다.",
    points: [
      "실행 중 이벤트와 케이스별 결과를 실시간으로",
      "생성 마법사에서 제안된 케이스를 보고 승인",
      "녹화 재생, 토큰·보안 분석을 한 화면에서",
    ],
    menu: ["홈", "실행", "생성 마법사", "Repair 검토", "재생", "분석", "설정"],
    suitesLabel: "명세",
    statusPassed: "통과",
    statusFailed: "실패 1",
    statusNotRun: "미실행",
    runLabel: "실행",
  },
  steps: {
    eyebrow: "시작하기",
    title: "명령 세 줄이면 첫 판정까지",
    items: [
      {
        title: "설치",
        details: "전역 설치 한 번이면 `mcpeak` 명령이 생긴다. 한 번만 쓸 거라면 `npx` 로도 된다.",
        command: INSTALL_COMMAND,
      },
      {
        title: "명세 만들기",
        details: "서버의 스키마를 읽어 케이스를 제안한다. 사람이 승인한 것만 명세 파일로 남는다.",
        command: "mcpeak generate --out weather.suite.json -- node ./server.mjs",
      },
      {
        title: "실행",
        details: "서버를 띄우고 판정한다. 하나라도 실패하면 종료 코드 1 이라 CI 에 그대로 붙는다.",
        command: "mcpeak test weather.suite.json -- node ./server.mjs",
      },
    ],
  },
  docs: {
    eyebrow: "문서",
    title: "문서 둘러보기",
    cards: [
      {
        icon: "bolt",
        title: "빠른 시작",
        details: "설치부터 첫 판정까지 5분",
        link: "/ko/quick-start",
      },
      {
        icon: "book",
        title: "가이드",
        details: "명세 작성·생성, 목 서버, 녹화, 대시보드, CI 연동",
        link: "/ko/guide/writing-suites",
      },
      {
        icon: "code",
        title: "레퍼런스",
        details: "CLI, 명세 형식, 목 정의 형식",
        link: "/ko/reference/cli",
      },
      {
        icon: "gear",
        title: "동작 원리",
        details: "도구가 내부에서 어떻게 맞물리는지",
        link: "/ko/concepts/how-it-works",
      },
    ],
  },
  footer: {
    tagline: "MCP 서버를 코드로 자동 테스트하는 오픈소스 프레임워크.",
    columns: [
      {
        title: "문서",
        links: [
          { text: "빠른 시작", link: "/ko/quick-start" },
          { text: "가이드", link: "/ko/guide/writing-suites" },
          { text: "CLI 레퍼런스", link: "/ko/reference/cli" },
          { text: "FAQ", link: "/ko/faq" },
        ],
      },
      {
        title: "커뮤니티",
        links: [
          { text: "GitHub", link: REPO },
          { text: "이슈", link: `${REPO}/issues` },
          { text: "기여 가이드", link: `${REPO}/blob/main/CONTRIBUTING.md` },
          { text: "보안 정책", link: `${REPO}/blob/main/SECURITY.md` },
        ],
      },
      packagesColumn("패키지"),
    ],
    bottom: "MIT License · VitePress 로 만듦",
  },
};

const en: LandingCopy = {
  heroLine1: "Test your MCP servers,",
  heroLine2: "and read why they fail",
  heroLead:
    "Test MCP servers automatically with code. One tool starts the server, validates responses, records and replays external calls, and substitutes a mock server.",
  primary: { text: "Quick Start", link: "/quick-start" },
  copyLabel: "Copy install command",
  copiedLabel: "Copied",
  terminalCaption: "A failed case says what differs, why, and how to fix it",
  statement: {
    strong: "The failure message is the product.",
    rest: " A test tool's real interface is the sentence it prints when something fails. Instead of stopping at ",
    code: "expected true, got false",
    tail: ", MCPeak says what differs, why, and how to fix it.",
  },
  checks: [
    "Same input, same result",
    "Only approved suites are pinned",
    "External calls recorded once",
    "MIT open source",
  ],
  features: {
    eyebrow: "Why MCPeak",
    title: "From starting the server to the verdict, in one tool",
    lead: "Generate a suite, start the server, pin external calls, and read failures as sentences.",
    cards: [
      {
        icon: "terminal",
        title: "The failure message is the product",
        details:
          "When a test fails, the terminal prints which assertion differs from what, why, and how to fix it. Even when the run itself fails, you get a cause code and a fix.",
      },
      {
        icon: "file",
        title: "Generate suites from schemas",
        details:
          "It reads the server's `tools/list`, deterministically synthesizes passing and violation cases, and stamps a fingerprint only on suites a person has approved.",
      },
      {
        icon: "repeat",
        title: "Same input, same result",
        details:
          "Running the same suite twice confirms the results match, so tests that wobble on timestamps or ordering surface early.",
      },
      {
        icon: "server",
        title: "Mock server",
        details:
          "No server yet? One mock definition JSON starts a server that passes the same suite.",
      },
      {
        icon: "record",
        title: "Record and replay external calls",
        details:
          "If the server calls a paid API, its HTTP calls are recorded once. Later runs replay the recording and get the same responses without the network.",
      },
      {
        icon: "shield",
        title: "Audit · Optimize",
        details:
          "Check a third-party server for security risks before registering it, and shrink long tool definitions to save tokens.",
      },
    ],
  },
  dashboard: {
    eyebrow: "Dashboard",
    title: ["In the browser,", "not the terminal"],
    lead: "Pick and run suites in a local web UI, and approve `generate` proposals or review `repair` results with a click. The verdict calls the same functions as the CLI, so both give the same result.",
    points: [
      "Live events and per-case results while a run is in progress",
      "Review and approve proposed cases in the generate wizard",
      "Replay recordings and analyze tokens and security in one place",
    ],
    menu: ["Home", "Runs", "Generate", "Repair", "Replay", "Analyze", "Settings"],
    suitesLabel: "Suites",
    statusPassed: "Passed",
    statusFailed: "1 failed",
    statusNotRun: "Not run",
    runLabel: "Run",
  },
  steps: {
    eyebrow: "Get started",
    title: "Three commands to your first verdict",
    items: [
      {
        title: "Install",
        details:
          "One global install gives you the `mcpeak` command. For a one-off run, `npx` works too.",
        command: INSTALL_COMMAND,
      },
      {
        title: "Generate a suite",
        details:
          "It reads the server's schemas and proposes cases. Only what a person approves is saved.",
        command: "mcpeak generate --out weather.suite.json -- node ./server.mjs",
      },
      {
        title: "Run",
        details:
          "It starts the server and judges it. Any failure exits with code 1, so it drops straight into CI.",
        command: "mcpeak test weather.suite.json -- node ./server.mjs",
      },
    ],
  },
  docs: {
    eyebrow: "Docs",
    title: "Explore the docs",
    cards: [
      {
        icon: "bolt",
        title: "Quick Start",
        details: "From install to first verdict in five minutes",
        link: "/quick-start",
      },
      {
        icon: "book",
        title: "Guide",
        details: "Writing and generating suites, mocks, recording, dashboard, CI",
        link: "/guide/writing-suites",
      },
      {
        icon: "code",
        title: "Reference",
        details: "CLI, suite spec, mock definition",
        link: "/reference/cli",
      },
      {
        icon: "gear",
        title: "How It Works",
        details: "How the pieces fit together inside",
        link: "/concepts/how-it-works",
      },
    ],
  },
  footer: {
    tagline: "An open-source framework for testing MCP servers automatically with code.",
    columns: [
      {
        title: "Docs",
        links: [
          { text: "Quick Start", link: "/quick-start" },
          { text: "Guide", link: "/guide/writing-suites" },
          { text: "CLI Reference", link: "/reference/cli" },
          { text: "FAQ", link: "/faq" },
        ],
      },
      {
        title: "Community",
        links: [
          { text: "GitHub", link: REPO },
          { text: "Issues", link: `${REPO}/issues` },
          { text: "Contributing", link: `${REPO}/blob/main/CONTRIBUTING.md` },
          { text: "Security", link: `${REPO}/blob/main/SECURITY.md` },
        ],
      },
      packagesColumn("Packages"),
    ],
    bottom: "MIT License · Built with VitePress",
  },
};

export const landingCopy = (lang: string): LandingCopy => (lang.startsWith("ko") ? ko : en);

// ── 터미널 ──────────────────────────────────────────────────────────────

export interface LogLine {
  readonly kind: "cmd" | "head" | "pass" | "fail" | "note" | "fix" | "sum" | "gap";
  readonly text: string;
}

/** 앞에 놓인 터미널. `quick-start.md` 예시와 `runner/src/reporter.ts` 요약 형식을 그대로 옮겼다. */
export const DEMO_COMMAND = "mcpeak test weather.suite.json -- node ./server.mjs";

/**
 * 배경에 흐르는 두 창의 로그. 날씨 서버는 실제 출력이고, 나머지는 장식이다 —
 * 흐리게 깔려 읽히지 않는 자리라 문구를 실제 출력에 맞추지 않았다.
 */
export const BACKGROUND_LOGS: readonly {
  readonly title: string;
  readonly lines: readonly LogLine[];
}[] = [
  {
    title: "zsh — weather-server",
    lines: [
      { kind: "cmd", text: "mcpeak test weather.suite.json -- node ./server.mjs" },
      { kind: "head", text: "날씨 서버  (3 cases)" },
      { kind: "pass", text: "tool-exists     get_weather 도구를 제공한다" },
      { kind: "pass", text: "seoul-succeeds  서울 날씨를 정상 조회한다" },
      { kind: "fail", text: "missing-tool    존재하지 않는 도구를 요구한다" },
      { kind: "note", text: "toolExists  툴 'missing_weather_tool'을(를) 찾을 수 없습니다" },
      { kind: "fix", text: "서버의 tools/list 응답과 테스트 명세를 확인하세요." },
      { kind: "sum", text: "2 passed, 1 failed  (3 total)" },
      { kind: "gap", text: " " },
      { kind: "cmd", text: "mcpeak test calendar.suite.json -- node ./calendar.mjs" },
      { kind: "head", text: "일정 서버  (4 cases)" },
      { kind: "pass", text: "list-events     list_events 도구를 제공한다" },
      { kind: "pass", text: "create-event    일정을 만든다" },
      { kind: "pass", text: "invalid-date    잘못된 날짜를 거부한다" },
      { kind: "pass", text: "empty-title     빈 제목을 거부한다" },
      { kind: "sum", text: "4 passed  (4 total)" },
      { kind: "gap", text: " " },
    ],
  },
  {
    title: "zsh — search-server",
    lines: [
      { kind: "cmd", text: "mcpeak test search.suite.json -- node ./search.mjs" },
      { kind: "head", text: "검색 서버  (3 cases)" },
      { kind: "pass", text: "search-basic    검색어로 결과를 받는다" },
      { kind: "fail", text: "limit-range     limit 상한을 넘기면 거부한다" },
      { kind: "note", text: "isError  오류 응답을 기대했지만 정상 응답이 왔습니다" },
      { kind: "pass", text: "empty-query     빈 검색어를 거부한다" },
      { kind: "sum", text: "2 passed, 1 failed  (3 total)" },
      { kind: "gap", text: " " },
      { kind: "cmd", text: "mcpeak test files.suite.json -- node ./files.mjs" },
      { kind: "head", text: "파일 서버  (3 cases)" },
      { kind: "pass", text: "read-file       파일을 읽는다" },
      { kind: "pass", text: "path-escape     상위 경로 접근을 막는다" },
      { kind: "pass", text: "large-file      큰 파일은 잘라서 돌려준다" },
      { kind: "sum", text: "3 passed  (3 total)" },
      { kind: "gap", text: " " },
    ],
  },
];
