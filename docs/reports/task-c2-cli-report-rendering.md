# Task T2 보고서 (cli 출력 계약)

## 실행 환경

```
pwd
<repository-root>/.claude/worktrees/ohmymcp-cli-report-rendering

git rev-parse HEAD
d3d16b7 (feat/cli-report-rendering)
```

## 변경 파일

```
 M packages/cli/src/index.ts
 M packages/cli/src/test-command.ts
 M packages/cli/tests/test-command.test.ts
?? .changeset/spotty-eagles-repeat.md
?? docs/adr/0012-cli-기본-출력-전환.md
?? docs/reports/task-c2-cli-report-rendering.md
```

허용 목록 밖 수정은 없다. `packages/cli/src/generate-command.ts`, `packages/runner/`,
`packages/cli/tests/cli-integration.test.ts` 모두 손대지 않았다. git 명령은 조회만 했다.

- `test-command.ts`: `TestCommandInput.json` 추가, `TestCommandDependencies` 에 `renderReport` 와
  `colorEnabled` 추가, `parseTestCommand` 에 `--json` 분기 추가, `runCli` 끝의 출력 블록 교체.
  계획서 §4-8 그대로다. `--json=` 분기는 `--json` 분기 뒤, `startsWith("-")` 분기 앞에 있다.
- `index.ts`: `unavailableDependencies` 에 던지는 `renderReport` 와 `colorEnabled: false` 추가,
  test 실행 경로에 `renderReport: runner.renderReport` 와 `colorEnabled` 한 줄 추가. 계획서 §4-9 그대로다.
- `test-command.test.ts`: 신규 테스트 12개, 기존 stdout 테스트를 `--json` 호출로 변경,
  `parseTestCommand` 기존 두 테스트의 기대값에 `json: false` 추가, `deps()` 에 `renderReport` 스파이와
  `colorEnabled` 추가.

## 구현 순서

계획서 5장 T2 순서를 따랐다. 테스트를 먼저 고치고 실패를 확인한 뒤 구현했다.

```
pnpm vitest run packages/cli/tests/test-command.test.ts   (구현 전)
 Test Files  1 failed (1)
      Tests  12 failed | 18 passed (30)
```

기존 테스트 `통과, 실패와 중단 report를 stdout으로만 출력한다` 는 지우지 않고 argv 에 `--json` 을
붙였다. `expect(d.writes.out.join("")).toBe(`${JSON.stringify(report(status), null, 2)}\n`)` 단언은
그대로 남아 있으므로 JSON 경로의 바이트 동일성이 계속 검증된다.

## 검증

### 표적

```
pnpm vitest run packages/cli/tests/test-command.test.ts

 Test Files  1 passed (1)
      Tests  30 passed (30)
   Duration  87ms
```

계획서 §5 T2 표의 신규 테스트 12개가 모두 있다. 이름 그대로다.

### 회귀

```
pnpm build      Tasks: 6 successful, 6 total
pnpm typecheck  Tasks: 6 successful, 6 total
pnpm lint       Checked 116 files in 23ms. No fixes applied.

pnpm test
 Test Files  2 failed | 33 passed (35)
      Tests  4 failed | 550 passed | 1 skipped (555)
```

린트 116 파일, 타입체크 6 태스크로 검사 대상이 0이 아니다.

### 실패 4건의 내용

예상된 것 둘이다. `packages/cli/tests/cli-integration.test.ts` 이며 T3 가 고친다.

```
FAIL packages/cli/tests/cli-integration.test.ts > CLI 실제 weather-server > 성공 report, 종료 코드와 PID 정리를 검증한다
SyntaxError: Unexpected token 'w', "weather-se"... is not valid JSON
  96| const parsed = JSON.parse(out.mock.calls.map(([value]) => String(...

FAIL packages/cli/tests/cli-integration.test.ts > CLI 실제 weather-server > assertion 실패 report, 종료 코드와 PID 정리를 검증한다
SyntaxError: Unexpected token 'w', "weather-se"... is not valid JSON
 137| const parsed = JSON.parse(out.mock.calls.map(([value]) => String(...
```

