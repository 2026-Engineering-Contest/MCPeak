# Mock Server

After this page you can start a mock server from a single definition file, without a real MCP
server, and run `mcpeak test` against it, and you know the procedure for validating a design
before building the server. For the fields of a definition file, see the
[mock definition format](/reference/mock-definition).

## When to use a mock versus a session

Both replace something real with something fake, but at a different layer.

```
[mcpeak] ──(1)── [MCP server] ──(2)── [external API]
             ↑                            ↑
      a mock stands in here     an External session stands in here
```

| | What it replaces | When |
|---|---|---|
| Mock | The MCP server itself | The server doesn't exist yet; you're testing the client side |
| [External session](/guide/external-sessions) | The external API the server calls | The server runs for real; only its outbound network calls are removed |

Testing your own server with a mock just checks that the answer you wrote comes back, which is
circular. Don't use a mock in the place where you validate a finished server.

## Installation

```bash
npm install -g @mcpeak/mock
```

This gives you the `mcpeak-mock` command. Installing `@mcpeak/cli` doesn't bring this command
along.

## Starting from a definition file

Write the tool schemas and responses as JSON.

```json
{
  "tools": [
    {
      "name": "get_weather",
      "inputSchema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "responses": [
    { "tool": "get_weather", "args": { "city": "서울" }, "result": { "tempC": 21 } },
    { "tool": "get_weather", "result": { "tempC": 0 } }
  ]
}
```

Point `mcpeak test` at it.

```bash
mcpeak test suite.json -- mcpeak-mock weather.mock.json
```

The process is the server, so you can't inject responses while it's running; they have to be
written into the definition file up front. `result` is the payload, not the MCP wire format. The
mock does the `content: [{ type: "text", … }]` wrapping itself. The same call always returns the
same bytes.

## Response matching rules

1. A response with specified arguments takes priority, ahead of the schema check.
2. If none matches, the arguments are checked against `inputSchema`. A violation is rejected with
   `isError: true`.
3. If the check passes, an entry that omits `args` handles the call.
4. If there's no such entry either, it rejects with `isError: true` and states what is
   registered.

The match key isn't affected by object key order. `{a:1,b:2}` and `{b:2,a:1}` find the same
response.

Omitting `args` is convenient, but it lets any arguments the schema allows pass through.
Specifying arguments is the default; treat omission as the exception.

### Argument checking

Matches the `inputSchema` advertised through `tools/list` against the actual call. It checks four
axes on top level fields.

| Axis | Example violation |
|---|---|
| `required` | Not sending `city` |
| `type` | `{ "city": 0 }` |
| `enum` | `{ "unit": "k" }` |
| `range` (`minimum`, `maximum`, `minLength`, `maxItems`, etc.) | `{ "days": 99 }` |

```
→ 툴 'get_weather' 의 'city' 은(는) string 이어야 합니다. 받은 값: 0 (number)
→ 이 툴이 tools/list 로 선언한 inputSchema 가 그렇게 요구합니다.
→ 거절이 의도한 것이면 responses 에 이 인자를 넣어 응답을 지정하세요.
```

It doesn't check inside nested objects or array elements, or `additionalProperties`. If a
combinator such as `anyOf` or an array-form `type` is present, it skips that tool (when the
combinator is at the root) or just that field; when a whole tool is skipped, it's reported once
to stderr when the server starts.

### Injecting a rejection response

Failure is half the contract too. Attach `isError: true` and the mock rejects with the sentence
you wrote.

```json
{ "tool": "get_weather", "args": { "city": "없는도시" },
  "result": "→ '없는도시' 는 모르는 도시입니다. 아는 도시: 서울, 부산, 제주",
  "isError": true }
```

An injected rejection, a schema violation, and a match miss are all `isError: true`, but the body
differs. The latter two are diagnostic sentences the mock writes itself; only the first is a
designed statement that says this is how the server rejects.

## Design-first workflow

Validating a design before building the server is the main use of a mock. It starts from zero
lines of implementation and ends with a contract to hand to the implementer.

```
① design ──→ ② try it ──→ ③ suite ──→ ( implement ) ──→ ④ verdict
definition   attach to a    generate the                  run the same
file         real client    contract draft                suite on the real server
```

### 1. Write the definition file

Write the tool schemas and the expected responses, including the failure responses.

### 2. Attach a real client

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

Add this to your Claude Desktop configuration as shown. The path must be absolute, since there's
no way to know which directory the client will launch from.

What to watch here isn't the response content: you wrote it, so there's nothing to see there.
What to watch is how the client handles your schema. If `description` is thin, the client picks
this tool at the wrong moment, or never picks it at all. Also check whether it fills in arguments
correctly just from the field names, and whether the error message you wrote actually helps the
user when it hits a rejection. All three are matters of changing a schema or a sentence, which is
cheapest before implementation.

### 3. Pull a draft contract from the mock

```bash
mcpeak generate --out contract.suite.json --baseline-only -- mcpeak-mock weather.mock.json
```

This suite is the draft contract you hand to the implementer. It contains one passing case and
the violation cases.

::: warning If the passing case fails, there's no entry that omits `args`
`generate` synthesizes a valid input from the schema, so you get a value like
`{ "city": "example" }`. If you only wrote `"서울"`, that call isn't in the table.

```
✗ get-weather-success  get_weather가 오류 없이 응답한다
    → 툴 'get_weather' 을(를) 인자 {"city":"example"} 로 호출했지만 주입된 응답이 없습니다.
    → 이 툴에 주입된 인자: {"city":"서울"}, {"city":"없는도시"}
```

Add one entry that omits `args`. A violating call still gets rejected as before, since that entry
is only reached after the schema check, so it never receives violating arguments.
:::

### 4. Run the same suite against the real server

```bash
mcpeak test contract.suite.json -- node ./server.mjs
```

Passing here proves the implementation kept the design contract. A green result on the mock
doesn't mean the implementation is correct; it's just the result of running the same suite
against an example server.

| | Result |
|---|---|
| Mock | `3 passed` |
| Real server (`examples/weather-server`) | `2 passed, 1 failed` |

The real server only knows Seoul, Busan, and Jeju, but the synthesized input was `"example"`, so
the passing case broke. The mock was green because its omit-args entry caught everything. Green
through step 3 is only a check against the mock; the contract verdict comes from step 4.

## The warning that always appears on a mock

The `거절 근거를 확인하지 못했습니다` warning always appears on a mock. The runner tells whether
a rejection came from the SDK's input validation by the prefix of the error message, and the
mock's rejection message isn't in that list. The case still passes, and only the warning is
attached.

## Starting over HTTP from code

When testing an external program that uses MCP, start a Streamable HTTP mock as a library. You
need to install it in the project for `import` to work; a global install only places the
executable.

```bash
npm install --save-dev @mcpeak/mock
```

```ts
import { ANY, createMockServer } from "@mcpeak/mock";

const mock = await createMockServer({ tools });
mock.on("add", { a: 1, b: 2 }, { sum: 3 });
mock.on("add", ANY, { sum: 0 });

console.log(mock.url); // http://127.0.0.1:53211/mcp

await mock.close();
```

The HTTP mock starts stateless. If it were stateful, the SDK would generate a session ID with
`randomUUID()`, which breaks determinism. The default port is 0, so an open port is assigned
automatically.
