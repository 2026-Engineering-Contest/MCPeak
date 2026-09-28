---
"@mcpeak/dashboard": minor
---

대시보드에 "목 만들기" 화면(사이드바 Mock)을 추가한다. `mock.json` 을 폼으로 새로 만들거나 기존 파일을 열어 고칠 수 있고, 편집 중에 녹화본 패널을 열어 외부 API 응답을 새 응답 줄로 넣거나 기존 줄의 `result` 로 넣을 수 있다. 녹화본은 읽기만 하고, 저장 전 `assertMockDefinition` 으로 검증한다. 폼에 칸이 없는 키는 보존한다. 녹화 때 가려지지 않는 body 안의 URL 은 개수로 경고한다.
