---
"@mcpeak/cli": minor
---

`mcpeak optimize` 서브커맨드를 추가한다. 서버의 `tools/list` 를 읽어 기능을 바꾸지 않고 토큰을 줄인 오버레이를 `--out` 에 쓰고, 변환별 기여를 담은 리포트를 stdout 에 낸다. `--json` 이면 리포트 대신 오버레이 JSON 을 낸다. 대상 옵션(`--`, `--command`/`--arg`/`--env`, `--url`/`--header-env`)은 `test`·`generate` 와 같은 규칙과 오류 문장을 쓴다. 만든 오버레이는 `mcpeak-optimize-proxy <overlay.json> -- <서버 명령>` 으로 띄워 MCP 클라이언트에 붙인다.
