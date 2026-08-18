# CLI 보고서 렌더링 구현 계획 (2026-08-13)

설계 문서: `docs/superpowers/specs/2026-08-13-cli-report-rendering-design.md`
참조: `docs/superpowers/specs/2026-08-13-response-body-assertion-design.md` (§11.2가 이 작업을 지목한다)
참조: `CONTRIBUTING.md` §2.1 (오너 표에서 `runner` 책임에 리포터가 포함된다)

## 1. 배경과 근거

응답 본문 단언 웨이브가 진단 문장을 완성했다. 그 문장이 사용자에게 닿지 않는다.
`packages/cli/src/test-command.ts:315` 가 보고서를 통째로 덤프하기 때문이다.

```ts
dependencies.writeStdout(`${JSON.stringify(finalReport, null, 2)}\n`);
```

설계 문서가 렌더러 배치(§3.1), 순수성 경계(§3.2), 진단 코드 무분기 원칙(§3.3), 출력 계약(§4),
레이아웃(§5), 제어 문자 이스케이프(§6)를 확정했다. 이 계획은 그것을 실행한다.

## 2. 목표 / 비범위 / 완료 조건

### 목표

1. `RunnerReport`를 터미널 문장으로 그리는 `renderReport`를 `packages/runner`에 추가한다.
2. `ohmymcp test`의 기본 stdout을 그 문장으로 바꾸고 `--json`으로 기존 출력을 보존한다.
3. 같은 보고서에 항상 같은 바이트를 만든다.
4. 서버 응답에서 온 문자열이 터미널 제어 시퀀스로 해석되지 않게 한다.

### 비범위

설계 문서 §9에 연동 계약이 있다. 이 계획에서 건드리지 않는다.

- 위반 클러스터링, AI 요약, repair
- 진행 상황 스트리밍(`RunnerEvent` 구독)
- JUnit XML 리포터
- 진단 문안 수정. `packages/runner/src/diagnostics.ts` 의 문장을 한 글자도 바꾸지 않는다.
- stderr 오류 경로. `format()` 과 `packages/cli/src/test-command.ts:143` 의
  `escapeTerminalText` 는 그대로 둔다.
- `packages/core` `packages/generate` `packages/record` `packages/mock` 전체
- `packages/cli/src/generate-command.ts`

### 완료 조건

- `pnpm build && pnpm typecheck && pnpm lint && pnpm test` 전부 통과.
  타입체크와 린트는 검사한 파일 수가 0이 아닌지 출력에서 확인한다.
- `packages/runner/tests/reporter.test.ts` 가 §5 T1의 단언 목록을 모두 포함하고 통과.
- `pnpm build && node packages/cli/tests/dist-cli-e2e.mjs` 통과.
- E2E에서 `--json` 없는 실행의 stdout에 `$.temperature: 필수 필드가 없습니다.` 가 포함되고,
  같은 입력 2회 실행의 stdout 바이트가 같다.
- `--json` 을 붙인 실행의 stdout 바이트가 이 웨이브 이전과 동일하다.
- `docs/adr/0012-cli-기본-출력-전환.md` 와 `docs/adr/0013-렌더러-배치와-진단-무분기.md` 존재.
- `.changeset/` 신규 파일 1개. `@ohmymcp-hsu/runner` minor, `ohmymcp` minor.

## 3. Global Constraints

모든 태스크의 요구사항에 아래가 암묵적으로 포함된다.

- T1의 수정 대상은 `packages/runner` 뿐이다. T2는 `packages/cli/src` 와
  `packages/cli/tests/test-command.test.ts` 뿐이다. T3는 `packages/cli/tests` 의 실환경
  파일 둘뿐이다.
- `core/src/types.ts` 의 `McpClient` 와 `ToolResult` 는 변경 금지다. 필요해 보이면 `BLOCKED`.
- `packages/runner/src/diagnostics.ts` 의 문안을 수정하지 않는다. 렌더러는 배치만 한다.
- 의존 방향은 단방향이다. `runner` 는 `core` 만 참조한다. `cli` 는 `core` 와 `runner` 를
  참조한다. 역참조와 순환을 만들지 않는다.
- `@modelcontextprotocol/sdk` 는 1.x 고정이다. 버전을 올리거나 `^` 를 붙이지 않는다.
- 목록에 없는 의존성을 추가하지 않는다. 특히 색상 라이브러리(`chalk`, `picocolors`)와
  문자 폭 라이브러리(`string-width`)를 추가하지 않는다.
- 유닛테스트는 인메모리와 `fixtures/` 만 쓴다. T1과 T2는 실제 서버 프로세스를 띄우지 않는다.
- `schemaVersion` 은 1을 유지한다.
- 커밋·머지·푸시는 사람이 한다. 서브에이전트는 worktree 생성 외의 git 명령을 실행하지 않는다.
- 산문에 대시 기호(`—`)를 쓰지 않는다. 주석과 문서는 한국어로 쓴다.
- **문서와 코드에 raw ESC 바이트(`0x1b`)를 넣지 않는다.** 문자열 리터럴에는 `"\u001b"` 를 쓴다.

## 4. 공유 계약 (전량 기재)

T1이 만들고 T2가 소비한다. 한 글자만 어긋나도 깨지므로 그대로 쓴다.

### 4-1. `packages/runner/src/reporter.ts` 공개 계약

```ts
import type { RunnerReport } from "./executor.js";

export interface RenderReportOptions {
  /** ANSI 색상 사용 여부. 기본 false. */
  color?: boolean;
}

/**
 * RunnerReport를 사람이 읽는 문자열로 그린다. 순수 함수다.
 * process, stdout, isTTY, NO_COLOR, Date, 로케일을 읽지 않는다.
 * 반환값은 항상 개행 하나로 끝난다. 호출부가 개행을 덧붙이지 않는다.
 */
export function renderReport(report: RunnerReport, options?: RenderReportOptions): string;
```

`packages/runner/src/index.ts` 에서 `renderReport` 와 `RenderReportOptions` 를 재수출한다.

### 4-2. 상수 (전량)

매직넘버와 기호는 전량 기재한다. 값이 흔들리면 모든 테스트의 기대 문자열이 깨진다.

