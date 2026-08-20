# 승인 전 시험 실행 게이트 설계 (2026-08-15)

- 담당 패키지: `cli` (주), `generate` (승인 화면 흐름)
- 작성자: @seodduu
- 로드맵 단계 3(dry run 승인 게이트)
- 참조: ADR-0023(시험 실행 전 서버 초기화 훅), ADR-0017(승인 지문 계산 범위),
  ADR-0018(입력 계약 대조 소비자 배선), ADR-0022(위반 케이스 생성 정책),
  ADR-0003(카세트 매칭 키), 이슈 #59,
  `docs/superpowers/specs/2026-08-14-approval-fingerprint-design.md`,
  `docs/superpowers/specs/2026-08-15-contract-axis-coverage-design.md` §9.3
- 신규 ADR 대상 1건: 케이스 분류의 저장 위치와 `test` 소비 방식(§14)

## 1. 배경

### 1.1 지금 무엇이 비어 있는가

`generate` 는 서버에 `tools/list` 만 보낸다(`packages/cli/src/generate-command.ts:890`). 툴 선언을
읽고 나면 곧바로 연결을 닫는다(`:891`). `tools/call` 은 한 번도 하지 않는다.

그래서 명세에 실리는 기대값은 전부 **선언만 보고 지어낸 추측**이다. baseline 이 만드는 정상
케이스도, ADR-0022 가 만드는 위반 케이스도, AI 가 제안한 케이스도 마찬가지다. 사용자는 그것을
읽고 승인한다. 승인된 순간 그 추측은 오라클 지위를 얻는다.

이 상태에서 `mcpeak test` 가 빨간불을 띄우면 원인이 둘인데 화면은 구분하지 못한다.

```
✗ get_weather/정상 응답
    → 응답 본문에 'temp' 필드가 없습니다. 발견된 필드: 'temperature'
```

서버가 `temp` 를 줘야 하는데 안 준 것인가, 아니면 AI 가 `temp` 라고 잘못 적은 것인가. 명세가
옳다는 전제가 실제로는 참이 아니기 때문에 이 질문에 답할 수 없다.

### 1.2 무엇을 만드는가

승인 직전에 후보 명세를 실제 서버에 한 번 돌린다. 케이스마다 결과를 보여주고, 실패한 케이스는
사용자가 둘 중 하나로 분류한다.

- **서버 결함**: 명세가 옳고 서버가 틀렸다. 케이스를 그대로 저장한다. 이것이 회귀 테스트가 된다.
- **명세 오류**: 추측이 틀렸다. 고치거나 케이스를 뺀다.

미분류가 하나라도 남으면 저장하지 않는다. 이 게이트가 "명세는 옳다" 를 실제로 참으로 만든다.

### 1.3 이름

로드맵은 이 단계를 dry run 이라고 부른다. 이 문서도 문맥상 그 말을 쓰지만 **제품 문구에서는
쓰지 않는다.** `--dry-run` 은 통상 "실행하는 척만 한다" 를 뜻하는데 여기서는 반대로 평소에 하지
않던 실제 호출을 한다. 화면과 옵션에는 `시험 실행` 과 `--no-dry-run` 만 쓴다. 옵션 이름에 남는
`dry-run` 은 로드맵·이슈와의 연결을 위한 것이고, 도움말 한 줄이 무엇을 하는지 풀어 쓴다.

## 2. 목표 / 비범위 / 완료 조건

### 목표

1. 대화형 `generate` 저장 경로에서 후보 명세의 모든 케이스가 실제 서버에 1회 이상 실행된다.
2. 실행 결과가 케이스별로 사람에게 보인다.
3. 실패 케이스는 분류 없이 저장될 수 없다.
4. 분류 결과가 명세 파일에 남아 `test` 가 읽을 수 있다.
5. 반복 실행 비용이 카세트로 닫힌다(옵션).
6. 서버 상태 잔여물이 만드는 가짜 실패를 초기화 훅으로 닫는다(옵션, ADR-0023).

### 비범위

- **자동 수정.** 명세 오류로 분류된 케이스를 AI 가 고쳐주는 것은 단계 4(repair)다. 여기서는
  기존 검토 메뉴(`revise`·`edit`)로 사용자가 고친다.
- **케이스별 stderr 구간.** 단계 9다. 시험 실행 실패 화면에는 단계 1 의 전체 stderr 꼬리를 쓴다.
- **결정론성 2회 실행 확인.** 단계 7이다.
- **부작용 있는 툴 선별.** 전량 실행이 결정이다(§4.4).
- **`test` 명령의 판정 변경.** 분류는 표시만 바꾸고 종료 코드를 바꾸지 않는다(§9).
- **비대화형 자동 분류.** TTY 없이 분류를 대신 정하지 않는다(§11).

### 완료 조건

- `--baseline-only` 없이 `generate` 를 돌려 `save` 를 고르면 시험 실행이 먼저 돈다.
- 실패 케이스를 분류하지 않으면 저장이 거부되고, 종료 코드가 0이 아니다.
- 저장된 파일의 `approval.cases` 에 케이스 전량의 분류가 들어 있다.
- 같은 카세트로 두 번 돌린 시험 실행 결과가 바이트 동일하다.
- `--reset-cmd` 가 실패하면 시험 실행이 시작되지 않는다.
- `mcpeak test` 가 `serverDefect` 로 표시된 케이스의 실패에 참고 문장을 덧붙인다.
- `pnpm test`, `pnpm typecheck --force`, `pnpm lint`, `pnpm build && pnpm --filter @mcpeak/cli test:e2e` 가 통과한다.

