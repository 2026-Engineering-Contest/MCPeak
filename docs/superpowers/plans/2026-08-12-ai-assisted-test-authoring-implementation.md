# AI 보조 테스트 작성·반복 검토 구현 계획

> 설계 기준: [AI 보조 테스트 작성·반복 검토 설계](../specs/2026-08-12-ai-assisted-test-authoring-design.md)
>
> 실행 규약: [계획 규약](../../conventions/plan.md), [실행 규약](../../conventions/execution.md)

## 1. 목표

결정론적 스키마 엔진이 만든 baseline을 사용자의 Codex 또는 Claude가 보완하고, 사용자가 검토 중
재수정을 요청하거나 변경 일부를 선택해 승인한 뒤 최종 JSON suite를 기존 `ohmymcp test`로 실행할
수 있게 한다.

완료 조건은 다음과 같다.

1. `@ohmymcp/generate`가 한 서버의 `ToolDef[]`를 in-memory baseline suite 하나로 만들고 같은
   입력·정책에 byte가 같은 fingerprint를 반환한다.
2. baseline, 승인 draft, working candidate, execution snapshot이 분리되고 AI 호출·거절·질문·실패는
   승인 revision을 바꾸지 않는다.
3. provider request와 result는 redaction, byte 제한, opaque binding, fingerprint 승인과 재검증을
   통과해야 한다.
4. Codex와 Claude adapter는 빈 임시 cwd, stdin, 구조화 출력, 도구·MCP·파일 쓰기 차단,
   환경변수 allowlist, timeout·취소·bounded 종료를 사용한다.
5. `ohmymcp generate`가 baseline-only와 대화형 AI 반복 검토를 지원하고 최종 승인 JSON만 원자적으로
   저장한다.
6. weather-server baseline은 `city: "example"` 때문에 실제 test가 실패하고, `서울`을 넣은 승인
   candidate는 통과한다.
7. 전체 `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`와 CLI dist E2E가 통과한다.

## 2. 비범위와 절대 제약

- `packages/core/src/types.ts`의 `McpClient`, `ToolResult`를 바꾸지 않는다.
- `@modelcontextprotocol/sdk` 버전과 root catalog를 바꾸지 않는다.
- 목록에 없는 외부 dependency를 추가하지 않는다. Node 내장 모듈과 기존 workspace package만 쓴다.
- `record`, `replay`, Dashboard, authoring session 영속화, RunnerReport repair provider 호출은 구현하지
  않는다.
- AI가 승인 없이 테스트를 실행·저장·덮어쓰게 하지 않는다.
- provider session resume, 자동 재시도, 자동 fallback, 자동 모델 승급을 구현하지 않는다.
- raw prompt, provider stdout·stderr, native error stack, 실제 MCP 입력·응답을 로그나 report에
  보존하지 않는다.
- 한 태스크에서 `packages/generate/**`와 `packages/cli/**`를 같이 수정하지 않는다.
- 구현 agent, reviewer, 메인 세션은 commit, merge, push하지 않는다. 사용자가 각 gate에서 수행한다.
- 실제 Codex·Claude smoke는 사용자의 명시적 승인과 계정·비용 확인 없이 실행하지 않는다.

## 3. 확인된 현재 상태

- 기준 main HEAD: 계획 작성 시 `22a4bdf171fc904c90ee5be0a6728559f7a4e529`이다.
- 설계·ADR·이 계획은 현재 작업 트리의 문서 변경이므로 실행 전 사용자가 먼저 커밋해야 한다.
- `generateTests()`는 도구별 TypeScript suite 파일을 만들며 in-memory baseline API는 없다.
- `packages/generate/package.json`은 `@ohmymcp/core`만 의존한다.
- Runner의 `TestSuiteSpec`, `MCP_SUITE_JSON_SCHEMA`, `validateMcpSuite`는 구현돼 있다.
- CLI는 `test`만 구현됐고 `generate`는 `COMMAND_NOT_IMPLEMENTED`다.
- weather-server의 `get_weather` schema에는 유효 도시 example이 없으므로 현재 규칙은
  `{ city: "example" }`을 만든다. 실제 서버는 이를 `isError: true`로 반환한다.
- 계획 작성 시 worktree 경로와 branch 이름은 비어 있다.

실행 직전에는 HEAD를 다시 계산한다. 위 SHA를 구현 기점으로 고정하지 않는다. 설계와 계획을 포함한
사용자 문서 커밋의 SHA가 실제 기점이다.

## 4. 실행 모델과 터미널 분할

메인 세션은 오케스트레이터로서 worktree 생성, 구현 agent 스폰, report·diff·테스트 직접 확인,
수정 루프와 사용자 commit gate를 소유한다. 구현은 task마다 `gpt-5.6-terra`, 추론 `medium` agent
한 명이 수행한다. 최종 package review도 별도 `gpt-5.6-terra`, 추론 `medium` agent가 읽기 전용으로
수행한다.

상위 모델은 provider process 수명주기나 approval binding의 같은 불확실성이 표준 모델의 서로 다른
두 시도 후에도 남을 때만 `gpt-5.6-sol`, 추론 `medium`으로 승급한다.

| Terminal | Worktree | Branch | Tasks | 시작 조건 |
|---|---|---|---|---|
| 1 | `<repo-root>/../OhMyMCP-worktrees/generate-ai-authoring` | `feat/generate-ai-authoring` | G1→G5 | 문서 커밋이 main HEAD이고 status clean |
| 2 | `<repo-root>/../OhMyMCP-worktrees/cli-ai-authoring` | `feat/cli-ai-authoring` | C1→C4 | G5 최종 SHA가 main 조상이고 ledger에 기록됨 |

두 terminal은 병렬 실행하지 않는다. CLI가 새 Generate 공개 API와 dist를 소비하므로 Generate 전체가
main에 통합된 뒤 Terminal 2를 만든다.

## 5. 의존성 그래프와 통합 대장

```text
문서 커밋
  ↓
G1 baseline·Runner dependency
  ↓ 사용자 commit SHA
G2 authoring state·diff·snapshot
  ↓ 사용자 commit SHA
G3 request·result 검증·redaction·approval
  ↓ 사용자 commit SHA
G4 provider process·Codex·Claude·dispatch
  ↓ 사용자 commit SHA
G5 Generate 문서·changeset·전체 검증·최종 review
  ↓ 사용자 commit·main 통합 SHA
C1 generate parser·baseline-only·atomic save
  ↓ 사용자 commit SHA
C2 대화형 반복 AI 검토
  ↓ 사용자 commit SHA
C3 실제 weather-server·dist E2E
  ↓ 사용자 commit SHA
C4 CLI 문서·changeset·전체 검증·최종 review
```

통합 SHA는 [ledger](./2026-08-12-ai-assisted-test-authoring-ledger.tsv)에 기록한다. 다음 task 전에
`git cat-file -e <sha>^{commit}`와 `git merge-base --is-ancestor <sha> HEAD`를 모두 통과해야 한다.
같은 feature worktree 안의 다음 task는 사용자가 만든 직전 task commit이 HEAD인지 확인한다.
Terminal 2는 G5 SHA가 main의 조상인지 확인한다.

## 6. 파일 소유권

### Generate 생성 예정

- `packages/generate/src/baseline.ts`
- `packages/generate/src/canonical.ts`
- `packages/generate/src/authoring-types.ts`
- `packages/generate/src/redaction.ts`
- `packages/generate/src/authoring-session.ts`
- `packages/generate/src/authoring-schema.ts`
- `packages/generate/src/authoring-request.ts`
- `packages/generate/src/provider-process.ts`
- `packages/generate/src/providers.ts`
- `packages/generate/tests/baseline.test.ts`
- `packages/generate/tests/authoring-session.test.ts`
- `packages/generate/tests/authoring-request.test.ts`
- `packages/generate/tests/provider-process.test.ts`
- `packages/generate/tests/providers.test.ts`
- `.changeset/generate-ai-authoring.md`

### Generate 수정 예정

- `packages/generate/src/index.ts`
- `packages/generate/tests/index.test.ts`
- `packages/generate/package.json`
- `packages/generate/README.md`
- `pnpm-lock.yaml`, G1의 workspace dependency 반영만
- `docs/architecture.md`, G5의 승인된 의존 방향 설명만

### CLI 생성 예정

