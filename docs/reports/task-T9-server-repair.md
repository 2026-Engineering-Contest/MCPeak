# T9 `repair` 명령 배선 보고서

status: READY_FOR_REVIEW

## 요약

`repair-command.ts` 의 인자 파싱과 번들 읽기 배선, `index.ts` 의 `repair` 분기(동적 import),
도움말을 만들었다. 새 테스트 11개를 포함해 `packages/cli` 전체가 초록이다.

1차 보고는 BLOCKED 였다. `COMMANDS` 에 `"repair"` 를 넣으니
`packages/cli/tests/index.test.ts:10` 의 단언이 깨졌는데 그 파일이 Files 목록 밖이었다.
오케스트레이터가 그 파일을 목록에 추가했고, **그 한 줄만** 고쳤다.

```ts
expect(COMMANDS).toEqual(["test", "generate", "repair", "record", "replay", "mock"]);
```

## 바꾼 파일

- 생성: `packages/cli/src/repair-command.ts`
- 수정: `packages/cli/src/index.ts` (`COMMANDS`, `--help` 분기, `repair` 분기, import 한 줄)
- 수정: `packages/cli/src/help.ts` (`REPAIR_USAGE`·옵션 설명·`commandHelp` 분기·명령 목록·
  `commandDiscovery` 한 줄)
- 생성: `packages/cli/tests/repair-command-parse.test.ts`
- 수정: `packages/cli/tests/index.test.ts` (`COMMANDS` 단언 한 줄. 다른 단언 변경 0건)
- 생성: `docs/reports/task-T9-server-repair.md` (이 파일)

목록 밖 파일 수정 0건. 다른 패키지 수정 0건. 의존성 추가 0건. git 명령 0건.
**`test` 분기는 한 글자도 안 고쳤다.**

## 검증

`pnpm vitest run packages/cli/tests/repair-command-parse.test.ts`

```
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

`pnpm vitest run packages/cli`

```
 Test Files  18 passed (18)
      Tests  503 passed (503)
```

T8 직후의 492 에서 11 이 늘었다. 기존 492 는 하나도 안 깨졌다.

`pnpm typecheck --force`

```
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
```

`pnpm lint`

```
Checked 179 files in 41ms. No fixes applied.
```

## 계약을 어떻게 지켰는지

- `RepairCommandInput` 은 계획서 시그니처 그대로다.
- `--provider`·`--model` 에 기본값이 없다. 없으면 `CLI_USAGE` 다. `--provider` 는 codex·claude
  밖이면 거절한다.
- `--max-cases` 는 1 이상 정수만 받는다. `0`·`-1`·`1.5`·`열`·`1e3`·빈 문자열 전부 거절이다.
- `--no-stderr`·`--yes` 는 값을 안 받는다. `=` 를 붙이면 거절한다.
- `index.ts` 의 `repair` 분기가 `@ohmymcp-hsu/generate` 를 **동적 import** 한다. `generate` 분기와
  같은 모양이고, 실패하면 `REPAIR_RUNTIME_UNAVAILABLE` 로 알리고 1 을 돌려준다.
- `repair` 분기는 `if (argv[0] !== "test")` 줄 **앞**에 있다. `test` 경로는 이 분기를 지나지
  않으므로 여전히 `core` 와 `runner` 만 로드한다.

## 임의로 판단한 지점

- **`DEFAULT_REPAIR_MAX_CASES` 를 `repair-command.ts` 에 상수로 뒀다.** 계획서는 "generate 에서
  가져온다" 고 적었지만, `repair-command.ts` 가 `@ohmymcp-hsu/generate` 를 **값으로** import 하면
  `index.ts` 가 그것을 정적으로 끌어와 `test` 경로까지 `generate` 를 로드한다. 계획서 §8 위험표
  첫 줄이 막는 바로 그것이다. 기존 `generate-command.ts`·`repair-proposal.ts` 도 generate 에서
  타입만 가져오고 값은 주입받는다. 같은 방식으로 맞췄고, **테스트가 두 상수의 동일성을 직접
  단언한다**(`expect(DEFAULT_REPAIR_MAX_CASES).toBe(DEFAULT_MAX_REPAIR_CASES)`). 갈라지면 그
  테스트가 먼저 깨진다.
- **`RepairCommandDependencies.diagnosis` 를 선택 필드로 미리 뒀다.** `index.ts` 의 동적 import
  결과를 담을 자리다. T10 이 확인 화면·전송·결과 표시를 배선할 때 쓴다. 지금은 주입만 하고
  읽지 않는다.
- **임시 문안 둘을 뒀다.** 번들을 읽은 뒤의 한 줄(`repair 번들을 읽었습니다. 실패 N건, …`)과
  `REPAIR_BUNDLE_READ_FAILED`·`REPAIR_BUNDLE_INVALID` 오류 줄이다. **T10 에서 확정한다.**
- **`commandDiscovery` 한 줄을 고쳤다.** `사용 가능한 명령: test, generate.` 였는데 `repair` 가
  빠져 있으면 새 명령을 알 방법이 없다. 이 문자열은 `TEST_USAGE_HINT`·`GENERATE_USAGE_HINT` 에도
  들어가므로 두 명령의 인자 오류 stderr 가 한 단어 늘어난다. T6 에서 승인받은 것과 같은 성격의
  변화다.
- **테스트를 11개 썼다.** 계획서 8개에 `runRepairCommand` 경로 셋(읽기 실패, 형식 불일치,
  정상 읽기)을 더했다. 파싱만 있고 실행 경로가 없으면 배선이 실제로 도는지 모른다.
- `repair` 도 `ohmymcp help repair` 와 `ohmymcp repair --help` 를 받는다. `index.ts` 의 기존
  두 명령 분기에 `"repair"` 를 더한 것이다.

## 남은 위험

- `diagnosis` 주입은 아직 안 쓰인다. T10 이 쓴다.
- 임시 문안 셋이 남아 있다. T10 의 문안 확정 대상이다.
