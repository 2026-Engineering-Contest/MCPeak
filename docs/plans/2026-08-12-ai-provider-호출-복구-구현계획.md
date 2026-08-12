# AI provider 호출 복구 구현계획 (2026-08-12)

참조 문서: `docs/ai-provider-schema-compatibility.md`
참조 구현: `/Users/doo._.hyun/Study/Project/MCPLens-V2/packages/extension/src/inferenceCli.ts`

## 1. 배경과 근거

`ohmymcp generate`의 AI 검토가 Codex와 Claude 양쪽에서 실패한다. 원인은 두 개다.

**원인 1. Codex는 프로세스가 뜨지도 않는다.**
`packages/generate/src/providers.ts:65` `hasRequiredCapabilities`가 `codex exec --help` 출력에
필수 문자열이 전부 있는지 검사하는데, 요구 목록에 `model_reasoning_effort`가 들어 있다. 이것은
`-c`로 넘기는 config key이지 help에 찍히는 flag가 아니다.

```
$ codex exec --help | grep -c model_reasoning_effort
0
```

따라서 gate가 항상 false가 되어 `providerUnavailable`을 던지고 codex는 한 번도 실행되지 않는다.
설치는 되어 있다(`codex-cli 0.147.0`, `claude 2.1.228`). Claude 쪽 요구 flag 8개는 help에 전부
있어 gate를 통과하고, 실제 실행 뒤 스키마 단계에서 죽는다.

이 검사 자체가 잉여다. `provider-process.ts:113-116`이 spawn 실패를 이미 `providerUnavailable`로
매핑한다. MCPLens-V2도 help 검사 없이 바로 spawn한다.

**원인 2. 전송 스키마가 두 CLI의 지원 범위 밖이다.**
`AUTHORING_OUTPUT_SCHEMA`가 `$schema`, 최상위 `oneOf`, `$ref`/`$defs`를 쓴다. 참조하는 runner
스키마(`packages/runner/src/spec/json-schema.ts`) 안에도 `oneOf`와 `$ref`가 12군데 있고,
`$defs/jsonValue`는 **재귀 참조**라 인라인 전개도 불가능하다.

MCPLens-V2가 두 CLI에서 실제로 통과시킨 스키마(`INFERENCE_OUTPUT_SCHEMA`)의 성질:
`$schema` 없음, `$ref`/`$defs` 없음, 최상위 조합자 없음, `anyOf`는 `items` 안쪽에서만,
문자열 제약은 `pattern`만 사용. CLI 인자 자체는 OhMyMCP와 이미 동일하다.

## 2. 목표 / 비범위 / 완료 조건

**목표**

1. Codex와 Claude가 실제로 spawn되어 결과를 돌려준다.
2. provider에 보내는 스키마가 두 CLI 공통 지원 범위 안에 있다.
3. 스키마를 단순화해도 로컬 검증 강도는 그대로다.
4. Claude의 오류 envelope를 성공으로 취급하지 않는다.
5. CLI가 실패 원인별로 다른 조치를 안내한다.

**비범위**

- `core/src/types.ts`의 `McpClient`·`ToolResult` (변경 금지)
- `packages/runner/src/spec/json-schema.ts` (다른 오너, 읽기만 한다)
- `@modelcontextprotocol/sdk` 버전 (1.x 고정)
- 새 런타임 의존성 추가

**완료 조건**

- `pnpm test`, `pnpm typecheck`, `pnpm lint` 전부 통과
- 새 provider 스키마에 `$schema`/`$ref`/`$defs`/최상위 조합자가 없음을 테스트가 기계적으로 증명
- Wave 2에서 실제 Codex와 Claude를 각각 호출해 `examples/weather-server` 승인본이
  `2 passed, 0 failed`

## 3. 설계 결정: suite를 JSON 문자열로 전송한다

runner suite 스키마는 재귀(`jsonValue`)를 포함하므로 `$ref` 없이 인라인 전개할 수 없다.
`operation.input`은 임의 JSON 객체라 strict structured output이 요구하는
"모든 객체에 `additionalProperties: false` + 전 property `required`"를 만족시킬 수 없다.

따라서 **provider 전송 스키마는 envelope만 규정하고, suite는 문자열 필드로 받는다.**
스칼라와 문자열 배열만 남으므로 재귀·조합자·nullable 문제가 전부 사라진다.

