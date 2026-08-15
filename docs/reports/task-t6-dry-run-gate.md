# Task T6 보고서: `generate` 배선 (`cli`)

## 무엇을 했나

`generate` 의 `save` 경로에 승인 전 시험 실행 게이트를 넣었다. 계획서 §4 T6 과 설계서 §4.2·§8 을
따랐다.

- `packages/cli/src/generate-command.ts` 수정. 옵션 4개, 연결 수명, `save` 경로 14단계,
  `renderSuite` 의 `approval.cases`
- `packages/cli/tests/generate-command.test.ts` 수정. 게이트 describe 신규(21개) + 옵션 파싱 3개
- `packages/cli/tests/generate-integration.test.ts` 수정. 실제 weather-server 경로의 확인 횟수와
  승인 기록 단언

웨이브 1 의 네 모듈(`reset-hook.ts`·`dry-run.ts`·`dry-run-review.ts`·`cassette-wiring.ts`)은
한 글자도 고치지 않았다.

## 옵션

| 옵션 | 규칙 |
|---|---|
| `--no-dry-run` | 한 번만. `--cassette`·`--reset-cmd` 와 함께 쓰면 사용 오류 |
| `--cassette <path>` | 한 번만 |
| `--record` | 한 번만. `--cassette` 없이 쓰면 사용 오류 |
| `--reset-cmd <command>` | 한 번만. 값이 공백뿐이면 사용 오류 |

`--baseline-only` 하나뿐이던 불리언 처리를 `flagNames` 집합으로 일반화했다. 세 플래그가 `=` 를
못 쓰고 두 번 못 쓰는 규칙을 한 곳에서 갖는다.

## 연결 수명

```
현재:  connect → listTools → baseline → 검토 루프 → (save 에서 시험 실행) → close
```

`--baseline-only` 는 지금과 같이 `listTools` 직후 닫는다. 대화형 경로는 검토가 끝난 뒤 닫는다.

**대화형 검토를 `runGenerateCommand` 의 try 블록 밖으로 뺐다.** 안에 두고 `await` 하면 검토가
던지는 오류를 그 catch 가 `GENERATE_FAILED` 로 뭉갠다. 지금까지는 `return runInteractiveReview(...)`
가 await 없이 promise 를 돌려줘서 우연히 catch 를 비껴갔고, 연결을 닫으려고 await 를 붙이는
순간 그 성질이 깨진다. 기존 테스트(`입력 닫힘이 아닌 오류는 삼키지 않는다`)가 이것을 잡았다.

## `save` 경로

설계서 §4.2 의 순서 그대로다. `--no-dry-run` 이면 2~10 을 건너뛰고 §8.5 확인 하나를 받는다.

카세트 배선은 **검토 세션에 하나**다. `save` 를 여러 번 골라도 같은 배선을 쓴다. 시도마다 새로
만들면 저장이 막힌 첫 시도의 녹화가 통째로 버려진다. `flush()` 는 저장에 성공한 뒤 한 번만
부른다. 저장이 실패하면 부르지 않는다(연결이 살아 있어야 다시 시도할 수 있다).

## 화면

설계서 §8 의 문안을 그대로 옮겼다. 실제 출력(케이스 3개, 실패 2개)이다.

```
시험 실행: 케이스 3개를 실제 서버에 보냅니다.
  대상: node server.mjs

이 실행은 서버 상태를 바꿀 수 있습니다. 입력 검증이 없는 서버라면 외부 API 호출도
그대로 나갑니다.
계속할까요? [y/N] ▸ 시험 실행 중... 3/3

  ✓ 통과 1건
  ✗ 실패 2건

  [1] weather가 필수 필드 'city' 누락을 거절한다
      isError  오류 응답을 기대했지만 정상 응답을 받았습니다.
      해결: 툴 입력값과 서버의 오류 응답을 확인하세요.
```

실패 사유는 `renderReport` 가 만든 블록이다. 여기서 새 문안을 만들지 않았다. 실패 케이스 머리글
`  [n] <caseName>` 은 분류 화면(§8.3)과 같은 함수 모양을 쓴다.

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

기점 1107 개에서 32 개 늘었다(게이트 21 · 옵션 파싱 3 · T8 도움말 7 · 통합 1 은 기존 테스트 보강).

## 임의로 판단한 지점

1. **주입점을 `cassetteIo` 하나만 늘렸다.** `runDryRun`·`reviewDryRun`·`wireCassette` 는 실제
   구현을 그대로 돌린다. 셋 다 주입한 client 와 io 만 쓰므로 인메모리로 검증된다. 파일시스템을
   만지는 곳이 카세트 저장뿐이라 그것만 주입점으로 열었다. `runResetCommand` 도 실물이고
   테스트는 `process.execPath -e` 와 없는 실행 파일만 쓴다.
