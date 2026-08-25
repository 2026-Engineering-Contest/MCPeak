# @ohmymcp-hsu/dashboard

## 0.3.0

### Minor Changes

- 498d2c9: 홈의 실행 폼에서 **External 세션 녹화·재생을 켤 수 있습니다**.

  지금까지 대시보드에서 녹화를 걸려면 `POST /api/runs` 를 직접 불러야 했습니다. 서버는 `flow:"test"`
  의 argv 를 그대로 CLI 에 넘기고 있었으므로 기능은 이미 돌고 있었고, 화면에 그 칸이 없었을 뿐입니다.

  「External 세션」 세 갈래(사용 안 함 · 외부 호출 녹화 · 녹화본 재생) 중 하나를 고르고 세션 파일
  경로를 적으면 됩니다. **세 갈래 중 하나만 고를 수 있는 모양입니다** — CLI 가 `--session` 과
  `--record-session` 의 동시 사용을 거절하므로, 만들 수 있는 조합을 만들게 해 두고 서버가 거절하는
  왕복을 없앴습니다. 경로가 비면 실행 버튼이 비활성입니다.

  폼 → argv 조립을 `buildTestArgv` 로 분리했습니다. 실행 버튼 비활성 판정과 제출이 같은 함수를 쓰므로
  버튼은 눌리는데 제출은 실패하는 상태가 생기지 않습니다. 세션을 안 쓰는 실행의 argv 는 한 토큰도
  바뀌지 않았습니다.

- 71fb736: Generate 1단계에서 **서버를 고르기만 하면 됩니다**. 홈과 같은 서버 목록(`.mcp.json`·`package.json` bin
  후보)이 맨 위에 오고, 후보를 고르면 2단계의 저장 위치·스위트 ID·이름이 자동으로 찹니다. 사용자가
  고친 값은 서버를 바꿔도 덮어쓰지 않습니다. 직접 입력은 마지막 갈래로 남아 있습니다.

  접속 방식에 **HTTP URL** 이 생겼습니다. `--url` 과 `--header-env` 를 화면에서 쓸 수 있고, 대시보드
  서버의 generate 배선에 `connectHttp`·`readEnv` 가 들어가 원격 서버 대상 생성이 서버에서 멈추지
  않습니다. stdio 갈래의 argv 는 한 토큰도 바뀌지 않았습니다.

  단계를 속성 성격으로 다시 묶었습니다. 3단계는 생성 방식(AI/기본 골격, 도구, 모델)만이고, 시험
  실행·자동 교정 토글은 4단계 「검증과 확인」으로 갔습니다. 초기화 명령이 시험 실행에 종속인데 다른
  단계에 있으면 입력이 왜 잠겼는지 볼 자리가 없었기 때문입니다.

- 390220b: 홈의 실행 폼에서 **서버를 고르기만 하면 됩니다**. 프로젝트 루트 아래 `.mcp.json` 의
  `mcpServers` 와 `package.json` 의 `bin` 을 읽어 후보를 보여주고(`GET /api/servers`), 이
  브라우저의 지난 실행값이 있으면 그것도 후보로 올립니다. 직접 입력은 마지막 갈래로 남습니다.
  후보를 만들려고 서버를 실행하지는 않습니다. `bin` 은 `@modelcontextprotocol/sdk` 를 직접
  의존하는 패키지의 것만 서버로 봅니다.

  `mcpeak test` 의 옵션(`--json` 제외)을 「테스트 옵션」 접이식 섹션에서 켤 수 있습니다. 접속
  (stdio / HTTP URL 과 헤더 환경변수), 검사(결정론 검사·초기화 명령·서버 stderr 줄 수), 결과 파일
  (JUnit 리포트·Repair 번들). CLI 가 거절하는 조합은 폼에서 만들 수 없고, 왜 못 만드는지가 컨트롤
  옆에 적힙니다. `--url` 대상이 대시보드에서도 실제로 연결됩니다.

  **repair 번들 경로를 더 묻지 않습니다.** 홈에서 시작한 test 실행은 항상
  `.mcpeak/repair/<스위트>.repair-bundle.json` 에 번들을 남기고, 실패한 실행의 `repair 시작` 폼에는
  그 경로가 채워져 있습니다. `.mcpeak/` 디렉터리와 그 안의 `.gitignore` 는 대시보드가 만듭니다.
  「Repair 번들」 칸에 직접 적으면 그 경로를 씁니다. 그래서 기본값으로 시작한 실행의 명령 끝에
  `--repair-bundle` 이 붙으며, 「실행될 명령」 미리보기에 그대로 보입니다.

  `RunSummary` 에 `argv` 필드가 생겼습니다(`GET /api/runs`, `GET /api/runs/:id`).

