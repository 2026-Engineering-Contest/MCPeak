# ADR-0001: 첫 MCP transport로 stdio 프로세스 연결을 사용한다

- 상태: 승인
- 날짜: 2026-08-12
- 승인일: 2026-08-12
- 작성자: core 오너
- 관련 설계: [Core stdio transport 및 프로세스 수명주기 설계](../superpowers/specs/2026-08-12-core-stdio-transport-design.md)

## 배경

`@ohmymcp-hsu/core`는 Runner가 실제 MCP 서버를 검사할 수 있도록 동결된 `McpClient` 구현을 만든다.
첫 도그푸딩 대상인 `examples/weather-server/server.mjs`는 별도 프로세스로 실행되는 stdio MCP
서버다. 이후에는 사용자가 직접 만든 Node.js 또는 Python 서버뿐 아니라 `npx`나 로컬 실행
명령으로 제공되는 외부 MCP도 같은 방식으로 검사해야 한다.

Runner는 `McpClient`를 주입받아 테스트를 실행할 뿐 서버 프로세스를 시작하거나 종료하지 않는다.
따라서 Core가 실제 서버 연결, MCP 초기화, 프로세스 정상 종료와 강제 종료를 소유해야 한다.

현재 설치된 `@modelcontextprotocol/sdk`는 1.30.0으로 고정되어 있다. SDK는 stdio, 인프로세스,
Streamable HTTP transport를 제공하지만 첫 수직 기능에서는 하나의 연결 방식과 실패 경계를 먼저
결정해야 한다.

## 선택지

### A. stdio 프로세스 연결

Core가 명령과 인자를 받아 MCP 서버를 자식 프로세스로 실행하고 stdin과 stdout으로 통신한다.

- 장점
  - Node.js, Python, `npx`, 로컬 실행 파일 등 구현 언어와 배포 형태에 덜 의존한다.
  - 사용자가 실제 MCP client에서 실행하는 방식과 가깝다.
  - 프로세스 시작 실패, stderr, handshake timeout, 비정상 종료를 실제로 검증할 수 있다.
- 단점
  - 프로세스와 stream 수명주기, 강제 종료, 플랫폼 차이를 처리해야 한다.
  - 인프로세스 가짜 client보다 테스트가 느리고 통합 테스트를 직렬화해야 한다.

### B. 인프로세스 연결

같은 Node.js 프로세스 안에서 MCP client와 server transport를 직접 연결한다.

- 장점
  - 빠르고 프로세스 종료 처리가 단순하다.
  - 단위 테스트에서 실패 상황을 만들기 쉽다.
- 단점
  - 실제 사용자가 실행하는 별도 MCP 프로세스와 수명주기가 다르다.
  - Python 서버, 실행 파일, `npx` 기반 외부 MCP를 그대로 검사할 수 없다.
  - 실제 stderr와 프로세스 종료 결함을 발견하지 못한다.

### C. Streamable HTTP 연결

Core가 원격 MCP URL과 인증정보를 받아 HTTP로 연결한다.

- 장점
  - 호스팅된 MCP와 원격 서비스를 직접 검사할 수 있다.
- 단점
  - OAuth, 헤더와 토큰 보관, redirect, request abort, socket 종료 정책이 추가로 필요하다.
  - 첫 도그푸딩 대상인 로컬 weather-server 연결 문제를 해결하지 않는다.

## 결정

첫 transport는 A안인 stdio 프로세스 연결로 한다.

Core는 `command`, `args`, 명시적 환경변수, 작업 디렉터리를 받아 서버를 실행하고 MCP
handshake가 완료된 뒤 `McpClient`를 제공한다. Core가 만든 연결은 프로세스와 stream을 소유하며
정상 종료와 pending MCP 요청에 의존하지 않는 강제 종료 기능을 함께 제공한다.

인프로세스 연결은 Core 단위 테스트용 fake 경계로만 사용하고 첫 공개 transport에는 포함하지
않는다. Streamable HTTP와 OAuth는 stdio 수직 기능이 실제 weather-server E2E를 통과한 뒤 별도
ADR과 설계로 추가한다.

SDK 1.30.0의 `Client`와 공개 MCP 타입 및 stdio framing을 사용한다. 다만 SDK 기본
`StdioClientTransport`만으로는 Core가 요구하는 독립적인 `forceClose()` 수명주기를 충분히 제어할
수 없으므로, 구체적인 프로세스 handle과 종료 정책은 Core가 소유한다. SDK 버전은 올리지 않는다.

## 이유

OhMyMCP의 첫 사용자 가치는 가짜 client가 아니라 실제 MCP 프로세스를 결정론적으로 검사하는
것이다. stdio는 현재 예제 서버와 일반적인 로컬 MCP 실행 형태를 모두 지원하며, 구현 언어에도
묶이지 않는다.

인프로세스 방식만 선택하면 Runner의 로직은 빠르게 검증할 수 있지만 프로세스 기동 실패,
handshake timeout, stderr, pending 요청, 좀비 프로세스 같은 실제 결함을 발견하지 못한다. 이
영역은 CI와 CLI 신뢰성에 직접 영향을 주므로 첫 transport에서 검증해야 한다.

HTTP를 동시에 지원하면 인증과 네트워크 종료 정책이 stdio 프로세스 수명주기와 섞인다. 두
transport는 강제 종료 방식이 다르므로 첫 PR에서 함께 추상화하면 검증되지 않은 공통 계층이 먼저
생긴다. stdio 수직 기능을 완성한 뒤 실제 요구를 기준으로 공통화를 결정한다.

## 결과

- `@ohmymcp-hsu/core`는 stdio MCP 프로세스의 시작, handshake, 통신, stderr 수집, 정상 종료와 강제
  종료를 소유한다.
- 동결된 `packages/core/src/types.ts`의 `McpClient`와 `ToolResult`는 변경하지 않는다.
- Core는 Runner를 import하지 않는다. CLI가 Core 수명주기를 Runner의
  `McpClientShutdownController`로 조립한다.
- 첫 공개 범위는 로컬에서 명령으로 실행 가능한 MCP다. 원격 HTTP, SSE, WebSocket, OAuth,
  인프로세스 공개 API, Docker 수명주기 관리는 제외한다.
- 실제 프로세스 통합 테스트는 `examples/weather-server/server.mjs`와 Core 소유의 종료 전용
  fixture를 사용하며 외부 네트워크나 실제 Notion, Figma 계정에 접근하지 않는다.
- stdio E2E와 도그푸딩 결과가 쌓이면 Streamable HTTP 지원 여부와 transport 공통 인터페이스를
  별도 ADR에서 결정한다.
