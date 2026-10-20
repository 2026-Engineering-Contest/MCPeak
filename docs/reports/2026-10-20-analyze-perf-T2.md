# analyze-perf T2 보고서: dashboard 서버 계약 (2026-10-20)

계획서 `docs/plans/2026-10-20-analyze-성능-카드-perf-연결-구현계획.md` §3 의 구현 결과다.

## 작업 공간

| 항목 | 값 |
|---|---|
| pwd | `.claude/worktrees/ohmymcp-analyze-perf-T2` |
| 브랜치 | `feat/analyze-perf-T2` |
| git rev-parse HEAD | `df28bd22af86b30c9c941a0bf51b002fe3c6d8e0` (커밋하지 않았으므로 BASE 와 같다) |
| BASE (`feat/analyze-perf`) | `df28bd22af86b30c9c941a0bf51b002fe3c6d8e0` |
| T1SHA (대장 `analyze-perf-T1`) | `fed659842ec974b6839240dbd3859cdbf871965b` (BASE 의 조상 확인됨) |
| cli 재export | `feat/analyze-perf:packages/cli/src/commands.ts` 에 `nodePerfDependencies` 1회 |

진입 확인: 계획서와 ADR-0119 존재, `git status --short` 빈 상태, `pnpm install`·`pnpm build` 성공,
`analyze-security.test.ts` 40 통과.

## 바꾼 파일

- `packages/dashboard/package.json`: `dependencies` 에 `"@mcpeak/perf": "workspace:*"` 한 줄(`@mcpeak/audit` 다음)
- `pnpm-lock.yaml`: `pnpm install` 이 바꾼 것만
- `packages/dashboard/src/api-types.ts`: `PerfReport` import, `RunFlow` 에 `"perf"`, `AnalyzePerfRequest`·`AnalyzePerfResponse` (§3.2 그대로)
- `packages/dashboard/src/server/analyze-perf.ts` (생성): §3.3 시그니처, §3.4·§3.5 본문 그대로
- `packages/dashboard/src/server/routes.ts`: §3.6 (옵션 두 개, `PERF_PATH`, `perfSlots`, POST·GET 라우트, `GET /api/runs` 필터)
- `packages/dashboard/tests/analyze-perf.test.ts` (생성): §3.7 의 14개
- `packages/dashboard/tests/routes.test.ts`: helper 네 번째 인자 `perf?` 와 §3.7 의 5개
- `packages/dashboard/web/src/screens/RunView.tsx`: `FLOW_TITLES` 에 `perf: "성능 측정",` 한 줄

`git diff --stat pnpm-lock.yaml`:

```
 pnpm-lock.yaml | 3 +++
 1 file changed, 3 insertions(+)
```

추가된 세 줄은 `packages/dashboard` importer 의 `'@mcpeak/perf': specifier: workspace:*, version: link:../perf` 뿐이다.

## 검증

| 명령 | 결과 |
|---|---|
| 구현 전 `pnpm vitest run packages/dashboard/tests/analyze-perf.test.ts packages/dashboard/tests/routes.test.ts` | 실패 확인: 2 파일 실패(analyze-perf 는 모듈 없음), routes 5 실패 |
| `pnpm vitest run packages/dashboard/tests/analyze-perf.test.ts packages/dashboard/tests/routes.test.ts packages/dashboard/tests/dependency-boundary.test.ts` | 3 파일, 106 통과 |
| `pnpm build --force` | `Tasks: 10 successful, 10 total`, `Cached: 0 cached, 10 total` |
| `pnpm typecheck --force` | `Tasks: 10 successful, 10 total`, `Cached: 0 cached, 10 total` |
| `pnpm lint` | 오류 0, 경고 14 (전부 `website/.vitepress/theme/components/HomeLanding.vue`, 이 작업 전부터 있던 것) |
| `pnpm test` | exit 0. `Test Files 255 passed (255)`, `Tests 5880 passed, 3 skipped (5883)` |

`pnpm test` 출력의 `✗ seoul-weather …`·`1 failed (1 total)` 줄은 실패를 기대하는 CLI 테스트가 찍는 출력이고 판정은
통과다. 오케스트레이터가 알려 준 기존 flaky(`audit-sandbox-e2e.test.ts` 의 live-weather 1건)는 이번 실행에서는
실패하지 않았다.

처음 `pnpm lint` 는 내가 쓴 세 파일(`routes.ts`, `analyze-perf.test.ts`, `routes.test.ts`)의 포맷·import 정렬로
4 오류였다. `biome check --write` 를 그 세 파일에만 돌려 고쳤다. `analyze-perf.ts` 는 포맷 수정 대상이 아니었고
§3.4·§3.5 본문 글자는 그대로다.

## 임의로 판단한 부분

1. `analyze-perf.ts` 에 모듈 설명 주석과 `preparePerfRun`·`analyzePerf`·`firstLine` 위의 한 줄 JSDoc 을 더했다.
   `analyze-security.ts` 의 주석 밀도에 맞춘 것이고 함수 본문은 바꾸지 않았다.
2. `preparePerfRun` 은 계획대로 동기 함수라 `handleAnalyzePerf` 에서 `await` 없이 부른다. 보안 쪽 `prepare` 는 비동기라
   이 한 줄만 다르다.
3. `isAnalyzePerfRequest` 는 `repeat` 의 타입(number)만 보고 범위·정수 여부는 `preparePerfRun` 에 맡겼다. 사양 문장
   ("`repeat` number 또는 없음")을 그대로 따른 것이다.
4. `GET /api/analyze/perf/<runId>` 라우트는 `GET /api/runs` 바로 앞에 두었고, 목록 필터 위 주석을 점검·측정 둘을 함께
   말하도록 고쳤다.
5. routes 테스트의 fake 는 보안의 `fakeSecurity` 꼴을 줄인 `fakePerf` 다(prepare 는 정한 결과, analyze 는 받은 argv 를
   남긴다). "형식이 틀린 본문" 테스트는 `GET /api/runs` 길이 비교에 더해 `registry.list()` 가 비었는지도 본다.
   "목록에 없다" 테스트는 `flow` 에 `perf` 가 없다는 것에 더해 길이가 1(test run 하나)인지도 본다.
6. `analyze-perf.test.ts` 의 `REPORT` 는 계획 §4.6 의 `perfCase`·`sequential` helper 를 이 파일에 복제해 같은 필드·값으로
   만들었다(`REPEATED` 는 인라인).
7. 404 문장은 보안의 "점검이 아닌 run id" 테스트에 해당하는 perf 판(다른 flow 의 runId 로 GET)을 따로 만들지 않았다.
   계획 §3.7 표에 없기 때문이다. `perfSlots` 가 `securitySlots` 와 분리돼 있어 같은 갈래로 404 가 난다.

## 남은 위험

- 실행 지시는 추론 수준 high 였다. 이 세션은 모델 ID `claude-opus-5-5` 는 확인했지만 추론 수준은 스스로 확인하거나
  바꿀 수 없다.
- 실제 `runPerfCommand` 와 `nodePerfDependencies` 를 끼운 경로는 fake 로더로만 검증했다. 실서버 측정은 C3(사람 확인)
  몫이다.
- `onSignal` 이 대시보드 프로세스에 SIGINT·SIGTERM·SIGHUP 처리기를 측정 동안 단다. 측정 중 대시보드를 Ctrl+C 로
  끝내면 perf 가 정리 뒤 `killSelf` 로 같은 신호를 재발신한다. 의도된 동작(ADR-0119)이지만 동시에 도는 다른 run 도 함께
  끝난다.
