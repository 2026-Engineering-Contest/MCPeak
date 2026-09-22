# 설계 — 중계 세션의 AI 동시 실행 상한

2026-09-22. 대상 패키지: `dashboard` 하나.
전제는 `docs/superpowers/specs/2026-09-22-dashboard-relay-screen-handoff.md` §1.

## 배경

4 단계 「실제 응답」 화면은 스위트 케이스마다 `claude` 를 한 대씩 띄워 사용자 서버를
두드린다. `RelaySessionRegistry.start()` 는 그것을 `Promise.all(plan.cases.map(...))` 로
**전부 동시에** 띄우고, 동시 실행 상한이 한 줄도 없다.

`examples/live-weather-server/server.suite.json`(callTool 케이스 82 개)로 4 단계를 켜자
`claude` 프로세스 82 개가 한꺼번에 기동해 12 코어 머신의 부하 평균이 **73** 까지 올라갔다
(정상 3~4). 중계기와 사용자 서버의 CPU 는 0.0% 였다 — 일한 것은 AI 프로세스들이다.

개발 중 쓰던 `examples/weather-server` 는 8 케이스, E2E 는 2 케이스라 한 번도 드러나지
않았다. 설계 §8 이 "동시 실행의 대가" 를 경고했지만 「한 서버를 같이 친다」로만 읽었고,
N 이 82 가 될 수 있다는 것은 아무도 세지 않았다.

곁딸린 결함이 하나 더 있다. `Promise.all` 은 하나가 reject 하면 `.then` 이 돌지 않아
`done` 이 나가지 않고 `settled` 도 안 풀린다 — 화면이 영영 안 끝난다.

## 선택지

1. **상한만 둔다.** 고정 상수로 동시 실행 수를 막는다. 비용(유료 AI 호출 건수)은 그대로다.
2. 상한 + UI 고지·케이스 선택. 건수·비용을 미리 알리고 고르게 한다.
3. 코어 수에서 상한을 유도한다.

**1 번을 고른다.** 2 번의 비용 문제는 실재하지만 화면·상호작용 설계가 따로 필요해
사용자가 별건으로 논의하기로 했다(핸드오프 §2). 3 번은 머신마다 값이 달라져 **같은 조작의
부하·타이밍 진단이 재현되지 않는다** — 결정론성을 값으로 두는 저장소에서 스스로 재현성을
깎는 선택이다.

## 결정

### 1. 새 모듈 `packages/dashboard/src/server/run-with-limit.ts`

```ts
export async function runWithLimit<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void>
```

일꾼 `limit` 명이 목록을 앞에서부터 하나씩 집어간다. 계약 넷:

- 동시에 진행 중인 worker 는 절대 `limit` 을 넘지 않는다.
- worker 가 throw 해도 풀은 멈추지 않고 남은 항목을 마저 돈다. **실패를 판단하지도,
  모아 두지도 않는다** — 보고는 worker 안의 몫이다. 이 자리의 유일한 소비자가 케이스별
  `aiDone` 으로 자기 실패를 말하므로 삼킴이 숨지 않는다.
- `signal?.aborted` 면 새 항목을 집지 않는다. 이미 진행 중인 것은 기다린다.
- 전부 끝나면(중단된 경우 진행 중이던 것이 끝나면) resolve 한다. **절대 reject 하지 않는다.**

프로세스도 시계도 쓰지 않는 순수 함수다. 동시성 규칙을 중계기 기동 없이 단독으로
검증할 수 있고, `relay-session.ts`(504 줄)의 이미 긴 `start()` 를 더 늘리지 않는다.
`relay-questions.ts` · `relay-lines.ts` · `relay-argv.ts` 와 같은 선례다.

### 2. 상한 값은 고정 상수 6

```ts
/**
 * 동시에 띄우는 AI 수의 상한.
 *
 * 케이스마다 `claude` 를 한 대씩 띄우는데, 82 케이스 스위트를 켜자 82 대가 한꺼번에 떠
 * 12 코어 머신 부하 평균이 73 까지 올라갔다(개당 약 0.9). 6 을 골라 개발 머신에서 체감
 * 대기를 줄이되 부하는 코어 수 안쪽에 둔다.
 *
 * **코어 수에서 유도하지 않는다.** 머신마다 값이 달라지면 같은 조작의 부하·타이밍 진단이
 * 재현되지 않는다. 고정 상수로 두고, 바꿀 때는 이 주석을 같이 고친다.
 */
const RELAY_AI_CONCURRENCY = 6;
```

82 케이스면 14 배치 × 케이스당 10~20 초 = 2.3~4.6 분.

### 3. `relay-session.ts` 변경

- `RelayAiSpec` 에 `readonly signal?: AbortSignal` 을 더한다. 이 타입은 `index.ts` 에서
  export 되지 않는 **패키지 내부 타입**이라 공개 면 변경이 아니다.
