# T3 · `@mcpeak/dashboard` — 실제 응답 화면 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대시보드 3 단계에 체크박스(`판정 전에 서버의 실제 응답을 본다`)를 넣고, 켜면 4 단계 「실제 응답」 스텝이 붙어 — 중계기를 띄우고, 고른 스위트의 케이스마다 질문 하나로 `claude` 를 동시에 띄우고, 중계기가 기록한 **실물 응답**을 케이스별 칸으로 보여준다. 떠날 때는 중계기를 **먼저 닫고** 나서 다음 동작을 한다.

**Architecture:** 판단이 있는 것은 전부 **순수 모듈**로 떼어 `node` 환경에서 테스트한다 (질문 생성 · argv 조립 · 줄 파싱 · 카드 뷰모델). 서버에는 `RelaySession` 하나와 통로 셋(`POST /api/relay` · SSE · `DELETE`)을 얹고, 프로세스 기계는 전부 주입받아 유닛 테스트가 진짜 프로세스를 띄우지 않게 한다. React 컴포넌트는 순수 모듈의 결과를 그리기만 한다. **`/api/runs` 에 얹지 않는다**(설계 §2-8).

**Tech Stack:** TypeScript (ESM, tsdown 0.22.14 dual 빌드) · vitest (projects: `unit` · `e2e` · `web`) · React 19 · Node ≥ 22.18.0 · `@mcpeak/generate`(`runProviderProcess` · `CLAUDE_ENV_ALLOWLIST`) · `@mcpeak/mock`(`relayBinPath()`)

---

## ⛔ 선행 조건 — 시작 전에 반드시 확인한다

**`@mcpeak/mock` 의 케이스 꼬리표가 아직 없다.** T1 계획서(`2026-09-21-mock-relay-body-case-binpath.md`)의 **Task 2** 가 커밋되지 않았다.

확인 명령 — 이 셋이 **전부 통과**해야 이 계획서를 시작할 수 있다.

```bash
cd /Users/cheonjamin/projects/mcptest
grep -c "readCaseTag" packages/mock/src/relay-log.ts      # 0 이면 아직이다
grep -c "case" packages/mock/src/relay-server.ts          # req.url 을 읽는 코드가 있어야 한다
corepack pnpm vitest run packages/mock/tests/relay-e2e.test.ts -t 꼬리표
```

> **§2 거짓 신호 주의.** `grep -c` 는 0 건일 때 **종료 코드 1** 을 낸다. 건수는 stdout 에서 읽고 종료 코드와 섞지 마라.

닫는 방법은 **새로 계획서를 쓰지 않는다.** T1 계획서의 Task 2 가 전문(테스트 4 · 5, `readCaseTag` 구현, `relay-server.ts` 의 대기표 수정)을 이미 담고 있다. 그것을 그대로 실행하고 사람이 SHA 를 만든 뒤 여기로 돌아온다.

**왜 막는가:** 설계 §2-3 이 케이스당 프로세스 하나를 **동시에** 띄우기로 정했다. 꼬리표가 없으면 중계기 기록 줄에 N 개 AI 의 `initialize` · `tools/list` · `tools/call` 이 한 덩어리로 섞이고, 어느 줄이 어느 케이스의 것인지 말할 근거가 사라진다. 이 계획서의 Task 3 · 5 · 6 · 7 이 전부 그 위에 선다.

---

## Global Constraints

- **패키지는 `packages/dashboard` 하나만 건드린다.** `mock`(T1) · `generate`(T2) 는 끝났고 이 계획서 범위 밖이다. `packages/mock/src` · `packages/generate/src` 의 파일을 열어 **읽는 것**은 되지만 **고치지 마라.**
- **`core/src/types.ts` 의 `McpClient` · `ToolResult` 를 바꾸지 않는다.**
- **새 외부 의존성을 추가하지 않는다.** 이 계획이 새로 들이는 것은 워크스페이스 내부 의존 `@mcpeak/mock` **하나**뿐이다. `dashboard → mock` 은 의존 방향표(`tests/dependency-boundary.test.ts` 의 `ALLOWED_INTERNAL_DEPENDENCIES`)에 **이미 허용**돼 있다. `package.json` 의 `dependencies` 에 `"@mcpeak/mock": "workspace:*"` 를 더하는 것이 전부이고, 빠뜨리면 그 테스트가 정확히 그 사실을 말해 준다.
- **`@modelcontextprotocol/sdk` 버전을 건드리지 않는다.**
- **커밋·푸시는 사람이 한다.** 각 태스크 끝에서 변경 파일과 권장 커밋 메시지만 제시하고 멈춘다. `git commit` 을 실행하지 않는다.
- **커밋 scope 는 `dashboard`.** Conventional Commits, scope 필수. ADR 커밋만 scope `adr`, changeset 커밋만 scope `release`.
- **결정론성.** 같은 스위트면 **항상 같은 질문이 같은 순서로** 나와야 한다. 새 코드에 `Date.now()` · `Math.random()` · `Object.keys` 순서 의존을 넣지 마라. 예외 둘: ① `relayId` 는 `crypto.randomUUID()` (기존 `RunRegistry.runId` 와 같은 이유 — UI 식별 전용, 산출물에 안 들어간다) ② 중계기가 기록하는 `ms`.
- **실패 메시지가 곧 제품이다.** 새로 던지는 오류·화면에 나가는 문장은 무엇이 왜 틀렸는지와 **어떻게 고치는지**까지 적는다.
- **`packages/mock/tests/stdio-e2e.test.ts` 는 미커밋 상태이고 사용자 것이다. 커밋 범위에 절대 넣지 마라.** `git add -A` 를 쓰지 말고 경로를 하나씩 지정한다.
- **종료 코드 0 이 성공이 아니다.** 권한에 막혀도 `claude` 는 0 으로 끝난다(설계 §3). 툴을 불렀는지는 **중계기 기록 줄로만** 판정한다.

## 계획 단계에서 닫은 실측

핸드오프 §5 가 남긴 두 번째 실측을 **이 계획서에서 직접 쟀다.** 결과가 Task 2 의 argv 를 정했다.

| 무엇 | 결과 |
|---|---|
| `--tools ""` 를 유지한 채 MCP 툴이 살아 있는가 | **살아 있다.** `claude` 2.1.267 · `mcpeak-relay --json --port 0 -- node examples/weather-server/server.mjs` · `--allowedTools "mcp__target"` 동반. 있는 판 · 없는 판 **둘 다** `{"dir":"req","id":3,"method":"tools/call","tool":"get_weather","args":{"city":"서울"}}` 가 찍혔다 |
| 응답 줄에 `method` 가 있는가 | **없다.** `jsonResponse` 의 머리는 `{dir,id,tool}` 뿐이다. 메서드 이름은 **같은 `id` 의 요청 줄에서** 가져와야 한다 → Task 3 의 파서가 id 로 짝짓는다 |
| 중계기 URL 의 모양 | `http://127.0.0.1:<port>/mcp` (`relay-server.ts:225`). 기동 줄은 `{"dir":"up","port":N,"url":"..."}` |
| 대시보드 web 테스트 기준선 | **6 파일 · 81 테스트 실패 / 330 통과 (411)**. 전부 `beforeEach` 의 `window.localStorage.clear is not a function`(jsdom 27.4.0). **내가 깬 것이 아니다.** 깨진 파일: `recent-commands` · `session-origin` · `last-run` · `replay-view` · `home`(35/35) · `generate-wizard`(1/29) |
| 그 고장이 새 UI 테스트를 막는가 | **안 막는다.** `generate-wizard.test.tsx` 는 29 건 중 28 건이 통과한다 — jsdom + React Testing Library 자체는 돈다. 터지는 것은 `localStorage.clear()` 한 줄뿐이다. **새 `.test.tsx` 파일에서 `localStorage.clear()` 를 부르지 않으면 정상 동작한다.** 그래서 이 계획의 UI 테스트는 `home.test.tsx` 에 **얹지 않고** 새 파일 둘로 나간다 |

> **`home.test.tsx` 를 건드리지 마라.** 35/35 가 이미 빨강이라 거기 테스트를 더하면 초록을 볼 수 없고, jsdom 고장을 고치는 것은 이 계획서 범위 밖이다(별건, 4 단계와 무관).

## File Structure

| 파일 | 무엇을 맡는가 | 이 계획에서 |
|---|---|---|
| `packages/dashboard/src/server/relay-questions.ts` | 스위트 → 케이스 목록·질문. **순수** | 생성 (Task 1) |
| `packages/dashboard/src/server/relay-argv.ts` | AI argv 조립. **순수** | 생성 (Task 2) |
| `packages/dashboard/src/server/relay-lines.ts` | 중계기 stderr 줄 → 타입 있는 이벤트. **순수** | 생성 (Task 3) |
| `packages/dashboard/src/server/relay-session.ts` | 중계기·AI N 개의 수명. 프로세스 기계는 **전부 주입** | 생성 (Task 4) |
| `packages/dashboard/src/server/routes.ts` | HTTP 라우팅 | 수정: 통로 셋 (Task 4) |
| `packages/dashboard/src/server/sse.ts` | SSE 직렬화 | 수정: 한 줄 형 넓히기 (Task 4) |
| `packages/dashboard/src/api-types.ts` | 브라우저·서버 공유 타입 | 수정: 중계 타입 (Task 1·4) |
| `packages/dashboard/src/index.ts` | 서버 조립 | 수정: 세션 레지스트리 (Task 4) |
| `packages/dashboard/package.json` | 매니페스트 | 수정: `@mcpeak/mock` 의존 (Task 4) |
| `packages/dashboard/web/src/relay/case-cards.ts` | 이벤트 → 케이스 칸 뷰모델. **순수** | 생성 (Task 5) |
| `packages/dashboard/web/src/relay/close-first.ts` | 「닫기 먼저」 순서. **순수** | 생성 (Task 5) |
| `packages/dashboard/web/src/relay/relay-stream.ts` | 중계 SSE 구독 훅 | 생성 (Task 6) |
| `packages/dashboard/web/src/home/steps/StepRelay.tsx` | 4 단계 화면 | 생성 (Task 6) |
| `packages/dashboard/web/src/home/steps/StepRunOptions.tsx` | 3 단계 옵션 | 수정: 체크박스 (Task 6) |
| `packages/dashboard/web/src/screens/Home.tsx` | 실행 마법사 | 수정: 4 단계·닫기 순서 (Task 6) |

**왜 순수 모듈을 이렇게 많이 떼는가.** 이 기능은 진짜 프로세스 둘(중계기 · AI)이 끼어 있어 그대로 두면 테스트가 전부 E2E 가 된다. E2E 는 직렬 웨이브라 느리고, AI 는 같은 입력에 같은 결과를 주지 않는다(설계 §8). 판정 규칙을 순수 함수로 내리면 테스트 7·8·9·10·11 이 전부 `node` 환경 유닛이 되고, E2E(테스트 12)는 **배선이 맞는지** 하나만 본다.

## 웨이브

| 웨이브 | 태스크 | 병렬 |
|---|---|---|
| 1 | Task 1 · 2 · 3 · 5 | **가능** — 파일 집합이 겹치지 않고 전부 순수 모듈이다 |
| 2 | Task 4 | 단독 (Task 1·2·3 의 산출물을 쓴다) |
| 3 | Task 6 | 단독 (Task 4·5 를 쓴다) |
| 4 | Task 7 (E2E) | **직렬 전용 웨이브.** 실제 프로세스를 띄운다 |
| 5 | Task 8 (ADR · changeset) | 단독 |

웨이브 1 에서 여러 세션이 **같은 워킹 트리**를 쓴다면 T1 계획서 §「병렬 실행 규약」이 그대로 적용된다: 자기 테스트 파일만 경로로 지정해 돌리고, `git` 쓰기 명령을 쓰지 않으며, 되돌려-실패-확인은 스크래치패드 `cp` 백업으로 한다.

---

## Task 1: 스위트 → 케이스 목록과 질문 (테스트 7)

**Files:**
- Create: `packages/dashboard/src/server/relay-questions.ts`
- Modify: `packages/dashboard/src/api-types.ts` (끝에 추가)
- Test: `packages/dashboard/tests/relay-questions.test.ts`

**Interfaces:**
- Consumes: 없음 (순수 · 독립)
- Produces:
  ```ts
  // api-types.ts
  export interface RelayCase {
    readonly id: string;      // 스위트의 케이스 id 그대로. 화면 칸 제목이다.
    readonly tag: string;     // 중계기 URL 에 실을 짧은 꼬리표. "c1" · "c2" …
    readonly tool: string;
    readonly input: unknown;
  }
  // relay-questions.ts
  export interface RelayPlan {
    readonly cases: readonly RelayCase[];
    readonly prompts: Readonly<Record<string, string>>;  // tag → stdin 질문
    readonly skipped: readonly string[];                 // 질문을 못 지은 케이스 id
  }
  export function planRelayCases(content: string): RelayPlan | { readonly error: string };
  ```

**왜 대시보드가 자체 꼬리표(`c1`)를 매기는가.** 사용자의 케이스 id 를 그대로 URL 에 실으면 두 가지가 걸린다 — `readCaseTag` 가 거는 길이·문자 상한에 걸려 **조용히 꼬리표가 사라지고**, 그러면 그 케이스의 줄이 「꼬리표 없음」 무더기로 떨어져 칸을 못 가른다. 우리가 매기면 항상 상한 안이고 항상 안전한 문자다. 원래 id 는 `RelayCase.id` 로 따로 나른다 — 화면 칸 제목은 사용자가 아는 이름이어야 하기 때문이다. 이 판단은 Task 8 의 ADR 에 적는다.

**왜 `skipped` 를 따로 세는가.** `operation.type` 이 `callTool` 이 아닌 케이스(`listTools` 등)는 질문의 재료(`tool` · `input`)가 없다. 조용히 빼면 화면에 칸이 적게 뜨는데 사용자는 자기 케이스가 사라진 이유를 알 수 없다 — `CLAUDE.local.md` §2 의 「finding 0 건이라 깨끗해 보임 → 건너뛴 건수를 따로 센다」가 이것이다.

- [ ] **Step 1: 실패 테스트를 쓴다**

