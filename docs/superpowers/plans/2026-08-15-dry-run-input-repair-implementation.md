# 시험 실행 입력값 교정 구현 계획 (2026-08-15)

- 설계 문서: `docs/superpowers/specs/2026-08-15-dry-run-input-repair-design.md`
- 선행 ADR: ADR-0023(초기화 훅), ADR-0024(케이스 분류 저장 위치)
- 신규 ADR: 교정 단계의 권한 경계, 지문 표시 시점 이동 (R0, 착수 전)
- 대상 패키지: `cli` 전부. **`generate` 와 `runner` 는 안 바뀐다.**
- 선행 작업: 승인 전 시험 실행 게이트(T0~T8, 통합 대장 기록 완료)

## 0. 실행 모델

메인 세션은 오케스트레이터다. 구현·테스트는 서브에이전트 또는 위임 세션이 한다. 메인 세션은
스폰, 보고서와 diff 확인, 검증 재실행, 머지 게이트, 통합 대장 기록만 한다.

모델 배분은 `CLAUDE.local.md` 의 표를 따른다.

- 상위 모델: R2, R3, R6. 화면 문안이 제품이고(R2), AI 권한 경계 판단이 들어가고(R3),
  지문 계약과 배선 순서가 얽힌다(R6).
- 표준 모델: R1, R5, R7. 설계서에 사양이 값 단위로 적혀 있어 판단 여지가 없다.

## 1. 사람 몫 사전 조건

터미널을 열기 전에 두 가지를 확인한다.

```sh
git log --oneline -1     # main 이 기점인지
git status --short       # 깨끗한지
```

설계서와 이 계획서, R0 의 새 ADR 이 `main` 에 커밋돼 있어야 한다. untracked 문서는 새
worktree 에 딸려가지 않는다.

## 2. 태스크 목록

| Task | 내용 | 선행 | 모델 |
|---|---|---|---|
| R0 | 권한 경계·지문 시점 ADR 2건 | 없음 | 메인 세션 |
| R1 | `repair-target.ts` 교정 대상 판별 | R0 | 표준 |
| R2 | `input-repair.ts` 교정 화면과 재실행 | R1 | 상위 |
| R3 | `repair-proposal.ts` AI 제안과 권한 검사 | R1 | 상위 |
| R5 | `dry-run-review.ts` 시도 이력 표시 | R1 | 표준 |
| R6 | `generate-command.ts` 배선·지문 이동·옵션 | R1~R5 | 상위 |
| R7 | `help.ts`·`dist-cli-e2e.mjs` | R6 | 표준 |

R4 번호는 쓰지 않는다. 단일 케이스 재실행에 새 모듈이 필요하지 않다는 것이 §4 R2 의 결론이라
초안에서 지운 번호를 그대로 비워 둔다.

### 의존성 그래프

```
R0 → R1 ─┬─→ R2 ─┐
         ├─→ R3 ─┼─→ R6 → R7
         └─→ R5 ─┘
```

### 웨이브

| 웨이브 | 태스크 | 터미널 | 병렬 |
|---|---|---|---|
| 0 | R0 | 메인 세션 | - |
| 1 | R1 | A | 단독 |
| 2 | R2 / R3 · R5 | B / C | B와 C 병렬 |
| 3 | R6 · R7 | D | 직렬 전용 |

R1 을 단독 웨이브로 두는 이유는 R2·R3·R5 가 전부 R1 의 타입을 쓰기 때문이다. 웨이브 3 을
직렬로 두는 이유는 R7 의 `dist-cli-e2e.mjs` 가 실제 서버 프로세스를 띄우기 때문이다.

## 3. PR 분할

| PR | 태스크 | 비고 |
|---|---|---|
| 1 | R1 | 순수 함수. 단독 머지 가능 |
| 2 | R2·R3·R5 | 신규 모듈 둘과 화면 한 줄. 배선 없음 |
| 3 | R6·R7 | 배선과 화면 |

스택 PR 을 만들지 않는다. 베이스가 피처 브랜치면 CodeRabbit 이 리뷰를 건너뛴다.

## 4. 태스크 상세

### R0: ADR 2건 (메인 세션)

**Files**
- Create: `docs/adr/0025-시험-실행-입력값-교정-권한-경계.md`
- Create: `docs/adr/0026-승인-지문-표시-시점.md`
- Modify: `docs/adr/README.md`

번호는 착수 시 `docs/adr/README.md` 로 확인한다. 설계서 §11.1 과 §11.2 의 선택지를 각각
배경/선택지/결정/이유/결과 다섯 항목으로 적는다.

**완료 조건**: 파일 둘이 존재하고 README 표에 두 줄이 늘었다. 상태는 `채택`.

---

### R1: 교정 대상 판별 (`cli`)

**Files**
- Create: `packages/cli/src/repair-target.ts`
- Test: `packages/cli/tests/repair-target.test.ts`

**공개 계약 (전량, 한 글자도 바꾸지 마라)**

```ts
import type { DryRunCaseOutcome } from "./dry-run.js";
import type { TestSuiteSpec } from "@ohmymcp/runner";
import type { JsonValue } from "@ohmymcp/runner";

/** 교정을 시도할 수 있는 실패 케이스. 설계 문서 §4.2 를 전부 만족한 것만 만들어진다. */
export interface RepairTarget {
  readonly caseId: string;
  readonly caseName: string;
  readonly tool: string;
  /** 현재 입력값. 키 순서는 명세에 적힌 순서다. */
  readonly input: Readonly<Record<string, JsonValue>>;
  /** 서버가 돌려준 오류 본문. 제안과 화면의 근거다. 없으면 빈 문자열이다. */
  readonly serverMessage: string;
}

/** 한 케이스에 대해 시도한 값의 이력. 분류 화면(§8.7)이 쓴다. */
export interface RepairAttempt {
  readonly field: string;
  readonly value: JsonValue;
  readonly passed: boolean;
}

export function selectRepairTargets(options: {
  readonly suite: TestSuiteSpec;
  readonly outcomes: readonly DryRunCaseOutcome[];
  readonly origins: ReadonlyMap<string, "schemaBaseline" | "ai" | "user">;
}): readonly RepairTarget[];
```

