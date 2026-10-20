# analyze-perf T4 보고서 (화면 초안)

계획서: `docs/plans/2026-10-20-analyze-성능-카드-perf-연결-구현계획.md` §5. 커밋은 하지 않았다.

## 작업 공간

| 항목 | 값 |
|---|---|
| pwd | `/Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T4` |
| `git rev-parse HEAD` | `19fbb48883782592b60ae38f5776b345ff57a590` (커밋 전이라 BASE 와 같다) |
| BASE (`feat/analyze-perf`) | `19fbb48883782592b60ae38f5776b345ff57a590` |
| T3SHA (대장 `analyze-perf-T3`) | `b6c2731de02920812cf52309a7a52a682320cf6c` (`feat/analyze-perf` 의 조상임을 확인) |
| 브랜치 | `feat/analyze-perf-T4` |

## 변경 파일

- 수정 `packages/dashboard/web/src/analyze/types.ts`: §5.1 의 타입 그대로
- 수정 `packages/dashboard/web/src/analyze/pillars.ts`: 성능 항목 `available: false` → `true` 한 줄
- 수정 `packages/dashboard/web/src/App.tsx`: `parseRoute` 가 `performance` 를 받는다
- 수정 `packages/dashboard/web/src/screens/AnalyzeView.tsx`
- 수정 `packages/dashboard/web/src/analyze/PillarCard.tsx`
- 생성 `packages/dashboard/web/src/analyze/PerformanceResult.tsx` (컴포넌트 이름 `PerformanceDetail`)
- 생성 `packages/dashboard/web/tests/performance-detail.test.tsx`
- 수정 `packages/dashboard/web/tests/app.test.ts`, `analyze-pillars.test.ts`, `analyze-view.test.tsx` (아래 목록)
- 생성 이 보고서

공유 계약(`packages/dashboard/src/`, `format.ts`, `build-perf-request.ts`, `use-performance-analysis.ts`,
`analyze-fixtures.tsx`)은 바꾸지 않았다.

## 검증

| 명령 | 결과 |
|---|---|
| 테스트 먼저: `pnpm vitest run --project web packages/dashboard/web/tests/performance-detail.test.tsx` (구현 전) | 6 실패, 1 통과. 통과한 하나는 "분석하기는 성능 요청을 보내지 않는다" 로, 구현 전에도 성립하는 가드다 |
| 표적: `pnpm vitest run --project web .../performance-detail.test.tsx .../app.test.ts .../analyze-pillars.test.ts .../analyze-view.test.tsx` | 4 파일 통과, 85 테스트 통과 |
| `pnpm build --force` | `Tasks: 10 successful`, `Cached: 0 cached, 10 total` |
| `pnpm typecheck --force` | `Tasks: 10 successful`, `Cached: 0 cached, 10 total` (첫 회는 TS2345 로 빨강이었고 고친 뒤 초록) |
| `pnpm lint` | `Checked 784 files`, 오류 없음 (`website/.../HomeLanding.vue` 의 기존 경고만) |
| `pnpm test` | 258 파일 중 257 통과, 테스트 5906 통과, 1 실패, 3 skip. 실패는 `packages/cli/tests/audit-sandbox-e2e.test.ts` 의 live-weather sandbox-session/replay 비교 1건뿐이다(오케스트레이터가 알려 준 main 의 기존 flaky). 고치지 않았다 |
| `pnpm vitest run --project web` (web 갈래 파일 수 확인용) | 65 파일, 992 테스트 통과. 에이전트 환경에서 vitest 가 통과 파일 줄을 감춰 `pnpm test` 출력으로는 갈래별 수를 볼 수 없어 따로 돌렸다 |

## 요구사항 R1~R11

