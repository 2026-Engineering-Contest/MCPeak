---
"@mcpeak/cli": minor
---

**Breaking**: `mcpeak verify` 명령을 제거했습니다. Tool 카세트를 걷어내는 첫 조각입니다
([ADR-0059](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0059-tool-카세트를-제거한다.md)).

`verify` 는 카세트 `auto` 모드의 사각지대를 메우는 부속물이었습니다 — `auto` 는 카세트에 있는
요청이면 서버를 부르지 않아 응답이 바뀌어도 모르고, `verify` 가 그것을 비파괴로 확인했습니다.
카세트가 사라지면 그 사각지대도 사라집니다.

**갈아타는 곳은 목적에 따라 갈립니다.**

- 서버 응답이 아직 맞는지 확인하고 싶었다면 → `mcpeak test` 로 실서버를 직접 검증하세요.
- 외부 API 호출을 막는 것이 목적이었다면 → `mcpeak test --record-session <path>` 로 녹화하고
  `--session <path>` 로 재생하세요. 서버는 실제로 뜨고 그 서버가 밖에 부르는 호출만 막힙니다.

`mcpeak verify` 를 실행하면 위 안내가 그대로 나옵니다. 라이브러리 함수 `verifyCassette` 는
`@mcpeak/record` 에 아직 남아 있습니다 — 구현 제거는 뒤 단계입니다.
