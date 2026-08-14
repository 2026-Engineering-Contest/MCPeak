# CLI 프로세스 진단 출력 설계 (2026-08-13)

- 상태: 사용자 승인 대기
- 구현 대상: `@ohmymcp/cli` (패키지명 `ohmymcp`)
- 선행 계약: [CLI 보고서 렌더링 설계](./2026-08-13-cli-report-rendering-design.md),
  [Runner 실행·보고서 설계](./2026-08-11-runner-design.md)
- 관련 ADR: ADR-0012(기본 출력 전환), ADR-0013(렌더러 배치), 이 문서가 만드는 ADR-0014

## 1. 배경

서버가 죽으면 사용자에게 아무 단서가 가지 않는다. 실제 실행 결과가 근거다.

예외를 던지고 죽는 서버에 `ohmymcp test` 를 걸면 지금 나오는 것은 이것뿐이다.

```
✓ seoul  서울 날씨
✗ jeju   제주 날씨
    툴 'get_weather' 호출 중 오류가 발생했습니다.
    해결: MCP 서버 프로세스와 연결 상태를 확인하세요.
    isError  (건너뜀) MCP 작업 결과가 없어 assertion을 검사할 수 없습니다.
```

같은 실행에서 서버는 stderr 에 `TypeError` 와 파일·줄 번호를 남겼다. 그것은 전부 버려진다.
"연결 상태를 확인하세요" 는 사용자가 실행할 수 있는 동작이 아니다.

기동 즉시 죽는 경우는 더 분명하다.

```
오류 [MCP_CONNECTION_FAILED/PROCESS_EXITED]: 요청 완료 전 MCP 서버가 종료되었습니다.
해결: exit code, signal, bounded stderr를 확인하세요.
```

힌트가 "exit code, signal, bounded stderr 를 확인하세요" 라고 지시하는데, CLI 는 그 셋을 어디에도
보여주지 않는다. 사용자가 지시를 따를 방법이 없다.

수집은 이미 되어 있다. `core` 의 `NodeControlledStdioTransport` 가 `BoundedStderr` 로 stderr 를
모으고, `McpStdioConnection.getDiagnostics()` 가 `McpProcessDiagnostics` 를 돌려준다
(`packages/core/src/diagnostics.ts:1`, `packages/core/src/index.ts:19`).

```ts
export interface McpProcessDiagnostics {
  readonly stderr: string;
  readonly stderrTruncated: boolean;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}
```

CLI 가 `connectStdio()` 의 반환값을 이미 손에 들고 있다(`packages/cli/src/test-command.ts:286`).
읽어서 출력하는 일만 남았다.

## 2. 목표 / 비범위 / 완료 조건

### 목표

1. 실패했거나 서버가 비정상 종료했을 때 종료 코드·시그널과 stderr 꼬리를 사용자에게 보여준다.
2. 지금 진단이 전혀 없는 실패 경로(`RUNNER_EXECUTION_FAILED`, `RUNNER_FINALIZATION_FAILED`,
   프로세스 종료로 인한 `MCP_CONNECTION_FAILED`)에도 같은 블록을 붙인다.
3. `--json` 의 stdout 바이트를 바꾸지 않는다. 기계 소비자가 깨지지 않는다.
4. 판정과 종료 코드를 바꾸지 않는다. 그 둘을 검증하는 기존 테스트가 그대로 통과한다.
5. 잘림을 숨기지 않는다. 사용자가 "이게 전부" 라고 오해할 여지를 없앤다.

### 비범위

- 케이스별 stderr 구간 분할. `core` 와 `runner` 를 함께 바꿔야 하고 `RunnerReport` 의 결정론성
  계약과 충돌한다. 로드맵 단계 9로 분리한다.
- `RunnerReport` 스키마 변경. 진단은 보고서에 들어가지 않는다(§4.2).
- `core` 수정. `maxStderrBytes` 조절 옵션도 이번 범위가 아니다.
- `runner` 수정. `renderReport` 는 건드리지 않는다.
- `generate` 명령의 출력.
- stderr 내용의 redaction. 로컬 터미널 출력이고 전송이 없다. provider 전송이 생기는 단계 4에서
  기존 redaction 계약을 적용한다.

### 완료 조건

- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` 전부 통과
- 판정, 종료 코드, stdout 바이트가 바뀌지 않는다. 이 셋을 검증하는 기존 단언은 수정 없이
  통과한다.
- 기존 테스트의 수정은 **공개 계약이 실제로 늘어난 세 곳**에만 허용한다. `TestCommandInput` 에
  `stderrLines` 가 생겨 파싱 결과를 전량 비교하는 단언 2곳, `usage` 문자열 1곳이다. 그 밖의
  기존 단언을 고쳐야 통과한다면 그것은 회귀다.
- `--stderr-lines 0` 을 준 실행의 stdout·stderr 바이트가 변경 전과 같다.
- `--json` 실행의 stdout 바이트가 변경 전과 같다.
- 실환경 E2E 가 예외로 죽는 예제 서버에 대해 stderr 에서 `TypeError` 문자열과 종료 코드 줄을
  찾는다.

## 3. 아키텍처

### 3.1 배치

새 모듈 하나를 만든다.

```
packages/cli/src/process-diagnostics.ts   (신규, 순수 함수)
packages/cli/src/test-command.ts          (수정, 옵션 파싱과 호출 지점)
```

`renderReport` 와 같은 이유로 렌더링과 부작용을 분리한다(ADR-0013). 이 모듈은 `process`,
`Date`, 파일 시스템을 읽지 않는다. 입력은 인자로만 받는다.

`runner` 에 두지 않는 이유: 진단은 `RunnerReport` 의 일부가 아니고, `runner` 는 `McpClient` 만
받으므로 `McpProcessDiagnostics` 를 알 수 없다. `core` 에 두지 않는 이유: 터미널 표현은 CLI 의
책임이고, `core` 는 다른 관심사다. 의존 방향(`cli` → `runner`/`core`)은 그대로다.

### 3.2 공개 계약 (전량)

```ts
/** core 의 McpProcessDiagnostics 와 구조가 같다. import 하지 않고 구조만 받는다. */
export interface ProcessDiagnosticsInput {
  readonly stderr: string;
  readonly stderrTruncated: boolean;
  readonly exitCode: number | null;
  readonly signal: string | null;
}

export interface RenderProcessDiagnosticsOptions {
  /** 표시할 stderr 마지막 줄 수. 0 이면 빈 문자열을 반환한다. */
  readonly maxLines: number;
}

/**
 * 프로세스가 비정상 종료했는지 판정한다. 판정 규칙은 §4.3 에 있다.
 * 우리가 보내는 종료 시그널(SIGTERM·SIGKILL)은 비정상이 아니고, 그 밖의 시그널이거나
 * exitCode 가 0 이 아닌 값으로 확정된 경우가 비정상이다.
 * exitCode 가 null 이면 아직 종료하지 않았다는 뜻이므로 비정상이 아니다.
 */
export function isAbnormalExit(diagnostics: ProcessDiagnosticsInput): boolean;

/**
 * 블록에 담을 내용이 있는지 판정한다. §4.3 의 "진단에 내용이 없으면 쓰지 않는다" 규칙이다.
 * 호출부가 여럿이라 규칙을 복제하면 한쪽만 바뀔 수 있으므로 여기 한 곳에 둔다.
 */
export function hasDiagnosticContent(diagnostics: ProcessDiagnosticsInput): boolean;

/**
 * 진단 블록을 만든다. maxLines 가 0 이면 빈 문자열을 반환한다.
 * 빈 문자열이 아니면 항상 개행으로 끝난다.
 */
