# @ohmymcp-hsu/mock

## 0.4.0

### Minor Changes

- e99192a: Node.js 최소 지원 버전을 22.18.0으로 올리고, 배포 패키지의 `engines.node`에 같은 요구사항을 명시합니다.

### Patch Changes

- a019771: `mock.on()` 이 `tools` 에 없는 툴 이름을 주입 시점에 거절합니다. 정의 파일 경로는 이미
  `assertMockDefinition` 이 잡고 있었지만 `on()` 은 통과시켜, 오타가 주입에 성공한 것처럼 보이고
  실제 호출이 미스로 떨어질 때까지 아무 신호도 받지 못했습니다.
- Updated dependencies [e99192a]
- Updated dependencies [2e62615]
- Updated dependencies [93816a8]
  - @mcpeak/core@0.4.0

## 0.3.0

### Minor Changes

- c923b48: 목이 `inputSchema` 로 호출 인자를 검사해 위반 인자를 거절한다 (#181, ADR-0048).

  `required` · `type` · `enum` · `range` 네 축을 최상위 필드에서만 본다. 주입된 응답이 검사보다
  우선하므로, 위반 인자에 응답을 지정해 두었다면 종전대로 그 응답이 나간다. 해석할 수 없는
  스키마는 건너뛴다 — 루트에 `anyOf` · `$ref` 등이 있으면 그 툴 전체를, 필드에 있으면 그 필드만
  건너뛰고 `required` 검사와 나머지 필드 검사는 계속한다. 툴 전체를 건너뛴 경우는 서버를 띄울 때
  stderr 로 한 번 고지한다.

  **동작 변경:** `ANY` 폴백에 기대어 위반 인자를 성공시키던 정의는 이제 거절을 받는다. 종전
  동작이 필요하면 그 인자를 `responses` 에 명시한다.

- 10ae345: mock: 정의에 `isError` 를 허용해 거절 응답을 주입할 수 있게 한다. 지금까지 목은 성공 응답만 표현할 수 있어서, "이 인자면 서버가 이렇게 거절한다" 를 사용자가 선언할 방법이 없었다. `isError: true` 를 붙이면 내가 정한 문장으로 거절할 수 있다 — 실패 UX 도 계약의 절반이고, 설계 단계에서 클라이언트에 보여줘야 하는 것이다. 선택 필드라 기존 정의 파일과 `mock.on()` 3인자 호출은 그대로 동작한다. 매칭 미스가 만드는 `isError`(표에 없다는 목의 안내)와 주입한 거절(서버가 이렇게 거절한다는 설계)은 본문으로 구분된다.

## 0.2.0

### Minor Changes

- 464d065: mock: 매칭 키로 만들 수 없는 인자를 주입 시점에 거부한다. 순환 참조 · 희소 배열 · `NaN` · `Infinity` · `Date` · 함수처럼 JSON 으로 표현할 수 없는 값은 어떤 호출로도 도달할 수 없어, 그대로 두면 주입이 영영 안 맞거나(희소 배열) 서로 다른 주입이 같은 키가 되어 엉뚱한 응답이 나갔다(`NaN` 과 `Infinity` 가 둘 다 `null`). 거부 집합은 `record` 의 카세트 매칭 키(ADR-0003)와 같게 맞췄다. 또한 깊게 중첩된 호출 인자가 스택을 터뜨려 목 서버 프로세스를 죽이던 문제를 고친다 — 깊이 512 를 넘으면 `isError: true` 응답으로 알린다.

### Patch Changes

- Updated dependencies [cd25fb4]
- Updated dependencies [bf16fb5]
  - @ohmymcp-hsu/core@0.3.0

## 0.1.2

### Patch Changes

- Updated dependencies [0d92470]
  - @ohmymcp-hsu/core@0.2.0

## 0.1.1

### Patch Changes

- c0d17d6: mock: 인자 매칭 키에서 값이 `undefined` 인 키를 제외한다. `on(tool, { a: 1, b: undefined }, ...)` 로 주입한 응답이 실제 호출 `{ a: 1 }` 과 다른 키가 되어 영영 잡히지 않던 문제를 고친다 — JSON-RPC 를 건너온 인자에는 `undefined` 가 있을 수 없으므로 주입 쪽도 같게 본다. `record` 의 카세트 매칭 키(ADR-0003)와 규칙을 맞춘 것이기도 하다.

## 0.1.0

### Minor Changes

- 623eea0: mock: stdio 진입점(`ohmymcp-mock`)과 인자 무관 매칭(`ANY`)을 추가한다. `core.connect()` 가 아직 stdio 만 알아 우리 도구가 목 서버에 붙지 못하던 것을 푼다 (ADR-0007). HTTP 진입점과 매칭 규칙을 공유한다 — 인자를 지정한 응답이 우선하고 `ANY`(정의 파일에서는 `args` 생략)가 나머지를 받는다.

## 0.0.1

### Patch Changes

- Updated dependencies [606600f]
  - @ohmymcp-hsu/core@0.1.0
