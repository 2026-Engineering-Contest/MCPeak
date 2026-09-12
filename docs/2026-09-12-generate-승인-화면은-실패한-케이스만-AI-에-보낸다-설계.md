# generate 승인 화면은 실패한 케이스만 AI 에 보낸다 (2026-09-12)

참조: `docs/superpowers/specs/2026-08-18-rejection-basis-verification-design.md` (이하 "#89 설계"),
ADR-0049, `docs/2026-09-11-공개서버-직접조작-데모-실측-문제.md` §4,
`packages/runner/src/rejection-basis.ts`, `packages/cli/src/generate-command.ts`,
`packages/cli/src/pre-fill-wiring.ts`.

## 1. 배경

### 1.1 승인 화면의 네 단계

`mcpeak generate` 가 시험 실행을 켜고 provider 를 붙이면 승인 화면이 이 순서로 흐른다.

| 순서 | 단계 | 대상 | 화면 |
|---|---|---|---|
| 1 | 시험 실행 | 전체 케이스 | `✓ 통과 N건 ✗ 실패 M건` 과 실패 목록 |
| 2 | 거절 근거 미확인 목록 | 통과한 거절 케이스 중 `unverified` | `거절 근거 미확인 K건` + 케이스마다 한 줄 |
| 3 | 거절 근거 AI 진단 | 같은 K건 | 전송 확인 → 판정 목록 → `이 진단은 참고입니다` |
| 4 | 실패 케이스 입력값 교정 | 실패 M건, 하나씩 | `[1] …` + 전송 승인 + 질문 |

2·3 은 #89 설계가 넣었다. 위반 케이스의 단언은 `isError: true` 하나라 서버가 입력을 거절한 것과
내부에서 터진 것을 구분하지 못한다는 관찰(80건)에서, 판정은 바꾸지 않되 참고로 사람과 AI 에게
보여주기로 한 것이다. `runner` 는 화이트리스트(TS SDK `-32602`, Python SDK, FastMCP pydantic,
MCPeak 목 고정 문장)로 "SDK 가 낸 거절" 만 `verified` 로 찍고 나머지는 전부 `unverified` 다.

### 1.2 실측: 화이트리스트 밖이 기본값이다

2026-09-12 에 두 서버로 쟀다.

| 서버 | 거절 케이스 | `verified` | `unverified` | 그중 거절이 아닌 것 |
|---|---|---|---|---|
| `@supabase/mcp-server-supabase@0.12.0` | 31 | 0 | 31 | 2 (`list_tables` 가 필수 필드 없이도 정상 응답) |
| `examples/live-weather-server` (툴 10개) | 43 | 0 | 43 | 2 (결함 B · C) |

둘 다 핸들러 안에서 직접 검증한다. Supabase 는 Zod 오류 JSON 을, 우리 예제는 `→ 'city' 는 비어
있지 않은 문자열이어야 합니다` 같은 문장을 돌려준다. 어느 쪽도 화이트리스트에 없다. **서버
개발자가 자기 손으로 거절 문장을 쓰는 순간 전부 미확인이 된다.** 그것이 대다수 서버다.

결과는 셋이다.

- 화면에 43줄이 오르고, 그 뒤 AI 전송을 물으며, 승인하면 43건(31KB 안팎)을 보낸다. 목록의
  문장은 전부 무엇이 왜 틀렸는지 서버가 말한 정상 거절이라 사람이 확인할 것이 없다.
- **거절이 아닌 케이스가 섞인다.** `summarize-text-missing-text` 는 `isError: false` 로 정상
  응답이 온 **실패** 케이스인데, `classifyRejectionBasis` 가 통과 여부를 보지 않아 `unverified`
  로 찍히고 미확인 목록과 AI 진단에 함께 오른다. 이미 1 단계에서 실패로 잡힌 케이스다.
- 3 단계의 결과 목록이 스크롤 위로 밀리면 마지막 줄 `이 진단은 참고입니다` 만 4 단계의 `[1] …`
  바로 위에 남아, 4 단계가 진단의 일부처럼 읽힌다.

### 1.3 사전보완 요약 줄

