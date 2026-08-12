# Task R3 보고서 — PR #37 2차 리뷰 대응 (packages/generate)

## 작업 공간

- pwd: `/Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-review2-generate`
- 브랜치: `fix/review2-generate` (`33499b8`에서 분기)
- `git rev-parse HEAD`: `33499b84eeec81b7b522f6094f4498aabc08a363`
- 진입 시 `git status --short` 비어 있었고 `pnpm install` 뒤 baseline 111 passed 확인. 커밋 안 함.

## 변경 파일

```
M packages/generate/src/authoring-request.ts
M packages/generate/src/authoring-types.ts
M packages/generate/src/index.ts
M packages/generate/src/provider-process.ts
M packages/generate/src/redaction.ts
M packages/generate/tests/authoring-request.test.ts
M packages/generate/tests/baseline.test.ts
M packages/generate/tests/provider-process.test.ts
?? .changeset/generate-review2.md
?? packages/generate/tests/dependency-boundary.test.ts
```

허용 목록 밖 변경은 없다. `packages/cli`와 `docs`의 기존 파일은 건드리지 않았다.

## 1. 계약 식별자를 값 기반 redaction에서 제외

`redaction.ts`의 `sanitize`에 경로 추적을 넣고, 값 기반 치환만 건너뛰는 가드를 받게 했다.

```ts
export type RedactionPathGuard = (path: string) => boolean;
export const SUITE_CONTRACT_PATHS: RedactionPathGuard = (path) =>
  /^(id|schemaVersion)$/.test(path) ||
  /^cases\[\d+\]\.(id|name)$/.test(path) ||
  /^cases\[\d+\]\.operation\.(type|tool)$/.test(path);
export const TOOL_CONTRACT_PATHS: RedactionPathGuard = (path) => /^\[\d+\]\.name$/.test(path);
```

경로는 root 기준 `cases[0].operation.tool` 꼴이다. `prepareAuthoringRequest`가 `baseline`과
`candidate`에 `SUITE_CONTRACT_PATHS`를, `tools`에 `TOOL_CONTRACT_PATHS`를 넘긴다.
`instruction`은 가드 없이 그대로 redaction한다(계약 식별자가 아니다).

**키 기반 치환(`DEFAULT_SENSITIVE_KEYS`)은 그대로 두었다.** 경로와 무관하게 적용된다. 계약 식별자
키(`id`, `name`, `type`, `tool`, `schemaVersion`)는 민감 키 목록에 없으므로 이 경로로 가려질 일이
없다. 코드 주석에도 적었다.

`redactAuthoringSuite`(provider **결과** 쪽)에는 가드를 넘기지 않았다. 그쪽은 `operation.input`만
훑으므로 계약 식별자를 건드리지 않는다.

테스트 3개:

- `계약 식별자는 값 기반 redaction에서 제외한다`: suite id, case id, tool name, operation type을
  `sensitiveValues`에 넣어도 요청 payload에 원문이 남는다.
- `같은 문자열이 operation.input 안에 있으면 여전히 가린다`: 같은 `"weather"` 문자열이
  `operation.input.city`에 있으면 `[REDACTED]`가 된다. 제외가 경로 단위임을 고정한다.
- `계약 식별자를 비밀값으로 선언해도 provider 결과 검증이 통과한다`: 이전에는 identity 대조와
  툴 allowlist가 `[REDACTED]`를 만나 `invalid`로 떨어지던 흐름이 `preview`로 통과한다.

## 2. warnings·summary를 공개 결과 타입까지 전달

`authoring-types.ts`의 `SanitizedAuthoringCandidate.result`에 두 필드를 **추가만** 했다.

```ts
readonly summary?: string;
readonly warnings?: readonly string[];
```

**optional로 둔 이유**는 런타임 형태가 두 가지이기 때문이다.

| 생산 경로 | `summary` | `warnings` |
|---|---|---|
| `validateAuthoringProviderResult` (provider 응답) | 있음 | 있음 |
| `authoring-session.ts`의 `candidateFor` (로컬 검토) | 없음 | 없음 |

로컬 검토 경로는 provider 응답 없이 candidate를 만들므로 두 필드를 담지 않는다. 필수로 두면 타입이
실제 런타임 객체와 어긋난다. 그 근거를 타입 주석에 적었다.

