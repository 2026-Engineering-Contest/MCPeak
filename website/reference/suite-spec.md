# Suite spec

This document lists every field of the JSON suite that `mcpeak test` reads, with its type. For how
to write one, see [writing suites](/guide/writing-suites).

## Suite

```json
{
  "schemaVersion": 1,
  "id": "weather",
  "name": "날씨 서버",
  "approval": { "fingerprint": "…", "cases": [] },
  "defaultTimeoutMs": 10000,
  "cases": []
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `schemaVersion` | `1` | yes | The suite format version. Any other value gives `UNSUPPORTED_SCHEMA_VERSION` |
| `id` | string | yes | The suite identifier |
| `name` | string | yes | Printed on the first line of the report |
| `approval` | object | no | The approval block attached by `generate`. Absent from a hand written suite |
| `defaultTimeoutMs` | number | no | The default time limit for a case. 10 seconds if absent |
| `cases` | array | yes | One or more. Empty gives `EMPTY_CASES` |

A field not on this list is rejected with `UNKNOWN_FIELD`, so a typo does not get silently ignored.

### `approval`

| Field | Type | Meaning |
|---|---|---|
| `fingerprint` | string | A digest of the suite at the time it was approved. 64 lowercase hex characters. Computed from the parsed object, so it is unaffected by indentation or key order. `approval` itself is excluded from the computation |
| `cases[]` | `{ id, status }` | The classification from the dry run. `status` is either `passed` or `serverDefect` |

## Case

```json
{
  "id": "seoul-succeeds",
  "name": "서울 날씨를 정상 조회한다",
  "timeoutMs": 5000,
  "operation": { "type": "callTool", "tool": "get_weather", "input": { "city": "서울" } },
  "assertions": [{ "type": "isError", "expected": false }]
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Unique within the suite. A duplicate gives `DUPLICATE_CASE_ID` |
| `name` | string | yes | Printed on the case's line in the report |
| `timeoutMs` | number | no | The time limit for this case. Takes priority over `defaultTimeoutMs` |
| `operation` | object | yes | One of the two forms below |
| `assertions` | array | yes | One or more. Empty gives `EMPTY_ASSERTIONS` |

## Operation

| `type` | Other fields | Meaning |
|---|---|---|
| `listTools` | none | Calls the server's `tools/list` |
| `callTool` | `tool: string`, `input: object` | Calls a tool with that input. `input` must be a JSON object |

## Assertion

Each operation has a fixed set of assertions it can take. A mismatch gives `INCOMPATIBLE_ASSERTION`.

| `type` | Operation | Other fields | Meaning |
|---|---|---|---|
| `toolExists` | `listTools` | `tool: string` | A tool with that name is in the list |
| `isError` | `callTool` | `expected: boolean` | The response's `isError` equals that value |
| `bodyMatchesSchema` | `callTool` | `schema` | The response's text body (parsed as JSON if it is JSON) matches the schema |
| `structuredContentMatchesSchema` | `callTool` | `schema` | The response's `structuredContent` matches the schema |

## Response schema

The subset of JSON Schema accepted by the two schema assertions. A keyword outside this list is
rejected with `UNSUPPORTED_SCHEMA_KEYWORD`.

| Keyword | Type | Meaning |
|---|---|---|
| `type` | `object` / `array` / `string` / `number` / `integer` / `boolean` / `null` | The value's type. Only one |
| `const` | JSON value | Exactly this value |
| `enum` | array of JSON values | One of these |
| `required` | string[] | Properties that must be present |
| `properties` | schema map | The schema for each property |
| `additionalProperties` | boolean or schema | If `false`, rejects fields outside `properties` |
| `items` | schema | The schema for array elements |
| `minItems` | number | Minimum array length |
| `minLength` / `maxLength` | number | String length |
| `stringContains` | string | The string contains this substring. Not a standard keyword |
| `minimum` / `maximum` | number | Numeric range |

A keyword whose meaning depends on the type must be accompanied by that `type`. `minLength` with no
`type` gives `SCHEMA_KEYWORD_REQUIRES_TYPE`.

## Validation errors

If the suite is malformed, the run stops before the server is started, and each problem is reported
with a code, path, message, and hint.

| Code | Meaning |
|---|---|
| `MISSING_REQUIRED_FIELD` | A required field is missing |
| `UNKNOWN_FIELD` | A field outside the list is present |
| `UNSUPPORTED_SCHEMA_VERSION` | `schemaVersion` is not 1 |
| `INVALID_TYPE` / `INVALID_VALUE` | A field's type or value is wrong |
| `DUPLICATE_CASE_ID` | A case `id` is duplicated |
| `EMPTY_CASES` / `EMPTY_ASSERTIONS` | An array is empty |
| `INCOMPATIBLE_ASSERTION` | An assertion does not match its operation |
| `INVALID_JSON_VALUE` | `input`, `const`, or `enum` holds a non JSON value |
| `INVALID_TIMEOUT` | The time limit is not a positive integer |
| `UNSUPPORTED_SCHEMA_KEYWORD` | The response schema has an unsupported keyword |
| `SCHEMA_KEYWORD_REQUIRES_TYPE` | A keyword is missing the `type` it requires |

## TypeScript types

`@mcpeak/runner` exports the same format as `TestSuiteSpec`. `defineMcpSuite` validates while
preserving literal types, and `validateMcpSuite` validates external JSON and returns either
`{ valid, value }` or `{ valid, issues }`.
