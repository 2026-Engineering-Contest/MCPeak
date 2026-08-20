# ohmymcp

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
