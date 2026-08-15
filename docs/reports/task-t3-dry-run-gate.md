# Task T3 보고서: 시험 실행 (`cli`)

## 무엇을 했나

후보 명세를 실제 서버에 한 번 돌리고 결과만 돌려주는 `runDryRun` 을 만들었다. 계획서 §4 T3 과
설계서 §3.2·§4.4·§4.5 를 따랐다.

- `packages/cli/src/dry-run.ts` 신규. `DryRunCaseOutcome`·`DryRunResult`·`RunDryRunOptions`·
  `runDryRun`. 시그니처는 계획서 그대로다
- `packages/cli/tests/dry-run.test.ts` 신규. 10개

화면에 아무것도 쓰지 않는다. `onEvent` 를 쓰지 않고 `report` 만 기다린다. 진단(stderr)도 읽지
않는다. 이 모듈이 아는 것은 `McpClient` 하나다.

## 실패 문장을 만들지 않았다

`detail` 은 `renderReport` 가 만든 그 케이스의 블록을 잘라 담는다. 잘라 내는 경계는 들여쓰기다.
`renderReport` 는 케이스 머리글만 기호로 시작하고 본문(진단 줄·단언 줄·`해결:` 줄)은 전부 4칸
들여쓴다. 메시지 안의 개행은 렌더러가 이미 이스케이프하므로 본문 줄이 임의로 늘어나지 않는다.

테스트는 같은 스위트를 `runSuite` 로 한 번 더 돌려 `renderReport` 출력에서 **케이스 id 로**
블록을 찾아 비교한다. 구현은 위치로 자르고 테스트는 id 로 찾으므로 두 경로가 같은 실수를 하기
어렵다.

## 판정 매핑

| 상황 | 결과 |
|---|---|
| 정상 종료 | `outcomes` 는 `report.cases` 순서 그대로, `aborted` 없음 |
| 케이스의 `OPERATION_FAILED` | `aborted.reason` 은 `connectionLost`, `detail` 은 runner 의 진단 메시지 그대로 |
| `RunnerPayloadLimitError` | `aborted.reason` 은 `payloadLimit`, `detail` 은 1MB 문장 |
| 그 밖의 예외 | `connectionLost` + `MCP 서버 연결이 끊겼습니다.` |

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

1. **연결 끊김을 예외가 아니라 보고서에서 읽는다.** 계획서는 "`client.callTool` 이 던지면
   `aborted.reason` 이 `connectionLost`" 라고 적었는데, `runSuite` 는 호출이 던져도 예외를
   올리지 않는다. 그 케이스를 `operation.status: "failed"` 와 `OPERATION_FAILED` 진단으로
   바꿔 보고서에 담고 **다음 케이스로 계속 간다**(`executor.ts` 는 timeout·abort 에서만
   `break` 한다). 그래서 보고서에서 첫 `OPERATION_FAILED` 를 찾아 그 지점을 끊김으로 판정했다.
   설계서 §4.1 이 "`runSuite` 가 `OPERATION_FAILED` 를 내고 `aborted.reason` 이
   `connectionLost` 가 된다" 고 적은 것과 같은 뜻으로 읽었다.
2. **끊긴 케이스까지를 `outcomes` 에 남겼다.** 계획서는 "그때까지 끝난 케이스" 라고만 적었다.
   끊긴 케이스를 포함하면 `outcomes.length` 가 곧 설계서 §8.4 의 `12/24` 에서 12 가 되어 T6 이
   더 셀 것이 없다. 제외하면 T6 이 `+1` 을 해야 하고 그 `+1` 의 근거가 코드 어디에도 없다.
   그 뒤 케이스는 버린다. 서버가 죽은 뒤의 같은 오류는 사실이 아니라 결과이기 때문이다.
3. **`detail` 에 케이스 머리글 줄을 넣지 않았다.** 호출 측(T4·T6)이 `[1] <caseName>` 으로
   머리글을 다시 그리므로 넣으면 같은 이름이 두 줄 나온다.
4. `payloadLimit` 은 `scope` 가 `case` 든 `report` 든 같은 문장을 쓴다. 계획서가 문장 하나만
   고정했고, 사용자가 취할 조치(케이스 수를 줄인다)도 하나다.

## 남은 위험

- **서버가 죽어도 남은 케이스를 계속 때린다.** `runSuite` 가 멈추지 않기 때문이다. 24개 중
  12번째에서 죽으면 남은 12번의 호출이 죽은 연결로 나간 뒤에야 결과를 자른다. 멈추려면
  `onEvent` + `AbortSignal` 이 필요한데 계획서가 `onEvent` 를 쓰지 말라고 못 박았다. 실제
  비용은 즉시 실패라 시간은 짧지만, 실서버 E2E(설계서 §13.7)에서 확인할 항목이다.
- **블록 자르기가 `renderReport` 의 들여쓰기 규칙에 묶여 있다.** 렌더러가 본문 들여쓰기를 바꾸면
  이 모듈이 조용히 빈 `detail` 을 내놓는다. 테스트가 `expected` 가 빈 문자열이 아님을 함께
  단언해 그 경우를 잡는다.
- 타임아웃으로 멈춘 실행은 `aborted` 가 아니다. 남은 케이스가 `notRun` 으로 들어오고, 그 처리는
  T4 의 분류 화면이 받는다(T4 보고서의 위험 항목 참고).

## 커밋 메시지

```
feat(cli): 후보 명세를 실제 서버에 돌리는 시험 실행을 추가한다
```
