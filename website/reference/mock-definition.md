# Mock definition

This document lists the fields of the definition file that `mcpeak-mock` reads. The matching rules
and the design first workflow are covered in [mock server](/guide/mock-server).

```json
{
  "tools": [
    {
      "name": "get_weather",
      "description": "도시의 현재 날씨",
      "inputSchema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "responses": [
    { "tool": "get_weather", "args": { "city": "서울" }, "result": { "tempC": 21 } },
    { "tool": "get_weather", "args": { "city": "없는도시" },
      "result": "→ '없는도시' 는 모르는 도시입니다", "isError": true },
    { "tool": "get_weather", "result": { "tempC": 0 } }
  ]
}
```

## `tools[]`

The tools advertised through `tools/list`. A tool not listed here cannot be used in `responses`
either.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `name` | string | yes | The tool name |
| `description` | string | no | The description a client reads when choosing the tool |
| `inputSchema` | JSON Schema | yes | The argument schema. Advertised as is and also used to check arguments |

`inputSchema` is emitted exactly as given, as JSON Schema. There is no Zod conversion.

## `responses[]`

| Field | Type | Required | Meaning |
|---|---|---|---|
| `tool` | string | yes | A name present in `tools`. If not, the definition is rejected when it is read |
| `args` | JSON object | no | The response to give when called with these arguments. If omitted, any arguments that pass the schema are accepted |
| `result` | JSON value | yes | The response payload. The mock wraps it as `content: [{ type: "text", … }]` |
| `isError` | boolean | no | If `true`, this response is a rejection. Omitting it is the same as `false` |

`responses` itself can be omitted. Every call then falls through as a match miss, and an
`isError: true` response is returned stating what is registered.

## When the definition is malformed

```
→ 올바르지 않은 목 정의입니다 — weather.mock.json: responses[0] 의 툴 '없는툴' 이 tools 에 없습니다. 있는 툴: get_weather, add
→ 형식: { "tools": [ { "name": ..., "inputSchema": ... } ], "responses": [ { "tool": ..., "result": ... } ] }
```

What is checked:

- `tools` is an array, and each entry has a string `name` and an `inputSchema`.
- If `responses` is present, it is an array, each entry has a string `tool` and a `result`, and
  `isError`, if present, is a boolean.
- `responses[].tool` is present in `tools`.

## Arguments that cannot be turned into a key

The following `args` values are rejected when the definition is read. Since an MCP call arrives as
JSON, none of these values can ever be reached by any call, and leaving them in would make the
injection look like it succeeded while it never matches.

| Value | Example |
|---|---|
| Circular reference | `o.self = o` |
| Sparse array | `[1, , 3]` |
| `NaN` / `Infinity` | `{ n: NaN }` |
| Non JSON value | `Date`, function, symbol, `BigInt`, `Map` |

The nesting depth limit is 512. If a call's arguments exceed it, the server reports `isError: true`
instead of being killed.

## Validating in code

```ts
import { assertMockDefinition } from "@mcpeak/mock";

assertMockDefinition(JSON.parse(text), "weather.mock.json");
```

The second argument is the source name used in the error message.
