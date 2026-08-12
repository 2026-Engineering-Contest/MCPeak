# AI provider 구조화 출력 호환성 결함

## 문제

`ohmymcp generate`의 AI 검토는 Codex와 Claude 모두 현재 실패한다. 인증이나 모델 문제가 아니라
`packages/generate/src/authoring-schema.ts`의 `AUTHORING_OUTPUT_SCHEMA`가 두 CLI에서 지원하는
JSON Schema 범위를 벗어나기 때문이다.

- Codex는 최상위 `oneOf`을 `invalid_json_schema`로 거절한다.
- Claude는 `$schema: "https://json-schema.org/draft/2020-12/schema"`를 해석하지 못한다.
- Claude에서 `$schema`를 제거해도 최상위 `oneOf`, `allOf`, `anyOf`을 거절한다.
- Runner suite schema 안에도 `oneOf`이 있으므로 최상위 `oneOf`만 제거해서는 해결되지 않는다.
- CLI는 상세 원인을 모두 `GENERATE_PROVIDER_FAILED`로 표시해 사용자가 인증, 모델, 스키마 문제를
  구분할 수 없다.

## 변경할 사항

1. `packages/generate/src/authoring-schema.ts`
   - Runner의 전체 JSON Schema를 provider 출력 schema로 직접 넣지 않는다.
   - Codex와 Claude가 공통으로 지원하는 단순한 provider 전송 schema를 별도로 만든다.
   - `$schema`와 `oneOf`, `allOf`, `anyOf` 같은 지원되지 않는 항목을 사용하지 않는다.

2. `packages/generate/src/authoring-request.ts`
   - provider가 반환한 결과를 지금처럼 `validateMcpSuite`로 다시 엄격하게 검증한다.
   - provider용 schema를 단순화하더라도 suite ID, schema version, 툴 이름, assertion과 비밀값 검증을
     완화하지 않는다.

3. `packages/generate/src/providers.ts`
   - Claude의 JSON envelope에서 `is_error: true` 또는 `api_error_status`가 있는 결과를 성공으로
     취급하지 않는다.
   - raw stderr와 인증정보는 노출하지 않고 안전한 failure code만 반환한다.

4. `packages/cli/src/generate-command.ts`
   - `providerUnavailable`, `nonZeroExit`, `timedOut`, `schemaMismatch`처럼 이미 정제된 failure code에
     따라 사용자가 취할 조치를 구분해 안내한다.

## 필요한 테스트

- Codex와 Claude에 전달하는 schema에 지원되지 않는 키워드가 없는지 검사한다.
- 두 provider의 `questions`와 `candidate` 결과가 정상 처리되는지 검사한다.
- 단순화된 provider schema를 통과했더라도 잘못된 suite는 로컬 validator가 거절하는지 검사한다.
- Claude의 `is_error: true` 결과가 candidate로 적용되지 않는지 검사한다.
- CLI 실패 메시지에 prompt, stdout, stderr, native stack과 인증정보가 노출되지 않는지 검사한다.
- 마지막에 실제 Codex와 Claude를 각각 직렬로 호출해 weather-server 승인본이 `2 passed, 0 failed`인지
  확인한다. 실제 호출은 사용자 승인 뒤에만 실행한다.

