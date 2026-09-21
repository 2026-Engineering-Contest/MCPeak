# T2 · `@mcpeak/generate` — `runProviderProcess` · provider 별 env 목록 공개 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@mcpeak/generate` 가 두 가지를 공개 면에 연다 — ① `runProviderProcess`(프로세스 기계: 임시 cwd · 타임아웃 · 출력 상한 · bounded 종료), ② **provider 별 환경변수 목록 둘**(`CLAUDE_ENV_ALLOWLIST` · `CODEX_ENV_ALLOWLIST`). T3 대시보드가 `claude` 를 띄울 때 **Anthropic 자격증명만** 넘기게 하는 것이 ②의 목적이다. MCP 를 여는 argv 는 `generate` 에 두지 않는다.

**Architecture:** 코드 변경은 `packages/generate/src/index.ts` 의 **재수출 두 곳**이 전부다. 타입 7 개(`ProviderProcessSpec` · `ProviderProcessDeps` · `ProviderProcessChild` · `ProviderProcessResult` · `ProviderFailureClassification` · `AuthoringProviderFailureCode` · `AuthoringProviderFailureReason`)는 이미 `index.ts` 가 `export type` 으로 내보내고 있고, 값으로 나가는 것이 없어서 부르는 쪽이 함수를 잡을 수 없는 상태다. 그 값을 열고, `providers.js` 재수출 블록에 목록 둘을 더한다. **새 타입 0 개 · 새 의존 0 개 · 동작 변경 0 건.** 나머지는 그 판단을 남기는 ADR 과 발행 준비다.

**왜 목록까지 여는가 (설계 §5 표가 틀렸다):** 설계 §5 는 "임시 cwd · env allowlist · 타임아웃 · 출력 상한 · 실패 분류 → `runProviderProcess` 가 똑같이 그것" 이라고 적었지만 **사실이 아니다.** 환경변수 필터링은 `providers.ts:285` 의 비공개 함수 `environment()` 가 하고, `runProviderProcess` 는 `spec.env` 를 **그대로** spawn 에 넘긴다(`provider-process.ts:155`). 그래서 ①만 열면 T3 는 env 를 스스로 정해야 하는데, 공개된 목록이 **합집합** `PROVIDER_ENV_ALLOWLIST` 하나뿐이라 그것을 쓰면 `claude` 자식이 `OPENAI_API_KEY` 까지 받는다. `providers.ts:26-29` 의 주석이 바로 그것을 금한다 — "codex 자식이 Anthropic 자격증명을, claude 자식이 OpenAI 자격증명을 받을 이유가 없다." **반쪽 둘을 같이 여는 이유는 합집합만 공개된 지금 상태가 잘못 쓰기 쉬운 모양이기 때문이다.**

**Tech Stack:** TypeScript (ESM 소스, tsdown 0.22.14 로 esm+cjs dual 빌드) · vitest · Node ≥ 22.18.0 · changesets

## Global Constraints

- **패키지는 `packages/generate` 하나만 건드린다.** `mock`(T1, 끝남) · `dashboard`(T3) 는 이 계획서 범위 밖이다. `packages/dashboard` 의 파일을 열지 마라.
- **`packages/generate` 는 다른 오너(@sunghoon0303)의 패키지다.** 수정 허락은 받아 뒀다(`2026-09-20-dashboard-relay-handoff.md` §5, 사용자 확인). **허락은 이 계획서에 적힌 범위까지다** — 여기 없는 것을 고쳐야 할 것 같으면 멈추고 사용자에게 알린다.
- **`core/src/types.ts` 의 `McpClient` · `ToolResult` 를 바꾸지 않는다.**
- **의존성을 추가하지 않는다.** 이 계획은 import 를 한 줄도 새로 들이지 않는다.
- **`providers.ts` 의 구현을 고치지 않는다.** 목록 둘은 **이미 `export const`** 다(`providers.ts:30`·`37`). `index.ts` 에서 재수출만 한다. 목록의 **내용을 바꾸지 마라** — 어느 키를 넣고 뺄지는 이 계획의 범위가 아니다.
- **`environment()` 헬퍼를 공개하지 않는다.** 3 줄짜리 필터라 부르는 쪽이 써도 갈라질 것이 없다. 위험한 것은 필터가 아니라 **목록**이고, 그것만 단일 출처로 둔다.
- **`@modelcontextprotocol/sdk` 버전을 건드리지 않는다.**
- **`provider-process.ts` 의 구현을 고치지 않는다.** 이 계획은 그 파일을 **읽기만** 한다. 시그니처·동작·주석 어느 것도 바꾸지 않는다 — 바꾸면 `generate` 의 authoring 경로와 `repair` 의 진단 경로가 같이 흔들린다.
- **`--mcp-config` · `--allowedTools` 를 만드는 코드를 `packages/generate` 에 넣지 않는다.** 그것이 이 태스크의 ADR 이 지키려는 바로 그 경계다. 그 argv 는 T3 에서 `packages/dashboard` 에만 생긴다.
- **커밋·푸시는 사람이 한다.** 각 태스크 끝에서 변경 파일과 권장 커밋 메시지만 제시하고 멈춘다. `git commit` · `git add` · `git stash` · `git checkout` · `git restore` 를 실행하지 않는다.
- **커밋 scope:** Task 1 은 `generate`, Task 2 는 `adr`, Task 3 은 `release`. Conventional Commits, scope 필수.
- **결정론성:** 새로 넣는 것이 한 줄짜리 정적 재수출이라 런타임 분기가 없다. 그 성질을 깨는 것(조건부 export, 동적 import)을 넣지 마라.
- **`packages/mock/tests/stdio-e2e.test.ts` 는 미커밋 상태이고 사용자 것이다. 커밋 범위에 절대 넣지 마라.**

## 이미 닫힌 실측

계획 단계에서 실제로 재서 닫았다. 아래는 추측이 아니라 이 저장소에서 확인한 값이다.

