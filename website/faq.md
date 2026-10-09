# FAQ

This page answers questions that only come up after installation is done.

## `mcpeak-mock`, `mcpeak-dashboard`, or `mcpeak-optimize-proxy` says "command not found"

This happens because only `@mcpeak/cli` was installed globally. A global npm install only puts that package's own executable on `PATH`. Even a package pulled in as a dependency does not get its bin installed.

```bash
npm install -g @mcpeak/mock @mcpeak/dashboard @mcpeak/optimize
```

## It passed, but "거절 근거를 확인하지 못했습니다" (rejection basis not verified) shows up

This means that for a case expecting `isError: true` that passed, the tool could not determine whether the error came from input validation or the server broke for some other reason. The tool only recognizes the SDK's input validation prefixes (things like `MCP error -32602:`). A rejection sentence the server wrote itself, and a mock server's rejection sentence, are not on that list, so this warning always appears for them. The verdict does not change. If in doubt, run `mcpeak generate --diagnose-rejections` to list the responses.

## A normal case made by `generate` fails

This happens because a placeholder value picked from the schema (`"example"`, `0`) is a value the server does not recognize. If the server only knows Seoul, Busan, and Jeju, `{ "city": "example" }` gets rejected. The dry run in the default flow surfaces this before saving, and you can either fix the input value and try again or take an AI suggestion. Writing real values into `mcpeak.fixtures.json` makes it use those values from the start. If it was made with `--baseline-only`, there was no dry run, so this failure stays as is.

## Everything passed, but "승인 시점과 다릅니다" (differs from the approved version) shows up

This means the suite was edited by hand after being approved with `generate`. The verdict does not change and the exit code is still 0. Since this is a green result on a suite that was never approved, it is easy to slide past unnoticed, more so than a failure, so it is always shown in this one case. If the change was intentional, regenerate and approve again with `mcpeak generate --force` using the same settings, or just leave it. A hand written suite has no fingerprint, and that is normal too.

## During replay, it still goes out over the real network

A session only intercepts `globalThis.fetch`. Calls made directly through `node:http` or `node:https`, or through axios, got, or node-fetch built on top of them, and any non Node server, are out of scope and are not replayed, they go out for real. If there are zero recordings or zero replays, this is reported when the run ends.

## Using a session option prints `ExperimentalWarning: SQLite`

This is because Node still marks `node:sqlite` as experimental. It only happens once, on first load, so it is one line per run, and it appears on Node 22.18.0 but not on 24.16.0. A saved recording is a standard SQLite file and is not affected.

## The server cannot read its API key

`core` does not pass the parent's environment variables through as is. Only names you specify, such as `--env WEATHER_API_KEY`, get through. The reason the value is not taken on the command line is that it stays in the `ps` listing and the shell history.

## Using `--url` with `mcpeak test` rejects stdio options

`--url` connects to a server that is already running, so there is no process to launch. Options that assume a process, like `--env` and `--reset-cmd`, cannot be used with it, and when they are combined, the error message says which option that is. For HTTP, use `--header-env`.

## Why you should not just type `mcpeak` while working in the repository

The `mcpeak` on `PATH` is the version published to npm, which can be behind the repository's main branch. In the repository, call the build output after `pnpm build`.

```bash
node packages/cli/dist/cli.mjs test <suite.json> -- node ./server.mjs
```

Skipping `pnpm build` means it bites on the stale `dist/`. Rebuild after changing the source.