**예상에 없던 것 둘이다.** 계획서가 지목하지 않은 파일이다.

```
FAIL packages/cli/tests/generate-integration.test.ts > generate 실제 weather-server > weather baseline은 실제 test에서 신뢰도 한계를 드러낸다
SyntaxError: Unexpected token 'W', "Weather  ("... is not valid JSON
 166| const report = JSON.parse(out.mock.calls.map(([value]) => String(...

FAIL packages/cli/tests/generate-integration.test.ts > generate 실제 weather-server > 사용자 지시를 반영한 승인 candidate는 실제 test를 통과한다
SyntaxError: Unexpected token 'W', "Weather  ("... is not valid JSON
 308| expect(JSON.parse(outputs.join("")).summary).toEqual({
```

원인은 cli-integration 과 같다. 이 두 테스트도 `run([...])` 로 `test` 서브커맨드를 돌린 뒤 stdout 을
`JSON.parse` 한다. `generate` 호출이 아니라 그 뒤의 `test` 호출이 문제다. `--json` 이 없으니 이제
사람용 문자열이 나온다. `Weather  (` 는 렌더러 헤더 줄의 앞부분이다.

고칠 지점은 두 곳이다. 각 `run([...])` 배열의 `"test"` 인자 목록 끝에 `"--json"` 을 넣으면 된다.

- `packages/cli/tests/generate-integration.test.ts:154` 로 시작하는 배열
- `packages/cli/tests/generate-integration.test.ts:296` 으로 시작하는 배열

이 파일은 T2 의 허용 목록에도, 계획서 T3 의 Files 목록에도 없다. 그래서 고치지 않고 그대로 뒀다.
**T3 의 승인 범위를 이 파일까지 넓혀 달라.** 계획서 §5 T3 의 Files 목록이 두 파일뿐인 것은 이
파일을 놓친 누락으로 보인다.

## 임의로 판단한 부분

1. **`parseTestCommand` 기존 두 테스트의 기대값에 `json: false` 를 넣었다.** `toEqual` 로 객체
   전체를 비교하므로 필드가 늘면 깨진다. 계획서가 이 두 테스트를 명시하지 않았지만 §4-8이
   `TestCommandInput` 에 `json` 을 필수로 넣도록 규정하므로 기대값 갱신이 불가피하다.
   두 테스트의 이름과 나머지 단언은 그대로다.
2. **테스트의 `renderReport` 스파이 반환값을 `렌더링 결과\n` 로 뒀다.** 문안은 runner 소유이므로
   CLI 테스트는 "주입한 값이 그대로 stdout 에 나오는가" 만 본다. 상수 이름은 `RENDERED` 다.
3. **changeset 파일 이름을 `spotty-eagles-repeat.md` 로 지었다.** 계획서가 이름을 정하지 않아
   changesets 관례대로 임의의 세 단어 이름을 썼다. 본문은 계획서에 적힌 마크다운 그대로다.
4. **`colorEnabled` 를 계획서 §4-9 그대로 `process.stdout.isTTY === true && process.env.NO_COLOR === undefined`
   로 두고 주석 한 줄을 붙였다.** `process` 를 읽는 유일한 지점임을 표시하기 위해서다.

## 남은 위험

- 위에 적은 `generate-integration.test.ts` 두 건이 지금 빨간 상태다. T3 범위를 넓히지 않으면
  `pnpm test` 가 계속 실패한다.
- `--json` 경로의 바이트 동일성은 유닛 테스트에서 확인했다. 실제 프로세스 경로의 확인은 T3 의
  `dist-cli-e2e.mjs` 몫이다.
- `packages/cli/dist/cli.mjs` 는 이 태스크에서 `pnpm build` 로 갱신했다. T3 는 실행 전에 다시
  `pnpm build` 를 해야 한다.
