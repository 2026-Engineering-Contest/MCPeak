# Quick Start

After this page you can install `mcpeak`, start and validate an MCP server with a single JSON
suite, and see the pass/fail report directly in the terminal.

## Requirements

- Node.js 22.18 or later. CI checks 22.18.0 and 24.
- An MCP server to test. You don't need one yet; you can start with a [mock server](/guide/mock-server).

## Installation

```bash
npm install -g @mcpeak/cli
```

Installing puts the `mcpeak` command on your `PATH`. If you only need it once, you can skip the
install and run `npx @mcpeak/cli test ...` instead.

The mock server and the web UI are separate packages. A global install only puts that package's
own executable on `PATH`, so even though they come along as dependencies, the `mcpeak-mock` and
`mcpeak-dashboard` commands appear only if you install them separately.

```bash
npm install -g @mcpeak/cli @mcpeak/mock @mcpeak/dashboard
```

## Verify

```bash
mcpeak --help
```

The first line looks like this.

```
MCPeak — MCP 서버 테스트 프레임워크
```

`mcpeak --version` prints the installed version. Help and version are not errors, so they go to
stdout and the exit code is 0.

## Your first test in 5 minutes

### 1. Write a suite

Write what you want to test as JSON. Each case states what to do to the server (`operation`) and
what you expect from the result (`assertions`).

```json
{
  "schemaVersion": 1,
  "id": "weather",
  "name": "날씨 서버",
  "cases": [
    {
      "id": "tool-exists",
      "name": "get_weather 도구를 제공한다",
      "operation": { "type": "listTools" },
      "assertions": [{ "type": "toolExists", "tool": "get_weather" }]
    },
    {
      "id": "seoul-succeeds",
      "name": "서울 날씨를 정상 조회한다",
      "operation": { "type": "callTool", "tool": "get_weather", "input": { "city": "서울" } },
      "assertions": [{ "type": "isError", "expected": false }]
    }
  ]
}
```

Save it as `weather.suite.json`. For the full list of fields, see the
[suite format](/reference/suite-spec).

### 2. Pass it along with how to start the server

Everything after `--` is the command that starts the server. The first token is the executable,
the rest are its arguments, and nothing after `--` is parsed further, so you can pass values like
`--port 0` through unchanged.

```bash
mcpeak test weather.suite.json -- node ./server.mjs
```

::: tip If you don't have a server to attach yet
`examples/weather-server/` in the repository is an example server that passes the suite above as
is. If you only installed via npm, start a [mock server](/guide/mock-server) instead. Add one
more mock definition JSON file, and the same two cases pass unchanged.
:::

### 3. Read the report

```
날씨 서버  (2 cases)

✓ tool-exists     get_weather 도구를 제공한다
✓ seoul-succeeds  서울 날씨를 정상 조회한다

2 passed  (2 total)
```

The exit code is 0 if everything passes and 1 if anything fails. A failure produces one of two
kinds of output.

If a case fails, the output shows which assertion differs from what, why, and how to fix it.

```
✗ missing-tool  존재하지 않는 도구를 요구한다
    toolExists  툴 'missing_weather_tool'을(를) 찾을 수 없습니다. 발견된 툴: 'add', 'get_weather'
    해결: 서버의 tools/list 응답과 테스트 명세를 확인하세요.

1 failed  (1 total)

명세: 승인 지문이 없습니다 (미고정)
  → mcpeak generate 로 승인한 명세가 아니거나 승인 이전 버전으로 만든 파일입니다.
```

The last two lines are attached to suites written by hand. For a suite approved via `generate`,
they instead report whether it still matches the approved version.

If the run itself fails because the suite can't be read or the server can't be reached, the
output shows the cause code and how to fix it.

```
오류 [MCP_CONNECTION_FAILED/PROCESS_START_FAILED]: MCP 서버 프로세스를 시작하지 못했습니다.
해결: command 실행 가능 여부와 cwd를 확인하세요.
```

## Next steps

You don't have to write suites by hand. [Generating a suite](/guide/generate) covers the flow
that reads the server's tool schemas and builds a suite for you. See
[Writing a suite](/guide/writing-suites) for what you can put in a case. If the server calls a
paid API, use [External sessions](/guide/external-sessions) to record that call once. See
[How it works](/concepts/how-it-works) for how the pieces fit together internally.
