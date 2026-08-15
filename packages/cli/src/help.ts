export const TEST_USAGE =
  "사용법: ohmymcp test <suite.json> --command <executable> [--arg <value> ...] [--json] [--junit <path>] [--stderr-lines <N>]";

export const GENERATE_USAGE =
  "사용법: ohmymcp generate --suite-id <id> --name <name> --out <suite.json> --command <executable> [--arg <value> ...] [--baseline-only] [--provider <codex|claude>] [--model <model>]";

const COMMANDS = `명령:
  test      JSON 테스트 명세로 MCP 서버를 실행하고 검증합니다.
  generate  MCP 서버의 툴 스키마에서 테스트 명세를 생성합니다.`;

export const GLOBAL_HELP = `OhMyMCP — MCP 서버 테스트 프레임워크

사용법: ohmymcp <명령> [옵션]
        ohmymcp help [명령]

${COMMANDS}

옵션:
  -h, --help  도움말을 표시합니다.
  --version   버전을 표시합니다.

서브커맨드 도움말:
  ohmymcp help <명령>
  ohmymcp <명령> --help
`;

const commandDiscovery = "사용 가능한 명령: test, generate. 전체 도움말: ohmymcp --help";

export const TEST_USAGE_HINT = `${TEST_USAGE} ${commandDiscovery}`;

export const GENERATE_USAGE_HINT = `${GENERATE_USAGE} ${commandDiscovery}`;

export function commandHelp(command: "test" | "generate"): string {
  if (command === "test")
    return `test — JSON 테스트 명세로 MCP 서버를 실행하고 검증합니다.

${TEST_USAGE}
`;
  return `generate — MCP 서버의 툴 스키마에서 테스트 명세를 생성합니다.

${GENERATE_USAGE}
`;
}
