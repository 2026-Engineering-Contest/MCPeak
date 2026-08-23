---
"@mcpeak/generate": minor
---

AI 사전보완이 codex 에서 **한 번도 성공하지 않던** 문제를 고칩니다([#284](https://github.com/2026-Engineering-Contest/MCPeak/issues/284), [ADR-0064](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0064-사전보완-제안-값을-json-문자열로-받는다.md)).

원인은 provider 도 인증도 아니고 우리가 만들어 보내는 출력 스키마였습니다. 제안 값을 빈 스키마
`value: {}` 로 두었는데, codex 는 모든 property 에 `type` 키를 요구해 요청을 통째로 거절합니다.

```
"code": "invalid_json_schema",
"message": "... In context=('properties', 'proposals', 'items', 'properties', 'value'),
  schema must have a 'type' key."
```

화면에는 이 사실이 한 글자도 오지 않고 `providerFailed` 만 남아, 사용자는 baseline 값으로 넘어가는
이유를 알 수 없었습니다.

제안 값을 `valueJson` 문자열로 받고 로컬에서 파싱합니다. 임의 JSON 을 두 CLI 공통 스키마 범위로
표현할 수 없다는 것은 ADR-0007 이 `suiteJson` 에서 이미 부딪혀 기록한 벽이고, 같은 답을 적용했습니다.
타입을 전부 나열하는 길(`{"type":[...,"object",...]}`)은 strict mode 의 `additionalProperties` 요구에
다시 걸리므로 택하지 않았습니다.

**검증 강도는 그대로입니다.** 제안 값의 최종 판정은 원래도 스키마가 아니라 `checkInputContract` 였고,
요청에 없는 케이스·없는 필드·근거 있는 값을 덮어쓰는 제안·서버 선언을 어기는 값은 지금과 똑같이
사유와 함께 버려집니다.

**breaking**: 공개 타입 `PreFillOutputSchema` 의 `properties.proposals.items.properties` 에서 `value` 가
`valueJson: { type: "string" }` 으로 바뀝니다. `PreFillProposal`(`{ caseId, field, value }`)은 그대로라
결과를 읽는 쪽은 영향이 없습니다.
