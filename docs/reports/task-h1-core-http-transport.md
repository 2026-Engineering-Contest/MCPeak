# Task H1 보고서 — 진단 유니온과 오류 코드

- 작업 브랜치: `feat/core-http-diagnostics`
- worktree: `.claude/worktrees/ohmymcp-h1-core-http`
- 기준 커밋: `11f7e9b`
- 근거 문서: 설계 `docs/superpowers/specs/2026-08-14-core-streamable-http-transport-design.md`
  §7.2 · §8.1 · §8.2 · §8.4 · §12.2 · §12.3 · §12.6,
  계획 `docs/superpowers/plans/2026-08-14-core-streamable-http-transport-implementation.md` §3.1 · Task H1
- 상태: READY_FOR_REVIEW

## 1. 변경 파일

```
 M packages/core/src/client.ts
 M packages/core/src/diagnostics.ts
 M packages/core/src/errors.ts
 M packages/core/tests/diagnostics.test.ts
 M packages/core/tests/errors.test.ts
```

`git status --short` 의 출력이 위와 같다. 신규 파일은 이 보고서뿐이다. 커밋은 하지 않았다.

### 1.1 `packages/core/src/diagnostics.ts`

- `McpHttpDiagnostics` 신설 (설계 §7.2 그대로: `url` · `status` · `statusText` · `sessionId`).
- `McpDiagnostics` 태그 유니온 신설 (설계 §7.2 그대로).
- `createDiagnosticsSnapshot` 이 `transport: "stdio"` 를 붙이고 반환 타입이
  `{ transport: "stdio" } & McpProcessDiagnostics` 로 좁아졌다.
- `createHttpDiagnosticsSnapshot(url, status, statusText, sessionId)` 신설. `Object.freeze` 한다.
- `BoundedStderr.snapshot` 의 반환 타입도 태그가 붙은 타입으로 좁혔다. 본문은 그대로다.
- `McpDiagnosticsInput` 과 `tagDiagnostics` 신설. 설계에 없는 추가분이며 이유는 3.1 에 적었다.

### 1.2 `packages/core/src/errors.ts`

- `McpClientErrorPhase` 에 `"connect"` 추가.
- `McpClientErrorCode` 에 설계 §8.2 의 6 종 추가. 총 17 종이다.
- `MCP_CLIENT_ERROR_DETAILS` 에 6 종의 `phase` · `message` · `hint` 를 §8.2 표에서 그대로 옮겼다.
- `McpClientError.diagnostics` 의 타입이 `McpDiagnostics` 다. 생성자 입력은 `McpDiagnosticsInput`
  이고 `tagDiagnostics` 로 정규화한 뒤 동결한다.
- `toJSON()` 을 transport 로 분기했다 (§8.4).
  - `stdio`: `name` · `code` · `phase` · `message` · `hint` · `transport` · `exitCode` · `signal` ·
    `stderrTruncated`
  - `http`: `name` · `code` · `phase` · `message` · `hint` · `transport` · `url` · `status` ·
    `statusText` · `sessionId`
  - 키 순서를 코드에 고정했으므로 `JSON.stringify` 결과가 실행마다 같다.

### 1.3 `packages/core/src/client.ts`

- `OperationFailureKind` 가 `"process" | "transport" | "httpSession" | undefined` 다.
- `"httpSession"` 이 `HTTP_SESSION_LOST` · `phase: "transport"` 로 매핑된다. 판정 순서는
  `process` → `transport` → `httpSession` → `OPERATION_FAILED` 이고, 기존 두 분기의 동작은
  그대로다.
- 진단 콜백 타입을 `() => McpDiagnosticsInput` 으로 넓혔다 (`createMcpClientAdapter`,
  `assertToolArguments`, `invalidArguments`).

### 1.4 테스트

- `tests/diagnostics.test.ts`: 설계 §12.2. stdio 스냅샷의 `transport` 와 나머지 네 필드,
  `BoundedStderr.snapshot` 의 태그, http 스냅샷의 `toEqual` 과 `Object.isFrozen` (3 건 추가).
- `tests/errors.test.ts`: 설계 §12.3. 신규 6 종의 `phase` · `hint` 대조, 신규 6 종 `message` 에
  `stdio` · `stdout` · `process` · `exit` 부재, HTTP `toJSON()` 키 집합 정확 일치,
  stdio `toJSON()` 키 집합, `headers` 값 부재, 같은 HTTP 실패 두 번의 `JSON.stringify` 동일성
  (6 건 추가). 기존 stdio `toJSON()` 단언에는 `transport: "stdio"` 한 줄을 더했다
  (`toMatchObject` 로 바꾸지 않았다).

