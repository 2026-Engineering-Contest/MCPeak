# mock 문서

목 서버 · 응답 주입

이 폴더는 `mock` 에 속하는 설계 문서, 구현 계획, 작업 보고서를 모아 둡니다. ADR 본문은 번호가 전역이라 [`docs/adr/`](../adr/) 에 그대로 있고, 아래 표는 그중 `mock` 담당분만 고른 것입니다.

## ADR

| 번호 | 주제 | 담당 | 상태 |
|---|---|---|---|
| [0005](../adr/0005-mock-data-strategy.md) | 목 데이터 생성 전략 — 사람이 작성 vs 스키마 기반 생성 | mock | 채택 |
| [0007](../adr/0007-mock-stdio-transport.md) | 목 서버의 두 번째 트랜스포트 — stdio 진입점을 낼 것인가 | mock | 채택 |
| [0029](../adr/0029-목-매칭-키-정규화-경계.md) | 매칭 키로 만들 수 없는 인자를 주입 시점에 거부하고, 해시하지 않는다 | mock | 채택 |
| [0030](../adr/0030-mock-src-상대-import-확장자.md) | `packages/mock/src` 의 상대 import 는 `.ts` 확장자를 쓴다 (ADR-0055 로 대체) | mock | 폐기 |
| [0048](../adr/0048-목이-inputSchema-를-실제로-검사한다.md) | 목이 `inputSchema` 를 실제로 검사하되, 주입된 응답이 검사보다 우선한다 | mock | 채택 |
| [0055](../adr/0055-mock-src-가-저장소-공통-import-관례로-돌아온다.md) | `packages/mock/src` 가 저장소 공통 import 관례로 돌아온다 (ADR-0030 대체) | mock | 채택 |

## 설계 명세 (specs)

- [2026-08-15-mock-key-normalization-design.md](./specs/2026-08-15-mock-key-normalization-design.md)
- [2026-09-08-mock-result-serialization-design.md](./specs/2026-09-08-mock-result-serialization-design.md)

## 구현 계획 (plans)

- [2026-08-15-mock-key-normalization-implementation.md](./plans/2026-08-15-mock-key-normalization-implementation.md)
