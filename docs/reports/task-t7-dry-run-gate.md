# T7 보고서: `test` 참고 문장 (`cli`)

계획서: `docs/superpowers/plans/2026-08-15-dry-run-approval-gate-implementation.md` §4 T7
설계 근거: `docs/superpowers/specs/2026-08-15-dry-run-approval-gate-design.md` §9
커밋 메시지: `feat(cli): test 보고서에 승인 시점 서버 결함 표시를 반영한다`

## 바꾼 파일

| 파일 | 내용 |
|---|---|
| `packages/cli/src/spec-approval.ts` | `caseApprovalStatuses`, `caseApprovalStatus`, `SERVER_DEFECT_NOTE_LINE` 추가 |
| `packages/cli/src/test-command.ts` | 참고 줄 출력, `--json` 의 `spec.cases` 키 |
| `packages/cli/tests/spec-approval.test.ts` | `spec-approval / 케이스 판정` describe 추가 (3 케이스) |
| `packages/cli/tests/test-command.test.ts` | `test 보고서 / 승인 시점 서버 결함 표시` describe 추가 (9 케이스) |

## 사양 대응

| 계획서 §4 T7 | 구현 |
|---|---|
| `serverDefect` 실패에 참고 줄 | `serverDefectCases` 집합에 들어간 케이스에만 출력 |
| 종료 코드 불변 | 판정 계산에 손대지 않았다. 기존 `allPassed ? 0 : 1` 그대로 |
| `passed` 케이스 실패는 침묵 | 집합 조건이 `=== "serverDefect"` 다 |
| `serverDefect` 통과는 침묵 | 집합 조건에 `status !== "passed"` 가 있다 |
| 지문 불일치면 안 찍는다 | `specApproval.state !== "matched"` 면 빈 집합 |
| `approval.cases` 없으면 아무것도 안 한다 | 조회표가 비면 빈 집합 |
| `--json` 에 `spec.cases` | `approval.cases` 를 그대로 싣는다. 지문 불일치에도 억제하지 않는다 |

문장은 계획서에 적힌 그대로다.

```
    참고: 승인 시점에 서버 결함으로 표시된 케이스입니다. 서버가 아직 고쳐지지 않았습니다.
```

## 검증

```
$ pnpm test
 Test Files  49 passed (49)
      Tests  1063 passed | 1 skipped (1064)
```

```
$ pnpm typecheck --force
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
```

```
$ pnpm lint
Checked 149 files in 32ms. No fixes applied.
```

## 임의로 판단한 지점

1. **참고 줄의 위치.** 설계서 §9 의 예시는 이 줄을 보고서의 케이스 블록 **안**, 실패 문장
   바로 아래에 놓는다. 그 자리는 `packages/runner/src/reporter.ts` 가 만드는 문자열의
   내부이고, `renderReport` 는 CLI 에 통짜 문자열 하나를 돌려준다. reporter 는 T7 의 허용
   Files 밖이라 손대지 않았다.

   대신 보고서 뒤, 기존 `참고:` 블록 루프 안에서 **해당 케이스의 블록 끝에** 붙였다. 순회
   순서를 `specFindings` 기준에서 `finalReport.cases` 기준으로 바꿔, finding 이 없고 승인
   판정만 있는 케이스도 빠지지 않게 했다. 기존 출력 순서는 그대로다(두 순서 모두 보고서의
   케이스 순서에서 나온다). 들여쓰기는 설계서대로 4칸을 유지했다.

   **설계서대로 케이스 블록 안에 넣으려면 `runner` 의 reporter 변경이 필요하다.** 판단이
   필요하면 알려 달라.

2. **문장에 케이스 id 가 없다.** 계획서가 문장을 값으로 못 박았으므로 그대로 썼다. 그 결과
   서버 결함 케이스가 둘 이상 동시에 실패하면 같은 줄이 여러 번 찍히고, finding 블록이 없는
   케이스에서는 어느 케이스의 줄인지 문장만으로는 알 수 없다. 1번의 reporter 변경이 이것도
   같이 해소한다.

3. **`spec.cases` 는 `approval.cases` 가 있을 때만 키를 만든다.** `approvedFingerprint` 와
   같은 규칙이다. "억제하지 않는다" 는 지문 불일치에도 싣는다는 뜻으로 읽었고, 그쪽은
   테스트로 고정했다(`지문이 불일치여도 --json 의 spec.cases 는 그대로다`). `findings` 처럼
   항상 빈 배열을 넣는 방식도 가능한데, 그러면 기존 `--json` 소비자가 보는 키가 하나 늘고
   기존 테스트의 정확 비교가 깨진다.

4. **조회를 Map 으로 한 번만 만든다.** `caseApprovalStatus(suite, id)` 는 계획서의 테스트
   이름에 맞춘 단건 조회이고, `test-command` 는 `caseApprovalStatuses(suite)` 로 표를 한 번
   만들어 쓴다. 케이스마다 배열을 훑으면 O(n²) 다.

## 남은 위험

- 위 1번과 2번. 화면상 참고 줄이 어느 케이스의 것인지는 앞선 `참고:` 블록이 있을 때만
  분명하다. 이 프로젝트에서 실패 메시지는 제품이므로 후속에서 reporter 쪽 배치를 다시
  볼 가치가 있다.
- `--json` 의 `spec.cases` 는 파일 내용을 그대로 싣는다. 실행 결과와의 대조는 소비자 몫이다.