R1에서 좁혀 캐스팅했던 두 곳(`as unknown as { warnings: readonly string[] }`)을 지웠다. 이제
`result.preview.result.warnings`와 `.summary`를 직접 읽는다.

추가만 하는 변경이라 `packages/cli`는 그대로 컴파일된다(`pnpm vitest run packages/cli` 93 passed).

## 3. `sha256` 공개 export

`index.ts`에서 `canonical.ts`의 `sha256`과 `canonicalJson`을 export했다. **정규화 동작은 한 글자도
바꾸지 않았다.** `canonicalJson`을 함께 내보낸 이유는 cli가 지금 두 가지(canonical 직렬화와
fingerprint)를 모두 자체 구현하고 있어서, 하나만 내보내면 나머지 한 벌이 남기 때문이다.

테스트 2개(`baseline.test.ts`):

- `sha256은 같은 값에 항상 같은 해시를 준다`: 같은 suite의 복사본이 같은 해시이고,
  `createBaselineSuite`가 계산한 `suiteFingerprint`와도 일치한다(두 경로가 같은 구현임을 고정).
- `sha256은 key 순서가 다른 동등한 객체에 같은 해시를 준다`: 중첩 객체의 키 순서를 뒤집어도 같은
  해시이고, **배열 순서는 다르면 다른 해시**임을 함께 단언한다(정규화가 배열 순서를 보존한다는 계약).

## 4. stdin 쓰기 오류 판정

R1의 "전부 무시" 판단을 철회한다. 리뷰어 지적이 맞다. 프롬프트가 잘려 나갔는데 조용히 진행하면
provider가 불완전한 입력으로 답한 결과를 성공으로 받는다.

쓰기 오류 발생 사실만 `stdinWriteFailed`에 기억하고 close 시점에 판정한다.

| close 상태 | 판정 |
|---|---|
| exit 0 + stdout이 유효한 JSON | 무시하고 `ok: true`. provider가 다 읽고 stdin을 먼저 닫은 경우다 |
| exit code ≠ 0 | `internal` (provider 판정이 아니라 우리 쪽 입력 문제다) |
| exit 0 + UTF-8 깨짐 | `internal` (쓰기 오류 없으면 기존대로 `invalidUtf8`) |
| exit 0 + JSON 아님 | `internal` (쓰기 오류 없으면 기존대로 `invalidJson`) |

근거는 `provider-process.ts`의 stdin 리스너 주석에 적었다.

테스트 3개: 쓰기 오류 후 비정상 종료 → `internal`, 쓰기 오류 후 stdout이 JSON 아님 → `internal`,
쓰기 오류 후 정상 결과 → 그대로 `ok: true`(기존 테스트 유지).

## 5. `generate → runner` 의존 검사 테스트

`packages/generate/tests/dependency-boundary.test.ts`를 새로 만들었다. `src/*.ts`를 실제로 읽어
`@ohmymcp/runner`에서 가져오는 심볼 이름을 뽑고 승인 목록과 정확히 비교한다.

**실제 소스를 훑어 확인한 결과 지시받은 목록과 정확히 일치했다.** 8개다.

```
타입: RunnerRedactionOptions, SuiteValidationIssue, TestCaseSpec, TestSuiteSpec
함수: validateMcpSuite
상수: DEFAULT_SENSITIVE_KEYS, MCP_SUITE_JSON_SCHEMA, REDACTED
```

파서를 만들면서 잡은 함정 두 개를 기록해 둔다. 둘 다 실제로 오탐을 냈고 지금은 막혀 있다.

1. **앞선 import 문으로 넘어감.** `import\s+([\s\S]*?)\s+from\s+"@ohmymcp/runner"`가 lazy
   매칭이라도 앞 문장부터 걸쳐 잡아서 `tmpdir`, `ToolDef` 같은 다른 패키지 심볼을 끌어왔다.
   clause에 따옴표와 세미콜론을 금지(`[^"';]*?`)해 막았다.
2. **생성 코드 문자열 리터럴.** `render.ts`가 생성 파일에 넣을 import 문을 문자열로 들고 있다
   (`'import { defineMcpSuite } from "@ohmymcp/runner";'`). 이것은 이 패키지의 의존이 아닌데
   `defineMcpSuite`가 잡혔다. 줄 시작 앵커(`^ ... /gm`)로 막았다. 실제 import 문은 열 0에서
   시작하고 저 리터럴은 들여쓰기돼 있다.

