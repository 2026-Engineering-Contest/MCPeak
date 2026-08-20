# @mcpeak/record

MCP 클라이언트를 카세트로 감싸 녹화·재생하고, 값이 프로세스 밖으로 나가는 경계에서
비밀값을 제거한다.

- **오너:** `@ddxng5` (② replay/record 파트)
- **의존:** `@mcpeak/core`
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
} from "@mcpeak/record";

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

### `record` 모드가 지우는 것

`record`는 넘겨받은 `cassette`를 **무시하고 빈 카세트에서 시작한다.** 저장하면 이번 실행이
부른 것만 남고 나머지는 사라진다. 그것이 "다시 녹화한다"의 의미다.

지우는 것은 막지 않되, **말없이 지우지는 않는다.** `record` 모드에서 `onFlush`가 있으면
`close()` 시점에 기존 카세트와 비교해 사라지는 상호작용을 `onWarning`으로 알린다.

```
→ --record 가 기존 카세트의 상호작용 2개를 지웁니다: fixtures/weather.cassette.json
  기존 3개 중 1개는 유지되고, 이번 실행에 없는 2개는 사라집니다.
  사라지는 요청: get_weather({"city":"부산"}), get_weather({"city":"제주"})
  → 이번 실행이 그 케이스를 부르지 않았습니다. 테스트 필터나 중간 실패를 확인하세요.
  → 기존 녹화본을 지키려면 --record 없이 실행하세요. 없는 것만 덧붙습니다.
```

경고일 뿐 저장을 막지 않는다. 막으면 `--record`가 갈아엎으라는 명령이라는 의미가 바뀌고,
`--record`를 자동으로 도는 파이프라인이 깨진다.

경고는 `onFlush`가 성공한 뒤에만 나온다. `onFlush`가 없거나 던지면 파일이 그대로이므로
사라지는 것도 없는데, 그때 "사라집니다"라고 말하면 거짓이 된다.

판정은 아래 두 함수로 분리돼 있고 `cli`가 직접 부를 수도 있다.

```ts
diffCassettes(before: Cassette | null, after: Cassette): CassetteDropReport;
droppedInteractionsMessage(report: CassetteDropReport, cassettePath?: string): string | null;
```

`dropped` 판정은 `key` 기준이다. 같은 키에 응답만 바뀐 것은 손실이 아니라 갱신이므로 세지
않는다. `before`가 `null`이면(새 파일) 사라지는 것이 없다. `auto`는 기존 것을 물려받아
덧붙이므로 이 경고를 내지 않는다.

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

## 드리프트 확인 (`verifyCassette`)

`auto` 모드는 카세트에 있는 요청이면 서버를 부르지 않는다. 그래서 **서버 응답이 바뀌어도
영원히 알아채지 못한다.** 그것을 확인하는 방법이 파괴적인 `--record` 뿐이면 재동기화를
피하게 되고, 카세트는 손으로 쓴 목과 똑같이 낡는다. 이 함수가 그 비파괴 경로다.

```ts
import { loadCassette, verifyCassette } from "@mcpeak/record";

const cassette = await loadCassette(path);
if (cassette !== null) {
  const result = await verifyCassette(client, cassette, { cassettePath: path });
  // { matched, mismatched, failed, skipped, toolsChanged }
  for (const item of result.mismatched) console.error(item.message);
}
```

**카세트를 고치지도 저장하지도 않는다.** 연결도 닫지 않는다 — 소유권은 호출자에게 있다.
CLI 는 `mcpeak verify <cassette.json> --command <executable>` 로 감싼다.

읽기 전용인 것은 **카세트 파일이지 서버가 아니다.** 녹화된 요청을 전부 다시 호출하므로,
메일 발송·결제·파일 쓰기 같은 툴이 카세트에 있으면 그 부작용이 실제로 다시 일어난다.
부작용이 있는 서버에는 샌드박스에서 붙여라.

| 분류 | 뜻 |
|---|---|
| `matched` | 카세트와 실서버 응답이 같다 |
| `mismatched` | 응답이 달라졌다. 카세트가 낡았다는 뜻이다 |
| `failed` | 실서버 호출 자체가 실패했다. 응답 차이와 구분한다 |
| `skipped` | args 에 마스킹된 값이 있어 실서버에 그대로 보낼 수 없다 |

### 비교는 마스킹 후에 한다

파일에서 읽은 카세트의 응답은 `prepareCassetteForWrite` 를 거쳐 이미 마스킹돼 있고 실서버
응답은 원문이다. 그대로 비교하면 비밀값이 든 응답이 **전부 거짓 불일치**가 된다. 그래서
실서버 응답에 `redact` 를 먼저 걸고 비교한다.

대가로 **비밀값 자체만 바뀐 경우는 감지하지 못한다** — 양쪽 다 `"[redacted]"` 로 보인다.
다만 그 값은 테스트에도 마스킹돼 나가므로([ADR-0041](../../docs/adr/0041-마스킹의-적용-경계.md))
어떤 단언도 그것에 의존할 수 없고, 따라서 놓쳐도 테스트 결과는 달라지지 않는다. 필드 추가·삭제,
이름 변경, 일반 값 변경, `isError` 변경, 툴 스키마 변경은 모두 잡힌다.

요청 **인자**에 비밀값이 있었던 상호작용은 원래 요청을 복원할 수 없다. 마스킹된 값을 실서버에
그대로 보내지 않고 `skipped` 로 보고한다. 그 요청의 드리프트는 `--record` 로만 확인된다.

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
[ADR-0047](../../docs/adr/0047-계약-스냅샷-api-철회.md).
