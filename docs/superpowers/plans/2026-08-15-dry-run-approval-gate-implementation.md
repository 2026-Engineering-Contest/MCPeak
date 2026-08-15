# 승인 전 시험 실행 게이트 구현 계획 (2026-08-15)

- 설계 문서: `docs/superpowers/specs/2026-08-15-dry-run-approval-gate-design.md`
- 선행 ADR: ADR-0023(시험 실행 전 서버 초기화 훅, 채택)
- 신규 ADR: 케이스 분류의 저장 위치와 `test` 소비 방식 (T0, 착수 전)
- 대상 패키지: `runner`(스키마), `cli`(전부)
- 로드맵 단계 3

## 0. 실행 모델

메인 세션은 오케스트레이터다. 구현·테스트는 서브에이전트가 한다. 메인 세션은 스폰, 보고서와
diff 확인, 검증 재실행, 머지 게이트, 통합 대장 기록만 한다.

모델 배분은 `CLAUDE.local.md` 의 표를 따른다. 태스크마다 §5 의 실행 프롬프트에 적혀 있다.

- 상위 모델: T3, T4, T5, T6. 실패 메시지 문안, 카세트 재생 결정론성, 패키지 경계 판단이
  들어가는 태스크다.
- 표준 모델: T1, T2, T7, T8. 설계서에 사양이 값 단위로 적혀 있어 판단 여지가 없다.

## 1. 사람 몫 사전 조건

터미널을 열기 전에 두 가지를 확인한다.

```sh
git log --oneline -1     # main 이 기점인지
git status --short       # 깨끗한지
```

**설계서·ADR-0023·이 계획서와 T0 의 새 ADR 이 `main` 에 커밋돼 있어야 한다.** untracked 문서는
새 worktree에 딸려가지 않는다. 커밋되지 않았으면 각 프롬프트의 1단계 검증에서 멈춘다.

## 2. 태스크 목록

| Task | 패키지 | 내용 | 선행 | 모델 |
|---|---|---|---|---|
| T0 | 문서 | 분류 저장 위치 ADR | 없음 | 메인 세션 |
| T1 | `runner` | `SuiteApproval.cases` 타입·검증·JSON Schema | T0 | 표준 |
| T2 | `cli` | `reset-hook.ts` | 없음 | 표준 |
| T3 | `cli` | `dry-run.ts` | 없음 | 상위 |
| T4 | `cli` | `dry-run-review.ts` | 없음 | 상위 |
| T5 | `cli` | `cassette-wiring.ts` | 없음 | 상위 |
| T6 | `cli` | `generate-command.ts` 배선 | T1~T5 | 상위 |
| T7 | `cli` | `spec-approval.ts`·`test-command.ts` 참고 문장 | T1 | 표준 |
| T8 | `cli` | `help.ts`·`dist-cli-e2e.mjs` | T6 | 표준 |

### 의존성 그래프

```
T0 → T1 ─┬─────────────→ T6 → T8
         └→ T7
T2 ─┐
T3 ─┼──────────────────→ T6
T4 ─┤
T5 ─┘
```

### 웨이브

| 웨이브 | 태스크 | 터미널 | 병렬 |
|---|---|---|---|
| 0 | T0 | 메인 세션 | - |
| 1 | T1 · T7 / T2 · T3 · T4 · T5 | A / B | A와 B 병렬 |
| 2 | T6 · T8 | C | 직렬 전용 |

웨이브 2 를 직렬로 두는 이유는 T8 의 `dist-cli-e2e.mjs` 가 실제 서버 프로세스를 띄우기
때문이다. `CLAUDE.local.md` 의 규칙이다.

T7 을 터미널 A 에 두는 이유는 T1 의 타입을 바로 쓰기 때문이다. 별도 터미널로 나누면 T1 머지를
기다려야 하고, 같은 터미널이면 순차 커밋 두 개로 끝난다. 단 **패키지가 다르므로 PR 은
나눈다**(CONTRIBUTING §2.2, `runner` 는 파트① 소유·`cli` 는 공동 소유).

## 3. PR 분할

| PR | 태스크 | 패키지 | 비고 |
|---|---|---|---|
| 1 | T1 | `runner` | 스키마 확장. 단독으로 머지 가능 |
| 2 | T7 | `cli` | PR 1 머지 후 |
| 3 | T2·T3·T4·T5 | `cli` | 신규 파일 4개. 배선 없음 |
| 4 | T6·T8 | `cli` | 배선과 화면. PR 1·3 머지 후 |

스택 PR 을 만들지 않는다. 베이스가 피처 브랜치면 CodeRabbit 이 리뷰를 건너뛴다. 단계 8
실행에서 확인된 도구 제약이다.

## 4. 태스크 상세

### T0: 분류 저장 위치 ADR (메인 세션)

**Files**
- Create: `docs/adr/00NN-케이스-분류-저장-위치.md` (번호는 착수 시 `docs/adr/README.md` 확인)
- Modify: `docs/adr/README.md`

설계서 §14 의 판단 셋을 다섯 항목으로 적는다. 선택지는 각각 다음과 같다.

1. 분류 위치: `approval.cases` (채택) / 케이스마다 필드 / 별도 사이드카 파일
2. `test` 종료 코드: 안 바꾼다 (채택) / `serverDefect` 를 통과로 친다
3. `specError` 저장: 안 한다 (채택) / 표시만 하고 저장한다

**완료 조건**: 파일이 존재하고 README 표에 한 줄이 늘었다. 상태는 `채택`.

---

### T1: `SuiteApproval.cases` 스키마 확장 (`runner`)

**Files**
- Modify: `packages/runner/src/spec/types.ts`
- Modify: `packages/runner/src/spec/validation.ts`
- Modify: `packages/runner/src/spec/json-schema.ts`
- Modify: `packages/runner/src/index.ts` (타입 재수출)
- Test: `packages/runner/tests/spec-validation.test.ts`
- Test: `packages/runner/tests/fingerprint.test.ts`

**공개 계약 (전량, 한 글자도 바꾸지 마라)**

```ts
export type CaseApprovalStatus = "passed" | "serverDefect";

export interface SuiteCaseApproval {
  readonly id: string;
  readonly status: CaseApprovalStatus;
}

export interface SuiteApproval {
  readonly fingerprint: string;
  readonly cases?: readonly SuiteCaseApproval[];
}
```

