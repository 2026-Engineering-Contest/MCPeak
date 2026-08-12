# Task B4 보고서 — 승인 화면에 변경 내용 표시

## 작업 공간

- worktree: `<repo-root>/.claude/worktrees/ohmymcp-cli-show-diff`
- 브랜치: `fix/cli-show-diff`
- `git rev-parse HEAD`: `9efbeac47d33f9b347c1f9e373948bdc9cd24b95`
- 기점 커밋: `9efbeac docs(core): stdio 통합 테스트 간헐 실패 인계 문서 추가` (지시받은 값과 일치)
- 진입 시 `git status --short` 비어 있음. `pnpm install` 후 `pnpm build`,
  `pnpm vitest run packages/cli` (67 passed) 실행 확인

## 변경 파일

| 파일 | 내용 |
|---|---|
| `packages/cli/src/generate-command.ts` | `showDiff` 재작성, `leaves`/`changedLeaves`/`diffBody` 추가 |
| `packages/cli/tests/generate-command.test.ts` | 테스트 11개 추가 |
| `.changeset/cli-show-diff-detail.md` | 신규 (patch, `ohmymcp`) |
| `docs/reports/task-b4.md` | 이 보고서 |

`AuthoringChange`와 `AuthoringDiffPreview`는 건드리지 않았다. 지금 타입만으로 충분했다.
`showDiff` 호출부 세 곳도 그대로 두고 함수만 고쳤다.

## 1. 비밀값 노출 확인 (요청한 선행 조사)

### 경로 추적

`createAuthoringDiff`(`packages/generate/src/authoring-session.ts:164`)는 두 값을 비교한다.

```ts
const before = current.approved.suite;   // session의 승인된 draft
const after  = stored.suite;             // candidate에 등록된 suite
```

`after`의 출처인 `stored.suite`는 `candidateFor`에서 이렇게 만들어진다
(`authoring-session.ts:108-121`).

```ts
const redacted = redactAuthoringSuite(value, { ...options.redaction, sensitiveValues: ... });
const frozenSuite = cloneFreeze(redacted.suite);
...
candidates.set(preview, { suite: frozenSuite, providerId: options.providerId });
```

**즉 `after`는 redaction을 이미 거친 값이다.** provider가 돌려준 원문이 아니다.

`before`는 승인된 draft다. 승인은 `applyAuthoringChanges`의
`if (!candidate.executable) return { applied: false, reason: "redactionRequired" };`
(`authoring-session.ts:237`)를 통과해야 하고, `executable`은 `redactedPaths.length === 0`이다.
따라서 **승인된 내용에는 애초에 redaction 대상이 없었다.**

### 다만 redaction 범위가 좁다

`redactAuthoringSuite`(`packages/generate/src/redaction.ts:13-26`)는 **`callTool` 케이스의
`operation.input`만** 훑는다.

```ts
for (const [index, item] of copy.cases.entries()) {
  if (item.operation.type !== "callTool") continue;
  ...
  item.operation.input = input as typeof item.operation.input;
}
```

`sanitize`가 가리는 것은 두 가지다.

- 키 이름이 `DEFAULT_SENSITIVE_KEYS`에 걸리는 경우. 목록은 `authorization`, `cookie`,
  `password`, `passwd`, `secret`, `token`, `apikey`, `accesstoken`, `refreshtoken`,
  `clientsecret` (`packages/runner/src/sanitization.ts:6`). 정규화는 소문자 + 영숫자 외 제거다.
- 호출자가 `sensitiveValues`로 넘긴 문자열과 정확히 일치하는 값.

**따라서 다음 경로는 redaction을 통과하지 않고 화면에 원문 그대로 나온다.**

| 경로 | redaction 적용 |
|---|---|
| `operation.input.*` (callTool) | 적용됨 (키 목록 + sensitiveValues) |
| `id`, `name` | **없음** |
| `operation.type`, `operation.tool` | **없음** |
| `assertions[*].*` (expected 값 포함) | **없음** |
| `timeoutMs` | **없음** |
| `listTools` 케이스 전체 | **없음** (`operation.type !== "callTool"`이라 건너뜀) |

### 판단과 조치

`packages/generate`는 수정 금지라 redaction을 넓히지 않았다. 지시대로 **현재 동작을 그대로
테스트로 고정했다.**

- `provider가 돌려준 candidate의 민감 키는 redaction된 값이 보인다`
  → `operation.input.token`에 `"hunter2"`를 넣으면 화면에 `"[REDACTED]"`가 나오고
  `hunter2`는 어디에도 없다.
