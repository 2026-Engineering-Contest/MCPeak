# Task T1 보고: 시험 실행 보고서의 실패 케이스 요약 절 (#446)

- 브랜치: `feat/runner-failed-case-recap`
- worktree: `.claude/worktrees/mcpeak-failed-case-recap`
- 기점: `a3e9c5c`
- 계획서: `docs/superpowers/plans/2026-09-10-failed-case-recap-implementation.md` Task T1 (Step 1~15)
- 상태: READY_FOR_REVIEW

## 변경 파일

허용 Files 두 개뿐이다. `git status --short` 출력이 아래와 같다.

```
 M packages/runner/src/reporter.ts
 M packages/runner/tests/reporter.test.ts
```

`git diff --stat`

```
 packages/runner/src/reporter.ts        | 108 ++++++++++++--
 packages/runner/tests/reporter.test.ts | 265 ++++++++++++++++++++++++++++++++-
 2 files changed, 361 insertions(+), 12 deletions(-)
```

### `packages/runner/src/reporter.ts`

- `bulletLine` 에서 글머리 판정 규칙을 `bulletBody` 로 떼어 냈다. 들여쓰기를 호출부가 정하므로
  케이스 블록(4칸)과 실패 요약 절(2칸)이 같은 규칙을 쓴다. `bulletLine` 의 외부 동작은 그대로다.
- `payloadNoticeLines` 뒤에 절을 더했다. `RECAP_INDENT`, `RECAP_HEADING`, `RECAP_STATUSES`,
  `MAX_RECAP_TEXT_CHARS`, `clampRecapText`, `recapText`, `failedRecapLines` 다.
- `renderReport` 꼬리에 `lines.push(...failedRecapLines(report, color))` 한 줄을 요약 줄 앞에
  끼웠다. 시그니처와 순수성은 그대로이고 새 export 도 없다.

### `packages/runner/tests/reporter.test.ts`

- `describe("실패한 케이스 절")` 을 새로 열어 14건을 더했다(위치·선택 규칙 4갈래·상태 선별·
  행 수·열 맞춤·이스케이프·화살표 겹침·자르기 상하한·색상·중단 줄과의 순서).
- 절이 생겨서 기대값이 늘어난 기존 단언 4건을 갱신했다. 판정 로직은 손대지 않았다.
  - `실패 케이스의 진단과 힌트를 그린다`: 절 두 줄 추가.
  - `케이스 레벨 진단을 단언 이름 없이 그린다`: 절 두 줄 추가(`⧖ slow-call → 타임아웃 진단`).
  - `다섯 상태 기호를 각각 쓴다`: `✗`·`⧖` 는 2회, 나머지 셋은 1회로 나눴다.
  - `화살표가 둘 이상이면 그대로 둔다`: 세는 대상을 케이스 블록 줄로 좁혔다(`INDENT_FOR_TEST`).

## 실행한 검증 명령과 출력

### 표적

```
pnpm --filter @mcpeak/runner exec vitest run --root ../.. packages/runner/tests/reporter.test.ts
```

```
 Test Files  1 passed (1)
      Tests  76 passed (76)
```

변경 전 이 파일은 62건이었다. 14건이 늘어 76건이고, 필터가 걸려 파일 하나만 돌았다.

### 패키지

```
pnpm --filter @mcpeak/runner exec vitest run --root ../.. packages/runner
```

```
 Test Files  27 passed (27)
      Tests  746 passed (746)
```

`junit.test.ts`(C10)와 `report-payload-notice.test.ts`(§6.1)는 **수정 없이** 통과했다.

### 전체

```
pnpm build --force
 Tasks:    7 successful, 7 total
Cached:    0 cached, 7 total

pnpm test
 Test Files  149 passed (149)
      Tests  3126 passed | 2 skipped (3128)

pnpm typecheck --force
 Tasks:    7 successful, 7 total
Cached:    0 cached, 7 total

pnpm lint
Checked 396 files in 96ms. No fixes applied.
```

`build` 와 `typecheck` 모두 `Cached: 0 cached` 를 확인했다. `packages/cli` 테스트는
`dry-run.test.ts`·`repair-bundle-write.test.ts` 포함 **수정 없이** 통과했다(C11). 설계 문서
§6.2 의 주장이 실제로 성립한다.

## 완료 조건 대응

