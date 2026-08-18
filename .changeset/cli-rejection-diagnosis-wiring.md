---
"ohmymcp": minor
"@ohmymcp/generate": minor
---

`generate` 승인 화면에서 거절 근거를 확인하지 못한 케이스를 **AI 에게 물어볼 수 있습니다.** 미확인 목록 아래에 요청 여부를 묻고, 사용자가 승낙했을 때만 provider 를 부릅니다. 자동으로 부르지 않습니다 — 케이스가 많으면 비용이 곱해지고 provider 가 없는 사용자가 대다수입니다. `--provider` 가 없거나 미확인이 0건이면 아무것도 묻지 않습니다.

**이 진단은 참고입니다. 케이스 판정도 저장 여부도 바꾸지 않습니다.** 결과는 화면에만 나가고 `--json` 이나 `RunnerReport` 에는 들어가지 않으며, 화면 마지막 줄이 그 사실을 항상 함께 적습니다. provider 가 실패하거나 형식을 어긴 답을 보내도 안내만 찍고 승인 화면이 그대로 이어집니다.

응답 본문이 없는 케이스는 진단에서 **제외합니다.** 호출이 오류로 끝나 서버 응답이 아예 없는 경우가 있는데, 빈 값을 채워 물으면 AI 에게 판단 재료가 없어 지어낸 답만 돌아옵니다. 몇 건을 왜 뺐는지는 화면에 남깁니다.

`@ohmymcp/generate` 의 provider 객체에 `diagnoseRejection` 메서드가 추가됐습니다. `RejectionDiagnosisProvider` 의 메서드 이름이 `diagnose` 에서 `diagnoseRejection` 으로 바뀌었습니다 — 한 provider 객체가 기존 `diagnose(request: DiagnosisRequest, …)` 와 시그니처가 충돌하지 않게 하기 위함입니다.
