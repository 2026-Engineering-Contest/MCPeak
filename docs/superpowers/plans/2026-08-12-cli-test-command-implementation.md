# CLI test 명령 실제 실행 흐름 구현 계획

- 상태: 실행 승인 대기
- 작성일: 2026-08-12
- 설계 기준: [CLI test 명령 실제 실행 흐름 설계](../specs/2026-08-12-cli-test-command-design.md)
- 선행 구현:
  - `@ohmymcp/core`의 `connectStdio`
  - `@ohmymcp/runner`의 `runSuite`, `finalizeRunnerExecution`
- 구현 대상: `ohmymcp` CLI

## 1. 목표

`ohmymcp test`가 단일 JSON 테스트 명세와 stdio MCP 서버의 command 및 args를 받아 다음 수직
흐름을 실제로 수행하게 한다.

```text
CLI argv 검증
  → JSON 명세 읽기·UTF-8 decode·parse·validate
  → connectStdio
  → runSuite
  → finalizeRunnerExecution
  → RunnerReport stdout 출력
  → 종료 코드 0 또는 1 반환
```

weather-server 대상 실제 프로세스 테스트는 source `run()` 계층과 빌드된 `dist/cli.mjs` 계층에서
각각 실행한다. 두 경로 모두 report 내용, stdout과 stderr 분리, process exit code, 자식 PID 잔존
없음을 검증한다.

최종 통과 조건은 다음과 같다.

```text
pnpm exec vitest run packages/cli/tests
pnpm --filter ohmymcp typecheck
pnpm build
pnpm --filter ohmymcp test:e2e
pnpm exec biome check packages/cli
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm exec changeset status
```

표적 테스트 출력에는 `packages/cli/tests/index.test.ts`, `test-command.test.ts`,
`cli-integration.test.ts`가 실제로 수집되고 테스트 수가 0보다 크게 나타나야 한다. 빌드 산출물
스모크는 `packages/cli/dist/cli.mjs`를 별도 process로 실행해야 하며 source 파일을 직접 import하면
통과로 인정하지 않는다.

## 2. 비범위와 절대 제약

- TypeScript, JavaScript, YAML 명세 loader를 추가하지 않는다.
- 여러 명세, glob, watch, 병렬 실행을 추가하지 않는다.
- `--cwd`, `--env`, timeout, payload limit, reporter 옵션을 추가하지 않는다.
- Ctrl+C 또는 다른 OS signal 전용 동작을 추가하지 않는다.
- `generate`, `record`, `replay`, `mock` 명령을 구현하지 않는다.
- Core와 Runner source, test, README, package manifest를 수정하지 않는다.
- `packages/core/src/types.ts`의 `McpClient`와 `ToolResult`를 변경하지 않는다.
- `examples/weather-server/**`를 수정하지 않는다.
- 기존 `examples/runner-weather-smoke.mjs`와 `examples/README.md` 작업을 수정하거나 되돌리지 않는다.
- `@modelcontextprotocol/sdk` 버전을 변경하지 않는다.
- 신규 외부 dependency를 추가하지 않는다.
- root `package.json`, workspace와 build 설정, CI workflow를 수정하지 않는다.
- shell command 문자열, `shell: true`, `eval`, 동적 명세 module import를 사용하지 않는다.
- command, args, raw stderr, stack, 임의 cause를 기본 사용자 오류에 출력하지 않는다.
- timestamp, duration, PID, random value, 환경별 절대 경로를 CLI 출력에 넣지 않는다.
- 테스트를 production code보다 먼저 작성하고 의도한 RED를 확인한 뒤 GREEN으로 이동한다.
- 구현과 리뷰 agent는 background 실행, commit, merge, push, 하위 agent spawn을 하지 않는다.
- 다른 작업자의 변경을 되돌리지 않는다.

## 3. 확인된 현재 상태

구현 시작 시 다음 사실을 다시 확인한다.

- `packages/cli/src/index.ts`의 `run()`은 `not implemented`를 throw하는 스텁이다.
- `packages/cli/src/cli.ts`는 `process.exit()`를 호출한다.
- CLI manifest는 `@ohmymcp/runner`를 직접 의존하지만 `@ohmymcp/core`는 직접 의존하지 않는다.
- CLI에는 package test script와 E2E script가 없다.
- Core package root는 `connectStdio`, `McpClientError`, `McpStdioConnection`을 export한다.
- Runner package root는 `validateMcpSuite`, `runSuite`, `finalizeRunnerExecution`, `RunnerReport`와
  `SuiteValidationIssue`를 export한다.
- root Vitest 설정은 `packages/*/tests/**/*.test.ts`를 수집한다.
- CI verify는 Node.js 20, 22, 24에서 `pnpm test`를 실행한다.
- build는 Node.js 22에서 수행하며 `turbo`의 `^build`가 CLI의 workspace dependency dist를 먼저
  생성한다.

문서와 실제 export가 다르면 실제 package root export와 `packages/runner/src/spec/types.ts`를
진실로 삼는다. 동결 타입이 부족하면 임의 수정하지 않고 `BLOCKED`로 보고한다.

## 4. 실행 모델과 터미널 분할

구현·테스트는 `gpt-5.6-terra`, reasoning `medium`인 구현 agent 한 명이 수행한다. CLI는 공동
소유 package이고 source, tests, manifest, lockfile, README와 E2E가 하나의 공개 계약을 공유하므로
병렬 worktree로 나누지 않는다. 나누면 같은 `packages/cli` 파일과 lockfile 소유권이 겹치고 RED와
GREEN의 인과관계가 분리된다.

```text
Wave 1, Terminal 1, Task CLI-1
  tests·fixtures RED
    → source·manifest 구현 GREEN
    → weather-server source E2E
    → dist CLI E2E
    → README·changeset
    → package 및 전체 검증

Wave 2, 같은 worktree, 읽기 전용
  최종 reviewer
    → 메인 세션 diff·테스트 재검증
```

터미널은 하나, worktree는 하나, 구현 branch는 `feat/cli-test-command` 하나다. Task CLI-1 중간에
commit 또는 통합 대장을 요구하지 않는다. 후속 구현 Task가 없으므로 태스크 간 통합 SHA gate도
없다. 사용자가 요청하기 전에는 메인 세션도 commit, merge, push하지 않는다.

## 5. 파일 소유권

### 5.1 생성

