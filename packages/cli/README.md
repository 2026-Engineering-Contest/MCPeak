# OhMyMCP CLI

`ohmymcp test`는 JSON 테스트 명세로 로컬 stdio MCP 서버를 직접 시작하고 종료합니다.

```bash
ohmymcp test packages/cli/tests/fixtures/weather-suite.json \
  --command node \
  --arg examples/weather-server/server.mjs
```

문법은 `ohmymcp test <suite.json> --command <executable> [--arg <value> ...]`입니다. 위 예시의 command와 arg는 `node examples/weather-server/server.mjs`로 실행됩니다. `--arg`는 반복할 수 있고, 하이픈으로 시작하는 값은 `--arg=-m`, 빈 값은 `--arg=`로 전달합니다.

stdout에는 최종 RunnerReport JSON만 출력하며, CLI 오류는 stderr에만 출력합니다. 모든 테스트가 통과하면 종료 코드 0을, failed 또는 aborted report와 입력, 연결, 종료 오류에는 1을 반환합니다.

현재는 UTF-8 JSON 단일 명세와 stdio 서버만 지원합니다. shell 문법, 여러 명세, TypeScript 모듈 명세는 지원하지 않습니다. `record`, `replay`, `mock` 명령은 아직 구현되지 않았습니다.

## generate

`ohmymcp generate`는 서버의 `tools/list` 결과에서 결정론적 baseline suite를 만듭니다.

```bash
ohmymcp generate \
  --suite-id weather \
  --name "Weather server" \
  --out weather.json \
  --command node \
  --arg examples/weather-server/server.mjs \
  --baseline-only
```

문법은 다음과 같습니다.

```text
ohmymcp generate --suite-id <id> --name <name> --out <suite.json> --command <executable> [--arg <value> ...] [--baseline-only] [--provider <codex|claude>] [--model <model>]
```

`--baseline-only`는 AI를 호출하지 않는 명시적 비대화형 승인입니다. 생성기는 기존 출력 파일을 덮어쓰지 않으며, 같은 디렉터리의 임시 파일을 다시 읽어 suite와 fingerprint를 검증한 뒤 원자적으로 저장합니다. weather-server의 baseline은 `get_weather`에 `{ "city": "example" }`를 사용하므로, 이어서 `ohmymcp test`를 실행하면 get_weather가 실패하고 add는 통과합니다. 이는 baseline이 스키마에서 얻은 출발점일 뿐 실행 성공을 보장하지 않는다는 신호입니다.

TTY에서 `--baseline-only`를 빼면 대화형 검토가 시작됩니다. Codex 또는 Claude provider와 model을 선택할 수 있습니다. 기본 model은 Codex `gpt-5.6-luna`, Claude `haiku`입니다. `--provider`와 `--model`을 함께 지정하면 그 정확한 선택을 사용합니다.

각 AI 요청 전에 provider, model, 정제된 요청의 크기, 결과 제한, timeout, fingerprint를 표시하고 전송 승인을 받습니다. 승인하지 않으면 provider를 호출하지 않습니다. 후보 결과는 전체 적용 또는 change ID 선택 적용으로 검토하며, 피드백을 입력해 새 요청을 보낼 수 있습니다. 질문 결과도 표시한 뒤 답변을 새 요청으로 보낼 수 있습니다. 직접 편집은 별도 JSON 파일 경로를 입력해 불러오며, 같은 diff와 승인 경계를 거칩니다.

마지막으로 승인된 draft의 fingerprint를 확인하고 저장을 다시 승인해야 JSON을 씁니다. 저장한 파일은 기존 `ohmymcp test <suite.json> --command ...` 명령에 그대로 전달할 수 있습니다. 실제 Codex 또는 Claude 호출은 계정과 비용을 사용하는 작업이므로, 자동 테스트나 기본 검증에서는 실행하지 않습니다.
