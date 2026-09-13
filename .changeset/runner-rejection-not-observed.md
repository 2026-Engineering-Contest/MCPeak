---
"@mcpeak/runner": patch
---

거절을 기대했는데 서버가 `isError: false` 정상 응답을 준 케이스가 `rejectionBasis: "unverified"` 로
찍혀, 이미 실패로 잡힌 케이스가 `summary.rejectionUnverified` 와 미확인 목록에 한 번 더 세어졌습니다.
이제 그런 케이스는 `notApplicable` 이고 `rejectionBody` 도 싣지 않아, 거절 근거 확인 대상은 실제로
거절된 케이스만 남습니다.