| 무엇 | 결과 |
|---|---|
| `runProviderProcess` 가 `index.ts` 에서 나가고 있나 | **안 나간다.** `index.ts` 는 `provider-process.js` 에서 **타입만** 가져온다(`export type { … } from "./provider-process.js"`). 값 재수출이 없다 |
| 어떤 타입이 이미 나가 있나 | `AuthoringProviderFailureCode` · `AuthoringProviderFailureReason` · `ProviderFailureClassification` · `ProviderProcessChild` · `ProviderProcessDeps` · `ProviderProcessResult` · `ProviderProcessSpec` — **7 개**(설계 §4 의 "타입 5 개" 는 어림수다) |
| `ProviderProcessClock` 은 나가 있나 | **안 나가 있다.** `ProviderProcessDeps.clock?` 이 참조하는 타입인데 `index.ts` 에 없다. **그래도 이 계획은 열지 않는다** — 선택 필드라 부르는 쪽이 `clock: { setTimeout: … }` 로 구조적으로 채울 수 있고, `deps.clock ?? defaultClock`(`provider-process.ts:175`)이라 생략해도 돈다. 설계가 "새 타입 0 개" 라고 못박은 것을 지킨다 |
| `dashboard` 가 `@mcpeak/generate` 를 이미 의존하나 | **한다.** `packages/dashboard/package.json:50` 에 `"@mcpeak/generate": "workspace:*"`. 즉 T3 는 의존 선언을 바꿀 필요가 없고, `dashboard` 의 의존 경계 테스트도 이 변경으로 흔들리지 않는다 |
| 없는 export 를 import 하면 vitest 가 어떻게 실패하나 | **모듈 해석 오류가 아니라 `undefined` 다.** 실제 출력: `AssertionError: expected undefined to be [AsyncFunction runProviderProcess]`. (vite 가 TS 소스를 변환하며 없는 이름을 `undefined` 로 준다) |
| ADR 다음 번호 | **0104.** 로컬 최대가 `0103`(ADR-B, T1 에서 씀)이고, `origin/main` 이 앞선 2 커밋은 `Version Packages` 와 그 머지뿐이라 **ADR 을 추가하지 않는다**(`git log --name-only HEAD..origin/main` 확인). 번호 충돌 없음 |
| `generate` 현재 버전 | `0.8.0` |
| env allowlist 를 누가 적용하나 | **`runProviderProcess` 가 아니다.** `providers.ts:272` 가 provider 별 목록을 고르고 `:285` 가 `environment(options.environment, allowlist)` 로 거른다. `runProviderProcess` 는 `spec.env` 를 그대로 spawn 에 넘긴다(`provider-process.ts:155`) |
| 목록 셋의 내용 | `CLAUDE_ENV_ALLOWLIST` = PATH·HOME·USER·SHELL + `ANTHROPIC_API_KEY`·`CLAUDE_CODE_OAUTH_TOKEN` / `CODEX_ENV_ALLOWLIST` = 공통 4 + `CODEX_HOME`·`OPENAI_API_KEY`·`OPENAI_ORG_ID`·`OPENAI_PROJECT_ID` / `PROVIDER_ENV_ALLOWLIST` = **둘의 합집합** |
| 공개된 것은 무엇인가 | **합집합뿐이다.** `index.ts:146` 이 `PROVIDER_ENV_ALLOWLIST` 만 내보낸다. 반쪽 둘은 `providers.ts` 에서 `export const` 지만 `index.ts` 를 안 지난다 |
| 실패 분류기는 공개돼 있나 | **아니다.** `classifyClaudeFailure` 는 `providers.ts:162` 의 비공개 함수이고, `runProviderProcess` 는 `spec.classifyFailure` 로 **주입받는다**(`provider-process.ts:82`). T3 는 그것 없이 돌 수 있다 — 4 단계는 "툴을 불렀나" 를 중계기 기록으로 판정하므로 분류기가 없어도 화면이 성립한다. **이 계획은 분류기를 열지 않는다** |

**설계 §5 의 실측 둘은 이 계획서 범위 밖이다.** 첫째(`relayBinPath()` 의 dual 빌드)는 T1 에서 닫혔고, 둘째(`--tools ""` 를 유지할 수 있나)는 **대시보드의 argv 조립에 걸린 것**이다. `packages/generate` 에는 그 코드가 없다 — `providers.ts:322` 의 `--tools ""` 는 MCP 를 닫아 둔 저자 경로의 것이고 이 계획은 그 줄을 건드리지 않는다. **T3 계획서에서 닫는다.**

## File Structure

| 파일 | 무엇을 맡는가 | 이 계획에서 |
|---|---|---|
| `packages/generate/src/index.ts` | `generate` 의 공개 면 전부 | **수정**: `runProviderProcess` 재수출 + `providers.js` 블록에 목록 둘 |
| `packages/generate/src/provider-process.ts` | 프로세스 기계 본체 — 임시 cwd · 타임아웃 · 출력 상한 · bounded 종료. **env 필터와 실패 분류는 여기 없다** | **읽기만.** 한 글자도 바꾸지 않는다 |
| `packages/generate/src/providers.ts` | provider 어댑터 — env 목록 셋 · `environment()` 필터 · 실패 분류기 · argv | **읽기만.** 목록은 이미 `export const` 라 고칠 것이 없다 |
| `packages/generate/tests/index.test.ts` | 공개 면 계약 테스트 (`canonical 재수출` describe 가 이미 같은 모양을 잡고 있다) | **수정**: `provider-process 재수출` describe 추가 |
| `docs/adr/0104-합성-경로는-MCP-를-닫아-두고-실제-응답-경로에서만-연다.md` | ADR-A | **신규** |
| `docs/adr/README.md` | ADR 색인표 | **수정**: 줄 하나 추가 (115 행 뒤) |
| `.changeset/generate-run-provider-process-export.md` | 발행 준비 | **신규** |

테스트를 `index.test.ts` 에 두는 이유: 이 태스크가 고정하려는 것은 `runProviderProcess` 의 **동작**(그건 `provider-process.test.ts` 가 이미 잡는다)이 아니라 **공개 면에 나가 있다는 사실**이다. 같은 파일의 `canonical 재수출` describe 가 "재수출한 것이 같은 함수 참조다" 를 잡는 선례다.

---

### Task 1: `runProviderProcess` 와 provider 별 env 목록을 공개 면에 연다

**Files:**
- Modify: `packages/generate/src/index.ts` — 두 곳. ① `export type { … } from "./provider-process.js";` 블록 바로 뒤 ② 그 아래 `providers.js` 재수출 블록 안
- Test: `packages/generate/tests/index.test.ts`

