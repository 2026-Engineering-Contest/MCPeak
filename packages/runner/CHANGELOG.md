# @ohmymcp/runner

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
