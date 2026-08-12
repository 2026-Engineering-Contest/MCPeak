# Task B3 보고서 — 간헐 실패 제거 (벽시계 1초 마감)

## 결론 먼저

**status: BLOCKED (부분 완료)**

허용된 3개 파일의 근거 없는 1초 마감은 전부 고쳤고, 그 범위에서는 부하 유무와 무관하게 50회
연속 녹색이다. 그러나 **태스크의 완료 조건인 "수정 후 `pnpm test` 실패 0회"는 달성하지 못했다.**
실측해 보니 실제로 흔들리던 테스트는 지시받은 두 파일이 아니라 `packages/core/tests/stdio-integration.test.ts`
였고, `core/`는 수정 금지 목록에 있다. 고치지 않고 보고한다.

## 작업 공간

- pwd: `/Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-cli-flaky-deadline`
- 브랜치: `fix/cli-flaky-deadline`
- `git rev-parse HEAD`: `1921d4c7fdcea907069a4d8e585cf705ac8d2f65`
- 기점 커밋: `1921d4c merge(cli): Task B2 입력 종료 처리 통합` (지시받은 값과 일치)
- 진입 시 `git status --short` 비어 있음. `pnpm install` 후 `pnpm build`,
  `pnpm vitest run packages/cli` (67 passed) 실행 확인

## 변경 파일

| 파일 | 내용 |
|---|---|
| `packages/cli/tests/cli-integration.test.ts` | `expectExited` 폴링 재작성 + 근거 상수 3개 + 진단 메시지 |
| `packages/cli/tests/generate-integration.test.ts` | `exited` 동일 |
| `packages/cli/tests/dist-cli-e2e.mjs` | `expectExited` 동일 (같은 1초 패턴이 있었다) |
| `docs/reports/task-b3.md` | 이 보고서 |

changeset은 만들지 않았다. 근거: `packages/cli/package.json`의 `files`가 `["dist"]`라
테스트 파일은 배포물에 들어가지 않는다. 사용자에게 보이는 변화가 없어 릴리스 노트에 실을 것이
없다.

## 1. 진짜 원인 (지시받은 가설과 다르다)

수정 전 상태로 `pnpm test`를 **20회** 돌렸다. 인위적 부하 없이도 재현됐다.

```
FAIL run 1
     × handshake timeout 뒤 프로세스를 정리한다 324ms
FAIL run 5   × handshake timeout 뒤 프로세스를 정리한다 376ms
FAIL run 15  × handshake timeout 뒤 프로세스를 정리한다 373ms
FAIL run 20  × handshake timeout 뒤 프로세스를 정리한다 386ms
=== before-noload: 4 failed / 20 runs ===
```

**4/20 전부 같은 테스트이고, 그 테스트는 `packages/cli`가 아니다.**

```
 FAIL  packages/core/tests/stdio-integration.test.ts > stdio 실제 프로세스 > handshake timeout 뒤 프로세스를 정리한다
Error: expect(received).toSatisfy()
Received: undefined
 ❯ assertNoResidue packages/core/tests/stdio-integration.test.ts:39:15
```

`packages/core/tests/stdio-integration.test.ts:29`의 메커니즘이다.

```ts
for (let attempt = 0; attempt < 20 && pid === undefined; attempt += 1) {
  ...
  else await new Promise((resolve) => setTimeout(resolve, 10));
}
```

PID 파일이 나타나기를 **20회 × 10ms = 200ms**만 기다린다. 이 테스트는 `connectTimeoutMs: 100`으로
handshake를 일부러 태우므로, 자식 node가 200ms 안에 기동해 PID 파일을 쓰지 못하면 `pid`가
`undefined`인 채로 단언에 걸린다. 실패한 실행들의 소요가 324~386ms인 것이 이와 맞는다.

즉 결함의 **성격**은 리뷰어 진단대로 "벽시계 예산이 프로세스 기동에 비해 작다"가 맞지만,
**위치**는 `packages/cli`가 아니라 `packages/core`다. 내가 앞서 B2 보고에서 지목한 cli의 1초
마감은 이번 20회 실행에서 한 번도 발화하지 않았다.

## 2. 그럼에도 cli 3개 파일을 고친 이유

1초라는 값에 근거가 없었던 것은 사실이고, 태스크가 명시적으로 허용한 범위다. 실측으로 값을
정했다.

