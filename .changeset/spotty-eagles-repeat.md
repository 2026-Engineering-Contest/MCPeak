---
"@ohmymcp/runner": minor
"ohmymcp": minor
---

`ohmymcp test` 의 기본 출력을 사람이 읽는 보고서로 바꿉니다. 실패한 케이스의 진단 문장과
해결 힌트를 터미널에 직접 표시합니다.

**파괴적 변경**: 기존의 JSON 출력은 `--json` 플래그로 옮겼습니다. stdout을 기계로 파싱하던
스크립트는 `ohmymcp test ... --json` 으로 바꿔야 합니다. `--json` 출력의 바이트는 이전과
동일합니다. 종료 코드는 바뀌지 않았습니다.
