---
"@ohmymcp/generate": minor
---

`generate`: 거절 근거를 확인하지 못한 위반 케이스에 대해 AI 에게 참고 의견을 묻는 통로를 추가했습니다(`prepareRejectionDiagnosisRequests` · `rejectionDiagnosisPrompt` · `dispatchRejectionDiagnosis`). 위반 케이스의 단언은 `isError: true` 하나라 "서버가 입력을 거절한 것"과 "서버가 다른 이유로 죽은 것"이 구분되지 않고, 관찰 80건은 응답 본문 형식으로 그 둘을 가를 수 없음을 보였습니다. 그래서 이 통로는 **판정을 바꾸지 않습니다.** 케이스 결과·종료 코드·`--json`·`RunnerReport` 어디에도 들어가지 않고 승인 화면에만 참고로 나갑니다. 대상은 `unverified` 케이스뿐이고, 전송 payload 에는 기존 redaction 계약(ADR-0033)이 그대로 적용됩니다. provider 응답은 `verdict` 가 `rejected`·`crashed`·`unsure` 셋 중 하나인지, `reason` 이 비지 않았는지, 요청한 케이스에 빠짐없이 한 번씩 답했는지를 전부 검사하고 하나라도 어긋나면 거부합니다.
