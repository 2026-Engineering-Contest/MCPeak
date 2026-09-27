import { defineConfig } from "vitepress";

const sidebar = [
  { text: "Quick Start", link: "/quick-start" },
  {
    text: "Guide",
    items: [
      { text: "Writing a Suite", link: "/guide/writing-suites" },
      { text: "Generating a Suite", link: "/guide/generate" },
      { text: "Mock Server", link: "/guide/mock-server" },
      { text: "External Sessions", link: "/guide/external-sessions" },
      { text: "Determinism Check", link: "/guide/determinism" },
      { text: "Repair", link: "/guide/repair" },
      { text: "Dashboard", link: "/guide/dashboard" },
      { text: "CI Integration", link: "/guide/ci" },
    ],
  },
  {
    text: "Concepts",
    items: [{ text: "How It Works", link: "/concepts/how-it-works" }],
  },
  {
    text: "Reference",
    items: [
      { text: "CLI", link: "/reference/cli" },
      { text: "Suite Spec", link: "/reference/suite-spec" },
      { text: "Mock Definition", link: "/reference/mock-definition" },
    ],
  },
  { text: "FAQ", link: "/faq" },
];

const koSidebar = [
  { text: "빠른 시작", link: "/ko/quick-start" },
  {
    text: "가이드",
    items: [
      { text: "명세 작성", link: "/ko/guide/writing-suites" },
      { text: "명세 생성", link: "/ko/guide/generate" },
      { text: "목 서버", link: "/ko/guide/mock-server" },
      { text: "External 세션", link: "/ko/guide/external-sessions" },
      { text: "결정론성 확인", link: "/ko/guide/determinism" },
      { text: "Repair", link: "/ko/guide/repair" },
      { text: "대시보드", link: "/ko/guide/dashboard" },
      { text: "CI 연동", link: "/ko/guide/ci" },
    ],
  },
  {
    text: "개념",
    items: [{ text: "동작 원리", link: "/ko/concepts/how-it-works" }],
  },
  {
    text: "레퍼런스",
    items: [
      { text: "CLI", link: "/ko/reference/cli" },
      { text: "명세 형식", link: "/ko/reference/suite-spec" },
      { text: "목 정의 형식", link: "/ko/reference/mock-definition" },
    ],
  },
  { text: "FAQ", link: "/ko/faq" },
];

export default defineConfig({
  title: "MCPeak",
  description:
    "Automated testing for MCP servers: declarative suites, generated cases, mocks, and recorded external calls.",
  base: "/MCPeak/",
  appearance: "dark",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    search: {
      provider: "local",
      options: {
        locales: {
          ko: {
            translations: {
              button: {
                buttonText: "검색",
                buttonAriaLabel: "검색",
              },
              modal: {
                displayDetails: "상세 목록 표시",
                resetButtonTitle: "검색 초기화",
                backButtonTitle: "검색 닫기",
                noResultsText: "검색 결과 없음",
                footer: {
                  selectText: "선택",
                  selectKeyAriaLabel: "엔터",
                  navigateText: "이동",
                  navigateUpKeyAriaLabel: "위쪽 화살표",
                  navigateDownKeyAriaLabel: "아래쪽 화살표",
                  closeText: "닫기",
                  closeKeyAriaLabel: "esc",
                },
              },
            },
          },
        },
      },
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/2026-Engineering-Contest/MCPeak" },
      { icon: "npm", link: "https://www.npmjs.com/package/@mcpeak/cli" },
    ],
    outline: "deep",
  },
  locales: {
    root: {
      label: "English",
      lang: "en",
      themeConfig: {
        nav: [
          { text: "Quick Start", link: "/quick-start" },
          { text: "Guide", link: "/guide/writing-suites" },
          { text: "Reference", link: "/reference/cli" },
        ],
        sidebar,
      },
    },
    ko: {
      label: "한국어",
      lang: "ko",
      link: "/ko/",
      description:
        "MCP 서버를 코드로 자동 테스트한다. 선언형 명세, 스키마 기반 생성, 목 서버, 외부 호출 녹화·재생.",
      themeConfig: {
        nav: [
          { text: "빠른 시작", link: "/ko/quick-start" },
          { text: "가이드", link: "/ko/guide/writing-suites" },
          { text: "레퍼런스", link: "/ko/reference/cli" },
        ],
        sidebar: koSidebar,
        outline: { level: "deep", label: "이 페이지 목차" },
        docFooter: {
          prev: "이전 페이지",
          next: "다음 페이지",
        },
        darkModeSwitchLabel: "테마",
        lightModeSwitchTitle: "라이트 모드로 전환",
        darkModeSwitchTitle: "다크 모드로 전환",
        returnToTopLabel: "맨 위로",
        langMenuLabel: "언어 변경",
        sidebarMenuLabel: "메뉴",
        lastUpdatedText: "최종 수정",
      },
    },
  },
});