**판별 규칙 (전량, 설계서 §4.2)**

케이스가 아래를 **모두** 만족할 때만 `RepairTarget` 이 된다.

| 조건 | 확인 방법 |
|---|---|
| 실패한 케이스다 | `outcome.status !== "passed"` |
| `callTool` 케이스다 | `case.operation.type === "callTool"` |
| 입력 키가 하나 이상 | `Object.keys(case.operation.input).length > 0` |
| origin 이 `user` 가 아니다 | `origins.get(caseId) !== "user"` |
| 위반 케이스가 아니다 | `isError` 단언의 `expected !== true` |
| 실패 사유가 `isError` 다 | `outcome.detail` 에 `isError` 로 시작하는 단언 줄이 있다 |

`origins` 에 없는 caseId 는 `schemaBaseline` 으로 본다. 호출 측이 provenance 를 못 구한
경우이고, 그때 교정을 막으면 기능이 통째로 안 도는 쪽이 더 나쁘다.

`serverMessage` 는 `outcome.detail` 에서 서버 오류 본문 줄만 뽑는다. 문장을 새로 만들지 마라.
뽑을 것이 없으면 빈 문자열이다.

**순서**: 반환 배열은 `outcomes` 순서다. 정렬하지 마라.

**테스트 (이름과 단언 전량)**

```
selectRepairTargets
  · 통과한 케이스는 대상이 아니다
  · listTools 케이스는 대상이 아니다
  · 입력이 빈 객체면 대상이 아니다
  · origin 이 user 면 대상이 아니다
  · origins 에 없는 caseId 는 schemaBaseline 으로 보고 대상이 된다
  · isError expected true 인 위반 케이스는 대상이 아니다
  · 본문 스키마 불일치로만 실패한 케이스는 대상이 아니다
  · isError 로 실패한 baseline 케이스는 대상이다
  · input 의 키 순서가 명세 순서와 같다
  · serverMessage 에 서버 오류 본문이 들어간다
  · 서버 오류 본문이 없으면 serverMessage 가 빈 문자열이다
  · 반환 순서가 outcomes 순서와 같다
```

**명령**: `pnpm test`, `pnpm typecheck --force`, `pnpm lint`
**보고서**: `docs/reports/task-r1-input-repair.md`
**커밋**: `feat(cli): 시험 실행 실패에서 입력값 교정 대상을 가려낸다`

---

### R2: 교정 화면과 재실행 (`cli`)

**Files**
- Create: `packages/cli/src/input-repair.ts`
- Test: `packages/cli/tests/input-repair.test.ts`

**공개 계약 (전량)**

```ts
export interface RepairOutcome {
  readonly caseId: string;
  /** 통과로 끝났는가. false 면 값이 되돌려진 상태다. */
  readonly repaired: boolean;
  /** 통과한 경우의 최종 입력값. repaired 가 false 면 undefined 다. */
  readonly input?: Readonly<Record<string, JsonValue>>;
  /** 시도 이력. 분류 화면이 쓴다. 순서는 시도 순이다. */
  readonly attempts: readonly RepairAttempt[];
}

export interface RepairInputsOptions {
  readonly io: ReviewIO;
  readonly suite: TestSuiteSpec;
  readonly targets: readonly RepairTarget[];
  /** 케이스 하나를 다시 실행한다. 호출 측이 runDryRun 을 감싸 넘긴다. */
  readonly rerun: (caseId: string, input: Readonly<Record<string, JsonValue>>)
    => Promise<{ readonly passed: boolean; readonly detail: string }>;
  /** AI 제안. 없으면 사람 입력만 쓴다. */
  readonly propose?: (target: RepairTarget)
    => Promise<Readonly<Record<string, JsonValue>> | undefined>;
  /** 입력 스키마. 타입 검사에 쓴다. 툴 이름으로 찾는다. */
  readonly tools: readonly ToolDef[];
}

export async function repairInputs(
  options: RepairInputsOptions,
): Promise<readonly RepairOutcome[]>;
```

**단계 구조 (설계서 §4.1, 전량)**

케이스마다 최대 2회 교정한다.

1. `propose` 가 있고 값을 돌려주면 그 값으로 §8.6 을 찍고 사람 확인을 받는다.
   `propose` 가 없거나 `undefined` 면 §8.6.1 로 사람에게 직접 받는다.
2. 재실행. 통과하면 끝. 실패하면 3으로.
3. 1에서 AI 제안을 썼을 때만 한 번 더 사람에게 받는다. 사람 입력이었으면 여기서 끝낸다.
4. 재실행. 통과하면 끝. 실패하면 값을 1회차 값으로 되돌리고 끝낸다.

**사람 입력 규칙 (설계서 §4.5, 전량)**

- 키마다 묻는다. 현재 값을 함께 보여준다.
- 엔터만 누르면 현재 값을 유지한다.
- 입력 문자열은 `JSON.parse` 를 시도하고, 실패하면 문자열 그대로 쓴다.
- 파싱 결과의 타입이 그 필드의 스키마 `type` 과 안 맞으면 같은 필드를 다시 묻는다.
  스키마가 없는 필드는 검사하지 않는다.
- 모든 키가 그대로면(전부 엔터) 교정을 포기한 것으로 보고 재실행하지 않는다.
  `repaired: false` 로 끝낸다. 같은 값으로 다시 실행하면 결과가 같기 때문이다.

**값 재사용 (설계서 §4.6)**

`(tool, 필드명)` 을 키로 이 호출 안에서 캐시한다. 뒤 케이스의 같은 키에 값이 있으면 묻지 않고
그 값을 적용한 뒤 §8.6.3 한 줄을 찍고 곧바로 재실행한다. 캐시는 **사람이 확인했고 재실행이
통과한 값만** 담는다. AI 제안을 그대로 통과시킨 값도 사람이 엔터를 눌렀으므로 포함된다.