## 3. 아키텍처

### 3.1 배치

| 파일 | 상태 | 책임 |
|---|---|---|
| `packages/cli/src/dry-run.ts` | 신규 | 시험 실행 오케스트레이션, 결과 요약 타입 |
| `packages/cli/src/dry-run-review.ts` | 신규 | 분류 화면과 게이트 판정 |
| `packages/cli/src/reset-hook.ts` | 신규 | 초기화 명령 실행(ADR-0023) |
| `packages/cli/src/cassette-wiring.ts` | 신규 | 카세트 로드·조립·flush |
| `packages/cli/src/generate-command.ts` | 수정 | 옵션 파싱, 연결 수명, `save` 경로에 게이트 삽입 |
| `packages/cli/src/spec-approval.ts` | 수정 | `approval.cases` 읽기, `test` 참고 문장 |
| `packages/cli/src/help.ts` | 수정 | 새 옵션 4개 도움말 |
| `packages/runner/src/spec/types.ts` | 수정 | `SuiteApproval` 에 `cases` 추가 |
| `packages/runner/src/spec/validation.ts` | 수정 | `cases` 검증 |
| `packages/runner/src/spec/json-schema.ts` | 수정 | `MCP_SUITE_JSON_SCHEMA` 갱신 |

`generate` 패키지는 **바뀌지 않는다.** 이유는 §3.3.

### 3.2 공개 계약 (전량)

`runner` 쪽 스키마 확장.

```ts
// packages/runner/src/spec/types.ts

/** 승인 시점에 사람이 케이스에 내린 판정. */
export type CaseApprovalStatus = "passed" | "serverDefect";

export interface SuiteCaseApproval {
  /** `cases[].id` 와 같은 값. */
  readonly id: string;
  readonly status: CaseApprovalStatus;
}

export interface SuiteApproval {
  readonly fingerprint: string;
  /**
   * 승인 시점 시험 실행의 케이스별 판정. 생략 가능하다. 없으면 시험 실행을 거치지 않은
   * 명세이며 `test` 는 아무 문장도 덧붙이지 않는다.
   */
  readonly cases?: readonly SuiteCaseApproval[];
}
```

`cli` 쪽 신규 계약.

```ts
// packages/cli/src/dry-run.ts

export interface DryRunCaseOutcome {
  readonly caseId: string;
  /** 화면에 쓰는 이름. `cases[].name` 을 그대로 옮긴다. */
  readonly caseName: string;
  readonly status: "passed" | "failed" | "timedOut" | "cancelled" | "notRun";
  /** 실패 사유 문장. `renderReport` 가 만든 케이스 블록을 그대로 담는다. */
  readonly detail: string;
}

export interface DryRunResult {
  readonly outcomes: readonly DryRunCaseOutcome[];
  /** 시험 실행 자체가 끝까지 못 간 경우. 케이스 판정과 다른 실패다. */
  readonly aborted?: { readonly reason: "connectionLost" | "payloadLimit"; readonly detail: string };
}

/**
 * 진단(stderr)과 화면 출력은 받지 않는다. 이 모듈은 `McpClient` 만 안다. §8.4 의 stderr 꼬리는
 * 호출 측이 기존 `renderProcessDiagnostics` 로 붙인다.
 */
export interface RunDryRunOptions {
  readonly client: McpClient;
  readonly suite: TestSuiteSpec;
}

export async function runDryRun(options: RunDryRunOptions): Promise<DryRunResult>;
```

```ts
// packages/cli/src/dry-run-review.ts

export type CaseClassification = "passed" | "serverDefect" | "specError";

export interface DryRunReviewResult {
  /** 저장을 진행해도 되는가. false 면 검토 메뉴로 돌아간다. */
  readonly cleared: boolean;
  /** `cleared` 가 true 일 때만 채워진다. 케이스 전량이 들어 있다. */
  readonly approvals: readonly SuiteCaseApproval[];
  /** 사용자가 `specError` 로 표시한 케이스. 저장을 막는 사유가 된다. */
  readonly specErrors: readonly string[];
}

export async function reviewDryRun(
  io: ReviewIO,
  result: DryRunResult,
): Promise<DryRunReviewResult>;
```

```ts
// packages/cli/src/reset-hook.ts

export class ResetCommandError extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  );
}

/** 셸을 거치지 않는다. 공백으로 나눈 첫 토큰이 실행 파일, 나머지가 인자다. */
export async function runResetCommand(command: string): Promise<void>;
```

```ts
// packages/cli/src/cassette-wiring.ts

export interface CassetteWiring {
  readonly client: McpClient;
  /** 시험 실행이 끝난 뒤 호출한다. 녹화가 없었으면 파일을 쓰지 않는다. */
  flush(): Promise<void>;
  /** 같은 키에 다른 응답이 왔다는 경고. 화면에 그대로 찍는다. */
  readonly warnings: readonly string[];
}

export async function wireCassette(options: {
  readonly inner: McpClient;
  readonly path: string | undefined;
  readonly forceRecord: boolean;
}): Promise<CassetteWiring>;
```

### 3.3 의존 방향

