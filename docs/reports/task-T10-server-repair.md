# T10 화면 문안 보고서

status: READY_FOR_REVIEW

## 요약

`repair-render.ts` 에 확인 화면·결과 화면·`unsure`·지문 블록·오류 문안을 만들고
`repair-command.ts` 에 배선했다. `packages/cli` 전체가 초록이다.

1차 보고는 BLOCKED 였다. T9 이 남긴 임시 동작(`번들을 읽고 한 줄 찍고 0`)을 고정한 테스트가
이 태스크의 대체 배선과 충돌했다. 오케스트레이터가 그 파일을 Files 에 추가했고, **그 테스트
하나만** 진단 통로 미주입 경로를 보는 쪽으로 바꿨다. 파싱 테스트 8개는 안 건드렸다.

정상 경로가 0 을 낸다는 보장은 `repair-render.test.ts` 의
`종료 코드가 diagnosis·unsure 모두 0 이다` 가 갖는다. 진단 통로를 주입하고 `--yes` 로 돌려
`diagnosis` 와 `unsure` 양쪽에서 0 을 단언한다. 그 사실을 바꾼 테스트 위 주석에도 적었다.

## 바꾼 파일

- 생성: `packages/cli/src/repair-render.ts`
- 수정: `packages/cli/src/repair-command.ts` (배선. 파싱 로직 변경 0건)
- 생성: `packages/cli/tests/repair-render.test.ts`
- 수정: `packages/cli/tests/repair-command-parse.test.ts` (T9 임시 동작을 고정한 테스트 하나만.
  파싱 테스트 8개 변경 0건)
- 생성: `docs/reports/task-T10-server-repair.md` (이 파일)

목록 밖 파일 수정 0건. 다른 패키지 수정 0건. 의존성 추가 0건. git 명령 0건.
실제 `codex`·`claude` 프로세스 호출 0건(provider 는 전부 가짜다).

## 검증

`pnpm vitest run packages/cli/tests/repair-render.test.ts`

```
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

`pnpm vitest run packages/cli`

```
 Test Files  19 passed (19)
      Tests  518 passed (518)