- `redaction 대상이 아닌 필드는 원문이 그대로 보인다`
  → `name`에 `PLAINTEXT_CASE_NAME`을 넣으면 그대로 나온다.

**후속 판단이 필요한 지점**: 화면에 내용을 찍기 시작했으므로, `assertions[*].expected`나
`name`에 비밀값이 들어간 suite는 이제 승인 화면에 원문이 노출된다. 이전에는 아무것도 안 찍어서
문제가 없었다. 승인 화면은 사용자 자기 터미널이라 위험도가 낮지만, 화면 공유나 터미널 로깅
환경에서는 다르다. `redactAuthoringSuite`의 범위를 `operation.input` 밖으로 넓힐지는
`packages/generate` 오너 판단이다.

## 2. 계획서에 없던 다섯 번째 변종

지시에는 네 변종(`addCase`, `replaceCase`, `removeCase`, `caseOrder`)만 적혀 있었으나
`AuthoringChange`에는 **`suiteMetadata`**가 하나 더 있다
(`packages/generate/src/authoring-types.ts:58-64`).

```ts
| { id; type: "suiteMetadata"; before: { name; defaultTimeoutMs? }; after: { name; defaultTimeoutMs? } }
```

`createAuthoringDiff`가 suite의 `name`이나 `defaultTimeoutMs`가 바뀌면 실제로 만든다. 빼놓으면
그 변경만 본문 없이 헤더 한 줄로 남아 원래 결함이 그대로 재현된다. `before`/`after`가 있는
구조라 `replaceCase`와 같은 leaf 비교를 적용했다. (타입은 고치지 않았다. 읽기만 했다.)

부수적으로 `addCase`의 인덱스 필드명은 지시에 적힌 `approvedIndex`가 아니라 `candidateIndex`다.
출력에 쓰지 않아 영향은 없다.

## 3. 구현

```ts
const MAX_DIFF_BODY_LINES = 40;
function leaves(value: unknown, prefix = ""): (readonly [string, string])[]
function changedLeaves(before: unknown, after: unknown): string[]
function diffBody(change): string[]
function showDiff(io, preview): void
```

- 순회는 문서 순서(`Object.entries` 순, 배열 인덱스 순)다. 정렬하지 않는다.
- 값은 `JSON.stringify` 결과. `undefined`가 들어오면 `"undefined"` 문자열로 떨어뜨린다
  (`JSON.stringify(undefined)`가 문자열이 아니라 `undefined`를 돌려주기 때문이다).
- 배열은 `[i]`, 객체는 `.`.
- **빈 객체 `{}`와 빈 배열 `[]`은 그 자체를 leaf로 본다.** 그러지 않으면 그 경로가 출력에서
  조용히 사라진다. baseline의 `operation.input`이 실제로 `{}`라 바로 걸리는 경우다.
- 같은 경로의 `-`와 `+`는 붙여서 쓰고, 한쪽에만 있는 경로는 한 줄만 쓴다.
- 본문이 40줄을 넘으면 40줄까지 쓰고 생략 줄을 붙인다.

`MAX_DIFF_BODY_LINES = 40` 근거(주석에도 남겼다): 승인 화면은 스크롤 없이 읽혀야 한다. 케이스
하나의 diff가 이보다 커지면 사람이 화면으로 판단할 수 없고 저장 후 JSON을 여는 편이 맞는
경로다. 40줄은 흔한 터미널 높이(24~50줄)에서 헤더와 메뉴 프롬프트를 빼고 남는 분량이다.

## 4. 실제 화면 (실측 원문)

임시 덤프 테스트로 뽑은 문자열을 그대로 붙인다. provider는 부르지 않았다. 덤프 테스트는
확인 후 제거했다.

replaceCase (`operation.input`을 `{}`에서 `{city:"서울"}`로):

```
change-001 replaceCase weather-success
  - operation.input: {}
  + operation.input.city: "서울"
```

addCase:

```
change-001 addCase add-negative
  + id: "add-negative"
  + name: "weather가 오류 없이 응답한다"
  + operation.type: "callTool"
  + operation.tool: "weather"
  + operation.input: {}
  + assertions[0].type: "isError"
  + assertions[0].expected: false
change-002 caseOrder
  - weather-success
  + weather-success, add-negative
```

removeCase (`weather-success`를 지우고 `kept-case`를 넣은 경우):

