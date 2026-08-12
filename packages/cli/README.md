# OhMyMCP CLI

`ohmymcp test`는 JSON 테스트 명세로 로컬 stdio MCP 서버를 직접 시작하고 종료합니다.

```bash
ohmymcp test packages/cli/tests/fixtures/weather-suite.json \
  --command node \
  --arg examples/weather-server/server.mjs
```

문법은 `ohmymcp test <suite.json> --command <executable> [--arg <value> ...]`입니다. 위 예시의 command와 arg는 `node examples/weather-server/server.mjs`로 실행됩니다. `--arg`는 반복할 수 있고, 하이픈으로 시작하는 값은 `--arg=-m`, 빈 값은 `--arg=`로 전달합니다.

stdout에는 최종 RunnerReport JSON만 출력하며, CLI 오류는 stderr에만 출력합니다. 모든 테스트가 통과하면 종료 코드 0을, failed 또는 aborted report와 입력, 연결, 종료 오류에는 1을 반환합니다.

현재는 UTF-8 JSON 단일 명세와 stdio 서버만 지원합니다. shell 문법, 여러 명세, TypeScript 모듈 명세는 지원하지 않습니다. `generate`, `record`, `replay`, `mock` 명령은 아직 구현되지 않았습니다.
