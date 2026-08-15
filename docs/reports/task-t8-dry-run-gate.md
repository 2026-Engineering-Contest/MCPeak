# Task T8 보고서: 도움말과 E2E (`cli`)

## 무엇을 했나

시험 실행 옵션 넷의 도움말을 넣고, 배포 산출물 E2E 의 기대값을 갱신했다. 계획서 §4 T8 그대로다.

- `packages/cli/src/help.ts` 수정. `GENERATE_USAGE` 에 옵션 넷을 넣고 설명 블록을 추가
- `packages/cli/tests/help.test.ts` 신규. 7개
- `packages/cli/tests/dist-cli-e2e.mjs` 수정. `generate --help` 와 `--baseline-only` 기대값

## 도움말

계획서가 고정한 네 줄을 그대로 넣었다.

```
옵션:
  --no-dry-run          승인 전 시험 실행을 건너뜁니다. 케이스가 실제 서버에서 확인되지
                        않은 채 저장됩니다
  --cassette <path>     서버 응답을 녹화·재생합니다. 반복 실행에서 서버를 다시 부르지
                        않습니다. 응답 전문이 저장되므로 .gitignore 를 확인하세요
  --record              카세트를 처음부터 다시 녹화합니다 (--cassette 필요)
  --reset-cmd <command> 시험 실행 전에 이 명령을 한 번 실행합니다. 셸을 거치지 않으므로
                        파이프나 && 는 쓸 수 없습니다
```

`GENERATE_USAGE` 한 줄에도 네 옵션 이름을 넣었다. 사용 오류 힌트(`GENERATE_USAGE_HINT`)는 그
한 줄만 쓰므로 설명 블록이 stderr 로 새지 않는다. 그 성질을 테스트로 고정했다.

## E2E

`pnpm test` 가 수집하지 않는 파일이라 여기를 빠뜨리면 로컬이 녹색인데 CI 의 `build` job 이
빨간불이 된다. 두 가지를 더했다.

- `generate --help` 출력에 옵션 넷과 `.gitignore` 문장이 있는지
- `--baseline-only` 출력에 시험 실행 줄이 없고 저장된 명세에 `approval.cases` 가 없는지

`--no-dry-run` 대화형 경로는 TTY 가 필요해 E2E 로 덮지 않는다. T6 의 인메모리 테스트가 덮는다.

## 검증

```
$ pnpm test
 Test Files  54 passed (54)
      Tests  1139 passed | 1 skipped (1140)

$ pnpm build && pnpm --filter ohmymcp test:e2e
(무출력, 종료 코드 0)

$ pnpm typecheck --force
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total

$ pnpm lint
Checked 158 files in 34ms. No fixes applied.
```

## 임의로 판단한 지점

1. **`packages/cli/tests/help.test.ts` 를 새로 만들었다.** 계획서 Files 에 있는데 저장소에는 없던
   파일이다. 지금까지 도움말은 `index.test.ts` 가 사용법 한 줄만, E2E 가 배포본만 봤다. 옵션
   설명은 순수 문자열이라 그 둘로 덮으면 실패 지점이 멀다.
2. **설명 블록을 `commandHelp("generate")` 안에만 넣었다.** 전체 도움말(`GLOBAL_HELP`)에는 넣지
   않았다. 거기는 명령 목록이고, 서브커맨드 옵션까지 실으면 첫 화면이 길어진다.
3. **`옵션:` 머리글을 붙였다.** 계획서는 네 줄만 준다. 머리글이 없으면 사용법 줄과 설명이 한
   덩어리로 보인다. `GLOBAL_HELP` 가 이미 같은 머리글을 쓴다.
4. `test` 의 도움말은 건드리지 않았다. 이 작업이 늘린 옵션이 없다.

## 남은 위험

- 도움말 문안이 계획서·설계서·`help.ts` 세 곳에 있다. 문구를 고치면 계획서 §4 T8 과 함께 고쳐야
  한다.
- E2E 의 도움말 단언은 부분 문자열이다. 줄바꿈 위치가 바뀌어도 통과한다. 정렬이 깨지는 것은
  `help.test.ts` 의 전체 줄 단언이 잡는다.

## 커밋 메시지

```
docs(cli): 시험 실행 옵션 도움말과 E2E 기대값을 갱신한다
```
