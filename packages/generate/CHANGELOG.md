# @ohmymcp-hsu/generate

## 0.6.0

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
- Updated dependencies [cdb8da0]
- Updated dependencies [93816a8]
  - @mcpeak/core@0.4.0
  - @mcpeak/runner@0.9.0

## 0.5.1

### Patch Changes

- be534d6: generate: 거절 진단 요청의 `responseBody` 에서 값 치환을 걷어냅니다. 계약 주석은 "redaction 이
  적용된 값" 이라고 적고 있었지만, 이 필드는 서버가 자유롭게 쓴 루트 문자열이라 키 기반 치환에는
  아예 안 걸리고 값 기반 치환은 완전 일치일 때만 걸립니다. CLI 경로에서는 `sensitiveValues` 를
  채우는 통로가 없어 실제로는 늘 무동작이었습니다. 가리지 못하면서 가린다고 적어 두는 쪽이 원래
  위험보다 나쁘므로, 적용하지 않는다는 사실을 계약에 적고 상한·확인·기본 거부로 다룹니다.
  구조화된 `input` 의 치환은 종전 그대로입니다. 근거는 ADR-0049 이고, ADR-0033 이 stderr 에 내린
  판단을 자유 텍스트 전반으로 넓힌 것입니다.

## 0.5.0

### Minor Changes

- 49b2431: `generate` 승인 화면에서 거절 근거를 확인하지 못한 케이스를 **AI 에게 물어볼 수 있습니다.** 미확인 목록 아래에 요청 여부를 묻고, 사용자가 승낙했을 때만 provider 를 부릅니다. 자동으로 부르지 않습니다 — 케이스가 많으면 비용이 곱해지고 provider 가 없는 사용자가 대다수입니다. `--provider` 가 없거나 미확인이 0건이면 아무것도 묻지 않습니다.

  **이 진단은 참고입니다. 케이스 판정도 저장 여부도 바꾸지 않습니다.** 결과는 화면에만 나가고 `--json` 이나 `RunnerReport` 에는 들어가지 않으며, 화면 마지막 줄이 그 사실을 항상 함께 적습니다. provider 가 실패하거나 형식을 어긴 답을 보내도 안내만 찍고 승인 화면이 그대로 이어집니다.

  응답 본문이 없는 케이스는 진단에서 **제외합니다.** 호출이 오류로 끝나 서버 응답이 아예 없는 경우가 있는데, 빈 값을 채워 물으면 AI 에게 판단 재료가 없어 지어낸 답만 돌아옵니다. 몇 건을 왜 뺐는지는 화면에 남깁니다.

  `@ohmymcp-hsu/generate` 의 provider 객체에 `diagnoseRejection` 메서드가 추가됐습니다. `RejectionDiagnosisProvider` 의 메서드 이름이 `diagnose` 에서 `diagnoseRejection` 으로 바뀌었습니다 — 한 provider 객체가 기존 `diagnose(request: DiagnosisRequest, …)` 와 시그니처가 충돌하지 않게 하기 위함입니다.

- 7600b09: 도그푸딩(공개 MCP 서버 8개)에서 잡힌 결함 셋을 고칩니다.

  - `generate` 가 지원하지 않는 JSON Schema 키워드를 만나면 서버 전체를 거절하던 것을, 해당 툴만 건너뛰고 나머지를 생성하도록 바꿉니다(ADR-0036). 건너뛴 툴은 `skippedTools` 로 결과에 실리고 화면에 `건너뜀 N tools` 블록으로 고지되며, 커버리지 분모에서 빠집니다. 실측에서 공개 서버 8개 중 5개가 툴 하나 때문에 전체 거절됐습니다. 전 툴 지원 서버의 출력과 지문은 바뀌지 않습니다.
  - `test` 가 `--arg` 값의 하이픈 접두를 거절해 `--arg -y` 를 못 받던 것을 고칩니다. `generate` 는 이미 받고 있었고, npx·uvx 로 띄우는 서버는 전부 여기 걸립니다.
  - `generate` 의 연결 단계 실패(서버가 spawn 직후 종료 등)가 원인 없는 `GENERATE_FAILED` 로 뭉개지던 것을, core 오류의 code·message·hint 를 그대로 보여주는 `GENERATE_CONNECT_FAILED/<code>` 로 바꿉니다.