재실행이 통과했을 때만 담는 이유는, 실패한 값을 퍼뜨리면 같은 툴·필드를 쓰는 뒤 케이스들이
물려받은 필드를 묻지 않게 되어 제 몫의 교정 기회를 한 번도 못 쓰고 한꺼번에 죽기 때문이다.
설계서 §4.6 이 캐시를 둔 이유는 통하는 값을 여러 번 묻지 않기 위해서다.

**화면**: 설계서 §8.6, §8.6.1, §8.6.2, §8.6.3 이 전량을 고정한다. 문안을 새로 만들지 마라.

**테스트 (전량)**

```
repairInputs
  · 대상이 없으면 아무것도 묻지 않고 빈 배열을 돌려준다
  · AI 제안이 있으면 그 값이 기본값으로 화면에 나온다
  · AI 제안에 엔터만 누르면 그 값으로 재실행한다
  · AI 제안이 없으면 사람에게 직접 묻는다
  · 재실행이 통과하면 repaired 가 true 이고 input 이 교정값이다
  · 재실행이 통과하면 그 케이스를 더 묻지 않는다
  · AI 제안이 실패하면 사람에게 한 번 더 묻는다
  · 사람 입력이 실패하면 다시 묻지 않고 repaired 가 false 다
  · 두 번 실패하면 attempts 에 두 항목이 시도 순으로 담긴다
  · 두 번 실패하면 input 이 undefined 다
  · 전부 엔터로 값을 그대로 두면 재실행하지 않는다
  · 숫자 문자열을 넣으면 숫자로 파싱된다
  · JSON 이 아닌 문자열은 문자열 그대로 쓰인다
  · 스키마 타입과 안 맞는 값을 주면 같은 필드를 다시 묻는다
  · 같은 툴·같은 필드의 두 번째 케이스는 묻지 않고 캐시값을 쓴다
  · 캐시를 적용할 때 §8.6.3 줄이 나온다
  · 캐시값으로 재실행한 케이스도 attempts 에 남는다
  · 화면 문안이 설계 문서 §8.6 과 같다
  · 화면 문안이 설계 문서 §8.6.1 과 같다
  · rerun 이 던지면 그대로 올라간다
```

`rerun` 과 `propose` 는 테스트가 주입하는 함수다. 실제 서버를 띄우지 마라.

**명령**: `pnpm test`, `pnpm typecheck --force`, `pnpm lint`
**보고서**: `docs/reports/task-r2-input-repair.md`
**커밋**: `feat(cli): 시험 실행 실패 케이스의 입력값 교정 화면을 추가한다`

---

### R3: AI 제안과 권한 검사 (`cli`)

**Files**
- Create: `packages/cli/src/repair-proposal.ts`
- Test: `packages/cli/tests/repair-proposal.test.ts`

**공개 계약 (전량)**

```ts
export interface ProposeRepairOptions {
  readonly target: RepairTarget;
  readonly session: AuthoringSessionView;
  readonly tools: readonly McpToolContext[];
  readonly provider: TestAuthoringProvider;
  readonly prepare: typeof prepareAuthoringRequest;
  readonly dispatch: typeof dispatchAuthoringRequest;
  readonly redaction?: RunnerRedactionOptions;
}

/** 제안된 입력값. 권한 경계를 벗어난 응답은 undefined 로 폐기된다. */
export async function proposeRepair(
  options: ProposeRepairOptions,
): Promise<Readonly<Record<string, JsonValue>> | undefined>;

/** 응답 검사. 허용 범위는 설계 문서 §4.3 이 전량 고정한다. 테스트를 위해 따로 내보낸다. */
export function acceptProposal(options: {
  readonly target: RepairTarget;
  readonly before: TestSuiteSpec;
  readonly after: TestSuiteSpec;
}): Readonly<Record<string, JsonValue>> | undefined;
```

**요청 (설계서 §4.4)**

`prepare({ mode: "revise", instruction, baseline, candidate, tools, providerId, model, redaction })`
로 만들고 `dispatch` 로 보낸다. `mode` 에 값을 추가하지 마라. `AuthoringRequestMode` 는
`generate` 의 공개 타입이고 이 요청은 `revise` 와 구조가 같다.

`instruction` 문안 (전량, 값만 채운다)

```
시험 실행에서 아래 케이스가 실패했습니다. 입력값만 고쳐 주세요.
단언과 케이스 구조는 바꾸지 마세요.

케이스: <caseName> (id: <caseId>)
툴: <tool>
보낸 입력: <canonicalJson(input)>
서버 응답: <serverMessage>
```

`serverMessage` 가 빈 문자열이면 **요청을 보내지 않고 `undefined` 를 돌려준다.** 보낼 근거가
없기 때문이다. redaction 이 본문을 통째로 지운 경우도 같다.

**권한 검사 `acceptProposal` (전량, 설계서 §4.3)**

`after` 에서 아래를 하나라도 위반하면 `undefined` 다. 부분 수용을 하지 마라.

| 검사 | 위반 예 |
|---|---|
| 케이스 수가 같다 | 케이스 추가·삭제 |
| 대상 케이스 외의 어떤 케이스도 `before` 와 deep equal 이다 | 남의 케이스 수정 |
| 대상 케이스의 `operation.tool` 이 같다 | 툴 교체 |
| 대상 케이스의 `assertions` 가 `before` 와 deep equal 이다 | 단언 무력화 |
| 대상 케이스의 `id`·`name`·`timeoutMs` 가 같다 | 메타데이터 변경 |
| 대상 케이스 `operation.input` 의 **키 집합**이 같다 | 키 추가·삭제 |
| 값이 하나 이상 실제로 바뀌었다 | 아무것도 안 고친 응답 |

통과하면 대상 케이스의 `operation.input` 을 그대로 돌려준다.

**테스트 (전량)**