같은 화면의 AI 사전보완 요약이 이렇게 찍힌다.

```
AI 사전보완: 툴 10개 중 3개에 값 제안을 받았습니다.
  채택 0 (실제 서버에서 baseline 값이 실패하고 제안 값이 통과)
  미채택 3 (baseline 값이 이미 통과)
```

채택 판정은 `pre-fill-wiring.ts` 가 네 갈래로 낸다.

| baseline | 제안 | 결과 |
|---|---|---|
| 통과 | 무엇이든 | baseline 유지 |
| 실패 | 통과 | **제안 채택** |
| 실패 | 실패 | baseline 유지, `needsClassification: true` 로 분류 화면행 |
| (중단) | | baseline 유지 |

요약 줄은 셋째·넷째 갈래도 `notAdopted` 에 합쳐 "baseline 값이 이미 통과" 라고 말한다.
live-weather-server 의 `evaluate_expression` 은 baseline `"example"` 이 실패했는데도 그 문구로
찍혔다. 실측 §4 가 미등록으로 적어 둔 결함이다.

### 1.4 왜 지금 고치나

데모가 승인 화면을 그대로 보여준다. 43줄 목록과 43건 전송 확인은 "왜 이걸 다 보내지" 라는
질문을 부르고, 요약 줄은 사실과 다른 말을 한다. 둘 다 이 프로젝트의 원칙(화면 문장이 곧
제품, 도구는 조용히 판단하지 않는다)에 걸린다.

## 2. 목표와 완료 조건

**목표.** 시험 실행 뒤 AI 에게 가는 것은 실패한 케이스뿐이다. 통과한 거절 케이스의 근거 확인은
사용자가 켤 때만 한다. 요약 줄은 네 갈래를 구분해 말한다.

**완료 조건.**

1. `mcpeak generate` 기본 실행에서 `거절 근거 미확인` 목록과 AI 진단 전송 확인이 나오지 않는다.
   대신 한 줄 고지가 나온다.
2. `--diagnose-rejections` 를 주면 지금과 같은 목록과 AI 진단(provider 가 있을 때)이 나온다.
3. `--diagnose-rejections` 와 `--no-dry-run` 을 함께 주면 사용 오류다.
4. 거절을 기대했으나 거절이 오지 않은(`isError: false`) 케이스는 `rejectionBasis` 가
   `notApplicable` 이다. `test` 요약의 `거절을 기대한 케이스 N건은 거절 근거를 확인하지 못했습니다`
   의 N 에서도 빠진다.
5. 사전보완 요약이 "미채택(이미 통과)" 과 "보류(둘 다 실패)" 를 나눠 찍는다.
6. 기존 동작 유지. 위 조건에 걸리지 않는 문장과 흐름은 바뀌지 않는다.
7. 루트 `pnpm test` · `pnpm typecheck --force` · `pnpm lint` 녹색.
8. live-weather-server 로 실제 generate 를 돌려 1·2·5 를 눈으로 확인한다.

## 3. 비범위

- 화이트리스트에 "Zod 모양이면 verified" 같은 형식 판정을 더하지 않는다. #89 의 관찰(본문
  형식으로 못 가른다)을 뒤집을 새 관찰이 없다.
- `test` 명령의 요약 문장 자체는 바꾸지 않는다. 집계 값만 4 번 조건으로 정확해진다.
- 대시보드 generate 폼에 토글을 더하지 않는다. 플래그 기본이 꺼짐이라 argv 를 안 바꾸면 그대로
  새 기본 동작이다. 토글은 후속.
- AI 진단의 요청·응답 계약(`rejection-diagnosis.ts`)은 그대로다. 언제 부르느냐만 바뀐다.
- 중단(`aborted`)된 사전보완의 요약 문구는 지금 그대로 둔다. 별도 경로가 이미 중단 사실을
  찍는다.

## 4. 결정

### 4.1 결정 1: 거절이 오지 않은 케이스는 판정 대상이 아니다 (runner)

`classifyRejectionBasis` 가 `rejected: boolean` 을 받는다. 실제 응답의 `isError` 가 `true` 였는지다.
`expectsRejection && !rejected` 면 `notApplicable` 이다. 거절이 없었으니 확인할 근거도 없다.
그 케이스는 이미 `isError` 단언 실패로 빨간색이다.

