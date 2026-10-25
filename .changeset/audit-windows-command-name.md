---
"@mcpeak/audit": patch
---

윈도우에서 `--sandbox` 가 docker 를 찾기도 전에 멈추던 문제를 고칩니다. 서버 명령의 이름을 허용 목록과 견줄 때 윈도우 실행 파일 확장자를 떼지 않아, `C:\Program Files\nodejs\node.exe` 가 `node.exe` 로 남아 `node`·`npx`·`npm` 목록을 통과하지 못했습니다. 그래서 docker 가 설치돼 있어도 `unsupported-command` 로 끝나면서 "격리 이미지가 node, npx, npm 만 실행합니다" 라고 안내했습니다 — 사용자가 준 명령이 바로 node 인데도요.

`node.exe`·`npx.cmd`·`npm.cmd` 를 각각 `node`·`npx`·`npm` 으로 봅니다. 같은 규칙을 격리의 네 판정이 함께 씁니다 — 허용 목록, 컨테이너에 넘길 명령, npm 캐시 tmpfs 를 열지 여부, 잡음 표의 실행기 판정. 셋째·넷째도 확장자를 떼지 않아, 윈도우에서 `npx.cmd` 로 서버를 띄우면 캐시 tmpfs 가 열리지 않고 런타임 잡음이 서버 행위로 보고될 수 있었습니다.
