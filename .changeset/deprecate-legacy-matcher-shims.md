---
"@ohmymcp/runner": patch
---

`createMcpTest` 와 `toContainTool` 을 `@deprecated` 로 표시합니다. 두 함수는 외부 테스트 러너
확장을 전제한 시그니처로 남아 있었고 JSDoc 은 "runner 오너가 채운다" 라고 적고 있었지만,
ADR-0002 가 matcher 를 독립 구현으로 유지하고 외부 러너 adapter 를 제공하지 않기로 결정하면서
채워질 일이 없어졌습니다. 시그니처와 `not implemented` 동작은 그대로 두고 표기만 바로잡으며,
제거는 major 릴리스와 migration 문서를 동반합니다. 새 코드는 `defineMcpSuite` 로 명세를 만들고
`runSuite` 로 실행하세요.
