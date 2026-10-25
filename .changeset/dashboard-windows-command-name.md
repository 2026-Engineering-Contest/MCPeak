---
"@mcpeak/dashboard": patch
---

윈도우에서 분석하기가 격리를 시도조차 하지 않던 문제를 고칩니다. 격리 가능 판정이 서버 명령의 윈도우 실행 파일 확장자를 떼지 않아, `.mcp.json` 에 `npx.cmd` 나 `node.exe` 로 적힌 서버를 고르면 `node`·`npx`·`npm` 목록을 통과하지 못했습니다. 보안 요청에 `sandbox` 키가 실리지 않으므로 사용자는 격리 없는 리포트를 받으면서 그 이유를 안내받지 못했습니다 — `@mcpeak/audit` 쪽은 적어도 `unsupported-command` 사유를 리포트에 남깁니다.

`node.exe`·`npx.cmd`·`npm.cmd` 를 각각 `node`·`npx`·`npm` 으로 봅니다. 규칙은 `@mcpeak/audit` 의 `sandbox/command-name.ts` 와 같습니다. 이름 자체의 대소문자는 양쪽 모두 가리므로(`NODE.EXE` 는 격리 가능이 아니다) 두 판정이 같은 값을 냅니다.
