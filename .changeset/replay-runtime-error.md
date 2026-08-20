---
"ohmymcp": patch
---

cli: `replay` 가 런타임 모듈 로드 실패를 내부 오류로 보고하지 않습니다.

`@ohmymcp-hsu/runner` 나 `@ohmymcp-hsu/record` 를 못 불러 fallback 의존성이 쓰이면, 가장 먼저
걸리는 `validateSuite` 가 평범한 `Error` 를 던져 `CLI_INTERNAL_ERROR` 로 잡혔습니다. 화면에는
"예상하지 못한 CLI 내부 오류가 발생했습니다 / 다시 실행한 뒤 재현 정보와 함께 이슈를
보고하세요" 가 나갔고, 사용자는 자기 설치 문제로 버그 리포트를 쓰게 됐습니다.

전용 `ReplayRuntimeUnavailableError` 와 `REPLAY_RUNTIME_UNAVAILABLE` 코드로 가릅니다.
`repair` 가 `REPAIR_RUNTIME_UNAVAILABLE` 로 이미 하던 것과 같은 처리입니다. 명세나 카세트가
실제로 잘못된 경우는 종전대로 `CLI_INTERNAL_ERROR` · `CASSETTE_READ_FAILED` 입니다.
