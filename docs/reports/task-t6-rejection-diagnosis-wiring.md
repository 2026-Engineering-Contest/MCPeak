# Task T6 — 승인 화면에 AI 진단을 배선한다 (`cli`)

작성일: 2026-08-18. 이슈 #89. 참조: 설계 문서 §6.3·§6.4, 계획서 Task T6.
기점: `031cabb` (T4 + T5 통합).

## 무엇을 만들었나

승인 화면의 미확인 목록 아래에 AI 진단을 붙였다. **마지막 태스크다.**

| 파일 | 상태 |
|---|---|
| `packages/generate/src/rejection-diagnosis.ts` | 인터페이스 메서드명 변경 (**목록 밖**) |
| `packages/generate/src/providers.ts` | `diagnoseRejection` 구현 (**목록 밖**) |
| `packages/generate/tests/rejection-diagnosis.test.ts` | 스텁 이름 변경 (**목록 밖**) |
| `packages/cli/src/generate-command.ts` | 의존 · 질문 · 렌더 |
| `packages/cli/src/index.ts` | 실제 provider 배선 (**목록 밖**) |
| `packages/cli/tests/generate-command.test.ts` | 신규 9건 |
| `packages/cli/tests/index.test.ts` | 의존 키 목록 (**목록 밖**) |
| `.changeset/cli-rejection-diagnosis-wiring.md` | 생성 |

## T5 의 구멍을 메웠다

T5 는 `rejectionDiagnosisPrompt` 와 `buildRejectionDiagnosisProviderSchema` 를 만들어 놓고
**그것을 실제로 부르는 provider 메서드를 안 만들었다.** 내가 T5 에서 빠뜨린 것이다. 그대로
두면 T6 은 테스트 스텁으로만 통과하고 실서버에서는 provider 를 꽂을 방법이 없다. W5 에서
터졌을 것이다.

메서드 이름도 갈라야 했다. `providers.ts` 의 provider 객체 하나가 authoring · preFill · 진단 ·
거절 진단을 전부 맡는데, 이미 `diagnose(request: DiagnosisRequest, …)` 가 있어서 T5 가 쓴
`diagnose(requests: RejectionDiagnosisRequest[], …)` 와 시그니처가 충돌한다. 한 객체가 두
인터페이스를 만족할 수 없다. `diagnoseRejection` 으로 바꿨고 그 근거를 인터페이스 주석에 남겼다.

## 실제 화면

```
거절 근거 미확인 2건
  → weather-missing-city   응답: → 'city' 는 문자열이어야 합니다.
  → weather-type-city      응답: → 'city' 는 문자열이어야 합니다.
  이 응답이 서버의 정상 거절인지 내부 오류인지 확인하지 못했습니다.

  나머지 2건의 진단을 AI 에게 요청할까요? [y/N] y
거절 근거 미확인 2건에 대해 AI 진단을 요청했습니다.

  weather-missing-city   거절로 보임
    → 응답이 JSON Schema 검증기의 문구이고 누락된 필드 이름을 정확히 지목합니다.
  weather-type-city      거절로 보임
    → 응답이 JSON Schema 검증기의 문구이고 누락된 필드 이름을 정확히 지목합니다.

이 진단은 참고입니다. 케이스 판정과 저장 여부를 바꾸지 않습니다.
```

설계 문서 §6.4 그대로다. 마지막 줄은 뺄 수 없다 — AI 답변이 판정으로 읽히면 사용자가 초록·빨강을
잘못 해석한다.

## 임의로 판단한 것

### 1. `rejectionProviders` 를 `providers` 와 따로 뒀다

`providers` 는 `TestAuthoringProvider`(`author`)를 만들고 이쪽은 `diagnoseRejection` 이라 계약이
다르다. `preFillProviders` 가 같은 이유로 이미 따로 있어서 그 선례를 따랐다.

**부수 효과가 컸다.** 기존 gate 테스트 중 이 의존을 가진 것이 하나도 없으므로 새 질문이 기존
흐름에 끼어들지 않는다. 기존 194건이 한 건도 안 바뀌었다. `providers` 를 재사용했다면 교정
경로 테스트 둘의 confirm 큐가 밀렸을 것이다.