export function renderProcessDiagnostics(
  diagnostics: ProcessDiagnosticsInput,
  options: RenderProcessDiagnosticsOptions,
): string;
```

`core` 의 타입을 import 하지 않고 구조가 같은 자체 타입을 쓰는 이유는 테스트에서 `core` 없이
문자열만으로 렌더러를 검증하기 위해서다. `NodeJS.Signals` 대신 `string | null` 을 쓰는 것도
같은 이유다. 대입 방향(`McpProcessDiagnostics` → `ProcessDiagnosticsInput`)은 구조적으로 성립한다.

### 3.3 호출 지점과 주입

`test-command.ts` 는 `dependencies.connect()` 가 돌려준 `McpStdioConnection` 을 이미 지역 변수
`connection` 으로 들고 있다. 여기서 `connection.getDiagnostics()` 를 호출한다.
`TestCommandDependencies` 에 새 필드를 추가하지 않는다. 기존 테스트의 `deps()` 헬퍼가 그대로
동작해야 하기 때문이다(`packages/cli/tests/test-command.test.ts:22` 의 `connection()` 픽스처가
이미 `getDiagnostics` 를 제공한다).

## 4. 출력 계약

### 4.1 채널: 진단은 stderr 로 나간다

stdout 은 보고서 전용 채널로 유지한다. 사람용 렌더 결과든 `--json` 의 JSON 이든 stdout 에는
그것만 나간다. 진단은 stderr 에 쓴다.

근거 셋.

1. `--json > report.json` 이 깨지지 않는다. 진단이 stdout 에 섞이면 `JSON.parse` 가 실패한다.
   `packages/cli/tests/dist-cli-e2e.mjs` 가 실제로 stdout 을 파싱한다.
2. `RunnerReport` 스키마를 늘리지 않아도 된다. 그 스키마는 `runner` 소유다.
3. 터미널에서는 stdout 과 stderr 가 함께 보이므로 사람 경험은 달라지지 않는다. 분리가 필요한
   경우에만 `2> server.log` 로 분리된다.

### 4.2 보고서에 넣지 않는 이유

Runner 설계의 완료 조건은 "동일한 suite 와 결정론적 fake client 를 두 번 실행한 `RunnerEvent[]`
와 `RunnerReport` 가 deep equality 를 만족한다" 이다. stderr 에는 타임스탬프·PID·절대 경로가
섞인다. 보고서에 넣는 순간 이 계약이 깨진다. 비결정적인 것은 보고서 밖에 둔다.

### 4.3 표시 조건

다음 중 하나라도 참이면 블록을 쓴다.

- 보고서를 얻은 경우: `report.status !== "passed"`
- 보고서를 얻은 경우: `isAbnormalExit(diagnostics)` — **전부 통과여도 쓴다.** 판정이 통과인데
  서버가 시그널로 죽었다면 종료 경로에 결함이 있다는 뜻이고, 그것을 숨기면 안 된다.
- 실패 경로: `RUNNER_EXECUTION_FAILED`, `RUNNER_FINALIZATION_FAILED`
- 연결 실패 경로: `MCP_CONNECTION_FAILED` 중 진단에 내용이 있는 경우(§4.3.1)

`--stderr-lines 0` 이면 위 조건과 무관하게 아무것도 쓰지 않는다.

**모든 경로 공통 조건: 진단에 내용이 없으면 쓰지 않는다.** `stderr` 가 빈 문자열이고
`isAbnormalExit` 이 거짓이면 블록에 남는 것은 `종료 코드: 0  시그널: 없음` 과
`stderr: (비어 있음)` 뿐이다. 정보가 0인 블록은 소음이고, 특히 케이스는 실패했지만 서버는
정상 종료한 실행에서 매번 붙는다. 그 경우 실패 원인은 단언 진단이 이미 설명하고 있다.

이 규칙은 렌더러가 아니라 호출부에 둔다. `renderProcessDiagnostics` 는 요청받은 것을 그대로
그리고, 무엇을 그릴 가치가 있는지는 CLI 가 판단한다.

#### 4.3.0 비정상 종료의 정의: 우리가 보낸 시그널은 제외한다

`isAbnormalExit` 은 다음일 때만 참이다.

```
signal !== null && signal !== "SIGTERM" && signal !== "SIGKILL"   → 비정상
또는 exitCode 가 null 도 0 도 아님                                  → 비정상
```

`SIGTERM` 과 `SIGKILL` 을 제외하는 이유는 **그 둘을 우리가 보내기 때문이다.**
`packages/core/src/lifecycle.ts` 가 stdin 을 닫은 뒤 `STDIN_CLOSE_GRACE_MS`(500ms)가 지나면
`SIGTERM` 을, 다시 `SIGTERM_GRACE_MS`(500ms) 뒤에 `SIGKILL` 을 보낸다. 타이머나 소켓 핸들을
들고 있어 유예 안에 못 끝나는 서버는 멀쩡해도 이 경로를 탄다. 그것을 비정상으로 보면 전부 통과한
실행에서도 `시그널: SIGTERM` 블록이 매번 붙고, 사용자는 서버가 죽었다고 읽는다. 거짓 경보다.

`SIGSEGV`·`SIGABRT`·`SIGBUS` 처럼 우리가 보내지 않는 시그널은 그대로 비정상이다.

**알려진 한계**: OOM killer 가 보낸 `SIGKILL` 을 우리가 보낸 것과 구분하지 못해 놓친다.
`McpProcessDiagnostics` 에 "우리가 보냈다" 표식이 없어 지금은 구분할 방법이 없다. 표식을 넣으려면
`core` 를 고쳐야 하므로 이번 범위 밖이다. 매 실행 거짓 경보를 내는 쪽보다 이 한 경우를 놓치는
쪽이 낫다고 보고 받아들인다.

#### 4.3.1 연결 실패 경로의 진단 출처

`connection` 객체가 없어도 진단을 읽을 수 있다. `core` 의 `McpClientError` 가
`diagnostics: McpProcessDiagnostics` 를 필드로 들고 있다(`packages/core/src/errors.ts:92`).
`connectStdio()` 는 핸드셰이크 실패·프로세스 조기 종료를 이 오류로 던지며 그때의 진단 스냅샷을
함께 담는다(`packages/core/src/index.ts:57`).

이 경로가 실제로 제일 중요하다. 의존성 미설치나 문법 오류로 서버가 기동 즉시 죽는 경우가 여기
해당하고, 지금 나오는 메시지가 `해결: exit code, signal, bounded stderr를 확인하세요` 인데
정작 그 셋을 보여주지 않는다는 §1 의 모순이 이 경로다.

`test-command.ts` 의 `coreError()` 헬퍼가 이미 오류 객체를 순회해 `McpClientError` 를 찾는다.
여기서 `diagnostics` 도 함께 꺼낸다. 구조 검증은 기존 방식대로 필드 존재와 타입을 직접 확인하고,
형태가 다르면 진단 없이 기존 메시지만 낸다.

**이 경로에서만 적용하는 추가 조건**: `stderr` 가 비어 있고 `isAbnormalExit` 이 거짓이면 블록을
쓰지 않는다. 실행 파일 자체가 없어 spawn 이 실패한 경우(`PROCESS_START_FAILED`)가 여기 해당하며,
그때 진단은 전부 비어 있어 `종료 코드: 없음  시그널: 없음  stderr: (비어 있음)` 만 남는다. 정보가
없는 블록은 소음이다.

### 4.4 종료 코드

바뀌지 않는다. `report.status === "passed" ? 0 : 1`, 실패 경로는 1. 진단 블록의 유무가 종료
코드에 영향을 주지 않는다.

## 5. 레이아웃

### 5.1 전체 구조

```
서버 프로세스 진단
  종료 코드: 1  시그널: 없음
  stderr (마지막 20줄):
    [weather] unexpected state for 제주
    TypeError: Cannot read properties of undefined (reading 'temp')
        at handleCall (/path/server.mjs:73:13)