`index.ts` 에서 `CaseApprovalStatus` 와 `SuiteCaseApproval` 을 타입으로 내보낸다.

**검증 규칙 (전량)**

| 입력 | 판정 |
|---|---|
| `approval.cases` 없음 | valid |
| `[]` | valid |
| `[{ id: "a", status: "passed" }]` | valid |
| `[{ id: 1, status: "passed" }]` | `INVALID_VALUE` |
| `[{ id: "a", status: "unknown" }]` | `INVALID_VALUE` |
| `[{ id: "a" }]` | `INVALID_VALUE` |
| `[{ id: "a", status: "passed" }, { id: "a", status: "passed" }]` | `INVALID_VALUE` (중복 id) |
| `cases` 가 배열이 아님 | `INVALID_VALUE` |

`approval.cases[].id` 가 `cases[].id` 에 실재하는지는 **검사하지 않는다.** 설계서 §7.3 이
근거다. 케이스를 지우는 정상 편집이 파일을 깨진 것으로 만들면 안 된다.

**테스트 (이름과 단언 전량)**

```
validateMcpSuite / approval.cases
  · approval.cases 가 없으면 valid 다
  · approval.cases 가 빈 배열이면 valid 다
  · id 가 문자열이 아니면 INVALID_VALUE 이고 path 가 approval.cases[0].id 다
  · status 가 passed·serverDefect 밖이면 INVALID_VALUE 다
  · status 가 없으면 INVALID_VALUE 다
  · 중복 id 가 있으면 INVALID_VALUE 다
  · cases 가 배열이 아니면 INVALID_VALUE 다
  · approval.cases[].id 가 cases 에 없어도 valid 다
  · MCP_SUITE_JSON_SCHEMA 가 approval.cases 를 기술하고 status 의 enum 이 둘이다

suiteFingerprint
  · approval.cases 를 넣어도 지문이 안 바뀐다
  · approval.cases 의 내용을 바꿔도 지문이 안 바뀐다
  · approval 블록 전체를 지워도 지문이 같다 (기존 테스트 유지)
```

**명령**: `pnpm test`, `pnpm typecheck --force`, `pnpm lint`
**보고서**: `docs/reports/task-t1-dry-run-gate.md`
**커밋**: `feat(runner): 승인 블록에 케이스별 판정을 추가한다`

---

### T2: 초기화 훅 (`cli`)

**Files**
- Create: `packages/cli/src/reset-hook.ts`
- Test: `packages/cli/tests/reset-hook.test.ts`

**공개 계약**

```ts
export class ResetCommandError extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  );
}

export async function runResetCommand(command: string): Promise<void>;
```

**사양**

- 공백으로 나눈 첫 토큰이 실행 파일, 나머지가 인자다. 따옴표를 해석하지 않는다.
- `execFile` 로 실행한다. `shell: true` 를 쓰지 마라. ADR-0023 의 보안 결정이다.
- 타임아웃 60_000ms. 초과하면 프로세스를 죽이고 `ResetCommandError` 를 던진다.
  이때 `exitCode` 는 `null` 이고 `stderr` 에 `타임아웃(60초)` 를 넣는다.
- 종료 코드가 0이 아니면 `ResetCommandError`.
- 실행 파일이 없으면(`ENOENT`) `ResetCommandError`. `exitCode` 는 `null`.
- stdout 은 버린다. stderr 은 최대 8KB 까지만 보관한다.
- 빈 문자열이나 공백뿐인 명령은 `ResetCommandError` 가 아니라 `TypeError` 다. 옵션 파싱에서
  이미 걸러야 하는 값이고, 여기까지 왔다면 호출 측 결함이다.

**테스트 (전량)**

```
runResetCommand
  · 종료 코드 0 이면 resolve 한다
  · 종료 코드 1 이면 ResetCommandError 를 던지고 exitCode 가 1 이다
  · 실행 파일이 없으면 ResetCommandError 를 던지고 exitCode 가 null 이다
  · stderr 이 ResetCommandError.stderr 에 담긴다
  · 셸 메타문자가 인자로 그대로 전달된다
      node -e 'process.stdout.write(process.argv[1])' "a && b" 의 인자가 한 덩어리다
  · 60초를 넘기면 프로세스를 죽이고 ResetCommandError 를 던진다 (타이머는 fake timer)
  · 공백뿐인 명령은 TypeError 다
  · stderr 이 8KB 를 넘으면 8KB 로 잘린다
```

테스트는 `process.execPath` 와 `-e` 를 써서 임시 스크립트 파일을 만들지 않는다. 병렬 터미널
안전 요구다.

**명령**: `pnpm test`, `pnpm typecheck --force`, `pnpm lint`
**보고서**: `docs/reports/task-t2-dry-run-gate.md`
**커밋**: `feat(cli): 시험 실행 전 초기화 명령 훅을 추가한다`

---

### T3: 시험 실행 (`cli`)

**Files**
- Create: `packages/cli/src/dry-run.ts`
- Test: `packages/cli/tests/dry-run.test.ts`

**공개 계약**

```ts
export interface DryRunCaseOutcome {
  readonly caseId: string;
  readonly caseName: string;
  readonly status: "passed" | "failed" | "timedOut" | "cancelled" | "notRun";
  readonly detail: string;
}

export interface DryRunResult {
  readonly outcomes: readonly DryRunCaseOutcome[];
  readonly aborted?: {
    readonly reason: "connectionLost" | "payloadLimit";
    readonly detail: string;
  };
}

export interface RunDryRunOptions {
  readonly client: McpClient;
  readonly suite: TestSuiteSpec;
}

export async function runDryRun(options: RunDryRunOptions): Promise<DryRunResult>;
```

**사양**

- `runSuite({ client, suite })` 를 부르고 `report` 를 기다린다. `onEvent` 는 쓰지 않는다.
  진행 표시는 T6 이 붙인다. 여기서 화면에 쓰지 않는다.
- `outcomes` 순서는 `report.cases` 순서다. 정렬하지 마라.
- `detail` 은 `renderReport` 가 만든 그 케이스의 블록을 그대로 담는다. **새 문안을 만들지
  마라.** 같은 실패를 `test` 에서 볼 때와 문장이 갈리면 안 된다. 통과 케이스의 `detail` 은
  빈 문자열이다.