## 2. 어떤 기존 테스트가 왜 깨졌고 어떻게 고쳤나

| 파일 | 깨졌나 | 내용 |
|---|---|---|
| `tests/errors.test.ts` | 예 | `toJSON()` 을 `toEqual` 로 비교하는 단언 1 건. `toJSON()` 이 `transport` 를 싣게 됐다. 기대값에 `transport: "stdio"` 를 더해 고쳤다 |
| `tests/diagnostics.test.ts` | 아니오 | 기존 3 건은 `toMatchObject` 와 필드 접근이라 영향 없음. 신규 케이스만 추가했다 |
| `tests/client.test.ts` | 아니오 | 진단 리터럴이 `() => McpDiagnosticsInput` 에 그대로 들어간다. 한 줄도 고치지 않았다 |
| `tests/index.test.ts` | 아니오 | 진단 리터럴이 없다 |
| `tests/stdio-integration.test.ts` | 아니오 | 진단을 `Object.isFrozen` 으로만 본다 |
| `tests/lifecycle.test.ts` | 아니오 | 진단 provider 가 `() => McpProcessDiagnostics` 로 계약돼 있고 그 타입은 바뀌지 않았다 |

설계 §12.6 은 최대 4 개 파일의 수리를 예상했지만 실제로 깨진 것은 `errors.test.ts` 1 건이다.
`McpProcessDiagnostics` 자체를 건드리지 않았기 때문이다 (3.1 참조). 중간에
`tests/client.test.ts` 와 `tests/lifecycle.test.ts` 를 고쳤다가 불필요해져 `git checkout` 으로
원상 복구했고, 최종 diff 에 남아 있지 않다.

## 3. 임의로 판단한 지점

### 3.1 `McpDiagnosticsInput` 과 `tagDiagnostics` 를 추가했다 (설계에 없음)

설계 §7.2 를 글자 그대로 옮기면 `McpClientError` 의 `diagnostics` 입력 타입이 `McpDiagnostics`
가 되는데, 진단을 넘기는 호출부가 전부 값을 `McpProcessDiagnostics` 로 선언하고 있어
`transport` 태그가 타입 수준에서 지워진다. 그 결과 다음이 컴파일되지 않는다.

- `packages/core/src/lifecycle.ts` (`#finalDiagnostics`, `getDiagnostics`, 6 개 호출부)
- `packages/core/src/controlled-stdio.ts` (`#diagnostics()`, `getDiagnostics()`)
- `packages/core/src/index.ts` (`McpStdioConnection.getDiagnostics`)

셋 다 이 태스크의 Files 목록 밖이다 (앞의 둘은 계획서가 명시적으로 금지한다).

시도했다가 되돌린 대안: `McpProcessDiagnostics` 인터페이스 자체에 `readonly transport: "stdio"`
를 넣는 방법. core 는 통과했지만 **`packages/cli/tests/test-command.test.ts` 가 깨졌다**
(다른 오너의 패키지라 수정 불가). 그 파일이 `McpStdioConnection` 의 진단을 손으로 만든다.

그래서 태그가 없는 stdio 진단도 받는 입력 타입 `McpDiagnosticsInput = McpDiagnostics |
McpProcessDiagnostics` 를 두고, `tagDiagnostics()` 로 태그가 없으면 `"stdio"` 를 붙인다.
공개 결과 타입은 설계대로다.

- `McpDiagnostics` 유니온의 형태: 설계와 동일
- `McpProcessDiagnostics`: 변경 없음
- `McpClientError.diagnostics` 속성 타입: `McpDiagnostics` (계획서 산출 계약대로)
- 런타임: stdio 진단은 전부 `createDiagnosticsSnapshot` 을 거치므로 이미 태그가 있다.
  `tagDiagnostics` 의 기본값이 실제로 쓰이는 곳은 다른 패키지의 test double 뿐이다.

**H3 담당자가 알아야 할 점**: `createMcpClientAdapter` 의 진단 콜백은 태그 없는 객체도 받으므로,
HTTP 경로에서 진단을 직접 리터럴로 만들면 조용히 `stdio` 로 태깅된다. HTTP 진단은 반드시
`createHttpDiagnosticsSnapshot` 으로 만들어라.

