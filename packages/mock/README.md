**English** · [한국어](./README.ko.md)

# @mcpeak/mock

A mock MCP server with response injection. It starts over either **Streamable HTTP** or **stdio**.

- **Owner:** `@storyrago` (③ mock server part)
- **Depends on:** `@mcpeak/core` · `@modelcontextprotocol/sdk` (catalog, pinned to 1.x)

It is for testing programs that use MCP without a real MCP server.
You can set up exactly the situation you want, with no external API keys and no real data.

**To validate a design before building the server** → [Design-first workflow](#design-first-workflow)

## Which one to use

| | Target | Response injection |
|---|---|---|
| **HTTP** `createMockServer` | **External programs** that use MCP | With `on()` after starting |
| **stdio** `mcpeak-mock` | **Our own tool** (`mcpeak test`) | Up front, in the definition file |

`core.connect()` understands HTTP too (ADR-0020). The split comes from the CLI: `mcpeak test`
hardcodes `core.connectStdio` and has no `--url` (`packages/cli/src/index.ts:132`·`234`).
See ADR-0007 for the full background.

### When an External session fits instead of a mock

Both "replace the real thing with a fake", but **they replace different layers.** Mix them up and you end up setting up the wrong one.

| | What it replaces | When |
|---|---|---|
| **`mock`** | The MCP **server itself** | The server doesn't exist yet · you're testing the side that uses the server |
| **External session**<br>`mcpeak test --record-session` | The **external API** the server calls | The server runs for real; you only want to remove the network calls it makes outward |

```
[우리 도구] ──(1)── [MCP 서버] ──(2)── [외부 API]
              ↑                          ↑
          mock 이 대신함            External 세션이 대신함
```

> `[our tool] ──(1)── [MCP server] ──(2)── [external API]` — a mock stands in at (1), an External session stands in at (2).

**Recording a mock with an External session yields zero recorded calls.** A mock only returns the
responses written in its definition file and has no code that reaches out (0 HTTP client calls in `src/`). A session file
is created, but it blocks no calls, and the tool tells you so (ADR-0057).

An External session is for when the server code has to actually run, but that server calls a paid API or an endpoint
with side effects.

Sessions belong to `@mcpeak/record`. See `mcpeak help test` and that package's README.

## HTTP — for external programs

This path calls it as a library, so you **must install it in your project**. A global install (`npm i -g`) only places
the executable, so `import` breaks with `ERR_MODULE_NOT_FOUND`.

```bash
npm install --save-dev @mcpeak/mock
```

```ts
import { ANY, createMockServer } from "@mcpeak/mock";

const mock = await createMockServer({ tools });      // tools: ToolDef[]
mock.on("add", { a: 1, b: 2 }, { sum: 3 });          // 인자를 지정
mock.on("add", ANY, { sum: 0 });                     // 나머지 전부

console.log(mock.url);   // http://127.0.0.1:53211/mcp
// ...테스트 대상 프로그램을 이 주소에 연결한다...

await mock.close();
```

> Comments: `인자를 지정` = specific arguments; `나머지 전부` = everything else; `테스트 대상 프로그램을 이 주소에 연결한다` = connect the program under test to this address.

## stdio — for our tool

Write a definition file,

```json
{
  "tools": [
    { "name": "add", "inputSchema": { "type": "object", "properties": { "a": { "type": "number" }, "b": { "type": "number" } } } }
  ],
  "responses": [
    { "tool": "add", "args": { "a": 1, "b": 2 }, "result": { "sum": 3 } },
    { "tool": "add", "result": { "sum": 0 } }
  ]
}
```

and point `mcpeak test` at it.

```bash
mcpeak test suite.json --command mcpeak-mock --arg definition.json
```

The process is the server, so you can't inject responses while it's running. That's why they are written into the definition file up front.

## Design-first workflow

**Validating a design before building the MCP server** is the main use of a mock. It starts from zero lines of
implementation and ends with a contract to hand to the implementer.

```
① 설계 ──→ ② 체험 ──→ ③ 명세 ──→ ( 구현 ) ──→ ④ 판정
정의 파일   실제         suite 생성                 같은 suite 를
JSON       클라이언트에   (계약 초안)                실물 서버에
           붙여본다
```

> ① design (definition file JSON) ──→ ② try it (attach to a real client) ──→ ③ suite (generate a suite, the contract draft) ──→ ( implement ) ──→ ④ verdict (run the same suite on the real server)

### ① Design — write the definition file

Write the tool schemas and the expected responses. Write the failure responses too — **failure UX is half the contract.**

```json
{
  "tools": [
    { "name": "get_weather",
      "inputSchema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      } }
  ],
  "responses": [
    { "tool": "get_weather", "args": { "city": "서울" },
      "result": { "city": "서울", "temp": 21, "condition": "맑음" } },
    { "tool": "get_weather", "args": { "city": "없는도시" },
      "result": "→ '없는도시' 는 모르는 도시입니다. 아는 도시: 서울, 부산, 제주",
      "isError": true }
  ]
}
```

### ② Try it — attach a real client

```json
{
  "mcpServers": {
    "weather-design": {
      "command": "mcpeak-mock",
      "args": ["/절대/경로/weather.mock.json"]
    }
  }
}
```

Add this to your Claude Desktop configuration as shown. **The path must be absolute** — there's no way to know which
directory the client will launch from.

What to watch here **isn't the response content.** You wrote the responses, so there's nothing to see there. What you need to watch is
**how the client handles your schema.**

- When it picks this tool — if `description` is thin, it picks it at the wrong moment or never picks it at all
- How it fills in arguments — whether it fills them correctly just from the field names
- What it says when it hits a rejection — whether the error message you wrote actually helps the user

**These three are expensive to fix after the server is built.** They are matters of changing a schema or a sentence, so they're cheapest before implementation.

### ③ Suite — pull a draft contract from the mock

```bash
mcpeak generate --suite-id weather --name "날씨 서버 계약" \
  --out contract.suite.json \
  --command mcpeak-mock --arg weather.mock.json --baseline-only
```

> **Note:** MCPeak's own messages are currently printed in Korean; English translations are shown alongside.

```
baseline suite를 저장했습니다: contract.suite.json
커버리지  1 tools, 3 axes 전부 검증
```

> Saved the baseline suite: contract.suite.json
> Coverage  1 tools, all 3 axes verified

This suite is **the draft contract you hand to the implementer.** It contains one passing case and the violation cases.

> ⚠️ **If the passing case fails, there's no `ANY` fallback.** `generate` synthesizes a valid input from the schema,
> so you get a value like `{ "city": "example" }`. If you only wrote `"서울"`, that call isn't
> in the table.
> ```
> ✗ get-weather-success  get_weather가 오류 없이 응답한다
>     → 툴 'get_weather' 을(를) 인자 {"city":"example"} 로 호출했지만 주입된 응답이 없습니다.
>     → 이 툴에 주입된 인자: {"city":"서울"}, {"city":"없는도시"}
> ```
> > ✗ get-weather-success  get_weather responds without an error
> > → Tool 'get_weather' was called with arguments {"city":"example"}, but no response was injected for it.
> > → Arguments injected for this tool: {"city":"서울"}, {"city":"없는도시"}
>
> Add one entry that omits `args` (= `ANY`). `ANY` doesn't catch violating arguments
> (see "Argument checking"), so the rejection cases keep working.

### ④ Verdict — the same suite against the real server

Once the implementation is done, run **the same file** against the real server. Passing proves the implementation kept the design contract.

```bash
mcpeak test contract.suite.json --command node --arg ./server.js
```

**Green on the mock doesn't mean the implementation is correct.** The actual result of running the same suite against the example server:

| | Result |
|---|---|
| Mock | `3 passed` |
| Real server (`examples/weather-server`) | `2 passed, 1 failed` |

The real server only knows Seoul, Busan, and Jeju, but the synthesized input was `"example"`, so the passing case broke. The mock was green because its `ANY`
fallback caught everything. **Green through ③ is "checked against the mock"; the contract verdict comes from ④.**

### Things to know

- **The `거절 근거를 확인하지 못했습니다` (could not confirm the grounds for rejection) warning always appears on a mock.** The `runner` tells whether a rejection came from the SDK's input
  validation by the prefix of the error message (`MCP error -32602:`, etc.), and the mock's rejection message
  isn't in that list. The case passes and only the warning is attached.
- **A mock is not how you actually use a finished MCP server.** A mock is for validating a design before implementation, and a stand-in for
  environments where the real server can't be attached (no external API key, responses that differ every time). Testing your own server with a mock is
  just checking that the answer you wrote comes back, which is circular — that's what `@mcpeak/record` does.

## Response matching rules

Both entry points use **the same rules.**

The same goes for injection time — a tool name not in `tools` is rejected on the spot, whether in a definition file or in `mock.on()`.
If a typo looked like a successful injection, you'd get no signal at all until a real call
fell through as a miss.

1. **A response with specified arguments takes priority.** Even ahead of the schema check.
2. If there's none, **the arguments are checked against `inputSchema`.** A violation is rejected with `isError: true`.
3. If the check passes, `ANY` (in a definition file, omitting `args`) handles it.
4. If there's no such entry either, it returns `isError: true` and states what is registered.

`ANY` is convenient, but it **lets a call with any arguments the schema allows pass.**
Specifying arguments is the default; use `ANY` as the exception.

`result` is not the MCP wire format but **the payload.** The mock does the `content: [{ type: "text", ... }]` wrapping.

### Argument checking

Matches the `inputSchema` advertised through `tools/list` against the actual call. It checks four axes **on top-level fields only**
([ADR-0048](../../docs/adr/0048-목이-inputSchema-를-실제로-검사한다.md)).

| Axis | Where in the schema | Example violation |
|---|---|---|
| `required` | `"required": ["city"]` | Not sending `city` |
| `type` | `{ "type": "string" }` | `{ "city": 0 }` |
| `enum` | `{ "enum": ["c", "f"] }` | `{ "unit": "k" }` |
| `range` | `minimum` · `maximum` · `exclusiveMinimum` · `exclusiveMaximum` · `minLength` · `maxLength` · `minItems` · `maxItems` | `{ "days": 99 }` |

```
→ 툴 'get_weather' 의 'city' 은(는) string 이어야 합니다. 받은 값: 0 (number)
→ 이 툴이 tools/list 로 선언한 inputSchema 가 그렇게 요구합니다.
→ 거절이 의도한 것이면 responses 에 이 인자를 넣어 응답을 지정하세요.
```

> → 'city' of tool 'get_weather' must be a string. Received: 0 (number)
> → The inputSchema this tool declared through tools/list requires it.
> → If the rejection is intended, add these arguments to responses and specify the response.

**To put an intended rejection into the design, inject a response for those specific arguments.** Rule 1 comes before rule 2, so this response wins.

```json
{ "tool": "get_weather", "args": { "city": 0 }, "result": "도시 이름이 잘못됐습니다" }
```

**Not checked:** the inside of nested objects and array elements, and `additionalProperties`. If a combinator
(`anyOf` · `oneOf` · `allOf` · `not` · `$ref` · `if`) or an array-form `type` is present, it is skipped — the whole tool
if it's at the root, just that field if it's on a field. When a whole tool is skipped, it's reported once to `stderr`
when the server starts.

```
→ 다음 툴은 inputSchema 를 해석할 수 없어 인자 검사를 건너뜁니다:
   'search' — 해석할 수 없는 키워드: anyOf
```

> → Argument checking is skipped for the following tools because their inputSchema can't be interpreted:
>    'search' — uninterpretable keyword: anyOf

### Injecting a rejection response

Failure is half the contract too. Attach `isError: true` and you can **reject with a sentence you chose.**

```json
{ "tool": "get_meeting", "args": { "id": "m-99" },
  "result": { "error": "→ 'm-99' 회의록이 없습니다" }, "isError": true }
```

In code, pass it as the fourth argument.

```ts
mock.on("get_meeting", { id: "m-99" }, { error: "→ 'm-99' 회의록이 없습니다" }, { isError: true });
```

Omit it and the response is a success. Stating `isError: false` explicitly is the same — it goes on the wire only when true.

**This is different from the `isError` of a match miss.**

| | When | Body |
|---|---|---|
| **Injected rejection** | Arguments declared with `isError: true` | The `result` you wrote |
| **Schema violation** | Arguments not in the table that violate `inputSchema` | A violation diagnostic the mock writes (`… 이어야 합니다`, "must be …") |
| **Match miss** | Arguments not in the table that satisfy the schema | A guidance message the mock writes (`주입된 응답이 없습니다`, "no response was injected") |

All three are `isError: true`, but **they're told apart by the body.** The latter two are "what the mock decided"; only the first is
a **design** that says "this is how the server rejects." If you want your own sentence instead of the violation diagnostic, write those arguments
into the table — matching rule 1 comes before rule 2.

### Arguments that can't be made into a key

The following are rejected at injection time. An MCP call arrives as JSON, so these are **values no call can ever
reach**; left in place, the injection looks like it succeeded but never matches, or ends up with the same key as another injection.

| Value | Example |
|---|---|
| Circular reference | `o.self = o` |
| Sparse array | `[1, , 3]` |
| `NaN` · `Infinity` | `{ n: NaN }` |
| Non-JSON value | `Date` · function · symbol · `BigInt` · `Map` |

`undefined` is not rejected — as an object property it's dropped, and as an array element it becomes `null`.

The nesting depth limit is 512. If a call's arguments exceed it, the server isn't killed; it reports this with an `isError: true`
response.

The rejection set is the same as `record`'s cassette matching key (ADR-0003). However, `record` hashes the key with SHA-256
and the mock doesn't — the mock's key isn't left in a file and is printed as is in failure messages.
See ADR-0029 for the background.

## Design notes

- **HTTP starts stateless.** `sessionIdGenerator: undefined`. If it were stateful, the SDK would
  generate a session ID with `randomUUID()`, breaking determinism. In exchange, stateless mode has to create a new
  `Server`/transport for every request (an SDK constraint).
- **The default port is 0.** An open port is assigned automatically. A fixed port fails when it's already
  taken and collides during parallel runs.
- **The matching key isn't affected by object key order.** `{a:1,b:2}` and `{b:2,a:1}` find the same
  response. Using `JSON.stringify` as is would follow insertion order and break determinism.
- **`ToolDef.inputSchema` goes out exactly as JSON Schema.** Because it uses the low-level `Server`,
  no Zod conversion is needed, and so there's no zod dependency either.
- **`src/stdio.ts` doesn't use top-level await.** The build also emits cjs, where
  it isn't supported. `packages/cli/src/cli.ts` has the same shape for the same reason.

## When it fails

The failure message is the product (CLAUDE.md).

**A call with no injected response**

```
→ 툴 'get_weather' 을(를) 인자 {"city":"제주"} 로 호출했지만 주입된 응답이 없습니다.
→ 이 툴에 주입된 인자: {"city":"서울"}
→ mock.on(툴이름, 인자, 응답) 의 인자가 호출과 일치하는지 확인하세요.
→ 인자를 가리지 않으려면 mock.on(툴이름, ANY, 응답) 을 쓰세요.
```

> → Tool 'get_weather' was called with arguments {"city":"제주"}, but no response was injected for it.
> → Arguments injected for this tool: {"city":"서울"}
> → Check that the arguments in mock.on(toolName, args, response) match the call.
> → To accept any arguments, use mock.on(toolName, ANY, response).

**The last two lines depend on the entry point.** If you started from a definition file, they point at that file instead of a nonexistent `mock.on`
— because the place to fix is different.

```
→ weather.mock.json 의 responses 에서 이 툴의 args 가 호출과 일치하는지 확인하세요.
→ 인자를 가리지 않으려면 그 항목에서 args 를 생략하세요.
```

> → Check that this tool's args in the responses of weather.mock.json match the call.
> → To accept any arguments, omit args in that entry.

**When the definition file is malformed**

```
→ 올바르지 않은 목 정의입니다 — weather.mock.json: responses[0] 의 툴 '없는툴' 이 tools 에 없습니다. 있는 툴: get_weather, add
→ 형식: { "tools": [ { "name": ..., "inputSchema": ... } ], "responses": [ { "tool": ..., "result": ... } ] }
```

> → Invalid mock definition — weather.mock.json: tool '없는툴' in responses[0] is not in tools. Available tools: get_weather, add
> → Format: { "tools": [ { "name": ..., "inputSchema": ... } ], "responses": [ { "tool": ..., "result": ... } ] }

You can also call `assertMockDefinition(value, source?)` directly to validate.

## Open questions

- Mock responses use **deterministic values a person specifies** (settled in ADR-0005). Schema-based random
  generation was dropped, and fixed-seed generation is on hold — it will be decided separately once demand for smoke tests
  of servers with many tools is actually confirmed.
- HTTP connections from the CLI — the `core.connect()` side is done (ADR-0020, #16). Once `mcpeak test` gets `--url`,
  our runner will attach to the HTTP mock too. For now the CLI is fixed to stdio
