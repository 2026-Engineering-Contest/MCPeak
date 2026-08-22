---
"@mcpeak/dashboard": minor
---

**Breaking**: 대시보드에서 카세트 화면과 replay 플로우를 제거했습니다. Tool 카세트를 걷어내는
두 번째 조각입니다([ADR-0059](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0059-tool-카세트를-제거한다.md)).

사라진 것:

- `Cassettes` 사이드바 항목과 `#/cassettes` 화면
- `GET`·`PUT`·`DELETE /api/cassettes/*` 와 `GET /api/cassettes`
- 실행 플로우 `replay` (`POST /api/runs` 의 `flow: "replay"`)

외부 API 호출을 막는 것이 목적이었다면 `mcpeak test --record-session <path>` 로 녹화하고
`--session <path>` 로 재생하세요. 서버는 실제로 뜨고 그 서버가 밖에 부르는 호출만 막힙니다.

`generate` 마법사의 `--cassette` 옵션은 아직 남아 있습니다 — 그 부분은 `generate` 오너가
별도로 걷습니다.
