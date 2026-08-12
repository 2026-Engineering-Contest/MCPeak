# Task B6 보고서 — CLI 실패 메시지 원인별 재작성

## 작업 공간

- worktree: `<repo-root>/.claude/worktrees/ohmymcp-cli-failure-message`
- 브랜치: `fix/cli-failure-message`
- `git rev-parse HEAD`: `9f17a69763ecf94df6ff47b0d9fc047633891351`
- 기점 커밋: `9f17a69 docs(cli): B4·B5 통합 대장 기록` (지시받은 값과 일치)
- 진입 시 `git status --short` 비어 있음
- `pnpm install` 후 `pnpm build`, `pnpm vitest run packages/cli` (78 passed) 실행 확인
- **`PublicProviderFailure.reason` 존재 확인** (`packages/generate/src/authoring-request.ts:91`)

```ts
export interface PublicProviderFailure {
  readonly providerId: "codex" | "claude";
  readonly code: AuthoringProviderFailureCode;
  readonly timeoutMs: number;
  readonly exitCode?: number;
  /** 닫힌 enum이며 CLI 안내 분기에만 쓴다. raw stream 문자열은 절대 담기지 않는다. */
  readonly reason?: AuthoringProviderFailureReason;
  readonly stderr?: { readonly captured: boolean; readonly truncated: boolean };
}
```

## 변경 파일

| 파일 | 내용 |
|---|---|
| `packages/cli/src/generate-command.ts` | `authCommand`·`exitMessage` 추가, `providerFailure` 시그니처에 `model` 추가 |
| `packages/cli/tests/generate-command.test.ts` | `failOn` 헬퍼 + 테스트 9개 추가 |
| `.changeset/cli-failure-message-reason.md` | 신규 (patch, `ohmymcp`) |
| `docs/reports/task-b6.md` | 이 보고서 |

`packages/generate`는 읽기만 했다. 타입을 바꿔야 할 일은 없었다.

## 고친 것 세 가지

1. **provider별 명령만 안내한다.** `authCommand(provider)`를 두어 codex는 `codex login status`,
   claude는 `claude /status`만 찍는다. 기존 `nonZeroExit` 문구가 유일하게 두 명령을 뭉쳐 놓은
   곳이었고, 그 문구가 사라졌다.
2. **모델 이름을 찍는다.** `providerFailure(deps, failure, model)`로 시그니처를 넓혀 CLI가 그
   요청에 쓴 `model` 값을 넘긴다. `reason`에는 모델 이름이 담기지 않으므로 CLI 자신의 값을 쓴다.
3. **`reason`별로 코드와 조치를 나눴다.** `exitMessage()`가 `nonZeroExit`만 담당한다.

### 다른 코드의 provider별 처리 점검 (지시받은 확인)

| code | 명령 포함 | 판정 |
|---|---|---|
| `providerUnavailable` | `` `{id} --version` `` | 이미 provider별. 그대로 둠 |
| `timedOut` | 없음 | 그대로 둠 |
| `schemaMismatch` | 없음 | 그대로 둠 |
| `cancelled` | 없음 | 그대로 둠 |
| `nonZeroExit` | `codex login status` **또는** `claude /status` | **뭉쳐 있던 유일한 곳. 고침** |

## 여섯 reason의 실제 출력 원문

임시 덤프 테스트로 뽑은 문자열 그대로다. 실제 provider는 부르지 않았다. 덤프 테스트는 확인 후
제거했다.

아래는 **조사 수정을 반영한 최종 문구**다(리뷰 반영 절 참고).

