---
"@ohmymcp-hsu/generate": minor
"ohmymcp": minor
---

도그푸딩(공개 MCP 서버 8개)에서 잡힌 결함 셋을 고칩니다.

- `generate` 가 지원하지 않는 JSON Schema 키워드를 만나면 서버 전체를 거절하던 것을, 해당 툴만 건너뛰고 나머지를 생성하도록 바꿉니다(ADR-0036). 건너뛴 툴은 `skippedTools` 로 결과에 실리고 화면에 `건너뜀 N tools` 블록으로 고지되며, 커버리지 분모에서 빠집니다. 실측에서 공개 서버 8개 중 5개가 툴 하나 때문에 전체 거절됐습니다. 전 툴 지원 서버의 출력과 지문은 바뀌지 않습니다.
- `test` 가 `--arg` 값의 하이픈 접두를 거절해 `--arg -y` 를 못 받던 것을 고칩니다. `generate` 는 이미 받고 있었고, npx·uvx 로 띄우는 서버는 전부 여기 걸립니다.
- `generate` 의 연결 단계 실패(서버가 spawn 직후 종료 등)가 원인 없는 `GENERATE_FAILED` 로 뭉개지던 것을, core 오류의 code·message·hint 를 그대로 보여주는 `GENERATE_CONNECT_FAILED/<code>` 로 바꿉니다.