`generate는 cli를 참조하지 않는다`(의존 방향 확인) 테스트도 같은 파일에 넣었다.

## 검증

```
$ pnpm vitest run packages/generate      # 진입 직후 baseline
 Test Files  6 passed (6) / Tests  111 passed (111)

$ pnpm vitest run packages/generate      # 신규 테스트 작성 직후
 Test Files  4 failed | 3 passed (7) / Tests  8 failed | 112 passed (120)

$ pnpm vitest run packages/generate      # 구현 후
 Test Files  7 passed (7) / Tests  120 passed (120)

$ pnpm vitest run packages/cli
 Test Files  5 passed (5) / Tests  93 passed (93)

$ pnpm build
 Tasks:    6 successful, 6 total

$ pnpm typecheck
 Tasks:    6 successful, 6 total

$ pnpm lint
Checked 102 files in 18ms. No fixes applied.

$ pnpm test
 Test Files  28 passed (28) / Tests  324 passed (324)

$ rm -rf packages/*/dist && pnpm test    # CI 조건
 Test Files  28 passed (28) / Tests  324 passed (324)
```

거짓 신호 점검:

- **타입체크 대상 0개**: `packages/generate`에서 `npx tsc --noEmit --listFiles`로 이 worktree의
  `src` 파일 **14개**가 실제 검사됨을 확인했다.
- **린트 대상 0개**: biome이 `Checked 102 files`를 출력한다.
- **빌드 산출물이 낡음**: `dist`를 지운 상태로도 324 passed다.
- **cli가 generate 공개 API를 쓴다**: `pnpm vitest run packages/cli` 93 passed.

## 내가 임의로 판단한 부분

1. **`canonicalJson`도 함께 export했다.** 지시는 `sha256`만이었다. cli가 `canonicalJson`과
   `suiteFingerprint`를 둘 다 자체 구현하고 있다고 했으므로, `sha256`만 내보내면 canonical 직렬화
   한 벌이 cli에 남는다. 필요 없으면 export 한 줄만 빼면 된다.
2. **`summary`와 `warnings`를 둘 다 optional로 했다.** 위 2번의 표가 근거다. 로컬 검토 경로를
   provider 경로와 같은 모양으로 맞추는(빈 문자열·빈 배열을 채우는) 선택지도 있었지만, 그러면
   "provider가 아무 경고도 안 줬다"와 "provider를 거치지 않았다"를 구분할 수 없어진다.
3. **`redactAuthoringSuite`에는 가드를 넘기지 않았다.** 그 함수는 `operation.input`만 훑으므로
   계약 식별자 경로에 닿지 않는다. 넘겨도 동작이 같지만 의미 없는 인자가 된다.
4. **의존 검사 테스트를 별도 파일로 뒀다.** 성격이 다르고(파일 시스템을 읽는다) ADR-0009가
   가리킬 대상이 명확한 편이 낫다고 봤다.
5. **changeset bump를 `minor`로 잡았다.** 공개 타입에 필드가 늘고 `sha256`·`canonicalJson`이
   새 export다.

## 남은 위험

1. **경로 가드는 문자열 패턴이다.** suite 구조가 바뀌어 경로 모양이 달라지면(예: `cases`가 중첩
   되면) 가드가 조용히 안 맞는다. 그 경우 계약 식별자가 다시 `[REDACTED]`가 되고 요청이 invalid로
   떨어지므로, 실패가 조용하지는 않지만 원인이 바로 보이지는 않는다.
2. **`warnings`·`summary`가 optional이라 cli는 `undefined`를 다뤄야 한다.** 표시 분기는 9f 몫이다.
3. **의존 검사 파서는 정규식이다.** 위 두 함정을 막았지만 `import` 없이 `require`나 동적
   `await import("@ohmymcp/runner")`로 가져오면 잡지 못한다. 지금 `src`에는 그런 코드가 없다.
   테스트 파일(`authoring-request.test.ts`)에는 동적 import가 있지만 검사 대상은 `src`뿐이다.
4. **stdin 판정 변경으로 이전에 성공하던 경계 케이스가 `internal`이 될 수 있다.** exit 0인데
   stdout이 깨진 상태에서 쓰기 오류까지 있었던 경우다. 그 상황은 원래도 `invalidJson`으로 실패했고
   코드만 바뀐다.
