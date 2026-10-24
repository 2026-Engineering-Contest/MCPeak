**English** · [한국어](./README.ko.md)

# @mcpeak/audit

Reads an MCP server's tool definitions, launch command, and protocol responses and checks them for security risks before you use the server. From the CLI, use it as
`mcpeak audit`.

```
mcpeak audit -- node ./server.mjs
mcpeak audit --command npx --arg -y --arg some-mcp-server@1.2.3 --env GITHUB_TOKEN
mcpeak audit --url https://mcp.example.com/mcp --header-env Authorization=MCP_TOKEN
mcpeak audit --baseline ./server.audit.json -- node ./server.mjs   # 도구 정의 변경 추적
mcpeak audit --json -- node ./server.mjs                           # 결과 JSON
mcpeak audit --sandbox -- node ./server.mjs                        # Docker 격리 안에서 행위 관측
```

The exit code is 2 when there is a critical or warning finding, 0 when there is none, and 1 on a connection or input failure. Permission combination warnings (`flow`) and
informational findings do not affect the exit code.

## What it looks at

| Family | What it checks |
|---|---|
| `desc` | Every string and schema key name in tools, prompts, resources, and instructions. Model instructions, hidden side effects, auto-execution triggers, shadowing of other tools, mentions of unrelated services, sensitive paths, invisible characters, ANSI escapes, long encoded strings, fields outside the schema standard |
| `schema` | Secret arguments, free text fields that could carry the conversation, mismatch between readOnlyHint and the name, missing destructiveHint on destructive names, unconstrained command, path, and URL arguments |
| `flow` | The combination of reading external input, accessing private data, and writing externally all in one server (warning) |
| `launch` | Inline code in the launch command, piping remote scripts to a shell, unpinned package versions, running a remote address, forwarding real env |
| `protocol` | Plain HTTP, accepting without authentication, no Origin check, insecure endpoints in OAuth metadata, session identifiers in URLs, server initiated requests and the instructions inside them, tool list changes during the audit |
| `secret` | Leaks of canary env values, echoes of forwarded real values, secret names mentioned in descriptions |
| `result` | Model instructions, invisible characters, ANSI, oversized content, and no response in call responses |
| `surface` | The difference between the `--baseline` file and the current tool definitions. With `--sandbox --compare-host`, also the difference between the tool definitions inside isolation and on this machine |
| `behavior` | (`--sandbox`) Reading decoy credential files, attempts to connect to internal addresses, child processes, writes and executions that contradict readOnlyHint, writes outside the temporary directory, tampering with the audit record |
| `network` | (`--sandbox`) Outgoing requests carrying a canary, undeclared destinations, names that resolve to internal addresses, certificate pinning, direct IP connections without a name lookup, requests absent from the replay |

The conditions and wording of each rule are defined authoritatively in §3 and §6 of `docs/audit/plans/2026-10-03-audit-핵심-검사-구현계획.md`.
For `behavior`, `network`, and isolated execution, §3 and §6 of `docs/audit/plans/2026-10-03-audit-샌드박스-행위-관측-구현계획.md` are authoritative.

## Isolated execution (`--sandbox`)

Starts the server inside a disposable Docker container instead of on your machine, calls every tool with fixed payloads, and records the files it opened, the processes it spawned,
the connections it attempted, and the HTTP requests it sent out in the meantime.

```
mcpeak audit --sandbox -- node ./server.mjs
mcpeak audit --sandbox --compare-host -- node ./server.mjs
mcpeak audit --sandbox --allow-host api.example.com -- npx -y some-mcp-server@1.2.3
mcpeak audit --sandbox --sandbox-session ./server.session.json --json -- node ./server.mjs   # 녹화
mcpeak audit --sandbox --sandbox-replay ./server.session.json --json -- node ./server.mjs    # 재생
```

| Option | Meaning |
|---|---|
| `--sandbox` | Turns on isolated execution. Cannot be used with `--url` |
| `--sandbox-session <path>` | Records the HTTP round trips of the server inside isolation to this file |
| `--sandbox-replay <path>` | Answers only from this session file. Never connects upstream. Cannot be used with `--sandbox-session` |
| `--allow-host <host>` | Adds to the declared destinations. Repeatable. The host and its subdomains are treated as declared |
| `--compare-host` | Starts the server once more on this machine **without isolation**, fetches only `tools/list`, and compares it with the surface inside isolation |
| `--sandbox-mount <dir>` | A host directory to expose read-only to the container |

Things to know:

- **If isolation does not turn on, the server runs on this machine.** Without Docker, when the daemon does not respond, or when the command is not
  `node`, `npx`, or `npm`, the same checks run without isolation and the second line of the report gives the reason as "행위 관측 안 함: …" (behavior not observed: …).
  The exit code follows the result of those checks.
- **The default call policy differs.** A run with isolation actually on uses `all` (tools that change state are called too); a run without it
  uses `readonly`. If you pass `--probe` explicitly, that value applies either way (ADR-0107).
- **`--compare-host` starts the server once on this machine without isolation.** It fetches only the list and calls no tools, but
  the server's startup code runs on this machine. The option catches servers that detect isolation and present different tool definitions, and
  it is off by default (ADR-0108).
