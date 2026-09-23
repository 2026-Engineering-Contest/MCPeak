---
"@mcpeak-examples/live-weather-server": patch
---

live-weather-server 를 저수준 `Server` + 손으로 쓴 JSON Schema 에서 `McpServer.registerTool` + zod 로 옮긴다. SDK 가 JSON Schema 를 만들고 인자를 검증하므로 결함 B(필수 필드 누락 미거절)·C(enum 밖 값에 정상 응답)는 만들 수 없게 되어 사라지고, 결함 A(outputSchema 불일치)만 남는다. 결함 A 의 실패 문장은 이제 서버 쪽 `Output validation error` 다. README 와 데모 순서를 그에 맞춘다.

`list_recent_quakes` 의 `hours`(최근 N시간) 를 `limit`(최근 N건) 으로 바꾼다. 요청 URL 에 현재 시각이 들어가 재생이 녹화본에서 못 찾던 것을 없애, 재생이 외부 호출 12건 전부를 찾는다. baseline 명세를 다시 뽑았다.
