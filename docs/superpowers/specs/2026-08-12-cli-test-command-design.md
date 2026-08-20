# CLI test 명령 실제 실행 흐름 설계

- 상태: 사용자 승인 완료, 구현 계획 작성 완료
- 작성일: 2026-08-12
- 승인일: 2026-08-12
- 구현 대상: `mcpeak` CLI
- 선행 설계:
  - [Core stdio transport 및 프로세스 수명주기 설계](./2026-08-12-core-stdio-transport-design.md)
  - [Runner 실행·보고서 및 Generate 연동 설계](./2026-08-11-runner-design.md)
  - [아키텍처의 CLI와 Core 연결 결정](../../architecture.md#7-cli와-core-연결-결정)

## 1. 목적

CLI의 `test` 명령은 사용자가 작성한 JSON 테스트 명세와 로컬 MCP 서버 실행 정보를 받아 실제
stdio 서버를 시작하고 Runner를 실행한다. CLI는 Core와 Runner를 조립하는 composition root이며,
명세 검증 전에는 서버 프로세스를 만들지 않고 Runner 실행 뒤에는 성공과 실패에 관계없이 정해진
수명주기 경계로 연결을 종료한다.

첫 수직 기능의 완료 조건은 다음과 같다.

> `mcpeak test`에 JSON 명세와 weather-server 실행 command 및 args를 전달하면 CLI가 명세를
> 검증한 뒤 서버에 연결하고, RunnerReport를 stdout에 한 번 출력하며, 테스트 결과에 맞는 종료
> 코드를 반환하고, 실행 뒤 자식 프로세스를 남기지 않는다.

완료 여부는 다음 검증으로 판정한다.

```text
pnpm exec vitest run packages/cli/tests
→ CLI 단위·계약 테스트와 실제 weather-server 명령 계층 E2E가 수집되고 전체 통과

pnpm --filter @mcpeak/cli typecheck
→ CLI 구현과 테스트 타입체크 통과

pnpm build
→ Core와 Runner의 최신 dist를 포함해 CLI ESM, CJS, 선언 파일 생성 성공

pnpm --filter @mcpeak/cli test:e2e
→ 빌드된 dist/cli.mjs가 실제 weather-server를 실행하고 report, 종료 코드, 프로세스 종료를 검증

pnpm exec biome check packages/cli
→ CLI 변경 파일 lint와 format 검사 통과
```

전체 저장소 회귀는 `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`로 판정한다. 명령
성공뿐 아니라 `packages/cli/tests`의 수집 파일과 테스트 수, 실제 weather-server 경로, 빌드된 CLI
스모크 실행 여부를 확인한다.

## 2. 범위

### 2.1 포함

- `test` 서브커맨드 디스패치
- 단일 UTF-8 JSON 테스트 명세 파일 로드
- JSON 파싱과 `validateMcpSuite` 명세 검증
- `--command` 한 개와 순서가 보존되는 반복 `--arg` 파싱
- Core의 `connectStdio`를 사용한 실제 stdio 서버 연결
- Runner의 `runSuite`와 `finalizeRunnerExecution` 조립
- RunnerReport JSON 출력
- 성공, 테스트 실패, 입력 실패, 연결 실패, 실행·종료 실패의 종료 코드 결정
- 단계와 해결 방법이 드러나는 결정론적 오류 출력
- 실제 weather-server를 사용하는 명령 계층 E2E와 빌드 산출물 스모크
- `@mcpeak/core`의 CLI 직접 workspace 의존성
- CLI README와 공개 기능 changeset 갱신

### 2.2 제외

- TypeScript 테스트 명세 직접 실행
- JavaScript, YAML 또는 그 밖의 테스트 명세 형식
- 여러 명세 파일과 glob 입력
- `--cwd`, `--env`, connect timeout, Runner timeout, payload limit 옵션
- watch 모드와 테스트 병렬 실행
- 컬러, 표, progress bar, 대화형 출력
- JSON 외 RunnerReport 출력 형식
- Ctrl+C와 그 밖의 OS signal 전용 처리
- `generate`, `record`, `replay`, `mock` 명령 구현
- Core와 Runner 공개 API 또는 동결 타입 변경
- `examples/weather-server/server.mjs` 수정
- `@modelcontextprotocol/sdk` 버전 변경
- 신규 외부 의존성 추가
- CI workflow 구조 변경

TypeScript 명세는 Node.js 20 최소 지원과 신규 의존성 금지 조건 때문에 이번 범위에서 제외한다.
Node.js 내장 TypeScript 실행은 Node.js 22 계열에서 추가됐고 `tsconfig.json` 전체 의미를 지원하지
않는다. 이후 TypeScript 명세를 지원하려면 지원 런타임과 로더 의존성을 별도 설계에서 먼저
결정한다.

## 3. 패키지 경계와 변경 허용 범위

CLI는 이미 승인된 의존 방향대로 Core와 Runner를 직접 조립한다.

```text
cli ─→ core
  └─→ runner ─→ core의 동결 타입
```

- `@mcpeak/core`는 `packages/cli/package.json`의 직접 workspace dependency로 추가한다.
- CLI는 `connectStdio`를 Runner를 통해 재수출하거나 우회하지 않는다.
- Runner는 Core 연결을 만들지 않고 주입된 `McpClient`만 실행한다.
- Core는 Runner 또는 CLI를 import하지 않는다.
- `packages/core/src/types.ts`의 `McpClient`와 `ToolResult`는 변경하지 않는다.
- `examples/weather-server/server.mjs`는 읽기 전용 E2E 대상이다.
- 기존 `examples/runner-weather-smoke.mjs`와 `examples/README.md`의 작업 중 변경은 수정하거나
  되돌리지 않는다.

구현에서 쓰기를 허용하는 범위는 다음과 같다.

```text
packages/cli/src/**
packages/cli/tests/**
packages/cli/README.md
packages/cli/package.json
pnpm-lock.yaml
.changeset/<새 CLI changeset>.md
```

설계와 계획 문서는 `docs/superpowers/specs/`와 `docs/superpowers/plans/`에 별도로 둔다. 루트
`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `vitest.config.ts`,
`biome.json`, GitHub Actions workflow는 변경하지 않는다.

## 4. 사용자 명령 계약

### 4.1 문법

첫 구현의 유일한 실행 문법은 다음과 같다.

```text
mcpeak test <suite.json> --command <executable> [--arg <value> ...]
```

weather-server 실행 예시는 다음과 같다.

```bash
mcpeak test packages/cli/tests/fixtures/weather-suite.json \
  --command node \
  --arg examples/weather-server/server.mjs
```

파싱 규칙은 다음과 같다.

1. 첫 토큰은 정확히 `test`여야 한다.
2. 두 번째 토큰은 정확히 하나의 명세 파일 경로다.
3. 명세 파일 뒤에는 `--command`와 `--arg`만 올 수 있다.
4. `--command`는 정확히 한 번 필요하며 빈 문자열일 수 없다.
5. `--arg`는 0회 이상 반복할 수 있고 빈 문자열도 값으로 허용한다.
6. 반복한 `--arg` 값은 입력 순서를 그대로 보존한다.
7. `--arg=-m`과 `--arg=` 형식도 각각 `-m`과 빈 문자열 인자로 허용한다.
8. `--command=node` 형식은 허용하고 `--command=`는 거절한다.
9. 알 수 없는 옵션, 추가 위치 인자, 중복 `--command`, 값 없는 옵션은 사용법 오류다.
10. `--` 구분자, 옵션 축약형, 옵션 결합형은 이번 범위에서 지원하지 않는다.

명령과 args는 shell 명령문으로 합치지 않는다. CLI는 파싱한 값을 다음처럼 Core에 전달한다.

```ts
connectStdio({ command, args });
```

따라서 pipe, redirect, glob, 환경변수 치환, command substitution은 발생하지 않는다. 하이픈으로
시작하는 서버 인자는 `--arg=-m`처럼 명시한다.

### 4.2 서브커맨드 디스패치

공개 `run(argv: string[]): Promise<number>` 시그니처는 유지한다. `run`은 `test`만 실제 명령으로
실행한다.

- 인자가 없거나 첫 토큰이 `COMMANDS`에 없으면 사용법 오류와 종료 코드 1을 반환한다.
- `generate`, `record`, `replay`, `mock`은 알려진 명령이지만 아직 지원되지 않았다는 결정론적
  오류와 종료 코드 1을 반환한다.
- 오류가 발생해도 `run`은 사용자 입력이나 런타임 실패를 그대로 reject하지 않고 stderr에
  정규화된 오류를 쓴 뒤 1을 resolve한다.
- 실제 실행 파일 `src/cli.ts`는 반환 코드를 `process.exitCode`에 대입한다.
- `process.exit()`를 호출하지 않아 stdout과 stderr가 flush되기 전에 프로세스를 끊지 않는다.

### 4.3 타입 시그니처

패키지 root의 기존 공개 계약은 다음 형태를 유지한다.

```ts
export type Command = (argv: string[]) => Promise<number>;

export const COMMANDS = ["test", "generate", "record", "replay", "mock"] as const;

export function run(argv: string[]): Promise<number>;
```

CLI test 명령이 해석한 값은 package-private 불변 입력으로 다룬다.

```ts
interface TestCommandInput {
  readonly suitePath: string;
  readonly command: string;
  readonly args: readonly string[];
}

type CliErrorCode =
  | "CLI_USAGE"
  | "COMMAND_NOT_IMPLEMENTED"
  | "SUITE_FORMAT_UNSUPPORTED"
  | "SUITE_READ_FAILED"
  | "SUITE_ENCODING_INVALID"
  | "SUITE_JSON_INVALID"
  | "SUITE_VALIDATION_FAILED"
  | "MCP_CONNECTION_FAILED"
  | "RUNNER_EXECUTION_FAILED"
  | "RUNNER_FINALIZATION_FAILED"
  | "CLI_INTERNAL_ERROR";

interface CliFailure {
  readonly code: CliErrorCode;
  readonly message: string;
  readonly hint: string;
  readonly issues?: readonly SuiteValidationIssue[];
}
```

단위 테스트에서 파일, Core, Runner와 출력을 대체할 수 있는 실행 경계를 두되 이 타입과 helper는
패키지 root에서 export하지 않는다. 공개 `run`은 실제 Node API와 `connectStdio`, `runSuite`,
`finalizeRunnerExecution`을 그 경계에 주입하는 adapter다. 내부 경계의 세부 함수명과 파일 배치는
구현 계획에서 확정한다.

## 5. 테스트 명세 로딩 계약

### 5.1 파일 형식

- 파일 확장자는 대소문자를 구분하지 않고 `.json`이어야 한다.
- 경로는 CLI를 시작한 `process.cwd()`를 기준으로 해석한다.
- 파일은 Node 내장 파일 API로 Buffer를 읽고 fatal UTF-8 decoder로 해석한다.
- 잘못된 UTF-8 byte sequence는 replacement character로 바꾸지 않고 입력 실패로 처리한다.
- UTF-8 텍스트를 `JSON.parse()`한 결과를 신뢰하지 않고 `validateMcpSuite()`에 전달한다.
- validator의 `valid: true` 결과에 들어 있는 `TestSuiteSpec`만 `runSuite`에 전달한다.

명세 처리 순서는 반드시 다음과 같다.

```text
확장자 확인
  → 파일 읽기
  → UTF-8 decode
  → JSON.parse
  → validateMcpSuite
  → connectStdio
```

확장자, 읽기, decode, JSON 파싱, 명세 검증 중 하나라도 실패하면 `connectStdio`를 호출하지 않는다.
`.ts`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs`, `.yaml`, `.yml` 파일은 내용을 읽거나 import하지 않고
거절한다. 명세 모듈의 코드를 실행하지 않으므로 명세 로딩 자체에 사용자 코드 side effect가 없다.

### 5.2 검증 오류

`validateMcpSuite()`가 반환한 모든 `SuiteValidationIssue`를 반환 순서대로 출력한다. 첫 오류만
출력하고 중단하지 않는다. 각 항목은 code, path, message, hint를 포함한다.

```text
오류 [SUITE_VALIDATION_FAILED]: MCP 테스트 명세가 유효하지 않습니다.
- [<issue.code>] <issue.path>: <issue.message>
  해결: <issue.hint>
```

Runner도 방어적으로 같은 명세를 다시 검증한다. CLI 검증과 Runner 검증 사이에는 명세 객체를
수정하지 않으며, Runner가 실행 snapshot을 만드는 기존 계약을 그대로 사용한다.

## 6. 실행과 종료 수명주기

### 6.1 정상 실행

유효한 명세와 command를 얻은 뒤의 호출 순서는 다음과 같다.

```text
connectStdio({ command, args })
  → runSuite({ client: connection.client, suite })
  → finalizeRunnerExecution({ execution, shutdown })
  → RunnerReport JSON 출력
  → report.status에 따른 종료 코드 반환
```

CLI는 다음처럼 동일한 client identity를 가진 shutdown controller를 한 번 만들고 finalizer에
전달한다.

```ts
const shutdown = {
  client: connection.client,
  close: () => connection.close(),
  forceClose: () => connection.forceClose(),
};
```

Runner의 `forceClose(reason)` reason은 Core에 별도 reason 인자가 없으므로 CLI adapter가 받고
무시한 뒤 `connection.forceClose()`를 호출한다. controller 객체는 finalization 도중 교체하지
않는다.

CLI는 `onEvent`를 제공하지 않는다. 이번 출력 계약은 중간 이벤트 없이 최종 RunnerReport 한 개만
출력하는 것이다. Runner의 redaction, payload limit, drain timeout, shutdown timeout은 모두 기존
기본값을 사용한다.

### 6.2 예외 경로

- `connectStdio`가 실패하면 Core가 내부 force cleanup을 수행한 결과를 보존하고 CLI는 연결 오류를
  출력한다.
- 연결 뒤 `runSuite`가 finalizer 등록 전에 동기 실패하면 CLI가 `connection.forceClose()`를
  호출해 열린 프로세스를 정리한다.
- execution을 얻은 뒤에는 `finalizeRunnerExecution`이 report 관찰, drain, graceful close,
  force close와 오류 집계를 전부 소유한다.
- `finalizeRunnerExecution`이 reject하면 CLI는 `client.close()`나 `connection.forceClose()`를 다시
  호출하지 않는다. caller가 만든 shutdown controller와 finalizer가 유일한 종료 경로다.
- drain이 `deadlineExceeded`이면 finalizer가 일반 close를 건너뛰고 shutdown controller의
  `forceClose`를 호출한다. CLI가 이 처리를 일반 close로 바꾸지 않는다.
- finalizer reject에는 report와 cleanup 오류가 정해진 순서로 집계돼 있다. CLI는 이 오류를
  `RUNNER_FINALIZATION_FAILED`로 분류하고 stdout을 비운 채 stderr를 출력한 뒤 종료 코드 1을
  반환하며, 집계된 오류를 다른 cleanup 오류로 덮지 않는다.
- 정상·실패 report가 반환된 경우 finalization은 이미 끝났으므로 그 뒤에 report를 출력한다.
- report 직렬화나 출력 전에 finalization이 실패하면 부분 report를 stdout에 출력하지 않는다.

`runSuite`는 직접 client를 닫지 않는다는 Runner 계약을 유지한다. CLI도 finalizer를 우회해 정상
종료하지 않는다.

## 7. 출력 계약

### 7.1 성공적으로 완료된 Runner 실행

finalizer가 RunnerReport를 반환하면 stdout에는 다음 값만 쓴다.

```ts
`${JSON.stringify(report, null, 2)}\n`;
```

- JSON indentation은 공백 2개다.
- 출력 끝에는 newline 하나가 있다.
- RunnerEvent, 진행 로그, command, args, 절대 경로는 섞지 않는다.
- report가 `passed`, `failed`, `aborted` 중 어느 상태이든 report가 존재하면 같은 형식으로
  stdout에 출력한다.
- 이 경로에서 stderr는 비어 있어야 한다.

### 7.2 오류 출력

report를 만들기 전에 실패하거나 finalization이 실패하면 stdout은 비어 있고 stderr에만 오류를
쓴다. 오류 형식은 다음 두 줄 구조를 기본으로 한다.

```text
오류 [<CLI 오류 코드>]: <무엇이 왜 실패했는지>
해결: <사용자가 다음에 확인하거나 실행할 내용>
```

명세 검증 오류는 5.2의 issue 목록을 두 줄 뒤에 추가한다. Core의 `McpClientError`를 찾을 수 있는
연결 실패는 Core code, message, hint를 다음처럼 보존한다.

```text
오류 [MCP_CONNECTION_FAILED/<core.code>]: <core.message>
해결: <core.hint>
```

`connectStdio`가 cleanup 오류를 함께 담은 `AggregateError`를 던지면 CLI는 errors 배열을 입력
순서로 탐색해 첫 `McpClientError`를 연결 실패의 primary로 사용한다. 순환 참조는 다시 방문하지
않는다. Core 오류를 찾지 못하면 일반 연결 실패 형식을 사용한다.

기본 오류 출력에는 다음 값을 넣지 않는다.

- JavaScript stack trace
- native `ENOENT`처럼 Node 버전과 운영체제에 따라 달라지는 원문 오류
- Core diagnostics의 raw stderr
- command 전체 문자열과 args
- `cause`와 `AggregateError.errors`의 임의 값

이 제한은 서버 stderr나 command arg에 들어 있을 수 있는 비밀값을 기본 출력으로 복사하지 않기
위한 것이다. Core가 제공하는 안정된 code, message, hint와 CLI가 소유한 단계별 문구만 사용한다.

### 7.3 CLI 오류 코드

| 코드 | 발생 단계 | message 의미 | hint 의미 |
|---|---|---|---|
| `CLI_USAGE` | 서브커맨드·옵션 파싱 | 어떤 필수 토큰이 없거나 어떤 토큰이 허용되지 않았는지 | 고정 usage 문자열 |
| `COMMAND_NOT_IMPLEMENTED` | 디스패치 | 알려진 명령이 아직 구현되지 않았음 | 현재 지원하는 `test` 명령 안내 |
| `SUITE_FORMAT_UNSUPPORTED` | 확장자 검사 | JSON 명세만 지원함 | `.json` 파일 사용 안내 |
| `SUITE_READ_FAILED` | 파일 읽기 | 지정한 명세 파일을 읽지 못함 | 경로와 읽기 권한 확인 안내 |
| `SUITE_ENCODING_INVALID` | UTF-8 decode | 파일이 유효한 UTF-8이 아님 | UTF-8 JSON으로 저장 안내 |
| `SUITE_JSON_INVALID` | JSON 파싱 | JSON 문법이 유효하지 않음 | JSON 문법 확인 안내 |
| `SUITE_VALIDATION_FAILED` | 명세 검증 | Runner 명세 계약을 만족하지 않음 | 출력된 issue별 해결 안내 |
| `MCP_CONNECTION_FAILED` | Core 연결 | MCP 서버 시작 또는 handshake 실패 | Core hint 또는 command 확인 안내 |
| `RUNNER_EXECUTION_FAILED` | `runSuite` 시작 | Runner execution을 시작하지 못함 | 명세와 Runner 설정 확인 안내 |
| `RUNNER_FINALIZATION_FAILED` | report·종료 | Runner report 또는 종료 lifecycle 실패 | 서버 응답과 종료 상태 확인 안내 |
| `CLI_INTERNAL_ERROR` | 분류되지 않은 경계 | 예상하지 못한 CLI 내부 오류 | 재실행 후 재현 정보와 함께 이슈 보고 안내 |

오류 문자열은 한국어 고정 문장으로 구현하고 테스트에서 전문을 비교한다. 사용자 입력 중 명세
경로를 출력할 때는 사용자가 전달한 문자열만 사용하고 `path.resolve()`로 만든 환경별 절대 경로는
출력하지 않는다. 사용자 입력이나 validator issue에서 온 문자열을 stderr에 넣을 때는 C0 control,
DEL, U+2028, U+2029 문자를 `\uXXXX` 형식으로 바꾼다. 따라서 명세 key나 경로에 newline 또는 ANSI
escape가 있어도 오류 줄 구조와 terminal 상태를 바꾸지 못한다.

## 8. 종료 코드 계약

| 결과 | stdout | stderr | 종료 코드 |
|---|---|---|---:|
| `report.status === "passed"` | RunnerReport JSON | 없음 | 0 |
| `report.status === "failed"` | RunnerReport JSON | 없음 | 1 |
| `report.status === "aborted"` | RunnerReport JSON | 없음 | 1 |
| 사용법 또는 명세 입력 실패 | 없음 | 정규화된 오류 | 1 |
| MCP 연결 실패 | 없음 | Core code·message·hint 기반 오류 | 1 |
| Runner 시작 또는 finalization 실패 | 없음 | 정규화된 오류 | 1 |

첫 구현에는 종료 코드 2와 세분화된 운영체제 exit code를 도입하지 않는다. 모든 비성공은 1로
통일한다. 라이브러리 진입점 `run`은 이 숫자를 resolve하고 실행 파일만 `process.exitCode`에
대입한다.

## 9. 내부 구조와 테스트 경계

공개 surface는 기존 `COMMANDS`, `Command`, `run`을 유지한다. 테스트 가능성을 위해 CLI 패키지
내부 구현은 다음 책임으로 나눈다. 파일 이름은 구현 계획에서 확정하되 package root에서 내부
helper를 재수출하지 않는다.

```text
run(argv)
  ├─ 서브커맨드 디스패치
  └─ test command
       ├─ 순수 argv 파서
       ├─ JSON suite loader·validator
       ├─ Core·Runner orchestration
       └─ stdout·stderr formatter
```

단위 테스트는 파일 API, connection factory, Runner 함수, stdout, stderr를 주입할 수 있는
package-private 실행 경계를 사용한다. 실제 공개 `run(argv)`는 Node API와 실제 Core·Runner를 넣는
얇은 adapter다. 의존성 주입 타입과 helper는 `packages/cli/src` 내부에서만 사용하고 패키지 root
export에 추가하지 않는다.

실제 weather-server 검증은 두 층으로 나눈다.

1. Vitest 명령 계층 E2E는 TypeScript source의 `run()`을 호출하되 Core와 Runner는 대체하지 않는다.
   실제 `examples/weather-server/server.mjs` 프로세스를 시작하고 JSON 명세를 실행한다. 이 테스트는
   루트 `pnpm test`에 수집되어 Node.js 20, 22, 24 verify 대상이 된다.
2. 빌드 산출물 스모크는 `node packages/cli/dist/cli.mjs ...`를 별도 프로세스로 실행한다. stdout,
   stderr와 실제 process exit code를 검사하며 `pnpm build` 뒤에만 실행한다.

weather-server 프로세스 잔존 검사는 CLI 테스트 fixture의 얇은 Node wrapper를 사용한다. wrapper는
자기 PID를 테스트가 만든 임시 파일에 기록한 뒤 읽기 전용 weather-server 모듈을 import한다.
테스트는 CLI 완료 후 기록된 PID에 signal 0을 보내 process-not-found인지 확인한다. 임시 디렉터리와
PID 파일은 테스트별로 분리하고, 실제 프로세스 E2E는 직렬로 실행한다. wrapper는 weather-server의
protocol 또는 응답을 바꾸지 않는다.

## 10. 테스트 계약

구현 전에 아래 테스트를 먼저 작성하고 실패를 확인한다. 테스트 이름과 핵심 단언은 구현 완료
조건의 일부다.

### 10.1 argv와 디스패치

| 테스트 이름 | 입력 | 필수 단언 |
|---|---|---|
| `test 명세, command와 반복 arg를 입력 순서대로 파싱한다` | `test suite.json --command node --arg a --arg b` | suite=`suite.json`, command=`node`, args=`["a","b"]` |
| `equals 형식과 하이픈·빈 문자열 arg를 보존한다` | `--command=node --arg=-m --arg=` | command=`node`, args=`["-m",""]` |
| `명령, 명세와 command 누락을 사용법 오류로 거절한다` | 각각 빈 argv, `test`, `test suite.json` | 각 code=`CLI_USAGE`, connect 호출 0회, stdout 비어 있음, 종료 코드 1 |
| `중복 command, 알 수 없는 옵션과 추가 위치 인자를 거절한다` | 세 입력을 각각 실행 | 각 code=`CLI_USAGE`, connect 호출 0회, 종료 코드 1 |
| `아직 구현되지 않은 알려진 명령을 구분한다` | `generate` | code=`COMMAND_NOT_IMPLEMENTED`, 종료 코드 1 |

### 10.2 명세 로딩과 검증

| 테스트 이름 | fixture | 필수 단언 |
|---|---|---|
| `JSON이 아닌 확장자를 파일 실행 전에 거절한다` | `.ts`, `.js`, `.yaml` 경로 | code=`SUITE_FORMAT_UNSUPPORTED`, read·connect 각 0회 |
| `읽을 수 없는 명세 경로를 안정된 오류로 반환한다` | 존재하지 않는 `.json` | code=`SUITE_READ_FAILED`, native 오류·stack 미포함, connect 0회 |
| `잘못된 UTF-8과 JSON 문법을 서로 구분한다` | invalid bytes, malformed JSON | 각각 `SUITE_ENCODING_INVALID`, `SUITE_JSON_INVALID`, connect 0회 |
| `명세의 모든 validation issue를 순서대로 출력한다` | 여러 오류가 있는 JSON | issue code·path·message·hint 전문, connect 0회 |
| `validation issue의 제어 문자를 escape한다` | newline과 ESC가 든 알 수 없는 key | stderr 줄 추가와 ANSI escape 없음, `\u000a`와 `\u001b` 포함 |
| `검증된 suite만 Runner에 전달한다` | 유효한 JSON | validator의 valid value와 `runSuite.suite` deep equality |

### 10.3 실행·출력·종료

| 테스트 이름 | 준비 | 필수 단언 |
|---|---|---|
| `Core와 Runner를 승인된 순서와 동일 client로 조립한다` | fake connection과 report | connect→runSuite→finalize 순서, runSuite client와 shutdown client reference equality |
| `통과 report를 pretty JSON으로 한 번 출력하고 0을 반환한다` | status=`passed` | stdout=`JSON.stringify(report, null, 2)+newline`, stderr 비어 있음, code=0 |
| `실패와 중단 report를 출력하고 1을 반환한다` | status=`failed`, `aborted` | 두 경우 모두 report stdout, stderr 비어 있음, code=1 |
| `연결 실패에서 Core 오류 계약만 출력한다` | `McpClientError`와 이를 감싼 AggregateError | Core code·message·hint 포함, raw stderr·cause·stack·command args 미포함, code=1 |
| `execution 시작 전 실패하면 연결을 강제 종료한다` | `runSuite` 동기 throw | forceClose 1회, close 0회, stdout 비어 있음, code=1 |
| `finalization 실패를 report와 섞지 않는다` | finalizer reject | stdout 비어 있음, 오류 code=`RUNNER_FINALIZATION_FAILED`, 종료 코드 1 |
| `실행 파일은 process.exit 대신 process.exitCode를 설정한다` | 빌드 산출물 실행 | stdout 완전 수집, 실제 exit code가 run 결과와 일치 |

### 10.4 weather-server E2E

E2E 명세는 다음 세 케이스를 이 순서로 포함한다.

1. `listTools` 결과에 `get_weather`가 존재한다.
2. `get_weather({ city: "서울" })`는 `isError: false`다.
3. `get_weather({ city: "없는도시" })`는 `isError: true`다.

필수 단언은 다음과 같다.

- CLI 반환 또는 실제 process exit code는 0이다.
- stdout은 schemaVersion 1, suite id, case 3개, `passed: 3`, `failed: 0`인 RunnerReport다.
- stderr는 빈 문자열이다.
- case와 summary 순서는 명세와 Runner 계약을 따른다.
- wrapper가 기록한 PID는 CLI 완료 뒤 존재하지 않는다.
- 외부 network, 시간, 난수, API key를 사용하지 않는다.
- 테스트 완료와 실패 cleanup 모두 임시 자원과 남은 프로세스를 정리한다.

## 11. 결정론성, 보안과 실패 메시지

- argv는 왼쪽에서 오른쪽으로 한 번 파싱하며 object key 순회나 shell 해석에 의존하지 않는다.
- 명세 case 순서는 JSON 배열 순서와 Runner의 순차 실행 계약을 그대로 따른다.
- CLI가 추가하는 출력에는 timestamp, duration, PID, 임시 경로, 난수, 절대 경로를 넣지 않는다.
- 오류 출력은 CLI가 소유한 고정 문장과 Core·Runner의 구조화된 안정 필드만 사용한다.
- command와 args를 오류에 되풀이하지 않아 args에 들어 있을 수 있는 secret을 노출하지 않는다.
- raw server stderr는 기본 출력하지 않는다.
- Runner의 기존 redaction과 payload limit 기본값을 우회하지 않는다.
- JSON 명세를 import하거나 eval하지 않는다.
- 실제 MCP 프로세스는 shell 없이 Core의 stdio transport로 시작한다.

실패 메시지는 무엇이 실패했는지, 어느 단계인지, 사용자가 무엇을 확인할지를 포함한다. 운영체제와
Node.js가 만든 원문 오류를 그대로 출력하지 않으므로 같은 입력과 같은 구조화된 실패는 지원
런타임에서 같은 CLI 메시지를 만든다.

## 12. 문서와 배포

CLI README에는 다음 내용을 실제 구현과 일치하게 추가한다.

- `mcpeak test` 문법과 weather-server 예시
- JSON 명세만 지원한다는 범위
- 반복 `--arg`와 `--arg=<value>` 사용법
- stdout RunnerReport와 stderr 오류 분리
- 성공 0, 그 밖의 결과 1인 종료 코드
- shell 문법과 TypeScript 명세가 지원되지 않는다는 제한

공개 기능 추가이므로 `@mcpeak/cli` minor changeset을 한국어로 작성한다. Core와 Runner changeset은
추가하지 않는다. CLI 버전과 배포 산출물 외 다른 패키지 버전은 이 변경에서 직접 조정하지 않는다.

## 13. ADR 판단

별도 ADR은 작성하지 않는다.

- `cli → core`, `cli → runner` 의존 방향은 아키텍처와 Core 설계에서 이미 승인됐다.
- JSON 우선 지원, 단일 명세, 출력 형식은 첫 CLI 수직 기능의 국소적이고 되돌릴 수 있는 제품
  범위다.
- TypeScript loader나 지원 Node.js 버전을 바꾸지 않는다.

이후 TypeScript 명세를 위해 런타임 loader 의존성을 도입하거나 Node.js 20 지원을 중단하는 결정은
패키지와 배포 정책에 영향을 주므로 별도 ADR 대상으로 다시 판단한다.

## 14. 남은 한계와 후속 작업

- Ctrl+C를 받았을 때 별도 AbortSignal과 강제 종료 정책은 아직 없다.
- 여러 명세와 여러 서버를 한 명령에서 실행하지 않는다.
- 사람이 읽기 쉬운 terminal reporter와 JUnit reporter는 없다.
- command별 cwd와 환경변수 override를 제공하지 않는다.
- TypeScript 명세와 사용자 정의 모듈을 실행하지 않는다.
- 빌드 산출물 스모크는 이번 범위에서 추가하지만 CI workflow에는 연결하지 않는다. CI 연결은
  workflow 공유 영역을 승인받은 후 별도 작업으로 진행한다.

이 한계는 첫 수직 기능의 JSON 명세, 실제 stdio 연결, Runner report, 종료 코드와 프로세스 정리
계약을 약화하지 않는다.
