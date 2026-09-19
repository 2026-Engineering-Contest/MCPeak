# mock 중계기 1 단계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**목표:** `@mcpeak/mock` 에 중계기 파일 세 개(`relay.ts` · `relay-server.ts` · `relay-log.ts`)와 그 테스트를 **추가**한다. 기존 목 코드는 한 줄도 건드리지 않는다.

**출처:** `docs/superpowers/specs/2026-09-16-mock-to-relay-design.md` (확정본). 그 문서 §7 의 1 단계, §8 의 테스트 13 건이 이 계획의 전부다. 2·3·4 단계는 이 계획에 없다.

**구조:** 앞에 Streamable HTTP, 뒤에 stdio 자식 하나. SDK 의 `Server`/`Client` 를 쓰지 않고 트랜스포트 둘의 `onmessage`/`send` 를 직접 잇는다. 해석하는 지점을 만들지 않는 것이 요점이다 — 값을 만들지도 바꾸지도 않는다는 규율이 구조로 보장된다.

**기술:** TypeScript (ESM, `verbatimModuleSyntax`) · `@modelcontextprotocol/sdk` **1.30.0 고정** · vitest · tsdown · biome.

---

## Global Constraints

이 절은 모든 태스크의 요구사항에 암묵적으로 포함된다.

- **다른 패키지를 수정하지 않는다.** 이 계획이 건드리는 것은 `packages/mock/**` 와 `docs/adr/**` 뿐이다. 다른 경로를 고쳐야 할 것 같으면 **멈추고 사용자에게 알린다** (`CLAUDE.md`).
- **기존 목 파일 무수정.** `src/index.ts` · `src/stdio.ts` · `src/input-validation.ts` · `src/key-violation.ts` 와 기존 테스트 4 개는 이 단계에서 한 줄도 바뀌지 않는다. `packages/mock/package.json` 과 `tsdown.config.mjs` 는 **추가만** 한다(기존 줄 삭제 금지). 이유: 1 단계는 "아무것도 안 깨진다" 가 계약이고, 목 삭제는 3 단계다.
- **새 의존성 0 개.** `node:*` 내장 모듈과 이미 있는 `@modelcontextprotocol/sdk` 만 쓴다. `sdk` 에 `^` 를 붙이거나 2.x 로 올리지 않는다.
- **`core/src/types.ts` 의 `McpClient` · `ToolResult` 를 건드리지 않는다.** 중계기는 `@mcpeak/core` 를 import 하지 않는다.
- **`exports` 를 추가하지 않는다.** 중계기는 bin 전용이다. 테스트만 `../src/relay-server.js` 처럼 내부 모듈을 직접 import 한다 (설계 §2-6).
- **stdout 에 아무것도 쓰지 않는다.** 기록은 전부 stderr 다 (설계 §4 「기록 채널」).
- **결정론성.** 시간은 `ms` 필드 한 곳에만 둔다. `Math.random` · `randomUUID` · `toLocaleString` · `Intl` 을 쓰지 않는다(로케일 의존). 자리수 구분은 직접 구현한다.
- **커밋·푸시는 사람이 한다.** 어떤 태스크도 `git commit` · `git push` · `git merge` 를 실행하지 않는다. 각 태스크 마지막 단계는 **권장 커밋 메시지와 변경 파일 목록을 제시**하고 멈추는 것이다. 사람이 만든 SHA 를 확인한 뒤 다음 태스크로 간다 (`CLAUDE.md`, `CLAUDE.local.md` §4).
- **커밋 scope 는 `mock`** (ADR 커밋만 `adr`). Conventional Commits.
- **실제 프로세스를 띄우는 스펙은 파일명이 `*-e2e.test.ts` 여야 한다.** 러너가 파일명으로 직렬 웨이브를 판정한다(`vitest.config.ts`, #119). 중계기 테스트는 자식 프로세스를 띄우고 포트를 연다 — **설계 §8 이 "유닛" 이라고 부른 1–11 번도 이 저장소 기준으로는 e2e 갈래다.** 순수 함수인 `relay-log` 만 `relay-log.test.ts` 다.
- **`pnpm` 이 PATH 에 없으면** `corepack pnpm` 으로 바꿔 부른다 (`CLAUDE.local.md` §5).
- **테스트 녹색을 그대로 믿지 않는다.** 매 실행에서 출력의 `Test Files ... passed` 줄과 **수집된 테스트 수**를 눈으로 확인한다. 0 건 수집은 녹색으로 보인다 (`CLAUDE.local.md` §2).

### 설계 문서에 없어서 이 계획이 정한 것 (사람 확인 필요)

구현 전에 훑고, 다르면 계획을 고친 뒤 시작한다.

| # | 자리 | 이 계획의 결정 | 근거 |
|---|---|---|---|
| A | 세션 여럿이 같은 `id` 를 쓴다 | **봉투의 `id` 를 중계기가 재작성한다.** 단조 증가 정수를 새로 매기고, 돌아올 때 원래 `id` 로 되돌린다. `params`·`result` 는 손대지 않는다 | `claude -p` 는 질문마다 새 프로세스라 두 세션이 모두 `id:1` 로 시작한다. 설계 §5 는 "`id` 로 매칭" 까지만 적었는데, 그대로 하면 나중 세션이 앞 세션의 대기 항목을 덮어쓴다 (테스트 11 이 이걸 잡는다) |
| B | 기록 줄의 `id` | **중계기가 매긴 id** 를 싣는다 | 4 단계 대시보드가 req·res 를 짝지어야 하는데, 클라이언트 id 를 쓰면 세션 둘이 똑같이 `1` 을 낸다 |
| C | `1,240자` 인데 JSON 키는 `bytes` (설계 §4 안에서 어긋난다) | **바이트로 통일한다.** `Buffer.byteLength(JSON.stringify(result), "utf8")`, 사람 줄은 `1,240바이트` | 한글은 글자수와 바이트가 3 배 차이라 둘을 섞으면 화면과 보고서가 다른 수를 말한다. 문안이냐 키냐 중 **공개 JSON 키**(major 없이 못 바꾼다)를 살렸다 |
| D | `isError: true` 결과의 기록 문안 | `← tools/call  boom 툴 오류 · 84바이트 · 0.1초`, JSON 은 `"ok":false,"isError":true` | 프로토콜 오류가 아니므로 `오류 -32602` 문형과 구분해야 한다. 설계에 문안이 없다 |
| E | 기동 안내 줄 | `→ 중계기 대기 중 http://127.0.0.1:7400/mcp`, `--json` 이면 `{"dir":"up","port":7400,"url":"..."}` | `--port 0` 이면 받은 포트를 알려 줄 채널이 이것뿐이다. 4 단계 대시보드도 이 줄로 URL 을 안다 |
| F | 알림(`notifications/*`)은 기록하지 않고 통과만 시킨다 | 테스트 6 이 "요청·응답 한 쌍으로 순서대로" 를 본다 | `notifications/initialized` 를 기록하면 짝이 안 맞는 줄이 끼어든다 |
| G | 자식이 먼저 죽으면 대기 중인 세션의 트랜스포트를 닫는다 | 오류 문장을 지어내지 않는다 — HTTP 연결만 끊는다 | "오류는 진짜 서버가 준 것을 그대로 쓴다" (설계 §4). 중계기가 JSON-RPC 오류를 만들면 그 규칙이 깨진다 |
| H | 자식 stderr 는 `inherit` | 진짜 서버의 로그가 사용자 터미널에 그대로 보인다 | 대가: `--json` 모드의 stderr 에 JSON 아닌 줄이 섞인다. 4 단계 대시보드는 **파싱 실패한 줄을 건너뛰어야 한다** — 2 단계 핸드오프에 적는다 |
| I | 서버발 요청(sampling·roots 등)은 돌려보낼 세션이 없다 | 기록만 하고 버린다 | stateless HTTP 에 서버→클라이언트 채널이 없다. 1 단계 범위 밖 |

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `packages/mock/src/relay-log.ts` (신규) | 기록 줄 문안. **순수 함수만.** 시간·I/O·전역 없음 |
| `packages/mock/src/relay-server.ts` (신규) | `startRelay()` — HTTP 기동 · 자식 spawn · 파이프 · id 매핑 · 수명 |
| `packages/mock/src/relay.ts` (신규) | bin 진입점 — argv 파싱 · stderr 배선 · 신호 · 종료 코드 |
| `packages/mock/tests/relay-log.test.ts` (신규) | 순수 함수 단위 테스트 (유닛 웨이브) |
| `packages/mock/tests/relay-e2e.test.ts` (신규) | `startRelay` 를 in-process 로 띄우는 테스트 (§8-1~11). 자식 프로세스를 띄우므로 e2e 웨이브 |
| `packages/mock/tests/relay-bin-e2e.test.ts` (신규) | bin 을 spawn 하는 테스트 (§8-12·13) |
| `packages/mock/tests/fixtures/relay-child.mjs` (신규) | 테스트용 가짜 MCP 서버. SDK 없이 줄단위 JSON-RPC 를 직접 다룬다 |
| `packages/mock/package.json` (수정: `bin` 에 한 줄 추가) | `mcpeak-relay` 진입점 노출. `mcpeak-mock` 은 그대로 둔다 |
| `packages/mock/tsdown.config.mjs` (수정: `entry` 에 한 줄 추가) | `src/relay.ts` 를 빌드 대상에 넣는다 |
| `docs/adr/0101-*.md` (신규) + `docs/adr/README.md` (표에 한 줄) | 1 단계의 설계 결정 기록 |

---

## Task 1: 기록 줄 문안 (`relay-log.ts`) (§8-10)

**모델:** 상위 · 추론 높음 (`CLAUDE.local.md` §1 승급 목록 1번 — 실패·기록 메시지 문안은 여러 소비자가 그대로 쓰는 계약이다)

**Files:**
- Create: `packages/mock/src/relay-log.ts`
- Test: `packages/mock/tests/relay-log.test.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `RelayRequestEvent` · `RelayResponseEvent` · `humanRequest(e): string` · `humanResponse(e): string` · `jsonRequest(e): string` · `jsonResponse(e): string` · `groupDigits(n): string` · `formatSeconds(ms): string`. Task 6 이 이 여섯 함수를 부른다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/mock/tests/relay-log.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  formatSeconds,
  groupDigits,
  humanRequest,
  humanResponse,
  jsonRequest,
  jsonResponse,
} from "../src/relay-log.js";

describe("humanRequest", () => {
  it("인자 없는 호출은 메서드만 적는다", () => {
    expect(humanRequest({ id: 1, method: "tools/list" })).toBe("→ tools/list");
  });

  it("tools/call 은 툴 이름과 인자를 그대로 싣는다", () => {
    expect(
      humanRequest({ id: 3, method: "tools/call", tool: "get_forecast", args: { city: "부산" } }),
    ).toBe('→ tools/call  get_forecast {"city":"부산"}');
  });

  it("인자를 줄이지 않는다 — 긴 인자도 전문이 실린다", () => {
    const args = { note: "가".repeat(300) };
    const line = humanRequest({ id: 4, method: "tools/call", tool: "add_note", args });
    expect(line).toContain(JSON.stringify(args));
    expect(line).not.toContain("…");
  });
});

describe("humanResponse", () => {
  it("tools/list 는 툴 개수를 적는다", () => {
    expect(
      humanResponse({ id: 1, method: "tools/list", kind: "ok", bytes: 900, ms: 12, toolCount: 10 }),
    ).toBe("← tools/list  툴 10개");
  });

  it("성공한 tools/call 은 크기와 시간을 적는다", () => {
    expect(
      humanResponse({
        id: 3,
        method: "tools/call",
        tool: "get_forecast",
        kind: "ok",
        bytes: 1240,
        ms: 1834,
      }),
    ).toBe("← tools/call  get_forecast 성공 · 1,240바이트 · 1.8초");
  });

  it("isError 결과는 프로토콜 오류와 다른 문형으로 적는다", () => {
    expect(
      humanResponse({ id: 5, method: "tools/call", tool: "boom", kind: "toolError", bytes: 84, ms: 120 }),
    ).toBe("← tools/call  boom 툴 오류 · 84바이트 · 0.1초");
  });

  it("프로토콜 오류는 서버가 준 코드와 메시지를 그대로 적는다", () => {
    expect(
      humanResponse({
        id: 6,
        method: "tools/call",
        tool: "convert_units",
        kind: "protocolError",
        code: -32602,
        message: "Structured content does not match the tool's output schema",
        ms: 30,
      }),
    ).toBe(
      "← tools/call  convert_units 오류 -32602 Structured content does not match the tool's output schema",
    );
  });
});

describe("jsonRequest · jsonResponse", () => {
  it("요청 줄이 파싱되고 필드가 맞다", () => {
    const line = jsonRequest({
      id: 3,
      method: "tools/call",
      tool: "get_forecast",
      args: { city: "부산" },
    });
    expect(JSON.parse(line)).toEqual({
      dir: "req",
      id: 3,
      method: "tools/call",
      tool: "get_forecast",
      args: { city: "부산" },
    });
  });

  it("인자·툴이 없으면 그 키를 내지 않는다", () => {
    expect(JSON.parse(jsonRequest({ id: 1, method: "tools/list" }))).toEqual({
      dir: "req",
      id: 1,
      method: "tools/list",
    });
  });

  it("성공 응답 줄이 파싱되고 필드가 맞다", () => {
    const line = jsonResponse({
      id: 3,
      method: "tools/call",
      tool: "get_forecast",
      kind: "ok",
      bytes: 1240,
      ms: 1834,
    });
    expect(JSON.parse(line)).toEqual({
      dir: "res",
      id: 3,
      tool: "get_forecast",
      ok: true,
      bytes: 1240,
      ms: 1834,
    });
  });

  it("툴 오류는 ok:false 와 isError:true 로 구분된다", () => {
    expect(
      JSON.parse(jsonResponse({ id: 5, method: "tools/call", tool: "boom", kind: "toolError", bytes: 84, ms: 120 })),
    ).toEqual({ dir: "res", id: 5, tool: "boom", ok: false, isError: true, bytes: 84, ms: 120 });
  });

  it("프로토콜 오류는 코드와 메시지를 싣는다", () => {
    expect(
      JSON.parse(
        jsonResponse({
          id: 6,
          method: "tools/call",
          tool: "convert_units",
          kind: "protocolError",
          code: -32602,
          message: "boom",
          ms: 30,
        }),
      ),
    ).toEqual({ dir: "res", id: 6, tool: "convert_units", ok: false, code: -32602, message: "boom", ms: 30 });
  });

  it("줄에 개행이 없다 — 한 호출이 한 줄이다", () => {
    const args = { text: "첫 줄\n둘째 줄" };
    expect(jsonRequest({ id: 1, method: "tools/call", tool: "echo", args })).not.toContain("\n");
    expect(humanRequest({ id: 1, method: "tools/call", tool: "echo", args })).not.toContain("\n");
  });
});

describe("서식 보조", () => {
  it("자리수를 세 자리마다 끊는다", () => {
    expect(groupDigits(0)).toBe("0");
    expect(groupDigits(999)).toBe("999");
    expect(groupDigits(1240)).toBe("1,240");
    expect(groupDigits(1234567)).toBe("1,234,567");
  });

  it("초는 소수 한 자리다", () => {
    expect(formatSeconds(0)).toBe("0.0초");
    expect(formatSeconds(120)).toBe("0.1초");
    expect(formatSeconds(1834)).toBe("1.8초");
  });
});
```

- [ ] **Step 2: 실패하는 것을 본다**

실행: `pnpm exec vitest run packages/mock/tests/relay-log.test.ts`
예상: `Failed to resolve import "../src/relay-log.js"` 로 파일 전체가 실패.

- [ ] **Step 3: 최소 구현을 쓴다**

`packages/mock/src/relay-log.ts`:

```ts
/**
 * 중계기 기록 줄의 문안. **순수 함수만 둔다** — 시간·난수·I/O·전역 상태가 없다.
 *
 * 이 파일이 따로 있는 이유는 테스트가 stderr 를 파싱하지 않고 문안을 직접 보기
 * 위해서다. `startRelay` 는 `log(line)` 을 주입받아 이 함수들의 결과를 흘린다.
 *
 * 문안 규칙 세 가지는 설계(§4 「기록 채널」)가 못박은 것이다.
 *   1. 인자는 줄이지 않는다 — 무엇을 보냈는지가 이 화면의 존재 이유다.
 *   2. 오류는 진짜 서버가 준 코드·메시지를 그대로 쓴다. 고쳐 쓰지 않는다.
 *   3. 시간은 `ms` 한 곳에만 둔다 — 결정론성 규칙에 걸리는 유일한 필드다.
 */

export interface RelayRequestEvent {
  /** 중계기가 매긴 id. 클라이언트의 id 가 아니다 — 세션 둘이 같은 값을 쓴다. */
  readonly id: number;
  readonly method: string;
  readonly tool?: string;
  readonly args?: unknown;
}

export type RelayResponseEvent = {
  readonly id: number;
  readonly method: string;
  readonly tool?: string;
  readonly ms: number;
} & (
  | { readonly kind: "ok"; readonly bytes: number; readonly toolCount?: number }
  | { readonly kind: "toolError"; readonly bytes: number }
  | { readonly kind: "protocolError"; readonly code: number; readonly message: string }
);

/**
 * 세 자리마다 쉼표를 넣는다. `toLocaleString` 을 쓰지 않는 이유는 로케일에 따라
 * 결과가 달라지기 때문이다 — 같은 입력에 같은 출력이 이 저장소의 핵심 가치다.
 */
export function groupDigits(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}초`;
}

