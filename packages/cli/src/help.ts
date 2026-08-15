export const TEST_USAGE =
  "사용법: ohmymcp test <suite.json> --command <executable> [--arg <value> ...] [--json] [--junit <path>] [--stderr-lines <N>]";

export const GENERATE_USAGE =
  "사용법: ohmymcp generate --suite-id <id> --name <name> --out <suite.json> --command <executable> [--arg <value> ...] [--baseline-only] [--provider <codex|claude>] [--model <model>] [--no-dry-run] [--cassette <path>] [--record] [--reset-cmd <command>] [--no-repair]";

/**
 * 시험 실행 옵션 설명. 사용법 한 줄로는 `--cassette` 가 무엇을 파일로 남기는지, `--reset-cmd`
 * 가 셸을 거치지 않는다는 제약을 알 수 없다. 둘 다 모르고 쓰면 사고가 나는 값이다.
 */
const GENERATE_DRY_RUN_OPTIONS = `옵션:
  --no-dry-run          승인 전 시험 실행을 건너뜁니다. 케이스가 실제 서버에서 확인되지
                        않은 채 저장됩니다
  --cassette <path>     서버 응답을 녹화·재생합니다. 반복 실행에서 서버를 다시 부르지
                        않습니다. 응답 전문이 저장되므로 .gitignore 를 확인하세요
  --record              카세트를 처음부터 다시 녹화합니다 (--cassette 필요)
  --reset-cmd <command> 시험 실행 전에 이 명령을 한 번 실행합니다. 셸을 거치지 않으므로
                        파이프나 && 는 쓸 수 없습니다
  --no-repair           시험 실행이 실패해도 입력값을 고쳐 다시 시도하지 않습니다.
                        실패가 곧바로 분류 화면으로 갑니다`;

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

${GENERATE_DRY_RUN_OPTIONS}
`;
}
