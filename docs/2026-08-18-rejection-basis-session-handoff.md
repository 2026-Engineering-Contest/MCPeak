# 거절 근거 확인(#89) 구현 세션 인수인계

- 작성일: 2026-08-18
- 프로젝트: OhMyMCP
- 이슈: #89 — `isError: true` 단언이 거절과 다른 실패를 구분하지 못한다
- 설계: `docs/superpowers/specs/2026-08-18-rejection-basis-verification-design.md` (작성 `@seodduu`)
- 계획: `docs/superpowers/plans/2026-08-18-rejection-basis-verification-implementation.md` (작성 `@seodduu`)
- 현재 단계: **T1~T6 구현 완료, PR #163 머지됨.** 후속 둘이 열려 있다

> 이 문서는 구현 세션의 결정과 남은 일을 넘기는 기록이다. 무엇을 만들었는지는 `docs/reports/`
> 의 태스크별 보고서가 상세하다. 여기에는 **그 보고서에 없는 것** — 왜 그렇게 갈렸는지, 다음
> 사람이 밟을 지뢰가 어디인지 — 를 적는다.

## 1. 무엇이 끝났나

| PR / 이슈 | 상태 | 내용 |
|---|---|---|
| #151 | **닫힘** | 이전 접근(`errorBodyContains` 자동 생성). 실측으로 반증돼 폐기 |
| #163 | **머지됨** | T1~T6 전량 + 응답 본문 배선 + RangeError 처리 |
| #164 | 열림 | `cli` 검토 입력 스텁 무한 루프 수정 (독립 건) |
| #165 | 열림 | provider 로 보내는 자유 텍스트의 redaction 계약 (후속 판단) |

여섯 태스크는 전부 계획서대로 끝났다. 통합 게이트 7개도 전부 확인했다.

## 2. 반드시 알아야 할 것 셋

### 2.1 `isError` 하나로는 못 가른다 — 그리고 본문 문구로도 못 가른다

이슈가 처음 제안한 `errorBodyContains(필드이름)` 자동 생성은 **실측으로 반증됐다.** 크래시
문구가 오히려 위반 필드 이름을 포함한다.

```
Cannot read properties of undefined (reading 'city')
```

`stringContains: "city"` 가 이 크래시를 **통과로 찍는다.** 3자 미만 필드를 빼는 가드로도 못
막는다(`city` 는 4자). #151 이 그 방식이었고 닫혔다. **다시 제안하지 마라.** 근거는
`docs/reports/observation-89-error-body.md` §4·§6 이다.

### 2.2 판정을 바꾸지 않는 것이 이 설계의 전제다

`unverified` 는 **"거절이 아니다" 가 아니라 "확인하지 못했다"** 는 뜻이다. 실패로 올리면 관찰한
서버 11개 중 2개가 통째로 빨개지고 거기 우리 예제 서버가 포함된다(ADR-0015).

케이스 판정 · 종료 코드 · `--json` · `RunnerReport.status` 어디에도 안 들어간다. AI 진단도
화면에만 나간다. **이 경계를 무너뜨리는 변경은 설계를 되돌리는 것이다.** 테스트가 이것을 직접
단언한다 — AI 가 `crashed` 라고 답해도 `approval.cases` 가 전량 `passed` 다.

### 2.3 셋째 지문이 툴 이름을 두 번 요구하는 이유

`packages/runner/src/rejection-basis.ts` 의 FastMCP 지문이다.

```
^Error executing tool <툴>: \d+ validation errors? for <툴>Arguments\b
```

FastMCP 는 **핸들러가 던진 예외도 같은 접두어로 감싼다.** 입력 검증이 낸 것만 모델 이름이
`<툴>Arguments` 다. 이 조건을 빼면 서버가 자기 응답을 검증하다 터진 것이 `verified` 로 찍힌다.
**단순화하지 마라.** 실서버(`mcp-server-calculator`)에서도 확인했다.

## 3. 설계 문서에 없어서 내가 정한 것

되돌릴 수 있는 판단들이다. 근거가 약하다고 보면 바꿔도 된다.

| 판단 | 자리 | 근거 |
|---|---|---|
| 실행 안 된 케이스는 `notApplicable` | `executor.ts` 의 `notRun` 분기 | `unverified` 로 두면 중단된 실행의 안 돈 케이스가 전부 고지에 실린다. 안 돈 케이스는 초록으로 찍히지 않아 크래시가 숨을 자리가 없다 |
| 표시용 본문과 지문 대조용 본문을 가름 | `executor.ts` `displayBody` / `bodyText` | 처음엔 한 판정으로 묶었다가, 서버가 보낸 JSON 본문이 화면에 `(본문 없음)` 으로 찍히는 것을 발견해 갈랐다 |
| 본문 없는 케이스는 AI 진단에서 제외 | `generate-command.ts` `askRejectionDiagnosis` | 빈 값을 채워 물으면 판단 재료가 없어 지어낸 `verdict` 만 돌아온다 |
| `rejectionBody` 상한 200자 | `clampObservedText` | 보고서의 다른 관찰 값과 같은 상한. **이 값이 AI 진단에도 그대로 간다** |
| `diagnoseRejection` 이름 분리 | `rejection-diagnosis.ts` | 기존 `diagnose(request: DiagnosisRequest, …)` 와 시그니처 충돌 |
| 고지 줄에 색 없음 | `reporter.ts` | 바로 위 요약 줄과 같은 규칙(요약에 색이 없다) |

