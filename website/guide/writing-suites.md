# Writing a Suite

After this page you know which operations and assertions you can write in a case, and you can
read what the terminal tells you when one fails. For the exact type of each field, see the
[suite format](/reference/suite-spec).

## Suite structure

A suite file holds one suite. A suite contains several cases, and cases run in the order they
appear in the suite.

```json
{
  "schemaVersion": 1,
  "id": "weather",
  "name": "날씨 서버",
  "defaultTimeoutMs": 10000,
  "cases": []
}
```

`id` is the name that refers to the suite within the file, and `name` is printed on the first
line of the report. `defaultTimeoutMs` is the time limit used when a case doesn't set its own
`timeoutMs`. If neither is set, it defaults to 10 seconds.

## Two kinds of operations

A case's `operation` states what to ask the server. There are two kinds.

| `operation.type` | What it does | Assertions you can use |
|---|---|---|
| `listTools` | Calls the server's `tools/list` | `toolExists` |
| `callTool` | Calls `tool` with `input` | `isError`, `bodyMatchesSchema`, `structuredContentMatchesSchema` |

Writing an assertion that doesn't match the operation is rejected before execution with
`INCOMPATIBLE_ASSERTION`, for example attaching `isError` to a `listTools` operation.

## Assertions

### `toolExists`

Checks whether the server advertises a tool with that name.

```json
{ "type": "toolExists", "tool": "get_weather" }
```

On failure, it also states what tools were found. This one line is enough to catch a typo.

```
toolExists  툴 'get_weater'을(를) 찾을 수 없습니다. 발견된 툴: 'add', 'get_weather'
해결: 서버의 tools/list 응답과 테스트 명세를 확인하세요.
```

### `isError`

Checks whether the response is an error or a success. `expected: false` expects a successful
response, and `expected: true` expects a rejection.

```json
{ "type": "isError", "expected": true }
```

A case that expects a rejection validates the server's failure path: whether the server rejects a
request that omits a required field or supplies the wrong type, instead of simply crashing. On
failure, it shows the body of what the server actually returned.

```
✗ add-missing-a  add가 필수 필드 'a' 누락을 거절한다
    isError  오류 응답을 기대했지만 정상 응답을 받았습니다.
    → {"sum":null}
    해결: 툴 입력값과 서버의 오류 응답을 확인하세요.
```

### `bodyMatchesSchema`

Matches the response body against a subset of JSON Schema. The body is extracted from the
response's text block. If the text parses as JSON, that value is the match target; otherwise the
raw string is used.

```json
{
  "type": "bodyMatchesSchema",
  "schema": {
    "type": "object",
    "required": ["temp"],
    "properties": { "temp": { "type": "number" } }
  }
}
```

The failure message states which path diverges and how, along with the number of violations. A
typical case is a server that renamed a field.

```
bodyMatchesSchema  응답이 기대 스키마와 다릅니다. 위반 1건.
    $: 필수 필드가 없습니다. 발견된 필드: 'temperature'
    해결: 스키마 변경이 의도된 것이라면 테스트를 업데이트하세요.
```

If the type differs, it states the expected type and the actual value; if a value falls outside
an `enum`, it states the allowed list and the actual value, in the same place.

### `structuredContentMatchesSchema`

Matches the same schema subset against `structuredContent`. For a tool whose server declares an
`outputSchema`, the response carries a structured value separately, and this checks that spot. It
doesn't touch the text body extraction rule. When `generate` finds an `outputSchema`, it saves
this assertion along with the suite, so that even if the server later changes both its
declaration and its response, the check still runs against the output contract as it stood when
saved.

## Schema subset

The two schema assertions accept a fixed set of keywords. A keyword outside that list is rejected
before execution with `UNSUPPORTED_SCHEMA_KEYWORD`, so that a check doesn't silently get skipped
while the case still turns green.

| Category | Keywords |
|---|---|
| Type and value | `type`, `const`, `enum` |
| Object | `required`, `properties`, `additionalProperties` |
| Array | `items`, `minItems` |
| String | `minLength`, `maxLength`, `stringContains` |
| Number | `minimum`, `maximum` |

`stringContains` is not part of standard JSON Schema; it's specific to this tool. Use it to check
whether an error message contains a particular word.

## Reviewing only the failed cases

The end of the report has a list that collects just the failed cases, so you don't have to scroll
back up when there are many cases.

```
실패한 케이스
  ✗ add-missing-a  → {"sum":null}
  ✗ add-missing-b  → {"sum":null}

6 passed, 2 failed  (8 total)
```

## Rejection basis warning

Even when a case that expects a rejection passes, a line like this can still be attached.

```
→ 거절을 기대한 케이스 6건은 거절 근거를 확인하지 못했습니다.
  서버가 거절한 것인지 다른 이유로 실패한 것인지 이 도구는 판단하지 못합니다.
  확인: mcpeak generate 의 승인 화면에서 해당 케이스의 응답을 확인하세요.
```

`isError: true` only says the response was an error. Whether that error is a rejection from input
validation or the server crashing for another reason can only be told from the error message. The
tool recognizes the SDK's input validation prefixes (such as `MCP error -32602:`), but it doesn't
recognize a rejection message the server writes itself. So it recommends checking without
changing the verdict. This warning always appears for servers that write their own rejection
messages, and for mock servers.

## Writing in TypeScript

To keep a suite as code instead of JSON, use `defineMcpSuite` from `@mcpeak/runner`. It preserves
literal types while also running runtime validation. To only validate JSON received from outside,
use `validateMcpSuite`.

```ts
import { defineMcpSuite } from "@mcpeak/runner";

export const suite = defineMcpSuite({
  schemaVersion: 1,
  id: "weather",
  name: "날씨 서버",
  cases: [
    {
      id: "tool-exists",
      name: "get_weather 도구를 제공한다",
      operation: { type: "listTools" },
      assertions: [{ type: "toolExists", tool: "get_weather" }],
    },
  ],
});
```

`mcpeak test` currently only accepts a single UTF-8 JSON file. A TypeScript suite is used on the
path where you call `runSuite` directly.

## What to read next

- [Generating a suite](/guide/generate): builds these cases automatically from a schema.
- [Suite format](/reference/suite-spec): the type of each field and the validation error codes.
- [Checking determinism](/guide/determinism): runs the same suite twice to check the results match.