| 요구 | 만족한 곳 |
|---|---|
| R1 | `AnalyzeView.tsx` 의 `performanceCard` 가 `usePerformanceAnalysis().state` 를 카드에 넘기고 `done` 이면 `performanceSummary` 를 그린다. `PillarCard.tsx` `SummaryBar` 가 첫 줄 라벨 `summary.baseLabel ?? "원본"`, 둘째 줄 `bar[0].label` 을 쓴다. idle 문장은 `PERFORMANCE_IDLE_NOTE` ("상세에서 명세를 골라 측정합니다") |
| R2 | `AnalyzeView.tsx` `runAll` 은 그대로 토큰·보안 둘만 보낸다. 테스트 "분석하기는 성능 요청을 보내지 않는다" |
| R3 | `PerformanceResult.tsx`: `GET /api/suites` 목록의 라디오, "반복 횟수" 입력(기본 `INITIAL_PERF_FORM.repeat` = 5), 시작 버튼. `tools` 는 폼 기본값 빈 배열 그대로 |
| R4 | `PerformanceResult.tsx` 의 두 번째 `useEffect` 가 `GET /api/suites/<path>` 의 `FileContent.content` 를 `JSON.parse` 해 `approval` 키를 본다. 시작 버튼 위에 `perfStartNotice(repeat, approved)` 의 줄을 그대로 보인다. 테스트 "미승인 명세면 미승인 고지가 보인다" |
| R5 | 상세: 사유가 `performanceUnavailable(transport)` 를 가장 먼저 보고 버튼이 비활성이다. 카드: idle 문장 자리에 같은 함수의 문장을 보인다(`AnalyzeView.tsx` 의 `idleNote`). 테스트 "원격 대상이면 성능 요청이 나가지 않는다" |
| R6 | `PerformanceResult.tsx` 가 `buildPerfRequest` 를 렌더마다 부르고 throw 문장을 사유로 보이며 버튼을 비활성으로 둔다. 제출도 같은 결과를 쓴다 |
| R7 | running 이면 `LogPanel`(제목 "진행")에 `performance.events` 를 보이고 `progressError` 를 `ErrorAlert` 로 보인다. 취소 버튼 없음 |
| R8 | done 이면 `state.result.rendered` 를 `<pre>`(등폭)로 그대로 보인다 |
| R9 | failed 면 `ErrorAlert` 에 `state.error` 전문. 카드는 기존대로 첫 줄 |
| R10 | 상세는 기존 `hasResults` 분기 안에 그대로 있다. app.test.ts 42~54행 테스트는 손대지 않았고 통과한다 |
| R11 | 토큰·보안이 running 이면 `otherRunning` 으로 시작 버튼이 비활성이고 "다른 분석이 끝난 뒤 측정할 수 있습니다." 를 보인다. 성능이 running 이면 `AnalyzeView.tsx` 의 `running` 에 포함돼 분석하기 버튼이 비활성이다(사유는 기존 "분석이 돌고 있습니다", 버튼 글자는 기존 "분석 중…"). 테스트 "다른 축이 도는 동안 성능을 시작할 수 없다", "성능이 도는 동안 분석하기를 누를 수 없다" |

## 정리한 기존 테스트 줄

- `packages/dashboard/web/tests/app.test.ts` 72~81행: "`#/analyze/performance` 면 tabpanel 이 없다" 를 "성능 상세 tabpanel 이 열리고(머리 `성능 효율성 상세`) 성능 카드가 `aria-selected=true`" 로 뒤집었다. 42~54행은 그대로다.
- `packages/dashboard/web/tests/analyze-pillars.test.ts` 324~326행: 이름 "…성능만 비활성이다" → "…세 축 모두 활성이다", `available` 기대 `[true, true, false]` → `[true, true, true]`.
- `packages/dashboard/web/tests/analyze-view.test.tsx` 727~731행: `getByText("아직 연결되지 않았습니다")` 를 "성능 카드 안에 명세를 골라 측정한다는 문장이 있다" 로 바꿨다.
- `packages/dashboard/web/tests/analyze-view.test.tsx` 735~745행: "성능 카드는 비활성이고 눌러도 해시가 바뀌지 않는다" → "성능 카드는 활성이고 누르면 해시가 성능 상세로 바뀐다" (`aria-disabled` 없음, 클릭 뒤 해시 `#/analyze/performance`).

