# CI Integration

After this page you can put `mcpeak test` into CI, and you know which of the exit code, the JUnit report, and the JSON report to read for what.

## Exit code

It is 0 when every case passes. It is 1 if there is even one failure, timeout, or cancellation, and also if the suite cannot be read or the server cannot be connected to. The simplest integration ends here.

```yaml
- run: npx @mcpeak/cli test weather.suite.json -- node ./server.mjs
```

## JUnit report

```bash
mcpeak test weather.suite.json --junit reports/junit.xml -- node ./server.mjs
```

This writes JUnit XML that CI tools read to that path. stdout is left as is and only the file is added, so it can be used together with `--json`. The directory in the path must already exist.

If the file cannot be written, it exits with code 1 and `JUNIT_WRITE_FAILED`, even if every test passed. This is to avoid CI turning green without a report. If it fails while building the XML, the file is neither created nor overwritten, so the previous run's report is left in place. A tool reading that path could mistake a stale report for a fresh one, so judge by the exit code.

Every `time` attribute is `0`. This is because the report has no timing information, not because it took zero seconds.

## JSON report

```bash
mcpeak test weather.suite.json --json -- node ./server.mjs > report.json
```

The report JSON goes to stdout. CLI errors and server diagnostics go only to stderr, so the redirect is not broken.

```json
{
  "schemaVersion": 1,
  "suite": { "id": "weather", "name": "날씨 서버" },
  "status": "passed",
  "cases": [],
  "summary": {
    "total": 8, "passed": 8, "failed": 0, "timedOut": 0,
    "cancelled": 0, "notRun": 0, "rejectionUnverified": 6
  },
  "spec": { "approval": "matched", "fingerprint": "…", "approvedFingerprint": "…" }
}
```

`spec.approval` is one of `matched`, `mismatched`, or `absent`. The human readable output hides the fingerprint line depending on the situation, but the JSON always includes it. If a key disappears conditionally from output meant for machines, a consumer has to write one more branch to handle it. Turning on `--determinism` adds the `determinism` key ([Determinism Check](/guide/determinism)).

## Server diagnostics

When a case fails or the server exits abnormally, a server process diagnostics block is attached to stderr. It carries the exit code, the signal, and the last N lines of stderr the server left behind. The default is 20 lines, and `--stderr-lines 0` turns it off. If the server exited normally and its stderr is also empty, the block is not written.

## Servers that call external APIs

To avoid calling a real API in CI, record an [External session](/guide/external-sessions) once locally and commit it, then replay it in CI with `--session`. Check that no credentials remain in the session file before committing it.

## Passing secrets

If the server reads its API key from an environment variable, specify its name with `--env NAME`. The SDK only passes a fixed list such as `HOME` and `PATH` to the child process, so anything not specified does not get through. The reason it does not take the value directly is that a token written on the command line stays in the `ps` listing and the shell history.

```yaml
- run: mcpeak test suite.json --env WEATHER_API_KEY -- node ./server.mjs
  env:
    WEATHER_API_KEY: ${{ secrets.WEATHER_API_KEY }}
```

When connecting to an HTTP server that is already running, use `--url` together with `--header-env header=ENV_VAR`.

## How the repository verifies itself

This repository's CI runs an E2E that applies `mcpeak` to the example servers under `examples/`. If this breaks, it is broken for the user too.
