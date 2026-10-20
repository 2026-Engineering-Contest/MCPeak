# analyze 성능 카드 perf 연결 추가 태스크 T1b 보고서 (2026-10-20)

`mcpeak perf` 가 측정 도중 호출 하나가 기록될 때마다 stderr 에 진행 줄을 쓰게 했다.

## 작업 공간

- pwd: `.claude/worktrees/ohmymcp-perf-progress`
- 브랜치: `feat/perf-progress` (origin/main 에서 분기)
- BASE (`git rev-parse origin/main`): `62e8c387a9a5b122e20e3cd451a2288c033e803b` (지시의 값과 같음)
- `git rev-parse HEAD`: `62e8c387a9a5b122e20e3cd451a2288c033e803b` (커밋하지 않음)

## 변경 파일

- `packages/cli/src/perf-command.ts`: `deps.perf.measure` 호출에 `onProgress` 를 넘긴다. `done` 으로 케이스 순번과
  반복 회차를 되짚어 `측정 중 N/M · <케이스> (i/R회)` 를 쓴다. 케이스 id 는 `escapeTerminalText` 를 거친다. 시작·끝 줄
  문구는 그대로다.
- `packages/cli/tests/perf-command.test.ts`: "측정 중 호출마다 진행 줄을 쓴다" 를 더했다. 기존 두 stderr 완전 일치
  단언을 진행 줄이 들어간 기대값으로 고쳤다(아래 판단 1).
- `packages/cli/tests/perf-e2e.test.ts`: `--json` 테스트의 stderr 기대값에 `serial` 케이스 진행 줄 다섯 개를 넣었다.
- `.changeset/perf-progress-lines.md`: `"@mcpeak/cli": patch`, 지시의 본문 그대로.
- `docs/reports/2026-10-20-analyze-perf-T1b.md`: 이 보고서.

`packages/perf` 와 허용 Files 밖은 건드리지 않았다.

## 검증

| 명령 | 결과 |
|---|---|
| 구현 전 `pnpm vitest run packages/cli/tests/perf-command.test.ts` | 1 실패, 79 통과 (새 테스트만 실패) |
| `pnpm vitest run packages/cli/tests/perf-command.test.ts packages/cli/tests/perf-e2e.test.ts` | 파일 2 통과, 테스트 84 통과 |
| `pnpm build --force` | Tasks 10 successful, `Cached: 0 cached, 10 total` |
| `pnpm typecheck --force` | Tasks 10 successful, `Cached: 0 cached, 10 total` |
| `pnpm lint` | 776 파일, 오류 0, 경고 14 (기존 것) |
| `pnpm test` | 파일 2 실패, 252 통과. 테스트 5 실패, 5857 통과, 3 skip (5865) |
| `pnpm vitest run packages/cli/tests/audit-sandbox-e2e.test.ts` (재실행, 표본 수집 포함) | 1 실패, 21 통과. 실패는 live-weather 녹화·재생 비교 하나 |

### `pnpm test` 의 실패

실패는 전부 `packages/cli/tests/audit-sandbox-e2e.test.ts` 와 `packages/dashboard/tests/analyze-security-e2e.test.ts`
에 있고, 이번 변경(perf 진행 줄)과 닿는 경로가 없다.

- live-weather `--sandbox-session`/`--sandbox-replay` 비교는 매번 줄 수가 달라 실패한다(183, 200 대 198). main 에서도 실패하는
  기존 flaky 다.
- 나머지는 잔존 단언(라벨 `mcpeak.audit=1` 컨테이너가 남음) 계열이고 실행마다 다른 테스트가 걸렸다. 시작 직전 확인에서는
  `docker ps -a --filter label=mcpeak.audit=1 -q` 와 `pgrep -f "vitest\.mjs|cli\.mjs audit"` 가 비어 있었다. 그런데 실행 중
  표본에 다른 worktree 의 대시보드 두 개가 떠 있었다. `ohmymcp-analyze-perf-T4` 의 것(13:48 시작)과 `dashboard-latest` 의
  것(11:13 시작)이다. 대시보드의 "분석하기" 는 같은 라벨로 격리 점검을 띄우므로 사전 확인 명령으로는 잡히지 않는 동시 실행
  원인이다. 그 상태에서 다시 돌린 마지막 실행은 live-weather 하나만 실패했다.