```ts
/** 진단과 단언 줄의 들여쓰기. 설계 문서 §5.3, §5.4. */
const INDENT = "    ";
/** 열 사이 구분. 헤더, 케이스 줄, 단언 줄, 요약 줄에서 같은 값을 쓴다. */
const GAP = "  ";

/** 케이스 상태 기호. 설계 문서 §5.2. 환경에 따라 바뀌지 않는다. */
const MARKS: Readonly<Record<TestCaseResult["status"], { glyph: string; sgr: string }>> = {
  passed: { glyph: "✓", sgr: "32" },
  failed: { glyph: "✗", sgr: "31" },
  timedOut: { glyph: "⧖", sgr: "33" },
  cancelled: { glyph: "⊘", sgr: "2" },
  notRun: { glyph: "·", sgr: "2" },
};

/** 요약 줄 항목. 순서가 곧 출력 순서다. 설계 문서 §5.6. */
const SUMMARY_LABELS: ReadonlyArray<readonly [keyof RunnerSummary, string]> = [
  ["passed", "passed"],
  ["failed", "failed"],
  ["timedOut", "timed out"],
  ["cancelled", "cancelled"],
  ["notRun", "not run"],
];
```

`total` 은 `SUMMARY_LABELS` 에 넣지 않는다. 괄호 안에 따로 그린다.

### 4-3. 이스케이프와 폭 계산 (전량)

순서가 틀리면 조용히 사고가 난다. 전량 기재한다.

```ts
/**
 * 터미널 제어 문자를 무해한 문자열로 바꾼다. 설계 문서 §6.
 * packages/cli/src/test-command.ts:143 의 규칙과 같은 값을 쓴다.
 * cli 의 것을 import 하지 않는다. 의존 방향이 뒤집힌다. ADR-0013에 근거가 있다.
 */
const escapeTerminalText = (value: string): string =>
  Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f || codePoint === 0x2028 || codePoint === 0x2029
      ? `\\u${codePoint.toString(16).padStart(4, "0")}`
      : character;
  }).join("");

/**
 * 코드 포인트 수. 표시 폭이 아니다. 설계 문서 §5.2의 알려진 한계를 그대로 받는다.
 * String.prototype.length 를 쓰지 않는다. 서로게이트 페어를 2로 세기 때문이다.
 */
const width = (value: string): number => Array.from(value).length;

/** 오른쪽을 공백으로 채운다. 이미 target 이상이면 그대로 둔다. */
const pad = (value: string, target: number): string =>
  value + " ".repeat(Math.max(0, target - width(value)));
```

**이스케이프를 먼저 하고 패딩을 나중에 한다.** 이스케이프하면 문자열이 길어지므로 순서를
뒤집으면 열이 어긋난다.

**이스케이프를 먼저 하고 색상 삽입을 나중에 한다.** 순서를 뒤집으면 우리가 넣은 SGR 시퀀스의
ESC 바이트가 이스케이프되어 `\u001b[32m` 이라는 리터럴 문자열이 화면에 찍힌다.