- 6ada2e6: `generate`: 거절 근거를 확인하지 못한 위반 케이스에 대해 AI 에게 참고 의견을 묻는 통로를 추가했습니다(`prepareRejectionDiagnosisRequests` · `rejectionDiagnosisPrompt` · `dispatchRejectionDiagnosis`). 위반 케이스의 단언은 `isError: true` 하나라 "서버가 입력을 거절한 것"과 "서버가 다른 이유로 죽은 것"이 구분되지 않고, 관찰 80건은 응답 본문 형식으로 그 둘을 가를 수 없음을 보였습니다. 그래서 이 통로는 **판정을 바꾸지 않습니다.** 케이스 결과·종료 코드·`--json`·`RunnerReport` 어디에도 들어가지 않고 승인 화면에만 참고로 나갑니다. 대상은 `unverified` 케이스뿐이고, 전송 payload 에는 기존 redaction 계약(ADR-0033)이 그대로 적용됩니다. provider 응답은 `verdict` 가 `rejected`·`crashed`·`unsure` 셋 중 하나인지, `reason` 이 비지 않았는지, 요청한 케이스에 빠짐없이 한 번씩 답했는지를 전부 검사하고 하나라도 어긋나면 거부합니다.
- 247e414: 진단 결과의 `discarded`를 단일 개수에서 사유별 개수로 확장합니다. 요청에 없는 케이스, 승인된 명세 수정 제안, `unsure` 응답에 함께 온 원인 후보를 각각 구분합니다.

  `repair` 화면은 실제로 발생한 제외 사유와 개수를 보여주고, 명세 재승인이나 재시도 중 관련 있는 다음 행동만 안내합니다.

- db571dd: authoring 통로와 분리된 **서버 진단 전용 통로**를 내보냅니다. 실패한 `test` 실행의 근거를 AI provider 에게 물어 서버 코드의 원인 후보를 받아 오는 경로이고, 기존 authoring API 는 바뀌지 않습니다.

  새 함수는 `prepareDiagnosisRequest` · `dispatchDiagnosisRequest` · `validateDiagnosisResult` · `diagnosisPrompt` 입니다. 새 상수는 `DIAGNOSIS_PROVIDER_SCHEMA` · `DEFAULT_MAX_REPAIR_CASES` · `MAX_REPAIR_STDERR_BYTES` · `MAX_CAUSE_CHARS` 이고, 타입은 `DiagnosisRequest` · `DiagnosisFailure` · `DiagnosisDiagnostic` · `DiagnosisProcessDiagnostics` · `DiagnosisCause` · `DiagnosisResult` · `ServerDiagnosisProvider` · `DiagnosisRequestPreview` · `DiagnosisRequestBinding` · `DiagnosisDispatchResult` · `DiagnosisValidation` 을 함께 내보냅니다.

  `createCodexProvider` · `createClaudeProvider` 가 돌려주는 객체에 `diagnose` 가 추가되어, 한 객체가 `TestAuthoringProvider` 와 `ServerDiagnosisProvider` 를 함께 만족합니다. 모델과 환경변수 allowlist, 샌드박스 설정은 두 경로가 공유합니다.

### Patch Changes