executor 는 `result.result.isError === true` 를 넘긴다. `summary.rejectionUnverified` 는 그대로
`unverified` 를 세므로 자동으로 빠진다.

이것은 cli 에서 `status === "passed"` 로 거르는 것과 다르다. runner 가 낸 값이 뜻과 맞아야
`--json` 보고서와 `test` 요약도 같이 맞는다. cli 는 그 위에 **한 번 더** `status === "passed"` 로
거른다. 두 패키지가 같은 시각에 바뀌고, 어느 한쪽만 들어가도 화면이 틀리지 않게 하기 위해서다.

### 4.2 결정 2: 미확인 목록과 AI 진단은 `--diagnose-rejections` 뒤로 (cli)

generate 에 값 없는 플래그 `--diagnose-rejections` 를 더한다. 기본은 꺼짐이다.

| 상태 | 2 단계(목록) | 3 단계(AI 진단) |
|---|---|---|
| 플래그 없음 | 한 줄 고지만 | 안 한다 |
| 플래그 있음, provider 없음 | 지금과 같은 목록 | 안 한다 (지금도 provider 없으면 안 한다) |
| 플래그 있음, provider 있음 | 지금과 같은 목록 | 지금과 같은 전송 확인 → 진단 |
| 플래그 + `--no-dry-run` | 사용 오류 | |

한 줄 고지는 미확인이 1건 이상일 때만 찍는다.

```
  통과한 거절 케이스 43건의 근거는 확인하지 않았습니다. --diagnose-rejections 로 목록과 AI 진단을 볼 수 있습니다.
```

"근거를 확인하지 못했다" 가 아니라 "확인하지 않았다" 다. 안 한 것과 못 한 것을 같은 말로 쓰면
플래그를 켠 뒤의 문장(`확인하지 못했습니다`)과 구분이 안 된다.

#89 설계 §6.1 은 "호출은 사용자가 시작한다" 고 했고, 지금도 전송 전에 `confirm` 을 묻는다. 이
결정은 그 문턱을 한 단계 앞으로 옮긴다. 목록조차 사용자가 켤 때만 나온다. 이유는 §1.2 다.
기본 서버에서 목록이 수십 줄이고 그 전부가 정상 거절이라, 기본 화면에 두면 신호가 아니라
소음이다.

### 4.3 결정 3: 사전보완 요약은 네 갈래를 말한다 (cli)

`ApplyPreFillResult` 에 `held: number`(둘 다 실패해 분류 화면으로 가는 수)를 더한다. 값은
`cases.filter(c => c.needsClassification).length` 다. `renderPreFillSummary` 는 이렇게 찍는다.

```
AI 사전보완: 툴 10개 중 3개에 값 제안을 받았습니다.
  채택 1 (실제 서버에서 baseline 값이 실패하고 제안 값이 통과)
  미채택 2 (baseline 값이 이미 통과)
  보류 1 (baseline 값도 제안 값도 실패. 분류 화면에서 정합니다)
```

`미채택` 의 수는 `notAdopted - held` 다. `보류` 줄은 0 이면 찍지 않는다. `채택`·`미채택` 줄은
지금처럼 항상 찍는다(기존 테스트가 그 둘을 고정한다).

### 4.4 버린 선택지

- **(A) 목록은 두고 AI 전송만 옵션.** 43줄이 그대로 남는다. §1.2 의 첫 문제가 안 풀린다.
- **(B) 같은 본문은 한 번만 보낸다.** live-weather 43 → 19 로 줄지만 Zod 처럼 필드 경로가
  본문에 들어가는 서버에서는 거의 안 준다(31 → 29). 근본이 아니다.
- **(C) Zod·Ajv 모양을 `verified` 로 본다.** #89 관찰과 부딪히고, 크래시가 검증 오류 모양으로
  포장되는 경우(FastMCP 사례가 이미 있다)를 다시 연다.
- **(D) 거절이 아닌 케이스를 cli 에서만 거른다.** `--json` 과 `test` 요약의 집계가 계속 틀린다.
  runner 가 값을 바로 내야 한다.

