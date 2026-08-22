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
                        서버가 **밖으로 나가는 HTTP 호출**을 녹화합니다. 서버는 실제로
                        실행되고, 그 서버가 부르는 외부 API 의 응답만 파일에 남습니다
  --session <path>      녹화한 외부 호출을 재생합니다. 서버는 실제로 실행되지만 외부
                        API 는 부르지 않습니다. 녹화에 없는 호출을 만나면 실패합니다

두 세션 옵션은 서로, 그리고 \`--determinism\` 과 함께 쓸 수 없습니다. \`--determinism\` 은 서버에
2회 연결하는데 세션은 연결 하나에 묶여 있어, 2회차가 같은 세션을 쓰면 반복 호출 순번이
어긋나고 새 세션을 쓰면 비교 기준이 갈라집니다.

세션은 \`--cassette\` 카세트와 다릅니다. **카세트는 우리가 서버에게 물어본 결과**를 남기고,
**세션은 그 서버가 밖에 물어본 결과**를 남깁니다. 둘은 섞이지 않으며 파일도 따로입니다.

세션 파일에는 외부 API 응답이 저장되므로 .gitignore 를 확인하세요. \`token\`·\`apiKey\` 같은
이름의 값은 저장 전에 가려집니다.`;

export const GENERATE_USAGE =
  "사용법: mcpeak generate --suite-id <id> --name <name> --out <suite.json> --command <executable> [--arg <value> ...] [--baseline-only] [--provider <codex|claude>] [--model <model>] [--no-dry-run] [--cassette <path>] [--record] [--reset-cmd <command>] [--no-repair] [--force]";

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

export const REPLAY_USAGE = "사용법: mcpeak replay <suite.json> --cassette <path>";

/**
 * 재생이 무엇을 하지 않는지가 이 명령의 핵심이다. 서버를 안 띄운다는 것과, 마스킹된 값에서는
 * 판정이 실제와 갈릴 수 있다는 것을 한 줄 사용법으로는 알 수 없다. ADR-0028.
 */
const REPLAY_OPTIONS = `옵션:
  --cassette <path>  재생할 카세트 파일입니다. 필수입니다.

replay 는 MCP 서버를 실행하지 않고 카세트에 녹화된 응답만 돌려줍니다. 카세트에 없는 호출을
만나면 실패합니다. 녹화는 \`mcpeak generate --cassette <path> --record\` 로 합니다.

카세트는 저장할 때 \`token\`·\`apiKey\` 같은 이름의 값을 가립니다. 그 자리의 판정은 실제 서버와
다를 수 있어 재생 시 경고합니다.`;

export const VERIFY_USAGE =
  "사용법: mcpeak verify <cassette.json> --command <executable> [--arg <value> ...]";

/**
 * `verify` 가 무엇을 **하지 않는지**가 이 명령의 핵심이다. 서버를 부르지만 카세트를 고치지
 * 않는다. `--record` 와 헷갈리면 사용자는 지우려던 적이 없는 파일을 지운다.
 *
 * 다만 "읽기 전용" 을 그 한 마디로 끝내면 안 된다. 읽기 전용인 것은 **카세트 파일**이고,
 * 서버 쪽으로는 녹화된 요청을 전부 다시 부른다. 메일 발송·결제·파일 쓰기 툴이 카세트에
 * 들어 있으면 그 부작용이 실제로 다시 일어난다. `--determinism` 이 툴을 2회 부른다는
 * 경고와 같은 성격이라 같은 자리에 적는다.
 */
const VERIFY_OPTIONS = `옵션:
  --command <executable>  MCP 서버 실행 파일입니다. 필수입니다.
  --arg <value>           서버에 넘길 인자입니다. 여러 번 쓸 수 있습니다.

verify 는 카세트에 녹화된 요청을 실서버에 다시 보내 응답이 아직 같은지 확인합니다.
**카세트를 고치지도 저장하지도 않습니다.**

읽기 전용인 것은 카세트 파일입니다. 서버 쪽은 녹화된 요청을 **전부 다시 호출**하므로,
메일 발송·결제·파일 쓰기 같은 툴이 카세트에 있으면 그 부작용이 실제로 다시 일어납니다.
부작용이 있는 서버에서는 샌드박스에서 쓰세요.

auto 모드(\`--record\` 없는 실행)는 카세트에 있는 요청이면 서버를 부르지 않으므로, 서버
응답이 바뀌어도 알아채지 못합니다. 이 명령이 그 드리프트를 확인하는 비파괴 경로입니다.

카세트는 저장할 때 \`token\`·\`apiKey\` 같은 이름의 값을 가립니다. 그 값이 **요청 인자**에
있었다면 원래 요청을 복원할 수 없어 "확인불가" 로 보고합니다. 응답 쪽 비밀값은 양쪽 모두
마스킹해 비교하므로, 비밀값 자체만 바뀐 경우는 감지되지 않습니다.

불일치나 호출 실패가 하나라도 있으면 종료 코드 1 입니다. 확인불가는 실패로 보지 않습니다.`;

const COMMANDS = `명령:
  test      JSON 테스트 명세로 MCP 서버를 실행하고 검증합니다.
  generate  MCP 서버의 툴 스키마에서 테스트 명세를 생성합니다.
  repair    실패한 test 실행의 번들로 서버 코드의 원인 후보를 제안받습니다.
  replay    녹화된 카세트로 서버 없이 테스트 명세를 재생합니다.
  verify    카세트가 아직 실서버 응답과 맞는지 확인합니다 (카세트를 고치지 않음).`;

export const GLOBAL_HELP = `OhMyMCP — MCP 서버 테스트 프레임워크

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

const commandDiscovery =
  "사용 가능한 명령: test, generate, repair, replay, verify. 전체 도움말: mcpeak --help";

export const TEST_USAGE_HINT = `${TEST_USAGE} ${commandDiscovery}`;

export const GENERATE_USAGE_HINT = `${GENERATE_USAGE} ${commandDiscovery}`;

export const REPAIR_USAGE_HINT = `${REPAIR_USAGE} ${commandDiscovery}`;

export const REPLAY_USAGE_HINT = `${REPLAY_USAGE} ${commandDiscovery}`;

export const VERIFY_USAGE_HINT = `${VERIFY_USAGE} ${commandDiscovery}`;

export function commandHelp(command: "test" | "generate" | "repair" | "replay" | "verify"): string {
  if (command === "verify")
    return `verify — 카세트가 아직 실서버 응답과 맞는지 확인합니다.

${VERIFY_USAGE}

${VERIFY_OPTIONS}
`;
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