- `runSuite` 가 `RunnerPayloadLimitError` 를 던지면 `aborted.reason` 이 `payloadLimit` 이고
  `detail` 에 다음 문장을 넣는다.
  `보고서가 1MB 상한을 넘었습니다. 케이스 수를 줄인 뒤 다시 시도하세요.`
- 그 밖의 예외는 `aborted.reason` 이 `connectionLost` 이고 `detail` 은 `renderReport` 로
  만들 수 없으므로 다음 형식이다.
  `툴 '<이름>' 호출 중 오류가 발생했습니다.` 툴 이름을 모르면 `MCP 서버 연결이 끊겼습니다.`
- `aborted` 가 있어도 `outcomes` 에는 그때까지 끝난 케이스가 들어간다. 비우지 마라. 12/24 에서
  끊겼다는 사실을 T6 이 화면에 쓴다.
- 서버 진단(stderr)은 여기서 읽지 않는다. T6 이 기존 `renderProcessDiagnostics` 로 붙인다.
  이 모듈은 `McpClient` 만 안다.

**테스트 (전량)**

```
runDryRun
  · 통과 케이스만 있는 스위트는 outcomes 전부 passed 이고 aborted 가 없다
  · 통과 케이스의 detail 이 빈 문자열이다
  · 실패 케이스의 detail 이 renderReport 의 그 케이스 블록과 문자열로 같다
  · 케이스 실행 순서가 suite.cases 순서와 같다 (fake client 가 호출 순서를 배열로 기록한다)
  · outcomes 순서가 suite.cases 순서와 같다
  · client.callTool 이 던지면 aborted.reason 이 connectionLost 이고 툴 이름이 detail 에 있다
  · aborted 여도 그때까지 끝난 케이스가 outcomes 에 남는다
  · RunnerPayloadLimitError 면 aborted.reason 이 payloadLimit 이고 1MB 문장이 들어간다
  · 같은 입력으로 2회 실행한 DryRunResult 가 JSON.stringify 기준 동일하다
  · caseName 이 spec 의 name 과 같다
```

fake client 는 인메모리 객체다. `fixtures/tools-list.sample.json` 을 툴 선언으로 쓴다.

**명령**: `pnpm test`, `pnpm typecheck --force`, `pnpm lint`
**보고서**: `docs/reports/task-t3-dry-run-gate.md`
**커밋**: `feat(cli): 후보 명세를 실제 서버에 돌리는 시험 실행을 추가한다`

---

### T4: 분류 화면 (`cli`)

**Files**
- Create: `packages/cli/src/dry-run-review.ts`
- Test: `packages/cli/tests/dry-run-review.test.ts`

**공개 계약**

```ts
export type CaseClassification = "passed" | "serverDefect" | "specError";

export interface DryRunReviewResult {
  readonly cleared: boolean;
  readonly approvals: readonly SuiteCaseApproval[];
  readonly specErrors: readonly string[];
}

export async function reviewDryRun(
  io: ReviewIO,
  result: DryRunResult,
): Promise<DryRunReviewResult>;
```

`ReviewIO` 는 `generate-command.ts` 가 이미 export 하는 타입이다. 새로 만들지 마라.

**화면 (설계서 §8.2·§8.3 전량, 문안을 바꾸지 마라)**

실패가 0건이면 아무것도 묻지 않고 `cleared: true` 와 전량 `passed` 를 돌려준다.

실패가 있으면 케이스마다 아래를 찍고 한 글자를 받는다.

```
  [1] add_todo/필수 필드 'title' 누락 거절
      → isError true 를 기대했지만 정상 응답을 받았습니다.

      [s] 서버 결함  명세가 옳다. 이 케이스를 회귀 테스트로 남긴다
      [m] 명세 오류  추측이 틀렸다. 저장 전에 고친다
      [?] 판단 보류  분류를 미룬다. 저장은 막힌다
      선택: 
```

- `s`·`m`·`?` 밖의 입력은 같은 질문을 다시 묻는다. 기본값으로 넘기지 마라.
- 대소문자를 구분하지 않는다. 앞뒤 공백을 버린다.
- 번호(`[1]`)는 실패 케이스 안에서의 1-기반 순번이다. 전체 케이스 번호가 아니다.

분류가 끝나면 요약을 찍는다.

```
  분류: 서버 결함 2건, 명세 오류 1건
```

0건인 종류는 요약에서 뺀다. `서버 결함 0건` 을 찍지 마라.

**반환 규칙**

| 상황 | `cleared` | `approvals` | `specErrors` |
|---|---|---|---|
| 실패 0건 | true | 전량 `passed` | `[]` |
| 전부 `s` | true | 통과는 `passed`, 실패는 `serverDefect` | `[]` |
| `m` 이 하나라도 있음 | false | `[]` | `m` 을 고른 caseId 들 |
| `?` 가 하나라도 있음 | false | `[]` | `[]` |
| `aborted` 가 있음 | false | `[]` | `[]` (아무것도 묻지 않는다) |

`cleared` 가 false 면 `approvals` 를 비운다. 반쯤 채워 넘기면 호출 측이 그것을 저장할 여지가
생긴다.

**테스트 (전량)**

```
reviewDryRun
  · 실패 0건이면 사용자에게 아무것도 묻지 않고 cleared true 다
  · 실패 0건이면 통과 케이스가 전부 approvals 에 passed 로 들어간다
  · 실패 케이스에 s 를 고르면 approvals 에 serverDefect 로 들어간다
  · 실패 케이스에 m 을 고르면 cleared false 이고 specErrors 에 caseId 가 있다
  · 실패 케이스에 ? 를 고르면 cleared false 이고 specErrors 가 비어 있다
  · cleared 가 false 면 approvals 가 빈 배열이다
  · approvals 순서가 outcomes 순서와 같다
  · 대문자 S 도 서버 결함으로 받는다
  · 앞뒤 공백이 있어도 받는다
  · x 를 주면 같은 질문을 다시 묻는다 (io.input 호출 횟수로 확인)
  · aborted 가 있으면 아무것도 묻지 않고 cleared false 다
  · 요약 줄에 0건인 종류가 안 나온다
  · 실패 케이스 번호가 1 부터 매겨진다
```