- `packages/cli/src/generate-command.ts`
- `packages/cli/tests/generate-command.test.ts`
- `packages/cli/tests/generate-integration.test.ts`
- `.changeset/cli-ai-authoring.md`

### CLI 수정 예정

- `packages/cli/src/index.ts`
- `packages/cli/tests/index.test.ts`
- `packages/cli/tests/dist-cli-e2e.mjs`
- `packages/cli/README.md`

### 모든 task에서 수정 금지

- `packages/core/src/types.ts`
- `packages/core/**`, `packages/runner/**`, `packages/record/**`, `packages/mock/**`
- `examples/**`, `fixtures/**`
- root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `vitest.config.ts`,
  `biome.json`
- `@modelcontextprotocol/sdk` catalog와 lockfile의 해당 resolution

## 7. 고정 공개 계약

설계 문서의 타입을 다음 파일에 나눠 구현하고 package root에서 재수출한다.

```text
baseline.ts
  BaselineSuiteOptions, BaselineGenerationResult, createBaselineSuite

authoring-types.ts
  AuthoringDraft, AuthoringSessionView, CaseProvenance
  AuthoringRequest, AuthoringRequestPreview, AuthoringProviderResult
  SanitizedAuthoringCandidate, AuthoringChange, AuthoringDiffPreview
  approval·dispatch·application·snapshot result union

authoring-session.ts
  createAuthoringSession, reviewLocalAuthoringCandidate
  createAuthoringDiff, applyAuthoringChanges
  finalizeAuthoringDraft, getAuthoringExecutionSuite

authoring-request.ts
  prepareAuthoringRequest, validateAuthoringProviderResult
  dispatchAuthoringRequest

providers.ts
  TestAuthoringProvider, createCodexAuthoringProvider, createClaudeAuthoringProvider
```

기존 `generateTests`, `GenerateOptions`, `GenerateTestsError`, `GenerateTestsErrorCode`는 signature와 동작을
유지한다. `createBaselineSuite`는 한 suite에 tool 순서대로 case를 넣지만 기존 `generateTests`는
도구별 파일을 계속 만든다.

### 7.1 고정 상수

```ts
export const BASELINE_POLICY_VERSION = "schema-baseline-v1" as const;
export const DEFAULT_BASELINE_TIMEOUT_MS = 10_000;
export const DEFAULT_PROVIDER_TIMEOUT_MS = 120_000;
export const MAX_PROVIDER_TIMEOUT_MS = 600_000;
export const DEFAULT_MAX_RESULT_BYTES = 262_144;
export const MAX_PROMPT_BYTES = 65_536;
export const MAX_TOOLS_BYTES = 131_072;
export const MAX_REQUEST_BYTES = 262_144;
export const MAX_STDERR_BYTES = 65_536;
export const PROVIDER_TERMINATION_GRACE_MS = 1_000;
export const PROVIDER_FORCE_DEADLINE_MS = 1_000;
```

종료는 timeout/cancel 시 기본 signal, 1,000ms 뒤 `SIGKILL`, 다시 1,000ms 뒤 child가 close하지 않아도
public result를 끝낸다. 아직 cwd로 사용하는 temp directory에서 child가 살아 있을 수 있으면 해당
directory를 삭제하지 않는다.

### 7.2 fingerprint와 binding

- canonical serializer는 array 순서를 유지하고 plain object key를 UTF-16 code unit 순서로 정렬한다.
- `undefined`, sparse array, 비유한 number, non-plain object와 cycle을 fingerprint 전에 거절한다.
- SHA-256 lowercase hex만 쓴다.
- visible fingerprint는 `binding`과 `fingerprint` field를 제외한다.
- fingerprint만 인증 근거로 쓰지 않고 module-private `WeakMap`의 binding identity를 함께 검사한다.
- request, candidate, session, execution snapshot registry는 package root에서 export하지 않는다.

### 7.3 authoring 상태 전이

| 현재 상태 | 입력 | 결과 |
|---|---|---|
| baseline 없음 | `createBaselineSuite` 성공 | frozen baseline result |
| baseline result | `createAuthoringSession` | revision 0 approved draft, 실행 불가 |
| approved draft | AI candidate·질문·실패·거절 | revision 불변 |
| approved draft + valid candidate | diff preview | revision 불변 |
| diff preview + 선택 + 승인 | 재검증 성공 | revision +1 frozen draft |
| diff preview + invalid/변조/redaction | 적용 거절 | revision·draft 불변 |
| approved draft + 최종 fingerprint 승인 | 재검증 성공 | opaque execution snapshot |

suite ID와 schema version은 session 동안 불변이다. unknown tool candidate는 전체 거절한다.

### 7.4 diff 순서와 선택 적용

diff는 metadata, 승인 순서의 remove, 승인 순서의 replace, candidate 순서의 add, caseOrder 순서다.
change ID는 `change-001`부터 시작한다. 실제 before/after case와 index를 preview에 포함한다.
선택 적용은 같은 순서로 승인 draft clone에 수행한다. add는 `candidateIndex`에 삽입한다.
`caseOrder.after`의 ID 집합이 조립 결과와 다르면 `incompatibleSelection`이다.

### 7.5 provider output Schema

`AUTHORING_OUTPUT_SCHEMA`는 `status: candidate | questions`의 닫힌 union이다. candidate branch의
`suite`는 Runner `MCP_SUITE_JSON_SCHEMA`의 `$defs`를 deep clone해 root `$defs`로 병합하고 내부
`#/$defs/*` reference가 같은 root를 가리키게 한다. Runner Schema 객체를 수정하지 않는다.
questions branch는 비어 있지 않은 string array만 허용한다. runtime validator는 Schema 통과를
신뢰하지 않고 `validateMcpSuite`, suite identity와 known tool 검사를 다시 수행한다.

## 8. Task G1: Runner 연동과 결정론적 baseline

**모델:** `gpt-5.6-terra`, 추론 `medium`

**Files:**

- Create: `packages/generate/src/baseline.ts`
- Create: `packages/generate/src/canonical.ts`
- Create: `packages/generate/tests/baseline.test.ts`
- Modify: `packages/generate/src/index.ts`
- Modify: `packages/generate/tests/index.test.ts`
- Modify: `packages/generate/package.json`
- Modify: `pnpm-lock.yaml`, workspace link만

### RED 테스트 이름과 필수 단언

1. `툴 순서대로 한 baseline suite와 case를 만든다`
   - 두 tools에서 case 두 개, operation tool 순서 동일
   - suite ID·name은 options exact value
   - default timeout은 10,000
   - 각 assertion은 `isError false`
   - `validateMcpSuite(result.suite).valid === true`
2. `명시한 baseline timeout과 suite identity를 보존한다`
   - `defaultTimeoutMs: 30_000` exact
   - blank ID/name, invalid timeout은 파일·session 전 거절
3. `같은 입력과 정책에 같은 fingerprint를 만든다`
   - 두 결과 deep equality
   - suite fingerprint 64-char lowercase hex
   - key insertion 순서가 다른 동등 schema도 같은 baseline fingerprint
4. `baseline 결과와 중첩 suite를 재귀 동결한다`
   - result, suite, cases, operation.input, assertions가 frozen
   - 원본 tools 변경이 결과를 바꾸지 않음
5. `기존 파일 생성과 baseline case 합성 규칙을 공유한다`
   - 한 tool의 기존 generated source를 import 또는 JSON 추출해 baseline case와 deep equality
   - 기존 path와 source snapshot 단언 유지
6. `지원하지 않는 schema는 어떤 산출물보다 먼저 거절한다`
   - 기존 `GenerateTestsError` code/path/hint 유지
   - baseline result 없음, 기존 file output 없음
7. `Runner 계약을 복사하지 않고 package dependency로 소비한다`
   - root import로 `TestSuiteSpec`, validator 사용
   - `packages/generate/package.json`에 `@ohmymcp/runner: workspace:*`
   - `packages/core/src/types.ts` diff 없음

RED:

```bash
pnpm exec vitest run packages/generate/tests/baseline.test.ts packages/generate/tests/index.test.ts
```

GREEN:

```bash
pnpm exec vitest run packages/generate/tests/baseline.test.ts packages/generate/tests/index.test.ts
pnpm exec vitest run packages/generate/tests
pnpm --filter @ohmymcp/generate typecheck
pnpm --filter @ohmymcp/generate build
pnpm exec biome check packages/generate
```

