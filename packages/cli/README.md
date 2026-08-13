# OhMyMCP CLI

`ohmymcp test`는 JSON 테스트 명세로 로컬 stdio MCP 서버를 직접 시작하고 종료합니다.

```bash
ohmymcp test packages/cli/tests/fixtures/weather-suite.json \
  --command node \
  --arg examples/weather-server/server.mjs
```

문법은 `ohmymcp test <suite.json> --command <executable> [--arg <value> ...] [--json] [--stderr-lines <N>]`입니다. 위 예시의 command와 arg는 `node examples/weather-server/server.mjs`로 실행됩니다. `--arg`는 반복할 수 있고, 하이픈으로 시작하는 값은 `--arg=-m`, 빈 값은 `--arg=`로 전달합니다.

stdout에는 보고서만 나갑니다. 기본은 사람이 읽는 보고서이고, `--json`을 주면 `RunnerReport` JSON이 나갑니다. CLI 오류와 서버 프로세스 진단은 stderr로만 나가므로 `--json > report.json`이 깨지지 않습니다. 모든 테스트가 통과하면 종료 코드 0을, failed 또는 aborted report와 입력, 연결, 종료 오류에는 1을 반환합니다.

`--stderr-lines <N>`은 실패했거나 서버가 비정상 종료·중단했을 때, 진단 내용이 있으면 stderr에 붙는 서버 프로세스 진단 블록의 stderr 표시 줄 수입니다. 기본값은 20이고, `0`을 주면 블록을 완전히 끕니다(그때 출력 바이트는 이 기능이 없던 때와 같습니다). 블록에는 종료 코드와 시그널, 서버가 남긴 stderr의 마지막 N줄이 담기며 잘린 사실은 헤더에 적힙니다. 서버가 정상 종료했고 stderr도 비어 있으면 보여줄 근거가 없으므로 블록을 쓰지 않습니다.

### 승인 지문 대조

`test`는 실행할 명세의 승인 지문을 계산해 파일에 적힌 `approval.fingerprint`와 대조하고, 그 결과를 보고서에 적습니다. **판정은 바꾸지 않습니다.** 종료 코드는 케이스 결과로만 정해지므로 지문이 달라도 전부 통과하면 0입니다. 명세를 고치는 것은 정상 작업이고, 그때마다 테스트가 막히면 사용자는 확인 절차를 우회하는 방법부터 찾게 됩니다.

표시 여부는 다음과 같습니다. 매 실행 한 줄을 무조건 찍으면 손으로 명세를 쓰는 사용자에게는 영구적인 소음이고, 그러면 정작 필요할 때 그 줄을 읽지 않습니다.

| 지문 상태 | 전부 통과 | 실패·타임아웃 등이 있음 |
|---|---|---|
| 일치 | 침묵 | 표시 |
| 불일치 | **표시** | 표시 |
| 없음(미고정) | 침묵 | 표시 |

전부 통과인데 불일치일 때만 예외를 두는 이유는 승인받지 않은 명세로 초록불이 뜬 상태이기 때문입니다. 그 사실은 실패보다 오히려 조용히 지나가기 쉽습니다.

명세 줄은 보고서 본문 뒤에 빈 줄 하나를 두고 stdout으로 나갑니다. `--json`에는 위 억제 규칙을 적용하지 않고 `spec` 키를 항상 넣습니다(`approval`은 `matched` · `mismatched` · `absent` 중 하나, `fingerprint`는 실행 시점 계산값, `approvedFingerprint`는 파일에 적힌 값이며 `absent`면 키가 없습니다). 기계가 읽는 출력에서 키가 조건부로 사라지면 소비자가 분기를 하나 더 써야 합니다. 기존 보고서 키는 그대로이므로 기존 소비자는 깨지지 않습니다.

지문이 없는 명세도 정상입니다. 손으로 쓴 명세와 이 기능 이전에 만든 명세가 여기에 해당하며 실패로 취급하지 않습니다.

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

저장한 명세에는 `approval` 블록이 함께 들어갑니다.

```json
{
  "schemaVersion": 1,
  "id": "weather",
  "name": "Weather server",
  "approval": {
    "fingerprint": "9f2c1a3b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8"
  },
  "defaultTimeoutMs": 5000,
  "cases": []
}
```

`fingerprint`는 승인한 시점의 명세를 요약한 소문자 hex 64자입니다. 계산 대상은 파일 바이트가 아니라 파싱된 명세 객체이므로 들여쓰기, 줄 끝 문자, 키 순서를 바꿔도 값이 그대로입니다. 답해야 하는 질문이 "바이트가 바뀌었나"가 아니라 "테스트의 의미가 바뀌었나"이기 때문입니다. `approval` 블록 자신은 계산에서 제외됩니다. 자기를 포함한 채로 자기를 요약할 수는 없습니다. 저장 직후에는 파일을 다시 읽어 계산값과 파일에 적힌 값이 모두 승인 시점의 지문과 같은지 확인한 뒤에만 커밋합니다.

마지막으로 승인된 draft의 fingerprint를 확인하고 저장을 다시 승인해야 JSON을 씁니다. 저장한 파일은 기존 `ohmymcp test <suite.json> --command ...` 명령에 그대로 전달할 수 있습니다. 실제 Codex 또는 Claude 호출은 계정과 비용을 사용하는 작업이므로, 자동 테스트나 기본 검증에서는 실행하지 않습니다.
