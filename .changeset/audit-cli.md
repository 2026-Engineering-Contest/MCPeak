---
"@mcpeak/cli": minor
---

`mcpeak audit` 서브커맨드를 더한다. MCP 서버를 쓰기 전에 도구 정의·실행 명령·프로토콜 응답을 로컬 규칙으로 점검하고 사람용 리포트나 `--json` 결과를 낸다. 대상 옵션은 `test`·`optimize` 와 같고, `--probe readonly|none|all`(기본 readonly), `--baseline <path>`, `--update-baseline`, `--json` 을 받는다. 종료 코드는 심각·주의 발견이 있으면 2, 없으면 0, 연결·입력 실패는 1 이다. stdio 서버에는 흔한 비밀 이름마다 카나리 값을 넣고, sampling·elicitation·roots 능력을 광고해 서버 발신 요청을 관측한다.
