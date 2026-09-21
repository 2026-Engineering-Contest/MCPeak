# 핸드오프 — 4 단계 실제 응답 화면, 구현 끝 · 동시 실행 상한부터

새 세션은 여기부터. 2026-09-22 작성.

## 0. 지금 어디인가

**4 단계 「실제 응답」 화면 구현이 끝났고 브랜치가 푸시돼 있다. PR 은 아직 안 열었다.**

```
브랜치: feat/dashboard-relay-screen  (origin 에 푸시됨, 로컬 == origin)
HEAD:   6ee8711
base:   ed928bd (로컬 main 끝)
커밋:   이번 작업 20개 (+ 로컬 main 의 미푸시 32개가 같이 올라가 있음 — §5)
```

게이트(HEAD 기준):

| | |
|---|---|
| `pnpm vitest run packages/dashboard` | 196/196 |
| `pnpm --filter @mcpeak/dashboard test:e2e` | 2/2 (**빌드 필요**) |
| `pnpm vitest run --project web` | 81 실패 / 363 통과 — 실패는 전부 기존 jsdom 고장 |
| typecheck · biome | 0 · 0 |

미커밋: `packages/mock/tests/stdio-e2e.test.ts` **하나뿐이고 사용자 것이다. 커밋 범위에 넣지 마라.**

## 1. 다음 할 일 — 동시 실행 상한

**이것이 첫 번째 작업이다.** 지시는 이미 정해졌고, 작업하던 에이전트를 중단시켰다. **코드는 한 줄도 안 바뀌었다**(파일만 읽고 멈췄다).

### 결함 — 실측으로 확인됐다

`packages/dashboard/src/server/relay-session.ts` 의 `RelaySessionRegistry.start()`:

```ts
// **동시에 띄운다**(설계 §2-3). 케이스들이 한 서버를 같이 치는 대가는 사용자가 알고 고른 것이다.
void Promise.all(
  plan.cases.map(async (relayCase) => { ... deps.runAi(...) ... }),
).then(() => { current.emit({ kind: "done" }); settleAll(); });
```

**동시 실행 상한이 한 줄도 없다.**

사용자가 `examples/live-weather-server/server.suite.json`(callTool 케이스 **82 개**)로 4 단계를 켜자 **`claude` 프로세스 82 개가 한꺼번에 기동**해 12 코어 머신의 부하 평균이 **73** 까지 올라갔다(정상 3~4). 중계기와 사용자 서버는 0.0% 였다 — 일한 것은 AI 프로세스들이다.

`examples/weather-server` 는 8 케이스, E2E 는 2 케이스라 개발 중엔 한 번도 안 보였다. 계획서·설계·리뷰 8 회가 전부 놓쳤다. 설계 §8 이 "동시 실행의 대가" 를 경고했지만 **「한 서버를 같이 친다」로만 봤고 N 이 82 가 될 수 있다는 것은 아무도 세지 않았다.**

### 사용자가 고른 것 — 1 번(상한만)

- 상한은 **이름 있는 상수**로, 4~6 사이에서 정하고 **왜 그 값인지 주석에 적는다.**
- **코어 수에서 유도하지 마라.** 머신마다 부하 특성이 달라지면 같은 조작의 진단이 어려워진다. 고정 상수로 두고 이유를 적는다.
- **UI 경고·케이스 선택 기능을 만들지 마라** — 사용자가 따로 논의하겠다고 했다(§2).

### 지켜야 할 계약

- 케이스는 하나도 빠짐없이 결국 다 돈다.
- 케이스마다 `aiDone` 이 정확히 한 번. `case` 는 케이스 **id** 다(꼬리표 아님).
- 전부 끝난 **뒤에** `done` 이 나가고 `settled` 가 풀린다.
- **`runAi` 하나가 reject 해도 나머지가 돌고 `done` 이 나가야 한다.** 지금은 `Promise.all` 이라 하나가 reject 하면 `.then` 이 안 돈다 → 화면이 영영 안 끝난다. 같이 고쳐라.

### ⚠️ 상한이 새로 여는 위험 — 대기열 중단

**이 수정에서 제일 중요한 자리다.** 지금은 전부 이미 떠 있어서 문제가 없다. 상한을 두면 **대기열이 생기고**, 세션이 닫힌 뒤에도 대기열이 계속 프로세스를 뱉는 길이 **새로 열린다** — 사용자가 「이전」·「실행 시작」·화면 이탈로 닫았는데 70 개가 더 뜨는 것이다.

- `RelaySession.close()` 가 불리면 **대기열을 멈춘다. 선택이 아니다.**
- 이미 떠 있는 AI 를 죽일지는 판단 사항. `runProviderProcess` 는 `spec.signal` 로 `AbortSignal` 을 받는다(`packages/generate/src/provider-process.ts`). 깔끔히 붙으면 붙이고, 아니면 대기열 중단만 하고 근거를 남겨라.
- 닫힌 뒤에도 `done`·`settled` 는 결국 풀려야 한다 — 안 그러면 `close()` 를 기다리는 쪽이 매달린다.

