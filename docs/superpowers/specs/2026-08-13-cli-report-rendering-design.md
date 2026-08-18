# CLI 보고서 렌더링 설계 (2026-08-13)

선행 설계: `docs/superpowers/specs/2026-08-13-response-body-assertion-design.md` (§11.2가 이 작업을 지목한다)
선행 구현: `docs/superpowers/plans/2026-08-13-response-body-assertion-implementation.md`
참조: `docs/superpowers/specs/2026-08-11-runner-design.md`

## 1. 배경

응답 본문 단언 웨이브가 진단 문장을 완성했다. `RunnerDiagnostic`은 `message`와 `hint`를 갖고,
`bodyMatchesSchema`는 `violations[]`에 위반별 완성된 문장까지 담는다.

그 문장이 사용자에게 닿지 않는다. `packages/cli/src/test-command.ts:315`가 보고서를 통째로
덤프한다.

```ts
dependencies.writeStdout(`${JSON.stringify(finalReport, null, 2)}\n`);
```

프로젝트 지침은 "실패 메시지가 곧 제품"이라고 규정한다. 지금 제품 표면은 들여쓰기된 JSON이다.
사용자가 `$.temperature: 필수 필드가 없습니다` 를 보려면 중괄호를 헤치고 들어가야 한다.

이 설계는 사람이 읽는 출력을 기본값으로 만들고, 기계용 JSON을 `--json` 뒤로 옮긴다.

## 2. 목표 / 비범위 / 완료 조건

### 목표

1. `RunnerReport`를 터미널 문장으로 그리는 렌더러를 `runner`에 추가한다.
2. `ohmymcp test`의 기본 stdout을 그 문장으로 바꾸고 `--json`으로 기존 출력을 보존한다.
3. 같은 보고서에 항상 같은 바이트를 만든다.
4. 서버 응답에서 온 문자열이 터미널 제어 시퀀스로 해석되지 않게 한다.

### 비범위

아래는 §9에 연동 계약을 남기고 이 웨이브에서 건드리지 않는다.

- **위반 클러스터링.** 같은 원인으로 묶어 보여주는 기능은 별도 웨이브다.
- **AI 요약과 repair.** provider 호출은 이 설계에 들어오지 않는다.
- **진행 상황 스트리밍.** `RunnerEvent` 구독은 하지 않는다. 최종 보고서만 그린다.
- **JUnit XML 리포터.** 자리만 열어 두고 만들지 않는다.
- **진단 문안 수정.** 문장은 `diagnostics.ts`가 소유한다. 렌더러는 배치만 한다.
- **stderr 오류 경로.** `format()`과 `escapeTerminalText`는 그대로 둔다.
- **`packages/core` `packages/generate` `packages/record` `packages/mock` 전체.**

### 완료 조건

- `pnpm build && pnpm typecheck && pnpm lint && pnpm test` 전부 통과. 타입체크와 린트는
  검사한 파일 수가 0이 아닌지 출력에서 확인한다.
- `packages/runner/tests/reporter.test.ts` 가 §7의 케이스를 모두 포함하고 통과한다.
- 같은 `RunnerReport`를 두 번 렌더한 문자열이 `===` 로 동일하다.
- `--json` 출력 바이트가 이 웨이브 이전과 동일하다.
- `pnpm build && node packages/cli/tests/dist-cli-e2e.mjs` 통과.
- `docs/adr/0012-cli-기본-출력-전환.md` 와 `docs/adr/0013-렌더러-배치와-진단-무분기.md` 존재.
- `.changeset/` 신규 파일 1개. `@ohmymcp-hsu/runner` minor, `ohmymcp` minor.
  CLI 패키지 이름은 `ohmymcp` 이며 `@ohmymcp-hsu/cli` 가 아니다. 출력 계약이 깨지지만 major 를
  쓰지 않는다. 현재 버전이 `0.2.0` 이라 major 는 `1.0.0` 이 되고, 그것은 우리가 아직 주장할 수
  없는 안정성 선언이다. 파괴적 변경 사실은 changeset 본문에 명시한다.

## 3. 아키텍처

### 3.1 배치

```
packages/runner/src/reporter.ts    (신규)  renderReport(report, options?) -> string
packages/cli/src/test-command.ts   (수정)  --json 파싱, 색상 판정, 문자열 write
```

