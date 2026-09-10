---
"@mcpeak/core": minor
"@mcpeak/runner": minor
"@mcpeak/generate": minor
"@mcpeak/cli": minor
---

`tools/list`의 `outputSchema`를 생성 명세에 보존하고 정상 케이스의
`structuredContent`를 저장 당시 출력 계약으로 재검증합니다(#406). 서버가 선언과 응답 타입을
함께 바꿔도 기존 명세가 계약 변경을 탐지하며, 기대 계약·실제 값·위반 필드 경로를 별도 진단으로
표시합니다. 의미를 보존할 수 없는 출력 스키마는 단언을 만들지 않고 CLI에서 미검증 범위와 원인을
알립니다.