시험 실행은 `runSuite`(runner)를 부른다. 이 호출을 **`cli` 에 둔다.** `generate` 에 두지 않는다.

`generate → runner` 간선 자체는 ADR-0009 로 이미 승인돼 있지만, 승인된 것은 **심볼 목록**이고
`runSuite` 는 그 목록에 없다. 넣으려면 ADR-0009 를 개정해야 한다. 그럴 이유가 없다.

- `cli → runner` 는 이미 `test` 경로에서 쓰는 정상 간선이다. 새 간선이 아니다.
- `generate` 는 서버를 실행하지 않는다는 성질을 유지하는 편이 낫다. 지금 `generate` 의
  단위 테스트는 전부 인메모리인데, 실행이 들어오면 그 성질이 깨진다.
- 카세트(`record`)도 `cli` 에서만 조립한다. `generate → record` 형제 간선을 만들지 않는다.
  이것은 로드맵이 이미 정한 배선이다.

즉 `generate` 는 자기 후보가 실제로 실행되는지 모른 채로 돈다. 바뀌는 것은 `cli` 가 `save` 를
처리하는 순서뿐이다.

## 4. 실행 흐름

### 4.1 연결 수명이 바뀐다

지금은 `listTools` 직후 연결을 닫는다. 시험 실행이 검토 메뉴 안쪽에서 일어나므로 **검토가
끝날 때까지 연결을 유지해야 한다.**

```
현재:  connect → listTools → close → baseline → 검토 루프 → save
변경:  connect → listTools → baseline → 검토 루프 → (save 에서 시험 실행) → close
```

이 변경의 대가를 명시한다.

- 사용자가 검토를 오래 하면 서버 프로세스가 그동안 살아 있다. AI 왕복이 끼면 수 분이 될 수
  있다. 이것을 감수한다. 대안은 시험 실행 직전에 다시 연결하는 것인데, 그러면 `listTools` 를
  본 서버와 시험 실행을 받는 서버가 다른 프로세스가 되어 툴 선언이 바뀌었을 가능성이 생긴다.
  같은 프로세스라는 성질이 더 중요하다.
- 검토 도중 서버가 죽으면 시험 실행에서 드러난다. `runSuite` 가 `OPERATION_FAILED` 를 내고
  `DryRunResult.aborted.reason` 이 `connectionLost` 가 된다. 이때 단계 1 의 stderr 꼬리를
  함께 찍는다(§8.4).
- `--baseline-only` 경로는 지금과 같다. 시험 실행이 없으므로 `listTools` 직후 닫는다.

### 4.2 `save` 를 골랐을 때의 순서

```
1. 최종 지문 표시 (기존)
2. 시험 실행 고지와 확인          ← 신규
3. 초기화 명령 실행 (있으면)       ← 신규, ADR-0023
4. 카세트 조립 (있으면)            ← 신규
5. runSuite 로 후보 명세 전량 실행  ← 신규
6. 결과 표시                       ← 신규
7. 실패 케이스 분류                ← 신규
8. 미분류·명세 오류가 있으면 메뉴로 복귀 ← 신규
9. 저장 확인 (기존)
10. finalize → saveSuite (기존, approval.cases 가 실린다)
11. 카세트 flush                   ← 신규
12. 커버리지 보고 (기존)
```

7에서 사용자가 `specError` 를 하나라도 고르면 8에서 멈춘다. 고치는 것은 기존 메뉴의 일이다.
`revise`(AI 에게 피드백) 또는 `edit`(JSON 직접 수정)로 돌아간다. 고친 뒤 다시 `save` 를 고르면
시험 실행이 다시 돈다. 카세트가 있으면 안 바뀐 케이스는 재생되므로 서버를 다시 때리지 않는다.

### 4.3 시험 실행은 기본 동작이다

`--no-dry-run` 을 주면 건너뛴다. 기본값은 실행이다.

옵트인으로 두지 않는 이유는 ADR-0022 와 같다. 목표가 "미확인 상태로 승인되는 케이스를 0으로"
인데 기본값이 미확인이면 그 목표는 옵션 문서를 읽은 사람에게만 성립한다.

`--no-dry-run` 으로 저장한 명세는 `approval.cases` 가 없다. 즉 파일이 스스로 "이 명세는 검증을
안 거쳤다" 고 말한다. 저장 직전에 그 사실을 한 번 더 보여준다(§8.5).

### 4.4 전량 실행한다

부작용 있는 툴을 골라내지 않는다. 근거 둘.

- MCP 의 `ToolAnnotations`(`readOnlyHint` 등)는 전부 optional 이다. 서버가 안 붙이면 판별할
  방법이 없고, 붙었어도 서버가 정직하다는 보장이 없다.
- 사용자가 일부 케이스를 실행에서 빼면 그 케이스는 승인 조건("실제 서버에 한 번 이상 실행")을
  영영 못 채운다. 즉 `delete_*` 류가 명세에 못 들어간다. 회귀 테스트가 가장 필요한 곳을
  정의가 스스로 막는다.

전제는 **대상이 사용자 소유의 개발 서버**라는 것이다. 프로덕션 데이터가 아니다. 안전장치는
실행 직전 확인 하나로 둔다(§8.1). 이 전제를 도움말에도 적는다.

### 4.5 실행 순서는 `cases` 배열 순서다