**Interfaces:**
- Consumes: `packages/generate/src/provider-process.ts` 의 `runProviderProcess` — 이미 존재한다. 시그니처는
  ```ts
  export async function runProviderProcess(
    spec: ProviderProcessSpec,
    supplied?: ProviderProcessDeps,
  ): Promise<ProviderProcessResult>;
  ```
- Consumes: `packages/generate/src/providers.ts` 의 `CLAUDE_ENV_ALLOWLIST`(`:37`) · `CODEX_ENV_ALLOWLIST`(`:30`) — 이미 `export const` 다. 타입은 `readonly string[]` 로 추론된다.
- Produces: T3(`packages/dashboard`)가 쓸 공개 심볼.
  ```ts
  import {
    CLAUDE_ENV_ALLOWLIST,        // claude 를 띄울 때 이것만 쓴다
    runProviderProcess,
    type ProviderProcessChild,   // 가짜 자식 프로세스를 만들 때
    type ProviderProcessDeps,    // E2E 에서 AI 를 가짜로 바꿀 때 (테스트 12)
    type ProviderProcessResult,
    type ProviderProcessSpec,
  } from "@mcpeak/generate";
  ```
  T3 가 env 를 만드는 모양은 이렇다. 필터는 3 줄이라 베껴 써도 갈라질 것이 없다 — **목록만 단일 출처면 된다.**
  ```ts
  env: Object.fromEntries(
    CLAUDE_ENV_ALLOWLIST.flatMap((key) =>
      process.env[key] === undefined ? [] : [[key, process.env[key]]]),
  )
  ```
  **`PROVIDER_ENV_ALLOWLIST`(합집합)를 쓰지 마라.** `claude` 자식이 `OPENAI_API_KEY` 까지 받는다.

  `ProviderProcessDeps.clock` 은 선택 필드다. 채우려면 타입 이름 없이 구조로 적는다 — `clock: { setTimeout: (cb, ms) => ({ unref() {}, cancel() {} }) }`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/generate/tests/index.test.ts` 의 **맨 아래에** 아래 describe 를 붙인다.

```ts
describe("provider-process 재수출", () => {
  // 4 단계 「실제 응답」의 대시보드가 이 함수로 AI 프로세스를 띄운다. 공개 면에서 빠지면
  // 부르는 쪽이 임시 cwd·env allowlist·타임아웃·출력 상한을 자기 손으로 다시 만들게 된다.
  // 그 사본이 갈라지는 것을 막는 것이 ADR-0104 다.
  it("index 가 내보내는 runProviderProcess 가 provider-process 의 그 함수다", () => {
    expect(runProviderProcess).toBe(directRunProviderProcess);
  });
});

describe("provider 별 env 목록 재수출", () => {
  // 공개된 것이 합집합뿐이면 대시보드가 그것을 쓰고, claude 자식이 OPENAI_API_KEY 를 받는다.
  // providers.ts 의 주석이 금하는 바로 그것이다(ADR-0104).
  it("claude 목록에 OpenAI 자격증명이 없다", () => {
    expect(CLAUDE_ENV_ALLOWLIST).toEqual([
      "PATH",
      "HOME",
      "USER",
      "SHELL",
      "ANTHROPIC_API_KEY",
      "CLAUDE_CODE_OAUTH_TOKEN",
    ]);
  });

  it("codex 목록에 Anthropic 자격증명이 없다", () => {
    expect(CODEX_ENV_ALLOWLIST).toEqual([
      "PATH",
      "HOME",
      "USER",
      "SHELL",
      "CODEX_HOME",
      "OPENAI_API_KEY",
      "OPENAI_ORG_ID",
      "OPENAI_PROJECT_ID",
    ]);
  });

  // 합집합은 계속 나간다(기존 소비자가 있다). 다만 그것이 두 목록의 합이라는 사실을 고정해서,
  // 누가 한쪽에만 키를 더하고 다른 쪽을 잊는 것을 막는다.
  it("합집합이 두 목록을 모두 덮는다", () => {
    for (const key of [...CLAUDE_ENV_ALLOWLIST, ...CODEX_ENV_ALLOWLIST])
      expect(PROVIDER_ENV_ALLOWLIST).toContain(key);
  });
});
```

그리고 파일 **맨 위의 import 블록을 아래 최종 형태로** 만든다. biome 이 정렬을 강제하므로 줄을 아무 데나 붙이면 `biome check` 가 옮긴다. 아래는 `biome check --write --stdin-file-path` 로 확인한 최종 순서다.

```ts
import { deepFreeze } from "../src/canonical.js";
import { assertConstraints } from "../src/constraints.js";
import {
  canonicalJson,
  CLAUDE_ENV_ALLOWLIST,
  CODEX_ENV_ALLOWLIST,
  createBaselineSuite,
  GenerateTestsError,
  generateTests,
  PROVIDER_ENV_ALLOWLIST,
  runProviderProcess,
  sha256,
} from "../src/index.js";
import { runProviderProcess as directRunProviderProcess } from "../src/provider-process.js";
import { validateSchema } from "../src/schema.js";
```

바뀌는 것은 두 곳뿐이다 — named 목록에 네 이름(`CLAUDE_ENV_ALLOWLIST` · `CODEX_ENV_ALLOWLIST` · `PROVIDER_ENV_ALLOWLIST` · `runProviderProcess`), 그리고 `provider-process.js` 에서 별칭으로 가져오는 줄 하나. **대문자 상수가 소문자보다 앞에 온다** — biome 의 정렬이 그렇다.

- [ ] **Step 2: 돌려서 실패를 본다**

```bash
cd /Users/cheonjamin/projects/mcptest
pnpm vitest run --root . packages/generate/tests/index.test.ts -t "재수출"
```

Expected: **`provider-process 재수출` 과 `provider 별 env 목록 재수출` 의 테스트가 FAIL.** `runProviderProcess` 쪽 문구는 실측한 그대로다.

```
AssertionError: expected undefined to be [AsyncFunction runProviderProcess] // Object.is equality
```

env 목록 쪽은 `expected undefined to deeply equal [ 'PATH', 'HOME', … ]` 모양이다. **`합집합이 두 목록을 모두 덮는다` 도 같이 실패한다** — `CLAUDE_ENV_ALLOWLIST` 가 `undefined` 라 전개에서 던진다. 셋 다 Step 3 뒤에 통과해야 한다.

**이 시점에 타입체크를 돌리면 같이 실패한다** — `TS2724: '"../src/index.js"' has no exported member named 'runProviderProcess'`. TDD 의 빨강이므로 정상이다. Step 3 뒤에 사라져야 한다.

> **종료 코드를 파이프 뒤에서 읽지 마라.** `| tail` 을 붙이면 `$?` 는 `tail` 의 값이라 항상 0 이다(`CLAUDE.local.md` §2). 판정은 **출력의 `Test Files … failed` 줄**로 한다.

- [ ] **Step 3: 최소 구현 — 재수출 두 곳**

`packages/generate/src/index.ts` 에서 `export type { … } from "./provider-process.js";` 블록을 찾는다.

```ts
export type {
  AuthoringProviderFailureCode,
  AuthoringProviderFailureReason,
  ProviderFailureClassification,
  ProviderProcessChild,
  ProviderProcessDeps,
  ProviderProcessResult,
  ProviderProcessSpec,
} from "./provider-process.js";
```

**①** 그 블록 **바로 뒤에** 아래를 넣는다. 주석을 같이 넣는다 — 다음 사람이 여기에 MCP 를 여는 도구를 더하려 할 때 읽을 자리가 이 줄이다.

```ts
/**
 * 프로바이더 프로세스 기계. 임시 cwd · 타임아웃 · 출력 상한 · bounded 종료를 한 곳에 둔다.
 * 4 단계 「실제 응답」의 대시보드가 같은 기계로 AI 를 띄우려고 공개한다.
 *
 * **환경변수를 거르지 않는다.** `spec.env` 를 그대로 자식에게 넘긴다. 무엇을 넘길지는 부르는
 * 쪽이 정하고, provider 별 목록(`CLAUDE_ENV_ALLOWLIST` · `CODEX_ENV_ALLOWLIST`)이 그 단일
 * 출처다. 실패 분류도 `spec.classifyFailure` 로 주입받는다.
 *
 * **MCP 를 여는 argv(`--mcp-config` · `--allowedTools`)는 여기에 두지 않는다**(ADR-0104).
 * 합성 경로의 AI 는 저자이고 그 산출물이 승인 게이트를 지나므로 MCP 를 닫아 둔다
 * (ADR-0006 이 세우고 ADR-0079 가 현재 argv 로 유지한다). 이 함수는 프로세스만 다룬다.
 */
