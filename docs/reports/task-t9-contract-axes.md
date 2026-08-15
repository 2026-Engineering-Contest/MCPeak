# Task T9 보고서: `cli` 화면과 실서버 E2E

## 무엇을 했나

- `renderCoverage(coverage: CoverageResult): string` 과 `renderCaseCountNotice(caseCount: number): string`
  을 순수 함수로 만들었다. `io.write` 를 안에서 부르지 않는다. 테스트가 문자열을 그대로 비교한다
- 축 이름 표를 `Readonly<Record<ContractAxisKind, string>>` 으로 뒀다. `runner` 가 축을 늘리면
  여기서 타입 오류가 난다
- `CASE_COUNT_WARNING_THRESHOLD = 1500` 과 근거 주석
- 두 경로에 배선했다. `--baseline-only` 는 `baseline.coverage` 를 그대로 쓰고, 대화형은 저장
  직전에 `deps.computeCoverage?.({ suite: 최종 suite, tools })` 를 다시 부른다
- `packages/cli/src/index.ts` 에 `computeCoverage: generate.computeCoverage` 한 줄
- E2E 기대값을 8케이스로 갱신했다

exit code 는 어느 경로에서도 바뀌지 않았다. 반환값 계약도 그대로다.

## 화면 문안 전량

### 전부 검증된 경우 (§7.1)

```
커버리지  2 tools, 8 axes 전부 검증
```

### 미검증이 있는 경우 (§7.2)

```
커버리지  3 tools, 12/14 axes 검증
  add           5/5
  get_weather   3/3
  search_docs   4/6
    ? filters 의 타입 위반 거절            미검증
    ? filters 의 선언되지 않은 값 거절     미검증
```

### 해석 불가가 있는 경우 (§7.3)

```
커버리지  3 tools, 8/8 axes 검증
  add           5/5
  get_weather   3/3
  search_docs   해석 불가
    → 입력 스키마를 해석하지 못해 이 툴의 축을 세지 못했습니다 (anyOf)
    → 이 툴은 커버리지 숫자에 들어가지 않습니다
```

### 해석 못 한 필드가 있는 경우 (§7.3 두 번째)

```
커버리지  1 tools, 4/5 axes 검증
  search_docs   4/5
    ? query 의 타입 위반 거절     미검증
    → 해석 못 한 필드 1개: filters. 이 필드의 축은 세지 않았습니다
```

### 축이 0개인 툴만 있는 경우 (0/0)

```
커버리지  1 tools, 0/0 axes 검증
  a   해석 불가
    → 입력 스키마를 해석하지 못해 이 툴의 축을 세지 못했습니다 (anyOf)
    → 이 툴은 커버리지 숫자에 들어가지 않습니다
```

"전부 검증" 이라고 쓰지 않는다. `verified === total` 이 참이지만 축을 하나도 세지 못한 것이지
전부 확인한 것이 아니다.

### 1MB 벽 고지 (§7.4)

```
→ 케이스 1842개를 만들었습니다. runner 보고서 상한(1MB)에 가까워 test 실행이
  RunnerPayloadLimitError 로 실패할 수 있습니다.
→ 툴을 나눠 여러 명세 파일로 생성하면 피할 수 있습니다.
```

### 축 이름 표

| 축 | 문장 |
|---|---|
| `HAPPY_PATH` | 선언을 지킨 입력에 정상 응답 |
| `REQUIRED_OMITTED` | 필수 필드 누락 거절 |
| `TYPE_VIOLATION` | 타입 위반 거절 |
| `ENUM_VIOLATION` | 선언되지 않은 값 거절 |

필드가 있는 축은 `${field} 의 ${문장}` 이고, 필드가 없는 축(`HAPPY_PATH`)은 문장만 적는다.

## 변경 파일

- Modify: `packages/cli/src/generate-command.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/tests/generate-command.test.ts`
- Modify: `packages/cli/tests/generate-integration.test.ts`
- Create: `docs/reports/task-t9-contract-axes.md`

`examples/**` 는 건드리지 않았다. 허용 목록 밖 파일도 건드리지 않았다. git 명령은 실행하지
않았다.

## 선행 실패 넷을 전부 해결했다