사용자 commit 권장:

```text
feat(generate): 결정론적 baseline suite API 추가
```

## 9. Task G2: Authoring 상태, diff, 선택 적용과 snapshot

**모델:** `gpt-5.6-terra`, 추론 `medium`

**Files:**

- Create: `packages/generate/src/authoring-types.ts`
- Create: `packages/generate/src/redaction.ts`
- Create: `packages/generate/src/authoring-session.ts`
- Create: `packages/generate/tests/authoring-session.test.ts`
- Modify: `packages/generate/src/index.ts`

### RED 테스트 이름과 필수 단언

1. `baseline으로 revision 0 authoring session을 만든다`
   - baseline과 approved draft suite deep equality
   - working candidate undefined
   - session view와 draft recursive frozen
2. `candidate와 질문은 승인 revision을 바꾸지 않는다`
   - local candidate review 뒤 revision 0
   - questions candidate 뒤 revision 0
3. `승인 draft 기준으로 고정 순서 diff를 만든다`
   - metadata, remove, replace, add, order exact 순서
   - IDs `change-001..005`
   - before/after, approvedIndex, candidateIndex exact
4. `baseline case 누락을 명시적인 remove로 표시한다`
   - 누락 case ID와 원본 spec 포함
5. `선택한 변경만 적용해 revision을 한 번 증가시킨다`
   - 선택하지 않은 case 불변
   - AI add/replace provenance와 provider ID 기록
   - 새 draft recursive frozen
6. `호환되지 않는 order 선택을 원자적으로 거절한다`
   - `incompatibleSelection`
   - revision, draft reference, provenance 불변
7. `unknown change와 중복 selected ID를 거절한다`
   - 적용 0건, 안전한 reason
8. `suite identity와 unknown tool candidate를 거절한다`
   - 다른 schemaVersion/suite ID 또는 없는 tool
   - diff·revision 없음
9. `민감 입력이 redaction된 candidate는 적용하지 않는다`
   - default key와 caller sensitive value가 `[REDACTED]`
   - raw sentinel이 preview 직렬화에 없음
   - executable false, `redactionRequired`
10. `직접 편집도 같은 검증과 diff 경계를 사용한다`
    - valid local JSON은 candidate preview
    - invalid suite는 public safe issues만 반환
11. `승인 fingerprint가 같은 draft만 execution snapshot으로 만든다`
    - false approval, wrong fingerprint, mutated view 거절
    - valid snapshot getter는 registry의 frozen suite 반환
    - forged snapshot 거절

RED:

```bash
pnpm exec vitest run packages/generate/tests/authoring-session.test.ts
```

GREEN:

```bash
pnpm exec vitest run packages/generate/tests/authoring-session.test.ts
pnpm exec vitest run packages/generate/tests
pnpm --filter @ohmymcp/generate typecheck
pnpm --filter @ohmymcp/generate build
pnpm exec biome check packages/generate
```

사용자 commit 권장:

```text
feat(generate): 반복 검토 상태와 변경 승인 추가
```

## 10. Task G3: AI request·result 검증과 승인 binding

**모델:** `gpt-5.6-terra`, 추론 `medium`

**Files:**

- Create: `packages/generate/src/authoring-schema.ts`
- Create: `packages/generate/src/authoring-request.ts`
- Create: `packages/generate/tests/authoring-request.test.ts`
- Modify: `packages/generate/src/index.ts`

### RED 테스트 이름과 필수 단언

1. `initial 요청은 baseline을 candidate로 고정한다`
   - frozen binding context의 baseline/candidate deep equality
   - visible preview 변경이 stored request를 바꾸지 않음
2. `revise 요청은 working candidate와 새 instruction만 보낸다`
   - 이전 raw prompt/output/session ID 없음
   - baseline, current candidate, instruction, tools만 존재
3. `prompt와 tool schema 비밀값을 전송 전에 제거한다`
   - assignment와 recursive sensitive key/value redaction
   - raw sentinel이 preview·fingerprint 직렬화에 없음
4. `비 JSON inputSchema를 redaction과 binding 전에 거절한다`
   - Date, undefined, NaN, Infinity, sparse array, function, bigint, symbol, cycle
   - 고정 code/path/message/hint, preview 0개
   - primitive, dense array, null-prototype, shared object 허용
5. `prompt tools request와 result 옵션 상한을 동기 검증한다`
   - 65,537/131,073/262,145 bytes scope exact
   - timeout 0, 소수, 600,001, NaN, Infinity 거절
   - 1과 600,000 허용
6. `request 승인 뒤 visible payload나 fingerprint 변조를 거절한다`
   - provider 호출 준비 0회, `approvalInvalidated`
7. `Runner Schema를 수정하지 않고 authoring output Schema를 만든다`
   - candidate/questions 닫힌 union
   - nested `$ref` resolution과 valid/invalid fixture parity
   - 원본 `MCP_SUITE_JSON_SCHEMA` deep equality·frozen 유지
8. `candidate provider 결과를 전체 문맥으로 검증한다`
   - valid candidate accepted
   - suite ID mismatch, unknown tool, duplicate ID, unsupported assertion 전체 invalid
9. `questions 결과는 candidate를 만들지 않는다`
   - non-empty questions only
   - approved revision과 working candidate 불변
10. `provider 결과의 비밀과 크기를 UI 전에 다시 제한한다`
    - suite input sentinel redacted, executable false
    - raw/sanitized 262,145 bytes는 result limit failure, preview 없음
11. `invalid provider issue에 raw key와 value를 넣지 않는다`
    - sentinel unknown property/value가 모든 returned issue field에 없음
    - issue array 최대 100개, 65,536 bytes와 truncation sentinel

RED:

```bash
pnpm exec vitest run packages/generate/tests/authoring-request.test.ts
```

GREEN:

```bash
pnpm exec vitest run packages/generate/tests/authoring-request.test.ts packages/generate/tests/authoring-session.test.ts
pnpm exec vitest run packages/generate/tests
pnpm --filter @ohmymcp/generate typecheck
pnpm --filter @ohmymcp/generate build
pnpm exec biome check packages/generate
```

사용자 commit 권장:

```text
feat(generate): AI 요청과 결과 검증 경계 추가
```

## 11. Task G4: 공통 provider process와 Codex·Claude adapter

**모델:** `gpt-5.6-terra`, 추론 `medium`

**Files:**

- Create: `packages/generate/src/provider-process.ts`
- Create: `packages/generate/src/providers.ts`
- Create: `packages/generate/tests/provider-process.test.ts`
- Create: `packages/generate/tests/providers.test.ts`
- Modify: `packages/generate/src/authoring-request.ts`
- Modify: `packages/generate/src/index.ts`

### RED 테스트 이름과 필수 단언

1. `Codex를 빈 cwd의 read-only ephemeral structured 실행으로 호출한다`
   - command `codex`, args가 설계 §12 exact 순서
   - prompt는 stdin, shell false, stdio pipe
   - output schema temp path
2. `Claude를 safe mode와 빈 도구·MCP·session으로 호출한다`
   - command `claude`, args가 설계 §12 exact 순서
   - inline Schema, stdin prompt
   - `structured_output`만 공통 결과로 반환
3. `필수 flag capability가 없으면 격리를 낮추지 않는다`
   - `codex exec --help`, `claude --help` fake output에서 flag 하나 누락
   - unavailable, inference spawn 0회
4. `두 provider가 같은 고정 지침과 제한된 context를 받는다`
   - baseline/candidate/tools/instruction exact
   - untrusted-data 경고가 instruction 마지막 줄
   - raw MCP input/output, env, path 없음
5. `환경변수 allowlist만 child에 전달한다`
   - design allowlist exact
   - PWD, arbitrary project secret 없음
6. `stdout byte 상한을 parse 전에 적용한다`
   - 262,145번째 byte 관찰 시 termination
   - JSON parse, envelope, validation, sanitization 0회
7. `chunk UTF-8 상태와 final flush를 검증한다`
   - 분할된 서울 정상 복원
   - malformed와 incomplete final은 invalidUtf8, parse 0회
8. `timeout과 cancel을 bounded 종료한다`
   - timeout 전 pending, boundary에 default kill
   - 1,000ms 뒤 SIGKILL, 2,000ms hard deadline에 public result 완료
   - pre-abort spawn 0회
   - 같은 시각 cancel 우선