## 임의로 판단한 부분

1. **측정 대상은 지금 대상 영역의 값이다.** `target.argv`·`target.serverId`·`target.state.transport` 를 쓴다(분석하기와 같은 값). 분석한 요청(`tokens.analyzed`)에는 transport 가 없고, 토큰이 실패하면 null 이라 쓰지 않았다. 대상 바꾸기로 폼을 고친 뒤 다시 분석하지 않으면 측정 대상이 카드의 "분석한 대상" 과 다를 수 있다. 카드의 "분석한 대상" 은 성능도 `performance.sent` 에서 구하므로 측정한 대상과는 맞는다.
2. **사유 우선순위**: 원격 > 다른 축 실행 중 > `buildPerfRequest` 오류. 원격은 대상을 바꾸지 않으면 풀리지 않기 때문이다. `buildPerfRequest` 자체도 원격을 먼저 던지므로 같은 순서다.
3. **승인 여부를 모르면 미승인으로 본다.** 내용을 읽는 중이거나, 읽기에 실패했거나, JSON 이 아니면 미승인 줄이 보인다. 고지가 하나 더 보이는 쪽이 안전하다고 판단했다. 그래서 승인된 명세를 고르면 응답이 오기 전 잠깐 미승인 줄이 보였다 사라진다. 읽기 실패 문장은 서버 문장 그대로 `ErrorAlert` 로 보인다.
4. **고지는 요청이 만들어질 때만 보인다.** 명세를 안 골랐거나 반복 횟수가 틀리면 고지 대신 사유 문장이 보인다. 고지의 반복 횟수는 검사를 통과한 `form.repeat` 다(`AnalyzePerfRequest.repeat` 가 타입상 선택 필드라 그 값을 쓰지 않았다).
5. **성능 폼 상태는 `AnalyzeView` 에 둔다.** 상세를 오가도 고른 명세·반복 횟수가 남는다. 명세 목록은 상세가 열릴 때마다 다시 읽는다.
6. **빈 명세 목록 문장**은 새로 짓지 않고 Home `StepRunSuite.tsx` 의 빈 목록 두 문장을 그대로 옮겼다(§6 자체 점검의 "빈 상태 문구 누락" 대비).
7. **카드 막대**: 성능은 측정한 케이스가 없으면(`bar` 가 빔) 막대를 그리지 않는다. 돌지 않은 측정을 100% 막대로 보이지 않기 위해서다. 비용 카드는 기존대로 빈 `bar` 에서도 "원본/압축" 두 줄을 그린다. 두 줄 라벨이 "개선 후" 처럼 길어져 칸 폭을 `32px` 고정에서 `minmax(32px, max-content)` 한 그리드로 바꿨다. 비용 카드의 모양은 거의 같다.
8. **새로 지은 화면 글자**: 카드 idle "상세에서 명세를 골라 측정합니다", 배지·버튼 "측정 중…", 버튼 "측정 시작", 라벨 "명세"·"반복 횟수", 로그 제목 "진행". 계약 문장(`performanceUnavailable`·`perfStartNotice`·`performanceSummary`)은 그대로 썼다. 보안 상세의 "점검은 중단되지 않고 끝까지 돕니다." 에 해당하는 문장은 넣지 않았다.
9. 성능이 도는 동안 분석하기 사유는 기존 문장 "분석이 돌고 있습니다" 를 재사용했다(R11 이 재량으로 둔 부분).
10. `PillarCard.tsx` 의 `available: false` 갈래(빗금 카드)는 지금 쓰는 축이 없지만 `PillarDescriptor.available` 계약이 남아 있어 지우지 않았다.

## 남은 위험

- 화면은 jsdom 행동 테스트로만 확인했다. 실제 브라우저 확인(§6 자체 점검·사용자 확인 루프)은 하지 않았다.
- done 상태(결과 `rendered`, 카드 요약)를 끝까지 그리는 행동 테스트는 §5.3 표에 없어 두지 않았다. 요약 함수 자체는 T3 테스트가 단언한다.

