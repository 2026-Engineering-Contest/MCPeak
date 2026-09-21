# T1 · `@mcpeak/mock` — 응답 본문 · 케이스 꼬리표 · 실행 파일 경로 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 중계기가 `--json` 기록 줄에 서버 응답 **본문 전체**와 **케이스 꼬리표**를 싣고, `mock` 이 중계기 실행 파일의 절대경로를 내보낸다 — 4 단계 대시보드가 실물 응답을 케이스별로 나눠 보여줄 수 있게 하는 최소 계약.

**Architecture:** 세 갈래가 서로 독립이다. ① `relay-log.ts` 의 이벤트 타입에 `body` · `case` 를 더하고 `jsonResponse`/`jsonRequest` 가 그것을 싣는다. ② `relay-server.ts` 가 HTTP 요청마다 `req.url` 에서 꼬리표를 읽어 대기표(`pending`)에 넣고, 응답을 옮길 때 같이 싣는다. ③ `index.ts` 가 `package.json` 의 `bin` 을 읽어 `relayBinPath()` 를 만든다. **사람이 읽는 줄은 한 바이트도 바뀌지 않는다.**

**Tech Stack:** TypeScript (ESM 소스, tsdown 0.22.14 로 esm+cjs dual 빌드) · vitest · `@modelcontextprotocol/sdk` 1.x · Node ≥ 22.18.0

## Global Constraints

- **패키지는 `packages/mock` 하나만 건드린다.** `generate`(T2) · `dashboard`(T3) 는 이 계획서 범위 밖이다.
- **`core/src/types.ts` 의 `McpClient` · `ToolResult` 를 바꾸지 않는다.**
- **의존성을 추가하지 않는다.** 이 계획은 `node:fs` · `node:path` · `node:url` 만 새로 들인다(전부 Node 내장).
- **`@modelcontextprotocol/sdk` 버전을 건드리지 않는다.** `catalog:` 고정 그대로.
- **커밋·푸시는 사람이 한다.** 각 태스크 끝에서 권장 커밋 메시지와 변경 파일만 제시하고 멈춘다. `git commit` 을 실행하지 않는다.
- **커밋 scope 는 `mock`.** Conventional Commits, scope 필수.
- **결정론성:** 새로 넣는 코드에 타임스탬프·랜덤·실행 순서 의존이 없어야 한다. `jsonRequest`/`jsonResponse` 의 **키 순서를 리터럴로 고정**한다(조건부 전개로 순서가 흔들리면 4 단계 스냅샷이 이유 없이 깨진다).
- **실패 메시지가 곧 제품이다.** 새로 던지는 오류는 무엇이 왜 틀렸는지와 **어떻게 고치는지**까지 적는다.
- **`packages/mock/tests/stdio-e2e.test.ts` 는 미커밋 상태이고 사용자 것이다. 커밋 범위에 절대 넣지 마라.**

## 병렬 실행 규약 — 여러 세션이 **같은 워킹 트리**를 쓴다

웨이브 1 은 Task 1 · Task 3(+3b) · Task 4 를 세 세션이 동시에 한다. worktree 가 아니라 한 트리라, 아래를 어기면 §2 의 거짓 신호가 그대로 난다.

1. **자기 파일만 건드린다.** 세 태스크의 파일 집합은 서로 겹치지 않는다 (Task 1: `relay-log.ts`·`relay-server.ts` + 그 테스트 둘 / Task 3·3b: `index.ts`·`package.json`·`tests/relay-bin-path.test.ts`·`tests/dist-relay-bin-e2e.mjs`·`.github/workflows/ci.yml` / Task 4: `docs/adr/0103-*.md`).
2. **`pnpm vitest run packages/mock` 를 돌리지 마라.** 패키지 전체를 돌리면 옆 세션의 반쯤 된 파일을 같이 물어 빨강·초록이 둘 다 거짓이 된다. **자기 테스트 파일을 경로로 지정해서만** 돌린다. 패키지 전체 게이트는 메인 세션이 웨이브 끝에 한 번 돌린다.
3. **git 쓰기 명령을 쓰지 마라** — `git stash` · `add` · `commit` · `checkout` · `restore` 전부. git index 는 트리 하나에 하나뿐인 공유 락이라, 두 세션이 동시에 stash 하면 서로의 작업을 물고 간다. **되돌려서 실패를 보는 단계는 스크래치패드 복사로 한다:**
   ```bash
   cp <파일> <스크래치패드>/<이름>.bak   # 되돌리기 전에
   # …수정을 손으로 빼고 테스트를 돌려 실패를 확인…
   cp <스크래치패드>/<이름>.bak <파일>   # 반드시 되돌린다
   ```
   되돌린 뒤 `git diff --stat <파일>` 로 내 변경이 그대로 남아 있는지 눈으로 본다. **되돌리기를 빠뜨리면 구현이 날아갔는데 로컬은 초록으로 보인다.**
4. **남의 파일에서 난 오류는 고치지 마라.** 타입체크·린트가 내 파일 아닌 곳에서 오류를 내면 그것은 옆 세션의 진행 중 상태다. **보고만 하고 넘어간다.**
5. **커밋·푸시·머지·리베이스를 하지 않는다. 백그라운드 실행과 하위 에이전트 spawn 도 하지 않는다.** 태스크가 끝나면 변경 파일과 권장 커밋 메시지를 보고하고 멈춘다 — SHA 는 사람이 만든다.
6. 실제 서버 프로세스를 띄우는 것은 웨이브 1 에서 **Task 1 하나뿐**이다(`--port 0` 으로 빈 포트를 받는다). Task 3b 는 빌드와 맨 node 호출만이라 포트·PID 가 겹치지 않는다. 이 조건이 깨지면(누가 서버를 띄우면) 그 태스크는 직렬 웨이브로 내린다.

## 이미 닫힌 실측 (설계 §5 의 첫 항목)

계획 단계에서 재라고 한 것을 **실측으로 닫았다.** 결과가 아래 Task 3 의 코드 형태를 정했다.

| 무엇 | 결과 |
|---|---|
| cjs 산출물에서 `import.meta.url` 이 도는가 | **돈다.** rolldown 이 `require("url").pathToFileURL(__filename).href` 로 치환한다 (tsdown 0.22.14, 산출물 육안 확인) |
| `new URL("../package.json", import.meta.url)` 를 번들러가 에셋으로 변형하는가 | **안 한다.** 두 포맷 산출물에 원형 그대로 남는다 |
| `src/` 로 돌 때(vitest)와 `dist/` 로 돌 때 같은 파일을 가리키는가 | **같다.** 둘 다 패키지 루트 바로 아래 같은 깊이라 `../package.json` 이 한 파일을 가리킨다 |
| 런타임 실측 | 가짜 패키지 레이아웃에서 `{dist, src} × {esm, cjs}` 네 조합 모두 `<root>/dist/relay.mjs` 를 돌려줬다 |
| dist 청크가 하위 폴더로 가지 않는가 | 안 간다. 해시 청크(`src-DkQ5nmyx.mjs`)도 `dist/` 바로 아래다 |

**설계 §5 의 두 번째 실측(`--tools ""` 유지 가능한지)은 이 계획서 범위 밖이다** — 그것은 대시보드의 argv 조립(T3)에 걸린 것이고 `mock` 에 해당 코드가 없다. T3 계획서에서 닫는다.

## File Structure

| 파일 | 무엇을 맡는가 | 이 계획에서 |
|---|---|---|
| `packages/mock/src/relay-log.ts` | 기록 줄의 문안. **순수 함수만** — 시간·난수·I/O·전역 없음 | 수정: 이벤트 타입에 `body`·`case` 추가, `readCaseTag` 추가, JSON 문안에 싣기 |
| `packages/mock/src/relay-server.ts` | 트랜스포트 둘을 잇는 중계 본체 | 수정: `req.url` 에서 꼬리표 읽어 대기표에 넣고, `describeResponse` 가 `body` 를 싣는다 |
| `packages/mock/src/index.ts` | 목 서버의 공개 면 | 수정: `relayBinPath()` 추가 |
| `packages/mock/tests/relay-log.test.ts` | 문안 유닛 테스트 | 수정: 테스트 1·2·3·4·5 |
| `packages/mock/tests/relay-e2e.test.ts` | 진짜 자식 프로세스를 띄우는 중계 e2e | 수정: 테스트 1·4 의 **끝-끝 절반** |
| `packages/mock/tests/relay-bin-path.test.ts` | `relayBinPath()` 계약 | **신규**: 테스트 6 |
| `docs/adr/0103-중계기-기록-줄이-응답-본문을-싣는다.md` | ADR-B | **신규** |

`relay-log.ts` 에 `readCaseTag` 를 두는 이유: URL 파싱은 순수 함수라 그 파일의 규칙("순수 함수만 둔다")을 깨지 않고, 설계 §4 가 지정한 자리다.

