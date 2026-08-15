# Task R8: `isError` 진단에 서버 응답 본문을 싣는다

`docs/adr/0027-isError-진단의-서버-응답-본문.md` 의 결정을 구현했다. 작업 도중 오케스트레이터가
설계서와 구현 계획을 커밋해(`b7a550f`) 그 두 문서와 대조했다.

- `docs/superpowers/specs/2026-08-15-iserror-response-body-design.md` §4 표, §5 순서
- `docs/superpowers/plans/2026-08-15-iserror-response-body-implementation.md`

두 문서와 내 구현이 어긋난 곳은 없었다.

브랜치 `feat/iserror-response-body`, 기반 커밋 `9b50c68`.

## 산출물: 실제 서버 화면

`examples/weather-server` 를 띄우고 `get_weather` 에 `{"city":"example"}` 를 보낸 결과다.
빌드한 CLI 를 그대로 돌렸다.

```
$ node packages/cli/dist/cli.mjs test <suite>.json --command node --arg examples/weather-server/server.mjs

weather 예제  (1 case)

✗ get_weather-example  get_weather가 오류 없이 응답한다
    isError  정상 응답을 기대했지만 오류 응답을 받았습니다.
    → → 'example' 의 날씨 데이터가 없습니다. 사용 가능한 도시: 서울, 부산, 제주
    → → 이 예제 서버는 고정 데이터만 가지고 있습니다.
    해결: 툴 입력값과 서버의 오류 응답을 확인하세요.

1 failed  (1 total)

명세: 승인 지문이 없습니다 (미고정)
  → ohmymcp generate 로 승인한 명세가 아니거나 승인 이전 버전으로 만든 파일입니다.
```

이 줄은 이번 작업 전에는 아예 없었다. 이제 서버가 무엇이라고 거절했는지가 화면에 나온다.

`→` 가 두 번 나오는 것은 이 예제 서버가 본문 안에서 `→` 를 글머리 기호로 쓰기 때문이다.
서버가 보낸 글자를 우리가 지우지 않는다는 뜻이라 그대로 둔다.

## 바꾼 파일

| 파일 | 내용 |
|---|---|
| `packages/runner/src/diagnostics.ts` | `RunnerDiagnostic.notes?: string[]` 추가. `responseBodyNote` 추가. `isErrorMismatchDiagnostic` 이 본문과 redaction 을 받는다 |
| `packages/runner/src/assertions.ts` | `assertIsError` 가 본문 접근자와 redaction 옵션을 받는다 |
| `packages/runner/src/executor.ts` | 추출을 케이스당 한 번 기억하고 필요할 때 계산한다. 두 단언이 공유한다 |
| `packages/runner/src/reporter.ts` | `notes` 를 `violations` 다음, `hint` 앞에 `→ ` 줄로 그린다 |
| `packages/runner/tests/assertions.test.ts` | 신규 10건 |
| `packages/runner/tests/reporter.test.ts` | 신규 3건 |
| `packages/runner/tests/executor.test.ts` | 신규 2건. `bodyResult` 헬퍼에 `isError` 옵션 추가 |
| `packages/cli/tests/repair-target.test.ts` | 아래 "허용 목록 밖에서 깨진 테스트" 참고 |
| `docs/adr/0027-isError-진단의-서버-응답-본문.md` | 예시를 실제 서버 응답으로 바꿈. 결과 절 한 줄 갱신 |

`packages/cli/src` 는 한 줄도 안 고쳤다. 계획서 예상대로 교정 대상 판별이 이미 `→ ` 줄을 읽고
있어 진단만 채우니 그대로 붙었다.

`packages/cli/tests/dry-run.test.ts` 와 `packages/cli/tests/generate-command.test.ts` 는 깨지지
않아서 손대지 않았다. PR #102 와 겹칠 일이 없다.

## 허용 목록 밖에서 깨진 테스트

