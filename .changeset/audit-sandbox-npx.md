---
"@mcpeak/audit": patch
---

`mcpeak audit --sandbox -- npx -y <패키지>` 가 격리 안에서 `ENOENT: mkdir '/home/node/.npm'` 으로 죽던 것을 고친다. 명령이 `npx`·`npm` 일 때만 target 컨테이너의 `~/.npm` 에 실행 가능한 tmpfs(512MB)를 얹는다. `node` 로 띄우는 서버의 격리 옵션은 그대로이고 `/tmp` 는 언제나 noexec 다(ADR-0109). 잡음 표에 `npm-cache` 행을 더해, 실행기가 시작 단계에 그 자리를 채우는 쓰기·옮기기·지우기를 `behavior/write-outside` 로 내지 않는다. 호출 단계의 같은 경로는 그대로 발견이다.