## 5. 계약 (전량)

### 5.1 runner: `classifyRejectionBasis`

```ts
export function classifyRejectionBasis(options: {
  readonly expectsRejection: boolean;
  /** 실제 응답의 `isError` 가 `true` 였는가. 거절이 안 왔으면 확인할 근거도 없다. */
  readonly rejected: boolean;
  readonly toolName: string | null;
  readonly bodyText: string | null;
}): RejectionBasis {
  const { expectsRejection, rejected, toolName, bodyText } = options;
  if (!expectsRejection) return "notApplicable";
  // 거절을 기대했지만 정상 응답이 왔다. 그 케이스는 isError 단언이 이미 실패로 잡았고,
  // "거절의 근거" 는 거절이 있어야 물을 수 있다.
  if (!rejected) return "notApplicable";
  if (bodyText === null) return "unverified";
  // 이하 기존 화이트리스트 그대로
```

executor 의 호출 자리:

```ts
const rejectionBasis: RejectionBasis =
  loss === undefined
    ? classifyRejectionBasis({
        expectsRejection,
        rejected:
          result !== undefined && result.type === "callTool" && result.result.isError === true,
        toolName: spec.operation.type === "callTool" ? spec.operation.tool : null,
        bodyText,
      })
    : "notApplicable";
```

`result` 변수의 실제 이름과 형은 executor 의 그 블록에서 이미 쓰는 것을 그대로 쓴다.
`rejected` 가 `false` 인 케이스는 `rejectionBody` 도 싣지 않는다(읽을 이유가 없다).

### 5.2 cli: 플래그

`optionNames` 와 `flagNames` 에 `"--diagnose-rejections"` 를 더한다. 파싱 뒤:

```ts
const diagnoseRejections = flags.has("--diagnose-rejections");
if (diagnoseRejections && !dryRun)
  throw new UsageError(
    "`--diagnose-rejections`는 `--no-dry-run`과 함께 사용할 수 없습니다. 시험 실행이 없으면 확인할 거절이 없습니다.",
  );
```

`GenerateInput`(또는 그에 해당하는 파싱 결과 타입)에 `readonly diagnoseRejections: boolean` 을
더한다.

### 5.3 cli: 시험 실행 뒤 흐름

```ts
writeDryRunResult(io, result);
// 통과한 거절 케이스만 대상이다. runner 가 거절 없는 케이스를 notApplicable 로 내지만,
// 한 패키지만 먼저 들어가도 화면이 틀리지 않게 여기서 한 번 더 거른다.
const unverified = result.outcomes.filter(
  (outcome) => outcome.status === "passed" && outcome.rejectionBasis === "unverified",
);
if (input.diagnoseRejections) {
  writeRejectionUnverified(io, unverified);
  await askRejectionDiagnosis({ ..., unverified, ... });
} else if (unverified.length > 0) {
  io.write(
    `  통과한 거절 케이스 ${unverified.length}건의 근거는 확인하지 않았습니다. ` +
      "--diagnose-rejections 로 목록과 AI 진단을 볼 수 있습니다.\n\n",
  );
}
```

`writeRejectionUnverified` 와 `askRejectionDiagnosis` 는 `DryRunResult` 대신 걸러진
`unverified` 배열을 받도록 시그니처를 바꾼다. 두 함수 안의 필터링은 지운다. 그 밖의 본문과
문장은 그대로다.

### 5.4 cli: 도움말

`GENERATE_USAGE` 의 `[--no-repair]` 뒤에 `[--diagnose-rejections]` 를 넣는다. 옵션 설명 블록의
`--no-repair` 아래:

```
  --diagnose-rejections
                        통과한 거절 케이스의 응답을 나열하고, provider 가 있으면 그 거절이
                        입력 검증 때문인지 서버 내부 오류인지 AI 에게 참고 의견을 묻습니다.
                        기본은 끕니다. 손으로 쓴 거절 문장은 전부 이 목록에 오르므로,
                        서버가 잘못된 입력에 그냥 터지는지 의심될 때 켜세요
```

### 5.5 cli: 사전보완 요약

