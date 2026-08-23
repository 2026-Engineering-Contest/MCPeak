---
"@mcpeak/record": minor
---

**Breaking**: `@mcpeak/record` 에서 Tool 카세트 구현을 제거했습니다. 이 패키지는 이제 External
세션 전용입니다([ADR-0059](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0059-tool-카세트를-제거한다.md)).
`verify`·`replay`·`generate --cassette` 로 사용자 표면을 걷어낸 데 이은 마지막 조각입니다.

사라진 export:

- `cassetteClient` · `loadCassette` · `saveCassette` · `diffCassettes` · `droppedInteractionsMessage`
- `verifyCassette` · `matchKey` · `redact` · `stableStringify` · `CASSETTE_VERSION` · `REDACTED`
- 관련 타입 전부(`Cassette` · `CassetteInteraction` · `CassetteMode` · `CassetteClientOptions` ·
  `CassetteDropReport` · `CassetteMismatch` · `CassetteVerifyResult`)

패키지 루트(`@mcpeak/record`)는 이제 `@mcpeak/record/external` 과 **같은 API** 를 냅니다 —
`startExternalCoordinator` · `createSqliteSessionStore` · `loadSession` ·
`ExternalRecordReplayError`. 서브패스로 부르던 코드는 그대로 동작합니다.

갈아탈 곳은 목적에 따라 갈립니다.

- 서버의 외부 HTTP 호출을 막고 싶다면 External 세션을 쓰세요 —
  `mcpeak test <suite.json> --command <executable> --record-session <path>` 로 녹화하고
  `--session <path>` 로 재생합니다. 서버는 실제로 뜨고 그 서버가 밖에 부르는 호출만 막힙니다.
- 서버 자체를 실행하지 않고 결정론적인 응답으로 테스트하려면 `@mcpeak/mock` 을 쓰세요.

`@mcpeak/core` 런타임 의존도 함께 제거했습니다. External 세션은 `McpClient` 를 감싸지 않아
core 타입을 쓰지 않습니다.