```
<<<providerUnavailable>>>
오류 [GENERATE_PROVIDER_UNAVAILABLE]: codex CLI를 실행할 수 없습니다.
해결: `codex --version` 명령으로 설치와 PATH를 확인한 뒤 다시 요청하세요.
<<<unknownModel>>>
오류 [GENERATE_PROVIDER_MODEL]: codex가 이 모델을 사용할 수 없습니다. 모델: gpt-nonexistent
해결: 모델 이름을 확인하세요. 이 계정에서 쓸 수 없는 모델일 수도 있습니다. codex 기본값은 gpt-5.6-luna입니다.
<<<unknownModel sonnet>>>
오류 [GENERATE_PROVIDER_MODEL]: claude가 이 모델을 사용할 수 없습니다. 모델: sonnet
해결: 모델 이름을 확인하세요. 이 계정에서 쓸 수 없는 모델일 수도 있습니다. claude 기본값은 haiku입니다.
<<<notAuthenticated codex>>>
오류 [GENERATE_PROVIDER_AUTH]: codex 인증이 유효하지 않습니다.
해결: `codex login status` 명령으로 로그인 상태를 확인한 뒤 다시 요청하세요.
<<<notAuthenticated claude>>>
오류 [GENERATE_PROVIDER_AUTH]: claude 인증이 유효하지 않습니다.
해결: `claude /status` 명령으로 로그인 상태를 확인한 뒤 다시 요청하세요.
<<<rateLimited>>>
오류 [GENERATE_PROVIDER_RATE_LIMIT]: codex가 요청 한도를 초과했습니다.
해결: 잠시 뒤 다시 요청하세요. 반복되면 도구 수를 줄여 payload를 줄이세요.
<<<badRequest>>>
오류 [GENERATE_PROVIDER_REQUEST]: codex가 요청을 거절했습니다. 모델: gpt-weird
해결: 두 가지를 확인하세요.
  1. 모델 이름이 이 계정에서 쓸 수 있는지. codex 기본값은 gpt-5.6-luna입니다.
  2. provider가 전송 schema를 받아들이는지. 반복되면 다른 provider로 시도하세요.
<<<serverError>>>
오류 [GENERATE_PROVIDER_SERVER]: claude 쪽 서버 오류입니다.
해결: 잠시 뒤 다시 요청하세요. 계속되면 provider 상태 페이지를 확인하세요.
<<<undefined>>>
오류 [GENERATE_PROVIDER_EXIT]: codex가 종료했습니다. 종료 코드: 1, 모델: gpt-5.6-luna
해결: `codex login status` 명령으로 로그인 상태를 확인하고, 모델 이름이 맞는지 확인하세요.
<<<undefined exitCode 3>>>
오류 [GENERATE_PROVIDER_EXIT]: codex가 종료했습니다. 종료 코드: 3, 모델: gpt-5.6-luna
해결: `codex login status` 명령으로 로그인 상태를 확인하고, 모델 이름이 맞는지 확인하세요.
<<<undefined no exitCode>>>
오류 [GENERATE_PROVIDER_EXIT]: claude가 종료했습니다. 모델: haiku
해결: `claude /status` 명령으로 로그인 상태를 확인하고, 모델 이름이 맞는지 확인하세요.
```

사용자가 실제로 겪은 상황(없는 모델)은 첫 번째 또는 다섯 번째로 떨어진다. 둘 다 모델 이름과
기본값을 알려주므로 로그인을 확인하러 가는 헛수고가 없어진다.

## 검증

### 테스트 선작성 후 실패 확인

```
pnpm vitest run packages/cli
     × unknownModel이면 모델 이름과 기본값을 알려준다
     × notAuthenticated면 provider에 맞는 인증 확인 명령만 안내한다
     × rateLimited면 재시도와 payload 축소를 안내한다
     × badRequest면 모델과 schema 두 가지를 확인하도록 안내한다
     × serverError면 재시도를 안내한다
     × reason이 없으면 기존 EXIT 문구에 모델을 붙여 안내한다
      Tests  6 failed | 81 passed (87)
```

나머지 셋(`exitCode를 모르면 …`, `reason은 nonZeroExit 밖에서 무시된다`,
`어떤 reason에서도 … 노출되지 않는다`)은 기존 동작으로도 성립하는 성질이라 처음부터 녹색이었다.
특히 `reason은 nonZeroExit 밖에서 무시된다`는 `switch (failure.code)`가 먼저 갈라지는 구조라
구현 전후로 계속 통과한다. 회귀 방지용으로 남겨 뒀다.

### 구현 후

```
pnpm vitest run packages/cli → Test Files 5 passed (5) / Tests 87 passed (87)
pnpm build     → Tasks: 6 successful, 6 total
pnpm typecheck → Tasks: 6 successful, 6 total
pnpm lint      → Checked 97 files in 31ms. No fixes applied.
pnpm test      → Test Files 27 passed (27) / Tests 294 passed (294)
```

검사 대상 0개 거짓 신호 점검:

- 린트 `Checked 97 files` (0 아님)
- 타입체크는 성공 시 무출력이라 별도로
  `cd packages/cli && npx tsc --noEmit --listFiles | grep -c "worktrees/ohmymcp-cli-failure-message/packages/cli/"`
  → **9**

