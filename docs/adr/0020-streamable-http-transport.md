# ADR-0020: 두 번째 transport 로 Streamable HTTP 를 추가하고, 진단을 transport 별 유니온으로 나눈다

- 상태: 초안
- 날짜: 2026-08-14
- 작성자: core 오너
- 관련 결정: [ADR-0001](./0001-transport-strategy.md), [ADR-0007](./0007-mock-stdio-transport.md)
- 관련 설계: [Core Streamable HTTP transport 설계](../superpowers/specs/2026-08-14-core-streamable-http-transport-design.md)
- 관련 이슈: [#16](https://github.com/2026-Engineering-Contest/OhMyMCP/issues/16)

## 배경

ADR-0001 은 첫 transport 로 stdio 프로세스 연결을 골랐고, 결과 절에서 "stdio E2E 와 도그푸딩
결과가 쌓이면 Streamable HTTP 지원 여부와 transport 공통 인터페이스를 별도 ADR 에서 결정한다"고
예고했다. 이 ADR 이 그 후속이다.

stdio 수직 기능은 완성됐다. `packages/core` 는 프로세스 기동, handshake, bounded stderr, 정상
종료와 강제 종료를 소유하며 실제 서버 통합 테스트를 통과한다.

이슈 #16 이 제기한 두 가지 중 하나는 이미 해소됐다. 목 서버 도그푸딩은 ADR-0007 이 낸 stdio
진입점(`ohmymcp-mock`)으로 뚫렸다. 남은 하나는 해소되지 않았다. **URL 로만 접근할 수 있는 MCP
서버를 우리 도구로 검사할 방법이 없다.** MCP 스펙은 stdio 와 Streamable HTTP 두 transport 를
정의하고 원격 MCP 는 후자만 쓴다. 도그푸딩 대상(§10)에 원격 서버가 들어오는 순간 막힌다.

이 결정에는 하위 결정이 하나 딸려 있다. Core 의 진단 타입 `McpProcessDiagnostics` 는
`stderr` · `stderrTruncated` · `exitCode` · `signal` 넷으로 이뤄지고, HTTP 에는 넷 다 존재하지
않는다. `McpClientError` 와 `createMcpClientAdapter` 가 이 타입을 필수로 요구하므로 transport 를
늘리려면 진단을 어떻게 할지 함께 정해야 한다.

## 선택지

### A. HTTP 를 추가하지 않고 미룬다

- 장점: `core` 를 안 건드린다.
- 단점: 원격 MCP 서버를 영원히 검사할 수 없다. MCP 스펙의 절반을 포기하는 것이며, 이 도구의
  대상 사용자 중 호스팅 MCP 를 쓰는 쪽이 통째로 빠진다.

### B. `runner` 가 자체 HTTP 클라이언트를 만든다

- 장점: `core` 를 안 건드린다.
- 단점: `cli → runner → core` 단방향 의존이 무너지고 transport 코드가 두 군데로 갈라진다.
  `runner` 의 책임은 실패 메시지 품질이지 프로토콜이 아니다.

### C. `core` 에 Streamable HTTP 를 추가한다 (진단은 빈 프로세스 스냅샷)

`ConnectOptions` 를 유니온으로 넓히고, HTTP 연결의 진단은 `exitCode: null`, `stderr: ""` 로
채운다.

- 장점: 타입 변경 폭이 가장 작다. `McpClientError` 를 손대지 않는다.
- 단점: **진단이 거짓말을 한다.** 사용자는 `exitCode: null` 을 보고 프로세스가 있다고 읽고,
  빈 `stderr` 를 보고 서버가 아무 말도 안 했다고 읽는다. 정작 필요한 상태 코드와 엔드포인트는
  어디에도 없다. 실패 메시지가 곧 제품인 프로젝트에서 이건 제품 결함이다.

### D. `core` 에 Streamable HTTP 를 추가하고, 진단을 transport 태그 유니온으로 나눈다

`McpDiagnostics = ({ transport: "stdio" } & McpProcessDiagnostics) | ({ transport: "http" } &
McpHttpDiagnostics)` 로 넓히고, HTTP 는 `url` · `status` · `statusText` · `sessionId` 를
싣는다. 오류 코드도 HTTP 전용으로 6종을 새로 낸다.

- 장점: 실패 메시지가 실제로 일어난 일을 말한다. 상태 코드 500 과 연결 거부와 HTML 응답이
  서로 다른 문장으로 나온다.
- 단점: `McpClientError.diagnostics` 의 공개 타입이 넓어지고 `toJSON()` 이 분기한다. 기존
  stdio 테스트의 `toEqual` 단언을 손봐야 한다.

### E. 두 transport 를 공통 추상화 뒤로 숨긴다

- 장점: 세 번째 transport 를 붙이기 쉽다.
- 단점: 두 경로의 종료 정책이 실제로 다르다. stdio 는 `SIGKILL` 로 프로세스를 죽여야 하고
  HTTP 는 죽일 프로세스가 없다. ADR-0001 이 경계한 "검증되지 않은 공통 계층"이 그대로 생긴다.

## 결정

**D 를 채택한다.** E 는 채택하지 않는다.

- `ConnectOptions` 를 `StdioConnectOptions | HttpConnectOptions` 유니온으로 넓힌다.
  `HttpConnectOptions` 는 `url`, 선택적 `headers`, 선택적 `connectTimeoutMs` 만 받는다.
- `connectStdio` 옆에 `connectHttp` 를 두고 `connect()` 만 분기한다. 공통 transport 인터페이스는
  만들지 않는다. `lifecycle.ts` 와 `controlled-stdio.ts` 는 한 줄도 재사용하지 않는다.
- 진단을 `transport` 태그 유니온으로 나눈다. HTTP 진단은 `url` · `status` · `statusText` ·
  `sessionId` 를 싣고, 헤더 값은 어디에도 싣지 않는다.
- HTTP 전용 오류 코드 6종(`HTTP_CONNECT_FAILED`, `HTTP_STATUS_ERROR`, `HTTP_UNAUTHORIZED`,
  `HTTP_RESPONSE_INVALID`, `HTTP_HANDSHAKE_TIMEOUT`, `HTTP_SESSION_LOST`)과 phase `"connect"` 를
  더한다. `PROCESS_EXITED` 나 `TRANSPORT_FAILED` 를 HTTP 경로에서 재사용하지 않는다. 그 hint 가
  프로세스와 stdout 을 가리켜 사용자를 잘못된 곳으로 보내기 때문이다.
- SDK 의 자동 재연결을 끈다(`maxRetries: 0`). 나머지 재연결 값도 고정 상수로 못 박는다.
- OAuth, SSE, WebSocket, 재연결, 스트림 재개는 이번 범위에서 제외한다.
- `McpClient` · `ToolDef` · `ToolResult` 와 SDK 버전은 건드리지 않는다.

## 이유

**HTTP 를 넣는 이유**는 MCP 스펙이 두 transport 를 정의하고 원격 MCP 가 후자만 쓰기 때문이다.
ADR-0001 이 HTTP 를 미룬 근거는 "첫 도그푸딩 대상인 로컬 weather-server 연결 문제를 해결하지
않는다" 였다. 그 문제는 이미 해결됐으므로 근거가 소멸했다.

**진단을 나누는 이유**는 이 프로젝트가 실패 메시지를 제품으로 보기 때문이다. C 안의 빈 스냅샷은
타입 검사를 통과하지만 사용자에게 거짓을 말한다. `exitCode: null` 은 "프로세스가 아직 살아
있다" 로도 읽히고 "프로세스가 없다" 로도 읽힌다. 어느 쪽으로 읽히든 HTTP 연결에서 사용자가
확인해야 할 것은 상태 코드와 엔드포인트 경로인데 그게 없다. 유니온의 비용은 `toJSON()` 분기
하나와 기존 단언 수정이고, 외부 패키지는 core 의 진단 타입을 아무도 읽지 않는다는 것을 전수
검색으로 확인했다.

**공통 추상화를 안 만드는 이유**는 두 transport 의 차이가 실제로 종료 정책에 있기 때문이다.
stdio 에는 `forceClose()` 가 있고 HTTP 에는 없다. 프로세스가 없으니 죽일 것도 없고 `close()` 가
내부 abort 로 pending 요청을 끊는다. 지금 공통 인터페이스를 만들면 HTTP 쪽에 의미 없는
`forceClose` 를 달거나, stdio 쪽 `forceClose` 를 인터페이스 밖으로 빼야 한다. 둘 다 사용자에게
거짓말을 하는 API 다.

**재연결을 끄는 이유**는 결정론성이다. SDK 기본값(2회 재시도, 1000ms 에서 1.5배 증가)을 그대로
두면 같은 서버 중단이 실행마다 다른 시각에 다른 오류로 관측된다. 우리는 테스트 도구다. 끊긴
연결을 조용히 되살리는 것보다 끊겼다고 즉시 말하는 쪽이 옳다.

## 결과

- `@ohmymcp/core` 가 URL 로 접근하는 Streamable HTTP MCP 서버를 검사할 수 있다.
- `connect()` 의 반환 타입은 `Promise<McpClient>` 로 유지되므로 `runner` · `generate` ·
  `record` · `mock` · `cli` 의 소스 변경이 없다.
- `McpClientError.diagnostics` 의 공개 타입이 `McpDiagnostics` 로 넓어진다. 이 값을 읽는
  소비자는 `transport` 로 분기해야 한다. 현재 그런 소비자는 없다.
- 오류 코드 목록이 11종에서 17종으로, phase 가 8종에서 9종으로 늘어난다.
- 새 런타임 의존성이 없고 SDK 버전이 그대로다.
- OAuth 가 필요한 원격 MCP 는 여전히 검사할 수 없다. 도그푸딩에서 실제로 막히면 별도 ADR 로
  연다.
- transport 공통 추상화는 세 번째 transport 가 생길 때 다시 판단한다.
- CLI 에 `--url` 플래그를 낼지는 이 ADR 의 범위 밖이며 `cli` 오너가 결정한다.
