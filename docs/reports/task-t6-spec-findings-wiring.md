# T6 보고서: 실환경 확인 (직렬 전용)

계획서 "Task 6: 실환경 확인" Step 1~6 과 오케스트레이터가 더한 항목 5·6 을 수행했다.
**소스는 한 줄도 고치지 않았다.** 쓴 파일은 이 보고서 하나뿐이다.

**판정: READY_FOR_REVIEW.** 확인 항목 여섯 중 다섯이 예상대로 재현됐다. 나머지 하나
(`SCHEMA_NOT_ANALYZABLE` 머리글)는 `examples/weather-server` 로는 구조적으로 재현할 수 없다.
사유는 6절에 있다. 결함이 아니라 예제 서버의 스키마가 전부 해석 가능해서다.

## 0. 준비

`pnpm build` 를 먼저 돌렸다(`Tasks: 6 successful, 6 total`). 실행 진입점은
`packages/cli/dist/cli.mjs` 다. 계획서 Step 2 는 `packages/cli/dist/cli.js` 라고 적고 있는데 그
파일은 없다. `packages/cli/package.json:12` 의 `bin` 이 `./dist/cli.mjs` 다.

예제 서버: `examples/weather-server/server.mjs`. 선언한 툴은 둘이다.

| 툴 | inputSchema | required |
|---|---|---|
| `get_weather` | `{ type: "object", properties: { city: { type: "string" } } }` | `["city"]` |
| `add` | `{ type: "object", properties: { a: { type: "number" }, b: { type: "number" } } }` | `["a", "b"]` |

둘 다 `additionalProperties` 를 닫지 않는다. 그래서 `UNDECLARED_FIELD` 는 구조적으로 나지
않는다. 오케스트레이터가 예상한 대로이고, 대신 `REQUIRED_MISSING` 으로 1번을 확인했다.

명세 JSON 은 전부 `/tmp` 에 만들었고 저장소에 넣지 않았다.

| 파일 | 용도 |
|---|---|
| `/tmp/t6-typo.json` | `get_weather` 의 `city` 를 `citi` 로 오타 |
| `/tmp/t6-ok.json` | 같은 명세에서 필드 이름만 바로잡은 것 |
| `/tmp/t6-vacuous.json` | `bodyMatchesSchema` 에 `minLength: 0` |
| `/tmp/t6-combined.json` | 오타 + 항상 참인 단언 + `add` 의 `a` 에 문자열 |
| `/tmp/t6-gen-candidate.json` | 승인 화면용 후보 (baseline 에서 파생) |
| `/tmp/t6-drive.py` | 승인 화면을 pty 로 구동하는 스크립트 |

---

## 1. 오타 명세로 `test` → 참고 문장과 exit code 1 ✅

```
$ node packages/cli/dist/cli.mjs test /tmp/t6-typo.json --command node --arg examples/weather-server/server.mjs

T6 실환경 확인  (1 case)

✗ seoul-weather  서울 날씨
    isError  정상 응답을 기대했지만 오류 응답을 받았습니다.
    해결: 툴 입력값과 서버의 오류 응답을 확인하세요.

1 failed  (1 total)

참고: seoul-weather 의 입력이 서버 선언과 다릅니다
  → 필수 필드 'city' 가 입력에 없습니다. 비슷한 필드: 'citi'

명세: 승인 지문이 없습니다 (미고정)
  → ohmymcp generate 로 승인한 명세가 아니거나 승인 이전 버전으로 만든 파일입니다.
EXIT=1
```

머리글, 비슷한 필드 제안, 위치(보고서 뒤·승인 블록 앞), exit code 1 전부 사양대로다.

## 2. 결정론성 ✅

```
$ node packages/cli/dist/cli.mjs test /tmp/t6-typo.json --command node --arg examples/weather-server/server.mjs --json > /tmp/t6-a.json
$ node packages/cli/dist/cli.mjs test /tmp/t6-typo.json --command node --arg examples/weather-server/server.mjs --json > /tmp/t6-b.json
$ cmp /tmp/t6-a.json /tmp/t6-b.json
(무출력)
exit: 1 1
```

`--json` 의 `spec` 블록도 확인했다. 문장이 아니라 구조로만 담겨 있다.

