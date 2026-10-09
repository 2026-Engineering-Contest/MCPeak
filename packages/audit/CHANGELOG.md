# @mcpeak/audit

## 0.2.0

### Minor Changes

- fb511b8: `@mcpeak/audit` 패키지를 새로 만든다. MCP 서버 사전 보안 점검의 공유 계약(리포트·기준 파일 타입, 규칙 모듈 시그니처)만 들어 있고 검사 본문은 아직 없다.

  `@mcpeak/core` 의 `connectStdio`·`connectHttp` 반환에 `McpServerSurface` 를 교차로 더한다. `listToolsRaw`(annotations·title·`_meta` 를 버리지 않는 tools/list), `listPrompts`·`listResources`(능력이 없으면 `[]`), `readResource`, `observeServerMessages`(서버가 보낸 요청·알림 관측, 요청에는 MethodNotFound 로 답한다), `serverVersion` 이다. 새 연결 옵션 `advertise` 로 sampling·elicitation·roots 능력을 켤 수 있고, 기본은 전부 꺼져 있어 기존 호출자의 동작은 바뀌지 않는다. `McpClient`·`McpStdioConnection`·`McpHttpConnection` 은 그대로다.

- ab15a0a: `mcpeak audit --sandbox` 를 더한다. 서버를 Docker 컨테이너 안에서 띄워 모든 도구를 부르고, 그동안의 파일 읽기·자식 프로세스·나가는 접속을 관측해 `behavior`·`network` 발견으로 알린다. `--sandbox-session`·`--sandbox-replay` 로 네트워크를 녹화·재생하고, `--allow-host` 로 목적지를 선언하며, `--compare-host` 로 격리 안팎의 도구 표면을 비교하고, `--sandbox-mount` 로 컨테이너에 보일 범위를 정한다. Docker 가 없으면 격리 없이 점검하고 리포트 둘째 줄이 그 사실을 말한다. 격리가 실제로 켜진 실행의 호출 기본값은 `all` 이다(ADR-0107, ADR-0108).
- 8ea349b: 격리 실행(행위 관측)의 공유 계약을 더한다. 타입(`SandboxOptions`·`SandboxReport`·`Observation`·`SyscallEvent`·`ObservedRequest`·`PlannedCall`·`HomePlan` 등), 규칙 가족 `behavior`·`network`, 위치 `call`, 오류 코드 `SANDBOX_CLEANUP_FAILED`·`SANDBOX_SESSION_UNREADABLE`, 격리 백엔드 인터페이스(`SandboxBackend`·`SandboxHandle`·`SandboxSpec`)와 모듈 시그니처가 들어 있고 검사 본문은 아직 없다. `AuditOptions.sandbox` 와 `AuditReport.sandbox` 는 선택 필드라서 `--sandbox` 없는 출력과 기준 파일 형식은 그대로다(`AUDIT_SCHEMA_VERSION` 은 1). 배포본에 격리 이미지 재료(`sandbox/Dockerfile`, `sandbox/gateway`)가 실린다.

### Patch Changes

- 56954eb: 정적 규칙 두 개의 오탐을 줄인다. `schema/annotation-mismatch` 는 읽기 전용(`readOnlyHint: true`) 도구의 설명 전체를 훑지 않고 도구 이름의 첫 토큰과 설명·제목의 맨 앞 동사만 본다. 설명 중간에 명사나 리소스 이름, HTTP 메서드로 나온 `commit`·`deploy`·`POST` 같은 낱말 때문에 정상 도구가 high 로 잡히던 문제가 사라진다. `desc/implicit-trigger` 는 파라미터(`inputSchema` 속성) 설명에서는 돌지 않는다. 인자를 어떻게 채우는지 알려 주는 조건문이 자동 트리거로 오인되었기 때문이다. 두 규칙의 id·심각도·메시지는 그대로이고, 파라미터 설명에 대한 다른 규칙(injection, shadowing 등)도 그대로 돈다.
- 798891a: `describeLocation`·`escapeInvisible` 을 공개 면에 올린다. 대시보드 보안 탭이 CLI 리포트와 같은 위치 문장을 쓰려는 것이다. 출력은 바뀌지 않는다.
- 5c87e79: `mcpeak audit --sandbox` 의 녹화가 상류가 답하지 않은 전달 요청도 카세트에 적는다. 상류 이름을 풀지 못했거나 접속하지 못해 게이트웨이가 스스로 502 로 답한 요청은 지금까지 세션 파일에 남지 않았고, 그래서 `--sandbox-replay` 로 재생하면 녹화에는 없던 `network/replay-miss` 발견이 하나 더 생겼다. 이제 그런 요청은 고정 문구의 502 응답으로 녹화되어 재생에서 `replay-hit` 가 되고, 응답 없는 유출 목적지로 요청을 보내는 서버에서도 녹화와 재생의 `--json` 이 `sandbox.network` 값 하나만 다르다. 세션 파일의 형식은 그대로다. 내부 주소로 풀려 막힌 요청과 상류가 응답을 시작한 뒤 끊긴 요청은 여전히 녹화하지 않는다.
- e2a3953: `mcpeak audit --sandbox -- npx -y <패키지>` 가 격리 안에서 `ENOENT: mkdir '/home/node/.npm'` 으로 죽던 것을 고친다. 명령이 `npx`·`npm` 일 때만 target 컨테이너의 `~/.npm` 에 실행 가능한 tmpfs(512MB)를 얹는다. `node` 로 띄우는 서버의 격리 옵션은 그대로이고 `/tmp` 는 언제나 noexec 다(ADR-0109). 잡음 표에 `npm-cache` 행을 더해, 실행기가 시작 단계에 그 자리를 채우는 쓰기·옮기기·지우기를 `behavior/write-outside` 로 내지 않는다. 호출 단계의 같은 경로는 그대로 발견이다.
- Updated dependencies [fb511b8]
- Updated dependencies [f4248d9]
  - @mcpeak/core@0.6.0
