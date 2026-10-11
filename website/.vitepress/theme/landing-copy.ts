// 첫 페이지(HomeLanding.vue)의 문구. 영어 · 한국어 두 벌을 같은 모양으로 둔다.
// 터미널 출력은 CLI 가 실제로 찍는 한국어 그대로이므로 언어와 상관없이 하나다.

export interface LandingLink {
  readonly text: string;
  readonly link: string;
}

/** 선택한 사람에게 보여 줄 기능 한 줄. */
export interface LandingPersonaFeature {
  readonly icon: LandingIcon;
  /** 이 기능을 꺼내 드는 구체적인 상황. 줄 왼쪽에 작게 붙는다. */
  readonly when: string;
  readonly title: string;
  /** `code` 조각은 `` ` `` 로 감싼다. 컴포넌트가 <code> 로 바꿔 그린다. */
  readonly details: string;
  readonly command: string;
}

export type LandingPersonaId = "developer" | "user";

/** 대시보드 창 오른쪽. 개발자는 명세 목록, 사용자는 분석 화면의 보안 탭을 본다. */
export type LandingDashboardScreen =
  | {
      readonly kind: "suites";
      readonly label: string;
      readonly passed: string;
      readonly failed: string;
      readonly notRun: string;
      readonly run: string;
    }
  | {
      readonly kind: "analyze";
      readonly tabs: readonly [string, string];
      /** 켜 둘 탭의 순번. */
      readonly activeTab: number;
      readonly summary: string;
      readonly findings: readonly {
        readonly level: "crit" | "warn";
        readonly badge: string;
        readonly rule: string;
        readonly where: string;
      }[];
    };

export interface LandingPersona {
  readonly id: LandingPersonaId;
  /** "나는 MCP [개발자] 입니다" 의 괄호 자리. */
  readonly choice: string;
  /** 고른 뒤 문장 아래에 붙는, 그 사람이 품고 오는 질문. */
  readonly question: string;
  readonly features: readonly LandingPersonaFeature[];
  /** 터미널 아래 안내. 첫 링크가 이 사람의 출발점이다. */
  readonly start: readonly LandingLink[];
  readonly dashboard: {
    readonly title: readonly [string, string];
    readonly lead: string;
    readonly points: readonly string[];
    readonly command: string;
    /** 창 왼쪽 메뉴에서 켜 둘 칸의 순번. */
    readonly activeMenu: number;
    readonly screen: LandingDashboardScreen;
  };
  readonly steps: {
    readonly title: string;
    readonly items: readonly LandingStep[];
  };
  readonly docs: {
    readonly title: string;
    readonly cards: readonly LandingDocCard[];
  };
}

export interface LandingStep {
  readonly title: string;
  readonly details: string;
  readonly command: string;
}

export interface LandingDocCard {
  readonly icon: "bolt" | "book" | "code" | "gear" | "shield" | "shrink" | "layout";
  readonly title: string;
  readonly details: string;
  readonly link: string;
}