- b1bb135: 홈 스위트 목록의 `실행` 옆에 `명세 확인` 을 더합니다. 누르면 그 파일을 읽어 케이스당 한 줄로
  행 안에 펼칩니다. 다시 누르면 닫힙니다.

  ```
  Weather 예제 (id weather) · 케이스 8건
    1. get-weather-success  callTool get_weather {"city":"서울"}  → isError=false
    2. tools-listed         listTools  → toolExists get_weather, toolExists add
    ...
  ```

  지금까지 홈은 파일 경로만 보여 줘서, 어떤 케이스가 들어 있는지는 에디터로 열어야 알 수 있었습니다.
  모양은 `mcpeak generate` 검토 메뉴의 `show` 와 같습니다. 두 자리가 다르게 보이면 같은 파일을 두 번
  배워야 합니다.

  파일은 버튼을 누를 때 읽습니다(`GET /api/suites/<path>`). 목록을 만들 때 전부 읽어 두면 스위트가
  많은 프로젝트에서 첫 화면이 느려지고, 그 사이 바뀐 파일이 낡은 채로 보입니다. 못 읽거나 스위트
  형식이 아니면 그 이유를 행 안에 적고 화면은 그대로 둡니다. 실행 폼과는 독립이라 둘 다 열려 있을
  수 있습니다.

- 850a53f: 빈 스위트 목록이 **어느 디렉터리를 뒤졌는지**와 **어떻게 고치는지**를 말합니다.

  대시보드는 서버를 띄운 디렉터리 아래에서 스위트를 찾습니다. 다른 곳에서 띄우면 첫 화면이
  통째로 비는데, 지금까지 화면은 "스위트가 없습니다." 한 줄이었습니다. 원인이 거의 언제나
  그 경로인데 화면에 그 경로가 없었습니다.

  ```
  전  스위트가 없습니다.

  후  이 디렉터리 아래에서 스위트를 찾지 못했습니다: <repo-root>/my-project
      → 스위트가 있는 디렉터리에서 mcpeak-dashboard 를 다시 띄우거나, 왼쪽 Generate 로
        새로 만드세요.
      목록에는 스위트 형식을 통과한 .json 만 담습니다. node_modules · .git · dist 아래는
      보지 않습니다.
  ```

  세 줄이 각각 **무엇이(0건) · 어디가 기준인지(경로) · 어떻게 고치는지**를 맡습니다. 셋째 줄은
  cwd 가 아닌 두 번째 원인(형식 불통과·제외 디렉터리)을 덮습니다.

  **새 라우트 `GET /api/meta`** 가 생겼습니다. 응답은 `ServerMeta`(`{ root: string }`) 하나이고,
  `api-types.ts` 에 추가된 새 타입입니다. 기존 타입과 라우트는 한 글자도 바뀌지 않았습니다.

  `/api/health` 를 확장하지 않은 이유는 [ADR-0071](../docs/adr/0071-스캔-루트를-화면에-싣는-방법.md)
  에 적었습니다 — 헬스 프로브에 설정값을 얹으면 이름이 하는 일과 어긋나고, 그 응답을 완전 일치로
  잠가 둔 테스트가 깨집니다.

  절대 경로를 화면에 그대로 띄웁니다. 이 서버는 `127.0.0.1` 에만 바인드하고, 같은 값을 이미
  터미널 기동 줄에 찍고 있습니다. 두 자리의 표기를 일부러 같게 두어 서로를 대조할 수 있게
  했습니다.

- 1d1410f: **Breaking**: 대시보드에서 카세트 화면과 replay 플로우를 제거했습니다. Tool 카세트를 걷어내는
  두 번째 조각입니다([ADR-0059](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0059-tool-카세트를-제거한다.md)).

  사라진 것:

  - `Cassettes` 사이드바 항목과 `#/cassettes` 화면
  - `GET`·`PUT`·`DELETE /api/cassettes/*` 와 `GET /api/cassettes`
  - 실행 플로우 `replay` (`POST /api/runs` 의 `flow: "replay"`)

  외부 API 호출을 막는 것이 목적이었다면 `mcpeak test --record-session <path>` 로 녹화하고
  `--session <path>` 로 재생하세요. 서버는 실제로 뜨고 그 서버가 밖에 부르는 호출만 막힙니다.

  `generate` 마법사의 `--cassette` 옵션은 아직 남아 있습니다 — 그 부분은 `generate` 오너가
  별도로 걷습니다.

