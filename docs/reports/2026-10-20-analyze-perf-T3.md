# analyze-perf T3 보고서 (web 계약)

계획서 `docs/plans/2026-10-20-analyze-성능-카드-perf-연결-구현계획.md` §4 의 구현 기록이다.

## 작업 공간

| 항목 | 값 |
|---|---|
| pwd | `.claude/worktrees/ohmymcp-analyze-perf-T3` |
| 브랜치 | `feat/analyze-perf-T3` |
| `git rev-parse HEAD` | `ecff846ca0c3c5207b7616ca0462b752bc5435df` (커밋하지 않았으므로 BASE 와 같다) |
| BASE (`feat/analyze-perf`) | `ecff846ca0c3c5207b7616ca0462b752bc5435df` |
| T2SHA (대장 `analyze-perf-T2`) | `125c27702b7ca6df697a9033da1c8d403d67db22`, `feat/analyze-perf` 의 조상 확인(`ancestor-ok`) |
| 실행 모델 | `claude-opus-5-5` |

진입 직후 확인: `git status --short` 비어 있음, 계획서 존재, `api-types.ts` 의 `AnalyzePerfResponse` 1건,
`pnpm install`·`pnpm build` 성공, `analyze-pillars.test.ts` 19건 초록.

## 바꾼 파일

- 수정 `packages/dashboard/web/src/analyze/format.ts`: `millis` 추가(§4.3 그대로).
- 수정 `packages/dashboard/web/src/analyze/pillars.ts`: `PillarSummary.baseLabel` 선택 필드(§4.2), 성능 축
  `description` 교체(§4.2), `performanceSummary`(§4.3 그대로). 성능 축 `available` 은 `false` 그대로다.
- 생성 `packages/dashboard/web/src/analyze/build-perf-request.ts`: §4.4 전량 그대로.
- 생성 `packages/dashboard/web/src/analyze/use-performance-analysis.ts`: `use-security-analysis.ts` 복제(§4.5).
- 수정 `packages/dashboard/web/tests/analyze-fixtures.tsx`: `stubFetch` 옵션 넷(`perfStart`·`perfResult`·`suites`·
  `suiteContent`)과 분기, `perfResultRequests` helper. 기존 옵션·분기·호출부는 그대로다.
- 수정 `packages/dashboard/web/tests/analyze-pillars.test.ts`: §4.6 의 픽스처 helper 와 테스트 11건 추가. 기존
  테스트의 단언은 바꾸지 않았다(바뀐 줄은 import 둘뿐이다).
- 생성 `packages/dashboard/web/tests/build-perf-request.test.ts`: §4.6 표의 5건.
- 생성 `packages/dashboard/web/tests/use-performance-analysis.test.tsx`: §4.6 표의 4건.

`packages/dashboard/src/`, `types.ts`, `App.tsx`, `screens/`, `cli`, `perf` 는 건드리지 않았다. web 코드의
`@mcpeak/perf` 참조는 테스트의 `import type` 하나뿐이다.

## 손계산 재확인

- current = round(412.4) + round(600.6) = 412 + 601 = **1013**. 케이스 c 는 `total` 이 없어 0 이다.
- saving = round(299.5) + round(120.4) = 300 + 120 = **420**. `Math.round(299.5)` 는 .5 를 +∞ 쪽으로 올려 300 이다.
  `REPEATED` 는 `perf/repeated-request` 라 단축에 들어가지 않는다.
- after = max(0, 1013 − 420) = **593**.
- 단축 1위 = compare_cities **300** (get_forecast 120 보다 크다).

계획서의 1013, 420, 593, 300 과 모두 같다. 테스트도 이 값으로 통과했다.

## 검증

| 명령 | 결과 |
|---|---|
| 구현 전 표적 3파일 | 실패 확인: pillars 11건 실패(`performanceSummary is not a function`), 새 두 파일은 모듈 없음 |
| `pnpm vitest run --project web …analyze-pillars… …build-perf-request… …use-performance-analysis… …analyze-view…` | 4 파일, 80건 통과 |
| `pnpm build --force` | `Tasks: 10 successful`, `Cached: 0 cached, 10 total` |
| `pnpm typecheck --force` | `Tasks: 10 successful`, `Cached: 0 cached, 10 total` |
| `pnpm lint` | 오류 0, 경고 14(전부 기존 `website/.vitepress/theme/components/HomeLanding.vue`). 처음 1회는 새 테스트 파일의 import 순서 오류가 있어 `biome check --write` 로 그 파일만 고쳤다 |
| `pnpm test` | 257 파일 중 256 통과, 1 실패. 5903건 중 5899 통과, 1 실패, 3 skip |
| `pnpm vitest run --project web` | 64 파일, 985건 통과(web 갈래 파일 수가 0 이 아님을 확인. 에이전트 환경에서는 통과 파일 줄이 감춰져 따로 셌다) |