### 2. 질문을 `io.confirm` 으로 했다

계획서가 "메뉴 항목" 이라고 적었지만 최상위 검토 메뉴에는 둘 수 없다. 시험 실행 결과가 `save`
분기 안의 지역 값이라 거기서만 닿는다. T4 산출 항목도 "T6 이 **이 블록 아래에** 메뉴 항목을
붙인다" 라 미확인 목록 바로 뒤가 맞다. 예/아니오 하나뿐이라 `io.confirm` 을 썼다.

### 3. 본문 없는 케이스는 빼고 화면에 적는다

앞서 합의한 대로다. 두 문장을 새로 썼다(설계 문서에 없다).

- 일부만 없을 때: `응답 본문이 없는 N건은 진단에서 제외합니다. AI 에게 줄 근거가 없습니다.`
- 전부 없을 때: `응답 본문이 없어 N건 전부를 AI 에게 물을 수 없습니다. 진단을 건너뜁니다.`
  이때는 질문 자체를 안 한다. 물어볼 것이 없는데 묻는 것은 소음이다.

### 4. provider 실패를 기존 `providerFailure` 로 낸다

새 오류 코드를 만들지 않았다. `GENERATE_PROVIDER_TIMEOUT` · `GENERATE_PROVIDER_SCHEMA` 같은
기존 문장이 그대로 나온다. 형식 위반은 T5 가 `schemaMismatch` 로 주므로 사용자는
`GENERATE_PROVIDER_SCHEMA` 를 본다. 테스트가 둘 다 고정한다.

## 검증

**측정 시점은 커밋 `49b2431`(T6 구현) 이다.** 이 표는 그 시점의 값이고, 이후 커밋에서 숫자가
늘었다. 문서마다 다른 수가 적히는 것은 실행 시점이 다르기 때문이므로 각자 시점을 함께 적는다.

| 명령 | 결과 (`49b2431` 시점) |
|---|---|
| `vitest run packages/cli/tests/generate-command.test.ts` | 203건 통과 (신규 9 포함) |
| `pnpm test` | 1829건 통과 · 3 skipped (기점 1820 + 신규 9) |
| `turbo run typecheck --force` | 6/6 통과, `Cached: 0 cached` |
| `biome ci .` | 202 파일 통과 |

이후 변화는 이렇다.

| 커밋 | `pnpm test` | 무엇이 달라졌나 |
|---|---|---|
| `49b2431` T6 구현 | 1829 통과 · 3 skip | 이 보고서의 측정 시점 |
| `480c1ea` dist e2e 단언 갱신 | 1829 통과 · 3 skip | 테스트 수 변화 없음 |
| `8c82496` RangeError 처리 | **1831** 통과 · 3 skip | 신규 2건(상한 초과 안내 · 다른 오류 전파) |
| `4e3e1f0` 실환경 검증 기록 | **1832** 통과 · 2 skip | `docs/adoption.md` 의 값. 코드 변화 없음 |

마지막 줄의 `1832 통과 · 2 skip` 은 `docs/adoption.md` §6 이 적은 값이다. 합계는 1834 로 같고,
**내 환경에서 skip 된 실서버 E2E 한 건이 그 실행에서는 돌았다.** 그 명령은 실제 서버 프로세스를
띄울 수 있어야 도는 종류다(`fix/require-real-server-e2e` 가 CI 에서 조용한 skip 을 실패로 올리게
한 그 테스트다). 코드 차이가 아니라 실행 환경 차이다.

**판정이 안 바뀐다는 것을 테스트가 직접 단언한다.** AI 가 `crashed` 라고 답해도 저장된
`approval.cases` 가 전량 `passed` 이고 분류 질문(`io.input`)이 한 번도 안 불린다.

`index.test.ts` 의 의존 키 exhaustiveness 검사가 이번에 제 역할을 했다. 새 함수 의존 둘을
`index.ts` 에 배선하지 않았다면 타입 오류로 막혔다.

