export const TEST_USAGE =
  "사용법: mcpeak test <suite.json> --command <executable> [--arg <value> ...] [--determinism] [--reset-cmd <command>] [--json] [--junit <path>] [--repair-bundle <path>] [--stderr-lines <N>] [--session <path> | --record-session <path>]";

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
                        않으므로 파이프나 && 는 쓸 수 없습니다
  --record-session <path>
                        서버가 \`globalThis.fetch\` 로 밖에 부른 HTTP 호출만 녹화합니다.
                        서버는 실제로 실행됩니다. \`node:http\`·\`node:https\` 같은 범위 밖 호출은
                        잡히지 않아 실제 네트워크로 나갈 수 있습니다
  --session <path>      녹화한 외부 호출을 재생합니다. 서버는 실제로 실행되지만 외부
                        API 호출은 \`globalThis.fetch\` 범위 안에서만 가로챕니다.
                        범위 밖 호출은 실제 네트워크로 나갈 수 있으며, 범위 밖 호출이
                        의심되는 경우 종료 때 알립니다

두 세션 옵션은 서로, 그리고 \`--determinism\` 과 함께 쓸 수 없습니다. \`--determinism\` 은 서버에
2회 연결하는데 세션은 연결 하나에 묶여 있어, 2회차가 같은 세션을 쓰면 반복 호출 순번이
어긋나고 새 세션을 쓰면 비교 기준이 갈라집니다.

세션 파일에는 외부 API 응답이 저장되므로 .gitignore 를 확인하세요. \`token\`·\`apiKey\` 같은
이름의 값은 저장 전에 가려집니다.

런타임에 따라 세션 옵션을 쓴 실행에서 \`ExperimentalWarning: SQLite is an experimental
feature\` 가 stderr 에 한 줄 찍힙니다(실측: Node 22.18.0 에서 나오고 24.16.0 에서는 안 납니다).
\`node:sqlite\` 를 처음 로드할 때 한 번 나오므로 실행당 한 줄이며, 세션 옵션이 없는 실행에는
붙지 않습니다. Node 가 그 모듈을 아직 실험적으로 표시한다는 뜻이고, **저장된 녹화는 표준
SQLite 파일이라 영향받지 않습니다.**`;

export const GENERATE_USAGE =
  "사용법: mcpeak generate --suite-id <id> --name <name> --out <suite.json> --command <executable> [--arg <value> ...] [--baseline-only] [--provider <codex|claude>] [--model <model>] [--no-dry-run] [--reset-cmd <command>] [--no-repair] [--force]";

/**
 * 시험 실행 옵션 설명. 사용법 한 줄로는 `--reset-cmd` 가 셸을 거치지 않는다는 제약을 알 수
 * 없다. 모르고 쓰면 사고가 나는 값이다.
 */
const GENERATE_DRY_RUN_OPTIONS = `옵션:
  --no-dry-run          승인 전 시험 실행을 건너뜁니다. 케이스가 실제 서버에서 확인되지
                        않은 채 저장됩니다
  --reset-cmd <command> 시험 실행 전에 이 명령을 한 번 실행합니다. 셸을 거치지 않으므로
                        파이프나 && 는 쓸 수 없습니다
  --no-repair           시험 실행이 실패해도 입력값을 고쳐 다시 시도하지 않습니다.
                        실패가 곧바로 분류 화면으로 갑니다
  --force               \`--out\` 경로에 파일이 있으면 지우고 새로 씁니다. 기본은 저장을
                        멈추는 것입니다`;

export const REPAIR_USAGE =
  "사용법: mcpeak repair <bundle.json> --provider <codex|claude> --model <model> [--max-cases <N>] [--no-stderr] [--yes]";

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
const COMMANDS = `명령:
  test      JSON 테스트 명세로 MCP 서버를 실행하고 검증합니다.
  generate  MCP 서버의 툴 스키마에서 테스트 명세를 생성합니다.
  repair    실패한 test 실행의 번들로 서버 코드의 원인 후보를 제안받습니다.`;

export const GLOBAL_HELP = `MCPeak — MCP 서버 테스트 프레임워크

사용법: mcpeak <명령> [옵션]
        mcpeak help [명령]

${COMMANDS}

옵션:
  -h, --help  도움말을 표시합니다.
  --version   버전을 표시합니다.

서브커맨드 도움말:
  mcpeak help <명령>
  mcpeak <명령> --help
`;

const commandDiscovery = "사용 가능한 명령: test, generate, repair. 전체 도움말: mcpeak --help";

export const TEST_USAGE_HINT = `${TEST_USAGE} ${commandDiscovery}`;

export const GENERATE_USAGE_HINT = `${GENERATE_USAGE} ${commandDiscovery}`;

export const REPAIR_USAGE_HINT = `${REPAIR_USAGE} ${commandDiscovery}`;

export function commandHelp(command: "test" | "generate" | "repair"): string {
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
  return `generate — MCP 서버의 툴 스키마에서 테스트 명세를 생성합니다.

${GENERATE_USAGE}

${GENERATE_DRY_RUN_OPTIONS}
`;
}
