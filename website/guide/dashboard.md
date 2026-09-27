# Dashboard

After this page you can start the local web UI to pick and run suites, and carry out `generate`'s approval screen and `repair` review in the browser.

## Install and run

```bash
npm install -g @mcpeak/dashboard
mcpeak-dashboard
```

```
대시보드: http://localhost:7357  (스위트 탐색 루트: /path/to/project)
```

It looks for suite files under the directory the command was run in. If the list is empty, check the search root printed at startup first. The port is changed with `--port`, and `0` picks a free port automatically.

## Screens

| Screen | What it does |
|---|---|
| Home | The list of suites found. Fill in the server run command and options to run one |
| Run | An event stream for the run in progress and per case results |
| Generate wizard | `generate`'s target selection, dry run, and approval screen |
| Repair review | Get and review cause candidates from a failed run's bundle |
| Replay | External session record and replay |
| Settings | Provider, model, and so on |

## Verdicts match the CLI

The dashboard does not have its own separate verdict logic. It calls the command functions that `@mcpeak/cli/commands` exposes directly, and only swaps the terminal output and interactive prompts for web implementations. So the same suite gives the same result whether run through the CLI or the dashboard. If the verdict logic existed in two copies, the results would eventually diverge, and on that day the user would have no way to know which one to trust. The background is in the repository's ADR-0046.

## Runtime requirements

Node 22.18 or higher is required, and CI checks it on 22.18.0 and 24. On Node 25, some dashboard frontend tests fail, but this is not part of CI verification.