export function humanRequest(event: RelayRequestEvent): string {
  const head = `→ ${event.method}`;
  if (event.tool === undefined) return head;
  const args = event.args === undefined ? "" : ` ${JSON.stringify(event.args)}`;
  return `${head}  ${event.tool}${args}`;
}

export function humanResponse(event: RelayResponseEvent): string {
  const label = event.tool === undefined ? `← ${event.method}` : `← ${event.method}  ${event.tool}`;
  if (event.kind === "protocolError") {
    return `${label} 오류 ${event.code} ${event.message}`;
  }
  if (event.kind === "ok" && event.toolCount !== undefined) {
    return `${label}  툴 ${event.toolCount}개`;
  }
  const verdict = event.kind === "ok" ? "성공" : "툴 오류";
  return `${label} ${verdict} · ${groupDigits(event.bytes)}바이트 · ${formatSeconds(event.ms)}`;
}

export function jsonRequest(event: RelayRequestEvent): string {
  // 키 순서를 리터럴로 고정한다. 조건부 전개라 순서가 흔들리면 4 단계의 스냅샷
  // 비교가 이유 없이 깨진다.
  return JSON.stringify({
    dir: "req",
    id: event.id,
    method: event.method,
    ...(event.tool === undefined ? {} : { tool: event.tool }),
    ...(event.args === undefined ? {} : { args: event.args }),
  });
}

