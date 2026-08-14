# Task H3 — HTTP transport 연결 보고서

- 상태: **READY_FOR_REVIEW**
- 브랜치: `feat/core-http-connect` (기점: 통합 브랜치 `feat/core-streamable-http`)
- 설계 문서: `docs/superpowers/specs/2026-08-14-core-streamable-http-transport-design.md`
  §3.3 · §4 · §6 · §8.3 · §9 · §10 · §12.0 · §12.4 · §12.5
- 구현 계획: `docs/superpowers/plans/2026-08-14-core-streamable-http-transport-implementation.md` Task H3

## 1. 변경 파일

```
 M packages/core/src/index.ts
?? packages/core/src/http-transport.ts
?? packages/core/tests/fixtures/http-server.ts
?? packages/core/tests/http-integration.test.ts
```

`git status --short` 결과가 위 네 줄이 전부다(보고서 파일 추가 전 기준). `lifecycle.ts` ·
`controlled-stdio.ts` · `diagnostics.ts` · `errors.ts` · `options.ts` · `client.ts` · `types.ts` 는
열지도 고치지도 않았다. 다른 패키지, 루트 빌드 설정, `package.json` 도 그대로다. 새 의존성 없음.

## 2. 구현 내용

### `packages/core/src/http-transport.ts` (신규)

| 항목 | 설계 근거 | 구현 |
|---|---|---|
| 재연결 고정 | §6 | `RECONNECTION_OPTIONS = { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 }`. SDK 기본값에 맡기지 않는다 |
| 연결 실패 매핑 | §8.3 | `mapConnectFailure` 가 6단계를 순서대로 판정한다. `UnauthorizedError` → `StreamableHTTPError(-1)` → `StreamableHTTPError(401\|403)` → `StreamableHTTPError` → `RequestTimeout` → 그 밖 |
| 연결 후 실패 판정 | §8.3 | `operationFailureKind()` 가 `StreamableHTTPError && code === 404 && sessionId !== null` 일 때만 `"httpSession"` 을 반환한다 |
| 진단 | §7.2 | 항상 `createHttpDiagnosticsSnapshot` 으로 만든다. 객체 리터럴을 쓰지 않으므로 `tagDiagnostics` 가 stdio 로 잘못 태깅할 여지가 없다 |
| 종료 | §9 | 멱등. `sessionId` 가 있으면 `terminateSession()` 을 부르고 실패는 삼킨다. `close()` 가 던지면 `CLOSE_FAILED` 로 감싼다. `forceClose` 는 만들지 않았다 |
| 비밀값 | §11 | 헤더는 `requestInit.headers` 로만 간다. 진단 · 오류 메시지 · `toJSON()` 어디에도 없다 |

`statusText` 는 `node:http` 의 `STATUS_CODES` 고정 표에서 가져온다. 서버 응답 본문을 읽지
않으므로 결정론적이고 비밀값이 섞이지 않는다.

### `packages/core/src/index.ts` (수정)

- `connectHttp(options: HttpConnectOptions): Promise<McpHttpConnection>` 추가
- `McpHttpConnection` 추가 (`client` · `getDiagnostics` · `close`. `forceClose` 없음)
- `connect` 가 `isHttpConnectOptions` 로 분기. 반환 타입은 `Promise<McpClient>` 그대로
- `connectStdio` 의 매개변수를 `StdioConnectOptions` 로 좁힘. 본문은 한 줄도 바뀌지 않았다
- `McpStdioConnection.getDiagnostics` 의 반환 타입에 `transport: "stdio"` 태그를 붙임
- `McpDiagnostics` · `McpHttpDiagnostics` · `HttpConnectOptions` · `StdioConnectOptions` 재수출

### `packages/core/tests/fixtures/http-server.ts` (신규)

`startMcpHttpServer` 는 SDK 저수준 `Server` 와 `StreamableHTTPServerTransport` 로 실제 MCP 서버를
띄운다. `startRawServer` 는 상태 코드 · Content-Type · 본문 · 지연만 돌려준다.
`reserveClosedPortUrl` 은 아무도 듣지 않는 포트의 URL 을 만든다. 전부 `127.0.0.1` 과 포트 `0` 이고
외부 네트워크에 접근하지 않는다. `packages/mock` 을 import 하지 않는다.

## 3. 검증