- `packages/cli/src/test-command.ts`
- `packages/cli/tests/test-command.test.ts`
- `packages/cli/tests/cli-integration.test.ts`
- `packages/cli/tests/dist-cli-e2e.mjs`
- `packages/cli/tests/fixtures/weather-suite.json`
- `packages/cli/tests/fixtures/weather-suite-failing.json`
- `packages/cli/tests/fixtures/stdio-server-wrapper.mjs`
- `.changeset/cli-test-command.md`

### 5.2 수정

- `packages/cli/src/index.ts`
- `packages/cli/src/cli.ts`
- `packages/cli/tests/index.test.ts`
- `packages/cli/README.md`
- `packages/cli/package.json`
- `pnpm-lock.yaml`

### 5.3 수정 금지

- `packages/core/**`
- `packages/runner/**`
- `packages/generate/**`
- `packages/record/**`
- `packages/mock/**`
- `examples/**`
- `fixtures/**`
- root `package.json`
- `pnpm-workspace.yaml`
- `turbo.json`
- `tsconfig.base.json`
- `vitest.config.ts`
- `biome.json`
- `.github/**`
- 기존 changeset

실행 보고서는 gitignore된 `.agents/reports/task-cli-test-command.md`와
`.agents/reports/final-cli-test-command-review.md`에만 쓴다.

## 6. 공개 계약과 package-private 경계

### 6.1 공개 package root

기존 공개 이름과 signature를 유지한다.

```ts
export type Command = (argv: string[]) => Promise<number>;

export const COMMANDS = ["test", "generate", "record", "replay", "mock"] as const;

export function run(argv: string[]): Promise<number>;
```

`packages/cli/src/index.ts`는 실제 Node API, Core와 Runner 구현을 `test-command.ts`의 실행 경계에
주입하는 얇은 composition root다. `test-command.ts`의 타입과 helper는 `packages/cli/src/index.ts`에서
재수출하지 않는다.

### 6.2 내부 입력과 오류

`packages/cli/src/test-command.ts`는 다음 package-private 계약을 구현한다. 이름은 테스트가 직접
사용하므로 바꾸지 않는다.

```ts
import type { McpStdioConnection } from "@ohmymcp/core";
import type {
  FinalizeRunnerExecutionOptions,
  RunnerExecution,
  RunnerReport,
  RunSuiteOptions,
  SuiteValidationIssue,
  SuiteValidationResult,
} from "@ohmymcp/runner";

export interface TestCommandInput {
  readonly suitePath: string;
  readonly command: string;
  readonly args: readonly string[];
}

export type CliErrorCode =
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

export interface CliFailure {
  readonly code: CliErrorCode;
  readonly message: string;
  readonly hint: string;
  readonly coreCode?: string;
  readonly issues?: readonly SuiteValidationIssue[];
}

export interface TestCommandDependencies {
  readFile(path: string): Promise<Uint8Array>;
  validateSuite(input: unknown): SuiteValidationResult;
  connect(options: {
    command: string;
    args: readonly string[];
  }): Promise<McpStdioConnection>;
  startRunner(options: RunSuiteOptions): RunnerExecution;
  finalize(options: FinalizeRunnerExecutionOptions): Promise<RunnerReport>;
  writeStdout(text: string): void;
  writeStderr(text: string): void;
}

export function parseTestCommand(argv: readonly string[]): TestCommandInput;

export function runCli(
  argv: readonly string[],
  dependencies: TestCommandDependencies,
): Promise<number>;
```

`parseTestCommand`는 잘못된 입력에서 내부 `CliCommandError`를 throw할 수 있다. `runCli`는 모든
사용자 입력과 실행 실패를 `CliFailure`로 분류해 stderr에 쓰고 1을 resolve한다. 테스트 이외의
호출자가 `CliCommandError`를 소비하지 않으므로 class 자체는 export하지 않는다.

`TestCommandDependencies.readFile`은 Buffer를 포함한 `Uint8Array`를 반환한다. production adapter는
`node:fs/promises.readFile`, `validateMcpSuite`, `connectStdio`, `runSuite`,
`finalizeRunnerExecution`, `(text) => process.stdout.write(text)`,
`(text) => process.stderr.write(text)`를 사용한다.

## 7. argv 파싱 계약

고정 usage 문자열은 다음 한 줄이다.

```text
사용법: ohmymcp test <suite.json> --command <executable> [--arg <value> ...]
```

`runCli`는 첫 토큰을 디스패치하고 `test` 뒤의 토큰만 `parseTestCommand`에 넘긴다.

### 7.1 허용 입력

```text
test suite.json --command node
test suite.json --command node --arg server.mjs --arg value
test suite.json --command=node --arg=-m --arg=
```

- suite 경로는 `test` 바로 뒤의 비어 있지 않은 문자열 하나다.
- `--command value`와 `--command=value`를 허용한다.
- `--command`는 정확히 한 번이며 값은 비어 있지 않아야 한다.
- `--arg value`와 `--arg=value`를 허용한다.
- `--arg`는 반복 가능하고 빈 문자열 값도 허용한다.
- args는 왼쪽에서 오른쪽 입력 순서를 보존한 새 배열이다.
- 반환한 `args` 배열과 `TestCommandInput`은 `Object.freeze`한다.

### 7.2 거절 입력과 고정 문장

모든 사용법 오류의 hint는 고정 usage 문자열이다.

| 조건 | message |
|---|---|
| argv가 비어 있음 | `실행할 CLI 명령이 없습니다.` |
| 첫 토큰이 알려지지 않음 | `알 수 없는 CLI 명령 '<escaped>'입니다.` |
| 알려졌지만 미구현 명령 | `'<escaped>' 명령은 아직 구현되지 않았습니다.` |
| `test` 뒤 suite 누락 또는 빈 문자열 | `테스트 명세 JSON 경로가 필요합니다.` |
| `--command` 누락 | `` `--command` 옵션이 필요합니다. `` |
| `--command` 중복 | `` `--command`는 한 번만 사용할 수 있습니다. `` |
| `--command` 값 누락 또는 빈 문자열 | `` `--command` 옵션 값이 필요합니다. `` |
| `--arg` 값 누락 | `` `--arg` 옵션 값이 필요합니다. `` |
| 알 수 없는 option | `지원하지 않는 test 옵션 '<escaped>'입니다.` |
| 추가 위치 인자 | `추가 위치 인자 '<escaped>'는 허용되지 않습니다.` |

