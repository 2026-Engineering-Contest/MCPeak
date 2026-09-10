# Task T1 보고서: 진단 요청의 오라클 판정 (`generate`)

이슈 #385. 계획서 `docs/superpowers/plans/2026-09-09-repair-spec-oracle-implementation.md` Task T1.
설계 문서 `docs/superpowers/specs/2026-09-09-repair-spec-oracle-design.md` §3.1 · §4.1 · §4.2.
브랜치 `fix/repair-spec-oracle`, 기점 `47e624d`.

## 무엇을 바꿨나

`DiagnosisRequest` 가 싣던 `specApproved: boolean` 을 두 축 구조체 `specTrust` 로 나눴다. 지문
대조(`fingerprint`)와 승인 시점 실행 기록(`runHistory`)이 별개의 값이 됐고, 오라클 판정은
`specIsOracle` 하나가 한다. 프롬프트 선택과 `target: "spec"` 폐기가 같은 이 함수를 본다.

- `packages/generate/src/diagnosis-schema.ts`: `DiagnosisSpecTrust` 인터페이스와 `specIsOracle`
  을 추가하고, `DiagnosisRequest.specApproved` 를 `specTrust` 로 바꿨다. 키 자리는 그대로다.
- `packages/generate/src/diagnosis-prompt.ts`: 역할 문장을 두 갈래에서 네 갈래로 늘렸다
  (`ORACLE_INSTRUCTION` · `APPROVED_UNRUN_INSTRUCTION` · `MISMATCHED_INSTRUCTION` ·
  `NO_APPROVAL_INSTRUCTION`). 승인 시점 판정 읽는 법(`CASE_HISTORY_RULE`)을 네 갈래 모두에
  역할 문장 뒤, 허용 caseId 목록 앞에 넣었다. 문안은 설계 §4.1 · §4.2 전량 그대로다.
- `packages/generate/src/diagnosis-request.ts`: `prepareDiagnosisRequest` 옵션의
  `specApproved: boolean` 을 `specTrust: DiagnosisSpecTrust` 로 바꾸고, 폐기 규칙이
  `specIsOracle(preview.request.specTrust)` 를 본다.
- `packages/generate/src/index.ts`: `DiagnosisSpecTrust` 타입과 `specIsOracle` 값을 공개했다.
- 테스트 다섯 파일(`diagnosis-{schema,prompt,request,result,dispatch}.test.ts`): 헬퍼 시그니처를
  바꾸고, 두 갈래 판정을 네 갈래 판정으로 늘렸다.

`specApproved` 라는 이름은 `packages/generate/src` 와 `packages/generate/tests` 어디에도 남지
않는다. `packages/generate/dist/` 에는 남아 있는데, 그것은 이 브랜치에서 아직 다시 빌드하지
않은 이전 산출물이고 git 추적 대상이 아니다. T2 가 시작할 때 `pnpm build --force` 로 지워진다.

## Step 2: 실패 확인 (이슈 #385 재현 증거)

명령:

```
pnpm vitest run --root . packages/generate/tests/diagnosis-schema.test.ts packages/generate/tests/diagnosis-prompt.test.ts packages/generate/tests/diagnosis-request.test.ts packages/generate/tests/diagnosis-result.test.ts packages/generate/tests/diagnosis-dispatch.test.ts
```

결과 요약:

```
 ❯ |unit| packages/generate/tests/diagnosis-schema.test.ts (15 tests | 1 failed) 5ms
     × 지문 일치와 실행 기록이 모두 있어야 참이다 1ms
 ❯ |unit| packages/generate/tests/diagnosis-result.test.ts (12 tests | 12 failed) 6ms
     × 오라클 명세에서는 target: "spec" 항목이 버려진다 0ms
     × 실행 기록이 없으면 target: "spec" 항목이 통과한다 0ms
     × 지문이 불일치하면 target: "spec" 항목이 통과한다 0ms
     × 승인 지문이 없으면 target: "spec" 항목이 통과한다 0ms
 ❯ |unit| packages/generate/tests/diagnosis-request.test.ts (12 tests | 11 failed) 8ms
     × specTrust 값이 request 에 그대로 실린다 0ms
     × specTrust 가 다르면 요청 지문도 다르다 0ms
 ❯ |unit| packages/generate/tests/diagnosis-dispatch.test.ts (9 tests | 8 failed) 5ms
 ❯ |unit| packages/generate/tests/diagnosis-prompt.test.ts (14 tests | 14 failed) 6ms
     × 역할 문장이 네 갈래다 3ms
     × 어떤 갈래도 통과 이력을 주장하지 않는다 0ms
     × 모든 갈래가 approvedAs 읽는 법을 담는다 0ms
     × 승인 판정 읽는 법이 역할 문장과 허용 caseId 목록 사이에 온다 0ms

 Test Files  5 failed (5)
      Tests  46 failed | 16 passed (62)
```

`specIsOracle` 이 아직 없다는 것이 첫째 증거다.

```
 FAIL  |unit| packages/generate/tests/diagnosis-schema.test.ts > specIsOracle > 지문 일치와 실행 기록이 모두 있어야 참이다
TypeError: specIsOracle is not a function
 ❯ packages/generate/tests/diagnosis-schema.test.ts:147:12
    145| describe("specIsOracle", () => {
    146|   it("지문 일치와 실행 기록이 모두 있어야 참이다", () => {
    147|     expect(specIsOracle(ORACLE)).toBe(true);
       |            ^
```

