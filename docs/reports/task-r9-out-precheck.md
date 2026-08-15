# Task R9: generate 출력 경로 선검사와 `--force` (`cli`)

계획서 `docs/superpowers/plans/2026-08-15-generate-out-precheck-implementation.md` §4 를
구현했다. 화면 문안과 검사 자리는 설계서
`docs/superpowers/specs/2026-08-15-generate-out-precheck-design.md` §4·§5·§6 이 전량 고정한다.

브랜치 `feat/generate-out-precheck`, 기반 커밋 `d72e5b5`.

## 바꾼 파일

| 파일 | 내용 |
|---|---|
| `packages/cli/src/generate-command.ts` | `--force` 옵션, 선검사, 덮어쓰기 저장, 문안 세 가지 |
| `packages/cli/src/help.ts` | `GENERATE_USAGE` 에 `[--force]`, 설명 블록에 `--force` 줄 |
| `packages/cli/tests/generate-command.test.ts` | 신규 18건 + 기존 2건 갱신 |
| `packages/cli/tests/help.test.ts` | 신규 2건 |
| `packages/cli/tests/dist-cli-e2e.mjs` | 도움말 옵션 목록에 `--force`, 재실행 선검사 블록 |

허용 목록 밖은 건드리지 않았다. `packages/runner`, `packages/generate`, `core/src/types.ts`,
루트 빌드 설정, 입력값 교정 모듈 전부 그대로다.

```
 M packages/cli/src/generate-command.ts
 M packages/cli/src/help.ts
 M packages/cli/tests/dist-cli-e2e.mjs
 M packages/cli/tests/generate-command.test.ts
 M packages/cli/tests/help.test.ts
```

### `generate-command.test.ts` 에서 손댄 범위 (PR #102 충돌 지점)

PR #102 가 같은 파일을 고치고 있어 범위를 적어 둔다.

1. **파일 끝에 `describe` 블록 세 개를 덧붙였다.** `generate 옵션 파싱`,
   `generate 출력 경로 선검사`, `generate 덮어쓰기 저장`. 기존 블록 안에 끼워 넣지 않았다.
   충돌이 나더라도 파일 끝의 추가분이라 양쪽을 이어 붙이면 된다.
2. **기존 테스트 한 건의 기대값에 한 줄을 더했다.** `generate 필수 값과 반복 arg를 순서대로
   파싱한다` 의 기대 객체에 `force: false` 를 넣었다. `parseGenerateCommand` 결과 전량을
   비교하는 테스트라 필드가 늘면 반드시 같이 늘어야 한다. 그 한 줄 말고는 안 고쳤다.
3. **리뷰 후 추가분도 전부 파일 끝 블록 안이다.** `generate 덮어쓰기 저장` 안에
   `failingUnlink` 헬퍼를 만들고 테스트 세 건을 더했다. 그 블록에 이미 있던
   `--force 인데 unlink 가 다른 오류면 저장이 실패한다` 는 단언을 새 문안으로 바꿨다.
   이 네 건은 모두 이번 태스크가 만든 블록 안이라 PR #102 와 겹치지 않는다.

`deps()` 헬퍼와 `normalizedEvents` 같은 공용 도구는 손대지 않고 그대로 썼다.

## 검사 자리 셋

설계서 §4 대로 셋이 되었고 역할이 다르다.

| 자리 | 시점 | `--force` |
|---|---|---|
| 선검사 (신설) | `parseGenerateCommand` 직후, `deps.connect` 앞 | 건너뛴다 |
| `exists` 선검사 (기존) | `saveSuite` 시작 직전 | 건너뛴다 |
| `link` 의 `EEXIST` (기존) | 커밋 순간 | **그대로 둔다** |

`link` 의 `EEXIST` 검사는 손대지 않았고 `rename` 도 넣지 않았다. R4 가 실측으로 없앤 데이터
손실 결함이 돌아오지 않는다. `--force` 의 덮어쓰기는 `link` 직전 `deps.unlink` 하나로 한다.
새 primitive 를 만들지 않았다.

## 검증

### `pnpm test`

삭제 실패 문안을 넣은 뒤 한 번은 기존 플레이크가 났다.
`packages/core/tests/stdio-integration.test.ts` 의 `handshake timeout 뒤 프로세스를 정리한다`
1건이고 이번 변경과 무관하다. 재실행 세 번 모두 아래 결과가 나왔다.