```
proposeRepair
  · serverMessage 가 비어 있으면 provider 를 부르지 않고 undefined 다
  · instruction 에 케이스 id·툴·입력·서버 응답이 들어간다
  · dispatch 가 candidate 를 주면 입력값이 돌아온다
  · dispatch 가 실패 상태를 주면 undefined 다
  · provider 가 던지면 undefined 다 (교정 실패가 시험 실행을 죽이지 않는다)

acceptProposal
  · 입력값만 바뀐 응답을 수용한다
  · 단언이 바뀌면 undefined 다
  · 툴 이름이 바뀌면 undefined 다
  · 케이스가 추가되면 undefined 다
  · 케이스가 삭제되면 undefined 다
  · 대상이 아닌 케이스가 바뀌면 undefined 다
  · 입력 키가 추가되면 undefined 다
  · 입력 키가 삭제되면 undefined 다
  · 케이스 이름이 바뀌면 undefined 다
  · 아무것도 안 바뀌었으면 undefined 다
  · 대상 케이스의 입력값 하나만 바뀌면 그 입력 전체를 돌려준다
```

**명령**: `pnpm test`, `pnpm typecheck --force`, `pnpm lint`
**보고서**: `docs/reports/task-r3-input-repair.md`
**커밋**: `feat(cli): 입력값 교정 제안을 provider 에 요청하고 권한을 검사한다`

---

### R5: 분류 화면의 시도 이력 (`cli`)

**Files**
- Modify: `packages/cli/src/dry-run-review.ts`
- Test: `packages/cli/tests/dry-run-review.test.ts`

**계약 변경 (전량)**

```ts
export async function reviewDryRun(
  io: ReviewIO,
  result: DryRunResult,
  attempts?: ReadonlyMap<string, readonly RepairAttempt[]>,
): Promise<DryRunReviewResult>;
```

세 번째 인자는 선택이다. 안 넘기면 지금과 완전히 같이 동작한다. 기존 호출부를 고치지 마라.
그것은 R6 의 일이다.

**화면 (설계서 §8.7, 전량)**

이력이 있는 케이스만 선택지 위에 아래를 찍는다. 시도가 1건이면 `한 번`, 2건이면 `두 번` 이다.

```
      입력값을 두 번 고쳐 봤지만 결과가 같습니다.
        city: "example" → 오류
        city: "서울"    → 오류
```

- 값은 `JSON.stringify` 로 찍는다. 문자열은 따옴표가 붙는다.
- 필드명 뒤 콜론을 세로로 맞춘다. 가장 긴 필드명 기준이다.
- 이력이 없는 케이스는 이 블록이 통째로 없다. 지금 화면 그대로다.

**테스트 (전량)**

```
reviewDryRun / 시도 이력
  · attempts 를 안 넘기면 화면이 지금과 같다
  · 이력이 있으면 선택지 위에 이력 블록이 나온다
  · 시도가 1건이면 '한 번' 이라고 나온다
  · 시도가 2건이면 '두 번' 이라고 나온다
  · 값이 JSON.stringify 형태로 나온다
  · 필드명 길이가 다르면 콜론이 세로로 맞는다
  · 이력이 없는 케이스에는 블록이 안 나온다
  · 이력이 붙어도 반환값 규칙이 그대로다
```

**명령**: `pnpm test`, `pnpm typecheck --force`, `pnpm lint`
**보고서**: `docs/reports/task-r5-input-repair.md`
**커밋**: `feat(cli): 분류 화면에 입력값 교정 시도 이력을 표시한다`

---

### R6: `generate` 배선 (`cli`)

**Files**
- Modify: `packages/cli/src/generate-command.ts`
- Test: `packages/cli/tests/generate-command.test.ts`
- Test: `packages/cli/tests/generate-integration.test.ts`

**옵션**

| 옵션 | 값 | 규칙 |
|---|---|---|
| `--no-repair` | 없음 | 한 번만. `--no-dry-run` 과 함께 쓰면 사용 오류 |

`flagNames` 집합에 더한다.

**저장 경로 순서**

설계서 §3 의 16단계 그대로다. 기존과 다른 곳은 셋이다.

1. **9~10 신설**: 교정 → 반영
2. **12 이동**: `Final fingerprint:` 표시를 `save` 분기 첫 줄에서 분류 뒤로 옮긴다
3. **11 변경**: `reviewDryRun` 에 시도 이력을 넘긴다

**단일 케이스 재실행 (판단이 갈리는 지점)**

새 모듈을 만들지 마라. 케이스 하나만 담은 스위트를 만들어 기존 `runDryRun` 을 부른다.

```ts
const rerun = async (caseId, input) => {
  const target = suite.cases.find((item) => item.id === caseId);
  const one = { ...suite, cases: [{ ...target, operation: { ...target.operation, input } }] };
  const result = await runDryRun({ client: cassette.client, suite: one });
  const outcome = result.outcomes[0];
  return { passed: outcome?.status === "passed", detail: outcome?.detail ?? "" };
};
```

스위트 전량을 다시 돌리지 않는 이유는 앞서 통과한 케이스가 상태 변화로 뒤집히는 것을 막기
위해서다. 설계서 §9 가 근거다. `result.aborted` 가 있으면 `passed: false` 로 본다.

**교정 결과 반영 (설계서 §5)**

`cli` 가 `TestSuiteSpec` 을 직접 고쳐 넣지 마라. 기존 3단 경로를 탄다.

```
reviewLocalAuthoringCandidate({ session, candidate: 교정된 suite 전체, tools })
  → createAuthoringDiff({ session, candidate })
  → applyAuthoringChanges({ session, preview, selectedChangeIds: 전량, approval })
```

교정이 0건이면 이 경로를 타지 않는다. 교정이 1건 이상이면 **한 번만** 탄다. 케이스마다 부르면
revision 이 교정 수만큼 는다.

반영 뒤 `session.approvedDraft.suiteFingerprint` 가 화면에 찍을 지문이고 저장될 지문이다.

**진행 표시**

```
▸ 다시 실행 중... 1건
```

중간 갱신을 넣지 마라. 터미널 제어 문자가 들어가면 파이프로 받은 출력이 깨지고 그 출력을
E2E 가 비교한다.

