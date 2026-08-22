---
"@mcpeak/record": minor
"@mcpeak/cli": minor
---

**External Record/Replay** — MCP 서버가 **밖으로 나가는 HTTP 호출**을 녹화하고 재생한다.

지금까지 카세트는 *우리가 서버에게 물어본 결과*를 남겼다. 세션은 *그 서버가 밖에 물어본 결과*를 남긴다. 둘은 섞이지 않고 파일도 따로다.

```bash
mcpeak test suite.json --command node --arg server.js --record-session s.db   # 녹화
mcpeak test suite.json --command node --arg server.js --session s.db          # 재생
```

재생에서는 서버가 실제로 실행되지만 외부 API 는 부르지 않는다. 녹화에 없는 호출을 만나면 실패한다. `token`·`apiKey` 같은 이름의 값은 저장 전에 가려지지만, **세션 파일에는 외부 API 응답이 그대로 들어가므로 `.gitignore` 를 확인해야 한다.**

라이브러리로는 `@mcpeak/record/external` 서브패스가 `startExternalCoordinator` 와 `createSqliteSessionStore` 를 공개한다. 저장은 `node:sqlite` 를 쓰므로 세션 옵션을 쓴 실행에서 런타임에 따라 `ExperimentalWarning` 이 stderr 에 한 줄 나올 수 있다 (ADR-0056).

**잡는 범위는 `globalThis.fetch` 하나다** (ADR-0057). `node:http`·`node:https`·axios·got 처럼 다른 경로로 부르는 서버는 녹화되지 않는다. 어댑터는 `node.fetch.v1` 이며 확장 여지를 두고 버전을 붙였다.

범위 밖이면 실행 끝에 알린다 — 녹화가 0건이거나 재생에서 소비한 호출이 0건이면 "이 세션은 아무 호출도 막지 못합니다" 를 낸다. 판정과 종료 코드는 바뀌지 않는다.

관련 결정: ADR-0051 · ADR-0052 · ADR-0053 · ADR-0056.