렌더러를 `runner`에 두는 근거는 `CONTRIBUTING.md` §2.1이다. 오너 표가 `runner`의 책임 범위를
"공개 API 설계, matcher, **실패 메시지 품질**, 리포터, JUnit XML"로 규정한다. `RunnerReport`
타입을 소유한 쪽이 렌더도 소유하면 타입이 바뀔 때 한 패키지 안에서 끝난다. 나중에 JUnit XML
리포터를 붙일 자리도 같은 곳이다.

의존 방향은 `cli` → `runner` 단방향으로 유지된다. `reporter.ts`는 `runner` 안에서만 쓰이며
아무것도 역참조하지 않는다.

### 3.2 순수성 경계

`renderReport`는 순수 함수다. `process`, `stdout`, `isTTY`, `NO_COLOR`, `Date`, 로케일을
읽지 않는다. 환경 판정은 전부 `cli`가 한다.

```ts
export interface RenderReportOptions {
  /** ANSI 색상 사용 여부. 기본 false. */
  color?: boolean;
}

export function renderReport(report: RunnerReport, options?: RenderReportOptions): string;
```

`cli`가 넘기는 값은 아래 한 줄로 결정된다.

```ts
const color = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
```

이 분리가 결정론성 검증을 단순하게 만든다. 렌더러 테스트는 픽스처 보고서를 넣고 문자열
전문을 비교하면 끝난다. 터미널을 위장할 필요가 없다.

### 3.3 진단 코드로 분기하지 않는다

이 설계의 중심 원칙이다.

모든 `RunnerDiagnostic`이 `{ code, message, hint }` 를 갖는다. `bodyMatchesSchema`만
`violations[]` 를 추가로 갖고, 그 원소도 각자 완성된 `message` 를 갖는다. 따라서 렌더러가 할
일은 배치뿐이다.

```
diagnostic.message                  한 줄
diagnostic.violations?.[].message   있으면 각각 한 줄, "→ " 접두
diagnostic.hint                     "해결: " 접두로 한 줄
```

`switch (diagnostic.code)` 를 쓰지 않는다. 결과 셋.

1. `listTools`의 `inputSchema` 단언이나 `expectFailure` 가 나중에 추가돼도 렌더러를 안 고친다.
2. 문안 소유권이 `diagnostics.ts`에 남는다. 문장을 고치려면 진단 생성 지점을 고친다.
3. 렌더러 테스트가 문안을 다시 단언하지 않는다. 문안 단언은 `body-diagnostics.test.ts` 몫이다.

유일한 분기는 `violations` 배열의 존재 여부다. 이것은 코드 분기가 아니라 옵셔널 필드 처리다.

## 4. 출력 계약

### 4.1 변경 요약

| | 이전 | 이후 |
|---|---|---|
| `ohmymcp test ...` stdout | JSON 덤프 | 사람용 문장 |
| `ohmymcp test ... --json` | 없는 플래그 | 이전과 동일 바이트 |
| stderr | 오류 전용 | 그대로 |
| 종료 코드 | `passed` 면 0, 아니면 1 | 그대로 |

파괴적 변경이다. `--json` 없이 stdout을 파싱하던 소비자가 깨진다. 현재 소비자는
`packages/cli/tests/dist-cli-e2e.mjs` 하나뿐이며 이 웨이브에서 함께 고친다. npm 미배포
알파이므로 지금이 가장 싼 시점이다. ADR-0012에 기록한다.

### 4.2 `--json` 파싱

`parseTestCommand`에 불리언 플래그를 더한다. 값을 받지 않으므로 `--json=true` 형태는 거부한다.
중복 지정은 거부한다. 기존 옵션 오류 문장 형식을 따른다.

```ts
export interface TestCommandInput {
  readonly suitePath: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly json: boolean;
}
```

### 4.3 출력 분기

`runCli` 끝의 `writeStdout` 한 줄만 바뀐다. 그 앞의 모든 실패 경로는 손대지 않는다.

```ts
const text = input.json
  ? `${JSON.stringify(finalReport, null, 2)}\n`
  : renderReport(finalReport, { color });
dependencies.writeStdout(text);
```