### 회귀 테스트 넷 (`packages/dashboard/tests/relay-session.test.ts`)

1. 동시에 뜨는 수가 상한을 넘지 않는다 (가짜 `runAi` 가 진행 중 개수의 최대치를 기록, 케이스 12 개)
2. 전부 돈다 (`runAi` 호출 수 · `aiDone` 수 = 케이스 수)
3. 하나가 reject 해도 나머지가 돌고 `done` 이 나간다
4. 닫으면 대기열이 멈춘다 (상한만큼 진행 중일 때 `close()`, 이후 `runAi` 호출 수가 안 늘어남 + `done`·`settled` 는 풀림)

**각 수정을 빼고 돌려 빨간 것을 본 뒤 되돌려라.** 테스트에서 실제로 기다리지 마라 — 가짜 `runAi` 가 수동으로 푸는 deferred 를 돌려주게 해 진행 순서를 직접 통제해라. 이 파일에 gate 기법 선례가 있다.

## 2. 사용자와 논의할 것 — 「전부 보여줄지」

**사용자가 따로 얘기하겠다고 했다. 먼저 만들지 마라.**

상한만으로는 안 풀리는 것:

- 82 케이스면 여전히 **유료 AI 호출 82 건**이 클릭 한 번에 나간다. 부하는 잡혀도 비용은 그대로다.
- 상한 5 기준 82 개를 순차 처리하면 17 배치 × 케이스당 10~20 초 = 꽤 걸린다.

후보(정해진 것 아님): 4 단계 진입 전 건수·비용 고지 후 확인 / 케이스를 골라서 보기 / "최대 N 건까지만" 기본값.

## 3. 무엇이 지어졌나

3 단계에 체크박스 `판정 전에 서버의 실제 응답을 본다` → 켜면 4 단계가 붙는다. 중계기를 띄우고 스위트 케이스마다 `claude` 를 동시에 돌려 사용자 서버를 두드린 뒤, **중계기가 서버에서 직접 받은 본문**을 케이스별 칸으로 보여준다. 떠날 때는 중계기를 먼저 닫고 나서 판정 실행을 시작한다.

| 파일 | 무엇 |
|---|---|
| `src/server/relay-questions.ts` | 스위트 → 케이스 목록·질문. 순수. 꼬리표(`c1`…)를 대시보드가 매긴다 |
| `src/server/relay-argv.ts` | AI argv. `--allowedTools` 필수, `--json-schema` 없음 |
| `src/server/relay-lines.ts` | 중계기 stderr → 타입 있는 줄. JSON 아닌 줄은 세어 건너뜀 |
| `src/server/relay-session.ts` | 중계기·AI N 개의 수명. 프로세스 기계는 전부 주입 |
| `src/server/routes.ts` | `POST /api/relay` · SSE · `DELETE` |
| `web/src/relay/case-cards.ts` | 이벤트 → 케이스 칸. 순수 |
| `web/src/relay/close-first.ts` | 닫기 먼저 순서 |
| `web/src/relay/unload-close.ts` | `pagehide` 정리 |
| `web/src/home/steps/StepRelay.tsx` | 4 단계 화면 |

`@mcpeak/mock` 에 케이스 꼬리표(`?case=`)도 같이 넣었다(선행 블로커였다). ADR-0105, changeset 2 개 포함.

## 4. 계획서가 틀렸던 것 — 이미 정정해 뒀다

구현·리뷰가 잡은 계획서 자체의 결함 6 개. 전문은 `docs/superpowers/plans/2026-09-21-dashboard-relay-screen.md` 끝 절에 있다.

1. 후보 서버 env 값을 구해 놓고 **버렸다** → 중계기가 기동 전에 죽고 엉뚱한 오류
2. 응답 줄 파싱에 `case` 처리 누락 → 꼬리표가 통째로 사라질 자리
3. `useEffect(…, [])` 가 첫 렌더 클로저를 붙잡아 **언마운트에서 아무것도 안 닫음**
4. `openRelay` 무방비 → 중계기 두 번 열리면 앞의 것을 영영 못 닫음
5. `close()` 가 5 초 타이머로 **무조건 "닫혔다"** → 판정 실행이 서버를 두 벌 띄움
6. 닫기 실패 안내가 "새로고침하세요" 인데, 새로고침하면 `relayId` 가 사라져 **영영 못 닫음**

**7 번이 §1 의 동시 실행 상한이다 — 아직 안 고쳤다.**

## 5. 함정 — 이번에 실제로 밟은 것

