# Task R2 보고서 — PR #37 CodeRabbit 리뷰 반영 (cli · docs)

## 작업 공간

- worktree: `<repo-root>/.claude/worktrees/ohmymcp-review-cli`
- 브랜치: `fix/review-cli`
- 기점 커밋: `cdb7d4e fix(cli): 워크스페이스 패키지를 소스로 해석하도록 vitest alias 보강`
- 진입 시 `git status --short` 비어 있음. `pnpm install` 후 `pnpm vitest run packages/cli`
  (89 passed) 실행 확인

## 변경 파일

| 파일 | 항목 |
|---|---|
| `packages/cli/src/generate-command.ts` | 1, 2 |
| `packages/cli/tests/generate-command.test.ts` | 1, 2, 3 |
| `docs/plans/2026-08-12-ai-provider-호출-복구-구현계획.md` | 4, 5(b) |
| `docs/superpowers/plans/2026-08-12-ai-assisted-test-authoring-implementation.md` | 4 |
| `docs/ai-provider-schema-compatibility.md` | 5(a) |
| `docs/reports/task-a1.md` ~ `task-b6.md` (8개) | 4 |
| `docs/architecture.md` | 6 |
| `.changeset/cli-review-fixes.md` | 신규 |
| `docs/reports/task-r2.md` | 이 보고서 |

`packages/cli/src/index.ts`는 **고치지 않았다.** 이유는 아래 1번에 적는다.
`packages/generate`는 열어 보지도 않았다(다른 터미널 작업 중).

## 1. `--baseline-only`가 실제 TTY에서 종료되지 않던 문제 🟠

### 고른 방향과 근거

제시된 두 갈래는 (a) reviewIO 지연 생성, (b) baselineOnly 경로에서 `io.close?.()` 보장이었고
권고는 (a)였다. **(a)를 골랐되 위치를 index.ts가 아니라 `nodeReviewIO` 안으로 잡았다.**

index.ts에서 지연 생성하려면 `reviewIO`를 팩토리로 바꿔야 하는데, `runGenerateCommand`가
`deps.reviewIO?.interactive`로 비대화형을 **provider 호출 전에** 거절하는 게이트가 있어
(generate-command.ts의 `GENERATE_INTERACTIVE_REQUIRED` 분기) 팩토리로 바꾸면 그 게이트도 함께
설계를 바꿔야 한다. 의존성 조립 형태와 게이트 두 곳이 걸리므로 범위가 커진다.

반면 진짜 원인은 "readline이 만들어지는 시점"이고 그것은 `nodeReviewIO` 내부 사정이다.
`createInterface`를 첫 질문까지 미루면 `interactive`(스트림의 `isTTY`만 보면 된다)와 의존성
조립은 그대로 두고 원인만 없앨 수 있다. 호출부는 한 줄도 바뀌지 않았다.

(b)를 고르지 않은 이유는 권고와 같다. 안 만들면 닫기를 잊을 여지 자체가 없다.

### 구현

```ts
let readline: ReturnType<typeof createInterface> | undefined;
const ensureReadline = () => {
  if (readline !== undefined) return readline;
  const created = createInterface({ input, output });
  created.on("close", () => { closed = true; rejectPending?.(); });
  readline = created;
  return created;
};
// question()이 ensureReadline()을 부른다.
// close는 만들지 않았으면 아무것도 하지 않는다.
close: () => readline?.close(),
```

`close` 이벤트 등록도 생성 시점으로 함께 옮겼다. B2에서 넣은 EOF 처리(닫힌 뒤 호출 → sentinel,
대기 중 닫힘 → race)는 그대로 동작한다.

### 테스트

실제 TTY는 유닛테스트로 만들 수 없으므로 **생성 여부**를 관찰했다. `createInterface`는 만드는
즉시 입력 스트림에 리스너를 걸므로 리스너 수가 곧 생성 여부다.