`runSuite` 가 순차 실행하고 그 순서가 곧 명세의 순서다. 정렬하지 않는다. 상태를 바꾸는 케이스가
있으면 순서가 결과를 만들지만, 그 순서는 사용자가 보고 승인한 것이고 지문에도 들어간다
(ADR-0017 이 `cases` 배열 순서를 의미로 보존한다).

## 5. 카세트 배선

### 5.1 옵트인이다

`--cassette <path>` 를 줬을 때만 카세트를 쓴다. 기본은 직접 호출이다.

기본으로 켜지 않는 이유는 파일을 말없이 만들지 않기 위해서다. 카세트는 서버 응답 전문이 담긴
산출물이고 어디에 둘지는 사용자가 정해야 한다. 경로를 정해주는 순간 `.gitignore` 도 우리가
정하는 셈이 된다.

### 5.2 모드 결정

| 조건 | 모드 |
|---|---|
| `--cassette` 없음 | 카세트 없음. `inner` 를 그대로 쓴다 |
| `--cassette` 있고 파일 없음 | `record` |
| `--cassette` 있고 파일 있음 | `auto` |
| `--cassette` + `--record` | `record` (기존 파일을 무시하고 새로 녹화) |

`replay` 모드는 `generate` 경로에서 쓰지 않는다. 새 케이스가 추가되는 것이 이 경로의 정상
흐름인데 `replay` 는 미스에서 실패하기 때문이다. `replay` 는 `test` 경로의 관심사이고 이
설계의 비범위다.

### 5.3 경고를 그대로 보여준다

`cassetteClient` 의 `onWarning` 은 같은 키에 다른 응답이 왔을 때 부른다. 이것은 사실상
**상태 의존 탐지기**다. 문장을 우리가 다시 만들지 않고 받은 문장을 그대로 찍는다.

```
⚠ 같은 입력에 다른 응답이 왔습니다: list_todos
   녹화본은 첫 응답을 유지합니다. 이 툴은 서버 상태에 의존할 수 있습니다.
```

경고는 저장을 막지 않는다. 상태에 의존하는 툴이 있는 것 자체는 정상이다.

### 5.4 카세트는 `flush` 에서만 쓴다

`cassetteClient.close()` 가 `onFlush` 를 부르고 그 안에서 `inner.close()` 까지 부른다. 우리는
검토 도중 연결을 닫으면 안 되므로 **`close()` 를 시험 실행 종료 시점에 부르지 않는다.**
`wireCassette` 가 `flush()` 를 따로 노출하고, 그 안에서 `saveCassette` 만 호출한다. 연결
종료는 기존 경로가 그대로 맡는다.

이것이 `record` 패키지를 고치지 않고 쓰는 방법이다. `onFlush` 를 우리가 원하는 시점에 부를 수
있도록 `cassetteClient` 를 감싸는 얇은 층이 `cassette-wiring.ts` 다.

### 5.5 비용

ADR-0022 가 위반 케이스를 상한 없이 만든다. 툴 5개짜리 서버에서 케이스가 20~40개가 되는 것이
보통이고, 첫 시험 실행은 그만큼 실제 호출이 나간다.

위반 케이스는 서버가 입력 검증에서 거절하면 외부 API 까지 가지 않아 정상 케이스보다 싸다. 단
**검증이 없는 서버에서는 그대로 나간다.** 즉 비용이 가장 큰 경우가 결함이 있는 경우다. 이 사실을
시험 실행 고지 화면에 케이스 수와 함께 적는다(§8.1).

## 6. 초기화 훅

ADR-0023 의 결정을 그대로 구현한다. 여기서는 배선만 적는다.

- 옵션은 `--reset-cmd <command>` 하나다. 명세 파일에서는 받지 않는다.
- 실행 시점은 시험 실행 직전 1회다. 케이스마다가 아니다. 재시도하지 않는다.
- 카세트 모드가 `record` 또는 `auto` 일 때 실행하고, 카세트가 없을 때도 실행한다. 서버를
  접촉하지 않는 경로(`--no-dry-run`)에서는 실행하지 않는다.
- 셸을 거치지 않는다. `execFile` 로 실행한다. 공백으로 나눈 첫 토큰이 실행 파일이다.
  따옴표 처리를 하지 않으므로 공백이 들어간 인자가 필요하면 사용자가 스크립트 파일을 만든다.
  이 제약을 도움말에 적는다.
- 종료 코드가 0이 아니면 `ResetCommandError` 를 던지고 시험 실행을 시작하지 않는다. 저장도
  하지 않는다. 검토 메뉴로 돌아간다.
- 초기화 명령의 stdout 은 버린다. stderr 은 실패했을 때만 마지막 3줄을 보여준다. 성공 경로에서
  남의 명령 출력을 우리 화면에 섞지 않는다.
- 타임아웃은 60초다. 시드 스크립트가 그보다 오래 걸리면 사용자가 알아야 한다. 초과하면
  프로세스를 죽이고 실패로 다룬다.

## 7. 분류를 어디에 저장하는가

### 7.1 `approval.cases` 에 넣는다

ADR-0017 이 지문 계산에서 `approval` 블록을 **통째로** 제외했고, 그 이유로 "단계 3 이 `approval`
에 케이스별 승인 상태를 더할 때 제외 규칙이 항목 수만큼 늘어나는 것을 막기 위해" 를 적었다.
그 예고를 그대로 따른다.