| # | 근거 |
|---|---|
| C1 | `전부 통과한 보고서를 그린다` 와 거절 고지 describe 의 exact 단언이 수정 없이 통과. 새 테스트 `실패도 타임아웃도 없으면 절을 내지 않는다` |
| C2 | `요약 줄 바로 앞에 절을 낸다`, `중단 줄이 있으면 절은 중단 줄 뒤, 요약 줄 앞이다` |
| C3 | `절의 행 수가 failed 와 timedOut 의 합이다` |
| C4 | `취소와 미실행은 절에 넣지 않는다` |
| C5 | `위반이 있으면…`, `위반이 없고 notes 가…`, `위반도 notes 도 없으면…`, `케이스 레벨 진단이 단언 진단보다 앞선다` |
| C6 | `절의 id 와 글도 제어 문자를 이스케이프한다` |
| C7 | `서버 줄이 이미 → 로 시작하면 절에서도 겹치지 않는다` |
| C8 | `절은 기호에만 색을 넣는다` |
| C9 | `test-command.ts` 의 `--json` 분기가 `renderReport` 를 부르지 않음을 읽어서 확인. `packages/cli` 전량 통과 |
| C10 | `junit.test.ts` 수정 없이 통과 |
| C11 | `dry-run.test.ts`·`repair-bundle-write.test.ts` 수정 없이 통과 |
| C12 | 위 전체 판정 출력 |
| C13 · C14 · C15 | T1 범위 밖이다. 각각 W2 와 T2 에서 판정한다 |

## 계획서에서 벗어난 부분

두 곳이고 둘 다 기계적인 것이다.

1. 계획서 Step 9 의 `failing("schema", diagnostic(...))` 호출은 인자를 한 줄에 붙여 적었는데,
   biome 포매터가 여러 줄로 편다. 포매터가 내는 형태로 적었다. 단언 내용은 그대로다.
2. 계획서 Step 10 의 `취소와 미실행은 절에 넣지 않는다` 는 `renderReport(report)` 를 두 번
   부르며 인덱스를 잡는다. 같은 값을 한 번만 부르도록 `lines` 변수로 묶었다. 순수 함수라 결과는
   같고, 두 번 부르는 코드는 읽는 사람이 두 값이 다를 수 있다고 의심하게 한다.

## 남은 위험

- **실서버 확인이 아직 없다.** 유닛테스트는 인메모리와 픽스처만 본다. 설계 문서 §7 의
  `mcp-server-git` 교정 전 실행(C15)과 `examples/weather-server` E2E(C13)는 직렬 웨이브 몫이다.
  지시대로 여기서 돌리지 않았다.
- **자르기 상한 100 은 실측 한 건에 맞춘 값이다.** 리허설의 가장 긴 실패 첫 줄(약 95자)이
  기준이라, 경로가 더 깊은 사용자 환경에서는 잘린 행이 나온다. 원본은 같은 화면 위 케이스
  블록에 온전히 있으므로 정보 손실은 아니지만, 실서버 확인에서 잘림이 잦으면 값을 다시 볼 여지가
  있다.
- **`width` 는 코드 포인트 수이지 표시 폭이 아니다.** 절의 id 열도 기존 케이스 줄과 같은 한계를
  그대로 받는다. 한글 id 가 섞이면 열이 눈에 어긋난다. 새로 생긴 문제가 아니라 기존 규칙을
  따른 결과다.
- 커밋하지 않았다. 문서·ADR·changeset(T2)도 손대지 않았다.

---

# Task T2 보고: 설계 문서 · ADR · changeset

- 기점: `00da84b` (T1 통합 SHA `9b8aac7` 포함)
- 계획서: 같은 계획서 Task T2 (Step 1~8)
- 상태: READY_FOR_REVIEW

## 변경 파일

`packages/` 아래는 하나도 없다.

```
 M docs/adr/README.md
 M docs/superpowers/specs/2026-08-13-cli-report-rendering-design.md
?? .changeset/runner-failed-case-recap.md
?? docs/adr/0092-실패-요약-절은-요약-줄-앞에-두고-가장-구체적인-진단-줄을-옮긴다.md
```

이 보고서 파일(`docs/reports/task-failed-case-recap.md`)도 함께 고쳤다.

### `docs/superpowers/specs/2026-08-13-cli-report-rendering-design.md`