export function jsonResponse(event: RelayResponseEvent): string {
  const head = {
    dir: "res" as const,
    id: event.id,
    ...(event.tool === undefined ? {} : { tool: event.tool }),
  };
  if (event.kind === "protocolError") {
    return JSON.stringify({ ...head, ok: false, code: event.code, message: event.message, ms: event.ms });
  }
  if (event.kind === "toolError") {
    return JSON.stringify({ ...head, ok: false, isError: true, bytes: event.bytes, ms: event.ms });
  }
  return JSON.stringify({
    ...head,
    ok: true,
    ...(event.toolCount === undefined ? {} : { tools: event.toolCount }),
    bytes: event.bytes,
    ms: event.ms,
  });
}
```

- [ ] **Step 4: 통과하는 것을 본다**

실행: `pnpm exec vitest run packages/mock/tests/relay-log.test.ts`
예상: `Test Files  1 passed (1)` · `Tests  15 passed (15)`. **테스트 수를 눈으로 확인한다** — 0 건 수집도 초록으로 보인다.

- [ ] **Step 5: 타입체크·린트**

실행:
```bash
pnpm --filter @mcpeak/mock typecheck
pnpm exec biome check packages/mock/src/relay-log.ts packages/mock/tests/relay-log.test.ts
```
예상: 둘 다 오류 0. 린트가 파일을 실제로 **몇 개** 검사했다고 찍는지 확인한다.

- [ ] **Step 6: 사람에게 커밋을 요청한다 (직접 실행하지 않는다)**

변경 파일: `packages/mock/src/relay-log.ts`, `packages/mock/tests/relay-log.test.ts`

권장 메시지:
```
feat(mock): 중계기 기록 줄 문안을 순수 함수로 추가한다
```
사람이 만든 SHA 를 확인한 뒤 Task 2 로 간다.

---

## Task 2: 가짜 MCP 서버 픽스처 + 파이프 왕복 (§8-1·2·4·5)

**모델:** 표준 · 추론 보통 (승인된 계약에 따른 기계적 배선)

**Files:**
- Create: `packages/mock/tests/fixtures/relay-child.mjs`
- Create: `packages/mock/src/relay-server.ts`
- Test: `packages/mock/tests/relay-e2e.test.ts`

**Interfaces:**
- Consumes: 없음 (Task 1 의 함수는 Task 6 에서 배선한다 — 여기서는 `log` 를 받기만 하고 부르지 않는다)
- Produces: `RelayOptions` · `RelayHandle` · `startRelay(options): Promise<RelayHandle>`. Task 4·5·6 이 같은 파일을 넓히고, Task 7 의 bin 과 Task 8 의 E2E 가 이것을 부른다.

- [ ] **Step 1: 가짜 서버 픽스처를 쓴다**

SDK 를 쓰지 않는다. SDK `Server` 는 스키마에 안 맞는 응답을 못 내보내는데, 테스트 3 이 정확히 그것을 요구한다.

`packages/mock/tests/fixtures/relay-child.mjs`:

```js
#!/usr/bin/env node
/**
 * 중계기 테스트용 가짜 MCP 서버 (stdio). **SDK 를 쓰지 않는다.**
 *
 * SDK `Server` 는 `outputSchema` 에 맞지 않는 `structuredContent` 를 내보내지 못한다.
 * 그런데 §8-3 회귀 테스트는 "진짜 서버가 잘못된 응답을 내면 중계기가 걸러내지 않고
 * 그대로 통과시킨다" 를 봐야 하므로, 잘못된 응답을 **의도적으로** 낼 수 있는 서버가
 * 필요하다. 그래서 줄단위 JSON-RPC 를 직접 다룬다.
 *
 * 응답은 전부 고정값이다 — 랜덤·타임스탬프를 쓰지 않는다.
 *
 * argv:
 *   --exit-after-initialize   initialize 에 답한 뒤 스스로 종료한다 (§8-8)
 * env:
 *   MCPEAK_RELAY_TEST_PIDFILE  주어지면 자기 pid 를 그 경로에 쓴다 (§8-13)
 */
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const exitAfterInitialize = argv.includes("--exit-after-initialize");
const pidfile = process.env.MCPEAK_RELAY_TEST_PIDFILE;
if (pidfile !== undefined) writeFileSync(pidfile, String(process.pid), "utf8");

const TOOLS = [
  {
    name: "echo",
    description: "받은 인자를 그대로 돌려준다.",
    inputSchema: { type: "object", properties: { text: { type: "string" } } },
  },
  {
    name: "bad_structured",
    description: "outputSchema 와 맞지 않는 structuredContent 를 낸다 (고의).",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: { temperature: { type: "number" } },
      required: ["temperature"],
    },
  },
  {
    name: "boom",
    description: "isError: true 인 결과를 낸다.",
    inputSchema: { type: "object", properties: {} },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function callResult(name, args) {
  if (name === "bad_structured") {
    // outputSchema 는 temperature(number) 를 요구하는데 temp(string) 를 낸다.
    return { content: [{ type: "text", text: "고장" }], structuredContent: { temp: "21" } };
  }
  if (name === "boom") {
    return { content: [{ type: "text", text: "툴이 실패했습니다" }], isError: true };
  }
  return {
    content: [{ type: "text", text: JSON.stringify(args ?? {}) }],
    structuredContent: { echo: args ?? {} },
  };
}

function handle(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "relay-child", version: "0.0.0" },
      },
    });
    if (exitAfterInitialize) setTimeout(() => process.exit(0), 10);
    return;
  }
  if (method === "notifications/initialized") return;
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }
  if (method === "tools/call") {
    send({ jsonrpc: "2.0", id, result: callResult(params?.name, params?.arguments) });
    return;
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf("\n");
  while (index !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line.length > 0) handle(JSON.parse(line));
    index = buffer.indexOf("\n");
  }
});
process.stdin.on("close", () => process.exit(0));
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

파일명이 `*-e2e.test.ts` 인 것이 중요하다 — 자식 프로세스를 띄우므로 직렬 웨이브로 가야 한다.

`packages/mock/tests/relay-e2e.test.ts`:

```ts
import { fileURLToPath } from "node:url";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { type RelayHandle, startRelay } from "../src/relay-server.js";

const CHILD = fileURLToPath(new URL("./fixtures/relay-child.mjs", import.meta.url));

const open: RelayHandle[] = [];
const sessions: Session[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close();
  for (const handle of open.splice(0)) await handle.close();
});

interface Session {
  call(id: number, method: string, params?: unknown): Promise<JSONRPCMessage>;
  notify(method: string, params?: unknown): Promise<void>;
  close(): Promise<void>;
}

/**
 * 중계기에 붙는 클라이언트. **SDK `Client` 를 쓰지 않는다** — `Client` 는
 * `structuredContent` 를 `outputSchema` 로 검증해서 던지므로, 중계기가 무엇을
 * 통과시켰는지 보는 테스트가 클라이언트 쪽 검증에 가려진다 (§8-3 이 그 자리다).
 * 트랜스포트만 써서 봉투를 그대로 본다.
 */
async function openSession(url: string): Promise<Session> {
  const transport = new StreamableHTTPClientTransport(new URL(url));
  const waiters = new Map<number, (m: JSONRPCMessage) => void>();
  transport.onmessage = (message) => {
    if ("id" in message && typeof message.id === "number") waiters.get(message.id)?.(message);
  };
  await transport.start();
  const session: Session = {
    call: (id, method, params) =>
      new Promise<JSONRPCMessage>((resolve) => {
        waiters.set(id, resolve);
        void transport.send({
          jsonrpc: "2.0",
          id,
          method,
          ...(params === undefined ? {} : { params }),
        } as JSONRPCMessage);
      }),
    notify: (method, params) =>
      transport.send({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) } as JSONRPCMessage),
    close: () => transport.close(),
  };
  sessions.push(session);
  // 핸드셰이크는 클라이언트와 진짜 서버가 직접 한다 — 중계기는 지나가게만 둔다(설계 §4).
  await session.call(0, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "relay-test", version: "0.0.0" },
  });
  await session.notify("notifications/initialized");
  return session;
}

async function startFixtureRelay(
  extra: readonly string[] = [],
): Promise<{ handle: RelayHandle; lines: string[] }> {
  const lines: string[] = [];
  const handle = await startRelay({
    port: 0,
    command: process.execPath,
    args: [CHILD, ...extra],
    log: (line) => lines.push(line),
    json: false,
  });
  open.push(handle);
  return { handle, lines };
}

describe("startRelay — 진짜 서버가 답한다", () => {
  it("§8-1 tools/list 가 진짜 서버가 선언한 목록 그대로 온다", async () => {
    const { handle } = await startFixtureRelay();
    const session = await openSession(handle.url);

    const response = await session.call(1, "tools/list");

    expect(response).toMatchObject({
      id: 1,
      result: {
        tools: [
          { name: "echo", description: "받은 인자를 그대로 돌려준다." },
          { name: "bad_structured" },
          { name: "boom" },
        ],
      },
    });
  });

  it("§8-2 tools/call 결과가 structuredContent 까지 그대로 온다", async () => {
    const { handle } = await startFixtureRelay();
    const session = await openSession(handle.url);

    const response = await session.call(2, "tools/call", {
      name: "echo",
      arguments: { text: "부산" },
    });

    expect(response).toMatchObject({
      id: 2,
      result: {
        content: [{ type: "text", text: '{"text":"부산"}' }],
        structuredContent: { echo: { text: "부산" } },
      },
    });
  });

  it("§8-4 isError: true 가 프로토콜 오류로 바뀌지 않는다", async () => {
    const { handle } = await startFixtureRelay();
    const session = await openSession(handle.url);

    const response = await session.call(3, "tools/call", { name: "boom", arguments: {} });

    expect(response).not.toHaveProperty("error");
    expect(response).toMatchObject({ id: 3, result: { isError: true } });
  });

  it("§8-5 서버가 낸 -32601 이 그대로 온다", async () => {
    const { handle } = await startFixtureRelay();
    const session = await openSession(handle.url);

    const response = await session.call(4, "resources/list");

    expect(response).toMatchObject({
      id: 4,
      error: { code: -32601, message: "Method not found: resources/list" },
    });
  });

  it("port 0 이면 받은 포트를 handle 로 돌려준다", async () => {
    const { handle } = await startFixtureRelay();

    expect(handle.port).toBeGreaterThan(0);
    expect(handle.url).toBe(`http://127.0.0.1:${handle.port}/mcp`);
  });
});
```

- [ ] **Step 3: 실패하는 것을 본다**

실행: `pnpm exec vitest run --project e2e packages/mock/tests/relay-e2e.test.ts`
예상: `Failed to resolve import "../src/relay-server.js"`.

- [ ] **Step 4: 최소 구현을 쓴다**

`packages/mock/src/relay-server.ts`:

```ts
import { createServer, type Server as HttpServer } from "node:http";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/**
 * 중계기 — 앞은 Streamable HTTP, 뒤는 stdio 자식 하나.
 *
 * **SDK 의 `Server`·`Client` 를 쓰지 않는다.** 트랜스포트 둘의 `onmessage`/`send` 를
 * 직접 잇는다. `Client` 를 끼우면 그것이 `structuredContent` 를 `outputSchema` 로
 * 검증해서 진짜 서버의 잘못된 응답을 **중계기가 대신 받아** 던진다. 그러면 사용자는
 * 서버의 답이 아니라 중계기가 만든 오류를 보게 되고, "진짜 서버가 답한다" 가 깨진다.
 * 이 구조를 고정하는 회귀 테스트가 relay-e2e 의 §8-3 이다.
 *
 * 해석하는 지점이 없다는 것이 요점이다 — `initialize` 도 그대로 지나간다. 중계기가
 * 능력을 대신 선언하는 순간 그것은 중계가 아니다.
 */