- **`corepack pnpm build` 를 쓰지 마라. `pnpm build` 다.** `/opt/homebrew/bin/pnpm` 은 v12 지만 **직접 실행하면** `packageManager: pnpm@10.34.5` 를 읽고 스스로 버전을 바꾼다. corepack 아래서는 그 자동 전환이 꺼지고, turbo 가 하위 빌드를 부를 때 그 컨텍스트를 물고 가 `ERR_PNPM_BAD_PM_VERSION` 으로 터진다. `CLAUDE.local.md` §5 의 "corepack pnpm 을 쓰거나 shim" 은 **pnpm 이 PATH 에 아예 없을 때** 얘기다.
- **`test:e2e` 는 빌드 뒤에만 의미가 있다.** `relayBinPath()` 가 `packages/mock/dist/relay.mjs` 를 띄운다. 루트 `vitest.config.ts` 의 `NEEDS_BUILD` 로 `pnpm test` 에서 빼 두었고, `packages/dashboard/vitest.e2e.config.ts` + CI `build` 잡 스텝이 돌린다. **`pnpm test` 가 초록이어도 이 스펙은 안 돈 것이다.**
- **`web` 6 파일 81 건이 기존 jsdom 고장으로 빨갛다**(`window.localStorage.clear is not a function`). **`home.test.tsx` 가 35/35 전부 빨강이라 홈 회귀를 로컬에서 볼 수 없다.** 새 UI 테스트는 새 파일에 쓰고 `localStorage.clear()` 를 부르지 마라 — 그것만 안 부르면 jsdom + RTL 은 정상 동작한다.
- **`toEqual` 은 `{case: undefined}` 를 `{}` 와 같다고 본다.** 필드 부재가 계약인 자리는 `toStrictEqual` 이어야 한다. `toThrow(문자열)` 부분 일치와 같은 계열이다.
- **turbo 캐시가 낡은 dist 를 복원해도 빌드는 성공으로 찍힌다.** 의심되면 고친 심볼을 `dist` 에서 grep 하고, 없으면 그 패키지에서 `npx tsdown --config-loader native`.

## 6. 남긴 별건 (이슈 권장)

1. **`toCaseCards` 의 짝짓기** — 지금은 「같은 꼬리표의 직전 요청이 `tools/call` 이었나」로 본다. 응답이 늦게 오면 결과가 어느 칸에도 안 들어가고 칸이 **영영 「기다리는 중」**에 머문다(중계기는 멀쩡한 답을 기록해 뒀는데). 제대로 고치려면 `call`/`result` 이벤트에 중계기 `id` 를 실어 id 로 짝지어야 한다 — 공개 면 변경이라 changeset 이 필요하다.
2. **유휴 수거가 요청 기반**이라 사용자가 영영 안 돌아오면 마지막 한 세션은 안 잡힌다.
3. **web jsdom 고장 81 건** — 이번 작업과 무관하지만 홈 회귀를 못 보게 막는다.
4. `Home.tsx` 가 `model: "sonnet"` 고정. UI 가 읽는 데가 없다.
5. 스위트에 중복 `id` 가 있으면 React key 가 충돌한다(꼬리표는 구분되므로 칸 분리 자체는 살아 있다).

## 7. 푸시·PR 상태와 §5 의 주의

브랜치는 푸시돼 있지만 **PR 은 안 열었다.**

**주의: 푸시에 52 커밋이 나갔다.** 이번 작업은 20 커밋인데, 이 브랜치가 로컬 `main` 위에 서 있고 그 `main` 이 `origin/main` 보다 32 커밋 앞서 있었다(중계기 1 단계 전체, generate T2, ADR-0101~0104, changeset 들). 그대로 PR 을 열면 세 단계 작업이 한 PR 에 섞인다.

로컬 `main` 은 `origin/main` 보다 **2 커밋 뒤처져** 있기도 하다(`Version Packages` — changeset 파일 하나 삭제).

사용자와 정할 것: 그대로 PR / `main` 을 먼저 푸시해 이 PR 을 20 커밋으로 줄이기 / `origin/main` 위로 리베이스. **리베이스·머지·푸시 정책은 `CLAUDE.local.md` §4 대로 사람이 정한다.**

## 8. 직접 돌려보는 절차

```bash
cd /Users/cheonjamin/projects/mcptest
pnpm build                                   # corepack 없이! (§5)
echo "${ANTHROPIC_API_KEY:+API_KEY 있음}${CLAUDE_CODE_OAUTH_TOKEN:+OAUTH 있음}"
node packages/dashboard/dist/dashboard-cli.mjs --port 7357
```

저장소 루트에서 띄워야 `examples/` 가 보인다. 1 단계 `weather` → 2 단계 `examples/weather-server/server.suite.json`(**8 케이스 — `live-weather-server` 는 82 케이스라 §1 전에는 쓰지 마라**) → 3 단계 체크박스 → 다음.

볼 것: `get_weather` 칸의 `성공 · 97바이트` + 본문 / `add` 케이스의 「툴 오류」 또는 **「호출 없음」** / 「이전」·「실행 시작」·새로고침 뒤 `ps aux | grep relay` 로 잔존 없는지.

## 9. 진행 기록

`.superpowers/sdd/progress.md` 에 태스크별 커밋·리뷰 결과·되돌려-빨강 증거·triage 가 전부 있다. 각 태스크 보고서는 `.superpowers/sdd/t3-task-N-report.md`.

**규칙은 `CLAUDE.md` 와 `CLAUDE.local.md` 가 전부다. 푸시·머지·리베이스는 사람이 한다.**