**고지 한 줄 추가 (설계서 §10)**

`--no-repair` 가 아니면 §8.1 고지에 아래를 더한다.

```
  실패한 케이스는 값을 고쳐 최대 2회까지 다시 호출합니다.
```

**테스트 (전량)**

```
generate 옵션 파싱
  · --no-repair 를 두 번 주면 사용 오류다
  · --no-repair 와 --no-dry-run 을 함께 주면 사용 오류다
  · --no-repair 를 주면 repair 가 꺼진다

generate 교정 경로
  · 입력값 실패가 교정으로 통과하면 분류를 묻지 않는다
  · 교정으로 통과한 값이 저장된 명세의 operation.input 에 들어간다
  · 교정으로 통과한 케이스가 approval.cases 에 passed 로 실린다
  · 교정이 두 번 실패하면 분류 화면이 뜨고 시도 이력이 함께 나온다
  · 교정이 두 번 실패하면 저장된 입력값이 원래 합성값이다
  · 위반 케이스의 실패는 교정을 시도하지 않고 바로 분류로 간다
  · 본문 스키마 불일치 실패는 교정을 시도하지 않는다
  · --no-repair 면 실패가 곧바로 분류로 간다
  · --no-repair 면 고지에 재호출 줄이 안 나온다
  · provider 가 없으면 AI 제안 없이 사람에게 묻는다
  · 교정 0건이면 applyAuthoringChanges 를 부르지 않는다
  · 교정 2건이어도 applyAuthoringChanges 를 한 번만 부른다
  · 재실행이 케이스 하나만 담은 스위트로 나간다 (client 호출 수로 확인)

generate 지문 표시
  · 최종 지문이 시험 실행 뒤에 찍힌다
  · 교정이 있으면 찍힌 지문이 저장된 approval.fingerprint 와 같다
  · 교정이 없으면 찍힌 지문이 기존과 같은 값이다
  · --no-dry-run 이어도 지문이 저장 확인 직전에 찍힌다
  · 반영 요약(§8.8)이 교정 0건이면 안 나온다
  · 반영 요약에 필드와 전후 값이 나온다
```

**명령**: `pnpm test`, `pnpm typecheck --force`, `pnpm lint`
**보고서**: `docs/reports/task-r6-input-repair.md`
**커밋**: `feat(cli): generate 저장 경로에 입력값 교정 단계를 넣는다`

---

### R7: 도움말과 E2E (`cli`)

**Files**
- Modify: `packages/cli/src/help.ts`
- Test: `packages/cli/tests/help.test.ts`
- Test: `packages/cli/tests/dist-cli-e2e.mjs`

**도움말 (전량)**

`GENERATE_USAGE` 의 옵션 목록 끝에 `[--no-repair]` 를 더하고, 설명 블록에 아래를 더한다.

```
  --no-repair           시험 실행이 실패해도 입력값을 고쳐 다시 시도하지 않습니다.
                        실패가 곧바로 분류 화면으로 갑니다
```

**E2E**

```
· generate --help 에 --no-repair 가 나온다
· generate --baseline-only 출력에 교정 줄이 없다 (기존 기대값 유지)
```

`pnpm build && pnpm --filter ohmymcp test:e2e` 로만 도는 파일이다. `pnpm test` 의 수집 대상이
아니라서 로컬 전체 검증이 녹색인데 CI 의 `build` job 이 빨간불이 되는 함정이 있다.

**명령**: `pnpm test`, `pnpm build && pnpm --filter ohmymcp test:e2e`, `pnpm typecheck --force`, `pnpm lint`
**보고서**: `docs/reports/task-r7-input-repair.md`
**커밋**: `docs(cli): 입력값 교정 옵션 도움말과 E2E 기대값을 갱신한다`

## 5. 실행 프롬프트

터미널 4개다. 프로젝트 루트에서 새 터미널을 열고 아래 블록을 그대로 붙여넣는다.

### 터미널 A (R1, 웨이브 1)

권장 실행 설정: 표준 모델, 추론 수준 보통, 에이전트 종류 `general-purpose`.

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

  git worktree add /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-repair-target -b feat/dry-run-repair-target main

를 실행한 뒤 그 경로로 세션을 옮겨라. 옮긴 다음 아래를 확인하고, 하나라도 어긋나면 중단하고
BLOCKED 로 보고해라.

  - pwd 가 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-repair-target 인지
  - git log --oneline -1 이 루트의 main HEAD 와 같은지
  - docs/superpowers/specs/2026-08-15-dry-run-input-repair-design.md 가 있는지
  - docs/superpowers/plans/2026-08-15-dry-run-input-repair-implementation.md 가 있는지
  - packages/cli/src/dry-run.ts 에 DryRunCaseOutcome 이 있는지
  - git status --short 가 비어 있는지
  - pnpm install 을 실행하고 pnpm test 가 실제로 기동하는지

[2단계: 실행]

너는 구현자다. Task R1 을 끝낸다. 계획서
docs/superpowers/plans/2026-08-15-dry-run-input-repair-implementation.md 의 §4 R1 을 읽고 그대로
구현해라. 공개 계약과 판별 규칙과 테스트 이름이 값 단위로 적혀 있으니 한 글자도 바꾸지 마라.
설계 근거는 docs/superpowers/specs/2026-08-15-dry-run-input-repair-design.md 의 §4.2 다.

R1 허용 Files:
  packages/cli/src/repair-target.ts
  packages/cli/tests/repair-target.test.ts

위 목록 밖의 파일을 고치지 마라. 특히 core/src/types.ts 의 McpClient·ToolResult, 루트 빌드
설정, 다른 오너의 패키지(record·mock)는 공유 계약이다. 이미 있는 dry-run.ts,
dry-run-review.ts, cassette-wiring.ts, reset-hook.ts, generate-command.ts 도 고치지 마라.
계약이 안 맞으면 고치지 말고 보고해라. 의존 방향은 단방향(cli → runner/generate/record/mock →
core)이고 역참조·순환을 만들지 마라. @modelcontextprotocol/sdk 는 1.x 고정이고 목록 밖
의존성을 추가하지 마라. 백그라운드 실행, 커밋, 머지, 푸시, 하위 에이전트 스폰을 하지 마라.
다른 작업자의 변경을 되돌리지 마라.

