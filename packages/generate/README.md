**English** · [한국어](./README.ko.md)

# @mcpeak/generate

Builds a deterministic baseline from the input schemas of MCP tools, and evolves the test
draft through AI-assisted review that the user approves.

- **Owners:** `@seodduu` `@endl24` `@sunghoon0303`
- **Dependencies at generation time:** `@mcpeak/core`, `@mcpeak/runner`
- **Dependencies when running the generated result:** `@mcpeak/runner`

## Deterministic baseline

`createBaselineSuite()` synthesizes the `ToolDef[]` discovered on a single server into an in-memory
`TestSuiteSpec`. The same tool definitions and options return the same suite and fingerprint. This API
neither writes files nor connects to a server, so the CLI and other user interfaces can compose it safely.

```ts
import { createBaselineSuite } from "@mcpeak/generate";

const baseline = createBaselineSuite(tools, {
  suiteId: "weather",
  suiteName: "날씨 서버 baseline",
});

console.log(baseline.suiteFingerprint);
```

Input values are picked in this order: `const` → `default` → `examples[0]` → `enum[0]` → a fixed value per type.
Objects get only their required properties, and arrays get a single element generated from `items`. The baseline's
happy path checks that the tool response's `isError` is `false`. If a tool declares an `outputSchema`,
the subset whose meaning can be preserved is saved along with it as a `structuredContentMatchesSchema` assertion.
So even if the server later changes both its declaration and its response, it is checked again against the output contract as it stood when saved.

`generateTests()` remains available as the existing TypeScript file generation API. Generated file names and the input value
selection rules follow the description below.

## Generating tests

```ts
import { generateTests } from "@mcpeak/generate";

const paths = await generateTests(tools, {
  outDir: "./generated",
});
```

By default, if any target file already exists, no file is written and it stops with an `OUTPUT_FILE_EXISTS`
error. Specify `overwrite: true` only when you explicitly intend to replace existing generated files.
We recommend not editing generated files directly and keeping hand-written tests in separate files.
Overwriting works only in environments that support opening files without following symbolic links. If the target is
a symbolic link or the platform does not support that capability, it stops without changing the existing file.
On Windows, where Node.js currently does not provide `O_NOFOLLOW`, `overwrite: true` is not supported;
the default no-clobber generation and creating new files still work.

```ts
await generateTests(tools, {
  outDir: "./generated",
  overwrite: true,
});
```

Tool names are normalized to lowercase letters, digits, and hyphens and truncated to at most 80 characters. If the normalized result
is empty or a Windows reserved name, `tool-<순번>` (a sequence number) is used. If it collides with an already reserved name,
deterministic suffixes such as `-2`, `-3` are appended until a free name is found. So callers
should not assume an unsuffixed `<tool-name>.generated.ts` and should find generated files through the returned `paths`.
Generated files contain neither how to connect to the server nor an `McpClient`; they export only Runner's declarative
`generatedSuite`.

The supported keywords are `type` (single), `required`, `properties`, `items` (single schema), `enum`, `const`,
`default`, `examples`, range, length, and count constraints, the `format` values in the table, `pattern` (an ECMA-262 subset),
`additionalProperties`, `propertyNames`, local `$ref` (`$defs`, `definitions`), `anyOf`, and `oneOf`.
`allOf`, `not`, `if`, `patternProperties`, array-form `type`, tuple `items`, and remote `$ref` are not
supported yet; a tool that has such a keyword is skipped and the remaining tools are generated. If a candidate value does not
satisfy its constraints or the constraints contradict each other, a `GenerateTestsError` is thrown before any file is written.

## AI-assisted review and approval

The AI-assisted flow keeps the baseline, the current approved draft, the candidate under review, and the final run snapshot separate.
Suggestions from Codex or Claude are never run or saved immediately. The approved draft changes only when the user applies
the changes they selected.

Each time the user asks for another revision, a new stateless request is built without resuming the provider session.
Each request reuses the baseline, the current working candidate, the user's feedback, the needed tool definitions, and the fixed output contract.
Earlier raw prompts and provider output are not automatically included in the next request.

Approval has three stages.

1. Send approval: review the provider, model, sanitized payload, byte length, timeout, and fingerprint.
2. Change approval: review the sanitized candidate and a locally computed diff, and choose which changes to apply.
3. Final run approval: confirm the fingerprint of the final suite snapshot again before saving or running.

Of the provider's results, only candidates that pass runtime validation, size limits, and redaction are shown
on the review screen. Raw prompts, provider stdout and stderr, native error stacks, and actual MCP inputs and responses are not kept in public
state, logs, or reports.

The Codex and Claude adapters each use an empty temporary working directory, stdin, and a structured output contract.
They block tools, MCP, file writes, and provider session persistence, and apply an environment variable allowlist, timeout, cancellation, and
bounded shutdown. Actually running a provider requires a CLI the user has installed and authenticated.

Calling a provider based on a `RunnerReport` to automatically repair tests is not in this package's current
scope. It also does not change Runner's execution and report contracts.

## Running with a real client

Generated files and the real server connection are composed in a separate execution entry point.

```ts
import { runSuite } from "@mcpeak/runner";
import { generatedSuite } from "./generated/get-weather.generated.js";

const execution = runSuite({
  client,
  suite: generatedSuite,
});

const report = await execution.report;
```

The execution entry point that created the client and transport is also responsible for closing that client after the run ends.
Generated code does not depend on Vitest, so the CLI, the Dashboard, or a separate test adapter can all use the same
suite.

## Scope of automatic generation

It does not generate abnormal inputs that the schema alone cannot tell you about, specific business result values, or business rule validation.
It checks the types and field structure of `outputSchema`, but does not judge a computation error that only has the right type, like `sum: 999`.
For output contracts whose meaning cannot be preserved with the Runner subset, such as `patternProperties` or combined schemas,
keywords are not silently dropped. The normal `isError` check is kept, and the unverified paths and reasons are left in the result's
`outputContractSkips` and in a CLI warning. Review the generated result as a draft, then
add the assertions and cases you need in a separate file.
