---
"@mcpeak/generate": minor
---

`additionalProperties: false` 툴에 선언 밖 필드를 넣은 거절 케이스를 만든다 (#427)
nullable `anyOf` 필드에 타입 위반 케이스가 생긴다. runner 의 해석 확장(#426)을 그대로 따른다
`pattern` 만 있는 문자열의 출처를 `placeholder` 로 내려 AI 사전보완이 덮을 수 있게 한다 (#428). `BASELINE_POLICY_VERSION` 은 올리지 않는다. 영향받는 툴이 전부 미배포 변경(#389)으로 처음 생성되는 것들이라 배포된 baseline 이 바뀌지 않는다.
