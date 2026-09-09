# Task T2 보고서: 번들과 화면 (`cli`)

이슈 #385. 계획서 `docs/superpowers/plans/2026-09-09-repair-spec-oracle-implementation.md` Task T2.
설계 문서 `docs/superpowers/specs/2026-09-09-repair-spec-oracle-design.md` §4.3 · §4.4 · §4.5.
브랜치 `fix/repair-spec-oracle`, 기점 `36fdf4d`(T1 통합 커밋).

## 무엇을 바꿨나

`repair` 가 번들의 지문 상태 하나로 오라클을 판정하던 것을 지문과 실행 기록 둘의 합의로 바꿨다.
번들이 `spec.runHistory` 를 실어 나르고 형식 버전이 2 가 됐다. 화면 세 자리(전송 확인, 결과 위
경고 블록, 원인 항목의 분류 라벨)가 실행 기록을 말한다.

- `packages/cli/src/spec-approval.ts`: `specRunHistory(suite)` 를 `caseApprovalStatuses` 뒤에
  추가했다. 판정 기준은 `approval.cases` 의 길이다.
- `packages/cli/src/repair-bundle.ts`: `REPAIR_BUNDLE_VERSION` 을 1 에서 2 로 올리고,
  `RepairBundle["spec"]` 에 `runHistory` 를 더했다. `buildRepairBundle` 이
  `specRunHistory(options.suite)` 로 값을 채우고, 읽기 검증 `specShapeValid` 가 `RUN_HISTORIES`
  로 값을 본다. `missingField` 문장에 `runHistory` 를 넣었다.
- `packages/cli/src/repair-command.ts`: `prepare` 에 넘기던 `specApproved` 를
  `specTrust: { fingerprint: bundle.spec.approval, runHistory: bundle.spec.runHistory }` 로
  바꾸고, `confirmView` 에 `runHistory` 를 더했다.
- `packages/cli/src/repair-render.ts`: `RUN_HISTORY_LABEL` 과 지역 함수 `isOracle` 을 두고,
  `renderApprovalNotice(approval, runHistory)` 로 인자를 늘렸다. `명세 상태` 줄이 두 라벨을
  가운뎃점으로 잇고, 분류 라벨 조건이 `!isOracle(options.bundle)` 이 됐다. `@mcpeak/generate` 의
  `specIsOracle` 은 import 하지 않는다(설계 §4.5).
- 테스트 여섯 파일: `spec-approval` · `repair-bundle-write` · `repair-bundle-read` ·
  `repair-command-parse` · `repair-render` · `repair-e2e`.

`packages/generate` 와 다른 오너의 패키지는 건드리지 않았다. `test` 명령의 `renderSpecApproval`
도 그대로다(설계 §2 비범위).

## Step 2: 실패 확인

명령:

```
pnpm vitest run --root . packages/cli/tests/spec-approval.test.ts packages/cli/tests/repair-bundle-write.test.ts packages/cli/tests/repair-bundle-read.test.ts packages/cli/tests/repair-render.test.ts
```

결과 요약:

```
 ❯ |unit| packages/cli/tests/spec-approval.test.ts (23 tests | 4 failed) 4ms
     × approval 이 없으면 absent 다 1ms
     × approval.cases 가 없으면 absent 다 0ms
     × approval.cases 가 빈 배열이면 absent 다 0ms
     × approval.cases 가 하나라도 있으면 present 다 0ms
 ❯ |unit| packages/cli/tests/repair-bundle-read.test.ts (15 tests | 3 failed) 7ms
     × bundleVersion 이 1 이면 versionMismatch 다 3ms
     × spec.runHistory 가 없으면 missingField 다 1ms
     × spec.runHistory 가 목록 밖 값이면 missingField 다 1ms
 ❯ |unit| packages/cli/tests/repair-render.test.ts (30 tests | 27 failed) 8ms
     × 전송 확인 화면이 지문 상태와 실행 기록을 함께 적는다 0ms
     × 지문이 맞고 실행 기록이 없으면 경고 블록이 붙는다 0ms
     × 실행 기록이 없으면 spec 항목에 분류 라벨이 붙는다 0ms
     × 네 경로의 화면이 서로 다르고 오라클 경로에만 경고가 없다 0ms
 ❯ |unit| packages/cli/tests/repair-bundle-write.test.ts (17 tests | 2 failed) 7ms
     × approval.cases 가 없으면 번들의 runHistory 가 absent 다 2ms
     × approval.cases 가 있으면 번들의 runHistory 가 present 다 0ms

 Test Files  4 failed (4)
      Tests  36 failed | 49 passed (85)
```

`specRunHistory` 가 없다는 것이 첫째 증거다.

```
TypeError: specRunHistory is not a function
```