| 명령 | 결과 | 검사 대상 수 |
|---|---|---|
| `pnpm test packages/core` (1회차) | 통과 | `Test Files 8 passed (8)`, `Tests 86 passed (86)` |
| `pnpm test packages/core` (2회차) | 통과 | 같은 `8 / 86`. 두 번 다 같은 결과 |
| `pnpm typecheck` | 통과 | `Tasks: 6 successful, 6 total` |
| `pnpm lint` | 통과 | `Checked 137 files in 30ms. No fixes applied.` |
| `pnpm build` | 통과 | `Tasks: 6 successful, 6 total`, `Cached: 0 cached` |

인계받은 기준선은 `Tests 65 passed (65)` 와 `src/index.ts(25,76)` typecheck 실패 1건이었다.
그 오류는 사라졌고 테스트는 21개 늘었다.

## 4. §12.4 · §12.5 케이스별 통과 여부

전부 `packages/core/tests/http-integration.test.ts` 에 번호를 붙여 넣었고 21개 모두 통과한다.

| # | 내용 | 결과 |
|---|---|---|
| 1 | `listTools()` 가 툴 이름과 설명을 순서대로 반환 | 통과 |
| 2 | `callTool` 성공 응답이 `isError: false` 이고 `content` 일치 | 통과 |
| 3 | 서버의 `isError: true` 를 던지지 않고 전달 | 통과 |
| 4 | 문자열 인자를 `INVALID_TOOL_ARGUMENTS` 로 거절, 서버 호출 카운터 0 | 통과 |
| 5 | `pageSize: 1`, 툴 3개를 모두 수집 | 통과 |
| 6 | 반복 cursor 에 `PAGINATION_CURSOR_REPEATED` | 통과 |
| 7 | 연결 거부에 `HTTP_CONNECT_FAILED`, `phase "connect"`, `transport "http"`, `status null` | 통과 |
| 8 | 500 에 `HTTP_STATUS_ERROR`, `status 500` | 통과 |
| 9 | 401 에 `HTTP_UNAUTHORIZED` | 통과 |
| 10 | `text/html` 응답에 `HTTP_RESPONSE_INVALID`, `status null` | 통과 |
| 11 | `delayMs 5000` + `connectTimeoutMs 200` 에 `HTTP_HANDSHAKE_TIMEOUT`, 2초 미만 | 통과 |
| 12 | 연결 뒤 서버 소멸 시 `PROCESS_EXITED` · `PROCESS_START_FAILED` · `TRANSPORT_FAILED` 아님 | 통과 |
| 13 | 세션을 잊은 서버(404)에 `HTTP_SESSION_LOST`, `phase "transport"` | 통과 |
| 14 | `close()` 두 번 호출해도 안 던짐 | 통과 |
| 15 | `terminateSession` 405 에도 `close()` 정상 반환 | 통과 |
| 16 | `close()` 뒤 pending `callTool` 이 유한 시간 안에 reject | 통과 |
| 17 | `connect({ url })` 반환값이 `McpClient` 이고 `getDiagnostics` 없음 | 통과 |
| 18 | `headers` 가 실제 요청 헤더로 전달 | 통과 |
| 19 | 같은 포트의 연결 거부 두 번, `toJSON()` 문자열 동일 | 통과 |
| 20 | 같은 500 두 번, `toJSON()` 문자열 동일 | 통과 |
| 21 | 성공 경로 두 번, `listTools()` 직렬화 결과 동일 | 통과 |

## 5. 임의로 판단한 지점

1. **fixture 가 `McpServer` 대신 저수준 `Server` 를 쓴다.** 설계 §12.0 은 "SDK McpServer +
   StreamableHTTPServerTransport" 라고 적었지만, `McpServer.registerTool` 은 zod 스키마를 받고
   `tools/list` 의 cursor 를 노출하지 않는다. §12.0 이 요구하는 `pageSize` 와 §12.4 6번의 반복
   cursor 를 만들 방법이 없어 `server/index.js` 의 `Server` 에
   `setRequestHandler(ListToolsRequestSchema, ...)` 를 붙였다. 같은 SDK 안이고 `packages/mock` 은
   쓰지 않는다.
2. **stateless fixture 는 요청마다 서버 · transport 인스턴스를 새로 만든다.** 하나를 재사용하면
   `initialize` 다음 요청부터 서버가 500 을 돌려준다(실측). SDK 의 stateless 계약이 인스턴스
   재사용을 허용하지 않는다. 세션을 유지해야 하는 stateful fixture 만 인스턴스를 하나로 둔다.