```

- 1행: 고정 문자열 `서버 프로세스 진단`
- 2행: 들여쓰기 2칸. `종료 코드: <값>` + 두 칸 + `시그널: <값>`
- 3행: 들여쓰기 2칸. stderr 헤더
- 4행 이후: 들여쓰기 4칸. stderr 각 줄

들여쓰기 2칸과 4칸은 `renderReport` 의 `INDENT = "    "`(4칸)와 계층을 맞춘 값이다. 블록 전체가
보고서보다 한 단 밖에 있으므로 헤더는 2칸에 둔다.

블록은 항상 개행으로 끝난다.

### 5.2 종료 코드 줄

- `exitCode` 가 숫자면 그 값. `null` 이면 `없음`.
- `signal` 이 문자열이면 그 값. `null` 이면 `없음`.

```
  종료 코드: 1  시그널: 없음
  종료 코드: 없음  시그널: SIGSEGV
  종료 코드: 없음  시그널: 없음
```

세 번째 줄은 프로세스가 아직 종료하지 않은 경우다(실행 중 오류로 중단된 경로, 또는 spawn 이
실패해 진단이 처음부터 빈 경우).

이 줄만으로는 블록이 나가지 않는다. §4.3 의 공통 억제 조건이 앞선다. `stderr` 가 비어 있고
`isAbnormalExit` 도 거짓이면 남는 것이 `종료 코드: 없음  시그널: 없음` 과 `stderr: (비어 있음)`
뿐이라 정보량이 0이고, `PROCESS_START_FAILED` 처럼 실제로 보여줄 것이 없는 경우와 구분되지
않는다. 렌더러는 이 조합을 그릴 수 있어야 하지만(§3.2 의 순수 함수 계약), 호출부가 그 상황에서
부르지 않는다.

즉 이 줄이 실제로 보이는 것은 같은 블록에 stderr 내용이 함께 있을 때다. 그때는 "서버가 아직
살아 있고 stderr 에 이런 것을 남겼다" 가 하나의 단서로 읽힌다.

### 5.3 stderr 헤더와 잘림 표시

`stderr` 가 빈 문자열이면 한 줄로 끝낸다.

```
  stderr: (비어 있음)
```

내용이 있으면 헤더에 실제 상황을 적는다. 괄호 안 항목은 해당될 때만 순서대로 붙인다.

```
  stderr (마지막 20줄):
  stderr (마지막 20줄, 위로 143줄 더 있음):
  stderr (마지막 20줄, 앞부분이 수집 상한으로 잘렸습니다):
  stderr (마지막 20줄, 위로 143줄 더 있음, 앞부분이 수집 상한으로 잘렸습니다):
```

- `위로 N줄 더 있음`: 줄 수 제한으로 잘린 경우. `N` 은 버려진 줄 수.
- `앞부분이 수집 상한으로 잘렸습니다`: `stderrTruncated === true` 인 경우. core 의
  `maxStderrBytes`(기본 64KB, `packages/core/src/options.ts:34`)에 걸린 것이다.

전체 줄 수가 `maxLines` 이하여서 버린 줄이 없으면 괄호 안은 `마지막 N줄` 대신 `전체`로 적는다.
다만 `stderrTruncated` 가 참이면 `전체`가 아니라 **`수집된 전체`** 다. 수집 상한에 걸려 앞부분이
잘린 스트림을 "전체" 라고 부르면 같은 괄호 안에서 모순이 된다.

```
  stderr (전체):
  stderr (수집된 전체, 앞부분이 수집 상한으로 잘렸습니다):
