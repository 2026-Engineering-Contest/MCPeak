---
"@mcpeak/mock": patch
---

**중복 주입을 거절한다.** 같은 툴·같은 인자(또는 같은 툴의 `ANY`)에 응답을 두 번 넣으면 전에는 앞의 것이 **아무 신호 없이** 사라졌다. 계약서 한 줄이 조용히 없어지는데 사용자는 끝까지 초록불만 봤다.

```
→ 도달할 수 없는 주입입니다: mock.on('add', ...)
→ 앞선 선언: 정의 파일 weather.mock.json 의 responses[0] — 툴 'add' 의 인자 {"a":1}
→ 같은 자리에 응답이 둘이면 뒤엣것이 앞엣것을 가려 하나는 영원히 안 쓰입니다. 하나만 남기세요.
```

**미스 진단문이 진입점에 맞는 안내를 준다.** 정의 파일로 띄운 사람 화면에는 `mock.on` 이라는 코드가 없다 — README 에도 안 나오는 API 다. 시키는 대로 할 수 없는 안내였다.

```
전  → mock.on(툴이름, 인자, 응답) 을 호출했는지 확인하세요.
    → 인자를 가리지 않으려면 mock.on(툴이름, ANY, 응답) — 정의 파일에서는 args 생략.

후 (stdio)  → 정의 파일 weather.mock.json 의 responses 에 { "tool": "add", "args": …, "result": … } 를 추가하세요.
후 (HTTP)   → mock.on(툴이름, 인자, 응답) 을 호출했는지 확인하세요.
```

`serveStdio(definition, definitionPath?)` 로 선택 인자가 하나 늘었다. **기존 호출은 그대로 돈다** — 경로를 안 주면 지금과 같은 문장이 나온다.

곁들여, `createMockServer` 옵션에서 난 주입 오류가 자기를 "정의 파일" 이라고 부르던 것을 `createMockServer 옵션` 으로 고쳤다. 같은 함수의 `assertMockDefinition` 이 이미 쓰던 이름이다.
