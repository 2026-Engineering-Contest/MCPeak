---
"@mcpeak/cli": minor
---

`@mcpeak/cli/commands` 에 `autoReviewIO` 를 더한다. `generate` 의 승인 질문(사전보완 전송, 시험 실행, 실패 분류, 교정 값, 재검증, 저장)에 정해진 정책으로 답하는 `ReviewIO` 다. 남은 실패는 서버 결함으로 기록하고, 고른 답은 `▸ 자동 승인: <질문> → <답>` 으로 화면에 남긴다. 대시보드의 "한 번에 검증" 이 쓴다(ADR-0103).
