# example-zod-notes-server

도그푸딩용 예제 MCP 서버. **stdio** 트랜스포트로 동작한다.

```bash
node examples/zod-notes-server/server.mjs
```

MCP 클라이언트(Claude Desktop 등)에 붙이려면 위 명령을 서버 실행 커맨드로 지정하면 된다.

## 툴

| 툴 | 인자 | 응답 |
|---|---|---|
| `get_note` | `{ id: uuid }` (선언 밖 필드 거절) | `{ id, title, body, tags, priority, dueAt, parentId }` |
| `create_note` | `{ title, body?, tags?, priority, dueAt \| null, parentId?, author: { name, email? } }` | 받은 값 + 고정 `id` |
| `list_notes` | `{ filter?: { tag?, priority \| null }, limit? = 10 }` | `{ ids: string[] }` |

노트는 고정 데이터 두 개뿐이다. 모르는 `id` 를 물으면 `isError: true` 와 함께 있는 노트를 알려준다.

## 왜 이렇게 만들었나

**`McpServer` + zod 를 쓴다.** `examples/weather-server` 는 손으로 쓴 JSON Schema 를 저수준 `Server`
에 넘긴다. 이 서버는 반대로 `McpServer.registerTool` 에 zod 스키마를 넘겨 SDK 가 JSON Schema 를
만들게 한다. `z.string().uuid()` 가 `format` 과 `pattern` 으로, `.nullable()` 이 `anyOf` 로,
`.strict()` 가 `additionalProperties: false` 로 바뀌는 그 변환 경로를 CI 에서 상시 밟는 것이 이
서버의 존재 이유다. 실무 zod 서버에서 툴이 통째로 건너뛰어지던 회귀를 여기서 막는다.

**정상 케이스 값은 스키마에 선언한다.** `get_note` 의 `id` 에 `.meta({ examples: [...] })` 를 달아
두었다. 생성기는 선언된 예시값을 그대로 쓰므로(ADR-0004) 정상 케이스가 실재하는 노트를 맞춘다.
생성기의 대표 UUID 를 시드 데이터에 넣는 방향은 택하지 않았다. 예제가 생성기 내부 상수에 묶이기
때문이다.

**`server.mutant.mjs` 는 통제 변이다.** `server.mjs` 에서 딱 세 줄을 약하게 만든 사본이라, 명세를
원본에서 만들어 변이에 돌리면 정해진 개수의 케이스가 실패한다. 검출력이 실제로 있는지 재는 자다.

| 원본 | 변이 | 잃는 축 |
|---|---|---|
| `title: z.string().min(1).max(80)` | `title: z.string()` | `create_note` 의 `title` 길이 제약 |
| `priority: z.enum(PRIORITIES)` | `priority: z.string()` | `create_note` 의 `priority` enum |
| `limit: z.number().int().min(1).max(50).default(10)` | `limit: z.number().default(10)` | `list_notes` 의 `limit` 정수·범위 |

실제 서버로 쓰지 마라. 검출력 측정 전용이다.

**검사하지 않는 것이 있다.** 이 예제로 도는 명세는 중첩 필드(`author.*`, `filter.*`)의 위반,
enum 의 두 번째 값, 선택 필드가 있고 없을 때의 분기를 아직 만들지 않는다. 그래서 "모든 의미를
검사했다" 고 읽으면 안 된다. 후속은 #388, #401 이다.

E2E 실행 방법은 [`packages/cli/tests/zod-notes-server-e2e.test.ts`](../../packages/cli/tests/zod-notes-server-e2e.test.ts)
에 있다. 여기에 절차를 복사하지 않는다.

## 배포되지 않는다

`package.json` 에 `"private": true` 가 있다. Changesets 릴리스 워크플로가 npm 에 올리지 않는다.
