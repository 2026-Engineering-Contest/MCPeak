# How It Works

After this page you understand what parts move in a single `mcpeak test` run, and how each part keeps determinism. The commands themselves are covered in [Quick Start](/quick-start) and the [CLI reference](/reference/cli).

## A single run

```
suite (JSON) ──→ runner ──→ core ──→ server process
                    │          │
                    │          └── stdio or Streamable HTTP
                    └── runs cases in order, judges assertions, builds the report
```

1. The CLI reads and validates the suite file. If a field is missing or an assertion does not match its operation, it stops before starting the server.
2. `core` connects to the server. If it is a command after `--`, it launches the process over stdio, and if it is `--url`, it connects to a Streamable HTTP server that is already running. Once the handshake finishes, it hands `runner` a client that only has `listTools` and `callTool`.
3. `runner` executes the cases in the order given in the suite. For each case it sends one operation and judges the assertions. If a timeout or cancellation occurs, the remaining cases are left as `notRun`.
4. `runner` builds the report, and the CLI prints it as human readable text, `--json`, and `--junit`.
5. `core` closes the server. It waits briefly for pending requests, attempts a normal shutdown, and force kills it if that does not finish.

## Packages

| Package | Role |
|---|---|
| `@mcpeak/core` | MCP protocol client, transport, process lifecycle |
| `@mcpeak/runner` | Suite execution, assertions, failure messages, reports and JUnit |
| `@mcpeak/generate` | Deterministic baseline generation from schemas, approval based AI review |
| `@mcpeak/record` | Record and replay of HTTP calls the server makes outward |
| `@mcpeak/mock` | Mock MCP server (stdio, Streamable HTTP) |
| `@mcpeak/cli` | The entry point. Kept thin |
| `@mcpeak/dashboard` | Local web UI. Reuses the CLI's command functions |

The dependency direction is one way: `dashboard` → `cli` → `runner` / `generate` / `record` / `mock` → `core`. A package can only depend on the layer to its right, and there are no back references.

## The server process is isolated

`core` does not pass the parent's `process.env` to the child as is. The parent environment can mix in authentication tokens, and values that change from run to run can shake the result. It passes only the fixed list the SDK allows, and anything the server needs beyond that goes through only if its name is specified with `--env NAME`.

Execution does not go through a shell. Even if `args` contains spaces or shell characters, they are not reinterpreted.

stderr is treated as untrusted input. Only the most recent 64 KiB is kept, and on failure the diagnostics block shows the last few lines. It is not included in the default error message.

## Where failure messages are built

When an assertion fails, `runner` builds three lines: what differed, what the server actually returned, and how to fix it.

```
isError  오류 응답을 기대했지만 정상 응답을 받았습니다.
→ {"sum":null}
해결: 툴 입력값과 서버의 오류 응답을 확인하세요.
```

The response body is included as is, but values under names like `authorization`, `token`, and `password` are masked. Anything beyond 64 KiB per case and 1 MiB per report is truncated.

## How determinism is kept

The same input must always produce the same result. Here is what each part of the tool does toward that.

- `generate` produces the same suite from the same tool definitions and options. It picks input values in the order fixed by the schema and does not use random values.
- The approval fingerprint is computed from the parsed suite object, not the file bytes. Changing indentation or key order does not change it.
- The mock's matching key is not affected by object key order. The HTTP mock starts stateless so the SDK does not generate a random session ID.
- The External session stores and replays the responses the server called outward. A temperature or exchange rate that changes on every call is fixed in place.
- JUnit's `time` is always `0`. The report carries no timing information by design.
- `--determinism` runs the same suite twice to surface any difference. The tool does not erase nondeterminism to hide it, it tells you when it is there.

## Approval fingerprint

A suite made by `generate` carries a summary from the moment it was approved. `test` recomputes that value every time and checks it against the value in the file. This does not change the verdict, it is only recorded in the report. Editing a suite is normal work, and if tests were blocked every time that happened, users would start looking for ways around the check instead. The detailed rules are in [suite generation](/guide/generate#approval-fingerprint).

## Design decisions

Judgment calls that "could have gone differently" are kept as one page each under the repository's `docs/adr/`. What counts as a live API is decided by the ADRs and the `@deprecated` comments in the source.

## What to read next

- [Quick Start](/quick-start): see your first run with a single suite.
- [Writing a Suite](/guide/writing-suites): operations, assertions, and how to read failure sentences.
- [CLI reference](/reference/cli): every command and flag.