```
change-001 removeCase weather-success
  - id: "weather-success"
  - name: "weather가 오류 없이 응답한다"
  - operation.type: "callTool"
  - operation.tool: "weather"
  - operation.input: {}
  - assertions[0].type: "isError"
  - assertions[0].expected: false
change-002 addCase kept-case
  + id: "kept-case"
  ...
change-003 caseOrder
  - weather-success
  + kept-case
```

비밀값 (`operation.input.token`에 `"hunter2"`):

```
change-001 replaceCase weather-success
  - operation.input: {}
  + operation.input.token: "[REDACTED]"
```

## 5. 검증

### 테스트 선작성 후 실패 확인

```
pnpm vitest run packages/cli
     × replaceCase는 바뀐 leaf 경로만 - 와 + 로 보여준다
     × addCase는 모든 leaf 경로를 + 로 보여준다
     × removeCase는 모든 leaf 경로를 - 로 보여준다
     × caseOrder는 before와 after 순서를 한 줄씩 보여준다
     × 배열 인덱스 경로를 쓴다
     × 본문이 40줄을 넘으면 잘라내고 생략 줄을 붙인다
     × select 메뉴에서도 각 change의 내용이 보인다
     × provider가 돌려준 candidate의 민감 키는 redaction된 값이 보인다
     × redaction 대상이 아닌 필드는 원문이 그대로 보인다
      Tests  9 failed | 69 passed (78)
```

`같은 입력은 항상 같은 출력을 낸다`와 `변경이 없으면 아무것도 쓰지 않는다` 둘은 기존 동작으로도
성립하는 성질이라 처음부터 녹색이었다.

### 구현 후

```
pnpm vitest run packages/cli → Test Files 5 passed (5) / Tests 78 passed (78)
pnpm build     → Tasks: 6 successful, 6 total
pnpm typecheck → Tasks: 6 successful, 6 total
pnpm lint      → Checked 97 files in 21ms. No fixes applied.
pnpm test      → Test Files 27 passed (27) / Tests 264 passed (264)
```

검사 대상 0개 거짓 신호 점검:

- 린트 `Checked 97 files` (0 아님)
- 타입체크는 성공 시 무출력이라 별도로
  `cd packages/cli && npx tsc --noEmit --listFiles | grep -c "worktrees/ohmymcp-cli-show-diff/packages/cli/"`
  → **9**

`packages/core`의 stdio-integration 간헐 실패는 이번 실행들에서 나오지 않았다. 다른 실패도 없었다.

## 6. 임의로 판단한 부분

1. **`suiteMetadata` 변종을 함께 처리했다** (위 2절). 빼면 그 변경에서 결함이 그대로 남는다.
2. **빈 객체·빈 배열을 leaf로 취급했다.** baseline의 `operation.input`이 `{}`라 실제로 걸린다.
   그 결과 위 실측 화면처럼 `- operation.input: {}` / `+ operation.input.city: "서울"`로 나온다.
   경로가 사라지는 것보다 낫다고 봤다.
3. **한 change당 `io.write`를 1회 호출한다** (헤더 + 본문을 한 문자열로). 줄마다 호출하면
   기존 호출 단위와 달라져 다른 테스트의 단언 방식과 어긋난다.
4. **테스트에서 `CallToolCaseSpec` 타입 가드를 썼다.** TS가 `case.operation.type` 검사로 케이스
   객체 자체를 좁혀 주지 않아 스프레드 결과가 union으로 남았다. `as` 캐스트 대신 타입 술어
   하나를 두는 편이 낫다고 봤다.
5. **`addCase` 테스트의 단언을 해당 change 블록으로 한정했다.** 케이스를 추가하면 `caseOrder`
   change도 함께 생기고 그 본문에는 `-` 줄이 있다. 처음에 출력 전체로 단언했다가 실패했고,
   블록 단위로 좁히는 것이 지시("addCase에 - 줄이 없다")의 실제 의미라고 판단했다.
6. **changeset은 `ohmymcp` patch.** 사용자에게 보이는 출력 변화라 릴리스 노트에 남길 값이 있다.

## 7. 남은 위험

- **redaction 범위가 `operation.input`으로 좁다** (위 1절 표). 화면에 내용을 찍기 시작한 이번
  변경으로 노출 표면이 새로 생겼다. `packages/generate` 오너 판단이 필요하다.
- 40줄 상한은 change 하나 기준이다. change가 여러 개면 화면 전체는 그보다 길어질 수 있다.
  전체 화면 상한은 지시에 없어 넣지 않았다.
- 실제 터미널에서 사람이 눈으로 본 확인은 하지 않았다. 실제 provider 호출이 필요해 이 태스크
  범위 밖이다. 위 4절 원문은 테스트가 만든 문자열이다.
