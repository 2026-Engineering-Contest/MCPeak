# 목 정의 형식

이 문서는 `mcpeak-mock` 이 읽는 정의 파일의 필드를 정리한다. 매칭 규칙과 설계 우선 워크플로는
[목 서버](/ko/guide/mock-server)에 있다.

```json
{
  "tools": [
    {
      "name": "get_weather",
      "description": "도시의 현재 날씨",
      "inputSchema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "responses": [
    { "tool": "get_weather", "args": { "city": "서울" }, "result": { "tempC": 21 } },
    { "tool": "get_weather", "args": { "city": "없는도시" },
      "result": "→ '없는도시' 는 모르는 도시입니다", "isError": true },
    { "tool": "get_weather", "result": { "tempC": 0 } }
  ]
}
```

## `tools[]`

`tools/list` 로 광고할 툴이다. 여기 없는 툴은 `responses` 에서도 쓸 수 없다.

| 필드 | 타입 | 필수 | 뜻 |
|---|---|---|---|
| `name` | string | 예 | 툴 이름 |
| `description` | string | 아니오 | 클라이언트가 툴을 고를 때 읽는 설명 |
| `inputSchema` | JSON Schema | 예 | 인자 스키마. 그대로 광고되고 인자 검사에도 쓴다 |

`inputSchema` 는 JSON Schema 그대로 나간다. Zod 변환이 없다.

## `responses[]`

| 필드 | 타입 | 필수 | 뜻 |
|---|---|---|---|
| `tool` | string | 예 | `tools` 에 있는 이름. 없으면 정의를 읽는 자리에서 거절한다 |
| `args` | JSON 객체 | 아니오 | 이 인자로 부를 때의 응답. 생략하면 스키마를 통과한 모든 인자를 받는다 |
| `result` | JSON 값 | 예 | 응답 알맹이. `content: [{ type: "text", … }]` 포장은 목이 한다 |
| `isError` | boolean | 아니오 | `true` 면 이 응답으로 거절한다. 생략과 `false` 는 같다 |

`responses` 자체를 생략할 수 있다. 그러면 모든 호출이 매칭 미스로 떨어지고, 무엇이 등록돼 있는지
말하는 `isError: true` 응답이 돌아간다.

## 정의가 잘못됐을 때

```
→ 올바르지 않은 목 정의입니다 — weather.mock.json: responses[0] 의 툴 '없는툴' 이 tools 에 없습니다. 있는 툴: get_weather, add
→ 형식: { "tools": [ { "name": ..., "inputSchema": ... } ], "responses": [ { "tool": ..., "result": ... } ] }
```

검사하는 것은 다음이다.

- `tools` 가 배열이고 각 항목에 문자열 `name` 과 `inputSchema` 가 있다.
- `responses` 가 있으면 배열이고, 각 항목에 문자열 `tool` 과 `result` 가 있으며, `isError` 가
  있으면 boolean 이다.
- `responses[].tool` 이 `tools` 에 있다.

## 키로 만들 수 없는 인자

아래 `args` 는 정의를 읽는 자리에서 거부한다. MCP 호출은 JSON 으로 오므로 어떤 호출로도 도달할
수 없는 값이고, 두면 주입은 성공한 것처럼 보이는데 영영 안 맞는다.

| 값 | 예 |
|---|---|
| 순환 참조 | `o.self = o` |
| 희소 배열 | `[1, , 3]` |
| `NaN` · `Infinity` | `{ n: NaN }` |
| JSON 이 아닌 값 | `Date` · 함수 · 심볼 · `BigInt` · `Map` |

중첩 깊이 상한은 512 다. 호출 인자가 이를 넘으면 서버를 죽이지 않고 `isError: true` 로 알린다.

## 코드에서 검증하기

```ts
import { assertMockDefinition } from "@mcpeak/mock";

assertMockDefinition(JSON.parse(text), "weather.mock.json");
```

두 번째 인자는 오류 문장에 실을 출처 이름이다.
