# fixtures

패키지 간 병렬 개발을 위한 공용 테스트 픽스처 (실제 MCP 서버 응답 샘플).

- 인터페이스 동결 전까지 `core` 외 패키지는 여기 있는 JSON으로 개발한다 (CONTRIBUTING §3).
- 실제 서버를 기다리지 않는다.
- 여기의 `*.sample.json` 은 형태를 보여주기 위한 **더미**다. 실제 공개 서버에서 받은
  응답으로 교체하는 것은 후속 작업(`fixtures` 담당)이다.

| 파일 | 설명 |
|---|---|
| `tools-list.sample.json` | `tools/list` 응답 형태의 더미 샘플 |
| `tools-call.sample.json` | 정상·오류·비결정 필드를 포함한 `tools/call` 응답 형태의 더미 샘플 |
