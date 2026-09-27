---
"@mcpeak/runner": patch
---

거절을 기대한 케이스에 서버가 정상 응답했을 때 서버가 무엇을 받아들였는지 말할 재료를 내보낸다. `acceptedViolations` 는 `checkInputContract` 가 거절 기대 케이스에서 억제한 선언 위반을 케이스별로 돌려주고(같은 대조 루프를 써서 두 함수가 다른 위반을 말하지 않는다), `describeAcceptedRejection` 은 그것을 `서버가 필수 필드 'b' 가 빠진 입력을 받아들였습니다` 같은 문장으로 만들며, `rejectionAccepted` 는 보고서만 보고 "거절 기대에 정상 응답" 인지 판정한다. `describeSpecFinding` 은 선택 인자로 `{ rejectionAccepted }` 문맥을 받아, 서버가 받아들인 경우의 `REJECTION_WITHOUT_VIOLATION` 을 입력을 고치라는 말 대신 서버의 입력 제약이 사라졌을 수 있다는 문장으로 낸다. 문맥을 넘기지 않으면 문장은 이전과 같다.
