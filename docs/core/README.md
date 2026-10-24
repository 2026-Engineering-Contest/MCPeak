# core 문서

프로토콜 클라이언트 · 트랜스포트 · 프로세스 수명주기

이 폴더는 `core` 에 속하는 설계 문서, 구현 계획, 작업 보고서를 모아 둡니다. ADR 본문은 번호가 전역이라 [`docs/adr/`](../adr/) 에 그대로 있고, 아래 표는 그중 `core` 담당분만 고른 것입니다.

## ADR

| 번호 | 주제 | 담당 | 상태 |
|---|---|---|---|
| [0001](../adr/0001-transport-strategy.md) | 첫 MCP transport로 stdio 프로세스 연결을 사용한다 | core | 승인 |
| [0020](../adr/0020-streamable-http-transport.md) | 두 번째 transport 로 Streamable HTTP 를 추가하고, 진단을 transport 별 유니온으로 나눈다 | core | 제안 |
| [0035](../adr/0035-callTool-인자의-배열-허용-범위.md) | `callTool` 인자에 배열을 허용하되 희소 배열은 거부한다 | core | 채택 |

## 설계 · 조사 · 인수인계

- [core-stdio-integration-flaky.md](./core-stdio-integration-flaky.md)

## 설계 명세 (specs)

- [2026-08-12-core-stdio-transport-design.md](./specs/2026-08-12-core-stdio-transport-design.md)
- [2026-08-14-core-streamable-http-transport-design.md](./specs/2026-08-14-core-streamable-http-transport-design.md)

## 구현 계획 (plans)

- [2026-08-12-core-stdio-transport-implementation.md](./plans/2026-08-12-core-stdio-transport-implementation.md)
- [2026-08-12-core-stdio-transport-ledger.tsv](./plans/2026-08-12-core-stdio-transport-ledger.tsv)
- [2026-08-14-core-streamable-http-transport-implementation.md](./plans/2026-08-14-core-streamable-http-transport-implementation.md)

## 작업 보고서 (reports)

4 건. [reports/](./reports/) 폴더에 있습니다.
