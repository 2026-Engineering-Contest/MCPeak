**English** · [한국어](./README.ko.md)

# @mcpeak/optimize

Shrinks an MCP server's tool definitions without changing their meaning, and starts a proxy that serves the shrunken definitions.
The server code is not touched. The only thing that changes is the `tools/list` the LLM sees; `tools/call` is
forwarded to the server as is, with the original names and arguments (ADR-0102).

## Usage

Two commands. First build the overlay, then let the proxy serve it.

```bash
# 1. 서버의 tools/list 를 읽어 오버레이를 만든다. 리포트가 stdout 에 나온다.
mcpeak optimize --out ./server.optimize.json -- node ./server.mjs

# 2. MCP 클라이언트 설정에서 서버 명령 자리에 프록시를 넣는다.
mcpeak-optimize-proxy ./server.optimize.json -- node ./server.mjs
mcpeak-optimize-proxy ./server.optimize.json --url http://localhost:3000/mcp
```

> Comments: 1. Read the server's tools/list and build the overlay. The report goes to stdout.
> 2. Put the proxy in place of the server command in the MCP client configuration.

`--out` is required. It doesn't invent a file name from the server name. For all options, see `mcpeak help optimize`.

On startup, the proxy compares the origin server's tool name list against the overlay. If the server has changed,
it refuses to serve and tells you to rebuild the overlay.

## What it changes: three safe-profile transformations

Only transformations that didn't change tool selection across 35 public servers, 210 model selection tests, and about 72,000 schema equivalence samples
are used (`docs/optimize/2026-09-27-mcp-도구-정의-압축-조사-실험.md`).

| Transformation | What it touches | Why it is safe |
|---|---|---|
| Lossless normalization | `$schema`·`$id`·`$comment`·`title` in `inputSchema`, `additionalProperties:true`, empty `required`·`properties` | The validation semantics don't change |
| Noise removal | URLs in descriptions, blocks after `Example:`, descriptions of three words or fewer that repeat the parameter name | Information the model doesn't use to pick a tool or fill arguments |
| Common parameter promotion | When a parameter with the same name and description repeats across three or more tools, its description goes once into a dictionary in the server `instructions` | The information isn't lost, only moved |

The expected reduction is a median of 12% per server, ranging from 1% to 38%. The reduction rate is decided by the server; what this tool guarantees is
that functionality is preserved. The transformer writes the overlay only after its own output passes a gate (a structural equivalence check between the original and the result).
If it doesn't pass, that's a defect in this tool, and the message says so.

## What it doesn't do

- Delete parameter descriptions, delete `default`, or delete `additionalProperties:false`. In measurements these caused wrong selections and missing
  arguments.
- Exclude, merge, or rename tools. That changes the call contract.
- Promote shared sentences into the server `instructions`. It left fragments in bulleted descriptions and turned tool-specific guidance global,
  causing regressions. It's planned to come back as an option once the defect is fixed.
- Relay resources·prompts. The proxy advertises tools only. If the origin has other capabilities, the report
  warns about it.

## Caution

Common parameter promotion preserves information only when the client shows the server `instructions` to the model.
In a client that ignores `instructions`, those parameter descriptions never reach the model. If such a
client is the target, take this into account before building the overlay.

Token counts are an approximation of UTF-8 bytes ÷ 4. The report marks them as "근사" (approximate).
