# Task T2 — 케이스 결과와 요약에 싣는다 (`runner`)

작성일: 2026-08-18. 이슈 #89. 참조: 설계 문서 §3.2 · §4.2, 계획서 Task T2. 선행: T1(`2b926e5`).

## 무엇을 만들었나

T1 의 `classifyRejectionBasis` 를 `executor.ts` 의 케이스 루프에 배선하고, 결과와 요약에 필드
둘을 더했다. **판정은 안 바뀐다.**

| 파일 | 상태 |
|---|---|
| `packages/runner/src/executor.ts` | 수정 — 필드 둘, 배선 |
| `packages/runner/src/index.ts` | 수정 — `RejectionBasis` · `classifyRejectionBasis` 수출 |
| `packages/runner/tests/executor.test.ts` | 수정 — 신규 6건, 기존 2건 갱신 |
| `.changeset/runner-rejection-basis.md` | 생성 |
| **계획서 Files 목록 밖** | 아래 「계획서의 결함」 참조 |

### `readBody()` 호출 조건을 넓힌 자리

계획서가 가장 조심하라고 한 부분이다. 지금까지 본문은 **실패한 케이스에서만** 읽혔다
(ADR-0027 배선). 거절을 기대한 케이스는 **통과했을 때도** 본문이 필요하다.

넓히는 범위를 `expectedIsError(spec) === true` 하나로 못 박았다. 거절을 기대하지 않는 케이스는
여전히 본문을 안 읽는다. 골든 보고서 테스트의 두 케이스가 `notApplicable` 로 나오는 것이 그
증거다 — 조건을 잘못 넓혔다면 그 케이스들도 본문을 읽었을 것이다.

## 임의로 판단한 것

### 1. 실행되지 않은 케이스는 `notApplicable` 이다

**설계 문서에 없다.** §4.2 는 실행된 케이스만 다룬다.

본문이 없으니 `classifyRejectionBasis` 에 그대로 넣으면 `unverified` 가 나온다. 그렇게 하지
않았다. 중단된 실행에서 안 돈 케이스 전부가 §5.1 의 "거절 근거를 확인하지 못했습니다" 에 실려
버린다. 안 돈 케이스는 **초록으로 찍히지도 않아 크래시가 숨을 자리가 없다.** `unverified` 를
안전한 기본값으로 두는 근거가 여기서는 성립하지 않고 소음만 남는다(ADR-0015).

되돌리려면 `executor.ts` 의 `notRun` 분기 한 줄이다. 테스트가 이 동작을 고정하고 있다.

### 2. JSON 으로 파싱된 본문은 지문 대조에 안 쓴다

`extractResponseBody` 는 본문이 JSON 객체·배열이면 파싱해서 준다(`form: "json"`). 그때는
`bodyText: null` 로 넘긴다. 관찰 80건이 전부 `text` 한 블록이고 지문 셋도 전부 문장 접두어라,
구조화된 본문에는 대조할 것이 없다.

### 3. `reporter.test.ts` 의 헬퍼에 `rejectionBasis` 입력을 선택 인자로 열어 뒀다

T3 가 "확인 못 함" 고지 줄을 테스트하려면 `unverified` 케이스를 만들어야 한다. 타입만 맞추고
막아 두면 T3 가 같은 헬퍼를 다시 고쳐야 해서, 기본값 `notApplicable` 로 열어만 뒀다.

## 계획서의 결함 — 보고한다

**T2 의 허용 Files 셋(`executor.ts` · `index.ts` · `executor.test.ts`)만으로는 T2 를 끝낼 수
없다.**

두 필드를 계획서가 적은 대로 **필수**로 만들면, 이 타입을 손으로 짓는 모든 테스트가 컴파일되지
않는다. 실제로 아래 파일들이 걸렸고 전부 리터럴에 필드를 더하는 기계적 수정이다.

| 패키지 | 파일 | 자리 |
|---|---|---|
| `runner` | `tests/junit.test.ts` | 6 |
| `runner` | `tests/reporter.test.ts` | 3 |
| `cli` | `tests/test-command.test.ts` | 5 |
| `cli` | `tests/repair-bundle-write.test.ts` | 1 |
| `cli` | `tests/replay-command.test.ts` | 1 |
| `cli` | `tests/generate-integration.test.ts` | 2 (런타임 단언) |

