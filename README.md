# MCPeak

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![npm](https://img.shields.io/npm/v/%40mcpeak%2Fcli)](https://www.npmjs.com/package/@mcpeak/cli)

MCP(Model Context Protocol) 서버를 **코드로 자동 테스트**하는 오픈소스 프레임워크.
서버를 띄우고, 응답을 검증하고, 녹화·재생하고, 목 서버로 대체하는 것을 하나의 도구로 한다.

```bash
npm install -g @mcpeak/cli
```

설치하면 `mcpeak` 명령이 `PATH` 에 놓입니다. 한 번만 쓸 거라면 설치 없이
`npx @mcpeak/cli test ...` 도 됩니다.

목 서버([실제 서버 없이 테스트하기](#실제-서버-없이-테스트하기))나 웹 UI 를 함께 쓰려면 각각
설치합니다. **전역 설치는 그 패키지 자신의 실행 파일만 `PATH` 에 놓으므로**, 의존성으로 딸려
와도 `mcpeak-mock` · `mcpeak-dashboard` 는 따로 설치해야 생깁니다.

```bash
npm install -g @mcpeak/cli @mcpeak/mock @mcpeak/dashboard
```

## 30초 예제

테스트할 것을 **JSON 명세**로 적고,

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

서버를 띄우는 방법과 함께 넘긴다.

```bash
mcpeak test weather.suite.json --command node --arg ./server.js
```

```
날씨 서버  (2 cases)

✓ tool-exists      get_weather 도구를 제공한다
✓ seoul-succeeds   서울 날씨를 정상 조회한다

2 passed  (2 total)
```

실패는 전부 종료 코드 `1` 이지만 출력은 두 갈래입니다.

- **케이스가 실패하면** 어느 단언이 무엇과 왜 다른지, 그리고 어떻게 고치는지가 나옵니다.
  ```
  ✗ missing-tool  존재하지 않는 도구를 요구한다
      toolExists  툴 'missing_weather_tool'를 찾을 수 없습니다.
      해결: 서버의 tools/list 응답과 테스트 명세를 확인하세요.
  ```
- **명세를 못 읽거나 서버에 못 붙는 등 실행 자체가 실패하면** 원인 코드와 해결 방법이 나옵니다.
  ```
  오류 [MCP_CONNECTION_FAILED/PROCESS_START_FAILED]: MCP 서버 프로세스를 시작하지 못했습니다.
  해결: command 실행 가능 여부와 cwd를 확인하세요.
  ```

## 명세를 직접 안 써도 됩니다

서버의 툴 스키마를 읽어 명세를 만들어 줍니다.

```bash
mcpeak generate --suite-id weather --name "날씨 서버" --out weather.suite.json \
  --command node --arg ./server.js
```

기본은 실제 서버에 한 번 돌려보고(시험 실행) 사람이 승인하는 흐름입니다.
`--baseline-only` 를 붙이면 AI 없이 결정론적으로만 만듭니다.

## CLI

```
mcpeak test <suite.json> --command <executable> [--arg <value> ...]
             [--json] [--junit <path>] [--stderr-lines <N>]
             [--record-session <path> | --session <path>]

mcpeak generate --suite-id <id> --name <name> --out <suite.json>
                 --command <executable> [--arg <value> ...]
                 [--baseline-only] [--provider <codex|claude>] [--model <model>]
                 [--no-dry-run] [--reset-cmd <command>] [--no-repair] [--force]
```

`--command` 와 `--arg` 가 **테스트 대상 서버를 띄우는 방법**입니다. `--arg` 를 여러 번 써서
인자를 순서대로 넘깁니다.

전체 도움말은 `mcpeak --help`, 서브커맨드는 `mcpeak help test` 로 봅니다.

`--record-session` 과 `--session` 은 **테스트 대상 서버가 밖으로 부르는 HTTP 호출**을 녹화·재생
합니다. [외부 API 를 부르는 서버](#외부-api-를-부르는-서버) 를 보세요.

## 실제 서버 없이 테스트하기

목 서버를 대신 띄우면 외부 API 키도 실제 데이터도 없이 원하는 상황을 세울 수 있습니다.

```bash
mcpeak test suite.json --command mcpeak-mock --arg mock.json
```

```json
{
  "tools": [
    {
      "name": "get_weather",
      "inputSchema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "responses": [{ "tool": "get_weather", "args": { "city": "서울" }, "result": { "tempC": 21 } }]
}
```

응답은 **사람이 지정한 값**입니다(ADR-0005). 같은 호출은 언제나 같은 바이트를 돌려줍니다.

목은 **서버를 만들기 전에 설계를 먼저 검증하는 데**도 씁니다 — 정의 파일로 띄워 Claude Desktop
같은 실제 클라이언트에 붙여보고, 거기서 `generate` 로 구현자에게 넘길 계약 초안을 뽑습니다.
절차는 [`packages/mock` 의 설계 우선 워크플로](./packages/mock#설계-우선-워크플로)에 있습니다.

## 외부 API 를 부르는 서버

목으로 대체할 수 없는 것이 하나 있습니다 — **테스트 대상 서버 자신이 밖으로 부르는 HTTP 호출**
입니다. 날씨 API, 결제, webhook 처럼 서버 안쪽에서 나가는 호출은 서버를 목으로 바꿔치기해도
그대로 남고, 두면 테스트를 돌릴 때마다 실제로 나갑니다.

External 세션은 그 호출을 한 번 녹화해 두고 이후 실행에서 재생합니다. **재생할 때도 서버는 실제로
뜹니다** — 멈추는 것은 서버가 아니라 그 서버가 밖에 부르는 쪽입니다.

```bash
# 1) 한 번은 진짜로 나갑니다. 그 응답이 세션 파일에 남습니다.
mcpeak test weather.suite.json --command node --arg ./server.js \
  --record-session weather.session.db

# 2) 이후로는 세션 파일에서 재생합니다. 외부 API 는 부르지 않습니다.
mcpeak test weather.suite.json --command node --arg ./server.js \
  --session weather.session.db
```

**잡는 범위는 서버가 `globalThis.fetch` 로 부른 호출입니다.** `node:http`·`node:https`, 그리고
그것을 직접 쓰는 axios·got·node-fetch 로 부르는 서버는 범위 밖입니다. Node 가 아닌 서버(Python·
Go 등)도 범위 밖입니다 — 주입이 Node 의 `--import` 훅이라 애초에 닿지 않습니다. 범위 밖 호출은
**재생되지 않고 실제 네트워크로 나갑니다.** 그럴 정황이 보이면 — 녹화가 0건이거나 재생이 0건이면
— 실행이 끝날 때 알려줍니다.

```
알림: 이 실행에서 외부 호출이 하나도 녹화되지 않았습니다.
→ 서버가 외부 API를 호출했다면 지원 범위를 벗어났는지 확인하세요.
→ MCPeak은 서버가 `globalThis.fetch`로 부른 것만 잡습니다.
```

세션 파일에는 외부 API 응답이 그대로 들어갑니다. `token`·`apiKey` 처럼 **이름**으로 알아볼 수 있는
값은 저장 전에 가려지지만 URL 경로는 아직 남습니다. `.gitignore` 를 확인하고, 경로 자체가
자격증명인 webhook 을 녹화한 파일은 커밋하지 마세요
([자세히](./packages/record#external-세션의-url-경로는-아직-저장된다)).

범위를 이렇게 정한 이유는
[ADR-0057](./docs/adr/0057-external-어댑터는-global-fetch-까지만-가로챈다.md) 에 있습니다.

## 기존 도구와의 차이

- **실패 메시지가 곧 제품이다.** `expected true, got false` 가 아니라 *무엇이 왜 다른지, 어떻게
  고치는지*를 출력한다.
- **결정론적.** 같은 입력 → 같은 결과. 녹화·재생으로 네트워크 없이 재현한다.
- **스키마 → 테스트 자동 생성.** 툴 스키마에서 테스트 케이스를 합성한다.

## 패키지

| 패키지 | 역할 |
|---|---|
| [`@mcpeak/cli`](./packages/cli) | CLI 진입점 (얇게 유지) |
| [`@mcpeak/core`](./packages/core) | MCP 프로토콜 클라이언트 · 트랜스포트 · 프로세스 수명주기 |
| [`@mcpeak/runner`](./packages/runner) | 선언형 테스트 실행 · assertion · 구조화된 리포트 |
| [`@mcpeak/generate`](./packages/generate) | 결정론적 baseline 과 승인형 AI 검토로 테스트 생성 |
| [`@mcpeak/record`](./packages/record) | 녹화 · 재생 · 계약 스냅샷 |
| [`@mcpeak/mock`](./packages/mock) | 목 MCP 서버(Streamable HTTP · stdio) · 응답 주입 |
| [`@mcpeak/dashboard`](./packages/dashboard) | 로컬 웹 UI. `mcpeak-dashboard` 로 띄웁니다 ([ADR-0046](./docs/adr/0046-대시보드를-로컬-웹서버로-만든다.md), 제안) |

의존 방향은 단방향입니다: `cli` → `runner`/`generate`/`record`/`mock` → `core`.
`dashboard` 는 `cli` 가 공개하는 `@mcpeak/cli/commands` 를 불러 같은 커맨드 함수를 씁니다 —
판정 로직을 두 벌 만들지 않기 위해서입니다.

## 설계 결정

"다르게 갈 수도 있었던" 판단은 [`docs/adr/`](./docs/adr) 에 한 페이지씩 남아 있습니다.
무엇이 살아 있는 API 인지는 ADR 과 소스의 `@deprecated` 주석이 기준입니다.

## 개발

```bash
corepack enable       # pnpm 활성화 (packageManager 핀 사용)
pnpm install
pnpm build            # 7개 패키지 + 예제 서버 dist/ 생성
pnpm typecheck
pnpm test
pnpm lint
```

저장소에서 작업할 때는 설치본 대신 **빌드 산출물**을 부릅니다. 고친 코드가 바로 반영됩니다.

```bash
# mcpeak test ...
node packages/cli/dist/cli.mjs test <suite.json> --command node --arg ./server.js

# mcpeak generate ...
node packages/cli/dist/cli.mjs generate --suite-id <id> --name <name> --out <suite.json> \
  --command node --arg ./server.js

# --command mcpeak-mock --arg mock.json
node packages/cli/dist/cli.mjs test <suite.json> \
  --command node --arg packages/mock/dist/stdio.mjs --arg mock.json
```

> `pnpm build` 를 건너뛰면 낡은 `dist/` 를 뭅니다. 소스를 고쳤으면 다시 빌드하세요.

Node 22.18 이상을 지원하며, CI는 최소 버전인 22.18.0과 Node 24에서 검사합니다.

> **Node 25 에서는 `packages/dashboard/web` 테스트 13건이 실패합니다.** `engines.node` 는 하한만
> 정하므로 Node 25 설치가 막히지는 않지만, CI 검증 대상이 아닙니다. 자기 변경과 무관하니 [#212](https://github.com/2026-Engineering-Contest/MCPeak/issues/212) 를 보세요.

기여 규칙은 [CONTRIBUTING.md](./CONTRIBUTING.md) 를 먼저 읽으세요.

## 라이선스

[MIT](./LICENSE)