3. **fixture 반환 타입에 관측 수단 세 개를 더했다.** §12.0 의 `TestHttpServer` 는 `url` 과
   `close` 뿐이지만, §12.4 의 4 · 13 · 18 번을 검증하려면 `callCount()` ·
   `lastRequestHeaders()` · `forgetSession()` 이 필요하다. 추가일 뿐 §12.0 의 두 멤버는 그대로다.
   `startMcpHttpServer` 옵션에도 `repeatCursor` · `stateful` · `terminateStatus` 를 더했다(6 · 13 ·
   15 번용).
4. **`statusText` 를 `node:http` 의 `STATUS_CODES` 에서 가져온다.** 설계는 이 값을 어디서 얻는지
   적지 않았다. `StreamableHTTPError` 는 코드만 주고 reason phrase 를 주지 않는다. 서버 응답에서
   읽으면 §11(본문을 싣지 않는다)과 §12.5(결정론성)를 동시에 어긴다. 고정 표가 두 규칙을 다
   지키면서 진단을 쓸모 있게 만든다. 모르는 코드는 `null` 이다.
5. **`operationFailureKind` 를 위해 SDK 호출을 감쌌다.** `createMcpClientAdapter` 의
   `operationFailureKind` 는 인자를 받지 않아 실패 원인을 볼 수 없다. `client.ts` 는 H1 소유라
   시그니처를 못 바꾼다. 그래서 `trackOperationFailures` 가 `listTools` · `callTool` 을 감싸
   마지막 실패를 기록하고 오류는 그대로 다시 던진다. `client.ts` 를 고치지 않고 §8.3 의 판정을
   만족시키는 유일한 길이었다.
6. **`McpStdioConnection.getDiagnostics` 의 태그를 단언으로 좁혔다.**
   `controlled-stdio.ts` 의 `getDiagnostics()` 선언 타입에는 태그가 없지만 런타임 값은 항상
   `transport: "stdio"` 를 달고 온다. 그 파일은 이 태스크의 소유가 아니라 선언을 넓힐 수 없어
   `tagDiagnostics(...) as StdioDiagnostics` 로 좁혔다. `tagDiagnostics` 는 태그가 이미 있으면
   같은 객체를 그대로 돌려주므로 `connectStdio` 의 런타임 동작과 객체 동일성이 유지된다.
   근본 해결은 `controlled-stdio.ts` 의 반환 타입을 태그 있는 타입으로 넓히는 것이고, 후속으로
   남긴다.
7. **연결 실패 정리에서 `abort()` 가 오류를 삼킨다.** stdio 경로는 정리 실패를
   `AggregateError` 로 합치지만, HTTP 에는 죽일 프로세스가 없어 정리 실패가 사용자에게 알릴
   내용이 없다. 원래 실패 원인을 덮지 않는 쪽을 택했다.

## 6. 남은 위험

- **11번의 시간 단언.** "2초 미만"은 시계에 의존한다. `connectTimeoutMs` 200ms 대비 여유가 10배라
  실측 여유는 크지만, 극단적으로 느린 CI 에서 흔들릴 수 있는 유일한 케이스다.
- **`sessionId` 는 진단에 그대로 실린다.** fixture 는 고정 문자열을 쓰지만 실제 서버는 임의
  값을 발급한다. 실서버를 상대로 한 실패의 `toJSON()` 은 실행마다 `sessionId` 가 달라진다.
  설계 §7.2 가 "관측된 값만 싣는다"고 정한 결과이고, §12.5 의 세 케이스는 전부 세션 발급 전
  실패라 영향이 없다.
- **쿼리 문자열 토큰은 진단 URL 에 남는다.** 설계 §11 · §15 의 명시적 한계다.
- **전체 `pnpm test` 는 돌리지 않았다.** 지시받은 네 명령만 실행했다. `examples/` 를 띄우는 E2E 는
  직렬 전용이라 다른 터미널과 충돌할 수 있어 통합 게이트에서 판정하는 편이 맞다.
- **OAuth · 재연결 미지원.** 설계 §15 그대로다. 401 은 `HTTP_UNAUTHORIZED` 로 끝나고, 끊기면
  재연결하지 않는다.