export { runProviderProcess } from "./provider-process.js";
```

**②** 아래쪽 `providers.js` 재수출 블록을 찾아서 목록 둘을 더한다. 알파벳 순서를 지킨다.

```ts
// 바꾸기 전
export {
  createClaudeAuthoringProvider,
  createClaudeProvider,
  createCodexAuthoringProvider,
  createCodexProvider,
  PROVIDER_ENV_ALLOWLIST,
} from "./providers.js";
```

```ts
// 바꾼 뒤
export {
  CLAUDE_ENV_ALLOWLIST,
  CODEX_ENV_ALLOWLIST,
  createClaudeAuthoringProvider,
  createClaudeProvider,
  createCodexAuthoringProvider,
  createCodexProvider,
  PROVIDER_ENV_ALLOWLIST,
} from "./providers.js";
```

목록에 주석을 달지 않는다 — `providers.ts:26-29` 에 이미 이유가 적혀 있고, 두 벌이 되면 갈라진다.

**이 둘 말고는 아무것도 바꾸지 않는다.** `provider-process.ts` 나 `providers.ts` 를 열어 고치고 싶은 것이 보여도 이 태스크의 범위가 아니다. **목록의 내용(어느 키가 들어가나)은 절대 건드리지 마라.**

- [ ] **Step 4: 돌려서 통과를 본다**

```bash
cd /Users/cheonjamin/projects/mcptest
pnpm vitest run --root . packages/generate/tests/index.test.ts
```

Expected: 출력에 `Test Files  1 passed (1)` 줄이 있고 `failed` 가 없다. **초록색만 보고 넘어가지 마라 — 그 줄을 눈으로 확인한다.**

- [ ] **Step 5: 되돌려서 그 테스트가 실패하는지 본다**

통과만 보면 아무것도 검증하지 않는 테스트가 섞여 들어온다(`CLAUDE.local.md` §2). **git 쓰기 명령을 쓰지 말고 스크래치패드 복사로 한다.**

```bash
cd /Users/cheonjamin/projects/mcptest
BAK=$(mktemp -d)/index.ts.bak            # 변수를 반드시 먼저 만든다
cp packages/generate/src/index.ts "$BAK"
echo "백업: $BAK"                          # 경로를 눈으로 확인하고 다음으로 간다
# 손으로 Step 3 의 export 줄(주석 포함)을 지운다
pnpm vitest run --root . packages/generate/tests/index.test.ts -t "provider-process 재수출"
# → 첫 테스트가 FAIL 해야 한다: expected undefined to be [AsyncFunction runProviderProcess]
cp "$BAK" packages/generate/src/index.ts
git diff --stat packages/generate/src/index.ts   # 되돌아왔는지 눈으로 본다
```

**`$SCRATCHPAD` 같은 미정의 변수를 쓰지 마라** — 비어 있으면 `/index.ts.bak` 로 루트를 가리킨다. 위처럼 `mktemp -d` 로 만들고 경로를 찍어 확인한다. **복구를 빠뜨리면 구현이 날아갔는데 로컬은 초록으로 보인다.**

- [ ] **Step 6: 패키지 게이트를 돌린다**

```bash
cd /Users/cheonjamin/projects/mcptest
pnpm vitest run --root . packages/generate
pnpm --filter @mcpeak/generate typecheck
pnpm biome check packages/generate
```

Expected:
- vitest: `Test Files … passed` 줄이 있고 `failed` 가 없다. **실행된 파일 수가 24 개 이상**인지 본다 — 한두 개만 돌았으면 경로를 잘못 짚은 것이다.
- typecheck: 출력 없음, 종료 코드 0. 파이프 없이 읽는다 — `pnpm --filter @mcpeak/generate typecheck >/dev/null 2>&1; echo $?`
  **`tsc --noEmit` 은 검사 파일 수를 찍지 않는다.** 초록이 "검사 대상에서 빠졌다" 를 가리는지 따로 본다 —
  `./node_modules/.bin/tsc -p packages/generate/tsconfig.json --noEmit --listFilesOnly | grep -c "packages/generate/"` 로 세고,
  그 수에 `tests/index.test.ts` 가 포함되는지 `--listFilesOnly | grep "tests/index.test.ts"` 로 확인한다.
- biome: `Checked N files` 줄의 **N 을 눈으로 본다.** 0 이면 아무것도 검사하지 않은 것이다.

- [ ] **Step 7: `dist` 에 실제로 실렸는지 확인한다**

T3 대시보드는 `@mcpeak/generate` 를 **`dist` 로** 집는다(`package.json` 의 `exports` 가 `./dist/index.mjs`·`./dist/index.cjs`). 소스에만 있고 산출물에 없으면 T3 가 빌드에서 깨진다. **turbo 캐시가 낡은 `dist` 를 복원해도 빌드는 성공했다고 찍힌다**(`CLAUDE.local.md` §2).

**`grep "runProviderProcess" dist/index.mjs` 로 판정하지 마라.** 그 이름은 **공개 export 가 없는 지금도** 번들에 2 건 들어 있다 — 정의(`dist/index.mjs:4196`)와 내부 사용(`4784`)이다. 실측 출력:

```text
packages/generate/dist/index.mjs:2      ← export 가 없는데도 2
packages/generate/dist/index.cjs:2
packages/generate/dist/index.d.mts:0
packages/generate/dist/index.d.cts:0
```

**런타임 산출물은 실제로 불러서 판정한다. 타입 산출물은 grep 이 유효하다**(0 → 1 이상으로 바뀌는 것이 곧 공개 여부다).

```bash
cd /Users/cheonjamin/projects/mcptest
pnpm --filter @mcpeak/generate build

