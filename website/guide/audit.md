# Audit

After this page you can check an MCP server's tool definitions, launch command, and protocol responses for security risks before registering it, and you know how to read the findings to decide whether to register it. The server code is not touched.

## Checking in one line

```bash
mcpeak audit -- node ./server.mjs
```

It starts the server, reads `tools/list` along with prompts, resources, and instructions, and actually calls the tools whose `readOnlyHint` is `true` to inspect their responses. The server is specified the same way as for `test`.

```bash
mcpeak audit --command npx --arg -y --arg some-mcp-server@1.2.3 --env GITHUB_TOKEN
mcpeak audit --url https://mcp.example.com/mcp --header-env Authorization=MCP_TOKEN
```

## Reading the result

`examples/audit-target-server` is a server made vulnerable on purpose. Auditing it prints this.

```
mcpeak audit 결과
서버 audit-target-server 0.0.0 · 도구 6개 · 프롬프트 0개 · 리소스 0개 · instructions 없음
호출 정책 readonly · 호출한 도구 3개

판정: 심각 5건, 주의 1건, 낮음 0건, 정보 0건

[심각] desc/injection · 도구 'add_numbers' 의 description
  → 모델에게 내리는 지시가 있습니다: "<IMPORTANT>" (raw 형에서 발견)
  해결: 이 서버를 신뢰하지 않는다면 등록하지 마세요. 서버 작성자라면 설명에서 모델 지시를 빼세요.

[심각] secret/env-leak · 도구 'echo_env' 호출 응답의 content[0].text
  → 환경변수 GITHUB_TOKEN 에 심은 값이 응답에 나왔습니다
  해결: 서버가 환경변수를 읽어 밖으로 냅니다. 등록하지 마세요.

[주의] schema/secret-field · 도구 'translate_text' 의 inputSchema.properties.api_key
  → 비밀값을 인자로 요구합니다: 'api_key'
  해결: 비밀은 인자가 아니라 서버 환경변수로 받아야 합니다. 모델 컨텍스트에 비밀이 실립니다.
```

Each finding is three lines: `[severity] family/rule · location`, what was seen, and what to do. The exit code is 2 when there is a critical or warning finding, 0 when there is none, and 1 on a connection or input failure. Permission combination warnings (`flow`) and informational findings do not affect the exit code.

The "not checked" section at the end of the report lists the families skipped in this run and why. When no tool has `readOnlyHint` set to `true`, the call checks (`result`, `secret`) are empty, and for a stdio target `protocol` is empty.

## What it looks at

| Family | What it checks |
|---|---|
| `desc` | Every string in tools, prompts, resources, and instructions. Model instructions, hidden side effects, shadowing of other tools, invisible characters, ANSI escapes, long encoded strings |
| `schema` | Secret arguments, free text fields that could carry the conversation, mismatch between `readOnlyHint` and the name, missing `destructiveHint` on destructive names |
| `flow` | The combination of reading external input, accessing private data, and writing externally all in one server (warning) |
| `launch` | Inline code in the launch command, piping remote scripts to a shell, unpinned package versions, forwarding real env |
| `protocol` | Plain HTTP, accepting without authentication, no Origin check, session identifiers in URLs, instructions inside server initiated requests |
| `secret` | Leaks of canary env values, echoes of forwarded real values |
| `result` | Model instructions, invisible characters, ANSI, oversized content in call responses |
| `surface` | The difference between the `--baseline` file and the current tool definitions |
| `behavior` · `network` | (`--sandbox`) Reading decoy credentials, child processes, requests to undeclared destinations |

Verdicts are made entirely on this machine. The rules are regular expressions, code point tables, schema checks, and hashes, and tool definitions are never sent out. For the same server and the same command, the `--json` output is identical down to the byte.

## Secrets are never given to the server

When launching a stdio server, common secret names such as `GITHUB_TOKEN` are filled with fake values (canaries). If the server emits that value in a response, it is leaking environment variables and that is reported as a finding. Names passed with `--env` receive the real value instead of a canary, and the audit also checks whether that value shows up in responses. No value is ever written to the output.

## Tracking tool definition changes

To catch a server that changes its tool definitions after approval, keep a baseline file.

```bash
mcpeak audit --baseline ./server.audit.json -- node ./server.mjs
```

If the baseline file does not exist it is created. If it does, the current definitions are compared against it and changed tools are reported as `surface` findings. When the server update is intentional, rewrite the baseline with `--update-baseline`.

## Observing behavior in isolation

Adding `--sandbox` starts the server inside a disposable Docker container instead of on this machine, calls every tool with fixed payloads, and records the files it opened, the processes it spawned, the connections it attempted, and the HTTP requests it sent out in the meantime.

```bash
mcpeak audit --sandbox -- node ./server.mjs
mcpeak audit --sandbox --allow-host api.example.com -- npx -y some-mcp-server@1.2.3
```

Four things to know.

- If isolation does not turn on, the server runs on this machine. Without Docker, or when the command is not `node`, `npx`, or `npm`, the same checks run without isolation and the second line of the report states the reason.
- The default call policy differs. A run with isolation actually on uses `all` (tools that change state are called too); a run without it uses `readonly`. If you pass `--probe` explicitly, that value applies either way.
- The network is intercepted, not cut. Hosts that appear in tool descriptions, the README, `package.json`, or `--allow-host` are declared destinations and are only logged; any other destination is a finding. The container does not receive the host's environment variables.
- Containers, networks, and volumes carry the label `mcpeak.audit=1` and are removed when the run ends. If the audit is killed midway they remain, so check with `docker ps -a --filter label=mcpeak.audit=1` and clean up.

HTTP round trips inside the sandbox are recorded with `--sandbox-session` and replayed with `--sandbox-replay`. Two runs replayed from the same session file produce byte identical `--json`. The full option list is in the [CLI reference](/reference/cli#audit).

## Limits

Without `--sandbox`, only the wording of descriptions and the protocol surface are examined. Paraphrased instructions and the actual behavior of the server code are not seen, so zero findings does not mean safe. `--sandbox` sees only the behavior observed in a single run. Behavior that changes with call count or over time, and values exfiltrated in encrypted form, are not seen. Not observed is not proof of absence.

## From the dashboard

The security tab of the [dashboard](/guide/dashboard)'s Analyze screen runs the same audit. The verdict comes from the same function the CLI uses.
