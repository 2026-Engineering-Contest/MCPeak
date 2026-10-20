# analyze-perf T4c 보고서 (최종 리뷰 결함 수정)

커밋은 하지 않았다.

## 작업 공간

| 항목 | 값 |
|---|---|
| pwd | `.claude/worktrees/ohmymcp-analyze-perf-fix` |
| 브랜치 | `feat/analyze-perf-fix` |
| HEAD = `feat/analyze-perf` | `41462c3750dbf0a10df8f35f3cdc056647a66edf` |

T4 worktree(7488 대시보드가 쓰는 곳)에서는 worktree 생성 명령만 실행했고 파일은 바꾸지 않았다.

## 변경 파일

- `packages/dashboard/web/src/screens/AnalyzeView.tsx`
  - 사유 상수 `PERF_RUNNING_REASON = "성능 측정이 끝난 뒤 다시 할 수 있습니다."` 추가.
  - `SecurityDetail` 이 `perfRunning` 을 받아 "다시 점검" 을 비활성으로 두고 버튼 옆에 사유 줄을 보인다.
  - `TokensDetail` 이 `perfRunning` 을 받아 "다시 분석" 을 막는다(아래 "추가" 절의 방식으로 최종 정리).
- `packages/dashboard/web/src/analyze/PerformanceResult.tsx`
  - 결과 화면의 "다시 측정" 이 `performanceUnavailable(transport) ?? (otherRunning ? OTHER_RUNNING_REASON : null)` 로
    비활성 판정·사유를 정한다. 지금 대상이 원격이면 비활성이고 원격 사유 문장이 보인다.
  - 68행 문서 주석을 "결과는 PerformanceResult 가 구획으로 그린다. rendered 원문은 보이지 않는다." 로 바꿨다.
- `packages/dashboard/web/tests/performance-detail.test.tsx`: 행동 테스트 둘 추가.
  - "성능이 도는 동안 다시 점검을 누를 수 없다": 보안 done 상태에서 성능 시작 뒤 SSE done 전에 보안 상세를 열면 다시
    점검이 disabled 이고, 눌러도 보안 POST 는 1회 그대로다.
  - "원격 대상으로 바꾸면 다시 측정이 비활성이다": stdio 로 성능 done 뒤 대상 바꾸기 → HTTP URL 로 바꾸면 다시 측정이
    disabled, 원격 사유 문장이 화면에 있고, 눌러도 `POST /api/analyze/perf` 는 1회 그대로다.
- `packages/dashboard/web/vite.config.ts` (오케스트레이터가 추가 허용): `testAliases` 를 `["audit", "core", "perf"]` 로,
  주석을 지시한 문장으로 바꿨다.

## 검증

| 명령 | 결과 |
|---|---|
| `pnpm vitest run --project web .../performance-detail.test.tsx .../analyze-view.test.tsx` | 2 파일, 61 테스트 통과 |
| CI 재현, 고치기 전: `packages/perf/dist` 를 치운 뒤 `pnpm vitest run --project web .../performance-view.test.ts` | `Failed to resolve entry for package "@mcpeak/perf"`, 1 파일 실패, 테스트 0 (재현됨) |
| CI 재현, 고친 뒤: 같은 조건 | 1 파일, 4 테스트 통과 |
| dist 원위치 | 두 번 모두 `mv` 로 되돌렸고 `packages/perf/dist` 에 `index.cjs` 등이 있음을 확인 |
| `pnpm build --force` | `Tasks: 10 successful`, `Cached: 0 cached, 10 total` |
| `pnpm typecheck --force` | `Tasks: 10 successful`, `Cached: 0 cached, 10 total` |
| `pnpm lint` | `Checked 786 files`, 오류 없음 |
| `pnpm test` | 259 파일 전부 통과, 5927 통과, 3 skip, 실패 0 (live-weather flaky 도 이번에는 통과) |

## 추가: 비용 상세 "다시 분석" 을 실제로 비활성으로 (오케스트레이터 허용)

첫 보고에서는 "다시 분석" 버튼이 허용 Files 밖(`SourceEditCard.tsx`)에 있어 누름을 무시하는 우회만 두었다.
오케스트레이터가 두 파일을 허용해 고쳤다.

- `packages/dashboard/web/src/analyze/SourceEditCard.tsx`: 선택 prop `reanalyzeDisabledReason?: string | null`
  (기본 null). 문장이면 "다시 분석" 이 disabled 이고 그 문장을 버튼 옆에 보인다. null 이면 예전과 같다.
- `packages/dashboard/web/src/analyze/TokensResult.tsx`: 같은 prop 을 받아 그대로 넘긴다(기본 null).
- `packages/dashboard/web/src/screens/AnalyzeView.tsx`: `TokensDetail` 이 성능 running 이면 `PERF_RUNNING_REASON` 을
  넘긴다. 결과 위 사유 줄과 `onReanalyze` 무시 우회는 지웠다.
- `packages/dashboard/web/tests/performance-detail.test.tsx`: "성능이 도는 동안 다시 분석을 누를 수 없다" 추가
  (비용 done, 성능 시작 뒤 SSE done 전에 비용 상세에서 소스 수정을 적용하면 다시 분석이 disabled 이고, 눌러도
  `POST /api/analyze/tokens` 는 1회 그대로).

재검증

| 명령 | 결과 |
|---|---|
| `pnpm vitest run --project web .../performance-detail.test.tsx .../analyze-view.test.tsx` | 2 파일, 62 테스트 통과 |
| `pnpm build --force` | `Tasks: 10 successful`, `Cached: 0 cached, 10 total` |
| `pnpm typecheck --force` | `Tasks: 10 successful`, `Cached: 0 cached, 10 total` |
| `pnpm lint` | `Checked 786 files`, 오류 없음 |
| `pnpm test` | 259 파일 전부 통과, 5928 통과, 3 skip, 실패 0 |

## 임의 판단

1. **prop 은 boolean 대신 사유 문장 하나(`reanalyzeDisabledReason`)로 했다.** 비활성 판정과 사유 줄을 한 값이 정해
   어긋날 수 없고, 사유 줄을 보안처럼 버튼 옆에 둘 수 있다. 다른 호출부는 없고, 주지 않으면 예전과 같다.
2. 테스트에서 성능을 먼저 시작하고 그 뒤에 비용 상세에서 소스 수정을 적용한다. 상세를 오가면 `SourceEditCard` 가
   다시 마운트되어 적용 상태(다시 분석 버튼)가 지워지기 때문이다.
3. "다시 측정" 의 사유는 원격이 다른 축 실행보다 앞선다(상세 폼의 사유 순서와 같다).
4. CI 재현 때 perf dist 를 치워 둔 곳은 지시한 다른 세션의 scratchpad 가 아니라 이 세션의 scratchpad
   (`<세션 scratchpad>/perf-dist-bak`)
   다. 남의 세션 디렉터리에 쓰지 않으려는 것이고, 동작은 같다.
