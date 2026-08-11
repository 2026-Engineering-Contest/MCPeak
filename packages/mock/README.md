# @ohmymcp/mock

목 MCP 서버 (Streamable HTTP) · 응답 주입.

- **오너:** `@storyrago` (③ mock server 파트)
- **의존:** `@ohmymcp/core` · `@modelcontextprotocol/sdk` (catalog, 1.x 고정)

실제 MCP 서버 없이, MCP 를 사용하는 프로그램을 테스트하기 위한 것이다.
외부 API 키도 실제 날씨도 필요 없이 "기온이 -10도일 때"를 만들어낼 수 있다.

## 사용법

```ts
import { createMockServer } from "@ohmymcp/mock";

const mock = await createMockServer({ tools });          // tools: ToolDef[]
mock.on("get_weather", { city: "서울" }, { temp: -10 });  // 인자별로 응답을 건다

console.log(mock.url);   // http://127.0.0.1:53211/mcp
// ...테스트 대상 프로그램을 이 주소에 연결한다...

await mock.close();
```

`on()` 의 세 번째 인자는 MCP 와이어 포맷이 아니라 **알맹이**다.
`content: [{ type: "text", text: ... }]` 로 감싸는 것은 목이 처리한다.

## 설계 메모

- **stateless 로 띄운다.** `sessionIdGenerator: undefined`. stateful 로 가면 SDK 가
  `randomUUID()` 로 세션 ID 를 만들어 결정론성이 깨진다. 대신 stateless 는 요청마다
  `Server`/transport 를 새로 만들어야 한다 (SDK 제약).
- **포트 기본값은 0** 이다. 빈 포트를 자동으로 받는다. 고정 포트는 이미 물려 있을 때
  실패하고 테스트를 병렬로 돌릴 때 서로 충돌한다.
- **매칭 키는 객체 키 순서에 영향받지 않는다.** `{a:1,b:2}` 와 `{b:2,a:1}` 이 같은
  응답을 찾는다. `JSON.stringify` 를 그대로 쓰면 삽입 순서를 타서 결정론성이 깨진다.
- **`ToolDef.inputSchema` 는 JSON Schema 그대로 나간다.** 저수준 `Server` 를 쓰기
  때문에 Zod 변환이 필요 없고, 따라서 zod 의존성도 없다.

## 주입되지 않은 호출

실패 메시지가 곧 제품이다 (CLAUDE.md). 무엇이 없고 무엇이 등록돼 있는지 알려준다.

```
→ 툴 'get_weather' 을(를) 인자 {"city":"제주"} 로 호출했지만 주입된 응답이 없습니다.
→ 이 툴에 주입된 인자: {"city":"서울"}
→ mock.on(툴이름, 인자, 응답) 을 호출했는지 확인하세요.
```

## 미결

- 목 데이터를 스키마에서 자동 생성할 것인지 (랜덤 / 고정 시드 / 사람이 직접 작성) — ADR-0005
- `core.connect()` 가 HTTP 를 모르기 때문에 **우리 `runner` 는 아직 이 목 서버에 붙지 못한다.**
  `ConnectOptions` 에 URL 분기가 필요하다 (ADR-0001 선택지 확장).