**명령**: `pnpm test`, `pnpm typecheck --force`, `pnpm lint`
**보고서**: `docs/reports/task-t4-dry-run-gate.md`
**커밋**: `feat(cli): 시험 실행 실패 케이스 분류 화면을 추가한다`

---

### T5: 카세트 배선 (`cli`)

**Files**
- Create: `packages/cli/src/cassette-wiring.ts`
- Test: `packages/cli/tests/cassette-wiring.test.ts`

**공개 계약**

```ts
export interface CassetteWiring {
  readonly client: McpClient;
  flush(): Promise<void>;
  readonly warnings: readonly string[];
}

export interface WireCassetteOptions {
  readonly inner: McpClient;
  readonly path: string | undefined;
  readonly forceRecord: boolean;
  /** 테스트 주입점. 생략하면 record 패키지의 loadCassette·saveCassette 를 쓴다. */
  readonly io?: {
    load(path: string): Promise<Cassette | null>;
    save(path: string, cassette: Cassette): Promise<void>;
  };
}

export async function wireCassette(options: WireCassetteOptions): Promise<CassetteWiring>;
```

**사양 (여기가 이 태스크의 핵심이다)**

- `path` 가 `undefined` 면 `inner` 를 그대로 `client` 로 돌려주고 `flush()` 는 아무것도 하지
  않는다. `warnings` 는 빈 배열이다.
- 모드 결정은 표 그대로다.

  | 조건 | 모드 |
  |---|---|
  | 파일 없음 | `record` |
  | 파일 있음 | `auto` |
  | `forceRecord` | `record` (파일이 있어도) |

- **`client.close()` 를 부르지 마라.** `cassetteClient` 의 `close()` 는 `onFlush` 를 부른 뒤
  `inner.close()` 까지 부른다. 검토 도중 연결이 닫히면 안 된다. 대신 `onFlush` 로 받은
  카세트를 모듈 안에 보관하고, `flush()` 에서 `save` 만 한다.
- `onFlush` 는 `close()` 안에서만 불린다. 즉 위 규칙대로 하면 `onFlush` 가 영영 안 불린다.
  그러므로 **`onFlush` 를 쓰지 말고** `cassetteClient` 를 감싸는 프록시를 만들어라.
  프록시의 `close()` 는 `inner.close()` 만 부르고 카세트를 건드리지 않는다. 카세트 스냅샷은
  `flush()` 시점에 `cassetteClient.close()` 를 부르는 대신, 우리가 `onFlush` 콜백을 통해
  받아 둔 최신본을 쓴다. 구현은 다음 형태다.

  ```ts
  let snapshot: Cassette | undefined;
  const recorder = cassetteClient(inner, {
    cassette,
    mode,
    cassettePath: path,
    onFlush: async (value) => { snapshot = value; },
    onWarning: (message) => { warnings.push(message); },
  });
  const client: McpClient = {
    listTools: () => recorder.listTools(),
    callTool: (name, args) => recorder.callTool(name, args),
    // close 는 recorder 를 거치지 않는다. 카세트 저장은 flush() 가 소유한다.
    close: () => inner.close(),
  };
  const flush = async (): Promise<void> => {
    await recorder.close();          // onFlush 로 snapshot 을 채운다
    if (snapshot === undefined) return;
    await io.save(path, snapshot);
  };
  ```

  `recorder.close()` 가 `inner.close()` 도 부르므로 **`flush()` 는 연결을 닫아도 되는 시점에만
  불러야 한다.** T6 이 저장 직후에 부른다. 이 제약을 파일 상단 주석에 적어라.
- `warnings` 는 `onWarning` 이 받은 문장을 순서대로 담는다. 문장을 다시 만들지 마라.
  `record` 가 만든 것을 그대로 쓴다.
- `load` 가 던지면(파일이 깨졌으면) 예외를 그대로 올린다. 삼키고 새로 녹화하면 사용자의
  카세트를 말없이 버리는 것이 된다.

**테스트 (전량)**

```
wireCassette
  · path 가 undefined 면 client 가 inner 와 같은 객체다
  · path 가 undefined 면 flush 가 save 를 부르지 않는다
  · 파일이 없으면 record 모드로 동작한다 (첫 호출이 inner 로 간다)
  · 파일이 있으면 auto 모드로 동작한다 (키가 맞는 호출이 inner 로 안 간다)
  · forceRecord 면 파일이 있어도 전부 inner 로 간다
  · client.close() 가 inner.close() 를 부르고 save 는 안 부른다
  · flush() 가 save 를 정확히 1회 부른다
  · flush() 가 저장한 카세트에 녹화된 호출이 들어 있다
  · 같은 키에 다른 응답이 오면 warnings 에 문장이 쌓인다
  · warnings 문장이 record 가 만든 것과 같다 (우리가 다시 만들지 않는다)
  · load 가 던지면 wireCassette 가 그대로 던진다
  · 같은 입력으로 2회 돌린 저장 카세트가 바이트 동일하다
```

`io` 를 주입해 파일시스템을 쓰지 않는다.

**명령**: `pnpm test`, `pnpm typecheck --force`, `pnpm lint`
**보고서**: `docs/reports/task-t5-dry-run-gate.md`
**커밋**: `feat(cli): 시험 실행에 카세트 클라이언트를 배선한다`

---

### T6: `generate` 배선 (`cli`)

**Files**
- Modify: `packages/cli/src/generate-command.ts`
- Test: `packages/cli/tests/generate-command.test.ts`
- Test: `packages/cli/tests/generate-integration.test.ts`

**옵션 (전량)**

| 옵션 | 값 | 규칙 |
|---|---|---|
| `--no-dry-run` | 없음 | 한 번만. `--cassette`·`--reset-cmd` 와 함께 쓰면 사용 오류 |
| `--cassette` | 경로 | 한 번만 |
| `--record` | 없음 | 한 번만. `--cassette` 없이 쓰면 사용 오류 |
| `--reset-cmd` | 명령 | 한 번만. 빈 문자열이면 사용 오류 |

`optionNames` 집합에 넷을 더한다. 값 파싱은 기존 `optionValue` 를 쓴다.

**연결 수명 변경**