2. **고지의 카세트 모드 표기를 `(신규 녹화)` / `(재생)` 둘로 뒀다.** 설계서 §8.1 은 `(신규 녹화)`
   한 가지만 보여준다. 재생일 때 그 표기를 쓰면 거짓이고, 표기를 빼면 두 모드가 같아 보인다.
   §5.2 의 표(record / auto)와 1:1 로 대응하는 낱말을 골랐다. 판정은 `deps.exists` 로 한다.
3. **`payloadLimit` 의 §8.4 첫 줄에서 `N/M 케이스에서 연결이 끊겼습니다` 를 뺐다.** 설계서는
   `connectionLost` 만 보여주는데, 보고서 상한 초과는 연결이 끊긴 것이 아니고 그 경로의
   `outcomes` 는 비어 있어 `0/24` 가 된다. 사유 줄(`→ ...`)은 그대로 붙는다.
4. **미분류로 막혔을 때의 첫 줄을 새로 썼다.** 설계서 §8.3 은 `명세 오류 N건이 있어 저장할 수
   없습니다.` 만 고정한다. 보류에는 고칠 것이 없으므로 `분류하지 않은 케이스가 있어 저장할 수
   없습니다.` 한 줄을 쓰고, `revise 또는 edit` 안내는 붙이지 않는다. 새로 지은 문장은 이것
   하나다.
5. **초기화 실패 화면도 새로 썼다.** 설계서 §6 이 동작(마지막 3줄, 저장하지 않음)만 정하고 문안을
   주지 않는다. 이 파일의 관례대로 변수 뒤에 조사를 붙이지 않는 라벨 형태로 적었다.
   `✗ 초기화 명령이 실패했습니다. 명령: <cmd> (종료 코드: <n>)`.
6. **서버 stderr 줄 수는 20 고정이다.** 설계서는 `--stderr-lines` 가 그대로 적용된다고 적었지만
   `generate` 에는 그 옵션이 없고 T6 의 옵션 표에도 없다. `test` 의 기본값과 같은 값을 상수로
   뒀다.
7. **결과 목록 뒤에 빈 줄 하나를 넣었다.** 없으면 §8.2 의 마지막 케이스와 §8.3 의 첫 질문이 붙어
   같은 케이스가 두 번 찍힌 것처럼 보인다.
8. **기존 저장 실패 테스트 셋을 `--no-dry-run` 경로로 옮겼다.** 그 셋이 보는 것은 `OUTPUT_EXISTS`·
   `SAVE_FAILED`·`LINK_UNSUPPORTED` 문구다. 시험 실행을 켜 두면 확인과 분류가 끼어들어 무엇을
   보는 테스트인지 흐려진다. 게이트 자체는 새 describe 21 개가 덮는다.
9. **`--cassette` 회차 테스트를 "두 번의 CLI 실행" 으로 썼다.** 계획서 문구는 "2회차 save" 인데,
   한 실행 안에서 두 번 `save` 를 골라도 첫 실행의 모드가 `record` 라 서버를 다시 때린다
   (`cassetteClient` 는 record 모드에서 재생하지 않는다). 카세트가 파일로 남은 다음 실행이
   `auto` 가 되어 "새 케이스만 서버로" 가 성립한다. 테스트는 그 성질을 본다(2회차 inner 호출 0).
   같은 실행 안의 2회차는 아래 위험에 적었다.

## 남은 위험

- **한 실행 안에서 저장이 막힌 뒤 다시 `save` 를 고르면, 카세트 파일이 없던 경우 전량이 서버로
  다시 나간다.** 설계서 §8.3 의 "고친 케이스만 서버에 다시 나갑니다" 는 카세트 파일이 이미 있는
  실행에서만 참이다. `wireCassette` 가 모드를 `load()` 결과로 정하고 그 계약은 T5 가 소유하므로
  여기서 바꾸지 않았다. 화면 문구를 조건부로 가르거나 `wireCassette` 에 모드 인자를 여는 것이
  후속 후보다.
- **`flush()` 와 `connection.close()` 가 둘 다 클라이언트를 닫는다.** `flush()` 는
  `connection.client.close()` 를, 그 뒤 `finally` 는 `connection.close()` 를 부른다. 서로 다른
  객체이고 순서도 정상 종료 순서와 같지만, `core` 의 종료 경로가 두 번 불리는 것을 전제로 하지
  않는다면 드러날 수 있다. E2E 의 좀비 프로세스 판정이 지금은 통과한다.
- **시험 실행은 `session.approvedDraft.suite` 로 돌고 저장은 `getAuthoringExecutionSuite` 결과로
  한다.** 두 값의 지문이 같다는 전제에 기대고 있다. 저장 직후 재검증 세 조건이 이 전제를 사후에
  확인하지만, 어긋나면 "시험 실행한 것과 저장한 것이 다르다" 가 되므로 `generate` 쪽 계약이
  바뀌면 여기부터 본다.
- 검토를 오래 하면 서버 프로세스가 그동안 살아 있다. 설계서 §4.1 이 감수하기로 한 대가다.

## 커밋 메시지

```
feat(cli): generate 저장 경로에 시험 실행 게이트를 넣는다
```
