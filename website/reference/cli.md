# CLI

This document lists every `mcpeak` command with its flags and defaults. To run through one end to
end first, see [quick start](/quick-start).

```
mcpeak <command> [options]
mcpeak help [command]
```

`mcpeak --help`, `-h`, and `help` print the full help text. Running with no arguments does the same,
writing it to stdout and exiting with code 0. `mcpeak help test` and `mcpeak test --help` are
equivalent. `--version` prints the version.

## Three ways to specify a server

`test` and `generate` accept the same three forms. Use only one.

| Form | Meaning |
|---|---|
| `-- <executable> [args...]` | Everything after `--` is the command that starts the server. The first token is the executable, the rest are arguments. Nothing after that is parsed further |
| `--command <executable> [--arg <value> ...]` | The same thing as flags. Repeat `--arg` as needed. A value starting with a hyphen goes as `--arg=-m`, and an empty value as `--arg=` |
| `--url <URL>` | Attaches to an already running Streamable HTTP server. Since no process is started, stdio-only options are not accepted |

`--env <NAME>` is available for stdio, and `--header-env <header>=<env var>` for HTTP.

| Option | Meaning |
|---|---|
| `--env <NAME>` | Passes the parent environment variable NAME to the server process. Can be repeated. The SDK only gives the child a fixed list such as `HOME` and `PATH`, so any value the server reads from the environment, such as an API key, needs to be named explicitly here. Names starting with `NODE_OPTIONS` or `MCPEAK_` are used by the record and replay wiring and are not accepted |
| `--header-env <header>=<env var>` | Reads a request header value from an environment variable and attaches it |

Neither option accepts the value directly, since a token written on the command line stays in the
`ps` list and shell history. Set the value without putting it in history either.

```bash
read -rs MCP_TOKEN; export MCP_TOKEN
mcpeak test suite.json --url http://127.0.0.1:3000/mcp --header-env Authorization=MCP_TOKEN
```

## test

```
mcpeak test <suite.json> <server target>
            [--determinism] [--reset-cmd <command>]
            [--json] [--junit <path>] [--repair-bundle <path>] [--stderr-lines <N>]
            [--session <path> | --record-session <path>]
```

Starts the server from the JSON suite and validates it. Exits 0 if every case passes, and 1 if
there is a failure, timeout, or abort, or an input, connection, or exit error. Only the report goes
to stdout; CLI errors and server diagnostics go to stderr.

| Option | Default | Meaning |
|---|---|---|
| `--determinism` | off | Runs the suite twice and compares the results. This is a non blocking diagnostic, so finding a difference does not change the exit code. See [determinism check](/guide/determinism) |
| `--reset-cmd <command>` | none | Runs this command once before each run. It does not go through a shell, so pipes and `&&` cannot be used |
| `--json` | off | Writes `RunnerReport` JSON to stdout instead of the human readable report |
| `--junit <path>` | none | Writes JUnit XML to that path. If it cannot be written, exits 1 with `JUNIT_WRITE_FAILED` even if every case passed |
| `--repair-bundle <path>` | none | Writes a bundle containing only the failed cases. See [Repair](/guide/repair) |
| `--stderr-lines <N>` | `20` | The number of lines in the server diagnostics block attached to stderr on failure. `0` turns the block off |
| `--record-session <path>` | none | Records the HTTP calls the server makes outward through `globalThis.fetch` |
| `--session <path>` | none | Replays recorded external calls |

The two session options cannot be used together, or together with `--determinism`. Their scope and
what they store are covered in [External session](/guide/external-sessions).

The fingerprint line at the end of the report states whether the suite approved by `generate`
matches the current file. It does not change the verdict. In `--json` it is always present under the
`spec` key.

## generate

```
mcpeak generate --out <suite.json> <server target>
                [--suite-id <id>] [--name <name>]
                [--baseline-only] [--provider <codex|claude>] [--model <model>]
                [--no-dry-run] [--reset-cmd <command>] [--fixtures <path>]
                [--no-repair] [--diagnose-rejections] [--force]
```