# ① ESM 산출물에서 실제로 잡히는가
node -e 'import("./packages/generate/dist/index.mjs").then(m => { console.log("esm:", typeof m.runProviderProcess); process.exit(typeof m.runProviderProcess === "function" ? 0 : 1); })'
echo "esm_exit=$?"

# ② CJS 산출물에서 실제로 잡히는가
node -e 'const m = require("./packages/generate/dist/index.cjs"); console.log("cjs:", typeof m.runProviderProcess); process.exit(typeof m.runProviderProcess === "function" ? 0 : 1);'
echo "cjs_exit=$?"

# ③ 타입 산출물 — 여기는 0 이었던 것이 1 이상이 되어야 한다
grep -c "runProviderProcess" packages/generate/dist/index.d.mts packages/generate/dist/index.d.cts
```

Expected: `esm: function` · `cjs: function` · 두 `_exit=0` · `.d.mts`·`.d.cts` 가 **각각 1 이상**.

하나라도 어긋나면 산출물이 낡은 것이다. `build` 스크립트가 곧 `tsdown` 이라(`packages/generate/package.json:39`) turbo 를 안 타지만, 워크스페이스 전체 빌드를 거쳤다면 캐시가 낄 수 있다. 그때 직접 빌드한다.

```bash
cd packages/generate && npx tsdown --config-loader native && cd /Users/cheonjamin/projects/mcptest
```

> **`grep -c` 의 결과와 종료 코드를 섞지 마라.** 0 건일 때 `grep` 은 exit 1 이고, 여러 파일을 한 번에 주면 **하나가 0 이어도 전체 종료 코드는 0 이다**(실측). 건수는 stdout 의 파일별 줄에서 눈으로 읽는다(`CLAUDE.local.md` §2).

- [ ] **Step 8: 보고하고 멈춘다 (커밋하지 않는다)**

변경 파일과 권장 커밋 메시지를 보고한다. **`git commit` 을 실행하지 않는다.**

```
변경 파일:
  packages/generate/src/index.ts
  packages/generate/tests/index.test.ts

권장 커밋 메시지:
feat(generate): runProviderProcess 와 provider 별 env 목록을 공개 면에 연다

4 단계 「실제 응답」의 대시보드가 프로세스 기계를 다시 만들지 않고
같은 것을 쓴다. env 목록을 같이 여는 이유는 지금까지 공개된 것이
두 provider 의 합집합뿐이라, 그것을 쓰면 claude 자식이 OPENAI_API_KEY 를
받기 때문이다 — 자격증명은 provider 별로 맞춘다(ADR-0104).
MCP 를 여는 argv 는 대시보드에 둔다. 새 타입은 없다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 2: ADR-A 를 쓴다 (ADR-0104)

**Files:**
- Create: `docs/adr/0104-합성-경로는-MCP-를-닫아-두고-실제-응답-경로에서만-연다.md`
- Modify: `docs/adr/README.md:115` 뒤에 색인 줄 하나

**Interfaces:**
- Consumes: Task 1 의 `export { runProviderProcess } from "./provider-process.js";` 주석이 `ADR-0104` 를 가리킨다. 번호가 달라지면 그 주석도 같이 고쳐야 한다.
- Produces: 없음 (문서).

- [ ] **Step 1: 번호가 아직 비어 있는지 다시 확인한다**

계획 시점에 `0104` 가 비어 있었지만, 그 사이에 사람이 리베이스했을 수 있다.

```bash
cd /Users/cheonjamin/projects/mcptest
git fetch && ls docs/adr/ | grep "^010" && git ls-tree -r --name-only origin/main docs/adr/ | grep "^docs/adr/010"
```

Expected: 양쪽 모두 `0104` 로 시작하는 파일이 **없다.** 있으면 멈추고 사용자에게 알린다 — 번호는 사람이 정한다.

- [ ] **Step 2: ADR 파일을 쓴다**

`docs/adr/0104-합성-경로는-MCP-를-닫아-두고-실제-응답-경로에서만-연다.md` 에 아래를 그대로 쓴다.

