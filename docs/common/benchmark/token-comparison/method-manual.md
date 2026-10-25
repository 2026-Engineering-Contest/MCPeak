## 방법

MCP 클라이언트를 직접 작성해 서버를 호출한다. 다른 MCP 테스트 프레임워크나 CLI 를 설치하거나
사용하지 마라. 아래 순서를 따르면 된다.

### 1. 클라이언트 스크립트 하나로 모든 호출을 모은다

`@modelcontextprotocol/sdk` 가 설치돼 있다. 다음 골격으로 `verify.mjs` 하나를 만들고, 모든
케이스를 이 파일에서 순서대로 실행해 결과를 JSON 으로 출력하게 하라. 케이스마다 프로세스를
새로 띄우지 마라.

```js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "verify", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["./server.mjs"] }));

const { tools } = await client.listTools();
// tools[i].name, tools[i].inputSchema 를 읽고 케이스를 만든다.

async function call(tool, input) {
  try {
    const res = await client.callTool({ name: tool, arguments: input });
    return { kind: res.isError ? "rejected" : "ok", res };
  } catch (err) {
    return { kind: "rejected", error: String(err) }; // JSON-RPC 오류(-32602 등)
  }
}

// ... 케이스 실행 ...
await client.close();
```

### 2. 케이스는 스키마(또는 requirements.md)에서 뽑는다

도구마다 다음을 만든다.

- 정상 케이스 1건. 값은 `examples`, `default`, `enum` 의 첫 값, 없으면 타입에 맞는 임의값 순으로
  고른다. 객체는 필수 프로퍼티만 채운다.
- 위반 케이스: 필수 필드마다 누락 1건, 필드마다 타입 불일치 1건, `enum` 필드마다 enum 밖 값 1건,
  범위·길이·개수 제약마다 상한·하한 밖 값 각 1건.

### 3. 결과를 판정 규칙에 대조해 보고서를 쓴다

스크립트 출력을 읽고 보고 형식대로 `report.md` 를 채운다. 판정이 애매하면 호출을 다시 해서
확인하고, 그래도 모르겠으면 "검증하지 못한 것" 에 적는다.