`specTrust` 가 `prepareDiagnosisRequest` 옵션에 없다는 것이 둘째 증거다. 옵션에 없는 키라
요청에 실리지 않고, 기존 `specApproved` 자리가 `undefined` 로 남아 요청 지문 계산이 던진다.

```
 FAIL  |unit| packages/generate/tests/diagnosis-request.test.ts > prepareDiagnosisRequest > specTrust 값이 request 에 그대로 실린다
TypeError: canonical JSON에는 undefined를 사용할 수 없습니다.
 ❯ canonicalJson packages/runner/src/canonical.ts:66:13
 ❯ sha256 packages/runner/src/canonical.ts:102:38
 ❯ prepareDiagnosisRequest packages/generate/src/diagnosis-request.ts:197:23
 ❯ prepare packages/generate/tests/diagnosis-request.test.ts:34:10
 ❯ packages/generate/tests/diagnosis-request.test.ts:152:12
```

`vitest` 는 타입을 보지 않으므로 이 시점의 타입 오류는 런타임 오류로 나타난다. 타입 층의 같은
사실은 아래 `pnpm typecheck --force` 항목이 보여준다.

## Step 7: 통과 확인

```
$ pnpm vitest run --root . packages/generate/tests/
 Test Files  23 passed (23)
      Tests  640 passed | 1 skipped (641)
   Duration  498ms

$ pnpm --filter @mcpeak/generate test
 Test Files  23 passed (23)
      Tests  640 passed | 1 skipped (641)

$ pnpm biome ci packages/generate
Checked 53 files in 18ms. No fixes applied.
```

## `pnpm typecheck --force` 가 가리킨 `cli` 의 실패 위치

계획대로 `packages/cli` 한 곳에서만 실패한다. 다른 패키지는 통과했다.

```
@mcpeak/cli:typecheck: src/repair-command.ts(164,5): error TS2353: Object literal may only specify known properties, and 'specApproved' does not exist in type '{ specTrust: DiagnosisSpecTrust; suite: { id: string; name: string; }; failures: readonly DiagnosisFailure[]; processDiagnostics?: DiagnosisProcessDiagnostics | undefined; ... 7 more ...; maxResultBytes?: number | undefined; }'.

 Tasks:    5 successful, 6 total
Cached:    0 cached, 6 total
Failed:    @mcpeak/cli#typecheck
```

`packages/cli/src/repair-command.ts:164` 는 설계서 §1 이 지목한 바로 그 줄
(`specApproved: bundle.spec.approval === "matched"`)이다. T2 가 고친다.

## 임의로 판단한 것

계획서가 적어 준 코드를 그대로 옮기면서 두 곳을 손봤다. 둘 다 문안과 단언의 뜻은 바꾸지 않았다.

1. **테스트의 공용 상수를 파일마다 실제로 쓰는 것만 선언했다.** 계획서 Step 1 은 네 상수를 각
   파일 상단에 두라고 적었는데, `diagnosis-request.test.ts` 는 `ORACLE` 과 `UNRUN` 만,
   `diagnosis-dispatch.test.ts` 는 `ORACLE` 만 쓴다. 네 개를 다 두면 biome 의
   `noUnusedVariables` 가 `pnpm biome ci` 를 빨강으로 만든다. 나머지 세 파일
   (`schema` · `prompt` · `result`)에는 네 개를 그대로 뒀다.
2. **`prompts[0].startsWith(...)` 를 `prompts[0]?.startsWith(...)` 로 바꿨다.** 이 저장소의
   `tsconfig` 는 `noUncheckedIndexedAccess` 를 켜 두어 `prompts[0]` 이
   `string | undefined` 다. 계획서 문장 그대로 두면
   `tests/diagnosis-prompt.test.ts(84,7): error TS2532: Object is possibly 'undefined'.` 로
   `@mcpeak/generate` 의 typecheck 가 실패한다. `toBe(true)` 단언은 그대로라 판정 내용은
   같다. 같은 배열의 `prompts[1]` 등은 `toContain` 의 인자여서 타입 오류가 나지 않아 손대지
   않았다.

`pnpm biome format --write` 가 `diagnosis-prompt.test.ts` 와 `diagnosis-result.test.ts` 의 줄
바꿈을 다시 잡았다. 문자열 리터럴과 단언은 바뀌지 않았다.

## 남은 위험

- **`@mcpeak/dashboard` 의 typecheck 를 아직 못 봤다.** turbo 가 `@mcpeak/cli` 실패에서 멈춰
  의존 패키지인 dashboard 까지 가지 않았다. dashboard 는 번들 형식을 해석하지 않으므로
  (설계 §3.2) 영향이 없어야 하지만, 확인은 T2 이후 통합 게이트에서 해야 한다.
- **`packages/generate/dist/` 가 낡았다.** T2 는 시작 전에 `pnpm build --force` 를 돌려야
  한다. 낡은 `.d.ts` 를 읽으면 로컬 typecheck 만 녹색이 된다.
- **`repair-e2e.test.ts` 는 이 태스크에서 돌리지 않았다.** 실제 서버 프로세스를 띄우므로
  직렬 웨이브(W4)의 몫이다.