```
 Test Files  57 passed (57)
      Tests  1258 passed | 1 skipped (1259)
```

### `pnpm build && pnpm --filter ohmymcp test:e2e`

```
 Tasks:    6 successful, 6 total

> ohmymcp@0.6.1 test:e2e
> node ./tests/dist-cli-e2e.mjs

e2e exit=0
```

### `pnpm typecheck --force`

```
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
  Time:    1.512s
```

### `pnpm lint`

```
> biome check .

Checked 164 files in 57ms. No fixes applied.
```

포매팅 지적은 나오지 않았다.

### 뮤테이션 점검

구현을 하나씩 망가뜨려 테스트가 실제로 붙들고 있는지 확인했다(기준 176건).

| 망가뜨린 것 | 결과 |
|---|---|
| 선검사가 `--force` 를 무시 | 6 failed |
| 선검사 문안을 저장용 문안으로 | 1 failed |
| 저장 `exists` 가 `--force` 를 무시 | 5 failed |
| `unlink` 덮어쓰기 제거 | 2 failed |
| `ENOENT` 말고 다른 오류도 삼킴 | 1 failed |
| 삭제 실패 전용 타입 제거(`GENERATE_FAILED` 로 뭉갬) | 4 failed |
| 코드가 없을 때 괄호를 안 뺌 | 1 failed |
| `ENOENT` 삼키기 제거 | 1 failed |

E2E 도 따로 확인했다. **선검사 블록을 통째로 지우고 다시 빌드하면 `test:e2e` 가 실패한다.**
되돌린 뒤 다시 통과한다. 유닛만으로는 배포 산출물이 그 순서를 지키는지 못 본다.

전부 되돌린 뒤 176건 통과와 `e2e exit=0` 을 다시 확인했다.

## 임의로 판단한 지점

### 1. 선검사를 TTY 게이트보다 앞에 뒀다

계획서는 "`parseGenerateCommand` 로 입력을 만든 직후" 라고 적었고 그대로 따랐다. 그 자리는
`GENERATE_INTERACTIVE_REQUIRED` 검사보다도 앞이다.

결과가 하나 갈린다. 비대화형에서 `--out` 이 이미 있는 채로 AI 검토 경로를 부르면 이제 TTY
안내 대신 출력 충돌 안내가 나온다. 둘 다 사실이지만 **먼저 고쳐야 하는 것은 출력 경로다.**
TTY 를 붙여 다시 돌려도 같은 자리에서 막히기 때문이다. 순서를 뒤집으면 사용자가 두 번 실패한다.

### 2. 출력 충돌 문안 두 가지를 한 함수에서 낸다

설계서 §6 이 "두 문장의 차이는 `시작하지 않았습니다` 와 `저장하지 않았습니다` 뿐이다. 코드는
같아야 한다" 로 못 박았다. 기존 `outputExistsFailure` 에 `stage` 인자를 더하고 그 한 마디만
갈랐다. 기본값은 `"save"` 라 기존 호출부 두 곳은 그대로다.

저장 단계 문안의 **해결 줄은 바뀌었다.** 기존에는 "기존 파일을 옮긴 뒤 다시 저장하세요" 였고
이제 "다른 `--out` 경로를 지정하거나, 기존 파일을 덮어쓰려면 `--force` 를 붙이세요" 다.
설계서 §6 이 두 문안을 같은 해결 줄로 고정했고, `--force` 가 생겼으니 옛 안내는 더 이상
사용자가 할 수 있는 최선이 아니다.

삭제 실패 문안(`GENERATE_OUTPUT_REPLACE_FAILED`)은 별도 함수다. 코드도 해결 줄도 다르므로
같은 함수에 인자를 하나 더 두지 않았다. 오류 타입도 `OutputReplaceError` 로 따로 두고
`catch` 두 곳에서 갈랐다. `GENERATE_FAILED` 로 뭉뚱그리지 않는다.

### 3. `--force` 일 때 `exists` 를 아예 부르지 않는다

