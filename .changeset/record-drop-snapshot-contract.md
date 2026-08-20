---
"@mcpeak/record": minor
---

record: 아무 경로에도 배선되지 않은 `snapshotContract` 를 공개 API 에서 제거합니다. 비결정
필드를 지워 감추는 대신 실행 간 차이를 보고하는 쪽(ADR-0038 결정론성 확인)으로 프로젝트가
방향을 정했고, 이 함수의 전제는 그 결정에 뒤집혔습니다. 이 함수만 쓰던
`NONDETERMINISTIC_KEYS` 와 `normalizeKey` 도 함께 걷어냈고, `transformJson` 은 옵션이
사라져 `redact` 가 본체를 흡수했습니다. `redact` 의 동작과 마스킹 경계는 그대로입니다.
근거는 ADR-0047 입니다.