알려졌지만 미구현인 명령의 code는 `COMMAND_NOT_IMPLEMENTED`이고 hint는
`현재는 test 명령만 사용할 수 있습니다.`로 고정한다. 나머지 표의 조건은 `CLI_USAGE`다.

`--`, 축약 option, `--command = node`, `--arg = value`는 허용하지 않는다. `--command` 또는
`--arg` 다음 토큰이 다른 인식 가능한 option이면 값 누락으로 처리한다. 하이픈으로 시작하는 실제
서버 arg는 `--arg=-m` 형식으로만 전달한다.

## 8. 명세 로딩과 오류 정규화

### 8.1 단계 순서

`runCli`는 server process를 만들기 전에 다음 순서를 지킨다.

```text
extname(suitePath).toLowerCase() === ".json"
  → readFile(suitePath)
  → new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  → JSON.parse(text)
  → validateSuite(value)
  → connect({ command, args })
```

`.json`이 아니면 `readFile`도 호출하지 않는다. read, decode, parse, validate 실패에서는 `connect`를
호출하지 않는다. 입력 suite 객체는 validation과 Runner 사이에서 수정하지 않는다.

### 8.2 고정 오류 dictionary

| code | message | hint |
|---|---|---|
| `SUITE_FORMAT_UNSUPPORTED` | `테스트 명세 형식을 지원하지 않습니다.` | `UTF-8로 저장한 .json 명세 파일을 사용하세요.` |
| `SUITE_READ_FAILED` | `테스트 명세 파일을 읽지 못했습니다.` | `명세 경로와 읽기 권한을 확인하세요.` |
| `SUITE_ENCODING_INVALID` | `테스트 명세 파일이 유효한 UTF-8이 아닙니다.` | `명세를 UTF-8 JSON으로 다시 저장하세요.` |
| `SUITE_JSON_INVALID` | `테스트 명세의 JSON 문법이 유효하지 않습니다.` | `JSON 문법과 쉼표, 따옴표를 확인하세요.` |
| `SUITE_VALIDATION_FAILED` | `MCP 테스트 명세가 유효하지 않습니다.` | `아래 명세 오류를 모두 수정하세요.` |
| `MCP_CONNECTION_FAILED` | `MCP 서버 연결에 실패했습니다.` | `command 실행 가능 여부와 stdio MCP 서버 설정을 확인하세요.` |
| `RUNNER_EXECUTION_FAILED` | `Runner 실행을 시작하지 못했습니다.` | `테스트 명세와 Runner 설정을 확인하세요.` |
| `RUNNER_FINALIZATION_FAILED` | `Runner 실행 또는 MCP 서버 종료에 실패했습니다.` | `서버 응답과 종료 상태를 확인하세요.` |
| `CLI_INTERNAL_ERROR` | `예상하지 못한 CLI 내부 오류가 발생했습니다.` | `다시 실행한 뒤 재현 정보와 함께 이슈를 보고하세요.` |

사용법 오류 code는 `CLI_USAGE`, 알려진 미구현 명령은 `COMMAND_NOT_IMPLEMENTED`다.

### 8.3 오류 출력 formatter

일반 오류는 정확히 다음 형식이다.

```text
오류 [<code>]: <message>
해결: <hint>
```

Core 오류가 있으면 다음 형식이다.

```text
오류 [MCP_CONNECTION_FAILED/<core.code>]: <core.message>
해결: <core.hint>
```

명세 검증 실패는 일반 두 줄 뒤에 validator가 반환한 모든 issue를 순서대로 붙인다.

```text
- [<issue.code>] <issue.path>: <issue.message>
  해결: <issue.hint>
```

전체 stderr 끝에는 newline 하나만 둔다. `escapeTerminalText`는 입력 문자열의 U+0000부터 U+001F,
U+007F, U+2028, U+2029를 소문자 4자리 `\uXXXX`로 바꾼다. 고정 문장도 같은 formatter를 통과시켜
출력 경계가 한 곳만 존재하게 한다. ANSI ESC, CR, LF와 tab이 사용자 입력 또는 validator issue에
있어도 실제 control character로 출력하지 않는다.

연결 실패에서 `McpClientError`를 찾을 때는 원본 오류를 먼저 보고, `AggregateError.errors`를 배열
순서대로 깊이 우선 탐색한다. object identity `Set`으로 순환을 끊는다. 첫 `McpClientError`만 Core
오류로 사용하며 diagnostics.stderr, cause, stack, command와 args는 읽어 formatter에 전달하지
않는다. `McpClientError`가 없으면 dictionary의 일반 연결 실패를 사용한다.

## 9. Core, Runner와 종료 조립

유효한 suite 뒤에 다음 순서를 유지한다.

```ts
const connection = await dependencies.connect({ command, args });

const shutdown = {
  client: connection.client,
  close: () => connection.close(),
  forceClose: () => connection.forceClose(),
};

const execution = dependencies.startRunner({
  client: connection.client,
  suite,
});

const report = await dependencies.finalize({ execution, shutdown });
```

- `startRunner`에는 `onEvent`, redaction, payload limit, signal, timeout option을 넣지 않는다.
- shutdown client는 startRunner client와 reference-equal이어야 한다.
- shutdown controller 객체는 한 번 만들고 finalizer 호출까지 교체하지 않는다.
- shutdown `forceClose`는 Runner reason을 인자로 받더라도 Core `connection.forceClose()`에는 인자를
  전달하지 않는다.
- connection 성공 뒤 `startRunner`가 동기 throw하면 `connection.forceClose()`를 정확히 한 번
  await하고 `RUNNER_EXECUTION_FAILED`를 출력한다.
- 위 cleanup도 실패하면 사용자 출력은 primary 단계인 `RUNNER_EXECUTION_FAILED`를 유지하고 raw
  cleanup 오류는 출력하지 않는다.
- execution 생성 뒤에는 finalizer가 report, drain, graceful close와 force close를 소유한다.
- finalizer reject 뒤 CLI가 `close` 또는 `forceClose`를 다시 호출하지 않는다.
- finalizer 성공 뒤에만 report를 serialize하고 stdout에 쓴다.

report 출력은 정확히 다음과 같다.

```ts
dependencies.writeStdout(`${JSON.stringify(report, null, 2)}\n`);
```

