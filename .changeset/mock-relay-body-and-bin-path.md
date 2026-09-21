---
"@mcpeak/mock": minor
---

중계기가 `--json` 기록 줄에 서버 응답 본문을 싣는다. `body` 는 JSON-RPC `result` 전체라 `content` 와 `structuredContent` 가 같이 들어 있다. AI 를 거치면 `structuredContent` 가 오지 않아 사용자가 자기 서버 답의 반쪽만 보게 되던 것을 없앤다(ADR-0103). 사람이 읽는 줄은 바뀌지 않고, 본문은 자르지 않는다 — 접는 것은 화면이 할 일이다. `protocolError` 에는 `body` 가 없다(서버가 결과를 준 적이 없다).

`relayBinPath()` 를 새로 내보낸다. 중계기 실행 파일의 절대경로를 `package.json` 의 `bin` 에서 읽어 돌려주므로, 부르는 쪽이 경로를 짐작하지 않는다. 소스로 돌 때와 발행본으로 돌 때, esm 과 cjs 에서 모두 같은 파일을 가리킨다.
