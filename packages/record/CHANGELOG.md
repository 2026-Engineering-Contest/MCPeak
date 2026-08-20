# @mcpeak/record

## 0.1.2

### Patch Changes

- 8a5b2a4: record 실행과 replay 실행이 같은 요청에 다른 값(타입까지)을 돌려주던 문제를 고칩니다.
  `callTool`·`listTools` 반환값도 카세트 파일 저장 시점과 같은 경계에서 마스킹합니다.
  카세트로 클론할 수 없는 응답을 그대로 돌려주던 녹화 실패 fallback 경로는 이 마스킹을 타지
  않고 원문을 그대로 돌려줍니다 — 그 값에 마스킹을 걸면 fallback 자체가 다시 던지기 때문입니다.
- 9bdd914: record와 auto 모드에서 카세트로 직렬화할 수 없는 호출 인자가 실제 MCP 호출을 막지 않도록 합니다. 실제 결과는 반환하되 불완전한 카세트를 저장하지 않도록 `onFlush`는 호출하지 않고, `close()`에서 값의 경로와 종류를 보고합니다. replay 모드에서는 실제 호출 없이 조회할 수 없는 값의 경로와 종류를 안내합니다.
- 8eb955d: 민감 키 목록에 `key` 합성어와 `passwd` · `credential` 이 추가되고, **복수형이 조회에서
  흡수됩니다.**

  ADR-0039 가 매칭을 접미 단어열 **정확 일치**로 좁힌 뒤, 목록이 그 규칙을 따라가지 못한
  구멍이 남아 있었습니다. 접미 조합이 목록에 없으면 전부 통과하므로 `secretKey` 는 `secret`
  이 목록에 있어도 접미 조합이 `key` · `secretkey` 뿐이라 어디에도 걸리지 않았습니다.
  `apiKey` 를 목록에 따로 넣어야 했던 것과 같은 구멍입니다. 복수형도 같습니다 — `token` 은
  걸리지만 `tokens` 는 통과했고, 토큰이나 비밀값이 배열로 오는 응답은 흔합니다.

  **새로 마스킹되는 것**

  | 종류         | 예                                                                           |
  | ------------ | ---------------------------------------------------------------------------- |
  | `key` 합성어 | `privateKey` · `secretKey` · `signingKey` · `sessionKey`                     |
  | 그 외 추가   | `credential` · `passwd`                                                      |
  | 복수형       | `tokens` · `secrets` · `passwords` · `cookies` · `apiKeys` · `refreshTokens` |

  **여전히 마스킹되지 않는 것** — `tokenCount` · `secretariat` 은 그대로고, 복수형 완화가
  `tokenCounts` · `secretariats` · `cookieCounts` 를 새로 잡지도 않습니다. 꼬리 `s` 를 떼도
  머리 명사는 바뀌지 않기 때문입니다. `key` 단독은 ADR-0039 의 판단대로 계속 넣지 않습니다.

  **일부러 뺀 것** — `auth` 는 `auth: { token, type }` 의 하위 트리를 통째로 가려 구조를 영영
  못 보게 만들고(`auth.token` 은 이미 `token` 으로 걸립니다), `pwd` 는 파일시스템 MCP 서버가
  작업 디렉터리 이름으로 쓰며, `bearer` 는 `bearerToken` 이 이미 `token` 으로 걸립니다.

  **카세트 파일의 내용이 바뀝니다.** 포맷과 `CASSETTE_VERSION` 은 그대로라 기존 카세트도 계속
  읽히지만, 다시 녹화하기 전까지는 예전 마스킹 결과를 그대로 갖고 있습니다. 위 필드를 단언하던
  테스트는 이제 `"[redacted]"` 를 보게 됩니다. 근거는 ADR-0045 에 있습니다.

- d70affe: replay에서 카세트 키를 찾지 못했을 때 가장 가까운 저장 요청의 필드별 차이를 보여주고, 마스킹 후 동일한 요청은 키 앞부분으로 구분합니다.
- 99db6ee: 카세트에 저장되는 `tools.inputSchema` 가 **더 이상 파괴되지 않습니다.**

  지금까지는 응답 데이터와 같은 규칙으로 스키마를 마스킹해서, `properties.apiKey` 처럼
  민감한 이름의 프로퍼티는 **정의 객체 전체가 `"[redacted]"` 문자열로 치환**됐습니다.

  ```
  { properties: { apiKey: { type: "string", default: "sk-..." } } }
            ↓ (이전)
  { properties: { apiKey: "[redacted]" } }
            ↓ (이후)
  { properties: { apiKey: { type: "string", default: "[redacted]" } } }
  ```

  스키마에서 프로퍼티 이름은 값이 아니라 선언 대상입니다. 이제 구조는 그대로 두고
  `default` · `examples` · `const` · `enum` 처럼 **값이 들어가는 자리만** 마스킹합니다.
  `properties` · `items` 는 재귀하고, 민감도는 그 자리까지 내려온 프로퍼티 이름으로
  판정합니다. ADR-0004 가 해석하지 않는 `allOf` · `anyOf` · `oneOf` 는 대상이 아닙니다.

  **이 변화가 중요한 이유** — 스키마가 부서지면 `replay` 와 `generate --cassette` 경로의
  입력 계약 대조가 판정 근거를 잃고, 그 실패가 "위반 없음"과 구분되지 않게 조용히
  사라집니다. 이제 스키마가 보존되어 대조가 실제로 의미를 갖습니다.

  카세트 포맷과 `CASSETTE_VERSION` 은 바뀌지 않지만, 저장되는 스키마의 **구조**가
  달라지므로 구형 카세트와는 내용이 어긋납니다. 다시 녹화하기 전까지는 예전 구조를
  그대로 갖고 있습니다.

  근거는 ADR-0040 에 있습니다.