9. `active cwd는 child가 닫히기 전에 삭제하지 않는다`
   - hard deadline child pending이면 rm 0회
   - close 관찰 뒤 temp cleanup 1회
10. `nonzero invalid JSON schema mismatch를 안전하게 구분한다`
    - exit code만 보존
    - stdout/stderr/native message/stack 미포함
11. `provider 실패를 자동 재시도하거나 fallback하지 않는다`
    - spawn 1회, 다른 provider 0회
12. `timeout·취소 뒤 늦은 settlement를 관찰한다`
    - late reject/close 후 result 불변, unhandled rejection 0건
13. `dispatch는 승인 binding의 frozen request만 provider에 보낸다`
    - false approval provider 0회
    - valid approval 1회
    - provider raw unknown을 즉시 validate→sanitize preview로 변환

RED:

```bash
pnpm exec vitest run packages/generate/tests/provider-process.test.ts packages/generate/tests/providers.test.ts
```

GREEN:

```bash
pnpm exec vitest run packages/generate/tests/provider-process.test.ts packages/generate/tests/providers.test.ts packages/generate/tests/authoring-request.test.ts
pnpm exec vitest run packages/generate/tests
pnpm --filter @ohmymcp/generate typecheck
pnpm --filter @ohmymcp/generate build
pnpm exec biome check packages/generate
```

사용자 commit 권장:

```text
feat(generate): Codex와 Claude provider adapter 추가
```

## 12. Task G5: Generate 문서, changeset, 전체 검증

**모델:** `gpt-5.6-terra`, 추론 `medium`

**Files:**

- Modify: `packages/generate/README.md`
- Modify: `packages/generate/package.json`, description만
- Modify: `docs/architecture.md`, `generate → runner` 방향과 authoring 역할만
- Create: `.changeset/generate-ai-authoring.md`
- Test only: 모든 Generate tests

README에는 baseline API, stateless 재호출, 3단 승인, Codex·Claude 격리, raw 데이터 미보존,
RunnerReport repair 비범위를 포함한다. changeset은 `@ohmymcp/generate` minor다.

```md
---
"@ohmymcp/generate": minor
---

결정론적 baseline, 반복 AI 검토·승인 상태와 격리된 Codex·Claude provider adapter를 추가합니다.
```

검증:

```bash
pnpm exec vitest run packages/generate/tests
pnpm --filter @ohmymcp/generate typecheck
pnpm --filter @ohmymcp/generate build
pnpm exec biome check packages/generate docs/architecture.md .changeset/generate-ai-authoring.md
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm changeset status
git diff --check
```

사용자 commit 권장:

```text
docs(generate): AI 보조 작성 사용법과 changeset 추가
```

G5 main review 뒤 읽기 전용 최종 reviewer가 설계 §§5~14와 passing tests를 대조한다. reviewer가
지적하면 해당 허용 Files를 소유한 기존 task agent에게 follow-up하고 전체 검증을 반복한다. 통과 후
사용자가 G5를 commit하고 feature branch를 main에 통합한다. 메인 세션은 merge·push하지 않는다.

## 13. Task C1: generate parser, baseline-only와 atomic JSON save

**모델:** `gpt-5.6-terra`, 추론 `medium`

**Files:**

- Create: `packages/cli/src/generate-command.ts`
- Create: `packages/cli/tests/generate-command.test.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/tests/index.test.ts`

고정 usage:

```text
사용법: ohmymcp generate --suite-id <id> --name <name> --out <suite.json> --command <executable> [--arg <value> ...] [--baseline-only] [--provider <codex|claude>] [--model <model>]
```

`--baseline-only`는 명시적 비대화형 승인으로 baseline을 저장한다. AI를 호출하지 않는다. interactive
mode에서 `--model`은 `--provider`와 함께만 허용한다. `--out`은 `.json`만 허용한다.

### RED 테스트 이름과 필수 단언

1. `generate 필수 값과 반복 arg를 순서대로 파싱한다`
2. `equals 형식, 하이픈 arg와 빈 arg를 보존한다`
3. `누락·중복·unknown·추가 위치 인자를 사용법 오류로 거절한다`
4. `model 단독과 잘못된 provider를 process 전에 거절한다`
5. `baseline-only는 Core tools/list 뒤 server를 닫고 AI 없이 저장한다`
   - connect→listTools→close→baseline→finalize→write 순서
   - provider 0회
6. `listTools 실패는 열린 connection을 강제 종료한다`
7. `기존 out 파일을 비대화형으로 덮어쓰지 않는다`
   - 기존 content 불변, temp·rename 0회
8. `같은 디렉터리 temp write를 다시 읽어 검증한 뒤 rename한다`
   - temp 이름 `.<basename>.ohmymcp.tmp`
   - write→read→validate/fingerprint→rename 순서
9. `temp 충돌과 재검증 실패는 목표 파일을 바꾸지 않는다`
10. `저장 JSON은 고정 필드 순서, 2칸 indent와 마지막 newline을 쓴다`
11. `generate dispatch 실패를 raw 오류 없이 정규화한다`
12. `기존 test 명령의 출력과 종료 코드를 바꾸지 않는다`

RED:

```bash
pnpm exec vitest run packages/cli/tests/generate-command.test.ts packages/cli/tests/index.test.ts
```

GREEN:

```bash
pnpm exec vitest run packages/cli/tests/generate-command.test.ts packages/cli/tests/index.test.ts packages/cli/tests/test-command.test.ts
pnpm --filter ohmymcp typecheck
pnpm --filter ohmymcp build
pnpm exec biome check packages/cli
```

사용자 commit 권장:

```text
feat(cli): baseline generate 명령 추가
```

## 14. Task C2: 대화형 AI 반복 검토

**모델:** `gpt-5.6-terra`, 추론 `medium`

**Files:**

- Modify: `packages/cli/src/generate-command.ts`
- Modify: `packages/cli/tests/generate-command.test.ts`
- Modify: `packages/cli/src/index.ts`, production dependency 조립만

production UI는 `node:readline/promises`를 사용하고 테스트는 injected `ReviewIO`를 사용한다.

```ts
export interface ReviewIO {
  input(message: string): Promise<string>;
  choose(message: string, choices: readonly string[]): Promise<string>;
  confirm(message: string): Promise<boolean>;
  write(text: string): void;
  readonly interactive: boolean;
}
```

직접 수정은 editor process를 실행하지 않는다. 사용자가 별도로 만든 JSON 파일 경로를 입력하면 fatal
UTF-8 decode, JSON parse와 `reviewLocalAuthoringCandidate`를 거친다.

### RED 테스트 이름과 필수 단언

1. `비대화형 AI mode를 provider 호출 전에 거절한다`
   - hint에 `--baseline-only` 또는 TTY
2. `provider와 model을 사용자가 선택한다`
   - both available 선택 menu
   - explicit provider/model exact
   - default codex `gpt-5.6-luna`, claude `haiku`
3. `provider unavailable이면 자동 fallback하지 않는다`
4. `AI 호출마다 정제된 request preview와 fingerprint 승인을 받는다`
   - 거절 provider 0회
   - 재호출도 새 confirm 1회 추가
5. `candidate diff를 전체 적용해 revision을 증가시킨다`
6. `선택 change ID만 적용한다`
   - unknown/incompatible selection은 draft 불변과 안내
7. `검토 중 피드백으로 AI를 재호출한다`
   - 두 번째 request candidate가 첫 working candidate
   - approved draft revision은 적용 전 불변
   - provider session ID/resume 없음
8. `questions 결과를 표시하고 답변으로 새 요청을 만든다`
9. `provider 실패 뒤 자동 재시도하지 않고 메뉴로 돌아간다`
10. `편집한 JSON 파일도 같은 diff와 승인 경계를 거친다`
11. `result redaction candidate를 저장하거나 적용하지 않는다`
12. `최종 fingerprint 승인 뒤에만 JSON을 저장한다`
13. `사용자 취소는 provider·파일 쓰기 없이 종료 코드 0이다`
14. `failure 출력에 prompt stdout stderr native stack을 넣지 않는다`

RED:

```bash
pnpm exec vitest run packages/cli/tests/generate-command.test.ts
```

GREEN:

```bash
pnpm exec vitest run packages/cli/tests/generate-command.test.ts packages/cli/tests/index.test.ts
pnpm exec vitest run packages/cli/tests
pnpm --filter ohmymcp typecheck
pnpm --filter ohmymcp build
pnpm exec biome check packages/cli
```

