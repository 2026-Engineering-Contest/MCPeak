**English** · [한국어](./README.ko.md)

# MCPeak CLI

`mcpeak test` starts and stops a local stdio MCP server directly from a JSON test suite.

When running it for the first time or checking which commands are available, it shows the full help. Running it with no arguments
also writes the same help to stdout and returns exit code 0.

```bash
mcpeak --help
mcpeak -h
mcpeak help
mcpeak --version
```

`mcpeak help test` and `mcpeak test --help` show the `test` help, and `mcpeak help generate` and
`mcpeak generate --help` show the `generate` help. Help and version are not errors, so they are printed
to stdout rather than stderr and return exit code 0.

```bash
mcpeak test packages/cli/tests/fixtures/weather-suite.json \
  --command node \
  --arg examples/weather-server/server.mjs
```

The syntax is `mcpeak test <suite.json> --command <executable> [--arg <value> ...] [--json] [--junit <path>] [--stderr-lines <N>] [--record-session <path> | --session <path>]`. The command and arg in the example above run as `node examples/weather-server/server.mjs`. `--arg` can be repeated; pass a value starting with a hyphen as `--arg=-m` and an empty value as `--arg=`.

Only the report goes to stdout. By default it is a human-readable report, and with `--json` it is `RunnerReport` JSON. CLI errors and server process diagnostics go only to stderr, so `--json > report.json` does not break. The exit code is 0 when every test passes, and 1 for a failed or aborted report and for input, connection, and shutdown errors.

`--junit <path>` writes a JUnit XML report that CI tools read to that path.

```bash
mcpeak test weather.json \
  --command node --arg examples/weather-server/server.mjs \
  --junit reports/junit.xml
```

It leaves stdout as is and only adds a file, so it can be used together with `--json`. The two have different roles — `--json` sets the stdout format, `--junit` sets a separate artifact. The directory of the path must already exist, and if the file cannot be written, it exits with code 1 and `JUNIT_WRITE_FAILED` even if every test passed. This is so CI never goes green without a report. The XML is written before stdout, so the file remains even if stdout is cut off in a pipe.

If building the XML fails, it exits with code 1 and `CLI_INTERNAL_ERROR`. This happens before the file write is reached, so **it neither creates the file nor overwrites an existing one.** The report from the previous run stays in place, so a tool reading this path in CI may mistake a stale report for the latest result. Judge by the exit code.

`RunnerReport` has no timing information, so every `time` attribute is `0`. It means "has no timing information," not "took 0 seconds." The rationale is in [ADR-0016](../../docs/adr/0016-junit-time-속성-고정.md), and the flag design is in [ADR-0019](../../docs/adr/0019-junit-리포터-cli-노출-방식.md).

`--record-session <path>` records the external HTTP responses the server fetched with `globalThis.fetch`,
and `--session <path>` replays that recording. The server actually runs during replay too. Calls at the `node:http` and
`node:https` layer are out of scope and may go out to the real network; the CLI surfaces runs where an out-of-scope call is suspected,
such as zero recorded or zero replayed responses, with a notice on stderr.

`--stderr-lines <N>` is the number of stderr lines shown in the server process diagnostic block that is attached to stderr, when there is diagnostic content, after a failure or after the server exits abnormally or is aborted. The default is 20, and `0` turns the block off entirely (the output bytes are then the same as before this feature existed). The block contains the exit code and signal and the last N lines of stderr the server left, and truncation is noted in the header. If the server exited normally and stderr is empty, there is no evidence to show, so the block is not written.

### Approval fingerprint check

`test` computes the approval fingerprint of the suite it runs, compares it against the `approval.fingerprint` written in the file, and records the result in the report. **It does not change the verdict.** The exit code is determined only by the case results, so it is 0 if everything passes even when the fingerprint differs. Editing a suite is normal work, and if tests were blocked every time, users would first look for a way around the check.

Whether it is shown is as follows. Printing a line unconditionally on every run would be permanent noise for users who write suites by hand, and then they would not read the line exactly when it matters.