export interface RelayOptions {
  /** 0 이면 임의 포트를 받아 handle.port 로 돌려준다. */
  port: number;
  command: string;
  args: readonly string[];
  /** 한 줄씩 부른다. bin 은 stderr 쓰기를 넣고, 테스트는 배열에 모은다. */
  log: (line: string) => void;
  json: boolean;
}

export interface RelayHandle {
  readonly port: number;
  readonly url: string;
  /** HTTP 를 닫고 자식이 실제로 끝날 때까지 기다린다. */
  close(): Promise<void>;
}

const HOST = "127.0.0.1";

function isRequest(message: JSONRPCMessage): message is JSONRPCMessage & { id: string | number; method: string } {
  return "method" in message && "id" in message;
}

export async function startRelay(options: RelayOptions): Promise<RelayHandle> {
  const { port, command, args, log } = options;

  const child = new StdioClientTransport({ command, args: [...args], stderr: "inherit" });
  await child.start();

  const http: HttpServer = createServer((req, res) => {
    // stateless 모드는 요청마다 새 transport 를 요구한다
    // (SDK: "Stateless transport cannot be reused across requests."). stateful 로 가면
    // sessionIdGenerator 가 randomUUID 를 쓰게 되어 결정론성이 깨진다.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    transport.onmessage = (message) => {
      void child.send(message);
    };
    res.on("close", () => {
      void transport.close();
    });
    void transport
      .start()
      .then(() => transport.handleRequest(req, res))
      .catch(() => {
        if (!res.headersSent) res.writeHead(500).end();
      });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      reject(
        error.code === "EADDRINUSE"
          ? new Error(
              [
                `→ 중계기를 띄우지 못했습니다: 포트 ${port} 이 이미 사용 중입니다 (${HOST}).`,
                "→ --port 0 을 주면 빈 포트를 자동으로 받습니다.",
                "→ 앞서 띄운 중계기를 닫지 않았는지도 확인하세요.",
              ].join("\n"),
            )
          : error,
      );
    };
    http.once("error", onError);
    http.listen(port, HOST, () => {
      http.off("error", onError);
      resolve();
    });
  });

  const address = http.address();
  if (address === null || typeof address === "string") {
    throw new Error("중계기 주소를 확인할 수 없습니다 (예상치 못한 address() 반환값).");
  }

  void log; // Task 6 에서 배선한다.
  void isRequest;

  return {
    port: address.port,
    url: `http://${HOST}:${address.port}/mcp`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        http.closeAllConnections();
        http.close((error) => (error ? reject(error) : resolve()));
      });
      await child.close();
    },
  };
}
```

응답을 돌려보내는 배선은 아직 없다 — 다음 단계에서 넣는다. 이 단계의 테스트는 그래서 아직 통과하지 않는다.

- [ ] **Step 5: 응답 경로를 잇는다**

`startRelay` 안, `const http = createServer(...)` **앞에** 대기표를 만들고 자식의 응답을 돌려보낸다.

```ts
  interface Pending {
    readonly transport: StreamableHTTPServerTransport;
    readonly clientId: string | number;
    readonly method: string;
    readonly tool?: string;
    readonly startedAt: number;
  }
  const pending = new Map<string | number, Pending>();

  child.onmessage = (message) => {
    if (!("id" in message) || message.id === null || isRequest(message)) {
      // 서버가 스스로 낸 요청·알림이다. stateless HTTP 에는 돌려보낼 채널이 없다 —
      // 1 단계 범위 밖이라 버린다.
      return;
    }
    const entry = pending.get(message.id);
    if (entry === undefined) return;
    pending.delete(message.id);
    void entry.transport.send({ ...message, id: entry.clientId });
  };
```

그리고 `transport.onmessage` 를 다음으로 바꾼다.

```ts
    transport.onmessage = (message) => {
      if (!isRequest(message)) {
        // 알림은 짝이 없다. 그대로 흘려보내고 기록하지 않는다 —
        // 기록하면 §8-6 이 보는 요청·응답 짝이 어긋난다.
        void child.send(message);
        return;
      }
      const params = (message as { params?: { name?: unknown; arguments?: unknown } }).params;
      const tool = typeof params?.name === "string" ? params.name : undefined;
      pending.set(message.id, {
        transport,
        clientId: message.id,
        method: message.method,
        tool,
        startedAt: Date.now(),
      });
      void child.send(message);
    };
```

- [ ] **Step 6: 통과하는 것을 본다**

실행: `pnpm exec vitest run --project e2e packages/mock/tests/relay-e2e.test.ts`
예상: `Test Files  1 passed (1)` · `Tests  5 passed (5)`.

- [ ] **Step 7: 타입체크·린트**

실행:
```bash
pnpm --filter @mcpeak/mock typecheck
pnpm exec biome check packages/mock
```
예상: 오류 0.

- [ ] **Step 8: 사람에게 커밋을 요청한다**

변경 파일: `packages/mock/src/relay-server.ts`, `packages/mock/tests/relay-e2e.test.ts`, `packages/mock/tests/fixtures/relay-child.mjs`

권장 메시지:
```
feat(mock): stdio 서버를 Streamable HTTP 로 중계하는 startRelay 를 추가한다
```

---

## Task 3: 응답을 해석하지 않는다 — 회귀 고정 (§8-3)

**모델:** 표준 · 추론 보통

**Files:**
- Modify: `packages/mock/tests/relay-e2e.test.ts` (describe 블록 추가)

**Interfaces:**
- Consumes: Task 2 의 `startRelay` · `openSession` · `startFixtureRelay`
- Produces: 없음 (테스트만)

- [ ] **Step 1: 회귀 테스트를 쓴다**

`relay-e2e.test.ts` 끝에 붙인다.

```ts
describe("중계기는 응답을 해석하지 않는다", () => {
  /**
   * **이 테스트는 구조를 고정한다.** 중계기에 `outputSchema` 검증을 넣거나 SDK `Client`
   * 를 끼우면 이 테스트가 실패한다 — 그게 이 테스트의 목적이다.
   *
   * SDK `Client` 는 `structuredContent` 를 `outputSchema` 로 검증해 `-32602` 를 던진다
   * (`examples/live-weather-server` 의 결함 A 가 내는 그 오류가 이 경로다). 중계기가
   * `Client` 를 쓰면 진짜 서버의 잘못된 응답을 중계기가 대신 받아서 던지고, 사용자는
   * 서버의 답이 아니라 중계기가 만든 오류를 본다. 설계 §2-2 가 거기서 깨진다.
   */
  it("§8-3 outputSchema 와 안 맞는 structuredContent 가 걸러지지 않고 그대로 간다", async () => {
    const { handle } = await startFixtureRelay();
    const session = await openSession(handle.url);

    const response = await session.call(9, "tools/call", {
      name: "bad_structured",
      arguments: {},
    });

    // 중계기가 만든 오류가 아니라 서버의 응답이 온다.
    expect(response).not.toHaveProperty("error");
    expect(response).toMatchObject({
      id: 9,
      result: { structuredContent: { temp: "21" } },
    });
    // 스키마가 요구하는 필드는 실제로 없다 — 즉 검증을 통과할 수 없는 값이다.
    // `JSONRPCMessage` 는 오류 갈래를 포함하는 유니온이라 곧바로 좁히면 TS2352 다.
    // 위 `toMatchObject` 가 이미 result 갈래임을 확인했으므로 `unknown` 을 경유한다.
    const result = (
      response as unknown as { result: { structuredContent: Record<string, unknown> } }
    ).result;
    expect(result.structuredContent).not.toHaveProperty("temperature");
  });
});
```

- [ ] **Step 2: 통과하는 것을 본다**

실행: `pnpm exec vitest run --project e2e packages/mock/tests/relay-e2e.test.ts`
예상: `Tests  6 passed (6)`.

- [ ] **Step 3: 이 테스트가 실제로 무언가를 잡는지 확인한다**

통과만 보고 넘기면 아무것도 검증하지 않는 테스트가 섞여 들어온다 (`CLAUDE.local.md` §2).
`relay-server.ts` 의 `child.onmessage` 안, `entry.transport.send(...)` 앞에 **일부러** 다음을 끼운다.

```ts
    // 임시 — 검증을 넣으면 이 테스트가 실패하는지 확인하는 용도. 확인 뒤 지운다.
    if ("result" in message) {
      const structured = (message.result as { structuredContent?: Record<string, unknown> })
        .structuredContent;
      if (structured !== undefined && !("temperature" in structured)) {
        void entry.transport.send({
          jsonrpc: "2.0",
          id: entry.clientId,
          error: { code: -32602, message: "Structured content does not match the tool's output schema" },
        });
        return;
      }
    }