- `nodeReviewIO는 질문하기 전에는 readline을 만들지 않는다`
  - 생성 직후 리스너 수가 그대로 → 안 만들어졌다
  - 질문 전 `io.close?.()`가 던지지 않는다 → 만들지 않았으면 닫을 것도 없다
  - `io.input()` 호출 후 리스너 수 증가 → 이때 만들어진다
  - 이어서 `io.close?.()`하면 대기 중이던 질문이 sentinel로 거절된다(B2 경로 회귀 확인)
- `baseline-only는 reviewIO에 아무것도 묻지 않는다`
  - `--baseline-only` 실행에서 `choose`/`input`/`confirm`이 한 번도 불리지 않는다

첫 테스트를 쓸 때 `Readable.from([])`을 썼다가 실패했다. EOF로 끝나는 스트림은 readline이
만들어지자마자 닫혀 리스너가 사라져서, 생성 후 리스너 수가 0으로 돌아온다. 열린 채로 두는
`new Readable({ read: () => undefined })`로 바꿔 해결했다. 주석에 남겼다.

## 2. 대화형 저장 실패가 원인을 감추던 문제 🟠

`saveSuite`가 던지던 `UsageError("기존 출력 파일을 비대화형으로 덮어쓸 수 없습니다.")`를
전용 오류로 갈랐다.

```ts
class OutputExistsError extends Error {
  constructor(readonly path: string) { super("output exists"); }
}
```

`UsageError`를 재사용하지 않은 이유: `UsageError`는 argv 해석 실패를 뜻하고 그쪽 메시지는
사용자에게 그대로 노출된다. 의미가 다른 두 실패를 한 타입에 얹으면 나중에 한쪽만 고칠 때
어긋난다.

기존 문구가 "**비대화형으로** 덮어쓸 수 없습니다"였는데 이 가드는 대화형 저장에서도 걸린다.
문구 자체가 상황과 맞지 않았다.

새 문구:

```
오류 [GENERATE_OUTPUT_EXISTS]: 출력 파일이 이미 있어 저장하지 않았습니다. 경로: /tmp/out.json
해결: 다른 `--out` 경로를 지정하거나 기존 파일을 옮긴 뒤 다시 저장하세요.
```

경로는 `경로: {path}` 라벨 뒤에 두어 변수 바로 뒤에 조사가 붙지 않게 했다(B6에서 정한 규칙).

**비대화형 경로에도 같이 적용했다.** 지시는 대화형만 언급했으나 동일한 결함이
`runGenerateCommand`의 바깥 catch에도 있어(`GENERATE_FAILED`로 뭉갠다) 같은 두 줄로 갈랐다.
한쪽만 고치면 같은 실패가 경로에 따라 다르게 보인다. 범위를 넘었다고 판단하면 그쪽 분기만
되돌리면 된다.

테스트 셋:
- `기존 out 파일을 비대화형으로 덮어쓰지 않는다`(기존) — 단언 보강. `GENERATE_OUTPUT_EXISTS`와
  `경로: /tmp/out.json`이 나오고 `GENERATE_FAILED`는 나오지 않는다
- `저장하려는 경로에 파일이 있으면 경로와 조치를 안내한다`(신규, 대화형)
- `경로 충돌이 아닌 저장 실패는 기존 문구를 유지한다`(신규) — `openTemp`가 던지면
  `GENERATE_SAVE_FAILED`가 유지되고 원본 오류 문자열(`EACCES`)은 새지 않는다

## 3. 중복 테스트 이름 🟡

둘 다 `"exitCode를 모르면 코드 없이 종료 사실만 안내한다"`였다. 검증 대상이 드러나게 갈랐다.

| 위치 | 새 이름 | 이 테스트만 보는 것 |
|---|---|---|
| `failWith` 쪽 | `exitCode가 없으면 종료 코드 라벨 자체를 빼고 안내한다` | 라벨(`종료 코드:`) 자체가 사라지는지 |
| `failOn` 쪽 | `exitCode가 없어도 provider에 맞는 명령과 모델 이름은 안내한다` | provider별 명령과 모델 이름이 남는지 |

이름을 가르면서 각 이름이 실제로 보는 것을 단언으로도 보강했다(앞쪽에 `종료 코드:` 미포함,
뒤쪽에 `모델: haiku` 포함).

