---
"@mcpeak/mock": patch
---

`mock.on()` 이 `tools` 에 없는 툴 이름을 주입 시점에 거절합니다. 정의 파일 경로는 이미
`assertMockDefinition` 이 잡고 있었지만 `on()` 은 통과시켜, 오타가 주입에 성공한 것처럼 보이고
실제 호출이 미스로 떨어질 때까지 아무 신호도 받지 못했습니다.
