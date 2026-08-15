# Task T6b 보고서: ADR-0009 개정과 의존 경계 목록

## 무엇을 했나

T6 이 `generate` 에 들인 `runner` 심볼 셋을 승인 절차대로 목록에 넣었다. ADR-0009 결과 절의
규칙("목록을 넓히려면 이 ADR 을 고쳐야 한다. 테스트가 먼저 깨져 그 사실을 알린다")을 따라
**ADR 을 먼저 고치고 그다음 테스트 목록을 고쳤다.**

### ADR-0009

배경 절 심볼 표에 셋을 넣었다.

| 종류 | 추가한 심볼 |
|---|---|
| 타입 | `ContractAxis`, `ContractDeclaredType` |
| 함수 | `deriveContractAxes` |

왜 늘어났는지를 기존 두 단락(2026-08-14 의 `checkInputContract` 3개, `canonicalJson` 3개)과 같은
형식으로 한 단락 추가했다. 날짜는 2026-08-15 다. 근거는 설계서 §3.1 의 두 이유다.

1. 정규화를 한 벌로 유지해야 한다. `normalizeInputSchema` 가 이미 정규화하는 구조체가 축 도출이
   필요한 것과 정확히 같다. 두 벌이면 입력 계약 대조는 "해석 못 했다" 며 침묵하는데 커버리지는
   "축 3개 미검증" 이라고 세는, 같은 화면 두 줄이 서로를 부정하는 상태가 된다.
2. `generate` 의 `validateSchema` 는 `anyOf` 를 만나면 던진다. 커버리지 표시는 AI 명세와 손으로
   쓴 명세에도 필요한데 그 경로는 서버 선언을 `generate` 파서에 통과시키지 않으므로, `generate`
   파서 기반 도출은 `anyOf` 하나로 화면 전체를 죽인다. `runner` 파서 기반 도출은 그 툴만 빼고
   나머지를 정상 표시한다.

### 경계 목록

`APPROVED_RUNNER_SYMBOLS` 에 알파벳 순서로 셋을 넣었다.

```
ContractAxis
ContractDeclaredType
deriveContractAxes
```

`matchCoveredAxes` 와 `ContractAxisKind` 는 **넣지 않았다.** 아직 import 하는 코드가 없고 이
테스트는 `toEqual` 로 정확한 일치를 요구하므로 미리 넣으면 반대 방향으로 깨진다. T7 이 쓰기
시작할 때 같은 절차로 넓힌다.

## 변경 파일

- Modify: `docs/adr/0009-generate가-runner에-의존하는-예외.md`
- Modify: `packages/generate/tests/dependency-boundary.test.ts`
- Create: `docs/reports/task-t6b-contract-axes.md`

허용 목록 밖 파일은 건드리지 않았다. git 명령은 실행하지 않았다.

## 검증

| 명령 | 판정 줄 |
|---|---|
| `pnpm vitest run packages/generate/tests/dependency-boundary.test.ts` | `Test Files  1 passed (1)` / `Tests  7 passed (7)` |
| `pnpm vitest run packages/generate` | `Test Files  9 passed (9)` / `Tests  167 passed \| 1 skipped (168)` |
| `pnpm typecheck --force` | `Tasks: 6 successful, 6 total` / `Cached: 0 cached, 6 total` |
| `pnpm lint` | `Checked 146 files in 29ms. No fixes applied.` |

T6 이 남긴 `1 failed` 가 0 이 됐다. 예상대로 `167 passed | 1 skipped` 이다.

## 임의로 판단한 지점

ADR 의 상태 줄은 건드리지 않았다. `상태: 제안`, `승인: 미승인` 그대로다. T6b 의 지시는 배경 절의
표와 사유 단락이었고, 승인 상태는 두 오너의 PR 승인으로만 바뀐다고 ADR 자신이 정하고 있다.

## 남은 위험

- ADR-0009 의 심볼 표와 `APPROVED_RUNNER_SYMBOLS` 가 지금은 일치하지만, 둘을 잇는 자동 검사가
  없다. 테스트는 실제 import 와 목록만 대조하고 ADR 문서는 보지 않는다. T7 이 심볼을 늘릴 때
  테스트만 고치고 ADR 을 잊으면 아무도 모른다.
- ADR 이 여전히 `제안` 상태다. 승인 절이 요구하는 두 오너 승인은 PR 단계의 일이다.

## 커밋 제안

```
docs(generate): ADR-0009 승인 심볼 목록에 계약 축 도출을 넣는다
```