`packages/cli/tests/repair-target.test.ts` 의
`서버 오류 본문이 없으면 serverMessage 가 빈 문자열이다` 가 깨졌다. 처음 받은 허용 목록에 없는
파일이라 손대지 않고 오케스트레이터에 보고했고, 승인(계획서 반영 `9c2a29a`)을 받은 뒤 고쳤다.

```
AssertionError: expected 'city 가 필요합니다.' to be ''
```

테스트가 틀린 것이 아니라 **전제를 잃었다.** 그 테스트는 "`isError` 단언만 달린 케이스에는
`→ ` 줄이 없다" 를 전제로 빈 문자열을 단언했는데, 이번 작업이 바로 그 전제를 없앤다.
`selectRepairTargets` 의 "뽑을 것이 없으면 빈 문자열" 동작 자체는 그대로 살아 있다.

고친 방법은 이름과 의도를 그대로 두고 상황만 바꾼 것이다. `content` 가 배열이 아닌 오류 응답을
쓰게 해서 추출이 `CONTENT_NOT_ARRAY` 로 실패하게 만들었다. 그러면 진단이 본문을 안 싣고
`→ ` 줄이 없다. 케이스는 여전히 `isError` 로 실패하므로 교정 대상 판별은 그대로 통과한다.
`targets` 가 1건인지도 함께 단언해 그 점을 못 박았다.

### 테스트 하나 추가

```
· isError 단언만 있어도 serverMessage 에 서버 응답 본문이 들어간다
```

이 작업의 성과 자체이고 `runner` 와 `cli` 를 잇는 계약이라 한쪽만 고쳐도 조용히 깨진다.

기존 `serverMessage 에 서버 오류 본문이 들어간다` 와 겹치는지 확인했다. **겹치지 않는다.**
기존 것은 `isError` 와 `bodyMatchesSchema` 가 함께 달린 케이스를 쓰고, 본문 단언의 위반 줄에서
값이 나오는 경로를 본다. 새 것은 단언이 `isError` 하나뿐인 베이스라인 케이스이고, 진단이 본문을
싣기 시작하면서 이번에 열린 경로를 본다. 생성기가 만드는 정상 케이스가 후자의 모양이다.

## 검증

### `pnpm test`

기존 플레이크(`packages/core/tests/stdio-integration.test.ts`)는 이번에 나오지 않았다.

```
 Test Files  57 passed (57)
      Tests  1238 passed | 1 skipped (1239)
```

한 번은 `packages/core/tests/stdio-integration.test.ts` 의
`handshake timeout 뒤 프로세스를 정리한다` 1건이 실패했다. 알려진 플레이크이고 이번 변경과
무관하다. 재실행 세 번 모두 위 결과가 나왔다.

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
  Time:    1.608s
```

### `pnpm lint`

```
> biome check .

Checked 164 files in 37ms. No fixes applied.
```

줄 나누기를 넣은 뒤 새 테스트 한 곳에서 포매팅 지적이 1건 나서 `biome check --write` 로 그
파일만 고쳤다.

### 추가 확인: `generate-integration.test.ts`

실제 `weather-server` 를 띄우는 테스트다. 지정된 케이스를 포함해 5건 전부 통과한다.

```
✓ weather-server에서 baseline JSON을 만들고 process를 종료한다
✓ weather baseline은 실제 test에서 신뢰도 한계를 드러낸다
✓ 실행할 수 없는 server command는 안전한 Core 오류가 된다
✓ 입력값 교정으로 고친 값이 실제 서버 명세에 남는다
✓ 사용자 지시를 반영한 승인 candidate는 실제 test를 통과한다
```

### 뮤테이션 점검

`packages/runner/tests` 전량 + `repair-target.test.ts` + `input-repair.test.ts` (기준 523건)
에서 구현을 하나씩 망가뜨렸다.

| 망가뜨린 것 | 결과 |
|---|---|
| `notes` 를 아예 안 붙임 | 9 failed |
| JSON 본문에서 redaction 제거 | 1 failed |
| 추출 실패한 본문도 짐작해 붙임 | 2 failed |
| 리포터가 `notes` 를 안 그림 | 4 failed |
| 줄 나누기 제거(한 줄로 뭉침) | 2 failed |
| 자르기 제거 | 2 failed |
| 빈 줄 버리기 제거 | 1 failed |

전부 되돌린 뒤 523건 통과를 다시 확인했다.

## 사양 변경 (리뷰 후)

처음에는 설계서 §4 대로 text 본문을 `notes` 한 항목에 담았다. 그러면 줄바꿈이 있는 응답에서
화면이 깨진다. 리포터가 `escapeTerminalText` 를 걸어 개행이 `\u000a` 로 바뀌고, 그 줄이
들여쓰기 밖으로 튀어나간다.

```
    → → 'example' 의 날씨 데이터가 없습니다. 사용 가능한 도시: 서울, 부산, 제주\u000a→ 이 예제 서버는 고정 데이터만 가지고 있습니다.