`runGenerateCommand` 의 `connection.close()` 호출(현재 `:891`)을 대화형 경로에서 뺀다.
`runInteractiveReview` 가 끝난 뒤 `finally` 에서 닫는다. `--baseline-only` 경로는 지금과
같이 `listTools` 직후 닫는다.

`runInteractiveReview` 시그니처에 `connection` 을 넘긴다. `client` 만 넘기면 T6 이
`getDiagnostics()` 를 못 불러 §8.4 화면을 만들 수 없다.

**`save` 경로 순서 (설계서 §4.2)**

```
1. 최종 지문 표시                       (기존)
2. dryRun 이 켜져 있으면 §8.1 고지 + 확인. 거절하면 continue
3. resetCmd 가 있으면 runResetCommand. 실패하면 안내 후 continue
4. wireCassette
5. runDryRun
6. warnings 를 찍는다
7. aborted 면 §8.4 를 찍고 continue
8. §8.2 결과를 찍는다
9. reviewDryRun
10. cleared 가 false 면 §8.3 요약과 안내를 찍고 continue
11. 저장 확인 (기존)
12. finalize → saveSuite. approval.cases 를 함께 쓴다
13. cassette.flush()
14. 커버리지 보고 (기존)
```

`--no-dry-run` 이면 2~10 을 건너뛰고 대신 §8.5 확인을 받는다. 거절하면 continue.

**`saveSuite` 변경**

`renderSuite` 가 `approval` 에 `cases` 를 넣는다. 키 순서는 `fingerprint` 다음이다.
`approvals` 가 빈 배열이면 `cases` 키를 넣지 않는다. 빈 배열은 "시험 실행을 했는데 케이스가
0개" 와 "안 했다" 를 구분하지 못한다.

저장 후 검증 조건 셋(`:264`)은 그대로 둔다. `approval.cases` 는 지문에 안 들어가므로 기존
조건이 그대로 성립한다. **성립하는지 테스트로 확인해라.**

**진행 표시**

```
▸ 시험 실행 중... 24/24
```

`runSuite` 의 `onEvent` 를 T3 이 쓰지 않으므로, T6 이 `runDryRun` 에 `onProgress` 를 넘기는
대신 **실행 전 케이스 수만 찍고 끝난 뒤 결과를 찍는다.** 즉 위 줄은 `24/24` 로 한 번만 나온다.
중간 갱신을 넣지 마라. 터미널 제어 문자가 들어가면 파이프로 받은 출력이 깨지고, 그 출력을
E2E 가 비교한다.

**테스트 (전량)**

```
generate 옵션 파싱
  · --no-dry-run 을 두 번 주면 사용 오류다
  · --no-dry-run 과 --cassette 를 함께 주면 사용 오류다
  · --no-dry-run 과 --reset-cmd 를 함께 주면 사용 오류다
  · --record 를 --cassette 없이 주면 사용 오류다
  · --reset-cmd 값이 빈 문자열이면 사용 오류다
  · --cassette 를 두 번 주면 사용 오류다

generate save 경로
  · 기본 경로에서 시험 실행 고지가 나오고 거절하면 저장하지 않는다
  · 고지에 케이스 수가 실제 케이스 수와 같게 나온다
  · 카세트가 없으면 고지에 카세트 줄이 안 나온다
  · 초기화가 없으면 고지에 초기화 줄이 안 나온다
  · 통과만 있으면 분류를 묻지 않고 저장으로 넘어간다
  · 실패 케이스를 serverDefect 로 분류하면 approval.cases 에 실린다
  · approval.cases 순서가 suite.cases 순서와 같다
  · 통과 케이스도 approval.cases 에 passed 로 실린다
  · specError 가 하나라도 있으면 저장하지 않고 메뉴로 돌아간다
  · 미분류가 있으면 저장하지 않는다
  · aborted 면 §8.4 를 찍고 저장하지 않으며 stderr 꼬리가 함께 나온다
  · --no-dry-run 이면 시험 실행 없이 저장되고 approval.cases 키가 없다
  · --no-dry-run 확인을 거절하면 저장하지 않는다
  · --reset-cmd 가 실패하면 시험 실행을 시작하지 않고 저장도 안 한다
  · --reset-cmd 성공 시 초기화 줄이 시험 실행보다 먼저 나온다
  · --cassette 를 주면 2회차 save 에서 inner 호출이 새 케이스 수만큼만 늘어난다
  · 카세트 경고가 화면에 그대로 나온다
  · approval.cases 가 실려도 suiteFingerprint 가 안 바뀐다
  · 저장 후 검증 조건 셋이 approval.cases 가 있어도 통과한다
  · --baseline-only 는 시험 실행을 하지 않고 approval.cases 도 없다
  · 대화형 경로에서 연결이 검토 종료 시점에 닫힌다 (close 호출 횟수 1)
  · 검토를 cancel 로 끝내도 연결이 닫힌다
```

**명령**: `pnpm test`, `pnpm typecheck --force`, `pnpm lint`
**보고서**: `docs/reports/task-t6-dry-run-gate.md`
**커밋**: `feat(cli): generate 저장 경로에 시험 실행 게이트를 넣는다`

---

### T7: `test` 참고 문장 (`cli`)

**Files**
- Modify: `packages/cli/src/spec-approval.ts`
- Modify: `packages/cli/src/test-command.ts`
- Test: `packages/cli/tests/spec-approval.test.ts`
- Test: `packages/cli/tests/test-command.test.ts`

**사양**

실패한 케이스의 id 가 `approval.cases` 에서 `serverDefect` 면 케이스 블록 뒤에 한 줄을 붙인다.

```
    참고: 승인 시점에 서버 결함으로 표시된 케이스입니다. 서버가 아직 고쳐지지 않았습니다.
```

- 종료 코드를 바꾸지 않는다.
- `passed` 로 표시된 케이스가 실패하면 아무 문장도 안 붙인다.
- `serverDefect` 케이스가 통과하면 아무 문장도 안 붙인다.
- **지문이 불일치면 이 문장을 찍지 않는다.** 명세가 바뀌었으면 승인 시점 판정이 지금 케이스에
  해당하는지 알 수 없다.
- `approval.cases` 가 없으면 아무것도 안 한다.
- `--json` 출력에는 `spec.cases` 키로 판정을 그대로 싣는다. 억제하지 않는다.

