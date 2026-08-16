---
"@ohmymcp/generate": minor
---

authoring 통로와 분리된 **서버 진단 전용 통로**를 내보냅니다. 실패한 `test` 실행의 근거를 AI provider 에게 물어 서버 코드의 원인 후보를 받아 오는 경로이고, 기존 authoring API 는 바뀌지 않습니다.

새 함수는 `prepareDiagnosisRequest` · `dispatchDiagnosisRequest` · `validateDiagnosisResult` · `diagnosisPrompt` 입니다. 새 상수는 `DIAGNOSIS_PROVIDER_SCHEMA` · `DEFAULT_MAX_REPAIR_CASES` · `MAX_REPAIR_STDERR_BYTES` · `MAX_CAUSE_CHARS` 이고, 타입은 `DiagnosisRequest` · `DiagnosisFailure` · `DiagnosisDiagnostic` · `DiagnosisProcessDiagnostics` · `DiagnosisCause` · `DiagnosisResult` · `ServerDiagnosisProvider` · `DiagnosisRequestPreview` · `DiagnosisRequestBinding` · `DiagnosisDispatchResult` · `DiagnosisValidation` 을 함께 내보냅니다.

`createCodexProvider` · `createClaudeProvider` 가 돌려주는 객체에 `diagnose` 가 추가되어, 한 객체가 `TestAuthoringProvider` 와 `ServerDiagnosisProvider` 를 함께 만족합니다. 모델과 환경변수 allowlist, 샌드박스 설정은 두 경로가 공유합니다.
