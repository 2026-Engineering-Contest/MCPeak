# Task R1 보고서 — PR #37 CodeRabbit 리뷰 대응 (packages/generate)

## 작업 공간

- worktree: `<repo-root>/.claude/worktrees/ohmymcp-review-generate`
- 브랜치: `fix/review-generate` (`cdb7d4e`에서 분기)
- `git rev-parse HEAD`: `cdb7d4e69cd270f937d9839d970e94645d2ee76d`
- 진입 시 `git status --short` 비어 있었고 `pnpm install` 뒤 `pnpm vitest run packages/generate`가
  96 passed로 실행됐다. 커밋은 하지 않았다.

## 변경 파일

```
M .changeset/generate-provider-schema.md
M packages/generate/src/authoring-request.ts
M packages/generate/src/authoring-session.ts
M packages/generate/src/provider-process.ts
M packages/generate/src/providers.ts
M packages/generate/src/redaction.ts
M packages/generate/tests/authoring-request.test.ts
M packages/generate/tests/authoring-session.test.ts
M packages/generate/tests/index.test.ts
M packages/generate/tests/provider-process.test.ts
M packages/generate/tests/providers.test.ts
```

허용 목록 밖 변경은 없다. `packages/cli`, `docs/plans`, 기존 `docs/reports` 파일은 건드리지 않았다.

## 항목별 처리

### 1. `const model = options.model ?? "m"` (Critical) — 고침

`Options.model`을 필수로 바꾸고(`readonly model: string`), 팩토리의 `options: Options = {}` 기본
인자를 없앴다. 추가로 런타임에서 비어 있지 않은 문자열인지 검사하고 아니면 `TypeError`를 던진다.

타입 필수화를 고른 이유는 호출부가 깨지지 않기 때문이다. `packages/cli/src/index.ts:65-66`이
`(model) => generate.createCodexAuthoringProvider({ model })`로 항상 model을 넘긴다. 런타임 검사만
두면 cli는 통과하지만 잘못된 호출을 컴파일 시점에 못 잡고, 타입만 바꾸면 JS 호출자를 못 막는다.
둘 다 뒀다.

테스트: `model을 넘기지 않으면 provider를 만들지 않는다` (누락과 공백 문자열 둘 다).

### 2. `` `${cwd}/${schemaName}` `` POSIX 구분자 — 고침

`node:path`의 `join(cwd, schemaName)`을 쓴다. `provider-process.ts`가 같은 파일을
`join(cwd, file.name)`으로 만드므로 이제 양쪽이 같은 경로를 만든다.

테스트: `Codex schema 파일 경로를 플랫폼 구분자로 만든다`가 `join`으로 만든 기대값과 대조한다.

### 3. `PROVIDER_ENV_ALLOWLIST` provider 혼재 (Security) — 고침

공통 4개(`PATH`, `HOME`, `USER`, `SHELL`)를 뽑고 provider별 목록을 새로 뒀다.

- `CODEX_ENV_ALLOWLIST` = 공통 + `CODEX_HOME`, `OPENAI_API_KEY`, `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID`
- `CLAUDE_ENV_ALLOWLIST` = 공통 + `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`

`PROVIDER_ENV_ALLOWLIST`는 두 목록의 합집합으로 **값과 순서를 그대로 유지**했다. 기존 테스트가
이 배열을 정확히 단언하고 있고, 외부에서 import할 수 있는 공개 export라 이름과 내용을 바꾸지 않는
쪽이 안전하다고 봤다. 의미는 "어떤 자식도 이 밖의 변수를 받지 않는다"는 상한이며 주석에 적었다.

테스트: `상대 provider의 인증 환경변수를 자식에게 넘기지 않는다`가 codex 자식 env 키 집합에
Anthropic 키가 없고, claude 자식 env 키 집합에 OpenAI/CODEX 키가 없음을 정확한 배열 비교로 단언한다.

### 4. `settle()`이 `killTimer`를 취소해 SIGKILL이 안 감 — 고침

`settle()`에서 `killTimer.cancel()`을 뺐다. 대신 `child.on("close")`에서 취소한다. 즉 프로세스가
실제로 닫히기 전에는 escalation 타이머가 살아 있고, 닫히면 불필요한 SIGKILL을 보내지 않는다.

테스트 두 개.
- `settle 뒤에도 SIGTERM을 무시한 자식에게 SIGKILL을 보낸다`: `outputLimitExceeded`로 settle된 뒤
  clock을 1초 진행하면 `kills`가 `["SIGTERM", "SIGKILL"]`이 된다(고치기 전에는 `["SIGTERM"]`).
