---
"@mcpeak/dashboard": minor
---

사용자 모드의 사전 점검 화면(`#/user/check`)을 채운다. README 의 `mcpServers` JSON 조각, 실행 명령 한 줄, 서버 URL 을 붙여 넣으면 기존 `POST /api/analyze/security` 로 한 번 점검하고, 결과 맨 위에 심각·주의 발견의 해결 문장을 모은 "먼저 할 일" 카드를 보인다. 붙여 넣은 설정의 환경변수와 헤더는 이름만 화면에 보이고 값은 어디에도 보내지 않는다(ADR-0111). 격리 실행이 기본으로 켜져 있다. 서버 면은 바뀌지 않는다.
