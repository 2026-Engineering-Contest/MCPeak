# @ohmymcp/mock

## 0.1.2

### Patch Changes

- Updated dependencies [0d92470]
  - @ohmymcp/core@0.2.0

## 0.1.1

### Patch Changes

- c0d17d6: mock: 인자 매칭 키에서 값이 `undefined` 인 키를 제외한다. `on(tool, { a: 1, b: undefined }, ...)` 로 주입한 응답이 실제 호출 `{ a: 1 }` 과 다른 키가 되어 영영 잡히지 않던 문제를 고친다 — JSON-RPC 를 건너온 인자에는 `undefined` 가 있을 수 없으므로 주입 쪽도 같게 본다. `record` 의 카세트 매칭 키(ADR-0003)와 규칙을 맞춘 것이기도 하다.

## 0.1.0

### Minor Changes

- 623eea0: mock: stdio 진입점(`ohmymcp-mock`)과 인자 무관 매칭(`ANY`)을 추가한다. `core.connect()` 가 아직 stdio 만 알아 우리 도구가 목 서버에 붙지 못하던 것을 푼다 (ADR-0007). HTTP 진입점과 매칭 규칙을 공유한다 — 인자를 지정한 응답이 우선하고 `ANY`(정의 파일에서는 `args` 생략)가 나머지를 받는다.

## 0.0.1

### Patch Changes

- Updated dependencies [606600f]
  - @ohmymcp/core@0.1.0
