# 목 서버

이 문서를 끝내면 실제 MCP 서버 없이 정의 파일 하나로 목 서버를 띄워 `mcpeak test` 를 돌리고,
서버를 만들기 전에 설계를 먼저 검증하는 절차를 아는 상태가 된다. 정의 파일의 필드는
[목 정의 형식](/ko/reference/mock-definition)에 있다.

## 언제 목이고 언제 세션인가

둘 다 진짜를 가짜로 바꾸지만 바꾸는 층이 다르다.

```
[mcpeak] ──(1)── [MCP 서버] ──(2)── [외부 API]
             ↑                          ↑
        목이 대신한다            External 세션이 대신한다
```

| | 무엇을 대신하나 | 언제 |
|---|---|---|
| 목 | MCP 서버 자체 | 서버가 아직 없다. 서버를 쓰는 쪽을 테스트한다 |
| [External 세션](/ko/guide/external-sessions) | 서버가 부르는 외부 API | 서버는 진짜로 돌리고 나가는 네트워크만 없앤다 |

내 서버를 목으로 테스트하는 것은 내가 적은 답이 나오는지 보는 일이라 순환이다. 완성된 서버를
검증하는 자리에는 목을 쓰지 않는다.

## 설치

```bash
npm install -g @mcpeak/mock
```

`mcpeak-mock` 명령이 생긴다. `@mcpeak/cli` 를 설치해도 이 명령은 따라오지 않는다.

## 정의 파일로 띄우기

툴 스키마와 응답을 JSON 으로 적는다.

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
  "responses": [
    { "tool": "get_weather", "args": { "city": "서울" }, "result": { "tempC": 21 } },
    { "tool": "get_weather", "result": { "tempC": 0 } }
  ]
}
```

`mcpeak test` 의 대상으로 지정한다.

```bash
mcpeak test suite.json -- mcpeak-mock weather.mock.json
```

프로세스가 곧 서버라 실행 중에 응답을 주입할 수 없다. 그래서 정의 파일에 미리 적는다.
`result` 는 MCP 와이어 포맷이 아니라 알맹이다. `content: [{ type: "text", … }]` 포장은 목이 한다.
같은 호출은 언제나 같은 바이트를 돌려준다.

## 응답 매칭 규칙

1. 인자를 지정한 응답이 우선한다. 스키마 검사보다 앞이다.
2. 없으면 `inputSchema` 로 인자를 검사한다. 어기면 `isError: true` 로 거절한다.
3. 통과하면 `args` 를 생략한 항목이 받는다.
4. 그것도 없으면 `isError: true` 와 함께 무엇이 등록돼 있는지 알려 준다.

매칭 키는 객체 키 순서에 영향받지 않는다. `{a:1,b:2}` 와 `{b:2,a:1}` 은 같은 응답을 찾는다.

`args` 를 생략한 항목은 편하지만 스키마가 허용하는 어떤 인자로도 통과하게 만든다. 기본은 인자
지정이고 생략은 예외로 쓴다.

### 인자 검사

`tools/list` 로 광고한 `inputSchema` 를 실제 호출에 대조한다. 최상위 필드에서 네 축을 본다.

| 축 | 위반 예 |
|---|---|
| `required` | `city` 를 안 보냄 |
| `type` | `{ "city": 0 }` |
| `enum` | `{ "unit": "k" }` |
| `range` (`minimum` · `maximum` · `minLength` · `maxItems` 등) | `{ "days": 99 }` |

```
→ 툴 'get_weather' 의 'city' 은(는) string 이어야 합니다. 받은 값: 0 (number)
→ 이 툴이 tools/list 로 선언한 inputSchema 가 그렇게 요구합니다.
→ 거절이 의도한 것이면 responses 에 이 인자를 넣어 응답을 지정하세요.
```

중첩 객체와 배열 원소 내부, `additionalProperties` 는 검사하지 않는다. `anyOf` 같은 조합자나
배열 `type` 이 있으면 그 툴(루트에 있을 때) 또는 그 필드만 건너뛰고, 툴 전체를 건너뛴 경우는
서버를 띄울 때 stderr 로 한 번 알린다.

### 거절 응답 주입

실패도 계약의 절반이다. `isError: true` 를 붙이면 내가 정한 문장으로 거절한다.

```json
{ "tool": "get_weather", "args": { "city": "없는도시" },
  "result": "→ '없는도시' 는 모르는 도시입니다. 아는 도시: 서울, 부산, 제주",
  "isError": true }