`renderReport` 는 자기 끝에 개행을 포함해 반환한다. 호출부가 개행을 덧붙이지 않는다.

## 5. 레이아웃

### 5.1 전체 구조

```
{suite.name}  ({N} cases)
                                  <- 빈 줄
{케이스 줄}
{케이스 줄}
...
                                  <- 빈 줄
{중단 줄}                          <- stopReason 이 있을 때만, 그 뒤 빈 줄
{요약 줄}
```

문자열은 항상 개행 하나로 끝난다. 줄바꿈은 언제나 `"\n"` 이다. 플랫폼에 따라 `"\r\n"` 을 쓰지
않는다. 이 프로젝트는 Windows 경로 회귀를 이미 두 번 밟았다(`fix/cli-windows-test-isolation`,
`fix/generate-windows-regression`).

`cases` 가 빈 배열인 보고서는 들어오지 않는다. `EMPTY_CASES` 검증이 스위트 단계에서 막는다.

### 5.2 케이스 줄

```
{mark} {caseId 패딩}  {spec.name}
```

`mark` 는 `TestCaseResult.status` 로 정한다. 다섯 개로 고정이며 환경에 따라 바뀌지 않는다.

| status | 기호 | 코드 포인트 |
|---|---|---|
| `passed` | `✓` | U+2713 |
| `failed` | `✗` | U+2717 |
| `timedOut` | `⧖` | U+29D6 |
| `cancelled` | `⊘` | U+2298 |
| `notRun` | `·` | U+00B7 |

`caseId` 열은 보고서 안 **모든 케이스의 `caseId` 중 가장 긴 것**에 맞춰 오른쪽을 공백으로
채운다. 길이는 `Array.from(id).length`, 즉 코드 포인트 수로 센다.

> **알려진 한계.** 코드 포인트 수는 표시 폭과 다르다. `caseId` 에 한글이나 전각 문자가 섞이면
> 열이 어긋난다. 폭을 정확히 재려면 East Asian Width 표가 필요하고 그것은 새 의존성이거나
> 직접 관리하는 표다. 지금 픽스처의 `caseId` 는 전부 ASCII다. 정렬 흔들림보다 의존성 추가와
> 결정론성 리스크가 크다고 판단해 코드 포인트 수를 쓴다. `spec.name` 은 마지막 열이라 폭과
> 무관하다.

### 5.3 케이스 레벨 진단

`operation.diagnostic` 이 있고 케이스가 `passed` 가 아니면 케이스 줄 다음에 4칸 들여쓰기로
붙인다. 단언 이름을 붙이지 않는다. 단언까지 가지 못한 실패이기 때문이다.

```
⧖ slow-call              대용량 예보를 반환한다
    테스트 '대용량 예보를 반환한다'가 제한 시간 10000ms 안에 완료되지 않았습니다.
    해결: 서버 응답 지연과 테스트의 timeoutMs 설정을 확인하세요.
```

### 5.4 단언 줄

`status` 가 `failed` 또는 `skipped` 인 단언만 출력한다. `passed` 와 `notRun` 은 출력하지
않는다. 통과한 단언까지 찍으면 실패가 묻힌다.

```
    {spec.type 패딩}  {skipped 접두}{diagnostic.message}
    → {violations[i].message}
    해결: {diagnostic.hint}
```

- `spec.type` 열은 **그 케이스 안에서 출력되는 단언들** 중 가장 긴 타입 이름에 맞춰 채운다.
  보고서 전체가 아니라 케이스 단위다. 한 케이스의 단언들이 서로 정렬되면 충분하고, 케이스마다
  독립적이면 케이스 하나를 고쳐도 다른 케이스의 바이트가 안 흔들린다.
- `skipped` 접두는 `"(건너뜀) "` 이다. 원인은 그 위 케이스 레벨 진단에 있다. 접두가 없으면
  사용자가 실패로 오해한다.
- `violations` 가 없으면 `→` 줄이 없다.
- `hint` 는 항상 마지막이다.

한 케이스에 실패 단언이 둘이면 둘 다 출력한다. `isError` 가 깨져도 `bodyMatchesSchema` 를
평가한다는 것이 응답 본문 웨이브 executor 통합의 결정이었고, 이 레이아웃이 그 결정을 화면에
드러낸다.