- **The network is intercepted, not cut.** The container's connections pass through a gateway, which records destination, headers, and body.
  A well-behaved server gets its responses as usual. Hosts that appear in tool descriptions, the README, `package.json`, or `--allow-host` are declared
  destinations and are only logged (`info`); any other destination is a finding. The container does not receive the host's environment variables.
- **What the container can see.** Without `--sandbox-mount`, it is the directory of the nearest
  `pnpm-workspace.yaml` above where you ran the command, or failing that the directory of the nearest `.git`, or failing both the directory you ran it in. It is mounted
  read-only at the same path as on the host. Your home directory and `/` are refused. If a file the server arguments point to lies outside that scope,
  it is refused.
- **Servers fetched and started via `npx` or `npm`.** Only when the command is `npx` or `npm` is an executable
  temporary area (512MB) opened at the container's `~/.npm`, because the npx/npm launcher has to download the package there and execute its bin. It is not opened for servers started
  with `node`, and `/tmp` is always non-executable (ADR-0109). What the launcher writes there on startup is
  not counted as a finding. A server writing there or executing from there during a call is not prevented; it only surfaces as a `behavior` finding.
  Packages larger than 512MB cannot be downloaded. Each run downloads afresh, so startup is slow.
- **Recording and replay.** The `--json` of two runs replayed from the same session file is identical down to the byte. The outputs of recording and replay
  differ only in the single `sandbox.network` value. A request that appears in replay but not in the recording is `network/replay-miss`.
- **Cleanup.** Containers, networks, and volumes carry the label `mcpeak.audit=1` and are removed when the run ends. If they cannot be removed,
  the report is emitted first, then what remains and the commands to clean it up by hand are written to stderr, and the run ends with exit code 1. If the process is
  killed during the audit (Ctrl-C and so on), there is no chance to remove them and they remain. In that case, clean up with the commands below.

  ```
  docker rm -f $(docker ps -aq --filter label=mcpeak.audit=1)
  docker network prune -f --filter label=mcpeak.audit=1
  docker volume rm $(docker volume ls -q --filter label=mcpeak.audit=1)
  ```

- The isolation image (`mcpeak-audit-sandbox:<내용 해시>`, tagged with a content hash) is built on the first run. It can take a few minutes.

An example is in `examples/sandbox-target-server` (a target made vulnerable on purpose).

## Design decisions

- **Verdicts are made only on this computer.** The rules are regular expressions, code point tables, schema checks, and hashes, and tool definitions are
  never sent out. For the same input, the `--json` output is identical down to the byte (ADR-0104).
- **Tool calls are read-only by default.** `--probe readonly` calls only tools whose readOnlyHint is true.
  `all` also calls tools that change state, so use it only in a disposable environment (ADR-0105).
- **The network inside isolation is observed by interception, not blocking.** Only runs with isolation actually on call every
  tool (ADR-0107). Traces of isolation cannot all be erased; the inside/outside surface comparison and the persistent comparison fill that gap (ADR-0108).
- **The server is never given real secrets.** When launching a stdio server, common secret names are filled with canary values, and if
  that value appears in a response, it is treated as a leak. Only names given explicitly with `--env` receive their real values. No value is ever written to the output.

## Limits

Even without `--sandbox`, the static families (`desc`, `schema`, `flow`, `launch`) and `protocol` and `surface` all run,
and the call results of tools called via `--probe` and echoes of secret values (`result`, `secret`) are examined too. What is not seen is `behavior` and
`network`, that is, the files the server code actually opened, the processes it spawned, and the connections it attempted. So zero findings does not mean
safe.

Description checking has two layers. Pattern rules (`desc/injection` and others) look for specific expressions, and the scoring rule (`desc/steering`)
measures, with 19 signals, how much a description is shaped to steer the model's tool use. On the 1,312 cases of the public poisoning benchmark MCPTox, the two
combined detect 99.1% of the originals, 97.3% of variants with substituted wording, 84.3% of variants planted directly in the targeted tool's description with the tone also changed,
and 63.2% of variants that spell out another tool's name with the tone also changed
(`docs/audit/benchmark/mcp-audit-recall/RESULTS.md`). The variants are mechanical substitutions, so the rate may be
lower on descriptions a person has carefully rewritten.

**It does not stop an attacker who knows how the checks work.** The rules and the score table are public in this repository, so writing around just the words that
act as signals leaves the scoring rule catching almost nothing (1.3% measured). What remains then is only content without which the attack would not work, that is, cases pointing to
credential paths or to addresses unrelated to the server, about 10% of the total. The scoring rule only looks at English descriptions.

The scoring rule's warning (medium) also fires on about 1% of legitimate tools. Legitimate descriptions that strongly instruct "always call X first"
are an example. The finding shows the evidence sentence together with the signals it triggered, so read it and decide.

`--sandbox` sees only the behavior observed in a single run. Behavior that changes with call count or over time, values exfiltrated in encrypted or
summarized form, the content of non-HTTP connections, and the content of connections that use certificate pinning are not seen. Container
traces (`/.dockerenv`, cgroup) cannot be erased, so some servers may detect isolation and behave themselves. Not
observed is not proof of absence.

## Using it as a library

```ts
import { audit, renderReport } from "@mcpeak/audit";
```

`audit(options, dependencies)` is a function into which connections, files, fetch, and randomness are all injected. Its shape is in `AuditDependencies` in
`src/audit.ts`, and the CLI wiring in `packages/cli/src/audit-command.ts` is an example.
