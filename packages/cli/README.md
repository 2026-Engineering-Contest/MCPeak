# OhMyMCP (cli)

`npx ohmymcp` 실행 진입점. **얇게 유지한다** — 각 오너가 자기 서브커맨드만 수정한다.

- **오너:** 공동 (CONTRIBUTING §2.1)
- **의존:** `@ohmymcp/runner` · `@ohmymcp/generate` · `@ohmymcp/record` · `@ohmymcp/mock`

## 상태

`run()` 디스패처 스텁만 존재한다. 실제 커맨드 로직은 각 패키지 오너가 채운다.
이 패키지의 npm 이름이 곧 실행 파일명(`ohmymcp`)이 된다.
