# Optimize

After this page you can build an overlay that shrinks an MCP server's tool definitions without changing their meaning, and you know how to plug the proxy that serves that overlay into an MCP client. The server code is not touched.

## Two commands

First build the overlay, then let the proxy serve it.

```bash
# 1. Read the server's tools/list and build the overlay. The report goes to stdout.
mcpeak optimize --out ./server.optimize.json -- node ./server.mjs

# 2. Put the proxy in place of the server command in the MCP client configuration.
mcpeak-optimize-proxy ./server.optimize.json -- node ./server.mjs
mcpeak-optimize-proxy ./server.optimize.json --url http://localhost:3000/mcp
```

`--out` is required. It does not invent a file name from the server name. The server is specified the same way as for `test`.

The only thing that changes is the `tools/list` the LLM sees. `tools/call` is forwarded to the server with the original names and arguments. On startup the proxy compares the origin server's tool name list against the overlay, and if the server has changed it refuses to serve and tells you to rebuild the overlay.

## Reading the report

Running it against `examples/live-weather-server` prints this.

```
mcpeak optimize 결과
서버 도구 10개, instructions 없음

크기 (UTF-8 바이트, 토큰은 바이트÷4 근사)
  원본            4443  (~1111 토큰)
  압축            3923  (~981 토큰, 11.7% 감소)
  instructions 증가분 0  (공통 파라미터 0개를 사전으로 옮김)

변환별 기여
  무손실 정규화        -520 바이트
  잡음 제거            -0 바이트
  공통 파라미터 승격   -0 바이트 (사전 +0 포함)

가장 많이 줄어든 도구
  get_forecast  337 → 285  (15.4%)
  convert_currency  508 → 456  (10.2%)

이 오버레이는 tools/list 만 바꿉니다. tools/call 은 원본 이름과 인자로 서버에 전달됩니다.
```

Token counts are an approximation of UTF-8 bytes ÷ 4. The reduction rate is decided by the server; what this tool guarantees is that functionality is preserved. With `--json` the overlay JSON goes to stdout instead of the report.

## What it changes

Only transformations that did not change tool selection across 35 public servers, 210 model selection tests, and about 72,000 schema equivalence samples are used. The expected reduction is a median of 12% per server, ranging from 1% to 38%.

| Transformation | What it touches | Why it is safe |
|---|---|---|
| Lossless normalization | `$schema`, `$id`, `$comment`, `title` in `inputSchema`, `additionalProperties:true`, empty `required` and `properties` | The validation semantics do not change |
| Noise removal | URLs in descriptions, blocks after `Example:`, descriptions of three words or fewer that repeat the parameter name | Information the model does not use to pick a tool or fill arguments |
| Common parameter promotion | When a parameter with the same name and description repeats across three or more tools, its description is written once into a dictionary in the server `instructions` | The information is not lost, only moved |

The transformer writes the overlay only after its own output passes a gate (a structural equivalence check between the original and the result). If it does not pass, that is a defect in this tool, and the message says so.

## What it does not do

- Delete parameter descriptions, delete `default`, or delete `additionalProperties:false`. In measurements these caused wrong selections and missing arguments.
- Exclude, merge, or rename tools. That changes the call contract.
- Relay resources and prompts. The proxy advertises tools only. If the origin has other capabilities, the report warns about it.

## Caution

Common parameter promotion preserves information only when the client shows the server `instructions` to the model. In a client that ignores `instructions`, those parameter descriptions never reach the model. If such a client is the target, take this into account before building the overlay.

## From the dashboard

The tokens tab of the [dashboard](/guide/dashboard)'s Analyze screen runs the same transformation and shows the report. The screen does not save the overlay to a file, so build the file for the proxy with the CLI.