사용자 commit 권장:

```text
feat(cli): AI 반복 검토 흐름 추가
```

## 15. Task C3: 실제 weather-server와 dist E2E

**모델:** `gpt-5.6-terra`, 추론 `medium`

**Files:**

- Create: `packages/cli/tests/generate-integration.test.ts`
- Modify: `packages/cli/tests/dist-cli-e2e.mjs`
- Test only: existing weather fixtures와 wrapper, 수정 금지

### RED 테스트 이름과 필수 단언

1. `weather-server에서 baseline JSON을 만들고 process를 종료한다`
   - tool case 두 개, get_weather input `{ city: "example" }`, add `{a:0,b:0}`
   - PID가 1초 안에 ESRCH
2. `weather baseline은 실제 test에서 신뢰도 한계를 드러낸다`
   - test exit 1, get_weather failed, add passed
   - stderr 없음
   - report summary는 `total: 2`, `passed: 1`, `failed: 1`, `timedOut: 0`,
     `cancelled: 0`, `notRun: 0`
3. `사용자 지시를 반영한 승인 candidate는 실제 test를 통과한다`
   - fake provider가 get_weather input을 `서울`로 교체한 structured result
   - interactive ReviewIO가 전송·변경·최종 승인을 명시
   - 저장 JSON을 새 `run(["test", ...])`에 전달해 exit 0
   - report summary는 `total: 2`, `passed: 2`, `failed: 0`, `timedOut: 0`,
     `cancelled: 0`, `notRun: 0`
4. `실행할 수 없는 server command는 안전한 Core 오류가 된다`
5. `dist baseline-only generate와 test 실패 경로를 별도 process로 검증한다`
6. `dist 기존 test 성공·실패 E2E를 유지한다`

실제 Codex·Claude는 자동 테스트에서 호출하지 않는다. source integration은 fake provider를 쓰며 실제
MCP server만 직렬 실행한다. 각 테스트는 `mkdtemp`와 고유 PID file을 쓰고 finally에서 해당 PID만
정리한다.

RED:

```bash
pnpm exec vitest run packages/cli/tests/generate-integration.test.ts
pnpm --filter ohmymcp build
pnpm --filter ohmymcp test:e2e
```

GREEN:

```bash
pnpm exec vitest run packages/cli/tests/generate-integration.test.ts packages/cli/tests/cli-integration.test.ts
pnpm --filter ohmymcp build
pnpm --filter ohmymcp test:e2e
pnpm exec vitest run packages/cli/tests
pnpm --filter ohmymcp typecheck
pnpm exec biome check packages/cli
```

사용자 commit 권장:

```text
test(cli): generate 실제 서버와 배포본 E2E 추가
```

## 16. Task C4: CLI 문서, changeset과 전체 검증

**모델:** `gpt-5.6-terra`, 추론 `medium`

**Files:**

- Modify: `packages/cli/README.md`
- Create: `.changeset/cli-ai-authoring.md`
- Test only: 모든 CLI tests와 dist E2E

README는 `--baseline-only`, interactive provider 선택, 요청별 전송 승인, 재호출, diff 선택, 편집 JSON
불러오기, final fingerprint, 기존 `ohmymcp test` 연결과 baseline weather 실패 예시를 문서화한다.

```md
---
"ohmymcp": minor
---

결정론적 baseline과 사용자 Codex·Claude를 이용한 반복 검토를 지원하는 generate 명령을 추가합니다.
```

검증:

```bash
pnpm exec vitest run packages/cli/tests
pnpm --filter ohmymcp typecheck
pnpm --filter ohmymcp build
pnpm --filter ohmymcp test:e2e
pnpm exec biome check packages/cli .changeset/cli-ai-authoring.md
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm changeset status
git diff --check
```

사용자 commit 권장:

```text
docs(cli): AI 보조 generate 사용법과 changeset 추가
```

C4 main review 뒤 읽기 전용 final reviewer가 설계 전체, Generate main 통합 SHA, CLI diff, source 실제
server와 dist E2E, root quality gate를 대조한다. 통과 후 사용자 commit gate에서 멈춘다.

## 17. 실제 Codex·Claude smoke gate

자동 검증과 별도다. 사용자가 실제 호출을 명시적으로 요청한 경우에만 메인 세션이 직렬로 수행한다.

프리플라이트:

```bash
codex --version
codex exec --help
claude --version
claude --help
```

확인할 내용:

- 사용자가 provider, model, 계정 비용 소비를 승인했다.
- 전송 preview에는 `서울을 정상 도시로 사용` instruction, baseline/candidate와 tools만 있다.
- 프로젝트 path, env, MCP 실제 입출력과 source는 없다.
- output path는 새 임시 directory의 새 파일이다.
- 동시에 provider process를 하나만 실행한다.

Codex smoke와 Claude smoke는 각각 새 authoring session으로 실행한다. 한 provider 실패를 다른 provider로
자동 대체하지 않는다. 승인 candidate JSON을 weather-server에 `ohmymcp test`로 실행해 두 cases가
passed인지 확인한다. raw prompt/stdout/stderr, session ID, 인증 정보는 report에 기록하지 않는다.

## 18. 메인 세션 리뷰와 보고 형식

각 task agent의 `READY_FOR_REVIEW`는 완료 증거가 아니다. 메인 세션은 다음을 직접 확인한다.

1. report에 pwd, HEAD, base SHA, RED와 GREEN 명령, 수집 file/test 수, 남은 위험이 있다.
2. agent를 spawn하기 직전에 기록한 task 시작 SHA를 기준으로 `git diff --name-only`를 실행했을 때
   변경이 task 허용 Files 안이다.
3. `git diff --check`가 통과하고 금지 파일 diff가 없다.
4. 테스트 이름과 핵심 단언이 계획과 일치한다.
5. package test가 실제 target을 수집했고 typecheck/build가 실제 package를 검사했다.
6. provider test는 fake process만 쓰며 실제 계정·network를 사용하지 않았다.

리뷰 지적은 같은 agent에 `followup_task`로 보내고 허용 Files를 반복한다. 통과하면 다음 형식으로
사용자에게 보고하고 commit SHA를 기다린다.

```text
Task: G1
상태: 사용자 commit 대기
변경 파일: ...
RED: 명령, 의도한 실패
GREEN: 명령, 수집 file/test 수
금지 파일: 무변경 확인
권장 commit: feat(generate): ...
남은 위험: ...
```

## 19. 사용자 사전 조건

실행 전에 사람은 다음 두 줄만 확인한다.

```text
git log --oneline -1  # 설계, ADR, 계획, ledger가 포함된 문서 커밋인지 확인
git status --short    # 출력이 비어 있는지 확인
```

문서가 untracked인 현재 상태에서는 worktree를 만들지 않는다. 사용자가 문서 커밋을 만든 뒤 실행한다.

## 20. Terminal 1 실행 프롬프트

권장 스폰 설정: `default / gpt-5.6-terra / medium`