- 5dd34d3: `generate`: `$schema` 키워드를 지원 목록에 추가해 draft 선언이 붙은 서버의 툴이 거절되지 않게 했습니다. 공식 TypeScript SDK가 zod에서 스키마를 뽑을 때 이 키를 기본으로 붙이므로, 그동안 `server-everything` 13개 툴과 `server-memory` 9개 툴이 전부 첫 키에서 막혔습니다. `$schema`는 방언 선언용 annotation이라 합성될 입력값을 바꾸지 않으며, 문자열이 아니면 종전대로 거절합니다. 실제 제약인 `minimum`·`maximum`·`format`의 거절은 그대로 유지됩니다.
- a2b37e0: 거절을 기대하는 케이스의 입력이 서버 선언을 하나도 어기지 않으면 `REJECTION_WITHOUT_VIOLATION` advisory 를 냅니다 (#94). ADR-0021 이 감수한 미탐(거절 기대 케이스에서 입력 계약 위반을 침묵)에 신호가 없어, 오타로 정상 입력이 됐거나 `expected` 를 잘못 적은 케이스가 아무것도 검증하지 않으면서 초록으로 통과했습니다. `cli test` 는 전용 머리글(`거절을 기대하지만 선언을 어기지 않습니다`)로, `generate` 승인 화면은 전용 블록(`거절 근거가 불분명한 케이스`)으로 보여주되 "위반 N건" 재확인 개수에는 넣지 않습니다. 서버가 선언 밖 제약(값의 도메인)으로 거절하는 정당한 케이스가 있으므로 차단하지 않습니다.
- 8e28914: 진단 요청의 `caseId` 허용 값을 요청마다 스키마 `enum` 으로 못 박습니다. provider 가 여러 케이스를 한 항목에 이어 붙여 답하면 검증이 그 항목을 버려, 근거가 충분한 답이 통째로 `unsure` 로 접히던 문제를 크게 줄입니다. provider 가 그래도 enum 을 어기면 검증은 여전히 그 항목을 버립니다. 프롬프트도 허용 목록과 "여러 케이스가 같은 원인이면 항목을 나눠 각각 낸다" 는 규칙을 함께 싣습니다.
- Updated dependencies [cd25fb4]
- Updated dependencies [bf16fb5]
- Updated dependencies [a2b37e0]
- Updated dependencies [4e2c6df]
- Updated dependencies [4558ef9]
  - @ohmymcp-hsu/core@0.3.0
  - @ohmymcp-hsu/runner@0.8.0

## 0.4.2

### Patch Changes

- Updated dependencies [ec99eab]
- Updated dependencies [0f4e5fd]
  - @ohmymcp-hsu/runner@0.7.0

## 0.4.1

### Patch Changes

- Updated dependencies [0d92470]
  - @ohmymcp-hsu/core@0.2.0
  - @ohmymcp-hsu/runner@0.6.1

## 0.4.0

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

### Patch Changes

- Updated dependencies [d31c26e]
  - @ohmymcp-hsu/runner@0.6.0

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

  generate: `canonical.ts` 가 `@ohmymcp-hsu/runner` 재수출 한 줄이 됩니다. 공개 API
  (`canonicalJson` · `sha256`)는 그대로이며 동작도 같습니다. 구현이 한 벌로 유지되어야
  저장 시점 지문과 실행 시점 지문이 갈리지 않습니다.

- Updated dependencies [c728f02]
- Updated dependencies [9803c19]
- Updated dependencies [cfa921d]
  - @ohmymcp-hsu/runner@0.5.0

## 0.3.4

### Patch Changes

- Updated dependencies [d8227e2]
  - @ohmymcp-hsu/runner@0.4.0

## 0.3.3

### Patch Changes

- Updated dependencies [4da5f7c]
  - @ohmymcp-hsu/runner@0.3.1

## 0.3.2

### Patch Changes

- Updated dependencies [74c96da]
  - @ohmymcp-hsu/runner@0.3.0

## 0.3.1

### Patch Changes

- Updated dependencies [a1f9bb4]
  - @ohmymcp-hsu/runner@0.2.0

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
  - @ohmymcp-hsu/core@0.1.0