B1에서 만든 기존 테스트(`providerUnavailable`, `timedOut`, `schemaMismatch`, `cancelled`,
`internal`)는 손대지 않았고 그대로 통과한다. `GENERATE_PROVIDER_EXIT` 관련 기존 테스트 둘도
새 문구에서 그대로 성립해(`"코드 1로"` 포함, `"코드 undefined"` 미포함) 갱신할 필요가 없었다.

`packages/core`의 stdio-integration 간헐 실패는 이번 실행들에서 나오지 않았다. 다른 실패도 없었다.

## 임의로 판단한 부분

1. **dispatch throw 경로(`failure === undefined`)에 모델 이름을 붙이지 않았다.** 지시가 판단에
   맡긴 항목이다. 붙이지 않은 이유는 두 가지다. 첫째, 그 경로는 원인을 전혀 모르는 상태라
   문구가 `GENERATE_PROVIDER_FAILED`의 일반 안내인데, 거기에 모델 이름만 얹으면 사용자가 취할
   행동이 달라지지 않는다. 정보가 늘어도 조치가 같으면 노이즈다. 둘째, 그 문구는
   `safeFailure()`가 `INTERACTIVE_REQUIRED`·`FINALIZE_FAILED`·`SAVE_FAILED`·`LOCAL_JSON_INVALID`와
   공유하는 함수라, 모델을 넣으려면 provider와 무관한 실패까지 문구가 흔들린다. 모델을 넘기는
   것 자체는 시그니처에 반영해 뒀으니(`providerFailure(deps, undefined, model)`) 나중에 판단이
   바뀌면 한 줄로 붙일 수 있다.
2. **`exitMessage`를 별도 함수로 뺐다.** `providerFailure`의 `switch` 안에 reason 분기를 중첩하면
   두 단계 switch가 한 함수에 들어가 읽기 어렵다.
3. **`reason`이 알 수 없는 값이면 `default`로 떨어져 `GENERATE_PROVIDER_EXIT`가 된다.**
   `reason`은 닫힌 enum이고 generate가 화이트리스트로 걸러 넣지만, 나중에 값이 추가되면 CLI가
   조용히 잘못된 문구를 내는 대신 원인 미상 문구로 떨어지는 편이 안전하다.
4. **테스트에 `failOn(providerId, model, failure)` 헬퍼를 새로 뒀다.** 기존 `failWith`는 codex와
   기본 모델에 고정돼 있어 provider별·모델별 검증을 할 수 없었다. 기존 헬퍼와 그것을 쓰는
   B1 테스트는 그대로 뒀다.
5. **changeset은 `ohmymcp` patch.** 사용자에게 보이는 출력 변화다.

## 리뷰 반영

- 리뷰 지적: `providerFailure`의 JSDoc이 고아가 됐다. 새 심볼(`authCommand`)을 그 사이에 끼워
  넣으면서 원래 붙어 있던 함수와 떨어져 `authCommand` 위에 붙어 있었다. JSDoc을
  `providerFailure` 선언 바로 위로 옮겼다. 옮기면서 본문도 현재 동작에 맞게 고쳤다. 기존 문장은
  `code`별 분기만 말했으나 실제로는 `nonZeroExit` 안에서 `reason`으로 한 겹 더 갈린다.
  재검증: `pnpm vitest run packages/cli` → 87 passed, `pnpm lint` → Checked 97 files.

### 조사 수정

리뷰 지적대로 한국어 조사가 변수 뒤에 붙어 틀리는 자리가 있었다. 세 곳을 고쳤고, 재발을 막는
규칙을 `exitMessage` 위 JSDoc에 남겼다: **변수 바로 뒤에 조사를 붙이지 않는다.** 조사는 앞말의
받침에 따라 형태가 갈리는데(을/를, 으로/로) 변수 값은 어떤 것이 올지 모르므로 어느 쪽으로
고정해도 반드시 틀리는 경우가 생긴다.

1. **명령 뒤의 `으로`** (AUTH, EXIT). `` `codex login status`으로 ``는 "스테이터스로"라 틀렸다.
   조사를 `로`로 바꾸는 것만으로는 `authCommand`가 돌려주는 문자열이 바뀌면 또 틀리므로,
   고정 명사 "명령"을 끼워 `` `codex login status` 명령으로 ``로 바꿨다. 앞말이 무엇이든
   "명령"이 조사를 받는다.