```json
{
  "approval": "absent",
  "fingerprint": "a4e9a7812d670fd4baae23d5be3e6c204c981c2855d24e7b9679ec2a912a0981",
  "findings": [
    { "code": "REQUIRED_MISSING", "severity": "blocking", "caseId": "seoul-weather", "path": "input.city" }
  ]
}
```

## 3. 옳은 명세에는 아무것도 안 붙는다 ✅

```
$ node packages/cli/dist/cli.mjs test /tmp/t6-ok.json --command node --arg examples/weather-server/server.mjs

T6 실환경 확인  (1 case)

✓ seoul-weather  서울 날씨

1 passed  (1 total)
EXIT=0
```

`참고:` 가 없고 exit code 0 이다.

## 4. 기존 E2E ✅ (다만 아래 주의)

```
$ pnpm test
 Test Files  43 passed (43)
      Tests  850 passed | 1 skipped (851)
```

**주의: `packages/cli/tests/dist-cli-e2e.mjs` 는 `pnpm test` 에 포함되지 않는다.** 확장자가
`.mjs` 라 루트 `vitest.config.ts` 의 수집 패턴(`packages/*/tests/**/*.test.ts`)에 안 걸린다.
`packages/cli/package.json:35` 의 `test:e2e` 스크립트로만 돈다. 계획서 Step 5 가
"`packages/cli/tests/dist-cli-e2e.mjs` 가 포함된 경로도 통과" 라고 적고 있어 `pnpm test` 만 보고
통과했다고 판정하면 거짓 신호다. 따로 돌렸다.

```
$ node ./tests/dist-cli-e2e.mjs
EXIT=0
```

다만 그 파일(430줄)에는 `참고` · `입력 계약` · `specFindings` 문자열이 하나도 없다. **이번
기능을 덮지 않는다.** 통과했다는 것은 기존 동작이 안 깨졌다는 뜻이지 새 출력이 검증됐다는 뜻이
아니다.

## 5. 승인 화면에 실제로 문장이 찍히는가 ✅ (T4 위험 해소)

T4 담당이 남긴 위험이다. 승인 화면 테스트는 candidate 를 리터럴로 주입하므로 실제 `generate` 가
채우는 `specFindings` 모양과 어긋나도 못 잡는다. 실환경에서 확인했다.

**provider 는 부르지 않았다.** `edit` 메뉴로 로컬 JSON 을 후보로 넣는 경로만 썼다. API 키가
필요한 경로는 건드리지 않았다.

먼저 baseline 을 뽑았다(`--baseline-only`). 결과는 위반이 하나도 없는 깨끗한 명세다
(`get-weather-success` 는 `city: "example"`, `add-success` 는 `a: 0, b: 0`). **baseline 만으로는
finding 이 안 난다.** 그래서 baseline 의 첫 케이스를 오타(`citi`) + 항상 참인 단언
(`minLength: 0`) 으로 바꾼 후보를 만들어 넣었다.

`generate` 는 stdin·stdout 양쪽이 TTY 여야 대화형으로 뜬다(`generate-command.ts:828`). 파이프로는
`GENERATE_INTERACTIVE_REQUIRED` 로 거절된다. `python3` 의 `pty.fork` 로 의사 터미널을 만들어
메뉴에 답했다. 실제 출력이다(제어 문자는 그대로 뒀다).

```
검토 메뉴 [codex/claude/apply-all/select/revise/edit/save/cancel]: edit
편집한 JSON 파일 경로: /tmp/t6-gen-candidate.json
change-001 replaceCase get-weather-success
  - operation.input.city: "example"
  + operation.input.citi: "서울"
  + assertions[1].type: "bodyMatchesSchema"
  + assertions[1].schema.type: "string"
  + assertions[1].schema.minLength: 0
검토 메뉴 [codex/claude/apply-all/select/revise/edit/save/cancel]: select
change-001 replaceCase get-weather-success
  - operation.input.city: "example"
  + operation.input.citi: "서울"
  + assertions[1].type: "bodyMatchesSchema"
  + assertions[1].schema.type: "string"
  + assertions[1].schema.minLength: 0
적용할 change ID를 쉼표로 입력하세요: change-001
입력 계약 위반 1건 (선택한 변경 기준)
  → change-001 get-weather-success
     필수 필드 'city' 가 입력에 없습니다. 비슷한 필드: 'citi'
항상 통과하는 단언 1건 (선택한 변경 기준)
  → change-001 get-weather-success
     assertions[1].schema.minLength 는 0이라 모든 문자열이 통과합니다
위반 2건이 남아 있습니다. 그래도 적용합니까? [y/N] y
선택한 변경을 적용할까요? [y/N] y
revision 1을 승인했습니다.
검토 메뉴 [codex/claude/apply-all/select/revise/edit/save/cancel]: cancel
```