suite 형식은 스키마 대신 **프롬프트 본문**으로 알린다(`MCP_SUITE_JSON_SCHEMA`를 그대로 직렬화해
고정 지침 뒤에 붙인다). 우리가 만든 데이터이므로 untrusted 취급 대상이 아니다.

검증 강도는 떨어지지 않는다. `providers.ts`가 `suiteJson`을 파싱해 객체로 되돌린 뒤
`validateAuthoringProviderResult`에 넘기므로, 이후 경로(`validateMcpSuite`, suite identity 대조,
툴 이름 allowlist, 비밀값 redaction)는 전부 그대로 돈다.

ADR 대상이다. Task A1에서 `docs/adr/0007-provider-전송-스키마-분리.md`를 함께 작성한다.

## 4. 공유 계약 (전량 기재)

### 4-1. `packages/generate/src/authoring-schema.ts`에 추가

`AUTHORING_OUTPUT_SCHEMA`는 로컬 문서화용으로 **그대로 둔다**(`index.ts` export 유지,
기존 테스트 `authoring-request.test.ts:250` 보존). 아래를 새로 추가한다.

```ts
/**
 * provider(Codex/Claude) 전송 전용 스키마.
 * 두 CLI 공통 지원 범위만 사용한다: $schema / $id / $ref / $defs / 최상위 oneOf·allOf·anyOf·not 없음,
 * 재귀 없음, nullable 없음. 문자열 제약은 pattern만 쓴다(minLength/minItems는 CLI별 지원이 불확실).
 * suite는 객체가 아니라 JSON 문자열로 받는다. 근거는 docs/adr/0007-provider-전송-스키마-분리.md.
 */
export const PROVIDER_OUTPUT_SCHEMA = freeze({
  type: "object",
  additionalProperties: false,
  required: ["status", "suiteJson", "summary", "warnings", "questions"],
  properties: {
    status: { enum: ["candidate", "questions"] },
    // status가 "questions"이면 빈 문자열, "candidate"이면 TestSuiteSpec의 JSON 직렬화.
    suiteJson: { type: "string" },
    // status가 "questions"이면 빈 문자열.
    summary: { type: "string" },
    warnings: { type: "array", items: { type: "string" } },
    questions: { type: "array", items: { type: "string", pattern: "\\S" } },
  },
});
```

### 4-2. `packages/generate/src/providers.ts`의 envelope 판정

`unwrap`을 아래 계약으로 바꾼다. 반환 타입은 지금과 같은 `unknown`이며, 값의 형태는
`validateAuthoringProviderResult`가 이미 받는 `{status, suite, summary, warnings, questions}`다.

```ts
/**
 * provider 원시 결과를 validateAuthoringProviderResult가 받는 형태로 정규화한다.
 * 실패는 전부 AuthoringProviderError로 던지며, raw stdout/stderr와 인증정보는 절대 담지 않는다.
 */
function unwrap(result: ProviderProcessResult, claude: boolean): unknown;
```

판정 순서와 통과 조건은 다음과 같다. 하나라도 어긋나면 `schemaMismatch`다.

1. `result.ok === false`이면 `new AuthoringProviderError(result.code, result)`.
2. Claude인 경우 envelope는 plain object여야 하고,
   `type === "result"`, `subtype === "success"`,
   `is_error !== true`, `api_error_status` 키 없음,
   `structured_output` 키 존재를 **전부** 만족해야 한다. 만족하면 `structured_output`을 취한다.
   Codex인 경우 `result.value`를 그대로 취한다.
3. 취한 값이 plain object여야 한다.
4. `status`가 `"candidate"` 또는 `"questions"`여야 한다.
5. `status === "questions"`이면 `{ status: "questions", questions }`를 반환한다.
   `questions`가 배열이 아니면 `schemaMismatch`.
6. `status === "candidate"`이면 `suiteJson`이 문자열이어야 하고 `JSON.parse`가 성공해야 하며,
   그 결과가 plain object여야 한다. 실패하면 `schemaMismatch`.
   `{ status: "candidate", suite: 파싱결과, summary, warnings, questions }`를 반환한다.

