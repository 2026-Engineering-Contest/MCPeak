# Task T4 완료 보고 (실환경 E2E, 직렬 전용)

## 실행 환경

```
$ pwd
/Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-runner-body-assertion

$ git rev-parse HEAD
a1f9bb47a129daadcedde76d2d9e4080628dac0c
```

브랜치 `feat/runner-body-assertion`. git 명령은 조회만 했고 커밋·머지·푸시는 실행하지 않았다.

## 변경 파일

```
 M packages/cli/tests/dist-cli-e2e.mjs
?? packages/cli/tests/fixtures/weather-body-assertion.suite.json
?? packages/cli/tests/fixtures/weather-body-assertion-failing.suite.json
?? docs/reports/task-t4.md
```

승인 범위 밖은 건드리지 않았다. `packages/cli/src/` 변경 없음. `packages/runner/` 변경 없음.
T1·T2·T3 산출물과 오케스트레이터가 통합 커밋에서 고친 `spec/index.ts` 배럴도 그대로 뒀다.

## 무엇을 했나

### 픽스처 1: 통과 (`weather-body-assertion.suite.json`)

계획서 §5 Task T4의 JSON을 그대로 썼다. 3케이스다.

- `weather-seoul`: JSON 객체 본문 구조 검증. `additionalProperties: false`, `required` 3개,
  `const` `enum` `minimum` `maximum`을 한 스키마에서 함께 쓴다.
- `weather-unknown-city`: 문자열 본문에 `stringContains: "사용 가능한 도시"`.
- `weather-invalid-type`: 문자열 본문에 `stringContains: "문자열이어야 합니다"`.

2번과 3번은 둘 다 `isError: true`인 오류 응답이지만 서로 다른 오류 분기다. 기존 계약으로는
구별되지 않았고 그것이 이 작업의 출발점이었다. 이제 두 케이스가 실제로 다른 문장을 요구한다.

`examples/weather-server/server.mjs`의 실제 응답을 확인하고 값을 골랐다. 서울은
`{ city: "서울", temp: 21, condition: "맑음" }`, 없는 도시는
`→ '평양' 의 날씨 데이터가 없습니다. 사용 가능한 도시: 서울, 부산, 제주`,
문자열이 아닌 `city`는 `→ 'city' 는 문자열이어야 합니다. 예: { "city": "서울" }`를 반환한다.

### 픽스처 2: 실패 (`weather-body-assertion-failing.suite.json`)

계획서 JSON 그대로다. `temp` 대신 `temperature`를 요구해 서버가 필드를 개명한 상황과 같은
진단을 만든다.

### `dist-cli-e2e.mjs`

계획서의 변경 2건을 그대로 적용했다.

1. 상단 fixture 배열에 `weather-body-assertion.suite.json`을 `passed`,
   `{ total: 3, passed: 3, ... }`로 추가.
2. 파일 끝 `generate` 블록 뒤에 새 블록 추가. 진단 코드와 위반 개수, 위반 코드와 경로,
   **진단 문장 전문**을 단언하고, 같은 인자로 2회 실행한 표준 출력 바이트가 같은지 본다.

## 검증 명령과 출력

### 표적 검증

```
$ pnpm build && node packages/cli/tests/dist-cli-e2e.mjs

 Tasks:    6 successful, 6 total
Cached:    5 cached, 6 total
  Time:    666ms
```

E2E 스크립트는 성공하면 아무것도 출력하지 않고 종료 코드 0으로 끝난다. 확인용으로
`&& echo` 를 붙여 실행했고 `E2E PASSED` 가 나왔다. 2회 실행 모두 통과했다.

`pnpm build` 를 앞에 붙여 낡은 `dist/cli.mjs` 로 판정하는 거짓 신호를 막았다. 이번 실행이
새 `dist` 를 썼다는 근거는 `BODY_SCHEMA_MISMATCH` 와 `REQUIRED_MISSING` 단언이 통과한 것이다.
T3 이전 `dist` 였다면 이 코드 자체가 존재하지 않아 실패한다.

E2E가 확인한 것을 풀어 쓰면 다음과 같다.

- 통과 픽스처 3케이스가 실제 서버 프로세스 상대로 전부 통과한다(`passed`, 종료 코드 0).
- 실패 픽스처는 종료 코드 1, `status: "failed"`, stderr 비어 있음.
- `diagnostic.code === "BODY_SCHEMA_MISMATCH"`, `totalViolations === 1`,
  `violations.length === 1`, `violations[0].code === "REQUIRED_MISSING"`,
  `violations[0].path === "$.temperature"`.
