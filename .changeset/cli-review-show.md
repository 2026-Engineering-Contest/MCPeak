---
"@mcpeak/cli": minor
---

`mcpeak generate` 의 검토 메뉴에 `show` 를 더합니다. 지금 승인된 명세를 케이스당 한 줄로 찍습니다.

검토 메뉴는 AI 제안의 diff(바뀐 값)만 보여 줘서, AI 가 만든 케이스가 무엇인지 저장 전에는 볼 곳이
없었습니다. `edit` 는 파일 경로를 묻는 것이지 보여 주는 것이 아니고, diff 끝의 안내도 "전체는 저장
후 JSON 을 확인하세요" 였습니다.

`show` 는 아무것도 묻지 않고 바로 찍은 뒤 메뉴로 돌아옵니다.

```
현재 명세: Weather (id weather) · 케이스 8건 · revision 1
  1. get-weather-success  callTool get_weather {"city":"서울"}  → isError=false
  2. tools-listed         listTools  → toolExists get_weather, toolExists add
  ...
저장하면 이 내용이 examples/weather-server/server.suite.json 에 쓰입니다.
```

`save` 가 읽는 것과 같은 명세라 여기 보이는 것이 저장됩니다. AI 후보를 받아 두고 아직 반영하지
않았으면 그 사실을 한 줄 덧붙입니다. 전문 JSON 이 아니라 한 줄 요약인 이유는 케이스 8건이면
JSON 이 100줄을 넘어 대시보드 로그를 덮기 때문입니다. 입력값은 80자에서 자릅니다.

대시보드는 CLI 의 선택지를 그대로 버튼으로 만들므로 손대지 않아도 `show` 버튼이 생깁니다.
