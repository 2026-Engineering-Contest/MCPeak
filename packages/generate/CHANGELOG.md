# @ohmymcp/generate

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