## 4. 개인 식별 경로 제거 🟠 Security

`grep -ro "doo\._\.hyun" docs/ | wc -l` → 수정 전 **23**, 수정 후 **0**.

| 대상 | 치환 |
|---|---|
| 보고서 8개의 `pwd:` 줄 | `- worktree: \`<repo-root>/.claude/worktrees/<이름>\`` 로 교체. worktree 이름은 남겼다(재현용). 브랜치와 기점 SHA는 이미 각 보고서에 있다 |
| 계획서 §8 실행 프롬프트 | 아래 별도 설명 |
| 계획서 참조 구현 경로 | `MCPLens-V2 저장소의 packages/extension/src/inferenceCli.ts (이 저장소 밖의 로컬 참조)` |
| superpowers 계획서 6곳 | `<repo-root>/../OhMyMCP-worktrees/<이름>`. 이 계획은 `.claude/worktrees/`가 아니라 저장소 옆 형제 디렉터리를 쓰던 시절 문서라 그 구조를 보존했다 |

### 실행 프롬프트의 붙여넣기 동작 보존

계획서 §8의 프롬프트는 사람이 그대로 복사해 쓰는 것이므로 `<repo-root>`로 바꾸면 동작하지
않는다. 절대 경로를 **상대 경로 + 위치 지시 문장**으로 바꿨다.

```diff
-/Users/<사용자>/.../OhMyMCP 에서
+이 저장소의 루트에서
   git worktree add .claude/worktrees/ohmymcp-generate-provider -b fix/generate-provider-schema
-를 실행한 뒤 세션을 /Users/<사용자>/.../ohmymcp-generate-provider 로 옮겨라.
+를 실행한 뒤 세션을 방금 만든 .claude/worktrees/ohmymcp-generate-provider 로 옮겨라.

-  - pwd가 /Users/<사용자>/.../ohmymcp-generate-provider 인지
+  - pwd가 .claude/worktrees/ohmymcp-generate-provider 로 끝나는지

-  5. 보고서를 /Users/<사용자>/.../ohmymcp-generate-provider/docs/reports/task-a1.md 에 쓴다.
+  5. 보고서를 worktree 안의 docs/reports/task-a1.md 에 쓴다.
```

`git worktree add` 줄은 원래부터 상대 경로였으므로 저장소 루트에서 실행하면 그대로 동작한다.
pwd 검증은 절대 경로 일치에서 접미사 일치로 바꿨다. 두 프롬프트(A1, B1) 모두 같은 방식이다.

## 5. 문서와 구현의 어긋남 🟡

### (a) `docs/ai-provider-schema-compatibility.md`

"`api_error_status`가 **있는** 결과를 성공으로 취급하지 않는다" → 값 기준으로 고쳤다.
Claude 2.1.228의 정상 성공 응답이 이 키를 항상 `null`로 담으므로 키 존재로 판정하면 모든
성공이 거절된다는 사실과 `null`/`undefined`만 통과시킨다는 현재 계약을 명시했다.
구현(`packages/generate/src/providers.ts`의 `value.api_error_status !== null &&
value.api_error_status !== undefined`)과 대조해 확인했다. generate는 읽기만 했다.

### (b) 계획서 §4-2 판정 순서 2번

본문을 현재 계약(`null` 또는 `undefined`)으로 고치고, 바로 아래에 인용 블록으로 **정정 사실**을
남겼다. 지운 것처럼 위장하지 말라는 지시대로 원래 조건이 무엇이었고 왜 A2에서 바뀌었는지 적었다.

> **정정(Task A2).** 이 항목은 원래 "`api_error_status` 키 없음"이었다. …

계획서 §5의 테스트 목록에 있는 `it("Claude가 api_error_status를 담으면 …")`은 그대로 뒀다.
"담으면"은 값이 있는 경우를 뜻하고 계획서 예시도 `529`라 현재 계약과 어긋나지 않는다.

## 6. `docs/architecture.md`의 의존 방향 서술 🟡