- §5.1 전체 구조 그림에 `{실패 요약 절}` 줄을 중단 줄과 요약 줄 사이에 넣었다.
- §5.7 을 **실패 요약 절**로 신설했다. 기존 §5.7 색상은 §5.8 로 밀었다.
- §5.8 색상 표에 절의 `✗`·`⧖` 가 케이스 줄과 같은 SGR 을 쓰고 머리글·`caseId`·`→`·진단 글에는
  색이 없다는 행 두 개를 더했다. 새 SGR 코드를 만들지 않는 이유(`dashboard` 의 `ansiToHtml`)를
  본문에 한 문장으로 적었다.

새 §5.7 이 담은 것은 행의 형태, 실리는 상태 표 다섯 줄과 그 이유, 진단 글 선택 규칙 3순위,
`MAX_RECAP_TEXT_CHARS` 100 과 근거, `caseId` 열을 절 안에서만 맞춘다는 것, 0건이면 한 줄도 내지
않는다는 것, 순서와 이스케이프·자르기·색상의 적용 순서다.

출력 예시는 계획서를 베끼지 않고 머지된 실제 출력을 실었다. 근거는
`packages/runner/tests/reporter.test.ts` 의 `describe("실패한 케이스 절")` 안
`요약 줄 바로 앞에 절을 낸다` 테스트의 exact 단언이며, 그 테스트가 통과하므로 문서에 적은
문자열이 곧 렌더러가 내는 문자열이다.

### `docs/adr/0092-…md` (신규)

다섯 항목(배경 / 선택지 / 결정 / 이유 / 결과)이다. 선택지 절에 절 위치 A·B·C 표와 행 문안
R1·R2 표를 실었다. 머리말 형식은 `docs/adr/0091-…md` 를 따랐다.

### `docs/adr/README.md`

색인에 0092 줄을 0091 다음에 같은 형식으로 더했다.

### `.changeset/runner-failed-case-recap.md` (신규)

`@mcpeak/runner` `minor` 다. 본문은 계획서 Step 5 의 문안 그대로다.

## 실행한 검증 명령과 출력

```
git status --short
 M docs/adr/README.md
 M docs/superpowers/specs/2026-08-13-cli-report-rendering-design.md
?? .changeset/runner-failed-case-recap.md
?? docs/adr/0092-….md
```

`packages/` 아래가 하나도 없다.

```
pnpm test
 Test Files  149 passed (149)
      Tests  3126 passed | 2 skipped (3128)

pnpm lint
Checked 396 files in 84ms. No fixes applied.
```

절 번호 확인. `grep -n "^### 5\." docs/superpowers/specs/2026-08-13-cli-report-rendering-design.md`

```
165:### 5.1 전체 구조
185:### 5.2 케이스 줄
210:### 5.3 케이스 레벨 진단
221:### 5.4 단언 줄
244:### 5.5 중단 줄
256:### 5.6 요약 줄
277:### 5.7 실패 요약 절
368:### 5.8 색상
```

## 계획서에서 벗어난 부분

**changeset 을 `pnpm changeset` 대화형으로 만들지 않고 파일로 직접 썼다.** `changeset add` 는
패키지와 bump 를 비대화형 인자로 받지 않아 이 환경에서 돌릴 수 없다. 결과 파일의 형식은 같고,
`pnpm changeset status` 가 `@mcpeak/runner` 를 minor 목록에 넣어 파싱을 확인했다.

## 남은 위험

- **`pnpm changeset status --since=origin/main` 은 지금 로컬에서 떨어진다.** 새 changeset 이
  untracked 라 `--since` 의 git 비교에 잡히지 않기 때문이다. 커밋하면 해소된다. 커밋은 사람
  몫이므로 여기서 하지 않았다. 통합 전에 이 명령을 다시 확인하는 쪽이 안전하다.
- **허용 Files 밖에 어긋난 참조가 하나 있다.** 고치지 않았다.
  `docs/superpowers/specs/2026-09-10-failed-case-recap-design.md:274` 의 `### 4.6 색상 (렌더링
  설계 §5.7 확장)` 은 이제 §5.8 을 가리켜야 한다. 같은 문서 107줄의 완료 조건 C14 도 "새 §5.7"
  이라고 적혀 있는데 그것은 이번에 신설한 §5.7 이 맞아 어긋나지 않는다.
- `packages/` 아래 `§5.7` 참조는 전부 다른 설계 문서(`2026-08-14-input-contract-check-design.md`)
  를 가리킨다. `packages/runner/src/assertion-substance.ts:26` 이 그것이다. 이번 절 번호 이동과
  무관하므로 고칠 것이 없다.
- ADR 의 상태는 `제안` 이다. 승인 절차는 사람 몫이다.
- 커밋하지 않았다.
