# @ohmymcp-hsu/mock

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
