# 명세 작성

이 문서를 끝내면 케이스에 어떤 작업과 단언을 적을 수 있는지 알고, 실패했을 때 터미널이 무엇을
말해 주는지 읽을 수 있는 상태가 된다. 필드 하나하나의 정확한 타입은 [명세 형식](/ko/reference/suite-spec)
에 있다.

## 명세의 뼈대

명세 하나는 스위트 하나다. 스위트에는 케이스가 여러 개 있고, 케이스는 명세에 적힌 순서대로
실행된다.

```json
{
  "schemaVersion": 1,
  "id": "weather",
  "name": "날씨 서버",
  "defaultTimeoutMs": 10000,
  "cases": []
}
```

`id` 는 파일 안에서 스위트를 가리키는 이름이고, `name` 은 보고서 첫 줄에 찍힌다.
`defaultTimeoutMs` 는 케이스마다 `timeoutMs` 를 따로 적지 않았을 때의 제한 시간이다. 둘 다 없으면
10초다.

## 두 가지 작업

케이스의 `operation` 은 서버에 무엇을 물을지다. 종류는 둘이다.

| `operation.type` | 하는 일 | 쓸 수 있는 단언 |
|---|---|---|
| `listTools` | 서버의 `tools/list` 를 부른다 | `toolExists` |
| `callTool` | `tool` 을 `input` 으로 호출한다 | `isError` · `bodyMatchesSchema` · `structuredContentMatchesSchema` |

작업과 맞지 않는 단언을 적으면 실행 전에 `INCOMPATIBLE_ASSERTION` 으로 거절한다. `listTools`
에 `isError` 를 붙이는 식이다.

## 단언

### `toolExists`

서버가 그 이름의 툴을 광고하는지 본다.

```json
{ "type": "toolExists", "tool": "get_weather" }
```

실패하면 무엇이 있었는지를 함께 말한다. 오타를 잡는 데 이 한 줄이면 충분하다.

```
toolExists  툴 'get_weater'을(를) 찾을 수 없습니다. 발견된 툴: 'add', 'get_weather'
해결: 서버의 tools/list 응답과 테스트 명세를 확인하세요.
```

### `isError`

응답이 오류인지 정상인지 본다. `expected: false` 는 정상 응답을, `expected: true` 는 거절을
기대한다.

```json
{ "type": "isError", "expected": true }
```

거절을 기대하는 케이스는 서버의 실패 경로를 검증한다. 필수 필드를 빼거나 타입을 틀리게 넣었을 때
서버가 그냥 터지지 않고 거절하는지다. 실패하면 서버가 실제로 무엇을 돌려줬는지 본문을 보여준다.

```
✗ add-missing-a  add가 필수 필드 'a' 누락을 거절한다
    isError  오류 응답을 기대했지만 정상 응답을 받았습니다.
    → {"sum":null}
    해결: 툴 입력값과 서버의 오류 응답을 확인하세요.
```

### `bodyMatchesSchema`

응답 본문을 JSON Schema 부분집합으로 대조한다. 본문은 응답의 text 블록에서 뽑는다. text 가
JSON 으로 파싱되면 그 값을, 아니면 문자열 그대로를 대조 대상으로 삼는다.

```json
{
  "type": "bodyMatchesSchema",
  "schema": {
    "type": "object",
    "required": ["temp"],
    "properties": { "temp": { "type": "number" } }
  }
}
```

실패 문장은 어느 경로가 어떻게 어긋났는지를 위반 건수와 함께 말한다. 서버가 필드 이름을 바꾼
경우가 전형적이다.

```
bodyMatchesSchema  응답이 기대 스키마와 다릅니다. 위반 1건.
    $: 필수 필드가 없습니다. 발견된 필드: 'temperature'
    해결: 스키마 변경이 의도된 것이라면 테스트를 업데이트하세요.
```

타입이 다르면 기대한 타입과 실제 값을, `enum` 밖 값이면 허용 목록과 실제 값을 같은 자리에
적는다.

### `structuredContentMatchesSchema`

