# @ohmymcp/record

카세트 포맷 · 요청 매칭 키 · 비결정 필드 처리 · 계약 스냅샷.

- **오너:** `@ddxng5` (② replay/record 파트)
- **의존:** `@ohmymcp/core`

## 상태

`record` · `replay` · `snapshotContract` 스텁만 존재한다. 녹화 파일에 인증 헤더가
섞이지 않도록 마스킹 규칙을 오너가 정하고 문서화한다 (CONTRIBUTING §13.5).
매칭 키 설계는 ADR-0003.
