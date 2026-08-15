# OhMyMCP

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

MCP(Model Context Protocol) 서버를 **코드로 자동 테스트**하는 오픈소스 프레임워크.
서버를 띄우고, 응답을 검증하고, 녹화·재생하고, 목 서버로 대체하는 것을 하나의 도구로 한다.

> ⚠️ **아직 npm 에 배포되지 않았습니다.** 여섯 패키지 모두 동작하지만 공개 배포 전이라,
> 지금은 저장소를 클론해 [개발](#개발) 절차로 써야 합니다.
>
> 아래 예제의 `ohmymcp` · `ohmymcp-mock` 은 **배포 후의 호출 형태**입니다. 배포 전에는 같은 명령을
> 빌드 산출물 경로로 부릅니다 — [개발](#개발) 절에 세 명령 모두 적어뒀습니다.

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
ohmymcp test weather.suite.json --command node --arg ./server.js
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
ohmymcp generate --suite-id weather --name "날씨 서버" --out weather.suite.json \
  --command node --arg ./server.js
```

기본은 실제 서버에 한 번 돌려보고(시험 실행) 사람이 승인하는 흐름입니다.
`--baseline-only` 를 붙이면 AI 없이 결정론적으로만 만듭니다.

## CLI

```
ohmymcp test <suite.json> --command <executable> [--arg <value> ...]
             [--json] [--junit <path>] [--stderr-lines <N>]

ohmymcp generate --suite-id <id> --name <name> --out <suite.json>
                 --command <executable> [--arg <value> ...]
                 [--baseline-only] [--provider <codex|claude>] [--model <model>]
                 [--no-dry-run] [--cassette <path>] [--record]
                 [--reset-cmd <command>] [--no-repair]
```

`--command` 와 `--arg` 가 **테스트 대상 서버를 띄우는 방법**입니다. `--arg` 를 여러 번 써서
인자를 순서대로 넘깁니다.

전체 도움말은 `ohmymcp --help`, 서브커맨드는 `ohmymcp help test` 로 봅니다.

## 실제 서버 없이 테스트하기

목 서버를 대신 띄우면 외부 API 키도 실제 데이터도 없이 원하는 상황을 세울 수 있습니다.

```bash
ohmymcp test suite.json --command ohmymcp-mock --arg mock.json
```

```json
{
  "tools": [{ "name": "get_weather", "inputSchema": { "type": "object" } }],
  "responses": [{ "tool": "get_weather", "args": { "city": "서울" }, "result": { "tempC": 21 } }]
}
```

응답은 **사람이 지정한 값**입니다(ADR-0005). 같은 호출은 언제나 같은 바이트를 돌려줍니다.

## 기존 도구와의 차이

- **실패 메시지가 곧 제품이다.** `expected true, got false` 가 아니라 *무엇이 왜 다른지, 어떻게
  고치는지*를 출력한다.
- **결정론적.** 같은 입력 → 같은 결과. 녹화·재생으로 네트워크 없이 재현한다.
- **스키마 → 테스트 자동 생성.** 툴 스키마에서 테스트 케이스를 합성한다.

## 패키지

| 패키지 | 역할 |
|---|---|
| [`ohmymcp`](./packages/cli) | CLI 진입점 (얇게 유지) |
| [`@ohmymcp/core`](./packages/core) | MCP 프로토콜 클라이언트 · 트랜스포트 · 프로세스 수명주기 |
| [`@ohmymcp/runner`](./packages/runner) | 선언형 테스트 실행 · assertion · 구조화된 리포트 |
| [`@ohmymcp/generate`](./packages/generate) | 결정론적 baseline 과 승인형 AI 검토로 테스트 생성 |
| [`@ohmymcp/record`](./packages/record) | 녹화 · 재생 · 계약 스냅샷 |
| [`@ohmymcp/mock`](./packages/mock) | 목 MCP 서버(Streamable HTTP · stdio) · 응답 주입 |

의존 방향은 단방향입니다: `cli` → `runner`/`generate`/`record`/`mock` → `core`.

## 설계 결정

"다르게 갈 수도 있었던" 판단은 [`docs/adr/`](./docs/adr) 에 한 페이지씩 남아 있습니다.
무엇이 살아 있는 API 인지는 ADR 과 소스의 `@deprecated` 주석이 기준입니다.

## 개발

```bash
corepack enable       # pnpm 활성화 (packageManager 핀 사용)
pnpm install
pnpm build            # 6개 패키지 dist/ 생성
pnpm typecheck
pnpm test
pnpm lint
```

배포 전이라 실행 파일이 `PATH` 에 없습니다. 위 예제의 명령들은 빌드 산출물로 직접 부릅니다.

```bash
# ohmymcp test ...
node packages/cli/dist/cli.mjs test <suite.json> --command node --arg ./server.js

# ohmymcp generate ...
node packages/cli/dist/cli.mjs generate --suite-id <id> --name <name> --out <suite.json> \
  --command node --arg ./server.js

# --command ohmymcp-mock --arg mock.json
node packages/cli/dist/cli.mjs test <suite.json> \
  --command node --arg packages/mock/dist/stdio.mjs --arg mock.json
```

Node 20 · 22 · 24 에서 검사하며, 빌드는 Node 22 이상이 필요합니다.

기여 규칙은 [CONTRIBUTING.md](./CONTRIBUTING.md) 를 먼저 읽으세요.

## 라이선스

[MIT](./LICENSE)
