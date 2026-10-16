**English** · [한국어](./README.ko.md)

# @mcpeak/runner

Runs declarative MCP test suites in order and provides assertion results along with structured events and reports.

- **Owners:** `@seodduu` `@endl24` `@sunghoon0303` (① MCP server testing part)
- **Dependency:** `@mcpeak/core`

## Writing a suite

`defineMcpSuite` validates the suite at runtime while preserving TypeScript literal types. When you receive a suite as external JSON or as generated output, use `validateMcpSuite`.

```ts
import { defineMcpSuite } from "@mcpeak/runner";

export const suite = defineMcpSuite({
  schemaVersion: 1,
  id: "weather-server",
  name: "날씨 MCP 서버 테스트",
  defaultTimeoutMs: 10_000,
  cases: [
    {
      id: "weather-tool-exists",
      name: "날씨 조회 툴을 제공한다",
      operation: { type: "listTools" },
      assertions: [{ type: "toolExists", tool: "get_weather" }],
    },
    {
      id: "weather-call-succeeds",
      name: "서울 날씨를 정상적으로 조회한다",
      operation: {
        type: "callTool",
        tool: "get_weather",
        input: { city: "서울" },
      },
      assertions: [
        { type: "isError", expected: false },
        {
          type: "structuredContentMatchesSchema",
          schema: {
            type: "object",
            required: ["temperature"],
            properties: { temperature: { type: "number" } },
          },
        },
      ],
    },
  ],
});
```

`listTools` can take `toolExists`, and `callTool` can take `isError`, `bodyMatchesSchema`, and
`structuredContentMatchesSchema`. The last assertion leaves the existing text body extraction rule
unchanged and checks only `ToolResult.raw.structuredContent` against the saved contract. Suites and run results are
processed in suite order, and `RunnerReport` and `RunnerEvent` can be passed to `JSON.stringify`.

## Execution and shutdown lifecycle

`runSuite` never closes the client injected into it. The side that starts the run must provide an idempotent shutdown controller holding exactly the same object as the client, and complete the shutdown with `finalizeRunnerExecution`.

```ts
import {
  finalizeRunnerExecution,
  runSuite,
  type McpClientShutdownController,
  type RunnerEvent,
} from "@mcpeak/runner";
import { suite } from "./weather-suite.js";

declare const shutdown: McpClientShutdownController;

const onEvent = (event: RunnerEvent) => {
  console.log(JSON.stringify(event));
};

const execution = runSuite({
  client: shutdown.client,
  suite,
  onEvent,
  redaction: {
    sensitiveKeys: ["sessionId"],
    sensitiveValues: [process.env.WEATHER_API_KEY ?? ""],
  },
  payloadLimits: {
    maxCaseBytes: 65_536,
    maxReportBytes: 1_048_576,
  },
  drainTimeoutMs: 5_000,
});

const report = await finalizeRunnerExecution({ execution, shutdown });
```

A case's `timeoutMs` takes priority if present; otherwise the suite's `defaultTimeoutMs` is used, and if neither is set, Runner's 10 second fallback. A timeout or an abort from an external `AbortSignal` stops the execution of the remaining cases.

`execution.drain` is a non-rejecting result that waits for pending MCP operations. The default deadline is `5_000ms`, and the result is `{ status: "settled" }` or `{ status: "deadlineExceeded", pendingOperations: 1 }`. After drain completes, graceful close and force close are each limited independently, by default to `2_000ms`. The controller must implement actual transport layer shutdown: process exit or kill for stdio, request abort or socket destroy for HTTP. Keep rejection handlers for MCP operations that finish late or reject in place for the lifetime of the controller.

`drainTimeoutMs` must be a finite integer in `1..60_000`. `closeTimeoutMs` and `forceCloseTimeoutMs` must each be a finite integer in `1..10_000`. Zero, non-finite numbers, negative numbers, and decimals throw a synchronous `RangeError` before the run.

## Observed data and follow-up repair

Observer events and reports recursively mask default sensitive keys (authorization, cookie, password, secret, token, and so on). Callers can add `sensitiveKeys` and `sensitiveValues`. The default limits are 65,536 bytes per case and 1,048,576 bytes per report. Runner never saves events or reports automatically.

A `RunnerReport` keeps the sanitized suite and diagnostics of failed cases. So it can be converted into JSON-safe sanitized repair input and used in a follow-up repair flow that goes through user review. The original MCP calls use separately kept input, so no secrets are exposed in observer data.

## Currently out of scope

- generate provider or repair validator implementation
- JUnit output and a Vitest adapter
- Parallel execution

## Compatibility with the previous API

`createMcpTest(config, body)` and `toContainTool(result, name)` are deprecated shims kept for minor version compatibility. They keep their existing signatures and the `not implemented` error as they are, and will not be removed before a major release. In new code, use the declarative `defineMcpSuite` and `runSuite`.
