export const TEST_USAGE =
  "사용법: ohmymcp test <suite.json> --command <executable> [--arg <value> ...] [--determinism] [--reset-cmd <command>] [--json] [--junit <path>] [--repair-bundle <path>] [--stderr-lines <N>]";

/**
 * 시험 실행 옵션 설명. `--determinism` 은 툴을 2회 호출하므로 부작용이 있는 서버에서 모르고
 * 쓰면 사고가 난다. 그 경고가 사용법 한 줄에는 들어가지 않는다.
 */
const TEST_OPTIONS = `옵션:
  --determinism         스위트를 2회 실행해 결과가 같은지 확인합니다. 툴을 2회
                        호출하므로 부작용이 있는 서버에서는 샌드박스에서 쓰세요.
                        --reset-cmd 와 함께 쓰면 결정론성 확인이 되고, 없으면
                        "2회 결과가 같았다" 까지만 확인합니다
  --reset-cmd <command> 각 시험 실행 전에 이 명령을 한 번 실행합니다. 셸을 거치지
                        않으므로 파이프나 && 는 쓸 수 없습니다`;

export const GENERATE_USAGE =
  "사용법: ohmymcp generate --suite-id <id> --name <name> --out <suite.json> --command <executable> [--arg <value> ...] [--baseline-only] [--provider <codex|claude>] [--model <model>] [--no-dry-run] [--cassette <path>] [--record] [--reset-cmd <command>] [--no-repair] [--force]";

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
                        실패가 곧바로 분류 화면으로 갑니다
  --force               \`--out\` 경로에 파일이 있으면 지우고 새로 씁니다. 기본은 저장을
                        멈추는 것입니다`;

export const REPAIR_USAGE =
  "사용법: ohmymcp repair <bundle.json> --provider <codex|claude> --model <model> [--max-cases <N>] [--no-stderr] [--yes]";

/**
 * repair 옵션 설명. 사용법 한 줄로는 `--no-stderr` 가 무엇을 빼는지, `--yes` 가 무엇을 건너뛰는지
 * 알 수 없다. 둘 다 외부 provider 로 나가는 내용을 바꾸는 값이다.
 */
const REPAIR_OPTIONS = `옵션:
  --provider <id>    진단을 물을 AI CLI 입니다. codex 또는 claude. 기본값은 없습니다
  --model <model>    provider 에 넘길 모델 식별자입니다. 기본값은 없습니다
  --max-cases <N>    한 번에 보낼 실패 개수 상한입니다. 넘으면 앞에서부터 남깁니다
  --no-stderr        서버 stderr 를 전송에서 뺍니다. stderr 는 서버가 자유롭게 쓰는
                     텍스트라 경로·토큰·데이터가 섞일 수 있습니다
  --yes              전송 확인 화면을 건너뜁니다. 비대화형 환경에서 필요합니다`;

export const REPLAY_USAGE = "사용법: ohmymcp replay <suite.json> --cassette <path>";

/**
 * 재생이 무엇을 하지 않는지가 이 명령의 핵심이다. 서버를 안 띄운다는 것과, 마스킹된 값에서는
 * 판정이 실제와 갈릴 수 있다는 것을 한 줄 사용법으로는 알 수 없다. ADR-0028.
 */
const REPLAY_OPTIONS = `옵션:
  --cassette <path>  재생할 카세트 파일입니다. 필수입니다.

replay 는 MCP 서버를 실행하지 않고 카세트에 녹화된 응답만 돌려줍니다. 카세트에 없는 호출을
만나면 실패합니다. 녹화는 \`ohmymcp generate --cassette <path> --record\` 로 합니다.

카세트는 저장할 때 \`token\`·\`apiKey\` 같은 이름의 값을 가립니다. 그 자리의 판정은 실제 서버와
다를 수 있어 재생 시 경고합니다.`;

const COMMANDS = `명령:
  test      JSON 테스트 명세로 MCP 서버를 실행하고 검증합니다.
  generate  MCP 서버의 툴 스키마에서 테스트 명세를 생성합니다.
  repair    실패한 test 실행의 번들로 서버 코드의 원인 후보를 제안받습니다.
  replay    녹화된 카세트로 서버 없이 테스트 명세를 재생합니다.`;

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

const commandDiscovery =
  "사용 가능한 명령: test, generate, repair, replay. 전체 도움말: ohmymcp --help";

export const TEST_USAGE_HINT = `${TEST_USAGE} ${commandDiscovery}`;

export const GENERATE_USAGE_HINT = `${GENERATE_USAGE} ${commandDiscovery}`;

export const REPAIR_USAGE_HINT = `${REPAIR_USAGE} ${commandDiscovery}`;

export const REPLAY_USAGE_HINT = `${REPLAY_USAGE} ${commandDiscovery}`;

export function commandHelp(command: "test" | "generate" | "repair" | "replay"): string {
  if (command === "test")
    return `test — JSON 테스트 명세로 MCP 서버를 실행하고 검증합니다.

${TEST_USAGE}

${TEST_OPTIONS}
`;
  if (command === "repair")
    return `repair — 실패한 test 실행의 번들로 서버 코드의 원인 후보를 제안받습니다.

${REPAIR_USAGE}

${REPAIR_OPTIONS}
`;
  if (command === "replay")
    return `replay — 녹화된 카세트로 서버 없이 테스트 명세를 재생합니다.

${REPLAY_USAGE}

${REPLAY_OPTIONS}
`;
  return `generate — MCP 서버의 툴 스키마에서 테스트 명세를 생성합니다.

${GENERATE_USAGE}

${GENERATE_DRY_RUN_OPTIONS}
`;
}