- 2065c2f: **Breaking**: 대시보드 Generate 마법사에서 Tool 카세트 경로와 재녹화 입력을 제거했습니다.
  Generate 요청은 더 이상 `--cassette`와 `--record` 옵션을 만들지 않습니다
  ([ADR-0059](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0059-tool-카세트를-제거한다.md)).

  서버의 외부 HTTP 호출을 녹화·재생하려면 `mcpeak test`의 `--record-session`과 `--session`을
  사용하고, 서버 자체를 결정론적인 응답으로 대신하려면 `mcpeak-mock`을 사용하세요.

### Patch Changes

- e7fc2f0: `mcpeak-dashboard` 에 `--help` 를 만들고, 기동 줄에 **스위트 탐색 루트**를 함께 싣습니다.

  첫 화면이 비는 이유는 거의 언제나 명령을 실행한 디렉터리인데, 도구는 그 경로를
  `startDashboardServer` 에 `root` 로 넘기면서도 화면에는 URL 만 찍고 버렸습니다. 사용자는
  도구가 고장 난 것과 폴더를 잘못 고른 것을 구분할 수 없었습니다.

  ```
  전  대시보드: http://localhost:7357
  후  대시보드: http://localhost:7357  (스위트 탐색 루트: <repo-root>/my-project)
  ```

  `--help` 는 아예 없었습니다. 주면 도움말 대신 서버가 그냥 떴고, 종료하지도 않았습니다.
  그래서 있는 유일한 옵션 `--port` 를 발견할 방법이 없었습니다.

  ```
  사용법: mcpeak-dashboard [--port <번호>]

    --port <번호>   대시보드가 쓸 포트. 기본 7357 입니다.
    --help, -h      이 도움말을 보여주고 끝냅니다.

  스위트는 명령을 실행한 디렉터리 아래에서 찾습니다.
  ```

  `--help` 는 `--port` 검사보다 **먼저**입니다. 잘못된 포트 값과 함께 와도 도움말이 나가야
  합니다 — 그 값을 어떻게 고치는지가 도움말에 적혀 있기 때문입니다.

  인자 해석과 문안은 `cli-args.ts` 로 분리했습니다. `dashboard-cli.ts` 는 import 만 해도
  `main()` 이 실행되는 구조라 `parsePort` 가 export 인데도 테스트가 한 건도 없었습니다.
  `bin` 경로는 바꾸지 않았으므로 발행 산출물의 진입점은 그대로입니다.

  **브라우저 화면**은 이 변경에 들어 있지 않습니다. 화면에 루트를 띄우려면 API 응답에 필드를
  더해야 하고 그것은 공개 타입 변경이라 따로 다룹니다.