---

### Task 1: 응답 본문을 `--json` 줄에 싣는다 (테스트 1 · 2 · 3)

**Files:**
- Modify: `packages/mock/src/relay-log.ts:21-30` (`RelayResponseEvent`), `:101-126` (`jsonResponse`)
- Modify: `packages/mock/src/relay-server.ts:252-273` (`describeResponse`)
- Test: `packages/mock/tests/relay-log.test.ts`, `packages/mock/tests/relay-e2e.test.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `RelayResponseEvent` 의 `ok`·`toolError` 변형에 `readonly body: unknown` 이 **필수 필드**로 생긴다. `protocolError` 변형에는 없다. Task 2 가 같은 타입에 `case` 를 더한다.

**왜 `protocolError` 에 `body` 가 없는가:** 서버가 결과를 준 적이 없다. 지어낼 것이 없으므로 필드를 두지 않는다 — 중계기가 값을 만들지 않는다는 규칙(설계 §4)이 타입 수준에서 지켜진다.

- [ ] **Step 1: 실패하는 유닛 테스트를 쓴다**

`packages/mock/tests/relay-log.test.ts` 의 `describe("jsonRequest · jsonResponse", ...)` 블록 **안**에 아래를 추가한다.

**기존 케이스 5 건도 같이 고쳐야 한다.** `body` 를 `ok`·`toolError` 의 **필수** 필드로 만들면 기존 이벤트 리터럴이 TS2345 로 깨진다 — `tsconfig` 의 `include` 가 `["src","tests"]` 라 테스트도 검사 대상이다. 대상은 `humanResponse` 3 건(tools/list 툴 개수 · 성공한 tools/call · isError 결과)과 `jsonResponse` 2 건(성공 응답 줄 · 툴 오류 줄)이다.
- `humanResponse` 3 건: 이벤트 리터럴에만 `body` 를 더한다. **기대 문자열은 한 글자도 바뀌지 않는다** — `humanResponse` 는 `body` 를 읽지 않는다.
- `jsonResponse` 2 건: 입력과 `toEqual` 기대값 **양쪽**에 같은 `body` 를 더한다. 이제 줄에 실리므로 기대값도 같이 가야 맞다.

**런타임만 보면 이 공백이 보이지 않는다.** `body: undefined` 는 `JSON.stringify` 가 키째로 지우므로 기존 케이스가 vitest 에서는 그냥 통과하고, `tsc` 에서만 드러난다. 그래서 Step 10 의 타입체크를 건너뛰면 안 된다.

```ts
  it("성공 응답 줄은 result 전체를 body 로 싣는다 — content 와 structuredContent 가 다 있다", () => {
    const result = {
      content: [{ type: "text", text: "고장" }],
      structuredContent: { temp: "21" },
    };
    const line = jsonResponse({
      id: 7,
      method: "tools/call",
      tool: "bad_structured",
      kind: "ok",
      bytes: 174,
      ms: 3,
      body: result,
    });
    expect(JSON.parse(line)).toEqual({
      dir: "res",
      id: 7,
      tool: "bad_structured",
      ok: true,
      bytes: 174,
      ms: 3,
      body: result,
    });
  });

  it("툴 오류 응답 줄도 body 를 싣는다", () => {
    const result = { content: [{ type: "text", text: "툴이 실패했습니다" }], isError: true };
    const line = jsonResponse({
      id: 8,
      method: "tools/call",
      tool: "boom",
      kind: "toolError",
      bytes: 61,
      ms: 2,
      body: result,
    });
    expect(JSON.parse(line)).toEqual({
      dir: "res",
      id: 8,
      tool: "boom",
      ok: false,
      isError: true,
      bytes: 61,
      ms: 2,
      body: result,
    });
  });

  it("프로토콜 오류 줄에는 body 가 없다 — 서버가 결과를 준 적이 없다", () => {
    const line = jsonResponse({
      id: 9,
      method: "tools/call",
      tool: "없는툴",
      kind: "protocolError",
      code: -32602,
      message: "Unknown tool",
      ms: 1,
    });
    expect(JSON.parse(line)).not.toHaveProperty("body");
  });

  it("body 를 줄이지 않는다 — 큰 응답도 전문이 실린다", () => {
    const result = { content: [{ type: "text", text: "가".repeat(20_000) }] };
    const line = jsonResponse({ id: 10, method: "tools/call", tool: "echo", kind: "ok", bytes: 1, ms: 1, body: result });
    expect((JSON.parse(line) as { body: typeof result }).body).toEqual(result);
    expect(line).not.toContain("…");
  });