### 5.5 중단 줄

`report.stopReason` 이 있을 때만 요약 바로 위에 한 줄과 빈 줄을 넣는다.

```
중단: 케이스 '{caseId}' 타임아웃으로 실행을 멈췄습니다.
중단: 외부 요청으로 실행을 멈췄습니다. 마지막 케이스 '{caseId}'
중단: 외부 요청으로 실행을 멈췄습니다.
```

세 번째는 `abortSignal` 이면서 `caseId` 가 없는 경우다.

### 5.6 요약 줄

```
{항목들}  ({total} total)
```

항목은 `RunnerSummary` 에서 **0이 아닌 것만** 아래 고정 순서로 뽑는다.

```
passed / failed / timed out / cancelled / not run
```

`", "` 로 연결한다. 예: `2 passed, 1 failed  (3 total)`. 전부 0인 보고서는 §5.1대로 들어오지
않는다.

> **표기 언어에 대한 결정.** 상태 단어를 영어로 둔다. 진단 문장은 한국어이고 프로젝트 규칙도
> 한국어를 요구하지만, 요약 줄의 단어는 문장이 아니라 **상태 토큰**이다. `passed` `failed` 는
> `RunnerSummary` 의 필드 이름과 `TestCaseResult.status` 값 그대로이므로 화면과 `--json` 이
> 같은 어휘를 쓰게 된다. grep 과 스크립트 친화적이기도 하다. 이 판단은 되돌리기 싸다.
> 검토에서 뒤집히면 요약 줄과 §7의 단언 문자열만 고치면 된다.

### 5.7 색상

`options.color` 가 `true` 일 때만 ANSI를 넣는다. 범위를 좁게 유지한다.

| 대상 | SGR |
|---|---|
| `✓` | `\u001b[32m` 초록 |
| `✗` | `\u001b[31m` 빨강 |
| `⧖` | `\u001b[33m` 노랑 |
| `⊘` `·` | `\u001b[2m` 흐리게 |
| `해결:` 로 시작하는 줄 전체 | `\u001b[2m` 흐리게 |
| 그 외 | 없음 |

각 구간은 `\u001b[0m` 으로 닫는다. 진단 문장 본문과 위반 줄에는 색을 넣지 않는다. 색이 많으면
읽기 어렵고, 색 없는 기본 출력과 구조가 달라져 테스트가 두 배가 된다.

## 6. 제어 문자 이스케이프

**렌더러가 그리는 문자열 중 서버 응답에서 유래한 것이 있다.** 위반의 `actual` 값, `observedKeys`,
`stringContains` 의 실제 문자열이 진단 `message` 안에 이미 박혀 들어온다. 서버가 응답에
`\u001b[2J` 같은 시퀀스를 넣으면 그대로 터미널에 전달되어 화면을 지우거나 커서를 옮긴다.

`packages/cli/src/test-command.ts:143` 의 `escapeTerminalText` 가 stderr 경로에서 이미 이
방어를 한다. stdout 경로에도 같은 방어가 필요하다.

**규칙**: 렌더러는 보고서에서 읽은 모든 문자열에 이스케이프를 적용한 뒤 프레임에 넣는다.
프레임(기호, 들여쓰기, `→`, `해결:`, 색상 코드)에는 적용하지 않는다. 이스케이프가 먼저,
색상 삽입이 나중이다. 순서가 뒤집히면 우리가 넣은 색상 코드까지 이스케이프된다.

대상 문자열은 `suite.name`, `spec.name`, `caseId`, `spec.type`, `diagnostic.message`,
`diagnostic.hint`, `violations[].message` 다.

변환 규칙은 CLI의 것과 같다. 코드 포인트가 `<= 0x1f`, `0x7f`, `0x2028`, `0x2029` 이면
`\uXXXX` 문자열로 바꾼다.

`reporter.ts` 는 자체 구현을 둔다. `cli` 의 것을 가져다 쓰면 의존 방향이 뒤집힌다. 6줄
중복이지만 경계를 지키는 쪽을 택한다. ADR-0013에 남긴다.

## 7. 테스트