```

T9 직후의 503 에서 15 가 늘었다. 기존 503 은 위의 임시 동작 테스트 하나만 내용이 바뀌었고
개수는 그대로다.

`pnpm typecheck --force`

```
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
```

`pnpm lint`

```
Checked 181 files in 42ms. No fixes applied.
```

## 문안 규칙을 어떻게 지켰는지

- 라벨은 `원인 후보`·`확인할 곳`·`근거`·`분류` 다. "원인" 이라고 단정하지 않는다.
- 경계 문장 두 줄(`REPAIR_BOUNDARY_LINES`)은 **모든 경로**의 마지막에 붙는다. `diagnosis`,
  `unsure`, 지문 불일치 셋을 테스트가 한 번에 확인한다. 억제 조건은 코드에 없다.
- `location`·`evidence` 가 빈 문자열이면 그 줄만 뺀다. 빈 라벨을 찍지 않는다.
- 케이스 순서는 **번들 순서**다. 응답을 역순으로 줘도 화면이 안 바뀐다는 테스트가 있다.
- AI 출력은 `escapeTerminalText` 사본으로 이스케이프한다. 패키지 경계를 넘지 않았다. 사본을 둔
  근거(ADR-0013)와 TAB 을 이스케이프하는 판단을 모듈 주석에 적었다.
- `discarded > 0` 이면 지정된 한 줄을 찍는다.
- 제외된 실패가 0건이면 확인 화면의 괄호를 안 찍는다. `--no-stderr` 면 stderr 줄이
  `(전송하지 않음)` 이다.
- 비대화형이고 `--yes` 가 없으면 **보내지 않는다.** 확인 화면을 stdout 에 찍어 무엇을 보내려
  했는지 보여주고, stderr 로 `--yes` 를 안내한 뒤 1 을 낸다. `dispatch` 호출 0회를 단언한다.
- `n` 이면 `dispatch`·`diagnose` 둘 다 0회이고 종료 코드 0 이다(완료 조건 5).
- 지문이 `matched` 가 아닐 때만 `target: "spec"` 항목에 `분류  명세 쪽 원인으로 봄` 이 붙는다.

## 임의로 판단한 지점

- **`shortfall` 을 화면에서 자른다(`SHORTFALL_DISPLAY_CHARS = 500`).** T3 에서 검증은 안 자르기로
  했고, 화면 쪽 판단을 나에게 맡겼다. 자르는 쪽으로 갔다. 근거는 경계 문장이다. provider 가
  장문 `shortfall` 을 보내면 그 한 항목이 터미널 한 화면을 밀어내고, **화면 맨 아래의 경계 두
  줄이 스크롤 밖으로 나간다.** 그 두 줄은 사용자가 명세 쪽으로 빠질 유일한 출구라 사라지면 안
  된다. 값 자체는 안 바꾸고 표시 단계에서만 자르며, 잘렸다는 것을 `…` 로 알린다. 상한은
  `MAX_CAUSE_CHARS` 와 같은 500 이다. 다르게 두면 항목마다 길이가 들쭉날쭉해진다.
- **`REPAIR_BUNDLE_EMPTY_LINE` 은 `repair-bundle.ts` 에 그대로 뒀다.** T7 에서 정한 문장을
  다시 읽고 바꿀 이유를 못 찾았다. 두 곳에 두면 갈라지므로 `repair-render.ts` 로 옮기지 않았다.
- **T9 의 임시 오류 문안 둘(`REPAIR_BUNDLE_READ_FAILED`·`REPAIR_BUNDLE_INVALID`)은 그대로
  뒀다.** 둘 다 무엇이 왜 다른지와 다음에 할 일을 이미 담고 있다. 새 문안 셋
  (`REPAIR_PROVIDER_FAILED`·`REPAIR_RESULT_INVALID`·`REPAIR_APPROVAL_INVALIDATED`)은
  `repair-render.ts` 에 뒀고, 전부 `파일은 하나도 바뀌지 않았습니다` 로 끝난다. 진단이 실패했을
  때 사용자가 가장 먼저 걱정하는 것이 그것이다.
- **확인 화면의 `stderr` 줄에 `없음` 을 추가했다.** 계획서 예시에는 stderr 가 있는 경우만
  있는데, 번들에 `process` 키가 없는 실행이 흔하다. 빈 줄을 두면 값이 잘린 것처럼 보인다.
- **`ReviewIO` 를 `RepairCommandDependencies.reviewIO` 로 받는다.** `generate` 가 쓰는 그
  인터페이스를 그대로 쓴다. 없으면 비대화형으로 본다.
- **`prepareDiagnosisRequest` 에 `tools: []` 를 넘긴다.** 번들에는 도구 선언이 없고 `repair` 는
  서버를 띄우지 않는다. 목록을 지어낼 자리가 없다.
- **테스트를 15개 썼다.** 계획서 14개에 `분류` 라벨이 지문 불일치에서만 붙는지 보는 것을
  더했다. 그 라벨이 `matched` 에서 새면 승인된 명세를 고치라는 말이 화면에 오른다.

## 남은 위험

- **`index.ts` 가 `reviewIO` 를 안 넘긴다.** T9 에서 그 파일을 배선할 때 `ReviewIO` 가 아직
  없었다. 지금 실제 CLI 로 `repair` 를 부르면 항상 비대화형으로 보여 `--yes` 를 요구한다.
  한 줄(`reviewIO: nodeReviewIO()`)이면 되지만 `index.ts` 는 이 태스크의 Files 목록 밖이다.
  T11 이 `repair --yes` 로 도는 E2E 라 막히지는 않지만, 확인 화면이 실사용에서 안 뜬다.
  다음 태스크의 Files 에 넣어 달라.