T4·T4b 사양이 전부 실환경에서 그대로 나온다.

- 두 머리글이 갈려 나온다.
- 입력 계약 블록이 먼저다.
- 재확인은 합계(`2건`)로 **한 번**만 받는다.
- 거부하지 않고 진행을 열어 둔다.
- 문장은 `describeSpecFinding` 것 그대로다.

**리터럴 주입 테스트가 실제 모양과 어긋난다는 위험은 해소됐다.**

## 6. 새 머리글 셋의 실환경 재현 여부

| 머리글 | 재현 | 근거 |
|---|---|---|
| `참고: <caseId> 의 입력이 서버 선언과 다릅니다` | ✅ | 1절·아래 복합 출력 |
| `참고: <caseId> 의 단언은 무엇이 와도 통과합니다` | ✅ | 아래 |
| `참고: <caseId> 의 입력 검사를 건너뛰었습니다` | ❌ 재현 불가 | 사유는 아래 |

### 단언 실질성 머리글 ✅

```
$ node packages/cli/dist/cli.mjs test /tmp/t6-vacuous.json --command node --arg examples/weather-server/server.mjs

✗ vacuous-case  항상 통과하는 단언
    isError  정상 응답을 기대했지만 오류 응답을 받았습니다.

1 failed  (1 total)

참고: vacuous-case 의 단언은 무엇이 와도 통과합니다
  → assertions[1].schema.minLength 는 0이라 모든 문자열이 통과합니다
EXIT=1
```

### 두 머리글이 한 화면에 함께 나오는 경우 ✅

계획서에 없는 확인이다. 설계 문서 §7.2 가 정한 블록 순서와 케이스 순서를 실환경에서 봤다.

```
$ node packages/cli/dist/cli.mjs test /tmp/t6-combined.json --command node --arg examples/weather-server/server.mjs

✗ seoul-weather  오타 + 항상 참인 단언
✗ add-case       타입 불일치

2 failed  (2 total)

참고: seoul-weather 의 입력이 서버 선언과 다릅니다
  → 필수 필드 'city' 가 입력에 없습니다. 비슷한 필드: 'citi'

참고: seoul-weather 의 단언은 무엇이 와도 통과합니다
  → assertions[1].schema.minLength 는 0이라 모든 문자열이 통과합니다

참고: add-case 의 입력이 서버 선언과 다릅니다
  → input.a 의 타입이 다릅니다. 서버 선언: 'number', 명세: 'string'
EXIT=1
```

같은 케이스 안에서 입력 계약이 먼저이고 단언 실질성이 뒤다. 케이스 순서는 명세 순서 그대로다.
T1 이 고친 `서버 선언:` 문안도 실환경에서 확인됐다.

### 건너뜀 머리글은 재현할 수 없다 ❌

`SCHEMA_NOT_ANALYZABLE` 은 서버의 `inputSchema` 를 해석하지 못했을 때만 난다. ADR-0015 의
차단 키워드(`anyOf` · `oneOf` · `allOf` · `not` · `if` · `$ref` 등)가 루트에 있어야 한다.
`examples/weather-server` 의 두 툴은 `type` · `properties` · `required` 만 쓰므로 전부 해석
가능하다. 재현하려면 예제 서버의 `inputSchema` 를 고쳐야 하는데 **소스 수정 금지가 이 태스크의
전제**라 하지 않았다.

이것은 결함이 아니다. 예제 서버가 단순해서 그 분기에 도달하지 않을 뿐이다. 그 코드 경로는
`packages/cli/tests/test-command.test.ts` 의 유닛테스트가 덮는다. 실환경 확인이 필요하다고
판단되면 `anyOf` 를 쓰는 툴을 예제 서버에 하나 더 넣는 별도 태스크가 필요하다.

