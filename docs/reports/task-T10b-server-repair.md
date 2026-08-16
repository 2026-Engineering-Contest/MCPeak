# T10b `repair` 분기에 ReviewIO 주입 보고서

status: READY_FOR_REVIEW

## 요약

`repair` 분기가 `nodeReviewIO()` 를 넘긴다. 같은 결함이 다시 나지 않게 의존성 조립을
`nodeRepairDependencies()` 함수로 빼고, **주입 자체를 단언하는 테스트**를 넣었다.
`generate` 분기와 `test` 분기는 안 건드렸다.

## 바꾼 파일

- 수정: `packages/cli/src/index.ts` (`nodeRepairDependencies` 추가, `repair` 분기가 그것을 쓰고
  끝나면 `reviewIO` 를 닫는다. `generate`·`test` 분기 변경 0건)
- 수정: `packages/cli/tests/index.test.ts` (테스트 하나 추가. 기존 단언 변경 0건)
- 생성: `docs/reports/task-T10b-server-repair.md` (이 파일)

목록 밖 파일 수정 0건. 다른 패키지 수정 0건. 의존성 추가 0건. git 명령 0건.

## 검증

`pnpm vitest run packages/cli`

```
 Test Files  19 passed (19)
      Tests  519 passed (519)
```

T10 직후의 518 에서 1 이 늘었다. 늘어난 1 이 이번에 추가한 테스트다.

`pnpm typecheck --force`

```
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
```

`pnpm lint`

```
Checked 181 files in 51ms. No fixes applied.
```

## 대화형 판정 기준

`generate` 와 **같은 기준**이다. 두 분기가 같은 `nodeReviewIO()` 를 쓰고, 그 구현이
`interactive` 를 이렇게 정한다(`generate-command.ts:1600`).

```ts
interactive: Boolean((input as NodeJS.ReadStream).isTTY && (output as NodeJS.WriteStream).isTTY),
```

stdin·stdout **둘 다** TTY 여야 참이다. 파이프로 돌리면 거짓이고, 그때 `repair` 는 확인 화면을
띄우되 보내지 않고 `--yes` 를 안내한다(T10 에서 고정한 동작). 기준이 다른 곳은 없다.

## 무엇으로 보장하는가

의존성 조립을 분기 안 리터럴로 두면 `reviewIO` 를 빠뜨려도 아무 테스트가 안 깨진다. T10 에서
실제로 그렇게 빠뜨렸고, `packages/cli` 518개가 전부 초록인 채로 실사용 확인 화면이 죽어 있었다.

그래서 조립을 `nodeRepairDependencies(generate)` 로 빼고 그 반환값을 직접 단언한다.

```
repair 의존성에 reviewIO 와 진단 통로가 모두 들어 있다
```

`reviewIO` 가 있는지, `confirm` 이 함수인지, `interactive` 가 boolean 인지, 진단 통로와
provider 팩토리가 있는지를 본다. 하나라도 빠지면 이 테스트가 먼저 깨진다.

`run(["repair", …])` 을 끝까지 도는 테스트로 잡는 방법도 있었지만 택하지 않았다. 테스트 환경은
TTY 가 아니라 `interactive` 가 어차피 거짓이고, 그러면 `reviewIO` 를 안 넘겨도 화면이 같아
결함을 못 잡는다. 잡지 못하는 테스트는 있으나 마나다.

## 임의로 판단한 지점

- **`nodeRepairDependencies` 를 export 했다.** 테스트가 부르려면 필요하다. `index.ts` 는 이미
  `COMMANDS`·`run` 을 내보내고 있어 새 공개 표면이 성격상 튀지 않는다.
- **끝나면 `reviewIO.close?.()` 를 부른다.** `nodeReviewIO` 는 첫 질문에서 readline 을 만들고,
  닫지 않으면 TTY 에서 프로세스가 안 끝난다(`generate-command.ts:1560-1565` 주석의 그 문제다).
  `try/finally` 로 감싸 취소·실패 경로에서도 닫는다.
- **테스트에서 `generate` 를 가짜 객체로 넘긴다.** 실제 모듈을 로드할 이유가 없고,
  `codex`·`claude` 프로세스와도 무관하다. 조립 결과의 모양만 본다.

## 남은 위험

- 확인 화면이 실제 TTY 에서 어떻게 보이는지는 여전히 사람 눈이 필요하다. 자동 테스트는 문자열
  조립까지만 본다.
- `reviewIO` 를 닫는 책임이 `index.ts` 에 있다. `runRepairCommand` 를 다른 진입점에서 부르면
  그쪽도 닫아야 한다. 지금 진입점은 하나뿐이다.