**테스트 (전량)**

```
spec-approval / 케이스 판정
  · approval.cases 가 없으면 판정 조회가 undefined 다
  · serverDefect 인 id 를 조회하면 serverDefect 다
  · cases 에 없는 id 를 조회하면 undefined 다

test 보고서
  · serverDefect 케이스가 실패하면 참고 줄이 붙는다
  · serverDefect 케이스가 통과하면 참고 줄이 안 붙는다
  · passed 케이스가 실패하면 참고 줄이 안 붙는다
  · 지문이 불일치면 참고 줄이 안 붙는다
  · 참고 줄이 붙어도 종료 코드가 그대로다
  · --json 에 spec.cases 가 실린다
```

**명령**: `pnpm test`, `pnpm typecheck --force`, `pnpm lint`
**보고서**: `docs/reports/task-t7-dry-run-gate.md`
**커밋**: `feat(cli): test 보고서에 승인 시점 서버 결함 표시를 반영한다`

---

### T8: 도움말과 E2E (`cli`)

**Files**
- Modify: `packages/cli/src/help.ts`
- Test: `packages/cli/tests/dist-cli-e2e.mjs`
- Test: `packages/cli/tests/help.test.ts`

**도움말 (전량)**

```
  --no-dry-run          승인 전 시험 실행을 건너뜁니다. 케이스가 실제 서버에서 확인되지
                        않은 채 저장됩니다
  --cassette <path>     서버 응답을 녹화·재생합니다. 반복 실행에서 서버를 다시 부르지
                        않습니다. 응답 전문이 저장되므로 .gitignore 를 확인하세요
  --record              카세트를 처음부터 다시 녹화합니다 (--cassette 필요)
  --reset-cmd <command> 시험 실행 전에 이 명령을 한 번 실행합니다. 셸을 거치지 않으므로
                        파이프나 && 는 쓸 수 없습니다
```

**E2E**

`pnpm build && pnpm --filter ohmymcp test:e2e` 로만 도는 파일이다. `pnpm test` 의 수집 대상이 아니라서 **로컬 전체 검증이
녹색인데 CI 의 `build` job 이 빨간불**이 된다. 계약 축 커버리지 작업에서 실제로 밟은 함정이다.

```
· generate --baseline-only 출력에 시험 실행 줄이 없다 (기존 기대값 유지)
· generate --help 에 새 옵션 4개가 나온다
```

`--no-dry-run` 대화형 경로는 TTY 가 필요해 E2E 로 안 덮는다. T6 의 인메모리 테스트가 덮는다.

**명령**: `pnpm test`, `pnpm build && pnpm --filter ohmymcp test:e2e`, `pnpm typecheck --force`, `pnpm lint`
**보고서**: `docs/reports/task-t8-dry-run-gate.md`
**커밋**: `docs(cli): 시험 실행 옵션 도움말과 E2E 기대값을 갱신한다`

## 5. 실행 프롬프트

터미널 3개다. 프로젝트 루트에서 새 터미널을 열고 아래 블록을 그대로 붙여넣는다.

### 터미널 A (T1 · T7, `runner` + `cli`)

권장 실행 설정: 표준 모델, 추론 수준 보통, 에이전트 종류 `general-purpose`.

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

  git worktree add /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-dryrun-schema -b feat/dry-run-approval-schema main

를 실행한 뒤 그 경로로 세션을 옮겨라. 옮긴 다음 아래를 확인하고, 하나라도 어긋나면 중단하고
BLOCKED 로 보고해라.

  - pwd 가 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-dryrun-schema 인지
  - git log --oneline -1 이 루트의 main HEAD 와 같은지
  - docs/superpowers/specs/2026-08-15-dry-run-approval-gate-design.md 가 있는지
  - docs/superpowers/plans/2026-08-15-dry-run-approval-gate-implementation.md 가 있는지
  - git status --short 가 비어 있는지
  - pnpm install 을 실행하고 pnpm test 가 실제로 기동하는지

[2단계: 실행]

너는 구현자다. Task T1 과 T7 을 순서대로 끝낸다. 계획서
docs/superpowers/plans/2026-08-15-dry-run-approval-gate-implementation.md 의 §4 T1 과 §4 T7 을
읽고 그대로 구현해라. 설계 근거는
docs/superpowers/specs/2026-08-15-dry-run-approval-gate-design.md 의 §7 과 §9 다.

T1 허용 Files:
  packages/runner/src/spec/types.ts
  packages/runner/src/spec/validation.ts
  packages/runner/src/spec/json-schema.ts
  packages/runner/src/index.ts
  packages/runner/tests/spec-validation.test.ts
  packages/runner/tests/fingerprint.test.ts

T7 허용 Files:
  packages/cli/src/spec-approval.ts
  packages/cli/src/test-command.ts
  packages/cli/tests/spec-approval.test.ts
  packages/cli/tests/test-command.test.ts

T1 을 먼저 끝내고 커밋 메시지 `feat(runner): 승인 블록에 케이스별 판정을 추가한다` 를 보고서에
적어라. 그다음 T7 을 하고 `feat(cli): test 보고서에 승인 시점 서버 결함 표시를 반영한다` 를
적어라. 커밋은 하지 마라. 사람이 한다.

위 목록 밖의 파일을 고치지 마라. 특히 core/src/types.ts 의 McpClient·ToolResult, 루트 빌드
설정, 다른 오너의 패키지(record·mock)는 공유 계약이다. 고쳐야 할 것 같으면 고치지 말고
보고해라. 의존 방향은 단방향(cli → runner/generate/record/mock → core)이고 역참조·순환을
만들지 마라. @modelcontextprotocol/sdk 는 1.x 고정이고 목록 밖 의존성을 추가하지 마라.
백그라운드 실행, 커밋, 머지, 푸시, 하위 에이전트 스폰을 하지 마라. 다른 작업자의 변경을
되돌리지 마라.

테스트는 인메모리와 fixtures/ 만 쓴다. examples/ 의 실제 서버를 띄우지 마라.

검증: pnpm test, pnpm typecheck --force, pnpm lint 를 모두 돌리고 출력을 보고서에 붙여라.
typecheck 는 Cached: 0 cached 인지 확인해라.

