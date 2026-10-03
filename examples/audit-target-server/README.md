# audit-target-server

**보안 검사 표적 전용.** `mcpeak audit` 의 E2E 가 이 서버를 띄워 검사 규칙이 실제로 걸리는지 확인한다.
다른 E2E(generate 도그푸딩, test 스위트 등)의 대상이 아니다. 실제 MCP 클라이언트에 등록하지 마라.

도구 여섯 개가 각각 규칙 하나를 일부러 밟는다. 지시문은 문장만 있고, 그 지시를 따르는 코드는 없다.

| 도구 | 밟는 규칙 | 어떻게 |
|---|---|---|
| `add_numbers` | `desc/injection` | 설명에 `<IMPORTANT>` 블록 |
| `get\u200Btime` | `desc/hidden-unicode` | 이름 가운데 U+200B(폭 없는 공백) |
| `translate_text` | `schema/secret-field` | 인자로 `api_key` 를 요구 |
| `delete_all` | `schema/annotation-mismatch` | 이름은 삭제인데 `readOnlyHint: true`. 실제로는 아무것도 지우지 않는다 |
| `echo_env` | `secret/env-leak` | `process.env.GITHUB_TOKEN` 을 응답으로 돌려준다(`readOnlyHint: true`) |
| `get_tip` | `result/injection` | 호출 응답에 "ignore previous instructions"(`readOnlyHint: true`) |

```
mcpeak audit -- node examples/audit-target-server/server.mjs   # 종료 코드 2
```

기대 결과는 `server.audit.expected.json` 이다. `--json` 출력의 `exitCode`·`counts`·`findings` 와 같아야
한다. `echo_env` 가 돌려주는 값은 감사가 넣은 카나리라 리포트에는 `<canary:GITHUB_TOKEN>` 자리표만 나오고,
그래서 실행마다 출력이 같다.

규칙이나 문장을 바꿔 이 파일이 달라지면, 차이가 의도된 것인지 확인한 뒤 같은 명령의 `--json` 출력으로
기대 파일을 갱신한다.