### 3.2 `HTTP_STATUS_ERROR` hint 의 backtick 을 그대로 두었다

설계 §8.2 표의 hint 에 "Streamable HTTP 엔드포인트는 보통 `` `/mcp` `` 입니다" 로 backtick 이
있다. 한 글자도 바꾸지 말라는 지시에 따라 backtick 을 포함한 문자열을 그대로 넣었다.

**제안 (적용하지 않음)**: 기존 11 종의 hint 는 `command` · `cwd` · `stdout` 같은 식별자에
backtick 을 쓰지 않는다. CLI 가 터미널에 그대로 출력하므로 backtick 만 이 한 줄에 남는다.
설계 문서 쪽의 backtick 이 markdown 표기였다면 제거하는 편이 일관적이다. 결정은 문서 오너에게
맡긴다.

### 3.3 `toJSON()` 의 키 순서

§8.4 는 키 목록만 주고 순서를 명시하지 않는다. `transport` 를 `hint` 뒤, transport 별 필드 앞에
두었다. §8.4 의 http 목록 순서와 같고, stdio 는 기존 순서 뒤에 `transport` 만 끼워 넣은 형태다.
순서를 코드에 고정했으므로 `JSON.stringify` 는 결정론적이다.

### 3.4 `HTTP_HANDSHAKE_TIMEOUT` 의 phase

설계 §8.2 표대로 `handshake` 다. 나머지 네 연결 오류의 `connect` 와 다르지만 표를 따랐다.
`HTTP_SESSION_LOST` 의 `transport` 도 같다.

## 4. 검증

worktree 루트에서 실행했다.

| 명령 | 결과 |
|---|---|
| `pnpm test packages/core` | `Test Files 7 passed (7)` · `Tests 57 passed (57)` (기준 48 건에서 9 건 증가) |
| `pnpm typecheck` | `Tasks: 6 successful, 6 total` |
| `pnpm lint` | `Checked 134 files in 28ms` · 오류 0 |

검사 대상이 0 이 아님을 확인한 방법:

- 테스트: 파일 7 개 · 케이스 57 개가 출력에 찍힌다. 기준선 48 건에서 신규 9 건이 늘었다.
- 타입체크: turbo 캐시를 피해 `packages/core` 에서 `npx tsc --noEmit --listFiles` 를 직접 돌려
  `packages/core/` 소속 파일 15 개(`src` 8 · `tests` 7)가 검사 대상임을 확인했다. 종료 코드 0.
- 린트: `Checked 134 files` 가 출력에 찍힌다. 중간에 실제로 format 오류 1 건
  (`errors.ts` 의 import 줄바꿈)을 잡아냈으므로 검사가 돌고 있다는 증거이기도 하다.

## 5. 남은 위험

1. **`tagDiagnostics` 의 기본값이 실수를 숨긴다.** 태그 없는 진단이 오면 stdio 로 간주한다.
   H3 가 HTTP 진단을 리터럴로 만들면 `toJSON()` 이 stdio 모양으로 나온다. 3.1 의 경고를 H3
   프롬프트에 넣는 것을 권한다.
2. **`McpStdioConnection.getDiagnostics()` 의 반환 타입에는 여전히 `transport` 가 없다.**
   `src/index.ts` 가 H3 소유라 열지 않았다. 런타임 값에는 태그가 있으므로 CLI 가 좁히기를 하려면
   H3 이 그 선언을 `McpDiagnostics` 로 넓혀야 한다. 이 태스크의 산출 계약에는 없는 항목이다.
3. **`packages/cli/tests/test-command.test.ts` 가 core 진단 형태에 결합돼 있다.** 3.1 에서
   확인했다. 이 태스크는 건드리지 않았지만, 앞으로 `McpProcessDiagnostics` 를 좁히는 변경은
   cli 오너와 조율해야 한다.
4. **오류 문장의 어투가 기존 11 종과 다르다.** 신규 6 종은 설계 표를 그대로 옮겨서 조사 앞에
   공백이 들어간다 (`url 의`, `status 와`). 기존은 붙여 쓴다 (`cwd를`). 문안 통일이 필요하면
   설계 문서와 함께 고쳐야 한다. 이 태스크에서는 표를 우선했다.
5. **HTTP 경로 자체는 아직 없다.** 신규 6 종은 H3 이 `http-transport.ts` 에서 던지기 전까지
   생성되지 않는다. 지금 검증된 것은 상수 · 타입 · `toJSON()` 분기까지다.
