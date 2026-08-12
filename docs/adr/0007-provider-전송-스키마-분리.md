# ADR-0007: provider 전송 스키마를 로컬 검증 스키마와 분리한다

- 상태: 승인
- 날짜: 2026-08-12
- 담당: generate
- 참조: [AI provider 스키마 호환성 조사](../ai-provider-schema-compatibility.md)

## 배경

`ohmymcp generate`의 AI 검토가 Codex와 Claude 양쪽에서 실패했다. provider에 보내던
`AUTHORING_OUTPUT_SCHEMA`는 `$schema`, 최상위 `oneOf`, `$ref`/`$defs`를 쓴다. 이 스키마가 참조하는
Runner suite 스키마(`packages/runner/src/spec/json-schema.ts`)에도 `oneOf`와 `$ref`가 12군데 있고,
`$defs/jsonValue`는 재귀 참조다.

두 CLI의 structured output은 이 범위를 받지 않는다. 실제로 통과하는 스키마의 성질은 `$schema` 없음,
`$ref`/`$defs` 없음, 최상위 조합자 없음, 재귀 없음이다. 게다가 `operation.input`은 임의 JSON 객체라
strict structured output이 요구하는 "모든 객체에 `additionalProperties: false`, 전 property `required`"를
만족시킬 수 없다.

## 선택지

- A안: Runner 스키마를 인라인 전개해 `$ref`를 없앤다.
- B안: suite는 객체로 두고 조합자만 제거한다.
- C안: provider 전송 스키마는 envelope만 규정하고, suite는 JSON 문자열 필드로 받는다.
- D안: Runner 스키마 자체를 CLI 호환 범위로 고친다.

## 결정

C안을 채택한다.

provider 전송 전용으로 `PROVIDER_OUTPUT_SCHEMA`를 새로 만든다. envelope는 스칼라와 문자열 배열만
가지며, suite는 `suiteJson` 문자열 필드로 받는다. suite 형식은 스키마 대신 프롬프트 본문으로 알린다
(`MCP_SUITE_JSON_SCHEMA`를 직렬화해 고정 지침 뒤에 붙인다). 기존 `AUTHORING_OUTPUT_SCHEMA`는 로컬
문서화용으로 그대로 둔다.

`providers.ts`는 `suiteJson`을 파싱해 객체로 되돌린 뒤 `validateAuthoringProviderResult`에 넘긴다.

## 이유

A안은 불가능하다. `jsonValue`가 재귀라서 유한한 인라인 전개가 없다. B안도 불가능하다. 조합자를
없애도 `operation.input`의 임의 객체가 strict mode의 `additionalProperties` 요구와 충돌한다. D안은
Runner가 다른 오너의 패키지이고, 로컬 검증 강도를 CLI 사정에 맞춰 낮추는 셈이라 방향이 거꾸로다.

C안은 검증 강도를 낮추지 않는다. 파싱 뒤 경로(`validateMcpSuite`, suite identity 대조, 툴 이름
allowlist, 비밀값 redaction)가 전부 그대로 돈다. provider가 무엇을 돌려주든 로컬 validator를 통과해야
사용자에게 보인다. 프롬프트에 붙는 suite 스키마는 우리가 만든 데이터이므로 untrusted 취급 대상이
아니다.

`JSON.parse` 실패는 `invalidJson`이 아니라 `schemaMismatch`로 매핑한다. `invalidJson`은 "CLI stdout
자체가 JSON이 아니다"라는 다른 층의 실패이고, 사용자 조치가 갈리기 때문이다.

## 결과

- provider 전송 스키마와 로컬 검증 스키마가 분리된다. 두 스키마가 어긋나지 않는지는 프롬프트 본문과
  `unwrap`의 파싱 단계가 책임진다.
- 프롬프트가 커진다. suite 스키마 직렬화 분량이 매 요청에 붙는다. `MAX_REQUEST_BYTES` 검사 대상은
  request 본문이라 이 증가로 한도에 걸리지는 않는다.
- Claude의 오류 envelope를 성공으로 취급하지 않는다. `type`, `subtype`, `is_error`,
  `api_error_status`, `structured_output` 존재를 전부 확인한 뒤에만 결과를 취한다.
- `api_error_status`는 키 존재가 아니라 값으로 판정한다. Claude 2.1.228의 성공 응답은 이 키를
  `null`로 항상 담기 때문에, 키 존재로 거절하면 모든 성공이 `schemaMismatch`가 된다. 실제 CLI
  호출로 확인한 사실이다.
- `hasRequiredCapabilities` help 검사를 제거했다. `codex exec --help`에 없는 config key를 요구해
  codex가 한 번도 실행되지 않았고, spawn 실패는 `provider-process.ts`가 이미
  `providerUnavailable`로 매핑한다.