## 임의로 판단한 부분

1. 지시는 "기존 stderr 완전 일치 단언(perf-command.test.ts 644·650행)은 fake 가 onProgress 를 안 부르면 그대로 통과" 라고
   했지만, 이 파일의 `harness()` 는 기본으로 실제 `perf.measure` 를 쓴다. 그래서 두 단언이 진행 줄 때문에 실패했다.
   같은 파일(허용 Files) 안에서 기대값을 진행 줄이 들어간 값으로 고쳤다. 기대값은 작은 도우미 `progressStderr(caseIds,
   repeat)` 로 만들고, 첫 테스트 이름 "진행 문장은 stderr 두 줄" 은 사실과 맞지 않아 "진행 문장은 stderr 의 시작 줄, 호출마다의
   진행 줄, 끝 줄이다" 로 바꿨다. 새 테스트는 문자열을 직접 적어 도우미와 무관하게 형식을 못 박는다.
2. 새 테스트의 fake measure 는 실제 `perf.measure` 를 `onProgress` 없이 돌려 측정값 4개를 얻은 뒤 `(1,4)`~`(4,4)` 를 손으로
   부른다. 지시가 요구한 마지막 줄 "측정 완료: 호출 4회" 가 측정값 개수에서 나오기 때문이다.
3. 잔존 단언 실패를 이번 변경과 무관하다고 판정하려고, 실행 중 다른 프로세스를 1초마다 기록하는 진단 스크립트를 scratchpad 에
   두고 돌렸다(그 스크립트 안의 표본기만 하위 셸로 돌렸다).

## 리뷰 수정 (PR #537, CodeRabbit 지적 1건)

지적: 신호 처리기가 `session.interrupted` 를 먼저 세우고 연결을 닫는다. 남은 `callTool` 이 거부된 채로 기록되면 `measure` 가
`onProgress` 를 계속 불러, 중단 뒤에도 진행 줄이 stderr 에 나온다. "중단 뒤 본 흐름은 아무것도 쓰지 않는다" 는 계약 위반이다.

- `packages/cli/src/perf-command.ts`: `onProgress` 콜백 맨 앞에서 `session.interrupted !== undefined` 면 바로 돌아간다.
  `session` 은 `measureAndReport` 의 인자라 그 자리에서 보인다. 이유는 주석 한 줄로 적었다.
- `packages/cli/tests/perf-command.test.ts`: 신호 정리 describe 에 "신호로 중단된 뒤에는 진행 줄을 쓰지 않는다" 를 더했다.
  기존 신호 테스트처럼 fake measure 안에서 `h.signal("SIGINT")` 를 부른다. `(1,4)` 를 부른 뒤 신호를 보내고 `(2,4)`~`(4,4)` 를
  더 부른다. stderr 가 시작 줄과 첫 진행 줄 하나뿐인지, 종료 코드 130 과 `killSelf("SIGINT")` 를 단언한다.

| 명령 | 결과 |
|---|---|
| 수정 전 `pnpm vitest run packages/cli/tests/perf-command.test.ts` | 1 실패(새 테스트), 80 통과 |
| `pnpm vitest run packages/cli/tests/perf-command.test.ts packages/cli/tests/perf-e2e.test.ts` | 파일 2 통과, 테스트 85 통과 |
| `pnpm typecheck --force` | Tasks 10 successful, `Cached: 0 cached, 10 total` |
| `pnpm lint` | 776 파일, 오류 0, 경고 14 (기존 것) |

이번 수정 범위에서는 `pnpm build --force` 와 `pnpm test` 전체를 다시 돌리지 않았다(지시한 검증 명령 밖).
