---
"@mcpeak/generate": minor
---

`runProviderProcess` 를 공개 면에 연다. 임시 cwd · 타임아웃 · 출력 상한 · bounded 종료를 한 곳에 둔 프로세스 기계이고, 지금까지 타입만 나가고 값이 없어서 부르는 쪽이 잡을 수 없었다. 대시보드의 4 단계 「실제 응답」이 같은 기계로 AI 를 띄우면서 그것을 다시 만들지 않게 한다.

`CLAUDE_ENV_ALLOWLIST` 와 `CODEX_ENV_ALLOWLIST` 를 같이 연다. `runProviderProcess` 는 환경변수를 거르지 않고 `spec.env` 를 그대로 넘기는데, 지금까지 공개된 목록은 두 provider 의 **합집합** 하나뿐이었다. 그것을 쓰면 `claude` 자식이 OpenAI 자격증명을, `codex` 자식이 Anthropic 자격증명을 받는다. 자격증명은 provider 별로 맞춘다(ADR-0104). 합집합은 기존 소비자를 위해 그대로 둔다.

MCP 를 여는 argv(`--mcp-config` · `--allowedTools`)는 같이 나가지 않는다. 합성 경로의 AI 는 케이스를 짓는 저자라 MCP 를 닫아 둬야 하고, 여는 판단은 부르는 쪽이 진다. 새 타입은 없다 — `ProviderProcessSpec` 등 7 개는 이미 나가 있었다.
