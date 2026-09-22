---
"@mcpeak/dashboard": patch
---

중계기 기동 실패 진단에서 짧은 비밀값도 가린다. 지금까지는 20 자 이상인 환경변수 값만
가려서, 12 자짜리 API 키 같은 짧은 비밀이 HTTP 400 본문에 원문으로 실릴 수 있었다. 이제
이름이 `KEY`·`TOKEN`·`SECRET`·`PASSWORD`·`CREDENTIAL` 를 포함하면 8 자 이상부터 가린다.