| 무엇 | 어떻게 |
|---|---|
| `generate-command.test.ts:81` 타입 오류 | 목의 `policyVersion` 을 `"schema-baseline-v2"` 로 바꾸고 `coverage: { tools: [], verified: 0, total: 0 }` 을 넣었다. 이 목의 suite 는 케이스가 0개라 커버리지도 비어 있는 것이 맞다 |
| E2E "baseline JSON을 만들고 process를 종료한다" | 케이스 8개와 입력 8개를 기대값으로 넣었다 |
| E2E "실제 test에서 신뢰도 한계를 드러낸다" | `summary` 를 8/7/1 로, `statuses` 를 8개로 |
| E2E "승인 candidate는 실제 test를 통과한다" | provider 목이 정상 케이스만 고치도록 좁혔다(아래) |

## 고친 기존 기대값 (전량)

| 파일 | 무엇을 | 왜 |
|---|---|---|
| `generate-command.test.ts` | `createBaselineSuite` 목의 `policyVersion` v1 → v2, `coverage` 필드 추가 | T8 이 `BaselineGenerationResult` 를 바꿨다 |
| `generate-integration.test.ts` | `suite.cases` 2개 → 8개, `operation` 목록 8개 | baseline 이 위반 케이스를 함께 만든다 |
| `generate-integration.test.ts` | `report.summary` `{total:2,passed:1,failed:1}` → `{total:8,passed:7,failed:1}`, `statuses` 2개 → 8개 | `examples/weather-server` 가 이미 입력을 검증하므로 위반 케이스 6개가 모두 통과한다 |
| `generate-integration.test.ts` | provider 목이 `get_weather` 케이스 **전부**의 입력을 `{city:"서울"}` 로 바꾸던 것을 **정상 응답을 기대하는 케이스만** 바꾸도록 | 위반 케이스까지 정상 입력으로 바꾸면 서버가 거절하지 않아 그 케이스가 실패한다. AI 가 고칠 것은 도메인 값이지 위반 케이스의 목적이 아니다. 이 목의 원래 의도(사용자 지시를 반영해 실패하던 케이스를 고친다)가 그대로 유지된다 |
| `generate-integration.test.ts` | 승인 후 `summary` `{total:2,passed:2}` → `{total:8,passed:8}` | 위와 같다 |

## 실서버 E2E 결과

`examples/weather-server` 를 수정하지 않고 계획서 기대값과 정확히 같은 결과가 나왔다.

```
total 8, passed 7, failed 1
statuses: [failed, passed, passed, passed, passed, passed, passed, passed]
```

유일한 실패는 `get-weather-success` 이고 원인은 `city: "example"` 이 서버의 `WEATHER` 표에 없는
것이다. 기존과 같은 이유이고 설계서 §2 의 비범위(도메인 값)다. 위반 케이스 6개는 전부 통과한다.
서버 프로세스는 `exited(pidFile)` 로 종료를 확인했다.

케이스 수는 상수 `8` 과 `deriveContractAxes` 로 센 축 수 **양쪽에** 맞춰 본다. 축 하나에 케이스
하나가 대응하므로(HAPPY_PATH 축은 정상 케이스에 대응한다) 두 수가 같아야 한다. `examples` 선언이
바뀌면 상수 쪽만 깨지고, 생성이 깨지면 양쪽이 깨진다. 축을 세는 연결은 pid 파일을 따로 쓴다.

## 검증

| 명령 | 판정 줄 |
|---|---|
| `pnpm vitest run packages/cli/tests/generate-command.test.ts` | `Test Files  1 passed (1)` / `Tests  98 passed (98)` |
| `pnpm vitest run packages/cli/tests/generate-integration.test.ts` | `Test Files  1 passed (1)` / `Tests  4 passed (4)` |
| `pnpm vitest run packages/cli` | `Test Files  7 passed (7)` / `Tests  254 passed (254)` |
| `pnpm test` | `Test Files  49 passed (49)` / `Tests  1010 passed \| 1 skipped (1011)` |
| `pnpm typecheck --force` | `Tasks: 6 successful, 6 total` / `Cached: 0 cached, 6 total` |
| `pnpm lint` | `Checked 148 files in 46ms. No fixes applied.` |

