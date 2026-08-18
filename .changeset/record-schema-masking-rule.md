---
"@ohmymcp-hsu/record": patch
---

카세트에 저장되는 `tools.inputSchema` 가 **더 이상 파괴되지 않습니다.**

지금까지는 응답 데이터와 같은 규칙으로 스키마를 마스킹해서, `properties.apiKey` 처럼
민감한 이름의 프로퍼티는 **정의 객체 전체가 `"[redacted]"` 문자열로 치환**됐습니다.

```
{ properties: { apiKey: { type: "string", default: "sk-..." } } }
          ↓ (이전)
{ properties: { apiKey: "[redacted]" } }
          ↓ (이후)
{ properties: { apiKey: { type: "string", default: "[redacted]" } } }
```

스키마에서 프로퍼티 이름은 값이 아니라 선언 대상입니다. 이제 구조는 그대로 두고
`default` · `examples` · `const` · `enum` 처럼 **값이 들어가는 자리만** 마스킹합니다.
`properties` · `items` 는 재귀하고, 민감도는 그 자리까지 내려온 프로퍼티 이름으로
판정합니다. ADR-0004 가 해석하지 않는 `allOf` · `anyOf` · `oneOf` 는 대상이 아닙니다.

**이 변화가 중요한 이유** — 스키마가 부서지면 `replay` 와 `generate --cassette` 경로의
입력 계약 대조가 판정 근거를 잃고, 그 실패가 "위반 없음"과 구분되지 않게 조용히
사라집니다. 이제 스키마가 보존되어 대조가 실제로 의미를 갖습니다.

카세트 포맷과 `CASSETTE_VERSION` 은 바뀌지 않지만, 저장되는 스키마의 **구조**가
달라지므로 구형 카세트와는 내용이 어긋납니다. 다시 녹화하기 전까지는 예전 구조를
그대로 갖고 있습니다.

근거는 ADR-0040 에 있습니다.
