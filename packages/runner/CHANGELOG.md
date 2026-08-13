# @ohmymcp/runner

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
