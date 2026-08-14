# @ohmymcp/core

## 0.2.0

### Minor Changes

- 0d92470: core: 두 번째 transport 로 Streamable HTTP 를 추가한다. `ConnectOptions` 가 기존 stdio 옵션과 `url`·`headers`·`connectTimeoutMs` 를 받는 HTTP 옵션의 유니온으로 넓어지고, `connect()` 가 옵션 모양을 보고 `connectStdio` 와 `connectHttp` 로 분기한다. 진단은 `transport` 태그 유니온으로 나뉘어 HTTP 실패는 `url`·`status`·`statusText`·`sessionId` 를 싣고 HTTP 전용 오류 코드 6종으로 끝난다. 헤더 값은 진단과 오류 JSON 어디에도 실리지 않는다. `McpClient` 반환 타입과 SDK 버전은 그대로이며, OAuth 와 자동 재연결은 이번 범위에서 제외한다.

## 0.1.0

### Minor Changes

- 606600f: 실제 MCP 서버 프로세스를 stdio로 연결하고 handshake, bounded stderr 진단, 정상 종료와 강제 종료를 제공한다.