```

이 규칙의 목적은 하나다. 사용자가 무해한 꼬리 20줄만 보고 "서버 stderr 에 문제 없음" 으로
오판하는 것을 막는다.

### 5.4 줄 분할 규칙

1. `stderr` 를 `/\r?\n/` 로 나눈다.
2. 마지막 원소가 빈 문자열이면 하나 버린다. 대부분의 stderr 가 개행으로 끝나므로 빈 줄이 하나
   생기는 것을 막는다. 그 외의 빈 줄은 유지한다. 스택 트레이스 사이의 빈 줄도 정보다.
3. 남은 줄에서 마지막 `maxLines` 개를 취한다. 버려진 개수가 §5.3 의 `N` 이다.
4. §5.5 의 이스케이프를 적용한 **뒤**, 그 결과가 1000자를 넘으면 앞 1000자만 남기고 뒤에
   ` …(N자 생략)` 을 붙인다. `N` 은 생략된 문자 수이고 세는 단위도 이스케이프된 문자다.

4번이 필요한 이유는 줄 수 제한만으로는 출력량이 묶이지 않기 때문이다. 구조화 로거는 크래시마다
수십 KB JSON 을 한 줄로 뱉는다. `--stderr-lines 20` 이어도 그 한 줄이 통째로 쏟아진다.
1000자면 스택 프레임 한 줄과 긴 절대 경로를 담고도 터미널 몇 줄에 들어간다.

**자르는 순서가 이스케이프 뒤인 이유**는 이스케이프가 제어문자 하나를 `\uXXXX` 6자로 부풀리기
때문이다. 원문 기준으로 1000자를 남기면 제어문자로 채운 줄이 6000자가 되어 상한이 상한 노릇을
못 한다. 다만 자르는 지점이 `\u001b` 같은 시퀀스 중간이 되면 안 되므로, 원문 문자 하나를 토큰
하나로 두고 토큰 경계에서만 자른다. 그래서 남는 길이는 1000 이하의 가장 큰 토큰 경계다.

### 5.5 제어 문자 이스케이프

stderr 는 신뢰할 수 없는 입력이다. 서버가 ANSI escape 를 넣으면 터미널을 조작할 수 있다.
`renderReport` 와 `test-command.ts` 가 쓰는 것과 **거의 같은 규칙**을 쓴다. 즉 코드포인트가
`<= 0x1f`, `0x7f..0x9f`, `U+2028`, `U+2029` 이면 `\uXXXX` 로 바꾼다.

**다른 점이 하나 있다. 이 모듈은 TAB(0x09)을 이스케이프하지 않는다.** 다른 두 사본은 우리가 만든
메시지 문자열만 다루므로 TAB 이 들어올 일이 없지만, 이 모듈은 서버 stderr 를 그대로 그린다.
Java 의 `\tat com.example.Foo.bar(Foo.java:42)` 나 Go 패닉 트레이스의 파일·줄 행은 전부 TAB
들여쓰기다. 그것을 `\u0009` 로 바꾸면 이 기능이 보여주려던 스택 트레이스가 도리어 읽기 어려워진다.
TAB 은 커서를 옮길 뿐이라 터미널 주입 벡터가 아니다.

다만 그 함수를 그대로 적용하면 개행(0x0a)까지 이스케이프되어 여러 줄이 한 줄로 뭉개진다.
그래서 **§5.4 로 줄을 나눈 뒤 각 줄에 적용하고, 그다음에 개행으로 합친다.** 줄 구조는 살고
제어문자는 죽는다.

`\r` 은 §5.4 의 분할에서 제거되므로 남지 않는다.

이 함수를 `runner` 나 `test-command.ts` 에서 import 하지 않고 이 모듈에 다시 쓴다. 근거는
ADR-0013 과 같다. `reporter.ts` 도 같은 이유로 자기 사본을 가지고 있다.

### 5.6 색상

쓰지 않는다. 진단 블록은 색상 없이 출력한다. 이유는 `colorEnabled` 가 `process.stdout.isTTY` 를
보는데 이 블록은 stderr 로 나가므로 판정 대상이 다르고, 색상은 이 기능의 목적에 기여하지 않는다.

## 6. 옵션: `--stderr-lines`

```
ohmymcp test <suite.json> --command <executable> [--arg <value> ...] [--json] [--stderr-lines <N>]
```

- 기본값 `20`.
- `0` 이면 진단 블록을 완전히 끈다. 출력이 변경 전과 바이트 단위로 같아진다. CI 에서 바이트
  비교가 필요할 때 쓰는 탈출구다.
- `--stderr-lines 40` 과 `--stderr-lines=40` 을 모두 받는다. 기존 `--command` 파싱과 같은 형태다.
- 검증: 10진 정수 문자열이어야 하고 `0` 이상이어야 한다. 상한은 두지 않는다. core 의
  `maxStderrBytes` 가 실질 상한이므로 큰 값을 줘도 없는 내용은 나오지 않는다.
- 위반은 전부 `CLI_USAGE` 실패로 처리하고 `usage` 문자열을 힌트로 낸다.
  - 값 없음: `` `--stderr-lines` 옵션 값이 필요합니다. ``
  - 중복 지정: `` `--stderr-lines`는 한 번만 사용할 수 있습니다. ``
  - 정수 아님·음수: `` `--stderr-lines` 값은 0 이상의 정수여야 합니다. ``

`usage` 상수에 `[--stderr-lines <N>]` 을 추가한다.

## 7. 실패 경로별 동작

| 경로 | 지금 | 변경 후 |
|---|---|---|
| 정상 통과, 정상 종료 | 보고서만 | 동일 (블록 없음) |
| 정상 통과, 비정상 종료 | 보고서만 | 보고서 + 진단 블록 |
| 케이스 실패, 서버가 stderr 를 남겼거나 비정상 종료 | 보고서만 | 보고서 + 진단 블록 |
| 케이스 실패, 서버는 정상 종료하고 stderr 도 비어 있음 | 보고서만 | 동일 (보여줄 근거가 없다) |
| 타임아웃·중단 | 보고서만 | 진단에 내용이 있으면 보고서 + 진단 블록 |
| `RUNNER_EXECUTION_FAILED` | 오류 메시지 | 오류 메시지 + 진단 블록 |
| `RUNNER_FINALIZATION_FAILED` | 오류 메시지 | 오류 메시지 + 진단 블록 |
| `MCP_CONNECTION_FAILED` (서버가 기동 후 죽음, 핸드셰이크 실패) | 오류 메시지 | 오류 메시지 + 진단 블록 (출처는 `McpClientError.diagnostics`) |
| `MCP_CONNECTION_FAILED` (`PROCESS_START_FAILED`, spawn 자체 실패) | 오류 메시지 | 동일 (진단이 전부 비어 있음, §4.3.1) |
| 명세 검증 실패 등 연결 이전 | 오류 메시지 | 동일 (연결 없음) |
| `--json` 지정 | JSON | JSON (stdout 동일) + 진단 블록(stderr) |
| `--stderr-lines 0` | — | 모든 경우에 블록 없음 |

**블록 앞에는 모든 경로에서 빈 줄 하나를 둔다.** 오류 메시지 뒤든 보고서 뒤든 사용자가 보는 것은
같은 터미널이고, 경로마다 레이아웃이 달라질 이유가 없다. stdout 과 stderr 가 다른 스트림이라는
사실은 구현의 사정이지 사용자가 아는 것이 아니다.

`RUNNER_EXECUTION_FAILED` 경로는 진단을 **`forceClose()` 호출 전에** 찍어 그 스냅샷을 쓴다.
`forceClose` 는 우리가 `SIGTERM`·`SIGKILL` 을 보내는 경로이므로(§4.3.0), 그 뒤의 값을 보여주면
로컬의 `startRunner` 실패를 서버가 죽은 것으로 오인시킨다.

## 8. 테스트

단위 테스트는 인메모리만 쓴다. 실환경 E2E 는 직렬 웨이브로 분리한다.

### 8.1 `packages/cli/tests/process-diagnostics.test.ts` (신규)

`isAbnormalExit`

- `signal 이 있으면 참이다`: `{ exitCode: null, signal: "SIGSEGV" }` → `true`
- `exitCode 가 0 이 아니면 참이다`: `{ exitCode: 1, signal: null }` → `true`
- `exitCode 가 0 이면 거짓이다`: `{ exitCode: 0, signal: null }` → `false`
- `아직 종료하지 않았으면 거짓이다`: `{ exitCode: null, signal: null }` → `false`

`renderProcessDiagnostics`

- `maxLines 가 0 이면 빈 문자열을 반환한다`: stderr 가 있어도 `""`
- `종료 코드와 시그널을 한 줄에 적는다`: `{ exitCode: 1, signal: null, stderr: "" }` →
  `"서버 프로세스 진단\n  종료 코드: 1  시그널: 없음\n  stderr: (비어 있음)\n"` (전량 비교)
- `null 종료 코드를 '없음'으로 적는다`: `{ exitCode: null, signal: "SIGSEGV" }` 의 2행이
  `"  종료 코드: 없음  시그널: SIGSEGV"`
- `stderr 가 비면 한 줄로 끝낸다`: 출력에 `"  stderr: (비어 있음)"` 포함, `"마지막"` 미포함
- `줄 수가 제한 이하면 전체로 표시한다`: 3줄 stderr, `maxLines: 20` → 헤더가
  `"  stderr (전체):"`
- `제한을 넘으면 마지막 N줄만 남기고 버린 줄 수를 적는다`: 25줄 stderr, `maxLines: 20` →
  헤더가 `"  stderr (마지막 20줄, 위로 5줄 더 있음):"`, 본문 첫 줄이 6번째 줄, 본문 줄 수 20
- `수집 상한 잘림을 헤더에 적는다`: `stderrTruncated: true`, 3줄 → 헤더가
  `"  stderr (전체, 앞부분이 수집 상한으로 잘렸습니다):"`
- `두 잘림이 동시에 발생하면 둘 다 적는다`: 25줄 + `stderrTruncated: true`, `maxLines: 20` →
  헤더가 `"  stderr (마지막 20줄, 위로 5줄 더 있음, 앞부분이 수집 상한으로 잘렸습니다):"`
- `끝의 개행으로 생기는 빈 줄을 만들지 않는다`: `"a\nb\n"` → 본문이 `"    a"`, `"    b"` 두 줄
- `중간의 빈 줄은 유지한다`: `"a\n\nb\n"` → 본문 세 줄, 두 번째가 `"    "`
- `CRLF 를 줄 구분으로 처리한다`: `"a\r\nb\r\n"` → 본문 두 줄, `\r` 이 남지 않는다
- `ANSI escape 를 이스케이프한다`: 입력 `"\x1b[31mred\x1b[0m"` → 출력에 문자열 `"\\u001b"` 포함, 실제 ESC 코드포인트(`0x1b`) 미포함
  (테스트 소스에서는 `\u001b` 이스케이프로 적는다. 문서에 원문 제어문자를 넣지 않는다.)
- `C1 제어 문자를 이스케이프한다`: 입력 `"\u009b1m"` → 출력에 문자열 `"\\u009b"` 포함
- `U+2028 과 U+2029 를 이스케이프한다`: 각각 `"\\u2028"`, `"\\u2029"` 포함
- `개행은 이스케이프하지 않는다`: `"a\nb"` → 출력에 `"\\u000a"` 미포함, 본문 두 줄
- `항상 개행으로 끝난다`: 빈 문자열이 아닌 모든 결과가 `"\n"` 로 끝난다

### 8.2 `packages/cli/tests/test-command.test.ts` (수정, 단언 추가만)

`parseTestCommand`

- `--stderr-lines 를 파싱한다`: `["suite.json","--command","node","--stderr-lines","5"]` →
  `stderrLines: 5`
- `--stderr-lines=N 형태를 파싱한다`: `"--stderr-lines=5"` → `stderrLines: 5`
- `기본값은 20 이다`: 옵션 없음 → `stderrLines: 20`
- `0 을 허용한다`: `"--stderr-lines","0"` → `stderrLines: 0`
- `값이 없으면 CLI_USAGE 로 실패한다`: `["suite.json","--command","node","--stderr-lines"]`
- `중복 지정을 거절한다`
- `정수가 아니면 거절한다`: `"1.5"`, `"abc"`, `""`
- `음수를 거절한다`: `"-1"` (기존 `--arg` 규칙과 같이 `-` 로 시작하는 값도 함께 걸린다)

`runCli`

- `실패가 있으면 stderr 에 진단 블록을 쓴다`: 실패 보고서 + `getDiagnostics` 가
  `{ exitCode: 1, signal: null, stderr: "boom\n", stderrTruncated: false }` →
  `writes.err` 를 이은 문자열에 `"서버 프로세스 진단"`, `"종료 코드: 1"`, `"boom"` 포함
- `전부 통과하고 정상 종료면 아무것도 쓰지 않는다`: 통과 보고서 + `{ exitCode: 0, signal: null }`
  → `writes.err` 가 빈 배열
- `실패해도 진단이 비어 있으면 쓰지 않는다`: 실패 보고서 +
  `{ stderr: "", stderrTruncated: false, exitCode: 0, signal: null }` → `writes.err` 가 빈 배열,
  반환값은 `1`
- `전부 통과여도 비정상 종료면 쓴다`: 통과 보고서 + `{ exitCode: null, signal: "SIGSEGV" }` →
  `writes.err` 에 `"시그널: SIGSEGV"` 포함, 반환값은 `0`
- `--stderr-lines 0 이면 실패해도 쓰지 않는다`: 실패 보고서 + `{ exitCode: 1 }` →
  `writes.err` 가 빈 배열
- `--json 의 stdout 을 바꾸지 않는다`: `--json` + 실패 보고서 → `writes.out` 을 이은 문자열이
  `JSON.parse` 가능하고 `writes.err` 에는 진단이 있다
- `RUNNER_EXECUTION_FAILED 경로에도 붙인다`: `startRunner` 가 던지는 의존성 →
  `writes.err` 에 `"RUNNER_EXECUTION_FAILED"` 와 `"서버 프로세스 진단"` 이 모두 있다
- `RUNNER_FINALIZATION_FAILED 경로에도 붙인다`: `finalize` 가 거절하는 의존성 → 같은 형태
- `연결 실패 오류에 담긴 진단을 쓴다`: `connect` 가 `diagnostics` 를 가진 `McpClientError` 형태의
  객체로 거절(`{ name: "McpClientError", code: "PROCESS_EXITED", message, hint,
  diagnostics: { stderr: "ERR_MODULE_NOT_FOUND\n", stderrTruncated: false, exitCode: 1,
  signal: null } }`) → `writes.err` 에 `"MCP_CONNECTION_FAILED/PROCESS_EXITED"` 와
  `"ERR_MODULE_NOT_FOUND"` 가 모두 있다
- `진단이 비어 있으면 연결 실패에 블록을 붙이지 않는다`: 같은 형태에
  `diagnostics: { stderr: "", stderrTruncated: false, exitCode: null, signal: null }` →
  `writes.err` 에 `"서버 프로세스 진단"` 이 없다
- `McpClientError 가 아닌 거절에는 붙지 않는다`: `connect` 가 평범한 `Error` 로 거절 →
  `writes.err` 에 `"서버 프로세스 진단"` 이 없다
- `오류 메시지와 진단 사이에 빈 줄을 둔다`: `RUNNER_EXECUTION_FAILED` 경로의 stderr 를 이은
  문자열에 `"\n\n서버 프로세스 진단"` 포함
- `종료 코드는 진단 유무와 무관하다`: 위 통과·실패 각 경우의 반환값이 각각 `0`, `1`

### 8.3 `packages/cli/tests/cli-integration.test.ts` (수정)

두 갈래로 나눈다. `examples/weather-server` 는 정상 종료하고 stderr 를 남기지 않아 §4.3 의 빈
진단 생략 규칙에 걸린다. 즉 그 서버로는 "옵션 없음 → 블록 있음" 을 만들 수 없다. `examples/` 는
수정 금지 대상이므로 서버를 고치지 않고 대상을 나눈다.

- `--stderr-lines 0 은 변경 전과 같은 바이트를 낸다`: `examples/weather-server` 에 실패 명세를
  두 번 실행해 stdout 이 두 경우 모두 같고, `--stderr-lines 0` 쪽 stderr 가 빈 문자열이다
- `stderr 를 남기고 죽는 서버에는 블록이 붙고 --stderr-lines 0 이면 사라진다`: 임시 디렉터리에
  stderr 에 표식을 쓰고 즉시 죽는 최소 스크립트를 만들어 두 번 실행한다. 옵션 없음 쪽 stderr 에
  `서버 프로세스 진단` 과 그 표식이 있고, `--stderr-lines 0` 쪽에는 연결 실패 메시지만 있다

두 번째가 없으면 §9 의 거짓 신호에 걸린다. 블록이 안 붙는 쪽만 단언하면 조건 판정이 잘못돼
어떤 경우에도 안 붙는 상태와 구분되지 않는다.

### 8.4 `packages/cli/tests/dist-cli-e2e.mjs` (수정, 실환경 직렬 웨이브)

배포 산출물(`dist/cli.mjs`)로 실제 서버 프로세스를 띄운다.

- 기존 `--json` 판정을 그대로 유지한다. stdout 을 `JSON.parse` 로 파싱한다.
- 예외를 던지고 죽는 임시 서버 스크립트를 테스트가 만들어 실행한다. 판정: 종료 코드 1, stderr 에
  `"서버 프로세스 진단"` 과 `"TypeError"` 가 있다.
- 실행 파일이 존재하지 않는 명령으로 실행한다. 판정: 기존 `MCP_CONNECTION_FAILED` 메시지가
  나오고 진단 블록은 없다.

임시 서버 스크립트는 `examples/weather-server/` 를 오염시키지 않는다. 테스트가 임시 디렉터리에
만들고, `@modelcontextprotocol/sdk` 를 쓰지 않는 최소 스크립트(stdout 에 아무것도 쓰지 않고
stderr 에 쓴 뒤 즉시 종료)로 충분하다. 핸드셰이크 실패 경로를 쓰는 것이므로 SDK 가 필요 없다.

## 9. 거짓 신호

- **`writes.err` 가 비어 있어 통과** — 진단이 안 붙은 게 아니라 조건 판정이 잘못돼 안 붙었을 수
  있다. 통과 케이스와 실패 케이스를 같은 테스트 파일에서 둘 다 단언한다.
- **문자열 `포함` 단언만으로 통과** — 레이아웃이 깨져도 통과한다. §8.1 의 최소 두 케이스는
  전체 문자열을 그대로 비교한다.
- **로컬에서만 되는 E2E** — `dist/` 가 낡으면 옛 동작을 검증한다. E2E 전에 `pnpm build` 를
  실행한 뒤 판정한다.
- **stderr 가 비어 통과하는 E2E** — 서버가 아직 종료 중이라 stderr 수집이 끝나지 않았을 수 있다.
  프로세스 종료를 기다린 뒤 판정한다.

## 10. 소유권과 PR

- 수정 파일이 전부 `packages/cli/` 안에 있다. `core`·`runner`·`generate` 무수정.
- `core/src/types.ts` 의 `McpClient`·`ToolResult` 와 무관하다.
- 의존 방향 `cli` → `runner`/`core` 유지. 역참조 없음.
- 새 의존성 없음.
- PR 하나. `feat(cli): 실패 시 서버 프로세스 진단을 출력한다`

## 11. ADR

ADR-0014 를 만든다. 주제는 "진단을 보고서가 아니라 stderr 채널로 보낸다" 이다. 선택지는
(1) `RunnerReport` 에 진단 필드 추가, (2) stdout 에 보고서와 함께 출력, (3) stderr 채널로 분리.
결정은 (3)이고, 이유는 §4.1·§4.2 의 결정론성 계약과 `--json` 소비자 보호다.

## 12. 후속 연동

- **단계 4 (repair)**: 진단 문자열이 provider 에 보낼 근거가 된다. 그때는 로컬 출력이 아니라
  전송이므로 기존 redaction 계약(경로·토큰 마스킹)을 적용해야 한다. 이 설계는 그 지점을
  비범위로 두되, 렌더러가 순수 함수라 입력을 정제한 뒤 같은 함수를 재사용할 수 있게 남긴다.
- **단계 9 (케이스별 stderr 구간)**: `core` 진단 API 에 오프셋이 생기면 이 모듈은 "전체 꼬리"
  대신 "구간"을 받아 같은 레이아웃으로 그린다. 렌더러 시그니처의 `stderr: string` 은 그대로
  쓸 수 있다.
