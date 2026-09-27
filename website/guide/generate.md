# Generating a Suite

After this page you can generate and approve a suite from a server's tool schemas, and you know
how the approval fingerprint stamped on that suite is used afterward in `mcpeak test`.

## Generate in one line

```bash
mcpeak generate --out weather.suite.json -- node ./server.mjs
```

Everything after `--` is the command that starts the server, the same as with `test`. The suite's
`id` and `name` are derived from the `--out` filename (`weather` for `weather.suite.json`). To
set them directly, use `--suite-id` and `--name`.

## What it generates

The generator reads the server's `tools/list` and synthesizes cases for each tool: one successful
call, plus one rejection case for each axis defined by `inputSchema` that a violation can break.

```
baseline suite를 저장했습니다: weather.suite.json
커버리지  2 tools, 8 axes 전부 검증
```

For `get_weather` and `add` in `examples/weather-server`, eight cases result.

| Case | What it checks |
|---|---|
| `get-weather-success` | Calling with `{ "city": "…" }` gives `isError: false` |
| `get-weather-missing-city` | Rejects when the required `city` is omitted |
| `get-weather-type-city` | Rejects when `city` is given a number |
| `add-success`, `add-missing-a`, `add-missing-b`, `add-type-a`, `add-type-b` | The same rules for `add` |

The input for a passing case is picked from the schema, in this order: `const`, `default`,
`examples[0]`, `enum[0]`, then a fixed value per type. Objects get only their required
properties, and arrays get a single element. If a tool declares an `outputSchema`, the passing
case also gets a `structuredContentMatchesSchema` assertion.

The same tool definition and the same options produce the same suite. No value that depends on
execution order or time is included.

## Dry run and approval

In the default flow, generated cases run once against the real server before saving, so a person
can see whether the placeholder values picked from the schema actually work against the server. A
value that's valid by the schema but unknown to the server, such as `"city": "example"`, shows up
here as a failure.

Failed cases go to a triage screen, where a person decides whether to keep the failure as a
server defect or fix the input and retry. If an AI provider is configured, you can request a
suggested fix for a failed case, and only a suggestion you approve goes into the suite.

When you choose a provider and model in a TTY, the request is sent only after you review the
following.

1. Send approval. You decide whether to send after reviewing the provider, model, the size of
   the sanitized request, the timeout, and the fingerprint.
2. Change approval. You choose which changes to apply after reviewing the returned candidate and
   a locally computed diff.
3. Save approval. You confirm the final suite's fingerprint again before the file is written.

If you don't approve, the provider is never called. An actual Codex or Claude call uses your
account and incurs cost, so it isn't run in automated tests.

## Generating without AI

```bash
mcpeak generate --out weather.suite.json --baseline-only -- node ./server.mjs
```

`--baseline-only` is a non-interactive approval that never calls AI. It saves exactly what was
synthesized from the schema, with no dry run and no pre-fill. `--no-dry-run` skips only the dry
run. It never calls the server's tools, so use it for servers that have side effects.

## Fixtures

A placeholder value can easily turn out to be one the server doesn't know. Write a value that
points to a real resource into a fixture file. `mcpeak.fixtures.json` is found automatically; use
`--fixtures` for a different path.

```
▸ 픽스처: mcpeak.fixtures.json (도구 1개, 필드 1개)
```

A fixture value goes into the generated suite unchanged. Writing a token or password there leaves
it in the suite file, so pass credentials through the server's startup environment variables
(`--env`) instead, and put only the identifier of a resource reachable with that credential in
the fixture.

## Approval fingerprint

A saved suite carries an `approval` block.

```json
{
  "schemaVersion": 1,
  "id": "weather",
  "name": "weather",
  "approval": {
    "fingerprint": "992133b77bf8fe75234d5397b5810c0eaac0e5813b01750dde01a6b7723501c6",
    "cases": [{ "id": "get-weather-success", "status": "passed" }]
  },
  "defaultTimeoutMs": 10000,
  "cases": []
}
```

`fingerprint` is a 64 character hex digest that summarizes the suite as it stood at approval. It
summarizes the parsed suite object rather than the file's bytes, so the value stays the same if
you change indentation, line endings, or key order. The `approval` block itself is excluded from
the computation. `cases` records how each case was classified during the dry run.

The `--out` filename feeds into the fingerprint. If `id` and `name` were derived from the
filename, regenerating under a different filename changes the fingerprint and triggers
reapproval. To keep it fixed, set `--suite-id` and `--name` directly.

`mcpeak test` computes the fingerprint of the suite it runs, compares it against the value in the
file, and prints the result at the end of the report. This doesn't change the verdict; the exit
code is determined only by the case results.

```
명세: 승인 시점과 동일 (992133b77bf8…)
```

This line stays silent when everything passes and the fingerprint matches. Printing it every time
would be noise for someone who writes suites by hand, and noise means it goes unread exactly when
it matters. When everything passes but the fingerprint differs, it's always shown: that's a green
result on an unapproved suite, a case easier to miss than an outright failure.

## Regenerating

If a file already exists at the `--out` path, the save is refused. Add `--force` for an
intentional regeneration.

## Rejection basis diagnostics

Turning on `--diagnose-rejections` lists the responses of passing rejection cases, and if a
provider is configured, asks it for a reference opinion on whether each rejection comes from
input validation or an internal server error. Use it when you suspect the server is simply
crashing on bad input rather than actually rejecting it.

## Supported schema keywords

`type` (single value), `required`, `properties`, `items` (single schema), `enum`, `const`,
`default`, `examples`, range, length, and count constraints, some `format` values, `pattern` (an
ECMA-262 subset), `additionalProperties`, `propertyNames`, local `$ref`, `anyOf`, `oneOf`.

A tool that uses `allOf`, `not`, `if`, `patternProperties`, an array-form `type`, tuple `items`,
or a remote `$ref` is skipped, and the rest of the tools are still generated. A skipped tool is
reported in the output.

## What it doesn't generate

It doesn't generate anything the schema alone can't tell you, such as input that violates a
business rule or the validation of a specific result value. It also doesn't catch a computation
error like `sum: 999` that has the right type but the wrong value. Treat the generated result as
a draft and add such assertions by hand as separate cases.