```markdown
# ADR-0104: 합성 경로는 MCP 를 닫아 두고 실제 응답 경로에서만 연다

- 상태: 제안
- 날짜: 2026-09-21
- 담당: generate, dashboard
- 작성자: @storyrago
- 참조: `docs/superpowers/specs/2026-09-21-dashboard-relay-screen-design.md` §2-7·§5,
  [ADR-0006](./0006-ai-assisted-test-authoring.md),
  [ADR-0079](./0079-claude-safe-mode-호환성.md),
  [ADR-0101](./0101-목과-external-세션-사이에-중계-층을-넣는다.md),
  [ADR-0103](./0103-중계기-기록-줄이-응답-본문을-싣는다.md)

## 배경

4 단계 「실제 응답」은 사용자의 서버를 **AI 에게 대신 두드리게 해서** 실물 응답을 보여준다.
그러려면 `claude` 를 띄우면서 `--mcp-config` 로 중계기 URL 을 물려야 한다. 즉 **MCP 를 여는
AI 호출이 이 저장소에 처음 생긴다.**

지금까지 AI 를 띄우는 경로는 둘이고 **둘 다 MCP 를 닫아 뒀다.** 이 차단을 처음 요구한 것은
[ADR-0006](./0006-ai-assisted-test-authoring.md) 이다 — "도구·MCP·파일 쓰기 차단, 환경변수
allowlist". [ADR-0079](./0079-claude-safe-mode-호환성.md) 는 `--safe-mode` 를 떼면서 그 격리를
현재 argv 로 **유지**한 기록이고, 그 결과가 `packages/generate/src/providers.ts:324-325` 의
`--strict-mcp-config` 와 `--mcp-config '{"mcpServers":{}}'` 다.

- `generate` 의 authoring — AI 가 테스트 케이스를 **짓는다.**
- `repair` 의 진단 — AI 가 실패 원인을 **판정한다.**

두 경로의 AI 는 **저자**다. 산출물이 파일로 남고 승인 게이트를 지난다
([ADR-0006](./0006-ai-assisted-test-authoring.md)). 케이스를 짓다 말고 진짜 서버를 호출하면
같은 입력에 다른 케이스가 나오고, **승인해 둔 것이 조용히 달라진다.** 결정론성이 이 저장소의
핵심 가치라서 MCP 를 닫은 것이다.

4 단계의 AI 는 성격이 다르다. 아무것도 짓지 않고 사용자의 서버를 한 번 두드릴 뿐이며, 화면에
올라가는 값은 전부 중계기가 서버에서 직접 받은 바이트다
([ADR-0103](./0103-중계기-기록-줄이-응답-본문을-싣는다.md)). AI 의 요약은 쓰지도 않는다.
**운전기사이지 저자가 아니다.**

그런데 프로세스를 다루는 기계는 둘이 똑같이 필요하다. `runProviderProcess` 가 들고 있는
임시 cwd · 환경변수 allowlist · 타임아웃 · 출력 상한 · 실패 분류는 성격과 무관하게 같다.
**임시 cwd 는 편의가 아니다** — 설계 §3 의 탐침을 프로젝트 폴더에서 돌렸더니 사용자 훅 6 개가
같이 실행됐다(`system hook_started` × 6).

## 선택지

1. **대시보드가 프로세스 기계를 자기 손으로 다시 만든다.** `generate` 의 공개 면은 그대로.
2. **`generate` 에 MCP 를 여는 도구를 만든다.** 예: `runMcpProviderProcess(spec, mcpUrl)`.
   argv 조립까지 `generate` 안에 두고 대시보드는 URL 만 넘긴다.
3. **`generate` 는 `runProviderProcess` 와 provider 별 env 목록을 연다.** MCP 를 여는 argv 는
   대시보드에만 둔다.

## 결정

**③을 쓴다.** `packages/generate/src/index.ts` 가 `runProviderProcess` 와
`CLAUDE_ENV_ALLOWLIST` · `CODEX_ENV_ALLOWLIST` 를 재수출한다. 새 타입은 만들지 않는다 —
필요한 타입 7 개는 이미 나가 있고, 목록은 `readonly string[]` 로 추론되는 상수다.

두 가지를 같이 못박는다.

- **`--mcp-config` 와 `--allowedTools` 를 만드는 코드는 `packages/dashboard` 에만 둔다.**
  `packages/generate` 안에 MCP 를 여는 argv 가 생기면 이 결정이 깨진 것이다.
- **AI 자식에게 넘기는 환경변수는 provider 별 목록으로 정한다.** 합집합
  `PROVIDER_ENV_ALLOWLIST` 를 새 호출부에서 쓰지 않는다.

## 이유

**①은 사본을 만든다.** 그리고 사본이 갈라지는 자리가 하필 안전 장치다 — 임시 cwd 는 사용자의
훅을 AI 프로세스에서 떼어 놓고(설계 §3 의 탐침에서 훅 6 개가 같이 실행됐다), 타임아웃·출력
상한은 프로세스가 매달리거나 메모리를 먹는 것을 막는다. 한쪽만 고쳐지는 날 대시보드 쪽이
조용히 무방비가 된다.

**목록을 같이 여는 이유는 ①이 env 에서 그대로 재현되기 때문이다.** `runProviderProcess` 는
환경변수를 거르지 않는다 — `spec.env` 를 그대로 자식에게 넘긴다(`provider-process.ts:155`).
거르는 것은 `providers.ts:285` 의 비공개 함수다. 그래서 함수만 열면 부르는 쪽이 env 를 스스로
정해야 하는데, **공개된 목록이 두 provider 의 합집합 하나뿐**이다. 그것을 쓰면 `claude` 자식이
`OPENAI_API_KEY` 를 받는다. `providers.ts:26-29` 의 주석이 그것을 금한다 — "codex 자식이
Anthropic 자격증명을, claude 자식이 OpenAI 자격증명을 받을 이유가 없다."

**왜 그것이 위험한가.** 4 단계의 AI 는 사용자의 MCP 서버가 돌려준 툴 설명·응답을 맥락에 받는다.
이 저장소는 그것을 이미 untrusted 로 못박아 뒀다(`providers.ts` 의 `FIXED_INSTRUCTION`).
인젝션이 성립하면 그 프로세스의 환경변수가 피해 범위가 되고, 그때 남의 벤더 키까지 들어 있을
이유가 없다. 자격증명은 과금이 걸린 물건이다.

**다만 이 경계는 완전하지 않다.** `HOME` 은 공통 목록이라 두 자식 다 받는다. 파일 읽기 도구가
살아 있으면 다른 CLI 의 자격증명 파일에는 어차피 닿는다. env 분리는 **방어 깊이**이고, 하드한
경계는 [ADR-0006](./0006-ai-assisted-test-authoring.md) 의 다른 두 줄(도구 차단 · 빈 임시 cwd)
이다. 그 둘이 4 단계에서 어떻게 되는지는 T3 가 실측해서 정한다.

**필터 함수까지 열지는 않는다.** `environment()` 는 세 줄이라 부르는 쪽이 다시 써도 갈라질 것이
없다. 위험한 것은 필터가 아니라 **목록**이고, 단일 출처가 필요한 것도 목록뿐이다.

**②는 경계를 흐린다.** `generate` 안에 "MCP 를 여는 도구" 가 놓이면, 저자 경로를 손보던
다음 사람이 그것을 집어 쓰는 날이 온다. 그날 [ADR-0006](./0006-ai-assisted-test-authoring.md)
이 세우고 [ADR-0079](./0079-claude-safe-mode-호환성.md) 가 현재 argv 로 유지하고 있는
"합성 AI 는 MCP 를 닫는다" 가 무너지고, **무너진 것을 알려 줄 장치가 없다.** 합성이
진짜 서버를 부르기 시작해도 테스트는 초록이고 케이스 파일만 조용히 달라진다.

**③은 위험한 것을 안 옮긴다.** 프로세스를 띄우는 기계는 성격이 없다 — 무엇을 띄우든 임시
cwd 와 타임아웃은 같은 값이다. 성격이 붙는 것은 **argv** 이고, 그것만 부르는 쪽에 남긴다.
그래서 "MCP 를 여는 코드가 어디 있나" 의 답이 `packages/dashboard` 한 곳으로 고정된다.
env 목록은 데이터라 argv 와 다르다 — 옮기는 것이 아니라 **한 곳을 가리키게** 하는 것이다.

**AI 의 역할이 다르다는 것이 판단의 뿌리다.** 저자의 AI 는 묶어야 하고(스키마 · MCP 닫기 ·
승인 게이트), 운전기사의 AI 는 묶을 것이 없다 — 산출물을 안 쓰기 때문이다. 같은 기계를 쓰되
**묶는 부분을 공유하지 않는 것**이 이 결정이다.

## 결과

- **`@mcpeak/generate` 의 공개 면이 함수 하나와 상수 둘만큼 넓어진다.** 한 번 나가면 major
  없이 못 줄인다. 대가를 알고 치른다.
- **합집합 `PROVIDER_ENV_ALLOWLIST` 는 계속 나간다.** 기존 소비자가 있어서 빼지 않는다. 다만
  새 호출부는 provider 별 목록을 쓴다. 이 구분이 흐려지는 것을 `index.test.ts` 가 잡는다.
- **새 타입은 0 개다.** `ProviderProcessSpec` 등 7 개는 이미 나가 있었고 값만 없었다.
  `ProviderProcessClock` 은 계속 닫아 둔다 — `ProviderProcessDeps.clock` 이 선택 필드이고
  부르는 쪽이 구조적으로 채울 수 있다.
- **T3 에 제약이 남는다.** `--mcp-config` · `--allowedTools` 조립은 `packages/dashboard` 안에
  있어야 한다. `packages/generate` 로 옮기자는 제안이 나오면 이 ADR 을 먼저 고쳐야 한다.
- **의존 방향은 바뀌지 않는다.** `dashboard → generate` 는 이미 선언돼 있고
  (`packages/dashboard/package.json`), 이 변경으로 새 의존이 생기지 않는다.
- **`generate` 의 테스트가 공개 면을 고정한다.** `index.test.ts` 의 `provider-process 재수출`
  이 함수가 빠지는 것을, `provider 별 env 목록 재수출` 이 두 목록의 내용과 합집합의 포함
  관계를 잡는다. 한쪽 목록에만 키를 더하고 다른 쪽을 잊으면 거기서 깨진다.
- **T3 에 실측 항목이 하나 더 생긴다.** `CLAUDE_ENV_ALLOWLIST` 에는 `ANTHROPIC_API_KEY` 와
  `CLAUDE_CODE_OAUTH_TOKEN` 이 **둘 다** 들어 있다. 둘 다 환경에 있을 때 `claude` CLI 가 어느
  쪽을 고르는지에 따라 **구독 요금제로 나갈 호출이 API 종량제로 나갈 수 있다.** 확인하지 않았다 —
  T3 가 argv 를 정하는 시점에 잰다.
- **4 단계는 여전히 테스트 경로가 아니다.** 진짜 AI 와 진짜 서버가 끼므로 같은 결과를 보장하지
  않는다. E2E 에서 AI 를 가짜로 바꾸는 이유이고
  ([ADR-0101](./0101-목과-external-세션-사이에-중계-층을-넣는다.md) 이 중계기를 테스트 경로에서
  뺀 것과 같은 선), 이 구분이 흐려지면 안 된다.
```

