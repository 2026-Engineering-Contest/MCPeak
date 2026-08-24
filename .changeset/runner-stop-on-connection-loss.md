---
"@mcpeak/runner": minor
---

서버와의 연결이 끝나면 **남은 케이스를 부르지 않고 멈춥니다**([ADR-0073](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0073-연결이-끝나면-남은-케이스를-부르지-않는다.md), [#279](https://github.com/2026-Engineering-Contest/MCPeak/issues/279)).

지금까지는 서버 프로세스가 죽어도 남은 케이스를 계속 호출했습니다. 원인은 하나인데 화면에는 실패 5건으로 부풀고, 뒤따르는 4건은 `Not connected` 복사본이었습니다. 이제 타임아웃과 같은 형태로 멈추고, 실행하지 않은 케이스는 `not run` 으로 갈립니다.

```
중단: 서버 프로세스가 종료되어 실행을 멈췄습니다. (종료 코드 42)

1 failed, 4 not run  (5 total)
```

프로세스 종료(`PROCESS_EXITED`) · 전송 실패(`TRANSPORT_FAILED`) · HTTP 세션 상실(`HTTP_SESSION_LOST`) 셋 다 해당합니다. 서버가 살아서 오류를 돌려준 실패(`OPERATION_FAILED`)는 그대로 다음 케이스를 이어갑니다.

`RunnerReport["stopReason"]` 에 `{ type: "connectionLost", caseId, cause, exitCode?, signal? }` 변종이 생겼습니다. `stopReason.type` 을 분기하는 코드는 이 사유를 함께 다뤄야 합니다.
