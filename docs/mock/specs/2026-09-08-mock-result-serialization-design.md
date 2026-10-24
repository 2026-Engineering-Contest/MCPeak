# mock: 실을 수 없는 응답과 포트 충돌을 설계된 문장으로 거절한다 (2026-09-08)

이슈 #415. 대상 패키지 `@mcpeak/mock` (오너 `@storyrago`).

## 1. 배경

`mock` 이 만든 진단문 대신 **외부 원문**이 사용자에게 나가는 경로가 두 곳 있다. 이 패키지의 존재 이유가 "실패했을 때 읽히는 문장" 이라, 그 자리에서만 문장이 없다는 것이 결함이다.

### 1.1 `result` 를 아무도 검사하지 않는다

`src/index.ts:456` 이 응답을 실어 보낸다.

```ts
content: [{ type: "text" as const, text: JSON.stringify(stored.result) }],
```

`args` 는 `put()` 이 `assertKeyable` 로 주입 시점에 막는다(`src/index.ts:126`). `result` 는 어느 지점에서도 검사하지 않는다.

`JSON.stringify` 는 두 가지로 실패한다.

| 값 | 결과 | 사용자가 받는 것 |
|---|---|---|
| `undefined` · 함수 · 심볼 | `undefined` 를 **반환** | `text` 필드가 사라져 클라이언트 zod 덤프 |
| 순환 참조 · `BigInt` | **던짐** | Node `TypeError` 원문 |

전자의 실측이다.

```
McpError: MCP error -32602: Invalid tools/call result: [
  { "code": "invalid_union", "errors": [[{ "expected": "string", "code": "invalid_type",
    "path": ["text"], "message": "Invalid input: expected string, received undefined" }]] ...
```

무엇이 왜 다른지도, 어떻게 고치는지도 없고, 목 코드를 가리키지도 않는다.

도달 경로는 둘이다. `mock.on("add", { a: 1 }, undefined)`, 그리고 JS 에서 `createMockServer({ responses: [{ tool: "add", result: undefined }] })` — `assertMockDefinition` 이 `"result" in res` 만 보므로 통과한다(`src/index.ts:396`).

### 1.2 고정 포트 충돌이 Node 원문 그대로 나간다

`src/index.ts:521-522`

```ts
http.once("error", reject);
http.listen(port, host, resolve);
```

`port` 는 공개 옵션이다. 이미 물린 포트를 주면 `listen EADDRINUSE: address already in use 127.0.0.1:45771` 이 그대로 나간다. 바로 아래 `:527` 은 훨씬 드문 `address()` 이상값에까지 설계된 문장을 붙여 놓았는데 이 흔한 경로만 비어 있다.

곁딸린 결함: `once("error", reject)` 가 listen 성공 후에도 떨어지지 않는다. 이후 런타임의 `error` 이벤트는 이미 settled 된 promise 의 `reject` 로 흘러 어디에도 나타나지 않는다. 조용히 사라지는 실패는 `rejectDuplicate`(`:132-145`)가 없앤 바로 그 양식이다.

## 2. 목표와 완료 조건

- `result` 를 실을 수 없으면 **주입 시점에** 이 패키지 관례의 3줄 진단문으로 거절한다.
- `EADDRINUSE` 를 설계된 문장으로 바꾸고, listen 성공 후 error 리스너를 뗀다.
- 완료 판정: 아래 §6 의 테스트 8건이 통과하고, 수정을 빼면 해당 테스트가 실패한다.

## 3. 비범위

- `respond()` 시점 검사 — §4.2 참조.
- `args` 의 `findKeyViolation` 을 `result` 에 재사용하는 것 — §4.3 참조.
- `off("error")` 자체의 테스트 — §6 참조.
- #416~#420 의 다른 `mock` 결함. 별도 이슈다.

## 4. 결정

### 4.1 검사 시점은 주입 시점(`put()`)이다

