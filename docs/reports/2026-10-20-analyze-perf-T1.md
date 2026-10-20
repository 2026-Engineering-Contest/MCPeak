# analyze 성능 카드 perf 연결 W1 T1 보고서 (2026-10-20)

계획서 `docs/plans/2026-10-20-analyze-성능-카드-perf-연결-구현계획.md` §2 를 구현했다.

## 작업 공간

- pwd: `.claude/worktrees/ohmymcp-analyze-perf-T1`
- 브랜치: `feat/perf-cli-exports`
- BASE (`git rev-parse feat/analyze-perf`): `43d6ffd2e7fe594e83e0bfc29e8da48bd8ff0576`
- `git rev-parse HEAD`: `43d6ffd2e7fe594e83e0bfc29e8da48bd8ff0576` (BASE 와 같음, 커밋하지 않음)

## 변경 파일

- `packages/cli/src/commands.ts`: `nodePerfDependencies` 를 `index.js` 재export 줄에 더하고, `optimize-command.js` 블록과
  `repair-command.js` 블록 사이에 `PerfCommandDependencies`(타입)·`runPerfCommand` 재export 블록을 넣었다.
- `packages/cli/tests/commands.test.ts`: §2.3 의 세 테스트를 describe 끝에 더했다.
- `.changeset/cli-perf-commands-export.md`: §2.4 원문 그대로 만들었다.
- `docs/reports/2026-10-20-analyze-perf-T1.md`: 이 보고서.

## 검증

| 명령 | 결과 |
|---|---|
| 구현 전 `pnpm vitest run packages/cli/tests/commands.test.ts` | 2 실패, 6 통과 (8). 새 export 두 테스트가 기대대로 실패했다. `parsePerfCommand` 부재 테스트는 가드라서 처음부터 통과한다 |
| 구현 후 `pnpm vitest run packages/cli/tests/commands.test.ts` | 8 통과 (8) |
| `pnpm build --force` | Tasks 10 successful, `Cached: 0 cached, 10 total` |
| `pnpm typecheck --force` | Tasks 10 successful, `Cached: 0 cached, 10 total` |
| `pnpm lint` | 776 파일 검사, 오류 0, 경고 14 (기존 것, 이번 변경 파일과 무관) |
| `pnpm test` | 파일 1 실패, 253 통과 (254). 테스트 1 실패, 5860 통과, 3 skip (5864) |

### `pnpm test` 의 실패 1건

`packages/cli/tests/audit-sandbox-e2e.test.ts` 의 "live-weather 를 --sandbox-session 으로 한 번, --sandbox-replay 로
한 번 돌린 --json 이 sandbox.network 만 다르다" 가 출력 줄 수가 다르다는 이유로 실패했다.

- 시작 전 `docker ps -a --filter label=mcpeak.audit=1 -q` 와 `pgrep -f "vitest\.mjs|cli\.mjs audit"` 는 둘 다 비어 있었다.
  즉 다른 세션과 동시에 돌아서 생긴 실패가 아니다.
- 그 파일만 다시 돌려도 같은 단언에서 실패했다(183 대 198).
- `commands.ts` 를 BASE 내용으로 잠시 되돌리고 `pnpm build --force` 뒤 다시 돌려도 실패했다(200 대 198). 실행마다 줄 수가
  달라지므로 실제 외부 데이터(live-weather 의 실시간 응답)에 따라 흔들리는 기존 flaky 로 판단했다. 확인 뒤 변경을 되살리고
  `pnpm build --force`·`pnpm typecheck --force`(둘 다 `Cached: 0 cached`)·표적 테스트(8 통과)를 다시 돌렸다.
- 이 테스트는 audit 오너 소관이고 이번 Files 밖이라 손대지 않았다.

## 임의로 판단한 부분

- §2.3 의 세 번째 테스트(`parsePerfCommand` 부재)는 구현 전에도 통과한다. 계획서대로 그대로 두었다.
- 위 e2e 실패를 이번 변경과 무관하다고 판정하려고 `commands.ts` 를 BASE 내용으로 잠시 되돌려 재현했다. git 명령은
  읽기(`git show HEAD:...`)만 썼고 stash·checkout 은 쓰지 않았다.
- changeset 의 bump 는 계획서대로 `minor` 로 두었다.
