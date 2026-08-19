# 거절 근거 확인(#89) 구현 세션 인수인계

- 작성일: 2026-08-18
- 프로젝트: OhMyMCP
- 이슈: #89 — `isError: true` 단언이 거절과 다른 실패를 구분하지 못한다
- 설계: `docs/superpowers/specs/2026-08-18-rejection-basis-verification-design.md` (작성 `@seodduu`)
- 계획: `docs/superpowers/plans/2026-08-18-rejection-basis-verification-implementation.md` (작성 `@seodduu`)
- 현재 단계: **T1~T6 구현 완료, PR #163 · #164 머지됨.** 후속 하나(#165)가 열려 있다
- 상태 기준: 아래 PR·이슈 상태는 **2026-08-19** 에 한 번 맞춘 것이다. 이후는 트래커가 정답이다

> 이 문서는 구현 세션의 결정과 남은 일을 넘기는 기록이다. 무엇을 만들었는지는 `docs/reports/`
> 의 태스크별 보고서가 상세하다. 여기에는 **그 보고서에 없는 것** — 왜 그렇게 갈렸는지, 다음
> 사람이 밟을 지뢰가 어디인지 — 를 적는다.

## 1. 무엇이 끝났나

| PR / 이슈 | 상태 | 내용 |
|---|---|---|
| #151 | **닫힘** | 이전 접근(`errorBodyContains` 자동 생성). 실측으로 반증돼 폐기 |
| #163 | **머지됨** | T1~T6 전량 + 응답 본문 배선 + RangeError 처리 |
| #164 | **머지됨** | `cli` 검토 입력 스텁 무한 루프 수정 (독립 건) |
| #165 | 열림 | provider 로 보내는 자유 텍스트의 redaction 계약 (후속 판단) |

여섯 태스크는 전부 계획서대로 끝났다. 통합 게이트 7개도 전부 확인했다.

#164 는 리베이스 없이 main 위에 시험 병합해 `pnpm test` 통과 1833건을 확인한 뒤 머지됐다.
`docs/adoption.md` §6 의 `1832 통과 · 2 skip` 은 **이 브랜치를 그대로 돌린 것**이라 서로 다른
실행이다 — #164 가 테스트를 하나 더하므로 통과 수가 한 건 많다.

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

### 4.2 로컬 검증에서 낡은 `dist` 를 볼 수 있다

**검증 전에는 `pnpm build --force` 를 붙여라.** 다만 이 자리에 처음 적었던 원인은 틀렸다.
`turbo run build` 가 `FULL TURBO` 를 낸 것 자체는 정상 동작이었다 — `build` 는 뼈대 커밋 때부터
`dependsOn: ["^build"]` 라, `core` 가 바뀌면 하위 다섯 패키지의 build 해시가 이미 무효화된다.
**#157 은 `build` 를 건드리지 않았다.** `dependsOn: []` 이던 `typecheck` 쪽 결함을 고친 PR 이다.

실제 구멍은 둘이고 **둘 다 로컬 한정**이다. CI 는 캐시가 비어 있고 build 다음에 e2e 를 돌린다
(`.github/workflows/ci.yml:131` · `:138`).

- **루트 설정 파일이 어떤 해시에도 안 들어간다.** `turbo.json` 에 `globalDependencies` 가 없다
  (실측: global hash 의 root 파일 목록이 비어 있다). `tsconfig.base.json` 을 고쳐도 build 캐시가
  전부 적중한다. lockfile 은 따로 잡히므로 의존성 변경은 안전하다.
- **`test:e2e` 가 turbo 태스크가 아니다.** `packages/cli/package.json` 의 스크립트라 build → e2e
  순서를 강제하는 장치가 없다. 소스만 고치고 e2e 를 돌리면 낡은 `dist` 를 검증한다.

앞의 것은 설정 결함으로 보이지만 `turbo.json` 은 루트 공유 설정이라 이 세션에서 건드리지 않았다.
별도 이슈감이다.

### 4.3 `askChoice` 무한 루프 (#164 로 막혔다)

`dry-run-review.ts` 의 `askChoice` 는 유효한 글자가 나올 때까지 도는 무한 루프다. 테스트 스텁이
큐가 비면 `""` 를 돌려주면 **`vi.fn` 의 호출 기록이 heap 을 4GB 까지 채우고 죽는다.** 실패가
아니라 워커가 통째로 죽어서 원인이 안 보인다.

승인 화면을 넓히는 작업은 분류 화면에 새 케이스를 도달시키므로 이 지뢰를 다시 밟을 자리였다.
**#164 가 스텁을 실제 `nodeReviewIO` 계약(EOF 에 던짐)에 맞춰 막았다.** 스텁을 다시 손볼 때 그
계약을 깨면 되살아난다 — 큐가 비었을 때 빈 문자열을 돌려주는 스텁으로 되돌리지 마라.

### 4.4 Python 서버는 `mcp<2` 로 고정해야 돈다

`mcp` 2.x 에서 `mcp.shared.exceptions.McpError` import 가 깨져 `mcp-server-time` 이 기동조차
못 한다. `docs/adoption.md` §6 에 재현 명령을 적어 뒀다.

## 5. 남은 일

### 5.1 지금 열린 것

- **#165 판단.** `responseBody` 의 계약 주석이 실제보다 강하다. ADR-0033 이 정규식 치환(E1)을
  이미 기각했으므로 **차단이 아니라 정직함**의 문제다. ADR-0033 작성자 `@seodduu` 의 의견이
  필요하다.
- **이 PR** (#167). 공개 서버 3개 대조 결과와 이 문서. 머지되면 여기 남는 것은 #165 뿐이다.

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
