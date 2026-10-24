# T2 보고: audit 샌드박스 녹화·재생 비대칭 수정 (2026-10-04)

상태: READY_FOR_REVIEW. 작업 공간 `.claude/worktrees/audit-replay`, 브랜치 `fix/audit-replay`, 기점 `52336ab`.
커밋은 하지 않았다. Docker E2E 는 지시대로 돌리지 않았다.

## 바꾼 파일

| 파일 | 내용 |
|---|---|
| `packages/audit/sandbox/gateway/forward.mjs` (수정, +31 -1) | `handle` 안에 `recordGatewayFailure` 를 더했다. 상류 이름 풀이 실패 catch 와 `upstream.on("error")` 두 자리에서 녹화 모드일 때 고정 문구의 502 를 카세트에 적는다. `note("live")` 와 `reply` 는 그대로다 |
| `packages/audit/tests/forward.test.ts` (신설) | `createForwarder` 를 직접 덮는 테스트가 없어 새로 만들었다. 단언 9개 |
| `packages/cli/tests/audit-sandbox-e2e.test.ts` (수정, +41) | 계획서 §4.3 의 `dockerIt` 블록 하나를 live-weather 녹화·재생 블록 바로 아래에 더했다. 기존 함수와 헬퍼는 건드리지 않았다 |
| `.changeset/audit-replay-unanswered.md` (신설) | `"@mcpeak/audit": patch` |

허용 Files 밖의 수정은 없다. `session.mjs` 와 세션 스키마는 손대지 않았다.

## 검증 결과

| 명령 | 결과 |
|---|---|
| `pnpm --filter @mcpeak/audit build` | Build complete |
| `pnpm --filter @mcpeak/audit test` | 23 파일, 822 통과 (기점 813 에서 9 증가) |
| `pnpm --filter @mcpeak/audit typecheck` | `tsc --noEmit` 오류 없음 |
| `pnpm --filter @mcpeak/cli typecheck` | `tsc --noEmit` 오류 없음 |
| `pnpm lint` | Checked 708 files, 오류 없음 |
| 수정 전 빨강 확인 | `forward.mjs` 를 HEAD 내용으로 되돌려 `forward.test.ts` 만 돌리면 5 실패 4 통과, 수정본으로 복구하면 9 통과 |
| Docker E2E | **돌리지 않았다.** 새 블록은 타입체크와 린트만 통과했다 |

수정 전 빨강인 다섯: 이름 풀이 실패 녹화, 접속 오류 녹화, 두 번 녹화 바이트 동일, 오류 두 번에 한 번만 기록, 클라이언트가 먼저 떠난 요청 기록.
수정 전에도 초록인 넷은 "적지 않는다" 쪽 가드다(blocked·SNI, 답한 뒤의 오류, 부분 응답 뒤 끊김, 녹화 모드 아님).

## `upstream.on("error")` 에 대해 확인한 것

- Node 24.14.1 에서 실측했다. 접속 거부는 `error`(ECONNREFUSED)가 한 번 온다. 응답을 받기 전에 **우리가** `upstream.destroy()` 를 부르면 `error`(ECONNRESET, socket hang up)가 온다.
- Node 의 `socketErrorListener` 는 응답이 시작된 뒤의 소켓 오류도 요청의 `error` 로 낸다. 그래서 계획서 코드를 그대로 넣으면 상류가 이미 답한 요청에 합성 502 가 덧붙을 수 있다.
- 대응: 요청마다 `settled` 깃발을 두었다. `response` 이벤트가 오면 참이 되고, 합성 502 를 한 번 적어도 참이 된다. 참이면 적지 않는다. 그래서 같은 요청에 두 번 적히지 않고, 상류가 답을 시작한 요청에는 덧붙지 않는다. 부분 응답 뒤 끊김은 아무것도 적지 않는다(계획서 범위 밖 그대로).

## 임의로 판단한 부분

1. **우리가 끊은 접속도 적는다.** 클라이언트가 먼저 떠나거나(`response.on("close")` 가 상류를 끊는다) `closeUpstreams()` 가 끊은 요청도, 상류가 응답을 시작하지 않았으면 합성 502 를 한 번 적는다. 계획서 코드의 글자 그대로의 동작이고, 그 요청은 이미 `live` 로 관측됐으므로 카세트에 항목이 있어야 재생이 대칭이 된다. 반대 선택(실제로 502 를 써 보낸 경우만 적기)도 가능했다. 그 경우 타임아웃으로 먼저 끊는 서버에서 `replay-miss` 비대칭이 남는다. 다만 이 경우 녹화 실행의 클라이언트는 502 를 받지 못했고(끊었으므로) 재생에서는 502 를 받는다. 관측과 발견은 같지만 서버가 받는 것은 다르다.
2. **테스트는 `node:http`·`node:https` 의 `request` 를 `vi.mock` 으로 바꿨다.** 소켓을 열지 않고 "답한 뒤의 오류", "오류 두 번" 을 만들려면 가짜 상류가 필요했다. 받는 요청과 내보내는 응답도 `EventEmitter` 가짜다. 기존 state 조립 헬퍼는 없어서 실제 `createState` 를 쓰고 `recorder.record` 에 스파이를 걸었다.
3. **계획서의 단언 넷에 다섯을 더했다.** 답한 뒤의 오류, 부분 응답 뒤 끊김, 오류 두 번, 클라이언트가 먼저 떠남, 녹화 모드가 아닐 때.
4. 네 번째 단언(바이트 동일)은 수정 전에 빈 세션끼리 같아 저절로 통과하므로, 항목 1개와 응답 2개가 쌓였는지도 함께 단언해 수정 전 빨강이 되게 했다.

## 남은 위험

- **Docker E2E 미실행.** G3·C4 는 직렬 게이트에서 확인해야 한다. 예제 표적의 `collect.sandbox-target.example.net` 이 이름 풀이 실패 경로인지 접속 오류 경로인지는 실행으로 확인하지 않았다(둘 다 덮었다).
- **`GET /session` 시점에 아직 진행 중인 요청**(상류가 응답 없이 매달려 있고 오류도 아직 안 난 경우)은 카세트에 없다. 재생에서 `replay-miss` 가 된다. `closeUpstreams()` 는 종료 때만 불려 세션을 읽은 뒤일 수 있다.
- `handle().catch` 의 "요청을 전달하지 못했습니다" 502(본문 읽기 실패 등)는 녹화하지 않는다. 키를 만들기 전에 실패하는 경로라 범위 밖으로 두었다.
- `upstream.on("error")` 안의 `recorder.record` 가 던지면 이벤트 핸들러라 잡히지 않는다. 기존 `answer.on("end")` 의 `record` 호출과 같은 조건이고, 현재 `record` 는 던지는 경로가 없다.
- N2(내부 주소로 풀리는 호스트명)와 부분 응답 뒤 끊김은 계획서대로 그대로 남는다.
- ADR-B 초안은 허용 Files 에 없어 만들지 않았다.