- 6dd1695: dashboard: repair 폼이 시작 버튼이 꺼진 이유를 버튼 옆에 말한다. 필수 칸(번들 경로·model)이
  비면 지금까지는 버튼만 말없이 비활성화됐다(#354). model 칸에는 이 칸이 필수라는 안내를 붙여
  generate 의 "모델 (선택)" 과 다르게 구는 이유를 화면에서 밝힌다.
- abaa102: run 화면이 **도는 run 과 없는 run 을 구분해서** 보여줍니다.

  지금까지 둘의 화면이 글자 하나 다르지 않았습니다. 실행이 도는 내내 "대기" 였고, 없는 run 을
  열어도 "대기" 였습니다. `RunStatus` 에 "대기" 라는 값은 없습니다 — 상태가 아니라 모른다는
  뜻인데 아는 척한 문구였습니다.

  ```
  전  실행 중          → 대기
      없는 run         → 대기            (영구히, 아무 안내 없음)

  후  실행 중          → 실행 중 뱃지    (첫 출력이 오기 전에도)
      없는 run         → 상태를 확인할 수 없음
                         그런 run이 없습니다.
                         → 대시보드는 실행 이력을 메모리에만 둡니다. 서버를 다시 시작했다면
                           이전 run 은 남아 있지 않습니다.
                         → 홈 화면의 최근 실행 목록에서 살아 있는 run 을 고르거나, 새 실행을
                           시작하세요.
  ```

  `mcpeak test` 는 끝날 때까지 stdout 을 뱉지 않으므로 SSE 이벤트가 한 건도 오지 않고, 그동안
  화면이 상태를 알 방법이 없었습니다. 구독 직전에 `GET /api/runs/:id` 를 **한 번** 읽어 그
  구간을 메웁니다. **주기 폴링은 하지 않습니다** — 타이머는 결정론성을 흔듭니다.

  스트림이 붙지 못한 경우는 `readyState` 로 **영구 실패**와 **재연결 중**을 가릅니다. 재연결은
  브라우저가 알아서 하므로 사람에게 알리지 않습니다. 판단 근거는
  [ADR-0072](../docs/adr/0072-대시보드-sse-실패를-readyState-로-판정한다.md) 에 있습니다.

  **서버는 한 줄도 바뀌지 않았습니다.** `GET /api/runs/:id` 가 이미 200 과 404 를 둘 다 주고
  있었고, 화면이 그것을 읽지 않았을 뿐입니다. 공개 타입도 바뀌지 않았습니다.

  안내는 화면 컨트롤 이름을 부르지 않습니다. 이 패널을 `RunView` 와 `RepairReview` 가 공유하는데
  후자에는 `← Runs` 링크가 없어, 없는 버튼을 누르라고 하는 안내가 됩니다.

- Updated dependencies [9d6f760]
- Updated dependencies [0dbeee2]
- Updated dependencies [82face1]
- Updated dependencies [de06218]
- Updated dependencies [623daa8]
- Updated dependencies [77135a3]
- Updated dependencies [2db017e]
- Updated dependencies [123702c]
- Updated dependencies [e24f46a]
- Updated dependencies [a3edffe]
- Updated dependencies [a810275]
- Updated dependencies [a49f43c]
- Updated dependencies [71ba3ed]
- Updated dependencies [5993740]
- Updated dependencies [cc14248]
- Updated dependencies [962e5f2]
- Updated dependencies [f5eebae]
- Updated dependencies [51a7193]
- Updated dependencies [b99847f]
- Updated dependencies [3f7692d]
- Updated dependencies [626d067]
- Updated dependencies [7186519]
- Updated dependencies [54d7dc6]
- Updated dependencies [7c1a5b0]
- Updated dependencies [48adbc8]
- Updated dependencies [d70bf49]
- Updated dependencies [5904700]
- Updated dependencies [3e39e33]
- Updated dependencies [63e50fe]
- Updated dependencies [0703898]
- Updated dependencies [3d79cd7]
- Updated dependencies [95f4299]
- Updated dependencies [46e47d5]
- Updated dependencies [8dc503e]
- Updated dependencies [9c0aa96]
- Updated dependencies [36bb78a]
- Updated dependencies [690203f]
- Updated dependencies [647a175]
- Updated dependencies [cc116fa]
- Updated dependencies [21977b4]
- Updated dependencies [2c5ca1b]
- Updated dependencies [ffdd83d]
- Updated dependencies [ff33aa7]
- Updated dependencies [aa00084]
- Updated dependencies [8579092]
- Updated dependencies [7bc5a71]
- Updated dependencies [c84eb8b]
  - @mcpeak/cli@0.11.0
  - @mcpeak/record@0.4.0
  - @mcpeak/generate@0.7.0
  - @mcpeak/mock@0.4.1
  - @mcpeak/runner@0.10.0

## 0.2.0

### Minor Changes

- e99192a: Node.js 최소 지원 버전을 22.18.0으로 올리고, 배포 패키지의 `engines.node`에 같은 요구사항을 명시합니다.

### Patch Changes

- 762978e: 대시보드에 남아 있던 옛 제품명을 지우고, 저장소를 쓸 수 없는 환경에서 화면이 통째로 죽던 것을 고친다.

  - **브라우저 탭 제목과 사이드바 로고가 아직 `OhMyMCP` 였다.** 개명(ADR-0050)이 URL 과
    패키지 이름까지만 따라오고 화면 문자열에서 멈춰 있었다. 발행된 `0.1.2` 의 번들과
    npm 의 패키지 설명에도 그대로 들어가 있다.
  - **`localStorage` 가 있다고 쓸 수 있는 것이 아니다.** 진입점(`main.tsx`)이 첫 페인트 전에
    테마를 적용하면서 저장소를 직접 만지는데, 저장소가 차단된 브라우저에서는 접근 자체가
    던진다. React 가 마운트되기 전이라 화면이 빈 페이지가 된다. Node 25 는 같은 자리에
    메서드 없는 껍데기를 두어 테스트 13 건을 깨뜨리고 있었다 (#212).

    `themeStorage()` 가 쓸 수 있는 저장소만 통과시키고 아니면 아무것도 기억하지 않는
    대체품을 준다. **테마를 기억하지 못하는 것은 불편이고, 대시보드가 안 뜨는 것은 고장이다.**

- f7c18f2: 실행 입력을 브라우저 `prompt()` 에서 화면 안 폼으로 옮기고, 공백이 든 경로를 못 쓰던 것을 고친다 (#223).

  - **`repair` 시작이 `window.prompt()` 3연발이었다.** 대시보드 테마와 따로 놀고, 두 번째에서
    오타를 알아채도 첫 번째부터 다시였고, `codex`·`claude` 둘뿐인 `provider` 가 자유 입력이었다.
    화면 안 폼으로 바꾸고 `provider` 를 `select` 로 만들었다. 값이 덜 차면 시작 버튼이 비활성이라
    세 번을 다 통과한 뒤에 실패하지 않는다. 번들이 어디서 생기는지도 입력란 아래 적었다.
  - **홈의 실행 명령이 한 칸이라 공백으로 쪼개고 있었다.** `node "my server.js"` 를 넣으면
    `--command node --arg "my --arg server.js"` 가 돼서, **공백이 든 경로를 가진 사용자는
    대시보드로 실행 자체를 못 했다.** generate 마법사가 쓰던 `StepServer`(실행 방법 세그먼트 +
    인자 칩 목록)를 그대로 쓴다. 나눠 받으므로 파싱도 따옴표 문제도 없어진다.

- Updated dependencies [e99192a]
- Updated dependencies [04d6786]
- Updated dependencies [19eb834]
- Updated dependencies [667c214]
- Updated dependencies [2e62615]
- Updated dependencies [a019771]
- Updated dependencies [3b78b72]
- Updated dependencies [fe9b0ea]
- Updated dependencies [cdb8da0]
- Updated dependencies [93816a8]
  - @mcpeak/cli@0.10.0
  - @mcpeak/core@0.4.0
  - @mcpeak/generate@0.6.0
  - @mcpeak/mock@0.4.0
  - @mcpeak/record@0.3.0
  - @mcpeak/runner@0.9.0

## 0.1.2

### Patch Changes

- Updated dependencies [7520b74]
- Updated dependencies [be534d6]
- Updated dependencies [c923b48]
- Updated dependencies [10ae345]
- Updated dependencies [55ba842]
- Updated dependencies [d962089]
- Updated dependencies [393def4]
- Updated dependencies [6cb8b5b]
  - @mcpeak/cli@0.9.0
  - @mcpeak/generate@0.5.1
  - @mcpeak/mock@0.3.0
  - @mcpeak/record@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [cd25fb4]
- Updated dependencies [407f9ff]
- Updated dependencies [49b2431]
- Updated dependencies [5b469fe]
- Updated dependencies [892ff61]
- Updated dependencies [bf16fb5]
- Updated dependencies [7600b09]
- Updated dependencies [6a93d42]
- Updated dependencies [6ada2e6]
- Updated dependencies [5dd34d3]
- Updated dependencies [464d065]
- Updated dependencies [f58967f]
- Updated dependencies [8a5b2a4]
- Updated dependencies [9bdd914]
- Updated dependencies [8eb955d]
- Updated dependencies [d70affe]
- Updated dependencies [99db6ee]
- Updated dependencies [f0ae3d3]
- Updated dependencies [2d68bdb]
- Updated dependencies [a2b37e0]
- Updated dependencies [8e28914]
- Updated dependencies [247e414]
- Updated dependencies [4e2c6df]
- Updated dependencies [4558ef9]
- Updated dependencies [db571dd]
- Updated dependencies [58fb54a]
  - @ohmymcp-hsu/core@0.3.0
  - ohmymcp@0.8.0
  - @ohmymcp-hsu/generate@0.5.0
  - @ohmymcp-hsu/mock@0.2.0
  - @ohmymcp-hsu/record@0.1.2
  - @ohmymcp-hsu/runner@0.8.0
