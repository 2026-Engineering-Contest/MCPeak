# @ohmymcp-hsu/runner

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
