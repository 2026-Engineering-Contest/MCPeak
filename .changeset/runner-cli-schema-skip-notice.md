---
"@mcpeak/runner": minor
"@mcpeak/cli": patch
---

`test`가 서버의 `inputSchema`를 해석하지 못해 입력 계약 검사를 건너뛴 경우, 테스트 케이스가
통과했더라도 그 사실을 알립니다(#288). `SCHEMA_NOT_ANALYZABLE` finding에는 해석 실패 사유가
추가되며, 사람용 출력은 사유와 함께 스키마를 고치는 방법을 안내합니다.

README의 목 서버 예시도 `properties`와 `required`가 있는 검사 가능한 입력 스키마로 고쳤습니다.