```json
{
  "schemaVersion": 1,
  "id": "todo-suite",
  "name": "todo 서버",
  "approval": {
    "fingerprint": "8f1c...",
    "cases": [
      { "id": "add_todo-happy", "status": "passed" },
      { "id": "list_todos-happy", "status": "passed" },
      { "id": "delete_todo-required-id", "status": "serverDefect" }
    ]
  },
  "cases": [ ... ]
}
```

- 지문은 바뀌지 않는다. `approval` 전체가 계산에서 빠지기 때문이다.
- `cases` 배열의 순서는 명세 `cases` 순서와 같게 쓴다. 사람이 두 블록을 눈으로 대조한다.
- 타임스탬프를 넣지 않는다. 실행 시각은 결정론성 계약을 깨고, "언제 승인했나" 는 git 이 답한다.
- 실행 환경(호스트, 서버 버전)도 넣지 않는다. 같은 이유다.

### 7.2 `specError` 는 저장되지 않는다

분류 셋 중 파일에 남는 것은 둘뿐이다. `specError` 는 "이 케이스는 틀렸다" 는 뜻이고, 틀린
케이스를 저장하는 것은 이 게이트의 목적과 반대다. 사용자가 고칠 때까지 저장이 막힌다.

### 7.3 저장 뒤 `test` 가 읽을 때의 불일치

명세를 손으로 고쳐 케이스를 추가하면 `approval.cases` 에 없는 케이스가 생긴다. 지문 불일치가
먼저 잡히므로(단계 8) 별도 처리를 하지 않는다. `test` 는 `approval.cases` 에 있는 id 만 참고
문장에 쓰고, 없는 id 는 침묵한다.

반대로 `approval.cases` 에 있는데 `cases` 에 없는 id 도 침묵한다. 검증 단계에서 오류로 만들면
케이스를 지우는 정상 편집이 파일을 깨진 것으로 만든다.

## 8. 화면 (전량)

### 8.1 시험 실행 고지

```
시험 실행: 케이스 24개를 실제 서버에 보냅니다.
  대상: node examples/todo-server/index.js
  카세트: .mcpeak/todo.cassette.json (신규 녹화)
  초기화: npm run seed

이 실행은 서버 상태를 바꿀 수 있습니다. 입력 검증이 없는 서버라면 외부 API 호출도
그대로 나갑니다.
계속할까요? [y/N]
```

카세트나 초기화가 없으면 그 줄을 찍지 않는다. 빈 값을 보여주지 않는다.

### 8.2 진행과 결과

```
▸ 초기화: npm run seed
▸ 시험 실행 중... 24/24

  ✓ 통과 21건
  ✗ 실패 3건

  [1] add_todo/필수 필드 'title' 누락 거절
      → isError true 를 기대했지만 정상 응답을 받았습니다.
        받은 응답: { "id": "t-9", "title": null }

  [2] get_todo/정상 응답
      → 응답 본문에 'title' 필드가 없습니다. 발견된 필드: 'name'

  [3] delete_todo/정상 응답
      → 툴 'delete_todo' 호출 중 오류가 발생했습니다.
        받은 오류: "id 't-1' 를 찾을 수 없습니다"
```

실패 사유 문장은 `renderReport` 가 만든 것을 그대로 쓴다. 여기서 새 문안을 만들지 않는다.
같은 실패를 `test` 에서 볼 때와 `generate` 에서 볼 때 문장이 다르면 사용자가 두 번 배운다.

### 8.3 분류

```
  [1] add_todo/필수 필드 'title' 누락 거절
      [s] 서버 결함  명세가 옳다. 이 케이스를 회귀 테스트로 남긴다
      [m] 명세 오류  추측이 틀렸다. 저장 전에 고친다
      [?] 판단 보류  분류를 미룬다. 저장은 막힌다
      선택: 
```

실패 사유는 여기서 다시 찍지 않는다. 바로 앞의 §8.2 가 같은 번호로 이미 보여줬고, 실패가 한
건일 때 같은 블록이 연달아 두 번 나오면 사용자는 그것을 중복 출력으로 읽는다. 번호와 이름만
다시 적어 어느 케이스를 묻는지 고정한다. 실사용에서 확인하고 고친 것이다(2026-08-15).

세 번째 선택지를 둔다. 보류를 없애면 사용자가 모르는 채로 아무거나 고르게 되고, 그렇게 들어간
`serverDefect` 는 없는 버그를 회귀 테스트로 굳힌다. 모르겠다고 말할 수 있어야 한다.

전부 분류하면 요약을 찍는다.

```
  분류: 서버 결함 2건, 명세 오류 1건

  명세 오류 1건이 있어 저장할 수 없습니다.
  → 검토 메뉴의 revise 또는 edit 으로 고친 뒤 다시 save 를 고르세요.
  → 고친 케이스만 서버에 다시 나갑니다. 나머지는 카세트에서 재생됩니다.
```

마지막 줄은 **실제 카세트 모드**로 갈린다. 재생은 `auto` 에서만 일어난다. 신규 녹화(`record`)는
회차마다 전량을 다시 보내므로 위 문장이 거짓이 된다. 그래서 경로 유무가 아니라 `wireCassette`
가 정한 모드를 받는다. 카세트가 없으면 다음을 찍는다.

```
  → 다시 save 를 고르면 케이스 24개가 모두 서버에 다시 나갑니다.
    반복 비용이 부담되면 --cassette 를 쓰세요.
```

