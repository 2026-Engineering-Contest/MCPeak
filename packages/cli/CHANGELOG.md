# ohmymcp

## 0.12.0

### Minor Changes

- 72fc934: `--record-session` 녹화가 스위트 경로·서버 명령·인자를 세션 파일에 함께 남깁니다(ADR-0085).
  재생 쪽 CLI 표면은 바뀌지 않으며, 이 정보는 대시보드 Replay 가 원클릭 재생의 재료로 읽습니다.
- b05cb58: 대시보드의 generate 검토 하위 입력에 `검토 메뉴로 돌아가기` 버튼을 추가합니다. 모델, AI 요청,
  피드백, change 선택, JSON 편집 입력을 잘못 열어도 실행을 취소하지 않고 상위 검토 메뉴로 돌아갈
  수 있습니다.

### Patch Changes

- Updated dependencies [b0a63f1]
  - @mcpeak/record@0.5.0

## 0.11.0

### Minor Changes

- 9d6f760: 녹화가 끝나면 **세션 파일 본문에 URL 이 몇 건 남았는지** 알립니다([ADR-0062](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0062-세션-본문의-url-은-지우지-않고-알린다.md), [#311](https://github.com/2026-Engineering-Contest/MCPeak/issues/311)).

  마스킹은 이름으로 판정하는데 URL 경로에는 판정에 쓸 이름이 없습니다. 그래서 경로 자체가
  자격증명인 endpoint(Slack·Discord webhook 등)가 자기 URL 을 본문으로 되돌려주면 그 값이 세션
  파일에 원문으로 남습니다. 지금까지는 그 사실을 알 방법이 README 한 줄뿐이었고, 세션은 SQLite 라
  눈으로 훑을 수도 없었습니다.

  ```
  알림: 세션 파일 본문에 URL 이 3건 남아 있습니다.
    되돌아온 경로 1건 — 이 실행의 요청 경로가 본문에 그대로 실렸습니다
    그 밖의 URL 2건
  → 경로 자체가 자격증명인 endpoint(Slack·Discord webhook 등)를 녹화했다면 그 값이 세션 파일에
    원문으로 들어 있습니다. 이름으로 판정할 수 없는 자리라 마스킹이 닿지 않습니다.
  → 커밋하기 전에 세션 파일 내용을 확인하세요. 이미 커밋했다면 그 자격증명을 폐기·재발급하세요.
  ```

  **개수만 말하고 URL 은 싣지 않습니다.** 알림이 새 유출 경로가 되면 고치려던 것을 그 자리에서
  다시 만들기 때문입니다. 재생에는 나오지 않습니다 — 이미 있는 파일을 읽을 뿐이라 새로 남는 것이
  없습니다. 세지 못한 것이 있으면 "N건 이상" 으로 알립니다.

  `mcpeak help test` 의 세션 파일 안내에도 이 한계를 적었습니다.

- 2db017e: External 세션이 **성공했을 때도** 무엇을 했는지 알립니다([ADR-0066](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0066-external-세션은-성공했을-때도-무엇을-했는지-말한다.md)).

  지금까지 세션 알림은 이상할 때만 말했습니다. 그래서 녹화 실행과 재생 실행의 출력이 **바이트까지
  같았습니다** — 방금 본 초록색이 실제 외부 API 를 부른 결과인지 녹화본을 재생한 결과인지 화면만
  봐서는 구분할 수 없었습니다. 판정이 같아도 그 판정의 근거는 다른 사실입니다.

  ```
  → 외부 호출 3건을 녹화했습니다: tmp/weather.db
  → 녹화된 외부 호출 3건을 재생했습니다: tmp/weather.db
  ```

  기존 경고와 **정확히 배타**입니다 — 경고가 말하는 갈래(녹화 0건, 재생 원본 0건, 미재생 등)에서는
  이 줄이 나오지 않으므로 같은 사실을 두 번 말하지 않습니다.

  stderr 로 나갑니다. stdout 리포트와 `--json` 출력은 바뀌지 않았고, 세션 옵션 없이 돌리는 실행도
  바뀌지 않았습니다. 대시보드는 stderr 를 이미 렌더하므로 이 변경만으로 화면에서도 녹화와 재생이
  구분됩니다.

  개수 옆에 단서를 한 줄 붙입니다 — `이 수는 어댑터가 잡은 호출만 셉니다`. 서버가
  `globalThis.fetch` 와 `node:http` 를 섞어 쓰면 어댑터는 앞쪽만 보므로, 개수를 단정하면
  "그게 전부" 로 읽힙니다. 실제로는 재생 중에도 범위 밖 호출이 실제 네트워크로 나갑니다.

- a3edffe: 대상 서버를 `--` 뒤에 그대로 적을 수 있고, 스위트 id·이름을 `--out` 에서 뽑습니다.

  ```bash
  전  mcpeak generate --suite-id weather --name "날씨 서버 계약" \
        --out contract.suite.json \
        --command mcpeak-mock --arg weather.mock.json --baseline-only

  후  mcpeak generate --out contract.suite.json --baseline-only -- mcpeak-mock weather.mock.json
  ```

  `test` 도 같습니다.

  ```bash
  mcpeak test weather.suite.json -- node ./server.js
  ```

  `--` 뒤 첫 토큰이 실행 파일, 나머지가 그 인자입니다. npm · cargo · docker 가 쓰는 관례라
  설명이 필요 없고, **뒤에 오는 것을 해석하지 않으므로** `--port 0` 같은 값을 그대로 넘길 수
  있습니다.

  ## 파괴적 변경이 아닙니다

  `--command` · `--arg` 는 그대로 됩니다. 두 서브커맨드 모두 지금까지 `--` 를 `지원하지 않는
옵션` 으로 거절했으므로 그 자리를 쓰던 사용법이 없습니다.

  **섞어 쓰면 사용 오류입니다.**

  | 조합               | 왜                                                                               |
  | ------------------ | -------------------------------------------------------------------------------- |
  | `--command x -- y` | 대상이 둘이 되면 어느 쪽을 띄울지 화면이 말할 수 없습니다                        |
  | `--arg x -- y`     | `--arg` 값이 통과 인자 **앞에** 끼어들어 사용자가 적지 않은 순서로 서버가 뜹니다 |

  ## `--suite-id` · `--name` 이 선택이 됐습니다

  `--out contract.suite.json` → id·name 모두 `contract`. `.json` 을 떼고 `.suite` 가 남으면
  그것도 뗍니다. **대소문자를 구분하지 않습니다** — `--out` 검사 자체가 `.json` 을 비구분으로
  받으므로 `contract.SUITE.JSON` 도 `contract` 입니다. 명시하면 그쪽이 이깁니다.

  ⚠️ **출력 파일명이 승인 지문에 들어갑니다.** 지문은 `approval` 만 빼고 전부 해시하므로
  (ADR-0017), id·name 을 파일명에서 뽑았다면 **파일명을 바꿔 다시 생성할 때 지문이 달라져
  재승인이 뜹니다.** 고정하려면 `--suite-id` 와 `--name` 을 직접 지정하세요. 이 결합은
  명시값이 없을 때만 생깁니다.

  판단 근거는 [ADR-0076](../docs/adr/0076-대상-명령은-통과-인자로-받고-스위트-이름은-출력-파일명에서-뽑는다.md) 에 있습니다.

- a810275: 보고서·케이스 상한 초과를 서버 종료 실패와 갈라서 실제 크기와 상한을 말합니다(#92).

  지금까지 `test` 는 runner 의 `RunnerPayloadLimitError` 를 일반 종료 실패로 접어
  `RUNNER_FINALIZATION_FAILED` 와 "서버 응답과 종료 상태를 확인하세요" 만 찍었습니다. 서버 문제가
  아니라 우리 상한인데 사용자를 서버 쪽으로 보냈습니다.

  ```
  오류 [RUNNER_PAYLOAD_LIMIT_EXCEEDED]: 보고서가 1172KB 로 상한 1024KB 를 넘었습니다. 상한은 올릴 수 없습니다.
  해결: 툴을 나눠 여러 명세 파일로 만드세요. 응답이 큰 툴은 케이스 수를 줄이세요.
  ```

  케이스 하나가 넘긴 경우는 그 케이스를 짚고, 케이스 수를 줄이라고 하지 않습니다. 나머지를 지워도
  같은 오류가 그대로 나기 때문입니다.

  `generate` 의 케이스 수 고지(1500개)는 케이스당 600바이트 추정 위에 있다는 사실을 문안에
  적었습니다. 실제 판정은 `test` 실행이 보고서 크기로 합니다.

- 71ba3ed: `test` 와 `generate` 가 **원격(Streamable HTTP) MCP 서버**에 붙을 수 있습니다. `--url <URL>` 로 지정하고, 인증이 필요하면 `--header-env <헤더이름>=<환경변수이름>` 으로 헤더를 환경변수에서 읽습니다 — 토큰을 명령줄에 쓰면 `ps` 목록과 셸 히스토리에 남기 때문에 값을 직접 받지 않습니다([ADR-0070](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0070-원격-서버의-인증-헤더는-값이-아니라-환경변수-이름으로-받는다.md), [#137](https://github.com/2026-Engineering-Contest/MCPeak/issues/137)).

  원격 서버 실패에는 엔드포인트·HTTP 상태·세션 ID 를 담은 진단 블록이 붙습니다.

- 5993740: `mcpeak generate` 의 검토 메뉴에 `show` 를 더합니다. 지금 승인된 명세를 케이스당 한 줄로 찍습니다.

  검토 메뉴는 AI 제안의 diff(바뀐 값)만 보여 줘서, AI 가 만든 케이스가 무엇인지 저장 전에는 볼 곳이
  없었습니다. `edit` 는 파일 경로를 묻는 것이지 보여 주는 것이 아니고, diff 끝의 안내도 "전체는 저장
  후 JSON 을 확인하세요" 였습니다.

  `show` 는 아무것도 묻지 않고 바로 찍은 뒤 메뉴로 돌아옵니다.

  ```
  현재 명세: Weather (id weather) · 케이스 8건 · revision 1
    1. get-weather-success  callTool get_weather {"city":"서울"}  → isError=false
    2. tools-listed         listTools  → toolExists get_weather, toolExists add
    ...
  저장하면 이 내용이 examples/weather-server/server.suite.json 에 쓰입니다.
  ```

  `save` 가 읽는 것과 같은 명세라 여기 보이는 것이 저장됩니다. AI 후보를 받아 두고 아직 반영하지
  않았으면 그 사실을 한 줄 덧붙입니다. 전문 JSON 이 아니라 한 줄 요약인 이유는 케이스 8건이면
  JSON 이 100줄을 넘어 대시보드 로그를 덮기 때문입니다. 입력값은 80자에서 자릅니다.

  대시보드는 CLI 의 선택지를 그대로 버튼으로 만들므로 손대지 않아도 `show` 버튼이 생깁니다.

- d70bf49: provider CLI 가 우리가 넘긴 옵션을 몰라 죽었을 때 **화면이 원인을 말합니다**([#285](https://github.com/2026-Engineering-Contest/MCPeak/issues/285), [ADR-0065](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0065-옵션-이름은-stderr-가-아니라-우리-args-에서-고른다.md)).

  설치된 CLI 버전에 우리가 넘긴 옵션이 없으면 요청이 API 에 닿기도 전에 죽습니다. 이 실패는 HTTP 상태
  코드를 남기지 않아 분류가 비었고, 화면은 `default` 갈래로 떨어져 **로그인과 모델을 확인하라고**
  안내했습니다. 둘 다 원인이 아니므로 안내를 그대로 따라도 풀리지 않았습니다.

  전:

  ```
  오류 [GENERATE_PROVIDER_EXIT]: claude가 종료했습니다. 종료 코드: 1, 모델: sonnet
  해결: `claude /status` 명령으로 로그인 상태를 확인하고, 모델 이름이 맞는지 확인하세요.
  ```

  후:

  ```
  오류 [GENERATE_PROVIDER_OPTION]: 설치된 claude가 우리가 넘긴 옵션을 모릅니다. 옵션: --safe-mode
    → 로그인도 모델도 원인이 아닙니다. CLI가 뜨기도 전에 옵션 해석에서 멈췄습니다.
  해결: `claude --version` 으로 버전을 확인하고 최신 버전으로 올리세요.
  ```

  `repair` 도 같은 사실을 말하며(`REPAIR_PROVIDER_OPTION`), 파일이 하나도 바뀌지 않았다는 약속은
  그대로 유지합니다.

  **stderr 를 화면에 찍지는 않습니다.** 거기에는 우리가 보낸 프롬프트가 echo 되고 그 안에 신뢰할 수
  없는 툴 설명이 있습니다. 옵션 이름은 stderr 에서 읽는 대신 **우리가 넘긴 args 목록에서 고릅니다**
  — 우리 것이 아니면 아무것도 말하지 않습니다.

  **breaking**: `AuthoringProviderFailureReason` 에 `unknownOption` 이 추가되고, `classifyFailure` 의
  반환형이 enum 에서 `ProviderFailureClassification` 객체로 바뀝니다. 사유만으로는 어느 옵션인지 말할
  수 없기 때문입니다. `PublicProviderFailure` 에는 `option` 필드가 생깁니다.

- 0703898: 재생 중 **어댑터 범위 밖으로 나간 호출을 세어 알립니다**([ADR-0068](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0068-재생-중-범위-밖-호출을-가로채지-않고-센다.md)).

  서버가 `globalThis.fetch` 와 `node:http`(axios·got 포함)를 섞어 쓰면 어댑터는 앞쪽만 봅니다.
  그러면 재생이 절반만 되고 나머지는 실제 네트워크로 나가는데, **기존 경고 네 갈래가 전부 그
  상황을 비켜갑니다** — `interactionCount > 0`, `consumedCount > 0`, `unusedCount === 0` 이라
  어느 조건에도 안 걸립니다. 화면에는 초록과 "N건을 재생했습니다" 만 남았습니다.

  ```
  경고: 범위 밖 호출 1건이 실제 네트워크로 나갔습니다.
  → 이 실행은 재현 가능하지 않습니다. 그 호출의 응답은 녹화본이 아니라 오늘의 것입니다.
  → 서버가 `node:http`·axios 등으로 부른 호출입니다. 재생하려면 `fetch` 로 바꾸거나,
    그 외부 의존을 `mcpeak mock` 으로 대신하세요.
  ```

  **가로채지 않고 세기만 합니다.** `diagnostics_channel` 을 쓰므로 서버 동작은 한 바이트도
  달라지지 않습니다 — ADR-0057 이 그은 어댑터 범위를 넓히지 않습니다.

  **0 건임을 확인한 실행에서는 조건절 단서가 사라집니다.** 못 센 경우(서버가 강제 종료된 경우)는
  0 으로 다루지 않고 기존 조건절을 유지합니다 — 부재와 0 은 다른 사실입니다.

- 95f4299: 재생이 **원본을 언제 녹화했는지** 함께 알립니다([ADR-0069](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0069-녹화의-낡음은-시각을-보이되-판정하지-않는다.md)).

  ```
  → 녹화된 외부 호출 1건을 재생했습니다: tmp/weather.db (2026-08-23 13:41:40 UTC 녹화)
  ```

  녹화본은 낡습니다. 석 달 전 세션도 원본 API 가 바뀐 뒤 그대로 재생되고 테스트는 초록으로
  통과합니다. 그 초록이 무엇에 대한 초록인지 알려면 **언제 찍은 녹화인지** 를 알아야 하는데,
  `recorded_at` 은 저장돼 있으면서 어디에도 나오지 않았습니다.

  **나이("12일 전")나 임계값 경고는 내지 않습니다.** 그러려면 지금 시각을 읽어야 하고, 그러면 같은
  세션의 같은 재생이 날마다 다른 출력을 냅니다 — 결정론이 이 도구의 핵심 가치입니다. 시각은 저장된
  값이라 언제 읽어도 같습니다. 낡았는지는 사람이 판단합니다.

  `toLocaleString` 을 쓰지 않고 ISO 를 잘라 `UTC` 로 표기합니다. 로캘·타임존에 따라 같은 세션이
  기계마다 다른 문자열을 내지 않게 하려는 것입니다.

  **이 도구는 외부 API 드리프트를 감지하지 않습니다.** 시각을 보여주는 것은 "언제 찍었는지" 이지
  "그 사이 바뀌었는지" 가 아닙니다. 실제 재검증은 후속 과제입니다.

- 46e47d5: **Breaking**: `mcpeak generate`의 Tool 카세트 옵션 `--cassette`와 `--record`를 제거했습니다.
  이는 CLI에 남아 있던 Tool 카세트 사용자 표면을 제거하는 변경입니다
  ([ADR-0059](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0059-tool-카세트를-제거한다.md)).

  `generate` 시험 실행은 이제 항상 실제 MCP 서버를 직접 호출합니다. 제거된 옵션을 사용하면
  일반적인 unknown-option 오류 대신 제거 사실과 다음 대체 경로를 안내합니다.

  - 서버의 외부 HTTP 호출을 녹화하려면
    `mcpeak test <suite.json> --command <executable> --record-session <path>`를 사용하세요.
  - 녹화한 외부 HTTP 호출을 재생하려면
    `mcpeak test <suite.json> --command <executable> --session <path>`를 사용하세요.
  - 서버 자체를 실행하지 않고 결정론적인 응답으로 테스트하려면 `mcpeak-mock`을 사용하세요.

- 9c0aa96: **Breaking**: `mcpeak replay` 명령을 제거했습니다. Tool 카세트를 걷어내는 세 번째 조각입니다
  ([ADR-0059](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0059-tool-카세트를-제거한다.md)).

  `@mcpeak/cli/commands` 의 공개 재export 에서도 `runReplayCommand`·`parseReplayCommand`·
  `ReplayCommandInput`·`ReplayCommandDependencies` 가 빠집니다.

  **갈아타는 곳은 목적에 따라 갈립니다.**

  - 서버를 띄우지 않고 저장된 응답으로 스위트를 돌리는 것이 목적이었다면 → `mcpeak-mock` 으로
    서버를 대신하세요. 사람이 지정한 결정론적 응답이라 낡지 않습니다.
  - 외부 API 호출만 막는 것이 목적이었다면 →
    `mcpeak test <suite.json> --command <executable> --record-session <path>` 로 녹화하고
    `--session <path>` 로 재생하세요. 서버는 실제로 뜨고 그 서버가 밖에 부르는 호출만 막힙니다.

  `mcpeak replay` 를 실행하면 위 안내가 그대로 나옵니다.

- 36bb78a: **Breaking**: `mcpeak verify` 명령을 제거했습니다. Tool 카세트를 걷어내는 첫 조각입니다
  ([ADR-0059](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0059-tool-카세트를-제거한다.md)).

  `verify` 는 카세트 `auto` 모드의 사각지대를 메우는 부속물이었습니다 — `auto` 는 카세트에 있는
  요청이면 서버를 부르지 않아 응답이 바뀌어도 모르고, `verify` 가 그것을 비파괴로 확인했습니다.
  카세트가 사라지면 그 사각지대도 사라집니다.

  **갈아타는 곳은 목적에 따라 갈립니다.**

  - 서버 응답이 아직 맞는지 확인하고 싶었다면 → `mcpeak test` 로 실서버를 직접 검증하세요.
  - 외부 API 호출을 막는 것이 목적이었다면 → `mcpeak test --record-session <path>` 로 녹화하고
    `--session <path>` 로 재생하세요. 서버는 실제로 뜨고 그 서버가 밖에 부르는 호출만 막힙니다.

  `mcpeak verify` 를 실행하면 위 안내가 그대로 나옵니다. 라이브러리 함수 `verifyCassette` 는
  `@mcpeak/record` 에 아직 남아 있습니다 — 구현 제거는 뒤 단계입니다.

### Patch Changes

- 0dbeee2: `generate` 의 시험 실행이 **연결 상실을 러너 신호로 판정합니다**([ADR-0074](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0074-시험-실행의-연결-상실은-진단-코드가-아니라-러너-신호로-판정한다.md), [#279](https://github.com/2026-Engineering-Contest/MCPeak/issues/279)).

  지금까지는 보고서에서 진단 코드가 `OPERATION_FAILED` 인 첫 케이스를 찾아 연결이 끊긴 지점으로 간주했습니다. 그 코드는 **서버가 살아서 낸 평범한 툴 오류에도 붙습니다.** 그래서 툴 하나가 오류를 내면 뒤 케이스의 판정을 통째로 버리고 "연결이 끊겼습니다" 라고 말했고, 저장도 막혔습니다.

  이제 러너가 준 `stopReason.type === "connectionLost"` 만 연결 상실로 봅니다. 중단 사유 문장도 `test` 화면과 같은 어휘를 씁니다.

  ```
  ✗ 시험 실행을 마치지 못했습니다. 3/8 케이스에서 연결이 끊겼습니다.
    → 케이스 'add 케이스 c' 에서 서버 프로세스가 종료됐습니다 (종료 코드 42). 남은 케이스는 실행되지 않았습니다.
  ```

  살아 있는 서버가 낸 툴 오류는 더 이상 시험 실행을 중단시키지 않습니다. 그 케이스만 실패로 남고 나머지도 전부 실행됩니다.

- 82face1: 서버 응답이 인자 타입 위반을 이미 충분히 설명한 경우 같은 사실을 입력 계약 참고 블록에서 반복하지 않습니다.
- de06218: `--determinism` 이 **종료 코드에 반영되지 않는다는 사실**을 화면과 `--help` 가 말합니다.

  비차단 진단이라 차이를 찾아도 종료 코드는 1회차 판정 그대로 0 입니다. **이 동작은 의도된
  설계이고 바뀌지 않았습니다** — 오탐이 CI 를 막으면 안 된다는 것이 그 이유입니다(ADR-0018).
  문제는 그 사실이 화면 어디에도 없었다는 것입니다. CI 는 초록인데 서버가 비결정이라는 것을
  아무도 모르는 자리였습니다.

  ```
  결정론성 확인
  → 1/3 케이스에서 2회 실행 결과가 다릅니다.

    claim / claim가 오류 없이 응답한다 (claim-success)
    → 판정이 다릅니다: 1회차 passed, 2회차 failed
    …
  → 이 진단은 종료 코드에 반영되지 않습니다. CI 를 막으려면 --json 의 determinism 키를 보세요.
  ```

  2회차가 완주하지 못해 비교를 못 한 갈래에는 **문장이 다릅니다.** 그 경우 `--json` 의
  `determinism` 키가 아예 만들어지지 않으므로, 그 키를 가리키면 없는 것을 가리키는 안내가
  됩니다.

  ```
  → 이 진단은 종료 코드에 반영되지 않습니다. --json 에서는 determinism 키가 만들어지지 않아
    이 안내가 stderr 로만 나갑니다.
  ```

  **결과가 같은 갈래에는 붙이지 않습니다.** 찾은 것이 없는 자리에 고지가 붙으면 노이즈가 되고,
  노이즈가 되면 정작 필요할 때 아무도 안 읽습니다. CLI 내부 오류 갈래도 그대로입니다 — 이미
  "시험 판정은 1회차 결과 그대로입니다" 로 같은 사실을 말하고 있습니다.

  `mcpeak test --help` 의 `--determinism` 항목에도 같은 사실을 적었습니다. 종료 코드를 도움말에
  적는 것은 이 저장소에 이미 있는 관례입니다.

- 623daa8: `mcpeak help test` 의 `--determinism` 항목에 표시값 마스킹의 한계를 적었습니다(#183).

  차이 지점의 양쪽 값은 `token`·`apiKey` 같은 이름으로 판정해 가립니다. 그런데 서버가 결과를
  JSON 문자열로 만들어 text 블록 하나에 싣는 형태(실서버의 기본 응답 형태)에서는 비밀값이 문자열
  안에 있어 이름 판정이 닿지 않습니다. 설계 문서가 "redaction 이 적용된다" 고만 적어 안심하고
  CI 로그에 남기던 자리라, 가려지지 않는 자리를 화면에 명시합니다
  ([ADR-0033](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0033-stderr-외부-전송-경계.md)
  의 E3 방식, [ADR-0082](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0082-runner-의-민감-키-판정을-record-와-같은-접미-단어열-규칙으로-맞춘다.md)).

- 77135a3: `test --session` 재생이 세션 파일을 읽기 전용으로 엽니다(#291). 예전에는 저장소가 재생에도
  스키마 DDL 을 무조건 심어서, 읽기 전용(chmod 444) 세션은 재생이 안 됐고 0바이트 파일을 넘긴
  실패한 실행이 그 파일을 36,864바이트짜리 빈 세션 DB 로 덮어썼습니다. 실패한 실행이 사용자
  파일을 바꾸지 않는 것이 이제 보장됩니다.

  External 세션 실패 안내에 빠져 있던 갈래 둘을 채웠습니다(#290).

  - 이미 존재하는 세션에 다시 녹화하면 "쓰기 권한을 확인하세요" 대신 원인에 맞는 문장과 경로를
    보여줍니다. 다른 `--record-session` 경로를 쓰거나 기존 파일을 지우라고 안내합니다.
  - 지원하지 않는 store version 의 세션 파일도 다시 녹화하라는 우리 문장으로 안내합니다.

  우리가 소스에 직접 써 넣은 안내 문구가 화면에서 한 줄로 뭉개지던 문제를 고쳤습니다(#289).
  `--determinism` 과 세션 옵션을 함께 쓸 수 없다는 3줄 안내, 초기화 명령 실패의 진단(종료
  코드·stderr 꼬리)이 실제 줄바꿈으로 나갑니다. 초기화 명령 실패 안내는 진단과 다음 행동을
  분리해, `stderr` 꼬리가 다음 문장에 경계 없이 이어붙던 것도 함께 고쳤습니다. 서버 응답처럼
  신뢰 못 할 값(사용자가 타이핑한 옵션·경로, 자식 프로세스의 stderr)에 대한 제어 문자 이스케이프는
  그대로 유지합니다 — 이제는 값을 만드는 자리에서 걸어, 우리 자신이 쓴 개행까지 함께 걸리지
  않습니다.

- 123702c: 입력값 교정이 **전송 전에 승인을 받습니다.** 그리고 값의 출처를 정확히 말합니다.

  `generate` 의 입력값 교정 단계가 승인 화면을 한 번도 보여주지 않고 provider 를 불렀습니다.
  같은 명령의 다른 AI 통로를 **전부 거절한 실행에서도** 호출이 나갔고, 그 본문에 baseline suite
  전량 · candidate suite 전량 · 툴 선언 · 서버 응답 원문이 실렸습니다. 메시지 품질이 아니라
  **동의(consent) 문제였습니다.**

  사전보완 · authoring 과 같은 화면을 같은 형식으로 찍고 묻습니다. 전송 데이터 목록만 이 통로의
  실제 내용으로 바꿉니다 — 이쪽은 **실패한 케이스의 서버 응답 원문**까지 보냅니다.

  ```
  Provider: codex
  Model: gpt-5.6-luna
  Payload: 3721 bytes
  Result limit: 262144 bytes
  Timeout: 120000ms
  Fingerprint: 225b0db3…
  전송 데이터: 실패한 케이스의 명세와 서버 응답 원문, baseline suite, current candidate, 툴 이름·설명·inputSchema
  이 요청을 전송할까요? [y/N]
  ```

  거절하면 요청을 보내지 않고 사람 입력으로 갑니다. **그때 사유를 정확히 말합니다.**

  ```
  거절  입력값이 거절된 것으로 보입니다. AI 전송을 거절했으므로 값을 직접 받습니다.
  부재  입력값이 거절된 것으로 보입니다. 서버 응답에 쓸 만한 값이 없어 직접 받습니다.
  ```

  둘을 한 문장으로 묶으면 거절한 사용자에게 **"서버 응답에 쓸 만한 값이 없다" 는 거짓 사유**를
  말하게 됩니다 — 서버 응답은 있었고 보내지 않기로 한 것뿐입니다.

  **보낼 근거가 없으면**(서버 응답이 비었거나 치환 뒤 본문이 사라졌으면) 묻지도 않습니다 —
  답이 없는 질문으로 사람을 세우지 않습니다.

  **provider 인스턴스가 없으면** 승인 화면도 전송 고지도 나오지 않습니다. `--provider` 로 id 를
  골라도 팩토리가 인스턴스를 주지 못하면 요청 자체가 없기 때문입니다.

  ## 값의 출처를 서버에 귀속하지 않습니다

  ```
  전  입력값이 거절된 것으로 보입니다. 서버 응답에서 값을 찾았습니다.
  후  입력값이 거절된 것으로 보입니다. codex(gpt-5.6-luna) 가 서버 응답을 보고 제안한 값입니다.
  ```

  이 갈래는 provider 가 배선됐을 때만 도달하므로 **값은 항상 provider 가 만든 것**입니다.
  서버에 귀속하면 사용자가 AI 가 관여한 사실 자체를 알 수 없습니다.

  ## 시험 실행 안내가 전송 사실을 미리 말합니다

  ```
  시험 실행: 케이스 3개를 실제 서버에 보냅니다.
    대상: node server.mjs
    실패한 케이스는 값을 고쳐 최대 2회까지 다시 호출합니다.
    값 제안에 codex(gpt-5.6-luna) 를 씁니다 — 실패한 케이스의 명세와 서버 응답을 보냅니다.
      전송 전에 매번 승인 화면을 보여주며, 거절하면 직접 입력합니다.
  ```

  전에는 `값을 고쳐 다시 호출합니다` 뿐이라 **서버 재호출로만 읽혔습니다.**

  `proposeRepair` 의 `confirm` 은 **선택 인자가 아닙니다.** 기본값을 두면 안 넘긴 호출자가
  조용히 자동 승인으로 돌아가고, 이 결함이 정확히 그 상태였습니다.

- e24f46a: `test --junit`이 XML 파일을 쓰지 못해도 통과·실패 케이스와 요약을 stdout에 보존합니다(#294).
  종료 코드 1과 `JUNIT_WRITE_FAILED`는 유지하며, 오류 메시지에 시도한 경로와 errno를 표시합니다.
- a49f43c: AI 사전보완 전송 승인에서 입력이 닫히면 `GENERATE_FAILED`로 잘못 안내하지 않고, 검토를 취소해 저장하지 않았다고 알립니다(#297).
- cc14248: 현재 명세와 저장된 `approval.fingerprint`가 불일치할 때 테스트 결과에 맞춰 통과·실패 안내를 구분하고, 변경 확인과 재승인 방법을 표시합니다.
- 962e5f2: 명세 로딩 단계 오류가 **경로와 원인을 문장에 싣습니다.**

  `} catch {` 가 오류 객체를 **바인딩조차 하지 않아** 정적 사전 문장만 나갔습니다. 경로를
  확인하라면서 그 경로가 화면에 없었습니다. `input.suitePath` 는 바로 그 스코프에 있었으니
  못 싣는 게 아니라 안 실었습니다.

  ```
  전  오류 [SUITE_READ_FAILED]: 테스트 명세 파일을 읽지 못했습니다.
      해결: 명세 경로와 읽기 권한을 확인하세요.        ← 그 경로가 없고, 둘 다 확인하라고 함

  후  오류 [SUITE_READ_FAILED]: 테스트 명세 파일이 그 경로에 없습니다: specs/none.suite.json
      해결: 경로와 파일 이름을 확인하세요. 상대 경로는 명령을 실행한 디렉터리 기준입니다.
  ```

  **errno 별로 다음 행동이 다르므로 갈라 말합니다.** 파일이 없으면 경로를 고치고, 권한이 없으면
  권한을 고칩니다. 어느 쪽인지 아는데 둘 다 확인하라고 하면 안 됩니다.

  | errno              | 문장                                                                         |
  | ------------------ | ---------------------------------------------------------------------------- |
  | `ENOENT`           | `테스트 명세 파일이 그 경로에 없습니다: <경로>`                              |
  | `EACCES` · `EPERM` | `테스트 명세 파일을 읽을 권한이 없습니다: <경로>` — `경로 자체는 찾았습니다` |
  | `EISDIR`           | `그 경로는 파일이 아니라 디렉터리입니다: <경로>`                             |
  | 그 밖              | 경로 + `errno: <값>`                                                         |

  JSON 문법 오류는 **파서가 준 문장을 그대로 옮깁니다.**

  ```
  오류 [SUITE_JSON_INVALID]: 테스트 명세의 JSON 문법이 유효하지 않습니다: broken.suite.json
    Unexpected token '}', ..."cases": [ } }" is not valid JSON
  ```

  위치 표기는 런타임마다 다릅니다 — `at position 7 (line 1 column 8)` 을 주기도 하고 깨진 자리의
  스니펫만 주기도 합니다. 우리가 형식을 고정하면 어느 한쪽에서 거짓이 되므로 파서 문장을 옮기고
  경로만 더합니다.

  확장자 오류는 **인코딩 얘기를 그만합니다.** 이 갈래는 `extname(path) !== ".json"` 하나로만
  오는데, 안내가 `UTF-8로 저장한 .json 명세 파일을 사용하세요` 라고 해서 이미 UTF-8 JSON 인
  사용자는 따라 해도 안 풀렸습니다. **원인과 안내가 다른 것을 가리키고 있었습니다.**

  ```
  전  오류 [SUITE_FORMAT_UNSUPPORTED]: 테스트 명세 형식을 지원하지 않습니다.
      해결: UTF-8로 저장한 .json 명세 파일을 사용하세요.

  후  오류 [SUITE_FORMAT_UNSUPPORTED]: 테스트 명세는 .json 파일이어야 합니다. 준 확장자: .yaml
        경로: specs/main.yaml
      해결: 경로가 .json 으로 끝나는지 확인하세요. 이 단계는 파일을 열지 않고 확장자만 봅니다.
  ```

  인코딩은 **바로 다음 단계가 따로 검사합니다.** 두 자리가 같은 말을 하면 사용자가 원인을 둘로
  흩뜨립니다.

  UTF-8 오류도 어느 파일인지 말합니다. `--repair-bundle` 쓰기 실패는 짝인 `--junit` 과 같은
  모양(경로 + errno)이 됐습니다 — 같은 실행에서 둘 다 실패할 수 있고, 그때 한쪽만 경로를 싣고
  있으면 어느 파일이 없는지 알 수 없습니다.

  **Node 오류 객체의 `message` 와 스택은 싣지 않습니다.** 거기 섞여 오던 내부 경로·스택
  프레임이 화면으로 새지 않도록, 읽기 실패에서는 `errno` 와 우리가 만든 문장만 나갑니다
  (기존 유출 방지 테스트가 손대지 않고 그대로 통과합니다).

  **사용자가 준 경로는 그대로 보여줍니다 — 절대 경로도 마찬가지입니다.** 그것이 이 이슈가
  요구한 것이고, 같은 저장소의 세 자리가 이미 그렇게 합니다(`mcpeak-mock` 의 목 정의 읽기 실패,
  `repair` 의 번들 읽기 실패, `--junit` 쓰기 실패). 가리면 "어느 경로를 썼는지" 를 못 보게 되어
  고치려던 문제가 그대로 돌아옵니다. `CONTRIBUTING.md` §4-7 의 절대 경로 금지는 **저장소에
  커밋하는 문서**가 대상이고 런타임 화면은 그 범위가 아닙니다([ADR-0071](../docs/adr/0071-스캔-루트를-화면에-싣는-방법.md)
  이 대시보드에서 같은 판단을 기록했습니다).

- f5eebae: 명령 이름을 틀렸을 때 `test` 의 플래그 목록 대신 **명령 목록**을 준다.

  `mcpeak tset` 처럼 오타를 내면 묻지도 않은 `test` 명령의 사용법 200 자를 먼저 읽어야 정작 필요한 명령 목록에 닿았다. 오타는 "어느 옵션을 쓰나" 가 아니라 "어떤 명령이 있나" 를 모르는 상태다.

  ```
  전  해결: 사용법: mcpeak test <suite.json> --command <executable> [--arg <value> ...]
          [--determinism] … [--session <path> | --record-session <path>] 사용 가능한 명령:
          test, generate, repair. 전체 도움말: mcpeak --help

  후  해결: 사용 가능한 명령: test, generate, repair. 전체 도움말: mcpeak --help
  ```

  라이브러리 진입점 `runCli([])` 도 같은 안내를 준다. **`mcpeak` 를 인자 없이 친 경우는 바뀌지 않는다** — 그쪽은 `run()` 이 먼저 가로채 전체 도움말을 찍고 종료 코드 0 으로 끝나며, 그게 맞는 동작이다. 여기서 닿는 것은 `@mcpeak/cli/commands` 로 나가는 공개 `runCli` 이고 대시보드가 그 문으로 들어온다.

  `mcpeak help <없는명령>` 도 고친다. 전에는 사용자가 정확히 친 `help` 를 두고 "알 수 없는 CLI 명령 'help'입니다" 라고 해서, 무엇을 고쳐야 하는지가 화면에서 사라졌다.

  ```
  전  오류 [CLI_USAGE]: 알 수 없는 CLI 명령 'help'입니다.
  후  오류 [CLI_USAGE]: 도움말이 없는 명령 '없는명령'입니다.
  ```

  제거된 `replay`·`verify` 는 여기 걸리지 않는다. 도움말을 물어도 마이그레이션 안내로 답하는 갈래가 앞에 있다(ADR-0059).

- 3f7692d: record: 재생 원본 판정을 둘로 가릅니다. 세션이 아예 없으면 `SESSION_NOT_FOUND`, 있는데 녹화가
  완료되지 않았으면 `REPLAY_SOURCE_INVALID` 입니다. 사용자에게 보이는 문장에서 내부 세션 id
  (`"default"`)를 뺐습니다 — 사용자가 준 적 없는 이름이라 무엇을 가리키는지 알 수 없었습니다.

  cli: `test --session` 이 세션을 열지 못했을 때 원인마다 다른 문장을 보여주고, **사용자가 준
  경로**를 함께 싣습니다. 그리고 없는 경로로 재생을 시도해도 **그 자리에 빈 세션 파일을 만들지
  않습니다** — `node:sqlite` 가 경로를 생성해 버려서, 오타 한 번에 빈 DB 가 남고 두 번째 실행부터는
  "파일이 없다" 는 진단이 거짓이 됐습니다.

  이전에는 없는 파일·빈 세션·실패한 녹화가 모두 같은 두 문장으로 끝났고, 재생인데 쓰기 권한을
  확인하라고 안내했습니다(#260).

- 647a175: `test`가 서버의 `inputSchema`를 해석하지 못해 입력 계약 검사를 건너뛴 경우, 테스트 케이스가
  통과했더라도 그 사실을 알립니다(#288). `SCHEMA_NOT_ANALYZABLE` finding에는 해석 실패 사유가
  추가되며, 사람용 출력은 사유와 함께 스키마를 고치는 방법을 안내합니다.

  README의 목 서버 예시도 `properties`와 `required`가 있는 검사 가능한 입력 스키마로 고쳤습니다.

- Updated dependencies [51a7193]
- Updated dependencies [b99847f]
- Updated dependencies [3f7692d]
- Updated dependencies [626d067]
- Updated dependencies [7186519]
- Updated dependencies [54d7dc6]
- Updated dependencies [7c1a5b0]
- Updated dependencies [48adbc8]
- Updated dependencies [d70bf49]
- Updated dependencies [5904700]
- Updated dependencies [3e39e33]
- Updated dependencies [63e50fe]
- Updated dependencies [0703898]
- Updated dependencies [3d79cd7]
- Updated dependencies [95f4299]
- Updated dependencies [8dc503e]
- Updated dependencies [690203f]
- Updated dependencies [647a175]
- Updated dependencies [cc116fa]
- Updated dependencies [21977b4]
- Updated dependencies [2c5ca1b]
- Updated dependencies [ffdd83d]
- Updated dependencies [ff33aa7]
- Updated dependencies [aa00084]
- Updated dependencies [8579092]
- Updated dependencies [7bc5a71]
- Updated dependencies [c84eb8b]
  - @mcpeak/record@0.4.0
  - @mcpeak/generate@0.7.0
  - @mcpeak/mock@0.4.1
  - @mcpeak/runner@0.10.0

## 0.10.0

### Minor Changes

- e99192a: Node.js 최소 지원 버전을 22.18.0으로 올리고, 배포 패키지의 `engines.node`에 같은 요구사항을 명시합니다.
- fe9b0ea: **External Record/Replay** — MCP 서버가 **밖으로 나가는 HTTP 호출**을 녹화하고 재생한다.

  지금까지 카세트는 *우리가 서버에게 물어본 결과*를 남겼다. 세션은 *그 서버가 밖에 물어본 결과*를 남긴다. 둘은 섞이지 않고 파일도 따로다.

  ```bash
  mcpeak test suite.json --command node --arg server.js --record-session s.db   # 녹화
  mcpeak test suite.json --command node --arg server.js --session s.db          # 재생
  ```

  재생에서는 서버가 실제로 실행되지만 외부 API 는 부르지 않는다. 녹화에 없는 호출을 만나면 실패한다. `token`·`apiKey` 같은 이름의 값은 저장 전에 가려지지만, **세션 파일에는 외부 API 응답이 그대로 들어가므로 `.gitignore` 를 확인해야 한다.**

  라이브러리로는 `@mcpeak/record/external` 서브패스가 `startExternalCoordinator` 와 `createSqliteSessionStore` 를 공개한다. 저장은 `node:sqlite` 를 쓰므로 세션 옵션을 쓴 실행에서 런타임에 따라 `ExperimentalWarning` 이 stderr 에 한 줄 나올 수 있다 (ADR-0056).

  **잡는 범위는 `globalThis.fetch` 하나다** (ADR-0057). `node:http`·`node:https`·axios·got 처럼 다른 경로로 부르는 서버는 녹화되지 않는다. 어댑터는 `node.fetch.v1` 이며 확장 여지를 두고 버전을 붙였다.

  범위 밖이면 실행 끝에 알린다 — 녹화가 0건이거나 재생에서 소비한 호출이 0건이면 "이 세션은 아무 호출도 막지 못합니다" 를 낸다. 판정과 종료 코드는 바뀌지 않는다.

  관련 결정: ADR-0051 · ADR-0052 · ADR-0053 · ADR-0056.

### Patch Changes

- 04d6786: npm 패키지 설명에 남아 있던 옛 제품명(`OhMyMCP`)을 `MCPeak` 으로 바꾼다. 레지스트리
  페이지에 그대로 노출되던 자리다 (ADR-0050).
- 19eb834: record: 재생 원본에서 찾지 못한 외부 호출을 `finish()` 요약의 `misses` 목록에 구조화해 담습니다.
  새 타입 `ReplayMissDetail`(`method`·`url`·`occurrence`·`matchKeyPrefix`)이 공개됩니다.

  **Breaking**: `ReplaySessionSummary` 에 필수 필드 `misses` 가 추가됩니다. `SessionSummary` 를
  직접 구성하던 TypeScript 소비자(테스트 목·모킹 등)는 그 필드를 채워야 컴파일됩니다. `0.x` 이므로
  minor 로 릴리스합니다(CONTRIBUTING §7 버전 — 마감 전까지 breaking change 허용, CHANGELOG 필수).

  cli: `test --session` 이 녹화에 없는 호출을 만나면, 그 진단을 `record` 의 `misses` 로부터
  읽어 stderr 에 별도 블록으로 그대로 보여줍니다. 이전에는 이 진단이 MCP 오류 채널을 타고
  나가 `runner` 가 서버 텍스트로 취급해 개행을 이스케이프 시퀀스로 바꾸고 200자에서 잘라
  해결 안내가 사라졌습니다(#259). 케이스별 실패 줄은 그대로 남고, 실행이 끝나면 잘리지 않은
  전체 진단이 한 번 더 나옵니다.

- 667c214: cli: `test` 의 External 세션이 끝날 때 녹화·재생 결과를 알립니다. 녹화가 0건이거나, 재생에서
  원본이 비었거나, 녹화된 호출을 하나도 재생하지 못한 경우 각각 다른 안내가 나옵니다. External
  어댑터는 서버가 `globalThis.fetch` 로 낸 호출만 잡으므로(ADR-0057), `node:http` 를 쓰는 서버는
  녹화도 재생도 되지 않은 채 조용히 통과하던 것을 이 안내가 드러냅니다.
- 3b78b72: generate: MCP 서버 연결 실패 시 종료 코드, 시그널, stderr 진단을 함께 표시합니다.
- Updated dependencies [e99192a]
- Updated dependencies [19eb834]
- Updated dependencies [2e62615]
- Updated dependencies [a019771]
- Updated dependencies [fe9b0ea]
- Updated dependencies [cdb8da0]
- Updated dependencies [93816a8]
  - @mcpeak/core@0.4.0
  - @mcpeak/generate@0.6.0
  - @mcpeak/mock@0.4.0
  - @mcpeak/record@0.3.0
  - @mcpeak/runner@0.9.0

## 0.9.0

### Minor Changes

- d962089: record: `--record` 가 기존 카세트를 갈아엎을 때 무엇이 사라지는지 알립니다. 지금까지는 기존
  파일에 상호작용이 50개 있어도 이번 실행이 12개만 부르면 나머지 38개가 아무 말 없이
  사라졌습니다. 테스트 필터나 중간 실패로 일부만 실행된 경우가 그대로 손실이 됐고, 커밋 전에
  `git diff` 를 보지 않으면 알 방법이 없었습니다.

  `record` 모드에서 `onFlush` 가 있으면 `close()` 시점에 기존 카세트와 비교해 사라지는 요청을
  `onWarning` 으로 알립니다. 판정은 `diffCassettes` 와 `droppedInteractionsMessage` 로 분리해
  공개했고, `key` 기준이라 같은 키에 응답만 바뀐 것은 손실이 아니라 갱신으로 봅니다.

  **경고일 뿐 저장을 막지 않습니다.** 막으면 `--record` 가 갈아엎으라는 명령이라는 의미가 바뀌고
  `--record` 를 자동으로 도는 파이프라인이 깨집니다. 고치는 것은 "지운다" 가 아니라 "말없이
  지운다" 입니다. `auto` 는 기존 것을 물려받아 덧붙이므로 이 경고가 나오지 않습니다.

  cli: `generate` 가 카세트 저장에 성공한 뒤 이 경고를 출력합니다. 경고는 `recorder.close()`
  안에서야 확정되므로 기존 두 출력 지점(시험 실행 후 · 교정 후)에는 아직 존재하지 않았고,
  출력 지점이 없어 화면까지 오지 못하던 상태였습니다.

- 6cb8b5b: record: 카세트가 아직 실서버와 맞는지 확인하는 `verifyCassette` 를 추가합니다.

  `auto` 모드는 카세트에 있는 요청이면 서버를 부르지 않으므로, 서버 응답이 바뀌어도 영원히
  알아채지 못합니다. 그것을 확인하는 방법이 지금까지 파괴적인 `--record` 뿐이었고, 재동기화가
  전부-아니면-전무라 사람들이 피했고, 그래서 카세트가 손으로 쓴 목과 똑같이 낡아 갔습니다.

  `verifyCassette(client, cassette)` 는 녹화된 요청을 실서버에 다시 보내 응답을 비교하고
  결과만 돌려줍니다. **카세트를 고치지도 저장하지도 않습니다.** 연결도 닫지 않습니다 —
  소유권은 호출자에게 있습니다.

  비교는 양쪽 모두 마스킹한 뒤에 합니다. 파일에서 읽은 카세트는 이미 마스킹돼 있고 실서버
  응답은 원문이라, 그대로 비교하면 비밀값이 든 응답이 전부 거짓 불일치가 됩니다. 대가로
  비밀값 자체만 바뀐 경우는 감지되지 않지만, 그 값은 테스트에도 마스킹돼 나가므로(ADR-0041)
  어떤 단언도 그것에 의존할 수 없습니다.

  요청 인자에 비밀값이 있었던 상호작용은 원래 요청을 복원할 수 없어 `skipped` 로 보고합니다.
  마스킹된 값을 실서버에 그대로 보내지 않습니다.

  record: JSON 문자열 안의 차이를 필드 단위로 보여줍니다. MCP 응답의 실제 페이로드는
  `content[].text` 안에 JSON 문자열로 들어 있어서, 지금까지는 이스케이프된 문자열 두 개를 눈으로
  대조하라는 메시지가 나왔고 페이로드가 길면 잘려서 아무것도 볼 수 없었습니다. 이제
  `raw.content[0].text.temp: <없음> / ... .temperature: 21` 처럼 어느 필드가 바뀌었는지 나옵니다.
  `replay` 미스와 중복 응답 경고도 같은 개선을 받습니다.

  cli: `mcpeak verify <cassette.json> --command <executable> [--arg <value> ...]` 를 추가합니다.
  불일치나 호출 실패가 있으면 종료 코드 1 입니다. 확인불가(마스킹된 인자)는 실패로 보지
  않습니다 — "달라졌다" 가 아니라 "확인할 수 없다" 이고, 그것으로 CI 를 빨갛게 만들면 끌 방법이
  없습니다. `--record` 를 주면 조용히 무시하지 않고 `generate --record` 를 안내합니다.

### Patch Changes

- 7520b74: cli: 거절 근거 AI 진단 승낙을 묻기 전에, 응답 본문이 값 치환 없이 그대로 provider 로 나간다는
  사실을 화면에 적습니다. 미확인 목록이 이미 본문을 한 줄씩 보여주고 있어서, 이 한 줄이 붙으면
  사용자가 보고 판단할 재료가 갖춰집니다. 문장은 `repair` 의 stderr 안내와 같은 계열로 맞췄습니다 —
  provider 로 자유 텍스트를 보내는 두 통로가 다른 문장을 쓰면 한쪽만 고쳐집니다. 근거는 ADR-0049
  입니다.
- 393def4: cli: `replay` 가 런타임 모듈 로드 실패를 내부 오류로 보고하지 않습니다.

  `@mcpeak/runner` 나 `@mcpeak/record` 를 못 불러 fallback 의존성이 쓰이면, 가장 먼저
  걸리는 `validateSuite` 가 평범한 `Error` 를 던져 `CLI_INTERNAL_ERROR` 로 잡혔습니다. 화면에는
  "예상하지 못한 CLI 내부 오류가 발생했습니다 / 다시 실행한 뒤 재현 정보와 함께 이슈를
  보고하세요" 가 나갔고, 사용자는 자기 설치 문제로 버그 리포트를 쓰게 됐습니다.

  전용 `ReplayRuntimeUnavailableError` 와 `REPLAY_RUNTIME_UNAVAILABLE` 코드로 가릅니다.
  `repair` 가 `REPAIR_RUNTIME_UNAVAILABLE` 로 이미 하던 것과 같은 처리입니다.

  다른 코드는 그대로입니다. 명세 자체의 문제는 종전대로 `SUITE_FORMAT_UNSUPPORTED` ·
  `SUITE_READ_FAILED` · `SUITE_ENCODING_INVALID` · `SUITE_JSON_INVALID` ·
  `SUITE_VALIDATION_FAILED` 이고, `CLI_INTERNAL_ERROR` 는 `validateSuite` 가 예상치 못하게
  던졌을 때만, `CASSETTE_READ_FAILED` 는 카세트를 읽지 못했을 때만 나옵니다.

- Updated dependencies [be534d6]
- Updated dependencies [c923b48]
- Updated dependencies [10ae345]
- Updated dependencies [55ba842]
- Updated dependencies [d962089]
- Updated dependencies [6cb8b5b]
  - @mcpeak/generate@0.5.1
  - @mcpeak/mock@0.3.0
  - @mcpeak/record@0.2.0

## 0.8.0

### Minor Changes

- 49b2431: `generate` 승인 화면에서 거절 근거를 확인하지 못한 케이스를 **AI 에게 물어볼 수 있습니다.** 미확인 목록 아래에 요청 여부를 묻고, 사용자가 승낙했을 때만 provider 를 부릅니다. 자동으로 부르지 않습니다 — 케이스가 많으면 비용이 곱해지고 provider 가 없는 사용자가 대다수입니다. `--provider` 가 없거나 미확인이 0건이면 아무것도 묻지 않습니다.

  **이 진단은 참고입니다. 케이스 판정도 저장 여부도 바꾸지 않습니다.** 결과는 화면에만 나가고 `--json` 이나 `RunnerReport` 에는 들어가지 않으며, 화면 마지막 줄이 그 사실을 항상 함께 적습니다. provider 가 실패하거나 형식을 어긴 답을 보내도 안내만 찍고 승인 화면이 그대로 이어집니다.

  응답 본문이 없는 케이스는 진단에서 **제외합니다.** 호출이 오류로 끝나 서버 응답이 아예 없는 경우가 있는데, 빈 값을 채워 물으면 AI 에게 판단 재료가 없어 지어낸 답만 돌아옵니다. 몇 건을 왜 뺐는지는 화면에 남깁니다.

  `@ohmymcp-hsu/generate` 의 provider 객체에 `diagnoseRejection` 메서드가 추가됐습니다. `RejectionDiagnosisProvider` 의 메서드 이름이 `diagnose` 에서 `diagnoseRejection` 으로 바뀌었습니다 — 한 provider 객체가 기존 `diagnose(request: DiagnosisRequest, …)` 와 시그니처가 충돌하지 않게 하기 위함입니다.

- 5b469fe: `generate` 승인 화면의 시험 실행 결과 아래에 **거절 근거 미확인 목록**을 붙입니다. 위반 케이스가 통과했더라도 그 거절이 서버의 정상 거절인지 내부 오류인지 확인하지 못한 경우가 있고, 그 케이스의 id 와 응답 본문을 한 줄씩 보여줘 사람이 저장 전에 판단할 수 있게 합니다. 0건이면 아무것도 나오지 않습니다.

  **판정도 저장 여부도 바뀌지 않습니다.** 이 케이스들은 통과한 케이스이고 목록은 화면에만 나옵니다. 응답 본문은 기존 `escapeTerminalText` 로 제어 문자를 무해화하며, 개행도 함께 이스케이프되어 여러 줄 응답이 한 줄로 나옵니다. 본문 길이 제한은 `runner` 가 진단 값과 같은 상한에서 이미 적용합니다. 호출이 오류로 끝나 읽을 응답이 없는 케이스는 `(본문 없음)` 으로 적습니다.

- 892ff61: `ohmymcp replay <suite.json> --cassette <path>` 를 추가했습니다. 녹화된 카세트만으로 테스트 명세를 재생하며 MCP 서버를 실행하지 않습니다. 카세트에 마스킹된 값이 있으면 그 자리의 판정이 실제 서버와 다를 수 있다는 경고를 냅니다.
- 7600b09: 도그푸딩(공개 MCP 서버 8개)에서 잡힌 결함 셋을 고칩니다.

  - `generate` 가 지원하지 않는 JSON Schema 키워드를 만나면 서버 전체를 거절하던 것을, 해당 툴만 건너뛰고 나머지를 생성하도록 바꿉니다(ADR-0036). 건너뛴 툴은 `skippedTools` 로 결과에 실리고 화면에 `건너뜀 N tools` 블록으로 고지되며, 커버리지 분모에서 빠집니다. 실측에서 공개 서버 8개 중 5개가 툴 하나 때문에 전체 거절됐습니다. 전 툴 지원 서버의 출력과 지문은 바뀌지 않습니다.
  - `test` 가 `--arg` 값의 하이픈 접두를 거절해 `--arg -y` 를 못 받던 것을 고칩니다. `generate` 는 이미 받고 있었고, npx·uvx 로 띄우는 서버는 전부 여기 걸립니다.
  - `generate` 의 연결 단계 실패(서버가 spawn 직후 종료 등)가 원인 없는 `GENERATE_FAILED` 로 뭉개지던 것을, core 오류의 code·message·hint 를 그대로 보여주는 `GENERATE_CONNECT_FAILED/<code>` 로 바꿉니다.

- 6a93d42: cli: `generate` 가 `--out` 경로 충돌을 **서버에 붙기 전에** 알려 줍니다. 지금까지는 저장 확인에
  답한 뒤에야 막혀서, 후보 검토와 provider 호출과 실서버 시험 실행과 입력값 교정을 다 치른 다음에
  "파일이 이미 있다" 를 들었습니다. 이제 인자 파싱 직후에 끊습니다.

  덮어쓰려면 `--force` 를 붙입니다. 기존 파일을 지우고 새로 씁니다. 플래그가 없으면 지금처럼
  저장을 멈춥니다. 커밋 순간의 no-clobber 보장(`link` 의 `EEXIST`)은 그대로라 다른 프로세스가
  같은 경로를 만들면 여전히 막힙니다. `--force` 인데 기존 파일을 못 지우면
  `GENERATE_OUTPUT_REPLACE_FAILED` 로 끊고 시스템 오류 코드를 함께 보여줍니다.

- a2b37e0: 거절을 기대하는 케이스의 입력이 서버 선언을 하나도 어기지 않으면 `REJECTION_WITHOUT_VIOLATION` advisory 를 냅니다 (#94). ADR-0021 이 감수한 미탐(거절 기대 케이스에서 입력 계약 위반을 침묵)에 신호가 없어, 오타로 정상 입력이 됐거나 `expected` 를 잘못 적은 케이스가 아무것도 검증하지 않으면서 초록으로 통과했습니다. `cli test` 는 전용 머리글(`거절을 기대하지만 선언을 어기지 않습니다`)로, `generate` 승인 화면은 전용 블록(`거절 근거가 불분명한 케이스`)으로 보여주되 "위반 N건" 재확인 개수에는 넣지 않습니다. 서버가 선언 밖 제약(값의 도메인)으로 거절하는 정당한 케이스가 있으므로 차단하지 않습니다.
- 247e414: 진단 결과의 `discarded`를 단일 개수에서 사유별 개수로 확장합니다. 요청에 없는 케이스, 승인된 명세 수정 제안, `unsure` 응답에 함께 온 원인 후보를 각각 구분합니다.

  `repair` 화면은 실제로 발생한 제외 사유와 개수를 보여주고, 명세 재승인이나 재시도 중 관련 있는 다음 행동만 안내합니다.

- 58fb54a: 서버 수정 방향 제안(단계 4 repair)을 추가합니다. 승인된 명세로 `test` 를 돌려 실패가 났을 때 그 근거를 한 파일로 남기고, `ohmymcp repair` 가 그것을 AI provider 에게 물어 **서버 코드의 원인 후보**를 화면에 보여줍니다. 파일도 명세도 고치지 않습니다.

  cli: `repair` 명령을 추가합니다.

  ```
  ohmymcp repair <bundle.json> --provider <codex|claude> --model <model> [--max-cases <N>] [--no-stderr] [--yes]
  ```

  `--provider` 와 `--model` 은 필수이며 기본값을 두지 않습니다. 외부로 나가기 전에 전송 내용을 확인 화면으로 보여주고, 비대화형 환경에서 `--yes` 가 없으면 보내지 않습니다. `n` 을 답하면 provider 를 한 번도 부르지 않고 종료 코드 0 으로 끝납니다. 진단을 받았든 근거가 부족하든 종료 코드는 0 이고, 1 이 되는 경우는 운영 실패뿐입니다(ADR-0032, ADR-0033).

  cli: `test` 에 `--repair-bundle <path>` 옵션을 추가합니다. 실패한 케이스와 서버 stderr 를 담은 번들 파일을 만듭니다. `repair` 의 입력이며 `--json` 보고서와는 별도 파일입니다(ADR-0031). 실패가 없으면 파일을 만들지 않고 그 사실을 한 줄로 알립니다. 쓰기에 실패하면 전부 통과여도 종료 코드가 1 이고 `REPAIR_BUNDLE_WRITE_FAILED` 가 뜹니다. **이 옵션을 주지 않은 실행의 stdout · stderr · 종료 코드는 이전과 같습니다.**

### Patch Changes

- cd25fb4: core: 셸을 사용하지 않는 실행 명령 토큰화와 구체적인 명령 구문 오류를 공개 API로 제공한다.

  cli: reset 명령에서 닫히지 않은 실행 파일 큰따옴표와 빈 실행 파일 경로를 구분해 안내한다.

- 407f9ff: `generate`: 실패할 때 `generate`가 이미 알고 있던 원인을 그대로 보여 줍니다. 지금까지는 스키마가 거절돼도 `GENERATE_FAILED`와 "MCP 서버와 출력 경로를 확인하세요"만 나왔는데, 서버도 경로도 멀쩡한 경우라 **틀린 안내**였습니다. 이제 오류 코드·스키마 경로·원인·조치가 모두 나옵니다.

  ```text
  오류 [UNSUPPORTED_SCHEMA]: 지원하지 않는 JSON Schema 키워드 'maximum'가 있습니다. 경로: tools[3].inputSchema.properties.count.maximum
  해결: 첫 버전은 type, required, properties, items, enum, const, default, examples, description, title, $schema를 지원합니다.
  ```

- f58967f: AI 검토 응답에 제안된 변경이 없으면 재요청 방법과 현재 상태 저장 방법을 안내합니다.
- Updated dependencies [cd25fb4]
- Updated dependencies [49b2431]
- Updated dependencies [bf16fb5]
- Updated dependencies [7600b09]
- Updated dependencies [6ada2e6]
- Updated dependencies [5dd34d3]
- Updated dependencies [464d065]
- Updated dependencies [8a5b2a4]
- Updated dependencies [9bdd914]
- Updated dependencies [8eb955d]
- Updated dependencies [d70affe]
- Updated dependencies [99db6ee]
- Updated dependencies [f0ae3d3]
- Updated dependencies [2d68bdb]
- Updated dependencies [a2b37e0]
- Updated dependencies [8e28914]
- Updated dependencies [247e414]
- Updated dependencies [4e2c6df]
- Updated dependencies [4558ef9]
- Updated dependencies [db571dd]
  - @ohmymcp-hsu/core@0.3.0
  - @ohmymcp-hsu/generate@0.5.0
  - @ohmymcp-hsu/mock@0.2.0
  - @ohmymcp-hsu/record@0.1.2
  - @ohmymcp-hsu/runner@0.8.0

## 0.7.0

### Minor Changes

- b6658b9: CLI에 전체·서브커맨드 도움말과 버전 출력을 추가합니다. 인자 없음, `--help`, `-h`, `help`는
  사용 가능한 `test`·`generate` 명령을 stdout에 안내하고, `help <command>`와
  `<command> --help`는 해당 명령의 사용법을 표시합니다. 사용법 오류에서도 두 명령과 전체 도움말을
  발견할 수 있습니다.
- 0dd2a02: cli: `generate` 의 시험 실행이 실패한 케이스의 입력값을 고쳐 다시 호출합니다. 스키마에 힌트가
  없어 합성된 값(`"example"` 같은 것)이 서버에 거절당한 실패는 이제 분류 화면에 도달하지 않고
  교정 단계에서 닫힙니다. 케이스 하나당 최대 2회 고치고, 통과한 값은 기존 3단 경로를 거쳐 저장될
  명세에 반영됩니다. `--provider` 가 있으면 서버의 오류 응답을 근거로 값 후보를 받고, AI 가 값
  말고 다른 것을 건드린 응답은 통째로 폐기합니다. 두 번 고쳐도 실패하면 분류 화면으로 가고 시도
  이력이 함께 나옵니다. `--no-repair` 로 이 단계를 끌 수 있습니다.

  `Final fingerprint:` 표시가 시험 실행과 분류 뒤로 옮겨집니다. 교정이 명세를 바꾸므로 앞에서
  찍으면 사용자가 승인한 지문과 저장되는 `approval.fingerprint` 가 갈립니다. 교정이 없으면 찍히는
  값은 이전과 같고 화면 순서만 바뀝니다.

### Patch Changes

- Updated dependencies [81579f1]
- Updated dependencies [81579f1]
- Updated dependencies [ec99eab]
- Updated dependencies [0f4e5fd]
  - @ohmymcp-hsu/record@0.1.1
  - @ohmymcp-hsu/runner@0.7.0
  - @ohmymcp-hsu/generate@0.4.2

## 0.6.1

### Patch Changes

- Updated dependencies [0d92470]
- Updated dependencies [38ec704]
  - @ohmymcp-hsu/core@0.2.0
  - @ohmymcp-hsu/record@0.1.0
  - @ohmymcp-hsu/generate@0.4.1
  - @ohmymcp-hsu/mock@0.1.2
  - @ohmymcp-hsu/runner@0.6.1

## 0.6.0

### Minor Changes

- fb40da5: `ohmymcp test` 에 `--junit <path>` 를 추가합니다. runner 가 만든 JUnit XML 을 그 경로에 파일로
  써서, CI 도구가 테스트 결과를 화면에 렌더할 수 있게 합니다. `renderJUnit` 은 공개 API 였지만
  CLI 에 리포터를 고르는 수단이 없어 사용자가 쓸 방법이 없었습니다. 이 플래그가 그 연결입니다.

  `--junit=<path>` 형태도 받습니다. 중복 지정, 값 없음, 빈 값, `--` 로 시작하는 값은 거절합니다.
  경로 자리의 플래그는 값을 빠뜨린 오타이지 그 이름의 파일을 만들라는 뜻이 아니기 때문입니다.

  **`--json` 과 함께 쓸 수 있습니다.** 둘은 경쟁하지 않습니다 — `--json` 은 stdout 형식을,
  `--junit` 은 별도 산출물을 정합니다. `--junit` 은 stdout 을 바꾸지 않으므로 사람이 읽는 보고서를
  보면서 CI 용 XML 을 함께 만들 수 있습니다. 플래그 형태와 출력 대상을 고른 근거는 ADR-0019 에
  있습니다.

  XML 은 stdout 보다 먼저 씁니다. `| head` 같은 파이프에서 stdout 이 EPIPE 로 끊겨도 요청한
  산출물은 디스크에 남습니다. 파일을 쓰지 못하면 모든 테스트가 통과했더라도 `JUNIT_WRITE_FAILED`
  와 함께 종료 코드 1 을 냅니다. 조용히 0 을 내면 CI 는 리포트 없이 초록이 되고, 사용자는 리포트가
  필요한 순간에야 없다는 것을 알게 되기 때문입니다.

  `--junit` 을 주지 않으면 출력 바이트와 종료 코드가 이전과 동일합니다.

- d31c26e: 입력 계약 대조 결과를 승인 화면과 `test` 출력에 배선한다.

  `runner` 가 이미 갖고 있던 `checkInputContract` · `checkAssertionSubstance` 를 두 소비자에 연결해,
  오타·타입 불일치·항상 참인 단언이 승인 전과 실패 직후에 문장으로 보인다.

  - `ohmymcp generate` 승인 화면은 선택한 변경에 걸린 위반을 세어 보여 주고, 위반이 있으면 확인을
    한 번 더 받는다. 거부하지는 않는다.
  - `ohmymcp test` 는 실패한 케이스에만 참고 문장을 붙인다. 판정과 exit code 는 바뀌지 않는다.
    `--json` 은 `spec.findings` 에 구조로 담는다.

  공개 타입 변경 둘이 있다.

  - `@ohmymcp-hsu/runner` 의 `SpecFindingCode` 에서 `UNCONSTRAINED_SCHEMA` 가 사라진다. 소비자 경로에서
    `validateMcpSuite` 가 먼저 거부해 도달할 수 없는 코드였다.
  - `@ohmymcp-hsu/generate` 의 `SanitizedAuthoringCandidate` 에 `specFindings` 필드가 생긴다. 승인
    지문 계산 대상 밖이라 이미 승인된 지문은 그대로다.

### Patch Changes

- Updated dependencies [d31c26e]
  - @ohmymcp-hsu/generate@0.4.0
  - @ohmymcp-hsu/runner@0.6.0

## 0.5.0

### Minor Changes

- 3430f8f: generate 가 저장하는 명세에 `approval.fingerprint` 를 기록하고, test 가 실행 시점에 계산한
  지문과 대조해 결과를 보고서에 적습니다. 지문은 `approval` 블록을 제외한 명세 전체의 sha256
  이므로 들여쓰기나 키 순서 같은 표기 변경으로는 달라지지 않습니다.

  **판정은 바뀌지 않습니다.** 종료 코드는 케이스 결과로만 정해집니다. 명세를 고치는 것은 정상
  작업이고, 그때마다 테스트가 막히면 사용자는 확인 절차를 우회하는 방법부터 찾게 됩니다.

  표시는 전부 통과일 때 불일치만 알리고, 실패가 있으면 세 상태를 모두 알립니다. 매 실행 한 줄은
  손으로 명세를 쓰는 사용자에게 영구 소음이기 때문입니다. `--json` 에는 억제 규칙을 적용하지
  않고 `spec` 키를 항상 넣습니다. 기존 보고서 키는 그대로입니다.

  지문이 없는 명세도 그대로 실행됩니다. 손으로 쓴 명세와 이 기능 이전에 만든 명세가 여기에
  해당합니다.

### Patch Changes

- Updated dependencies [c0d17d6]
- Updated dependencies [c728f02]
- Updated dependencies [9803c19]
- Updated dependencies [cfa921d]
  - @ohmymcp-hsu/mock@0.1.1
  - @ohmymcp-hsu/runner@0.5.0
  - @ohmymcp-hsu/generate@0.3.5

## 0.4.1

### Patch Changes

- Updated dependencies [d8227e2]
  - @ohmymcp-hsu/runner@0.4.0
  - @ohmymcp-hsu/generate@0.3.4

## 0.4.0

### Minor Changes

- f4a78b0: `ohmymcp test` 가 실패했거나 서버가 비정상 종료·중단했을 때, 보여줄 진단 정보가 있으면 서버
  프로세스 진단을 stderr 에 출력합니다. 종료 코드, 시그널, 서버가 남긴 stderr 의 마지막 줄들을
  보여줍니다. 기동 즉시 죽는 서버처럼 지금까지 단서가 전혀 없던 경로에서도 원인을 볼 수 있습니다.

  서버 프로세스와 무관한 실패에는 붙지 않습니다. 명세 검증 실패처럼 연결 이전에 끝나는 경로와
  보고서 렌더링 중의 내부 오류가 그렇습니다.

  `--stderr-lines <N>` 으로 표시할 줄 수를 조절합니다. 기본값은 20 이고 `0` 을 주면 진단을 끕니다.

  진단은 stdout 이 아니라 stderr 로 나가므로 `--json` 출력의 바이트는 이전과 같습니다. 판정과
  종료 코드도 바뀌지 않았습니다. 서버가 정상 종료하고 stderr 도 비어 있으면 보여줄 근거가 없으므로
  블록을 출력하지 않습니다.

## 0.3.1

### Patch Changes

- Updated dependencies [4da5f7c]
  - @ohmymcp-hsu/runner@0.3.1
  - @ohmymcp-hsu/generate@0.3.3

## 0.3.0

### Minor Changes

- 74c96da: `ohmymcp test` 의 기본 출력을 사람이 읽는 보고서로 바꿉니다. 실패한 케이스의 진단 문장과
  해결 힌트를 터미널에 직접 표시합니다.

  **파괴적 변경**: 기존의 JSON 출력은 `--json` 플래그로 옮겼습니다. stdout을 기계로 파싱하던
  스크립트는 `ohmymcp test ... --json` 으로 바꿔야 합니다. `--json` 출력의 바이트는 이전과
  동일합니다. 종료 코드는 바뀌지 않았습니다.

### Patch Changes

- Updated dependencies [74c96da]
  - @ohmymcp-hsu/runner@0.3.0
  - @ohmymcp-hsu/generate@0.3.2

## 0.2.2

### Patch Changes

- Updated dependencies [a1f9bb4]
  - @ohmymcp-hsu/runner@0.2.0
  - @ohmymcp-hsu/generate@0.3.1

## 0.2.1

### Patch Changes

- Updated dependencies [ed2a3b8]
  - @ohmymcp-hsu/generate@0.3.0

## 0.2.0

### Minor Changes

- 0bf2549: 결정론적 baseline과 사용자 Codex·Claude를 이용한 반복 검토를 지원하는 generate 명령을 추가합니다.

### Patch Changes

- 0b89688: suite 저장을 원자적 no-clobber로 바꾼다. 지금까지는 저장 전에 출력 경로를 검사한 뒤 `rename`으로
  커밋했는데, `rename`은 대상이 있으면 말없이 덮어쓴다. 검사와 커밋 사이에 다른 프로세스가 같은
  경로를 만들면 그 파일이 조용히 사라졌다. 이제 `link`로 커밋해 대상이 있으면 `EEXIST`로 실패하고
  `GENERATE_OUTPUT_EXISTS`로 안내한다. 임시 파일 이름도 실행마다 고유해진다.
- 5899f3d: generate의 provider 실패 안내를 원인별로 다시 쓴다. `nonZeroExit`의 `reason`에 따라
  `GENERATE_PROVIDER_MODEL`, `GENERATE_PROVIDER_AUTH`, `GENERATE_PROVIDER_RATE_LIMIT`,
  `GENERATE_PROVIDER_REQUEST`, `GENERATE_PROVIDER_SERVER`로 나눠 안내하고, 실패한 모델 이름과
  provider 기본 모델을 함께 보여준다. 로그인 확인 명령도 해당 provider의 것만 찍는다.
  지금까지는 codex로 실패해도 `claude /status`가 같이 나왔다.
- c77f668: 출력 디렉터리가 hard link를 지원하지 않거나 권한이 없어 저장이 막힌 경우를
  `GENERATE_LINK_UNSUPPORTED`로 따로 안내한다. 지금까지는 일반 실패로만 끝나 사용자가 무엇을
  바꿔야 다시 시도할 수 있는지 알 수 없었다. 이제 경로와 원인 코드, 그리고 다른 디렉터리를
  `--out`으로 지정하라는 조치를 함께 보여준다.
- 8f495c4: generate의 AI provider 실패를 원인별로 분기해 안내한다. `providerUnavailable`, `nonZeroExit`,
  `timedOut`, `schemaMismatch`, `cancelled`는 각각 다른 오류 코드와 조치 문장을 출력하고, 나머지
  코드는 기존 `GENERATE_PROVIDER_FAILED` 문구를 유지한다.
- 3272114: `--baseline-only`가 실제 터미널에서 종료되지 않던 문제를 고친다. readline 인터페이스를 명령
  시작 시점이 아니라 첫 질문 시점에 만들도록 바꿔, 아무것도 묻지 않는 경로에서는 입력 스트림을
  잡지 않는다.

  출력 경로에 파일이 이미 있어 저장이 막힌 경우를 다른 I/O 실패와 분리해
  `GENERATE_OUTPUT_EXISTS`로 안내한다. 경로와 다음 조치를 함께 보여준다. 대화형·비대화형 두
  경로 모두에 적용된다.

- f393c48: generate AI 검토의 승인 화면이 무엇이 바뀌는지 보여준다. 지금까지 change ID와 종류만 찍어
  사용자가 내용을 모른 채 승인해야 했다. 이제 각 change 아래에 바뀐 leaf 경로를 `-`와 `+`로
  보여주고, 케이스 추가·삭제는 전체 경로를, 순서 변경은 before와 after 순서를 보여준다.
  본문이 40줄을 넘으면 잘라내고 남은 줄 수를 알린다.
- 930e6ba: 대화형 검토 중 stdin이 EOF로 닫히면 Node readline 스택을 노출하며 비정상 종료하던 문제를 고친다.
  이제 취소와 같은 경로로 종료 코드 0으로 끝나고 `입력이 종료되어 검토를 취소했습니다. 저장하지
않았습니다.`만 출력한다. 닫힘이 아닌 오류는 기존대로 전파한다.
- Updated dependencies [0694441]
- Updated dependencies [77d7623]
- Updated dependencies [ba4bc97]
- Updated dependencies [53d0440]
- Updated dependencies [7c1cf62]
- Updated dependencies [3760bac]
- Updated dependencies [623eea0]
  - @ohmymcp-hsu/generate@0.2.0
  - @ohmymcp-hsu/mock@0.1.0

## 0.1.0

### Minor Changes

- c42f6a8: JSON 테스트 명세와 stdio MCP 서버 실행 정보를 받아 실제 RunnerReport와 종료 코드를 만드는 test 명령을 추가한다.

### Patch Changes

- Updated dependencies [606600f]
- Updated dependencies [b80e0e5]
  - @ohmymcp-hsu/core@0.1.0
  - @ohmymcp-hsu/generate@0.1.0
  - @ohmymcp-hsu/mock@0.0.1
  - @ohmymcp-hsu/record@0.0.1
  - @ohmymcp-hsu/runner@0.1.1

## 0.0.1

### Patch Changes

- Updated dependencies [216184a]
  - @ohmymcp-hsu/runner@0.1.0
