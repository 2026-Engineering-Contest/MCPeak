---
"@mcpeak/runner": patch
---

결정론성 진단의 원인 추정 문장 셋이 실서버에서 모두 나옵니다(#293).

실서버는 결과를 JSON 으로 만들어 text 블록에 문자열로 감싸 보내는 것이 기본인데, 그 형태에서
`randomId` 와 `numericDrift` 가 **한 번도 걸리지 않았습니다.** UUID 판정에 `^…$` 앵커가 있어
text 블록 전체가 UUID 하나일 때만 걸렸고, 숫자 판정은 `typeof === "number"` 분기에만 있어
언제나 string 인 text content 로는 도달할 수 없었습니다. 차이 지점은 정확히 짚으면서 "무엇
때문으로 보인다" 는 줄만 통째로 빠졌습니다.

```
  issue_token / issue_token가 오류 없이 응답한다 (issue-token-success)
  → 다른 지점: content[0].text
     1회차: "{\"user\":\"example\",\"token\":\"2a6c24ca-cb6f-4aca-9fb7-dededf59cd5c\"}"
     2회차: "{\"user\":\"example\",\"token\":\"ca35b2b8-11fa-410d-82cd-433cf40d78f0\"}"
  → 실행마다 새로 발급되는 식별자로 보입니다. 이 값은 단언 기준이 될 수 없습니다.
```

판정을 "패턴이 있다" 에서 **"뽑은 자리 값이 실제로 달라졌다"** 로 바꿨습니다
([ADR-0067](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0067-결정론성-힌트는-패턴-존재가-아니라-값-변화로-판정한다.md)).
앵커만 떼면 숫자를 품은 모든 JSON 이 "측정값 변동" 이 되기 때문입니다. 같은 변경으로 **시간은
그대로인데 옆자리가 변한 응답에 "시간 의존으로 보입니다" 가 붙던 오귀속도 사라집니다.**

패턴 밖 차이가 섞여 있으면 힌트를 달지 않습니다. 짚어준 값을 고쳐도 여전히 다른 경우라, 원인을
단정하면 사용자를 엉뚱한 곳으로 보냅니다.

공개 API 는 그대로입니다.
