---
"@ohmymcp/mock": patch
---

mock: 인자 매칭 키에서 값이 `undefined` 인 키를 제외한다. `on(tool, { a: 1, b: undefined }, ...)` 로 주입한 응답이 실제 호출 `{ a: 1 }` 과 다른 키가 되어 영영 잡히지 않던 문제를 고친다 — JSON-RPC 를 건너온 인자에는 `undefined` 가 있을 수 없으므로 주입 쪽도 같게 본다. `record` 의 카세트 매칭 키(ADR-0003)와 규칙을 맞춘 것이기도 하다.