```

실행: `pnpm exec vitest run --project e2e packages/mock/tests/relay-e2e.test.ts -t "§8-3"`
예상: **FAIL** — `expected { error: ... } not to have property "error"`.

- [ ] **Step 4: 임시 코드를 지운다**

Step 3 에서 끼운 블록을 지운다. 지운 뒤 `git diff packages/mock/src/relay-server.ts` 로 **남은 조각이 없는지 눈으로 본다** — 여기서 지우기를 빠뜨리면 §8-2 가 대신 깨진다.

실행: `pnpm exec vitest run --project e2e packages/mock/tests/relay-e2e.test.ts`
예상: `Tests  6 passed (6)`.

- [ ] **Step 5: 사람에게 커밋을 요청한다**

변경 파일: `packages/mock/tests/relay-e2e.test.ts`

권장 메시지:
```
test(mock): 중계기가 응답을 검증하지 않는다는 것을 회귀로 고정한다
```

---

## Task 4: 세션이 섞이지 않는다 — id 재작성 (§8-11)

**모델:** 표준 · 추론 보통

**Files:**
- Modify: `packages/mock/src/relay-server.ts`
- Modify: `packages/mock/tests/relay-e2e.test.ts`

**Interfaces:**
- Consumes: Task 2 의 `pending` 맵
- Produces: 중계기가 매긴 단조 증가 id. Task 6 의 기록 줄이 이 값을 싣는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`relay-e2e.test.ts` 끝에 붙인다.

```ts
describe("세션 격리", () => {
  /**
   * 대시보드는 `claude -p` 를 **질문마다 새 프로세스로** 띄운다. 새 프로세스는 JSON-RPC
   * id 를 1 부터 다시 시작하므로, 동시에 붙은 두 세션이 같은 id 를 쓴다. 자식은 하나뿐이라
   * (설계 §5) 파이프가 1:N 이 되고, 봉투의 id 를 그대로 흘려보내면 나중 세션이 앞 세션의
   * 대기 항목을 덮어써서 응답이 엉뚱한 세션으로 간다.
   *
   * 중계기가 자기 id 를 새로 매기고 돌아올 때 되돌리는 것이 그 해법이다.
   */
  it("§8-11 두 세션이 같은 id 로 번갈아 불러도 응답이 섞이지 않는다", async () => {
    const { handle } = await startFixtureRelay();
    const first = await openSession(handle.url);
    const second = await openSession(handle.url);

    const [a, b] = await Promise.all([
      first.call(1, "tools/call", { name: "echo", arguments: { who: "first" } }),
      second.call(1, "tools/call", { name: "echo", arguments: { who: "second" } }),
    ]);

    expect(a).toMatchObject({ id: 1, result: { structuredContent: { echo: { who: "first" } } } });
    expect(b).toMatchObject({ id: 1, result: { structuredContent: { echo: { who: "second" } } } });
  });
});
```

- [ ] **Step 2: 실패하는 것을 본다**

실행: `pnpm exec vitest run --project e2e packages/mock/tests/relay-e2e.test.ts -t "§8-11"`
예상: FAIL. 두 세션이 같은 대기표 칸을 쓰므로 한쪽이 응답을 못 받아 타임아웃이거나, 양쪽이 같은 값을 받는다.

- [ ] **Step 3: id 재작성을 넣는다**

`startRelay` 안의 대기표 선언을 바꾼다.

```ts
  const pending = new Map<number, Pending>();
  // 중계기가 매기는 id. 자식 파이프는 하나인데 세션은 여럿이라, 클라이언트가 준 id 를
  // 그대로 쓰면 서로 덮어쓴다. 봉투의 id 만 바꾼다 — params·result 는 손대지 않으므로
  // "값을 만들지도 바꾸지도 않는다" 는 그대로다. 1 부터 세므로 결정론적이다.
  let nextId = 1;
```

`transport.onmessage` 의 요청 갈래를 바꾼다.

```ts
      const relayId = nextId++;
      pending.set(relayId, {
        transport,
        clientId: message.id,
        method: message.method,
        tool,
        startedAt: Date.now(),
      });
      void child.send({ ...message, id: relayId });
```

`child.onmessage` 의 조회를 바꾼다.

```ts
    // `id` 는 Task 2 가 블록 앞에서 뽑아 둔 지역 상수다. `message.id` 를 다시 쓰지 마라 —
    // `isRequest` 의 부정 분기에서 TS 가 유니온을 되돌려 `undefined` 가 다시 섞인다(TS2345).
    //
    // 문(statement)으로 좁힌다. 삼항 안에서 좁히면 그 좁히기가 다음 문장까지 이어지지 않아
    // 아래 세 줄이 전부 `as number` 를 달아야 한다(실측: 빼면 TS2345·TS2322).
    if (typeof id !== "number") return;
    const entry = pending.get(id);
    if (entry === undefined) return;
    pending.delete(id);
    void entry.transport.send({ ...message, id: entry.clientId });
```

- [ ] **Step 4: 통과하는 것을 본다**

실행: `pnpm exec vitest run --project e2e packages/mock/tests/relay-e2e.test.ts`
예상: `Tests  7 passed (7)`.

- [ ] **Step 5: 수정을 빼고 이 테스트가 실패하는지 본다**

`void child.send({ ...message, id: relayId })` 를 잠시 `void child.send(message)` 로 되돌리고, `pending.set(relayId, ...)` 를 `pending.set(message.id as number, ...)` 로 되돌린다.

실행: `pnpm exec vitest run --project e2e packages/mock/tests/relay-e2e.test.ts -t "§8-11"`
예상: **FAIL.** 확인한 뒤 Step 3 의 형태로 되돌린다. **되돌리기를 잊으면 구현이 날아간 채 나머지 테스트만 초록으로 보인다** — `git diff` 로 눈으로 확인한다.

- [ ] **Step 6: 사람에게 커밋을 요청한다**

변경 파일: `packages/mock/src/relay-server.ts`, `packages/mock/tests/relay-e2e.test.ts`

권장 메시지:
```
feat(mock): 중계기가 JSON-RPC id 를 재작성해 세션을 격리한다
```

---

## Task 5: 수명 — 닫기와 좀비 (§8-8·9)

**모델:** 표준 · 추론 보통

**Files:**
- Modify: `packages/mock/src/relay-server.ts`
- Modify: `packages/mock/tests/relay-e2e.test.ts`

**Interfaces:**
- Consumes: Task 2 의 `RelayHandle.close`
- Produces: `RelayHandle.childPid: number | null` — Task 8 의 E2E 가 쓰지 않고 테스트만 쓴다. `close()` 가 자식 종료까지 기다린다는 계약은 4 단계(대시보드가 ① 화면을 떠날 때)가 기댄다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
describe("수명", () => {
  it("§8-8 뒤 서버가 먼저 죽어도 close() 가 멈추지 않는다", async () => {
    const { handle } = await startFixtureRelay(["--exit-after-initialize"]);
    const session = await openSession(handle.url);
    const pid = handle.childPid;
    expect(pid).not.toBeNull();
    await session.close();
    // 기다리는 조건은 `childPid` 가 null 이 되는 것이다. getter 는 살아 있으면 pid ·
    // 끝났으면 null 두 상태뿐이라 "null 이 아니면서 죽어 있다" 는 상태가 존재하지 않는다.
    // setTimeout 이 아니라 폴링인 이유는 고정 대기가 느린 CI 에서 가끔 실패하기 때문이다.
    await waitFor(() => handle.childPid === null);
    // 계약이 아니라 실제 프로세스가 죽었는지도 따로 본다.
    expect(isAlive(pid as number)).toBe(false);

    await expect(handle.close()).resolves.toBeUndefined();
  });

  it("§8-9 close() 뒤 자식 프로세스가 남지 않는다", async () => {
    const { handle } = await startFixtureRelay();
    const session = await openSession(handle.url);
    await session.call(1, "tools/list");
    const pid = handle.childPid;
    expect(pid).not.toBeNull();
    expect(isAlive(pid as number)).toBe(true);

    await handle.close();

    await waitFor(() => !isAlive(pid as number));
    expect(isAlive(pid as number)).toBe(false);
  });
});
```

파일 위쪽 헬퍼에 다음을 더한다.

```ts
/** 프로세스 수를 세지 않고 **이 pid 하나**만 본다. 프로세스 수는 병렬 실행에서 남의 서버를 센다. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("조건이 제한 시간 안에 참이 되지 않았습니다.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
```

- [ ] **Step 2: 실패하는 것을 본다**

실행: `pnpm exec vitest run --project e2e packages/mock/tests/relay-e2e.test.ts -t "수명"`
예상: FAIL — `handle.childPid` 가 타입에 없다(타입 오류) 또는 `undefined`.

- [ ] **Step 3: 구현을 더한다**

`RelayHandle` 에 한 줄을 더한다.

```ts
export interface RelayHandle {
  readonly port: number;
  readonly url: string;
  /** 자식 프로세스의 pid. 자식이 끝나면 null 이 된다. */
  readonly childPid: number | null;
  /** HTTP 를 닫고 자식이 실제로 끝날 때까지 기다린다. */
  close(): Promise<void>;
}
```

`await child.start();` 다음에 pid 를 붙잡고, 자식이 먼저 죽는 경우를 다룬다.

```ts
  // SDK 트랜스포트는 자식이 끝나면 내부 참조를 지워 pid 를 null 로 만든다. 종료 여부를
  // 확인하려면 우리가 처음 pid 를 들고 있어야 한다.
  const childPid = child.pid;
  let childAlive = true;
  /** 닫기는 한 번만 실제로 수행한다. 아래 `close` 주석 참고. */
  let closing: Promise<void> | undefined;
  child.onclose = () => {
    childAlive = false;
    // 대기 중인 세션에 **오류 문장을 지어내지 않는다** — HTTP 연결만 끊는다. 오류는
    // 진짜 서버가 준 것만 쓴다는 규칙(설계 §4)을 중계기가 스스로 어기지 않기 위해서다.
    for (const entry of pending.values()) void entry.transport.close();
    pending.clear();
  };
```