보고서: docs/reports/task-t1-dry-run-gate.md 와 docs/reports/task-t7-dry-run-gate.md 두 개를
쓴다. 각각 바꾼 파일, 검증 명령과 결과, 임의로 판단한 지점, 남은 위험을 적어라.

최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작해라.
```

### 터미널 B (T2 · T3 · T4 · T5, `cli` 신규 모듈)

권장 실행 설정: 상위 모델, 추론 수준 높음, 에이전트 종류 `general-purpose`.
상위 모델인 이유: T3·T4 는 실패 메시지 문안이 제품이고, T5 는 카세트 재생 결정론성이
`cassetteClient.close()` 의 부작용과 얽혀 있어 계획서에 코드로 못 박기 어려운 판단이 남는다.

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

  git worktree add /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-dryrun-modules -b feat/dry-run-approval-modules main

를 실행한 뒤 그 경로로 세션을 옮겨라. 옮긴 다음 아래를 확인하고, 하나라도 어긋나면 중단하고
BLOCKED 로 보고해라.

  - pwd 가 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-dryrun-modules 인지
  - git log --oneline -1 이 루트의 main HEAD 와 같은지
  - docs/superpowers/specs/2026-08-15-dry-run-approval-gate-design.md 가 있는지
  - docs/superpowers/plans/2026-08-15-dry-run-approval-gate-implementation.md 가 있는지
  - git status --short 가 비어 있는지
  - pnpm install 을 실행하고 pnpm test 가 실제로 기동하는지

[2단계: 실행]

너는 구현자다. Task T2, T3, T4, T5 를 이 순서로 끝낸다. 계획서
docs/superpowers/plans/2026-08-15-dry-run-approval-gate-implementation.md 의 §4 해당 절을 읽고
그대로 구현해라. 화면 문안은 설계 문서
docs/superpowers/specs/2026-08-15-dry-run-approval-gate-design.md 의 §8 이 전량을 고정한다.
문안을 새로 만들지 마라.

T2 허용 Files: packages/cli/src/reset-hook.ts, packages/cli/tests/reset-hook.test.ts
T3 허용 Files: packages/cli/src/dry-run.ts, packages/cli/tests/dry-run.test.ts
T4 허용 Files: packages/cli/src/dry-run-review.ts, packages/cli/tests/dry-run-review.test.ts
T5 허용 Files: packages/cli/src/cassette-wiring.ts, packages/cli/tests/cassette-wiring.test.ts

네 태스크 모두 신규 파일이고 서로를 import 하지 않는다. generate-command.ts 를 고치지 마라.
배선은 T6 의 일이고 다른 터미널이 한다. ReviewIO 타입은 generate-command.ts 가 이미 내보내므로
그것을 import 해서 쓰고 새로 정의하지 마라.

태스크마다 커밋 메시지를 보고서에 적어라. 커밋은 하지 마라. 사람이 한다.
  T2: feat(cli): 시험 실행 전 초기화 명령 훅을 추가한다
  T3: feat(cli): 후보 명세를 실제 서버에 돌리는 시험 실행을 추가한다
  T4: feat(cli): 시험 실행 실패 케이스 분류 화면을 추가한다
  T5: feat(cli): 시험 실행에 카세트 클라이언트를 배선한다

위 목록 밖의 파일을 고치지 마라. 특히 core/src/types.ts 의 McpClient·ToolResult, 루트 빌드
설정, 다른 오너의 패키지(record·mock)는 공유 계약이다. record 패키지는 @ddxng5 소유이므로
한 글자도 고치지 마라. cassetteClient 를 감싸서 쓰는 것은 허용된다. 의존 방향은 단방향이고
역참조·순환을 만들지 마라. @modelcontextprotocol/sdk 는 1.x 고정이고 목록 밖 의존성을 추가하지
마라. 백그라운드 실행, 커밋, 머지, 푸시, 하위 에이전트 스폰을 하지 마라. 다른 작업자의 변경을
되돌리지 마라.

테스트는 인메모리와 fixtures/ 만 쓴다. examples/ 의 실제 서버를 띄우지 마라. 임시 스크립트
파일을 만들지 말고 process.execPath 와 -e 를 써라.

검증: pnpm test, pnpm typecheck --force, pnpm lint 를 모두 돌리고 출력을 보고서에 붙여라.
typecheck 는 Cached: 0 cached 인지 확인해라.

보고서: docs/reports/task-t2-dry-run-gate.md, task-t3-, task-t4-, task-t5- 네 개를 쓴다. 각각
바꾼 파일, 검증 명령과 결과, 임의로 판단한 지점, 남은 위험을 적어라.

최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작해라.
```

### 터미널 C (T6 · T8, 배선과 E2E, 직렬 전용)

**웨이브 1 의 네 PR 이 모두 `main` 에 머지된 뒤에 연다.** 통합 대장에 SHA 가 기록돼 있고 그
커밋이 `main` 의 조상인지 메인 세션이 먼저 확인한다.

권장 실행 설정: 상위 모델, 추론 수준 높음, 에이전트 종류 `general-purpose`.
상위 모델인 이유: 연결 수명 변경과 저장 경로 순서가 패키지 경계·결정론성 판단을 포함하고,
화면 출력이 곧 제품이다.

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

  git worktree add /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-dryrun-wiring -b feat/dry-run-approval-wiring main

를 실행한 뒤 그 경로로 세션을 옮겨라. 옮긴 다음 아래를 확인하고, 하나라도 어긋나면 중단하고
BLOCKED 로 보고해라.

  - pwd 가 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-dryrun-wiring 인지
  - git log --oneline -1 이 루트의 main HEAD 와 같은지
  - packages/cli/src/reset-hook.ts, dry-run.ts, dry-run-review.ts, cassette-wiring.ts 가
    모두 있는지 (없으면 웨이브 1 이 안 들어온 것이다. BLOCKED 로 보고해라)
  - packages/runner/src/spec/types.ts 에 SuiteCaseApproval 이 있는지
  - docs/superpowers/plans/2026-08-15-dry-run-approval-gate-implementation.md 가 있는지
  - git status --short 가 비어 있는지
  - pnpm install 과 pnpm build 를 실행하고 pnpm test 가 실제로 기동하는지

[2단계: 실행]

