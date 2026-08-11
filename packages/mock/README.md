# @ohmymcp/mock

가짜 데이터 생성 · 응답 주입 API. (릴리스 · 도그푸딩도 이 오너가 겸한다.)

- **오너:** `@storyrago` (③ mock server 파트)
- **의존:** `@ohmymcp/core`

## 상태

`createMockServer` · `injectResponse` 스텁만 존재한다. 스키마 기반 랜덤 vs 고정 시드는
ADR-0005 에서 결정한다 (결정론성이 핵심 가치, CLAUDE.md).
