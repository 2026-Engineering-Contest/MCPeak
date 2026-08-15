---
"@ohmymcp/runner": minor
---

runner: 명세의 `approval` 블록이 케이스별 판정을 담을 수 있습니다. `approval.cases` 에
`{ id, status }` 를 배열로 적고 `status` 는 `passed` 와 `serverDefect` 둘뿐입니다. 검증과
`MCP_SUITE_JSON_SCHEMA` 가 함께 넓어지고 `CaseApprovalStatus` · `SuiteCaseApproval` 타입을
내보냅니다. `cases` 는 선택적이라 기존 명세 파일은 그대로 유효하고, `approval` 은 지문 계산에서
빠지므로 지문도 바뀌지 않습니다. `approval.cases[].id` 가 실재하는 케이스인지는 검증하지
않습니다. 케이스를 지우는 정상 편집이 명세 파일을 깨진 것으로 만들지 않기 위해서입니다.
