# sandbox-target-server

**행위 관측 표적 전용. 격리 없이 띄우지 마세요.** `mcpeak audit --sandbox` 의 E2E 가 이 서버를 격리 컨테이너
안에서 띄워 행위 관측 규칙이 실제로 걸리는지 확인한다. 다른 E2E(generate 도그푸딩, test 스위트, 격리 없는
`audit` 등)의 대상이 아니다. 실제 MCP 클라이언트에 등록하지 마라.

`audit-target-server` 는 설명문만 수상하고 아무 일도 하지 않는다. 이 서버는 다르다. 도구가 **실제로** 파일을
읽고, 프로세스를 띄우고, 밖으로 요청을 보낸다. 격리 컨테이너의 홈은 미끼로 채워져 있어 거기서는 잃을 것이
없지만, 호스트에서 띄우고 도구를 부르면 진짜 홈의 파일을 읽어 밖으로 보내려 한다.

도구는 여섯이고 서버 분기가 하나다. 각 도구는 격리 안의 호출 계획 아래에서 맡은 규칙 하나만 밟는다.

| 도구 | 하는 일 | 밟는 규칙 |
|---|---|---|
| `read_note` | `path` 인자를 검증 없이 홈의 `notes/` 아래 경로로 이어 붙여 읽는다(경로 순회) | `behavior/file-canary-read` |
| `fetch_status` | `url` 인자를 검증 없이 요청한다 | `behavior/internal-address` |
| `disk_usage` | `child_process.execFile("du", …)` 로 자식 프로세스를 띄운다 | `behavior/child-process` |
| `sync_settings` | 홈의 자격 증명 파일 하나(`.cursor/mcp.json`)를 읽어 이 문서에 없는 호스트로 POST 한다 | `network/canary-exfiltration`, `network/undeclared-destination` |
| `ping` | 아무 일도 하지 않고 `"pong"` 을 돌려준다(오탐 기준) | 없음 |
| `list_env_names` | `process.env` 의 **이름만** 정렬해 돌려준다(값은 돌려주지 않는다). 호스트 env 가 컨테이너에 들어오지 않는다는 것을 E2E 가 이 응답으로 확인한다 | 없음 |
| (분기) | `/.dockerenv` 가 있으면 `ping` 의 설명을 다르게 낸다 | `surface/environment-dependent` |

여섯 규칙이 정확히 한 번씩 나온다. 이유는 호출 계획과 판정 규칙으로 정해진다.

- `read_note` 의 인자는 `path` 라 `path:traversal` 과 `path:absolute` 가 간다. 순회만 격리 홈의 자격 증명
  파일에 닿는다. 절대 경로는 `notes/` 아래로 이어 붙어 없는 파일이 된다. 응답에 파일 내용이 나오므로 심각도는
  high 다.
- `fetch_status` 의 인자는 `url` 이고 `format` 은 두지 않는다. `url:metadata` 와 `url:loopback` 이 둘 다 내부
  주소라 한 건으로 접힌다. `url:file-scheme` 은 `fetch` 가 거절한다. 자리값은 주소 꼴이 아니라 요청이 나가지
  않는다.
- `disk_usage` 는 인자가 없다. `du` 는 셸도 다운로드 도구도 아니라서 심각도는 low 다.
- `sync_settings` 는 인자가 없다. 읽은 파일의 카나리가 요청에 실리므로 읽기 발견은 따로 나지 않고, 유출 한
  건과 선언 밖 목적지 한 건이 난다. 목적지에는 상류가 없어 요청은 실패한다.
- 어느 도구에도 `readOnlyHint` 를 두지 않는다. 두면 `behavior/annotation-violation` 이 함께 난다.
- **이 문서에는 어떤 주소도 적지 않는다.** 문서에 적힌 주소는 서버가 선언한 목적지로 읽히므로, 적으면
  `sync_settings` 의 목적지가 선언된 것이 된다.

## 서버가 죽는 실행

`--crash-after-list` 를 주면 `tools/list` 에 답한 직후 종료 코드 1 로 죽는다. 서버가 죽은 실행에서도 그때까지의
관측이 남는지 보는 데 쓴다.

```
node examples/sandbox-target-server/server.mjs --crash-after-list
```

## 실행

```
mcpeak audit --sandbox -- node examples/sandbox-target-server/server.mjs
```

기대 결과는 `server.sandbox.expected.json` 이다. 실제 실행의 `findings`·`counts`·`exitCode` 와 같아야 한다.
규칙이나 문장을 바꿔 그 파일이 달라지면, 차이가 의도된 것인지 위 표와 한 줄씩 대조한 뒤 갱신한다.
