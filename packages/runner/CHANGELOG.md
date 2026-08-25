# @ohmymcp-hsu/runner

## 0.10.0

### Minor Changes

- 647a175: `test`가 서버의 `inputSchema`를 해석하지 못해 입력 계약 검사를 건너뛴 경우, 테스트 케이스가
  통과했더라도 그 사실을 알립니다(#288). `SCHEMA_NOT_ANALYZABLE` finding에는 해석 실패 사유가
  추가되며, 사람용 출력은 사유와 함께 스키마를 고치는 방법을 안내합니다.

  README의 목 서버 예시도 `properties`와 `required`가 있는 검사 가능한 입력 스키마로 고쳤습니다.

- ff33aa7: 보고서 크기가 상한(1MB)의 80% 이상이면 실제 바이트로 알립니다(#92).

  상한은 올릴 수 없고 넘으면 테스트 실패가 아니라 예외로 죽습니다. 지금까지는 `generate` 가
  케이스 1500개에서 고지했는데, 그 임계는 케이스당 600바이트라는 관측 추정 위에 있었습니다.
  응답이 큰 서버는 1500 미만에서 벽에 닿고, 작은 서버는 3000개에서도 안전한데 경고를 봅니다.

  `test` 실행 시점에는 보고서를 만들면서 크기를 압니다. 그 값으로 판정합니다.

  ```
    → 보고서 크기가 850KB 로 상한 1024KB 의 82% 입니다.
      케이스나 응답이 더 커지면 test 실행이 보고서 상한 초과로 실패합니다. 상한은 올릴 수 없습니다.
      툴을 나눠 여러 명세 파일로 만들면 피할 수 있습니다.
  ```

  `RunnerReport.payload` 키가 80% 이상일 때만 생깁니다. 대부분의 실행에서 키가 없어 `--json` 출력은
  이전과 바이트 그대로입니다. `reportBytes` 는 이 키를 넣기 전 크기이고, 상한 초과 판정도 같은
  값으로 하므로 고지 때문에 상한을 넘는 일은 없습니다. 임계는 `REPORT_PAYLOAD_NOTICE_RATIO` 로
  내보냅니다.

- aa00084: `--determinism` 비교 표시값과 모든 단언 진단에서 `sessionToken` · `X-Api-Key` · `privateKey` 같은
  합성 키가 실제로 가려집니다(#183).

  두 가지가 겹쳐 있었습니다. 결정론성 비교의 표시값은 값을 **문자열로 만든 뒤** 마스킹해서 키
  정보가 이미 사라진 상태였고, runner 의 민감 키 판정은 정규화한 키의 **정확 일치**라
  `sessiontoken` 이 목록에 없으면 통과였습니다. 같은 저장소의 `record` 는 ADR-0039·0045 로 접미
  단어열 일치를 쓰므로, 같은 응답이 카세트에서는 가려지고 실패 메시지에는 원문으로 찍혔습니다.

  ```
    get_session / 세션 조회 (session)
    → 다른 지점: raw.sessionToken
       1회차: [REDACTED]
       2회차: [REDACTED]
  ```

  runner 의 판정을 record 와 같은 규칙으로 맞췄습니다
  ([ADR-0082](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0082-runner-의-민감-키-판정을-record-와-같은-접미-단어열-규칙으로-맞춘다.md)).
  키를 단어로 쪼개 **뒤에서부터** 이어붙인 조합이 목록과 일치하면 가립니다. `accessToken` 은
  토큰의 일종이라 가리고, `tokenCount` 는 개수의 일종이라 그대로 둡니다. 복수형(`tokens`)도
  가립니다. 목록에 `privatekey` · `secretkey` · `signingkey` · `sessionkey` · `credential` 을
  더했습니다.

  결정론성 비교는 차이 지점까지의 **조상 키**도 봅니다. `token: { value }` 의 `value` 가 달라도
  가립니다.

  **가리지 못하는 자리가 남습니다.** 서버가 결과를 JSON 문자열로 만들어 text 블록 하나에 싣는
  형태에서는 비밀값이 문자열 안에 있어 키 판정이 닿지 않습니다. `sensitiveValues` 정확 일치만
  남습니다.

  공개 API 는 그대로입니다. `DEFAULT_SENSITIVE_KEYS` 항목이 늘고 `isSensitiveKey` 가 새로
  export 됩니다.

- 7bc5a71: 서버와의 연결이 끝나면 **남은 케이스를 부르지 않고 멈춥니다**([ADR-0073](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0073-연결이-끝나면-남은-케이스를-부르지-않는다.md), [#279](https://github.com/2026-Engineering-Contest/MCPeak/issues/279)).

  지금까지는 서버 프로세스가 죽어도 남은 케이스를 계속 호출했습니다. 원인은 하나인데 화면에는 실패 5건으로 부풀고, 뒤따르는 4건은 `Not connected` 복사본이었습니다. 이제 타임아웃과 같은 형태로 멈추고, 실행하지 않은 케이스는 `not run` 으로 갈립니다.

  ```
  중단: 서버 프로세스가 종료되어 실행을 멈췄습니다. (종료 코드 42)

  1 failed, 4 not run  (5 total)
  ```

  프로세스 종료(`PROCESS_EXITED`) · 전송 실패(`TRANSPORT_FAILED`) · HTTP 세션 상실(`HTTP_SESSION_LOST`) 셋 다 해당합니다. 서버가 살아서 오류를 돌려준 실패(`OPERATION_FAILED`)는 그대로 다음 케이스를 이어갑니다.

  `RunnerReport["stopReason"]` 에 `{ type: "connectionLost", caseId, cause, exitCode?, signal? }` 변종이 생겼습니다. `stopReason.type` 을 분기하는 코드는 이 사유를 함께 다뤄야 합니다.

### Patch Changes

- 690203f: 호출 실패의 `해결:` 안내가 **오류를 낸 층이 붙여 온 안내**를 씁니다([ADR-0075](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0075-실패-안내는-오류를-낸-층이-갖는다.md), [#279](https://github.com/2026-Engineering-Contest/MCPeak/issues/279)).

  지금까지는 호출이 실패하면 무엇이 원인이든 `MCP 서버 프로세스와 연결 상태를 확인하세요.` 한 문장이 붙었습니다. 서버가 죽었을 때는 화면 아래 프로세스 진단 블록이 종료 코드·stderr 를 이미 보여주므로 **이미 출력된 것을 확인하라는 순환**이었고, 서버가 살아서 낸 툴 오류에는 애초에 맞지 않는 안내였습니다.

  ```text
  ✗ add-success    add-success
      툴 'add' 호출 중 오류가 발생했습니다.
      → 원인: MCP error -32000: Connection closed
      해결: 서버 stderr에 나온 오류를 수정한 뒤 다시 실행하세요.
  ```

  오류 코드별 안내는 `@mcpeak/core` 가 이미 갖고 있습니다(stderr 가 비었으면 종료 코드를 짚는 문장까지). 러너는 그 문장을 옮기되, 다른 서버 출력과 같은 **치환·길이 상한**을 적용합니다. 안내를 안 들고 오는 client(문자열이 아니거나 비어 있는 경우 포함)에는 `core` 와 같은 기본 문장이 붙습니다.

  함께, **연결이 끊겨 실패한 케이스는 거절 근거 미확인 경고에서 빠집니다.** 그 케이스는 읽을 응답 본문이 아예 없는데 "승인 화면에서 응답을 확인하세요" 라고 안내하고 있었습니다. 서버가 살아서 낸 실패의 거절 근거는 그대로 셉니다.

- cc116fa: 결정론성 진단의 원인 추정 문장 셋이 실서버에서 모두 나옵니다(#293).

  실서버는 결과를 JSON 으로 만들어 text 블록에 문자열로 감싸 보내는 것이 기본인데, 그 형태에서
  `randomId` 와 `numericDrift` 가 **한 번도 걸리지 않았습니다.** UUID 판정에 `^…$` 앵커가 있어
  text 블록 전체가 UUID 하나일 때만 걸렸고, 숫자 판정은 `typeof === "number"` 분기에만 있어
  언제나 string 인 text content 로는 도달할 수 없었습니다. 차이 지점은 정확히 짚으면서 "무엇
  때문으로 보인다" 는 줄만 통째로 빠졌습니다.

  ```
    issue_token / issue_token가 오류 없이 응답한다 (issue-token-success)
    → 다른 지점: content[0].text
       1회차: "{\"user\":\"example\",\"token\":\"2a6c24ca-cb6f-4aca-9fb7-dededf59cd5c\"}"
       2회차: "{\"user\":\"example\",\"token\":\"ca35b2b8-11fa-410d-82cd-433cf40d78f0\"}"
    → 실행마다 새로 발급되는 식별자로 보입니다. 이 값은 단언 기준이 될 수 없습니다.
  ```

  판정을 "패턴이 있다" 에서 **"뽑은 자리 값이 실제로 달라졌다"** 로 바꿨습니다
  ([ADR-0067](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0067-결정론성-힌트는-패턴-존재가-아니라-값-변화로-판정한다.md)).
  앵커만 떼면 숫자를 품은 모든 JSON 이 "측정값 변동" 이 되기 때문입니다. 같은 변경으로 **시간은
  그대로인데 옆자리가 변한 응답에 "시간 의존으로 보입니다" 가 붙던 오귀속도 사라집니다.**

  패턴 밖 차이가 섞여 있으면 힌트를 달지 않습니다. 짚어준 값을 고쳐도 여전히 다른 경우라, 원인을
  단정하면 사용자를 엉뚱한 곳으로 보냅니다.

  공개 API 는 그대로입니다.

- 21977b4: 서버 오류 본문이 `→` 로 시작할 때 화면에 `→ →` 로 겹쳐 찍히던 것을 고칩니다([#280](https://github.com/2026-Engineering-Contest/MCPeak/issues/280)).

  리포터가 위반·`notes` 줄에 조건 없이 `→ ` 글머리를 붙여서, 서버가 이미 그 글머리를 쓴 줄은 화살표가 두 개가 됐습니다.

  ```
  전: → → 툴 'get_weather' 의 'city' 은(는) string 이어야 합니다. 받은 값: 12345 (number)
  후: → 툴 'get_weather' 의 'city' 은(는) string 이어야 합니다. 받은 값: 12345 (number)
  ```

  **목 전용 결함이 아닙니다.** `→` 글머리는 `CLAUDE.md` 「실패 메시지가 곧 제품이다」 절이 권장하는 형식이고 `examples/weather-server` 도 그렇게 쓰므로, 우리 안내를 따라 실패 메시지를 쓴 사용자 서버가 전부 이 자리에 걸렸습니다.

  고친 곳은 표시 계층뿐입니다. `notes` 원문은 그대로 나갑니다 — 거절 근거 확인(ADR-0060)이 목 응답의 `→` 글머리를 완전 일치로 요구하고, `--json` 의 `notes` 와 `mcpeak generate` 의 교정 요청 문안이 같은 값을 씁니다. 서버가 들여쓴 하위 항목의 공백과 서버가 직접 쓴 두 번째 화살표도 보존합니다.

- 2c5ca1b: `isSensitiveKey` 를 공개 API 로 내보냅니다. `generate` 가 민감 키 판정을 같은 구현으로 하기
  위해서입니다(#368, ADR-0082).
- ffdd83d: MCPeak 목이 `inputSchema` 위반을 거절한 응답을 고정 접미어로 확인해, 정상 통과 뒤에
  `거절 근거를 확인하지 못했습니다` 경고가 항상 나오던 문제를 수정합니다.
- 8579092: 명세 검증 문장이 **코드마다 달라집니다** ([ADR-0078](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0078-명세-검증-문안은-코드별-표가-갖고-호출-지점이-문맥을-얹는다.md), [#352](https://github.com/2026-Engineering-Contest/MCPeak/issues/352)).

  지금까지는 `validateSuite` 가 어떤 결함이든 같은 문장 하나를 붙였습니다. 필드가 **없는** 것과 값이 **틀린** 것과 단언이 operation 과 **안 맞는** 것이 화면에서 구분되지 않아, 코드 이름을 읽고 사용자가 스스로 해석해야 했습니다.

  ```
  - [MISSING_REQUIRED_FIELD] schemaVersion: 명세 필드 'schemaVersion'가 유효하지 않습니다.
    해결: 명세 계약에 맞게 필드와 값을 확인하세요.
  - [INCOMPATIBLE_ASSERTION] cases[0].assertions[0]: 명세 필드 'cases[0].assertions[0]'가 유효하지 않습니다.
    해결: 명세 계약에 맞게 필드와 값을 확인하세요.
  ```

  이제 13개 코드가 저마다 다른 문장을 내고, 넣어야 할 값과 대조 대상을 싣습니다.

  ```
  - [MISSING_REQUIRED_FIELD] schemaVersion: 'schemaVersion' 필드가 없습니다. 받는 값: 1.
    해결: 'schemaVersion' 필드를 명세에 추가하세요.
  - [INCOMPATIBLE_ASSERTION] cases[0].assertions[0]: 'listTools' operation 은 'isError' 단언을 받지 않습니다. 허용: toolExists
    해결: 단언 type 을 허용 목록의 것으로 바꾸거나 operation 을 확인하세요.
  ```

  모르는 필드는 그 자리가 받는 필드 목록을, 타임아웃은 받는 범위를, JSON 으로 옮길 수 없는 값은 원인(유한하지 않은 수 · 옮길 수 없는 타입 · 순환 참조)을 각각 구분해 말합니다. 긴 값과 승인 지문은 화면에 싣지 않고 형식만 말합니다.

  `SuiteValidationIssue` 의 구조와 `SuiteValidationIssueCode` 목록은 그대로입니다. `message` · `hint` 문자열의 내용만 달라지므로 CLI 렌더링은 바뀌지 않습니다.

- c84eb8b: runner: `toolExists` 실패 메시지에 서버가 실제로 선언한 툴 목록을 표시합니다. 선언된 툴이
  없으면 `(없음)`으로 명시하며, 툴 이름 뒤의 잘못된 조사를 `을(를)` 병기로 바로잡습니다 (#277).

## 0.9.0

### Minor Changes

- e99192a: Node.js 최소 지원 버전을 22.18.0으로 올리고, 배포 패키지의 `engines.node`에 같은 요구사항을 명시합니다.

### Patch Changes

- cdb8da0: 저장소 개명(OhMyMCP → MCPeak)에 맞춰 공개 식별자 두 곳을 정리한다.

  - `runner` 의 `MCP_SUITE_JSON_SCHEMA.$id` 를 소유한 주소로 옮긴다. 기존 값
    `https://ohmymcp.dev/...` 은 DNS 조차 없는 지어낸 도메인이었다 (#210).
  - `generate` 의 enum 위반 미끼값을 `__mcpeak_invalid_enum__` 으로 바꾼다.
    이 값은 생성된 suite 안에 그대로 들어가므로 기존 suite 의 승인 지문이 바뀐다 (#211).

- Updated dependencies [e99192a]
- Updated dependencies [2e62615]
- Updated dependencies [93816a8]
  - @mcpeak/core@0.4.0

## 0.8.0

### Minor Changes

- a2b37e0: 거절을 기대하는 케이스의 입력이 서버 선언을 하나도 어기지 않으면 `REJECTION_WITHOUT_VIOLATION` advisory 를 냅니다 (#94). ADR-0021 이 감수한 미탐(거절 기대 케이스에서 입력 계약 위반을 침묵)에 신호가 없어, 오타로 정상 입력이 됐거나 `expected` 를 잘못 적은 케이스가 아무것도 검증하지 않으면서 초록으로 통과했습니다. `cli test` 는 전용 머리글(`거절을 기대하지만 선언을 어기지 않습니다`)로, `generate` 승인 화면은 전용 블록(`거절 근거가 불분명한 케이스`)으로 보여주되 "위반 N건" 재확인 개수에는 넣지 않습니다. 서버가 선언 밖 제약(값의 도메인)으로 거절하는 정당한 케이스가 있으므로 차단하지 않습니다.
- 4e2c6df: `runner`: 거절을 기대한 케이스마다 **거절 근거를 확인했는지**를 판정해 결과에 싣습니다. `TestCaseResult.rejectionBasis`(`verified` · `unverified` · `notApplicable`)와 `RunnerSummary.rejectionUnverified` 두 필드가 늘었습니다. 위반 케이스의 단언은 `isError: true` 하나라 "서버가 입력을 거절한 것"과 "서버가 다른 이유로 실패한 것"이 구분되지 않았고, 관찰 80건은 응답 본문 형식으로 크래시를 지목할 수 없음을 보였습니다. 그래서 방향을 뒤집어 **SDK 검증이 낸 거절임을 양성으로 확인**합니다. 지문 셋(TS SDK 의 `MCP error -32602:`, Python 하위 SDK 의 `Input validation error:`, FastMCP 의 `<툴>Arguments` 모델)에 안 걸리면 전부 `unverified` 로 떨어지는 화이트리스트입니다.

  확인하지 못한 케이스에는 응답 본문도 함께 싣습니다(`TestCaseResult.rejectionBody`). 승인 화면이 "이 응답이 정상 거절인지 내부 오류인지"를 사람에게 보여주려면 본문이 필요한데 판정만으로는 그 자리를 채울 수 없기 때문입니다. `unverified` 이고 본문을 읽었을 때만 **키가 생기고**, 진단 값과 같은 상한(200자)에서 잘리며 같은 redaction 을 받습니다. `verified` 와 `notApplicable` 에는 키 자체가 없어서 통과한 모든 케이스의 응답이 보고서에 들어가지 않습니다.

  **판정과 종료 코드는 바뀌지 않습니다.** `unverified` 는 "거절이 아니다"가 아니라 "확인하지 못했다"는 뜻이고, 이것을 실패로 올리면 관찰한 서버 11개 중 2개가 통째로 빨개집니다(ADR-0015). `RunnerReport.schemaVersion` 은 `1` 을 유지합니다 — 늘어난 필드가 전부 추가이고 기존 필드의 의미가 바뀌지 않아, 기존 `--json` 소비자는 새 키를 무시하면 종전과 같은 결과를 읽습니다. 분류는 응답 본문 문자열만 보는 순수 함수라 같은 응답에 항상 같은 값이 나옵니다.

- 4558ef9: `runner`: `ohmymcp test` 요약 아래에 거절 근거를 확인하지 못한 케이스 수를 고지합니다. 0건이면 아무 줄도 안 나옵니다. 이 케이스들은 **통과한 케이스**이고 판정도 종료 코드도 바뀌지 않습니다 — `unverified` 는 "거절이 아니다"가 아니라 "확인하지 못했다"는 뜻이라, 문안도 실패나 결함이라고 말하지 않고 무엇을 판단하지 못했는지와 어디서 확인하는지만 적습니다. 케이스 목록에는 아무 표시도 더하지 않습니다. 통과한 케이스 옆에 기호가 붙으면 판정이 바뀐 것으로 읽히기 때문입니다.

### Patch Changes

- Updated dependencies [cd25fb4]
- Updated dependencies [bf16fb5]
  - @ohmymcp-hsu/core@0.3.0

## 0.7.0

### Minor Changes

- ec99eab: runner: 명세의 `approval` 블록이 케이스별 판정을 담을 수 있습니다. `approval.cases` 에
  `{ id, status }` 를 배열로 적고 `status` 는 `passed` 와 `serverDefect` 둘뿐입니다. 검증과
  `MCP_SUITE_JSON_SCHEMA` 가 함께 넓어지고 `CaseApprovalStatus` · `SuiteCaseApproval` 타입을
  내보냅니다. `cases` 는 선택적이라 기존 명세 파일은 그대로 유효하고, `approval` 은 지문 계산에서
  빠지므로 지문도 바뀌지 않습니다. `approval.cases[].id` 가 실재하는 케이스인지는 검증하지
  않습니다. 케이스를 지우는 정상 편집이 명세 파일을 깨진 것으로 만들지 않기 위해서입니다.
- 0f4e5fd: runner: `isError` 단언이 실패하면 서버가 돌려준 응답 본문을 진단에 함께 싣습니다. 지금까지는
  `정상 응답을 기대했지만 오류 응답을 받았습니다.` 라는 고정 문장과 두 불리언만 담겨 있어서,
  서버가 왜 거절했는지가 화면에 한 글자도 나오지 않았습니다. 이제 본문이 위반 줄과 같은 `→ `
  형식으로 붙고, 여러 줄이면 줄마다 한 항목입니다.

  `RunnerDiagnostic` 에 선택 필드 `notes?: string[]` 이 생기고 리포터가 그것을 찍습니다. 다른
  진단은 채우지 않으므로 출력이 그대로입니다. `assertIsError` 는 본문 접근자와 redaction 옵션을
  더 받습니다. 본문에는 승인 화면과 같은 redaction 이 적용되고 `MAX_VALUE_STRING_CHARS` 에서
  잘립니다. 본문 추출이 실패하면 아무것도 붙이지 않습니다.

## 0.6.1

### Patch Changes

- Updated dependencies [0d92470]
  - @ohmymcp-hsu/core@0.2.0

## 0.6.0

### Minor Changes

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

## 0.5.0

### Minor Changes

- c728f02: runner: canonical JSON 구현(`canonicalJson` · `sha256` · `deepFreeze`)을 `generate` 에서
  이관하고, 승인 지문을 계산하는 `suiteFingerprint` 를 추가합니다. 지문은 `approval` 블록을
  제외한 명세 전체의 sha256 이며, 제외 규칙은 이 함수 하나가 소유합니다. 파일에 적힌 지문이
  다음 계산의 대상에 들어가면 승인 시점의 값과 절대 같아질 수 없기 때문입니다.

  이관하면서 `canonicalJson` 과 `deepFreeze` 의 재귀 순회를 명시적 스택으로 바꿨습니다. 재귀판은
  깊이 1500 부근에서 `RangeError` 로 죽었는데 `validateMcpSuite` 는 그 깊이를 통과시켜서, 검증을
  통과한 명세가 지문 계산에서만 죽었습니다. 출력 문자열은 재귀판과 바이트 단위로 같습니다.
  sparse array 판정도 own property 기준으로 바꿨습니다. 프로토타입 체인까지 보면
  `Array.prototype` 에 인덱스가 정의됐을 때 hole 이 상속값으로 채워져 지문이 전역 상태에 따라
  달라집니다.

  generate: `canonical.ts` 가 `@ohmymcp-hsu/runner` 재수출 한 줄이 됩니다. 공개 API
  (`canonicalJson` · `sha256`)는 그대로이며 동작도 같습니다. 구현이 한 벌로 유지되어야
  저장 시점 지문과 실행 시점 지문이 갈리지 않습니다.

- 9803c19: `RunnerReport` 를 JUnit XML 로 그리는 `renderJUnit(report, options?)` 을 추가합니다. CI 가 테스트
  결과를 화면에 렌더하려면 이 포맷이 필요합니다. CONTRIBUTING §2.1 이 JUnit XML 을 `runner` 책임으로
  규정하고, CLI 보고서 렌더링 설계 §9.3 이 `junit.ts` 자리를 열어 둔 것을 채웁니다.

  `renderReport` 와 같은 순수성 경계를 지킵니다 — `process` · `Date` · 로케일 · 난수를 읽지 않으므로
  같은 보고서는 항상 같은 바이트를 냅니다.

  케이스 상태는 JUnit 관례대로 나눕니다. 단언이 틀린 경우는 `<failure>`, 작업이 실행되지 못한 경우
  (작업 실패 · 시간 초과)는 `<error>`, `cancelled` 와 `notRun` 은 `<skipped/>` 입니다. CI 화면에서
  "서버가 죽었다" 와 "응답이 다르다" 가 구별됩니다. 실패 본문에는 `diagnostics.ts` 가 만든 문장을
  그대로 싣고 `expected` · `actual` · 스키마 위반 목록 · `hint` 를 함께 담습니다.

  서버 응답 문자열이 그대로 XML 에 들어가므로 두 단계를 거칩니다. `&` `<` `>` `"` 는 이스케이프하고,
  XML 1.0 이 허용하지 않는 제어문자와 짝 없는 서로게이트는 제거합니다. 후자는 수치 참조로도 담을 수
  없어 제거가 유일한 방법이며, 빠뜨리면 서버가 뱉은 제어문자 하나로 리포트 파일 전체가 파싱 불가가
  됩니다.

  `time` 속성은 항상 `0` 입니다. `RunnerReport` 는 결정론성을 위해 시간 필드를 갖지 않으므로
  `0` 은 "0초 걸렸다" 가 아니라 "시간 정보가 없다" 의 표현입니다. 실제 경과 시간이 필요해지면
  `RunnerReport` 를 바꾸지 않고 `JUnitRenderOptions` 를 확장합니다.

- cfa921d: runner: 명세에 선택 필드 `approval: { fingerprint }` 를 추가합니다. 승인 시점의 명세 지문을
  파일에 남겨 두기 위한 자리이며, 검증은 형식(sha256 hex 64자, 소문자)만 봅니다. 값이 실제
  명세와 맞는지 대조하는 것은 실행 시점의 관심사라 여기서 하지 않습니다. `approval` 이 없는 기존
  명세는 그대로 유효합니다. 공개 JSON Schema(`MCP_SUITE_JSON_SCHEMA`)에도 같은 규칙이
  들어가 런타임 검증과 갈라지지 않습니다.

## 0.4.0

### Minor Changes

- d8227e2: 명세를 서버에 돌리기 전에 종이 위에서 검사하는 순수 함수 세 개를 추가합니다. 서버를 호출하지
  않습니다.

  `checkInputContract({ suite, tools })` 는 명세의 `callTool` 입력을 서버가 선언한
  `inputSchema` 와 대조합니다. 필수 필드 누락, 선언에 없는 필드, 타입 불일치, enum 밖 값을
  찾고, 이름이 비슷한 후보가 있으면 함께 알려줍니다. 지금까지는 오타 하나짜리 명세도 서버를
  띄워 실행한 뒤에 `isError false 를 기대했지만 true 를 받았습니다` 로만 드러나서, 서버가
  고장난 것인지 명세가 틀린 것인지 구분할 수 없었습니다.

  `checkAssertionSubstance(suite)` 는 통과가 보장된 단언을 찾습니다. `minLength: 0` 처럼 모든
  값이 통과하는 키워드가 그렇습니다. 이런 단언은 초록불을 켜지만 아무것도 검증하지 않습니다.

  `describeSpecFinding(finding)` 이 사용자에게 보여줄 문장을 만듭니다. 소비자가 문안을 각자
  짓지 않도록 한 곳에 둡니다.

  해석하지 못하는 서버 스키마는 위반으로 잡지 않고 `SCHEMA_NOT_ANALYZABLE` 로 알린 뒤 그 툴의
  입력 검사를 건너뜁니다. `ToolDef.inputSchema` 는 우리가 통제하지 않는 임의의 JSON Schema 라서,
  `anyOf` 같은 조합자를 무시하고 `properties` 만 보면 맞는 명세를 위반으로 잡게 됩니다. 검사를
  못 했다는 사실 자체를 숨기지 않으므로, finding 이 없는 것과 검사를 건너뛴 것을 구분할 수
  있습니다. 자세한 근거는 ADR-0015 에 있습니다.

  같은 이름의 툴이 두 번 선언된 경우도 해석 불가로 처리합니다. 어느 선언이 참인지 알 수 없어서
  하나를 고르면 목록 순서가 결과를 바꾸게 됩니다.

  아직 어느 명령에도 연결돼 있지 않습니다. `ohmymcp` CLI 의 동작은 이전과 같습니다.

## 0.3.1

### Patch Changes

- 4da5f7c: `createMcpTest` 와 `toContainTool` 을 `@deprecated` 로 표시합니다. 두 함수는 외부 테스트 러너
  확장을 전제한 시그니처로 남아 있었고 JSDoc 은 "runner 오너가 채운다" 라고 적고 있었지만,
  ADR-0002 가 matcher 를 독립 구현으로 유지하고 외부 러너 adapter 를 제공하지 않기로 결정하면서
  채워질 일이 없어졌습니다. 시그니처와 `not implemented` 동작은 그대로 두고 표기만 바로잡으며,
  제거는 major 릴리스와 migration 문서를 동반합니다. 새 코드는 `defineMcpSuite` 로 명세를 만들고
  `runSuite` 로 실행하세요.

## 0.3.0

### Minor Changes

- 74c96da: `ohmymcp test` 의 기본 출력을 사람이 읽는 보고서로 바꿉니다. 실패한 케이스의 진단 문장과
  해결 힌트를 터미널에 직접 표시합니다.

  **파괴적 변경**: 기존의 JSON 출력은 `--json` 플래그로 옮겼습니다. stdout을 기계로 파싱하던
  스크립트는 `ohmymcp test ... --json` 으로 바꿔야 합니다. `--json` 출력의 바이트는 이전과
  동일합니다. 종료 코드는 바뀌지 않았습니다.

## 0.2.0

### Minor Changes

- a1f9bb4: callTool 응답 본문을 JSON Schema 부분집합으로 검사하는 `bodyMatchesSchema` 단언을 추가합니다.
  필드 누락, 타입 변경, 값 불일치, 오류 메시지 내용을 위반 목록과 한국어 진단 문장으로 보고합니다.

## 0.1.1

### Patch Changes

- Updated dependencies [606600f]
  - @ohmymcp-hsu/core@0.1.0

## 0.1.0

### Minor Changes

- 216184a: 선언형 MCP 테스트 명세, 순차 실행, 구조화된 진단·이벤트·보고서와 timeout·중단 처리를 추가합니다.
