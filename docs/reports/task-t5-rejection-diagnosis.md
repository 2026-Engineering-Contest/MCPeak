# Task T5 — AI 진단 요청과 응답 (`generate`)

작성일: 2026-08-18. 이슈 #89. 참조: `docs/superpowers/specs/2026-08-18-rejection-basis-verification-design.md` §6,
`docs/superpowers/plans/2026-08-18-rejection-basis-verification-implementation.md` Task T5.

## 무엇을 만들었나

거절 근거를 확인하지 못한(`unverified`) 케이스에 대해 AI 에게 **참고 의견**을 묻는 통로다.
판정을 바꾸지 않는다. 승인 화면에만 나가고 T6 이 그 화면을 그린다.

| 파일 | 상태 |
|---|---|
| `packages/generate/src/rejection-diagnosis.ts` | 생성 |
| `packages/generate/src/index.ts` | 수정 (재수출만) |
| `packages/generate/tests/rejection-diagnosis.test.ts` | 생성 (21건) |
| `.changeset/generate-rejection-diagnosis.md` | 생성 |

공개 표면은 계획서가 고정한 계약 그대로다. `RejectionDiagnosisRequest` · `RejectionVerdict` ·
`RejectionDiagnosisResult` · `RejectionDiagnosisDispatchResult`. 거기에 T6 이 쓸 세 함수와
프롬프트·스키마 조립기를 더했다.

## 내가 임의로 판단한 것

**계획서에 없어서 내가 정한 것들이다. 뒤집을 수 있다.**

### 1. `basis` 를 `runner` 에서 import 하지 않고 구조적으로 다시 적었다

T5 는 선행 태스크가 없어(웨이브 표) T1 의 `runner/src/rejection-basis.ts` 가 아직 없는 시점에
만들어진다. `RejectionBasis` 를 import 하면 T5 가 T1 을 기다리게 되고 웨이브 계획이 깨진다.
그래서 `RejectionDiagnosisCase.basis` 를 `"verified" | "unverified" | "notApplicable"` 로 직접
적었다. 세 리터럴이 같으므로 T1 이 들어오면 그대로 대입된다.

**T6 통합 때 확인할 것:** 그때는 `runner` 타입을 쓰는 편이 낫다. 두 벌이 남으면 한쪽만 바뀔
여지가 생긴다.

### 2. 요청한 케이스를 빠뜨린 응답을 거부한다

계획서는 "케이스 id 가 요청에 없던 것이면 거부한다"(초과)만 적었고 누락은 안 적었다. 누락도
거부하게 했다. 근거는 둘이다. `unsure` 가 있으므로 **답할 수 없는 케이스는 없다.** 그리고
조용히 넘기면 화면이 요청보다 적은 항목을 이유 없이 보여줘, 사용자가 "AI 가 답을 안 준 것"과
"AI 가 계약을 어긴 것"을 구분하지 못한다. 계획서의 "응답 검증을 느슨하게 하지 마라" 와 같은
방향이다. 같은 이유로 **중복 caseId 도 거부한다** — 어느 답이 그 케이스의 판단인지 우리가 정할
수 없다.

### 3. `inputSchema` 에는 redaction 을 걸지 않았다

설계서 §6.2 가 `input` 과 `responseBody` 에만 "redaction 이 적용된 값이다" 를 달아 뒀고,
`inputSchema` 에는 안 달았다. 그 주석대로 갔다. 스키마 안의 enum 값이 치환되면 AI 가 대조할
계약 자체가 사라진다. `authoring-request.ts` 가 `unredactedTools` 를 따로 두는 이유와 같다.

### 4. 프롬프트와 출력 스키마를 이 파일 안에 뒀다

허용 Files 가 셋뿐이라 `diagnosis-prompt.ts` · `diagnosis-schema.ts` 같은 분리를 못 했다.
`caseId` 를 `enum` 으로 박는 것은 `buildDiagnosisProviderSchema` 를 그대로 따랐다 — provider 가
여러 caseId 를 콤마로 이어 붙여 보낸 전례가 있고, 그 항목이 검증에서 버려져 근거가 충분한 답이
통째로 `unsure` 로 접혔다.

### 5. `reason` 상한을 500자로 뒀다

진단 통로의 `MAX_CAUSE_CHARS` 와 같은 값이다. 근거도 같다. 한 항목이 터미널 한 화면을 밀어내지
않게 한다.

## 발견한 한계 — 검토가 필요하다

**`responseBody` 안에 박힌 비밀값은 치환되지 않는다.**

ADR-0033 의 값 치환은 **완전 일치**다(`redaction.ts` 의 `sensitiveValues.has(current)`).
`responseBody` 는 서버가 쓴 자유 문장이라, 비밀값이 문장 안에 섞여 오면
(`"거절: tok-secret 은 허용되지 않습니다"`) 그대로 provider 로 나간다. `input` 은 구조화된
값이라 대부분 완전 일치로 잡히지만 응답 본문은 그렇지 않다.

설계서 §6.3 이 "새 규칙을 만들지 않는다" 를 못 박아서 여기서 고치지 않았다. 대신 **아는 한계로
테스트에 못 박았다**(`[한계] 문장 안에 박힌 비밀값은 치환되지 않는다`). 부분 문자열 치환을
도입할지는 ADR-0033 의 소유자가 판단할 일이고, 이 통로만의 문제가 아니다(진단 통로의 stderr 는
아예 치환 대상이 아니다).

## 검증

| 명령 | 결과 |
|---|---|
| `vitest run packages/generate/tests/rejection-diagnosis.test.ts` | 21건 통과 |
| `pnpm test` | 1782건 통과 · 3 skipped (기점 1761 + 신규 21. 기존 케이스 판정 변화 없음) |
| `turbo run typecheck --force` | 6/6 통과, `Cached: 0 cached` |
| `biome ci .` | 200 파일 통과 |

통합 게이트 4~7번(관찰 픽스처 재현, 탐침 크래시 4건, `--json` 바이트 동일, e2e)은 T1·W5 의
몫이라 여기서 확인하지 않았다.

## T6 이 알아야 할 것

- `dispatchRejectionDiagnosis` 는 **요청이 비면 provider 를 부르지 않고** 곧바로
  `{ type: "completed", results: [] }` 를 돌려준다. 확인 못 한 케이스가 없다는 뜻이다.
- 실패는 전부 `{ type: "failed", failure: PublicProviderFailure }` 다. 형식 위반은
  `code: "schemaMismatch"` 로 온다. 화면 문장은 기존 provider 실패 렌더러가 그대로 쓴다.
- 결과 순서는 **요청 순서**다. provider 응답 순서를 따르지 않는다. 같은 실행을 두 번 볼 때
  화면이 흔들리지 않게 하기 위함이다.
- 호출은 사용자가 시작한다. 자동으로 부르지 않는다(설계서 §6.3).
- 화면 마지막 줄 "이 진단은 참고입니다. 케이스 판정과 저장 여부를 바꾸지 않습니다." 는 뺄 수
  없다(설계서 §6.4).
