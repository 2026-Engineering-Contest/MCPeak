# @ohmymcp/core

## 0.3.0

### Minor Changes

- cd25fb4: core: 셸을 사용하지 않는 실행 명령 토큰화와 구체적인 명령 구문 오류를 공개 API로 제공한다.

  cli: reset 명령에서 닫히지 않은 실행 파일 큰따옴표와 빈 실행 파일 경로를 구분해 안내한다.

### Patch Changes

- bf16fb5: `callTool` 이 배열이 든 인자를 거부하던 문제를 고칩니다. `{ items: [1, 2, 3] }` 처럼 중첩된
  배열이 있으면 SDK 에 닿기도 전에 `INVALID_TOOL_ARGUMENTS` 로 막혔고, 빈 배열도 마찬가지였습니다.
  JSON Schema 의 `type: "array"` 를 쓰는 MCP 서버는 이 도구로 테스트할 수 없었습니다.

  배열은 이제 객체와 같은 컨테이너로 순회합니다. 깊이 상한과 순환 참조 검사가 똑같이 걸리고,
  같은 배열을 두 곳에서 참조하는 것은 순환이 아니므로 통과합니다. 검증은 값을 변형하지 않으므로
  서버가 받는 것은 넘긴 배열 그대로입니다.

  **최상위 인자는 계속 객체여야 합니다.** MCP 의 `arguments` 규약입니다.

  **희소 배열(`[1, , 3]`)은 거부합니다.** 빈 자리는 JSON 을 거치면 `null` 이 되어 실제 `null`
  원소와 구분되지 않습니다 — 넘긴 값과 서버가 받는 값이 달라지는 유일한 배열 형태입니다.
  거부 집합(순환 참조 · 희소 배열 · `NaN`/`Infinity` · JSON 이 아닌 값)은 `record`(ADR-0003) ·
  `mock`(ADR-0029) 과 같게 맞췄습니다. 근거는 ADR-0035 에 있습니다.

## 0.2.0

### Minor Changes

- 0d92470: core: 두 번째 transport 로 Streamable HTTP 를 추가한다. `ConnectOptions` 가 기존 stdio 옵션과 `url`·`headers`·`connectTimeoutMs` 를 받는 HTTP 옵션의 유니온으로 넓어지고, `connect()` 가 옵션 모양을 보고 `connectStdio` 와 `connectHttp` 로 분기한다. 진단은 `transport` 태그 유니온으로 나뉘어 HTTP 실패는 `url`·`status`·`statusText`·`sessionId` 를 싣고 HTTP 전용 오류 코드 6종으로 끝난다. 헤더 값은 진단과 오류 JSON 어디에도 실리지 않는다. `McpClient` 반환 타입과 SDK 버전은 그대로이며, OAuth 와 자동 재연결은 이번 범위에서 제외한다.

## 0.1.0

### Minor Changes

- 606600f: 실제 MCP 서버 프로세스를 stdio로 연결하고 handshake, bounded stderr 진단, 정상 종료와 강제 종료를 제공한다.
