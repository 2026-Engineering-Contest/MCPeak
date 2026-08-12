---
"ohmymcp": patch
---

generate의 AI provider 실패를 원인별로 분기해 안내한다. `providerUnavailable`, `nonZeroExit`,
`timedOut`, `schemaMismatch`, `cancelled`는 각각 다른 오류 코드와 조치 문장을 출력하고, 나머지
코드는 기존 `GENERATE_PROVIDER_FAILED` 문구를 유지한다.