같은 스키마 부분집합을 `structuredContent` 에 대조한다. 서버가 `outputSchema` 를 선언하는
툴이면 응답에 구조화된 값이 따로 실리는데, 그 자리를 본다. text 본문 추출 규칙은 건드리지 않는다.
`generate` 가 `outputSchema` 를 발견하면 이 단언을 함께 저장해, 서버가 나중에 선언과 응답을
함께 바꿔도 저장 당시의 출력 계약으로 다시 검사한다.

## 스키마 부분집합

두 스키마 단언이 받는 키워드는 정해져 있다. 목록 밖 키워드가 있으면 실행 전에
`UNSUPPORTED_SCHEMA_KEYWORD` 로 거절한다. 조용히 무시해서 검사가 빠진 채 초록이 되는 일을
막기 위해서다.

| 범주 | 키워드 |
|---|---|
| 타입·값 | `type` · `const` · `enum` |
| 객체 | `required` · `properties` · `additionalProperties` |
| 배열 | `items` · `minItems` |
| 문자열 | `minLength` · `maxLength` · `stringContains` |
| 숫자 | `minimum` · `maximum` |

`stringContains` 는 표준 JSON Schema 에 없는 이 도구만의 키워드다. 오류 문장이 특정 단어를
담는지 볼 때 쓴다.

## 실패한 케이스만 다시 볼 때

보고서 끝에는 실패한 케이스만 다시 모은 목록이 붙는다. 케이스가 많을 때 스크롤을 거슬러
올라가지 않게 하려는 것이다.

```
실패한 케이스
  ✗ add-missing-a  → {"sum":null}
  ✗ add-missing-b  → {"sum":null}

6 passed, 2 failed  (8 total)
```

## 거절 근거 경고

거절을 기대한 케이스가 통과했는데도 이런 줄이 붙을 수 있다.

```
→ 거절을 기대한 케이스 6건은 거절 근거를 확인하지 못했습니다.
  서버가 거절한 것인지 다른 이유로 실패한 것인지 이 도구는 판단하지 못합니다.
  확인: mcpeak generate 의 승인 화면에서 해당 케이스의 응답을 확인하세요.
```

`isError: true` 는 "오류였다" 까지만 말한다. 그 오류가 입력 검증에서 나온 거절인지, 서버가 다른
이유로 터진 것인지는 오류 문장으로만 알 수 있다. 도구는 SDK 의 입력 검증 접두어
(`MCP error -32602:` 등)를 알아보지만, 서버가 직접 쓴 거절 문장은 알아보지 못한다. 그래서
판정을 바꾸지 않고 확인을 권한다. 손으로 쓴 거절 문장을 쓰는 서버, 그리고 목 서버에서는 이
경고가 항상 뜬다.

## TypeScript 로 쓰기

JSON 대신 코드로 명세를 두려면 `@mcpeak/runner` 의 `defineMcpSuite` 를 쓴다. 리터럴 타입을
유지하면서 런타임 검증을 함께 한다. 외부에서 받은 JSON 을 검증만 하려면 `validateMcpSuite` 다.

```ts
import { defineMcpSuite } from "@mcpeak/runner";

export const suite = defineMcpSuite({
  schemaVersion: 1,
  id: "weather",
  name: "날씨 서버",
  cases: [
    {
      id: "tool-exists",
      name: "get_weather 도구를 제공한다",
      operation: { type: "listTools" },
      assertions: [{ type: "toolExists", tool: "get_weather" }],
    },
  ],
});
```

다만 `mcpeak test` 가 받는 것은 지금 UTF-8 JSON 파일 하나다. TypeScript 명세는 `runSuite` 로
직접 실행하는 경로에서 쓴다.

## 다음에 읽을 것

- [명세 생성](/ko/guide/generate): 스키마에서 이 케이스들을 자동으로 만든다.
- [명세 형식](/ko/reference/suite-spec): 필드별 타입과 검증 오류 코드.
- [결정론성 확인](/ko/guide/determinism): 같은 명세를 두 번 돌려 결과가 같은지 본다.
