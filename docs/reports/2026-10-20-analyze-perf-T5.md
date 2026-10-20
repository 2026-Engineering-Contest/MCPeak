# analyze-perf T5 보고서: 확정 기록 (2026-10-20)

계획서 `docs/plans/2026-10-20-analyze-성능-카드-perf-연결-구현계획.md` §7 과 오케스트레이터가 전한 확인 루프 변경
a~g 의 반영 결과다.

## 작업 공간

| 항목 | 값 |
|---|---|
| pwd | `/Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T5` |
| 브랜치 | `feat/analyze-perf-T5` |
| git rev-parse HEAD | `f7d384330b78ed1c650c66157140604086305a1f` (커밋하지 않았으므로 BASE 와 같다) |
| BASE (`feat/analyze-perf`) | `f7d384330b78ed1c650c66157140604086305a1f` |
| T4SHA (대장 `analyze-perf-T4`) | `0080d47f6973fdf7d7c64be32d5c954a9c1c9a77` (BASE 의 조상 확인됨) |

진입 확인: 계획서와 `performance-detail.test.tsx` 존재, `git status --short` 빈 상태, `pnpm install`·`pnpm build` 성공.

## 바꾼 파일

- `packages/dashboard/web/tests/performance-detail.test.tsx`: 새 describe "AnalyzeView 성능 확정 화면" 5개 추가. 기존 13개는 그대로
- `docs/adr/0119-analyze-성능-축은-명세를-골라-따로-시작하고-카드는-perf-가-낸-값만-읽는다.md`: 결정·이유·결과 절
- `docs/adr/README.md`: 0118 행 다음에 0119 행(담당 dashboard, 상태 제안)
- `docs/adr/0116-…독립이다.md`: 상태 줄에 "ADR-0119 가 성능 축을 예외로 둔다." 추가
- `docs/2026-10-18-analyze-통합-대시보드-설계.md`: §9 의 둘째 항목(일곱 파일 문장)
- `docs/plans/2026-10-20-analyze-성능-카드-perf-연결-구현계획.md`: 끝에 "## 13. 실행 중 바뀐 것" 추가(a~g, T1b)
- `.changeset/analyze-perf-card.md` (생성, `"@mcpeak/dashboard": minor`)
- `docs/reports/2026-10-20-analyze-perf-T5.md` (이 보고서)

## 추가한 화면 단언

| 테스트 | 고정한 것 |
|---|---|
| 카드는 단축 헤드라인과 측정·미측정·진단 칩, 진단 배지를 보인다 | 헤드라인 `−120 ms`, 부제 `~1013 → ~893 ms`, 배지 `진단 1건`, 칩 `측정 2`·`미측정 1`·`진단 1`, 바닥 `가장 큰 단축: a −120ms`, `호출 실패` 없음 |
| 진단이 없고 기준선이 없으면 배지가 진단 0건(기준선 없음)이다 | 배지 `진단 0건(기준선 없음)`, 헤드라인 `0 ms` |
| 상세는 개선 지점·케이스별 응답 시간·미측정 케이스·이 측정의 한계 구획을 보인다 | heading `개선 지점 1건`·`케이스별 응답 시간`·`이 측정의 한계`, 글자 `미측정 케이스 1개`, 한계 문장 |
| 시작 버튼 위 고지는 확정 문구 그대로다 | 고지 세 줄(반복 5번, 격리 없음, 미승인) 원문 |
| 원격 사유는 확정 문구 그대로다 | `performanceUnavailable("http")` 원문, stdio 는 null |

## 검증

| 명령 | 결과 |
|---|---|
| `pnpm vitest run --project web packages/dashboard/web/tests/performance-detail.test.tsx` | 18 통과 (기존 13 + 새 5) |
| `grep -n "0119" docs/adr/README.md` | 한 줄(131행) |
| `grep -c "—"`: changeset, 계획서 §13, `git diff -U0 docs/` 의 추가 줄 | 각각 0 |
| `pnpm build --force` | `Tasks: 10 successful`, `Cached: 0 cached, 10 total` |
| `pnpm typecheck --force` | `Tasks: 10 successful`, `Cached: 0 cached, 10 total` |
| `pnpm lint` | 오류 0, 경고 14(전부 `website/` 의 기존 경고). 처음엔 새 테스트 파일 포맷 1 오류였고 그 파일에만 `biome check --write` |
| `pnpm test` | exit 1. `Test Files 1 failed, 258 passed (259)`, `Tests 1 failed, 5924 passed, 3 skipped (5928)`. 실패 1건은 `packages/cli/tests/audit-sandbox-e2e.test.ts` 의 "live-weather 를 --sandbox-session 으로 한 번, --sandbox-replay 로 한 번 돌린 --json 이 sandbox.network 만 다르다" 로, 오케스트레이터가 알린 기존 flaky(실시간 외부 API)다. 이 태스크는 cli 와 소스를 건드리지 않았다 |