`args` 를 `assertKeyable` 로 막는 자리와 대칭이고, 잘못 쓴 줄에서 스택이 끊긴다. `src/index.ts:69-71` 주석이 `args` 에 대해 같은 선택을 한 이유를 적어 두었다. 이 저장소는 늦게 터지는 것을 결함으로 본다(#223).

### 4.2 응답 시점 검사를 하지 않는다

주입해 놓고 쓰지 않는 응답까지 막게 되지만, 그 대가로 주입한 줄에서 즉시 실패한다. 응답 시점에 던지면 이미 MCP 응답을 만들던 중이라 사용자에게 무엇이 가는지가 SDK 에 달린다.

### 4.3 `args` 의 검사기를 재사용하지 않는다

`args` 는 **찾는 데** 쓴다. 들어온 호출과 맞춰야 하므로 `stableKey` 로 문자열 키를 만들고, 그래서 `Date` · `NaN` · 깊은 중첩을 거부한다.

`result` 는 **실어 보내기만** 한다. `Date` 는 `"2026-01-01T00:00:00.000Z"` 로, `NaN` 은 `null` 로 정상 직렬화된다. `findKeyViolation` 을 재사용하면 이 정상 사용을 막는다. 규칙이 다르다는 것을 `assertSerializable` 주석에 남긴다.

### 4.4 두 갈래를 갈라 적는다

`stringify` 가 반환값 `undefined` 를 내는 경우와 던지는 경우는 사용자가 고치는 방법이 다르다. `undefined` 는 값을 `null` 로 바꾸는 것이고, 순환 참조는 참조를 끊는 것이다. `KeyViolation` 이 5종을 갈라 적는 것과 같은 이유다.

## 5. 설계

### 5.1 타입 시그니처

```ts
// key-violation.ts — export 로 바꾼다 (지금 module-private)
export function describeValue(value: unknown): string;

// index.ts — 신규
function assertSerializable(result: unknown, source: string): void;
```

판정용 유니온 타입을 만들지 않는다. `KeyViolation` 은 5종이라 판정과 문장을 갈랐지만, 이쪽은 2종이고 분기가 `try/catch` 그 자체다.

새 파일을 만들지 않는다. `key-violation.ts` 를 뗀 이유 둘(테스트가 판정 함수를 직접 부르려면 export 가 필요하다, 키 규칙이 한 덩어리로 바뀐다)이 여기에는 해당하지 않는다.

### 5.2 호출 위치

`put()` 의 맨 위, `ANY` 분기보다 **앞**이다.

```ts
function put(registry, tool, args, result, source, isError = false) {
  assertSerializable(result, source);
  const stored: StoredResponse = { result, isError, source };
  if (args === ANY) { /* early return */ }
  assertKeyable(args ?? {}, source);
  ...
}
```

`assertKeyable` 옆에 두면 `ANY` 주입이 검사를 건너뛴다. `args` 검사가 분기 뒤에 있는 것은 `ANY` 가 `Symbol.for` 라 `notJson` 에 걸리기 때문이고, `result` 검사에는 그 이유가 없다.

### 5.3 문안

`keyViolationMessage` 형태를 따른다 — 첫 줄에 `source` 와 종류, 둘째 줄에 값, 셋째 줄에 왜와 어떻게. 변하는 값 뒤에 조사를 붙이지 않는다(`key-violation.ts:104-108`).

값이 사라지는 갈래:

```
→ mock.on('add', ...) 의 응답을 JSON 으로 실을 수 없습니다: 값이 사라집니다
→ 발견: function
→ 목은 result 를 JSON 문자열로 만들어 보냅니다. undefined · 함수 · 심볼은 문자열이 되지 않습니다. 값이 없다는 뜻이면 null 을 쓰세요.
```

직렬화가 던지는 갈래:

```
→ 정의 파일의 responses[0] 의 응답을 JSON 으로 실을 수 없습니다: 직렬화가 실패했습니다
→ 원인: Converting circular structure to JSON
→ 순환 참조나 BigInt 가 흔한 원인입니다. 참조를 끊거나 수를 문자열로 바꿔 넘기세요.
```

`원인` 은 Node 오류 메시지의 **첫 줄만** 쓴다. 순환 참조 `TypeError` 는 뒤에 객체 경로 덤프가 여러 줄 붙어, 그대로 실으면 문장이 결정론적이지 않다.

### 5.4 포트

```
→ 목 서버를 띄우지 못했습니다: 포트 45771 이 이미 사용 중입니다 (127.0.0.1).
→ port 를 생략하면 빈 포트를 자동으로 받습니다. 고정 포트는 병렬 실행 시 충돌합니다.
→ 앞서 띄운 목의 close() 를 빠뜨리지 않았는지도 확인하세요.
```

`EADDRINUSE` 만 갈아끼우고 나머지 `error` 는 원래 오류를 그대로 reject 한다. listen 성공 시 `http.off("error", onError)` 로 리스너를 뗀다 — 그래야 이후 런타임 오류가 unhandled 로 드러난다.

## 6. 테스트

거절되는 것:

1. `on()` 에 `undefined` 를 주면 전문 일치로 던진다
2. `on()` 에 함수를 주면 `발견: function`
3. `on()` 에 순환 참조를 주면 던지는 갈래
4. `on()` 에 `BigInt` 를 주면 던지는 갈래
5. `mock.on("add", ANY, undefined)` 도 막힌다 — §5.2 분기 순서 회귀
6. `createMockServer({ responses: [{ tool, result: undefined }] })` 도 막힌다

통과해야 하는 것 (과잉 거절 회귀):

7. `Date` · `NaN` · `null` · 중첩 `undefined` 필드를 `result` 로 넣으면 정상 동작한다

포트:

8. 같은 포트로 목을 둘 띄우면 `EADDRINUSE` 문장이 전문 일치로 나온다

전부 `toThrow(new Error(전문))` 완전 일치다. chai 는 `indexOf` 로 보므로 부분 일치를 걸면 뒤에 줄이 붙어도 통과하고, 1·3·4 는 수정 전에도 던지므로 부분 일치로는 아무것도 검증하지 못한다. 이 패키지가 `tests/index-e2e.test.ts:393` 에서 이미 쓰는 방식이다.

**커밋 전에 수정을 빼고 한 번 돌려 해당 테스트가 실패하는 것을 확인한다.**

`off("error")` 자체의 테스트는 만들지 않는다. `http` 서버 객체가 밖으로 노출돼 있지 않아 리스너 수를 볼 방법이 없고, 우회해 만들면 테스트가 내부 구조에 묶인다. 1줄 수정이라 비용이 이득보다 크다.

## 7. 결과

- 파일: `packages/mock/src/index.ts`, `packages/mock/src/key-violation.ts`(export 한 줄), `packages/mock/tests/index-e2e.test.ts`, `.changeset/*.md`
- 공개 API 변경 없음. `assertSerializable` 은 module-private 이고 `describeValue` 는 `key-violation.ts` 안에서만 쓰인다.
- 새 의존성 없음. `core/src/types.ts` 미변경. SDK 버전 미변경.
- ADR 을 쓰지 않는다. §4.3 의 판단(두 규칙이 다른 이유)은 `assertSerializable` 주석에 남긴다. 단순 구현은 ADR 대상이 아니다.
- 권장 커밋 메시지: `fix(mock): 실을 수 없는 응답과 포트 충돌을 설계된 문장으로 거절한다`