`packages/dashboard/tests/relay-questions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { planRelayCases } from "../src/server/relay-questions.js";

const SUITE = JSON.stringify({
  id: "weather",
  name: "날씨 서버",
  cases: [
    {
      id: "get-weather-success",
      operation: { type: "callTool", tool: "get_weather", input: { city: "서울" } },
      assertions: [{ type: "isError", expected: false }],
    },
    { id: "tools-exist", operation: { type: "listTools" }, assertions: [] },
    {
      id: "add-missing-a",
      operation: { type: "callTool", tool: "add", input: { b: 2 } },
      assertions: [{ type: "isError", expected: true }],
    },
  ],
});

describe("중계 케이스 계획", () => {
  it("callTool 케이스마다 꼬리표·툴·입력을 파일 순서 그대로 낸다", () => {
    const plan = planRelayCases(SUITE);
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;
    expect(plan.cases).toEqual([
      { id: "get-weather-success", tag: "c1", tool: "get_weather", input: { city: "서울" } },
      { id: "add-missing-a", tag: "c2", tool: "add", input: { b: 2 } },
    ]);
  });

  it("질문을 못 지은 케이스를 조용히 버리지 않고 센다", () => {
    const plan = planRelayCases(SUITE);
    if ("error" in plan) throw new Error("계획이 서야 한다");
    expect(plan.skipped).toEqual(["tools-exist"]);
  });

  it("같은 스위트는 항상 같은 질문을 같은 순서로 낸다", () => {
    const first = planRelayCases(SUITE);
    const second = planRelayCases(SUITE);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("질문에 툴 이름과 입력이 그대로 실린다", () => {
    const plan = planRelayCases(SUITE);
    if ("error" in plan) throw new Error("계획이 서야 한다");
    expect(plan.prompts.c1).toContain("get_weather");
    expect(plan.prompts.c1).toContain('{"city":"서울"}');
  });

  it("JSON 이 아니면 고치는 방법까지 말한다", () => {
    const result = planRelayCases("{ 아님");
    expect(result).toEqual({
      error:
        "→ 스위트 파일이 올바른 JSON 이 아닙니다.\n→ 2 단계에서 고른 파일을 열어 JSON 형식을 확인하세요.",
    });
  });

  it("cases 배열이 없으면 무엇이 없는지 말한다", () => {
    expect(planRelayCases(JSON.stringify({ id: "x" }))).toEqual({
      error:
        "→ 스위트에 cases 배열이 없습니다.\n→ mcpeak generate 가 만든 스위트 파일인지 확인하세요.",
    });
  });

  it("callTool 케이스가 하나도 없으면 띄울 것이 없다고 말한다", () => {
    const result = planRelayCases(
      JSON.stringify({ cases: [{ id: "only-list", operation: { type: "listTools" } }] }),
    );
    expect(result).toEqual({
      error:
        "→ 이 스위트에는 툴을 부르는 케이스가 없습니다. 실제 응답을 볼 대상이 없습니다.\n" +
        "→ 건너뛴 케이스 1 건: only-list\n" +
        "→ operation.type 이 callTool 인 케이스가 있는 스위트를 고르세요.",
    });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && corepack pnpm vitest run packages/dashboard/tests/relay-questions.test.ts`
Expected: FAIL — `Failed to resolve import "../src/server/relay-questions.js"`

- [ ] **Step 3: 타입을 `api-types.ts` 끝에 더한다**

```ts
/**
 * 4 단계 「실제 응답」이 띄울 케이스 하나.
 *
 * `tag` 는 **대시보드가 매긴다** — 중계기 URL(`?case=<tag>`)에 실리는 값이라 짧고 안전한
 * 문자여야 하고, 사용자의 케이스 id 를 그대로 실으면 `readCaseTag` 의 길이·문자 상한에
 * 걸려 조용히 사라진다. 화면 칸 제목에는 `id` 를 쓴다(사용자가 아는 이름).
 */
export interface RelayCase {
  readonly id: string;
  readonly tag: string;
  readonly tool: string;
  readonly input: unknown;
}
```

- [ ] **Step 4: 구현한다**

`packages/dashboard/src/server/relay-questions.ts`:

```ts
import type { RelayCase } from "../api-types.js";

/**
 * 고른 스위트를 읽어 케이스마다 질문 하나를 짓는다. **순수 함수** — 파일도 시간도 읽지 않는다.
 *
 * 근거를 스위트로 잡은 이유는 설계 §2-2 다. 툴 목록을 따로 읽지 않는다 — 스위트에 `tool` ·
 * `input` 이 이미 있고, 같은 스위트면 항상 같은 질문이 같은 순서로 나온다. 결정론성이
 * 이 저장소의 핵심 가치이고(`CLAUDE.md`), 질문이 흔들리면 같은 화면을 두 번 볼 수 없다.
 */

export interface RelayPlan {
  readonly cases: readonly RelayCase[];
  /** `tag` → AI 에게 stdin 으로 갈 질문. */
  readonly prompts: Readonly<Record<string, string>>;
  /** 질문을 못 지은 케이스의 id. **조용히 버리지 않는다.** */
  readonly skipped: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 질문 문안. 한 줄짜리 지시가 아니라 **재료를 그대로 보인다** — AI 는 여기서 저자가 아니라
 * 운전기사이고(설계 §5), 지어낼 여지를 줄일수록 사용자가 보는 것이 자기 케이스에 가깝다.
 */
function question(tool: string, input: unknown): string {
  return [
    "연결된 MCP 서버(target)의 툴을 한 번 호출하세요.",
    `툴 이름: ${tool}`,
    `입력(JSON): ${JSON.stringify(input ?? {})}`,
    "입력을 고치지 말고 그대로 보내세요. 호출이 실패해도 다시 시도하지 마세요.",
    "결과를 요약하지 말고 받은 그대로 한 번만 알려주세요.",
  ].join("\n");
}

export function planRelayCases(content: string): RelayPlan | { readonly error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      error:
        "→ 스위트 파일이 올바른 JSON 이 아닙니다.\n→ 2 단계에서 고른 파일을 열어 JSON 형식을 확인하세요.",
    };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.cases)) {
    return {
      error:
        "→ 스위트에 cases 배열이 없습니다.\n→ mcpeak generate 가 만든 스위트 파일인지 확인하세요.",
    };
  }
  const cases: RelayCase[] = [];
  const prompts: Record<string, string> = {};
  const skipped: string[] = [];
  // 파일 순서를 그대로 쓴다. 정렬하지 않는다 — 같은 스위트가 항상 같은 순서로 나와야 한다.
  for (const [index, testCase] of parsed.cases.entries()) {
    const id =
      isRecord(testCase) && typeof testCase.id === "string" ? testCase.id : `(id 없음 #${index + 1})`;
    const operation = isRecord(testCase) ? testCase.operation : undefined;
    if (
      !isRecord(operation) ||
      operation.type !== "callTool" ||
      typeof operation.tool !== "string"
    ) {
      skipped.push(id);
      continue;
    }
    // 꼬리표는 **남은 케이스 수** 로 매긴다. 건너뛴 것이 번호를 먹으면 `c2` 가 비는데,
    // 그 빈 번호는 아무 데도 나타나지 않아 사람이 읽을 때 설명할 길이 없다.
    const tag = `c${cases.length + 1}`;
    cases.push({ id, tag, tool: operation.tool, input: operation.input });
    prompts[tag] = question(operation.tool, operation.input);
  }
  if (cases.length === 0) {
    return {
      error: [
        "→ 이 스위트에는 툴을 부르는 케이스가 없습니다. 실제 응답을 볼 대상이 없습니다.",
        `→ 건너뛴 케이스 ${skipped.length} 건: ${skipped.join(", ")}`,
        "→ operation.type 이 callTool 인 케이스가 있는 스위트를 고르세요.",
      ].join("\n"),
    };
  }
  return { cases, prompts, skipped };
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && corepack pnpm vitest run packages/dashboard/tests/relay-questions.test.ts`
Expected: PASS — 출력에 `Test Files  1 passed (1)` 과 `Tests  7 passed (7)` 줄이 있어야 한다. **「exit 0」만 보고 넘기지 마라**(§2 거짓 신호 1번).

- [ ] **Step 6: 보고하고 멈춘다**

변경 파일: `packages/dashboard/src/server/relay-questions.ts`(신규) · `packages/dashboard/src/api-types.ts` · `packages/dashboard/tests/relay-questions.test.ts`(신규)

```
feat(dashboard): 스위트에서 케이스별 질문과 꼬리표를 짓는다
```

**커밋하지 마라.** 사람이 SHA 를 만든다.

---

## Task 2: AI argv 조립 (테스트 8)

**Files:**
- Create: `packages/dashboard/src/server/relay-argv.ts`
- Test: `packages/dashboard/tests/relay-argv.test.ts`

**Interfaces:**
- Consumes: 없음 (순수 · 독립)
- Produces: `export function buildRelayAiArgs(input: { readonly model: string; readonly url: string; readonly tag: string }): readonly string[]`

**왜 여기에 있고 `generate` 에 없는가.** 설계 §2-7 · §5 가 정한 것이다. `generate` 안에 「MCP 를 여는 도구」가 생기면 다음 사람이 **저자 경로**(케이스를 지어내 승인 게이트를 지나는 경로)에서 그것을 집어 쓴다. 그러면 케이스를 짓다 말고 진짜 서버를 호출하게 되고, 같은 입력에 다른 결과가 나와 승인해 둔 것이 조용히 달라진다(ADR-0079). 프로세스를 다루는 기계는 `runProviderProcess` 로 공유하고, **MCP 를 여는 argv 는 대시보드에만 둔다.**

**세 칸만 집 방식과 다르다**(`packages/generate/src/providers.ts:322-330` 과 비교):

| | `generate` · `repair` | 여기 |
|---|---|---|
| `--tools ""` | 있다 | **있다** (실측으로 유지 확정 — 위 표) |
| `--allowedTools` | 없다 | **`"mcp__target"`** — 없으면 툴을 한 번도 못 부른다 |
| `--mcp-config` | `{"mcpServers":{}}` | 중계기 URL + 꼬리표 |
| `--json-schema` | 있다 | **없다** — 답의 모양을 강제하지 않는다. 답을 쓰지 않으니까 |

- [ ] **Step 1: 실패 테스트를 쓴다**

`packages/dashboard/tests/relay-argv.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildRelayAiArgs } from "../src/server/relay-argv.js";

const BASE = { model: "sonnet", url: "http://127.0.0.1:51234/mcp", tag: "c2" } as const;