report status가 `passed`면 0, `failed` 또는 `aborted`면 1을 반환한다. 세 상태 모두 stderr는 비고
stdout에는 report 한 개만 있다. report를 얻지 못한 오류 경로는 stdout을 쓰지 않는다.

## 10. fixture 계약

### 10.1 성공 weather suite

`packages/cli/tests/fixtures/weather-suite.json` 내용은 다음과 같다.

```json
{
  "schemaVersion": 1,
  "id": "weather-server-cli",
  "name": "weather-server CLI E2E",
  "defaultTimeoutMs": 10000,
  "cases": [
    {
      "id": "weather-tool-exists",
      "name": "get_weather 도구를 제공한다",
      "operation": { "type": "listTools" },
      "assertions": [{ "type": "toolExists", "tool": "get_weather" }]
    },
    {
      "id": "seoul-weather-succeeds",
      "name": "서울 날씨를 정상 조회한다",
      "operation": {
        "type": "callTool",
        "tool": "get_weather",
        "input": { "city": "서울" }
      },
      "assertions": [{ "type": "isError", "expected": false }]
    },
    {
      "id": "unsupported-city-is-tool-error",
      "name": "미지원 도시는 도구 오류를 반환한다",
      "operation": {
        "type": "callTool",
        "tool": "get_weather",
        "input": { "city": "없는도시" }
      },
      "assertions": [{ "type": "isError", "expected": true }]
    }
  ]
}
```

### 10.2 실패 weather suite

`packages/cli/tests/fixtures/weather-suite-failing.json`은 실제 assertion 실패와 종료 코드 1을
검증한다.

```json
{
  "schemaVersion": 1,
  "id": "weather-server-cli-failing",
  "name": "weather-server CLI 실패 E2E",
  "cases": [
    {
      "id": "missing-tool",
      "name": "존재하지 않는 도구를 요구한다",
      "operation": { "type": "listTools" },
      "assertions": [{ "type": "toolExists", "tool": "missing_weather_tool" }]
    }
  ]
}
```

### 10.3 PID wrapper

`packages/cli/tests/fixtures/stdio-server-wrapper.mjs`는 command args로 받은 PID 파일과 target module
경로만 사용한다.

```js
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const [pidFile, targetModule] = process.argv.slice(2);

if (pidFile === undefined || targetModule === undefined) {
  throw new Error("pid file과 target module 경로가 필요합니다.");
}

await writeFile(pidFile, String(process.pid), "utf8");
await import(pathToFileURL(targetModule).href);
```

wrapper는 protocol handler를 만들지 않고 읽기 전용 weather-server module을 import한다. 테스트는
PID 파일과 target module에 절대 경로를 전달하지만 CLI stdout과 stderr에는 그 경로를 출력하지
않는다.

## 11. 테스트 우선 구현 순서

### 11.1 RED 1, argv·명세·조립 계약

먼저 `packages/cli/tests/index.test.ts`를 스텁 기대에서 실제 디스패치 기대 구조로 바꾸고
`test-command.test.ts`를 생성한다. production source를 고치기 전에 다음 명령을 실행한다.

```bash
pnpm exec vitest run packages/cli/tests/index.test.ts packages/cli/tests/test-command.test.ts
```

기대 RED는 `test-command.ts` 없음, `run()` 스텁, 또는 실제 계약 미구현 때문이다. 테스트 파일이
수집되지 않거나 의존성·dist 누락으로 runner 자체가 시작되지 않은 실패는 유효한 RED가 아니다.

테스트 이름과 필수 단언은 다음과 같다.

#### argv와 디스패치

1. `test 명세, command와 반복 arg를 입력 순서대로 파싱한다`
   - `parseTestCommand(["suite.json", "--command", "node", "--arg", "a", "--arg", "b"])`
   - frozen input, frozen args, suitePath, command, `args === ["a", "b"]`
2. `equals 형식과 하이픈·빈 문자열 arg를 보존한다`
   - `--command=node --arg=-m --arg=`
   - command `node`, args `[-m, ""]`
3. `명령, 명세와 command 누락을 사용법 오류로 거절한다`
   - 빈 argv, `["test"]`, `["test", "suite.json"]`
   - 각 종료 코드 1, stderr의 정확한 message와 usage, stdout 빈 문자열, connect 0회
4. `중복 command, 값 없는 option, 알 수 없는 option과 추가 위치 인자를 거절한다`
   - 각 입력을 독립 실행
   - `CLI_USAGE`, 정확한 고정 문장, read와 connect 0회
5. `아직 구현되지 않은 알려진 명령을 구분한다`
   - `["generate"]`
   - `COMMAND_NOT_IMPLEMENTED`, 종료 코드 1, read와 connect 0회
6. `알 수 없는 명령의 제어 문자를 escape한다`
   - 명령에 newline과 ESC 포함
   - stderr에 실제 newline 추가와 ESC 없음, `\u000a`, `\u001b` 포함

#### 명세 로딩

7. `JSON이 아닌 확장자를 파일 읽기 전에 거절한다`
   - `.ts`, `.js`, `.yaml`을 table test
   - 각 `SUITE_FORMAT_UNSUPPORTED`, read·validate·connect 0회
8. `대문자 JSON 확장자와 상대 경로를 그대로 읽는다`
   - `SUITE.JSON`과 상대 경로 입력
   - readFile이 사용자 경로 문자열 그대로 1회 받고 valid suite 실행
9. `읽을 수 없는 명세 경로를 안정된 오류로 반환한다`
   - readFile이 secret sentinel을 포함한 native error reject
   - `SUITE_READ_FAILED`, stack·sentinel·절대 경로 없음, connect 0회
10. `잘못된 UTF-8과 JSON 문법을 서로 구분한다`
   - bytes `[0xc3, 0x28]`, malformed JSON
   - 각각 `SUITE_ENCODING_INVALID`, `SUITE_JSON_INVALID`, connect 0회
11. `명세의 모든 validation issue를 순서대로 출력한다`
    - validator가 두 issue 반환
    - 두 code, path, message, hint의 입력 순서와 고정 header 전문
12. `validation issue의 제어 문자를 escape한다`
    - issue path와 message에 LF, CR, tab, ESC, U+2028 포함
    - formatter가 만든 구조적 newline 외 입력 유래 control 없음, 각 `\uXXXX` 포함
