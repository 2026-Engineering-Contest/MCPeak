---
"@mcpeak/generate": minor
"@mcpeak/cli": minor
---

`repair` 가 시험 실행 없이 저장된 승인 명세를 정답으로 놓지 않습니다. 승인 지문 일치와 실제 서버
실행 기록을 별도로 봅니다. 실행 기록이 없으면(`--baseline-only`·`--no-dry-run` 으로 저장한 명세)
서버와 명세 양쪽 원인을 받고, 화면이 그 사실을 알립니다. 진단 프롬프트는 승인 시점 케이스 판정을
정확히 설명하며, `serverDefect` 케이스를 통과 이력이 있는 것으로 말하지 않습니다.

repair 번들 형식이 버전 2 가 됩니다. 이전 번들은 거절되므로 `mcpeak test --repair-bundle` 로 다시
만드세요.