---

## 예상과 달랐던 것

1. **계획서의 실행 경로가 틀렸다.** `packages/cli/dist/cli.js` 는 없다. `dist/cli.mjs` 다.
2. **`pnpm test` 가 `dist-cli-e2e.mjs` 를 안 돈다.** 계획서 Step 5 의 기대와 다르다. 4절에
   적었다. `CLAUDE.local.md` 의 거짓 신호 표에 있는 "테스트 러너 수집 설정 확인" 항목이 그대로
   해당한다.
3. **`generate` 대화형은 파이프로 못 띄운다.** stdin·stdout 둘 다 TTY 를 요구한다. `pty.fork`
   가 필요했다. 계획서는 이 제약을 적지 않았다.
4. **baseline 만으로는 승인 화면에 finding 이 안 난다.** `createBaselineSuite` 가 만드는 명세는
   서버 선언에서 파생되므로 정의상 입력 계약을 어기지 않는다. 승인 화면 확인에는 사람이 손댄
   후보가 반드시 필요하다.

## 임의로 판단한 지점

1. **승인 화면 구동에 `pty.fork` 스크립트를 썼다.** `script -q /dev/null … < file` 을 먼저
   시도했으나 입력 EOF 가 즉시 pty 를 닫아 첫 메뉴에서 끝났다. 파이썬으로 pty 를 직접 열고
   출력이 멎으면 다음 답을 쓰는 방식으로 바꿨다. 스크립트는 `/tmp/t6-drive.py` 에 있고 저장소에
   넣지 않았다.
2. **`t6-combined.json` 을 추가로 만들었다.** 계획서에도 지시에도 없다. 두 머리글이 한 화면에
   함께 나올 때의 블록 순서와 `TYPE_MISMATCH` 문안은 설계 문서 §7.2 가 정한 것인데 유닛테스트
   밖에서 본 적이 없었다.
3. **`dist-cli-e2e.mjs` 를 따로 돌렸다.** `pnpm test` 에 안 걸린다는 것을 확인한 뒤다. 안 돌리고
   "Step 5 통과" 라고 적었으면 거짓 보고가 된다.
4. **좀비 확인 범위.** `pgrep -fl "ohmymcp-spec-findings-wiring"` 로 이 worktree 발 프로세스가
   0인 것을 확인했다. `pgrep -fl "weather-server/server.mjs"` 에는 두 개가 잡히는데 경로가
   **원본 저장소**(`/Users/doo._.hyun/Study/Project/OhMyMCP/packages/cli/…`)이고 `--provider codex`
   가 붙어 있다. 내 실행이 아니라 다른 세션 것이라 손대지 않았다.

## 남은 위험

1. **`dist-cli-e2e.mjs` 가 이번 기능을 안 덮는다.** 430줄 어디에도 `참고` · `입력 계약` ·
   `specFindings` 가 없다. CI 가 "우리 도구로 우리를 검증한다" 를 지키는 파일인데, 이번에 넣은
   출력은 그 그물에 안 걸린다. 오타 명세 하나를 그 스크립트에 더하는 것이 자연스러운 후속이다.
2. **`SCHEMA_NOT_ANALYZABLE` 경로는 실환경에서 한 번도 안 돌아봤다.** 유닛테스트만 덮는다.
   예제 서버에 `anyOf` 툴이 없어서다.
3. **`UNDECLARED_FIELD` 도 실환경 미확인이다.** 예제 서버가 `additionalProperties` 를 닫지 않아
   구조적으로 안 난다. 승인 화면과 `test` 화면 양쪽에서 이 코드의 문장은 유닛테스트로만
   검증돼 있다.
4. **승인 화면 확인은 수동 pty 구동이라 CI 에 없다.** 이번에 눈으로 봤지만, 다음에 누가
   `confirmSpecFindings` 를 깨뜨리면 잡는 것은 리터럴 주입 유닛테스트뿐이다. 그 테스트가 실제
   모양과 어긋날 수 있다는 위험은 오늘 확인으로 "지금은 맞다" 까지만 닫혔고, 앞으로도 맞다는
   보장은 아니다.