describe("중계 AI argv", () => {
  it("allowedTools 가 붙는다", () => {
    // 이것이 없으면 `system permission_denied` 가 나고 tools/call 이 한 번도 안 찍힌다(설계 §3).
    const args = buildRelayAiArgs(BASE);
    const at = args.indexOf("--allowedTools");
    expect(at).toBeGreaterThan(-1);
    expect(args[at + 1]).toBe("mcp__target");
  });

  it("mcp-config 의 URL 에 케이스 꼬리표가 붙는다", () => {
    const args = buildRelayAiArgs(BASE);
    const at = args.indexOf("--mcp-config");
    expect(JSON.parse(args[at + 1] as string)).toEqual({
      mcpServers: { target: { type: "http", url: "http://127.0.0.1:51234/mcp?case=c2" } },
    });
  });

  it("내장 도구를 끈 채로 둔다", () => {
    const args = buildRelayAiArgs(BASE);
    const at = args.indexOf("--tools");
    expect(at).toBeGreaterThan(-1);
    expect(args[at + 1]).toBe("");
  });

  it("json-schema 를 붙이지 않는다", () => {
    // 답의 모양을 강제하지 않는다. AI 의 답은 화면에 쓰지 않는다(설계 §5).
    expect(buildRelayAiArgs(BASE)).not.toContain("--json-schema");
  });

  it("모델이 argv 에 그대로 실린다", () => {
    const args = buildRelayAiArgs({ ...BASE, model: "haiku" });
    expect(args[args.indexOf("--model") + 1]).toBe("haiku");
  });

  it("같은 입력은 항상 같은 배열이다", () => {
    expect(buildRelayAiArgs(BASE)).toEqual(buildRelayAiArgs(BASE));
  });

  it("URL 에 이미 쿼리가 있으면 & 로 잇는다", () => {
    const args = buildRelayAiArgs({ ...BASE, url: "http://127.0.0.1:1/mcp?x=1" });
    const config = JSON.parse(args[args.indexOf("--mcp-config") + 1] as string) as {
      mcpServers: { target: { url: string } };
    };
    expect(config.mcpServers.target.url).toBe("http://127.0.0.1:1/mcp?x=1&case=c2");
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && corepack pnpm vitest run packages/dashboard/tests/relay-argv.test.ts`
Expected: FAIL — import 해결 실패

- [ ] **Step 3: 구현한다**

`packages/dashboard/src/server/relay-argv.ts`:

```ts
/**
 * 중계기에 붙는 `claude` 의 argv. **순수 함수** — 환경도 시간도 읽지 않는다.
 *
 * 집 방식(`packages/generate/src/providers.ts` 의 `claudeSpec`)과 **모양이 같고 세 칸만
 * 다르다**: `--allowedTools` 가 붙고, `--mcp-config` 가 중계기를 가리키며, `--json-schema`
 * 가 없다. 두 벌이 된 것이 아니라 **역할이 다르다** — 저자(generate·repair)는 MCP 를 닫고
 * 스키마로 묶지만, 여기 AI 는 운전기사라 아무것도 지어내지 않고 사용자의 서버를 대신 두드릴
 * 뿐이다(설계 §5, ADR-0079·ADR-0104).
 */

/** MCP 설정의 서버 이름. `--allowedTools` 의 `mcp__target` 과 짝이다. 바꾸면 둘 다 바꾼다. */
const SERVER_NAME = "target";

export interface RelayAiArgsInput {
  /** `MODEL_OPTIONS.claude` 의 값 하나. */
  readonly model: string;
  /** 중계기 기동 줄이 준 URL. `http://127.0.0.1:<port>/mcp` */
  readonly url: string;
  /** 대시보드가 매긴 짧은 케이스 꼬리표(`c1` …). 중계기가 기록 줄에 그대로 옮긴다. */
  readonly tag: string;
}

export function buildRelayAiArgs(input: RelayAiArgsInput): readonly string[] {
  // `URL` 로 조립하지 않는다 — 그러면 기본 포트·후행 슬래시가 정규화돼 중계기가 준 문자열과
  // 달라질 수 있고, 화면에 보이는 URL 과 실제로 간 URL 이 갈리면 진단할 방법이 없다.
  const separator = input.url.includes("?") ? "&" : "?";
  const url = `${input.url}${separator}case=${encodeURIComponent(input.tag)}`;
  return [
    "-p",
    "--model",
    input.model,
    // 내장 도구는 끈 채로 둔다. MCP 툴은 아래 `--allowedTools` 가 따로 연다 —
    // 둘이 별개 축이라는 것을 계획 단계에서 실측으로 확인했다.
    "--tools",
    "",
    "--no-session-persistence",
    "--strict-mcp-config",
    // **이것이 없으면 툴을 한 번도 못 부른다.** `system permission_denied` 가 나는데
    // 종료 코드는 0 이다(설계 §3). 빠뜨려도 조용히 지나가는 종류의 실수라 테스트로 건다.
    "--allowedTools",
    `mcp__${SERVER_NAME}`,
    "--mcp-config",
    JSON.stringify({ mcpServers: { [SERVER_NAME]: { type: "http", url } } }),
    "--output-format",
    "json",
  ];
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && corepack pnpm vitest run packages/dashboard/tests/relay-argv.test.ts`
Expected: PASS — `Tests  7 passed (7)`

- [ ] **Step 5: 되돌려서 실패를 본다**

`--allowedTools` 두 줄을 **손으로 지우고** 테스트를 다시 돌려 그 케이스가 빨강인지 확인한 뒤 되돌린다. 스크래치패드 백업으로 한다(`git stash` 를 쓰지 마라 — 같은 트리를 쓰는 세션이 있을 수 있고 index 는 공유 락이다).

```bash
SCRATCH=/private/tmp/claude-501/-Users-cheonjamin-projects-mcptest/11ae66be-f45a-457e-a064-c7b83ceae183/scratchpad
cp packages/dashboard/src/server/relay-argv.ts "$SCRATCH/relay-argv.bak"
# …--allowedTools 두 줄을 손으로 지운다…
corepack pnpm vitest run packages/dashboard/tests/relay-argv.test.ts   # 빨강이어야 한다
cp "$SCRATCH/relay-argv.bak" packages/dashboard/src/server/relay-argv.ts
git diff --stat packages/dashboard/src/server/relay-argv.ts            # 내 변경이 그대로 있는지 눈으로 본다
```

- [ ] **Step 6: 보고하고 멈춘다**

```
feat(dashboard): 중계기에 붙는 AI argv 를 조립한다
```

---

## Task 3: 중계기 기록 줄 파서 (테스트 9)

**Files:**
- Create: `packages/dashboard/src/server/relay-lines.ts`
- Test: `packages/dashboard/tests/relay-lines.test.ts`

**Interfaces:**
- Consumes: 없음 (순수 · 독립)
- Produces:
  ```ts
  export type RelayLine =
    | { readonly kind: "up"; readonly url: string }
    | { readonly kind: "request"; readonly id: number; readonly method: string; readonly tool?: string; readonly args?: unknown; readonly case?: string }
    | { readonly kind: "response"; readonly id: number; readonly ok: boolean; readonly tool?: string; readonly bytes?: number; readonly ms?: number; readonly body?: unknown; readonly code?: number; readonly message?: string; readonly case?: string }
    | { readonly kind: "drop"; readonly method: string };
  export class RelayLineReader {
    push(chunk: string): readonly RelayLine[];
    readonly skipped: number;
  }
  ```

**왜 클래스인가 · 왜 `skipped` 인가.** ① stderr 는 청크로 오고 줄 경계에서 잘리지 않는다 — 반쪽 줄을 들고 있을 곳이 필요하다. ② **자식 서버의 stderr 가 같은 채널로 흐른다**(설계 §8). JSON 이 아닌 줄은 건너뛰되 **몇 건인지 센다** — 전부 건너뛰고 「기록 0 건」이 되면 사용자는 자기 서버가 조용한 줄 안다.

**응답 줄에는 `method` 가 없다**(계획 단계 실측). `jsonResponse` 의 머리는 `{dir,id,tool}` 뿐이다. 메서드 이름이 필요하면 **같은 `id` 의 요청 줄**에서 가져온다 — 그 짝짓기는 이 파서가 아니라 쓰는 쪽(Task 5 의 뷰모델)이 한다. 파서는 줄 하나를 그대로 옮기는 것까지만 한다.

- [ ] **Step 1: 실패 테스트를 쓴다**

`packages/dashboard/tests/relay-lines.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RelayLineReader } from "../src/server/relay-lines.js";

const UP = '{"dir":"up","port":51234,"url":"http://127.0.0.1:51234/mcp"}';
const REQ =
  '{"dir":"req","id":3,"method":"tools/call","tool":"get_weather","args":{"city":"서울"},"case":"c1"}';
const RES =
  '{"dir":"res","id":3,"tool":"get_weather","ok":true,"bytes":97,"ms":2,"body":{"content":[]},"case":"c1"}';

describe("중계기 줄 파서", () => {
  it("기동 줄에서 URL 을 읽는다", () => {
    expect(new RelayLineReader().push(`${UP}\n`)).toEqual([
      { kind: "up", url: "http://127.0.0.1:51234/mcp" },
    ]);
  });

  it("요청·응답 줄을 꼬리표와 함께 낸다", () => {
    const reader = new RelayLineReader();
    expect(reader.push(`${REQ}\n${RES}\n`)).toEqual([
      {
        kind: "request",
        id: 3,
        method: "tools/call",
        tool: "get_weather",
        args: { city: "서울" },
        case: "c1",
      },
      {
        kind: "response",
        id: 3,
        ok: true,
        tool: "get_weather",
        bytes: 97,
        ms: 2,
        body: { content: [] },
        case: "c1",
      },
    ]);
  });

  it("JSON 이 아닌 줄을 건너뛰고 그 건수를 센다", () => {
    // 자식 서버의 stderr 가 같은 채널로 흐른다. 여기서 죽으면 관찰 채널이 통째로 끊긴다.
    const reader = new RelayLineReader();
    const lines = reader.push(`[server] listening on stdio\n${REQ}\n그냥 한국어 로그\n`);
    expect(lines).toHaveLength(1);
    expect(reader.skipped).toBe(2);
  });

  it("JSON 이지만 우리 모양이 아닌 줄도 건너뛴다", () => {
    const reader = new RelayLineReader();
    expect(reader.push('{"level":"info","msg":"ready"}\n')).toEqual([]);
    expect(reader.skipped).toBe(1);
  });

  it("청크가 줄 중간에서 잘려도 이어 붙인다", () => {
    const reader = new RelayLineReader();
    expect(reader.push(REQ.slice(0, 20))).toEqual([]);
    expect(reader.push(`${REQ.slice(20)}\n`)).toHaveLength(1);
    expect(reader.skipped).toBe(0);
  });

  it("꼬리표가 없으면 case 필드도 없다", () => {
    const reader = new RelayLineReader();
    const [line] = reader.push('{"dir":"req","id":1,"method":"initialize"}\n');
    expect(line).toEqual({ kind: "request", id: 1, method: "initialize" });
  });

  it("프로토콜 오류 줄은 body 없이 코드와 메시지를 낸다", () => {
    const reader = new RelayLineReader();
    expect(
      reader.push('{"dir":"res","id":4,"ok":false,"code":-32602,"message":"bad","ms":1}\n'),
    ).toEqual([{ kind: "response", id: 4, ok: false, ms: 1, code: -32602, message: "bad" }]);
  });

  it("버린 줄을 낸다", () => {
    const reader = new RelayLineReader();
    expect(reader.push('{"dir":"drop","kind":"request","method":"sampling/createMessage"}\n')).toEqual(
      [{ kind: "drop", method: "sampling/createMessage" }],
    );
  });

  it("빈 줄은 건너뛴 것으로 세지 않는다", () => {
    const reader = new RelayLineReader();
    reader.push("\n\n");
    expect(reader.skipped).toBe(0);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && corepack pnpm vitest run packages/dashboard/tests/relay-lines.test.ts`
Expected: FAIL — import 해결 실패

- [ ] **Step 3: 구현한다**

`packages/dashboard/src/server/relay-lines.ts`:

```ts
/**
 * 중계기 stderr 를 타입 있는 줄로 바꾼다. **순수** — 프로세스도 시간도 모른다.
 *
 * **자식 서버의 stderr 가 같은 채널로 흐른다**(설계 §8). JSON 이 아닌 줄은 건너뛰되 건수를
 * 센다 — 전부 건너뛰어 「기록 0 건」이 되면 사용자는 자기 서버가 조용한 줄 알고, 그것이
 * 거짓이면 진단이 통째로 틀어진다.
 *
 * **응답 줄에는 `method` 가 없다**(`relay-log.ts` 의 `jsonResponse`). 메서드 이름이 필요한
 * 쪽은 같은 `id` 의 요청 줄에서 가져온다. 여기서 지어내지 않는다.
 */

export type RelayLine =
  | { readonly kind: "up"; readonly url: string }
  | {
      readonly kind: "request";
      readonly id: number;
      readonly method: string;
      readonly tool?: string;
      readonly args?: unknown;
      readonly case?: string;
    }
  | {
      readonly kind: "response";
      readonly id: number;
      readonly ok: boolean;
      readonly tool?: string;
      readonly bytes?: number;
      readonly ms?: number;
      readonly body?: unknown;
      readonly code?: number;
      readonly message?: string;
      readonly case?: string;
    }
  | { readonly kind: "drop"; readonly method: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const optional = <T>(key: string, value: unknown, guard: (v: unknown) => v is T) =>
  guard(value) ? { [key]: value } : {};

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number";
const isDefined = (value: unknown): value is unknown => value !== undefined;

function toLine(raw: Record<string, unknown>): RelayLine | null {
  if (raw.dir === "up" && typeof raw.url === "string") return { kind: "up", url: raw.url };
  if (raw.dir === "drop" && typeof raw.method === "string")
    return { kind: "drop", method: raw.method };
  if (raw.dir === "req" && typeof raw.id === "number" && typeof raw.method === "string") {
    return {
      kind: "request",
      id: raw.id,
      method: raw.method,
      ...optional("tool", raw.tool, isString),
      ...optional("args", raw.args, isDefined),
      ...optional("case", raw.case, isString),
    };
  }
  if (raw.dir === "res" && typeof raw.id === "number" && typeof raw.ok === "boolean") {
    return {
      kind: "response",
      id: raw.id,
      ok: raw.ok,
      ...optional("tool", raw.tool, isString),
      ...optional("bytes", raw.bytes, isNumber),
      ...optional("ms", raw.ms, isNumber),
      ...optional("body", raw.body, isDefined),
      ...optional("code", raw.code, isNumber),
      ...optional("message", raw.message, isString),
    };
  }
  return null;
}

export class RelayLineReader {
  /** JSON 이 아니거나 우리 모양이 아니어서 버린 줄의 수. 빈 줄은 세지 않는다. */
  skipped = 0;
  /** 청크 경계에 걸린 반쪽 줄. */
  private buffer = "";

  push(chunk: string): readonly RelayLine[] {
    this.buffer += chunk;
    const parts = this.buffer.split("\n");
    // 마지막 조각은 아직 줄이 아니다. 다음 청크와 이어 붙인다.
    this.buffer = parts.pop() ?? "";
    const lines: RelayLine[] = [];
    for (const part of parts) {
      if (part.trim() === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(part);
      } catch {
        this.skipped += 1;
        continue;
      }
      const line = isRecord(parsed) ? toLine(parsed) : null;
      if (line === null) {
        this.skipped += 1;
        continue;
      }
      lines.push(line);
    }
    return lines;
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && corepack pnpm vitest run packages/dashboard/tests/relay-lines.test.ts`
Expected: PASS — `Tests  9 passed (9)`

- [ ] **Step 5: 보고하고 멈춘다**

```
feat(dashboard): 중계기 기록 줄을 파싱하고 JSON 아닌 줄을 세어 건너뛴다
```

---

## Task 4: 중계 세션과 통로 셋

**Files:**
- Create: `packages/dashboard/src/server/relay-session.ts`
- Modify: `packages/dashboard/src/api-types.ts` · `packages/dashboard/src/server/routes.ts` · `packages/dashboard/src/server/sse.ts` · `packages/dashboard/src/index.ts` · `packages/dashboard/package.json`
- Test: `packages/dashboard/tests/relay-session.test.ts` · `packages/dashboard/tests/relay-routes.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `planRelayCases` · `RelayPlan` · `RelayCase`, Task 2 의 `buildRelayAiArgs`, Task 3 의 `RelayLineReader` · `RelayLine`
- Produces:
  ```ts
  // api-types.ts
  export type RelayEventInput =
    | { readonly kind: "up"; readonly url: string }
    | { readonly kind: "call"; readonly case?: string; readonly tool?: string; readonly method: string; readonly args?: unknown }
    | { readonly kind: "result"; readonly case?: string; readonly tool?: string; readonly ok: boolean; readonly bytes?: number; readonly ms?: number; readonly body?: unknown; readonly code?: number; readonly message?: string }
    | { readonly kind: "aiDone"; readonly case: string; readonly ok: boolean; readonly failure?: string }
    | { readonly kind: "notice"; readonly message: string }
    | { readonly kind: "done" };
  export type RelayEvent = RelayEventInput & { readonly id: number };
  export interface StartRelayRequest {
    readonly suitePath: string;
    readonly command: string;
    readonly args: readonly string[];
    readonly envNames: readonly string[];
    readonly serverId?: string;
    readonly model: string;
  }
  export interface StartRelayResponse { readonly relayId: string; readonly cases: readonly RelayCase[] }
  // relay-session.ts
  export class RelaySessionRegistry { start(...): Promise<RelaySession | { error: string }>; get(id): RelaySession | undefined }
  ```

**통로를 `/api/runs` 에 얹지 않는 이유**(설계 §2-8): 중계기는 **스스로 끝나지 않는 유일한 실행**이다. 「그만」이라고 말하는 길이 필요한데 run 쪽에는 그 길이 없다 — `RunRegistry` 에는 취소가 없고, `RunSummary` 의 `exitCode`·`status` 는 끝나는 실행을 전제로 한 모양이다.

- [ ] **Step 1: 의존을 선언한다**

`packages/dashboard/package.json` 의 `dependencies` 에 한 줄을 더한다 (알파벳 순서 무관 — 기존 목록도 순서가 아니다):

```json
    "@mcpeak/mock": "workspace:*",
```

Run: `cd /Users/cheonjamin/projects/mcptest && corepack pnpm install`

- [ ] **Step 2: 세션의 실패 테스트를 쓴다 (프로세스를 띄우지 않는다)**

`packages/dashboard/tests/relay-session.test.ts`:

```ts
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { RelayEvent } from "../src/api-types.js";
import { RelaySessionRegistry } from "../src/server/relay-session.js";

const SUITE = JSON.stringify({
  cases: [
    { id: "a", operation: { type: "callTool", tool: "get_weather", input: { city: "서울" } } },
    { id: "b", operation: { type: "callTool", tool: "add", input: { a: 1, b: 2 } } },
  ],
});

/** 중계기 자리에 세울 가짜. stderr 로 줄을 흘리고 kill 을 기록한다. */
class FakeRelay extends EventEmitter {
  readonly stderr = new EventEmitter();
  readonly signals: string[] = [];
  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    // 실제 중계기는 SIGTERM 에 닫히고 close 를 낸다.
    queueMicrotask(() => this.emit("close"));
    return true;
  }
  line(text: string): void {
    this.stderr.emit("data", Buffer.from(`${text}\n`, "utf8"));
  }
}

function harness(options: { readonly onAi?: (tag: string) => Promise<{ ok: boolean }> } = {}) {
  const relay = new FakeRelay();
  const aiArgs: (readonly string[])[] = [];
  const order: string[] = [];
  const registry = new RelaySessionRegistry({
    readSuite: () => Promise.resolve(SUITE),
    spawnRelay: (args) => {
      order.push(`relay:${args.join(" ")}`);
      return relay;
    },
    runAi: (spec) => {
      aiArgs.push(spec.args);
      order.push(`ai:${spec.tag}`);
      return (options.onAi?.(spec.tag) ?? Promise.resolve({ ok: true })).then((r) => r);
    },
  });
  return { relay, aiArgs, order, registry };
}

const START = {
  suitePath: "s.json",
  command: "node",
  args: ["server.mjs"],
  envNames: ["API_KEY"],
  model: "sonnet",
} as const;

describe("중계 세션", () => {
  it("기동 줄을 읽고 나서야 AI 를 띄운다", async () => {
    const { relay, order, registry } = harness();
    const started = registry.start(START);
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    const session = await started;
    if ("error" in session) throw new Error(session.error);
    expect(order[0]).toMatch(/^relay:/);
    expect(order.slice(1).sort()).toEqual(["ai:c1", "ai:c2"]);
  });

  it("케이스마다 자기 꼬리표가 붙은 URL 을 받는다", async () => {
    const { relay, aiArgs, registry } = harness();
    const started = registry.start(START);
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    await started;
    const urls = aiArgs
      .map((args) => JSON.parse(args[args.indexOf("--mcp-config") + 1] as string))
      .map((config: { mcpServers: { target: { url: string } } }) => config.mcpServers.target.url)
      .sort();
    expect(urls).toEqual([
      "http://127.0.0.1:1/mcp?case=c1",
      "http://127.0.0.1:1/mcp?case=c2",
    ]);
  });

  it("중계기 --env 에 서버 후보의 환경변수 이름이 실린다", async () => {
    const { relay, order, registry } = harness();
    const started = registry.start(START);
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    await started;
    expect(order[0]).toContain("--env API_KEY");
    expect(order[0]).toContain("-- node server.mjs");
  });

  it("기록 줄이 이벤트로 흐른다", async () => {
    const { relay, registry } = harness();
    const started = registry.start(START);
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    const session = await started;
    if ("error" in session) throw new Error(session.error);
    const seen: RelayEvent[] = [];
    session.subscribe((event) => seen.push(event));
    relay.line(
      '{"dir":"res","id":3,"tool":"get_weather","ok":true,"bytes":97,"ms":2,"body":{"x":1},"case":"c1"}',
    );
    expect(seen).toEqual([
      {
        id: expect.any(Number) as unknown as number,
        kind: "result",
        case: "c1",
        tool: "get_weather",
        ok: true,
        bytes: 97,
        ms: 2,
        body: { x: 1 },
      },
    ]);
  });

  it("AI 가 끝나면 케이스마다 aiDone 이 나간다", async () => {
    const { relay, registry } = harness({
      onAi: (tag) => Promise.resolve({ ok: tag === "c1" }),
    });
    const started = registry.start(START);
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    const session = await started;
    if ("error" in session) throw new Error(session.error);
    await session.settled;
    const kinds = session.events.filter((event) => event.kind === "aiDone");
    expect(kinds).toHaveLength(2);
    expect(session.events.at(-1)?.kind).toBe("done");
  });

  it("닫기는 중계기에 SIGTERM 을 보내고 닫힐 때까지 기다린다", async () => {
    const { relay, registry } = harness();
    const started = registry.start(START);
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    const session = await started;
    if ("error" in session) throw new Error(session.error);
    await session.close();
    expect(relay.signals).toEqual(["SIGTERM"]);
  });

  it("두 번 닫아도 신호는 한 번만 간다", async () => {
    const { relay, registry } = harness();
    const started = registry.start(START);
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    const session = await started;
    if ("error" in session) throw new Error(session.error);
    await Promise.all([session.close(), session.close()]);
    expect(relay.signals).toEqual(["SIGTERM"]);
  });

  it("스위트에 callTool 케이스가 없으면 중계기를 띄우지 않는다", async () => {
    const relay = new FakeRelay();
    let spawned = 0;
    const registry = new RelaySessionRegistry({
      readSuite: () => Promise.resolve(JSON.stringify({ cases: [] })),
      spawnRelay: () => {
        spawned += 1;
        return relay;
      },
      runAi: () => Promise.resolve({ ok: true }),
    });
    const result = await registry.start(START);
    expect("error" in result).toBe(true);
    expect(spawned).toBe(0);
  });

  it("건너뛴 케이스가 있으면 안내 이벤트로 알린다", async () => {
    const relay = new FakeRelay();
    const registry = new RelaySessionRegistry({
      readSuite: () =>
        Promise.resolve(
          JSON.stringify({
            cases: [
              { id: "a", operation: { type: "callTool", tool: "t", input: {} } },
              { id: "only-list", operation: { type: "listTools" } },
            ],
          }),
        ),
      spawnRelay: () => relay,
      runAi: () => Promise.resolve({ ok: true }),
    });
    const started = registry.start(START);
    relay.line('{"dir":"up","port":1,"url":"http://127.0.0.1:1/mcp"}');
    const session = await started;
    if ("error" in session) throw new Error(session.error);
    const notice = session.events.find((event) => event.kind === "notice");
    expect(notice).toMatchObject({
      message: "→ 툴을 부르지 않는 케이스 1 건은 띄우지 않았습니다: only-list",
    });
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && corepack pnpm vitest run packages/dashboard/tests/relay-session.test.ts`
Expected: FAIL — import 해결 실패

- [ ] **Step 4: `api-types.ts` 에 중계 타입을 더한다**

```ts
/** 중계 세션이 브라우저로 흘리는 이벤트. `RunEvent` 와 별개다 — 실행이 아니라 관찰이다. */
export type RelayEventInput =
  | { readonly kind: "up"; readonly url: string }
  | {
      readonly kind: "call";
      readonly case?: string;
      readonly method: string;
      readonly tool?: string;
      readonly args?: unknown;
    }
  | {
      readonly kind: "result";
      readonly case?: string;
      readonly tool?: string;
      readonly ok: boolean;
      readonly bytes?: number;
      readonly ms?: number;
      readonly body?: unknown;
      readonly code?: number;
      readonly message?: string;
    }
  /**
   * AI 프로세스 하나가 끝났다. **`ok` 가 성공을 뜻하지 않는다** — 권한에 막혀도 `claude` 는
   * 0 으로 끝난다(설계 §3). 툴을 불렀는지는 `call` 이벤트로만 판정한다. 이 이벤트가 말하는
   * 것은 "이 케이스는 더 기다릴 것이 없다" 하나다.
   */
  | { readonly kind: "aiDone"; readonly case: string; readonly ok: boolean; readonly failure?: string }
  | { readonly kind: "notice"; readonly message: string }
  | { readonly kind: "done" };

export type RelayEvent = RelayEventInput & { readonly id: number };

/** POST /api/relay */
export interface StartRelayRequest {
  readonly suitePath: string;
  readonly command: string;
  readonly args: readonly string[];
  /** 중계기 `--env` 에 실을 **이름**. 값은 브라우저를 지나지 않는다(설계 §4.3 과 같은 규칙). */
  readonly envNames: readonly string[];
  readonly serverId?: string;
  readonly model: string;
}

export interface StartRelayResponse {
  readonly relayId: string;
  readonly cases: readonly RelayCase[];
}
```

- [ ] **Step 5: `sse.ts` 의 형을 한 칸 넓힌다**

`formatSseEvent` · `formatSseEvents` 가 `RunEvent` 만 받는다. 중계 이벤트도 같은 직렬화를 쓰므로 **`id` 만 요구하도록** 넓힌다. 기존 호출부는 그대로 컴파일된다.

```ts
/** `id` 를 가진 이벤트면 무엇이든 받는다 — run 과 중계 세션이 같은 직렬화를 쓴다. */
export function formatSseEvent(event: { readonly id: number }): string {
  return `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function formatSseEvents(events: readonly { readonly id: number }[]): string {
  return events.map(formatSseEvent).join("");
}
```

`import type { RunEvent }` 가 더 이상 쓰이지 않으면 지운다(린트가 잡는다).

- [ ] **Step 6: 세션을 구현한다**

`packages/dashboard/src/server/relay-session.ts`:

```ts
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { CLAUDE_ENV_ALLOWLIST, runProviderProcess } from "@mcpeak/generate";
import { relayBinPath } from "@mcpeak/mock";
import type { RelayCase, RelayEvent, RelayEventInput, StartRelayRequest } from "../api-types.js";
import { buildRelayAiArgs } from "./relay-argv.js";
import { RelayLineReader } from "./relay-lines.js";
import { planRelayCases } from "./relay-questions.js";

/** AI 한 대에 주는 시간. 툴 한 번 부르고 끝나는 일이라 authoring 보다 짧다. */
const AI_TIMEOUT_MS = 120_000;
/** AI stdout 상한. `--output-format json` 봉투 하나라 크지 않다. */
const AI_MAX_OUTPUT_BYTES = 1_000_000;
/** 기동 줄을 기다리는 시간. 넘으면 중계기가 못 떴다고 본다. */
const RELAY_START_TIMEOUT_MS = 15_000;

/** 중계기 자식. 테스트가 가짜로 바꿔 끼울 수 있게 최소면만 요구한다. */
export interface RelayChild {
  readonly stderr: { on(event: "data", listener: (chunk: Buffer) => void): unknown };
  kill(signal: NodeJS.Signals): boolean;
  on(event: "close", listener: () => void): unknown;
}

export interface RelayAiSpec {
  readonly tag: string;
  readonly args: readonly string[];
  readonly stdin: string;
}

export interface RelaySessionDeps {
  readonly readSuite: (suitePath: string) => Promise<string>;
  readonly spawnRelay: (args: readonly string[]) => RelayChild;
  readonly runAi: (spec: RelayAiSpec) => Promise<{ readonly ok: boolean; readonly failure?: string }>;
}

/**
 * `generate` 의 비공개 `environment()` 와 같은 일을 한다. 그쪽은 export 되지 않아 여기서
 * 다시 적되, **목록은 공개된 것을 쓴다**(`CLAUDE_ENV_ALLOWLIST`). 합집합
 * `PROVIDER_ENV_ALLOWLIST` 를 쓰면 `claude` 자식이 `OPENAI_API_KEY` 를 받는데,
 * `providers.ts:26-29` 의 주석이 금하는 것이 정확히 그것이다(ADR-0104).
 */
function aiEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    CLAUDE_ENV_ALLOWLIST.flatMap((key) => (source[key] === undefined ? [] : [[key, source[key]]])),
  );
}

export class RelaySession {
  readonly relayId = crypto.randomUUID(); // UI 식별 전용. 산출물에 안 들어간다(RunRegistry 와 같다).
  readonly cases: readonly RelayCase[];
  /** 모든 AI 가 끝나면 풀린다. 테스트가 기다릴 자리다. */
  readonly settled: Promise<void>;

  private readonly accumulated: RelayEvent[] = [];
  private readonly listeners = new Set<(event: RelayEvent) => void>();
  private closing: Promise<void> | undefined;

  constructor(
    private readonly child: RelayChild,
    cases: readonly RelayCase[],
    settled: Promise<void>,
  ) {
    this.cases = cases;
    this.settled = settled;
  }

  get events(): readonly RelayEvent[] {
    return this.accumulated;
  }

  /**
   * 늦은 구독자에게 과거 이벤트를 다시 보내는 것은 호출부 몫이다 — `RunRecord.subscribe` 와
   * 같은 이유이고 같은 모양이다(재전송과 라이브 사이에 틈이 생기면 중복·누락이 난다).
   */
  subscribe(listener: (event: RelayEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: RelayEventInput): void {
    const identified = { ...event, id: this.accumulated.length + 1 } as RelayEvent;
    this.accumulated.push(identified);
    for (const listener of this.listeners) listener(identified);
  }

  /**
   * 중계기와 그 자식 서버를 닫고 **닫힌 것을 확인한 뒤** 반환한다. 멱등이다.
   *
   * AI 프로세스는 따로 죽이지 않는다 — 중계기가 닫히면 MCP 접속이 끊겨 스스로 끝나고,
   * 그래도 남으면 `runProviderProcess` 의 타임아웃이 SIGTERM · SIGKILL 로 올라간다.
   */
  close(): Promise<void> {
    this.closing ??= new Promise<void>((resolve) => {
      this.child.on("close", () => resolve());
      try {
        this.child.kill("SIGTERM");
      } catch {
        // 이미 죽었으면 close 가 오지 않을 수 있다. 아래 타이머가 푼다.
      }
      setTimeout(resolve, 5_000).unref?.();
    });
    return this.closing;
  }
}

const systemDeps: RelaySessionDeps = {
  readSuite: () => {
    throw new Error("readSuite 는 호출부가 주입한다");
  },
  // `relayBinPath()` 는 실행 권한이 아니라 파일 경로를 준다. shebang 에 기대지 않고
  // 지금 도는 node 로 직접 띄운다 — 사용자의 PATH 에 다른 node 가 있어도 같은 런타임이다.
  spawnRelay: (args) =>
    spawn(process.execPath, [relayBinPath(), ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    }) as unknown as RelayChild,
  runAi: async (spec) => {
    const result = await runProviderProcess({
      command: "claude",
      args: spec.args,
      stdin: spec.stdin,
      timeoutMs: AI_TIMEOUT_MS,
      env: aiEnvironment(process.env),
      cwdPrefix: tmpdir(),
      maxOutputBytes: AI_MAX_OUTPUT_BYTES,
    });
    return result.ok ? { ok: true } : { ok: false, failure: result.code };
  },
};

export class RelaySessionRegistry {
  private readonly sessions = new Map<string, RelaySession>();

  constructor(private readonly deps: Partial<RelaySessionDeps> = {}) {}

  get(relayId: string): RelaySession | undefined {
    return this.sessions.get(relayId);
  }

  async start(
    request: StartRelayRequest,
    readSuite?: (suitePath: string) => Promise<string>,
  ): Promise<RelaySession | { readonly error: string }> {
    const deps: RelaySessionDeps = {
      readSuite: this.deps.readSuite ?? readSuite ?? systemDeps.readSuite,
      spawnRelay: this.deps.spawnRelay ?? systemDeps.spawnRelay,
      runAi: this.deps.runAi ?? systemDeps.runAi,
    };
    let content: string;
    try {
      content = await deps.readSuite(request.suitePath);
    } catch {
      return {
        error: `→ 스위트 파일을 읽지 못했습니다: ${request.suitePath}\n→ 2 단계로 돌아가 파일이 그 자리에 있는지 확인하세요.`,
      };
    }
    const plan = planRelayCases(content);
    // **중계기를 띄우기 전에** 계획이 서는지 본다. 못 서면 아무 프로세스도 띄우지 않는다 —
    // 띄운 뒤 실패하면 사용자에게 닫으라고 말할 대상만 남는다.
    if ("error" in plan) return plan;

    const relayArgs = [
      "--json",
      "--port",
      "0",
      ...request.envNames.flatMap((name) => ["--env", name]),
      "--",
      request.command,
      ...request.args,
    ];
    const child = deps.spawnRelay(relayArgs);
    const reader = new RelayLineReader();

    let session: RelaySession | undefined;
    let settleAll: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      settleAll = resolve;
    });

    const url = await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), RELAY_START_TIMEOUT_MS);
      timer.unref?.();
      child.stderr.on("data", (chunk: Buffer) => {
        for (const line of reader.push(chunk.toString("utf8"))) {
          if (line.kind === "up") {
            clearTimeout(timer);
            resolve(line.url);
            session?.emit({ kind: "up", url: line.url });
            continue;
          }
          if (session === undefined) continue;
          if (line.kind === "request") {
            session.emit({
              kind: "call",
              method: line.method,
              ...(line.case === undefined ? {} : { case: line.case }),
              ...(line.tool === undefined ? {} : { tool: line.tool }),
              ...(line.args === undefined ? {} : { args: line.args }),
            });
          } else if (line.kind === "response") {
            const { kind: _kind, id: _id, ...rest } = line;
            session.emit({ kind: "result", ...rest });
          }
          // `drop` 은 화면에 칸이 없다. 버린 것은 자식이 먼저 건 것이라 케이스를 말할 근거가 없다.
        }
      });
    });

    if (url === null) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* 이미 죽었으면 할 일이 없다. */
      }
      return {
        error: [
          "→ 중계기가 기동 줄을 내지 않았습니다. 서버 명령이 stdio MCP 서버가 맞는지 확인하세요.",
          `→ 실행한 명령: ${request.command} ${request.args.join(" ")}`,
          "→ 터미널에서 같은 명령을 직접 띄워 서버가 뜨는지 먼저 보세요.",
        ].join("\n"),
      };
    }

    session = new RelaySession(child, plan.cases, settled);
    session.emit({ kind: "up", url });
    if (plan.skipped.length > 0) {
      session.emit({
        kind: "notice",
        message: `→ 툴을 부르지 않는 케이스 ${plan.skipped.length} 건은 띄우지 않았습니다: ${plan.skipped.join(", ")}`,
      });
    }
    this.sessions.set(session.relayId, session);

    const current = session;
    // **동시에 띄운다**(설계 §2-3). 케이스들이 한 서버를 같이 치는 대가는 사용자가 알고 고른 것이다.
    void Promise.all(
      plan.cases.map(async (relayCase) => {
        const result = await deps.runAi({
          tag: relayCase.tag,
          args: buildRelayAiArgs({ model: request.model, url, tag: relayCase.tag }),
          stdin: plan.prompts[relayCase.tag] ?? "",
        });
        current.emit({
          kind: "aiDone",
          case: relayCase.id,
          ok: result.ok,
          ...(result.failure === undefined ? {} : { failure: result.failure }),
        });
      }),
    ).then(() => {
      current.emit({ kind: "done" });
      settleAll();
    });

    return session;
  }
}
```

- [ ] **Step 7: 세션 테스트 통과를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && corepack pnpm vitest run packages/dashboard/tests/relay-session.test.ts`
Expected: PASS — `Tests  9 passed (9)`

- [ ] **Step 8: 통로 셋의 실패 테스트를 쓴다**

`packages/dashboard/tests/relay-routes.test.ts` — `tests/routes.test.ts` 의 서버 기동 모양을 그대로 따른다. **먼저 그 파일을 읽고 같은 헬퍼 모양을 쓴다**(`startDashboardServer` 를 `port: 0` 으로 띄우고 `fetch` 로 친다).

```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { StartRelayResponse } from "../src/api-types.js";
import { startDashboardServer } from "../src/index.js";

const SUITE = JSON.stringify({
  cases: [{ id: "a", operation: { type: "callTool", tool: "get_weather", input: { city: "서울" } } }],
});

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

async function server() {
  const root = await mkdtemp(join(tmpdir(), "relay-routes-"));
  await writeFile(join(root, "s.suite.json"), SUITE, "utf8");
  const handle = await startDashboardServer({ port: 0, root });
  close = handle.close;
  return { base: `http://127.0.0.1:${handle.port}`, root };
}

describe("중계 통로", () => {
  it("본문이 모자라면 무엇이 빠졌는지 말한다", async () => {
    const { base } = await server();
    const response = await fetch(`${base}/api/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ suitePath: "s.suite.json" }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "suitePath·command·args·envNames·model 이 필요합니다.",
    });
  });

  it("없는 중계 세션의 SSE 는 404 다", async () => {
    const { base } = await server();
    const response = await fetch(`${base}/api/relay/nope/events`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "그런 중계 세션이 없습니다." });
  });

  it("없는 중계 세션을 닫아도 404 다", async () => {
    const { base } = await server();
    const response = await fetch(`${base}/api/relay/nope`, { method: "DELETE" });
    expect(response.status).toBe(404);
  });

  it("스위트에 부를 툴이 없으면 400 으로 거절한다", async () => {
    const { base, root } = await server();
    await writeFile(join(root, "empty.suite.json"), JSON.stringify({ cases: [] }), "utf8");
    const response = await fetch(`${base}/api/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        suitePath: "empty.suite.json",
        command: "node",
        args: [],
        envNames: [],
        model: "sonnet",
      }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("툴을 부르는 케이스가 없습니다");
  });

  it("허용되지 않는 경로의 스위트는 거절한다", async () => {
    const { base } = await server();
    const response = await fetch(`${base}/api/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        suitePath: "../../etc/passwd",
        command: "node",
        args: [],
        envNames: [],
        model: "sonnet",
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "허용되지 않는 경로입니다." });
  });
});

// 위 다섯은 프로세스를 띄우지 않는다 — 전부 중계기 기동 **전에** 거절되는 갈래다.
// 진짜 중계기를 띄우는 성공 경로는 Task 7 의 E2E 가 본다(직렬 웨이브).
```

> 위 테스트는 `StartRelayResponse` 를 쓰지 않는다. **첫 줄의 `import type { StartRelayResponse }` 를 지우고 시작해라** — 미사용 import 는 biome 이 잡는다.

- [ ] **Step 9: 실패를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && corepack pnpm vitest run packages/dashboard/tests/relay-routes.test.ts`
Expected: FAIL — 전부 404 `그런 경로가 없습니다: POST /api/relay`

- [ ] **Step 10: 라우트를 더한다**

`routes.ts` 상단 import 에 더한다:

```ts
import type { ApiError, StartRelayRequest, StartRelayResponse } from "../api-types.js";
import type { RelaySessionRegistry } from "./relay-session.js";
```

`RouterOptions` 에 한 줄:

```ts
  /** 중계 세션 레지스트리. run 과 별개다 — 중계기는 스스로 끝나지 않는 유일한 실행이다(설계 §2-8). */
  readonly relays: RelaySessionRegistry;
```

`handleRequest` 의 `/api/runs` 블록 **앞**에 세 갈래를 넣는다 (`/api/` 404 폴백보다 위면 순서는 자유):

```ts
  if (method === "POST" && pathname === "/api/relay") {
    await handleStartRelay(request, response, options.root, options.relays);
    return;
  }
  if (method === "GET" && pathname.startsWith("/api/relay/") && pathname.endsWith("/events")) {
    handleRelayEvents(request, response, options.relays, extractId(pathname, "/api/relay/", "/events"));
    return;
  }
  if (method === "DELETE" && pathname.startsWith("/api/relay/")) {
    await handleCloseRelay(response, options.relays, decodeParam(pathname, "/api/relay/") ?? "");
    return;
  }
```

`extractRunId` 를 일반화해 재사용한다(기존 호출부는 `extractId(pathname, "/api/runs/", suffix)` 로 바꾼다):

```ts
function extractId(pathname: string, prefix: string, suffix: string): string {
  const raw = pathname.slice(prefix.length, pathname.length - suffix.length);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
```

핸들러 셋을 파일 끝에 더한다:

```ts
function isStartRelayRequest(value: unknown): value is StartRelayRequest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.suitePath === "string" &&
    typeof record.command === "string" &&
    typeof record.model === "string" &&
    Array.isArray(record.args) &&
    record.args.every((item) => typeof item === "string") &&
    Array.isArray(record.envNames) &&
    record.envNames.every((item) => typeof item === "string") &&
    (record.serverId === undefined || typeof record.serverId === "string")
  );
}

async function handleStartRelay(
  request: IncomingMessage,
  response: ServerResponse,
  root: string,
  relays: RelaySessionRegistry,
): Promise<void> {
  const body = await readJsonBody<unknown>(request);
  if (body === undefined) {
    sendJson(response, 400, { error: "본문이 올바른 JSON이 아닙니다." });
    return;
  }
  if (!isStartRelayRequest(body)) {
    sendJson(response, 400, { error: "suitePath·command·args·envNames·model 이 필요합니다." });
    return;
  }
  // 경로 가드는 파일 라우트와 같은 한 곳을 쓴다. 두 벌이 되면 한쪽만 고쳐지는 사고가 난다.
  const absolute = resolveProjectPath(root, body.suitePath);
  if (absolute === null) {
    sendJson(response, 400, { error: "허용되지 않는 경로입니다." });
    return;
  }
  // 후보를 골랐으면 그 후보의 `.mcp.json` env 를 **여기서** 값으로 바꿔 중계기에 물린다.
  // 값은 이 프로세스 안에서만 살고 argv 에도 응답에도 실리지 않는다(설계 §4.3 과 같은 규칙).
  if (body.serverId !== undefined) {
    const candidateEnv = await resolveCandidateEnv(root, body.serverId, process.env);
    if (candidateEnv === undefined) {
      sendJson(response, 400, { error: `서버 후보를 찾을 수 없습니다: ${body.serverId}` });
      return;
    }
  }
  const session = await relays.start(body, async () => (await readFileContent(root, absolute)).content);
  if ("error" in session) {
    sendJson(response, 400, session);
    return;
  }
  const result: StartRelayResponse = { relayId: session.relayId, cases: session.cases };
  sendJson(response, 200, result);
}

/** run 의 SSE 와 같은 모양이다 — 과거 이벤트를 동기 구간에서 흘리고 이어서 구독한다. */
function handleRelayEvents(
  request: IncomingMessage,
  response: ServerResponse,
  relays: RelaySessionRegistry,
  relayId: string,
): void {
  const session = relays.get(relayId);
  if (session === undefined) {
    sendJson(response, 404, { error: "그런 중계 세션이 없습니다." });
    return;
  }
  response.writeHead(200, SSE_HEADERS);
  response.write(formatSseEvents(session.events));
  const unsubscribe = session.subscribe((event) => {
    response.write(formatSseEvent(event));
  });
  response.on("close", unsubscribe);
}

/**
 * **닫힌 것을 확인하고 나서 응답한다.** 브라우저의 `[실행 시작]` 이 이 응답을 기다렸다가
 * 판정 실행을 시작하므로(설계 §1), 여기서 먼저 답하면 같은 서버가 두 벌 뜬다.
 */
async function handleCloseRelay(
  response: ServerResponse,
  relays: RelaySessionRegistry,
  relayId: string,
): Promise<void> {
  const session = relays.get(relayId);
  if (session === undefined) {
    sendJson(response, 404, { error: "그런 중계 세션이 없습니다." });
    return;
  }
  await session.close();
  response.writeHead(204);
  response.end();
}
```

`index.ts` 에서 레지스트리를 만들어 넘긴다:

```ts
import { RelaySessionRegistry } from "./server/relay-session.js";
// …
  const registry = new RunRegistry();
  const relays = new RelaySessionRegistry();
  const server = createServer((request, response) => {
    handleRequest(request, response, { root: options.root, webDist: WEB_DIST, registry, relays })
```

`tests/routes.test.ts` 가 `handleRequest` 를 직접 부른다면 그 호출부에도 `relays: new RelaySessionRegistry()` 를 더한다. **먼저 그 파일을 읽어 확인한다.**

- [ ] **Step 11: 통로 테스트 통과를 확인한다**

```bash
cd /Users/cheonjamin/projects/mcptest
corepack pnpm vitest run packages/dashboard/tests/relay-routes.test.ts
corepack pnpm vitest run packages/dashboard/tests/routes.test.ts
```
Expected: 둘 다 PASS. 두 번째는 **기존 테스트가 안 깨졌는지** 보는 것이다.

- [ ] **Step 12: 의존 경계와 타입체크를 본다**

```bash
cd /Users/cheonjamin/projects/mcptest
corepack pnpm vitest run packages/dashboard/tests/dependency-boundary.test.ts
corepack pnpm --filter @mcpeak/dashboard typecheck
```
Expected: PASS. `dependency-boundary` 가 빨갛다면 `package.json` 의 `@mcpeak/mock` 한 줄이 빠진 것이다.

> **§2 거짓 신호 2번.** 타입체크가 초록이어도 **새 파일이 검사 대상에 들었는지** 확인해라. `tsc --noEmit` 은 `tsconfig` 의 `include` 를 따른다 — `src/**` 라면 자동으로 든다. 의심되면 새 파일에 `const x: number = "틀림";` 을 잠깐 넣어 빨간지 보고 지운다.

- [ ] **Step 13: 보고하고 멈춘다**

```
feat(dashboard): 중계 세션과 통로 셋을 연다
```

---

## Task 5: 케이스 칸 뷰모델과 닫기 순서 (테스트 10 · 11 의 판정 절반)

**Files:**
- Create: `packages/dashboard/web/src/relay/case-cards.ts` · `packages/dashboard/web/src/relay/close-first.ts`
- Test: `packages/dashboard/web/tests/case-cards.test.ts` · `packages/dashboard/web/tests/close-first.test.ts`

**Interfaces:**
- Consumes: Task 4 의 `RelayEvent` · Task 1 의 `RelayCase` (둘 다 `src/api-types.ts` — web 은 이미 그 파일을 상대경로로 읽는다)
- Produces:
  ```ts
  export type CaseCardStatus = "waiting" | "ok" | "toolError" | "protocolError" | "noCall";
  export interface CaseCard {
    readonly id: string; readonly tool: string; readonly input: unknown;
    readonly status: CaseCardStatus;
    readonly calls: readonly { readonly tool?: string; readonly args?: unknown }[];
    readonly results: readonly { readonly ok: boolean; readonly bytes?: number; readonly ms?: number; readonly body?: unknown; readonly code?: number; readonly message?: string }[];
  }
  export function toCaseCards(cases: readonly RelayCase[], events: readonly RelayEvent[]): readonly CaseCard[];
  export function runAfterClose(close: () => Promise<void>, start: () => Promise<void>): Promise<void>;
  ```

> ⚠️ **`case` 필드가 이벤트 종류마다 다른 값이다. 헷갈리기 쉬운 자리다.**
> - `call` · `result` 의 `case` 는 **꼬리표**(`c1`)다 — 중계기가 URL 에서 읽어 그대로 옮긴 값이다.
> - `aiDone` 의 `case` 는 **케이스 id**(`get-weather-success`)다 — 그 이벤트는 중계기가 아니라 세션이 만들고, 화면이 칸을 찾는 열쇠가 id 이기 때문이다.
>
> `toCaseCards` 가 `calls`·`results` 는 `relayCase.tag` 로, `finished` 는 `relayCase.id` 로 찾는 것이 그래서다. **둘을 바꿔 쓰면 모든 칸이 영영 `waiting` 이거나 영영 `noCall` 이 된다** — 조용히 틀리는 종류라 Step 5 의 되돌려-실패-확인이 여기에 걸린다.

**「호출 없음」이 필수인 이유**(설계 §1): 실측에서 AI 가 권한에 막혀 툴을 한 번도 안 불렀다. 그때 빈 화면만 나오면 사용자는 **자기 서버가 고장난 줄 안다.** 그래서 `noCall` 은 「아직 안 왔다」(`waiting`)와 **다른 상태**여야 하고, 가르는 축은 `aiDone` 이벤트다 — 그 케이스의 AI 가 끝났는데 `call` 이 하나도 없었으면 `noCall` 이다.

- [ ] **Step 1: 실패 테스트를 쓴다**

`packages/dashboard/web/tests/case-cards.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { RelayCase, RelayEvent, RelayEventInput } from "../../src/api-types.js";
import { toCaseCards } from "../src/relay/case-cards.js";

const CASES: readonly RelayCase[] = [
  { id: "get-weather-success", tag: "c1", tool: "get_weather", input: { city: "서울" } },
  { id: "add-missing-a", tag: "c2", tool: "add", input: { b: 2 } },
];

const withIds = (inputs: readonly RelayEventInput[]): readonly RelayEvent[] =>
  inputs.map((event, index) => ({ ...event, id: index + 1 }) as RelayEvent);

describe("케이스 칸", () => {
  it("이벤트가 없으면 전부 기다리는 중이다", () => {
    expect(toCaseCards(CASES, []).map((card) => card.status)).toEqual(["waiting", "waiting"]);
  });

  it("칸 순서는 케이스 순서 그대로다", () => {
    expect(toCaseCards(CASES, []).map((card) => card.id)).toEqual([
      "get-weather-success",
      "add-missing-a",
    ]);
  });

  it("꼬리표로 줄을 갈라 제 칸에 넣는다", () => {
    const cards = toCaseCards(
      CASES,
      withIds([
        { kind: "call", case: "c2", method: "tools/call", tool: "add", args: { b: 2 } },
        { kind: "call", case: "c1", method: "tools/call", tool: "get_weather", args: { city: "서울" } },
        { kind: "result", case: "c1", tool: "get_weather", ok: true, bytes: 97, ms: 2, body: { t: 21 } },
      ]),
    );
    expect(cards[0]?.results).toEqual([{ ok: true, bytes: 97, ms: 2, body: { t: 21 } }]);
    expect(cards[1]?.results).toEqual([]);
    expect(cards[1]?.calls).toEqual([{ tool: "add", args: { b: 2 } }]);
  });

  it("툴을 안 부른 채 AI 가 끝나면 「호출 없음」이다", () => {
    // 권한에 막히면 종료 코드 0 으로 끝나면서 tools/call 이 한 건도 없다(설계 §3).
    const cards = toCaseCards(
      CASES,
      withIds([{ kind: "aiDone", case: "get-weather-success", ok: true }]),
    );
    expect(cards[0]?.status).toBe("noCall");
    expect(cards[1]?.status).toBe("waiting");
  });

  it("AI 가 끝나기 전에는 호출이 없어도 기다리는 중이다", () => {
    expect(toCaseCards(CASES, []).at(0)?.status).toBe("waiting");
  });

  it("툴 오류와 프로토콜 오류를 가른다", () => {
    const cards = toCaseCards(
      CASES,
      withIds([
        { kind: "call", case: "c1", method: "tools/call", tool: "get_weather" },
        { kind: "result", case: "c1", ok: false, bytes: 40, ms: 1, body: { isError: true } },
        { kind: "call", case: "c2", method: "tools/call", tool: "add" },
        { kind: "result", case: "c2", ok: false, code: -32602, message: "bad" },
      ]),
    );
    expect(cards[0]?.status).toBe("toolError");
    expect(cards[1]?.status).toBe("protocolError");
  });

  it("initialize·tools/list 는 칸의 상태를 바꾸지 않는다", () => {
    // 툴 호출이 아닌 왕복까지 「불렀다」로 세면 「호출 없음」 칸이 영영 안 뜬다.
    const cards = toCaseCards(
      CASES,
      withIds([
        { kind: "call", case: "c1", method: "initialize" },
        { kind: "result", case: "c1", ok: true, bytes: 125, ms: 4, body: {} },
        { kind: "aiDone", case: "get-weather-success", ok: true },
      ]),
    );
    expect(cards[0]?.status).toBe("noCall");
  });

  it("꼬리표 없는 줄은 어느 칸에도 안 들어간다", () => {
    const cards = toCaseCards(
      CASES,
      withIds([{ kind: "call", method: "tools/call", tool: "get_weather" }]),
    );
    expect(cards.flatMap((card) => card.calls)).toEqual([]);
  });
});
```

`packages/dashboard/web/tests/close-first.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runAfterClose } from "../src/relay/close-first.js";

describe("닫기 먼저", () => {
  it("닫기가 끝난 뒤에 다음 동작을 시작한다", async () => {
    const order: string[] = [];
    await runAfterClose(
      () =>
        new Promise<void>((resolve) => {
          order.push("close:start");
          setTimeout(() => {
            order.push("close:end");
            resolve();
          }, 5);
        }),
      () => {
        order.push("start");
        return Promise.resolve();
      },
    );
    expect(order).toEqual(["close:start", "close:end", "start"]);
  });

  it("닫기가 실패하면 다음 동작을 시작하지 않는다", async () => {
    // 안 닫힌 중계기가 남은 채 판정 실행이 시작되면 같은 서버가 두 벌 뜬다(설계 §1).
    let started = false;
    await expect(
      runAfterClose(
        () => Promise.reject(new Error("닫지 못했습니다")),
        () => {
          started = true;
          return Promise.resolve();
        },
      ),
    ).rejects.toThrow(new Error("닫지 못했습니다"));
    expect(started).toBe(false);
  });
});
```

> **`toThrow` 주의**(§2 거짓 신호). `toThrow("문장")` 은 **부분 일치**라 뒤에 무엇이 붙어도 통과한다. 위처럼 `toThrow(new Error(전문))` 으로 완전 일치를 건다.

- [ ] **Step 2: 실패를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && corepack pnpm vitest run --project web tests/case-cards.test.ts tests/close-first.test.ts`
Expected: FAIL — import 해결 실패

- [ ] **Step 3: 구현한다**

`packages/dashboard/web/src/relay/close-first.ts`:

```ts
/**
 * 닫기가 **끝난 것을 확인한 뒤** 다음 동작을 시작한다.
 *
 * 이 한 줄이 따로 파일로 있는 이유는 순서가 이 화면의 계약이기 때문이다(설계 §1).
 * `[실행 시작]` 이 중계기를 안 닫고 판정 실행을 시작하면 같은 서버가 두 벌 뜬다 —
 * 컴포넌트 안에 묻어 두면 그 순서에 테스트를 걸 자리가 없다.
 *
 * 닫기가 실패하면 **시작하지 않는다.** 그때 시작하는 것이 바로 막으려던 상태다.
 */
export async function runAfterClose(
  close: () => Promise<void>,
  start: () => Promise<void>,
): Promise<void> {
  await close();
  await start();
}
```

`packages/dashboard/web/src/relay/case-cards.ts`:

```ts
import type { RelayCase, RelayEvent } from "../../../src/api-types.js";

/**
 * 케이스 칸 하나의 상태.
 *
 * `noCall` 이 `waiting` 과 **다른 상태인 것이 요점이다.** 실측에서 AI 가 권한에 막혀 툴을
 * 한 번도 안 불렀고(설계 §3), 그때 빈 칸만 보이면 사용자는 자기 서버가 고장난 줄 안다.
 */
export type CaseCardStatus = "waiting" | "ok" | "toolError" | "protocolError" | "noCall";

export interface CaseCall {
  readonly tool?: string;
  readonly args?: unknown;
}

export interface CaseResult {
  readonly ok: boolean;
  readonly bytes?: number;
  readonly ms?: number;
  readonly body?: unknown;
  readonly code?: number;
  readonly message?: string;
}

export interface CaseCard {
  readonly id: string;
  readonly tool: string;
  readonly input: unknown;
  readonly status: CaseCardStatus;
  readonly calls: readonly CaseCall[];
  readonly results: readonly CaseResult[];
}

/** 칸의 상태를 바꾸는 것은 **툴 호출뿐이다.** initialize·tools/list 는 왕복이지 호출이 아니다. */
const TOOL_CALL = "tools/call";

export function toCaseCards(
  cases: readonly RelayCase[],
  events: readonly RelayEvent[],
): readonly CaseCard[] {
  const calls = new Map<string, CaseCall[]>();
  const results = new Map<string, CaseResult[]>();
  const finished = new Set<string>();
  // 응답 줄에는 method 가 없다(`relay-log.ts`). 툴 호출의 응답인지는 **같은 꼬리표의
  // 마지막 요청이 tools/call 이었는지**로 본다 — 중계기는 요청·응답을 짝지어 순서대로 낸다.
  const lastWasToolCall = new Map<string, boolean>();

  for (const event of events) {
    if (event.kind === "aiDone") {
      finished.add(event.case);
      continue;
    }
    // 꼬리표가 없는 줄은 어느 칸에도 넣지 않는다. 어느 케이스의 것인지 말할 근거가 없다.
    if (event.kind === "call") {
      if (event.case === undefined) continue;
      lastWasToolCall.set(event.case, event.method === TOOL_CALL);
      if (event.method !== TOOL_CALL) continue;
      const list = calls.get(event.case) ?? [];
      list.push({
        ...(event.tool === undefined ? {} : { tool: event.tool }),
        ...(event.args === undefined ? {} : { args: event.args }),
      });
      calls.set(event.case, list);
      continue;
    }
    if (event.kind === "result") {
      if (event.case === undefined || lastWasToolCall.get(event.case) !== true) continue;
      const list = results.get(event.case) ?? [];
      const { kind: _kind, id: _id, case: _case, tool: _tool, ...rest } = event;
      list.push(rest);
      results.set(event.case, list);
    }
  }

  return cases.map((relayCase) => {
    const ownCalls = calls.get(relayCase.tag) ?? [];
    const ownResults = results.get(relayCase.tag) ?? [];
    const last = ownResults.at(-1);
    const status: CaseCardStatus =
      last === undefined
        ? // AI 가 끝났는데 툴 호출이 한 건도 없으면 「호출 없음」이다. 끝나기 전이면 아직 기다린다.
          finished.has(relayCase.id) && ownCalls.length === 0
          ? "noCall"
          : "waiting"
        : last.ok
          ? "ok"
          : last.code === undefined
            ? "toolError"
            : "protocolError";
    return {
      id: relayCase.id,
      tool: relayCase.tool,
      input: relayCase.input,
      status,
      calls: ownCalls,
      results: ownResults,
    };
  });
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && corepack pnpm vitest run --project web tests/case-cards.test.ts tests/close-first.test.ts`
Expected: PASS — `Tests  10 passed (10)`

- [ ] **Step 5: 되돌려서 실패를 본다 (테스트 10 · 11 은 빈 테스트가 되기 쉽다)**

핸드오프 §6 이 지목한 둘이다. **둘 다 수정을 빼고 한 번 돌려 실패를 본다.**

```bash
SCRATCH=/private/tmp/claude-501/-Users-cheonjamin-projects-mcptest/11ae66be-f45a-457e-a064-c7b83ceae183/scratchpad
cp packages/dashboard/web/src/relay/case-cards.ts "$SCRATCH/case-cards.bak"
cp packages/dashboard/web/src/relay/close-first.ts "$SCRATCH/close-first.bak"

# ① `noCall` 판정을 `"waiting"` 으로 바꾼다 → 「호출 없음」 케이스가 빨강이어야 한다
# ② runAfterClose 를 `await Promise.all([close(), start()])` 로 바꾼다 → 순서 케이스가 빨강이어야 한다
corepack pnpm vitest run --project web tests/case-cards.test.ts tests/close-first.test.ts

cp "$SCRATCH/case-cards.bak" packages/dashboard/web/src/relay/case-cards.ts
cp "$SCRATCH/close-first.bak" packages/dashboard/web/src/relay/close-first.ts
git diff --stat packages/dashboard/web/src/relay/
```

**되돌리기를 빠뜨리면 구현이 날아갔는데 로컬은 초록으로 보인다.**

- [ ] **Step 6: 보고하고 멈춘다**

```
feat(dashboard): 중계 이벤트를 케이스 칸으로 가르고 닫기 순서를 고정한다
```

---

## Task 6: 체크박스와 4 단계 화면 (테스트 10 · 11 의 화면 절반)

**Files:**
- Create: `packages/dashboard/web/src/relay/relay-stream.ts` · `packages/dashboard/web/src/home/steps/StepRelay.tsx`
- Modify: `packages/dashboard/web/src/home/steps/StepRunOptions.tsx` · `packages/dashboard/web/src/screens/Home.tsx`
- Test: `packages/dashboard/web/tests/step-relay.test.tsx`

**Interfaces:**
- Consumes: Task 5 의 `toCaseCards` · `runAfterClose`, Task 4 의 `StartRelayResponse` · `RelayEvent`
- Produces: `StepRelay` 컴포넌트 · `useRelayEvents(relayId)` 훅

> **`home.test.tsx` 를 건드리지 마라.** 35/35 가 이미 빨갛다(jsdom `localStorage.clear`, 이 작업과 무관). 새 UI 테스트는 **새 파일** `step-relay.test.tsx` 에 쓰고 **`localStorage.clear()` 를 부르지 마라.** 그러면 jsdom + RTL 이 정상 동작한다(계획 단계 실측).

- [ ] **Step 1: 실패 테스트를 쓴다**

`packages/dashboard/web/tests/step-relay.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RelayCase, RelayEvent, RelayEventInput } from "../../src/api-types.js";
import { StepRelay } from "../src/home/steps/StepRelay.js";

afterEach(cleanup);

const CASES: readonly RelayCase[] = [
  { id: "get-weather-success", tag: "c1", tool: "get_weather", input: { city: "서울" } },
  { id: "add-missing-a", tag: "c2", tool: "add", input: { b: 2 } },
];

const withIds = (inputs: readonly RelayEventInput[]): readonly RelayEvent[] =>
  inputs.map((event, index) => ({ ...event, id: index + 1 }) as RelayEvent);

describe("4 단계 실제 응답", () => {
  it("케이스마다 칸이 하나씩 뜬다", () => {
    render(<StepRelay cases={CASES} events={[]} error={null} skipped={null} />);
    expect(screen.getByText("get-weather-success")).toBeDefined();
    expect(screen.getByText("add-missing-a")).toBeDefined();
  });

  it("AI 가 툴을 안 불렀으면 「호출 없음」 칸이 뜬다", () => {
    render(
      <StepRelay
        cases={CASES}
        events={withIds([{ kind: "aiDone", case: "get-weather-success", ok: true }])}
        error={null}
        skipped={null}
      />,
    );
    expect(screen.getByText("AI 가 이 케이스에서 툴을 부르지 않았습니다.")).toBeDefined();
  });

  it("성공한 칸은 바이트·시간과 사람이 읽는 본문을 보인다", () => {
    render(
      <StepRelay
        cases={CASES}
        events={withIds([
          { kind: "call", case: "c1", method: "tools/call", tool: "get_weather", args: { city: "서울" } },
          {
            kind: "result",
            case: "c1",
            tool: "get_weather",
            ok: true,
            bytes: 97,
            ms: 20,
            body: { content: [{ type: "text", text: '{"temp":21}' }] },
          },
        ])}
        error={null}
        skipped={null}
      />,
    );
    expect(screen.getByText(/97바이트/)).toBeDefined();
    expect(screen.getByText(/0\.0초/)).toBeDefined();
  });

  it("프로토콜 오류는 서버가 준 코드와 문장을 그대로 보인다", () => {
    render(
      <StepRelay
        cases={CASES}
        events={withIds([
          { kind: "call", case: "c2", method: "tools/call", tool: "add" },
          { kind: "result", case: "c2", ok: false, code: -32602, message: "필수 인자 a 가 없습니다" },
        ])}
        error={null}
        skipped={null}
      />,
    );
    expect(screen.getByText(/-32602/)).toBeDefined();
    expect(screen.getByText(/필수 인자 a 가 없습니다/)).toBeDefined();
  });

  it("건너뛴 케이스가 있으면 그 안내를 보인다", () => {
    render(
      <StepRelay cases={CASES} events={[]} error={null} skipped="→ 툴을 부르지 않는 케이스 1 건은 띄우지 않았습니다: only-list" />,
    );
    expect(screen.getByText(/only-list/)).toBeDefined();
  });

  it("중계기를 못 띄웠으면 그 사유 전문을 보인다", () => {
    render(<StepRelay cases={[]} events={[]} error={"→ 중계기가 기동 줄을 내지 않았습니다."} skipped={null} />);
    expect(screen.getByText(/중계기가 기동 줄을 내지 않았습니다/)).toBeDefined();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && corepack pnpm vitest run --project web tests/step-relay.test.tsx`
Expected: FAIL — import 해결 실패

- [ ] **Step 3: SSE 훅을 만든다**

`packages/dashboard/web/src/relay/relay-stream.ts`:

```ts
import { useEffect, useState } from "react";
import type { RelayEvent } from "../../../src/api-types.js";

/**
 * `GET /api/relay/:id/events` 를 구독한다. `run-stream.ts` 와 같은 모양이되 **훨씬 작다** —
 * 중계 세션에는 질문도 상태 전이도 없고, 이벤트가 곧 화면이다.
 *
 * **주기 폴링을 하지 않는다.** 타이머는 결정론성을 흔든다(ADR-0072 와 같은 판단).
 */
export function useRelayEvents(relayId: string | null): readonly RelayEvent[] {
  const [events, setEvents] = useState<readonly RelayEvent[]>([]);

  useEffect(() => {
    setEvents([]);
    if (relayId === null) return;
    const source = new EventSource(`/api/relay/${encodeURIComponent(relayId)}/events`);
    source.onmessage = (message: MessageEvent<string>): void => {
      const event = JSON.parse(message.data) as RelayEvent;
      // 재연결로 같은 id 가 두 번 올 수 있다. 중복을 여기서 거른다.
      setEvents((previous) =>
        previous.some((received) => received.id === event.id) ? previous : [...previous, event],
      );
    };
    return (): void => source.close();
  }, [relayId]);

  return events;
}
```

- [ ] **Step 4: 화면을 만든다**

`packages/dashboard/web/src/home/steps/StepRelay.tsx`:

```tsx
import type { JSX } from "react";
import { useState } from "react";
import type { RelayCase, RelayEvent } from "../../../../src/api-types.js";
import { Card } from "../../components/Card.js";
import type { CaseCard, CaseCardStatus } from "../../relay/case-cards.js";
import { toCaseCards } from "../../relay/case-cards.js";

/** 본문을 접어 두는 기준. 중계기는 자르지 않는다 — **접는 것은 화면이 한다**(설계 §2-6). */
const FOLD_CHARS = 200;

const STATUS_LABEL: Record<CaseCardStatus, string> = {
  waiting: "기다리는 중",
  ok: "성공",
  toolError: "툴 오류",
  protocolError: "프로토콜 오류",
  noCall: "호출 없음",
};

/** 중계기의 사람 줄과 같은 규칙이다(`relay-log.ts`). 두 자리가 다르면 같은 값을 두 번 배운다. */
function groupDigits(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}초`;
}

/** `content` 의 텍스트만 모은 것. 없으면 null — 지어내지 않는다. */
function humanText(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const content = (body as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const texts = content.flatMap((block) =>
    typeof block === "object" && block !== null && typeof (block as { text?: unknown }).text === "string"
      ? [(block as { text: string }).text]
      : [],
  );
  return texts.length === 0 ? null : texts.join("\n");
}

function Foldable(props: { label: string; text: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const long = props.text.length > FOLD_CHARS;
  return (
    <div className="mt-1">
      <span className="text-xs text-ink-muted">{props.label}</span>{" "}
      <span className="break-all font-mono text-xs text-ink">
        {open || !long ? props.text : `${props.text.slice(0, FOLD_CHARS)}…`}
      </span>
      {long && (
        <button
          type="button"
          className="ml-2 text-xs text-accent underline"
          onClick={() => setOpen((previous) => !previous)}
        >
          {open ? "접기" : "더 보기"}
        </button>
      )}
    </div>
  );
}

function CaseBox(props: { card: CaseCard }): JSX.Element {
  const card = props.card;
  const last = card.results.at(-1);
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="break-all font-mono text-sm font-semibold text-ink">{card.id}</span>
        <span className="shrink-0 text-xs text-ink-muted">{STATUS_LABEL[card.status]}</span>
      </div>

      {card.status === "noCall" && (
        <p className="mt-2 text-sm text-ink-muted">AI 가 이 케이스에서 툴을 부르지 않았습니다.</p>
      )}
      {card.status === "waiting" && (
        <p className="mt-2 text-sm text-ink-muted">아직 이 케이스의 호출이 오지 않았습니다.</p>
      )}

      {card.calls.map((call, index) => (
        <p key={`call-${String(index)}`} className="mt-2 break-all font-mono text-xs text-ink">
          → {call.tool ?? card.tool} {call.args === undefined ? "" : JSON.stringify(call.args)}
        </p>
      ))}

      {last !== undefined && last.code !== undefined && (
        // 서버가 준 코드·문장을 그대로 쓴다. 고쳐 쓰지 않는다(`relay-log.ts` 의 문안 규칙 2).
        <p className="mt-1 font-mono text-xs" style={{ color: "var(--status-failed-fg)" }}>
          ← 오류 {last.code} {last.message ?? ""}
        </p>
      )}
      {last !== undefined && last.code === undefined && (
        <>
          <p className="mt-1 font-mono text-xs text-ink">
            ← {last.ok ? "성공" : "툴 오류"} · {groupDigits(last.bytes ?? 0)}바이트 ·{" "}
            {seconds(last.ms ?? 0)}
          </p>
          <Foldable label="사람이 읽는 칸" text={humanText(last.body) ?? "없음"} />
          <Foldable
            label="기계가 읽는 칸"
            text={
              typeof last.body === "object" &&
              last.body !== null &&
              "structuredContent" in last.body
                ? JSON.stringify((last.body as { structuredContent: unknown }).structuredContent)
                : "없음"
            }
          />
        </>
      )}
    </Card>
  );
}

/**
 * 4 단계 「실제 응답」. **화면은 케이스마다 칸 하나다**(설계 §1).
 *
 * 이 컴포넌트는 판정을 하지 않는다 — 전부 `toCaseCards` 가 한다. 그래야 테스트가 jsdom 없이
 * 돌고, 「호출 없음」처럼 틀리기 쉬운 판정에 되돌려-실패-확인을 걸 수 있다.
 */
export function StepRelay(props: {
  cases: readonly RelayCase[];
  events: readonly RelayEvent[];
  /** 중계기를 못 띄운 사유 전문. 서버가 준 문장을 그대로 쓴다. */
  error: string | null;
  /** 건너뛴 케이스 안내. 없으면 null. */
  skipped: string | null;
}): JSX.Element {
  const cards = toCaseCards(props.cases, props.events);
  return (
    <div className="space-y-3">
      {props.error !== null && (
        <p className="whitespace-pre-wrap text-sm" style={{ color: "var(--status-failed-fg)" }}>
          {props.error}
        </p>
      )}
      {props.skipped !== null && (
        <p className="whitespace-pre-wrap text-xs text-ink-muted">{props.skipped}</p>
      )}
      {cards.map((card) => (
        <CaseBox key={card.id} card={card} />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: 화면 테스트 통과를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && corepack pnpm vitest run --project web tests/step-relay.test.tsx`
Expected: PASS — `Tests  6 passed (6)`

- [ ] **Step 6: 3 단계에 체크박스를 넣는다**

`StepRunOptions.tsx` 의 props 에 둘을 더한다:

```ts
  /** 켜면 4 단계 「실제 응답」이 붙는다. */
  liveResponse: boolean;
  onLiveResponseChange: (value: boolean) => void;
```

「실행될 명령」 블록 **바로 위**에 넣는다:

```tsx
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          id="home-run-live-response"
          checked={props.liveResponse}
          disabled={http}
          onChange={(event) => props.onLiveResponseChange(event.target.checked)}
        />
        <span className="text-sm text-ink">
          판정 전에 서버의 실제 응답을 본다
          <span className="mt-0.5 block text-xs text-ink-muted">
            {http
              ? "원격 서버에는 중계기를 붙일 수 없습니다. 우리가 띄우는 stdio 서버에서만 됩니다."
              : "케이스마다 AI 를 한 대씩 띄워 서버를 두드리고, 오간 호출을 그대로 보여줍니다. 판정은 아직 하지 않습니다."}
          </span>
        </span>
      </label>
```

**HTTP 에서 끄는 이유:** 중계기는 stdio 서버를 HTTP 로 **중계**하는 물건이다. 대상이 이미 HTTP 면 중계할 것이 없다(`relay.ts` 머리 주석).

- [ ] **Step 7: `Home.tsx` 에 4 단계를 붙인다**

```tsx
// STEPS 를 고정 배열에서 파생으로 바꾼다.
const BASE_STEPS = ["테스트할 서버", "테스트할 스위트", "실행 옵션"] as const;
const RELAY_STEP = "실제 응답";
```

`Home()` 안:

```tsx
  const [liveResponse, setLiveResponse] = useState(false);
  const [relay, setRelay] = useState<StartRelayResponse | null>(null);
  const [relayError, setRelayError] = useState<string | null>(null);
  const relayEvents = useRelayEvents(relay?.relayId ?? null);

  const steps = liveResponse && !http ? [...BASE_STEPS, RELAY_STEP] : BASE_STEPS;

  /** 중계기를 닫고 **닫힌 것을 확인한 뒤** 돌아온다. 없으면 할 일이 없다. */
  async function closeRelay(): Promise<void> {
    const current = relay;
    if (current === null) return;
    await apiSend<void>("DELETE", `/api/relay/${encodeURIComponent(current.relayId)}`);
    setRelay(null);
  }

  /** 4 단계에 들어설 때 중계기를 띄운다. */
  async function openRelay(suitePath: string): Promise<void> {
    setRelayError(null);
    try {
      setRelay(
        await apiSend<StartRelayResponse>("POST", "/api/relay", {
          suitePath,
          command: target.command,
          args: target.args,
          envNames: state.envNames,
          model: "sonnet",
          ...(state.choice.kind === "candidate" ? { serverId: state.choice.id } : {}),
        } satisfies StartRelayRequest),
      );
    } catch (err) {
      setRelayError(err instanceof Error ? err.message : String(err));
    }
  }
```

`실행 시작` 버튼의 `onClick` 을 바꾼다 — **닫기가 먼저다:**

```tsx
            onClick={() => void runAfterClose(closeRelay, startRun).catch((err: unknown) => {
              setStartError(
                `${err instanceof Error ? err.message : String(err)}\n` +
                  "→ 중계기를 닫지 못해 실행을 시작하지 않았습니다. 같은 서버가 두 벌 뜨는 것을 막기 위해서입니다.\n" +
                  "→ 새로고침한 뒤 다시 시도하세요.",
              );
            })}
```

`이전` 버튼도 같다:

```tsx
          onClick={() => void closeRelay().finally(() => setStep((previous) => Math.max(previous - 1, 0)))}
```

화면 이탈에도 닫는다:

```tsx
  useEffect(() => () => void closeRelay(), []); // 언마운트 정리
```

`다음` 버튼이 4 단계로 넘어갈 때 `openRelay` 를 부르고, 4 단계 본문에 `StepRelay` 를 그린다:

```tsx
        {step === 3 && (
          <StepRelay
            cases={relay?.cases ?? []}
            events={relayEvents}
            error={relayError}
            skipped={
              relayEvents.find((event) => event.kind === "notice")?.message ?? null
            }
          />
        )}
```

`StepRunOptions` 호출에 두 props 를 넘긴다:

```tsx
            liveResponse={liveResponse}
            onLiveResponseChange={setLiveResponse}
```

`STEPS.length - 1` 을 쓰던 자리를 전부 `steps.length - 1` 로 바꾼다 — 안 바꾸면 체크박스를 켠 뒤에도 3 단계에 「실행 시작」이 남아 4 단계로 갈 수 없다.

- [ ] **Step 8: 타입체크와 web 전체를 돌린다**

```bash
cd /Users/cheonjamin/projects/mcptest
corepack pnpm --filter @mcpeak/dashboard typecheck
corepack pnpm vitest run --project web
```

Expected: 타입체크 PASS. web 은 **기준선과 같아야 한다** — `Tests  81 failed | 3xx passed`. **실패 81 건이 늘어나면 내가 깬 것이다.** 늘어난 파일 이름을 확인해라.

- [ ] **Step 9: 보고하고 멈춘다**

```
feat(dashboard): 3 단계 체크박스와 4 단계 실제 응답 화면을 붙인다
```

---

## Task 7: E2E — 진짜 중계기 · 가짜 AI (테스트 12)

**Files:**
- Create: `packages/dashboard/tests/relay-e2e.test.ts`

**Interfaces:**
- Consumes: Task 4 의 `RelaySessionRegistry`

**AI 는 가짜다.** 설계 §8 이 못박았다 — 진짜 `claude` 를 쓰면 같은 입력에 같은 결과가 안 나온다. 이 E2E 가 보는 것은 **배선**이다: 진짜 `mcpeak-relay` 가 진짜 `examples/weather-server` 를 물고 뜨고, 꼬리표 붙은 URL 로 들어온 호출이 제 케이스의 이벤트로 나오는가. 가짜 AI 자리에는 **MCP 클라이언트 대신 맨 `fetch`** 를 쓴다 — SDK `Client` 를 끌어오면 검증 계층이 하나 더 껴서 무엇이 깨진 것인지 흐려진다.

- [ ] **Step 1: 실패 테스트를 쓴다**

`packages/dashboard/tests/relay-e2e.test.ts` — **파일명이 `-e2e.test.ts` 인 것이 중요하다.** 루트 `vitest.config.ts` 의 `E2E_GLOB` 이 이 이름으로 직렬 웨이브를 가른다.

```ts
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { RelaySessionRegistry } from "../src/server/relay-session.js";

const SUITE_PATH = fileURLToPath(
  new URL("../../../examples/weather-server/server.suite.json", import.meta.url),
);
const SERVER_PATH = fileURLToPath(
  new URL("../../../examples/weather-server/server.mjs", import.meta.url),
);

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

/** MCP 왕복 한 번을 맨 fetch 로 친다. SDK Client 를 쓰지 않는다 — 검증 계층이 하나 더 끼면 진단이 흐려진다. */
async function callTool(url: string, tool: string, args: unknown): Promise<void> {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  const send = (body: unknown) => fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  await send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "relay-e2e", version: "0" },
    },
  });
  await send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } });
}

describe.sequential("중계 세션 E2E", () => {
  it("진짜 중계기를 띄우고 꼬리표 붙은 호출을 제 케이스로 가른다", async () => {
    const registry = new RelaySessionRegistry({
      readSuite: () => readFile(SUITE_PATH, "utf8"),
      // AI 자리를 우리가 대신한다. 자기 꼬리표가 붙은 URL 로 툴을 한 번 부르고 끝낸다.
      runAi: async (spec) => {
        const config = JSON.parse(spec.args[spec.args.indexOf("--mcp-config") + 1] as string) as {
          mcpServers: { target: { url: string } };
        };
        // `c1` 만 부른다. `c2` 는 툴을 안 부른 채 끝나 「호출 없음」이 되어야 한다.
        if (spec.tag === "c1") await callTool(config.mcpServers.target.url, "get_weather", { city: "서울" });
        return { ok: true };
      },
    });

    const session = await registry.start({
      suitePath: SUITE_PATH,
      command: process.execPath,
      args: [SERVER_PATH],
      envNames: [],
      model: "sonnet",
    });
    if ("error" in session) throw new Error(session.error);
    cleanup = () => session.close();

    await session.settled;

    const calls = session.events.filter(
      (event) => event.kind === "call" && event.method === "tools/call",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ case: "c1", tool: "get_weather" });

    const results = session.events.filter((event) => event.kind === "result" && event.case === "c1");
    // **본문이 실려 있어야 한다.** 이것이 4 단계의 존재 이유다 — AI 경유로는 안 오는 값이다.
    expect(results.at(-1)).toMatchObject({ ok: true });
    expect(JSON.stringify(results.at(-1))).toContain("content");

    expect(session.events.at(-1)?.kind).toBe("done");
  }, 60_000);

  it("닫으면 중계기와 자식 서버가 실제로 끝난다", async () => {
    const registry = new RelaySessionRegistry({
      readSuite: () => readFile(SUITE_PATH, "utf8"),
      runAi: () => Promise.resolve({ ok: true }),
    });
    const session = await registry.start({
      suitePath: SUITE_PATH,
      command: process.execPath,
      args: [SERVER_PATH],
      envNames: [],
      model: "sonnet",
    });
    if ("error" in session) throw new Error(session.error);
    await session.settled;
    await session.close();
    // 두 번 닫아도 걸리지 않는다. 화면 이탈과 `[실행 시작]` 이 둘 다 부를 수 있다.
    await session.close();
  }, 60_000);
});
```

> `server.suite.json` 의 케이스 이름·개수를 **먼저 읽고** `c1` · `c2` 가 무엇인지 확인해라. 첫 두 `callTool` 케이스가 무엇인지에 따라 위 `get_weather` 와 인자를 맞춰야 한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && corepack pnpm vitest run packages/dashboard/tests/relay-e2e.test.ts`
Expected: 처음에는 FAIL 이거나, 배선이 맞으면 바로 PASS 다. **바로 통과하면 그것이 의심스러운 상태다** — `runAi` 안의 `callTool` 을 빼고 돌려 첫 케이스가 빨간지 확인해라.

- [ ] **Step 3: 결정론성을 본다**

같은 입력 두 번의 출력이 같아야 한다(`ms` 를 뺀 나머지).

```bash
cd /Users/cheonjamin/projects/mcptest
for i in 1 2; do corepack pnpm vitest run packages/dashboard/tests/relay-e2e.test.ts >/dev/null 2>&1; echo "run$i exit=$?"; done
```

> **종료 코드는 파이프 없이 읽는다**(§2). `| tail` 뒤에서 `$?` 를 읽으면 `tail` 의 값이다.

- [ ] **Step 4: 보고하고 멈춘다**

```
test(dashboard): 중계 세션 배선을 E2E 로 고정한다 (AI 는 가짜)
```

---

## Task 8: ADR 과 changeset

**Files:**
- Create: `docs/adr/NNNN-dashboard-relay-screen.md`
- Create: `.changeset/<이름>.md`

- [ ] **Step 1: ADR 번호를 딴다**

```bash
cd /Users/cheonjamin/projects/mcptest
git fetch
ls docs/adr | tail -5
git log origin/main --name-only --oneline -20 -- docs/adr | grep "docs/adr/" | sort -u | tail -5
```

**`origin/main` 과 겹치지 않는 번호를 골라라.** 핸드오프 §6 이 지목한 함정이다 — 로컬이 ahead/behind 인 상태에서 로컬 목록만 보면 번호가 충돌한다.

- [ ] **Step 2: ADR 을 쓴다**

다섯 항목, 한 페이지. 적을 판단은 **셋**이다 — 설계 문서가 이미 결정한 것을 옮겨 적는 것이 아니라, **이 계획서가 새로 내린 것**을 적는다.

```markdown
# ADR-NNNN: 대시보드가 케이스 꼬리표를 직접 매기고, 중계 통로를 run 과 나눈다

## 배경
4 단계 「실제 응답」은 케이스마다 AI 를 하나씩 **동시에** 띄운다. 중계기는 stateless 라
접속을 구분할 식별자가 없고, 기록 줄은 한 채널로 섞여 나온다. 꼬리표를 URL 로 나르기로
한 것(설계 §2-4)까지는 정해져 있었으나, **그 꼬리표의 값을 누가 정하는가**와 **통로를 어디에
두는가**는 열려 있었다.

## 선택지
1. 사용자의 케이스 id 를 그대로 URL 에 싣는다.
2. 대시보드가 짧은 자체 꼬리표(`c1` · `c2` …)를 매기고 원래 id 를 따로 나른다.
3. 케이스마다 중계기를 따로 띄운다(꼬리표 자체를 없앤다).

통로는 ① 기존 `POST /api/runs` 에 flow 를 하나 더한다 ② 중계기 전용 통로 셋을 판다.

## 결정
꼬리표는 **대시보드가 매긴다**(선택지 2). 통로는 **따로 판다**.

## 이유
- 사용자 케이스 id 는 `readCaseTag` 의 길이·문자 상한에 걸려 **조용히 사라진다.** 사라진
  꼬리표는 오류를 내지 않고 그 케이스의 줄을 「꼬리표 없음」으로 떨어뜨려, 화면이 칸을 못
  가르는데 아무도 이유를 모른다. 우리가 매기면 항상 상한 안이고 항상 안전한 문자다.
- 화면 칸 제목은 사용자가 아는 이름이어야 한다. 그래서 `RelayCase` 가 `id` 와 `tag` 를
  둘 다 나른다 — 나르는 값과 보이는 값을 가른다.
- 중계기마다 프로세스를 따로 띄우면(선택지 3) 사용자의 서버가 N 벌 뜬다. 상태를 가진
  서버에서 그것은 다른 실험이다.
- 중계기는 **스스로 끝나지 않는 유일한 실행**이다. 「그만」이라고 말하는 길이 필요한데
  `RunRegistry` 에는 취소가 없고 `RunSummary` 는 끝나는 실행을 전제한 모양이다. 얹으면 그
  타입들이 전부 「끝나지 않을 수도 있는 실행」을 담게 된다.

## 결과
- `RelayCase.tag` 가 공개 면에 생긴다. 브라우저와 서버가 같이 쓴다.
- `DELETE /api/relay/:id` 가 **닫힌 것을 확인하고 나서** 응답한다. 브라우저의
  `[실행 시작]` 이 그 응답을 기다린다 — 안 그러면 같은 서버가 두 벌 뜬다.
- `dashboard` 가 `@mcpeak/mock` 에 의존한다(`relayBinPath()`). 의존 방향표에 이미 허용된
  아래 방향이라 경계는 유지된다.
- `generate` 의 공개 면은 더 넓어지지 않는다. MCP 를 여는 argv 는 대시보드에만 산다(ADR-0104).
```

- [ ] **Step 3: changeset 을 넣는다**

`@mcpeak/dashboard` 는 `private: false` 이고 공개 면(`/api/relay` 통로 셋)이 넓어졌다. `minor` 다.

```bash
cd /Users/cheonjamin/projects/mcptest && ls .changeset/*.md | head -3   # 기존 형식을 먼저 본다
```

```markdown
---
"@mcpeak/dashboard": minor
---

판정 전에 서버의 실제 응답을 보는 4 단계 화면을 붙인다. 중계기를 띄워 케이스마다 AI 를
하나씩 동시에 돌리고, 중계기가 서버에서 직접 받은 본문을 케이스별 칸으로 보여준다.
```

- [ ] **Step 4: 보고하고 멈춘다**

```
docs(adr): 케이스 꼬리표를 대시보드가 매기고 중계 통로를 나눈 판단을 남긴다
chore(release): 대시보드 4 단계 화면에 changeset 을 넣는다
```

---

## 웨이브 끝 게이트 — 메인 세션이 직접 돌린다

배분받은 세션에는 금지한 명령이다(`CLAUDE.local.md` §4). 커밋 전에 **메인 세션이** 돌린다.

```bash
cd /Users/cheonjamin/projects/mcptest
corepack pnpm vitest run packages/dashboard >/dev/null 2>&1; echo "unit+e2e exit=$?"
corepack pnpm vitest run --project web >/dev/null 2>&1; echo "web exit=$?"
corepack pnpm --filter @mcpeak/dashboard typecheck >/dev/null 2>&1; echo "typecheck exit=$?"
corepack pnpm biome check . >/dev/null 2>&1; echo "lint exit=$?"
```

- **종료 코드는 파이프 없이 읽는다**(§2). 위 형태가 그것이다.
- **web 은 exit 1 이 정상이다** — 기준선이 81 건 실패다. 파이프 없는 확인과 별개로 한 번 더 돌려 **숫자가 81 인지** 눈으로 봐라. 늘었으면 내가 깬 것이다.
- **`Test Files ... passed` 줄이 출력에 있는지** 확인해라. 없으면 스크립트가 없는 것을 부른 것이다(§2 거짓 신호 1번).
- **`not implemented` 스텁이 남지 않았는지** 본다: `grep -rn "not implemented" packages/dashboard/src packages/dashboard/web/src` — 건수는 stdout, 종료 코드는 `$?` 다. 섞지 마라.
- **빌드 산출물을 의심한다.** dist 를 보는 확인이 있으면 `pnpm build` 성공이 최신 dist 를 뜻하지 않는다(turbo 캐시). 고친 심볼을 `dist` 에서 grep 하고, 없으면 그 패키지에서 `npx tsdown --config-loader native`.
- **커밋 범위에 미커밋 사용자 파일이 섞이지 않았는지** `git log --name-only` 로 확인한다. `git add -A` 를 쓰지 말고 경로를 하나씩 지정한다. 특히 `packages/mock/tests/stdio-e2e.test.ts` 는 사용자 것이다.

## 주의사항 (실행 중 계속 유효)

- **결정론성.** 4 단계는 테스트 경로가 아니다(설계 §2-3). 진짜 서버와 AI 가 끼므로 같은 결과를 보장하지 않는다. **그래서 E2E 에서 AI 를 가짜로 바꾼다.** 이 구분이 흐려지면 안 된다.
- **동시 실행의 대가.** 케이스들이 한 서버를 동시에 친다. 상태를 가진 서버는 돌릴 때마다 결과가 달라질 수 있다. 사용자가 알고 고른 것이다.
- **종료 코드 0 이 성공이 아니다.** 툴을 불렀는지는 **중계기 기록 줄로만** 판정한다.
- **stderr 에 JSON 이 아닌 줄이 섞인다.** 자식 서버의 stderr 가 같은 채널로 흐른다. 파싱 실패한 줄은 건너뛰되 **건수를 센다.**
- **로컬 `main` 이 낡으면 있지도 않은 버그를 진단하게 된다.** 시작 전에 `git fetch` 로 격차를 본다.
- **회귀 테스트를 새로 썼으면 수정을 빼고 한 번 돌려 실패를 본다.** 특히 테스트 10(닫기 순서)과 11(호출 없음) — 둘 다 「아무것도 검증하지 않는 테스트」가 되기 쉬운 모양이다(Task 5 Step 5).
- **커밋·푸시는 사람이 한다.**
