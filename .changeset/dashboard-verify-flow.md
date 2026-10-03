---
"@mcpeak/dashboard": minor
---

생성 마법사 4단계에 "한 번에 검증" 옵션(기본 꺼짐)을 더한다. 켜면 승인 질문에 자동으로 답해 명세를 저장하고, 같은 서버에 `test` 를 이어 돌려 결과를 한 화면에 보여 준다. 새 `verify` 플로우는 기존 `generate`·`test` 커맨드 함수를 그대로 부른다(ADR-0046, ADR-0103). `RunIo.reviewIO` 는 `WebReviewIO` 클래스가 아니라 `ReviewIO` 인터페이스로 받는다.
