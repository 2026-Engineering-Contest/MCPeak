---
---

릴리스가 필요 없는 변경이라 빈 changeset 입니다(ADR-0063).

`packages/dashboard` 의 **테스트 파일 두 개만** 고쳤습니다 — 제품 코드는 한 글자도 바뀌지
않았고 사용자가 보는 동작도 그대로입니다. Windows 에서 테스트만 POSIX 파일시스템을 전제해
거짓으로 빨개지던 것을 고쳤습니다([#304](https://github.com/2026-Engineering-Contest/MCPeak/issues/304)).