- `systemDeps.runAi` 가 그 signal 을 `runProviderProcess` 에 그대로 넘긴다. 그쪽은 이미
  `spec.signal` 을 받아 abort 시 SIGTERM → SIGKILL 로 정리하고 `{ok:false, code:"cancelled"}`
  로 resolve 한다(`packages/generate/src/provider-process.ts:134,215,250`). `generate` 는
  건드리지 않는다.
- `RelaySession` 이 `AbortController` 를 소유하고 AI 쪽에 그 signal 을 준다.
- `close()` 는 **중계기에 신호를 보내기 전에 먼저 `abort()`** 한다. 순서가 반대면 중계기가
  닫히는 사이에 대기열이 새 프로세스를 뱉는다.
- `start()` 의 `Promise.all` 자리:

```ts
void runWithLimit(plan.cases, RELAY_AI_CONCURRENCY, async (relayCase) => {
  let result: { readonly ok: boolean; readonly failure?: string };
  try {
    result = await deps.runAi({ tag, args, stdin, signal: current.aiSignal });
  } catch {
    // runAi 가 reject 해도 이 케이스만 실패로 답한다. 여기서 새면 done 이 영영 안 나간다.
    result = { ok: false, failure: "internal" };
  }
  current.emit({ kind: "aiDone", case: relayCase.id, ok: result.ok, ...failure });
}).then(() => { current.emit({ kind: "done" }); settleAll(); });
```

### 4. 지켜야 할 계약

- 정상 경로에서 케이스는 하나도 빠짐없이 다 돈다.
- 케이스마다 `aiDone` 이 **정확히 한 번**. `case` 는 케이스 **id** 다(꼬리표가 아니다).
- 전부 끝난 **뒤에** `done` 이 나가고 `settled` 가 풀린다.
- `runAi` 하나가 reject 해도 나머지가 돌고 `done` 이 나간다.
- `close()` 뒤에는 새 AI 가 뜨지 않는다. 그래도 `done` · `settled` 는 결국 풀린다 —
  안 그러면 `close()` 를 기다리는 쪽이 매달린다.

### 5. 의도적으로 하지 않는 것

- **중단돼서 한 번도 안 돈 케이스에는 `aiDone` 을 내지 않는다.** 그 칸은 「기다리는 중」에
  남지만, 중단이 일어나는 경우는 사용자가 화면을 떠난 때뿐이라 볼 사람이 없다.
- UI 경고 · 케이스 선택 · 건수 고지를 만들지 않는다(핸드오프 §2, 사용자가 별건으로 논의).
- 상한을 설정으로 빼지 않는다. 필요해지면 그때 연다.

## 테스트

**새 파일 `packages/dashboard/tests/run-with-limit.test.ts`** — 순수, 수동으로 푸는 deferred:

1. 동시 진행 수의 최대치가 `limit` 을 넘지 않는다.
2. 항목을 하나도 빠뜨리지 않는다.
3. worker 가 throw 해도 나머지가 돌고 resolve 한다.
4. abort 뒤엔 새 항목을 집지 않고, 진행 중이던 것이 끝나면 resolve 한다.

**`packages/dashboard/tests/relay-session.test.ts`** — 케이스 12 개짜리 스위트가 필요해
하네스에 `suite` 옵션을 더한다:

1. 동시에 뜨는 `runAi` 수가 6 을 넘지 않는다.
2. 전부 돈다 — `runAi` 호출 수 · `aiDone` 수 = 케이스 수, `done` 은 1 회.
3. `runAi` 하나가 reject 해도 나머지가 돌고 `done` 이 나간다.
4. `close()` 하면 대기열이 멈추고(이후 `runAi` 호출 수가 안 늘어남), 진행 중이던 AI 는
   abort 신호를 받고, `done` · `settled` 는 풀린다.

테스트에서 실제로 기다리지 않는다. 가짜 `runAi` 가 수동으로 푸는 deferred 를 돌려주게 해
진행 순서를 직접 통제한다(`relay-session.test.ts` 의 `manualClock` · `BufferedStderr` 선례).

**각 수정을 빼고 돌려 그 테스트가 빨간 것을 본 뒤 되돌린다**(`CLAUDE.local.md` §2). 전체가
통과하는 것으로는 모자라다.

## 결과

- 82 케이스 스위트에서 동시 `claude` 프로세스가 6 을 넘지 않는다. 부하는 코어 수 안쪽.
- 화면을 떠나면 대기열이 멈추고 진행 중이던 AI 도 정리된다 — 이탈 뒤 살아남는 프로세스 0.
- `runAi` 가 reject 해도 화면이 끝난다.
- **비용은 그대로다.** 82 케이스면 여전히 유료 AI 호출 82 건이 클릭 한 번에 나간다.
  이것은 핸드오프 §2 의 별건으로 남는다.
- 딸린 것: ADR-0106(고정 상한을 고른 이유 · 실행 중 abort 를 고른 이유), changeset 1 건
  (dashboard patch). 커밋 scope 는 `fix(dashboard)`.