신규 녹화 중이면 둘째 줄만 갈린다. 이미 `--cassette` 를 쓰는 중이라 그것을 쓰라고 하면 안 된다.

```
  → 다시 save 를 고르면 케이스 24개가 모두 서버에 다시 나갑니다.
    신규 녹화 중이라 이번 세션에서는 재생하지 않습니다.
```

### 8.4 시험 실행이 끝까지 못 간 경우

```
✗ 시험 실행을 마치지 못했습니다. 12/24 케이스에서 연결이 끊겼습니다.
  → 툴 'summarize' 호출 중 오류가 발생했습니다.

서버 stderr (마지막 20줄):
  FATAL: heap out of memory
    at Object.summarize (/app/tools/summarize.js:41:11)

저장하지 않았습니다. 서버를 고친 뒤 다시 save 를 고르세요.
```

stderr 블록은 단계 1 의 `renderProcessDiagnostics` 를 그대로 쓴다. `--stderr-lines` 도 그대로
적용된다. 여기서 새 렌더러를 만들지 않는다.

러너가 제한 시간 초과로 멈춘 경우도 같은 자리에 들어간다. 첫 줄만 갈린다.

```
✗ 시험 실행을 마치지 못했습니다. 12/24 케이스에서 멈췄습니다.
  → 케이스 'summarize 정상 응답' 가 제한 시간 안에 끝나지 않았습니다. 남은 케이스는 실행되지 않았습니다.
```

러너는 이때 남은 케이스를 `notRun` 으로 채워 보고서를 낸다. 그것을 중단으로 옮기지 않으면
서버에 보낸 적도 없는 케이스가 분류 화면으로 가고, 사용자가 `서버 결함` 을 고르면 없는 버그가
회귀 테스트로 굳는다. 보고서를 받은 뒤 `RunnerExecution.drain` 을 기다리는 이유도 같은 계열이다.
제한 시간을 넘긴 요청은 아직 살아 있고, 그 응답이 다음 회차 도중에 도착하면 카세트에 섞인다.

### 8.5 `--no-dry-run` 으로 저장할 때

```
⚠ 시험 실행을 건너뜁니다. 케이스 24건이 실제 서버에서 확인되지 않은 채 저장됩니다.
   저장된 명세에 승인 기록(approval.cases)이 남지 않습니다.
   계속할까요? [y/N]
```

## 9. `test` 쪽 소비

`serverDefect` 로 표시된 케이스가 `test` 에서 실패하면 참고 문장 한 줄을 덧붙인다.

```
✗ delete_todo/정상 응답
    → 정상 응답을 기대했지만 오류 응답을 받았습니다.
      받은 오류: "id 't-1' 를 찾을 수 없습니다"
    참고: 승인 시점에 서버 결함으로 표시된 케이스입니다. 서버가 아직 고쳐지지 않았습니다.
```

- **종료 코드를 바꾸지 않는다.** 알려진 결함이어도 실패는 실패다. 초록으로 만들면 고칠 이유가
  사라진다. 회귀 테스트로 남긴다는 것은 고쳐질 때까지 빨간불로 남는다는 뜻이다.
- `passed` 로 표시된 케이스가 실패하면 아무 문장도 덧붙이지 않는다. 그것은 새 회귀이고 기존
  실패 문장이 이미 필요한 것을 다 말한다.
- `serverDefect` 케이스가 통과하면 침묵한다. "고쳐졌다" 를 알려주는 것은 유용해 보이지만
  `test` 화면은 실패를 보는 자리다. 통과 케이스에 문장을 붙이면 초록 출력이 길어진다.
  후속 후보로만 남긴다(§15).
- 지문이 불일치면 이 문장을 찍지 않는다. 명세가 바뀌었으면 승인 시점의 판정이 지금 케이스에
  해당하는지 알 수 없다. 지문 불일치 자체는 단계 8 이 이미 보고한다.

## 10. 결정론성

- 시험 실행 결과는 `RunnerReport` 를 거치므로 기존 결정론성 계약을 그대로 물려받는다.
- `approval.cases` 에 시각·환경·소요 시간을 넣지 않는다(§7.1).
- 초기화 명령의 출력은 성공 경로에서 화면에 안 나온다(§6). 보고서에도 안 들어간다.
- 카세트 경로 문자열은 화면에만 쓰고 명세 파일에 안 남긴다. 남기면 같은 명세가 사람마다 다른
  파일이 된다.
- 진행 표시(`24/24`)는 stdout 에 쓰지만 `--json` 출력에는 넣지 않는다. `generate` 는 아직
  `--json` 이 없으므로 이 항목은 예약이다.

## 11. 비대화형 경로

시험 실행은 TTY 를 요구한다. 분류가 사람의 판단이기 때문이다.

| 경로 | 동작 |
|---|---|
| `--baseline-only` (TTY 없음) | 시험 실행 없음. `approval.cases` 없이 저장. 지금과 동일 |
| 대화형 + `--no-dry-run` | 시험 실행 없음. 확인 한 번 받고 저장(§8.5) |
| 대화형 기본 | 시험 실행 + 분류 |

CI 에서 명세를 만드는 경로는 `--baseline-only` 뿐이고 그것은 지금도 AI 를 안 쓴다. 즉 이
설계가 CI 를 새로 막지 않는다.