## 수정 1: 명세 목록을 고른 서버 기준으로 거른다 (사용자 확인 루프)

요구: 성능 상세의 명세 목록이 저장소 전체를 보여 길다. 홈 마법사와 같은 규칙으로 고른 서버에 딸린 명세만 위에
보이고, 딸린 명세가 없으면 생성 화면으로 안내한다.

바꾼 파일

- `packages/dashboard/web/src/analyze/PerformanceResult.tsx`: `home/match-suites.ts` 의 `matchSuites` 를 그대로
  import 해 목록을 matched·others 로 가른다. matched 는 펴고, others 는 "다른 명세 보기 (N)" 버튼으로 편다(홈의
  「다른 스위트 보기」 와 같은 모양). matched 가 비면 명세 자리에 "이 서버용 테스트 명세가 없습니다. 성능 측정은
  명세의 케이스를 그대로 호출하므로 먼저 명세를 만드세요." 와 링크 `#/generate` "명세 만들기" 를 보인다. 저장소에
  명세가 하나도 없을 때 쓰던 홈의 빈 목록 문장 두 개는 이 안내로 바꿨다.
- `packages/dashboard/web/src/screens/AnalyzeView.tsx`: 더 쓰지 않는 `root` prop 을 넘기지 않는다(한 줄 삭제).
- `packages/dashboard/web/tests/performance-detail.test.tsx`: 테스트 둘 추가("고른 서버에 딸린 명세만 먼저 보인다",
  "딸린 명세가 없으면 생성 화면 링크가 보인다"). 기존 테스트 정리 둘. 미승인 명세 픽스처 경로를
  `examples/weather-server/draft.suite.json` → `examples/weather-server/server.suite.draft.json` 으로 바꿨다(앞의 것은
  weather 서버에 딸린 이름이 아니라 접힌 쪽으로 간다). "원격 대상이면 …" 테스트는 HTTP 대상에 딸린 명세가 없으므로
  "다른 명세 보기" 를 편 뒤 명세를 고른다.

검증

| 명령 | 결과 |
|---|---|
| `pnpm vitest run --project web .../performance-detail.test.tsx .../analyze-view.test.tsx .../app.test.ts` | 3 파일, 57 테스트 통과 |
| `pnpm build --force` | `Tasks: 10 successful`, `Cached: 0 cached, 10 total` |
| `pnpm typecheck --force` | `Tasks: 10 successful`, `Cached: 0 cached, 10 total` |
| `pnpm lint` | `Checked 784 files`, 오류 없음 |

`pnpm test` 전체는 오케스트레이터가 다시 돈다고 해서 돌리지 않았다.

임의 판단

1. `matchSuites` 에 넘기는 args 는 측정 대상 argv 의 `--arg` 값들이다(`buildAnalyzeArgv` 가 직접 입력이면 스크립트
   경로를 선두 `--arg` 로 싣으므로 같은 규칙이 된다). HTTP 대상은 빈 배열이라 matched 가 늘 비고 안내가 보인다.
   새 화면 상태를 만들지 않으려고 `AnalyzeView` 에서 args 를 따로 넘기지 않고 이미 받는 argv 에서 구했다.
2. matched 가 정확히 1개면 목록을 처음 받은 뒤 한 번만 그것을 미리 고른다. 이미 고른 명세가 있으면 건드리지 않고,
   사용자가 바꾼 선택을 되돌리지 않는다.
3. 고른 명세가 접힌 쪽(others)에 있으면 "다른 명세 보기" 를 펴 둔다. 고른 것이 보이지 않으면 무엇을 측정하는지
   알 수 없기 때문이다.
4. 홈과 달리 matched 가 비어도 others 를 자동으로 펴지 않는다. 요구가 "펼칠 수는 있다" 였고, 안내와 링크가 먼저
   보이게 하려는 것이다.
5. 버튼 글자는 홈의 「다른 스위트 보기」 를 따라 개수를 붙였다("다른 명세 보기 (N)").