- f0ae3d3: 민감 키 판정이 **이름에 포함되면 걸리는 방식에서 접미 단어열이 정확히 일치할 때 걸리는
  방식으로** 바뀝니다. 그리고 `cookie` 가 목록에 추가됩니다.

  **새로 마스킹되는 것** — `Cookie` · `Set-Cookie` 헤더. 세션 값을 나르는데도 목록에 없어
  카세트 파일과 경고 출력에 원문으로 남고 있었습니다. `authorization` 은 이미 목록에 있었으니
  같은 급인 쪽만 빠져 있던 셈입니다.

  **더 이상 마스킹되지 않는 것** — `tokenCount` · `passwordPolicy` · `secretariat` 처럼 민감
  단어를 품고 있을 뿐인 필드. 영어 합성명사는 마지막 단어가 머리라서 `accessToken` 은 토큰의
  일종이지만 `tokenCount` 는 개수의 일종입니다.

  | 키                                              | 이전      | 이후      |
  | ----------------------------------------------- | --------- | --------- |
  | `Cookie` · `Set-Cookie`                         | 원문 노출 | 마스킹    |
  | `accessToken` · `X-Api-Key` · `apiKey0`         | 마스킹    | 마스킹    |
  | `tokenCount` · `passwordPolicy` · `secretariat` | 마스킹    | 값 그대로 |

  **카세트 파일의 내용이 바뀝니다.** 포맷과 버전은 그대로라 기존 카세트도 계속 읽히지만,
  다시 녹화하기 전까지는 예전 마스킹 결과를 그대로 갖고 있습니다.

  `tokenCount` 같은 필드를 단언하던 테스트는 이제 실제 값을 보게 됩니다. 근거는 ADR-0039 에
  있습니다.

- 2d68bdb: 같은 요청에 다른 응답이 왔을 때 나오는 경고가 **비밀값을 원문 그대로 출력하던 문제를
  고칩니다.** 응답 마스킹은 카세트를 파일로 쓰는 시점에만 걸렸기 때문에, 이 경고에는
  `sessionToken` 같은 값이 가려지지 않은 채 실렸습니다. 같은 메시지의 요청 쪽은 이미
  마스킹되고 있었으므로 응답 쪽만 새고 있었습니다. 경고는 stderr 로 나갑니다.

  이제 표시 직전에만 마스킹합니다.

  ```
  → 같은 요청에 다른 응답이 왔습니다: get_stock({"ticker":"AAPL"})
    1회차 raw.token: "[redacted]" / 2회차 raw.token: "[redacted]"
    → 위 값은 마스킹되어 표시됩니다. 실제 값은 서로 다릅니다.
  ```

  **차이 판정은 원문 기준 그대로입니다.** 마스킹한 값으로 비교하면 서로 다른 두 비밀값이
  같아져 "같은 요청에 다른 응답" 경고 자체가 사라집니다. 이 경고의 목적이 비결정 서버를
  드러내는 것이므로(ADR-0003), 판정과 표시를 분리하는 쪽을 골랐습니다.

  값이 마스킹되면 양쪽이 똑같이 `[redacted]` 로 보여 거짓 양성처럼 읽히므로, 값이 실제로
  다르다는 고지를 한 줄 붙입니다.

  카세트 포맷과 저장되는 내용은 바뀌지 않습니다.

- Updated dependencies [cd25fb4]
- Updated dependencies [bf16fb5]
  - @mcpeak/core@0.3.0

## 0.1.1

### Patch Changes

- 81579f1: record: 실제 MCP 호출이 성공한 뒤 카세트에 기록할 `callTool` 응답이나 `listTools` 결과를
  복제하지 못해도 성공 결과를 먼저 돌려주고, `close()`에서 녹화 실패와 JSON 경로를 함께
  보고합니다.
- 81579f1: record: `redact`의 sparse array 검사를 실제로 실행되는 경로로 옮기고, request args와 response
  마스킹 시점 문서를 구현과 맞춥니다.

## 0.1.0

### Minor Changes

- 38ec704: record: McpClient 카세트 데코레이터와 stable JSON 기반 녹화·재생 API 추가

### Patch Changes

- Updated dependencies [0d92470]
  - @mcpeak/core@0.2.0

## 0.0.1

### Patch Changes

- Updated dependencies [606600f]
  - @mcpeak/core@0.1.0