`JSON.parse` 실패를 `invalidJson`이 아니라 `schemaMismatch`로 매핑하는 이유: `invalidJson`은
"CLI stdout 자체가 JSON이 아니다"라는 다른 층의 실패이며, CLI 재실행으로 풀릴 수 있는지 여부가
다르다. 사용자 조치가 갈리므로 코드를 섞지 않는다.

### 4-3. `packages/generate/src/authoring-request.ts`의 questions 엄격화

`validateAuthoringProviderResult`의 `raw.status === "questions"` 분기에, 기존 questions 검사
**앞에** 다음을 넣는다.

```ts
// questions 응답에 suite/summary/warnings가 딸려오면 candidate를 우회 적용하려는 시도로 본다.
if ("suite" in raw || "summary" in raw || "warnings" in raw)
  return {
    status: "invalid",
    issues: [
      {
        code: "INVALID_VALUE",
        path: "status",
        message: "questions 응답에 suite 결과가 함께 왔습니다.",
        hint: "질문만 반환하거나 candidate로 반환하세요.",
      },
    ],
  };
```

## 5. 태스크

### Task A1 — `packages/generate` provider 호출 복구

**허용 Files (생성·수정)**

- `packages/generate/src/authoring-schema.ts`
- `packages/generate/src/providers.ts`
- `packages/generate/src/authoring-request.ts`
- `packages/generate/src/index.ts`
- `packages/generate/tests/providers.test.ts`
- `packages/generate/tests/authoring-request.test.ts`
- `docs/adr/0007-provider-전송-스키마-분리.md` (신규)
- `.changeset/` 아래 신규 파일 1개

**수정 금지 (공유 계약)**

`core/` 전체, `packages/runner/` 전체, `packages/cli/` 전체, `packages/record/`,
`packages/mock/`, 루트 `package.json`·`turbo.json`·`tsconfig.base.json`·`vitest.config.ts`

**작업 내용**

1. `authoring-schema.ts`에 §4-1의 `PROVIDER_OUTPUT_SCHEMA`를 추가하고 `index.ts`에서 export한다.
2. `providers.ts`에서 `hasRequiredCapabilities` 함수와 `Options.capabilities`·`Options.runHelp`,
   `execFile`/`promisify` import를 제거한다. `author()` 진입부의 gate 호출을 지운다.
   spawn 실패는 `provider-process.ts`가 이미 `providerUnavailable`로 매핑한다.
3. `providers.ts`가 Codex `--output-schema` 파일과 Claude `--json-schema` 인자에
   `AUTHORING_OUTPUT_SCHEMA` 대신 `PROVIDER_OUTPUT_SCHEMA`를 넣는다. CLI 인자 배열의 나머지는
   한 글자도 바꾸지 않는다.
4. `prompt()`가 고정 지침 뒤에 suite 스키마를 붙인다.
   `${FIXED_INSTRUCTION}\n\nTestSuiteSpec JSON Schema:\n${JSON.stringify(MCP_SUITE_JSON_SCHEMA)}\n\nsuiteJson 필드에는 이 스키마를 만족하는 suite를 JSON 문자열로 직렬화해 넣는다.\n\n${JSON.stringify(request)}\n${UNTRUSTED_WARNING}`
   `MCP_SUITE_JSON_SCHEMA`는 `@ohmymcp/runner`에서 import한다(단방향 의존 유지).
   프롬프트가 커지므로 `MAX_REQUEST_BYTES` 검사에 걸리지 않는지 확인한다. 걸리면 수정하지 말고 보고한다.
5. `unwrap`을 §4-2 계약대로 다시 쓴다.
6. `authoring-request.ts`에 §4-3을 적용한다.
7. ADR을 배경/선택지/결정/이유/결과 다섯 항목으로 쓴다. 선택지에는
   "runner 스키마 인라인 전개"(재귀 때문에 불가), "suite를 객체로 두고 조합자만 제거"(strict mode의
   additionalProperties 요구 때문에 불가), "suite를 JSON 문자열로 전송"(채택)을 적는다.

**테스트 (구현 전에 먼저 작성해 실패를 확인한다)**

`packages/generate/tests/providers.test.ts`

기존 테스트 중 아래 둘은 gate 제거로 사양이 사라졌으므로 **삭제**한다.
- `"필수 flag capability가 없으면 격리를 낮추지 않는다"` (118행)
- `"기본 capability 검사는 실제 help 출력의 필수 flag를 모두 요구한다"` (126행)