- `자식이 이미 닫혔으면 SIGKILL을 보내지 않는다`: close 뒤 1초 진행해도 `["SIGTERM"]` 그대로.

### 5. `child.stdin.write/end`의 비동기 stream error — 고침

`ProviderProcessChild["stdin"]`에 선택적 `on?(event: "error", ...)`를 더하고, 있으면 리스너를 단다.
선택적으로 둔 이유는 기존 테스트 stub과 외부 구현이 이 메서드를 갖지 않아도 깨지지 않게 하기 위해서다.

**무엇을 실패로 볼지**: 아무것도 실패로 보지 않는다. 근거를 코드 주석에 적었다. provider가 프롬프트를
다 읽고 stdin을 먼저 닫으면 EPIPE가 나는데, 그때도 stdout에는 정상 결과가 온다. 여기서 실패로
처리하면 성공한 실행이 `internal`로 뒤집힌다. 결과 판정은 exit code와 stdout parsing이 하고, 이
리스너의 유일한 목적은 처리되지 않은 stream error가 host 프로세스를 죽이는 것을 막는 것이다.

테스트: `stdin 스트림 error는 실행 결과를 바꾸지 않는다`. EPIPE를 emit한 뒤 정상 stdout과 exit 0으로
`ok: true`가 나오고 `unhandledRejection`이 없음을 단언한다.

### 6. `suiteIssues.concat();` no-op — 고침

삭제했다. 바로 아래 블록이 같은 조건으로 `contextIssues`에 push하므로 동작 변화가 없다.

### 7. `suite.cases?.forEach`의 `item.operation` 접근 — 고침

`cases`가 배열인지 확인하고, 각 `item`과 `item.operation`이 plain object일 때만 도구 이름을 본다.
아니면 그 case는 건너뛴다. 스키마 위반은 이미 `safeIssues(raw.suite)`가 수집해 `contextIssues`에
들어가 있으므로 결과는 `invalid`다.

테스트: `operation이 없는 case가 와도 예외 없이 invalid로 떨어진다`. `expect(...).not.toThrow()`와
`status === "invalid"`를 함께 단언한다.

### 8. `warnings: []` — 고침(단, 타입 경계에서 잘린다. 아래 "남은 위험" 참조)

triage 판정 (a)에 동의한다. 검증까지 해두고 버리는 것은 실수로 보인다. 문자열이면서 공백이 아닌
항목만 통과시키고, `redactText`를 적용하고, 개수를 100으로 자른다(`issues`의 기존 상한과 같게).

`AuthoringProviderResult.warnings`의 선언 타입도 `readonly PublicProviderValidationIssue[]`에서
`readonly string[]`으로 바꿨다. provider 전송 스키마(`PROVIDER_OUTPUT_SCHEMA`)가 warnings를 문자열
배열로 규정하므로 원래 타입이 실제 값과 맞지 않았다. `warnings`를 읽는 코드는 저장소 어디에도
없어서(cli 포함) 이 변경으로 깨지는 곳이 없다.

테스트 두 개: redaction과 비문자열 제거를 확인하는 것, 200개를 넣어 100개로 잘리는 것.

### 9. raw provider suite를 세션으로 넘기는 분기 — **고치지 않았다. 의도가 있다**

`git log`로 확인했다. 커밋 `9706556 fix(generate): provider 결과 redaction 경계 유지`가 이 분기를
의도적으로 넣었고, 같은 커밋이 테스트
`dispatch bridge에도 caller redaction 정책을 적용한다`를 함께 추가했다.

이유는 이렇다. `redactAuthoringSuite`는 sanitize 전후 JSON을 비교해 `redactedPaths`를 만든다. 이미
redaction된 suite를 다시 넘기면 바뀌는 값이 없어 `redactedPaths`가 비고, 그러면
`executable: redactedPaths.length === 0`이 `true`가 되어 **비밀값이 들어 있던 suite가 실행 가능으로
표시된다.** 실제 값은 `[REDACTED]` 문자열이 박힌 상태다. 위 테스트가 `executable: false`와
`applied: false, reason: "redactionRequired"`를 단언해 이 경계를 고정하고 있다.

즉 원문을 넘기는 것은 "검증을 건너뛰는 지름길"이 아니라 **redaction이 일어났다는 신호를 세션
계층까지 보존하기 위한 것**이다. `reviewLocalAuthoringCandidate`가 검증과 redaction을 다시 수행하므로
검증 강도도 떨어지지 않는다. 지시대로 고치지 않고 보고한다.