- 문장 전문이
  `$.temperature: 필수 필드가 없습니다. 발견된 필드: 'city', 'condition', 'temp'` 와 정확히 같다.
  서버 응답의 키 순서는 `city`, `temp`, `condition` 인데 진단은 사전순이다. 응답에서 온 목록을
  정렬한다는 §4-8 규칙이 유닛테스트뿐 아니라 실제 경로에서도 지켜짐을 이 단언이 증명한다.
- 같은 인자로 2회 실행한 표준 출력 바이트가 같다.
- 매 실행 뒤 서버 프로세스가 종료했다(`expectExited`).

### 전체 회귀

```
$ pnpm typecheck

 Tasks:    6 successful, 6 total
Cached:    5 cached, 6 total
  Time:    842ms
```

`tsc --noEmit` 은 성공 시 무출력이라 검사 대상 0개와 구분되지 않는다. 이번에 만진 패키지인
`cli` 의 파일 수를 따로 셌다.

```
$ cd packages/cli && npx tsc --noEmit --listFiles | grep "packages/cli" | grep -vc node_modules
9
```

```
$ pnpm lint
> biome check .

Checked 112 files in 21ms. No fixes applied.
```

T3 시점 110개에서 신규 픽스처 2개가 늘어 112개다. 포맷 수정은 필요 없었다.

```
$ pnpm test
> vitest run

 Test Files  32 passed (32)
      Tests  476 passed | 1 skipped (477)
   Duration  1.44s
```

`pnpm test` 는 vitest 스위트다. T4가 추가한 dist E2E는 vitest 밖에서 도는 별도 스크립트라
이 숫자에 포함되지 않는다. T3와 같은 476인 것이 정상이다.

### 좀비 프로세스 확인

E2E 실행 뒤 `weather-server/server.mjs` 문자열로 살아 있는 프로세스를 확인했더니 2건이
잡혔다. 확인해 보니 이번 실행과 무관했다.

```
$ ps -o pid,ppid,etime,command -p ...
14048  1  20:26:17  ... /Users/doo._.hyun/Study/Project/OhMyMCP/packages/cli/dist/cli.mjs generate ... --provider codex ...
14050  14048  20:26:17  ... 같은 명령
```

경로가 worktree가 아니라 메인 저장소이고, 경과 시간이 20시간이며, 명령이 `generate --provider
codex` 다. 다른 세션이 20시간 전에 띄운 것이고 T4가 남긴 것이 아니다. T4가 띄운 프로세스는
`expectExited` 가 매 실행마다 종료를 확인한다.

## 내가 임의로 판단한 부분

1. **픽스처 JSON의 줄바꿈과 들여쓰기.** 계획서의 JSON은 `"assertions"` 안의
   `{ "type": "bodyMatchesSchema", "schema": {` 를 한 줄에 붙여 썼는데 biome 포맷과 맞지 않아
   `schema` 를 다음 줄로 내렸다. 값과 구조는 한 글자도 바꾸지 않았다. `pnpm lint` 가 통과한다.

2. **E2E 성공 확인 방법.** 이 스크립트는 성공 시 아무것도 출력하지 않는다. 통과와 "아무것도
   안 돌았음" 을 구분하려고 `&& echo "E2E PASSED"` 를 붙여 실행했다. 스크립트 자체는 고치지
   않았다.

3. **`pnpm test` 숫자가 T3와 같은 것.** T4의 산출물은 vitest가 수집하지 않는 `.mjs` 스크립트라
   전체 테스트 수가 늘지 않는다. 이것이 정상이며, 늘지 않은 것을 실패 신호로 오해하지 않도록
   여기에 적어 둔다. T4의 판정 근거는 `node packages/cli/tests/dist-cli-e2e.mjs` 의 종료 코드다.

## 계약 관련 확인 사항

- 승인 범위인 세 파일과 보고서만 만졌다. `packages/cli/src/` 와 `packages/runner/` 무변경.
- 의존성 추가 없음. `@modelcontextprotocol/sdk` 버전 변경 없음.
- 이 태스크만 `examples/weather-server` 의 실제 프로세스를 띄운다. 유닛테스트(vitest) 쪽에는
  실제 서버를 띄우는 코드를 추가하지 않았다.
- 진단 문장 전문 단언과 결정론성 단언을 모두 넣었다.