기존 테스트 중 `capabilities: async () => true`를 넘기던 호출부는 해당 옵션 인자를 제거한다.
CLI 인자 배열 단언은 그대로 유지한다(회귀 방지).

신규:

```
it("help 조회 없이 바로 provider를 spawn한다")
  → runHelp 대체 경로가 없어졌으므로, run stub이 정확히 1회 호출되는지 확인한다.
    assert: r.calls.toHaveLength(1)

it("provider 전송 스키마에 지원되지 않는 keyword가 없다")
  → PROVIDER_OUTPUT_SCHEMA를 재귀 순회한다.
    assert: 어떤 depth에서도 "$schema" | "$id" | "$ref" | "$defs" 키가 없다
    assert: 최상위에 "oneOf" | "allOf" | "anyOf" | "not" 키가 없다
    assert: 어떤 depth에서도 값이 객체/배열인 재귀 참조가 없다(JSON.stringify가 예외 없이 성공)

it("Codex에 전달하는 schema 파일 내용이 PROVIDER_OUTPUT_SCHEMA다")
    assert: invocation.files[0].contents === JSON.stringify(PROVIDER_OUTPUT_SCHEMA)

it("Claude --json-schema 인자가 PROVIDER_OUTPUT_SCHEMA다")
    assert: args의 "--json-schema" 다음 원소 === JSON.stringify(PROVIDER_OUTPUT_SCHEMA)

it("suiteJson을 파싱해 suite 객체로 정규화한다")
  → run stub이 { ok: true, value: { status: "candidate", suiteJson: JSON.stringify(suite()),
    summary: "s", warnings: [], questions: [] } } 반환
    assert: author() 결과가 { status: "candidate", suite: <suite()와 deep equal>, summary: "s" }

it("suiteJson이 JSON이 아니면 schemaMismatch다")
  → suiteJson: "{not json"
    assert: rejects.toMatchObject({ code: "schemaMismatch" })

it("suiteJson이 객체가 아니면 schemaMismatch다")
  → suiteJson: "[]"
    assert: rejects.toMatchObject({ code: "schemaMismatch" })

it("Claude가 is_error를 세우면 candidate로 적용하지 않는다")
  → value: { type: "result", subtype: "success", is_error: true,
             structured_output: { status: "candidate", suiteJson: "{}", summary: "s",
                                  warnings: [], questions: [] } }
    assert: rejects.toMatchObject({ code: "schemaMismatch" })

it("Claude가 api_error_status를 담으면 candidate로 적용하지 않는다")
  → 위와 같되 api_error_status: 529
    assert: rejects.toMatchObject({ code: "schemaMismatch" })

it("Claude subtype이 success가 아니면 schemaMismatch다")
  → subtype: "error_max_turns"
    assert: rejects.toMatchObject({ code: "schemaMismatch" })

it("provider 실패 오류에 prompt·stdout·stderr 원문이 담기지 않는다")
  → 위 실패 케이스들에서 던져진 오류를 JSON.stringify + error.message + error.stack으로 합쳐 검사
    assert: "ignore previous instructions"(툴 설명 원문)를 포함하지 않는다
    assert: "structured_output" 원문 페이로드를 포함하지 않는다
```

`packages/generate/tests/authoring-request.test.ts`

```
it("questions 응답에 suite가 함께 오면 거절한다")
  → validateAuthoringProviderResult({ status: "questions", questions: ["q"], suite: {} }, preview)
    assert: { status: "invalid" }이고 issues[0].path === "status"

it("questions 응답에 summary가 함께 오면 거절한다")
    assert: 위와 동일

it("provider schema를 통과해도 허용되지 않은 툴 이름이면 로컬 validator가 거절한다")
  → suite.cases[0].operation.tool을 요청에 없는 "unknown-tool"로 바꿔 넣는다
    assert: { status: "invalid" }이고 issues에 path가
            "suite.cases[0].operation.tool"인 항목이 있다

it("provider schema를 통과해도 suite id가 다르면 거절한다")
    assert: { status: "invalid" }이고 issues에 path === "suite.id"인 항목이 있다
```