`ApplyPreFillResult`:

```ts
  readonly adopted: number;
  readonly notAdopted: number;
  /** baseline 값도 제안 값도 실패해 분류 화면으로 가는 수. `notAdopted` 에 포함된다. */
  readonly held: number;
```

`applyPreFill` 의 반환:

```ts
    adopted,
    notAdopted: cases.length - adopted,
    held: cases.filter((item) => item.needsClassification).length,
```

제안이 없어 일찍 돌아가는 두 자리(`byCase.size === 0`, `targetIds.size === 0`)도 `held: 0` 을
싣는다.

`renderPreFillSummary`:

```ts
export function renderPreFillSummary(options: {
  readonly toolCount: number;
  readonly proposedToolCount: number;
  readonly adopted: number;
  readonly notAdopted: number;
  readonly held: number;
  readonly discarded: readonly PreFillDiscard[];
}): string {
  const { toolCount, proposedToolCount, adopted, notAdopted, held, discarded } = options;
  if (proposedToolCount === 0 && discarded.length === 0) return "";
  const lines = [
    `AI 사전보완: 툴 ${toolCount}개 중 ${proposedToolCount}개에 값 제안을 받았습니다.`,
    `  채택 ${adopted} (실제 서버에서 baseline 값이 실패하고 제안 값이 통과)`,
    `  미채택 ${notAdopted - held} (baseline 값이 이미 통과)`,
  ];
  if (held > 0)
    lines.push(`  보류 ${held} (baseline 값도 제안 값도 실패. 분류 화면에서 정합니다)`);
  for (const item of discarded)
    lines.push(`  버림 1 (${item.reason}: ${item.caseId}.${item.field})`);
  return `${lines.join("\n")}\n`;
}
```

호출 자리는 `held: preFillResult.held` 를 넘긴다.

## 6. 파일별 변경

| 패키지 | 파일 | 무엇을 |
|---|---|---|
| runner | `src/rejection-basis.ts` | `rejected` 인자. §5.1 |
| runner | `src/executor.ts` | 호출 자리에 `rejected` 전달. `rejected` 가 거짓이면 `rejectionBody` 미기재 |
| runner | `tests/rejection-basis.test.ts`, executor 의 거절 근거 테스트 | §7.1 |
| cli | `src/generate-command.ts` | 플래그 파싱·사용 오류, 시험 실행 뒤 분기, 한 줄 고지, 두 함수 시그니처, 요약 호출 |
| cli | `src/pre-fill-wiring.ts` | `held` |
| cli | `src/help.ts` | 사용법 줄과 옵션 설명 |
| cli | `tests/generate-command.test.ts`, `tests/pre-fill-screen.test.ts`, `tests/pre-fill-wiring.test.ts`, `tests/help.test.ts` | §7.2 |
| docs | `docs/adr/0098-*.md`, `docs/adr/README.md` | 결정 2 가 #89 기본값을 뒤집는다 |
| docs | `docs/2026-09-11-공개서버-직접조작-데모-실측-문제.md` §4 | 해소 갱신 |

`core` · `generate` · `record` · `mock` · `dashboard` 는 건드리지 않는다. 새 의존성은 없다.

## 7. 테스트 사양

### 7.1 runner

`tests/rejection-basis.test.ts` 에 추가. 기존 케이스는 전부 `rejected: true` 를 더해 그대로
통과한다.

- `거절을 기대했지만 거절이 오지 않으면 판정 대상이 아니다`:
  `{ expectsRejection: true, rejected: false, toolName: "t", bodyText: "MCP error -32602: x" }` →
  `"notApplicable"`. 본문이 화이트리스트 모양이어도 `notApplicable` 이다.
- `거절을 기대하지 않으면 rejected 와 무관하게 판정 대상이 아니다`:
  `{ expectsRejection: false, rejected: true, … }` → `"notApplicable"`.

executor 테스트(거절 근거를 이미 다루는 파일에 추가):

- 거절을 기대한 케이스에 서버가 `isError: false` 정상 응답을 주면, 그 케이스는 `failed` 이고
  `rejectionBasis` 는 `"notApplicable"`, `rejectionBody` 는 없고, `summary.rejectionUnverified`
  는 그 케이스를 세지 않는다.