### 10. `applyAuthoringChanges`의 도구 allowlist 죽은 코드 — 고침 (triage 판정 (a))

코멘트가 맞다. `knownTools(next, next.cases...map(item => ({name: item.operation.tool})))`는
allowlist를 검사 대상 자신에서 만들므로 항상 통과한다.

`reviewLocalAuthoringCandidate`(106행)가 `options.tools`를 쓰는 것은 정상이다. 그래서 세션 상태
구조를 크게 바꾸지 않고, **candidate 단위로 호출자가 준 도구 목록을 저장**하는 방식을 골랐다.
`candidates` WeakMap 엔트리에 `tools`를 넣고(이름만, frozen), `applyAuthoringChanges`가 그것을 쓴다.
`createAuthoringDiff`는 이 WeakMap에 등록된 candidate만 받으므로 apply 경로에서 항상 목록이 있다.

**이 경로가 실제로 도달 가능한지 확인했다.** 서버가 도구를 하나 줄인 뒤 검토하는 상황이다.
candidate는 그 도구의 case를 지웠지만 사용자가 삭제 change를 선택하지 않으면, 승인본에는 이제
존재하지 않는 도구의 case가 그대로 남는다. 고치기 전에는 이것이 통과했다.

테스트: `적용 결과가 세션에 전달된 도구 목록 밖의 도구를 남기면 거절한다`. `applied: false`,
`reason: "invalid"`, `issues`에 `cases[1].operation.tool` 경로가 있고 revision이 0에 머무름을 단언한다.

### 11. `redaction.ts sanitize`와 `authoring-request.ts redacted` 중복 — 고침

`redaction.ts`에 `sanitizeRedactable`을 export하고, `authoring-request.ts`의 `redacted`는 그것을
부르는 한 줄로 줄였다. 두 구현은 키 정규화·민감 키 치환·재귀 순회가 동일했으므로 동작 변화가 없다.
기존 redaction 테스트(요청 payload 경로와 suite 경로 양쪽)가 전부 그대로 통과해 이를 고정한다.

`redactText`(문자열 안의 `key=value` 패턴 치환)는 성격이 다른 함수라 합치지 않았다.

### 12. changeset bump — 고침

`.changeset/generate-provider-schema.md`를 `patch`에서 `minor`로 올렸다.

### 13. 테스트 결함들 — 전부 고침

- **`expect(MCP_SUITE_JSON_SCHEMA).toEqual(MCP_SUITE_JSON_SCHEMA)`**: 자기 비교라 아무것도 못 잡는다.
  "generate가 원본을 건드리지 않는다"를 실제로 검증하려면 generate를 거치지 않은 인스턴스가 필요하다.
  `vi.resetModules()` 뒤 `await import("@ohmymcp-hsu/runner")`로 새 모듈 인스턴스를 띄워 그것과 비교한다.
  더해서 `$schema`/`$id`/`$defs` 키가 원본에 남아 있는지도 단언한다(`authoring-schema.ts`가 복사본에서
  이 키들을 지우므로, 복사를 빠뜨리면 여기서 걸린다).
- **중복 `selectedChangeIds`**: candidate가 approved와 같아 `changes`가 빈 배열이었고 `"change-001"`은
  존재하지 않는 ID라 `unknownChange`가 "중복"이 아니라 "미존재"로 나던 것이다. case를 추가해 실제
  change가 생기게 하고, 그 change의 실제 ID를 두 번 넘기도록 바꿨다.
- **`?? "{}"` 폴백**: 폴백을 없애고 `expect(matched?.[1]).toBeTypeOf("string")`으로 매칭 실패를 명시
  단언한다. 이제 정규식이 어긋나면 그 사실이 그대로 보인다.
- **Claude 프롬프트 경로 비노출**: `expect(lp).not.toContain(process.cwd())`를 추가했다.

## 고치지 말라고 한 항목

- **`redacted`가 기본 민감 키를 정규화하지 않는다는 지적**: 오판이라는 triage에 동의한다.
  다만 지시대로 테스트로 못 박았다.
  - `camelCase 민감 키도 정규화해 가린다`: `accessToken`, `refresh-token`, `clientSecret`가 전부 가려짐.
  - `DEFAULT_SENSITIVE_KEYS는 전부 정규화된 형태다`: 각 키가 `toLowerCase().replace(/[^a-z0-9]/g,"")`와
    같은지 확인. 나중에 camelCase 키가 추가되면 여기서 걸린다.
