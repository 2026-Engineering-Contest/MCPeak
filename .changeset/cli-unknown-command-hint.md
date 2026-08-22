---
"@mcpeak/cli": patch
---

명령 이름을 틀렸을 때 `test` 의 플래그 목록 대신 **명령 목록**을 준다.

`mcpeak tset` 처럼 오타를 내면 묻지도 않은 `test` 명령의 사용법 200 자를 먼저 읽어야 정작 필요한 명령 목록에 닿았다. 오타는 "어느 옵션을 쓰나" 가 아니라 "어떤 명령이 있나" 를 모르는 상태다.

```
전  해결: 사용법: mcpeak test <suite.json> --command <executable> [--arg <value> ...]
        [--determinism] … [--session <path> | --record-session <path>] 사용 가능한 명령:
        test, generate, repair, replay, verify. 전체 도움말: mcpeak --help

후  해결: 사용 가능한 명령: test, generate, repair, replay, verify. 전체 도움말: mcpeak --help
```

명령을 아예 주지 않은 경우도 같다.

`mcpeak help <없는명령>` 도 고친다. 전에는 사용자가 정확히 친 `help` 를 두고 "알 수 없는 CLI 명령 'help'입니다" 라고 해서, 무엇을 고쳐야 하는지가 화면에서 사라졌다.

```
전  오류 [CLI_USAGE]: 알 수 없는 CLI 명령 'help'입니다.
후  오류 [CLI_USAGE]: 도움말이 없는 명령 '없는명령'입니다.
```