**표적 검증**: `pnpm vitest run packages/generate`
**전체 회귀**: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`

**보고 경계**: `packages/cli`나 `packages/runner`를 고쳐야 할 것 같으면 고치지 말고 `BLOCKED`로 보고한다.

---

### Task B1 — `packages/cli` 실패 원인별 안내 분기

**허용 Files (생성·수정)**

- `packages/cli/src/generate-command.ts`
- `packages/cli/tests/generate-command.test.ts`
- `.changeset/` 아래 신규 파일 1개

**수정 금지 (공유 계약)**

`core/` 전체, `packages/generate/` 전체, `packages/runner/` 전체, `packages/record/`,
`packages/mock/`, 루트 빌드 설정 전체

**작업 내용**

`generate-command.ts:216`의 `safeFailure`가 지금 모든 provider 실패를 `GENERATE_PROVIDER_FAILED`
한 줄로 찍는다. `result.failure.code`(`PublicProviderFailure.code`, 이미 정제된 값이다)에 따라
아래 문구로 분기한다. 이 프로젝트에서 실패 메시지는 곧 제품이므로 문구를 그대로 쓴다.

```
providerUnavailable
  오류 [GENERATE_PROVIDER_UNAVAILABLE]: {codex|claude} CLI를 실행할 수 없습니다.
  해결: `{codex|claude} --version`으로 설치와 PATH를 확인한 뒤 다시 요청하세요.

nonZeroExit
  오류 [GENERATE_PROVIDER_EXIT]: {codex|claude}가 코드 {exitCode}로 종료했습니다.
  해결: 로그인 상태와 모델 사용 권한을 확인하세요. `codex login status` 또는 `claude /status`.

timedOut
  오류 [GENERATE_PROVIDER_TIMEOUT]: {codex|claude} 응답이 {timeoutMs}ms 안에 오지 않았습니다.
  해결: 도구 수를 줄이거나 timeout을 늘려 다시 요청하세요.

schemaMismatch
  오류 [GENERATE_PROVIDER_SCHEMA]: {codex|claude}가 요구한 형식과 다른 결과를 돌려줬습니다.
  해결: 다시 요청하세요. 반복되면 다른 provider로 바꿔 시도하세요.

cancelled
  오류 [GENERATE_PROVIDER_CANCELLED]: AI 검토 요청이 취소됐습니다.
  해결: 메뉴에서 다시 요청하세요.

그 외 (outputLimitExceeded / invalidUtf8 / invalidJson / internal)
  기존 GENERATE_PROVIDER_FAILED 문구를 유지한다.
```

`{codex|claude}`는 `result.failure.providerId`, `{exitCode}`는 `result.failure.exitCode`,
`{timeoutMs}`는 `result.failure.timeoutMs`를 넣는다. `exitCode`가 `undefined`면 그 문장에서
`코드 {exitCode}로 ` 부분을 빼고 `종료했습니다`로 쓴다.

`357`행과 `364`행 두 호출부 모두 분기 대상이다.

**테스트**

`packages/cli/tests/generate-command.test.ts`

```
it("providerUnavailable이면 CLI 설치와 PATH 확인을 안내한다")
    assert: stderr에 "GENERATE_PROVIDER_UNAVAILABLE" 포함
    assert: stderr에 "--version" 포함

it("nonZeroExit이면 로그인 상태 확인을 안내하고 exit code를 보여준다")
    assert: stderr에 "GENERATE_PROVIDER_EXIT" 와 "코드 1로" 포함

it("exitCode를 모르면 코드 없이 종료 사실만 안내한다")
    assert: stderr에 "GENERATE_PROVIDER_EXIT" 포함, "코드 undefined" 미포함

it("timedOut이면 timeout 값과 함께 조치를 안내한다")
    assert: stderr에 "GENERATE_PROVIDER_TIMEOUT" 과 "120000ms" 포함

it("schemaMismatch면 재요청과 provider 전환을 안내한다")
    assert: stderr에 "GENERATE_PROVIDER_SCHEMA" 포함

it("internal 등 그 외 코드는 기존 문구를 유지한다")
    assert: stderr에 "GENERATE_PROVIDER_FAILED" 포함

it("실패 메시지에 prompt·stdout·stderr·stack·인증정보가 노출되지 않는다")
  → 위 전 케이스의 stderr 전체를 합쳐 검사
    assert: "ANTHROPIC_API_KEY" 미포함
    assert: "OPENAI_API_KEY" 미포함
    assert: "at " 로 시작하는 스택 프레임 줄 미포함
    assert: provider에 보낸 instruction 원문 미포함