export type LandingIcon =
  | "terminal"
  | "file"
  | "repeat"
  | "server"
  | "record"
  | "shield"
  | "shrink"
  | "layout"
  | "wrench"
  | "box";

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
  /** 고른 사람에 따라 이 문장 아래 섹션이 전부 바뀐다. */
  readonly personas: {
    /** 문장 "나는 MCP [개발자 / 사용자] 입니다" 의 앞뒤. */
    readonly before: string;
    readonly after: string;
    readonly choiceLabel: string;
    readonly startLabel: string;
    readonly items: readonly [LandingPersona, LandingPersona];
  };
  readonly dashboard: {
    readonly eyebrow: string;
    readonly menu: readonly string[];
  };
  readonly steps: { readonly eyebrow: string };
  readonly docs: { readonly eyebrow: string };
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
  heroLine1: "MCP를 더 견고하게,",
  heroLine2: "실패하면 고칠 곳까지 알려준다",
  heroLead:
    "MCP를 코드로 자동 테스트한다. 서버를 띄우고, 응답을 검증하고, 외부 호출을 녹화·재생하고, 목 서버로 대체하는 것을 하나의 도구로 한다.",
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
  personas: {
    before: "나는 MCP",
    after: "입니다",
    choiceLabel: "개발자인지 사용자인지 고르기",
    startLabel: "여기서 시작",
    items: [
      {
        id: "developer",
        choice: "개발자",
        question: "내가 만든 MCP가 제대로 동작하는지 확인하고 싶다",
        features: [
          {
            icon: "file",
            when: "명세 파일이 아직 없을 때",
            title: "스키마에서 명세 생성",
            details:
              "`tools/list` 를 읽어 정상 케이스와 위반 케이스를 제안하고, 사람이 승인한 것만 명세로 남긴다.",
            command: "mcpeak generate --out weather.suite.json -- node ./server.mjs",
          },
          {
            icon: "terminal",
            when: "서버 코드를 고친 뒤",
            title: "판정과 실패 문장",
            details:
              "무엇이 왜 다른지, 어떻게 고치는지 찍는다. 하나라도 실패하면 종료 코드 1 이라 CI 에 그대로 붙는다.",
            command: "mcpeak test weather.suite.json -- node ./server.mjs",
          },
          {
            icon: "server",
            when: "서버 코드가 아직 없을 때",
            title: "목 MCP",
            details: "정의 JSON 하나로 같은 명세를 그대로 통과하는 MCP를 띄운다.",
            command: "mcpeak test weather.suite.json -- mcpeak-mock weather.mock.json",
          },
          {
            icon: "record",
            when: "서버가 날씨·결제 같은 외부 API 를 부를 때",
            title: "외부 호출 녹화·재생",
            details:
              "한 번만 진짜로 부르고, 이후 실행은 녹화본을 재생해 네트워크 없이 같은 응답을 받는다.",
            command:
              "mcpeak test weather.suite.json --record-session weather.session.db -- node ./server.mjs",
          },
          {
            icon: "repeat",
            when: "같은 명세가 돌릴 때마다 다른 결과를 낼 때",
            title: "결정론 검사",
            details:
              "같은 명세를 서버에 두 번 돌려 결과를 비교한다. 타임스탬프나 실행 순서에 따라 흔들리는 케이스를 찾아낸다.",
            command: "mcpeak test weather.suite.json --determinism -- node ./server.mjs",
          },
          {
            icon: "wrench",
            when: "실패 원인을 서버 코드에서 찾아야 할 때",
            title: "Repair",
            details:
              "`--repair-bundle` 로 실패 근거를 파일에 남기고, 그 파일을 AI 에게 넘겨 서버 코드의 원인 후보를 받는다.",
            command: "mcpeak repair repair.json --provider claude --model sonnet",
          },
        ],
        start: [
          { text: "빠른 시작", link: "/ko/quick-start" },
          { text: "명세 생성", link: "/ko/guide/generate" },
          { text: "목 서버", link: "/ko/guide/mock-server" },
        ],
        dashboard: {
          title: ["터미널 대신", "브라우저에서"],
          lead: "로컬 웹 UI 에서 명세를 고르고 실행하고, `generate` 승인과 `repair` 검토까지 클릭으로 진행한다. 판정은 CLI 와 같은 함수를 부르므로 어느 쪽으로 돌려도 결과가 같다.",
          points: [
            "실행 중 이벤트와 케이스별 결과를 실시간으로",
            "생성 마법사에서 제안된 케이스를 보고 승인",
            "녹화 재생과 Repair 검토를 한 화면에서",
          ],
          command: "npm install -g @mcpeak/dashboard && mcpeak-dashboard",
          activeMenu: 0,
          screen: {
            kind: "suites",
            label: "명세",
            passed: "통과",
            failed: "실패 1",
            notRun: "미실행",
            run: "실행",
          },
        },
        steps: {
          title: "명령 세 줄이면 첫 판정까지",
          items: [
            {
              title: "설치",
              details:
                "전역 설치 한 번이면 `mcpeak` 명령이 생긴다. 한 번만 쓸 거라면 `npx` 로도 된다.",
              command: INSTALL_COMMAND,
            },
            {
              title: "명세 만들기",
              details:
                "서버의 스키마를 읽어 케이스를 제안한다. 사람이 승인한 것만 명세 파일로 남는다.",
              command: "mcpeak generate --out weather.suite.json -- node ./server.mjs",
            },
            {
              title: "실행",
              details:
                "서버를 띄우고 판정한다. 하나라도 실패하면 종료 코드 1 이라 CI 에 그대로 붙는다.",
              command: "mcpeak test weather.suite.json -- node ./server.mjs",
            },
          ],
        },
        docs: {
          title: "개발자용 문서",
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
              details: "명세 작성·생성, 목 서버, 녹화, 결정론, CI 연동",
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
      },
      {
        id: "user",
        choice: "사용자",
        question: "MCP를 내 클라이언트에 믿고 사용해도 되는지 알고 싶다",
        features: [
          {
            icon: "shield",
            when: "MCP 클라이언트에 등록하기 전에",
            title: "Audit · 보안 점검",
            details:
              "도구 설명 속 모델 지시, 환경변수 유출, 비밀값 인자, 버전을 고정하지 않은 실행 명령을 찾는다. 서버 코드는 건드리지 않는다.",
            command: "mcpeak audit --command npx --arg -y --arg some-mcp-server@1.2.3",
          },
          {
            icon: "box",
            when: "서버를 내 컴퓨터에서 바로 띄우기 꺼려질 때",
            title: "격리 점검",
            details:
              "버려지는 Docker 컨테이너 안에서 띄우고 모든 도구를 불러, 그동안 연 파일·띄운 프로세스·나간 요청을 기록한다.",
            command: "mcpeak audit --sandbox -- npx -y some-mcp-server@1.2.3",
          },
          {
            icon: "shrink",
            when: "도구 정의가 길어 토큰을 많이 차지할 때",
            title: "Optimize · 토큰 절감",
            details:
              "도구 정의를 뜻은 그대로 두고 줄인 오버레이를 만들어 프록시로 꽂는다. 바뀌는 것은 `tools/list` 뿐이고, 서버가 바뀌면 프록시가 서비스를 멈추고 다시 만들라고 알린다.",
            command: "mcpeak optimize --out ./server.optimize.json -- npx -y some-mcp-server@1.2.3",
          },
        ],
        start: [
          { text: "Audit", link: "/ko/guide/audit" },
          { text: "Optimize", link: "/ko/guide/optimize" },
          { text: "대시보드", link: "/ko/guide/dashboard" },
        ],
        dashboard: {
          title: ["점검 결과를", "브라우저에서"],
          lead: "대시보드의 분석 화면에서 보안 탭은 Audit 점검 결과를, 토큰 탭은 Optimize 압축 리포트를 보여 준다. CLI 와 같은 함수를 부르므로 결과가 같다.",
          points: [
            "보안 탭: 발견을 심각도와 해결 문장까지",
            "토큰 탭: 원본·압축 크기와 줄어든 비율",
            "등록할지 판단할 근거를 한 화면에서",
          ],
          command: "npm install -g @mcpeak/dashboard && mcpeak-dashboard",
          activeMenu: 5,
          screen: {
            kind: "analyze",
            tabs: ["토큰", "보안"],
            activeTab: 1,
            summary: "심각 5 · 주의 1",
            findings: [
              { level: "crit", badge: "심각", rule: "desc/injection", where: "add_numbers" },
              { level: "crit", badge: "심각", rule: "secret/env-leak", where: "echo_env" },
              {
                level: "warn",
                badge: "주의",
                rule: "schema/secret-field",
                where: "translate_text",
              },
            ],
          },
        },
        steps: {
          title: "명령 세 줄이면 등록 판단까지",
          items: [
            {
              title: "설치",
              details:
                "`audit` 와 `optimize` 는 `mcpeak` 에 들어 있다. 클라이언트에 꽂을 프록시는 `@mcpeak/optimize` 가 준다.",
              command: "npm install -g @mcpeak/cli @mcpeak/optimize",
            },
            {
              title: "등록 전 점검",
              details:
                "클라이언트에 넣을 실행 명령 그대로 점검한다. 심각·주의 발견이 있으면 종료 코드 2 다.",
              command: "mcpeak audit -- npx -y some-mcp-server@1.2.3",
            },
            {
              title: "줄여서 꽂기",
              details:
                "`mcpeak optimize --out` 으로 오버레이를 만든 뒤, 클라이언트 설정의 서버 명령 자리에 프록시를 넣는다.",
              command:
                "mcpeak-optimize-proxy ./server.optimize.json -- npx -y some-mcp-server@1.2.3",
            },
          ],
        },
        docs: {
          title: "사용자용 문서",
          cards: [
            {
              icon: "shield",
              title: "Audit",
              details: "등록 전 보안 점검과 발견 읽는 법",
              link: "/ko/guide/audit",
            },
            {
              icon: "shrink",
              title: "Optimize",
              details: "도구 정의를 줄이고 프록시로 꽂기",
              link: "/ko/guide/optimize",
            },
            {
              icon: "layout",
              title: "대시보드",
              details: "분석 화면에서 보안·토큰 결과 보기",
              link: "/ko/guide/dashboard",
            },
            {
              icon: "book",
              title: "FAQ",
              details: "자주 묻는 질문",
              link: "/ko/faq",
            },
          ],
        },
      },
    ],
  },
  dashboard: {
    eyebrow: "대시보드",
    menu: ["홈", "실행", "생성 마법사", "Repair 검토", "재생", "분석", "설정"],
  },
  steps: { eyebrow: "시작하기" },
  docs: { eyebrow: "문서" },
  footer: {
    tagline: "MCP를 코드로 자동 테스트하는 오픈소스 프레임워크.",
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
  heroLine1: "Build sturdier MCP servers,",
  heroLine2: "and see exactly what to fix",
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
  personas: {
    before: "I",
    after: "MCP servers",
    choiceLabel: "Choose whether you build or use MCP servers",
    startLabel: "Start here",
    items: [
      {
        id: "developer",
        choice: "build",
        question: "I want to know my server actually works",
        features: [
          {
            icon: "file",
            when: "No suite file yet",
            title: "Generate suites from schemas",
            details:
              "It reads `tools/list`, proposes passing and violation cases, and saves only what a person approves.",
            command: "mcpeak generate --out weather.suite.json -- node ./server.mjs",
          },
          {
            icon: "terminal",
            when: "After you change server code",
            title: "Verdicts that explain failures",
            details:
              "It prints what differs, why, and how to fix it. Any failure exits with code 1, so it drops straight into CI.",
            command: "mcpeak test weather.suite.json -- node ./server.mjs",
          },
          {
            icon: "server",
            when: "No server code yet",
            title: "Mock server",
            details: "One definition JSON starts a mock that passes the same suite.",
            command: "mcpeak test weather.suite.json -- mcpeak-mock weather.mock.json",
          },
          {
            icon: "record",
            when: "Your server calls a weather, payment, or other external API",
            title: "Record and replay external calls",
            details:
              "Call the real API once. Later runs replay the recording and get the same responses without the network.",
            command:
              "mcpeak test weather.suite.json --record-session weather.session.db -- node ./server.mjs",
          },
          {
            icon: "repeat",
            when: "The same suite gives different results run to run",
            title: "Determinism check",
            details:
              "It runs the suite against the server twice and compares the results, finding cases that wobble on timestamps or ordering.",
            command: "mcpeak test weather.suite.json --determinism -- node ./server.mjs",
          },
          {
            icon: "wrench",
            when: "You need to find the cause in server code",
            title: "Repair",
            details:
              "`--repair-bundle` saves the failure evidence to a file, which you hand to an AI for likely causes in your server code.",
            command: "mcpeak repair repair.json --provider claude --model sonnet",
          },
        ],
        start: [
          { text: "Quick Start", link: "/quick-start" },
          { text: "Generate", link: "/guide/generate" },
          { text: "Mock server", link: "/guide/mock-server" },
        ],
        dashboard: {
          title: ["In the browser,", "not the terminal"],
          lead: "Pick and run suites in a local web UI, and approve `generate` proposals or review `repair` results with a click. The verdict calls the same functions as the CLI, so both give the same result.",
          points: [
            "Live events and per-case results while a run is in progress",
            "Review and approve proposed cases in the generate wizard",
            "Replay recordings and review Repair results in one place",
          ],
          command: "npm install -g @mcpeak/dashboard && mcpeak-dashboard",
          activeMenu: 0,
          screen: {
            kind: "suites",
            label: "Suites",
            passed: "Passed",
            failed: "1 failed",
            notRun: "Not run",
            run: "Run",
          },
        },
        steps: {
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
          title: "Docs for builders",
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
              details: "Writing and generating suites, mocks, recording, determinism, CI",
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
      },
      {
        id: "user",
        choice: "use",
        question: "I want to know whether I can trust an MCP server in my client",
        features: [
          {
            icon: "shield",
            when: "Before you register it in your MCP client",
            title: "Audit",
            details:
              "Finds instructions to the model hidden in tool descriptions, leaked environment variables, secret arguments, and unpinned launch commands. Server code stays untouched.",
            command: "mcpeak audit --command npx --arg -y --arg some-mcp-server@1.2.3",
          },
          {
            icon: "box",
            when: "You'd rather not start the server on your own machine",
            title: "Sandboxed audit",
            details:
              "Starts the server in a throwaway Docker container, calls every tool, and records the files it opened, processes it spawned, and requests it sent.",
            command: "mcpeak audit --sandbox -- npx -y some-mcp-server@1.2.3",
          },
          {
            icon: "shrink",
            when: "Long tool definitions eat your tokens",
            title: "Optimize",
            details:
              "Builds an overlay that shrinks tool definitions without changing their meaning, served through a proxy. Only `tools/list` changes, and if the server changes the proxy stops and asks you to rebuild.",
            command: "mcpeak optimize --out ./server.optimize.json -- npx -y some-mcp-server@1.2.3",
          },
        ],
        start: [
          { text: "Audit", link: "/guide/audit" },
          { text: "Optimize", link: "/guide/optimize" },
          { text: "Dashboard", link: "/guide/dashboard" },
        ],
        dashboard: {
          title: ["Audit results,", "in the browser"],
          lead: "The dashboard's Analyze screen shows Audit findings on the Security tab and the Optimize report on the Tokens tab. It calls the same functions as the CLI, so the results match.",
          points: [
            "Security: findings with severity and a fix sentence",
            "Tokens: original and compressed size, and the reduction",
            "Everything you need to decide whether to register it",
          ],
          command: "npm install -g @mcpeak/dashboard && mcpeak-dashboard",
          activeMenu: 5,
          screen: {
            kind: "analyze",
            tabs: ["Tokens", "Security"],
            activeTab: 1,
            summary: "5 critical · 1 warning",
            findings: [
              { level: "crit", badge: "Critical", rule: "desc/injection", where: "add_numbers" },
              { level: "crit", badge: "Critical", rule: "secret/env-leak", where: "echo_env" },
              {
                level: "warn",
                badge: "Warning",
                rule: "schema/secret-field",
                where: "translate_text",
              },
            ],
          },
        },
        steps: {
          title: "Three commands to a go/no-go",
          items: [
            {
              title: "Install",
              details:
                "`audit` and `optimize` ship with `mcpeak`. The proxy you plug into your client comes from `@mcpeak/optimize`.",
              command: "npm install -g @mcpeak/cli @mcpeak/optimize",
            },
            {
              title: "Audit before registering",
              details:
                "Audit the exact launch command you would put in your client. Critical or warning findings exit with code 2.",
              command: "mcpeak audit -- npx -y some-mcp-server@1.2.3",
            },
            {
              title: "Shrink and plug in",
              details:
                "Build an overlay with `mcpeak optimize --out`, then put the proxy where the server command goes in your client config.",
              command:
                "mcpeak-optimize-proxy ./server.optimize.json -- npx -y some-mcp-server@1.2.3",
            },
          ],
        },
        docs: {
          title: "Docs for users",
          cards: [
            {
              icon: "shield",
              title: "Audit",
              details: "Pre-install security checks and how to read findings",
              link: "/guide/audit",
            },
            {
              icon: "shrink",
              title: "Optimize",
              details: "Shrink tool definitions and plug in the proxy",
              link: "/guide/optimize",
            },
            {
              icon: "layout",
              title: "Dashboard",
              details: "Security and token results on the Analyze screen",
              link: "/guide/dashboard",
            },
            {
              icon: "book",
              title: "FAQ",
              details: "Frequently asked questions",
              link: "/faq",
            },
          ],
        },
      },
    ],
  },
  dashboard: {
    eyebrow: "Dashboard",
    menu: ["Home", "Runs", "Generate", "Repair", "Replay", "Analyze", "Settings"],
  },
  steps: { eyebrow: "Get started" },
  docs: { eyebrow: "Docs" },
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

// ── 개발자 / 사용자 선택 아래 터미널 ─────────────────────────────────────────────

/** 한 줄을 색 조각으로 나눈 것. 빈 배열은 빈 줄이다. */
export type TermTone = "plain" | "dim" | "ok" | "fail" | "warn" | "brand" | "bold";
export type TermLine = readonly { readonly tone: TermTone; readonly text: string }[];

/**
 * 고른 사람 쪽 터미널. 앞 데모처럼 CLI 가 실제로 찍는 출력이라 언어와 상관없이 하나다.
 * generate 는 `guide/generate.md`, audit 는 `guide/audit.md` 의 `examples/audit-target-server`
 * 결과에서 옮겼다(audit 는 앞 두 건만 남기고 줄였다).
 */
export const PERSONA_TERMINALS: Record<
  LandingPersonaId,
  { readonly title: string; readonly lines: readonly TermLine[] }
> = {
  developer: {
    title: "zsh — my-mcp",
    lines: [
      [
        { tone: "dim", text: "$ " },
        {
          tone: "plain",
          text: "mcpeak generate --out weather.suite.json --baseline-only -- node ./server.mjs",
        },
      ],
      [{ tone: "plain", text: "baseline suite를 저장했습니다: weather.suite.json" }],
      [
        { tone: "plain", text: "커버리지  " },
        { tone: "ok", text: "2 tools, 8 axes 전부 검증" },
      ],
      [],
      [
        { tone: "dim", text: "$ " },
        { tone: "plain", text: "mcpeak test weather.suite.json -- node ./server.mjs" },
      ],
      [
        { tone: "bold", text: "날씨 서버  " },
        { tone: "dim", text: "(3 cases)" },
      ],
      [
        { tone: "ok", text: "✓" },
        { tone: "plain", text: " tool-exists     " },
        { tone: "dim", text: "get_weather 도구를 제공한다" },
      ],
      [
        { tone: "ok", text: "✓" },
        { tone: "plain", text: " seoul-succeeds  " },
        { tone: "dim", text: "서울 날씨를 정상 조회한다" },
      ],
      [
        { tone: "fail", text: "✗" },
        { tone: "plain", text: " missing-tool    " },
        { tone: "dim", text: "존재하지 않는 도구를 요구한다" },
      ],
      [
        { tone: "fail", text: "    toolExists" },
        {
          tone: "plain",
          text: "  툴 'missing_weather_tool'을(를) 찾을 수 없습니다. 발견된 툴: 'add', 'get_weather'",
        },
      ],
      [
        { tone: "brand", text: "    해결:" },
        { tone: "plain", text: " 서버의 tools/list 응답과 테스트 명세를 확인하세요." },
      ],
      [],
      [
        { tone: "ok", text: "2 passed" },
        { tone: "plain", text: ", " },
        { tone: "fail", text: "1 failed" },
        { tone: "dim", text: "  (3 total)" },
      ],
    ],
  },
  user: {
    title: "zsh — some-mcp-server",
    lines: [
      [
        { tone: "dim", text: "$ " },
        { tone: "plain", text: "mcpeak audit -- node ./server.mjs" },
      ],
      [{ tone: "bold", text: "mcpeak audit 결과" }],
      [
        {
          tone: "dim",
          text: "서버 audit-target-server 0.0.0 · 도구 6개 · 프롬프트 0개 · 리소스 0개",
        },
      ],
      [],
      [
        { tone: "plain", text: "판정: " },
        { tone: "fail", text: "심각 5건" },
        { tone: "plain", text: ", " },
        { tone: "warn", text: "주의 1건" },
        { tone: "dim", text: ", 낮음 0건, 정보 0건" },
      ],
      [],
      [
        { tone: "fail", text: "[심각]" },
        { tone: "plain", text: " desc/injection · 도구 'add_numbers' 의 description" },
      ],
      [{ tone: "plain", text: '  → 모델에게 내리는 지시가 있습니다: "<IMPORTANT>"' }],
      [
        { tone: "brand", text: "  해결:" },
        { tone: "plain", text: " 이 서버를 신뢰하지 않는다면 등록하지 마세요." },
      ],
      [],
      [
        { tone: "fail", text: "[심각]" },
        { tone: "plain", text: " secret/env-leak · 도구 'echo_env' 호출 응답의 content[0].text" },
      ],
      [{ tone: "plain", text: "  → 환경변수 GITHUB_TOKEN 에 심은 값이 응답에 나왔습니다" }],
      [
        { tone: "brand", text: "  해결:" },
        { tone: "plain", text: " 서버가 환경변수를 읽어 밖으로 냅니다. 등록하지 마세요." },
      ],
    ],
  },
};
