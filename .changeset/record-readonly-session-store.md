---
"@mcpeak/record": minor
---

`createSqliteSessionStore` 에 `readOnly` 옵션을 더했습니다. 켜면 세션 DB 를 읽기 전용으로 열고
스키마 DDL·`meta` INSERT 를 돌리지 않습니다 — **주어진 파일을 만들지도 고치지도 않습니다.**

재생(`--session`)은 읽기인데 저장소가 모드와 무관하게 DDL 을 실행하고 있었고, 그 결과가 둘이었습니다([#291](https://github.com/2026-Engineering-Contest/MCPeak/issues/291)).

- 읽기 전용(chmod 444) 세션은 `attempt to write a readonly database` 로 한 건도 재생되지 않았습니다. 저장소에 커밋한 세션·CI 아티팩트 캐시·읽기 전용 마운트에서 재생을 쓸 수 없다는 뜻입니다.
- 0바이트 파일을 넘기면 **실패한 실행이 그 파일을 36,864바이트짜리 빈 세션 DB 로 덮어썼습니다.**

`readOnly` 로 연 저장소는 세션이 아닌 파일을 거부하고, 그 이유를 원인별로 갈라 말합니다 —
세션이 없는 파일과 store version 이 다른 파일은 사용자가 할 일이 다릅니다. 녹화 계열 호출
(`createSession`·`reserve`·`complete`·`finish`)은 SQLite 원문 대신 우리 문장으로 거부합니다.

기본값은 `false` 이고 녹화 경로의 동작은 그대로입니다.
