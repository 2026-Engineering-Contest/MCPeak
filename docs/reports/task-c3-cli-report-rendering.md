# Task T3 보고서 (실환경 검증)

## 실행 환경

```
pwd
<repository-root>/.claude/worktrees/ohmymcp-cli-report-rendering

git rev-parse HEAD
52b5b7c (feat/cli-report-rendering)
```

## 변경 파일

```
 M packages/cli/tests/cli-integration.test.ts
 M packages/cli/tests/dist-cli-e2e.mjs
 M packages/cli/tests/generate-integration.test.ts
?? docs/reports/task-c3-cli-report-rendering.md
```

`packages/cli/src/` 와 `packages/runner/` 는 손대지 않았다. git 명령은 조회만 했다.

- `cli-integration.test.ts`: `JSON.parse` 를 쓰는 두 테스트의 argv 끝에 `"--json"` 추가.
  렌더링 경로 테스트 `--json 없이 실패 케이스의 진단 문장을 stdout에 쓴다` 하나 추가.
  그 테스트가 쓰는 스위트 상수 `bodyFailure` 한 줄 추가. 기존 픽스처를 그대로 쓰며 새로 만들지 않았다.
- `generate-integration.test.ts`: `run([...])` 두 곳(`test` 서브커맨드)의 인자 끝에 `"--json"` 추가.
  `generate` 호출과 스위트 파일을 읽는 `JSON.parse` 는 손대지 않았다.
- `dist-cli-e2e.mjs`: `test` 서브커맨드 실행 세 지점의 인자 배열 끝에 `"--json"` 추가.
  파일 끝에 렌더링 경로 블록 추가. 계획서 5장 T3 의 코드 그대로다.

## 검증

### 표적

```
pnpm build && node packages/cli/tests/dist-cli-e2e.mjs
 Tasks:    6 successful, 6 total
(E2E 는 실패 시 assert 로 즉시 종료한다. 종료 코드 0 으로 끝났다)

pnpm vitest run packages/cli/tests/cli-integration.test.ts
 Test Files  1 passed (1)
      Tests  4 passed (4)
   Duration  421ms

pnpm vitest run packages/cli/tests/generate-integration.test.ts
 Test Files  1 passed (1)
      Tests  4 passed (4)
   Duration  724ms
```

`pnpm build` 를 먼저 돌렸다. 낡은 `dist/cli.mjs` 로 판정했다면 증상은
`지원하지 않는 test 옵션 '--json'입니다.` 였을 것이고 그런 출력은 없었다.

### 전체 회귀

```
pnpm build      Tasks: 6 successful, 6 total
pnpm typecheck  Tasks: 6 successful, 6 total
pnpm lint       Checked 116 files in 21ms. No fixes applied.

pnpm test
 Test Files  35 passed (35)
      Tests  555 passed | 1 skipped (556)
   Duration  1.50s
```

완전히 녹색이다. T2 시점에 남아 있던 실패 4건이 모두 사라졌다.
`packages/core/tests/stdio-integration.test.ts` 는 이번 회차에서 실패하지 않았다.

### 검사 대상이 0이 아닌지 확인

turbo 캐시를 비우고 다시 돌렸다.

```
turbo run typecheck --force
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
```

`packages/cli` 에서 `tsc --noEmit --listFiles` 로 센 검사 대상은 9개다. 변경한 두 테스트 파일이
목록에 있다.

```
packages/cli/src/generate-command.ts
packages/cli/src/test-command.ts
packages/cli/src/index.ts
packages/cli/src/cli.ts
packages/cli/tests/cli-integration.test.ts
packages/cli/tests/generate-command.test.ts
packages/cli/tests/generate-integration.test.ts
packages/cli/tests/index.test.ts
packages/cli/tests/test-command.test.ts
```

`dist-cli-e2e.mjs` 는 `.mjs` 라 tsc 대상이 아니다. biome 의 116 파일 검사에는 포함된다.

## 사람이 실제로 보게 될 출력

```
node packages/cli/dist/cli.mjs test \
  packages/cli/tests/fixtures/weather-body-assertion-failing.suite.json \
  --command node --arg examples/weather-server/server.mjs

날씨 서버 응답 본문 불일치  (1 case)

✗ weather-renamed-field  temperature 필드를 기대하지만 서버는 temp를 반환한다
    bodyMatchesSchema  응답이 기대 스키마와 다릅니다. 위반 1건.
    → $.temperature: 필수 필드가 없습니다. 발견된 필드: 'city', 'condition', 'temp'
    해결: 스키마 변경이 의도된 것이라면 테스트를 업데이트하세요.

1 failed  (1 total)

exit=1
```

## 임의로 판단한 부분

1. **`cli-integration.test.ts` 의 새 테스트에서 픽스처 경로를 파일 상단 상수 `bodyFailure` 로 뽑았다.**
   기존 `success`, `failure` 상수와 같은 자리에 같은 방식으로 뒀다.
2. **새 테스트의 단언 순서를 진단 문장 포함, `JSON.parse` 던짐, stderr 미호출, PID 종료 순으로 뒀다.**
   계획서가 요구한 세 단언(진단 문장, `JSON.parse` 던짐, 종료 코드 1)이 모두 있고, 기존 두 테스트와
   같은 구조를 유지하려고 stderr 와 PID 확인을 덧붙였다.
3. **`dist-cli-e2e.mjs` 의 렌더링 블록은 계획서 코드를 그대로 붙였다.** ANSI 검사의 문자열 리터럴은
   raw 바이트가 아니라 유니코드 이스케이프 표기로 넣었다.

## 남은 위험

- 렌더링 경로의 결정론성은 E2E 에서 두 번 실행의 stdout 바이트 비교로 확인했다. 이것이 계획서
  §11 의 거짓 신호 "출력이 결정론적인 것처럼 보임" 에 대한 진실 기준이다.
- `packages/core/tests/stdio-integration.test.ts` 의 플레이키 실패는 이번 회차에서 재현되지 않았다.
  실제 프로세스를 띄우는 테스트라 병렬 부하에서 다시 나타날 수 있다. 이 파일은 손대지 않았다.
- E2E 는 `pnpm build` 산출물을 판정하므로 통합 게이트에서도 `pnpm build` 를 생략하면 안 된다.