`packages/cli` 는 244개에서 254개로 늘었다(커버리지 화면 8개, 케이스 수 고지 3개, 기존 1개는
E2E 에서 변화 없음).

### `pnpm test` 첫 실행에서 무관한 flake 하나

첫 실행에서 `packages/core/tests/stdio-integration.test.ts:103` 이 한 번 실패했다.

```
expect(pid).toSatisfy((value) => typeof value === "number" && Number.isSafeInteger(value) ...)
```

같은 파일을 단독으로 돌리면 `5 passed` 이고, `pnpm test` 를 두 번 더 돌리면 두 번 다
`1010 passed` 다. `packages/core` 는 이 태스크가 건드리지 않았고 실패 지점도 PID 판정이라
내 변경과 무관하다. E2E 프로세스가 늘어 부하가 커진 것이 방아쇠일 수는 있다. 판단은 넘긴다.

## 임의로 판단한 지점

1. **한 줄 요약을 쓰는 조건을 "숨길 것이 없을 때" 로 좁혔다.** 설계서 §7.3 이
   `verified === total` 인데도 `8/8 axes 검증` 과 툴별 줄을 보여 준다. 그래서 해석 불가 툴이나
   해석 못 한 필드가 하나라도 있으면 숫자가 다 차 있어도 상세를 찍는다. 안 그러면 그 사실이
   화면에서 사라지고 "전부 확인했다" 로 읽힌다.
2. **정렬을 표시 폭(한글 2칸) 기준으로 계산했다.** 문자 수로 맞추면 한글이 섞인 줄에서 열이
   어긋난다. 툴 이름 열은 `가장 긴 이름 폭 + 3`, 미검증 라벨 열은 `가장 긴 라벨 폭 + 5` 다.
   설계서 §7.2 의 첫 줄과 §7.3 의 필드 예시가 이 규칙과 정확히 일치한다. **§7.2 의 두 번째
   미검증 줄만 공백이 한 칸 더 많다.** 한 규칙으로는 재현되지 않아 문서의 오타로 봤다. 셋 중
   둘을 맞추는 규칙을 골랐다.
3. `HAPPY_PATH` 의 문장은 설계서에 없어서 §3.2 의 주석("선언을 지킨 입력에 정상 응답한다")에서
   가져왔다. 기본 생성 경로에서는 이 축이 항상 검증되므로 화면에 나오는 일이 드물다.
4. 커버리지를 `deps.writeStdout` 으로 찍는다. 대화형 경로도 `io.write` 가 아니라 stdout 이다.
   계획서가 고지를 "stdout 에 있다" 로 못 박았고, 두 출력이 다른 스트림으로 갈리면 파이프로
   받는 쪽에서 하나만 보인다.
5. 저장 메시지 다음에 커버리지, 그다음 케이스 수 고지 순서로 찍는다. 설계서가 순서를 정하지
   않았다. 저장 결과가 먼저 보이는 편이 실패 시 읽기 쉽다.
6. E2E 의 축 수 확인은 서버를 한 번 더 띄운다. pid 파일을 따로 쓰고 그것의 종료도 확인한다.

## 남은 위험

- 커버리지 화면은 툴 수만큼 줄이 늘어난다. 미검증이 하나라도 있으면 툴 30개 서버에서 31줄이
  찍힌다. 설계서 §7.2 가 정한 동작이지만(전부 검증된 툴도 함께 찍는다) 큰 서버에서 실제로
  어떻게 읽히는지는 실사용 전에 알 수 없다.
- 케이스 수 고지 임계는 케이스당 600 바이트 가정이다. 응답 본문이 큰 서버에서는 1500 미만에서도
  1MB 에 닿을 수 있다. 고지는 상한이 아니라 안내라 막지는 않는다.
- `computeCoverage` 는 선택 의존성이라 주입되지 않으면 대화형 경로에서 커버리지가 조용히 빠진다.
  케이스 수 고지는 그래도 찍힌다. 실제 주입은 `index.ts` 한 줄이고 테스트가 그 경로를 덮지
  않는다.

## 커밋 제안

```
feat(cli): generate 화면에 계약 축 커버리지를 표시한다
```
