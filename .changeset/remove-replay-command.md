---
"@mcpeak/cli": minor
---

**Breaking**: `mcpeak replay` 명령을 제거했습니다. Tool 카세트를 걷어내는 세 번째 조각입니다
([ADR-0059](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0059-tool-카세트를-제거한다.md)).

`@mcpeak/cli/commands` 의 공개 재export 에서도 `runReplayCommand`·`parseReplayCommand`·
`ReplayCommandInput`·`ReplayCommandDependencies` 가 빠집니다.

**갈아타는 곳은 목적에 따라 갈립니다.**

- 서버를 띄우지 않고 저장된 응답으로 스위트를 돌리는 것이 목적이었다면 → `mcpeak-mock` 으로
  서버를 대신하세요. 사람이 지정한 결정론적 응답이라 낡지 않습니다.
- 외부 API 호출만 막는 것이 목적이었다면 → `mcpeak test --record-session <path>` 로 녹화하고
  `--session <path>` 로 재생하세요. 서버는 실제로 뜨고 그 서버가 밖에 부르는 호출만 막힙니다.

`mcpeak replay` 를 실행하면 위 안내가 그대로 나옵니다.