Builds a suite from the server's tool schemas. The flow is described in
[generating a suite](/guide/generate).

| Option | Default | Meaning |
|---|---|---|
| `--out <suite.json>` | required | The path to save to. The file name is included in the approval fingerprint |
| `--suite-id <id>` | derived from the file name | For `contract.suite.json` this is `contract` |
| `--name <name>` | same as `--suite-id` | The name printed on the first line of the report |
| `--baseline-only` | off | Non interactive approval that does not call an AI. Also skips the dry run |
| `--provider <codex\|claude>` | selected in a TTY | The CLI to use for AI review |
| `--model <model>` | selected in a TTY | The model to pass to the provider |
| `--no-dry-run` | off | Skips the dry run before approval. This also skips any AI pre-fill that requires a run |
| `--reset-cmd <command>` | none | Runs once before the dry run |
| `--fixtures <path>` | `mcpeak.fixtures.json` | JSON listing values that point to real resources, per tool and field. If absent, generation proceeds without it |
| `--no-repair` | off | Does not fix input values and retry when the dry run fails |
| `--diagnose-rejections` | off | Lists the responses of passing rejection cases and, if a provider is set, asks it for a reference opinion |
| `--force` | off | Deletes and rewrites the file at `--out` if one already exists. By default, saving stops instead |

## repair

```
mcpeak repair <bundle.json> --provider <codex|claude> --model <model>
              [--max-cases <N>] [--no-stderr] [--yes]
```

Uses a bundle produced by `test --repair-bundle` to get suggested cause candidates in the server
code. The flow is described in [Repair](/guide/repair).

| Option | Default | Meaning |
|---|---|---|
| `--provider <id>` | required | `codex` or `claude` |
| `--model <model>` | required | The model identifier to pass to the provider |
| `--max-cases <N>` | all | The maximum number of failures to send at once. Excess cases are dropped from the end, keeping the first ones |
| `--no-stderr` | off | Excludes server stderr from what is sent |
| `--yes` | off | Skips the confirmation screen before sending |

## Separate executables

| Command | Package | Meaning |
|---|---|---|
| `mcpeak-mock <definition.json>` | `@mcpeak/mock` | Starts a stdio mock server from a definition file. See [mock server](/guide/mock-server) |
| `mcpeak-dashboard [--port <number>]` | `@mcpeak/dashboard` | The local web UI. Default port 7357, or automatic if `0` is given. See [dashboard](/guide/dashboard) |

A global install only places that package's own executable, so install all three separately.

## Error codes

If the run itself fails, stderr gets an `오류 [<코드>]: <메시지>` line along with a `해결:` line.
Connection errors take the form `MCP_CONNECTION_FAILED/<detail code>`.

| Detail code | Meaning |
|---|---|
| `PROCESS_START_FAILED` | The server process could not be started. Check the command and cwd |
| `HANDSHAKE_TIMEOUT` / `HANDSHAKE_FAILED` | The process started, but the MCP handshake did not finish |
| `PROCESS_EXITED` | The server exited before the handshake or during the run. The diagnostics block carries the exit code and stderr |
| `HTTP_CONNECT_FAILED` / `HTTP_UNAUTHORIZED` / `HTTP_STATUS_ERROR` | Could not connect to the `--url` target |
| `HTTP_SESSION_LOST` | The HTTP session was lost during the run |

Codes for a malformed suite file are listed under
[validation errors in the suite spec](/reference/suite-spec#validation-errors).

## Supported scope

Supports a single UTF-8 JSON suite and stdio or Streamable HTTP servers. Shell syntax, multiple
suites, and TypeScript module suites are not accepted. On Windows, `.cmd` and `.bat` are not accepted
as the command. Give an executable the operating system can run directly, and pass a script path as
an argument.
