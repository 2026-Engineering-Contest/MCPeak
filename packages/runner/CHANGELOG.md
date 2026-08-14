# @ohmymcp/runner

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

  - `@ohmymcp/runner` 의 `SpecFindingCode` 에서 `UNCONSTRAINED_SCHEMA` 가 사라진다. 소비자 경로에서
    `validateMcpSuite` 가 먼저 거부해 도달할 수 없는 코드였다.
  - `@ohmymcp/generate` 의 `SanitizedAuthoringCandidate` 에 `specFindings` 필드가 생긴다. 승인
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

  generate: `canonical.ts` 가 `@ohmymcp/runner` 재수출 한 줄이 됩니다. 공개 API
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
  - @ohmymcp/core@0.1.0

## 0.1.0

### Minor Changes

- 216184a: 선언형 MCP 테스트 명세, 순차 실행, 구조화된 진단·이벤트·보고서와 timeout·중단 처리를 추가합니다.
