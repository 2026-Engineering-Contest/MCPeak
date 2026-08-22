---
"@mcpeak/record": patch
---

External 세션의 `link`(RFC 8288)·`refresh` 응답 헤더에도 URL 경로 제거를 적용합니다
(ADR-0053 개정, #301). `location`·`content-location` 을 막은 뒤 남아 있던 잔여 유출 경로입니다.

값 전체가 아니라 **URL 부분만** 지웁니다. `link` 는 각 `<URI>` 를 응답 URL 기준으로 해석한 뒤
`https://host/<redacted>?…` 로 바꿉니다. 파라미터는 `rel` 이 등록 값(`next`·`prev`·`first`·`last`·
`self` 등)일 때만 원문으로 남깁니다 — pagination 진단(`rel="next"`)은 그대로 보입니다. 그 밖의
`rel` 값과 다른 파라미터(`title`·`type`·`anchor` 등)는 문법상 임의 문자열이라 토큰을 가려낼 수
없으므로 값을 `[redacted]` 로 씁니다. `refresh` 는 지연 초를 남기고 `url=` 의 URL 만 지웁니다.
문법대로 해석되지 않는 값은 통째로 `[redacted]` 입니다.

```
Link: </services/T00/B00/XXXXSECRET?cursor=2>; rel="next"
  → <https://hooks.example.com/<redacted>?cursor=2>; rel="next"
Refresh: 0; url=/hooks/REFRESHSECRET
  → 0; url=https://hooks.example.com/<redacted>
```

matchKey 와 Replay 매칭에는 영향이 없습니다. 이 변경 전에 녹화한 세션 파일에는 두 헤더의
경로가 원문으로 남아 있으므로 README 의 정리 절차를 따르세요.
