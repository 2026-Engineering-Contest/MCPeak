# Task T4 보고서: 분류 화면 (`cli`)

## 무엇을 했나

시험 실행에서 실패한 케이스를 사람이 분류하는 화면과 저장 게이트 판정을 만들었다. 계획서
§4 T4 와 설계서 §8.3 을 따랐다.

- `packages/cli/src/dry-run-review.ts` 신규. `CaseClassification`·`DryRunReviewResult`·
  `reviewDryRun`
- `packages/cli/tests/dry-run-review.test.ts` 신규. 14개

`ReviewIO` 는 `generate-command.ts` 의 것을 import 한다. `SuiteCaseApproval` 은 `runner` 의
것을 import 한다(아래 "정정" 참고).

## 화면

설계서 §8.3 의 블록을 문자 단위로 고정한 테스트를 하나 두었다(`선택지 문안이 설계 문서 §8.3 과
같다`). 출력 전문을 통째로 비교하므로 누가 공백 하나를 바꾸면 깨진다.

```
  [1] add_todo/필수 필드 'title' 누락 거절
      → isError true 를 기대했지만 정상 응답을 받았습니다.

      [s] 서버 결함  명세가 옳다. 이 케이스를 회귀 테스트로 남긴다
      [m] 명세 오류  추측이 틀렸다. 저장 전에 고친다
      [?] 판단 보류  분류를 미룬다. 저장은 막힌다
      선택: 
```

실패 사유 줄은 T3 의 `detail`(즉 `renderReport` 의 블록)에 두 칸을 덧붙여 찍는다. 문장은
건드리지 않는다. 분류가 끝나면 `  분류: 서버 결함 2건, 명세 오류 1건` 을 찍고 0건인 종류는 뺀다.

`s`·`m`·`?` 밖의 입력은 같은 프롬프트를 다시 묻는다. 기본값으로 넘기지 않는다.

## 반환 규칙

계획서 표 그대로다. `cleared` 가 false 면 `approvals` 를 비운다.

| 상황 | `cleared` | `approvals` | `specErrors` |
|---|---|---|---|
| 실패 0건 | true | 전량 `passed` | `[]` |
| 전부 `s` | true | 통과는 `passed`, 실패는 `serverDefect` | `[]` |
| `m` 이 하나라도 | false | `[]` | `m` 을 고른 caseId |
| `?` 가 하나라도 | false | `[]` | `[]` |
| `aborted` | false | `[]` | `[]` (아무것도 묻지 않는다) |

## 정정: 로컬 타입을 `runner` 의 것으로 바꿨다

착수 시점의 기점(`5031794`)에는 T1 이 없어서 `SuiteCaseApproval` 을 이 파일에 같은 모양으로
정의해 뒀다. 작업 중 T1 이 `main` 에 머지돼(`fce46b1`) 오케스트레이터의 지시로 `git merge main`
을 한 뒤 로컬 정의를 지우고 `import type { SuiteCaseApproval } from "@ohmymcp/runner";` 로
바꿨다. 지금 이 브랜치에는 정의가 한 벌만 있다. 병합은 fast-forward 였고 충돌은 없었다.

## 검증

```
$ pnpm test
 Test Files  53 passed (53)
      Tests  1107 passed | 1 skipped (1108)

$ pnpm typecheck --force
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total

$ pnpm lint
Checked 157 files in 33ms. No fixes applied.
```

## 임의로 판단한 지점

1. **"실패" 를 `status !== "passed"` 로 정의했다.** 계획서는 통과와 실패 둘만 말하는데 상태는
   다섯 가지다(`failed`·`timedOut`·`cancelled`·`notRun`). `passed` 가 아닌 것을 통과로 기록하면
   승인 파일이 거짓말을 하므로 전부 분류 대상으로 돌렸다. 사용자가 `?` 를 고르면 저장이 막히고,
   이것이 미확인 케이스에 대한 옳은 기본 동작이다.
2. **요약 줄에 `판단 보류 N건` 을 넣었다.** 계획서 예시는 서버 결함·명세 오류 둘만 보여준다.
   보류가 있는데 요약에서 빠지면 저장이 막힌 이유가 화면에서 사라진다. 0건이면 안 나오므로
   계획서 예시와 같은 출력이 그대로 나온다.
3. **`m` 과 `?` 가 섞이면 `specErrors` 에 `m` 만 담는다.** 계획서 표의 두 줄이 겹치는 경우다.
   표의 행 순서를 따랐고, 사용자가 다음에 할 일(고칠 케이스 목록)이 그것이다.
4. **되물을 때 선택지 블록을 다시 찍지 않는다.** `선택: ` 프롬프트만 다시 묻는다. 전체를 다시
   찍으면 오타 한 번에 화면이 두 배가 된다.
5. 저장 불가 안내(설계서 §8.3 의 `명세 오류 1건이 있어 저장할 수 없습니다` 이하)는 이 모듈이
   찍지 않는다. 마지막 줄이 카세트 유무에 따라 갈리는데 이 모듈은 카세트를 모른다. 계획서
   §4 T6 의 10번 단계가 소유한다.

## 남은 위험

- **`notRun` 케이스를 분류하라고 묻는다.** 타임아웃으로 실행이 멈춘 뒤의 남은 케이스가 그렇다.
  `detail` 이 비어 있어 사용자는 이름만 보고 판단해야 하고, `서버 결함` 이라는 선택지 문안이
  그 상황에 맞지 않는다. 실행되지 않은 케이스를 별도로 다루려면 설계서 §8 에 화면이 하나 더
  필요하다. 후속 후보로 남긴다.
- 되묻기에 상한이 없다. 비대화형 입력이 잘못 물리면 무한 루프가 된다. 다만 `ReviewIO` 는 입력
  스트림이 닫히면 `ReviewInputClosedError` 를 던지므로 실제 EOF 에서는 빠져나온다.

## 커밋 메시지

```
feat(cli): 시험 실행 실패 케이스 분류 화면을 추가한다
```
