# @ohmymcp-hsu/record

## 0.4.0

### Minor Changes

- b99847f: **Breaking**: External 세션이 URL 경로를 더 이상 저장하지 않습니다(ADR-0053). 저장하는 표준
  URL 필드 넷(요청 `display.url`, 저장 outcome의 `url`, `location`·`content-location` 헤더)에서
  pathname 을 `<redacted>` 로 지웁니다. `location`·`content-location` 이 상대 참조(RFC 9110)여도
  거부하지 않고 응답 URL 기준으로 절대 URL 로 해석한 뒤 같은 규칙을 적용합니다.

  matchKey 계산에는 영향이 없습니다 — 정확한 pathname(매칭 재료)은 여전히 매칭에 쓰이고, 다만
  자식 프로세스 밖으로 나가지 않습니다. `/hooks/AAA` 와 `/hooks/BBB` 는 여전히 다른 matchKey 를
  냅니다. 그래서 이 개정 **이전에 만든 세션 파일도 Replay 는 계속 됩니다** — 다만 경로가 원문으로
  남아 있으므로, README의 정리 절차(삭제 → 자격증명 재발급 → 재녹화)를 따르세요.

  응답의 `redirect: "manual"` 로 받은 301·302·303·307·308 도 `Response.redirected` 값과 무관하게
  거부합니다 — 그 응답의 `Location` 이 경로가 든 절대 URL 이라, 지우려던 경로가 응답 쪽으로
  되돌아오는 구멍이었습니다.

  `NormalizedExternalRequest` 의 `match` 필드가 없어지고 `schemaVersion` 은
  `interactionSchemaVersion` 으로 개명됩니다. 둘 다 `@mcpeak/record/external` 의 공개 표면에는
  없는 내부 타입이라 소비자(`cli`)에는 영향이 없습니다.

  **진단이 약해지는 자리가 하나 있습니다.** replay miss·incomplete 메시지의 URL 이
  `GET https://api.example.com/<redacted>` 까지만 말합니다. **경로로 자원을 가르는 API 는 miss 줄이
  서로 같아집니다** — `/weather/seoul` 과 `/weather/busan` 이 둘 다 `https://api.example.com/<redacted>`
  로 보입니다. 함께 표시되는 matchKey 로 구분해야 합니다. query 로 가르는 API(`?city=seoul`)는
  query 가 남으므로 영향이 없습니다.

  함께 고친 것들:

  - **Coordinator 가 URL 오류를 500 으로 뭉개고 세션을 열어 두던 문제.** `runtime.mjs` 는 자식에서도
    돌아 `.ts` 를 import 할 수 없어 오류를 직접 만들어 썼는데, 그 값이 `ExternalRecordReplayError`
    의 인스턴스가 아니라서 부모의 분기를 빠져나갔습니다. 자격증명이 든 URL 처럼 재검사 도중 나는
    오류가 분류된 4xx 대신 `COORDINATOR_INTERNAL` 500 으로 나가고, ADR-0052 가 요구한 "불변식이
    깨지면 세션을 즉시 실패로 닫는다" 도 건너뛰었습니다. 오류 클래스를 `errors.mjs` 로 내려 부모와
    자식이 같은 인스턴스를 보게 했습니다.
  - **`throw` 결과에 재구성이 없어 재검사가 항등식이던 문제.** `redactStoredOutcome` 이 response 가
    아닌 값을 입력 그대로 돌려주어 바이트 비교가 같은 참조끼리의 비교가 됐고, 자식이 실어 보낸
    낯선 필드가 검증 없이 저장됐습니다. 이제 두 갈래 다 알려진 필드만 옮겨 담습니다.
  - **낯선 필드의 진단이 뒤바뀌던 문제.** 스키마에 없는 필드가 원인인데도 "민감 값 마스킹을
    놓쳤다" 는 문장이 나가, 사용자가 민감 키 목록 version 을 뒤지게 했습니다. 요청의 중첩
    `display` 와 저장 결과(`response`·`throw`) 모두 `unknown-field` 로 분류합니다.
  - **재검사의 예외를 전부 위반으로 단정하던 문제.** 우리 쪽 실패까지 "자식과 부모의 build 가
    다르다" 로 나갔습니다. 이제 의도적으로 거절한 오류만 위반으로 분류하고 나머지는 그대로 올립니다.
  - **전송 표현 헤더를 저장하던 문제.** `content-encoding`·`transfer-encoding`·`content-length` 는
    원래 전송 형태를 가리키는데 저장하는 body 는 이미 압축이 풀린 최종 바이트라, 재생 때 평문 body
    에 "gzip 이다" 라는 헤더가 붙어 나갔습니다.