비대화형에서 분류를 자동으로 정하는 모드(예: 실패는 전부 `specError`)를 두지 않는다. 그것은
사람이 판단했다는 기록을 기계가 위조하는 것이고, 승인 정의를 무의미하게 만든다.

## 12. 보안

- `--reset-cmd` 는 CLI 인자에서만 받는다. 명세 파일에서 받지 않는다(ADR-0023).
- 셸을 거치지 않는다. `execFile` 이므로 `;`·`&&`·백틱이 해석되지 않는다.
- 카세트 파일에는 서버 응답 전문이 들어간다. `record` 의 `redact` 가 민감 키를 가리지만
  본문 텍스트 안의 비밀은 못 잡는다. 카세트 경로를 정할 때 `.gitignore` 를 확인하라는 문장을
  도움말에 넣는다.
- 시험 실행 화면에 찍히는 응답은 `runner` 의 redaction 을 그대로 거친다. 새 경로를 만들지
  않는다.

## 13. 테스트

전부 인메모리다. 예외는 §13.5 의 실서버 E2E 하나이고 직렬 전용이다.

### 13.1 `packages/cli/tests/reset-hook.test.ts` (신규)

```
runResetCommand
  · 종료 코드 0 이면 resolve 한다
  · 종료 코드 1 이면 ResetCommandError 를 던지고 exitCode 가 1 이다
  · 실행 파일이 없으면 ResetCommandError 를 던진다
  · stderr 이 ResetCommandError.stderr 에 담긴다
  · 셸 메타문자가 인자로 전달된다 (echo "a && b" 가 파일을 만들지 않는다)
  · 60초를 넘기면 프로세스를 죽이고 ResetCommandError 를 던진다
```

### 13.2 `packages/cli/tests/dry-run.test.ts` (신규)

```
runDryRun
  · 통과 케이스만 있는 스위트는 outcomes 전부 passed 이고 aborted 가 없다
  · 실패 케이스의 detail 이 renderReport 의 케이스 블록과 같다
  · 케이스 실행 순서가 suite.cases 순서와 같다 (fake client 가 호출 순서를 기록한다)
  · 호출 중 client 가 던지면 aborted.reason 이 connectionLost 다
  · runSuite 가 RunnerPayloadLimitError 를 던지면 aborted.reason 이 payloadLimit 이고
    scope 에 따라 안내가 갈린다 (report 는 케이스 수, case 는 그 케이스를 줄이라고 한다)
  · 제한 시간 초과로 러너가 멈추면 aborted.reason 이 stopped 이고 notRun 이 outcomes 에 없다
  · 남은 호출이 끝난 뒤에 반환한다 (drain)
  · 같은 입력으로 2회 실행한 DryRunResult 가 JSON.stringify 기준 동일하다
```

### 13.3 `packages/cli/tests/dry-run-review.test.ts` (신규)

```
reviewDryRun
  · 실패 0건이면 사용자에게 아무것도 묻지 않고 cleared true 를 준다
  · 실패 케이스에 s 를 고르면 approvals 에 serverDefect 로 들어간다
  · 실패 케이스에 m 을 고르면 specErrors 에 들어가고 cleared 가 false 다
  · 실패 케이스에 ? 를 고르면 cleared 가 false 이고 specErrors 는 비어 있다
  · 통과 케이스도 approvals 에 passed 로 들어간다 (전량이 기록된다)
  · approvals 순서가 outcomes 순서와 같다
  · 알 수 없는 입력을 주면 같은 질문을 다시 묻는다
```

### 13.4 `packages/cli/tests/generate-command.test.ts` (수정)

```
generate save 경로
  · 기본 경로에서 시험 실행 고지가 나오고 거절하면 저장하지 않는다
  · 실패 케이스를 serverDefect 로 분류하면 approval.cases 에 실린다
  · specError 가 하나라도 있으면 저장하지 않고 종료 코드가 0 이 아니다
  · 미분류(?)가 있으면 저장하지 않는다
  · --no-dry-run 이면 시험 실행 없이 저장되고 approval.cases 가 없다
  · --reset-cmd 가 실패하면 시험 실행을 시작하지 않고 저장도 안 한다
  · --cassette 를 주면 2회차 save 에서 서버 호출이 새 케이스 수만큼만 늘어난다
  · approval.cases 가 실려도 suiteFingerprint 가 바뀌지 않는다
  · --baseline-only 는 시험 실행을 하지 않는다
```

### 13.5 `packages/cli/tests/dist-cli-e2e.mjs` (수정)

이 파일은 `pnpm test` 가 아니라 `pnpm build && pnpm --filter @mcpeak/cli test:e2e` 로만 돈다. CI 의 `build` job 이 부른다.
출력 형태를 바꾸는 변경이므로 여기 기대값을 함께 고쳐야 한다. 계약 축 커버리지 작업에서
이것을 빠뜨려 로컬은 녹색인데 CI 가 빨간불이 된 선례가 있다.

```
· generate --baseline-only 출력이 시험 실행 줄 없이 기존과 같다
· generate --no-dry-run 이 경고 줄을 찍는다
```

### 13.6 `packages/runner/tests/spec-validation.test.ts` (수정)

