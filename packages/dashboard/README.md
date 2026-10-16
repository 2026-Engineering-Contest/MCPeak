**English** · [한국어](./README.ko.md)

# @mcpeak/dashboard

Local web UI for [MCPeak](https://github.com/2026-Engineering-Contest/MCPeak), the MCP server testing
framework. Pick and run suites, and carry out `generate`'s approval screen and `repair` review in the
browser.

## Install and run

```bash
npm install -g @mcpeak/dashboard
mcpeak-dashboard
```

> **Note:** MCPeak's own messages are currently printed in Korean; English translations are shown alongside.

```
대시보드: http://localhost:7357  (스위트 탐색 루트: /path/to/project)
```

> Dashboard: http://localhost:7357  (suite search root: /path/to/project)

It looks for suite files under the directory the command was run in. If the list is empty, check the
search root printed at startup first. Change the port with `--port`; `0` picks a free port
automatically.

## Screens

| Screen | What it does |
|---|---|
| Home | The list of suites found. Fill in the server run command and options to run one |
| Run | An event stream for the run in progress and per-case results |
| Generate wizard | `generate`'s target selection, dry run, and approval screen |
| Repair review | Get and review cause candidates from a failed run's bundle |
| Replay | External session record and replay |
| Analyze | The tokens tab shows the compression report from [Optimize](https://2026-engineering-contest.github.io/MCPeak/guide/optimize), the security tab the findings from [Audit](https://2026-engineering-contest.github.io/MCPeak/guide/audit) |
| Settings | Provider, model, and so on |

## Verdicts match the CLI

The dashboard has no verdict logic of its own. It calls the command functions that
`@mcpeak/cli/commands` exposes directly, and only swaps the terminal output and interactive prompts
for web implementations. So the same suite gives the same result whether run through the CLI or the
dashboard. If the verdict logic existed in two copies, the results would eventually diverge, and on
that day the user would have no way to know which one to trust. Background:
[ADR-0046](../../docs/adr/0046-대시보드를-로컬-웹서버로-만든다.md) (in Korean).

## Requirements

Node 22.18 or later.

## Documentation

[Dashboard guide](https://2026-engineering-contest.github.io/MCPeak/guide/dashboard) ·
[MCPeak docs](https://2026-engineering-contest.github.io/MCPeak/)

## License

MIT