테스트는 인메모리와 fixtures/ 만 쓴다. examples/ 의 실제 서버를 띄우지 마라.

검증: pnpm test, pnpm typecheck --force, pnpm lint 를 모두 돌리고 출력을 보고서에 붙여라.
typecheck 는 Cached: 0 cached 인지 확인해라.

보고서: docs/reports/task-r1-input-repair.md 를 쓴다. 바꾼 파일, 검증 명령과 결과, 임의로
판단한 지점, 남은 위험을 적어라. 커밋 메시지
`feat(cli): 시험 실행 실패에서 입력값 교정 대상을 가려낸다` 를 보고서에 적어라. 커밋은 하지
마라. 사람이 한다.

최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작해라.
```

### 터미널 B (R2, 웨이브 2)

**R1 이 `main` 에 머지된 뒤에 연다.** 통합 대장에 SHA 가 있고 그 커밋이 `main` 의 조상인지
메인 세션이 먼저 확인한다.

권장 실행 설정: 상위 모델, 추론 수준 높음, 에이전트 종류 `general-purpose`.
상위 모델인 이유: 화면 문안이 이 프로젝트에서 곧 제품이고, 재시도 단계 전이와 값 재사용 캐시가
계획서에 코드로 못 박기 어려운 판단을 남긴다.

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

  git worktree add /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-repair-screen -b feat/dry-run-repair-screen main

를 실행한 뒤 그 경로로 세션을 옮겨라. 옮긴 다음 아래를 확인하고, 하나라도 어긋나면 중단하고
BLOCKED 로 보고해라.

  - pwd 가 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-repair-screen 인지
  - git log --oneline -1 이 루트의 main HEAD 와 같은지
  - packages/cli/src/repair-target.ts 가 있는지 (없으면 R1 이 안 들어온 것이다. BLOCKED)
  - docs/superpowers/specs/2026-08-15-dry-run-input-repair-design.md 가 있는지
  - docs/superpowers/plans/2026-08-15-dry-run-input-repair-implementation.md 가 있는지
  - git status --short 가 비어 있는지
  - pnpm install 을 실행하고 pnpm test 가 실제로 기동하는지

[2단계: 실행]

너는 구현자다. Task R2 를 끝낸다. 계획서
docs/superpowers/plans/2026-08-15-dry-run-input-repair-implementation.md 의 §4 R2 를 읽고 그대로
구현해라. 화면 문안은 설계 문서
docs/superpowers/specs/2026-08-15-dry-run-input-repair-design.md 의 §8.6, §8.6.1, §8.6.2,
§8.6.3 이 전량을 고정한다. 문안을 새로 만들지 마라. 실패 메시지와 질문 문구가 이 프로젝트의
제품이다.

R2 허용 Files:
  packages/cli/src/input-repair.ts
  packages/cli/tests/input-repair.test.ts

RepairTarget 과 RepairAttempt 는 packages/cli/src/repair-target.ts 가 이미 내보낸다. import 해서
쓰고 새로 정의하지 마라. ReviewIO 는 generate-command.ts 가 내보낸다. 그것도 새로 만들지 마라.
generate-command.ts 를 고치지 마라. 배선은 R6 의 일이고 다른 터미널이 한다.

위 목록 밖의 파일을 고치지 마라. 특히 core/src/types.ts 의 McpClient·ToolResult, 루트 빌드
설정, 다른 오너의 패키지(record·mock)는 공유 계약이다. 계약이 안 맞으면 고치지 말고 보고해라.
의존 방향은 단방향이고 역참조·순환을 만들지 마라. @modelcontextprotocol/sdk 는 1.x 고정이고
목록 밖 의존성을 추가하지 마라. 백그라운드 실행, 커밋, 머지, 푸시, 하위 에이전트 스폰을 하지
마라. 다른 작업자의 변경을 되돌리지 마라.

테스트는 인메모리와 fixtures/ 만 쓴다. rerun 과 propose 는 테스트가 주입하는 함수다.
examples/ 의 실제 서버를 띄우지 마라.

검증: pnpm test, pnpm typecheck --force, pnpm lint 를 모두 돌리고 출력을 보고서에 붙여라.
typecheck 는 Cached: 0 cached 인지 확인해라.

보고서: docs/reports/task-r2-input-repair.md 를 쓴다. 바꾼 파일, 검증 명령과 결과, 임의로
판단한 지점, 남은 위험을 적어라. 커밋 메시지
`feat(cli): 시험 실행 실패 케이스의 입력값 교정 화면을 추가한다` 를 보고서에 적어라. 커밋은
하지 마라. 사람이 한다.

최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작해라.
```

### 터미널 C (R3 · R5, 웨이브 2)

**R1 이 `main` 에 머지된 뒤에 연다.** 터미널 B 와 파일이 겹치지 않으므로 동시에 돌린다.

권장 실행 설정: 상위 모델, 추론 수준 높음, 에이전트 종류 `general-purpose`.
상위 모델인 이유: R3 의 권한 검사는 AI 가 기대값을 무력화하는 경로를 막는 자리라 빠뜨린 검사
하나가 게이트 전체를 무력화한다. 계획서에 표로 적었지만 판정 구현에 판단이 남는다.

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

  git worktree add /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-repair-proposal -b feat/dry-run-repair-proposal main

를 실행한 뒤 그 경로로 세션을 옮겨라. 옮긴 다음 아래를 확인하고, 하나라도 어긋나면 중단하고
BLOCKED 로 보고해라.

  - pwd 가 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-repair-proposal 인지
  - git log --oneline -1 이 루트의 main HEAD 와 같은지
  - packages/cli/src/repair-target.ts 가 있는지 (없으면 R1 이 안 들어온 것이다. BLOCKED)
  - docs/superpowers/specs/2026-08-15-dry-run-input-repair-design.md 가 있는지
  - docs/superpowers/plans/2026-08-15-dry-run-input-repair-implementation.md 가 있는지
  - git status --short 가 비어 있는지
  - pnpm install 을 실행하고 pnpm test 가 실제로 기동하는지