## ADR-0119 에서 고친 문장

결정 절
1. 배지 순서 문장 `관측 안 함 → 측정 중단 → 호출 실패 N건 → 회귀(기준선이 있을 때) → 진단 N건 → 진단 0건.` 을
   `관측 안 함 → 측정 중단 → 회귀(기준선이 있을 때) → 진단 N건 → 진단 0건.` 으로 바꿨다(a).
2. 추가: 명세 목록을 `matchSuites` 로 거르고 "다른 명세 보기" 로 접으며, 딸린 명세가 없으면 "먼저 명세를 만드세요"
   와 `#/generate` 링크(d).
3. 추가: 다른 축이 도는 동안 성능 시작 금지, 성능이 도는 동안 "분석하기" 금지(R11)(e).
4. 추가: 카드 칩은 측정·미측정·진단. 응답 시간을 하나도 못 잰 케이스는 "미측정 케이스" 이고 배지를 바꾸지 않는다(a).
5. 추가: 상세 결과는 `rendered` 를 보이지 않고 보안 상세와 같은 구획 순서, 하단 "다시 측정"·"명세 바꾸기", 실패 시
   명세 폼 재표시(b).

이유 절
6. 추가: "호출 실패" 대신 "미측정 케이스" 로 묶는 이유(사용자 결정, 서비스 장애처럼 읽힘).
7. 추가: CLI 원문 대신 구획으로 보이는 이유(보안 상세와 읽는 방식 맞춤, 글자는 여전히 perf·CLI 의 것).
8. 추가: 명세 목록 거르기와 상호 차단의 이유((a) 의 문제와 (b) 의 이유에 묶음).

결과 절
9. 추가: `AnalyzePerfResponse` 에 `abortedLine`·`limits`(c).
10. 추가: perf 진행 줄과 대시보드 진행 패널(PR #537, T1b)(f).
11. "포기한 것" 끝에 부분 실패 비고 열, 상세의 도구 선택 입력, isError 응답 문장 추가(g).

선택지 절의 (b) "명세(와 반복 횟수, 도구)를 고르고" 는 지시 범위(결정·이유·결과)가 아니라 고치지 않았다. 도구 입력을
포기한 사실은 결과 절 11 에 있다.

## 임의로 판단한 부분

1. 새 화면 단언은 기존 describe 를 건드리지 않으려고 별도 describe "AnalyzeView 성능 확정 화면" 으로 두었다. 헤드라인을
   `−N ms` 로 고정하려고 기존 `perfResponse()` 에 병렬화 진단 하나를 더한 `perfResponseWithSaving()` helper 를 새로 뒀다.
2. 기존 행동 테스트는 문구를 계약 함수에서 꺼내 비교하지만, 새 단언은 "확정" 의 뜻에 맞춰 고지·원격 사유를 원문 그대로
   적었다. 문구를 바꾸면 ADR-0119 와 이 단언을 함께 고쳐야 한다는 주석을 달았다.
3. 칩 단언은 카드 안의 `span` 중 글자가 숫자로 끝나는 것을 모아 `측정 2`·`미측정 1`·`진단 1` 이 들어 있는지로 본다.
   `측정` 이 `미측정` 의 부분 문자열이라 textContent 포함 검사만으로는 구별되지 않기 때문이다.
4. 설계 §9 는 둘째 항목만 고쳤다. 첫 항목("`available: false`", "준비 중" 배지)은 연결 전 상태 기술이라 지금은 맞지
   않지만 지시 범위가 "일곱 파일 문장" 이라 두었다. 연결 파일 목록은 `git diff --stat 245ba74b HEAD -- packages/dashboard packages/cli/src`
   (PR #535 머지 시점 대비)에서 테스트를 뺀 소스 파일이다.
5. changeset 은 사용자 관점 문장 넷으로 썼다(지시는 두세 문장). 시작 전 고지, 분석하기와의 분리, 결과 표시, 서버 API
   추가를 빼면 사용자가 바뀐 점을 알기 어렵다고 봤다.
6. 계획서 §13 의 f) 에 "cli 패키지 작업이라 별도 PR 로 main 에 먼저 머지했고 `feat/analyze-perf` 에 병합했다" 를
   더했다. 커밋 로그(`64bb18d1`, `59ac58cb`)에서 확인한 사실이다.

## 남은 위험

- 추론 수준 medium 지시는 이 세션이 스스로 확인하거나 바꿀 수 없다. 모델 ID `claude-opus-5-5` 는 확인했다.
- 화면 단언이 문구를 원문으로 고정해, 이후 문구 수정 때 이 테스트도 함께 고쳐야 한다(의도된 고정).
- 설계 §9 첫 항목은 연결 전 상태를 그대로 적고 있다.