계획서 §3 은 "PR 은 패키지별로 나눈다(runner · cli · generate)" 라고 못 박았는데, **필수 필드
추가가 그 분할을 물리적으로 불가능하게 만든다.** 선택 필드로 내리면 분할이 지켜지지만 계약이
설계 문서와 달라지고 T3·T4 가 `undefined` 를 처리해야 한다.

**필수 유지 + `cli` 테스트를 같은 PR 에 포함**으로 결정했다. `cli` 는 공용 소유이고 이 수정은
테스트 리터럴뿐이라 동작 변화가 없다. CONTRIBUTING §2.2 의 "한 PR 에서 여러 오너의 영역을
동시에 건드리지 않는다" 와는 어긋나므로, 리뷰어에 `cli` 를 아는 사람을 함께 넣는다.
**T3~T6 도 같은 이유로 Files 목록이 모자랄 수 있다.**

## 실서버 dogfood 가 설계를 확인해 준다

`generate-integration.test.ts` 는 실제 `examples/weather-server` 를 띄운다. 거기서
`rejectionUnverified: 6` 이 나왔다. 그 서버는 거절 문장을 손으로 써서 SDK 지문에 안 걸린다.
설계 문서 §9 가 "우리 `examples/weather-server` 가 그 예다" 라고 미리 적어 둔 경우이고, 규칙이
합성 데이터가 아니라 실서버에서도 예측대로 동작한다는 뜻이다.

**그 8건의 판정은 하나도 안 바뀌었다.** `passed: 7` · `failed: 1` 그대로이고 키 하나가 늘었다.

## 검증

| 명령 | 결과 |
|---|---|
| `vitest run packages/runner/tests/executor.test.ts` | 29건 통과 (신규 6 포함) |
| `vitest run packages/runner` | 568건 통과 |
| `pnpm test` | 1782건 통과 · 3 skipped |
| `turbo run typecheck --force` | 6/6 통과, `Cached: 0 cached` |
| `biome ci .` | 200 파일 통과 |

**기존 케이스 판정이 하나도 안 바뀌었다.** 전체 diff 에서 `status`·`passed`·`failed`·
`timedOut`·`cancelled`·`notRun` 의 **값**이 바뀐 자리는 없다. 지워진 줄은 한 줄짜리 리터럴을
여러 줄로 편 서식 변경과 골든 문자열뿐이고, 둘 다 같은 값으로 다시 적었다.

골든 보고서 테스트(`기존 isError 전용 스위트의 보고서가 변하지 않는다`)는 갱신했다. 늘어난
것은 `cases[].rejectionBasis` 와 `summary.rejectionUnverified` **둘뿐**이고 기존 키의 값은
그대로다. 그래서 `schemaVersion` 은 `1` 을 유지한다. 그 사유를 테스트 주석에 적었다.

## T3 · T4 가 알아야 할 것

- `RunnerSummary.rejectionUnverified` 가 0 이면 화면에 **아무 줄도 안 찍는다**(설계 문서 §5.1).
- `rejectionUnverified` 는 판정 종류가 아니다. `total = passed + failed + timedOut + cancelled +
  notRun` 합산식에 **안 들어간다.** `executor.test.ts` 가 그 항등식을 그대로 단언한다.
- 케이스 목록에는 표시하지 않는다. 통과한 케이스 옆에 기호를 더하면 판정이 바뀐 것으로 읽힌다.
- `reporter.test.ts` 의 `testCase()` 헬퍼가 `rejectionBasis` 를 선택 인자로 받는다.
- T4 가 승인 화면에 응답 본문을 보여주려면 본문이 필요한데, **`TestCaseResult` 에는 본문이 없다.**
  `rejectionBasis` 만 있다. §5.2 의 화면(`응답: Input validation error: ...`)을 그리려면 본문을
  어디서 가져올지 T4 가 정해야 한다. 이 태스크 범위 밖이라 손대지 않았다.