| Fingerprint state | All passed | Has failures, timeouts, etc. |
|---|---|---|
| Matched | Silent | Shown |
| Mismatched | **Shown** | Shown |
| Absent (not pinned) | Silent | Shown |

The only exception is a mismatch when everything passes, because that is a green result on an unapproved suite. That fact is even easier to let slip by quietly than a failure.

When the fingerprint computed from the current suite and the saved `approval.fingerprint` do not match, the message distinguishes the situation
by whether everything passed or there were failures. Two fingerprints alone cannot reconstruct the specific changes, so
it guides you to compare the suite in version control, and if the change was intended, to regenerate and re-approve by adding
`--force` to `mcpeak generate` with the same settings.

The suite line goes to stdout after the report body, separated by one blank line. `--json` does not apply the suppression rule above and always includes the `spec` key (`approval` is one of `matched` · `mismatched` · `absent`, `fingerprint` is the value computed at run time, and `approvedFingerprint` is the value written in the file; when `absent`, the key is omitted). If keys conditionally disappear from machine-readable output, consumers have to write one more branch. Existing report keys are unchanged, so existing consumers do not break.

A suite without a fingerprint is also normal. Hand-written suites and suites made before this feature fall into this category and are not treated as failures.

Currently only a single UTF-8 JSON suite and stdio servers are supported. Shell syntax, multiple suites, and TypeScript module suites are not supported. The `record` and `mock` commands are not implemented yet.

## generate

`mcpeak generate` builds a deterministic baseline suite from the server's `tools/list` result.

```bash
mcpeak generate \
  --suite-id weather \
  --name "Weather server" \
  --out weather.json \
  --command node \
  --arg examples/weather-server/server.mjs \
  --baseline-only
```

The syntax is as follows.

```text
mcpeak generate --suite-id <id> --name <name> --out <suite.json> --command <executable> [--arg <value> ...] [--baseline-only] [--provider <codex|claude>] [--model <model>]
```

`--baseline-only` is an explicit non-interactive approval that never calls AI. The generator does not overwrite an existing output file; it rereads a temporary file in the same directory to verify the suite and fingerprint and then saves atomically. The weather-server baseline uses `{ "city": "example" }` for `get_weather`, so if you then run `mcpeak test`, get_weather fails and add passes. This is a signal that the baseline is only a starting point derived from the schema and does not guarantee a successful run.

In a TTY, leaving out `--baseline-only` starts an interactive review. You can choose a Codex or Claude provider and model. The default models are Codex `gpt-5.6-luna` and Claude `haiku`. If you specify both `--provider` and `--model`, that exact choice is used.

Before each AI request, it shows the provider, model, size of the sanitized request, result limit, timeout, and fingerprint, and asks for send approval. If you do not approve, the provider is not called. Candidate results are reviewed by applying them all or applying selected change IDs, and you can enter feedback to send a new request. Question results are also shown, and you can send your answer as a new request. Direct editing loads a separate JSON file whose path you enter, and goes through the same diff and approval boundary.

The saved suite includes an `approval` block.

```json
{
  "schemaVersion": 1,
  "id": "weather",
  "name": "Weather server",
  "approval": {
    "fingerprint": "9f2c1a3b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8"
  },
  "defaultTimeoutMs": 5000,
  "cases": []
}
```

`fingerprint` is 64 lowercase hex characters that summarize the suite as it stood at approval. It is computed from the parsed suite object rather than the file's bytes, so the value stays the same if you change indentation, line endings, or key order. The question it has to answer is not "did the bytes change" but "did the meaning of the tests change." The `approval` block itself is excluded from the computation. Nothing can summarize itself while containing itself. Right after saving, the file is reread, and it is committed only after confirming that both the computed value and the value written in the file equal the fingerprint at approval.

Finally, JSON is written only after you confirm the fingerprint of the last approved draft and approve the save again. The saved file can be passed as is to the existing `mcpeak test <suite.json> --command ...` command. An actual Codex or Claude call uses your account and incurs cost, so it is not run in automated tests or default verification.