`return` 문을 바꾼다.

```ts
  return {
    port: address.port,
    url: `http://${HOST}:${address.port}/mcp`,
    get childPid() {
      return childAlive ? childPid : null;
    },
    close: () => {
      // **두 번 불러도 안전해야 한다.** 두 번째 `http.close()` 는 ERR_SERVER_NOT_RUNNING
      // ("Server is not running.") 을 던지는데, 닫기를 두 번 부르는 것은 정상적인 일이다 —
      // 테스트의 afterEach 가 정리로 한 번 더 부르고, Task 7 의 bin 은 신호 처리와 정상 종료
      // 양쪽에서 부른다. 같은 약속을 돌려주어 두 번째 호출이 첫 번째의 결과를 기다리게 한다.
      closing ??= (async () => {
        await new Promise<void>((resolve, reject) => {
          http.closeAllConnections();
          http.close((error) => (error ? reject(error) : resolve()));
        });
        // 자식이 이미 죽었으면 SDK 가 즉시 반환한다. 살아 있으면 stdin 을 닫고 기다렸다가
        // SIGTERM · SIGKILL 로 올라간다 (SDK StdioClientTransport.close).
        await child.close();
      })();
      return closing;
    },
  };
```

- [ ] **Step 4: 통과하는 것을 본다**

실행: `pnpm exec vitest run --project e2e packages/mock/tests/relay-e2e.test.ts`
예상: `Tests  9 passed (9)`.

- [ ] **Step 5: 사람에게 커밋을 요청한다**

변경 파일: `packages/mock/src/relay-server.ts`, `packages/mock/tests/relay-e2e.test.ts`

권장 메시지:
```
feat(mock): 중계기가 자식 종료까지 기다려 닫히도록 한다
```

---

## Task 6: 기록 배선 (§8-6·7)

**모델:** 표준 · 추론 보통 (문안은 Task 1 에서 확정됐다 — 여기서는 배선만)

**Files:**
- Modify: `packages/mock/src/relay-server.ts`
- Modify: `packages/mock/tests/relay-e2e.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `humanRequest` · `humanResponse` · `jsonRequest` · `jsonResponse`, Task 4 의 중계기 id
- Produces: `RelayOptions.log` 로 흘러나가는 줄. Task 7 의 bin 이 stderr 로, 4 단계 대시보드가 `--json` 으로 읽는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
describe("기록", () => {
  it("§8-6 요청·응답이 한 쌍으로 순서대로 나온다", async () => {
    const { handle, lines } = await startFixtureRelay();
    const session = await openSession(handle.url);
    await session.call(1, "tools/list");
    await session.call(2, "tools/call", { name: "echo", arguments: { text: "부산" } });

    // 초 단위는 시간에 따라 달라지는 유일한 값이라 마스킹하고 비교한다.
    const masked = lines.map((line) => line.replace(/\d+\.\d초/g, "N초"));
    expect(masked).toEqual([
      "→ initialize",
      "← initialize 성공 · 114바이트 · N초",
      "→ tools/list",
      "← tools/list  툴 3개",
      '→ tools/call  echo {"text":"부산"}',
      "← tools/call  echo 성공 · 107바이트 · N초",
    ]);
  });

  it("§8-7 --json 줄이 파싱되고 필드가 맞다", async () => {
    const lines: string[] = [];
    const handle = await startRelay({
      port: 0,
      command: process.execPath,
      args: [CHILD],
      log: (line) => lines.push(line),
      json: true,
    });
    open.push(handle);
    const session = await openSession(handle.url);
    await session.call(7, "tools/call", { name: "echo", arguments: { text: "부산" } });

    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const request = parsed.find((entry) => entry.dir === "req" && entry.tool === "echo");
    const response = parsed.find((entry) => entry.dir === "res" && entry.tool === "echo");
    expect(request).toEqual({
      dir: "req",
      id: expect.any(Number),
      method: "tools/call",
      tool: "echo",
      args: { text: "부산" },
    });
    expect(response).toMatchObject({ dir: "res", id: request?.id, tool: "echo", ok: true });
    expect(typeof response?.ms).toBe("number");
  });

  it("알림은 짝이 없으므로 기록하지 않는다", () => {
    // openSession 이 보내는 notifications/initialized 가 §8-6 의 목록에 없다는 것으로
    // 이미 확인된다. 이 자리는 그 사실을 문서로 남기는 곳이다.
    expect(true).toBe(true);
  });
});
```

**주의:** 위 숫자 114·107 은 픽스처 응답을 직렬화한 **실측** 바이트 수다. 픽스처가 고정값이라 변하지 않는다. 픽스처를 고치면 이 값도 실측으로 다시 맞춘다 — 짐작해서 적지 않는다. 참고로 `echo` 응답은 글자수 99 · 바이트 107 이다. `부산` 이 두 번 들어가 4 자가 12 바이트가 된다 — 표 C 가 바이트로 통일한 이유가 이것이다.

- [ ] **Step 2: 실패하는 것을 본다**

실행: `pnpm exec vitest run --project e2e packages/mock/tests/relay-e2e.test.ts -t "기록"`
예상: FAIL — `lines` 가 빈 배열이다.

- [ ] **Step 3: 배선한다**

`relay-server.ts` 위쪽에 import 를 더한다.

```ts
import {
  humanRequest,
  humanResponse,
  jsonRequest,
  jsonResponse,
  type RelayRequestEvent,
  type RelayResponseEvent,
} from "./relay-log.js";
```

`startRelay` 안, `const pending = ...` 옆에 두 줄을 둔다.

```ts
  const { port, command, args, log, json } = options;
  const writeRequest = (event: RelayRequestEvent): void =>
    log(json ? jsonRequest(event) : humanRequest(event));
  const writeResponse = (event: RelayResponseEvent): void =>
    log(json ? jsonResponse(event) : humanResponse(event));
```

Task 2 Step 4 에서 넣어 둔 `void log;` 와 `void isRequest;` 줄을 지운다.

`transport.onmessage` 의 요청 갈래에서 `child.send` **앞에** 한 줄을 더한다.

```ts
      writeRequest({
        id: relayId,
        method: message.method,
        ...(tool === undefined ? {} : { tool }),
        ...(params?.arguments === undefined ? {} : { args: params.arguments }),
      });
```

`child.onmessage` 에서 `entry.transport.send` **앞에** 응답 줄을 낸다.

```ts
    writeResponse(describeResponse(message, entry));
```

파일 아래쪽에 순수 보조 함수를 둔다.

```ts
/**
 * 자식이 낸 봉투 하나를 기록 이벤트로 옮긴다. **여기서 값을 바꾸지 않는다** — 오류 코드와
 * 메시지는 진짜 서버가 준 것을 그대로 싣는다.
 */
function describeResponse(
  message: JSONRPCMessage,
  entry: { method: string; tool?: string; startedAt: number },
): RelayResponseEvent {
  const head = {
    id: 0, // 아래에서 덮어쓴다 — 호출부가 relayId 를 안다.
    method: entry.method,
    ...(entry.tool === undefined ? {} : { tool: entry.tool }),
    ms: Date.now() - entry.startedAt,
  };
  if ("error" in message) {
    const error = message.error as { code: number; message: string };
    return { ...head, kind: "protocolError", code: error.code, message: error.message };
  }
  const result = (message as { result: Record<string, unknown> }).result;
  const bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  if (Array.isArray(result.tools)) {
    return { ...head, kind: "ok", bytes, toolCount: result.tools.length };
  }
  if (result.isError === true) return { ...head, kind: "toolError", bytes };
  return { ...head, kind: "ok", bytes };
}
```

호출부에서 id 를 채운다 — `child.onmessage` 의 그 줄을 다음으로 한다.

```ts
    writeResponse({ ...describeResponse(message, entry), id });
```

- [ ] **Step 4: 통과하는 것을 본다**

실행: `pnpm exec vitest run --project e2e packages/mock/tests/relay-e2e.test.ts`
예상: `Tests  12 passed (12)`. 바이트 수가 어긋나면 **실측값으로 테스트를 고친다** (구현을 고치지 않는다 — 픽스처 응답의 실제 크기가 진실이다).

- [ ] **Step 5: 같은 입력 두 번의 출력을 바이트로 비교한다**

결정론성 확인이다. 같은 테스트를 두 번 돌려 마스킹한 줄이 같은지 본다.

실행:
```bash
pnpm exec vitest run --project e2e packages/mock/tests/relay-e2e.test.ts > /tmp/relay-1.txt 2>&1; echo "exit=$?"
pnpm exec vitest run --project e2e packages/mock/tests/relay-e2e.test.ts > /tmp/relay-2.txt 2>&1; echo "exit=$?"
grep -c "passed" /tmp/relay-1.txt /tmp/relay-2.txt
```
예상: 두 `exit=0`. **종료 코드는 파이프 뒤에서 읽지 않는다** — 위처럼 리다이렉트 뒤 `$?` 로 본다 (`CLAUDE.local.md` §2).

- [ ] **Step 6: 사람에게 커밋을 요청한다**

변경 파일: `packages/mock/src/relay-server.ts`, `packages/mock/tests/relay-e2e.test.ts`

권장 메시지:
```
feat(mock): 중계기가 오간 호출을 한 줄씩 기록한다
```

---

## Task 7: bin 진입점 (`relay.ts`)

**모델:** 표준 · 추론 보통 (사용법 문안은 Task 1 의 규칙을 따른다)

**Files:**
- Create: `packages/mock/src/relay.ts`
- Modify: `packages/mock/package.json` (`bin` 에 한 줄 **추가**)
- Modify: `packages/mock/tsdown.config.mjs` (`entry` 에 한 줄 **추가**)

**Interfaces:**
- Consumes: Task 2~6 의 `startRelay(options): Promise<RelayHandle>`
- Produces: `mcpeak-relay --port <n> [--json] -- <command> [args...]` · `export async function main(argv: readonly string[]): Promise<void>` (Task 8 은 `main` 을 import 하지 않고 프로세스를 띄운다)

- [ ] **Step 1: bin 을 쓴다**

`packages/mock/src/relay.ts`:

```ts
#!/usr/bin/env node
/**
 * `mcpeak-relay --port 7400 -- node ./server.mjs` — stdio MCP 서버를 Streamable HTTP 로 중계한다.
 *
 * 앞이 HTTP, 뒤가 stdio 다. **뒤 서버는 stdio 만 받는다** — 진짜 서버가 이미 HTTP 면 AI 를
 * 거기 직접 붙이면 되므로 중계기가 필요 없다.
 *
 * **stdout 에 아무것도 쓰지 않는다.** 기록은 전부 stderr 다. 4 단계 대시보드가 이 채널을
 * 읽는다.
 */
