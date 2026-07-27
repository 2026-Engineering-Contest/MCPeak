# ADR — 설계 결정 기록 (Architecture Decision Records)

"다르게 갈 수도 있었던" 판단을 한 페이지로 남깁니다. 단순 구현은 대상이 아닙니다.

- 형식: `0001-제목.md`
- 항목: 배경 / 선택지 / 결정 / 이유 / 결과 (CONTRIBUTING §8)
- **오너 1인당 최소 2건**을 마감까지 작성합니다.

아래는 초기 후보의 뼈대 파일입니다. 제목과 상태만 채워져 있고, 내용은 결정 시점에 채웁니다.

| 번호 | 주제 | 담당 |
|---|---|---|
| [0001](./0001-transport-strategy.md) | 트랜스포트 전략: stdio 프로세스 기동 vs 인프로세스 연결 | core |
| [0002](./0002-matcher-strategy.md) | matcher: 기존 러너 확장 vs 독립 구현 | runner |
| [0003](./0003-cassette-matching-key.md) | 카세트 매칭 키 · 비결정 필드 처리 | record |
| [0004](./0004-generation-scope.md) | 생성 테스트의 범위 | generate |
| [0005](./0005-mock-data-strategy.md) | 목 데이터 생성 전략: 스키마 랜덤 vs 고정 시드 | mock |