`packages/runner/tests/reporter.test.ts` 신규. 전부 인메모리 `RunnerReport` 픽스처를 쓴다.
실제 서버를 띄우지 않는다.

문안 자체는 단언하지 않는다. §3.3대로 문안은 `diagnostics.ts` 소유이고
`body-diagnostics.test.ts` 가 이미 고정한다. 여기서 다시 단언하면 문안을 고칠 때 두 곳이
깨진다. 렌더러 테스트는 **배치와 결정론성**만 본다.

| 테스트 이름 | 핵심 단언 |
|---|---|
| `전부 통과한 보고서를 그린다` | 출력 전문이 기대 문자열과 동일 |
| `실패 케이스의 진단과 힌트를 그린다` | 출력 전문이 기대 문자열과 동일 |
| `위반 목록을 화살표 줄로 그린다` | `→` 로 시작하는 줄 수가 `violations.length` 와 같음 |
| `통과한 단언은 그리지 않는다` | 출력에 `isError` 가 없음 |
| `skipped 단언에 건너뜀 접두를 붙인다` | 해당 줄에 `(건너뜀)` 포함 |
| `notRun 단언은 그리지 않는다` | 출력 줄 수가 기대와 같음 |
| `케이스 레벨 진단을 단언 이름 없이 그린다` | 타임아웃 케이스 출력 전문이 기대와 동일 |
| `다섯 상태 기호를 각각 쓴다` | 다섯 상태를 한 보고서에 넣고 각 기호가 정확히 1회 |
| `caseId 열을 가장 긴 것에 맞춘다` | 모든 케이스 줄에서 `spec.name` 시작 열 인덱스가 같음 |
| `단언 타입 열을 케이스 안에서 맞춘다` | 한 케이스의 두 단언 줄에서 message 시작 열이 같음 |
| `단언 타입 열은 케이스마다 독립이다` | 케이스 A의 열 너비가 케이스 B의 단언 이름 길이에 무관 |
| `stopReason 타임아웃 줄을 그린다` | `중단: 케이스 'slow-call' 타임아웃으로` 포함 |
| `stopReason abortSignal에 caseId가 있으면 그린다` | `마지막 케이스 'x'` 포함 |
| `stopReason abortSignal에 caseId가 없으면 생략한다` | `마지막 케이스` 미포함 |
| `stopReason이 없으면 중단 줄이 없다` | `중단:` 미포함 |
| `요약에서 0인 항목을 생략한다` | `2 passed, 1 failed  (3 total)` |
| `요약 항목 순서가 고정이다` | 다섯 항목이 모두 0이 아닐 때 순서가 기대와 동일 |
| `단수 케이스에 case를 쓴다` | 헤더에 `(1 case)` |
| `문자열이 개행 하나로 끝난다` | `endsWith("\n")` 이고 `endsWith("\n\n")` 아님 |
| `CRLF를 쓰지 않는다` | 출력에 `\r` 없음 |
| `같은 보고서를 두 번 그리면 같다` | 두 호출 결과가 `===` |
| `케이스 순서를 유지한다` | 출력 케이스 줄 순서가 `report.cases` 순서와 동일 |
| `제어 문자를 이스케이프한다` | `spec.name` 에 `\u001b[2J` 를 넣으면 출력에 원문 `\u001b` 없음 |
| `위반 메시지의 제어 문자도 이스케이프한다` | `violations[0].message` 에 넣어도 동일 |
| `색상 옵션이 없으면 ANSI가 없다` | 출력에 `\u001b` 없음 |
| `색상 옵션이 true면 상태 기호에 SGR을 붙인다` | 출력 전문이 기대 문자열과 동일 |
| `색상은 이스케이프 뒤에 넣는다` | 제어 문자가 든 이름 + `color: true` 에서 SGR이 온전함 |
| `해결 줄만 흐리게 한다` | `color: true` 에서 `\u001b[2m` 개수가 해결 줄 수와 같음 |

`packages/cli/tests/` 추가분. 기존 테스트 파일 이름은 구현 계획에서 확정한다.

