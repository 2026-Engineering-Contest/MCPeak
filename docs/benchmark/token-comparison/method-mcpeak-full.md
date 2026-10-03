## 방법

MCPeak 으로 검증한다. MCP 클라이언트를 직접 작성하지 마라. `npx -y @mcpeak/cli@latest` 로 실행하며
별도 설치는 필요 없다.

### 1. 서버 스키마에서 명세를 만든다

```bash
npx -y @mcpeak/cli@latest generate --out server.suite.json --baseline-only -- node ./server.mjs
```

서버의 `tools/list` 를 읽어 도구마다 정상 케이스와, `inputSchema` 의 축(필수 누락, 타입, enum,
범위)을 하나씩 어기는 거절 케이스를 만들어 `server.suite.json` 에 저장한다. 도구가 `outputSchema`
를 선언하면 정상 케이스에 응답 모양 검증도 붙는다.

### 2. 명세를 서버에 돌린다

```bash
npx -y @mcpeak/cli@latest test server.suite.json -- node ./server.mjs
```

케이스별 통과·실패와 실패 이유가 터미널에 찍힌다. 거절 케이스가 실패했다는 것은 서버가
거절해야 할 입력에 성공 응답을 냈다는 뜻이다. 그것이 결함이다.

정상 케이스가 실패하면 먼저 입력값을 의심하라. `generate` 는 스키마만 보고 `"example"` 같은
자리값을 넣으므로 서버가 모르는 값일 수 있다. 서버의 오류 메시지가 쓸 수 있는 값을 알려 주면
`mcpeak.fixtures.json` 에 적고 `--force` 로 다시 만든다.

```json
{ "schemaVersion": 1, "tools": { "<도구 이름>": { "<필드>": "<서버가 아는 값>" } } }
```

```bash
npx -y @mcpeak/cli@latest generate --out server.suite.json --baseline-only --force -- node ./server.mjs
```

허용되는 입력을 넣었는데도 거절하거나 오류가 나면 그것은 결함이다.

### 3. requirements.md 가 있으면 케이스를 보탠다

스키마에 없고 요구사항 문서에만 있는 제약은 `generate` 가 만들지 못한다. 그 제약을 어기는
케이스를 `server.suite.json` 의 `cases` 에 직접 추가하고 다시 `test` 를 돌린다. 케이스 형식은
다음과 같다.

```json
{
  "id": "<도구>-<필드>-<위반 축>",
  "name": "<필드> 가 <제약> 을 어기면 거절한다",
  "operation": { "type": "callTool", "tool": "<도구 이름>", "input": { "<필드>": "<제약을 어기는 값>" } },
  "assertions": [{ "type": "isError", "expected": true }]
}
```

`isError` 단언은 `-32602` 같은 JSON-RPC 오류도 거절로 본다.

### 4. 결과를 판정 규칙에 대조해 보고서를 쓴다

`test` 출력을 읽고 보고 형식대로 `report.md` 를 채운다. 명세 파일 경로를 보고서에 적는다.