```text
AI 보조 테스트 작성 구현의 Generate terminal을 오케스트레이션해라.

[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.
현재 저장소에서 git rev-parse --show-toplevel, git rev-parse --path-format=absolute --git-dir,
git rev-parse --path-format=absolute --git-common-dir, git branch --show-current,
git rev-parse HEAD, git status --short를 기록해라. status가 깨끗하지 않거나
docs/superpowers/specs/2026-08-12-ai-assisted-test-authoring-design.md,
docs/superpowers/plans/2026-08-12-ai-assisted-test-authoring-implementation.md,
docs/adr/0006-ai-assisted-test-authoring.md가 HEAD에 추적돼 있지 않으면 BLOCKED로 끝내라.

git-dir과 git-common-dir가 다르면 이미 연결 worktree이므로 중첩 worktree를 만들지 말고 현재 경로를
generate_worktree로 쓴다. 같으면 branch feat/generate-ai-authoring과 경로
<repo-root>/../OhMyMCP-worktrees/generate-ai-authoring이 모두 없는지 확인한다. 하나라도
있으면 삭제·재사용하지 말고 BLOCKED다. 직전에
ai_generate_base_commit="$(git rev-parse HEAD)"를 실행해 기준 SHA를 기록하고
git worktree add -b feat/generate-ai-authoring
<repo-root>/../OhMyMCP-worktrees/generate-ai-authoring
"$ai_generate_base_commit"을 실행해 그 경로로 이동한다.

진입 뒤 pwd, HEAD==base_commit, branch, 세 문서 존재, clean status를 확인한다.
pnpm install --frozen-lockfile를 실행하고 pnpm exec vitest --version,
pnpm exec tsc --version, pnpm --filter @ohmymcp/generate typecheck가 실제 실행되는지 확인한다. 실패하면
agent를 spawn하지 말고 BLOCKED다.

[2단계: 실행]
계획의 G1부터 G5까지 정확히 순서대로 진행한다. 활성 agent는 한 번에 구현 1명 또는 final reviewer
1명만 둔다. 각 구현 agent는 gpt-5.6-terra, medium, fork_turns none으로 spawn한다. message에는 실제
generate_worktree 절대 경로, task 시작 SHA, 설계·계획 절대 경로, 해당 Task의 Files와 테스트 이름,
RED/GREEN 명령, report 절대 경로 .agents/reports/ai-authoring/<Task>.md를 전부 넣는다.

모든 agent에게 첫 명령으로 pwd와 HEAD를 확인하게 하고 background, commit, merge, push, 하위 agent
spawn과 다른 작업자의 변경 되돌리기를 금지한다. packages/core/src/types.ts, SDK version, 다른 package,
root build config 수정을 금지한다. 테스트를 먼저 작성하고 의도한 RED를 확인한 뒤 구현하게 한다.

G1 agent 허용 Files는 baseline.ts, canonical.ts, generate src/index.ts, baseline/index tests,
generate package.json, pnpm-lock.yaml이다. G2는 authoring-types.ts, redaction.ts,
authoring-session.ts, authoring-session.test.ts, generate src/index.ts다. G3는 authoring-schema.ts,
authoring-request.ts, authoring-request.test.ts, generate src/index.ts다. G4는 provider-process.ts,
providers.ts, provider-process/providers tests, authoring-request.ts, generate src/index.ts다. G5는 Generate
README·description, docs/architecture.md, generate changeset과 검증만 허용한다.

각 agent가 READY_FOR_REVIEW를 반환하면 report, task 시작 SHA 기준 diff, 테스트 수집 수를 직접
확인한다. 지적은 같은 agent에 followup_task로 보낸다. 통과하면 사용자에게 변경 파일, RED, GREEN,
권장 한국어 commit 메시지를 보고하고 멈춘다. 사용자가 SHA를 주면 commit 존재, HEAD 일치, 직전 SHA
조상 여부와 허용 Files를 확인한 뒤 ledger 기록을 사용자 문서 commit으로 요청하고 다음 Task를
시작한다. agent와 메인 세션은 commit·merge·push하지 않는다.

G5까지 사용자 commit이 끝나면 read-only final reviewer 한 명을 gpt-5.6-terra medium으로 실행한다.
설계 §§5~14, package diff, 전체 tests/typecheck/lint/build/changeset을 대조한다. 통과 후 feature branch를
main에 통합할 것을 사용자에게 요청하고 G5 SHA가 main 조상이 되기 전에는 Terminal 2를 시작하지
않는다.

agent 최종 형식은 status: READY_FOR_REVIEW 또는 status: BLOCKED, 변경 파일, RED, GREEN과 수집 수,
report 경로, 남은 위험 순서다.
```

## 21. Terminal 2 실행 프롬프트

권장 스폰 설정: `default / gpt-5.6-terra / medium`

```text
AI 보조 테스트 작성 구현의 CLI terminal을 오케스트레이션해라.

[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.
현재 저장소에서 git rev-parse --show-toplevel, git rev-parse --path-format=absolute --git-dir,
git rev-parse --path-format=absolute --git-common-dir, git branch --show-current,
git rev-parse HEAD, git status --short를 기록해라. status가 깨끗하지 않거나 설계·계획·ADR·ledger가
HEAD에 추적돼 있지 않으면 BLOCKED다.

ledger의 G5 SHA를 읽고 빈 값, commit 부재, 현재 HEAD의 비조상이면 BLOCKED다. 현재 main의 Generate
package root에 createBaselineSuite, createAuthoringSession, prepareAuthoringRequest,
dispatchAuthoringRequest, createCodexAuthoringProvider, createClaudeAuthoringProvider export가 없거나
Generate package tests/typecheck/build가 실패해도 BLOCKED다.

git-dir과 git-common-dir가 다르면 중첩 worktree를 만들지 말고 현재 경로를 cli_worktree로 쓴다.
같으면 branch feat/cli-ai-authoring과 경로
<repo-root>/../OhMyMCP-worktrees/cli-ai-authoring이 모두 없는지 확인한다. 하나라도 있으면
삭제·재사용하지 말고 BLOCKED다. 직전에 ai_cli_base_commit="$(git rev-parse HEAD)"를 실행해 기준
SHA를 기록하고 git worktree add -b feat/cli-ai-authoring
<repo-root>/../OhMyMCP-worktrees/cli-ai-authoring "$ai_cli_base_commit"을 실행해 이동한다.

진입 뒤 pwd, HEAD==base_commit, branch, 문서 존재, clean status를 확인한다.
pnpm install --frozen-lockfile를 실행하고 pnpm build로 fresh Generate dist를 만든 뒤
pnpm exec vitest --version, pnpm exec tsc --version, pnpm --filter ohmymcp typecheck가 실제 실행되는지
확인한다. 실패하면 agent를 spawn하지 말고 BLOCKED다.

[2단계: 실행]
계획의 C1부터 C4까지 정확히 순서대로 진행한다. 활성 agent는 한 번에 구현 1명 또는 final reviewer
1명만 둔다. 모든 agent는 gpt-5.6-terra, medium, fork_turns none이다. message에는 실제 cli_worktree,
task 시작 SHA, 설계·계획 경로, Task Files·테스트 이름·RED/GREEN 명령과 report
.agents/reports/ai-authoring/<Task>.md를 전부 넣는다.

C1 허용 Files는 cli generate-command.ts, generate-command/index tests와 cli src/index.ts다. C2는 같은
generate-command source/test와 production dependency 조립 범위의 index.ts다. C3는
generate-integration.test.ts와 dist-cli-e2e.mjs만이다. C4는 CLI README, CLI changeset과 검증만이다.
examples, fixtures, core, runner, generate, record, mock, root build config는 수정 금지다.

모든 agent에게 background, commit, merge, push, 하위 agent spawn과 다른 작업자의 변경 되돌리기를
금지한다. 테스트를 먼저 작성해 의도한 RED를 확인하게 한다. 실제 Codex·Claude를 unit/integration에서
호출하지 말고 fake provider를 쓴다. 실제 MCP weather-server E2E만 describe.sequential과 고유 temp/PID
정리로 실행한다.

READY_FOR_REVIEW 뒤 메인 세션은 report, 허용 Files diff, 수집 수, fresh dist E2E를 직접 확인한다.
통과하면 사용자 commit gate에서 멈추고 SHA를 검증한 뒤 다음 Task를 시작한다. C4 뒤 read-only final
reviewer로 전체 설계, Generate main 통합 SHA, CLI source/dist E2E와 root gates를 검증한다. 실제
Codex·Claude smoke는 사용자가 별도로 명시하기 전에는 실행하지 않는다.

agent 최종 형식은 status: READY_FOR_REVIEW 또는 status: BLOCKED, 변경 파일, RED, GREEN과 수집 수,
report 경로, 남은 위험 순서다. 메인과 agent는 commit·merge·push하지 않는다.
```

## 22. 네이티브 agent 호출

아래 호출은 §20과 §21의 오케스트레이터가 해당 사용자 commit gate를 통과한 뒤 하나씩만 실행한다.
`generateWorktree`와 `cliWorktree`는 각 프롬프트의 1단계에서 검증한 실제 절대 경로다. 문자열 치환 뒤
변수 이름이나 `${generateWorktree}`, `${cliWorktree}` literal이 message에 남아 있으면 spawn하지 않는다.