2. **모델 이름 뒤의 `을`** (MODEL). `'gpt-nonexistent'을`은 "트"로 끝나 받침이 없어 틀렸고,
   `sonnet`("넷")은 `을`이 맞아 어느 쪽으로 고정해도 한쪽이 틀린다. `badRequest`·`EXIT`와 같은
   `모델: {model}` 라벨 형태로 통일했다. 여섯 문구의 모양도 이제 일관된다.
3. **exitCode 뒤의 `로`** (EXIT). 지시에서 "판단해서 적어라"고 한 항목인데, **실제로 틀린다.**
   `코드 1로`는 "일로"라 맞지만 `코드 3로`는 "삼으로", `코드 6로`는 "육으로", `코드 100로`는
   "백으로"가 되어야 한다. 숫자를 한국어로 읽은 받침에 따라 갈리므로 고정할 수 없다.
   `종료 코드: {exitCode}, ` 라벨 형태로 떼어냈다.

#### 전체 훑기 결과

변수가 조사 앞에 오는 자리를 모두 확인했다.

| 자리 | 판정 |
|---|---|
| `{id}가` (전 문구) | **맞음.** providerId는 codex("코덱스", 스)와 claude("클로드", 드) 둘뿐이고 둘 다 받침이 없어 `가`가 맞다. 값이 늘어날 수 없는 닫힌 타입이라 안정적이다 |
| `{id} CLI를` | **맞음.** 조사가 붙는 앞말이 변수가 아니라 고정 문자열 "CLI"("씨아이")다 |
| `{timeoutMs}ms 안에` | **맞음.** "안에"는 조사가 아니라 명사+에라 형태가 갈리지 않는다 |
| `{default}입니다` | **맞음.** "입니다"는 받침에 따라 갈리지 않는다 |
| `{model}` (badRequest, EXIT) | **맞음.** 이미 `모델: {model}` 라벨 형태였다 |
| `{exitCode}로` | **틀림.** 위 3번에서 고침 |

#### `{id} --version`에 대한 정정

리뷰에서 "`` `${id} --version`으로 ``는 그대로 둔 게 정상"이라고 했는데, **실제로는 그것도
바꿨다.** 판단 근거는 이렇다. 그 자리의 조사는 변수에 의존하지 않으므로(`--version` = "버전",
받침 ㄴ → `으로`가 맞다) **틀린 것은 아니었다.** 다만 고친 AUTH·EXIT가 "명령으로"가 되면서 같은
파일 안에서 명령을 안내하는 문장이 두 가지 형태로 갈리는 것이 이상해 함께 맞췄다. 틀림을
고친 것이 아니라 일관성을 위한 변경이므로, 되돌리길 원하면 그 한 줄만 되돌리면 된다.

#### 추가한 테스트

- `모델 이름 뒤에 조사를 붙이지 않는다` — 받침 있는 이름(`sonnet`)과 없는 이름(`haiku`) 둘로
  확인한다. 두 출력 모두 `'을 사용할`·`'를 사용할`이 없고 `모델: {이름}`이 나온다.
- `명령 뒤에 조사를 붙이지 않는다` — codex·claude × (notAuthenticated, reason 없음) 네 조합.
  ``status`으로``와 ``status`로``가 없고 ``` ` 명령으로 ```가 나온다.

문구가 바뀐 기존 단언 둘(`"코드 1로"` → `"종료 코드: 1"`)도 갱신했다. B1 테스트의
`"코드 undefined"` 미포함 단언과 `--version` 포함 단언은 새 문구에서도 그대로 성립한다.

재검증:

```
pnpm vitest run packages/cli → Tests 89 passed (89)
pnpm typecheck → Tasks: 6 successful, 6 total
pnpm lint      → Checked 97 files in 36ms. No fixes applied.
```

## 남은 위험

- `reason`을 채우는 쪽은 B5(`packages/generate`)다. codex/claude의 실제 stderr가 어떤 reason으로
  매핑되는지는 CLI 테스트로 검증할 수 없다. 실제 호출 E2E에서만 확인된다. 특히 없는 모델이
  `unknownModel`로 오는지 `badRequest`로 오는지에 따라 사용자가 보는 화면이 달라진다. 두 문구 다
  모델 이름과 기본값을 담고 있어 어느 쪽이든 원래 문제(로그인 확인하러 가는 헛수고)는 해결되지만,
  어느 쪽으로 떨어지는지는 실측이 필요하다.
- 실제 터미널에서 사람이 눈으로 본 확인은 하지 않았다. 위 원문은 테스트가 만든 문자열이다.
