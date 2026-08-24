---
"@mcpeak/cli": minor
---

대상 서버를 `--` 뒤에 그대로 적을 수 있고, 스위트 id·이름을 `--out` 에서 뽑습니다.

```bash
전  mcpeak generate --suite-id weather --name "날씨 서버 계약" \
      --out contract.suite.json \
      --command mcpeak-mock --arg weather.mock.json --baseline-only

후  mcpeak generate --out contract.suite.json --baseline-only -- mcpeak-mock weather.mock.json
```

`test` 도 같습니다.

```bash
mcpeak test weather.suite.json -- node ./server.js
```

`--` 뒤 첫 토큰이 실행 파일, 나머지가 그 인자입니다. npm · cargo · docker 가 쓰는 관례라
설명이 필요 없고, **뒤에 오는 것을 해석하지 않으므로** `--port 0` 같은 값을 그대로 넘길 수
있습니다.

## 파괴적 변경이 아닙니다

`--command` · `--arg` 는 그대로 됩니다. 두 서브커맨드 모두 지금까지 `--` 를 `지원하지 않는
옵션` 으로 거절했으므로 그 자리를 쓰던 사용법이 없습니다. **둘을 함께 쓰면 사용 오류입니다** —
대상이 둘이 되면 어느 쪽을 띄울지 화면이 말할 수 없습니다.

## `--suite-id` · `--name` 이 선택이 됐습니다

`--out contract.suite.json` → id·name 모두 `contract`. `.json` 을 떼고 `.suite` 가 남으면
그것도 뗍니다. 명시하면 그쪽이 이깁니다.

⚠️ **출력 파일명이 승인 지문에 들어갑니다.** 지문은 `approval` 만 빼고 전부 해시하므로
(ADR-0017), id·name 을 파일명에서 뽑았다면 **파일명을 바꿔 다시 생성할 때 지문이 달라져
재승인이 뜹니다.** 고정하려면 `--suite-id` 와 `--name` 을 직접 지정하세요. 이 결합은
명시값이 없을 때만 생깁니다.

판단 근거는 [ADR-0076](../docs/adr/0076-대상-명령은-통과-인자로-받고-스위트-이름은-출력-파일명에서-뽑는다.md) 에 있습니다.
