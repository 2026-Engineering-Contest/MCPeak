# @ohmymcp-hsu/dashboard

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