### G1 구현

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "generate_baseline",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: [
    "역할: OhMyMCP Generate의 Runner 연동과 결정론적 baseline 구현자.",
    "Worktree: ${generateWorktree}",
    "Report: ${generateWorktree}/.agents/reports/ai-authoring/G1.md",
    "첫 명령으로 pwd와 HEAD를 확인하고 AGENTS.md, 실행 규약, AI authoring 설계, ADR-0006, 구현 계획의 G1을 끝까지 읽는다.",
    "허용 Files: packages/generate/src/baseline.ts, packages/generate/src/canonical.ts, packages/generate/src/index.ts, packages/generate/tests/baseline.test.ts, packages/generate/tests/index.test.ts, packages/generate/package.json, pnpm-lock.yaml, report. 그 밖의 파일은 수정 금지다.",
    "테스트를 먼저 작성한다. tool 순서, suiteId/name 명시, 10000ms timeout, required/example/default/placeholder 우선순위, JSON 직렬화 안전성, stable key sort, SHA-256 fingerprint, 기존 generateTests 호환성을 RED와 GREEN으로 검증한다.",
    "금지: background, commit, merge, push, 하위 agent spawn, frozen Core 타입, SDK version, 다른 package와 root 설정 수정, 다른 변경 되돌리기.",
    "검증: baseline/index focused Vitest, Generate 전체 tests/typecheck/build, Biome. 수집 file/test 수를 기록하고 READY_FOR_REVIEW 또는 BLOCKED로 보고한다.",
  ].join("\n").replaceAll("${generateWorktree}", generateWorktree),
});
```

### G2 구현

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "generate_authoring_state",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: [
    "역할: OhMyMCP authoring 상태, local diff, 선택 적용과 snapshot 구현자.",
    "Worktree: ${generateWorktree}",
    "Report: ${generateWorktree}/.agents/reports/ai-authoring/G2.md",
    "첫 명령으로 pwd와 HEAD를 확인하고 승인된 G1 SHA가 HEAD인지 검증한 뒤 AGENTS.md, 실행 규약, 설계, ADR-0006, 계획 G2를 읽는다.",
    "허용 Files: packages/generate/src/authoring-types.ts, packages/generate/src/redaction.ts, packages/generate/src/authoring-session.ts, packages/generate/src/index.ts, packages/generate/tests/authoring-session.test.ts, report.",
    "테스트를 먼저 작성한다. baseline 불변, approvedDraft/workingCandidate 분리, case ID 기반 add/replace/remove/order diff, 결정론적 change ID와 순서, 선택 적용, revision, 거절 무변경, final fingerprint snapshot을 검증한다.",
    "금지: background, commit, merge, push, 하위 agent spawn, 다른 package·dependency·lockfile·root 설정 수정, 다른 변경 되돌리기.",
    "검증: authoring-session focused와 Generate 전체 tests/typecheck/build/Biome. 수집 수를 기록하고 READY_FOR_REVIEW 또는 BLOCKED로 보고한다.",
  ].join("\n").replaceAll("${generateWorktree}", generateWorktree),
});
```

### G3 구현

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "generate_authoring_request",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: [
    "역할: OhMyMCP AI authoring request/result 검증, redaction과 승인 binding 구현자.",
    "Worktree: ${generateWorktree}",
    "Report: ${generateWorktree}/.agents/reports/ai-authoring/G3.md",
    "첫 명령으로 pwd와 HEAD, 승인된 G2 SHA를 확인하고 AGENTS.md, 실행 규약, 설계, ADR-0006, 계획 G3를 읽는다.",
    "허용 Files: packages/generate/src/authoring-schema.ts, packages/generate/src/authoring-request.ts, packages/generate/src/index.ts, packages/generate/tests/authoring-request.test.ts, packages/generate/tests/authoring-session.test.ts, report.",
    "테스트를 먼저 작성한다. Runner schema clone, compile/revise payload 최소화, secret·path redaction, byte 상한, preview fingerprint 승인, opaque binding, stale 승인 거절, full candidate와 questions 결과 검증, local diff 연결을 검증한다.",
    "금지: background, commit, merge, push, 하위 agent spawn, 실제 provider·network 호출, dependency·lockfile·다른 package·root 설정 수정.",
    "검증: authoring-request/session focused와 Generate 전체 tests/typecheck/build/Biome. 수집 수를 기록하고 READY_FOR_REVIEW 또는 BLOCKED로 보고한다.",
  ].join("\n").replaceAll("${generateWorktree}", generateWorktree),
});
```

### G4 구현

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "generate_providers",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: [
    "역할: OhMyMCP 공통 provider process와 Codex·Claude adapter 구현자.",
    "Worktree: ${generateWorktree}",
    "Report: ${generateWorktree}/.agents/reports/ai-authoring/G4.md",
    "첫 명령으로 pwd와 HEAD, 승인된 G3 SHA를 확인하고 AGENTS.md, 실행 규약, 설계 §§11-14, ADR-0006, 계획 G4를 읽는다.",
    "허용 Files: packages/generate/src/provider-process.ts, packages/generate/src/providers.ts, packages/generate/src/authoring-request.ts, packages/generate/src/index.ts, packages/generate/tests/provider-process.test.ts, packages/generate/tests/providers.test.ts, packages/generate/tests/authoring-request.test.ts, report.",
    "테스트를 먼저 작성한다. fake child만 사용해 stdin, 빈 temp cwd, env allowlist, byte와 UTF-8 경계, timeout/cancel 우선순위, kill 후 1초 SIGKILL과 hard deadline, late event 안정성, Codex·Claude exact argv, structured output, no retry/fallback을 검증한다.",
    "금지: background, commit, merge, push, 하위 agent spawn, 실제 Codex·Claude·network 호출, dependency·lockfile·다른 package·root 설정 수정.",
    "검증: provider focused와 Generate 전체 tests/typecheck/build/Biome. 수집 수를 기록하고 READY_FOR_REVIEW 또는 BLOCKED로 보고한다.",
  ].join("\n").replaceAll("${generateWorktree}", generateWorktree),
});
```

### G5 문서와 검증

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "generate_authoring_docs",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: [
    "역할: OhMyMCP Generate AI authoring 문서, changeset과 전체 검증 담당자.",
    "Worktree: ${generateWorktree}",
    "Report: ${generateWorktree}/.agents/reports/ai-authoring/G5.md",
    "첫 명령으로 pwd와 HEAD, 승인된 G4 SHA를 확인하고 AGENTS.md, 실행 규약, 설계, ADR-0006, 계획 G5와 실제 export를 읽는다.",
    "허용 Files: packages/generate/README.md, packages/generate/package.json의 description, docs/architecture.md의 Generate 설명, .changeset/generate-ai-authoring.md, report. source/test/dependency/lockfile 수정은 금지다.",
    "README에는 baseline, session, 승인 binding, provider opt-in과 CLI 경계를 실제 API와 일치하게 쓰고 Generate minor changeset을 한국어로 작성한다.",
    "금지: background, commit, merge, push, 하위 agent spawn, 다른 package와 root 설정 수정, 다른 변경 되돌리기.",
    "검증: Generate tests/typecheck/build/Biome, root test/typecheck/lint/build, changeset status와 diff check. 실제 수집 수를 기록하고 READY_FOR_REVIEW 또는 BLOCKED로 보고한다.",
  ].join("\n").replaceAll("${generateWorktree}", generateWorktree),
});
```

### Generate 최종 읽기 전용 리뷰

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "generate_authoring_final_review",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: [
    "역할: OhMyMCP Generate AI authoring 최종 읽기 전용 reviewer.",
    "Worktree: ${generateWorktree}",
    "Report: ${generateWorktree}/.agents/reports/ai-authoring/generate-final.md",
    "첫 명령으로 pwd와 HEAD를 확인하고 G1-G5와 ledger SHA가 모두 조상인지 검증한다. AGENTS.md, 실행 규약, 설계 §§5-14, ADR-0006, 계획과 package diff를 읽는다.",
    "파일 수정, background, commit, merge, push, 하위 agent spawn은 금지다. baseline 불변성, diff 결정론성, 승인 binding, redaction, provider lifecycle, package 경계와 passing gates를 심각도순으로 검토한다.",
    "필요한 읽기 전용 검증을 실행하고 READY_FOR_REVIEW 또는 BLOCKED, 발견 사항, 명령과 수집 수, report 경로 순서로 보고한다.",
  ].join("\n").replaceAll("${generateWorktree}", generateWorktree),
});
```

