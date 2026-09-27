# Repair

After this page you can save the evidence from a failed run into a bundle file, and you know how to have an AI suggest cause candidates in the server code from that bundle.

## Creating a bundle

Adding `--repair-bundle` to `test` writes a separate file that collects only the failed cases.

```bash
mcpeak test weather.suite.json --repair-bundle repair.json -- node ./server.mjs
```

The bundle holds a `bundleVersion`, the suite that was run, the diagnostics for the failed cases, the tool definitions the server advertised, and information about the target server. The server's stderr is included too. If there are no failures, no bundle is created.

The reason it is a separate file from the `--json` report is that the two files carry different contracts. `--json` is the verdict output that CI reads, so it is effectively frozen, while the bundle is evidence handed to an AI, so its fields keep growing.

## Getting cause candidates

```bash
mcpeak repair repair.json --provider claude --model sonnet
```

`--provider` and `--model` have no default. You need a Codex or Claude CLI that you have installed and authenticated. A confirmation screen shows what will be sent before it goes out, and you must approve it.

| Option | Meaning |
|---|---|
| `--max-cases <N>` | The cap on the number of failures sent at once. Beyond the cap, the earliest ones are kept |
| `--no-stderr` | Excludes the server's stderr from what is sent. stderr is free form text the server writes, so it can mix in paths, tokens, or data |
| `--yes` | Skips the confirmation screen. Needed in non-interactive environments |

The suggestions are cause candidates in the server code. It does not fix the file. It does not fix the suite either. Problems on the suite side are covered by the dry run in [suite generation](/guide/generate).

## Seeing it with an example

`examples/live-weather-server` has one defect planted on purpose. `convert_units` declares `converted` in its `outputSchema` but ships `result` in `structuredContent`. The SDK validates that response and rejects it with `-32602`, and `test` shows that error as the cause of failure. This server exists so you can feed that bundle into `repair` and watch a one line cause candidate come out.

## From the dashboard

The [dashboard](/guide/dashboard) has a path that goes straight from a failed run into repair. It decides the bundle path itself, without asking.