```

**표적 검증**: `pnpm vitest run packages/cli`
**전체 회귀**: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`

**보고 경계**: `packages/generate`의 `PublicProviderFailure` 타입을 바꿔야 할 것 같으면 고치지 말고
`BLOCKED`로 보고한다.

---

### Task C1 — 실제 CLI 호출 E2E (직렬 전용)

**선행**: A1과 B1이 둘 다 통합 대장에 SHA로 기록된 뒤에만 시작한다.
**실행 주체**: 메인 오케스트레이터만. 서브에이전트에 넘기지 않는다.
**사전 승인**: 실제 Codex·Claude 호출은 과금·외부 서비스 접촉이므로 사용자 승인 뒤에만 실행한다.

**절차**

1. 프리플라이트(읽기 전용): `codex --version`, `claude --version`, `codex login status`,
   `examples/weather-server`가 기동되는지 확인.
2. Codex로 `ohmymcp generate`를 1회 실행해 승인본을 만들고 `ohmymcp test`가
   `2 passed, 0 failed`인지 확인한다.
3. Claude로 같은 절차를 1회 실행해 같은 결과인지 확인한다.
4. 두 provider 각각 같은 입력으로 2회 실행해 저장된 suite 파일의 바이트가 동일한지 확인한다
   (결정론성 확인. 다르면 무엇이 달랐는지 보고).

**완료 조건**: 두 provider 모두 `2 passed, 0 failed`.
**실패 시**: 아무것도 커밋하지 않고 실패한 provider, 실패 코드, stderr 요약을 보고한다.

## 6. 웨이브와 터미널 분할

| Wave | Task | 터미널 | worktree | 브랜치 | 모델 |
|---|---|---|---|---|---|
| 1 | A1 | 터미널 1 | `.claude/worktrees/ohmymcp-generate-provider` | `fix/generate-provider-schema` | 상위 |
| 1 | B1 | 터미널 2 | `.claude/worktrees/ohmymcp-cli-provider-failure` | `fix/cli-provider-failure-message` | 상위 |
| 2 | C1 | 메인 세션 | 없음 (루트) | 없음 | 상위 |

A1과 B1은 쓰는 파일이 겹치지 않고 `PublicProviderFailure` 타입도 바뀌지 않으므로 병렬이 안전하다.
C1은 실제 외부 서비스를 쓰므로 직렬 전용이다.

**모델 상위 배정 사유**

- A1: provider 프로토콜 준수와 envelope 판정. 어떤 envelope를 성공으로 볼지가 사양으로 다 적히지
  않고, 잘못 통과시키면 오류 응답이 candidate로 적용된다. `CLAUDE.local.md` 모델 표의
  "목 서버 프로토콜 준수"와 같은 성격이다.
- B1: 실패 메시지 문안 설계. 이 프로젝트에서 실패 메시지는 곧 제품이며 모델 표의 명시적 예외다.

## 7. 사람 몫 사전 조건

터미널을 열기 전에 프로젝트 루트에서 2줄만 확인한다.

```
git log --oneline -1     # 이 계획서 커밋이 HEAD인지
git status --short       # 깨끗한지
```

이 계획서(`docs/plans/`)와 참조 문서(`docs/ai-provider-schema-compatibility.md`)는 현재
untracked다. **worktree를 만들기 전에 커밋되어 있어야 한다.** 커밋은 사람이 한다.

## 8. 실행 프롬프트

### 터미널 1 — Task A1

권장 실행 설정: 상위 모델, 추론 수준 high, 일반 구현 에이전트(`general-purpose`).

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

/Users/doo._.hyun/Study/Project/OhMyMCP 에서
  git worktree add .claude/worktrees/ohmymcp-generate-provider -b fix/generate-provider-schema
를 실행한 뒤 세션을 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-generate-provider 로 옮겨라.

진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 BLOCKED로 보고해라:
  - pwd가 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-generate-provider 인지
  - git log --oneline -1 이 루트에서 본 기점 커밋과 같은지
  - docs/plans/2026-08-12-ai-provider-호출-복구-구현계획.md 와
    docs/ai-provider-schema-compatibility.md 가 실제로 존재하는지
  - git status --short 가 비어 있는지
  - pnpm install 을 실행한 뒤 pnpm build 와 pnpm vitest run packages/generate 가 실제로 실행되는지