### C1 구현

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "cli_generate_baseline",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: [
    "역할: OhMyMCP CLI generate parser, baseline-only와 atomic JSON save 구현자.",
    "Worktree: ${cliWorktree}",
    "Report: ${cliWorktree}/.agents/reports/ai-authoring/C1.md",
    "첫 명령으로 pwd와 HEAD를 확인하고 G5 통합 SHA가 조상인지 검증한 뒤 AGENTS.md, 실행 규약, 설계, ADR-0006, 계획 C1을 읽는다.",
    "허용 Files: packages/cli/src/generate-command.ts, packages/cli/src/index.ts, packages/cli/tests/generate-command.test.ts, packages/cli/tests/index.test.ts, report.",
    "테스트를 먼저 작성한다. strict argv, 반복 arg 순서, model/provider 규칙, baseline-only 비대화형 승인, Core close, 기존 out 보호, 고정 sibling temp와 validate-fsync-rename-cleanup atomic save, JSON LF를 검증한다.",
    "금지: background, commit, merge, push, 하위 agent spawn, generate/core/runner/fixtures/examples/root 설정 수정, 새 dependency, 다른 변경 되돌리기.",
    "검증: generate-command/index focused와 CLI 전체 tests/typecheck/build/Biome. 수집 수를 기록하고 READY_FOR_REVIEW 또는 BLOCKED로 보고한다.",
  ].join("\n").replaceAll("${cliWorktree}", cliWorktree),
});
```

### C2 구현

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "cli_generate_review",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: [
    "역할: OhMyMCP CLI 대화형 AI 반복 검토 구현자.",
    "Worktree: ${cliWorktree}",
    "Report: ${cliWorktree}/.agents/reports/ai-authoring/C2.md",
    "첫 명령으로 pwd와 HEAD, 승인된 C1 SHA를 확인하고 AGENTS.md, 실행 규약, 설계 §§7-15, ADR-0006, 계획 C2를 읽는다.",
    "허용 Files: packages/cli/src/generate-command.ts, packages/cli/src/index.ts의 production dependency 조립, packages/cli/tests/generate-command.test.ts, packages/cli/tests/index.test.ts, report.",
    "테스트를 먼저 작성한다. TTY gate, provider/model 선택, unavailable no fallback, 요청별 preview 승인, diff 전체·선택 적용, stateless 재호출, questions, JSON 불러오기, reject/cancel, final fingerprint 승인 뒤에만 save를 검증한다.",
    "금지: background, commit, merge, push, 하위 agent spawn, editor process 실행, 실제 provider·network 호출, 다른 package·dependency·lockfile·root 설정 수정.",
    "검증: CLI focused와 전체 tests/typecheck/build/Biome. fake provider만 쓰고 수집 수를 기록해 READY_FOR_REVIEW 또는 BLOCKED로 보고한다.",
  ].join("\n").replaceAll("${cliWorktree}", cliWorktree),
});
```

### C3 구현

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "cli_generate_e2e",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: [
    "역할: OhMyMCP CLI generate 실제 weather-server와 dist E2E 구현자.",
    "Worktree: ${cliWorktree}",
    "Report: ${cliWorktree}/.agents/reports/ai-authoring/C3.md",
    "첫 명령으로 pwd와 HEAD, 승인된 C2 SHA를 확인하고 AGENTS.md, 실행 규약, 설계, ADR-0006, 계획 C3와 weather fixture를 읽는다.",
    "허용 Files: packages/cli/tests/generate-integration.test.ts, packages/cli/tests/dist-cli-e2e.mjs, report. production source와 fixture 수정은 금지다.",
    "테스트를 먼저 작성한다. baseline은 add passed/get_weather failed와 정확한 2/1/1/0/0/0 summary, 서울 승인본은 2/2/0/0/0/0 summary, PID 종료, 실행 불가 command, dist generate/test 실패 경로와 기존 E2E를 검증한다.",
    "금지: background, commit, merge, push, 하위 agent spawn, 실제 Codex·Claude 호출, 다른 package·examples·fixtures·root 설정 수정. 실제 MCP tests는 직렬이며 고유 temp/PID만 정리한다.",
    "검증: generate integration, CLI integration, fresh CLI build와 dist E2E, CLI 전체 tests/typecheck/Biome. 수집 수와 process 정리를 기록해 READY_FOR_REVIEW 또는 BLOCKED로 보고한다.",
  ].join("\n").replaceAll("${cliWorktree}", cliWorktree),
});
```

### C4 문서와 검증

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "cli_generate_docs",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: [
    "역할: OhMyMCP CLI AI generate 문서, changeset과 전체 검증 담당자.",
    "Worktree: ${cliWorktree}",
    "Report: ${cliWorktree}/.agents/reports/ai-authoring/C4.md",
    "첫 명령으로 pwd와 HEAD, 승인된 C3 SHA를 확인하고 AGENTS.md, 실행 규약, 설계, ADR-0006, 계획 C4와 실제 CLI usage를 읽는다.",
    "허용 Files: packages/cli/README.md, .changeset/cli-ai-authoring.md, report. source/test/dependency/lockfile와 다른 package 수정은 금지다.",
    "README에 baseline-only, provider 선택, 매회 전송 승인, 재호출, diff 선택, 편집 JSON 불러오기, final fingerprint와 test 연결을 실제 동작과 일치하게 쓰고 CLI minor changeset을 한국어로 작성한다.",
    "금지: background, commit, merge, push, 하위 agent spawn, repository-wide write format, 다른 변경 되돌리기.",
    "검증: CLI tests/typecheck/build/dist E2E/Biome, root test/typecheck/lint/build, changeset status와 diff check. 수집 수를 기록해 READY_FOR_REVIEW 또는 BLOCKED로 보고한다.",
  ].join("\n").replaceAll("${cliWorktree}", cliWorktree),
});
```

### CLI 최종 읽기 전용 리뷰

권장 스폰 설정: `default / gpt-5.6-terra / medium`.

```js
await spawn_agent({
  task_name: "cli_generate_final_review",
  fork_turns: "none",
  model: "gpt-5.6-terra",
  reasoning_effort: "medium",
  message: [
    "역할: OhMyMCP AI 보조 test authoring 전체 최종 읽기 전용 reviewer.",
    "Worktree: ${cliWorktree}",
    "Report: ${cliWorktree}/.agents/reports/ai-authoring/cli-final.md",
    "첫 명령으로 pwd와 HEAD를 확인하고 Generate G5 통합 SHA, C1-C4와 ledger SHA가 모두 조상인지 검증한다. AGENTS.md, 실행 규약, 설계, ADR-0006, 계획, Generate와 CLI diff를 읽는다.",
    "파일 수정, background, commit, merge, push, 하위 agent spawn과 실제 provider 호출은 금지다. 승인 경계, non-TTY 안전성, atomic save, process cleanup, fake-provider source E2E, fresh dist E2E, 문서 일치를 심각도순으로 검토한다.",
    "필요한 읽기 전용 gates를 실행하고 READY_FOR_REVIEW 또는 BLOCKED, 발견 사항, 명령과 수집 수, report 경로 순서로 보고한다.",
  ].join("\n").replaceAll("${cliWorktree}", cliWorktree),
});
```

## 23. 자체 검토 체크리스트

- [x] baseline과 AI working candidate가 다른 상태로 유지된다.
- [x] 검토 중 AI 재호출이 stateless 새 request와 매회 승인으로 대응된다.
- [x] provider full candidate를 로컬 diff로 바꾸고 선택 적용한다.
- [x] Generate와 CLI 쓰기 파일이 같은 task나 terminal에서 겹치지 않는다.
- [x] `generate → runner` workspace dependency가 선행 G1에 있다.
- [x] 공유·동결 Core 타입과 SDK version은 수정 금지다.
- [x] provider process lifecycle, byte limit, UTF-8, timeout·cancel 단언이 G4에 전량 있다.
- [x] weather baseline 실패와 승인 candidate 통과를 둘 다 C3가 검증한다.
- [x] 실제 provider smoke는 자동 E2E와 분리되고 사용자 승인 뒤 직렬 실행된다.
- [x] 각 task에 모델, Files, RED, GREEN, 사용자 commit gate가 있다.
- [x] 두 terminal prompt에 worktree 판별·부트스트랩·agent 금지사항·최종 reviewer가 있다.
- [x] 각 구현과 최종 reviewer의 네이티브 `spawn_agent` 호출, 모델, 추론, 독립 message가 있다.
- [x] 구현 agent의 완료 선언 대신 report·diff·수집 수를 메인 세션이 직접 확인한다.