- [ ] **Step 3: 색인표에 줄을 더한다**

`docs/adr/README.md` 의 `0103` 줄(115 행) **바로 뒤에** 붙인다.

```markdown
| [0104](./0104-합성-경로는-MCP-를-닫아-두고-실제-응답-경로에서만-연다.md) | 합성 경로는 MCP 를 닫아 두고 실제 응답 경로에서만 연다 | generate, dashboard | 제안 |
```

- [ ] **Step 4: 링크가 실제로 가리키는지 확인한다**

죽은 링크를 잡는 테스트가 없으므로 손으로 본다.

```bash
cd /Users/cheonjamin/projects/mcptest
ls "docs/adr/0104-합성-경로는-MCP-를-닫아-두고-실제-응답-경로에서만-연다.md"
grep -c "0104" docs/adr/README.md
for n in 0006 0079 0101 0103; do ls docs/adr/${n}-* >/dev/null 2>&1 && echo "$n ok" || echo "$n MISSING"; done
```

Expected: 파일이 있고, `README.md` 의 건수가 `1`, 참조 넷이 전부 `ok`.
**`0079` 는 번호가 중복이다**(`0079-claude-safe-mode-호환성.md` 와
`0079-서버-후보는-실행-없이-설정-파일에서만-읽는다.md`). ADR 본문의 링크가
`0079-claude-safe-mode-호환성.md` 를 가리키는지 눈으로 확인한다 — 그쪽이 `--mcp-config` 를
다루는 문서다.

- [ ] **Step 5: 보고하고 멈춘다**

