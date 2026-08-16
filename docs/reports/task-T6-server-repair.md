# T6 `--repair-bundle` 파싱 보고서

status: READY_FOR_REVIEW

## 요약

`--junit` 분기를 선례로 `--repair-bundle` 파싱을 더했다. `TestCommandInput` 에 필드 한 줄,
`CliErrorCode` 에 `REPAIR_BUNDLE_WRITE_FAILED`, 도움말에 옵션 한 자리를 넣었다. 실행 경로는
아직 이 값을 읽지 않는다(T7 몫). 테스트 5개는 계획서 문장을 이름으로 썼고 전부 통과한다.

## 바꾼 파일

- 수정: `packages/cli/src/test-command.ts` (필드·에러 코드·사전 문장·파싱 분기)
- 수정: `packages/cli/src/help.ts` (`TEST_USAGE` 에 `[--repair-bundle <path>]` 한 자리)
- 수정: `packages/cli/tests/test-command.test.ts` (테스트 5개 추가만. 기존 케이스 수정·삭제 0건)
- 생성: `docs/reports/task-T6-server-repair.md` (이 파일)

목록 밖 파일 수정 0건. `packages/generate/**` 를 포함해 다른 패키지 수정 0건. 의존성 추가 0건.
git 명령 0건.

## 검증

`pnpm vitest run packages/cli/tests/test-command.test.ts`

```
 Test Files  1 passed (1)
      Tests  115 passed (115)
```

`pnpm vitest run packages/cli`

```
 Test Files  15 passed (15)
      Tests  471 passed (471)
```

부트스트랩 때 확인한 466 에서 5가 늘었다. 늘어난 5가 이번에 추가한 테스트이고, 기존 466 은
하나도 안 깨졌다.

`pnpm typecheck --force`

```
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
```

`pnpm lint`

```
Checked 174 files in 67ms. No fixes applied.
```

## 계약을 어떻게 지켰는지

- `TestCommandInput.repairBundlePath` 의 주석은 계획서 문장 그대로다.
- 파싱은 `--junit` 분기와 같은 모양이다. 중복 지정, 값 없음(`--repair-bundle` 뒤 인자 없음),
  빈 값(`--repair-bundle=`), 값 자리의 `--` 시작 토큰을 각각 `CLI_USAGE` 로 거절한다.
- `REPAIR_BUNDLE_WRITE_FAILED` 의 message·hint 는 계획서에 적힌 문장 그대로다.
- **`--repair-bundle` 없는 경로의 동작을 안 바꿨다.** 새 값은 `parseTestCommand` 의 반환에만
  실리고 실행 경로 어디에서도 읽지 않는다. 기존 test 명령 스냅샷 테스트가 하나도 안 바뀌었다.

## 임의로 판단한 지점

- **`TEST_USAGE` 문자열을 고쳤다.** 계획서가 "도움말에 옵션 한 줄" 을 요구했고, `test` 도움말은
  이 한 줄이 전부다(`help.ts:52`). 이 문자열은 `TEST_USAGE_HINT` 를 거쳐 **CLI_USAGE 실패의
  hint** 에도 들어가므로, 인자를 잘못 준 실행의 stderr 가 이 작업 전과 달라진다. 완료 조건 2 는
  "`--repair-bundle` 없이 돌린 `ohmymcp test` 의 stdout·stderr·종료 코드" 를 말하므로 정상
  실행 경로는 그대로다. 인자 오류 경로의 사용법 한 줄이 바뀌는 것은 옵션을 추가하면 피할 수
  없다고 봤다. `help.test.ts` 를 포함해 기존 테스트는 안 깨졌다.
- **옵션 자리를 `--junit` 뒤, `--stderr-lines` 앞에 뒀다.** 파일을 쓰는 옵션끼리 붙는 편이
  읽기 쉽다.
- **파싱 분기 위 주석에 `--json` 예시를 적었다.** `--junit` 쪽 주석과 같은 구조이고, 계획서
  테스트 이름도 `--repair-bundle --json` 을 예로 든다.
- 테스트 파일은 `packages/cli/tests/test-command.test.ts` 다. 계획서가 말한
  `test-command-parse.test.ts` 는 이 저장소에 없고, `parseTestCommand` 테스트가 여기에 있다.

## 남은 위험

- `repairBundlePath` 는 아직 아무도 안 읽는다. T7 이 번들 조립·쓰기를 배선할 때까지 이 옵션은
  받기만 하고 아무 일도 하지 않는다. 사용자에게 노출된 도움말에는 이미 보인다. T7 전에 릴리스가
  나가면 "옵션은 있는데 파일이 안 생긴다" 가 된다.
- `REPAIR_BUNDLE_WRITE_FAILED` 도 아직 아무도 안 던진다. 같은 이유다.
