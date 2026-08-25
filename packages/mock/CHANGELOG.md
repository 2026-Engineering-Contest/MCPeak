# @ohmymcp-hsu/mock

## 0.4.1

### Patch Changes

- 7c1a5b0: **중복 주입을 거절한다.** 같은 툴·같은 인자(또는 같은 툴의 `ANY`)에 응답을 두 번 넣으면 전에는 앞의 것이 **아무 신호 없이** 사라졌다. 계약서 한 줄이 조용히 없어지는데 사용자는 끝까지 초록불만 봤다.

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

- 48adbc8: 선언조차 없는 툴을 부르면 **"주입 안 됨" 이 아니라 "선언 안 됨"** 으로 답한다.

  두 상황은 고칠 자리가 다르다 — 하나는 `responses`, 다른 하나는 `tools` 다. 이걸 한 문장으로 뭉개면 진단문이 시키는 `mock.on('<없는툴>', ...)` 이 곧바로 거절당해(#239 가 넣은 검사) 사용자가 막다른 길에 선다.

  ```
  전  → 툴 'subtract' 을(를) 인자 {"a":1} 로 호출했지만 주입된 응답이 없습니다.
      → 주입된 툴: 'add'
      → mock.on(툴이름, 인자, 응답) 을 호출했는지 확인하세요.        ← 하면 거절당한다

  후  → 툴 'subtract' 은(는) 이 목 서버가 선언한 툴이 아닙니다.
      → 선언된 툴: 'get_weather', 'add'
      → tools/list 로 광고하지 않은 이름이라 어떤 응답도 주입할 수 없습니다.
      → 이 툴이 필요하면 정의의 tools 에 { "name": "subtract", "inputSchema": … } 를 먼저 추가하세요.
  ```

  주입 경로(`mock.on` · 정의 파일)는 이미 미지의 툴 이름을 막고 있었다(#239). 호출 경로만 그 지식을 안 썼다 — 두 진입점이 같은 규칙을 쓴다는 것이 이 패키지의 계약이다.

  선언은 됐는데 주입만 안 된 툴의 문장은 그대로다. 두 갈래가 섞이지 않는 것을 HTTP·stdio 양쪽에서 테스트로 고정했다.

- 5904700: `packages/mock` README 의 **HTTP 절에 설치 안내를 넣는다.** 라이브러리로 부르는 경로인데 설치 없이 `import` 로 시작해서, 전역 설치(`npm i -g`)만 한 사람은 `ERR_MODULE_NOT_FOUND` 를 봤다. 전역 설치는 실행 파일만 놓는다.

  루트 `README.md` 도 함께 고친다(발행 대상 아님).

  - **§30초 예제가 없는 `./server.js` 를 참조**했다. 글자 그대로 따라가면 30초 안에 초록불이 아니라 `MODULE_NOT_FOUND` 다. 저장소의 `examples/weather-server/server.mjs` 를 가리키고, npm 으로만 설치한 사람은 목으로 시작하도록 안내한다
  - 통과 출력 샘플의 **컬럼 패딩이 실제와 한 칸 달랐다**
  - 실패 샘플의 `toolExists` 문장이 낡았다. 발견된 툴을 싣게 된 변경(#277)이 반영되지 않았고, 실제로 함께 나오는 `명세: 승인 지문이 없습니다` 블록도 빠져 있었다
  - **§CLI 사용법이 실제보다 좁았다.** `--determinism`·`--reset-cmd`·`--repair-bundle` 이 없고 `repair` 명령 자체가 없었다. `packages/cli/src/help.ts` 의 정본과 플래그 22개가 일치하도록 맞췄다

  두 샘플은 빌드한 CLI 로 실제 실행해 **바이트 단위로 대조**했다.

## 0.4.0

### Minor Changes

- e99192a: Node.js 최소 지원 버전을 22.18.0으로 올리고, 배포 패키지의 `engines.node`에 같은 요구사항을 명시합니다.

### Patch Changes

- a019771: `mock.on()` 이 `tools` 에 없는 툴 이름을 주입 시점에 거절합니다. 정의 파일 경로는 이미
  `assertMockDefinition` 이 잡고 있었지만 `on()` 은 통과시켜, 오타가 주입에 성공한 것처럼 보이고
  실제 호출이 미스로 떨어질 때까지 아무 신호도 받지 못했습니다.
- Updated dependencies [e99192a]
- Updated dependencies [2e62615]
- Updated dependencies [93816a8]
  - @mcpeak/core@0.4.0

## 0.3.0

### Minor Changes

- c923b48: 목이 `inputSchema` 로 호출 인자를 검사해 위반 인자를 거절한다 (#181, ADR-0048).

  `required` · `type` · `enum` · `range` 네 축을 최상위 필드에서만 본다. 주입된 응답이 검사보다
  우선하므로, 위반 인자에 응답을 지정해 두었다면 종전대로 그 응답이 나간다. 해석할 수 없는
  스키마는 건너뛴다 — 루트에 `anyOf` · `$ref` 등이 있으면 그 툴 전체를, 필드에 있으면 그 필드만
  건너뛰고 `required` 검사와 나머지 필드 검사는 계속한다. 툴 전체를 건너뛴 경우는 서버를 띄울 때
  stderr 로 한 번 고지한다.

  **동작 변경:** `ANY` 폴백에 기대어 위반 인자를 성공시키던 정의는 이제 거절을 받는다. 종전
  동작이 필요하면 그 인자를 `responses` 에 명시한다.

- 10ae345: mock: 정의에 `isError` 를 허용해 거절 응답을 주입할 수 있게 한다. 지금까지 목은 성공 응답만 표현할 수 있어서, "이 인자면 서버가 이렇게 거절한다" 를 사용자가 선언할 방법이 없었다. `isError: true` 를 붙이면 내가 정한 문장으로 거절할 수 있다 — 실패 UX 도 계약의 절반이고, 설계 단계에서 클라이언트에 보여줘야 하는 것이다. 선택 필드라 기존 정의 파일과 `mock.on()` 3인자 호출은 그대로 동작한다. 매칭 미스가 만드는 `isError`(표에 없다는 목의 안내)와 주입한 거절(서버가 이렇게 거절한다는 설계)은 본문으로 구분된다.

## 0.2.0

### Minor Changes

- 464d065: mock: 매칭 키로 만들 수 없는 인자를 주입 시점에 거부한다. 순환 참조 · 희소 배열 · `NaN` · `Infinity` · `Date` · 함수처럼 JSON 으로 표현할 수 없는 값은 어떤 호출로도 도달할 수 없어, 그대로 두면 주입이 영영 안 맞거나(희소 배열) 서로 다른 주입이 같은 키가 되어 엉뚱한 응답이 나갔다(`NaN` 과 `Infinity` 가 둘 다 `null`). 거부 집합은 `record` 의 카세트 매칭 키(ADR-0003)와 같게 맞췄다. 또한 깊게 중첩된 호출 인자가 스택을 터뜨려 목 서버 프로세스를 죽이던 문제를 고친다 — 깊이 512 를 넘으면 `isError: true` 응답으로 알린다.

### Patch Changes

- Updated dependencies [cd25fb4]
- Updated dependencies [bf16fb5]
  - @ohmymcp-hsu/core@0.3.0

## 0.1.2

### Patch Changes

- Updated dependencies [0d92470]
  - @ohmymcp-hsu/core@0.2.0

## 0.1.1

### Patch Changes

- c0d17d6: mock: 인자 매칭 키에서 값이 `undefined` 인 키를 제외한다. `on(tool, { a: 1, b: undefined }, ...)` 로 주입한 응답이 실제 호출 `{ a: 1 }` 과 다른 키가 되어 영영 잡히지 않던 문제를 고친다 — JSON-RPC 를 건너온 인자에는 `undefined` 가 있을 수 없으므로 주입 쪽도 같게 본다. `record` 의 카세트 매칭 키(ADR-0003)와 규칙을 맞춘 것이기도 하다.

## 0.1.0

### Minor Changes

- 623eea0: mock: stdio 진입점(`ohmymcp-mock`)과 인자 무관 매칭(`ANY`)을 추가한다. `core.connect()` 가 아직 stdio 만 알아 우리 도구가 목 서버에 붙지 못하던 것을 푼다 (ADR-0007). HTTP 진입점과 매칭 규칙을 공유한다 — 인자를 지정한 응답이 우선하고 `ANY`(정의 파일에서는 `args` 생략)가 나머지를 받는다.

## 0.0.1

### Patch Changes

- Updated dependencies [606600f]
  - @ohmymcp-hsu/core@0.1.0