`exited`/`expectExited`에 임시 계측을 넣고 실제 종료 지연을 측정했다.

- 무부하 `pnpm vitest run packages/cli --reporter=verbose`: 전부 `0ms`
- **15코어 전부를 포화**시킨 상태에서 12회 실행, 표본 60개:

  ```
  --- max per helper ---
  cli-integration max=1ms
  generate-integration max=1ms
  --- overall distribution ---
    58 0
     2 1
  ```

이유는 명확하다. 이 헬퍼가 불리는 시점에는 CLI가 이미 자식의 종료를 `await`한 뒤라, 정상
경로는 **첫 폴링에서 끝난다.** 즉 1초 마감은 실측 최악값의 1000배였고 발화한 적이 없다.
계측 코드는 측정 후 전부 제거했다(최종 diff에 `MEASURE` 문자열 없음).

부하는 이렇게 줬다.

```bash
CORES=$(sysctl -n hw.ncpu)          # 15
for _ in $(seq 1 "$CORES"); do yes > /dev/null & done
```

## 3. 고친 내용

세 파일 모두 같은 모양으로 바꿨다.

```ts
const EXIT_TIMEOUT_MS = 3_000;
const EXIT_POLL_INTERVAL_MS = 20;
const EXIT_MIN_POLLS = 25;

const started = Date.now();
for (let polls = 1; ; polls += 1) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (ESRCH) return;
    throw error;
  }
  const elapsed = Date.now() - started;
  if (polls >= EXIT_MIN_POLLS && elapsed >= EXIT_TIMEOUT_MS) throw new Error(진단 메시지);
  await new Promise((r) => setTimeout(r, EXIT_POLL_INTERVAL_MS));
}
```

**값의 근거** (전부 주석으로 코드에 남겼다)

- `EXIT_TIMEOUT_MS = 3_000`: 실측 최악값 1ms의 3000배. 동시에 vitest 기본 테스트 타임아웃
  5초보다 짧아야 한다. 그래야 vitest의 무의미한 타임아웃 메시지 대신 우리 진단 메시지가
  먼저 나온다. 위아래가 다 막힌 구간에서 고른 값이다.
- `EXIT_POLL_INTERVAL_MS = 20`: 정상 경로는 첫 폴링에서 끝나므로 이 값은 비정상 상황에서만
  의미가 있다. 20ms면 3초 동안 150회를 확인하면서 busy spin으로 CPU를 뺏지 않는다.
- `EXIT_MIN_POLLS = 25`: **이것이 흔들림을 막는 핵심이다.** 부하로 이벤트 루프가 밀리면
  벽시계만 지나가고 실제 확인은 몇 번 못 한 채 실패로 판정될 수 있다. 최소 25회는 실제로
  확인한 뒤에만 실패로 본다. 즉 마감을 늘린 것이 아니라 **판정 근거를 벽시계에서 실제 확인
  횟수로 옮겼다.** 정상 경로의 소요 시간은 그대로 0ms다.

**진단 메시지**. 기존 문구 `weather-server PID가 1초 안에 종료되지 않았습니다.`는 무엇을
확인할지가 없었다. 실제 PID, 경과 시간, 확인 횟수, 다음에 볼 곳을 담았다.

## 4. 안전장치가 실제로 동작하는지 확인

종료되지 않는 PID(측정 스크립트 자기 자신)를 넣어 태웠다.

```
걸린 시간: 3014ms
메시지 원문:
weather-server(PID 44498)가 3014ms 동안 141회 확인에도 종료되지 않았습니다. 확인: `ps -p 44498`로 생존 여부를 보고, examples/weather-server/server.mjs의 종료 처리와 CLI의 connection close 경로에 좀비 프로세스가 남는지 확인하세요.
```

3초 안전장치가 걸리고, 141회 실제 확인 후 발화하며, PID와 경과 시간과 다음 조치가 들어 있다.

## 5. 수정 후 실측

간헐 결함이므로 횟수로 적는다.

| 대상 | 부하 | 실행 | 실패 |
|---|---|---|---|
| `pnpm vitest run packages/cli` | 없음 | 25 | **0** |
| `pnpm vitest run packages/cli` | 15코어 포화 | 25 | **0** |
| `pnpm test` (전체) | 없음 | 25 | **2** (전부 `packages/core`) |

수정 전 대조군: `pnpm test` 무부하 20회 중 4회 실패.

