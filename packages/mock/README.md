# @ohmymcp/mock

목 MCP 서버 · 응답 주입. **Streamable HTTP** 와 **stdio** 두 가지로 뜬다.

- **오너:** `@storyrago` (③ mock server 파트)
- **의존:** `@ohmymcp/core` · `@modelcontextprotocol/sdk` (catalog, 1.x 고정)

실제 MCP 서버 없이, MCP 를 사용하는 프로그램을 테스트하기 위한 것이다.
외부 API 키도 실제 데이터도 없이 원하는 상황을 그대로 세워둘 수 있다.

## 어느 쪽을 쓰나

| | 대상 | 응답 주입 |
|---|---|---|
| **HTTP** `createMockServer` | MCP 를 사용하는 **외부 프로그램** | 띄운 뒤 `on()` 으로 |
| **stdio** `ohmymcp-mock` | **우리 도구**(`ohmymcp test`) | 정의 파일에 미리 |

`core.connect()` 가 아직 stdio 만 알기 때문에 갈린다 (#16). 자세한 배경은 ADR-0007.

## HTTP — 외부 프로그램용

```ts
import { ANY, createMockServer } from "@ohmymcp/mock";

const mock = await createMockServer({ tools });      // tools: ToolDef[]
mock.on("add", { a: 1, b: 2 }, { sum: 3 });          // 인자를 지정
mock.on("add", ANY, { sum: 0 });                     // 나머지 전부

console.log(mock.url);   // http://127.0.0.1:53211/mcp
// ...테스트 대상 프로그램을 이 주소에 연결한다...

await mock.close();
```

## stdio — 우리 도구용

정의 파일을 만들고,

```json
{
  "tools": [
    { "name": "add", "inputSchema": { "type": "object", "properties": { "a": { "type": "number" }, "b": { "type": "number" } } } }
  ],
  "responses": [
    { "tool": "add", "args": { "a": 1, "b": 2 }, "result": { "sum": 3 } },
    { "tool": "add", "result": { "sum": 0 } }
  ]
}
```

`ohmymcp test` 의 대상으로 지정한다.

```bash
ohmymcp test suite.json --command ohmymcp-mock --arg definition.json
```

프로세스가 곧 서버라 실행 중에는 응답을 주입할 수 없다. 그래서 정의 파일에 미리 적는다.

## 응답 매칭 규칙

두 진입점이 **같은 규칙**을 쓴다.

1. **인자를 지정한 응답이 우선한다.**
2. 없으면 `ANY`(정의 파일에서는 `args` 생략)가 받는다.
3. 그것도 없으면 `isError: true` 와 함께 무엇이 등록돼 있는지 알려준다.

`ANY` 는 편하지만 **잘못된 인자로 불러도 통과**하게 만든다. 기본은 인자 지정이고 `ANY` 는 예외로 쓴다.

`result` 는 MCP 와이어 포맷이 아니라 **알맹이**다. `content: [{ type: "text", ... }]` 포장은 목이 한다.

### 키로 만들 수 없는 인자

아래는 주입 시점에 거부됩니다. MCP 호출은 JSON 으로 오므로 **어떤 호출로도 도달할 수 없는
값**이고, 그대로 두면 주입은 성공한 것처럼 보이는데 영영 안 맞거나 다른 주입과 같은 키가 됩니다.

| 값 | 예 |
|---|---|
| 순환 참조 | `o.self = o` |
| 희소 배열 | `[1, , 3]` |
| `NaN` · `Infinity` | `{ n: NaN }` |
| JSON 이 아닌 값 | `Date` · 함수 · 심볼 · `BigInt` · `Map` |

`undefined` 는 거부하지 않습니다 — 객체 프로퍼티면 빼고, 배열 원소면 `null` 로 둡니다.

중첩 깊이 상한은 512 입니다. 호출 인자가 이를 넘으면 서버를 죽이지 않고 `isError: true`
응답으로 알려줍니다.

거부 집합은 `record` 의 카세트 매칭 키(ADR-0003)와 같습니다. 다만 `record` 는 키를 SHA-256 으로
해시하고 목은 하지 않습니다 — 목의 키는 파일에 남지 않고 실패 메시지에 그대로 찍히기 때문입니다.
배경은 ADR-0027.

## 설계 메모

- **HTTP 는 stateless 로 띄운다.** `sessionIdGenerator: undefined`. stateful 로 가면 SDK 가
  `randomUUID()` 로 세션 ID 를 만들어 결정론성이 깨진다. 대신 stateless 는 요청마다
  `Server`/transport 를 새로 만들어야 한다 (SDK 제약).
- **포트 기본값은 0** 이다. 빈 포트를 자동으로 받는다. 고정 포트는 이미 물려 있을 때
  실패하고 병렬 실행 시 충돌한다.
- **매칭 키는 객체 키 순서에 영향받지 않는다.** `{a:1,b:2}` 와 `{b:2,a:1}` 이 같은 응답을
  찾는다. `JSON.stringify` 를 그대로 쓰면 삽입 순서를 타서 결정론성이 깨진다.
- **`ToolDef.inputSchema` 는 JSON Schema 그대로 나간다.** 저수준 `Server` 를 쓰기 때문에
  Zod 변환이 필요 없고, 따라서 zod 의존성도 없다.
- **`src/stdio.ts` 는 top-level await 를 쓰지 않는다.** 빌드가 cjs 도 함께 내는데 그쪽에서
  지원되지 않는다. `packages/cli/src/cli.ts` 도 같은 이유로 같은 형태다.

## 실패했을 때

실패 메시지가 곧 제품이다 (CLAUDE.md).

**주입되지 않은 호출**

```
→ 툴 'get_weather' 을(를) 인자 {"city":"제주"} 로 호출했지만 주입된 응답이 없습니다.
→ 이 툴에 주입된 인자: {"city":"서울"}
→ mock.on(툴이름, 인자, 응답) 의 인자가 호출과 일치하는지 확인하세요.
→ 인자를 가리지 않으려면 mock.on(툴이름, ANY, 응답) — 정의 파일에서는 args 생략.
```

**정의 파일이 잘못됐을 때**

```
→ weather.mock.json 가 올바르지 않습니다: responses[0] 의 툴 '없는툴' 이 tools 에 없습니다. 있는 툴: get_weather, add
→ 형식: { "tools": [ { "name": ..., "inputSchema": ... } ], "responses": [ { "tool": ..., "result": ... } ] }
```

`assertMockDefinition(value, source?)` 을 직접 불러 검증할 수도 있다.

## 미결

- 목 응답은 **사람이 지정한 결정론적 값**을 쓴다 (ADR-0005 에서 확정). 스키마 기반 랜덤
  생성은 폐기됐고, 고정 시드 생성은 보류 상태다 — 툴이 많은 서버의 스모크 테스트 수요가
  실제로 확인되면 그때 별도로 결정한다.
- `core.connect()` 의 HTTP 지원 — #16. 있으면 우리 러너가 HTTP 목에도 붙는다
- CI 의 E2E 잡에 stdio 목 경로를 넣을지 — `examples/` 오너 확정 후 (§2.1 에 빠져 있다)