너는 구현자다. Task T6 과 T8 을 순서대로 끝낸다. 계획서
docs/superpowers/plans/2026-08-15-dry-run-approval-gate-implementation.md 의 §4 T6 과 §4 T8 을
읽고 그대로 구현해라. 저장 경로 순서는 설계 문서
docs/superpowers/specs/2026-08-15-dry-run-approval-gate-design.md 의 §4.2 가, 화면 문안은 §8 이
전량을 고정한다.

T6 허용 Files:
  packages/cli/src/generate-command.ts
  packages/cli/tests/generate-command.test.ts
  packages/cli/tests/generate-integration.test.ts

T8 허용 Files:
  packages/cli/src/help.ts
  packages/cli/tests/help.test.ts
  packages/cli/tests/dist-cli-e2e.mjs

주의할 것 셋을 미리 적는다.

  1. 연결 수명이 바뀐다. 대화형 경로에서 listTools 직후 close 를 하지 말고 검토가 끝난 뒤
     finally 에서 닫아라. --baseline-only 경로는 지금 그대로 둔다.
  2. cassetteWiring.flush() 는 내부에서 inner.close() 까지 부른다. 저장이 끝난 뒤에만 불러라.
  3. dist-cli-e2e.mjs 는 pnpm test 가 아니라 pnpm build && pnpm --filter ohmymcp test:e2e 로 돈다. 출력 형태를 바꿨으므로
     이 파일 기대값을 반드시 함께 고쳐라. 안 고치면 로컬은 녹색인데 CI 의 build job 이
     빨간불이 된다.

커밋 메시지를 보고서에 적어라. 커밋은 하지 마라. 사람이 한다.
  T6: feat(cli): generate 저장 경로에 시험 실행 게이트를 넣는다
  T8: docs(cli): 시험 실행 옵션 도움말과 E2E 기대값을 갱신한다

위 목록 밖의 파일을 고치지 마라. 특히 core/src/types.ts 의 McpClient·ToolResult, 루트 빌드
설정, 다른 오너의 패키지(record·mock)는 공유 계약이다. 웨이브 1 이 만든 reset-hook.ts,
dry-run.ts, dry-run-review.ts, cassette-wiring.ts 도 고치지 마라. 계약이 안 맞으면 고치지 말고
보고해라. 의존 방향은 단방향이고 역참조·순환을 만들지 마라. @modelcontextprotocol/sdk 는 1.x
고정이고 목록 밖 의존성을 추가하지 마라. 백그라운드 실행, 커밋, 머지, 푸시, 하위 에이전트
스폰을 하지 마라. 다른 작업자의 변경을 되돌리지 마라.

이 터미널은 직렬 전용이다. T8 의 E2E 가 실제 서버 프로세스를 띄우므로 다른 터미널과 동시에
돌리지 않는다.

검증: pnpm test, pnpm build && pnpm --filter ohmymcp test:e2e, pnpm typecheck --force, pnpm lint 를 모두 돌리고 출력을
보고서에 붙여라. typecheck 는 Cached: 0 cached 인지 확인해라.

보고서: docs/reports/task-t6-dry-run-gate.md 와 docs/reports/task-t8-dry-run-gate.md 두 개를
쓴다. 각각 바꾼 파일, 검증 명령과 결과, 임의로 판단한 지점, 남은 위험을 적어라.

최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작해라.
```

## 6. 통합 게이트

각 태스크 보고를 받으면 메인 세션이 직접 확인한다. 자식의 완료 선언은 단서일 뿐이다.

1. worktree 에서 `git status --short` 와 `git diff --check`. 변경 경로가 허용 Files 안인가.
2. diff 를 직접 읽는다. 설계서 §8 의 문안이 그대로 들어갔는가. 새 문안을 지어내지 않았는가.
3. 계획서에 적힌 테스트 명령을 **다시 실행한다.** `pnpm typecheck --force` 의 출력에서
   `Cached: 0 cached` 를 확인한다. turbo 캐시가 이전 녹색을 재생하는 거짓 신호를 막는다.
4. 통과하면 커밋하고 `--no-ff` 로 머지한다. 머지된 `main` 에서 전체 테스트를 **새로** 돌린다.
5. 통합 SHA 를 `docs/task-integration-ledger.tsv` 에 `T<N>-dry-run-gate` 로 기록하고 별도 문서
   커밋으로 보존한다.
6. worktree 가 깨끗한지 확인한 뒤 그 worktree 만 제거하고 그 브랜치만 삭제한다.

## 7. 완료 판정

설계서 §2 의 완료 조건 전부에 더해 아래를 확인한다.

- `main` 에서 `pnpm test`, `pnpm build && pnpm --filter ohmymcp test:e2e`, `pnpm typecheck --force`, `pnpm lint` 가 통과한다.
- `docs/task-integration-ledger.tsv` 에 T1~T8 여덟 줄이 있고 전부 `main` 의 조상이다.
- `docs/adr/README.md` 에 T0 의 ADR 이 색인돼 있다.
- 상태 있는 예제 서버 부재로 인한 검증 공백(설계서 §13.7)이 후속 작업으로 등록돼 있다.

## 8. 알려진 위험

- **연결 수명 변경이 기존 테스트를 깬다.** `generate-command.test.ts` 의 여러 케이스가
  `listTools` 직후 `close` 를 기대한다. T6 이 그 기대값을 함께 고쳐야 하고, 그것이 T6 의
  실제 분량을 계획보다 키울 수 있다.
- **카세트 flush 시점이 미묘하다.** `recorder.close()` 가 `inner.close()` 를 부르므로 순서를
  틀리면 저장 직전에 연결이 죽는다. T5 의 테스트가 `close` 호출 횟수를 세는 이유다.
- **ADR 번호 충돌.** 병렬 브랜치가 같은 번호를 잡는 사고가 저장소에서 네 번 났다. T0 을
  메인 세션이 먼저 끝내고 머지한 뒤 웨이브 1 을 연다.
- **E2E 누락.** 출력 형태를 바꾸는 작업에서 `pnpm test` 밖의 검증 스크립트를 빠뜨리는 실수가
  직전 작업에서 났다. T8 에 명시했지만 통합 게이트에서 `pnpm build && pnpm --filter ohmymcp test:e2e` 를 다시 돌려 확인한다.
