---
"@mcpeak/dashboard": minor
---

홈 스위트 목록의 `실행` 옆에 `명세 확인` 을 더합니다. 누르면 그 파일을 읽어 케이스당 한 줄로
행 안에 펼칩니다. 다시 누르면 닫힙니다.

```
Weather 예제 (id weather) · 케이스 8건
  1. get-weather-success  callTool get_weather {"city":"서울"}  → isError=false
  2. tools-listed         listTools  → toolExists get_weather, toolExists add
  ...
```

지금까지 홈은 파일 경로만 보여 줘서, 어떤 케이스가 들어 있는지는 에디터로 열어야 알 수 있었습니다.
모양은 `mcpeak generate` 검토 메뉴의 `show` 와 같습니다. 두 자리가 다르게 보이면 같은 파일을 두 번
배워야 합니다.

파일은 버튼을 누를 때 읽습니다(`GET /api/suites/<path>`). 목록을 만들 때 전부 읽어 두면 스위트가
많은 프로젝트에서 첫 화면이 느려지고, 그 사이 바뀐 파일이 낡은 채로 보입니다. 못 읽거나 스위트
형식이 아니면 그 이유를 행 안에 적고 화면은 그대로 둡니다. 실행 폼과는 독립이라 둘 다 열려 있을
수 있습니다.
