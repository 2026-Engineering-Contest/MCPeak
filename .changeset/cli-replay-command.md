---
"ohmymcp": minor
---

`ohmymcp replay <suite.json> --cassette <path>` 를 추가했습니다. 녹화된 카세트만으로 테스트 명세를 재생하며 MCP 서버를 실행하지 않습니다. 카세트에 마스킹된 값이 있으면 그 자리의 판정이 실제 서버와 다를 수 있다는 경고를 냅니다.