`pnpm test` 의 실패 1건은 `packages/cli/tests/audit-sandbox-e2e.test.ts` 의 "live-weather 를 --sandbox-session 으로
한 번, --sandbox-replay 로 한 번 돌린 --json 이 sandbox.network 만 다르다"(줄 수 198 기대, 183 수신)다.
오케스트레이터가 지목한 main 의 기존 flaky 이고 이 태스크의 파일과 무관해 고치지 않았다. 실행 전에
`docker ps -a --filter label=mcpeak.audit=1 -q` 와 `pgrep -f "vitest\.mjs|cli\.mjs audit"` 가 둘 다 비어 있음을 확인했다.

## 임의로 판단한 부분

1. **훅 주석의 낱말.** §4.5 는 "타입·경로·이름만 바꾼다" 이다. 코드는 그대로 두었고, 주석의 "점검" 을 "측정" 으로,
   함수 머리 주석의 "보안 축의 분석 상태(설계 §5.4)… 구현계획 §3.3" 을 성능 축과 ADR-0119, 보안 훅의 복제라는
   문장으로 바꿨다. 보안 문장을 성능 훅에 남기면 읽는 사람을 오도하기 때문이다. 이름 치환으로 만든 사본과 diff 하면
   주석 다섯 자리만 다르고 코드 줄은 같다.
2. **훅 테스트의 그리기 방법.** §4.6 은 `security-detail.test.tsx` 에 맞추라 했지만 그 파일은 `AnalyzeView` 를 그린다.
   성능 훅은 T4 전까지 화면에 연결되지 않으므로 `run-stream.test.ts` 처럼 `renderHook` 으로 훅을 직접 그렸다. fake 는
   `security-detail.test.tsx` 와 같이 `stubFetch`·`installFakeEventSource`·`lastSource` 를 쓰고 `beforeEach`·`afterEach`
   (cleanup, `vi.unstubAllGlobals`)도 같은 모양이다.
3. **`/api/suites/<path>` 의 기본 응답.** 이전에는 이 경로가 기본 분기로 떨어져 `"[]"` 200 이었고, 이제 §4.6 대로
   `suiteContent` 에 없으면 404 다. 이 fixture 를 쓰는 `analyze-view`·`security-detail`·`app` 테스트는 이 경로를
   읽지 않아 영향이 없고 전체 실행에서도 초록이다. 본문은 계획서 문장("명세 JSON")대로 `suiteContent` 의 값을 그대로
   싣는다. 실제 서버 응답이 `{ path, content }` 꼴이면 T4 테스트가 그 꼴의 값을 넣으면 된다.
4. **`Object.keys` 단언.** "두 키가 없다" 를 `Object.keys(bare)` 가 `["argv", "suitePath", "repeat"]` 와 같다로 적었다.
   §4.4 의 객체 리터럴 순서가 고정이라 결정론적이다.
5. **기준선 테스트의 첫 단언.** `baseline` + `exitCode: 2` 는 기본 findings 3건을 그대로 둔 채 "회귀" 를 단언했다.
   회귀가 진단 수보다 먼저 판정되는지도 함께 보기 위해서다.

## 남은 위험

- 성능 축은 아직 `available: false` 이고 훅·요청 조립은 화면에 연결되지 않았다(T4 몫). 화면은 지금과 같다.
- (검토 후 수정) `stubFetch` 의 `GET /api/suites/<path>` 분기는 이제 `suiteContent` 의 명세 JSON 을 실제 API 처럼
  `FileContent` `{ path, content: JSON.stringify(content, null, 2), mtimeMs: 0 }` 로 감싸 돌려준다(오케스트레이터 지시,
  계획서 §4.6 사양 정정). 없는 경로 404 는 그대로다. 위 판단 3 의 "본문 그대로" 는 이 수정으로 대체된다.