```
변경 파일:
  docs/adr/0104-합성-경로는-MCP-를-닫아-두고-실제-응답-경로에서만-연다.md (신규)
  docs/adr/README.md

권장 커밋 메시지:
docs(adr): 합성 경로는 MCP 를 닫아 두고 실제 응답 경로에서만 연다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 3: changeset 을 넣는다

**Files:**
- Create: `.changeset/generate-run-provider-process-export.md`

**Interfaces:**
- Consumes: Task 1 의 공개 면 변경. Task 1 이 안 끝났으면 이 태스크를 시작하지 않는다.
- Produces: 없음 (발행 준비).

- [ ] **Step 1: changeset 을 쓴다**

공개 면이 넓어지므로 **minor** 다(`0.8.0` → `0.9.0`). 기존 파일이 지키는 문체를 따른다 —
무엇이 열렸고 **왜** 열렸는지, 그리고 열지 **않은** 것이 무엇인지.

```markdown
---
"@mcpeak/generate": minor
---

`runProviderProcess` 를 공개 면에 연다. 임시 cwd · 타임아웃 · 출력 상한 · bounded 종료를 한 곳에 둔 프로세스 기계이고, 지금까지 타입만 나가고 값이 없어서 부르는 쪽이 잡을 수 없었다. 대시보드의 4 단계 「실제 응답」이 같은 기계로 AI 를 띄우면서 그것을 다시 만들지 않게 한다.

`CLAUDE_ENV_ALLOWLIST` 와 `CODEX_ENV_ALLOWLIST` 를 같이 연다. `runProviderProcess` 는 환경변수를 거르지 않고 `spec.env` 를 그대로 넘기는데, 지금까지 공개된 목록은 두 provider 의 **합집합** 하나뿐이었다. 그것을 쓰면 `claude` 자식이 OpenAI 자격증명을, `codex` 자식이 Anthropic 자격증명을 받는다. 자격증명은 provider 별로 맞춘다. 합집합은 기존 소비자를 위해 그대로 둔다.

MCP 를 여는 argv(`--mcp-config` · `--allowedTools`)는 같이 나가지 않는다(ADR-0104). 합성 경로의 AI 는 케이스를 짓는 저자라 MCP 를 닫아 둬야 하고, 여는 판단은 부르는 쪽이 진다. 새 타입은 없다 — `ProviderProcessSpec` 등 7 개는 이미 나가 있었다.
```

- [ ] **Step 2: 형식을 확인한다**

```bash
cd /Users/cheonjamin/projects/mcptest
head -4 .changeset/generate-run-provider-process-export.md
ls .changeset/
```

Expected: 첫 줄이 `---`, 둘째 줄이 `"@mcpeak/generate": minor`, 셋째 줄이 `---`.
`.changeset/` 에 이 파일이 보인다.

> **`.changeset/light-lizards-wave.md` 를 건드리지 마라.** `origin/main` 의 `Version Packages`
> 커밋이 이미 그 파일을 지웠다. 리베이스 때 정리되는 것이고 사람의 몫이다.

- [ ] **Step 3: 보고하고 멈춘다**

```
변경 파일:
  .changeset/generate-run-provider-process-export.md (신규)

권장 커밋 메시지:
chore(release): generate 의 runProviderProcess 공개에 changeset 을 넣는다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

## 웨이브 · 순서

한 웨이브로 끝난다. **Task 1 → Task 2 → Task 3 순서를 지킨다.**

- Task 2 의 ADR 번호를 Task 1 의 소스 주석이 가리키므로, Task 2 에서 번호가 바뀌면 Task 1 의
  주석도 같이 고친다.
- Task 3 은 Task 1 이 끝난 뒤에만 의미가 있다.
- **실제 프로세스를 띄우는 테스트가 없다.** 이 계획의 테스트는 전부 유닛이라 직렬 웨이브로
  내릴 이유가 없다. 다만 `packages/generate` 전체 게이트(Task 1 Step 6)는 `provider-process.test.ts`
  가 가짜 deps 로 도는 것이라 포트·PID 를 쓰지 않는다.

커밋은 셋으로 쪼갠다 — `feat(generate)` · `docs(adr)` · `chore(release)`.
`git log --grep "(generate)"` 로 기여를 뽑는 집계가 그 scope 에 걸린다.

## 이 계획이 **안 하는** 것

경계를 분명히 해 둔다. 아래가 보이면 범위 밖이다.

- **`provider-process.ts` 의 구현 수정.** 읽기만 한다.
- **`ProviderProcessClock` 공개.** 설계가 "새 타입 0 개" 라고 정했고, 선택 필드라 구조로 채울 수 있다. 코덱스 리뷰가 타입체크로 확인했다(`diagnostics=0`).
- **`environment()` 필터 함수 공개.** 3 줄이라 부르는 쪽이 다시 써도 갈라질 것이 없다. 단일 출처가 필요한 것은 목록뿐이다.
- **실패 분류기(`classifyClaudeFailure`) 공개.** 4 단계는 "툴을 불렀나" 를 중계기 기록으로 판정하므로 분류기 없이 성립한다. 필요해지면 T3 에서 따로 판단한다.
- **env 목록의 내용 변경.** 어느 키를 넣고 빼는지는 이 계획의 범위가 아니다.
- **`ANTHROPIC_API_KEY` 와 `CLAUDE_CODE_OAUTH_TOKEN` 중 무엇이 우선하는지 실측.** 요금제가 걸린 문제이고 argv 를 정하는 T3 의 몫이다.
- **`--tools ""` 실측.** 대시보드 argv 에 걸린 것이다 — T3 계획서에서 닫는다.
- **`generate` 의 dist E2E 추가.** T1 은 `relayBinPath()` 때문에 dist E2E 를 새로 넣었지만
  (`import.meta` 가 빌드 포맷에 따라 달라지는 위험이 있었다), 이 변경은 **정적 재수출 한 줄**이라
  빌드 포맷에 따라 달라질 것이 없다. Task 1 Step 7 의 `dist` grep 으로 충분하다고 판단했다.
  **이 판단은 사용자 확인 대상이다** — CI 에 고정하고 싶으면 T3 에서 대시보드가 `@mcpeak/generate`
  를 실제로 import 하는 순간 build 잡이 잡는다.
- **`packages/dashboard` 의 어떤 파일도.** T3 다.
- **`--tools ""` 와 도구 차단이 4 단계에서 성립하는지 실측.** ADR-0104 가 "env 분리는 방어 깊이이고 하드한 경계는 도구 차단" 이라고 적은 그 실측이다. T3 가 닫는다.
- **리베이스 · 커밋 · 푸시.** 사람이 한다.