[2단계: 실행]

너는 구현자다. Task R3 과 R5 를 순서대로 끝낸다. 계획서
docs/superpowers/plans/2026-08-15-dry-run-input-repair-implementation.md 의 §4 R3 과 §4 R5 를
읽고 그대로 구현해라. 권한 경계는 설계 문서
docs/superpowers/specs/2026-08-15-dry-run-input-repair-design.md 의 §4.3 이, 화면 문안은 §8.7 이
전량을 고정한다.

R3 허용 Files:
  packages/cli/src/repair-proposal.ts
  packages/cli/tests/repair-proposal.test.ts
R5 허용 Files:
  packages/cli/src/dry-run-review.ts
  packages/cli/tests/dry-run-review.test.ts

R5 는 기존 파일을 고친다. 세 번째 인자는 선택이고, 안 넘기면 지금과 완전히 같이 동작해야 한다.
기존 테스트를 지우지 마라. reviewDryRun 의 기존 호출부(generate-command.ts)를 고치지 마라.
그것은 R6 의 일이다.

R3 은 generate 패키지를 고치지 않는다. prepareAuthoringRequest 와 dispatchAuthoringRequest 는
이미 내보내진 것을 쓴다. AuthoringRequestMode 에 값을 추가하지 마라.

위 목록 밖의 파일을 고치지 마라. 특히 core/src/types.ts 의 McpClient·ToolResult, 루트 빌드
설정, 다른 오너의 패키지(record·mock)는 공유 계약이다. 계약이 안 맞으면 고치지 말고 보고해라.
의존 방향은 단방향이고 역참조·순환을 만들지 마라. @modelcontextprotocol/sdk 는 1.x 고정이고
목록 밖 의존성을 추가하지 마라. 백그라운드 실행, 커밋, 머지, 푸시, 하위 에이전트 스폰을 하지
마라. 다른 작업자의 변경을 되돌리지 마라.

테스트는 인메모리와 fixtures/ 만 쓴다. provider 는 테스트가 주입하는 가짜다. 실제 codex·claude
프로세스를 띄우지 마라.

검증: pnpm test, pnpm typecheck --force, pnpm lint 를 모두 돌리고 출력을 보고서에 붙여라.
typecheck 는 Cached: 0 cached 인지 확인해라.

보고서: docs/reports/task-r3-input-repair.md 와 docs/reports/task-r5-input-repair.md 두 개를
쓴다. 각각 바꾼 파일, 검증 명령과 결과, 임의로 판단한 지점, 남은 위험을 적어라. 커밋 메시지도
보고서에 적어라. 커밋은 하지 마라. 사람이 한다.
  R3: feat(cli): 입력값 교정 제안을 provider 에 요청하고 권한을 검사한다
  R5: feat(cli): 분류 화면에 입력값 교정 시도 이력을 표시한다

최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작해라.
```

### 터미널 D (R6 · R7, 웨이브 3, 직렬 전용)

**웨이브 2 의 세 태스크가 모두 `main` 에 머지된 뒤에 연다.**

권장 실행 설정: 상위 모델, 추론 수준 높음, 에이전트 종류 `general-purpose`.
상위 모델인 이유: 지문 표시 시점 이동이 승인 계약을 건드리고, 단일 케이스 재실행이 결정론성
판단을 포함하며, 화면 출력이 곧 제품이다.

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

  git worktree add /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-repair-wiring -b feat/dry-run-repair-wiring main

를 실행한 뒤 그 경로로 세션을 옮겨라. 옮긴 다음 아래를 확인하고, 하나라도 어긋나면 중단하고
BLOCKED 로 보고해라.

  - pwd 가 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-repair-wiring 인지
  - git log --oneline -1 이 루트의 main HEAD 와 같은지
  - packages/cli/src/repair-target.ts, input-repair.ts, repair-proposal.ts 가 모두 있는지
    (없으면 웨이브 2 가 안 들어온 것이다. BLOCKED 로 보고해라)
  - packages/cli/src/dry-run-review.ts 의 reviewDryRun 이 세 번째 인자를 받는지
  - docs/superpowers/plans/2026-08-15-dry-run-input-repair-implementation.md 가 있는지
  - git status --short 가 비어 있는지
  - pnpm install 과 pnpm build 를 실행하고 pnpm test 가 실제로 기동하는지

[2단계: 실행]

너는 구현자다. Task R6 과 R7 을 순서대로 끝낸다. 계획서
docs/superpowers/plans/2026-08-15-dry-run-input-repair-implementation.md 의 §4 R6 과 §4 R7 을
읽고 그대로 구현해라. 저장 경로 순서는 설계 문서
docs/superpowers/specs/2026-08-15-dry-run-input-repair-design.md 의 §3 이, 반영 방법은 §5 가,
지문 시점은 §6 이, 화면 문안은 §8 이 전량을 고정한다.

R6 허용 Files:
  packages/cli/src/generate-command.ts
  packages/cli/tests/generate-command.test.ts
  packages/cli/tests/generate-integration.test.ts
R7 허용 Files:
  packages/cli/src/help.ts
  packages/cli/tests/help.test.ts
  packages/cli/tests/dist-cli-e2e.mjs

주의할 것 넷을 미리 적는다.

  1. Final fingerprint 표시가 save 분기 첫 줄에서 분류 뒤로 옮겨간다. 교정이 명세를 바꾸므로
     앞에서 찍으면 저장되는 지문과 달라진다. 화면에 찍힌 값과 저장된 approval.fingerprint 가
     항상 같아야 하고, 그것을 테스트로 고정해라.
  2. 단일 케이스 재실행에 새 모듈을 만들지 마라. 케이스 하나만 담은 스위트로 기존 runDryRun 을
     부른다. 스위트 전량을 다시 돌리면 앞서 통과한 케이스가 상태 변화로 뒤집힌다.
  3. 교정 결과 반영은 reviewLocalAuthoringCandidate → createAuthoringDiff →
     applyAuthoringChanges 세 단을 탄다. cli 가 TestSuiteSpec 을 직접 조립해 넣지 마라.
     revision·provenance·지문 재계산이 generate 안에서 한 번에 일어나야 한다.
  4. dist-cli-e2e.mjs 는 pnpm test 가 아니라 pnpm build && pnpm --filter ohmymcp test:e2e 로
     돈다. 출력 형태를 바꿨으므로 이 파일 기대값을 반드시 함께 고쳐라. 안 고치면 로컬은
     녹색인데 CI 의 build job 이 빨간불이 된다.

웨이브 1·2 가 만든 repair-target.ts, input-repair.ts, repair-proposal.ts, dry-run-review.ts,
dry-run.ts, cassette-wiring.ts, reset-hook.ts 는 고치지 마라. 계약이 안 맞으면 고치지 말고
보고해라. core/src/types.ts, 루트 빌드 설정, 다른 오너의 패키지도 공유 계약이다. 의존 방향은
단방향이고 역참조·순환을 만들지 마라. @modelcontextprotocol/sdk 는 1.x 고정이고 목록 밖
의존성을 추가하지 마라. 백그라운드 실행, 커밋, 머지, 푸시, 하위 에이전트 스폰을 하지 마라.
다른 작업자의 변경을 되돌리지 마라.

이 터미널은 직렬 전용이다. R7 의 E2E 가 실제 서버 프로세스를 띄우므로 다른 터미널과 동시에
돌리지 않는다.

검증: pnpm test, pnpm build && pnpm --filter ohmymcp test:e2e, pnpm typecheck --force,
pnpm lint 를 모두 돌리고 출력을 보고서에 붙여라. typecheck 는 Cached: 0 cached 인지 확인해라.

보고서: docs/reports/task-r6-input-repair.md 와 docs/reports/task-r7-input-repair.md 두 개를
쓴다. 각각 바꾼 파일, 검증 명령과 결과, 임의로 판단한 지점, 남은 위험을 적어라. 커밋 메시지도
보고서에 적어라. 커밋은 하지 마라. 사람이 한다.
  R6: feat(cli): generate 저장 경로에 입력값 교정 단계를 넣는다
  R7: docs(cli): 입력값 교정 옵션 도움말과 E2E 기대값을 갱신한다

최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작해라.
```