```

오케스트레이터가 사양을 고쳤다. **본문을 개행으로 나눠 줄마다 `notes` 항목 하나로 넣는다.**

- 빈 줄은 버린다.
- 자르기는 **나누기 전 본문 전체**에 `MAX_VALUE_STRING_CHARS` 로 건다. 줄마다 따로 자르면
  긴 응답에서 총량이 안 잡힌다.
- JSON 본문은 그대로 한 줄이다. `structuralValue` 의 compact JSON 에는 개행이 없다.
- 줄 안의 글자는 손대지 않는다. 서버가 `→` 를 글머리로 쓰면 `→ → ...` 가 되는데, 그것은
  서버가 보낸 글자를 우리가 안 지운다는 뜻이라 맞다.

덮는 테스트 둘을 넣었다. `본문이 여러 줄이면 줄마다 notes 항목이 된다` 와
`여러 줄 본문을 나누기 전에 전체 길이로 자른다`. 뒤엣것은 줄마다 잘랐다면 두 줄이 온전히
남는 입력을 써서 순서를 못 박는다.

## 임의로 판단한 지점

### 1. `assertIsError` 가 본문을 값이 아니라 접근자로 받는다

계획서는 "`extraction` 결과(`BodyExtraction`)를 넘겨받아 쓴다" 라고 적었고 나는 값 대신
`() => BodyExtraction | undefined` 를 받게 했다.

값으로 받으려면 executor 가 미리 추출해야 하는데, 그러면 기존 테스트
`bodyMatchesSchema가 없으면 추출을 호출하지 않는다`(`executor.test.ts`)가 깨진다. 그 테스트는
`content` 접근 횟수를 세서 "필요 없으면 응답을 읽지 않는다" 를 못 박고 있다. `isError` 는
**실패했을 때만** 본문이 필요하고, 통과 여부는 단언 안에서 정해지므로 executor 가 미리 알 수
없다. executor 에서 `isError !== expected` 를 다시 비교하면 단언의 판정 로직이 두 곳에 생긴다.

그래서 executor 가 케이스당 한 번만 계산해 기억하는 접근자를 만들고 두 단언이 공유한다.
ADR-0011 의 "케이스당 한 번" 은 그대로이고, "필요 없으면 안 읽는다" 도 그대로다.
`bodyMatchesSchema` 쪽은 호출 시점에 `readBody()` 를 부르므로 동작이 이전과 같다.

이 판단을 덮는 테스트를 두 개 넣었다. `isError가 실패하면 그때 추출해 본문을 진단에 싣는다`
(추출 1회), `한 케이스의 isError 두 개가 같은 추출을 공유한다`(추출 1회).

### 2. JSON 본문에 `structuralValue` 를 쓴다

"진단이 이미 쓰는 직렬화 규칙" 으로 `diagnostics.ts` 안의 후보는 둘이다. `summarizeValue` 는
객체를 `object (키 3개)` 로 요약해 버려서 서버가 뭐라 했는지가 사라진다. `structuralValue` 는
구조를 유지한 compact JSON 으로 적고 상한에서 자른다. CONST·ENUM 진단이 "무엇이 다른지 보여주는
것이 전부" 라서 쓰는 함수이고, 이 자리의 목적도 같아서 그것을 골랐다.

redaction 을 태우려고 `keys` 인자에 빈 배열을 넘겼다. `undefined` 를 넘기면 `structuralValue` 가
sanitize 를 건너뛴다. 빈 배열이면 조상 키 검사만 비고 `sanitizeJsonValue` 는 그대로 돈다.

### 3. text 본문의 redaction 은 값 전체 일치일 때만 걸린다

`sanitizeJsonValue` 는 문자열에 대해 `sensitiveValues` 와 **정확히 같을 때만** 가린다. 부분
문자열은 안 가린다. 이것은 내가 정한 것이 아니라 `sanitization.ts` 의 기존 규칙이고, ADR-0008
이 정한 승인 화면과 같은 규칙을 쓰라는 지시를 따른 결과다. 테스트 두 개로 양쪽을 못 박았다.
JSON 본문의 민감한 **키**는 가려지고(`{"token":"[REDACTED]",...}`), text 본문은 값 전체가
일치할 때 가려진다.

### 4. `executor.test.ts` 의 `bodyResult` 헬퍼에 `isError` 옵션을 더했다

`isError` 실패를 만들려면 `isError: true` 인 응답이 필요한데, 그 헬퍼는 `content` 를 게터로
만들어 접근 횟수를 센다. 객체 전개(`{...bodyResult(...), isError: true}`)로 덮으면 게터가 그
자리에서 실행돼 카운터가 먼저 올라가고 지연 추출을 못 본다. 그래서 헬퍼에 선택 옵션을 더했다.
기본값은 `false` 라 기존 호출부는 영향이 없다.

## 남은 위험

- **설계서 파일이 이 worktree 에 없어 못 고쳤다.**
  `docs/superpowers/specs/2026-08-15-iserror-response-body-design.md` 는 분기점(`9b50c68`)
  뒤에 main 에 커밋돼서 이 worktree 에 존재하지 않는다. 루트 작업 트리를 고치지 말라는 지시가
  있었고 rebase 는 git 작업이라 하지 않았다. §4 의 "form 이 text 면 그 문자열을 한 줄로
  싣는다" 와 §5 예시가 아직 옛 규칙이다. 아래 문안으로 바꾸면 된다.
  - §4 표: `form === "text"` 행을 "개행으로 나눠 줄마다 항목 하나로 싣는다. 빈 줄은 버린다"
  - §4 본문: 자르기는 나누기 전 본문 전체에 `MAX_VALUE_STRING_CHARS` 로 건다
  - §5 예시: 이 보고서 맨 위의 실제 출력 블록
- **ADR 결정 절의 한 줄이 낡았다.** `0027` 56행이 "응답 본문을 `notes` 에 한 줄로 싣는다" 다.
  결정·이유 절을 건드리지 말라는 지시를 따라 그대로 뒀다. 배경의 예시와 결과 절은 고쳤다.
- **본문이 외부 provider 로 나가는 경로가 이제 실제로 열렸다.** ADR-0027 이 예고한 결과이고
  redaction 은 ADR-0008 규칙을 그대로 쓴다. 다만 위 3번대로 text 본문의 값 가리기가 전체 일치
  기준이라, 오류 문장 **안에** 토큰이 섞여 나오는 서버라면 그 문장이 그대로 나간다. 기존 승인
  화면과 같은 노출 수준이지만 노출 지점이 하나 늘었다.
- `notes` 는 선택 필드라 다른 진단은 손대지 않았다. 반대로 말하면 지금 `notes` 를 채우는 곳은
  `isError` 하나뿐이고, 다른 진단이 채우기 시작하면 리포터 순서 규칙(violations 먼저)을 다시
  볼 필요가 있다.

## 커밋 메시지

```
feat(runner): isError 진단에 서버 응답 본문을 싣는다
```

커밋은 하지 않았다.