```

주입한 거절, 스키마 위반, 매칭 미스는 셋 다 `isError: true` 지만 본문이 다르다. 뒤의 둘은 목이
만든 진단문이고, 첫 번째만 "서버가 이렇게 거절한다" 는 설계다.

## 녹화본으로 응답 채우기

`result` 를 지어내지 않고 진짜 외부 API 가 돌려준 값으로 채울 수 있다.
[External 세션](/ko/guide/external-sessions)으로 녹화한 세션 파일(`mcpeak test --record-session`)이
있으면, [대시보드](/ko/guide/dashboard)의 Mock 화면에서 그 녹화본의 응답 본문을 골라 넣는다.

```bash
mcpeak test suite.json --record-session weather.session.db -- node ./server.mjs
mcpeak-dashboard
```

1. 사이드바 **Mock** 에서 새로 만들거나 기존 목 정의 파일을 연다.
2. 응답 카드의 **[녹화본에서 가져오기]** 를 누르고 녹화본을 고른다.
3. 외부 호출 목록에서 본문을 미리 보고 **[이걸로 채우기]** 를 누른다. 그 줄의 `result` 만
   바뀌고 툴 · `args` · `isError` 는 그대로다. 칸에 값이 있으면 바꾸기 전에 묻는다.
4. 저장하면 정의 검사(`assertMockDefinition`)를 거쳐 파일로 쓴다. 그 파일을 평소처럼
   `mcpeak-mock` 으로 띄운다.

응답을 받은 호출만 고를 수 있다. 예외로 끝난 호출과 녹화가 끝나지 않은 호출은 본문이 없어
목록에 보이기만 한다. 녹화본은 읽기만 하고, 서버를 띄우거나 새로 녹화하지 않는다.

::: warning 녹화본은 서버가 받은 응답이지 서버가 준 답이 아니다
녹화본에 담긴 것은 서버가 바깥 API 에게서 받은 본문이다. 목의 `result` 는 서버가 클라이언트에게
돌려주는 답이다. 실제 서버가 받은 응답에서 값을 꺼내 다른 모양으로 답한다면, 가져온 `result` 를
그 모양으로 고친다.
:::

녹화 때 민감한 키 값 · 헤더 · URL 경로는 이미 가려진다. 본문 안의 URL 문자열은 가려지지 않으므로
가져온 본문에 URL 이 있으면 경고가 뜬다. 저장은 막지 않는다.

```
→ 이 응답 본문에 URL 이 2개 있습니다. 녹화 때 가려지지 않는 자리라 자격증명이 담겼을 수 있습니다.
→ 저장 전에 result 에서 해당 값을 확인하세요.
```

## 설계 우선 워크플로

서버를 만들기 전에 설계를 검증하는 것이 목의 주된 쓰임이다. 구현 0줄에서 시작해 구현자에게
넘길 계약까지 만든다.

```
① 설계 ──→ ② 체험 ──→ ③ 명세 ──→ ( 구현 ) ──→ ④ 판정
정의 파일   실제         suite 생성                 같은 suite 를
            클라이언트에  (계약 초안)                실물 서버에
            붙여 본다