13. `검증된 suite만 connection과 Runner에 전달한다`
    - valid result의 suite reference가 startRunner suite와 동일
    - validate 전에 connect 0회, 전체 호출 순서 read→validate→connect→start→finalize

#### 실행·출력·종료

14. `Core와 Runner를 승인된 순서와 동일 client로 조립한다`
    - connect options가 `{ command: "node", args: ["server.mjs"] }`
    - startRunner client와 shutdown client가 connection.client와 reference-equal
    - shutdown close와 forceClose가 각 connection method에 위임
15. `통과 report를 pretty JSON으로 한 번 출력하고 0을 반환한다`
    - stdout 정확히 `JSON.stringify(report, null, 2) + "\n"`, stderr 0회
16. `실패와 중단 report를 출력하고 1을 반환한다`
    - `failed`, `aborted` 각각 같은 JSON 규칙, stderr 0회, code 1
17. `연결 실패에서 Core 오류 계약만 출력한다`
    - direct `McpClientError`, 이를 감싼 nested AggregateError, 순환 AggregateError
    - 첫 Core code·message·hint 포함, diagnostics stderr·cause sentinel·stack·args 미포함
18. `Core 오류 없는 연결 실패는 일반 연결 오류로 정규화한다`
    - arbitrary throw와 reject `undefined`
    - dictionary 전문, stdout 빈 문자열, code 1
19. `Runner 시작 전 실패하면 연결을 강제 종료한다`
    - startRunner sync throw
    - forceClose 1회 await, close 0회, finalize 0회, `RUNNER_EXECUTION_FAILED`
20. `Runner 시작 cleanup 실패가 primary 오류를 덮지 않는다`
    - startRunner와 forceClose가 각각 secret sentinel로 실패
    - 출력은 `RUNNER_EXECUTION_FAILED` dictionary만 포함
21. `finalization 실패를 report와 섞지 않는다`
    - finalize reject
    - stdout 0회, `RUNNER_FINALIZATION_FAILED`, connection close·forceClose 추가 호출 0회
22. `예상하지 못한 내부 오류를 stack 없이 정규화한다`
    - output 전 분류되지 않은 dependency failure
    - `CLI_INTERNAL_ERROR`, stack과 sentinel 없음

fake report는 실제 `RunnerReport` 타입의 최소 완전 객체를 사용하며 `as unknown as`로 shape 오류를
숨기지 않는다. fake connection은 실제 `McpClient` method를 모두 제공한다.

### 11.2 RED 2, 실제 weather-server와 dist 진입점

production source를 고치기 전에 weather suite 두 개, PID wrapper,
`cli-integration.test.ts`, `dist-cli-e2e.mjs`와 package `test:e2e` script를 작성한다.

```bash
pnpm exec vitest run packages/cli/tests/cli-integration.test.ts
pnpm --filter ohmymcp build
pnpm --filter ohmymcp test:e2e
```

source integration은 `run()` 스텁 때문에 실패해야 한다. dist E2E는 빌드된 stub CLI의 예외 또는
출력·exit code 불일치 때문에 실패해야 한다. weather-server가 실행되지 않았거나 test가 0개
수집된 상태는 유효한 RED가 아니다.

`cli-integration.test.ts`는 `describe.sequential`로 다음을 검증한다.

1. `weather-server JSON 명세를 실제 Core와 Runner로 실행하고 프로세스를 종료한다`
   - `run(["test", suite, "--command", process.execPath, "--arg", wrapper, "--arg", pidFile,
     "--arg", weatherServer])`
   - stdout spy가 받은 JSON의 status `passed`, case 3개, summary `{ total: 3, passed: 3,
     failed: 0, timedOut: 0, cancelled: 0, notRun: 0 }`
   - stderr spy 0회, 반환 코드 0
   - 기록된 PID가 최대 1초 안에 `ESRCH`
2. `assertion 실패 report를 stdout에 출력하고 1을 반환한다`
   - failing suite를 실제 weather-server에 실행
   - parsed report status `failed`, summary failed 1, stderr 0회, 반환 코드 1
   - 기록된 PID가 최대 1초 안에 `ESRCH`
3. `실행할 수 없는 command의 Core 오류를 stderr에 출력하고 1을 반환한다`
   - valid suite와 `ohmymcp-command-that-does-not-exist` command를 사용
   - stdout 0회, stderr header `MCP_CONNECTION_FAILED/PROCESS_START_FAILED`, 반환 코드 1
   - native error, stack, 입력 command 값이 stderr에 없음

각 테스트는 `mkdtemp`로 별도 directory와 PID file을 만든다. `finally`에서 PID가 남아 있으면 해당
PID만 `SIGKILL`하고 directory를 지운다. 다른 process나 broad path를 종료하지 않는다. 테스트는
외부 network, 사용자 설정, API key를 사용하지 않는다.

`dist-cli-e2e.mjs`는 Node 내장 `child_process.spawn`, `fs/promises`, `os`, `path`, `url`,
`assert/strict`만 사용한다. 빌드된 `dist/cli.mjs`를 두 번 별도 process로 실행해 다음을 검사한다.

1. 성공 suite의 exit code 0, signal null, stderr 빈 문자열, stdout report status `passed`, passed 3,
   PID 잔존 없음
2. 실패 suite의 exit code 1, signal null, stderr 빈 문자열, stdout report status `failed`, failed 1,
   PID 잔존 없음

각 child spawn은 `{ stdio: ["ignore", "pipe", "pipe"] }`이고 shell option을 쓰지 않는다. stdout과
stderr는 Buffer chunk 순서대로 합친다. child `error`와 `close`를 모두 처리하고 close 전 error가
발생하면 중복 settle하지 않는다.

### 11.3 GREEN, production 구현

RED 증거를 기록한 뒤에만 다음을 구현한다.

1. `test-command.ts`에 §6부터 §9의 parser, loader, formatter, error normalization과 orchestration을
   구현한다.
2. `index.ts`에서 production dependency를 만들고 `run(argv)`가 `runCli`를 반환하게 한다.
3. `cli.ts`를 다음 형태로 바꾼다.

```ts
#!/usr/bin/env node
import { run } from "./index.js";

void run(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
```

ESM과 CJS entry를 같은 source에서 빌드하므로 top-level await를 사용하지 않는다. `runCli`가 사용자
입력과 실행 실패를 1로 resolve하므로 진입점에 별도 오류 formatter도 두지 않는다. `process.exit()`는
어떤 경로에서도 사용하지 않는다.