**코드는 고치지 않았다.** 문서에 현재 상태와 미해결 사실만 적었다.

의존 그래프(`cli → generate → runner → core`) 아래에 `generate → runner`의 현재 상태를 절로
추가했다. 실제 import를 훑어 무엇을 가져오는지 표로 적었다.

| 가져오는 것 | 종류 |
|---|---|
| `TestSuiteSpec`, `TestCaseSpec`, `SuiteValidationIssue`, `RunnerRedactionOptions` | 타입 |
| `validateMcpSuite` | 함수 |
| `MCP_SUITE_JSON_SCHEMA` | 상수 |
| `DEFAULT_SENSITIVE_KEYS`, `REDACTED` | 상수 |

그리고 이것이 선언된 규칙과 어떤 관계인지 한 문단으로 적었다. 요지는 둘이다. 첫째, 화살표
방향 자체는 어긋나지 않는다. 둘째, §3의 "core의 **타입**만 있으면 되고 **구현**은 필요 없다"는
서술은 core에 한한 것이고 runner에는 성립하지 않는다. `generate`는 runner의 구현에 의존한다.
제거하려면 suite 스펙과 검증기를 더 낮은 층으로 내려야 하고 그것은 별도 ADR 대상이며 아직
정해지지 않았다고 적었다. 판단은 내리지 않았다.

## 검증

```
pnpm vitest run packages/cli → Test Files 5 passed (5) / Tests 93 passed (93)
pnpm build     → Tasks: 6 successful, 6 total
pnpm typecheck → Tasks: 6 successful, 6 total
pnpm lint      → Checked 97 files in 27ms. No fixes applied.
pnpm test      → Test Files 27 passed (27) / Tests 300 passed (300)
```

CI 조건(build 없이) 재현:

```
rm -rf packages/*/dist && pnpm test
→ Test Files 27 passed (27) / Tests 300 passed (300)
```

검사 대상 0개 거짓 신호 점검:

- 린트 `Checked 97 files` (0 아님)
- 타입체크는 성공 시 무출력이라 별도로
  `cd packages/cli && npx tsc --noEmit --listFiles | grep -c "worktrees/ohmymcp-review-cli/packages/cli/"`
  → **9**
- `grep -rn "doo\._\.hyun" docs/` → **0건**

`packages/core`의 stdio-integration 간헐 실패는 이번 실행들에서 나오지 않았다. 다른 실패도 없었다.

## 임의로 판단한 부분

1. **1번을 index.ts가 아니라 `nodeReviewIO` 안에서 지연 생성으로 해결했다.** 근거는 위 1번.
   `packages/cli/src/index.ts`는 수정 허용 목록에 있었지만 건드릴 필요가 없었다.
2. **2번을 비대화형 경로에도 적용했다.** 지시 범위를 살짝 넘는다. 근거는 위 2번.
3. **`OutputExistsError`를 새로 만들었다.** `UsageError` 재사용을 피한 이유는 위 2번.
4. **superpowers 계획서는 `<repo-root>/../OhMyMCP-worktrees/` 형태로 바꿨다.** 그 문서가 쓰던
   형제 디렉터리 구조를 그대로 보존해야 재현 지시가 말이 되기 때문이다.
5. **계획서 §5의 `api_error_status` 테스트 목록 문장은 그대로 뒀다.** 현재 계약과 어긋나지 않는다.
6. **changeset을 만들었다.** 1번과 2번이 사용자에게 보이는 동작 변화다(종료되지 않던 명령이
   종료되고, 새 오류 코드가 생긴다). 3~6번은 테스트 이름과 문서라 릴리스 노트 대상이 아니다.

## 남은 위험

- 1번의 진짜 판정 기준은 **실제 TTY에서 `--baseline-only`가 종료되는지**다. 유닛테스트는
  readline 생성 여부까지만 본다. 실제 터미널 확인은 하지 않았다. 사람이 한 번 돌려 보는 것이
  유일한 진실 기준이다.
- 6번은 서술만 고쳤다. `generate → runner` 의존 자체는 그대로이며 ADR이 필요하다.
