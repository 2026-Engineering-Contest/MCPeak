---
"@mcpeak/runner": minor
---

`--determinism` 비교 표시값과 모든 단언 진단에서 `sessionToken` · `X-Api-Key` · `privateKey` 같은
합성 키가 실제로 가려집니다(#183).

두 가지가 겹쳐 있었습니다. 결정론성 비교의 표시값은 값을 **문자열로 만든 뒤** 마스킹해서 키
정보가 이미 사라진 상태였고, runner 의 민감 키 판정은 정규화한 키의 **정확 일치**라
`sessiontoken` 이 목록에 없으면 통과였습니다. 같은 저장소의 `record` 는 ADR-0039·0045 로 접미
단어열 일치를 쓰므로, 같은 응답이 카세트에서는 가려지고 실패 메시지에는 원문으로 찍혔습니다.

```
  get_session / 세션 조회 (session)
  → 다른 지점: raw.sessionToken
     1회차: [REDACTED]
     2회차: [REDACTED]
```

runner 의 판정을 record 와 같은 규칙으로 맞췄습니다
([ADR-0082](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0082-runner-의-민감-키-판정을-record-와-같은-접미-단어열-규칙으로-맞춘다.md)).
키를 단어로 쪼개 **뒤에서부터** 이어붙인 조합이 목록과 일치하면 가립니다. `accessToken` 은
토큰의 일종이라 가리고, `tokenCount` 는 개수의 일종이라 그대로 둡니다. 복수형(`tokens`)도
가립니다. 목록에 `privatekey` · `secretkey` · `signingkey` · `sessionkey` · `credential` 을
더했습니다.

결정론성 비교는 차이 지점까지의 **조상 키**도 봅니다. `token: { value }` 의 `value` 가 달라도
가립니다.

**가리지 못하는 자리가 남습니다.** 서버가 결과를 JSON 문자열로 만들어 text 블록 하나에 싣는
형태에서는 비밀값이 문자열 안에 있어 키 판정이 닿지 않습니다. `sensitiveValues` 정확 일치만
남습니다.

공개 API 는 그대로입니다. `DEFAULT_SENSITIVE_KEYS` 항목이 늘고 `isSensitiveKey` 가 새로
export 됩니다.
