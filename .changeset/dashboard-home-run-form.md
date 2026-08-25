---
"@mcpeak/dashboard": minor
---

홈의 실행 폼에서 **서버를 고르기만 하면 됩니다**. 프로젝트 루트 아래 `.mcp.json` 의
`mcpServers` 와 `package.json` 의 `bin` 을 읽어 후보를 보여주고(`GET /api/servers`), 이
브라우저의 지난 실행값이 있으면 그것도 후보로 올립니다. 직접 입력은 마지막 갈래로 남습니다.
후보를 만들려고 서버를 실행하지는 않습니다. `bin` 은 `@modelcontextprotocol/sdk` 를 직접
의존하는 패키지의 것만 서버로 봅니다.

`mcpeak test` 의 옵션(`--json` 제외)을 「테스트 옵션」 접이식 섹션에서 켤 수 있습니다. 접속
(stdio / HTTP URL 과 헤더 환경변수), 검사(결정론 검사·초기화 명령·서버 stderr 줄 수), 결과 파일
(JUnit 리포트·Repair 번들). CLI 가 거절하는 조합은 폼에서 만들 수 없고, 왜 못 만드는지가 컨트롤
옆에 적힙니다. `--url` 대상이 대시보드에서도 실제로 연결됩니다.

**repair 번들 경로를 더 묻지 않습니다.** 홈에서 시작한 test 실행은 항상
`.mcpeak/repair/<스위트>.repair-bundle.json` 에 번들을 남기고, 실패한 실행의 `repair 시작` 폼에는
그 경로가 채워져 있습니다. `.mcpeak/` 디렉터리와 그 안의 `.gitignore` 는 대시보드가 만듭니다.
「Repair 번들」 칸에 직접 적으면 그 경로를 씁니다. 그래서 기본값으로 시작한 실행의 명령 끝에
`--repair-bundle` 이 붙으며, 「실행될 명령」 미리보기에 그대로 보입니다.

`RunSummary` 에 `argv` 필드가 생겼습니다(`GET /api/runs`, `GET /api/runs/:id`).
