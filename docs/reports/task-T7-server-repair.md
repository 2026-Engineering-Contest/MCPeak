# T7 번들 조립과 쓰기 보고서

status: READY_FOR_REVIEW

## 요약

`repair-bundle.ts` 에 `buildRepairBundle` 과 직렬화를 만들고, `test-command.ts` 의
`snapshotDiagnostics()` 뒤 자리에서 쓰기를 배선했다. 매핑 규칙은 설계서 §4.2 그대로다.
`--repair-bundle` 을 주지 않으면 블록을 통째로 건너뛰므로 기존 경로의 출력과 종료 코드가 그대로다.

## 바꾼 파일

- 생성: `packages/cli/src/repair-bundle.ts`
- 수정: `packages/cli/src/test-command.ts` (import 한 덩이 + 쓰기 호출 블록 하나. 기존 로직 변경 0건)
- 생성: `packages/cli/tests/repair-bundle-write.test.ts`
- 생성: `docs/reports/task-T7-server-repair.md` (이 파일)

목록 밖 파일 수정 0건. `packages/generate/**` 를 포함한 다른 패키지 수정 0건. 의존성 추가 0건.
git 명령 0건. 실제 서버 프로세스 0건.

## 검증

`pnpm vitest run packages/cli/tests/repair-bundle-write.test.ts`

```
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

`pnpm vitest run packages/cli`

```
 Test Files  16 passed (16)
      Tests  484 passed (484)
```

T6 직후의 471 에서 13 이 늘었다. 늘어난 13 이 이번에 추가한 테스트이고 기존 471 은 하나도 안
깨졌다.

`pnpm typecheck --force`

```
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
```

`pnpm lint`

```
Checked 176 files in 40ms. No fixes applied.
```

## 매핑 규칙을 어떻게 지켰는지

- `report.cases` 중 `status !== "passed"` 인 것만 담는다. `timedOut`·`cancelled`·`notRun` 포함.
- `tool`·`input` 은 `spec.operation.type === "callTool"` 일 때만 담는다.
- `diagnostics` 는 배열이다. `operation.diagnostic` 을 먼저, `assertions[].diagnostic` 을 그
  순서로 이어 담는다. `notes` 도 그대로 옮긴다.
- `approvedAs` 는 `spec-approval.ts` 의 `caseApprovalStatuses` 로 찾는다. 표시가 없으면 키를
  만들지 않는다.
- `process` 는 `processDiagnostics` 가 있고 `hasDiagnosticContent` 가 참일 때만 담는다.
  **화면이 쓰는 그 함수를 그대로 import 했다.** 사본을 만들지 않았다.
- 실패가 0건이면 `buildRepairBundle` 이 `undefined` 를 돌려주고, 호출 지점은 파일을 안 만들고
  한 줄만 알린다.
- 쓰기 실패는 `--junit` 선례를 따른다. 전부 통과여도 종료 코드가 1 이고
  `REPAIR_BUNDLE_WRITE_FAILED` 가 stderr 에 뜬다.
- 쓰기 지점은 `const settled = snapshotDiagnostics();` 뒤다. 스냅샷을 그대로 넘긴다. 프로세스
  정리 뒤 상태를 다시 읽지 않는다.

## 완료 조건 2 확인

`--repair-bundle` 없이 돌린 실행과 준 실행의 stdout·stderr 를 같은 시나리오로 비교하는 테스트를
넣었다(`--repair-bundle 없이 돌린 실행의 stdout·stderr·종료 코드가 옵션 도입 전과 같다`).
두 실행의 출력 문자열과 종료 코드가 같고, 옵션이 없으면 `writeFile` 호출이 0건이다. 기존 test
명령 스냅샷 테스트도 하나도 안 바뀌었다(`packages/cli` 471 → 484, 기존 471 전부 통과).

## 임의로 판단한 지점

- **실패가 0건일 때의 문안을 내가 정했다.** 계획서는 "한 줄만 알린다" 고만 적었다.
  `REPAIR_BUNDLE_EMPTY_LINE` 로 상수를 두고 `repair 번들: 실패한 케이스가 없어 파일을 만들지
  않았습니다.` 로 썼다. 앞에 빈 줄을 붙이는 것은 다른 블록과 같은 레이아웃 규칙이다. **T10 이
  화면 문안을 확정하는 태스크이므로 거기서 바꿀 수 있다.** stdout 에 쓴다.
- **`cliVersion` 을 선택 인자로 두고 기본값을 `repair-bundle.ts` 안에서 만들었다.** 계획서
  시그니처는 `cliVersion: string` 필수였지만, `test-command.ts` 는 버전을 모른다.
  `TestCommandDependencies` 에 필드를 더하면 "쓰기 호출 지점만" 이라는 범위를 넘고 기존
  주입 지점 전부를 고쳐야 한다. `index.ts` 가 하듯 `../package.json` 을 읽어
  `REPAIR_BUNDLE_GENERATED_BY` 를 만들고, 인자로 덮어쓸 수 있게 열어 뒀다.
- **`serializeRepairBundle` 을 뒀다.** 들여쓰기 2칸에 개행으로 끝난다. `--json` 보고서
  (`JSON.stringify(value, null, 2)`)와 같은 모양이라 사람이 열어 봐도 읽힌다.
- **`truncated` 는 타입에만 두고 채우지 않는다.** 설계서 §4.2 가 "번들 단계에서 자르지 않지만
  담을 자리를 지금 정해 둔다" 고 적었다. 자르는 것은 `prepareDiagnosisRequest` 쪽이다.
- **테스트를 13개 썼다.** 계획서의 11개에 둘을 더했다. 하나는 실제 `runCli` 경로에서 번들
  파일이 만들어지는지, 다른 하나는 실패 0건일 때 파일을 안 만들고 한 줄만 알리는지 본다.
  둘 다 계획서가 본문에서 요구한 동작인데 테스트 목록에는 없었다.
- **진단 코드 리터럴을 실제 `RunnerDiagnosticCode` 값으로 골랐다.** 처음에 쓴
  `TOOL_CALL_FAILED`·`FIELD_MISSING` 은 그 유니온에 없어 타입체크가 막았다.
  `OPERATION_FAILED`·`BODY_SCHEMA_MISMATCH` 로 바꿨다.
- biome 포매팅과 `noUnsafeOptionalChaining` 에 맞춰 테스트 표현을 다듬었다. 단언 내용은 같다.

## 남은 위험

- 번들을 읽는 쪽이 아직 없다. T8 이 읽기·검증을 만든다. 지금은 파일만 생긴다.
- `REPAIR_BUNDLE_EMPTY_LINE` 문안이 T10 에서 바뀌면 이 파일의 상수를 고쳐야 한다. 테스트도
  그 문장을 부분 문자열로 본다.
- `generatedBy` 는 `packages/cli/package.json` 의 버전을 그대로 쓴다. 번들에 남는 값이므로
  릴리스 버전과 일치한다.