- 같은 스위트에서 다른 거절 케이스가 손으로 쓴 문장으로 거절되면 그 케이스만
  `"unverified"` 로 세어 `rejectionUnverified` 가 1 이다.

### 7.2 cli

`tests/generate-command.test.ts` 의 `거절 근거 미확인 목록` describe:

- 기존 케이스 "미확인 케이스를 id 와 응답 한 줄로 나열한다" 와 "여러 줄 응답을 한 줄로 자르고
  제어 문자를 이스케이프한다" 는 argv 에 `--diagnose-rejections` 를 더해 그대로 통과한다.
- `플래그가 없으면 목록 대신 한 줄 고지만 찍는다`: 같은 설정에서 플래그 없이 돌리면 출력에
  `거절 근거 미확인` 이 없고 `통과한 거절 케이스 ${failingCases}건의 근거는 확인하지 않았습니다.
  --diagnose-rejections 로 목록과 AI 진단을 볼 수 있습니다.` 가 있다.
- `미확인이 0건이면 고지도 없다`: 전부 `-32602` 로 거절하면 고지 문장이 없다.
- `거절이 오지 않은 케이스는 목록에 오르지 않는다`: 위반 케이스 하나가 `isError: false` 로
  응답하면(그 케이스는 실패), 플래그를 켜도 목록의 건수에서 빠지고 그 id 가 목록에 없다.
  실패 목록에는 있다.
- `--diagnose-rejections 와 --no-dry-run 을 함께 주면 사용 오류다`: 문장 전체를 단언한다.
- AI 진단 describe 의 기존 케이스 전부에 `--diagnose-rejections` 를 더한다. 그리고
  `플래그 없이는 provider 가 있어도 진단을 요청하지 않는다`: `rejectionProviders` 를 주고 플래그
  없이 돌리면 `AI 진단을 요청했습니다` 도, 전송 확인 질문도 없다.

`tests/pre-fill-screen.test.ts` 의 `사전보완 결과 요약`:

- `base` 에 `held: 0` 을 더해 기존 케이스가 그대로 통과한다.
- `보류가 있으면 미채택에서 빼고 보류 줄을 찍는다`: `{ adopted: 1, notAdopted: 3, held: 1 }` →
  `미채택 2`, `보류 1 (baseline 값도 제안 값도 실패. 분류 화면에서 정합니다)`.
- `보류가 0이면 보류 줄이 없다`.

`tests/pre-fill-wiring.test.ts`:

- baseline 실패 · 제안 실패인 케이스 하나와 baseline 통과인 케이스 하나를 주면
  `{ adopted: 0, notAdopted: 2, held: 1 }` 이다. 제안이 없으면 `held: 0`.

`tests/help.test.ts`:

- generate 사용법 줄에 `[--diagnose-rejections]` 가 있고 옵션 설명에 `--diagnose-rejections`
  와 `기본은 끕니다` 가 있다.

### 7.3 실환경 (직렬, 오케스트레이터)

`examples/live-weather-server` 로 `mcpeak generate --command node --arg <server> --provider
claude --model sonnet` 을 대화형으로 돌린다. 판정 셋.

- 시험 실행 결과 뒤에 `통과한 거절 케이스 41건의 근거는 확인하지 않았습니다.` 한 줄이 있고
  `거절 근거 미확인` 목록과 전송 확인이 없다. 41 은 43 에서 결함 B · C 두 건이 빠진 수다.
- `--diagnose-rejections` 를 붙이면 목록 41건과 전송 확인이 나온다.
- 사전보완 요약이 `evaluate_expression` 을 채택 또는 보류로 셈한다. "미채택 (이미 통과)" 로
  세지 않는다.

## 8. 남는 갈래

- 대시보드 generate 폼에서 이 플래그를 켤 방법이 없다. 후속 태스크.
- 화이트리스트가 좁은 것은 그대로다. 플래그를 켠 사용자는 여전히 수십 줄을 본다. 형식 판정을
  더할지는 새 관찰이 있을 때 다시 논의한다.
