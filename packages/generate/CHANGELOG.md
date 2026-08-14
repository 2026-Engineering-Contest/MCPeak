# @ohmymcp/generate

## 0.3.5

### Patch Changes

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

- Updated dependencies [c728f02]
- Updated dependencies [9803c19]
- Updated dependencies [cfa921d]
  - @ohmymcp/runner@0.5.0

## 0.3.4

### Patch Changes

- Updated dependencies [d8227e2]
  - @ohmymcp/runner@0.4.0

## 0.3.3

### Patch Changes

- Updated dependencies [4da5f7c]
  - @ohmymcp/runner@0.3.1

## 0.3.2

### Patch Changes

- Updated dependencies [74c96da]
  - @ohmymcp/runner@0.3.0

## 0.3.1

### Patch Changes

- Updated dependencies [a1f9bb4]
  - @ohmymcp/runner@0.2.0

## 0.3.0

### Minor Changes

- ed2a3b8: 기존 생성 파일을 기본적으로 보존하고, 명시적인 `overwrite: true` 옵션을 지정한 경우에만 교체할 수 있도록 재생성 정책을 추가합니다.

## 0.2.0

### Minor Changes

- 0694441: 결정론적 baseline, 반복 AI 검토·승인 상태와 격리된 Codex·Claude provider adapter를 추가합니다.
- ba4bc97: provider 비정상 종료의 원인을 닫힌 enum(`AuthoringProviderFailureReason`)으로 분류해 `PublicProviderFailure.reason`으로 올립니다. 미인증, 없는 모델, 쿼터 초과, 잘못된 요청, 서버 오류가 `nonZeroExit` 하나에 뭉쳐 있던 문제를 풉니다. 분류에는 CLI가 돌려준 숫자 상태 코드만 쓰며, stdout·stderr 원문은 어떤 결과에도 담기지 않습니다.
- 53d0440: Codex와 Claude가 실제로 실행되도록 provider 호출을 복구합니다. 잘못된 help 기반 capability 검사를 제거하고, 두 CLI 공통 지원 범위만 쓰는 provider 전송 스키마를 도입해 suite를 JSON 문자열로 주고받습니다. Claude의 오류 envelope를 candidate로 적용하지 않습니다.
- 7c1cf62: 계약 식별자(suite id, case id·name, operation type·tool, 도구 이름)를 값 기반 redaction 대상에서 제외해, 사용자가 그 문자열을 비밀값으로 선언해도 suite identity 대조와 도구 allowlist가 깨지지 않게 합니다. provider가 보고한 `summary`와 `warnings`를 공개 candidate 결과 타입에 노출하고, suite fingerprint 계산을 한 곳에 두도록 `sha256`과 `canonicalJson`을 export합니다. stdin 쓰기 오류 뒤 비정상 종료를 성공으로 넘기지 않고 `internal`로 보고합니다.

### Patch Changes

- 77d7623: Claude 성공 응답을 오류로 오판하던 문제를 고칩니다. Claude CLI는 성공 응답에도 `api_error_status`를 `null`로 항상 담기 때문에, 키 존재가 아니라 값으로 판정합니다.
- 3760bac: stdin 쓰기 오류를 예외 없이 실패로 판정합니다. 이전에는 종료 코드가 0이고 stdout이 유효한 JSON이면 무시했지만, 쓰기 오류가 났다는 것은 프롬프트 일부가 전달되지 않았다는 뜻이고 그 응답은 잘린 입력에 대한 응답입니다. 오류가 나면 자식 프로세스를 정리하고 `internal`로 보고합니다.

## 0.1.0

### Minor Changes

- b80e0e5: Generate deterministic Runner `TestSuiteSpec` source files from supported MCP tool input schemas.

### Patch Changes

- Updated dependencies [606600f]
  - @ohmymcp/core@0.1.0