- **`--help` 실행 timeout**: 해당 코드가 없다(A1에서 제거). 손대지 않았다.
- **`generate → runner` 의존 제거**: 손대지 않았다.

## 검증 명령과 결과

```
$ pnpm vitest run packages/generate      # 진입 직후 baseline
 Test Files  6 passed (6) / Tests  96 passed (96)

$ pnpm vitest run packages/generate      # 신규 테스트 작성 직후
 Test Files  2 failed | 4 passed (6) / Tests  4 failed | 104 passed (108)

$ pnpm vitest run packages/generate      # 구현 후
 Test Files  6 passed (6) / Tests  108 passed (108)

$ pnpm build
 Tasks:    6 successful, 6 total

$ pnpm typecheck
 Tasks:    6 successful, 6 total

$ pnpm lint
> biome check .
Checked 97 files in 17ms. No fixes applied.

$ pnpm test
 Test Files  27 passed (27) / Tests  308 passed (308)

$ rm -rf packages/*/dist && pnpm test    # CI와 같은 조건(build 없음)
 Test Files  27 passed (27) / Tests  308 passed (308)
```

거짓 신호 점검:

- **타입체크 대상 0개**: `tsc --noEmit`은 성공 시 파일 수를 안 찍는다. `packages/generate`에서
  `npx tsc --noEmit --listFiles`로 이 worktree의 `src` 파일 **10개**가 실제 검사됐음을 확인했다.
- **린트 대상 0개**: biome이 `Checked 97 files`를 출력한다.
- **빌드 산출물이 낡음**: `dist`를 지운 상태로도 `pnpm test`가 308 passed다.
- `packages/core`의 stdio-integration 간헐 실패는 이번 실행들에서 나오지 않았다.

## triage와 다르게 본 것

1. **항목 9는 고치지 않았다.** 위 9번에 근거를 적었다. 커밋 `9706556`과 그 커밋이 함께 추가한
   테스트가 명시적 의도를 보여준다. 검증된 suite를 넘기면 `redactedPaths`가 비어
   `executable: true`가 되고, 비밀값이 있던 suite가 실행 가능으로 표시된다.
2. **항목 3에서 `PROVIDER_ENV_ALLOWLIST`를 없애지 않았다.** 공개 export이고 기존 테스트가 정확히
   단언하고 있어 합집합으로 유지하는 쪽이 호환에 안전하다고 봤다. 실제 격리는 새 provider별
   목록이 한다.
3. **항목 8은 절반만 도달한다.** 아래 남은 위험 1번.

## 남은 위험

1. **warnings가 공개 타입 경계에서 잘린다.** `SanitizedAuthoringCandidate.result`의 타입은
   `{status, suite, questions}`뿐이라 `warnings`(와 `summary`)가 타입에 없다. 값은 런타임 객체에
   실려 가지만 타입상 보이지 않으므로 cli가 그대로는 못 읽는다. 이 타입은
   `packages/generate/src/authoring-types.ts`에 있고 **이번 태스크의 수정 허용 목록 밖**이라
   손대지 않았다. 테스트에서는 해당 지점만 좁혀 캐스팅하고 그 이유를 주석에 적었다.
   경고를 실제로 사용자에게 보이려면 `authoring-types.ts`에 `warnings`(필요하면 `summary`)를
   추가하는 별도 태스크가 필요하다.
2. **항목 10의 도구 목록은 candidate 단위다.** 세션 전체가 아니라 그 candidate를 검토할 때 준
   목록을 쓴다. 검토마다 도구 목록이 달라지면 마지막 검토의 목록이 기준이 된다. 지금 CLI 흐름에서는
   한 세션 내 목록이 같으므로 문제되지 않지만, 목록이 바뀌는 흐름이 생기면 다시 봐야 한다.
3. **항목 5의 판단은 "EPIPE를 실패로 보지 않는다"이다.** provider가 stdin을 일찍 닫는 정상 상황을
   깨뜨리지 않는 쪽을 골랐다. 반대로 stdin 쓰기가 실제로 실패해 프롬프트가 잘려 전달되는 경우는
   그대로 진행되어 provider가 이상한 결과를 낼 수 있다. 그 경우는 스키마 검증에서
   `schemaMismatch`로 걸린다.
4. **항목 4의 escalation 타이머는 `unref`된 상태다.** 기존 동작 그대로다. 호스트가 즉시 종료하면
   SIGKILL이 발송되지 않을 수 있다. 이번 변경 범위 밖이라 건드리지 않았다.