import { startRelay } from "./relay-server.js";

const usage = [
  "사용법: mcpeak-relay [--port <번호>] [--json] -- <명령> [인자...]",
  "  --port 0 (기본) 이면 빈 포트를 자동으로 받습니다.",
  "  --json 을 주면 기록을 한 줄 JSON 으로 냅니다.",
  "  -- 뒤는 중계할 stdio MCP 서버의 실행 명령입니다.",
].join("\n");

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

interface Parsed {
  port: number;
  json: boolean;
  command: string;
  args: string[];
}

export function parseArgs(argv: readonly string[]): Parsed {
  let port = 0;
  let json = false;
  let index = 0;
  for (; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      index += 1;
      break;
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--port") {
      const value = argv[index + 1];
      const parsed = Number(value);
      if (value === undefined || !Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        fail(`→ --port 에는 0~65535 의 정수가 필요합니다. 받은 값: ${value ?? "(없음)"}\n${usage}`);
      }
      port = parsed;
      index += 1;
      continue;
    }
    fail(`→ 모르는 인자입니다: ${token}\n${usage}`);
  }
  const rest = argv.slice(index);
  const command = rest[0];
  if (command === undefined) {
    fail(`→ 중계할 서버의 실행 명령이 필요합니다. -- 뒤에 적으세요.\n${usage}`);
  }
  return { port, json, command, args: rest.slice(1) };
}

export async function main(argv: readonly string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stderr.write(`${usage}\n`);
    return;
  }
  const { port, json, command, args } = parseArgs(argv);

  const handle = await startRelay({
    port,
    command,
    args,
    log: (line) => process.stderr.write(`${line}\n`),
    json,
  });

  // --port 0 이면 받은 포트를 알려 줄 채널이 이 줄뿐이다. 4 단계 대시보드도 이 줄로 URL 을 안다.
  process.stderr.write(
    json
      ? `${JSON.stringify({ dir: "up", port: handle.port, url: handle.url })}\n`
      : `→ 중계기 대기 중 ${handle.url}\n`,
  );

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    handle
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        fail(`→ 중계기를 닫는 중 오류가 났습니다.\n→ ${error instanceof Error ? error.message : String(error)}`);
      });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// top-level await 를 쓰지 않는다 — 빌드가 cjs 도 함께 내는데 그쪽에서 지원되지 않는다.
// src/stdio.ts · packages/cli/src/cli.ts 도 같은 이유로 이 형태다.
main(process.argv.slice(2)).catch((error: unknown) => {
  fail(
    `→ 중계기를 띄우지 못했습니다.\n→ ${error instanceof Error ? error.message : String(error)}`,
  );
});
```

- [ ] **Step 2: bin 과 빌드 대상에 등록한다**

`packages/mock/package.json` 의 `bin` 을 **추가만** 한다. `mcpeak-mock` 은 3 단계까지 그대로 둔다 — 1 단계의 계약은 "아무것도 안 깨진다" 이고, 이 이름을 문자열로 기대하는 CLI 테스트가 남의 영역에 있다.

```json
  "bin": {
    "mcpeak-mock": "./dist/stdio.mjs",
    "mcpeak-relay": "./dist/relay.mjs"
  },
```

`packages/mock/tsdown.config.mjs` 의 `entry` 에 한 줄을 더한다.

```js
  entry: ["src/index.ts", "src/stdio.ts", "src/relay.ts"],
```

- [ ] **Step 3: 손으로 전체 흐름을 한 번 돌린다**

설계 §7-1 이 요구하는 "터미널에서 손으로 전체 흐름을 돌려볼 수 있는 상태" 확인이다.

```bash
node --import ./packages/mock/tests/fixtures/register-ts-resolve.mjs \
  packages/mock/src/relay.ts --port 0 -- node examples/weather-server/server.mjs
```
예상 stderr: `→ 중계기 대기 중 http://127.0.0.1:<포트>/mcp`

다른 터미널에서:
```bash
curl -sS -X POST http://127.0.0.1:<포트>/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```
예상: `examples/weather-server` 의 `serverInfo` 가 담긴 응답. 중계기 터미널에는 `→ initialize` · `← initialize 성공 ...` 두 줄.

Ctrl-C 로 닫고 `ps` 에 `server.mjs` 가 남지 않았는지 본다.

- [ ] **Step 4: 빌드가 실제로 새 진입점을 내는지 확인한다**

```bash
pnpm --filter @mcpeak/mock build
ls packages/mock/dist/relay.mjs
grep -c "중계기 대기 중" packages/mock/dist/relay.mjs
```
예상: 파일이 있고 `grep` **stdout 이 `1`**. 0 건이면 grep 은 exit 1 이다 — 종료 코드를 건수로 읽지 않는다.
`dist` 에 없으면 turbo 캐시가 낡은 산출물을 복원한 것이다. 그때는 `packages/mock` 에서 `npx tsdown --config-loader native` 로 직접 빌드한다 (`CLAUDE.local.md` §2).

- [ ] **Step 5: 타입체크·린트**

```bash
pnpm --filter @mcpeak/mock typecheck
pnpm exec biome check packages/mock
```
예상: 오류 0.

- [ ] **Step 6: 사람에게 커밋을 요청한다**

변경 파일: `packages/mock/src/relay.ts`, `packages/mock/package.json`, `packages/mock/tsdown.config.mjs`

권장 메시지:
```
feat(mock): mcpeak-relay 진입점을 추가한다
```

---

## Task 8: bin E2E (§8-12·13)

**모델:** 표준 · 추론 보통

**Files:**
- Create: `packages/mock/tests/relay-bin-e2e.test.ts`

**Interfaces:**
- Consumes: Task 7 의 bin (`src/relay.ts`), Task 2 의 픽스처
- Produces: 없음

- [ ] **Step 1: 테스트를 쓴다**

`dist` 가 아니라 `src/relay.ts` 를 띄운다. CI 의 verify 잡은 빌드 없이 `pnpm test` 를 돌리므로 `dist` 를 요구하면 그 잡에서 깨진다. `stdio-e2e.test.ts` 가 같은 이유로 같은 형태다.

```ts
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

const RELAY = fileURLToPath(new URL("../src/relay.ts", import.meta.url));
const CHILD = fileURLToPath(new URL("./fixtures/relay-child.mjs", import.meta.url));
const WEATHER = fileURLToPath(new URL("../../../examples/weather-server/server.mjs", import.meta.url));
/**
 * `src/` 는 형제 모듈을 ".js" 로 부르는데 Node 의 ESM 리졸버는 그것을 ".ts" 로 매핑하지
 * 않는다. 이 훅이 그 한 칸을 메운다 (ADR-0055). `--import` 에는 원시 경로가 아니라 URL 을
 * 넘긴다 — Windows 절대경로를 그대로 주면 드라이브 문자를 스킴으로 읽어 자식이 시작조차
 * 못 한다 (#246).
 */
const tsResolve = new URL("./fixtures/register-ts-resolve.mjs", import.meta.url).href;

const spawned: ReturnType<typeof spawn>[] = [];
afterEach(() => {
  for (const child of spawned.splice(0)) child.kill("SIGKILL");
});

/** 중계기를 띄우고 기동 줄에서 URL 을 읽어 돌려준다. */
function startRelayProcess(
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ child: ReturnType<typeof spawn>; url: string; stderr: () => string }> {
  const child = spawn(process.execPath, ["--import", tsResolve, RELAY, ...args], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  spawned.push(child);
  let stderr = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`중계기가 기동 줄을 내지 않았습니다:\n${stderr}`)), 10_000);
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      const match = /중계기 대기 중 (\S+)/.exec(stderr);
      if (match?.[1] !== undefined) {
        clearTimeout(timer);
        resolve({ child, url: match[1], stderr: () => stderr });
      }
    });
    child.on("error", reject);
  });
}

async function roundTrip(url: string, message: JSONRPCMessage): Promise<JSONRPCMessage> {
  const transport = new StreamableHTTPClientTransport(new URL(url));
  const received = new Promise<JSONRPCMessage>((resolve) => {
    transport.onmessage = resolve;
  });
  await transport.start();
  await transport.send(message);
  const response = await received;
  await transport.close();
  return response;
}

describe("mcpeak-relay — 배포되는 진입점", () => {
  it("§8-12 결정론적 예제 서버를 중계하고 HTTP 로 왕복한다", async () => {
    const { url } = await startRelayProcess(["--port", "0", "--", process.execPath, WEATHER]);

    const initialized = await roundTrip(url, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "relay-bin-test", version: "0.0.0" },
      },
    } as JSONRPCMessage);
    expect(initialized).toMatchObject({
      id: 1,
      result: { serverInfo: { name: "example-weather-server" } },
    });

    const listed = await roundTrip(url, { jsonrpc: "2.0", id: 2, method: "tools/list" } as JSONRPCMessage);
    expect(listed).toMatchObject({
      id: 2,
      result: { tools: [{ name: "get_weather" }, { name: "add" }] },
    });
  }, 30_000);

  it("§8-13 SIGINT 에 자식까지 종료된다", async () => {
    const pidfile = join(mkdtempSync(join(tmpdir(), "mcpeak-relay-")), "child.pid");
    const { child } = await startRelayProcess(["--port", "0", "--", process.execPath, CHILD], {
      MCPEAK_RELAY_TEST_PIDFILE: pidfile,
    });
    const childPid = Number(readFileSync(pidfile, "utf8"));
    expect(childPid).toBeGreaterThan(0);

    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGINT");
    await exited;

    // 프로세스 수가 아니라 **이 pid 하나**를 본다. 프로세스 수는 병렬 실행에서 남의 서버를 센다.
    await new Promise((resolve) => setTimeout(resolve, 200));
    let alive = true;
    try {
      process.kill(childPid, 0);
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);
  }, 30_000);
});
```