```
approval.cases
  · 없으면 valid 다
  · 빈 배열이면 valid 다
  · id 가 문자열이 아니면 INVALID_VALUE 다
  · status 가 passed·serverDefect 밖이면 INVALID_VALUE 다
  · 중복 id 가 있으면 INVALID_VALUE 다
  · approval.cases 를 넣어도 suiteFingerprint 가 안 바뀐다
  · MCP_SUITE_JSON_SCHEMA 가 cases 를 기술한다
```

### 13.7 실서버 E2E (직렬 전용, 후속)

`examples/` 에는 `weather-server` 하나뿐이고 상태가 없다. 초기화 훅이 실제로 가짜 실패를
없애는지는 **상태 있는 예제 서버가 생겨야 확인된다.** ADR-0023 의 결과 항목에 적은 공백이다.

이 설계에서는 훅이 도는지(명령 실행, 실패 시 중단, 건너뜀 조건)까지만 인메모리로 덮고,
상태 있는 예제 서버 추가를 별도 작업으로 올린다. 그것 없이 "잔여물 문제를 해결했다" 고
말하지 않는다.

## 14. 신규 ADR 대상

**케이스 분류의 저장 위치와 `test` 소비 방식.** §7 과 §9 다. 다르게 갈 수 있었던 판단이 셋이다.

- 분류를 `approval.cases` 에 넣을 것인가, 케이스마다 필드로 넣을 것인가. 후자면 지문에 들어가
  분류가 명세의 의미가 된다.
- `serverDefect` 가 `test` 의 종료 코드를 바꿀 것인가. 바꾸면 CI 가 초록이 되지만 고칠 이유가
  사라진다.
- `specError` 를 파일에 남길 것인가. 남기면 "틀린 줄 알면서 저장한 케이스" 가 생긴다.

ADR-0023 은 초기화 훅만 다뤘으므로 이것은 별도 ADR 이다. 번호는 착수 시점에 비어 있는 다음
번호를 잡는다. 병렬 브랜치가 있으면 충돌하므로 `docs/adr/README.md` 를 먼저 확인한다.

## 15. 미해결과 후속

- **상태 있는 예제 서버.** §13.7. 이것이 없으면 초기화 훅의 효과를 우리 CI 가 검증하지 못한다.
- **`serverDefect` 가 통과했을 때 알리기.** §9 에서 침묵으로 정했다. 서버를 고쳤는데 아무도
  안 알려주는 것은 아깝다. `test` 요약 줄에 "이전에 서버 결함으로 표시된 2건이 지금은
  통과합니다" 한 줄을 붙이는 안이 있다. 화면 소음과의 교환이라 실사용 뒤에 정한다.
- **`replay` 전용 실행에서 서버를 안 띄우기.** 지금 구조는 `cassetteClient` 를 만들려면 감쌀
  `inner` 가 있어야 하고, 그러려면 프로세스가 뜬다. 호출만 안 갈 뿐이다. CI 에서 서버 없이
  카세트만으로 `test` 를 돌리려면 `cli` 가 더미 `inner` 를 넣는 처리가 필요하다. 이 설계의
  비범위이고 `test` 경로 작업에서 다룬다.
- **부분 재실행.** 지금은 `save` 를 고를 때마다 전량이 대상이다. 카세트가 있으면 실제 호출은
  새 케이스뿐이지만, 카세트가 없으면 전량이 다시 나간다. "실패한 케이스만 다시" 는 유용해
  보이나 상태를 바꾸는 케이스가 있으면 순서가 달라져 결과가 달라진다. 전량 유지가 안전하다.

### 15.1 구현에서 드러난 후속 (2026-08-15 추가)

구현(T1~T8)을 통합하면서 확인된 것들이다. 설계 시점에는 안 보였다.

- **`test` 의 참고 줄에 케이스 id 가 없다.** §9 는 참고 줄을 케이스 블록 안에 놓지만, 그
  자리는 `runner/src/reporter.ts` 안이고 `renderReport` 가 통짜 문자열을 돌려준다. 구현은
  보고서 뒤의 기존 참고 블록 구역에 붙였다. 서버 결함 케이스가 둘 이상 동시에 실패하면 같은
  문장이 여러 번 찍히고 어느 케이스의 것인지 문장만으로는 모른다. 같은 구역의 다른 참고
  문장들은 전부 케이스 id 를 문장에 담고 있어 이것만 규칙이 다르다. 고치려면 `reporter` 가
  케이스 블록에 외부 문장을 끼울 자리를 열어야 한다. **이 PR 의 범위가 아니다.** `reporter`
  는 `runner` 패키지이고 이 설계는 `test` 출력을 바꾸지 않는 것이 전제다. `test` 경로 작업에서
  다룬다.
- ~~**카세트 첫 녹화 실행에서 §8.3 의 마지막 줄이 참이 아니다.**~~ 리뷰에서 다시 지적받아
  고쳤다. `wireCassette` 가 정한 모드를 `CassetteWiring.mode` 로 내보내고 화면이 그 값
  하나만 본다. 모드 승격은 하지 않았다. 한 세션 안에서 재생 여부가 도중에 바뀌면 같은 실행의
  회차마다 서버가 보는 호출 수가 달라진다.
- ~~**`notRun`·`timedOut` 케이스의 분류 화면.**~~ 리뷰에서 다시 지적받아 고쳤다. 러너가
  중간에 멈추면 `aborted` 로 다루고 분류 화면 자체를 띄우지 않는다. `notRun` 은 판정이
  아니므로 `outcomes` 에서도 뺀다. §8.4 를 보라.