```

그리고 `describe("humanResponse", ...)` 블록 **안**에 테스트 2 를 추가한다.

```ts
  it("사람이 읽는 줄은 body 를 싣지 않는다 — 한 줄로 유지된다", () => {
    const line = humanResponse({
      id: 7,
      method: "tools/call",
      tool: "bad_structured",
      kind: "ok",
      bytes: 174,
      ms: 3,
      body: { content: [{ type: "text", text: "고장" }], structuredContent: { temp: "21" } },
    });
    expect(line).toBe("← tools/call  bad_structured 성공 · 174바이트 · 0.0초");
    expect(line).not.toContain("structuredContent");
    expect(line).not.toContain("\n");
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && pnpm vitest run packages/mock/tests/relay-log.test.ts`

Expected: FAIL. 새 케이스들이 타입 오류(`body` 가 `RelayResponseEvent` 에 없다)로 죽거나, `jsonResponse` 결과에 `body` 키가 없어 `toEqual` 이 깨진다.
출력에 `Test Files ... failed` 줄이 있는지 확인한다. 즉시 exit 0 이면 스크립트를 잘못 부른 것이다.

- [ ] **Step 3: 타입에 `body` 를 더한다**

`packages/mock/src/relay-log.ts` 의 `RelayResponseEvent` 를 아래로 바꾼다.

```ts
export type RelayResponseEvent = {
  readonly id: number;
  readonly method: string;
  readonly tool?: string;
  readonly ms: number;
} & (
  | {
      readonly kind: "ok";
      readonly bytes: number;
      readonly toolCount?: number;
      /**
       * JSON-RPC `result` **전체**. `content` 와 `structuredContent` 가 같이 들어 있다.
       *
       * AI 경유로는 `structuredContent` 가 오지 않는다(설계 §3 실측). 사용자가 자기 서버
       * 답의 반쪽만 보게 되므로 중계기가 직접 싣는다. **줄이지 않는다** — 접는 것은 화면이
       * 할 일이고, 관찰 채널의 충실성이 여기서는 먼저다(설계 §2-6).
       */
      readonly body: unknown;
    }
  | { readonly kind: "toolError"; readonly bytes: number; readonly body: unknown }
  // `protocolError` 에는 `body` 가 없다. 서버가 결과를 준 적이 없어 지어낼 것이 없다 —
  // "오류는 진짜 서버가 준 것만 쓴다" 를 타입이 지키게 한다.
  | { readonly kind: "protocolError"; readonly code: number; readonly message: string }
);
```

- [ ] **Step 4: `jsonResponse` 가 `body` 를 싣게 한다**

`packages/mock/src/relay-log.ts` 의 `jsonResponse` 에서 `toolError`·`ok` 두 분기에 `body` 를 **맨 뒤**에 더한다. `protocolError` 분기는 그대로 둔다.

```ts
  if (event.kind === "toolError") {
    return JSON.stringify({
      ...head,
      ok: false,
      isError: true,
      bytes: event.bytes,
      ms: event.ms,
      body: event.body,
    });
  }
  return JSON.stringify({
    ...head,
    ok: true,
    ...(event.toolCount === undefined ? {} : { tools: event.toolCount }),
    bytes: event.bytes,
    ms: event.ms,
    body: event.body,
  });
```

`body` 를 맨 뒤에 두는 이유는 키 순서를 리터럴로 고정하면서 **큰 값이 줄 끝에 오게** 하는 것이다 — 사람이 `--json` 줄을 눈으로 훑을 때 머리 필드들이 먼저 보인다. `humanResponse` 는 **손대지 않는다**(테스트 2).

- [ ] **Step 5: `describeResponse` 가 `body` 를 채운다**

`packages/mock/src/relay-server.ts` 의 `describeResponse` 마지막 세 `return` 을 바꾼다. `result` 는 이미 지역 변수로 뽑혀 있다 — **그 값을 그대로 싣는다. 복사하거나 고치지 않는다.**

```ts
  const result = (message as { result: Record<string, unknown> }).result;
  const bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  if (Array.isArray(result.tools)) {
    return { ...head, kind: "ok", bytes, toolCount: result.tools.length, body: result };
  }
  if (result.isError === true) return { ...head, kind: "toolError", bytes, body: result };
  return { ...head, kind: "ok", bytes, body: result };
```

- [ ] **Step 6: 유닛 테스트 통과를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && pnpm vitest run packages/mock/tests/relay-log.test.ts`

Expected: PASS. 출력에 `Test Files  1 passed` 와 통과 건수가 찍혀야 한다. 건수가 이전보다 5 건 늘었는지 본다.

- [ ] **Step 7: 끝-끝 절반 — 진짜 자식이 낸 `structuredContent` 가 `body` 에 실리는지 본다**

유닛 테스트는 `jsonResponse` 에 `body` 를 **손으로 넣어** 확인한 것이다. `describeResponse` 가 실제로 채우는지는 아직 아무도 안 봤다. `packages/mock/tests/relay-e2e.test.ts` 의 `describe("기록", ...)` 블록 안에 추가한다.

`bad_structured` 를 고른 이유: 설계 §3 이 실측한 그 모양이다 — `outputSchema` 는 `temperature`(number) 를 요구하는데 자식은 `temp`(string) 를 낸다. AI 경유로는 이 값이 사라지는 것이 확인된 자리라, 중계기 경로로는 살아 있어야 한다는 것이 이 테스트의 요점이다.

```ts
  it("--json 응답 줄의 body 에 자식이 낸 content 와 structuredContent 가 다 실린다", async () => {
    const lines: string[] = [];
    const handle = await startRelay({
      port: 0,
      command: process.execPath,
      args: [CHILD],
      log: (line) => lines.push(line),
      json: true,
      env: {},
    });
    open.push(handle);
    const session = await openSession(handle.url);
    sessions.push(session);
    await session.call(1, "tools/call", { name: "bad_structured", arguments: {} });

    const responses = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.dir === "res" && entry.tool === "bad_structured");
    expect(responses).toHaveLength(1);
    expect(responses[0]?.body).toEqual({
      content: [{ type: "text", text: "고장" }],
      structuredContent: { temp: "21" },
    });
  });
```

- [ ] **Step 8: 끝-끝 테스트 통과를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && pnpm vitest run packages/mock/tests/relay-e2e.test.ts`

Expected: PASS. **기존 케이스가 함께 초록인지도 본다** — `describe("기록")` 의 스냅샷 비교(사람이 읽는 줄)가 깨지면 `humanResponse` 를 잘못 건드린 것이다.

- [ ] **Step 9: 되돌려서 회귀를 증명한다**

새 테스트가 결함 경로를 실제로 지나는지 본다. **통과만 보고 넘기면 아무것도 검증하지 않는 테스트가 섞여 들어온다.**

```bash
cd /Users/cheonjamin/projects/mcptest
# Step 5 의 수정만 되돌린다 — body: result 세 곳을 뺀다.
git stash push -- packages/mock/src/relay-server.ts
pnpm vitest run packages/mock/tests/relay-e2e.test.ts
```

Expected: Step 7 의 케이스가 **실패한다**(`body` 가 `undefined`). 실패를 눈으로 본 뒤 되돌린다:

```bash
git stash pop
```

`git stash pop` 이 충돌하면 **stash 항목이 그대로 남는다.** 해소 후 `git stash drop` 을 직접 해야 한다.
`git stash push` 는 미커밋인 `tests/stdio-e2e.test.ts` 를 건드리지 않게 **경로를 반드시 지정**한다.

- [ ] **Step 10: 타입체크 · 린트**

```bash
cd /Users/cheonjamin/projects/mcptest
pnpm --filter @mcpeak/mock typecheck
pnpm biome check packages/mock
```

Expected: 둘 다 오류 0. **각 명령이 검사한 파일 수를 출력에서 확인한다** — 초록인데 파일 수가 0 이면 검사 대상에서 빠진 것이다.

- [ ] **Step 11: 사람에게 넘긴다 (커밋하지 않는다)**

권장 커밋 메시지와 변경 파일을 제시하고 **멈춘다.**

```
feat(mock): 중계기 기록 줄이 응답 본문을 싣는다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

변경 파일: `packages/mock/src/relay-log.ts` · `packages/mock/src/relay-server.ts` · `packages/mock/tests/relay-log.test.ts` · `packages/mock/tests/relay-e2e.test.ts`
**`packages/mock/tests/stdio-e2e.test.ts` 는 넣지 않는다.**

사람이 만든 SHA 를 확인한 뒤 Task 2 를 시작한다.

---

### Task 2: 케이스 꼬리표를 URL 로 나른다 (테스트 4 · 5)

**Files:**
- Modify: `packages/mock/src/relay-log.ts` (`RelayRequestEvent`·`RelayResponseEvent`·`jsonRequest`·`jsonResponse`, `readCaseTag` 신규)
- Modify: `packages/mock/src/relay-server.ts:153-192` (`createServer` 콜백), `:97-103` (`Pending`), `:252-261` (`describeResponse` 머리)
- Test: `packages/mock/tests/relay-log.test.ts`, `packages/mock/tests/relay-e2e.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `RelayResponseEvent.body`
- Produces:
  ```ts
  export const MAX_CASE_TAG = 200;
  export function readCaseTag(url: string | undefined): string | undefined;
  ```
  그리고 `RelayRequestEvent` · `RelayResponseEvent` 양쪽에 `readonly case?: string`. T3(dashboard)가 `--json` 줄의 `case` 필드로 화면 칸을 가른다.

**왜 URL 인가:** 중계기는 stateless 다(`relay-server.ts:157`, `sessionIdGenerator: undefined`). **접속을 구분할 식별자가 없다.** 경로·쿼리는 보지 않고 넘기므로 `?case=<id>` 를 붙여도 정상 동작한다(설계 §3 실측). 꼬리표를 URL 로 나르는 근거가 이것이다.

**꼬리표는 `--json` 줄에만 싣는다.** 사람이 읽는 줄은 한 바이트도 바뀌지 않는다 — 터미널로 중계기를 쓰는 사람에게는 꼬리표가 아예 없고(대시보드만 붙인다), 문안 규칙은 설계가 못박은 것이다. 테스트 4 의 "없으면 **필드** 자체가 없다" 도 JSON 필드를 말한다.

- [ ] **Step 1: `readCaseTag` 의 실패하는 유닛 테스트를 쓴다 (테스트 5)**

`packages/mock/tests/relay-log.test.ts` 맨 아래에 새 블록을 추가하고, 파일 맨 위 import 에 `MAX_CASE_TAG` 와 `readCaseTag` 를 더한다.

```ts
describe("readCaseTag", () => {
  it("case 쿼리가 있으면 그 값을 돌려준다", () => {
    expect(readCaseTag("/mcp?case=seoul-weather")).toBe("seoul-weather");
  });

  it("url 이 없거나 case 쿼리가 없으면 undefined 다", () => {
    expect(readCaseTag(undefined)).toBeUndefined();
    expect(readCaseTag("/mcp")).toBeUndefined();
    expect(readCaseTag("/mcp?other=1")).toBeUndefined();
  });

  it("빈 값은 꼬리표가 아니다", () => {
    expect(readCaseTag("/mcp?case=")).toBeUndefined();
  });

  it("퍼센트 인코딩을 디코드한다 — 케이스 id 에 문자 제약이 없다", () => {
    // core 의 스위트 스키마에서 `cases[].id` 는 nonEmptyString 뿐이다. 한글·공백 id 가
    // 적법하므로 허용 문자를 kebab-case 로 좁히면 멀쩡한 케이스의 꼬리표가 조용히 사라진다.
    expect(readCaseTag("/mcp?case=%EC%84%9C%EC%9A%B8%20%EB%A7%91%EC%9D%8C")).toBe("서울 맑음");
  });

  it("상한을 넘는 값은 버린다", () => {
    expect(readCaseTag(`/mcp?case=${"a".repeat(MAX_CASE_TAG)}`)).toBe("a".repeat(MAX_CASE_TAG));
    expect(readCaseTag(`/mcp?case=${"a".repeat(MAX_CASE_TAG + 1)}`)).toBeUndefined();
  });

  it("제어문자가 섞인 값은 버린다 — 기록 채널이 줄 단위다", () => {
    expect(readCaseTag("/mcp?case=a%0Ab")).toBeUndefined();
    expect(readCaseTag("/mcp?case=a%00b")).toBeUndefined();
  });

  it("case 가 여러 번 오면 첫 값을 쓴다", () => {
    expect(readCaseTag("/mcp?case=first&case=second")).toBe("first");
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && pnpm vitest run packages/mock/tests/relay-log.test.ts`

Expected: FAIL — `readCaseTag` 가 없어 import 가 깨진다.

- [ ] **Step 3: `readCaseTag` 를 구현한다**

`packages/mock/src/relay-log.ts` 의 `groupDigits` **앞**(타입 선언 뒤)에 넣는다. 순수 함수라 이 파일의 규칙을 깨지 않는다.

```ts
/**
 * 꼬리표 길이 상한. 케이스 id 는 화면 칸 제목에 쓰이는 짧은 식별자다 — 이보다 길면
 * 그것은 id 가 아니라 누가 URL 에 딴 것을 실은 것이다.
 */
export const MAX_CASE_TAG = 200;

/**
 * 제어문자. **기록 채널이 줄 단위라** 개행이 섞이면 대시보드의 줄 파서가 없던 줄을
 * 하나 더 본다. `JSON.stringify` 가 이스케이프하므로 지금 통로로는 새지 않지만, 거르는
 * 자리는 값이 들어오는 지점 한 곳에 둔다.
 */
const CONTROL_CHARS = /[ -]/;

/**
 * URL 쿼리의 `case` 꼬리표. 순수 함수 — 길이·문자 상한을 건다.
 *
 * **허용 문자를 kebab-case 로 좁히지 않는다.** `cases[].id` 는 스위트 스키마에서
 * `nonEmptyString` 뿐이라 한글·공백 id 가 적법하고(실측: `packages/runner/src/spec/json-schema.ts`),
 * 좁히면 멀쩡한 케이스의 꼬리표가 조용히 사라져 화면이 칸을 못 가른다. 거르는 것은
 * **줄 단위 채널을 깨는 것**(제어문자)과 **id 가 아닌 크기**(상한) 둘뿐이다.
 *
 * 버릴 때 오류를 던지지 않는다 — 꼬리표는 화면을 나누는 편의이고, 없으면 칸이 하나로
 * 합쳐질 뿐 중계 자체는 정상이다. 중계기가 사용자의 요청을 거절할 이유가 되지 않는다.
 */
export function readCaseTag(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  let value: string | null;
  try {
    // `req.url` 은 경로+쿼리라 절대 URL 이 아니다. 기준이 필요하고, 그 기준은 버려지므로
    // 어떤 값이든 결과에 영향이 없다.
    value = new URL(url, "http://127.0.0.1").searchParams.get("case");
  } catch {
    return undefined;
  }
  if (value === null || value === "") return undefined;
  if (value.length > MAX_CASE_TAG) return undefined;
  if (CONTROL_CHARS.test(value)) return undefined;
  return value;
}
```

- [ ] **Step 4: 유닛 테스트 통과를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && pnpm vitest run packages/mock/tests/relay-log.test.ts -t readCaseTag`

Expected: PASS, 7 건.

- [ ] **Step 5: 문안이 꼬리표를 싣는 실패 테스트를 쓴다 (테스트 4 의 유닛 절반)**

`packages/mock/tests/relay-log.test.ts` 의 `jsonRequest` · `jsonResponse` 블록에 각각 추가한다.

```ts
  it("케이스 꼬리표가 있으면 요청 줄에 싣는다", () => {
    const line = jsonRequest({
      id: 1,
      method: "tools/call",
      tool: "get_weather",
      args: { city: "서울" },
      case: "seoul-weather",
    });
    expect(JSON.parse(line)).toEqual({
      dir: "req",
      id: 1,
      method: "tools/call",
      tool: "get_weather",
      case: "seoul-weather",
      args: { city: "서울" },
    });
  });

  it("꼬리표가 없으면 요청 줄에 필드 자체가 없다", () => {
    expect(JSON.parse(jsonRequest({ id: 1, method: "tools/list" }))).not.toHaveProperty("case");
  });
```

```ts
  it("케이스 꼬리표가 있으면 응답 줄에 싣는다", () => {
    const line = jsonResponse({
      id: 1,
      method: "tools/call",
      tool: "get_weather",
      kind: "ok",
      bytes: 97,
      ms: 4,
      body: { content: [] },
      case: "seoul-weather",
    });
    expect(JSON.parse(line)).toEqual({
      dir: "res",
      id: 1,
      tool: "get_weather",
      case: "seoul-weather",
      ok: true,
      bytes: 97,
      ms: 4,
      body: { content: [] },
    });
  });

  it("꼬리표가 없으면 응답 줄에 필드 자체가 없다", () => {
    const line = jsonResponse({
      id: 1,
      method: "tools/call",
      kind: "ok",
      bytes: 1,
      ms: 1,
      body: {},
    });
    expect(JSON.parse(line)).not.toHaveProperty("case");
  });

  it("프로토콜 오류 줄도 꼬리표를 싣는다", () => {
    const line = jsonResponse({
      id: 1,
      method: "tools/call",
      kind: "protocolError",
      code: -32602,
      message: "Unknown tool",
      ms: 1,
      case: "missing-tool",
    });
    expect(JSON.parse(line)).toMatchObject({ case: "missing-tool", ok: false });
  });
```

그리고 사람이 읽는 줄이 **안 바뀌는** 것을 고정한다 (`humanRequest`·`humanResponse` 블록에 각각):

```ts
  it("사람이 읽는 줄은 꼬리표를 싣지 않는다", () => {
    expect(
      humanRequest({ id: 1, method: "tools/call", tool: "get_weather", case: "seoul-weather" }),
    ).toBe("→ tools/call  get_weather");
    expect(
      humanResponse({
        id: 1,
        method: "tools/call",
        tool: "get_weather",
        kind: "ok",
        bytes: 97,
        ms: 4,
        body: {},
        case: "seoul-weather",
      }),
    ).toBe("← tools/call  get_weather 성공 · 97바이트 · 0.0초");
  });
```

- [ ] **Step 6: 실패를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && pnpm vitest run packages/mock/tests/relay-log.test.ts`

Expected: FAIL — `case` 가 이벤트 타입에 없어 타입 오류가 나거나, JSON 줄에 `case` 키가 없어 `toEqual` 이 깨진다.

- [ ] **Step 7: 타입과 문안에 `case` 를 더한다**

`packages/mock/src/relay-log.ts`:

```ts
export interface RelayRequestEvent {
  /** 중계기가 매긴 id. 클라이언트의 id 가 아니다 — 세션 둘이 같은 값을 쓴다. */
  readonly id: number;
  readonly method: string;
  readonly tool?: string;
  readonly args?: unknown;
  /**
   * 대시보드가 URL(`?case=<id>`)로 실어 보낸 케이스 꼬리표. **터미널 사용에는 없다.**
   *
   * 중계기가 stateless 라 접속을 구분할 식별자가 없다(`relay-server.ts` 의
   * `sessionIdGenerator: undefined`). 동시 실행에서 케이스를 가르는 유일한 축이다.
   */
  readonly case?: string;
}
```

`RelayResponseEvent` 의 공통 머리에도 같은 필드를 더한다 (`ms` 뒤).

```ts
export type RelayResponseEvent = {
  readonly id: number;
  readonly method: string;
  readonly tool?: string;
  readonly ms: number;
  /** `RelayRequestEvent.case` 와 같다 — 짝지은 요청의 꼬리표를 그대로 옮긴다. */
  readonly case?: string;
} & (
  | {
      readonly kind: "ok";
      readonly bytes: number;
      readonly toolCount?: number;
      /**
       * JSON-RPC `result` **전체**. `content` 와 `structuredContent` 가 같이 들어 있다.
       *
       * AI 경유로는 `structuredContent` 가 오지 않는다(설계 §3 실측). 사용자가 자기 서버
       * 답의 반쪽만 보게 되므로 중계기가 직접 싣는다. **줄이지 않는다** — 접는 것은 화면이
       * 할 일이고, 관찰 채널의 충실성이 여기서는 먼저다(설계 §2-6).
       */
      readonly body: unknown;
    }
  | { readonly kind: "toolError"; readonly bytes: number; readonly body: unknown }
  // `protocolError` 에는 `body` 가 없다. 서버가 결과를 준 적이 없어 지어낼 것이 없다 —
  // "오류는 진짜 서버가 준 것만 쓴다" 를 타입이 지키게 한다.
  | { readonly kind: "protocolError"; readonly code: number; readonly message: string }
);
```

유니온 세 갈래는 Task 1 에서 만든 것과 **같다.** `case` 는 공통 머리에만 더하므로 유니온은 손대지 않는다 — 위 블록은 최종 형태를 전문으로 보인 것이다.

`jsonRequest` — `tool` 뒤, `args` 앞에 넣는다. **키 순서는 리터럴로 고정한다.**

```ts
export function jsonRequest(event: RelayRequestEvent): string {
  // 키 순서를 리터럴로 고정한다. 조건부 전개라 순서가 흔들리면 4 단계의 스냅샷
  // 비교가 이유 없이 깨진다.
  return JSON.stringify({
    dir: "req",
    id: event.id,
    method: event.method,
    ...(event.tool === undefined ? {} : { tool: event.tool }),
    ...(event.case === undefined ? {} : { case: event.case }),
    ...(event.args === undefined ? {} : { args: event.args }),
  });
}
```

`jsonResponse` — `head` 에 넣으면 세 분기가 한 번에 받는다.

```ts
  const head = {
    dir: "res" as const,
    id: event.id,
    ...(event.tool === undefined ? {} : { tool: event.tool }),
    ...(event.case === undefined ? {} : { case: event.case }),
  };
```

`humanRequest` · `humanResponse` · `jsonDrop` 은 **손대지 않는다.** `RelayDropEvent` 에도 꼬리표를 넣지 않는다 — 버린 메시지는 자식이 먼저 건 것이라 짝지을 요청이 없고, 따라서 어느 케이스의 것인지 말할 근거가 없다.

- [ ] **Step 8: 유닛 테스트 통과를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && pnpm vitest run packages/mock/tests/relay-log.test.ts`

Expected: PASS. 기존 케이스까지 전부 초록이어야 한다 — 꼬리표가 없을 때 줄이 **글자 그대로 예전과 같다**는 것이 기존 스냅샷으로 지켜진다.

- [ ] **Step 9: 중계기가 `req.url` 에서 꼬리표를 읽는 실패 테스트를 쓴다 (테스트 4 의 끝-끝 절반)**

`packages/mock/tests/relay-e2e.test.ts` 의 `describe("기록", ...)` 안에 추가한다. **동시 실행에서 섞인 줄을 가르는 것**이 이 기능의 존재 이유라, 두 꼬리표를 같이 띄워 그것을 본다.

```ts
  it("서로 다른 꼬리표로 붙은 두 세션의 줄이 꼬리표로 갈린다", async () => {
    const lines: string[] = [];
    const handle = await startRelay({
      port: 0,
      command: process.execPath,
      args: [CHILD],
      log: (line) => lines.push(line),
      json: true,
      env: {},
    });
    open.push(handle);

    const first = await openSession(`${handle.url}?case=seoul-weather`);
    const second = await openSession(`${handle.url}?case=%EC%84%9C%EC%9A%B8%20%EB%A7%91%EC%9D%8C`);
    sessions.push(first, second);
    await Promise.all([
      first.call(1, "tools/call", { name: "echo", arguments: { text: "가" } }),
      second.call(1, "tools/call", { name: "echo", arguments: { text: "나" } }),
    ]);

    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const tagsOf = (dir: string): string[] =>
      parsed.filter((entry) => entry.dir === dir).map((entry) => String(entry.case));
    // 요청·응답 양쪽에 실린다. 순서는 동시 실행이라 보장하지 않으므로 정렬해서 본다.
    expect(tagsOf("req").sort()).toEqual(["seoul-weather", "서울 맑음"].sort());
    expect(tagsOf("res").sort()).toEqual(["seoul-weather", "서울 맑음"].sort());
  });

  it("꼬리표 없이 붙으면 줄에 case 필드가 없다", async () => {
    const lines: string[] = [];
    const handle = await startRelay({
      port: 0,
      command: process.execPath,
      args: [CHILD],
      log: (line) => lines.push(line),
      json: true,
      env: {},
    });
    open.push(handle);
    const session = await openSession(handle.url);
    sessions.push(session);
    await session.call(1, "tools/call", { name: "echo", arguments: {} });

    for (const line of lines) {
      expect(JSON.parse(line)).not.toHaveProperty("case");
    }
  });
```

- [ ] **Step 10: 실패를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && pnpm vitest run packages/mock/tests/relay-e2e.test.ts -t 꼬리표`

Expected: FAIL — 첫 케이스가 `["undefined","undefined"]` 를 받는다. 중계기가 아직 `req.url` 을 안 읽는다.

- [ ] **Step 11: 중계기가 꼬리표를 읽어 대기표에 넣는다**

`packages/mock/src/relay-server.ts` — import 에 `readCaseTag` 를 더한다.

```ts
import {
  humanDrop,
  humanRequest,
  humanResponse,
  jsonDrop,
  jsonRequest,
  jsonResponse,
  readCaseTag,
  type RelayDropEvent,
  type RelayRequestEvent,
  type RelayResponseEvent,
} from "./relay-log.js";
```

`Pending` 에 필드를 더한다.

```ts
  interface Pending {
    readonly transport: StreamableHTTPServerTransport;
    readonly clientId: string | number;
    readonly method: string;
    readonly tool?: string;
    /** 이 접속이 URL 로 실어 온 케이스 꼬리표. 응답 줄에 그대로 옮긴다. */
    readonly case?: string;
    readonly startedAt: number;
  }
```

`createServer` 콜백 머리에서 **접속당 한 번** 읽는다. 요청마다 새 transport 를 만드는 자리라 여기가 꼬리표의 수명과 정확히 맞는다.

```ts
  const http: HttpServer = createServer((req, res) => {
    // 꼬리표는 접속당 하나다. 여기서 한 번 읽어 아래 클로저가 쓴다 — `onmessage` 안에서
    // 다시 읽을 수 있지만, 같은 접속에서 값이 달라질 여지를 만들지 않는다.
    const caseTag = readCaseTag(req.url);
    // stateless 모드는 요청마다 새 transport 를 요구한다
    // (SDK: "Stateless transport cannot be reused across requests."). stateful 로 가면
    // sessionIdGenerator 가 randomUUID 를 쓰게 되어 결정론성이 깨진다.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
```

`transport.onmessage` 안의 `writeRequest` 와 `pending.set` 에 싣는다.

```ts
      writeRequest({
        id: relayId,
        method: message.method,
        ...(tool === undefined ? {} : { tool }),
        ...(caseTag === undefined ? {} : { case: caseTag }),
        ...(params?.arguments === undefined ? {} : { args: params.arguments }),
      });
      pending.set(relayId, {
        transport,
        clientId: message.id,
        method: message.method,
        tool,
        case: caseTag,
        startedAt: Date.now(),
      });
```

`describeResponse` 의 인자 타입과 머리에 더한다.

```ts
function describeResponse(
  message: JSONRPCMessage,
  entry: { method: string; tool?: string; case?: string; startedAt: number },
): RelayResponseEvent {
  const head = {
    id: 0, // 아래에서 덮어쓴다 — 호출부가 relayId 를 안다.
    method: entry.method,
    ...(entry.tool === undefined ? {} : { tool: entry.tool }),
    ...(entry.case === undefined ? {} : { case: entry.case }),
    ms: Date.now() - entry.startedAt,
  };
```

- [ ] **Step 12: 끝-끝 테스트 통과를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && pnpm vitest run packages/mock/tests/relay-e2e.test.ts`

Expected: PASS, 기존 케이스 포함 전부. 특히 `describe("세션 격리")` 가 초록인지 본다.

- [ ] **Step 13: 되돌려서 회귀를 증명한다**

Step 9 의 첫 케이스는 **두 꼬리표가 갈리는지**를 본다. 단일 세션만 쓰면 "꼬리표를 하나 박아 넣어도" 통과하는 모양이 되므로, 되돌려 실패를 확인한다.

```bash
cd /Users/cheonjamin/projects/mcptest
git stash push -- packages/mock/src/relay-server.ts
pnpm vitest run packages/mock/tests/relay-e2e.test.ts -t 꼬리표
```

Expected: 첫 케이스 **실패**(`case` 가 없다), 두 번째 케이스는 통과(원래 없으니). 확인 후:

```bash
git stash pop
```

- [ ] **Step 14: 타입체크 · 린트 · 패키지 전체 테스트**

```bash
cd /Users/cheonjamin/projects/mcptest
pnpm --filter @mcpeak/mock typecheck
pnpm biome check packages/mock
pnpm vitest run packages/mock
```

Expected: 전부 초록. 마지막 명령 출력에 `Test Files ... passed` 와 파일 수가 찍혀야 한다.
`grep -rc "not implemented" packages/mock/src` 로 남은 스텁이 없는지도 본다(0 이어야 한다. **0 건일 때 `grep` 은 exit 1 이다 — 건수는 stdout 에서 읽고 종료 코드와 섞지 않는다**).

- [ ] **Step 15: 사람에게 넘긴다**

```
feat(mock): 중계기가 케이스 꼬리표를 URL 에서 읽어 기록한다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

변경 파일: `packages/mock/src/relay-log.ts` · `packages/mock/src/relay-server.ts` · `packages/mock/tests/relay-log.test.ts` · `packages/mock/tests/relay-e2e.test.ts`

사람이 만든 SHA 를 확인한 뒤 Task 3 을 시작한다.

---

### Task 3: `relayBinPath()` 를 내보낸다 (테스트 6)

**Files:**
- Modify: `packages/mock/src/index.ts` (import 머리 + 파일 끝에 함수 추가)
- Test: `packages/mock/tests/relay-bin-path.test.ts` (신규)

**Interfaces:**
- Consumes: 없음 (Task 1·2 와 독립)
- Produces: `export function relayBinPath(): string` — `@mcpeak/mock` 의 공개 면. T3(dashboard)가 `spawn` 대상으로 쓴다.

**구현 형태는 실측으로 정했다** (위 「이미 닫힌 실측」). `package.json` 의 `bin["mcpeak-relay"]` 를 읽는다 — 경로를 짐작하지 않고 진실 원천을 하나로 둔다(설계 §9). `../package.json` 이 소스로 돌 때와 산출물로 돌 때 같은 파일을 가리키는 것, cjs 산출물에서도 `import.meta.url` 이 도는 것 둘 다 확인했다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/mock/tests/relay-bin-path.test.ts` 를 새로 만든다.

**존재 확인(`existsSync`)을 여기 넣지 않는다.** `pnpm test` 는 루트에서 `vitest run` 이고 turbo 를 지나지 않아 **빌드 의존이 없다** — clean checkout 에서 `dist/relay.mjs` 가 없어 이유 없이 빨개진다. 여기서 고정하는 것은 "매니페스트와 어긋나지 않는다" 이고, 존재 확인은 빌드 뒤에 해야 한다(아래 「미결」 참조).

```ts
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { relayBinPath } from "../src/index.js";

/** 패키지 루트. `tests/` 의 한 칸 위다. */
const ROOT = fileURLToPath(new URL("..", import.meta.url));

const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  bin: Record<string, string>;
};

describe("relayBinPath", () => {
  it("package.json 의 bin 을 패키지 루트 기준으로 해석한다", () => {
    // 경로를 여기 다시 적지 않는다. 매니페스트와 **어긋나지 않는 것**이 계약이고,
    // 문자열을 박아 두면 bin 을 바꿀 때 이 테스트가 같이 틀려서 아무것도 안 잡는다.
    expect(relayBinPath()).toBe(join(ROOT, manifest.bin["mcpeak-relay"] ?? ""));
  });

  it("절대경로를 돌려준다 — 대시보드가 임시 cwd 에서 spawn 한다", () => {
    expect(isAbsolute(relayBinPath())).toBe(true);
  });

  it("소스로 돌 때도 dist 산출물을 가리킨다", () => {
    // vitest 는 `src/index.ts` 를 읽는다. `src/relay.mjs` 는 없으므로, 여기서 `src/` 를
    // 가리키면 발행본과 소스 실행이 갈린다. 실측으로 닫은 자리다(계획서 머리).
    expect(relayBinPath()).toBe(join(ROOT, "dist", "relay.mjs"));
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && pnpm vitest run packages/mock/tests/relay-bin-path.test.ts`

Expected: FAIL — `relayBinPath` 가 `../src/index.js` 에 없어 import 가 깨진다.

- [ ] **Step 3: `relayBinPath()` 를 구현한다**

`packages/mock/src/index.ts` 의 import 머리에 세 줄을 더한다. 기존 첫 두 줄(`node:http`) 위에 온다 — biome 이 정렬한다.

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
```

파일 **맨 끝**(`serveStdio` 뒤)에 함수를 더한다.

```ts
/**
 * 중계기 실행 파일(`mcpeak-relay`)의 절대경로. 대시보드가 `spawn` 대상으로 쓴다.
 *
 * **경로를 짐작하지 않고 `package.json` 의 `bin` 을 읽는다.** bin 이름이나 산출물
 * 파일명이 바뀌면 여기가 자동으로 따라오도록 진실 원천을 하나로 둔다(설계 §9).
 *
 * `src/` 와 `dist/` 가 패키지 루트 바로 아래 같은 깊이라, `../package.json` 은 소스로
 * 돌 때(vitest)와 산출물로 돌 때(발행본) **같은 파일**을 가리킨다. cjs 산출물에서도
 * 돈다 — rolldown 이 `import.meta.url` 을
 * `require("url").pathToFileURL(__filename).href` 로 바꿔 넣는다(tsdown 0.22.14 실측).
 * dist 의 해시 청크도 `dist/` 바로 아래라 깊이가 같다.
 *
 * `relay.mjs` 는 **빌드 산출물이다.** 이 함수는 경로를 계산할 뿐 파일이 있는지는 보지
 * 않는다 — 빌드 전에 부르면 없는 경로가 나온다. 존재 확인은 부르는 쪽이 한다.
 */
export function relayBinPath(): string {
  const manifestUrl = new URL("../package.json", import.meta.url);
  const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as {
    bin?: Record<string, string>;
  };
  const relative = manifest.bin?.["mcpeak-relay"];
  if (relative === undefined) {
    throw new Error(
      [
        "→ package.json 의 bin 에 'mcpeak-relay' 항목이 없어 중계기 실행 파일의 위치를 알 수 없습니다.",
        `→ 읽은 파일: ${fileURLToPath(manifestUrl)}`,
        `→ 발견된 bin 항목: ${Object.keys(manifest.bin ?? {}).join(", ") || "없음"}`,
        "→ bin 이름을 바꿨다면 relayBinPath() 가 찾는 이름도 같이 바꾸세요.",
      ].join("\n"),
    );
  }
  return join(dirname(fileURLToPath(manifestUrl)), relative);
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd /Users/cheonjamin/projects/mcptest && pnpm vitest run packages/mock/tests/relay-bin-path.test.ts`

Expected: PASS, 3 건.

- [ ] **Step 5: 두 산출물에서 실제로 도는지 확인한다 — 유닛 테스트가 못 보는 곳**

위 테스트는 `src/` 만 지난다. **`dist/` 와 cjs 는 vitest 밖이다.** 빌드하고 두 포맷에서 직접 부른다.

```bash
cd /Users/cheonjamin/projects/mcptest
pnpm --filter @mcpeak/mock build
# turbo 캐시가 낡은 dist 를 복원해도 빌드는 성공이라고 찍힌다. 고친 심볼이 실제로 있는지 본다.
grep -l relayBinPath packages/mock/dist/*.mjs packages/mock/dist/*.cjs
```

Expected: `grep -l` 이 esm·cjs 양쪽 파일을 적어도 하나씩 적는다. **아무것도 안 나오면** 캐시가 낡은 것이다:

```bash
cd /Users/cheonjamin/projects/mcptest/packages/mock && npx tsdown --config-loader native && cd /Users/cheonjamin/projects/mcptest
```

그 다음 두 포맷에서 부른다. **셸 작업 디렉터리가 호출 사이에 유지되므로 루트로 돌아온 것을 확인한다.**

```bash
cd /Users/cheonjamin/projects/mcptest
node --input-type=module -e "
import { relayBinPath } from './packages/mock/dist/index.mjs';
import { existsSync } from 'node:fs';
const p = relayBinPath();
console.log('esm:', p, existsSync(p) ? 'OK' : 'MISSING');
if (!existsSync(p)) process.exit(1);
"
node -e "
const { relayBinPath } = require('./packages/mock/dist/index.cjs');
const { existsSync } = require('node:fs');
const p = relayBinPath();
console.log('cjs:', p, existsSync(p) ? 'OK' : 'MISSING');
if (!existsSync(p)) process.exit(1);
"
```

Expected: 두 줄 다 `…/packages/mock/dist/relay.mjs OK`. **종료 코드는 파이프 없이 확인한다** — `cmd >/dev/null 2>&1; echo $?` 로 본다. 파이프 뒤에서 `$?` 를 읽으면 `head`·`tail` 의 값이다.

- [ ] **Step 6: 되돌려서 회귀를 증명한다**

```bash
cd /Users/cheonjamin/projects/mcptest
git stash push -- packages/mock/src/index.ts
pnpm vitest run packages/mock/tests/relay-bin-path.test.ts
git stash pop
```

Expected: 3 건 전부 실패(import 가 깨진다). 확인 후 되돌린다.

- [ ] **Step 7: 타입체크 · 린트**

```bash
cd /Users/cheonjamin/projects/mcptest
pnpm --filter @mcpeak/mock typecheck
pnpm biome check packages/mock
```

Expected: 오류 0. 검사한 파일 수가 출력에 찍히는지 본다 — 새 파일이 `index.ts` 를 지나 검사 대상에 들어왔는지가 이 확인의 요점이다.

- [ ] **Step 8: 사람에게 넘긴다**

```
feat(mock): 중계기 실행 파일 경로를 relayBinPath 로 내보낸다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

변경 파일: `packages/mock/src/index.ts` · `packages/mock/tests/relay-bin-path.test.ts`

`@mcpeak/mock` 의 **공개 면이 넓어지는 변경**이므로 changeset 이 필요한지 사람에게 확인받는다(`.changeset/` 은 CI 의 `changeset-check` 가 본다).

---

### Task 3b: 빌드 산출물에 중계기 bin 이 실제로 있는지 CI 가 본다 (테스트 6 의 나머지 절반)

**사용자 승인:** CI 스텝을 넣는다(2026-09-21 확인). 아래 「미결 ①」이 이것으로 닫힌다.

**Files:**
- Create: `packages/mock/tests/dist-relay-bin-e2e.mjs`
- Modify: `packages/mock/package.json` (`scripts.test:e2e` 추가)
- Modify: `.github/workflows/ci.yml` (`build` 잡에 스텝 하나)

**Interfaces:**
- Consumes: Task 3 의 `relayBinPath()`
- Produces: 없음 (검증 통로)

**왜 vitest 밖인가:** `pnpm test` 는 루트 `vitest run` 이고 turbo 를 지나지 않아 **빌드 의존이 없다.** `existsSync` 를 vitest 에 넣으면 clean checkout 에서 이유 없이 빨개진다. `cli`(`test:e2e` → `dist-cli-e2e.mjs`) · `record`(`dist-external-e2e.mjs`)가 이미 같은 모양이고, CI 의 `build` 잡이 빌드 뒤에 그것들을 부른다. 같은 자리에 하나 더 붙인다.

**`dist-cli-e2e.mjs` 를 건드리지 않는다.** 그 파일은 꼬리에 블록을 붙여 나가는 구조라 리베이스 때 거의 항상 충돌한다. `mock` 전용 새 파일을 만든다.

- [ ] **Step 1: 실패하는 dist E2E 를 쓴다**

`packages/mock/tests/dist-relay-bin-e2e.mjs` 를 새로 만든다. vitest 가 아니라 **맨 node** 다 — `cli`·`record` 와 같은 모양이다.

```js
/**
 * 빌드 산출물 전용 E2E. **vitest 밖이다** — `pnpm test` 는 빌드를 앞세우지 않으므로
 * 존재 확인을 거기 넣으면 clean checkout 에서 이유 없이 빨개진다. CI 의 `build` 잡이
 * `pnpm build` 뒤에 부른다.
 *
 * 무엇을 고정하나: `relayBinPath()` 가 가리키는 파일이 **빌드 뒤에 실제로 있다**.
 * 매니페스트 합의는 vitest 쪽(`relay-bin-path.test.ts`)이 이미 보므로, 여기서만 할 수
 * 있는 것은 산출물이 정말 나왔는지다. `src/relay.ts` 가 tsdown entry 에서 빠지면
 * 여기서 걸린다.
 *
 * **두 포맷을 다 본다.** 발행본 소비자는 `import` 로도 `require` 로도 들어온다.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const pkgRoot = resolve(here, "..");
const expected = join(pkgRoot, "dist", "relay.mjs");

const esm = await import(join(pkgRoot, "dist", "index.mjs"));
const cjs = createRequire(import.meta.url)(join(pkgRoot, "dist", "index.cjs"));

for (const [label, mod] of [
  ["esm", esm],
  ["cjs", cjs],
]) {
  assert.equal(
    typeof mod.relayBinPath,
    "function",
    `→ ${label} 산출물이 relayBinPath 를 내보내지 않습니다.\n` +
      "→ src/index.ts 에서 export 했는지, tsdown 캐시가 낡지 않았는지 확인하세요.",
  );
  const actual = mod.relayBinPath();
  assert.equal(
    actual,
    expected,
    `→ ${label} 산출물의 relayBinPath() 가 다른 곳을 가리킵니다.\n` +
      `→ 받은 값: ${actual}\n→ 기대한 값: ${expected}`,
  );
  assert.ok(
    existsSync(actual),
    `→ ${label}: relayBinPath() 가 가리키는 파일이 없습니다: ${actual}\n` +
      "→ pnpm build 를 돌렸는지 확인하세요.\n" +
      "→ 빌드가 성공했는데도 없으면 turbo 캐시가 낡은 dist 를 복원한 것입니다 — " +
      "packages/mock 에서 npx tsdown --config-loader native 로 직접 빌드하세요.\n" +
      "→ package.json 의 bin.mcpeak-relay 가 tsdown entry(src/relay.ts)와 맞는지도 보세요.",
  );
}

console.log(`✔ relayBinPath() → ${expected} (esm · cjs 양쪽 확인)`);
```

- [ ] **Step 2: 스크립트를 더한다**

`packages/mock/package.json` 의 `scripts` 에 한 줄. **`cli`·`record` 와 같은 이름을 쓴다** — CI 가 `pnpm --filter <pkg> test:e2e` 로 부른다.

```json
    "test": "vitest run --root ../.. packages/mock",
    "test:e2e": "node ./tests/dist-relay-bin-e2e.mjs"
```

- [ ] **Step 3: 빌드 전에 실패하는 것을 본다**

```bash
cd /Users/cheonjamin/projects/mcptest
rm -rf packages/mock/dist
pnpm --filter @mcpeak/mock test:e2e; echo "종료 코드: $?"
```

Expected: 실패. `dist/index.mjs` 가 없어 import 가 깨진다. **종료 코드는 파이프 없이 읽는다** — 위처럼 `; echo $?` 로 본다.

- [ ] **Step 4: 빌드 후 통과하는 것을 본다**

```bash
cd /Users/cheonjamin/projects/mcptest
pnpm --filter @mcpeak/mock build
pnpm --filter @mcpeak/mock test:e2e; echo "종료 코드: $?"
```

Expected: `✔ relayBinPath() → …/packages/mock/dist/relay.mjs (esm · cjs 양쪽 확인)`, 종료 코드 0.

- [ ] **Step 5: 되돌려서 회귀를 증명한다 — bin 이름을 틀리게 해 본다**

이 E2E 가 **정말 무언가를 보는지** 확인한다. `package.json` 의 `bin` 키를 잠시 틀리게 바꾼다.

```bash
cd /Users/cheonjamin/projects/mcptest
cp packages/mock/package.json /tmp/mock-pkg.json.bak
node -e "
const fs=require('fs');const p='packages/mock/package.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
j.bin['mcpeak-relay-오타']=j.bin['mcpeak-relay'];delete j.bin['mcpeak-relay'];
fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');
"
pnpm --filter @mcpeak/mock test:e2e; echo "종료 코드: $?"
```

Expected: **실패한다.** `relayBinPath()` 가 "bin 에 'mcpeak-relay' 항목이 없습니다" 를 던지고 종료 코드가 0 이 아니다. 확인 후 **반드시** 되돌린다:

```bash
cd /Users/cheonjamin/projects/mcptest
cp /tmp/mock-pkg.json.bak packages/mock/package.json
git diff --stat packages/mock/package.json
```

`git diff --stat` 에 `test:e2e` 추가분만 남아야 한다. **되돌리기를 빠뜨리면 발행본의 bin 이름이 깨진다.**

- [ ] **Step 6: CI 의 `build` 잡에 스텝을 더한다**

`.github/workflows/ci.yml` 의 `build` 잡, `Verify built record external subpath` **뒤**에 넣는다. `cli` · `record` 와 같은 모양이다.

```yaml
      - name: Verify built relay bin path
        run: pnpm --filter @mcpeak/mock test:e2e
```

**어느 잡의 어느 스텝이 이것을 실행하는지 지목할 수 있어야 한다** — `build` 잡(`needs: changes`, `if: needs.changes.outputs.code == 'true'`)의 `Build` 스텝 뒤다. 문서만 고친 PR 에서는 `build` 잡이 잡 수준 `if` 로 건너뛰어지고, GitHub 이 skipped 를 통과로 치므로 필수 체크가 막히지 않는다.

- [ ] **Step 7: 워크플로 문법을 확인한다**

```bash
cd /Users/cheonjamin/projects/mcptest
node -e "
const fs=require('fs');
const t=fs.readFileSync('.github/workflows/ci.yml','utf8');
const i=t.indexOf('Verify built relay bin path');
if(i===-1){console.error('스텝이 없습니다');process.exit(1)}
console.log(t.slice(i-200,i+120));
"
```

Expected: 새 스텝이 `build` 잡의 다른 `Verify built …` 스텝들과 **같은 들여쓰기**(6 칸)로 붙어 있다. YAML 은 들여쓰기가 틀리면 조용히 다른 잡에 붙는다.

**`pnpm biome check .github` 로 확인하지 마라.** biome 설정이 `.github` 을 통째로 무시해서 `Checked 0 files … These paths were provided but ignored` 와 **종료 코드 1** 이 나온다 — 린트 실패로 착각하기 쉽지만 검사한 파일이 0 건이다(실측). 들여쓰기 눈확인으로는 모자라니 **YAML 을 실제로 파싱해 스텝이 `build` 잡에 들어갔는지 본다.** 파서가 없으면 잡별 스텝 이름을 순서대로 뽑아 새 스텝이 `Build` 뒤·`Export JUnit report` 앞에 있는지 확인한다.

기존 `Export JUnit report` 스텝 위의 주석(`# "우리 도구로 우리를 검증한다" 의 마지막 한 칸이다`)이 **새 스텝에 딸려 가지 않게** 한다. 새 스텝은 그 주석 **위**에 들어간다.

- [ ] **Step 8: 사람에게 넘긴다 (커밋 둘)**

Task 3b 는 **소유 패키지가 걸친다** — `mock` 안의 스크립트·테스트와 `ci` 의 워크플로다. 커밋을 둘로 나눈다.

```
test(mock): 빌드 산출물의 중계기 bin 경로를 dist E2E 로 고정한다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```
변경 파일: `packages/mock/tests/dist-relay-bin-e2e.mjs` · `packages/mock/package.json`

```
ci: mock 의 dist E2E 를 build 잡에서 돌린다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```
변경 파일: `.github/workflows/ci.yml`

---

### Task 4: ADR-B 를 쓴다

**Files:**
- Create: `docs/adr/0103-중계기-기록-줄이-응답-본문을-싣는다.md`
- Modify: `docs/adr/README.md` (색인 표에 한 줄)

**Interfaces:**
- Consumes: Task 1·2 에서 내린 판단
- Produces: 없음 (문서)

**README 색인을 같이 갱신한다.** `docs/adr/README.md:8-9` 가 "ADR 을 추가하면 이 표에 한 줄을 더하고, 파일 머리의 상태가 바뀌면 표의 상태도 함께 갱신합니다" 로 정하고 있고 0101·0102 가 실제로 표에 들어가 있다(`:113-114`). 처음 계획서가 이것을 빠뜨렸다 — 작업 중 발견해 더했다.

**T2 의 ADR-A(0104)도 같은 표에 줄을 더한다.** 두 태스크가 동시에 이 파일을 만지면 충돌하므로, T1 의 0103 줄을 **먼저** 넣고 T2 는 그 뒤에 붙인다.

**번호 확인:** origin/main 의 최대 ADR 번호는 **0100**, 로컬 최대는 **0102**(내 미푸시 커밋). behind 2 커밋은 `Version Packages` 릴리스 커밋 둘뿐이라 **ADR 을 더하지 않는다** — 충돌이 없다. 다음 빈 번호는 **0103**. T2 의 ADR-A 가 0104 를 받는다.

**리베이스를 먼저 한다면** 번호를 다시 확인하고 딴다:
```bash
cd /Users/cheonjamin/projects/mcptest && git fetch && git ls-tree -r --name-only origin/main -- docs/adr/ | grep -oE '[0-9]{4}' | sort -n | tail -1
```

- [ ] **Step 1: ADR 초안을 쓴다**

다섯 항목 — 배경 / 선택지 / 결정 / 이유 / 결과. 한 페이지면 충분하다. 담을 내용:

- **배경:** 4 단계는 사용자에게 자기 서버의 **실물 응답**을 보여준다. AI 경유로는 `structuredContent` 가 오지 않는다(설계 §3 실측: `convert_units` 가 중계기 기준 174 바이트인데 `tool_result` 로 온 것은 `content` 텍스트 49 자뿐, `tool_result.content` 의 모양도 블록 배열/맨 문자열로 흔들린다). 스위트 단언 중 `structuredContentMatchesSchema` 6 건이 보는 값이 그것이라, AI 를 거치면 사용자가 자기 서버 답의 반쪽만 본다.
- **선택지:** ① AI 의 `tool_result` 를 화면에 쓴다 ② 중계기가 본문을 기록 줄에 싣는다 ③ 대시보드가 서버에 따로 한 번 더 붙어 값을 다시 받는다.
- **결정:** ②. `--json` 줄에만 싣고, **사람이 읽는 줄에는 싣지 않으며, 자르지 않는다.**
- **이유:** ①은 실측으로 반쪽만 온다. ③은 같은 입력에 두 번 호출해 상태를 가진 서버에서 결과가 갈리고, "화면의 값은 판정이 본 것과 같다" 가 깨진다. 사람 줄을 뺀 것은 터미널로 중계기를 쓰는 사람의 화면이 10MB 로 터지면 안 되기 때문이고, 자르지 않는 것은 관찰 채널의 충실성이 먼저이기 때문이다 — 접는 것은 화면이 한다.
- **결과:** `RelayResponseEvent` 의 `ok`·`toolError` 에 `body` 가 필수로 생긴다. `protocolError` 에는 없다(서버가 결과를 준 적이 없다). `--json` 줄의 크기 상한이 사라져 대시보드가 SSE 로 큰 줄을 나를 수 있어야 한다(T3 의 제약). 꼬리표(`case`)도 같은 규칙을 따른다 — JSON 줄에만, 사람 줄은 불변.

- [ ] **Step 2: 사람에게 넘긴다**

```
docs(adr): 중계기 기록 줄이 응답 본문을 싣는 결정을 남긴다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

변경 파일: `docs/adr/0103-중계기-기록-줄이-응답-본문을-싣는다.md`

**주의:** CI 의 `changes` 잡은 `docs/adr/**` 를 **코드로 센다** — 이 커밋만 있어도 verify·e2e·build 가 전부 돈다.

---

## 미결 — 남은 것 하나

### ① 테스트 6 의 존재 확인 — **닫혔다 (2026-09-21 사용자 승인)**

CI 스텝을 넣는다. **Task 3b** 가 그 일이다: `packages/mock/tests/dist-relay-bin-e2e.mjs` + `package.json` 의 `test:e2e` + `.github/workflows/ci.yml` 의 `build` 잡 스텝 하나. 워크플로 커밋은 scope `ci` 로 따로 나간다.

<details>
<summary>판단의 배경 (기록용)</summary>

### 테스트 6 의 「파일이 실제로 있다」를 어디서 확인하나

설계 §6 의 테스트 6 은 "`relayBinPath()` 가 가리키는 파일이 **실제로 있다**" 다. 그런데 `pnpm test` 는 루트 `vitest run` 이고 **turbo 를 지나지 않아 빌드 의존이 없다.** 존재 확인을 vitest 에 넣으면 clean checkout 에서 이유 없이 빨개지고, 반대로 `existsSync` 를 조건부로 건너뛰면 "0 건이라 깨끗해 보임" 이 된다.

Task 3 은 vitest 쪽을 **매니페스트 합의**로 고정하고(빌드 무관), 존재 확인은 Step 5 에서 **손으로** 돌리게 해 뒀다. 이것을 CI 에 박으려면 둘이 필요하다:

- `packages/mock/package.json` 에 `test:e2e` 스크립트 추가 (패키지 안이라 T1 범위)
- `.github/workflows/ci.yml` 의 `build` 잡에 스텝 한 줄 — `pnpm --filter @mcpeak/mock test:e2e`. `cli`·`record` 가 이미 같은 모양으로 있다.

**후자는 `mock` 패키지 밖이다.** scope 는 `ci` 이고 소유 패키지가 없는 작업이라 별도 커밋이 된다. **권장:** Task 3 뒤에 `ci(mock)` … 이 아니라 `ci:` 스코프 커밋 하나로 붙인다. 다만 「한 번에 한 패키지」와 「남의 영역」에 걸리는 판단이라 진행 전에 확인받는다.

넣지 않기로 하면, `relay.mjs` 가 빌드 산출물에서 사라져도 아무 테스트가 안 잡는다 — 대시보드가 런타임에 `ENOENT` 로 깨지는 것이 첫 신호가 된다.

</details>

### ② 리베이스를 먼저 하나

로컬 `main` 이 `origin/main` 대비 **ahead 21 / behind 2** 다. behind 2 는 `Version Packages` 릴리스 커밋 둘이고 `packages/mock` · `docs/adr` 를 **건드리지 않는다**(`git diff --stat main...origin/main -- packages/mock docs/adr` 가 빈 출력). 즉 이 계획서를 리베이스 **전에** 진행해도 충돌하는 파일이 없고, ADR 번호도 겹치지 않는다.

다만 릴리스 커밋이 버전을 올렸으므로 changeset 판단(Task 3 Step 8)이 리베이스 전후로 달라질 수 있다. **리베이스는 사람이 한다** — `git rebase` 를 실행하지 않는다.

---

## 인접 태스크 — 이 계획서 범위 밖

- **T2 · `generate`** — `export { runProviderProcess }` 한 줄 + ADR-A(0104). 별도 계획서.
- **T3 · `dashboard`** — 통로 셋(`POST /api/relay` · SSE · `DELETE`) · 화면 · 테스트 7–12. 별도 계획서. 시작 전에 알아둘 것 둘:
  - `packages/dashboard/package.json` 에 `@mcpeak/mock` 의존이 **아직 없다.** T3 가 더한다. 의존 방향(`dashboard` → … → `core`)에는 맞다.
  - 설계 §5 의 두 번째 실측(`--tools ""` 를 유지한 채 MCP 툴이 사는지)이 **아직 열려 있다.**
  - 대시보드 web 테스트 **81 건이 이미 깨져 있다**(jsdom `localStorage.clear is not a function`). 중계기 작업과 무관하다. T3 시작 전에 기준선을 찍어 둔다.