## 6. 통합 게이트

각 태스크 보고를 받으면 메인 세션이 직접 확인한다. 자식의 완료 선언은 단서일 뿐이다.

1. worktree 에서 `git status --short` 와 `git diff --check`. 변경 경로가 허용 Files 안인가.
2. diff 를 직접 읽는다. 설계서 §8 의 문안이 그대로 들어갔는가. 새 문안을 지어내지 않았는가.
   **R3 은 §4.3 의 검사 일곱 개가 전부 구현됐는지 하나씩 대조한다.** 빠진 검사 하나가 게이트를
   무력화한다.
3. 계획서에 적힌 테스트 명령을 **다시 실행한다.** `pnpm typecheck --force` 의 출력에서
   `Cached: 0 cached` 를 확인한다.
4. 통과하면 커밋하고 `--no-ff` 로 머지한다. 머지된 `main` 에서 전체 테스트를 **새로** 돌린다.
5. 통합 SHA 를 `docs/task-integration-ledger.tsv` 에 `R<N>-input-repair` 로 기록하고 별도 문서
   커밋으로 보존한다.
6. worktree 가 깨끗한지 확인한 뒤 그 worktree 만 제거하고 그 브랜치만 삭제한다.

## 7. 완료 판정

설계서 §2 의 완료 조건 전부에 더해 아래를 확인한다.

- `main` 에서 `pnpm test`, `pnpm build && pnpm --filter ohmymcp test:e2e`,
  `pnpm typecheck --force`, `pnpm lint` 가 통과한다.
- `docs/task-integration-ledger.tsv` 에 R1·R2·R3·R5·R6·R7 여섯 줄이 있고 전부 `main` 의
  조상이다.
- `docs/adr/README.md` 에 R0 의 ADR 두 건이 색인돼 있다.
- `examples/weather-server` 대상 실서버 통합 테스트에서 `city` 합성 실패가 교정으로 닫힌다.

## 8. 알려진 위험

- **지문 이동이 기존 테스트를 깬다.** `generate-command.test.ts` 의 여러 케이스가
  `Final fingerprint:` 를 시험 실행 전 위치에서 기대한다. R6 이 그 기대값을 함께 고쳐야 하고,
  그것이 R6 의 실제 분량을 계획보다 키울 수 있다. 승인 전 시험 실행 게이트 작업의 T6 에서 같은
  종류의 일이 실제로 났다.
- **R3 의 권한 검사 누락.** 검사 하나가 빠지면 AI 가 단언을 고치는 경로가 열리고, 그것은
  게이트가 있으나 마나인 상태다. 통합 게이트 2번에서 표와 코드를 하나씩 대조한다.
- **재실행 호출 수 증가.** 케이스당 최대 3회다. 상태를 바꾸는 서버에서 잔여물이 늘어난다.
  `--reset-cmd` 가 재시도 사이에는 안 돈다는 것을 설계서 §10 에 적었지만, 상태 있는 예제 서버가
  없어 우리 CI 로는 확인되지 않는다.
- **`origins` 를 못 구하는 경우.** `AuthoringSessionView.approvedDraft.provenance` 에서 뽑는데,
  R6 배선 시 그 값이 비어 있으면 모든 케이스가 `schemaBaseline` 으로 취급돼 사용자가 손으로 쓴
  케이스까지 교정 대상이 된다. R6 테스트에 provenance 가 실린 경로를 반드시 넣는다.
