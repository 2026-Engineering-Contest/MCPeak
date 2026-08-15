# @ohmymcp/record

MCP 클라이언트를 카세트로 감싸 녹화·재생하고, 계약 스냅샷에서 비결정 필드와 비밀값을
제거한다.

- **오너:** `@ddxng5` (② replay/record 파트)
- **의존:** `@ohmymcp/core`
- **결정:** [ADR-0003](../../docs/adr/0003-cassette-matching-key.md)

## 공개 API

```ts
import {
  cassetteClient,
  loadCassette,
  saveCassette,
  type Cassette,
} from "@ohmymcp/record";

const path = "fixtures/weather.cassette.json";
const cassette = await loadCassette(path);

const client = cassetteClient(realClient, {
  cassette,
  cassettePath: path,
  onFlush: (next) => saveCassette(path, next),
});

try {
  const tools = await client.listTools();
  const result = await client.callTool("get_weather", { city: "Seoul" });
  console.log(tools, result);
} finally {
  await client.close();
}
```

## 모드

| 모드 | 동작 |
|---|---|
| `record` | 항상 실제 client를 호출하고 새 카세트를 만든다. |
| `replay` | 카세트에 저장된 `listTools`와 `callTool` 응답만 돌려준다. 누락되면 에러다. |
| `auto` | 카세트에 있으면 재생하고, 없으면 실제 호출 뒤 카세트에 추가한다. |

`mode`를 생략하면 `auto`로 동작한다. `cassettePath`는 파일 IO를 수행하지 않고, 실패 메시지에
표시할 경로로만 사용한다.

`close()`는 `onFlush`가 있으면 저장용으로 마스킹한 카세트를 넘긴 뒤 `inner.close()`를
호출한다. 파일 IO는 `loadCassette`와 `saveCassette`로 분리되어 있고, 테스트에서는 `onFlush`에
인메모리 저장 함수를 넣으면 된다.

`inner.close()`는 `onFlush`가 실패해도 `finally`로 항상 실행된다. `onFlush`와
`inner.close()`가 동시에 실패하면 `inner.close()`의 오류가 우선한다 — `onFlush`의 오류는
버려지고 호출자에게 전달되지 않는다 (JS `try`/`finally` 기본 동작).

실제 `listTools` 또는 `callTool` 호출은 성공했지만 결과가 JSON 카세트로 복제될 수 없으면
호출 결과는 그대로 돌려주고, `close()`에서 녹화 실패와 값 경로를 보고한다. 이때 불완전한
카세트를 저장하지 않도록 `onFlush`는 호출하지 않는다.

## 매칭과 저장 규칙

`matchKey(toolName, args)`는 `toolName`과 stable JSON 인자를 SHA-256 hex로 해시한다. 원본
인자는 마스킹 전에 키 계산에 쓰지만, 파일에는 해시만 저장한다. 객체 키 순서는 사전순으로
정렬하고, 객체의 `undefined` 필드는 제거하며, 배열 순서는 유지한다.

카세트는 `version: 1`, `interactions`, 선택적인 `tools`를 가진다. `tools`에는 `listTools`
응답을 저장한다. `replay` 모드에서 `listTools`도 실서버로 나가지 않는다.

같은 키에 다른 응답이 녹화되면 첫 응답을 유지하고 경고한다. 같은 요청에 다른 응답이 오는
서버는 카세트가 숨길 문제가 아니라 결정론성 결함이다.

`replay`에서 키를 찾지 못하면 같은 툴의 저장 요청 중 표시 가능한 인자 차이가 가장 적은 항목과
필드별 차이를 보여준다. 마스킹 후 인자가 동일하면 비밀값 차이 또는 어긋난 키를 구분할 수 있도록
요청 키와 저장 키의 앞 8자를 보여준다.

## 마스킹과 계약 스냅샷

`redact(value)`는 `authorization`, `apiKey`, `accessToken`, `refreshToken`, `token`,
`secret`, `password`를 이름에 포함하는 필드를 `"[redacted]"`로 바꾼다. 대소문자는 구분하지
않으며, 안전을 위해 `tokenCount`처럼 과하게 잡히는 이름도 마스킹한다.

`snapshotContract(result)`는 `ToolResult.raw`를 깊게 순회해 `id`, `requestId`, `sessionId`,
`timestamp`, `createdAt`, `updatedAt`, `expiresAt` 필드를 제거한 뒤 비밀값을 마스킹한다.

요청 `args`는 녹화 시점에 마스킹되어 인메모리 카세트에도 원문 비밀값이 남지 않는다. 응답
`content`/`raw`와 `tools`는 재생 결정론성을 위해 내부 카세트에서 원문을 유지하지만,
`onFlush`가 받는 카세트는 이미 마스킹된 저장용 값이다. 값이 JSON 문자열이면 flush 시점에
파싱 가능한 경우 구조화해 마스킹하고 stable JSON 문자열로 저장한다.

## 제외 범위

첫 버전은 사용자 정의 매칭 함수, 사용자 정의 마스킹 규칙, TTL, 부분 매칭을 제공하지 않는다.
필요성이 확인되면 별도 ADR로 확장한다.