```

### ① 정의 파일을 쓴다

툴 스키마와 예상 응답을 적는다. 실패 응답도 같이 적는다.

### ② 진짜 클라이언트에 붙인다

```json
{
  "mcpServers": {
    "weather-design": {
      "command": "mcpeak-mock",
      "args": ["/절대/경로/weather.mock.json"]
    }
  }
}
```

Claude Desktop 설정에 위처럼 넣는다. 경로는 절대경로여야 한다. 클라이언트가 어느 디렉터리에서
띄울지 알 수 없어서다.

여기서 볼 것은 응답 내용이 아니다. 응답은 내가 적은 것이라 볼 게 없다. 볼 것은 클라이언트가
내 스키마를 어떻게 다루는가다. `description` 이 부족하면 엉뚱할 때 이 툴을 고르거나 아예 안
고른다. 필드 이름만 보고 인자를 맞게 채우는지, 거절을 만났을 때 내가 쓴 오류 문장이 사용자에게
도움이 되는지도 본다. 이 셋은 스키마와 문장을 바꾸는 일이라 구현 전이 가장 싸다.

### ③ 목에서 계약 초안을 뽑는다

```bash
mcpeak generate --out contract.suite.json --baseline-only -- mcpeak-mock weather.mock.json
```

이 명세가 구현자에게 넘기는 계약 초안이다. 정상 케이스 하나와 위반 케이스들이 들어 있다.

::: warning 정상 케이스가 실패하면 `args` 생략 항목이 없는 것이다
`generate` 는 정상 입력을 스키마에서 합성하므로 `{ "city": "example" }` 같은 값이 나온다. 내가
`"서울"` 만 적어 뒀으면 그 호출은 표에 없다.

```
✗ get-weather-success  get_weather가 오류 없이 응답한다
    → 툴 'get_weather' 을(를) 인자 {"city":"example"} 로 호출했지만 주입된 응답이 없습니다.
    → 이 툴에 주입된 인자: {"city":"서울"}, {"city":"없는도시"}
```

`args` 를 생략한 항목을 하나 두면 된다. 위반 인자는 그 항목이 받지 않으므로 거절 케이스는
그대로 동작한다.
:::

### ④ 같은 명세를 실물 서버에

```bash
mcpeak test contract.suite.json -- node ./server.mjs
```

통과하면 구현이 설계 계약을 지켰다는 증명이다. 목에서 초록인 것은 구현이 맞다는 뜻이 아니다.
같은 명세를 예제 서버에 돌린 결과다.

| | 결과 |
|---|---|
| 목 | `3 passed` |
| 실물 (`examples/weather-server`) | `2 passed, 1 failed` |

실물은 서울·부산·제주만 아는데 합성 입력이 `"example"` 이라 정상 케이스가 깨졌다. 목은 생략
항목이 다 받아서 초록이었다. ③까지의 초록은 목 기준 확인이고, 계약 판정은 ④에서 난다.

## 목에서 항상 뜨는 경고

`거절 근거를 확인하지 못했습니다` 경고는 목에서 항상 뜬다. runner 는 거절이 SDK 입력 검증에서
나온 것인지 오류 문장의 접두어로 판별하는데, 목의 거절문은 그 목록에 없다. 케이스는 통과하고
경고만 붙는다.

## 코드에서 HTTP 로 띄우기

MCP 를 쓰는 외부 프로그램을 테스트할 때는 라이브러리로 Streamable HTTP 목을 띄운다. 프로젝트에
설치해야 `import` 가 된다. 전역 설치는 실행 파일만 놓는다.

```bash
npm install --save-dev @mcpeak/mock
```

```ts
import { ANY, createMockServer } from "@mcpeak/mock";

const mock = await createMockServer({ tools });
mock.on("add", { a: 1, b: 2 }, { sum: 3 });
mock.on("add", ANY, { sum: 0 });

console.log(mock.url); // http://127.0.0.1:53211/mcp

await mock.close();
```

HTTP 목은 stateless 로 뜬다. stateful 이면 SDK 가 `randomUUID()` 로 세션 ID 를 만들어 결정론성이
깨진다. 포트 기본값은 0 이라 빈 포트를 자동으로 받는다.
