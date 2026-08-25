---
"@mcpeak/generate": patch
---

provider 로 나가는 요청과 승인 화면의 민감 키 판정을 runner 와 같은 규칙으로 맞췄습니다(#368).

`generate` 는 runner 의 민감 키 **목록**만 가져다 자기 정확 일치로 판정했습니다.
[ADR-0082](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0082-runner-의-민감-키-판정을-record-와-같은-접미-단어열-규칙으로-맞춘다.md)
로 runner 가 접미 단어열 규칙으로 바뀌면서 목록과 규칙이 한 쌍이 됐는데, 목록만 가져오면
`sessionToken` 이 실패 메시지에서는 가려지고 provider 요청에서는 원문이었습니다. 이제 runner 의
`isSensitiveKey` 를 그대로 씁니다. `sessionToken`·`X-Api-Key`·`privateKey`·복수형이 새로
가려지고 `tokenCount`·`cacheKey` 는 그대로 보입니다.

provider 가 돌려준 summary·warnings·questions 같은 자유 텍스트도 `이름: 값` 꼴에서 이름을 같은
규칙으로 판정합니다. 이전에는 목록 항목을 부분 문자열로 찾아 `sessionToken:` 은 걸리고
`tokens=` 는 안 걸렸습니다.

ADR-0009 의 승인 심볼 목록에 `isSensitiveKey` 를 더했습니다.
