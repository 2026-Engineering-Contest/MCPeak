---
"@mcpeak/record": minor
---

**Breaking**: External 세션이 URL 경로를 더 이상 저장하지 않습니다(ADR-0053). 저장하는 표준
URL 필드 넷(요청 `display.url`, 저장 outcome의 `url`, `location`·`content-location` 헤더)에서
pathname 을 `<redacted>` 로 지웁니다. `location`·`content-location` 이 상대 참조(RFC 9110)여도
거부하지 않고 응답 URL 기준으로 절대 URL 로 해석한 뒤 같은 규칙을 적용합니다.

matchKey 계산에는 영향이 없습니다 — 정확한 pathname(매칭 재료)은 여전히 매칭에 쓰이고, 다만
자식 프로세스 밖으로 나가지 않습니다. `/hooks/AAA` 와 `/hooks/BBB` 는 여전히 다른 matchKey 를
냅니다. 그래서 이 개정 **이전에 만든 세션 파일도 Replay 는 계속 됩니다** — 다만 경로가 원문으로
남아 있으므로, README의 정리 절차(삭제 → 자격증명 재발급 → 재녹화)를 따르세요.

응답의 `redirect: "manual"` 로 받은 301·302·303·307·308 도 `Response.redirected` 값과 무관하게
거부합니다 — 그 응답의 `Location` 이 경로가 든 절대 URL 이라, 지우려던 경로가 응답 쪽으로
되돌아오는 구멍이었습니다.

`NormalizedExternalRequest` 의 `match` 필드가 없어지고 `schemaVersion` 은
`interactionSchemaVersion` 으로 개명됩니다. 둘 다 `@mcpeak/record/external` 의 공개 표면에는
없는 내부 타입이라 소비자(`cli`)에는 영향이 없습니다.