전체 실행에 남은 2회는 모두 `packages/core/tests/stdio-integration.test.ts >
handshake timeout 뒤 프로세스를 정리한다`이며 내 변경과 무관하다.

```
FAIL run 7   × handshake timeout 뒤 프로세스를 정리한다 342ms
FAIL run 10  × handshake timeout 뒤 프로세스를 정리한다 354ms
=== after-full-noload: 2 failed / 25 runs ===
```

## 6. 검증 명령과 결과

```
pnpm vitest run packages/cli → Test Files 5 passed (5) / Tests 67 passed (67)
pnpm --filter ohmymcp test:e2e → 정상 종료 (출력 없음, exit 0)
pnpm build     → Tasks: 6 successful, 6 total
pnpm typecheck → Tasks: 6 successful, 6 total
pnpm lint      → Checked 97 files in 29ms. No fixes applied.
pnpm test      → Test Files 27 passed (27) / Tests 253 passed (253)
```

검사 대상 0개 거짓 신호 점검:

- 린트 `Checked 97 files` (0 아님)
- 타입체크는 성공 시 무출력이라 별도로
  `cd packages/cli && npx tsc --noEmit --listFiles | grep -c "worktrees/ohmymcp-cli-flaky-deadline/packages/cli/"`
  → **9**
- `dist-cli-e2e.mjs`는 vitest 수집 대상이 아니라(`include: packages/*/tests/**/*.test.ts`)
  `pnpm test`로는 한 번도 실행되지 않는다. 고친 코드가 실제로 도는지 확인하려고
  `pnpm --filter ohmymcp test:e2e`를 따로 돌렸다.

## 7. 임의로 판단한 부분

1. **`EXIT_MIN_POLLS`를 추가했다.** 지시는 "조건 폴링 + 넉넉한 안전장치"였다. 넉넉한 마감만으로는
   이벤트 루프가 밀리는 상황을 못 막아서, 실제 확인 횟수를 판정 조건에 넣었다.
2. **안전장치를 3초로 잡았다.** 더 크게 잡고 싶었지만 vitest 기본 테스트 타임아웃 5초를 넘으면
   우리 진단 메시지가 죽는다. `vitest.config.ts`는 공유 계약이라 손대지 않았고, 개별 `it()`의
   타임아웃을 올리는 것도 이 태스크 범위를 넘는다고 봤다.
3. **changeset을 만들지 않았다** (위 근거).
4. **`dist-cli-e2e.mjs`에도 같은 상수와 메시지를 복사했다.** 세 곳이 같은 판정을 하는데 값이
   갈리면 나중에 더 헷갈린다. 공용 헬퍼 모듈로 빼는 편이 낫지만 신규 파일은 허용 목록에 없었다.

## 8. BLOCKED 사유와 제안

**`packages/core/tests/stdio-integration.test.ts:29`의 200ms 예산이 남은 간헐 실패의 원인이다.**
`core/`는 수정 금지 목록이라 손대지 않았다.

성격은 이 태스크와 같다. `CLAUDE.local.md` 거짓 신호 표의 "재생 테스트가 가끔 실패 →
타임스탬프·실행 순서 의존"과 "실제 서버 프로세스를 띄우는 E2E는 직렬 전용 웨이브로 분리"에
동일하게 걸린다. 통합 게이트가 `pnpm test`로 판정하는 한 25회 중 2회는 계속 빨간불이다.

제안 두 가지. 둘 다 내 권한 밖이라 실행하지 않았다.

1. `core` 오너에게 같은 처방을 태스크로 넘긴다. PID 파일 대기를 고정 200ms 예산이 아니라
   조건 폴링 + 최소 확인 횟수 + 근거 있는 안전장치로 바꾸면 된다. 실패 메시지도
   `Received: undefined`가 아니라 "PID 파일이 N ms 안에 나타나지 않았다"로 바뀌어야 한다.
2. 실제 프로세스를 띄우는 테스트(`packages/core/tests/stdio-integration.test.ts`,
   `packages/cli/tests/cli-integration.test.ts`, `packages/cli/tests/generate-integration.test.ts`)를
   기본 유닛 실행에서 떼어 직렬 전용 프로젝트로 분리한다. `CLAUDE.local.md`가 이미 요구하는
   구조다. 다만 `vitest.config.ts`가 공유 계약이라 **제안만** 한다.