```ts
/** color 가 false 면 원문 그대로 반환한다. */
const sgr = (code: string, text: string, color: boolean): string =>
  color ? `\u001b[${code}m${text}\u001b[0m` : text;
```

### 4-4. 줄 조립 규칙 (전량)

기대 문자열을 테스트가 전문 비교하므로 공백 하나까지 확정한다.

```
헤더        `${escapedSuiteName}${GAP}(${total} ${total === 1 ? "case" : "cases"})`
빈 줄       ""
케이스 줄   `${mark} ${pad(escapedCaseId, idColumn)}${GAP}${escapedCaseName}`
케이스 진단 `${INDENT}${escapedMessage}`
케이스 힌트 `${INDENT}해결: ${escapedHint}`
단언 줄     `${INDENT}${pad(escapedType, typeColumn)}${GAP}${prefix}${escapedMessage}`
위반 줄     `${INDENT}→ ${escapedViolationMessage}`
단언 힌트   `${INDENT}해결: ${escapedHint}`
빈 줄       ""
중단 줄     §4-5
빈 줄       ""            (중단 줄이 있을 때만)
요약 줄     `${items.join(", ")}${GAP}(${total} total)`
```

- `mark` 뒤는 공백 **한 칸**이다. `GAP` 이 아니다.
- `idColumn` 은 보고서 안 모든 케이스의 이스케이프된 `caseId` 폭 중 최댓값이다.
- `typeColumn` 은 **그 케이스 안에서 출력되는 단언들**의 이스케이프된 `spec.type` 폭 중
  최댓값이다. 보고서 전체가 아니다.
- `prefix` 는 단언 `status` 가 `"skipped"` 이면 `"(건너뜀) "`, 아니면 `""` 이다.
- 위반 줄의 화살표는 `→` 이며 뒤에 공백 한 칸이 온다.
- 전체 문자열은 각 줄을 `"\n"` 으로 연결하고 마지막에 `"\n"` 하나를 더한다. `"\r\n"` 을 쓰지
  않는다.

### 4-5. 중단 줄 (전량)

```ts
const stopReasonLine = (
  stopReason: NonNullable<RunnerReport["stopReason"]>,
  escape: (value: string) => string,
): string =>
  stopReason.type === "timeout"
    ? `중단: 케이스 '${escape(stopReason.caseId)}' 타임아웃으로 실행을 멈췄습니다.`
    : stopReason.caseId === undefined
      ? "중단: 외부 요청으로 실행을 멈췄습니다."
      : `중단: 외부 요청으로 실행을 멈췄습니다. 마지막 케이스 '${escape(stopReason.caseId)}'`;
```

### 4-6. 색상 적용 지점 (전량)

`options.color` 가 `true` 일 때만 적용한다. 아래 두 곳 외에는 색을 넣지 않는다.

```ts
// 1. 케이스 상태 기호
const mark = sgr(MARKS[result.status].sgr, MARKS[result.status].glyph, color);

// 2. "해결: " 로 시작하는 줄 전체. 들여쓰기를 포함해 감싼다.
const hintLine = sgr("2", `${INDENT}해결: ${escapedHint}`, color);
```

진단 문장 본문, 위반 줄, 헤더, 요약 줄, 케이스 이름에는 색을 넣지 않는다.

### 4-7. 출력 대상 판정 (전량)

무엇을 그리고 무엇을 생략하는지가 사양이다.

| 대상 | 조건 |
|---|---|
| 케이스 줄 | 항상. 모든 케이스를 `report.cases` 순서 그대로 |
| 케이스 진단·힌트 | `result.status !== "passed"` 이고 `result.operation.diagnostic !== undefined` |
| 단언 줄 | 단언 `status` 가 `"failed"` 또는 `"skipped"` |
| 단언 위반 줄 | 그 단언의 `diagnostic.violations` 가 있고 길이가 1 이상 |
| 단언 힌트 | 단언 줄을 그린 경우 항상 |
| 중단 줄 | `report.stopReason !== undefined` |

`status` 가 `"passed"` 또는 `"notRun"` 인 단언은 그리지 않는다. `diagnostic` 이 없는 단언은
그리지 않는다(계약상 `failed` 와 `skipped` 는 항상 `diagnostic` 을 갖는다. 방어적으로
`undefined` 면 그 단언 전체를 건너뛴다).

### 4-8. `packages/cli/src/test-command.ts` 변경 계약

```ts
export interface TestCommandInput {
  readonly suitePath: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly json: boolean;
}

export interface TestCommandDependencies {
  readFile(path: string): Promise<Uint8Array>;
  validateSuite(input: unknown): SuiteValidationResult;
  connect(options: { command: string; args: readonly string[] }): Promise<McpStdioConnection>;
  startRunner(options: RunSuiteOptions): RunnerExecution;
  finalize(options: FinalizeRunnerExecutionOptions): Promise<RunnerReport>;
  renderReport(report: RunnerReport, options?: { color?: boolean }): string;
  colorEnabled: boolean;
  writeStdout(text: string): void;
  writeStderr(text: string): void;
}
```

`renderReport` 를 주입하는 이유는 테스트가 전달된 `color` 값을 관찰해야 하기 때문이다.
`colorEnabled` 를 불리언으로 주입하는 이유는 `runCli` 가 `process` 를 읽지 않게 하기 위해서다.

`runCli` 끝의 출력 블록만 바꾼다.

```ts
try {
  dependencies.writeStdout(
    input.json
      ? `${JSON.stringify(finalReport, null, 2)}\n`
      : dependencies.renderReport(finalReport, { color: dependencies.colorEnabled }),
  );
} catch {
  return writeFailure(dependencies, {
    code: "CLI_INTERNAL_ERROR",
    ...dictionary.CLI_INTERNAL_ERROR,
  });
}
return finalReport.status === "passed" ? 0 : 1;
```

`parseTestCommand` 에 플래그를 더한다. 기존 옵션 처리 루프 안에 분기를 넣는다.

```ts
} else if (token === "--json") {
  if (json) fail("`--json`은 한 번만 사용할 수 있습니다.");
  json = true;
} else if (token.startsWith("--json=")) {
  fail("`--json`은 값을 받지 않습니다.");
} else if (token.startsWith("-")) fail(`지원하지 않는 test 옵션 '${token}'입니다.`);
```

`--json=` 분기를 `--json` 분기보다 **뒤**, `startsWith("-")` 분기보다 **앞**에 둔다. 순서가
어긋나면 `--json=true` 가 "지원하지 않는 옵션"으로 분류되어 문장이 달라진다.

### 4-9. `packages/cli/src/index.ts` 합성 지점

```ts
// unavailableDependencies 에 추가
renderReport: (): never => {
  throw new Error("runtime dependencies unavailable");
},
colorEnabled: false,

// test 실행 경로의 runCli 인자에 추가
renderReport: runner.renderReport,
colorEnabled: process.stdout.isTTY === true && process.env.NO_COLOR === undefined,
```

`process` 를 읽는 유일한 지점이다.

## 5. 태스크

### Task T1 — runner 렌더러

**Files**

- 신규: `packages/runner/src/reporter.ts`
- 수정: `packages/runner/src/index.ts` (재수출)
- 신규: `packages/runner/tests/reporter.test.ts`
- 신규: `docs/adr/0013-렌더러-배치와-진단-무분기.md`

**입력** 없음. 이 웨이브의 첫 태스크다.

**산출** §4-1부터 §4-7까지 전부. T2가 `renderReport` 를 소비한다.

**구현 순서**

1. `reporter.test.ts` 에 아래 테스트를 먼저 쓰고 실패를 확인한다.
2. `reporter.ts` 를 구현한다. §4-2부터 §4-7의 코드와 규칙을 그대로 쓴다.
3. `index.ts` 에서 재수출한다.
4. ADR-0013을 쓴다. 배경 / 선택지 / 결정 / 이유 / 결과 다섯 항목, 한 페이지.

**픽스처 방침**

테스트 파일 안에 `RunnerReport` 를 만드는 헬퍼를 둔다. 외부 픽스처 파일을 만들지 않는다.
`spec` 필드는 실제 `TestCaseSpec` 모양을 만족해야 타입이 통과한다.

**문안을 단언하지 않는다.** 설계 문서 §3.3대로 문안은 `diagnostics.ts` 소유이고
`body-diagnostics.test.ts` 가 이미 고정한다. 이 테스트가 쓰는 `message` 와 `hint` 는 헬퍼가
넣는 임의 문자열이며, 렌더러가 그것을 **어디에 놓는지**만 본다.

**테스트 케이스와 단언 전량**

`packages/runner/tests/reporter.test.ts`

| 테스트 이름 | 핵심 단언 |
|---|---|
| `전부 통과한 보고서를 그린다` | 출력 전문이 기대 문자열과 동일 |
| `실패 케이스의 진단과 힌트를 그린다` | 출력 전문이 기대 문자열과 동일 |
| `위반 목록을 화살표 줄로 그린다` | `→` 로 시작하는 줄 수가 `violations.length` 와 같음 |
| `통과한 단언은 그리지 않는다` | 출력에 그 단언의 `spec.type` 문자열이 없음 |
| `notRun 단언은 그리지 않는다` | 출력 줄 수가 기대와 같음 |
| `skipped 단언에 건너뜀 접두를 붙인다` | 해당 줄이 `(건너뜀) ` 를 진단 message 앞에 포함 |
| `diagnostic이 없는 failed 단언은 건너뛴다` | 예외 없이 반환, 그 단언 줄이 없음 |
| `케이스 레벨 진단을 단언 이름 없이 그린다` | 타임아웃 케이스 출력 전문이 기대와 동일 |
| `passed 케이스의 operation 진단은 그리지 않는다` | `passed` + `operation.diagnostic` 있는 케이스에서 그 message가 출력에 없음 |
| `다섯 상태 기호를 각각 쓴다` | 다섯 상태를 한 보고서에 넣고 각 기호가 정확히 1회 등장 |
| `caseId 열을 가장 긴 것에 맞춘다` | 모든 케이스 줄에서 케이스 이름의 시작 인덱스가 동일 |
| `단언 타입 열을 케이스 안에서 맞춘다` | 한 케이스의 두 단언 줄에서 message 시작 인덱스가 동일 |
| `단언 타입 열은 케이스마다 독립이다` | 케이스 A의 단언 줄 열 너비가 케이스 B의 더 긴 단언 이름에 영향받지 않음 |
| `케이스 순서를 유지한다` | 출력 케이스 줄 순서가 `report.cases` 순서와 동일 |
| `stopReason 타임아웃 줄을 그린다` | `중단: 케이스 'slow-call' 타임아웃으로 실행을 멈췄습니다.` 포함 |
| `stopReason abortSignal에 caseId가 있으면 그린다` | `마지막 케이스 'weather-seoul'` 포함 |
| `stopReason abortSignal에 caseId가 없으면 생략한다` | `중단: 외부 요청으로 실행을 멈췄습니다.` 로 끝나고 `마지막 케이스` 미포함 |
| `stopReason이 없으면 중단 줄이 없다` | 출력에 `중단:` 미포함 |
| `요약에서 0인 항목을 생략한다` | 요약 줄이 `2 passed, 1 failed  (3 total)` |
| `요약 항목 순서가 고정이다` | 다섯 항목이 모두 0이 아닐 때 요약 줄이 `1 passed, 1 failed, 1 timed out, 1 cancelled, 1 not run  (5 total)` |
| `단수 케이스에 case를 쓴다` | 헤더가 `(1 case)` 로 끝남 |
| `복수 케이스에 cases를 쓴다` | 헤더가 `(3 cases)` 로 끝남 |
| `문자열이 개행 하나로 끝난다` | `endsWith("\n")` 참이고 `endsWith("\n\n")` 거짓 |
| `CRLF를 쓰지 않는다` | 출력에 `"\r"` 없음 |
| `같은 보고서를 두 번 그리면 같다` | 두 호출 결과가 `===` |
| `케이스 이름의 제어 문자를 이스케이프한다` | `spec.name` 에 `"\u001b[2J"` 를 넣으면 출력에 `"\u001b"` 없고 `"\\u001b"` 있음 |
| `위반 메시지의 제어 문자를 이스케이프한다` | `violations[0].message` 에 넣어도 동일 |
| `caseId의 제어 문자를 이스케이프한다` | `caseId` 에 넣어도 동일 |
| `중단 줄의 caseId도 이스케이프한다` | `stopReason.caseId` 에 넣어도 동일 |
| `이스케이프 뒤 길이로 열을 맞춘다` | 제어 문자가 든 `caseId` 와 없는 `caseId` 를 섞어도 이름 시작 인덱스가 동일 |
| `색상 옵션이 없으면 ANSI가 없다` | 출력에 `"\u001b"` 없음 |
| `색상 옵션이 false여도 ANSI가 없다` | `{ color: false }` 에서 기본값 호출과 결과가 `===` |
| `색상 옵션이 true면 상태 기호에 SGR을 붙인다` | 출력 전문이 기대 문자열과 동일 |
| `색상은 이스케이프 뒤에 넣는다` | 제어 문자가 든 이름 + `color: true` 에서 `"\u001b[31m"` 이 온전히 등장 |
| `해결 줄만 흐리게 한다` | `color: true` 에서 `"\u001b[2m"` 등장 횟수가 해결 줄 수 + 흐린 기호 수와 같음 |
| `색상은 줄 수를 바꾸지 않는다` | `color: true` 와 `false` 의 `split("\n").length` 가 같음 |

**표적 검증** `pnpm vitest run packages/runner/tests/reporter.test.ts`

**전체 회귀** `pnpm build && pnpm typecheck && pnpm lint && pnpm test`

**실패 시 보고 경계** `packages/runner` 밖의 파일을 고쳐야 통과한다고 판단되면 고치지 말고
`BLOCKED` 로 보고한다. 특히 `diagnostics.ts` 의 문안을 고쳐야 할 것 같으면 그것은 신호가
아니라 이 태스크의 오해다. 렌더러 테스트는 문안을 단언하지 않는다.

---

### Task T2 — cli 출력 계약

**Files**

- 수정: `packages/cli/src/test-command.ts`
- 수정: `packages/cli/src/index.ts`
- 수정: `packages/cli/tests/test-command.test.ts`
- 신규: `docs/adr/0012-cli-기본-출력-전환.md`
- 신규: `.changeset/` 아래 파일 1개

**입력** T1의 `renderReport` 와 `RenderReportOptions`.

**산출** §4-8과 §4-9.

**구현 순서**

1. `test-command.test.ts` 의 기존 테스트 중 깨지는 것을 먼저 확인한다.
   `packages/cli/tests/test-command.test.ts:185` 가
   `expect(d.writes.out.join("")).toBe(`${JSON.stringify(report(status), null, 2)}\n`)` 를
   단언한다. 이 테스트("통과, 실패와 중단 report를 stdout으로만 출력한다")는 `--json` 을 붙인
   호출로 바꾼다. 지우지 않는다. JSON 경로의 바이트 동일성이 완료 조건이다.
2. 아래 신규 테스트를 쓰고 실패를 확인한다.
3. `test-command.ts` 를 §4-8대로 고친다.
4. `index.ts` 를 §4-9대로 고친다.
5. ADR-0012와 changeset을 쓴다.

**테스트 케이스와 단언 전량**

`packages/cli/tests/test-command.test.ts` 추가분

| 테스트 이름 | 핵심 단언 |
|---|---|
| `--json 없이 renderReport 결과를 stdout에 쓴다` | `writes.out.join("")` 이 주입한 `renderReport` 의 반환값과 동일 |
| `--json이면 기존 JSON 바이트를 쓴다` | `writes.out.join("")` 이 `${JSON.stringify(report, null, 2)}\n` 과 동일 |
| `--json이면 renderReport를 호출하지 않는다` | 주입한 `renderReport` 스파이의 호출 횟수가 0 |
| `colorEnabled를 renderReport에 그대로 넘긴다` | `renderReport` 스파이가 `{ color: true }` 로 호출됨 |
| `colorEnabled가 false면 그대로 넘긴다` | `renderReport` 스파이가 `{ color: false }` 로 호출됨 |
| `--json을 두 번 쓰면 거절한다` | 종료 코드 1, stderr에 `` `--json`은 한 번만 사용할 수 있습니다. `` |
| `--json=true를 거절한다` | 종료 코드 1, stderr에 `` `--json`은 값을 받지 않습니다. `` |
| `--json은 순서와 무관하다` | `--json` 을 `--command` 앞에 둔 경우와 뒤에 둔 경우의 stdout이 동일 |
| `종료 코드는 --json 여부와 무관하다` | 같은 실패 보고서에서 두 경로 모두 1 |
| `renderReport가 던지면 CLI_INTERNAL_ERROR가 된다` | 종료 코드 1, stderr에 `CLI_INTERNAL_ERROR`, stdout 비어 있음 |
| `parseTestCommand가 json 기본값 false를 낸다` | `--json` 없는 argv에서 `input.json === false` |
| `parseTestCommand가 json true를 낸다` | `--json` 있는 argv에서 `input.json === true` |

**changeset 내용**

```markdown
---
"@ohmymcp-hsu/runner": minor
"ohmymcp": minor
---

`ohmymcp test` 의 기본 출력을 사람이 읽는 보고서로 바꿉니다. 실패한 케이스의 진단 문장과
해결 힌트를 터미널에 직접 표시합니다.

**파괴적 변경**: 기존의 JSON 출력은 `--json` 플래그로 옮겼습니다. stdout을 기계로 파싱하던
스크립트는 `ohmymcp test ... --json` 으로 바꿔야 합니다. `--json` 출력의 바이트는 이전과
동일합니다. 종료 코드는 바뀌지 않았습니다.
```

`ohmymcp` 를 major 가 아니라 minor 로 올린다. 현재 버전이 `0.2.0` 이라 major 는 `1.0.0` 이
되고 그것은 아직 주장할 수 없는 안정성 선언이다.

**표적 검증** `pnpm vitest run packages/cli/tests/test-command.test.ts`

**전체 회귀** `pnpm build && pnpm typecheck && pnpm lint && pnpm test`

`pnpm test` 에 `packages/cli/tests/cli-integration.test.ts` 가 포함되며 그 파일은 T3에서
고친다. **T2 시점에 그 두 테스트가 실패하는 것은 예상된 상태다.** 실패 내용이
`JSON.parse` 오류인지 확인하고, 다른 실패가 섞여 있지 않은지 본 뒤 T3로 넘어간다. 이 실패를
고치려고 `cli-integration.test.ts` 를 T2에서 만지지 않는다.

**실패 시 보고 경계** `packages/cli/src/generate-command.ts` 나 `packages/runner` 를 고쳐야
통과한다고 판단되면 고치지 말고 `BLOCKED` 로 보고한다.

---

### Task T3 — 실환경 검증 (직렬 전용)

**Files**

- 수정: `packages/cli/tests/cli-integration.test.ts`
- 수정: `packages/cli/tests/generate-integration.test.ts`
- 수정: `packages/cli/tests/dist-cli-e2e.mjs`

**입력** T1과 T2의 산출 전부. 빌드된 `packages/cli/dist/cli.mjs` 가 필요하므로 반드시
`pnpm build` 뒤에 실행한다.

**직렬 전용인 이유** `examples/weather-server` 의 실제 프로세스를 띄운다.
`CLAUDE.local.md` 규칙상 유닛테스트와 같은 웨이브에서 돌리지 않는다.

**`cli-integration.test.ts` 변경**

`JSON.parse` 를 쓰는 두 지점(`:96`, `:137`)이 있다. 두 테스트의 argv에 `--json` 을 추가한다.
그 외에는 손대지 않는다.

그리고 렌더링 경로를 보는 테스트를 하나 추가한다.

| 테스트 이름 | 핵심 단언 |
|---|---|
| `--json 없이 실패 케이스의 진단 문장을 stdout에 쓴다` | stdout에 `$.temperature: 필수 필드가 없습니다.` 포함, `JSON.parse` 가 던짐, 종료 코드 1 |

이 테스트가 쓰는 스위트는 `packages/cli/tests/fixtures/weather-body-assertion-failing.suite.json`
이다. 응답 본문 단언 웨이브가 만든 파일이며 새로 만들지 않는다.

**`generate-integration.test.ts` 변경**

이 파일도 `test` 서브커맨드의 stdout을 `JSON.parse` 한다. 계획서 초판이 놓쳤고 T2 실행 중에
발견해 여기에 더한다. `run([...])` 의 인자 배열 두 곳(`:154`, `:296`) 끝에 `"--json"` 을
추가한다. `:111` 의 `JSON.parse` 는 생성된 스위트 **파일**을 읽는 것이라 손대지 않는다.
`generate` 서브커맨드 호출에는 `--json` 을 붙이지 않는다.

**`dist-cli-e2e.mjs` 변경**

`test` 서브커맨드를 실행하는 지점이 셋이다. 각각에 `--json` 을 추가한다. `generate`
서브커맨드 호출에는 추가하지 않는다.

1. `for (const [fixture, expectedStatus, expectedSummary] of [...])` 루프 안의 `execute([...])`
2. `generate` 블록 뒤의 `execute([...])` (생성된 baseline 스위트를 실행하는 지점)
3. 본문 단언 블록의 `const args = [...]`

각 배열의 마지막 원소 뒤에 `"--json"` 을 추가한다. 위치는 배열 끝이면 된다. `--arg` 값으로
오해되지 않도록 `--arg` 값들 뒤에 둔다.

그리고 파일 끝에 렌더링 경로 블록을 추가한다.

```js
{
  const dir = await mkdtemp(join(tmpdir(), "ohmymcp-dist-render-"));
  const pidFile = join(dir, "pid");
  const args = [
    "test",
    join(here, "fixtures", "weather-body-assertion-failing.suite.json"),
    "--command",
    process.execPath,
    "--arg",
    wrapper,
    "--arg",
    pidFile,
    "--arg",
    server,
  ];
  try {
    const first = await execute(args);
    assert.equal(first.code, 1);
    assert.equal(first.err, "");
    // 사람용 출력이므로 JSON 이 아니다.
    assert.throws(() => JSON.parse(first.out));
    // 실패 메시지가 곧 제품이다. 진단 문장이 실제로 사람 눈앞에 오는지 본다.
    assert.ok(
      first.out.includes(
        "$.temperature: 필수 필드가 없습니다. 발견된 필드: 'city', 'condition', 'temp'",
      ),
      `진단 문장이 stdout에 없습니다. 실제 출력:\n${first.out}`,
    );
    assert.ok(first.out.includes("해결: "), "해결 힌트 줄이 없습니다.");
    // 색상 없이 나와야 한다. 자식 프로세스의 stdout 은 파이프이므로 TTY 가 아니다.
    assert.ok(!first.out.includes("\u001b"), "TTY 가 아닌데 ANSI 시퀀스가 있습니다.");
    assert.ok(!first.out.includes("\r"), "CRLF 를 쓰고 있습니다.");
    await expectExited(pidFile);

    // 결정론성: 같은 입력 2회 실행의 표준 출력 바이트가 같아야 한다.
    const second = await execute(args);
    assert.equal(second.out, first.out);
    await expectExited(pidFile);
  } finally {
    await cleanupPid(pidFile);
    await rm(dir, { recursive: true, force: true });
  }
}
```

**표적 검증**

```
pnpm build && node packages/cli/tests/dist-cli-e2e.mjs
pnpm vitest run packages/cli/tests/cli-integration.test.ts
```

`pnpm build` 를 빼먹으면 낡은 `dist/cli.mjs` 를 돌려 `--json` 을 모르는 CLI로 판정한다.
그 경우 증상은 `지원하지 않는 test 옵션 '--json'입니다.` 이며 종료 코드 1이다.
`CLAUDE.local.md` 거짓 신호 표의 "결함이 계속 재현 / 빌드 산출물이 낡음" 항목이다.

**전체 회귀** `pnpm build && pnpm typecheck && pnpm lint && pnpm test`

**실패 시 보고 경계** `packages/cli/src/` 나 `packages/runner/` 를 고쳐야 통과한다고 판단되면
고치지 말고 `BLOCKED` 로 보고한다. T3의 승인 범위는 위 두 테스트 파일뿐이다.

## 6. 웨이브와 터미널 분할

의존이 직렬이라 병렬이 없다. **터미널 1개, worktree 1개, 브랜치 1개**다.

```
T1 runner 렌더러  →  T2 cli 출력 계약  →  T3 실환경 검증
```

| 태스크 | 선행 | 쓰기 파일 겹침 |
|---|---|---|
| T1 | 없음 | 없음 |
| T2 | T1 | 없음 |
| T3 | T2 | 없음 |

파일은 겹치지 않지만 T2가 T1의 `renderReport` 를 import 하고, T3는 빌드된
`packages/cli/dist/cli.mjs` 가 T2까지의 산출을 담아야 하므로 순차다. T3는 실제 서버 프로세스를
띄우므로 `CLAUDE.local.md` 규칙상 직렬 전용이다.

worktree 경로: `.claude/worktrees/ohmymcp-cli-report-rendering`
브랜치: `feat/cli-report-rendering`

## 7. 모델 배분

| 태스크 | 모델 | 근거 |
|---|---|---|
| 오케스트레이터 세션 | 상위 | 리뷰와 머지 게이트 |
| T1 | **상위** | 실패 메시지가 사람에게 닿는 표면을 만든다. 이스케이프·패딩·색상의 적용 순서가 틀리면 조용히 사고가 나고, 결정론성 판정이 이 태스크에 걸려 있다. `CLAUDE.local.md` 모델 배분표의 상위 모델 예외 중 "실패 메시지 문안 설계" 항목에 해당한다 |
| T2 | 표준 | 계약이 §4-8과 §4-9에 코드 수준으로 전량 적혀 있다. 위임만 하는 CLI 커맨드 변경이다 |
| T3 | 표준 | 변경 지점과 단언이 §5 T3에 전량 적혀 있다 |

## 8. 사람 몫 사전 조건

터미널을 열기 전에 프로젝트 루트에서 확인한다.

```
git log --oneline -1     # 아래 두 조건을 만족하는 커밋이 HEAD인지
git status --short       # 깨끗한지
```

두 조건.

1. **`feat/runner-body-assertion` 브랜치가 머지돼 있어야 한다.** 이 계획은 그 브랜치가 만든
   `RunnerDiagnostic.violations`, `hint`, `packages/cli/tests/fixtures/weather-body-assertion-failing.suite.json`
   에 의존한다. `ls packages/runner/src/body.ts` 로 확인할 수 있다.
2. **설계 문서와 이 계획서가 커밋돼 있어야 한다.** untracked면 새 worktree에 딸려가지 않아
   서브에이전트가 문서를 읽지 못한다. 커밋은 사람이 한다.

## 9. 실행 프롬프트

### 터미널 1 — Task T1 · T2 · T3 (순차)

권장 실행 설정: 상위 모델, 추론 수준 high. 이 세션은 오케스트레이터이며 태스크마다 서브에이전트를
스폰한다.

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

이 저장소의 루트에서
  git worktree add .claude/worktrees/ohmymcp-cli-report-rendering -b feat/cli-report-rendering
를 실행한 뒤 세션을 방금 만든 .claude/worktrees/ohmymcp-cli-report-rendering 로 옮겨라.

진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 BLOCKED로 보고해라:
  - pwd가 .claude/worktrees/ohmymcp-cli-report-rendering 로 끝나는지
  - git log --oneline -1 이 루트에서 본 기점 커밋과 같은지
  - docs/superpowers/plans/2026-08-13-cli-report-rendering-implementation.md 와
    docs/superpowers/specs/2026-08-13-cli-report-rendering-design.md 가 실제로 존재하는지
  - packages/runner/src/body.ts 와 packages/runner/src/schema-match.ts 가 존재하는지
    (없으면 응답 본문 단언 웨이브가 머지되지 않은 것이다. 중단해라)
  - packages/cli/tests/fixtures/weather-body-assertion-failing.suite.json 이 존재하는지
  - git status --short 가 비어 있는지
  - pnpm install 을 실행한 뒤 pnpm build 와 pnpm vitest run packages/runner 가 실제로 실행되는지

[2단계: 실행]

역할: 오케스트레이터. 직접 구현하지 않는다. 태스크마다 서브에이전트를 스폰하고, 보고를 받으면
직접 diff와 테스트 결과를 확인한 뒤 다음 태스크로 넘어간다.

계획서 docs/superpowers/plans/2026-08-13-cli-report-rendering-implementation.md 의
3장(Global Constraints), 4장(공유 계약), 5장(태스크)을 읽어라. 4장의 코드는 그대로 쓴다.

태스크 순서는 T1 → T2 → T3 이며 병렬 실행은 없다. T2 는 T1 이 만든 renderReport 를 import
하고, T3 는 빌드된 packages/cli/dist/cli.mjs 가 T2 까지의 산출을 담아야 하므로 마지막이다.

T2 를 끝낸 시점에 packages/cli/tests/cli-integration.test.ts 의 두 테스트가 실패한다. 이것은
예상된 상태이며 T3 가 고친다. 실패 내용이 JSON.parse 오류인지만 확인하고 넘어가라. T2
서브에이전트에게 그 파일을 고치게 하지 마라.

각 서브에이전트에게 아래를 그대로 지시해라:
  - 계획서 5장의 해당 Task 절만 읽고 그대로 구현할 것
  - 그 Task의 Files 목록에 있는 파일만 수정할 것
  - 테스트를 먼저 쓰고 실패를 실제로 확인한 뒤 구현할 것
  - 계획서에 적힌 테스트 케이스와 단언을 하나도 빠뜨리지 말 것
  - 표적 검증과 전체 회귀 검증을 모두 실행할 것
  - 보고서를 worktree 안의 docs/reports/task-c1.md (또는 c2, c3)에 쓸 것
  - 보고서에 pwd, git rev-parse HEAD, 변경 파일 목록, 실행한 검증 명령과 결과 원문,
    임의로 판단한 부분을 적을 것
  - 최종 응답을 "status: READY_FOR_REVIEW" 또는 "status: BLOCKED" 로 시작할 것

서브에이전트 스폰 설정:
  T1  상위 모델, 추론 수준 high, 일반 구현 에이전트(general-purpose)
      T1은 실패 메시지가 사람에게 닿는 표면이고, 이스케이프·패딩·색상의 적용 순서가 틀리면
      조용히 사고가 나므로 상위 모델을 쓴다.
  T2  표준 모델, 추론 수준 medium, 일반 구현 에이전트(general-purpose)
  T3  표준 모델, 추론 수준 medium, 일반 구현 에이전트(general-purpose)

T1 서브에이전트에게 아래 금지 사항을 그대로 전달해라:
  - packages/runner 밖의 파일을 수정하지 마라. 특히 packages/core, packages/cli,
    packages/generate, packages/record, packages/mock, 루트 package.json, turbo.json,
    tsconfig.base.json, vitest.config.ts 는 공유 계약이다. 안 맞아 보여도 고치지 말고
    BLOCKED로 보고해라.
  - packages/runner/src/diagnostics.ts 의 문안을 한 글자도 바꾸지 마라. 렌더러는 배치만 한다.
    렌더러 테스트는 문안을 단언하지 않는다.
  - core/src/types.ts 의 McpClient 와 ToolResult 는 변경 금지다.
  - 색상 라이브러리나 문자 폭 라이브러리를 추가하지 마라. 목록에 없는 의존성 추가 금지다.
  - 문자열 리터럴에 raw ESC 바이트를 넣지 마라. "\u001b" 로 써라.
  - 유닛테스트는 인메모리만 쓴다. examples/ 의 실제 서버 프로세스를 띄우지 마라.
  - git 명령(커밋, 머지, 푸시)을 실행하지 마라.
  - 백그라운드 실행과 하위 에이전트 스폰을 하지 마라.
  - 산문에 대시 기호를 쓰지 마라. 주석과 문서는 한국어로 써라.

T2 서브에이전트에게는 위 금지 사항 중 첫 항목을 아래로 바꿔 전달해라. 나머지는 같다:
  - 수정해도 되는 파일은 packages/cli/src/test-command.ts, packages/cli/src/index.ts,
    packages/cli/tests/test-command.test.ts, docs/adr/0012-cli-기본-출력-전환.md,
    .changeset/ 아래 새 파일 하나뿐이다.
    packages/cli/src/generate-command.ts 와 packages/runner/ 는 수정 금지다.
    packages/cli/tests/cli-integration.test.ts 도 T2 에서는 수정 금지다. T3 가 고친다.
  - pnpm test 에서 cli-integration.test.ts 의 두 테스트가 실패하는 것은 예상된 상태다.
    그것을 고치려 하지 말고 보고서에 실패 내용을 그대로 적어라.

T3 서브에이전트에게는 위 금지 사항 중 첫 항목을 아래로 바꿔 전달해라. 나머지는 같다:
  - 수정해도 되는 파일은 packages/cli/tests/cli-integration.test.ts 와
    packages/cli/tests/dist-cli-e2e.mjs 둘뿐이다.
    packages/cli/src/ 와 packages/runner/ 는 수정 금지다. 고쳐야 통과한다고 판단되면
    고치지 말고 BLOCKED로 보고해라.
  - T3는 examples/weather-server 의 실제 프로세스를 띄운다. 이 태스크에 한해 허용한다.
  - node packages/cli/tests/dist-cli-e2e.mjs 를 돌리기 전에 반드시 pnpm build 를 먼저 해라.
    빼먹으면 --json 을 모르는 낡은 dist/cli.mjs 로 판정한다. 그 경우 증상은
    "지원하지 않는 test 옵션 '--json'입니다." 이다.

태스크 사이 리뷰에서 네가 직접 확인할 것:
  - 변경 파일이 그 Task의 Files 목록을 벗어나지 않았는지 git status --short 로 확인
  - 계획서에 적힌 테스트 케이스가 실제로 존재하는지 테스트 파일을 열어 대조
  - pnpm build && pnpm typecheck && pnpm lint && pnpm test 를 네가 직접 다시 실행
  - 타입체크와 린트 출력에서 검사한 파일 수가 0이 아닌지 확인
  - grep -rP '\x1b' packages/runner/src packages/cli/src 가 비어 있는지 확인
    (소스에 raw ESC 바이트가 들어가면 안 된다)
  - 서브에이전트의 "완료" 선언만으로 다음 태스크를 시작하지 마라

T3까지 끝나면 아래를 확인하고 사용자에게 보고해라:
  - packages/runner/src/index.ts 가 renderReport 와 RenderReportOptions 를 재수출하는지
  - docs/adr/0012-cli-기본-출력-전환.md 와
    docs/adr/0013-렌더러-배치와-진단-무분기.md 가 존재하는지
  - .changeset/ 에 @ohmymcp-hsu/runner minor 와 ohmymcp minor 를 담은 파일이 있는지
  - pnpm build && node packages/cli/tests/dist-cli-e2e.mjs 가 통과하는지
  - E2E의 결정론성 단언(같은 입력 2회 실행의 표준 출력 바이트 일치)이 렌더링 경로에도
    들어 있는지
  - --json 경로의 stdout 바이트가 이 웨이브 이전과 같은지
  - 실제로 사람이 보게 될 출력을 한 번 눈으로 확인하고 보고에 붙여라:
      pnpm build
      node packages/cli/dist/cli.mjs test packages/cli/tests/fixtures/weather-body-assertion-failing.suite.json --command node --arg examples/weather-server/server.mjs

커밋과 머지는 하지 마라. 사람이 한다.
```

## 10. 통합 게이트

1. 세 태스크의 보고서(`docs/reports/task-c1.md` ~ `task-c3.md`)를 직접 읽는다.
2. `git diff` 로 변경 파일이 각 Task의 Files 목록 안에 있는지 확인한다.
   특히 `packages/runner/src/diagnostics.ts` 변경이 하나도 없어야 한다.
3. `pnpm build && pnpm typecheck && pnpm lint && pnpm test` 를 오케스트레이터가 직접 실행한다.
4. `pnpm build && node packages/cli/tests/dist-cli-e2e.mjs` 를 직접 실행한다.
   `pnpm build` 를 생략하지 않는다.
5. 실제 출력을 눈으로 확인한다. §9 마지막 명령을 직접 돌린다.
6. 통과하면 사람이 커밋하고 머지한다.
7. 머지 직후 `docs/task-integration-ledger.tsv` 에 `C1-cli-report-rendering` 등 태스크명과
   통합 SHA를 기록하고 별도 문서 커밋으로 보존한다.

## 11. 거짓 신호 점검

`CLAUDE.local.md` 의 표에 있는 항목 중 이 작업에서 실제로 밟을 가능성이 있는 것들이다.

| 거짓 신호 | 이 작업에서의 모습 | 진실 기준 |
|---|---|---|
| 타입체크·린트 녹색 | `reporter.ts` 가 tsconfig include 밖에 있으면 검사 대상 0 | 출력에서 검사한 파일 수를 확인 |
| 유닛테스트 녹색, 실행 시 실패 | 인메모리 픽스처만 통과하고 실제 CLI 경로는 `--json` 누락으로 깨짐 | T3의 `dist-cli-e2e.mjs` |
| 새 worktree에서 테스트 타임아웃 | `pnpm install` 누락 | 1단계 부트스트랩 확인 |
| 결함이 계속 재현 | `dist/cli.mjs` 가 낡음 | `pnpm build` 후 재확인 |
| 재생 테스트가 가끔 실패 | 색상 판정이 테스트 환경의 TTY 여부를 탐 | 렌더러 테스트는 `color` 를 명시적으로 넘김 |

이 작업 고유의 거짓 신호 셋을 추가로 적는다.

| 거짓 신호 | 원인 | 진실 기준 |
|---|---|---|
| 렌더링이 잘 되는 것처럼 보임 | 실패가 하나뿐인 픽스처만 봄 | 다섯 상태를 한 보고서에 넣은 픽스처 |
| 출력이 결정론적인 것처럼 보임 | 같은 프로세스에서 두 번 호출만 비교 | 두 번 **실행**의 stdout 바이트 비교(T3) |
| 이스케이프가 되는 것처럼 보임 | 색상 없는 경로만 확인 | 제어 문자 + `color: true` 조합에서 SGR이 온전한지 |

## 12. 자체 검토

- 설계 문서 §3~§7의 모든 요구가 T1·T2·T3 중 하나에 대응한다. §8(거짓 신호)은 §11에,
  §9(후속 작업)는 비범위에, §10(소유권)은 §6에, §11(ADR)은 T1과 T2의 Files에 대응한다.
- 공유 계약(§4)이 T1에 선행 배치됐고 T2가 소비한다. 세 태스크의 쓰기 파일이 겹치지 않는다.
- 각 스폰에 모델과 추론 수준이 명시됐다. 상위 모델을 고른 T1에 사유가 적혀 있다.
- T1과 T2의 테스트는 인메모리만 쓴다. 실제 서버를 띄우는 검증은 T3로 분리됐다.
- 태스크 사이 리뷰(§9)와 최종 통합 게이트(§10)가 있다.
- 판단이 갈리는 로직(이스케이프·패딩·색상의 순서, 줄 조립, 중단 줄, 출력 대상 판정)이 §4에
  전량 기재됐다. 매직넘버(들여쓰기 4칸, 구분 2칸, 다섯 기호, 요약 순서)에 근거가 붙어 있다.
- 모든 명령이 실제로 실행 가능하다. `pnpm vitest run <path>`, `node <path>`, `pnpm build`.