[2단계: 실행]

역할: Task A1 구현자. packages/generate의 AI provider 호출을 복구한다.

계획서 docs/plans/2026-08-12-ai-provider-호출-복구-구현계획.md 의 3장(설계 결정), 4장(공유 계약),
5장 Task A1을 읽고 그대로 구현해라. 4장의 코드와 판정 순서는 그대로 쓴다.

수정해도 되는 파일은 이것뿐이다:
  packages/generate/src/authoring-schema.ts
  packages/generate/src/providers.ts
  packages/generate/src/authoring-request.ts
  packages/generate/src/index.ts
  packages/generate/tests/providers.test.ts
  packages/generate/tests/authoring-request.test.ts
  docs/adr/0007-provider-전송-스키마-분리.md (신규)
  .changeset/ 아래 신규 파일 1개

다음은 공유 계약이다. 안 맞아 보여도 고치지 말고 BLOCKED로 보고해라:
  core/ 전체, packages/runner/ 전체, packages/cli/ 전체, packages/record/, packages/mock/,
  루트 package.json, turbo.json, tsconfig.base.json, vitest.config.ts

지켜야 할 제약:
  - 의존 방향은 단방향이다. generate는 core와 runner를 참조하고, cli를 참조하지 않는다.
  - @modelcontextprotocol/sdk 는 1.x 고정이다. 버전을 올리거나 ^ 를 붙이지 마라.
  - 목록에 없는 의존성을 추가하지 마라.
  - 유닛테스트는 인메모리와 fixtures/ 만 쓴다. 실제 codex/claude 프로세스를 띄우지 마라.
  - git 명령(커밋, 머지, 푸시)을 실행하지 마라. 1단계의 worktree 생성만 예외다.
  - 백그라운드 실행과 하위 에이전트 스폰을 하지 마라.
  - 다른 작업자의 변경을 되돌리지 마라.

작업 순서:
  1. 계획서 5장 Task A1의 테스트를 먼저 작성하고, 실패하는 것을 실제로 확인한다.
  2. 구현한다.
  3. pnpm vitest run packages/generate 로 표적 검증.
  4. pnpm build && pnpm typecheck && pnpm lint && pnpm test 로 전체 회귀 검증.
     타입체크와 린트는 검사한 파일 수가 0이 아닌지 출력에서 확인한다.
  5. 보고서를 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-generate-provider/docs/reports/task-a1.md 에 쓴다.
     보고서에는 pwd, git rev-parse HEAD, 기점 커밋, 변경 파일 목록, 실행한 검증 명령과 결과 원문,
     내가 임의로 판단한 부분을 적는다.