| 테스트 이름 | 핵심 단언 |
|---|---|
| `--json 없이 렌더링 문자열을 쓴다` | `writeStdout` 인자가 `{` 로 시작하지 않음 |
| `--json이면 기존 JSON을 쓴다` | `writeStdout` 인자가 `JSON.stringify(report, null, 2) + "\n"` 과 동일 |
| `--json을 두 번 쓰면 거부한다` | 종료 코드 1, stderr에 `CLI_USAGE` |
| `--json=true를 거부한다` | 종료 코드 1, stderr에 `CLI_USAGE` |
| `TTY가 아니면 색을 끈다` | 렌더 옵션의 `color` 가 false |
| `NO_COLOR가 있으면 TTY여도 색을 끈다` | 렌더 옵션의 `color` 가 false |
| `종료 코드는 --json 여부와 무관하다` | 같은 보고서에서 두 경로 모두 1 |

`packages/cli/tests/dist-cli-e2e.mjs` 수정. **모든 `execute` 호출에 `--json` 을 추가**한다.
이 파일은 `JSON.parse(out)` 으로 판정하고 두 번 실행의 stdout 바이트를 비교한다. 플래그를
빠뜨리면 파싱에서 터진다.

그리고 렌더링 경로를 보는 블록을 하나 추가한다. `--json` 없이 실패 픽스처를 실행하고,
stdout에 `$.temperature: 필수 필드가 없습니다.` 가 포함되는지, 두 번 실행의 stdout 바이트가
같은지 본다. 실환경에서 문장이 실제로 사람 눈앞에 오는지 증명하는 유일한 지점이다.

## 8. 거짓 신호

`CLAUDE.local.md` 표에서 이 작업이 밟을 수 있는 것.

| 거짓 신호 | 이 작업에서의 모습 | 진실 기준 |
|---|---|---|
| 유닛테스트 녹색, 실행 시 실패 | 인메모리 픽스처만 통과하고 실제 CLI 경로는 `--json` 누락으로 깨짐 | `pnpm build` 후 `dist-cli-e2e.mjs` |
| 결함이 계속 재현 | `dist/cli.mjs` 가 낡음 | `pnpm build` 후 재확인 |
| 재생 테스트가 가끔 실패 | 색상 판정이 테스트 환경의 TTY 여부를 탐 | 렌더러 테스트는 `color` 를 명시적으로 넘김 |

이 작업 고유의 것 둘.

| 거짓 신호 | 원인 | 진실 기준 |
|---|---|---|
| 렌더링이 잘 되는 것처럼 보임 | 실패가 하나뿐인 픽스처만 봄 | 다섯 상태를 한 보고서에 넣은 픽스처 |
| 출력이 결정론적인 것처럼 보임 | 같은 프로세스에서 두 번 호출만 비교 | 두 번 실행의 stdout 바이트 비교(E2E) |

## 9. 후속 작업 연동 계약

### 9.1 위반 클러스터링

실패가 많을 때 화면이 길어진다. 원인이 하나인데 케이스 12개가 같이 깨지는 경우가 전형이다.
그때 필요한 것은 요약이 아니라 **묶기**다.

```
위반 20건이 3개 원인으로 묶입니다.
  [12건] $.temp 필드 없음, 응답에는 'temperature'가 있음
  [ 5건] $.condition이 enum 밖의 값
  [ 3건] 타임아웃
```

`SchemaViolationDiagnostic` 이 `code` `path` `expected` `actual` `observedKeys` 를 구조화해
갖고 있으므로 `(code, path, expected)` 로 그룹핑하고 건수 내림차순으로 정렬하면 된다. 순수
함수이고 결정론적이며 AI 호출이 필요 없다. 응답 본문 웨이브가 진단을 문자열이 아니라 구조로
남긴 덕을 여기서 본다.

이 웨이브에 넣지 않는 이유는 관심사가 다르기 때문이다. 렌더링은 `RunnerReport` 를 문자열로
바꾸는 순수 변환이고, 클러스터링은 "무엇을 같은 원인으로 볼 것인가"라는 판단이다. 판단이
들어가는 쪽은 설계 논의가 따로 필요하다.

### 9.2 AI 요약과 repair

`packages/generate` 에 provider 인프라가 이미 있다. `provider-process.ts`(codex/claude
서브프로세스), `authoring-session.ts`(승인 세션), `redaction.ts`, `validateAuthoringProviderResult`.
ADR-0006 · 0007 · 0008이 그 결정을 담는다. repair 는 authoring 의 입력을 `ToolDef` 에서
실패 보고서로 바꾼 형태이므로 새로 만들 것이 적다.