4. `packages/cli/package.json` dependencies에 `"@ohmymcp/core": "workspace:*"`를 추가한다.
5. scripts에 `"test:e2e": "node ./tests/dist-cli-e2e.mjs"`를 추가한다.
6. 외부 dependency 추가 없이 `pnpm install --lockfile-only`로 CLI importer의 lockfile을 갱신한다.
7. focused unit, source E2E, package typecheck, build, dist E2E를 순서대로 GREEN으로 만든다.

## 12. 문서와 changeset

### 12.1 CLI README

`packages/cli/README.md`의 스텁 상태 문구를 실제 기능으로 바꾸고 다음 내용을 포함한다.

- JSON suite 예시 또는 `packages/cli/tests/fixtures/weather-suite.json` 링크
- `ohmymcp test <suite.json> --command <executable> [--arg <value> ...]`
- Node server에서 command와 arg를 합치면 `node ./server.mjs`가 된다는 설명
- `--arg` 반복과 `--arg=-m`, `--arg=` 설명
- CLI가 stdio MCP server를 직접 시작하고 종료한다는 설명
- stdout에는 RunnerReport JSON, stderr에는 CLI 오류만 출력한다는 설명
- passed 0, failed·aborted·입력·연결·종료 실패 1인 종료 코드
- JSON only, single suite, stdio only, no shell, TypeScript module 미지원 제한
- `generate`, `record`, `replay`, `mock`은 아직 미구현이라는 현재 상태

문서 예시는 실제 CLI 문법과 fixture path로 표적 E2E에서 실행 가능한 값만 사용한다.

### 12.2 changeset

`.changeset/cli-test-command.md`를 다음 내용으로 작성한다.

```md
---
"ohmymcp": minor
---

JSON 테스트 명세와 stdio MCP 서버 실행 정보를 받아 실제 RunnerReport와 종료 코드를 만드는 test 명령을 추가한다.
```

Core와 Runner changeset을 추가하거나 기존 changeset을 수정하지 않는다.

## 13. Task CLI-1 실행 명세

### 역할과 모델

- 역할: CLI test 명령 구현과 테스트 담당자
- 모델: `gpt-5.6-terra`
- reasoning: `medium`
- 상위 모델 승급 없음: Core process lifecycle과 Runner finalizer는 선행 구현을 그대로 조립하며,
  이번 Task에는 해소되지 않은 불변식 충돌이 없다.

### 선행 조건

- 승인된 설계와 이 구현 계획이 현재 HEAD에 포함돼 있다.
- worktree가 깨끗하고 기존 examples 작업이 구현 worktree에 섞이지 않는다.

### 산출물

- §5.1의 생성 파일 전체
- §5.2의 수정 파일 전체
- `.agents/reports/task-cli-test-command.md`

### RED gate

```text
pnpm exec vitest run packages/cli/tests/index.test.ts packages/cli/tests/test-command.test.ts
→ 테스트가 실제 수집되고 미구현 계약 때문에 실패

pnpm exec vitest run packages/cli/tests/cli-integration.test.ts
→ 실제 weather-server 경로를 확인한 뒤 run stub 때문에 실패

pnpm --filter ohmymcp build && pnpm --filter ohmymcp test:e2e
→ dist CLI가 실행되지만 report 또는 exit 계약 불일치로 실패
```

### GREEN gate

```text
pnpm exec vitest run packages/cli/tests/index.test.ts packages/cli/tests/test-command.test.ts
pnpm exec vitest run packages/cli/tests/cli-integration.test.ts
pnpm exec vitest run packages/cli/tests
pnpm --filter ohmymcp typecheck
pnpm build
pnpm --filter ohmymcp test:e2e
pnpm exec biome check packages/cli
```

각 명령에서 실제 테스트 파일과 수집 수, weather-server 대상 경로, dist CLI path, 성공·실패
exit code, PID 잔존 검사 결과를 report에 기록한다.

### 실패 시 경계

- Core 또는 Runner 공개 API가 설계와 다르면 해당 package를 수정하지 않고 `BLOCKED`다.
- 신규 dependency가 필요하면 추가하지 않고 용도와 license를 보고해 승인을 요청한다.
- root config 또는 CI workflow 변경 없이는 요구 검증을 수집할 수 없으면 공유 영역을 수정하지 않고
  `BLOCKED`다.
- weather-server 수정이 필요해 보이면 수정하지 않고 실패 재현과 영향 범위를 보고한다.
- 현재 worktree에 허용 파일 밖 변경이 생기면 다른 작업자의 변경인지 확인하고 되돌리지 않은 채
  `BLOCKED`다.

## 14. 메인 세션 리뷰와 최종 검증

구현 agent가 `READY_FOR_REVIEW`를 반환해도 완료로 간주하지 않는다. 메인 세션은 다음을 직접
확인한다.

1. report 경로가 존재하고 pwd, HEAD, RED, GREEN, 수집 수, PID 검사, 남은 위험이 기록됐는지
   확인한다.
2. Task 시작 SHA를 기준으로 `git diff --name-only`, `git diff --stat`, `git diff --check`를 실행해
   §5 허용 파일만 변경됐는지 확인한다.
3. `packages/core/src/types.ts`, SDK version, existing changeset, examples, root config가 변경되지
   않았는지 확인한다.
4. parser가 shell을 사용하지 않고 args 순서를 보존하는지 읽는다.
5. validation 전 connect가 불가능한 호출 순서인지 읽는다.
6. connection 성공 뒤 startRunner 실패의 force cleanup과 execution 뒤 finalizer 단독 소유권을
   확인한다.
7. report path에서는 stderr가 비고 오류 path에서는 stdout이 비는지 테스트와 코드를 대조한다.
8. raw stderr, cause, stack, command args가 오류 formatter로 유입되지 않는지 확인한다.
9. source E2E와 dist E2E가 실제 weather-server와 PID wrapper를 사용했는지 확인한다.
10. README, changeset, package manifest와 실제 동작이 일치하는지 확인한다.

지적이 있으면 같은 구현 agent에게 `followup_task`로 보내고 report와 focused 검증을 갱신시킨다.
허용 파일과 표적 검증이 통과하면 별도 읽기 전용 reviewer를 실행한다.

