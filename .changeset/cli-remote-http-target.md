---
"@mcpeak/cli": minor
---

`test` 와 `generate` 가 **원격(Streamable HTTP) MCP 서버**에 붙을 수 있습니다. `--url <URL>` 로 지정하고, 인증이 필요하면 `--header-env <헤더이름>=<환경변수이름>` 으로 헤더를 환경변수에서 읽습니다 — 토큰을 명령줄에 쓰면 `ps` 목록과 셸 히스토리에 남기 때문에 값을 직접 받지 않습니다([ADR-0070](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0070-원격-서버의-인증-헤더는-값이-아니라-환경변수-이름으로-받는다.md), [#137](https://github.com/2026-Engineering-Contest/MCPeak/issues/137)).

원격 서버 실패에는 엔드포인트·HTTP 상태·세션 ID 를 담은 진단 블록이 붙습니다.