최종 응답은 "status: READY_FOR_REVIEW" 또는 "status: BLOCKED" 로 시작하고, 변경 파일,
검증 명령과 결과, 보고서 절대 경로, 남은 위험을 포함해라.
```

### 터미널 2 — Task B1

권장 실행 설정: 상위 모델, 추론 수준 high, 일반 구현 에이전트(`general-purpose`).

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

/Users/doo._.hyun/Study/Project/OhMyMCP 에서
  git worktree add .claude/worktrees/ohmymcp-cli-provider-failure -b fix/cli-provider-failure-message
를 실행한 뒤 세션을 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-cli-provider-failure 로 옮겨라.

진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 BLOCKED로 보고해라:
  - pwd가 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-cli-provider-failure 인지
  - git log --oneline -1 이 루트에서 본 기점 커밋과 같은지
  - docs/plans/2026-08-12-ai-provider-호출-복구-구현계획.md 가 실제로 존재하는지
  - git status --short 가 비어 있는지
  - pnpm install 을 실행한 뒤 pnpm build 와 pnpm vitest run packages/cli 가 실제로 실행되는지

[2단계: 실행]

역할: Task B1 구현자. packages/cli의 generate 실패 메시지를 원인별로 분기한다.

계획서 docs/plans/2026-08-12-ai-provider-호출-복구-구현계획.md 의 5장 Task B1을 읽고 그대로
구현해라. 실패 메시지 문구는 계획서에 적힌 문장을 그대로 쓴다. 이 프로젝트에서 실패 메시지는
곧 제품이다. 임의로 다듬지 마라.

수정해도 되는 파일은 이것뿐이다:
  packages/cli/src/generate-command.ts
  packages/cli/tests/generate-command.test.ts
  .changeset/ 아래 신규 파일 1개

다음은 공유 계약이다. 안 맞아 보여도 고치지 말고 BLOCKED로 보고해라:
  core/ 전체, packages/generate/ 전체, packages/runner/ 전체, packages/record/, packages/mock/,
  루트 package.json, turbo.json, tsconfig.base.json, vitest.config.ts

특히 packages/generate 의 PublicProviderFailure 타입은 다른 터미널이 동시에 작업 중인 패키지다.
필드를 추가하거나 바꿔야 할 것 같으면 절대 고치지 말고 BLOCKED로 보고해라. 현재 필드는
providerId, code, timeoutMs, exitCode, stderr 이며 이것만으로 구현할 수 있다.

지켜야 할 제약:
  - 의존 방향은 단방향이다. cli는 generate/runner/record/mock을 참조하고, 역참조를 만들지 않는다.
  - @modelcontextprotocol/sdk 는 1.x 고정이다.
  - 목록에 없는 의존성을 추가하지 마라.
  - 유닛테스트는 인메모리와 fixtures/ 만 쓴다. 실제 codex/claude 프로세스를 띄우지 마라.
  - git 명령(커밋, 머지, 푸시)을 실행하지 마라. 1단계의 worktree 생성만 예외다.
  - 백그라운드 실행과 하위 에이전트 스폰을 하지 마라.
  - 다른 작업자의 변경을 되돌리지 마라.

작업 순서:
  1. 계획서 5장 Task B1의 테스트를 먼저 작성하고, 실패하는 것을 실제로 확인한다.
  2. 구현한다.
  3. pnpm vitest run packages/cli 로 표적 검증.
  4. pnpm build && pnpm typecheck && pnpm lint && pnpm test 로 전체 회귀 검증.
     타입체크와 린트는 검사한 파일 수가 0이 아닌지 출력에서 확인한다.
  5. 보고서를 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-cli-provider-failure/docs/reports/task-b1.md 에 쓴다.
     보고서에는 pwd, git rev-parse HEAD, 기점 커밋, 변경 파일 목록, 실행한 검증 명령과 결과 원문,
     내가 임의로 판단한 부분을 적는다.

최종 응답은 "status: READY_FOR_REVIEW" 또는 "status: BLOCKED" 로 시작하고, 변경 파일,
검증 명령과 결과, 보고서 절대 경로, 남은 위험을 포함해라.
```

## 9. 통합 게이트

1. 각 태스크 보고서, 허용 Files의 diff, 테스트 출력을 직접 확인한다. "완료" 선언만으로 통합하지 않는다.
2. 허용 Files 밖 변경이 있으면 통합하지 않고 되돌린다.
3. 통합 순서는 A1 → B1. 통합 직후 SHA를 `docs/task-integration-ledger.tsv`에 기록하고 별도 문서
   커밋으로 보존한다.
4. 통합 후 루트에서 `pnpm build && pnpm typecheck && pnpm lint && pnpm test`를 다시 돌린다.
   빌드 산출물이 낡으면 고쳐진 결함이 계속 재현되므로 `pnpm build`를 건너뛰지 않는다.
5. 둘 다 통합되고 대장에 SHA가 남은 뒤에 Wave 2(Task C1)를 사용자 승인 아래 실행한다.

## 10. 거짓 신호 점검

`CLAUDE.local.md`의 표에서 이 계획이 실제로 밟을 항목:

- **새 worktree에서 테스트 타임아웃**: 의존성 미설치. 프롬프트 1단계의 `pnpm install`로 막는다.
- **결함이 계속 재현**: 빌드 산출물이 낡음. cli는 generate의 산출물을 보므로 A1 통합 후
  `pnpm build`를 반드시 돌린다.
- **타입체크·린트 녹색인데 검사 대상 0개**: 검사한 파일 수를 출력에서 확인하라고 프롬프트에 넣었다.
- **유닛테스트 녹색, 실행 시 실패**: 이 결함 자체가 그 사례다. Task C1의 실제 CLI 호출이 유일한
  진실 기준이다. C1 없이 완료로 판정하지 않는다.