reviewer 통과 뒤 메인 세션이 다음 전체 검증을 직접 실행한다.

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter ohmymcp test:e2e
pnpm exec changeset status
```

`pnpm test` 출력에서 CLI 테스트 파일과 수집 수를 확인한다. `pnpm build` 뒤 dist E2E를 다시 실행해
오래된 산출물이나 cache가 결과를 가리지 않게 한다. 사용자가 요청하지 않았으므로 commit, merge,
push는 하지 않는다.

## 15. 사용자 사전 조건과 worktree 실행 프롬프트

사용자가 실행 전에 확인할 사전 조건은 다음 두 줄이다.

```bash
git log --oneline -1
git status --short
```

첫 명령의 HEAD에는 승인된 설계와 이 구현 계획이 포함돼 있어야 한다. 두 번째 명령 출력은 비어
있어야 한다. 현재 root의 `examples/README.md`와 `examples/runner-weather-smoke.mjs` 작업을 먼저
사용자 방식으로 보존하거나 별도 worktree와 섞이지 않게 정리하기 전에는 아래 프롬프트를 실행하지
않는다.

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```text
OhMyMCP CLI test 명령 실제 실행 흐름 구현 계획을 오케스트레이션해라.

[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

현재 checkout에서 다음 값을 기록해라.

  repo_root="$(git rev-parse --show-toplevel)"
  base_commit="$(git rev-parse HEAD)"
  git_dir="$(git rev-parse --path-format=absolute --git-dir)"
  git_common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
  current_branch="$(git branch --show-current)"

`git status --short`가 비어 있지 않거나 다음 문서가 base_commit에 없으면 BLOCKED로 끝내라.

  docs/superpowers/specs/2026-08-12-cli-test-command-design.md
  docs/superpowers/plans/2026-08-12-cli-test-command-implementation.md

git_dir와 git_common_dir가 다르면 현재 checkout이 이미 연결 worktree다. 이때 current_branch가
정확히 `feat/cli-test-command`가 아니면 worktree나 파일을 변경하지 말고 BLOCKED로 끝내라.
branch가 일치할 때만 중첩 worktree를 만들지 말고 repo_root를 cli_worktree로 사용해라. git_dir와
git_common_dir가 같으면 다음 값을 계산해라.

  worktree_parent="$(dirname "$repo_root")/OhMyMCP-worktrees"
  cli_worktree="$worktree_parent/cli-test-command"
  cli_branch="feat/cli-test-command"

worktree_parent만 `mkdir -p`로 만들 수 있다. cli_worktree 경로나 cli_branch가 이미 존재하면
삭제하거나 재사용하지 말고 BLOCKED로 끝내라. 다음 명령으로 base_commit에서 worktree를 만들어라.

  git worktree add -b "$cli_branch" "$cli_worktree" "$base_commit"

새 worktree를 만든 경우 gitignore 대상인 로컬 지침을 원본 작업공간에서 복사해라.

  cp "$repo_root/AGENTS.md" "$cli_worktree/AGENTS.md"
  cp -R "$repo_root/.agents" "$cli_worktree/.agents"
  mkdir -p "$cli_worktree/docs"
  cp -R "$repo_root/docs/conventions" "$cli_worktree/docs/conventions"

현재 checkout이 이미 연결 worktree라면 복사하지 말고 그 위치의 AGENTS.md, `.agents/`,
`docs/conventions/`가 존재하는지만 확인해라.

cli_worktree로 이동한 뒤 다음을 확인해라.

  pwd
  git rev-parse HEAD
  git rev-parse --git-dir
  git rev-parse --git-common-dir
  git branch --show-current
  git status --short

pwd가 기록한 cli_worktree와 다르거나 HEAD가 base_commit과 다르거나 승인 문서, AGENTS.md,
`.agents/skills/execution-conventions/SKILL.md`, `docs/conventions/plan.md`,
`docs/conventions/execution.md`가 없거나 status가 깨끗하지 않으면 구현을 시작하지 말고 BLOCKED로
끝내라.

다음으로 bootstrap하고 도구가 실제 실행되는지 확인해라.

  pnpm install --frozen-lockfile
  pnpm exec vitest run packages/cli/tests/index.test.ts
  pnpm --filter ohmymcp typecheck
  pnpm --filter @ohmymcp/core build
  pnpm --filter @ohmymcp/runner build
  pnpm --filter ohmymcp build

의존성 설치, 기존 CLI 테스트 수집, typecheck와 선행 dist build 중 하나라도 실패하면 agent를
spawn하지 말고 BLOCKED로 끝내라. 출력에 실제 CLI test와 Core, Runner, CLI package가 나타나는지
확인해라.

[2단계: 실행]

AGENTS.md, plan-conventions, execution-conventions, `docs/conventions/plan.md`,
`docs/conventions/execution.md`, CLI 설계와 이 구현 계획을 끝까지 읽어라.

Task CLI-1 구현 agent 한 명만 spawn한다. 동시에 다른 agent를 실행하지 않는다. 실제 cli_worktree
절대 경로, 절대 report 경로, 허용 Files, 금지 Files, RED와 GREEN 명령, 완료 형식을 message 안에
전부 넣어라. 표나 이전 message를 참조하게 하지 마라.

agent는 background 실행, commit, merge, push, 하위 agent spawn을 하지 않으며 다른 작업자의
변경을 되돌리지 않는다. 최종 응답은 다음 형식이다.

  status: READY_FOR_REVIEW 또는 status: BLOCKED
  변경 파일
  RED 명령과 실패 이유
  GREEN 명령과 결과 및 수집 수
  report 경로
  남은 위험

READY_FOR_REVIEW 뒤에는 메인 세션이 report, 허용 파일 diff와 focused 테스트를 직접 확인한다.
지적은 같은 agent에게 followup_task로 보내고 수정 루프를 반복한다.

focused gate가 통과하면 읽기 전용 final reviewer를 spawn한다. reviewer report와 메인 세션의 전체
test, typecheck, lint, build, dist E2E, changeset status가 모두 통과하기 전에는 완료로 보고하지
않는다. 사용자가 요청하지 않았으므로 commit, merge, push는 하지 않는다.
```

## 16. 네이티브 agent 호출

오케스트레이터는 `cliWorktree`를 §15에서 기록한 실제 절대 경로로 치환한다. 아래 호출 문자열에
`${cliWorktree}` literal을 남기지 않는다.

### Task CLI-1 구현

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "cli_test_command",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: [
    "역할: OhMyMCP CLI test 명령 구현과 테스트 담당자.",
    "Worktree: ${cliWorktree}",
    "Report: ${cliWorktree}/.agents/reports/task-cli-test-command.md",
    "첫 명령으로 git rev-parse --show-toplevel, git rev-parse HEAD, git status --short를 실행해 Worktree와 깨끗한 기점을 확인한다. AGENTS.md, .agents/skills/execution-conventions/SKILL.md, docs/conventions/execution.md, CLI 설계와 구현 계획을 끝까지 읽는다. 하나라도 없거나 경로가 다르면 BLOCKED다.",
    "허용 Files: packages/cli/src/test-command.ts, packages/cli/src/index.ts, packages/cli/src/cli.ts, packages/cli/tests/index.test.ts, packages/cli/tests/test-command.test.ts, packages/cli/tests/cli-integration.test.ts, packages/cli/tests/dist-cli-e2e.mjs, packages/cli/tests/fixtures/weather-suite.json, packages/cli/tests/fixtures/weather-suite-failing.json, packages/cli/tests/fixtures/stdio-server-wrapper.mjs, packages/cli/README.md, packages/cli/package.json, pnpm-lock.yaml, .changeset/cli-test-command.md, .agents/reports/task-cli-test-command.md.",
    "금지: Core, Runner와 다른 package, examples, fixtures, root 설정, CI, SDK version, 신규 외부 dependency 수정. shell true, eval, 명세 module import, background, commit, merge, push, 하위 agent spawn, 다른 변경 되돌리기도 금지한다.",
    "테스트를 먼저 작성한다. argv parser, JSON 확장자와 fatal UTF-8, parse와 validate 순서, 모든 validation issue, terminal control escape, Core 오류의 safe normalization, connect→runSuite→finalize 순서, 동일 client identity, startRunner 전 force cleanup, finalizer 단독 종료 소유권, report stdout과 오류 stderr 분리, exit 0/1을 계획의 고정 문장과 단언 그대로 검증한다.",
    "실제 process E2E는 읽기 전용 examples/weather-server/server.mjs를 PID wrapper로 import한다. 성공 3-case suite와 실제 assertion 실패 suite를 source run과 dist/cli.mjs에서 실행하고 stdout JSON, 빈 stderr, exit code, PID ESRCH를 검사한다. 외부 network와 사용자 설정은 쓰지 않는다.",
    "RED: pnpm exec vitest run packages/cli/tests/index.test.ts packages/cli/tests/test-command.test.ts, pnpm exec vitest run packages/cli/tests/cli-integration.test.ts, pnpm --filter ohmymcp build && pnpm --filter ohmymcp test:e2e. 테스트 미수집이나 bootstrap 실패는 RED로 인정하지 않는다.",
    "GREEN: focused unit, source integration, packages/cli/tests 전체, pnpm --filter ohmymcp typecheck, pnpm build, pnpm --filter ohmymcp test:e2e, pnpm exec biome check packages/cli. 실제 파일과 테스트 수, success/failure exit, PID 잔존을 기록한다.",
    "README를 실제 문법과 범위로 갱신하고 ohmymcp minor changeset을 한국어로 작성한다. package에는 @ohmymcp/core workspace dependency와 test:e2e script만 추가하고 pnpm install --lockfile-only로 lockfile importer를 갱신한다.",
    "보고서와 최종 응답은 READY_FOR_REVIEW 또는 BLOCKED, 변경 파일, RED, GREEN과 수집 수, report 경로, 남은 위험 순서다.",
  ].join("\n").replaceAll("${cliWorktree}", cliWorktree),
});
```

### 최종 읽기 전용 리뷰

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "cli_test_command_review",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: [
    "역할: OhMyMCP CLI test 명령 최종 읽기 전용 reviewer.",
    "Worktree: ${cliWorktree}",
    "Report: ${cliWorktree}/.agents/reports/final-cli-test-command-review.md",
    "첫 명령으로 저장소 루트, HEAD, status를 확인하고 AGENTS.md, execution-conventions, CLI 설계와 구현 계획을 끝까지 읽는다.",
    "파일 수정, background, commit, merge, push, 하위 agent spawn은 금지한다.",
    "Task 기점 이후 diff와 테스트를 읽기 전용 검토한다. 허용 파일, package 경계, JSON-only와 argv 문법, validation-before-connect, shell 미사용, 동일 client와 finalizer lifecycle, startRunner 실패 cleanup, stdout/stderr와 exit code, secret 및 terminal control 안전성, Node 20 호환성, 실제 weather-server source/dist E2E, PID 잔존, README와 changeset 일치를 심각도순으로 보고한다.",
    "필요한 read-only focused 테스트를 실행하고 report에 명령, 수집 수와 결과를 기록한다. 최종 응답은 READY_FOR_REVIEW 또는 BLOCKED로 시작한다.",
  ].join("\n").replaceAll("${cliWorktree}", cliWorktree),
});
```

## 17. 자체 검토 체크리스트

- [x] 설계의 모든 포함 범위가 Task CLI-1 또는 최종 검증에 대응한다.
- [x] CLI 한 package와 lockfile을 단일 terminal이 소유해 파일 충돌이 없다.
- [x] JSON-only, Node.js 20, 신규 외부 dependency 금지 조건이 일치한다.
- [x] Core와 Runner 공개 API, 동결 타입, SDK version은 수정 금지다.
- [x] argv, suite loader, 오류 formatter와 lifecycle의 입력·출력 계약이 고정됐다.
- [x] production code 전에 unit, source E2E와 dist E2E RED를 확인한다.
- [x] 실제 process 테스트는 읽기 전용 weather-server와 격리된 임시 PID file만 사용한다.
- [x] success와 assertion failure 모두 source run과 dist CLI에서 exit code를 검증한다.
- [x] raw stderr, stack, command args, control character가 사용자 출력을 오염하지 않는다.
- [x] package README, dependency, test:e2e script, lockfile와 changeset 범위가 명시됐다.
- [x] 구현 agent와 reviewer 모델은 프로젝트 모델 배분표에 맞고 상위 모델 승급 사유가 없다.
- [x] 구현 agent 뒤 별도 읽기 전용 reviewer와 메인 전체 검증 gate가 있다.
- [x] commit, merge, push는 사용자 요청 없이는 수행하지 않는다.
