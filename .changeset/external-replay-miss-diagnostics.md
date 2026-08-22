---
"@mcpeak/record": minor
"@mcpeak/cli": patch
---

record: 재생 원본에서 찾지 못한 외부 호출을 `finish()` 요약의 `misses` 목록에 구조화해 담습니다.
새 타입 `ReplayMissDetail`(`method`·`url`·`occurrence`·`matchKeyPrefix`)이 공개됩니다.

**Breaking**: `ReplaySessionSummary` 에 필수 필드 `misses` 가 추가됩니다. `SessionSummary` 를
직접 구성하던 TypeScript 소비자(테스트 목·모킹 등)는 그 필드를 채워야 컴파일됩니다. `0.x` 이므로
minor 로 릴리스합니다(CONTRIBUTING §7 버전 — 마감 전까지 breaking change 허용, CHANGELOG 필수).

cli: `test --session` 이 녹화에 없는 호출을 만나면, 그 진단을 `record` 의 `misses` 로부터
읽어 stderr 에 별도 블록으로 그대로 보여줍니다. 이전에는 이 진단이 MCP 오류 채널을 타고
나가 `runner` 가 서버 텍스트로 취급해 개행을 이스케이프 시퀀스로 바꾸고 200자에서 잘라
해결 안내가 사라졌습니다(#259). 케이스별 실패 줄은 그대로 남고, 실행이 끝나면 잘리지 않은
전체 진단이 한 번 더 나옵니다.