- 3e39e33: 녹화한 세션 body 에 남은 URL 문자열을 세어 종료 요약에 싣습니다([ADR-0062](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0062-세션-본문의-url-은-지우지-않고-알린다.md), [#311](https://github.com/2026-Engineering-Contest/MCPeak/issues/311)).

  마스킹은 이름으로 판정하는데(`token`·`apiKey`) URL 경로 세그먼트에는 판정에 쓸 이름이 없습니다.
  그래서 Slack·Discord webhook 처럼 **경로 자체가 자격증명**인 endpoint 가 자기 URL 을 body 로
  되돌려주면 그 값이 세션 파일에 원문으로 남았고, 대응은 README 의 "커밋 전에 내용을 확인해라"
  한 줄뿐이었습니다. 세션은 SQLite 라 눈으로 훑을 수도 없습니다.

  이제 녹화 요약이 두 갈래로 셉니다.

  - **되돌아온 경로** — body 의 URL 이 그 요청의 경로를 그대로 담고 있습니다. 자식이 정확한
    경로를 쥐고 판정하므로 추측이 없습니다.
  - **그 밖의 URL 문자열** — 되돌아온 경로는 아니지만 URL 로 해석되는 값입니다.

  **지우지는 않습니다.** 저장한 body 가 곧 재생에서 서버가 받는 값이라, 경로를 지우면 `next` 를
  따라가는 서버가 없는 경로로 요청해 재생이 깨집니다 — body 에 URL 이 있는 서버, 즉 지켜야 할
  바로 그 서버가 깨집니다. ADR-0062 가 그 대가를 재고 "지우지 않고 알린다" 를 골랐습니다.

  **원문 URL 은 세션 파일에 그대로 남습니다** — 지우지 않는 것이 이 결정입니다. 값이 나가지 않는
  곳은 **Coordinator wire 와 종료 요약** 둘입니다. 자식이 부모로 보내는 것은 SHA-256 지문뿐이라,
  세는 쪽은 URL 을 볼 수 없으면서도 세션 전체에서 중복을 제거합니다. 진단이 새 유출 경로가 되지
  않게 하는 형식적 보장이고, Coordinator 는 지문 형태(64자 hex)를 벗어난 값이 오면 세션을 실패로
  닫습니다. URL 이 512개를 넘으면 지문 일부를 버리고 "최소 N건" 으로 알립니다 — 전부 실으면
  Coordinator payload 상한을 넘겨 녹화가 통째로 실패하기 때문입니다.

  세션 저장 형식은 바뀌지 않았습니다 — 탐지 결과는 저장하지 않고 종료 요약에만 실립니다. 기존
  세션 파일과 그것을 읽는 소비자는 영향받지 않습니다.

  사용자에게 보이는 알림 문구는 `@mcpeak/cli` 후속 변경에서 붙습니다.

- 63e50fe: record: 세션 파일을 읽기 전용으로 열어 스냅샷을 주는 `loadSession(path)` 을 `@mcpeak/record/external` 에 추가

  세션 파일이 아니면 던지지 않고 `null` 을 준다. 프로젝트를 훑으며 "이게 세션인가" 를 묻는 판별기라(legacy 의 `loadCassette` 와 같은 자리), 아닌 파일이 정상 입력이기 때문이다. `readOnly: true` 로 열어 없는 경로에 빈 DB 를 만들지 않는다.

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

- 3d79cd7: `createSqliteSessionStore` 에 `readOnly` 옵션을 더했습니다. 켜면 세션 DB 를 읽기 전용으로 열고
  스키마 DDL·`meta` INSERT 를 돌리지 않습니다 — **주어진 파일을 만들지도 고치지도 않습니다.**

  재생(`--session`)은 읽기인데 저장소가 모드와 무관하게 DDL 을 실행하고 있었고, 그 결과가 둘이었습니다([#291](https://github.com/2026-Engineering-Contest/MCPeak/issues/291)).

  - 읽기 전용(chmod 444) 세션은 `attempt to write a readonly database` 로 한 건도 재생되지 않았습니다. 저장소에 커밋한 세션·CI 아티팩트 캐시·읽기 전용 마운트에서 재생을 쓸 수 없다는 뜻입니다.
  - 0바이트 파일을 넘기면 **실패한 실행이 그 파일을 36,864바이트짜리 빈 세션 DB 로 덮어썼습니다.**

  `readOnly` 로 연 저장소는 세션이 아닌 파일을 거부하고, 그 이유를 원인별로 갈라 말합니다 —
  세션이 없는 파일과 store version 이 다른 파일은 사용자가 할 일이 다릅니다. 녹화 계열 호출
  (`createSession`·`reserve`·`complete`·`finish`)은 SQLite 원문 대신 우리 문장으로 거부합니다.

  기본값은 `false` 이고 녹화 경로의 동작은 그대로입니다.

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

- 8dc503e: **Breaking**: `@mcpeak/record` 에서 Tool 카세트 구현을 제거했습니다. 이 패키지는 이제 External
  세션 전용입니다([ADR-0059](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0059-tool-카세트를-제거한다.md)).
  `verify`·`replay`·`generate --cassette` 로 사용자 표면을 걷어낸 데 이은 마지막 조각입니다.

  사라진 export:

  - `cassetteClient` · `loadCassette` · `saveCassette` · `diffCassettes` · `droppedInteractionsMessage`
  - `verifyCassette` · `matchKey` · `redact` · `stableStringify` · `CASSETTE_VERSION` · `REDACTED`
  - 관련 타입 전부(`Cassette` · `CassetteInteraction` · `CassetteMode` · `CassetteClientOptions` ·
    `CassetteDropReport` · `CassetteMismatch` · `CassetteVerifyResult`)

  패키지 루트(`@mcpeak/record`)는 이제 `@mcpeak/record/external` 과 **같은 API** 를 냅니다 —
  `startExternalCoordinator` · `createSqliteSessionStore` · `loadSession` ·
  `ExternalRecordReplayError`. 서브패스로 부르던 코드는 그대로 동작합니다.

  갈아탈 곳은 목적에 따라 갈립니다.

  - 서버의 외부 HTTP 호출을 막고 싶다면 External 세션을 쓰세요 —
    `mcpeak test <suite.json> --command <executable> --record-session <path>` 로 녹화하고
    `--session <path>` 로 재생합니다. 서버는 실제로 뜨고 그 서버가 밖에 부르는 호출만 막힙니다.
  - 서버 자체를 실행하지 않고 결정론적인 응답으로 테스트하려면 `@mcpeak/mock` 을 쓰세요.

  `@mcpeak/core` 런타임 의존도 함께 제거했습니다. External 세션은 `McpClient` 를 감싸지 않아
  core 타입을 쓰지 않습니다.

### Patch Changes

- 51a7193: External 세션의 `link`(RFC 8288)·`refresh` 응답 헤더에도 URL 경로 제거를 적용합니다
  (ADR-0053 개정, #301). `location`·`content-location` 을 막은 뒤 남아 있던 잔여 유출 경로입니다.

  값 전체가 아니라 **URL 부분만** 지웁니다. `link` 는 각 `<URI>` 를 응답 URL 기준으로 해석한 뒤
  `https://host/<redacted>?…` 로 바꿉니다. 파라미터는 `rel` 이 등록 값(`next`·`prev`·`first`·`last`·
  `self` 등)일 때만 원문으로 남깁니다 — pagination 진단(`rel="next"`)은 그대로 보입니다. 그 밖의
  `rel` 값과 다른 파라미터(`title`·`type`·`anchor`·확장 파라미터)는 이름도 값도 문법상 임의
  문자열이라 토큰을 가려낼 수 없으므로 이름째 `param=[redacted]` 로 씁니다. `refresh` 는 지연 초를 남기고 `url=` 의 URL 만 지웁니다.
  문법대로 해석되지 않는 값은 통째로 `[redacted]` 입니다.

  ```
  Link: </services/T00/B00/XXXXSECRET?cursor=2>; rel="next"
    → <https://hooks.example.com/<redacted>?cursor=2>; rel="next"
  Refresh: 0; url=/hooks/REFRESHSECRET
    → 0; url=https://hooks.example.com/<redacted>
  ```

  matchKey 와 Replay 매칭에는 영향이 없습니다. 이 변경 전에 녹화한 세션 파일에는 두 헤더의
  경로가 원문으로 남아 있으므로 README 의 정리 절차를 따르세요.

- 3f7692d: record: 재생 원본 판정을 둘로 가릅니다. 세션이 아예 없으면 `SESSION_NOT_FOUND`, 있는데 녹화가
  완료되지 않았으면 `REPLAY_SOURCE_INVALID` 입니다. 사용자에게 보이는 문장에서 내부 세션 id
  (`"default"`)를 뺐습니다 — 사용자가 준 적 없는 이름이라 무엇을 가리키는지 알 수 없었습니다.

  cli: `test --session` 이 세션을 열지 못했을 때 원인마다 다른 문장을 보여주고, **사용자가 준
  경로**를 함께 싣습니다. 그리고 없는 경로로 재생을 시도해도 **그 자리에 빈 세션 파일을 만들지
  않습니다** — `node:sqlite` 가 경로를 생성해 버려서, 오타 한 번에 빈 DB 가 남고 두 번째 실행부터는
  "파일이 없다" 는 진단이 거짓이 됐습니다.

  이전에는 없는 파일·빈 세션·실패한 녹화가 모두 같은 두 문장으로 끝났고, 재생인데 쓰기 권한을
  확인하라고 안내했습니다(#260).

## 0.3.0

### Minor Changes

- e99192a: Node.js 최소 지원 버전을 22.18.0으로 올리고, 배포 패키지의 `engines.node`에 같은 요구사항을 명시합니다.
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

- Updated dependencies [e99192a]
- Updated dependencies [2e62615]
- Updated dependencies [93816a8]
  - @mcpeak/core@0.4.0

## 0.2.0

### Minor Changes

- 55ba842: record: 아무 경로에도 배선되지 않은 `snapshotContract` 를 공개 API 에서 제거합니다. 비결정
  필드를 지워 감추는 대신 실행 간 차이를 보고하는 쪽(ADR-0038 결정론성 확인)으로 프로젝트가
  방향을 정했고, 이 함수의 전제는 그 결정에 뒤집혔습니다. 이 함수만 쓰던
  `NONDETERMINISTIC_KEYS` 와 `normalizeKey` 도 함께 걷어냈고, `transformJson` 은 옵션이
  사라져 `redact` 가 본체를 흡수했습니다. `redact` 의 동작과 마스킹 경계는 그대로입니다.
  근거는 ADR-0047 입니다.
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

## 0.1.2

### Patch Changes

- 8a5b2a4: record 실행과 replay 실행이 같은 요청에 다른 값(타입까지)을 돌려주던 문제를 고칩니다.
  `callTool`·`listTools` 반환값도 카세트 파일 저장 시점과 같은 경계에서 마스킹합니다.
  카세트로 클론할 수 없는 응답을 그대로 돌려주던 녹화 실패 fallback 경로는 이 마스킹을 타지
  않고 원문을 그대로 돌려줍니다 — 그 값에 마스킹을 걸면 fallback 자체가 다시 던지기 때문입니다.
- 9bdd914: record와 auto 모드에서 카세트로 직렬화할 수 없는 호출 인자가 실제 MCP 호출을 막지 않도록 합니다. 실제 결과는 반환하되 불완전한 카세트를 저장하지 않도록 `onFlush`는 호출하지 않고, `close()`에서 값의 경로와 종류를 보고합니다. replay 모드에서는 실제 호출 없이 조회할 수 없는 값의 경로와 종류를 안내합니다.
- 8eb955d: 민감 키 목록에 `key` 합성어와 `passwd` · `credential` 이 추가되고, **복수형이 조회에서
  흡수됩니다.**

  ADR-0039 가 매칭을 접미 단어열 **정확 일치**로 좁힌 뒤, 목록이 그 규칙을 따라가지 못한
  구멍이 남아 있었습니다. 접미 조합이 목록에 없으면 전부 통과하므로 `secretKey` 는 `secret`
  이 목록에 있어도 접미 조합이 `key` · `secretkey` 뿐이라 어디에도 걸리지 않았습니다.
  `apiKey` 를 목록에 따로 넣어야 했던 것과 같은 구멍입니다. 복수형도 같습니다 — `token` 은
  걸리지만 `tokens` 는 통과했고, 토큰이나 비밀값이 배열로 오는 응답은 흔합니다.

  **새로 마스킹되는 것**

  | 종류         | 예                                                                           |
  | ------------ | ---------------------------------------------------------------------------- |
  | `key` 합성어 | `privateKey` · `secretKey` · `signingKey` · `sessionKey`                     |
  | 그 외 추가   | `credential` · `passwd`                                                      |
  | 복수형       | `tokens` · `secrets` · `passwords` · `cookies` · `apiKeys` · `refreshTokens` |

  **여전히 마스킹되지 않는 것** — `tokenCount` · `secretariat` 은 그대로고, 복수형 완화가
  `tokenCounts` · `secretariats` · `cookieCounts` 를 새로 잡지도 않습니다. 꼬리 `s` 를 떼도
  머리 명사는 바뀌지 않기 때문입니다. `key` 단독은 ADR-0039 의 판단대로 계속 넣지 않습니다.

  **일부러 뺀 것** — `auth` 는 `auth: { token, type }` 의 하위 트리를 통째로 가려 구조를 영영
  못 보게 만들고(`auth.token` 은 이미 `token` 으로 걸립니다), `pwd` 는 파일시스템 MCP 서버가
  작업 디렉터리 이름으로 쓰며, `bearer` 는 `bearerToken` 이 이미 `token` 으로 걸립니다.

  **카세트 파일의 내용이 바뀝니다.** 포맷과 `CASSETTE_VERSION` 은 그대로라 기존 카세트도 계속
  읽히지만, 다시 녹화하기 전까지는 예전 마스킹 결과를 그대로 갖고 있습니다. 위 필드를 단언하던
  테스트는 이제 `"[redacted]"` 를 보게 됩니다. 근거는 ADR-0045 에 있습니다.

- d70affe: replay에서 카세트 키를 찾지 못했을 때 가장 가까운 저장 요청의 필드별 차이를 보여주고, 마스킹 후 동일한 요청은 키 앞부분으로 구분합니다.
- 99db6ee: 카세트에 저장되는 `tools.inputSchema` 가 **더 이상 파괴되지 않습니다.**

  지금까지는 응답 데이터와 같은 규칙으로 스키마를 마스킹해서, `properties.apiKey` 처럼
  민감한 이름의 프로퍼티는 **정의 객체 전체가 `"[redacted]"` 문자열로 치환**됐습니다.

  ```
  { properties: { apiKey: { type: "string", default: "sk-..." } } }
            ↓ (이전)
  { properties: { apiKey: "[redacted]" } }
            ↓ (이후)
  { properties: { apiKey: { type: "string", default: "[redacted]" } } }
  ```

  스키마에서 프로퍼티 이름은 값이 아니라 선언 대상입니다. 이제 구조는 그대로 두고
  `default` · `examples` · `const` · `enum` 처럼 **값이 들어가는 자리만** 마스킹합니다.
  `properties` · `items` 는 재귀하고, 민감도는 그 자리까지 내려온 프로퍼티 이름으로
  판정합니다. ADR-0004 가 해석하지 않는 `allOf` · `anyOf` · `oneOf` 는 대상이 아닙니다.

  **이 변화가 중요한 이유** — 스키마가 부서지면 `replay` 와 `generate --cassette` 경로의
  입력 계약 대조가 판정 근거를 잃고, 그 실패가 "위반 없음"과 구분되지 않게 조용히
  사라집니다. 이제 스키마가 보존되어 대조가 실제로 의미를 갖습니다.

  카세트 포맷과 `CASSETTE_VERSION` 은 바뀌지 않지만, 저장되는 스키마의 **구조**가
  달라지므로 구형 카세트와는 내용이 어긋납니다. 다시 녹화하기 전까지는 예전 구조를
  그대로 갖고 있습니다.

  근거는 ADR-0040 에 있습니다.

- f0ae3d3: 민감 키 판정이 **이름에 포함되면 걸리는 방식에서 접미 단어열이 정확히 일치할 때 걸리는
  방식으로** 바뀝니다. 그리고 `cookie` 가 목록에 추가됩니다.

  **새로 마스킹되는 것** — `Cookie` · `Set-Cookie` 헤더. 세션 값을 나르는데도 목록에 없어
  카세트 파일과 경고 출력에 원문으로 남고 있었습니다. `authorization` 은 이미 목록에 있었으니
  같은 급인 쪽만 빠져 있던 셈입니다.

  **더 이상 마스킹되지 않는 것** — `tokenCount` · `passwordPolicy` · `secretariat` 처럼 민감
  단어를 품고 있을 뿐인 필드. 영어 합성명사는 마지막 단어가 머리라서 `accessToken` 은 토큰의
  일종이지만 `tokenCount` 는 개수의 일종입니다.

  | 키                                              | 이전      | 이후      |
  | ----------------------------------------------- | --------- | --------- |
  | `Cookie` · `Set-Cookie`                         | 원문 노출 | 마스킹    |
  | `accessToken` · `X-Api-Key` · `apiKey0`         | 마스킹    | 마스킹    |
  | `tokenCount` · `passwordPolicy` · `secretariat` | 마스킹    | 값 그대로 |

  **카세트 파일의 내용이 바뀝니다.** 포맷과 버전은 그대로라 기존 카세트도 계속 읽히지만,
  다시 녹화하기 전까지는 예전 마스킹 결과를 그대로 갖고 있습니다.

  `tokenCount` 같은 필드를 단언하던 테스트는 이제 실제 값을 보게 됩니다. 근거는 ADR-0039 에
  있습니다.

- 2d68bdb: 같은 요청에 다른 응답이 왔을 때 나오는 경고가 **비밀값을 원문 그대로 출력하던 문제를
  고칩니다.** 응답 마스킹은 카세트를 파일로 쓰는 시점에만 걸렸기 때문에, 이 경고에는
  `sessionToken` 같은 값이 가려지지 않은 채 실렸습니다. 같은 메시지의 요청 쪽은 이미
  마스킹되고 있었으므로 응답 쪽만 새고 있었습니다. 경고는 stderr 로 나갑니다.

  이제 표시 직전에만 마스킹합니다.

  ```
  → 같은 요청에 다른 응답이 왔습니다: get_stock({"ticker":"AAPL"})
    1회차 raw.token: "[redacted]" / 2회차 raw.token: "[redacted]"
    → 위 값은 마스킹되어 표시됩니다. 실제 값은 서로 다릅니다.
  ```

  **차이 판정은 원문 기준 그대로입니다.** 마스킹한 값으로 비교하면 서로 다른 두 비밀값이
  같아져 "같은 요청에 다른 응답" 경고 자체가 사라집니다. 이 경고의 목적이 비결정 서버를
  드러내는 것이므로(ADR-0003), 판정과 표시를 분리하는 쪽을 골랐습니다.

  값이 마스킹되면 양쪽이 똑같이 `[redacted]` 로 보여 거짓 양성처럼 읽히므로, 값이 실제로
  다르다는 고지를 한 줄 붙입니다.

  카세트 포맷과 저장되는 내용은 바뀌지 않습니다.

- Updated dependencies [cd25fb4]
- Updated dependencies [bf16fb5]
  - @ohmymcp-hsu/core@0.3.0

## 0.1.1

### Patch Changes

- 81579f1: record: 실제 MCP 호출이 성공한 뒤 카세트에 기록할 `callTool` 응답이나 `listTools` 결과를
  복제하지 못해도 성공 결과를 먼저 돌려주고, `close()`에서 녹화 실패와 JSON 경로를 함께
  보고합니다.
- 81579f1: record: `redact`의 sparse array 검사를 실제로 실행되는 경로로 옮기고, request args와 response
  마스킹 시점 문서를 구현과 맞춥니다.

## 0.1.0

### Minor Changes

- 38ec704: record: McpClient 카세트 데코레이터와 stable JSON 기반 녹화·재생 API 추가

### Patch Changes

- Updated dependencies [0d92470]
  - @ohmymcp-hsu/core@0.2.0

## 0.0.1

### Patch Changes

- Updated dependencies [606600f]
  - @ohmymcp-hsu/core@0.1.0
