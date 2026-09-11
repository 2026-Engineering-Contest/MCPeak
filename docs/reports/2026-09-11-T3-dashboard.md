# T3 보고: 녹화 실패 사유 문구와 ADR-0094 (dashboard + docs)

- 날짜: 2026-09-11
- 브랜치: `fix/record-session-completion-dashboard`
- 기준 커밋: `64fc396`
- 근거 문서: `docs/2026-09-11-녹화-완료-판정-분리-설계.md` §4 · §5.4 · §7.4

## 바꾼 파일

| 파일 | 변경 |
|---|---|
| `packages/dashboard/web/src/screens/ReplayView.tsx` | `STATUS_REASON.failed` 를 설계 §5.4 의 새 문자열로 교체. `STATUS_REASON` 위 주석이 CLI 의 새 `REPLAY_SOURCE_INVALID` 안내(설계 §5.2)를 가리키도록 갱신 |
| `packages/dashboard/web/tests/replay-view.test.tsx` | 설계 §7.4 의 `it` 블록 추가 |
| `docs/adr/0094-녹화-완료-판정은-어댑터-동작으로만-정한다.md` (신규) | 결정 기록 |
| `docs/adr/README.md` | 색인 표 맨 끝 한 줄 추가 |
| `.changeset/record-session-completion-dashboard.md` (신규) | `@mcpeak/dashboard` patch |

`packages/cli/**` · `packages/record/**` · `packages/core/src/types.ts` 는 손대지 않았다.
`git status --short` 는 위 다섯 파일만 보여준다.

## 문안

설계 §5.4 표대로 옮겼다.

- `STATUS_REASON.failed`: `녹화 실행이 실패한 세션입니다. 다시 녹화하세요.`
  → `녹화가 도중에 끊긴 세션입니다. 다시 녹화하세요.`
- `STATUS_REASON.running` 과 `STATUS_LABEL` 은 그대로 두었다.

설계와 다르게 옮긴 곳은 없다. 문자열은 한 글자도 바꾸지 않았다.

주석은 설계가 문자열을 지정하지 않은 자리라 직접 썼다. CLI 의 새 `hint` 전문을 인용하고,
원인이 끊긴 녹화이지 테스트 판정이 아니라는 점(ADR-0094)을 적었다. 기존 주석에 있던 대시는
문장을 나누는 방식으로 풀었고, 새로 쓴 산문에는 대시를 넣지 않았다.

## 검증

| 명령 | 결과 |
|---|---|
| `npx vitest run packages/dashboard/web/tests/replay-view.test.tsx` | `Test Files 1 passed (1)` · `Tests 14 passed (14)` (작업 전 13건에서 1건 증가) |
| `pnpm test` | `Test Files 153 passed (153)` · `Tests 3200 passed, 2 skipped (3202)` |
| `pnpm typecheck --force` | `Tasks: 7 successful, 7 total` · `Cached: 0 cached, 7 total` |
| `pnpm lint` | `Checked 403 files in 96ms. No fixes applied.` |

검사 대상 수를 출력에서 확인했다. 테스트 파일 153개, typecheck 태스크 7개(캐시 0), 린트 403개
파일이며 0건인 항목은 없다.

## 남은 위험

- 이 브랜치는 설계 §6 표 가운데 dashboard 와 docs 몫만 담는다. `packages/cli/src/test-command.ts`
  의 `finish` 인자 고정(§4.1)과 문안 §5.1 · §5.2 · §5.3 이 아직 없으므로, 지금 상태로는
  화면 문구만 새 규칙을 말하고 동작과 터미널 문장은 옛 규칙 그대로다. CLI 쪽 태스크와 함께
  머지되어야 사용자가 보는 것이 일관된다.
- 주석이 인용한 `REPLAY_SOURCE_INVALID` 안내 전문은 아직 CLI 에 없는 문자열이다. CLI 태스크가
  설계 §5.2 와 다르게 구현되면 주석이 계약을 잘못 말하게 된다. 통합 시 두 문장을 대조해야 한다.
- ADR-0094 의 상태는 `제안` 이다. 담당이 세 패키지에 걸쳐 있어 승인 주체가 한 명이 아니다.