계획서는 두 자리에서 "건너뛴다" 라고만 적었다. `!input.force && (await deps.exists(...))` 로
써서 단축 평가에 걸리게 했다. 즉 `--force` 면 `exists` 호출 자체가 없다. 테스트
`--force 면 저장 직전 exists 검사를 건너뛴다` 가 이것을 `exists` 가 `outPath` 로 불리지
않았다는 것으로 본다.

### 4. E2E 에서 "서버가 뜨지 않았다" 를 PID 파일 값으로 본다

계획서는 "기존 `expectExited` 와 같은 방식으로 본다" 라고 적었다. 그런데 `expectExited` 만으로는
약하다. PID 파일에는 **직전 실행이 남긴 죽은 PID** 가 들어 있어서, 새 서버가 뜨든 안 뜨든
그 함수는 통과한다.

그래서 재실행 직전 PID 파일 내용을 읽어 두고, 재실행 뒤 값이 그대로인지 본다. wrapper 가
서버를 띄우면 파일을 새 값으로 덮어쓰므로 값이 같다는 것은 안 떴다는 뜻이다. `expectExited`
도 그대로 함께 부른다. 새 검사 방식을 만든 것이 아니라 기존 PID 파일을 한 번 더 읽었다.

### 5. 테스트 이름은 계획서 그대로 썼다

계획서 목록을 그대로 썼다. E2E 두 항목은 기존 도움말 블록의 옵션 목록에 `--force` 를 더하는
것과 재실행 블록 신설로 각각 처리했다.

리뷰 후 삭제 실패 문안을 넣으면서 세 건을 더했다. 오케스트레이터가 지정한 두 건
(`EISDIR` 이면 replace 실패 문안, 그 문안에 시스템 코드)에 더해 `코드 없는 unlink 오류면
괄호를 빼고 적는다` 를 넣었다. 코드가 없을 때 괄호를 빼라는 규칙을 붙드는 이름이 없었고,
실제로 그 규칙을 지우면 `(undefined)` 가 사용자 화면에 나간다.

## 남은 위험

- **`unlink` 와 `link` 사이의 창.** 그 사이에 다른 프로세스가 같은 경로를 만들면 `link` 가
  `EEXIST` 로 실패한다. 설계서 §5 가 그 창을 알면서도 `rename` 을 금지했고 나도 그대로 뒀다.
  사용자에게는 지금과 같은 저장 실패로 보인다.
- **선검사와 저장 사이의 창.** 선검사를 통과한 뒤 다른 프로세스가 파일을 만들면 저장 단계에서
  걸린다. 이것은 원래 있던 성질이고 선검사가 보장이 아니라 편의라는 뜻이다. 기존 주석의 구분을
  그대로 유지했다.
- **`--force` 는 여전히 디렉터리를 지우지 못한다.** 다만 이제 화면이 그 사실에 다가간다.
  `unlink` 가 `EISDIR`·`EPERM` 을 내면 전용 문안이 시스템 코드와 함께 나가고, 사용자가 확인할
  두 가지(디렉터리인지, 권한이 없는지)를 적어 준다. **원인을 단정하지는 않는다.** 여기서
  구분할 수단이 없고 그것을 알려고 `stat` 을 주입하지 않는다는 것이 설계서 §6 의 결정이다.
- **삭제 실패는 저장 실패로 취급한다.** 종료 코드가 기존 저장 실패와 같고, 대화형 경로에서는
  검토 메뉴로 돌아가는 동작도 그대로다. 즉 `--out` 이 디렉터리인 채로 `save` 를 다시 고르면
  시험 실행이 처음부터 다시 돈다. 선검사는 `exists` 가 참이면 `--force` 없이 끊고 `--force`
  면 건너뛰므로, 디렉터리 경우를 착수 전에 잡아 주지는 않는다.
- **`generate-command.test.ts` 가 PR #102 와 겹친다.** 위 "손댄 범위" 대로 파일 끝 추가와 한 줄
  갱신뿐이라 병합은 어렵지 않을 것으로 본다. 다만 그 PR 이 `deps()` 헬퍼나 파싱 결과 전량 비교
  테스트를 함께 고쳤다면 `force: false` 줄이 양쪽에서 충돌한다.

## 커밋 메시지

```
feat(cli): generate 출력 경로를 착수 전에 검사하고 --force 를 추가한다
```

커밋은 하지 않았다.