- [ ] **Step 2: 돌린다**

실행: `pnpm exec vitest run --project e2e packages/mock/tests/relay-bin-e2e.test.ts`
예상: `Test Files  1 passed (1)` · `Tests  2 passed (2)`.

실패하면 먼저 의심할 것: `pnpm install` 누락(파일 없음 오류·spawn 경로), `--import` URL 형태, 예제 서버의 `node_modules` 부재.

- [ ] **Step 3: 목 패키지 전체가 여전히 초록인지 본다**

1 단계의 계약은 "아무것도 안 깨진다" 이다.

```bash
pnpm exec vitest run packages/mock > /tmp/mock-all.txt 2>&1; echo "exit=$?"
grep -E "Test Files|Tests " /tmp/mock-all.txt
```
예상: `exit=0`, 기존 4 개 파일 + 새 3 개 파일이 모두 통과. **파일 수가 7 인지 눈으로 확인한다** — 새 파일이 수집되지 않은 채 초록으로 보이는 것이 이 저장소의 대표적 거짓 신호다.

- [ ] **Step 4: 남은 스텁이 없는지 센다**

```bash
grep -rn "not implemented\|TODO" packages/mock/src/relay*.ts; echo "exit=$?"
```
예상: 출력 없음, `exit=1` (grep 은 0 건일 때 1 이다 — 이것이 정상이다).

- [ ] **Step 5: 사람에게 커밋을 요청한다**

변경 파일: `packages/mock/tests/relay-bin-e2e.test.ts`

권장 메시지:
```
test(mock): mcpeak-relay 진입점의 왕복과 신호 종료를 E2E 로 고정한다
```

---

## Task 9: ADR

**모델:** 표준 · 추론 보통 (이미 내린 판단을 문서로 옮기는 작업은 승급하지 않는다 — `CLAUDE.local.md` §1)

**Files:**
- Create: `docs/adr/0101-목과-external-세션-사이에-중계-층을-넣는다.md`
- Modify: `docs/adr/README.md` (색인 표에 한 줄)

**Interfaces:**
- Consumes: Task 1~8 에서 실제로 내린 결정
- Produces: 2 단계 계획이 참조할 기록

- [ ] **Step 1: 번호가 비어 있는지 확인한다**

```bash
ls docs/adr | grep -c "^0101"; echo "exit=$?"
```
예상: stdout `0`. 누가 먼저 0101 을 썼으면(`git fetch` 로 격차를 먼저 본다) 다음 빈 번호를 쓴다.

- [ ] **Step 2: ADR 을 쓴다**

`docs/adr/0101-목과-external-세션-사이에-중계-층을-넣는다.md` — 항목은 배경 / 선택지 / 결정 / 이유 / 결과 다섯이고 한 페이지면 충분하다 (CONTRIBUTING §8).

```markdown
# ADR-0101: 목과 External 세션 사이에 중계 층을 넣는다

- 상태: 제안
- 날짜: 2026-09-18
- 담당: mock
- 작성자: @storyrago
- 참조: `docs/superpowers/specs/2026-09-16-mock-to-relay-design.md`,
  [ADR-0005](./0005-mock-data-strategy.md), [ADR-0007](./0007-mock-stdio-transport.md),
  [ADR-0048](./0048-...md), [ADR-0057](./0057-external-어댑터는-global-fetch-까지만-가로챈다.md)

## 배경

(설계 §1·§3 을 줄여 적는다: 판정 화면이 서버의 실물 응답을 보여주지 않는다. 스위트 단언
134 건이 전부 모양만 보고 값을 보는 단언은 0 건이라 스위트 명세만으로는 목을 세울 수 없다.
카세트는 ADR-0059 로 사라졌다. 그리고 stdio 서버는 AI 클라이언트가 자기 자식으로 띄우므로
대시보드가 호출을 관찰할 방법이 없다.)

## 선택지

1. 목을 그대로 두고 빈 스키마로 때운다
2. 응답을 녹화해 재생한다
3. 진짜 서버를 뒤에 두고 중계한다 (SDK `Server` + `Client` 브리지)
4. 진짜 서버를 뒤에 두고 중계한다 (트랜스포트 직결)

## 결정

4 를 고른다. 목 패키지를 중계기로 **전환**한다(병행이 아니다). 패키지 이름은 유지하고
`bin` 만 `mcpeak-relay` 를 더한다. 테스트 스위트는 중계기를 지나지 않는다.

## 이유

(1 은 입력 검사가 조용히 꺼진 채 초록이 뜨는 알려진 결함 H-5·H-4 를 재현한다. 2 는 경로가
없다. 3 은 SDK `Client` 가 `structuredContent` 를 `outputSchema` 로 검증해 진짜 서버의 잘못된
응답을 중계기가 대신 받아 던진다 — 사용자가 서버의 답 대신 중계기가 만든 오류를 본다.
4 는 해석하는 지점이 없어 "값을 만들지도 바꾸지도 않는다" 가 규율이 아니라 구조로 보장된다.)

## 결과

- 무효가 되는 ADR 네 건: 0005 · 0007 · 0048 · 0057.
- 봉투의 `id` 는 중계기가 재작성한다. 자식이 하나인데 세션이 여럿이라 클라이언트 id 를 그대로
  쓰면 응답이 섞인다. `params`·`result` 는 손대지 않는다.
- 중계기를 지나는 응답은 결정론적이지 않다. 그래서 테스트 경로에서 뺐다 — 이 구분이 흐려지면
  결정론성이 무너진다.
- 2 단계에서 목 소비자(`packages/cli/tests/http-remote-e2e.test.ts` · `examples/mock-server` ·
  문서)를 옮긴다. 공동 영역이라 이슈를 열고 오너에게 알린다.
```

참조 링크의 파일명은 `ls docs/adr` 로 실제 이름을 확인해 채운다. 추측해서 적지 않는다.

- [ ] **Step 3: 색인에 한 줄을 더한다**

`docs/adr/README.md` 표 끝에:

```markdown
| [0101](./0101-목과-external-세션-사이에-중계-층을-넣는다.md) | 목과 External 세션 사이에 중계 층을 넣는다 | mock | 제안 |
```

- [ ] **Step 4: 사람에게 커밋을 요청한다**

변경 파일: `docs/adr/0101-*.md`, `docs/adr/README.md`

권장 메시지 (패키지 소유가 없는 작업이라 scope 는 `adr`):
```
docs(adr): 목과 External 세션 사이에 중계 층을 넣는 결정을 기록한다
```

---

## 1 단계 완료 점검

모두 끝난 뒤 한 번에 돌린다. **각 명령의 종료 코드를 파이프 없이 확인한다.**

```bash
pnpm exec vitest run > /tmp/all-tests.txt 2>&1; echo "tests exit=$?"
grep -E "Test Files|Tests " /tmp/all-tests.txt
pnpm typecheck > /tmp/typecheck.txt 2>&1; echo "typecheck exit=$?"
pnpm lint > /tmp/lint.txt 2>&1; echo "lint exit=$?"
pnpm build > /tmp/build.txt 2>&1; echo "build exit=$?"
grep -c "중계기 대기 중" packages/mock/dist/relay.mjs
```

확인할 것:

- [ ] 네 종료 코드가 모두 0
- [ ] 목 패키지의 테스트 파일이 **7 개** 수집됐다 (기존 4 + 신규 3)
- [ ] `dist/relay.mjs` 의 grep stdout 이 `1` (0 이면 turbo 캐시가 낡은 산출물을 복원한 것 —
      `packages/mock` 에서 `npx tsdown --config-loader native`)
- [ ] 기존 목 소스 4 개가 안 바뀌었다: `git diff --stat main -- packages/mock/src/index.ts packages/mock/src/stdio.ts packages/mock/src/input-validation.ts packages/mock/src/key-violation.ts` 가 **빈 출력**
- [ ] `package.json` 의 `mcpeak-mock` 이 그대로 있다

## 이 계획이 하지 않는 것

2·3·4 단계다. 다음 계획에서 다룬다.

- 목 소비자 이전 (`packages/cli/tests/http-remote-e2e.test.ts` 의 `createMockServer` 대체) — 남의 영역이라 이슈를 먼저 연다
- 목 삭제 · `1.0.0` changeset · `bin` 에서 `mcpeak-mock` 제거 · README · `description`
- 대시보드 체크박스와 ① 화면 · `runProviderProcess` 로 AI 를 부르는 경로 · 두 번째 ADR

작업 시작 전에 `git fetch` 로 `main` 과의 격차를 본다. 시작 시점의 작업 트리에는 이 계획과
무관한 변경 하나가 있다 — `packages/mock/tests/stdio-e2e.test.ts` (주석 5 줄, #418). 섞이지
않게 따로 커밋하거나 stash 한다. (`git stash pop` 이 충돌하면 항목이 남으므로 해소 뒤
`git stash drop` 을 직접 한다.)
