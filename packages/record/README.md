# @ohmymcp-hsu/record

MCP 클라이언트를 카세트로 감싸 녹화·재생하고, 값이 프로세스 밖으로 나가는 경계에서
비밀값을 제거한다.

- **오너:** `@ddxng5` (② replay/record 파트)
- **의존:** `@ohmymcp-hsu/core`
- **결정:** [ADR-0003](../../docs/adr/0003-cassette-matching-key.md) (개정:
  [ADR-0039](../../docs/adr/0039-민감-키-목록과-매칭-경계.md),
  [ADR-0040](../../docs/adr/0040-스키마와-데이터의-마스킹-규칙-분리.md),
  [ADR-0041](../../docs/adr/0041-마스킹의-적용-경계.md))

## 공개 API

```ts
import {
  cassetteClient,
  loadCassette,
  saveCassette,
  type Cassette,
} from "@ohmymcp-hsu/record";

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

호출 인자가 JSON 카세트로 표현될 수 없으면 `record`와 `auto` 모드는 실제 호출 결과를 그대로
돌려주고 `close()`에서 녹화 실패를 보고한다. 이때 불완전한 카세트를 저장하지 않도록 `onFlush`는
호출하지 않는다. `replay` 모드는 실제 호출 없이 카세트를 조회할 수 없는 값의 경로와 종류를
보고한다.

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

## 마스킹

`redact(value)`는 키를 `-`·`_` 구분자와 카멜케이스 경계로 단어를 나눈 뒤, **뒤에서부터
이어붙인 접미 조합**이 `authorization`, `apikey`, `accesstoken`, `refreshtoken`, `token`,
`secret`, `password`, `cookie` 중 하나와 정확히 일치하는 필드만 `"[redacted]"`로 바꾼다.
대소문자는 구분하지 않는다. 부분 문자열 포함이 아니라 접미 일치이므로 `tokenCount`·
`passwordPolicy`처럼 머리 명사가 다른 합성어는 마스킹하지 않는다. 반대로 `X-Api-Key`처럼
목록에 없는 단어가 앞단어와 합쳐 목록에 걸리는 경우는 그대로 마스킹한다. 판정 규칙과 한계는
[ADR-0039](../../docs/adr/0039-민감-키-목록과-매칭-경계.md).

`tools`의 `inputSchema`는 데이터가 아니라 스키마라 `redact`가 아닌 별도 규칙
(`redactSchema`)을 탄다. 프로퍼티 이름 자체는 절대 마스킹하지 않고, 민감한 프로퍼티 아래의
`default`·`const`·`examples`·`enum` 값만 가린다. 근거는
[ADR-0040](../../docs/adr/0040-스키마와-데이터의-마스킹-규칙-분리.md).

요청 `args`는 녹화 시점에 마스킹되어 인메모리 카세트에도 원문 비밀값이 남지 않는다. 응답
`content`/`raw`와 `tools`는 재생 결정론성을 위해 **내부 카세트에는** 원문으로 남지만,
`callTool`·`listTools`가 호출자에게 돌려주는 값과 `onFlush`가 받는 저장용 카세트는 이미
마스킹되어 있다 — 값이 프로세스 밖으로 나가는 경계마다 마스킹을 건다
([ADR-0041](../../docs/adr/0041-마스킹의-적용-경계.md)). 값이 JSON 문자열이면 이 경계에서
파싱 가능한 경우 구조화해 마스킹하고 stable JSON 문자열로 저장한다.

## 제외 범위

첫 버전은 사용자 정의 매칭 함수, 사용자 정의 마스킹 규칙, TTL, 부분 매칭을 제공하지 않는다.
필요성이 확인되면 별도 ADR로 확장한다.

**계약 스냅샷(`snapshotContract`)과 비결정 필드 제거도 제공하지 않는다.** 이 패키지는
비결정성을 지워서 감추지 않고, 같은 키에 다른 응답이 오면 경고해서 드러낸다. 실행 간
차이를 판정하는 일은 `runner` 의 결정론성 확인이 맡는다
([ADR-0038](../../docs/adr/0038-결정론성-확인의-비교-대상과-캡처-위치.md)). 근거는
[ADR-0046](../../docs/adr/0046-계약-스냅샷-api-철회.md).
