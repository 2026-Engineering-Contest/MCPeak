---
"@ohmymcp-hsu/record": patch
---

민감 키 목록에 `key` 합성어와 `passwd` · `credential` 이 추가되고, **복수형이 조회에서
흡수됩니다.**

ADR-0039 가 매칭을 접미 단어열 **정확 일치**로 좁힌 뒤, 목록이 그 규칙을 따라가지 못한
구멍이 남아 있었습니다. 접미 조합이 목록에 없으면 전부 통과하므로 `secretKey` 는 `secret`
이 목록에 있어도 접미 조합이 `key` · `secretkey` 뿐이라 어디에도 걸리지 않았습니다.
`apiKey` 를 목록에 따로 넣어야 했던 것과 같은 구멍입니다. 복수형도 같습니다 — `token` 은
걸리지만 `tokens` 는 통과했고, 토큰이나 비밀값이 배열로 오는 응답은 흔합니다.

**새로 마스킹되는 것**

| 종류 | 예 |
|---|---|
| `key` 합성어 | `privateKey` · `secretKey` · `signingKey` · `sessionKey` |
| 그 외 추가 | `credential` · `passwd` |
| 복수형 | `tokens` · `secrets` · `passwords` · `cookies` · `apiKeys` · `refreshTokens` |

**여전히 마스킹되지 않는 것** — `tokenCount` · `secretariat` 은 그대로고, 복수형 완화가
`tokenCounts` · `secretariats` · `cookieCounts` 를 새로 잡지도 않습니다. 꼬리 `s` 를 떼도
머리 명사는 바뀌지 않기 때문입니다. `key` 단독은 ADR-0039 의 판단대로 계속 넣지 않습니다.

**일부러 뺀 것** — `auth` 는 `auth: { token, type }` 의 하위 트리를 통째로 가려 구조를 영영
못 보게 만들고(`auth.token` 은 이미 `token` 으로 걸립니다), `pwd` 는 파일시스템 MCP 서버가
작업 디렉터리 이름으로 쓰며, `bearer` 는 `bearerToken` 이 이미 `token` 으로 걸립니다.

**카세트 파일의 내용이 바뀝니다.** 포맷과 `CASSETTE_VERSION` 은 그대로라 기존 카세트도 계속
읽히지만, 다시 녹화하기 전까지는 예전 마스킹 결과를 그대로 갖고 있습니다. 위 필드를 단언하던
테스트는 이제 `"[redacted]"` 를 보게 됩니다. 근거는 ADR-0045 에 있습니다.
