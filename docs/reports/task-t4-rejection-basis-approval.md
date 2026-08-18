# Task T4 — 승인 화면의 미확인 목록 (`cli`)

작성일: 2026-08-18. 이슈 #89. 참조: 설계 문서 §5.2, 계획서 Task T4. 선행: T2·T3 + 본문 배선(`e723423`).

## 무엇을 만들었나

`generate` 승인 화면의 시험 실행 결과 블록 아래에 거절 근거 미확인 목록을 붙였다.

| 파일 | 상태 |
|---|---|
| `packages/cli/src/generate-command.ts` | 수정 — `writeRejectionUnverified` 추가, 결과 블록 뒤에 배선 |
| `packages/cli/src/dry-run.ts` | 수정 — `DryRunCaseOutcome` 에 두 값 전달 (**계획서 Files 목록 밖**) |
| `packages/cli/tests/generate-command.test.ts` | 수정 — 신규 5건 |
| `packages/cli/tests/dry-run-review.test.ts` · `pre-fill-wiring.test.ts` | 리터럴 한 줄씩 (**목록 밖**) |
| `.changeset/cli-rejection-unverified-list.md` | 생성 |

## 실제 화면

테스트 하네스에서 실제 출력을 떠서 확인했다.

```
  ✓ 통과 3건

거절 근거 미확인 2건
  → weather-missing-city   응답: → 'city' 는 문자열이어야 합니다. 예: { "city": "서울" }
  → weather-type-city      응답: → 'city' 는 문자열이어야 합니다. 예: { "city": "서울" }
  이 응답이 서버의 정상 거절인지 내부 오류인지 확인하지 못했습니다.
```

설계 문서 §5.2 의 모양 그대로다. id 열이 맞고(20자·17자를 같은 열로), 결과 블록 바로 아래에
붙는다. **케이스는 `✓ 통과 3건` 이고 분류를 묻지 않고 저장으로 넘어간다** — 목록이 판정을 바꾸지
않는다는 것을 테스트가 함께 단언한다.

## 임의로 판단한 것

### 1. 본문이 없는 케이스는 `(본문 없음)` 으로 적는다

**설계 문서에 없다.** §5.2 의 예시는 본문이 있는 두 건뿐이다.

호출이 오류로 끝난 케이스는 읽을 응답이 아예 없다(설계 §4.2, 관찰의 `server-github` 12건이 그
경우다). 그 자리를 빈칸으로 두면 사용자가 "응답이 빈 문자열이었다" 로 읽는다. **무엇을 못
봤는지가 그 사람의 판단 재료**라서 적어 뒀다. 괄호로 감싸 우리가 쓴 말임을 표시했다.

### 2. 블록 끝에 빈 줄을 하나 넣는다

없으면 마지막 안내 문장에 다음 질문(`최종 JSON을 저장할까요?`)이 곧바로 붙어 그 질문의 일부처럼
읽힌다. 같은 함수 이웃인 `writeDryRunResult` 가 같은 이유로 실패 목록 뒤에 빈 줄을 넣는다.

### 3. id 열 너비는 `최대폭 + 3` 이다

§5.2 예시의 두 줄에서 역산한 값이다(18자 + 3, 14자 + 7 → 둘 다 21열). 예시가 두 줄뿐이라
"고정 21열" 과 구분되지 않지만, 고정값은 긴 id 에서 깨지므로 최대폭 기준으로 갔다.

### 4. 자르기 규칙을 새로 만들지 않았다

계획서가 "기존 `escapeTerminalText` 와 진단 렌더러 규칙을 재사용해라. 새 규칙을 만들면 화면마다
다르게 잘린다" 고 했다. `escapeTerminalText`(`repair-render.ts`)가 개행(0x0a)까지 이스케이프하
므로 **여러 줄 응답이 한 줄이 되는 것과 제어 문자 무해화가 한 번에 해결된다.** 길이 자르기는
`runner` 가 `clampObservedText` 로 이미 했다. `cli` 에서 다시 자르지 않는다.

## 계획서 Files 목록 밖으로 나간 것

T2 때와 같은 종류다. T4 의 허용 Files 는 `generate-command.ts` 와 그 테스트 둘뿐인데, 화면이 쓸
값이 `DryRunCaseOutcome` 에 없어서 `dry-run.ts` 를 먼저 배선해야 했다. 필드를 필수로 두면
그 타입을 손으로 짓는 테스트 둘도 함께 바뀐다.

전부 `cli` 안이고 같은 PR 이다. 다른 오너의 패키지는 안 건드렸다.

## 검증

| 명령 | 결과 |
|---|---|
| `vitest run packages/cli/tests/generate-command.test.ts` | 194건 통과 (신규 5 포함) |
| `pnpm test` | 1798건 통과 · 3 skipped (기점 1793 + 신규 5) |
| `turbo run typecheck --force` | 6/6 통과, `Cached: 0 cached` |
| `biome ci .` | 200 파일 통과 |

**기존 케이스 판정이 하나도 안 바뀌었다.** 신규 테스트가 저장된 `approval.cases` 전량이
`passed` 인 것과 분류 질문(`io.input`)이 한 번도 안 불린 것을 함께 단언한다.

## T6 이 알아야 할 것

- 이 블록 **아래에** 메뉴 항목을 붙인다(계획서 T4 산출 항목).
- 목록에 올릴 케이스는 `outcome.rejectionBasis === "unverified"` 다. `dry-run.ts` 가 이미
  옮겨 놨다.
- **`rejectionBody` 는 없을 수 있다.** T5 의 `RejectionDiagnosisRequest.responseBody` 는
  `string` 필수라, 본문 없는 케이스를 AI 에게 물을지 말지 T6 이 정해야 한다. 물을 수 없다면 그
  케이스는 진단 대상에서 빼고 화면에 그 사실을 남기는 편이 낫다.
- 본문은 `runner` 가 200자에서 자른 값이다. AI 판단이 부족해 보이면 그 상한을 다시 볼 자리다
  (`docs/reports/task-t4-prep-rejection-body.md`).