## 4. 다음 사람이 밟을 지뢰

### 4.1 필수 필드를 늘리면 패키지 경계를 넘는다

계획서는 PR 을 패키지별 셋으로 나누라고 했는데 **불가능했다.** `TestCaseResult` 와
`RunnerSummary` 에 필수 필드를 더하면 그 타입을 손으로 짓는 모든 테스트가 컴파일되지 않는다.
`runner` 2개 + `cli` 5개 파일이 함께 걸렸다.

계획서의 Files 목록을 그대로 믿지 마라. T2 · T4 · T6 에서 전부 모자랐다.

### 4.2 turbo 캐시가 낡은 산출물로 검증하게 만든다

`turbo run build` 가 `FULL TURBO` 로 6개 전부 캐시 복원해서, 변경이 안 들어간 `dist` 로 e2e 를
돌릴 뻔했다. **검증 전에는 `--force` 를 붙여라.** 관련 이슈가 #157 로 열려 있다.

### 4.3 `askChoice` 무한 루프 (#164 가 고치는 중)

`dry-run-review.ts` 의 `askChoice` 는 유효한 글자가 나올 때까지 도는 무한 루프다. 테스트 스텁이
큐가 비면 `""` 를 돌려주면 **`vi.fn` 의 호출 기록이 heap 을 4GB 까지 채우고 죽는다.** 실패가
아니라 워커가 통째로 죽어서 원인이 안 보인다.

승인 화면을 넓히는 작업은 분류 화면에 새 케이스를 도달시키므로 이 지뢰를 다시 밟는다. #164 가
스텁을 실제 `nodeReviewIO` 계약(EOF 에 던짐)에 맞춘다.

### 4.4 Python 서버는 `mcp<2` 로 고정해야 돈다

`mcp` 2.x 에서 `mcp.shared.exceptions.McpError` import 가 깨져 `mcp-server-time` 이 기동조차
못 한다. `docs/adoption.md` §6 에 재현 명령을 적어 뒀다.

## 5. 남은 일

### 5.1 지금 열린 것

- **#164 머지.** 리베이스 불필요하다. 사람 승인만 없다.
  main 위에 시험 병합해 `pnpm test` 통과 1833건을 확인했다. `docs/adoption.md` §6 의
  `1832 통과 · 2 skip` 은 **이 브랜치를 그대로 돌린 것**이라 서로 다른 실행이다. #164 가
  테스트를 하나 더하므로 통과 수가 한 건 많다.
- **#165 판단.** `responseBody` 의 계약 주석이 실제보다 강하다. ADR-0033 이 정규식 치환(E1)을
  이미 기각했으므로 **차단이 아니라 정직함**의 문제다. ADR-0033 작성자 `@seodduu` 의 의견이
  필요하다.
- **`docs/adoption.md` §6 갱신 PR** (이 브랜치). 공개 서버 3개 대조 결과.

### 5.2 검증이 안 끝난 것

- **Go·JVM 구현 서버.** 관찰도 대조도 못 했다. 전부 `unverified` 로 떨어진다.
- **화이트리스트 노후화.** 픽스처 테스트가 유일한 감시 장치다.
  **`@modelcontextprotocol/sdk` 버전을 올릴 때 `rejection-basis.test.ts` 를 함께 봐라.**

### 5.3 정리할 것

머지 뒤 중간 이정표 브랜치 넷을 지운다. 전부 #163 의 조상이라 내용은 이미 main 에 있다.

```sh
git branch -d feat/rejection-basis-rule feat/rejection-basis-wiring \
              feat/rejection-basis-reporter feat/rejection-diagnosis-provider
git push origin --delete feat/rejection-basis-rule feat/rejection-basis-wiring \
              feat/rejection-basis-reporter feat/rejection-diagnosis-provider
```

## 6. 참고 문서

| 문서 | 내용 |
|---|---|
| `docs/reports/task-t1-rejection-basis.md` | 분류 규칙. 지문 셋의 근거 |
| `docs/reports/task-t2-rejection-basis-wiring.md` | 결과·요약 배선. 계획서 Files 목록 결함 기록 |
| `docs/reports/task-t3-rejection-notice.md` | `test` 요약 고지 줄 |
| `docs/reports/task-t4-prep-rejection-body.md` | 응답 본문 배선(계획서에 없던 선행) |
| `docs/reports/task-t4-rejection-basis-approval.md` | 승인 화면 미확인 목록 |
| `docs/reports/task-t5-rejection-diagnosis.md` | AI 진단 통로. redaction 한계 최초 기록 |
| `docs/reports/task-t6-rejection-diagnosis-wiring.md` | 진단 배선 + W5 결과 |
| `docs/reports/observation-89-error-body.md` | 관찰 80건 + 탐침. **이 설계의 근거 전부** |
| `docs/adoption.md` §6 | 실환경 검증 기록 |