착수 전에 못 박아야 할 경계 셋.

1. **repair 는 테스트 스펙만 고친다.** 서버 코드는 건드리지 않는다. 우리 저장소가 아니다.
2. **"이 변경이 의도된 것인가"는 사람이 답한다.** 서버가 필드를 개명한 경우와 서버가 필드를
   빠뜨린 경우는 진단이 완전히 같다. 진단 힌트가 `"스키마 변경이 의도된 것이라면"` 이라는
   조건절로 쓰인 이유다. AI가 그 조건을 추론하게 두면 안 된다.
3. **자동 적용 금지.** 후보 생성 → diff 표시 → 사람 승인. 무인 플래그를 만들지 않는다.
   깨진 테스트를 서버에 맞춰 자동 갱신하면 회귀 탐지 도구가 회귀 은폐 도구가 된다.

결정론성과의 선은 이렇게 긋는다.

```
결정론 영역   renderReport, --json 출력, 종료 코드, 클러스터링
비결정 영역   AI 설명, repair 후보 생성
```

AI 호출은 기본 꺼짐, 대화형 TTY에서만, stdout 보고서와 종료 코드에 영향 없음. `--json` 에는
섞이지 않는다. CI가 이 도구를 쓰는 경로가 그것이다.

이 설계는 §9.2를 막지 않는다. 렌더러가 `caseId` 를 화면에 찍으므로 선택 UI가 붙을 자리는
이미 생긴다.

### 9.3 JUnit XML 리포터

`CONTRIBUTING.md` §2.1이 `runner` 책임으로 규정한다. `reporter.ts` 와 같은 디렉터리에
`junit.ts` 를 두고 `renderJUnit(report): string` 시그니처를 맞추면 된다. 이 웨이브에서는
만들지 않는다.

### 9.4 진행 상황 스트리밍

`RunSuiteOptions.onEvent` 가 이미 있다. 긴 스위트에서 살아있다는 신호가 필요해지면 `cli` 가
구독해 stderr에 진행을 찍는 방식이 가능하다. stdout 바이트를 건드리지 않으므로 이 설계와
충돌하지 않는다. 다만 `cli` 가 stderr를 오류 전용으로 쓰는 현재 규칙을 먼저 바꿔야 한다.

## 10. 소유권과 PR 분할

`CONTRIBUTING.md` §2.1에서 `runner` 는 파트 ①, `cli` 는 공동이며 "각자 자기 서브커맨드만
수정"이다. `test` 서브커맨드는 파트 ① 소관이므로 이 작업에 소유권 충돌이 없다.

§2.2가 "한 PR에서 여러 오너의 영역을 동시에 건드리지 않는다"고 규정한다. 이 작업은 `runner`
와 `cli`를 함께 건드리지만 둘 다 파트 ① 소관이므로 위반이 아니다. 다만 리뷰 단위를 작게
하려면 PR 두 개로 나눌 수 있다. `runner` 렌더러가 먼저 머지되면 `cli` 가 그것을 쓴다. 분할
여부는 구현 계획에서 정한다.

## 11. ADR

- `docs/adr/0012-cli-기본-출력-전환.md`
  기본 stdout을 사람용으로 바꾸고 `--json` 을 opt-in으로 둔 결정. 대안은 기본 JSON 유지 +
  `--reporter pretty` opt-in 과 TTY 자동 전환이었다. 전자는 아무도 플래그를 안 붙여 목적이
  달성되지 않고, 후자는 같은 명령이 환경에 따라 다른 바이트를 내어 결정론성과 충돌한다.
  파괴적 변경 비용이 미배포 알파에서 가장 싸다는 것이 결정 근거다.

- `docs/adr/0013-렌더러-배치와-진단-무분기.md`
  렌더러를 `cli` 가 아니라 `runner` 에 둔 결정과, 렌더러가 진단 코드로 분기하지 않는 원칙,
  그리고 `escapeTerminalText` 를 `cli` 에서 재사용하지 않고 `runner` 에 중복 구현한 판단.
