# @ohmymcp-hsu/mock

목 MCP 서버 · 응답 주입. **Streamable HTTP** 와 **stdio** 두 가지로 뜬다.

- **오너:** `@storyrago` (③ mock server 파트)
- **의존:** `@ohmymcp-hsu/core` · `@modelcontextprotocol/sdk` (catalog, 1.x 고정)

실제 MCP 서버 없이, MCP 를 사용하는 프로그램을 테스트하기 위한 것이다.
외부 API 키도 실제 데이터도 없이 원하는 상황을 그대로 세워둘 수 있다.

**서버를 만들기 전에 설계를 먼저 검증하려면** → [설계 우선 워크플로](#설계-우선-워크플로)

## 어느 쪽을 쓰나

| | 대상 | 응답 주입 |
|---|---|---|
| **HTTP** `createMockServer` | MCP 를 사용하는 **외부 프로그램** | 띄운 뒤 `on()` 으로 |
| **stdio** `ohmymcp-mock` | **우리 도구**(`ohmymcp test`) | 정의 파일에 미리 |

`core.connect()` 는 HTTP 도 안다 (ADR-0020). 갈리는 이유는 CLI 다 — `ohmymcp test` 가
`core.connectStdio` 를 하드코딩하고 `--url` 이 없다 (`packages/cli/src/index.ts:132`·`234`).
자세한 배경은 ADR-0007.

## HTTP — 외부 프로그램용

```ts
import { ANY, createMockServer } from "@ohmymcp-hsu/mock";

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

## 설계 우선 워크플로

**MCP 서버를 만들기 전에 설계를 먼저 검증하는 것**이 목의 주된 쓰임이다. 구현 0 줄에서
시작해 구현자에게 넘길 계약까지 만든다.

```
① 설계 ──→ ② 체험 ──→ ③ 명세 ──→ ( 구현 ) ──→ ④ 판정
정의 파일   실제         suite 생성                 같은 suite 를
JSON       클라이언트에   (계약 초안)                실물 서버에
           붙여본다
```

### ① 설계 — 정의 파일을 쓴다

툴 스키마와 예상 응답을 적는다. 실패 응답도 같이 적는다 — **실패 UX 도 계약의 절반이다.**

```json
{
  "tools": [
    { "name": "get_weather",
      "inputSchema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      } }
  ],
  "responses": [
    { "tool": "get_weather", "args": { "city": "서울" },
      "result": { "city": "서울", "temp": 21, "condition": "맑음" } },
    { "tool": "get_weather", "args": { "city": "없는도시" },
      "result": "→ '없는도시' 는 모르는 도시입니다. 아는 도시: 서울, 부산, 제주",
      "isError": true }
  ]
}
```

### ② 체험 — 진짜 클라이언트에 붙인다

```json
{
  "mcpServers": {
    "weather-design": {
      "command": "ohmymcp-mock",
      "args": ["/절대/경로/weather.mock.json"]
    }
  }
}
```

Claude Desktop 설정에 위처럼 넣는다. **경로는 절대경로여야 한다** — 클라이언트가 어느
디렉터리에서 띄울지 알 수 없다.

여기서 볼 것은 **응답 내용이 아니다.** 응답은 내가 적은 것이라 볼 게 없다. 봐야 하는 것은
**클라이언트가 내 스키마를 어떻게 다루는가**다.

- 이 툴을 언제 고르나 — `description` 이 부족하면 엉뚱할 때 고르거나 아예 안 고른다
- 인자를 어떻게 채우나 — 필드 이름만 보고 맞게 채우는지
- 거절을 만났을 때 뭐라고 하나 — 내가 쓴 오류 문장이 사용자에게 도움이 되는지

**이 셋은 서버를 다 만든 뒤에 고치면 비싸다.** 스키마와 문장을 바꾸는 일이라 구현 전이 가장 싸다.

### ③ 명세 — 목에서 계약 초안을 뽑는다

```bash
ohmymcp generate --suite-id weather --name "날씨 서버 계약" \
  --out contract.suite.json \
  --command ohmymcp-mock --arg weather.mock.json --baseline-only
```
```
baseline suite를 저장했습니다: contract.suite.json
커버리지  1 tools, 3 axes 전부 검증
```

이 suite 가 **구현자에게 넘기는 계약 초안**이다. 정상 케이스 하나와 위반 케이스들이 들어 있다.

> ⚠️ **정상 케이스가 실패하면 `ANY` 폴백이 없는 것이다.** `generate` 는 정상 입력을 스키마에서
> 합성하므로 `{ "city": "example" }` 같은 값이 나온다. 내가 `"서울"` 만 적어뒀으면 그 호출은
> 표에 없다.
> ```
> ✗ get-weather-success  get_weather가 오류 없이 응답한다
>     → 툴 'get_weather' 을(를) 인자 {"city":"example"} 로 호출했지만 주입된 응답이 없습니다.
>     → 이 툴에 주입된 인자: {"city":"서울"}, {"city":"없는도시"}
> ```
> `args` 를 생략한 줄(= `ANY`)을 하나 두면 된다. 위반 인자는 `ANY` 가 먹지 않으므로
> (「인자 검사」 참조) 거절 케이스는 그대로 동작한다.

### ④ 판정 — 같은 suite 를 실물 서버에

구현이 끝나면 **같은 파일**을 진짜 서버에 돌린다. 통과하면 구현이 설계 계약을 지켰다는 증명이다.

```bash
ohmymcp test contract.suite.json --command node --arg ./server.js
```

**목에서 초록인 것은 구현이 맞다는 뜻이 아니다.** 같은 suite 를 예제 서버에 돌린 실제 결과:

| | 결과 |
|---|---|
| 목 | `3 passed` |
| 실물 (`examples/weather-server`) | `2 passed, 1 failed` |

실물은 서울·부산·제주만 아는데 합성 입력이 `"example"` 이라 정상 케이스가 깨졌다. 목은 `ANY`
폴백이 다 받아서 초록이었다. **③까지의 초록은 "목 기준 확인" 이고, 계약 판정은 ④에서 난다.**

### 알아둘 것

- **`거절 근거를 확인하지 못했습니다` 경고는 목에서 항상 뜬다.** `runner` 는 거절이 SDK 입력
  검증에서 나온 것인지 오류 문장의 접두어로 판별하는데(`MCP error -32602:` 등), 목의 거절문은
  그 목록에 없다. 케이스는 통과하고 경고만 붙는다.
- **완성된 MCP 를 실제로 쓰는 것은 목이 아니다.** 목은 구현 전 설계 검증과, 실물을 붙일 수
  없는 환경(외부 API 키 없음, 응답이 매번 다름)의 대역이다. 내 서버를 목으로 테스트하는 것은
  내가 적은 답이 나오는지 보는 것이라 순환이다 — 그건 `@ohmymcp-hsu/record` 가 한다.

## 응답 매칭 규칙

두 진입점이 **같은 규칙**을 쓴다.

1. **인자를 지정한 응답이 우선한다.** 스키마 검사보다도 앞이다.
2. 없으면 **`inputSchema` 로 인자를 검사한다.** 어기면 `isError: true` 로 거절한다.
3. 통과하면 `ANY`(정의 파일에서는 `args` 생략)가 받는다.
4. 그것도 없으면 `isError: true` 와 함께 무엇이 등록돼 있는지 알려준다.

`ANY` 는 편하지만 **스키마가 허용하는 범위에서는 어떤 인자로 불러도 통과**하게 만든다.
기본은 인자 지정이고 `ANY` 는 예외로 쓴다.

`result` 는 MCP 와이어 포맷이 아니라 **알맹이**다. `content: [{ type: "text", ... }]` 포장은 목이 한다.

### 인자 검사

`tools/list` 로 광고한 `inputSchema` 를 실제 호출에 대조한다. 네 축을 **최상위 필드에서만** 본다
([ADR-0048](../../docs/adr/0048-목이-inputSchema-를-실제로-검사한다.md)).

| 축 | 스키마의 어디 | 위반 예 |
|---|---|---|
| `required` | `"required": ["city"]` | `city` 를 안 보냄 |
| `type` | `{ "type": "string" }` | `{ "city": 0 }` |
| `enum` | `{ "enum": ["c", "f"] }` | `{ "unit": "k" }` |
| `range` | `minimum` · `maximum` · `exclusiveMinimum` · `exclusiveMaximum` · `minLength` · `maxLength` · `minItems` · `maxItems` | `{ "days": 99 }` |

```
→ 툴 'get_weather' 의 'city' 은(는) string 이어야 합니다. 받은 값: 0 (number)
→ 이 툴이 tools/list 로 선언한 inputSchema 가 그렇게 요구합니다.
→ 거절이 의도한 것이면 responses 에 이 인자를 넣어 응답을 지정하세요.
```

**의도한 거절을 설계에 넣으려면 그 인자를 지정해 주입한다.** 1번이 2번보다 앞이라 이 응답이 이긴다.

```json
{ "tool": "get_weather", "args": { "city": 0 }, "result": "도시 이름이 잘못됐습니다" }
```

**검사하지 않는 것:** 중첩 객체와 배열 원소 내부, `additionalProperties`. 조합자
(`anyOf` · `oneOf` · `allOf` · `not` · `$ref` · `if`)나 배열 `type` 이 있으면 — 루트에 있으면 그 툴
전체를, 필드에 있으면 그 필드만 — 건너뛴다. 툴 전체를 건너뛴 경우는 서버를 띄울 때 `stderr` 로
한 번 고지한다.

```
→ 다음 툴은 inputSchema 를 해석할 수 없어 인자 검사를 건너뜁니다:
   'search' — 해석할 수 없는 키워드: anyOf
```

### 거절 응답 주입

실패도 계약의 절반이다. `isError: true` 를 붙이면 **내가 정한 문장으로 거절**할 수 있다.

```json
{ "tool": "get_meeting", "args": { "id": "m-99" },
  "result": { "error": "→ 'm-99' 회의록이 없습니다" }, "isError": true }
```

코드에서는 네 번째 인자로 넘긴다.

```ts
mock.on("get_meeting", { id: "m-99" }, { error: "→ 'm-99' 회의록이 없습니다" }, { isError: true });
```

생략하면 성공이다. `isError: false` 를 명시해도 같다 — 참일 때만 와이어에 싣는다.

**매칭 미스의 `isError` 와는 다른 것이다.**

| | 언제 | 본문 |
|---|---|---|
| **주입한 거절** | `isError: true` 로 선언한 인자 | 내가 쓴 `result` |
| **스키마 위반** | 표에 없고 `inputSchema` 를 어긴 인자 | 목이 만든 위반 진단문 (`… 이어야 합니다`) |
| **매칭 미스** | 표에 없고 스키마는 지킨 인자 | 목이 만든 안내문 (`주입된 응답이 없습니다`) |

셋 다 `isError: true` 지만 **본문으로 구분된다.** 뒤의 둘은 "목이 판단한 것" 이고, 첫 번째만
"서버가 이렇게 거절한다" 는 **설계**다. 위반 진단문 대신 내 문장을 내보내고 싶으면 그 인자를
표에 적으면 된다 — 매칭 규칙 1번이 2번보다 앞이다.

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
배경은 ADR-0029.

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
- CLI 의 HTTP 연결 — `core.connect()` 쪽은 됐다 (ADR-0020, #16). `ohmymcp test` 에 `--url`
  이 생기면 우리 러너가 HTTP 목에도 붙는다. 지금은 CLI 가 stdio 로 고정돼 있다