번들 형식이 아직 버전 1 이라 낡은 번들이 그대로 통과한다는 것이 둘째 증거다.

```
 FAIL  |unit| packages/cli/tests/repair-bundle-read.test.ts > readRepairBundle > bundleVersion 이 1 이면 versionMismatch 다
AssertionError: expected { status: 'ok', bundle: { …(4) } } to deeply equal { status: 'invalid', …(1) }

- Expected
+ Received

  {
-   "reason": "versionMismatch",
-   "status": "invalid",
+   "bundle": {
+     "bundleVersion": 1,
```

`repair-render.test.ts` 의 27건은 `bundle()` 헬퍼가 `bundleVersion: 2` 와 `runHistory` 를 쓰기
시작했는데 읽기 검증이 아직 버전 1 만 받으므로, 모든 화면 경로가 `versionMismatch` 로 접혀
생긴 것이다. 실행 기록을 다루는 새 테스트 넷이 그 안에 있다.

## Step 7: 통과 확인

```
$ pnpm build --force
 Tasks:    7 successful, 7 total
Cached:    0 cached, 7 total

$ pnpm typecheck --force
 Tasks:    7 successful, 7 total
Cached:    0 cached, 7 total
```

`@mcpeak/dashboard:typecheck` 까지 도달해 통과했다. T1 보고서가 남긴 위험 하나가 여기서 닫혔다.

```
$ pnpm --filter @mcpeak/cli test
 Test Files  31 passed (31)
      Tests  922 passed | 1 skipped (923)

$ pnpm vitest run --root . packages/cli/tests/spec-approval.test.ts packages/cli/tests/repair-bundle-write.test.ts packages/cli/tests/repair-bundle-read.test.ts packages/cli/tests/repair-command-parse.test.ts packages/cli/tests/repair-render.test.ts
 Test Files  5 passed (5)
      Tests  96 passed (96)

$ pnpm biome ci packages/cli
Checked 74 files in 67ms. No fixes applied.
```

## 임의로 판단한 것

계획서 Step 1 의 `전송 확인 화면이 지문 상태와 실행 기록을 함께 적는다` 를 한 곳 고쳤다.
계획서는 `runRepairCommand([...ARGV, "--yes"], ...)` 로 부르고 `writes.out` 에서 문장을 찾는데,
`--yes` 가 있으면 확인 화면 자체가 렌더링되지 않는다(`repair-command.ts` 의 `if (!input.yes)`).
같은 파일의 기존 테스트 `--yes 면 확인 화면 없이 바로 보낸다` 가 그 동작을 이미 고정하고 있다.
그래서 `--yes` 를 빼고 `runRepairCommand(ARGV, ...)` 로 불렀다. `deps` 가 `reviewIO` 를 안 주면
비대화형 경로라 확인 화면이 `writeStdout` 으로 나가므로, 계획서의 두 단언
(`명세 상태  승인 지문 일치 · 실행 기록 있음` · `... 실행 기록 없음`)과 `writes.out` 조회는
글자 그대로 유지된다. 왜 그렇게 부르는지 주석 한 줄을 테스트에 붙였다.

실제 실패 출력:

```
 ❯ packages/cli/tests/repair-render.test.ts:258:41
    258|     expect(present.writes.out.join("")).toContain("명세 상태  승인 지문 일치 · 실…
```

나머지 테스트 셋(`경고 블록` · `분류 라벨` · `네 경로`)은 결과 화면을 보므로 `--yes` 그대로
두었고 계획서 코드 그대로 통과한다. T1 에서 걸렸던 `noUnusedVariables` ·
`noUncheckedIndexedAccess` 는 이번 태스크에서는 걸리지 않았다.

## 남은 위험

- **`repair-e2e.test.ts` 는 이 태스크에서 돌리지 않았다.** 실제 서버 프로세스를 띄우므로 직렬
  웨이브(W4)의 몫이다. `expect(bundle.bundleVersion).toBe(2)` 와
  `expect(bundle.spec.runHistory).toBe("absent")` 두 줄이 거기서 처음 판정된다.
- **저장소에 남아 있는 낡은 번들 파일은 이제 거절된다.** 버전 2 로 올렸으므로 사용자가 이전에
  만들어 둔 번들은 `versionMismatch` 문장을 받고 `mcpeak test --repair-bundle` 을 다시 돌려야
  한다. 의도된 결정이다(설계 §3.2). ADR 은 T3 이 쓴다.
- **`.changeset/` 은 아직 없다.** `packages/*` 를 건드렸으므로 `changeset-check` 가 필요로 한다.
  T3 의 몫이다.
- **`pnpm test` 전량과 `pnpm biome ci .` 은 이 태스크 범위 밖이다.** 통합 게이트에서 확인한다.