## W5 실환경 검증 — 전부 통과

여섯 태스크가 끝난 뒤 빌드 산출물로 실제 서버에 돌렸다. 인메모리 스텁이 아니라
`packages/cli/dist/cli.mjs` 와 `examples/weather-server/server.mjs` 다.

### 게이트 6 — 결정론성

같은 명세를 2회 실행해 `--json` 출력을 바이트로 비교했다. **2843 바이트가 동일하다.**
분류가 응답 본문만 보는 순수 함수라는 것이 실행에서도 확인된다.

### 게이트 7 — dist e2e

`pnpm build` 후 `pnpm --filter ohmymcp test:e2e` 가 통과한다(exit 0).

**turbo 캐시에 주의해야 했다.** 첫 `turbo run build` 가 `FULL TURBO` 로 6개 전부 캐시에서
복원돼 변경이 반영되지 않은 산출물이 나왔다. `--force` 로 다시 빌드해 `dist` 에 새 심볼이
들어간 것을 확인한 뒤 e2e 를 돌렸다. 검증 전에 `--force` 를 붙이는 편이 안전하다.

`dist-cli-e2e.mjs` 의 summary 단언 5곳을 갱신했다(**계획서 Files 목록 밖**, `cli` 안). 값은
추측하지 않고 실행 결과에서 받아 채웠다.

| 픽스처 | `rejectionUnverified` |
|---|---|
| `weather-suite.json` | 1 |
| `weather-suite-failing.json` | 0 |
| `weather-body-assertion.suite.json` | 2 |
| `generate` baseline (8케이스) | 6 |
| 4케이스 스위트 | 1 |

### 사람이 보는 화면

빌드된 CLI 를 실제 서버에 그냥 돌린 결과다.

```
weather-server CLI E2E  (3 cases)

✓ weather-tool-exists             get_weather 도구를 제공한다
✓ seoul-weather-succeeds          서울 날씨를 정상 조회한다
✓ unsupported-city-is-tool-error  미지원 도시는 도구 오류를 반환한다

3 passed  (3 total)

  → 거절을 기대한 케이스 1건은 거절 근거를 확인하지 못했습니다.
    서버가 거절한 것인지 다른 이유로 실패한 것인지 이 도구는 판단하지 못합니다.
    확인: ohmymcp generate 의 승인 화면에서 해당 케이스의 응답을 확인하세요.
```

종료 코드는 `0` 이다. **판정이 안 바뀌었다.** 확인 못 한 그 한 건은
`unsupported-city-is-tool-error` — 거절 문장을 손으로 쓴 케이스이고, 설계 문서 §9 가 우리
예제 서버를 그 한계의 예로 미리 적어 둔 바로 그 자리다. 규칙이 합성 데이터가 아니라 실제
실행에서도 예측대로 동작한다.

## 남은 것

**AI 진단 경로의 실 provider 검증은 `@seodduu` 가 했다** (`4e3e1f0`, `docs/adoption.md` §6).
이 보고서를 쓸 때는 못 한 항목이었다. 실제 `claude` CLI 로 승인 화면까지 대화형으로 돌려
미확인 6건에 전부 `거절로 보임` 이 나왔고, 판정·종료 코드가 안 바뀌는 것과 참고 문장이 붙는
것까지 확인됐다.

**대신 그 기록이 새 구멍을 짚었다.** 표본이 `examples/weather-server` 하나뿐인데 그 서버는
거절 문장을 손으로 써서 **전부 `unverified` 로 떨어진다.** 그래서 실환경에서 `verified` 가
나온 적이 한 번도 없다 — 화이트리스트의 **양성 경로가 픽스처로만 검증됐다.**

계획서 W5 3번의 공개 서버 3개 대조가 그 자리를 메운다. 기대값은 관찰 기록에 있다
(`server-memory` 0건 · `mcp-server-time` 2건 · `mcp-server-calculator` 0건).

- **후속 이슈:** #165 — provider 로 보내는 자유 텍스트의 redaction 계약.
