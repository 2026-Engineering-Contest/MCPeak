# Core Streamable HTTP transport 구현 계획 (2026-08-14)

- 설계 문서: `docs/superpowers/specs/2026-08-14-core-streamable-http-transport-design.md`
- 선행 결정: `docs/adr/0020-streamable-http-transport.md`
- 대상 패키지: `packages/core` 단독 (그 밖에는 `docs/` 와 `.changeset/` 만)
- 해결 이슈: [#16](https://github.com/2026-Engineering-Contest/OhMyMCP/issues/16)

## 1. 실행 모델

이 세션은 오케스트레이터다. 구현과 테스트는 서브에이전트가 worktree 안에서 실행하고, 이 세션은
스폰 · 리뷰 · 통합 게이트만 한다. 모델 배분은 `CLAUDE.local.md` 의 표를 따른다(§6).

커밋 · 푸시는 사람이 한다. 서브에이전트는 git 명령을 실행하지 않는다. 단 worktree 생성은
프롬프트 1단계에서 에이전트가 직접 한다.

## 2. 목표와 완료 조건

설계 문서 §1 을 그대로 쓴다. 통합 게이트에서 판정하는 항목만 다시 적는다.

- `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm build` 전부 통과하고, 각 출력의 검사
  파일 수가 0 이 아님
- 설계 문서 §12 의 테스트 케이스 22 개가 전부 존재하고 통과
- `connect({ url })` 이 실제 인프로세스 HTTP MCP 서버에서 `listTools` · `callTool` 을 수행
- HTTP 경로에서 `PROCESS_START_FAILED` · `PROCESS_EXITED` · `TRANSPORT_FAILED` 가 한 번도
  발생하지 않음 (§12.4 의 12번)
- 같은 실패를 두 번 일으킨 `JSON.stringify(error.toJSON())` 두 값이 문자열로 동일
  (§12.5 의 19 · 20번)
- `packages/core` 밖의 소스 변경 0 건. `packages/core/src/types.ts` 변경 0 건
- `package.json` 의 `@modelcontextprotocol/sdk` 항목 변경 0 건
- `docs/adr/0020-streamable-http-transport.md` 의 상태가 `제안` 이고 색인과 일치

## 3. 공유 계약 (전량, H1 이 만들고 이후 수정 금지)

H3 이 여기에 의존한다. 본문은 설계 문서 §7.2 · §8.2 · §8.3 에 전량으로 있다. 여기서는 파일
배치와 태스크 경계만 정한다.

### 3.1 H1 이 만드는 것

```
packages/core/src/diagnostics.ts   McpHttpDiagnostics, McpDiagnostics, createHttpDiagnosticsSnapshot
packages/core/src/errors.ts        phase "connect", 코드 6종, toJSON transport 분기
packages/core/src/client.ts        진단 타입 확장, OperationFailureKind 에 "httpSession" 추가
```

`createDiagnosticsSnapshot` 은 `transport: "stdio"` 를 붙여 반환하도록 고친다. 이 한 줄이
기존 stdio 테스트의 `toEqual` 단언을 깨뜨리므로 **H1 이 그 수리까지 소유한다** (설계 문서
§12.6).

### 3.2 태스크 경계 중 헷갈리는 두 지점

**오류 매핑을 둘로 나눈다.** 같은 파일을 두 태스크가 만지지 않게 하기 위한 분할이다.

| 무엇 | 어디 | 누구 |
|---|---|---|
| `OperationFailureKind` 값에서 오류 코드로 가는 매핑 (`"httpSession"` → `HTTP_SESSION_LOST`) | `client.ts` | H1 |
| SDK 오류에서 `OperationFailureKind` 로 가는 판정 (404 이고 sessionId 가 있으면 `"httpSession"`) | `http-transport.ts` | H3 |
| SDK 오류에서 연결 단계 오류 코드로 가는 매핑 (설계 문서 §8.3 의 6단계) | `http-transport.ts` | H3 |

**`src/index.ts` 는 H3 단독 소유다.** H1 · H2 는 열지 않는다. 테스트가 `../src/<모듈>.js` 를
직접 import 하므로(`packages/core/tests/options.test.ts:2` 등) H1 · H2 의 테스트는 index 의
export 없이도 돈다.

### 3.3 이름을 바꾸지 않는 것

`resolveConnectOptions` 는 이름 그대로 두고 매개변수 타입만 `StdioConnectOptions` 로 좁힌다.
호출부가 `src/index.ts`(H3) 와 `tests/lifecycle.test.ts`(무주공산) 에 흩어져 있어 개명하면 태스크
경계를 가로지른다. 설계 문서 §5.1 에 근거가 있다.

## 4. 태스크

### Task H1 — 진단 유니온과 오류 코드

**목표.** 설계 문서 §7.2 · §8.1 · §8.2 · §8.4 를 구현하고, 그로 인해 깨지는 기존 stdio 단언을
수리한다.

**Files (수정).**
```
packages/core/src/diagnostics.ts
packages/core/src/errors.ts
packages/core/src/client.ts
packages/core/tests/diagnostics.test.ts
packages/core/tests/errors.test.ts
packages/core/tests/client.test.ts          (진단 리터럴에 transport 추가가 필요한 경우만)
packages/core/tests/index.test.ts           (같은 이유일 때만)
packages/core/tests/stdio-integration.test.ts (같은 이유일 때만)
packages/core/tests/lifecycle.test.ts       (같은 이유일 때만)
```

**입력 계약.** 설계 문서 §7.2 의 타입 전량, §8.2 의 표 6행, §8.4 의 키 목록.

**산출 계약.**
- `McpHttpDiagnostics` · `McpDiagnostics` · `createHttpDiagnosticsSnapshot` 을
  `src/diagnostics.js` 에서 import 가능
- `McpClientErrorPhase` 에 `"connect"` 포함, `McpClientErrorCode` 가 17종
- `McpClientError.diagnostics` 타입이 `McpDiagnostics`
- `OperationFailureKind` 가 `"process" | "transport" | "httpSession" | undefined`
- `createMcpClientAdapter` 의 `operationFailureKind` 가 `"httpSession"` 을 반환하면
  `HTTP_SESSION_LOST` 오류가 나온다

**테스트.** 설계 문서 §12.2 전량, §12.3 전량, §12.6.

**표적 검증.** `pnpm test packages/core`
**회귀 검증.** `pnpm typecheck`, `pnpm lint`

**보고서.** `docs/reports/task-h1-core-http-transport.md`

**경계.** 오류 문장을 설계 문서 §8.2 표와 한 글자도 다르게 쓰지 않는다. 더 나은 문안이 떠오르면
적용하지 말고 보고서에 제안으로 적는다. 이 문장은 CLI 가 그대로 사용자에게 보여 준다.
`src/index.ts` · `src/options.ts` · `src/http-transport.ts` 를 열지 않는다. 기존 stdio 단언을
느슨하게(`toMatchObject`) 바꿔서 통과시키지 않는다. 정확히 `transport: "stdio"` 를 더한다.

---

### Task H2 — HTTP 옵션 검증

**목표.** 설계 문서 §5 전량을 구현한다.

**Files (수정).**
```
packages/core/src/options.ts
packages/core/tests/options.test.ts
```

**입력 계약.** 설계 문서 §5.1 의 타입 전량, §5.2 의 분기 규칙, §5.3 의 URL 규칙 표 4행,
§5.4 의 헤더 규칙 표 3행과 소문자 정규화 · 중복 키 규칙, §5.5.

**산출 계약.** `HttpConnectOptions` · `ResolvedHttpConnectOptions` · `isHttpConnectOptions` ·
`resolveHttpConnectOptions` 를 `src/options.js` 에서 import 가능. `ConnectOptions` 가
`StdioConnectOptions | HttpConnectOptions` 유니온. `resolveConnectOptions` 의 동작은 stdio
입력에 대해 기존과 완전히 동일.

**테스트.** 설계 문서 §12.1 전량.

**표적 검증.** `pnpm test packages/core`
**회귀 검증.** `pnpm lint`

`pnpm typecheck` 는 **H2 단독 게이트에서 뺀다.** 설계 §5.1 이 요구하는 두 가지, 즉
`ConnectOptions` 를 유니온으로 만드는 것과 `resolveConnectOptions` 의 매개변수를
`StdioConnectOptions` 로 좁히는 것을 함께 하면 `src/index.ts:25` 의
`connectStdio(options: ConnectOptions)` 호출이 반드시 깨진다. 그 파일은 H3 단독 소유라
H2 가 고칠 수 없다. H2 브랜치 단독으로 녹색을 만들 방법이 없으므로 typecheck 는 H3 통합
후 통합 브랜치에서 한 번에 판정한다. H1 도 같은 이유로 걸릴 수 있으면 동일하게 다룬다.

**보고서.** `docs/reports/task-h2-core-http-transport.md`

**경계.** `src/index.ts` 를 열지 않는다. `resolveConnectOptions` 를 개명하지 않는다(§3.3).
`McpClientError` 를 import 하지 않는다. 옵션 검증은 소켓을 열기 전에 끝나므로 진단이 없고,
`TypeError` · `RangeError` 만 던진다. 이것은 기존 stdio 옵션 검증과 같은 규칙이다.

---

### Task H3 — HTTP transport 연결

**목표.** 설계 문서 §4 · §6 · §8.3 · §9 · §10 을 구현하고 통합 테스트를 붙인다.

**선행.** H1 · H2 의 통합 SHA 가 대장에 있고 현재 HEAD 의 조상이어야 한다.

**Files (생성).**
```
packages/core/src/http-transport.ts
packages/core/tests/fixtures/http-server.ts
packages/core/tests/http-integration.test.ts
```
**Files (수정).**
```
packages/core/src/index.ts
```

**입력 계약.** H1 이 만든 진단 · 오류 계약, H2 가 만든 옵션 계약. 설계 문서 §3.3 의 SDK 실측.

**산출 계약.** `connectHttp(options: HttpConnectOptions): Promise<McpHttpConnection>` 와
`connect(options: ConnectOptions): Promise<McpClient>` 가 `@ohmymcp-hsu/core` 에서 import 가능.
`connect` 의 반환 타입은 `Promise<McpClient>` 그대로. `McpHttpConnection` ·
`McpHttpDiagnostics` · `McpDiagnostics` 타입 재수출.

**테스트.** 설계 문서 §12.0 의 fixture 두 개, §12.4 의 18 케이스, §12.5 의 3 케이스.

**표적 검증.** `pnpm test packages/core`
**회귀 검증.** `pnpm typecheck`, `pnpm lint`, `pnpm build`

**보고서.** `docs/reports/task-h3-core-http-transport.md`

**경계.**
- `src/lifecycle.ts` 와 `src/controlled-stdio.ts` 를 한 줄도 고치지 않는다. HTTP 경로는 프로세스
  수명주기 코드를 재사용하지 않는다(설계 문서 §13).
- `connectStdio` 의 시그니처와 동작을 바꾸지 않는다.
- H1 이 만든 오류 문장과 진단 타입을 고치지 않는다. 부족하면 고치지 말고 `BLOCKED` 로 보고한다.
- `reconnectionOptions` 를 설계 문서 §6 의 값 그대로 넣는다. SDK 기본값에 맡기지 않는다.
- `McpHttpConnection` 에 `forceClose` 를 만들지 않는다(설계 문서 §9).
- 테스트 서버는 `127.0.0.1` 과 포트 `0` 으로만 띄운다. 고정 포트를 쓰지 않는다. 외부 네트워크에
  접근하지 않는다.
- `packages/mock` 을 import 하지 않는다. 의존 방향 역전이다.

---

### Task H4 — 문서와 changeset

**목표.** 설계 결정을 저장소 문서에 반영한다. 코드는 건드리지 않는다.

**Files (수정).**
```
docs/adr/0020-streamable-http-transport.md   상태를 초안에서 제안으로
docs/adr/README.md                            색인 행의 상태를 제안으로
docs/architecture.md                          2절 표의 core 입력 칸
packages/core/README.md                       HTTP 연결 사용법 절 추가
```
**Files (생성).**
```
.changeset/core-streamable-http.md
```

**입력 계약.** 설계 문서 §14, ADR-0020 의 결정 절.

**산출 계약.**
- `docs/architecture.md` 2절 표의 `core` 입력 칸이
  `ConnectOptions (command·args·env·cwd 또는 url·headers)`
- `packages/core/README.md` 에 `connect({ url })` 예제와 "OAuth 미지원 · 재연결 미지원" 한 줄
- changeset 은 `@ohmymcp-hsu/core` 의 `minor` 이고 본문이 한국어 한 문단

**표적 검증.** `pnpm lint`
**회귀 검증.** 없음. 코드 변경이 없다.

**보고서.** `docs/reports/task-h4-core-http-transport.md`

**경계.** ADR-0001 을 수정하지 않는다. 승인된 결정이고, 이번 ADR 이 그것이 예고한 후속이다.
`docs/adr/README.md` 의 번호 충돌 경고 문단을 건드리지 않는다. 이 ADR 은 0019 로 시작했다가
JUnit 리포터 ADR 이 먼저 main 에 들어오면서 0020 으로 한 번 밀렸다. 머지 시점에 또 밀리면 이
태스크가 아니라 통합 게이트에서 재번호한다.
코드 파일을 열지 않는다.

## 5. 의존성과 웨이브

```
H1 (진단·오류 계약) ─┐
H2 (옵션 검증)      ─┴─→ H3 (transport 연결)
H4 (문서)  독립
```

| 웨이브 | 태스크 | 터미널 수 | 이유 |
|---|---|---|---|
| 1 | H1 · H2 · H4 | 3 | 쓰기 파일이 겹치지 않는다 |
| 2 | H3 | 1 | H1 의 진단 · 오류 계약과 H2 의 옵션 계약을 둘 다 쓴다 |

웨이브 1 의 파일 소유권은 다음과 같이 갈린다. 교집합이 없다.

| 태스크 | src | tests | docs |
|---|---|---|---|
| H1 | `diagnostics.ts` · `errors.ts` · `client.ts` | `diagnostics` · `errors` · `client` · `index` · `stdio-integration` · `lifecycle` 중 깨진 것 | 없음 |
| H2 | `options.ts` | `options` | 없음 |
| H4 | 없음 | 없음 | ADR · README · architecture · changeset |

H1 이 `tests/options.test.ts` 를 열 일은 없다. 그 파일은 진단을 쓰지 않는다. H2 가
`tests/lifecycle.test.ts` 를 열 일도 없다. `resolveConnectOptions` 를 개명하지 않기 때문이다
(§3.3). 이 두 문장이 성립하지 않는 상황이 발견되면 그 태스크는 `BLOCKED` 로 보고한다.

E2E 와 실환경 검증은 없다. 모든 테스트가 `127.0.0.1` 인프로세스 서버이므로 직렬 웨이브가 필요
없다. 다만 포트를 `0` 으로 받는다는 조건이 붙는다(§4 H3 경계).

## 6. 모델 배분

`CLAUDE.local.md` 의 표를 따른다.

| 태스크 | 모델 | 추론 수준 | 근거 |
|---|---|---|---|
| 오케스트레이터 (이 세션) | 상위 | 높음 | 리뷰 · 머지 게이트 |
| H1 | **상위** | 높음 | 예외 항목 "실패 메시지 문안 설계". 오류 문장 6종이 곧 제품이고 CLI 가 그대로 출력한다 |
| H2 | 표준 | 보통 | 검증 규칙과 오류 문구가 설계 문서 §5 에 표로 전량 적혀 있다 |
| H3 | **상위** | 높음 | 예외 항목 "목 서버 프로토콜 준수" 와 "재생 결정론성" 에 준한다. SDK 오류 6단계 판정과 재연결 · 세션 종료 정책은 실패 모드를 직접 관찰하며 맞춰야 한다 |
| H4 | 표준 | 보통 | 판단은 설계 문서와 ADR 에서 이미 내렸다. 옮겨 적는 작업이다 |

## 7. 사람 몫 사전 조건

터미널을 열기 전에 프로젝트 루트에서 두 줄만 확인한다.

```bash
git log --oneline -1        # main 이고 설계 문서 커밋이 들어가 있어야 한다
git status --short          # 비어 있어야 한다
```

아래 세 파일이 **`main` 에 커밋돼 있어야 한다.** untracked 면 새 worktree 에 안 따라간다.

```
docs/superpowers/specs/2026-08-14-core-streamable-http-transport-design.md
docs/superpowers/plans/2026-08-14-core-streamable-http-transport-implementation.md
docs/adr/0020-streamable-http-transport.md
```

프롬프트는 기점을 SHA 가 아니라 `main` 으로 적는다. 커밋 직후 SHA 가 바뀌므로 계획서에 SHA 를
박아두면 반드시 낡는다. 대신 프롬프트 1단계에서 설계 문서 존재를 직접 확인시킨다.

## 8. 실행 프롬프트

각 블록은 단독 실행 단위다. 프로젝트 루트에서 터미널을 열고 그대로 붙여넣는다.

### 8.1 웨이브 1 / Task H1

권장 실행 설정: 모델 **상위 모델(Opus)**, 추론 수준 **높음**, 에이전트 종류 일반 구현 에이전트.

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.
  git worktree add .claude/worktrees/ohmymcp-h1-core-http -b feat/core-http-diagnostics main
를 실행한 뒤 그 경로로 세션을 옮겨라.
진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 status: BLOCKED 로 보고해라:
  - pwd 가 .claude/worktrees/ohmymcp-h1-core-http 로 끝나는지
  - git log --oneline -1 이 루트의 main HEAD 와 같은지
  - docs/superpowers/specs/2026-08-14-core-streamable-http-transport-design.md 가 존재하는지
  - docs/superpowers/plans/2026-08-14-core-streamable-http-transport-implementation.md 가 존재하는지
  - git status --short 가 비어 있는지
그다음 부트스트랩을 해라. 새 worktree 는 node_modules 를 상속하지 않는다.
  pnpm install
  pnpm build
그리고 pnpm test packages/core 가 실제로 실행되는지 확인해라(기존 테스트가 통과해야 한다).
출력에 "Test Files ... passed" 줄이 있는지 눈으로 봐라. 실행 자체가 안 되면
status: BLOCKED 로 보고하고 멈춰라.

[2단계: 실행] Task H1 — 진단 유니온과 오류 코드

설계 문서 docs/superpowers/specs/2026-08-14-core-streamable-http-transport-design.md 와
구현 계획 docs/superpowers/plans/2026-08-14-core-streamable-http-transport-implementation.md 를
먼저 읽어라. 설계 문서 §7.2 · §8.1 · §8.2 · §8.4 · §12.2 · §12.3 · §12.6 이 네 담당 범위다.

수정할 것:
  packages/core/src/diagnostics.ts  McpHttpDiagnostics, McpDiagnostics,
                                    createHttpDiagnosticsSnapshot 추가.
                                    createDiagnosticsSnapshot 이 transport: "stdio" 를 붙이게 한다
  packages/core/src/errors.ts       phase "connect" 추가, 설계 문서 §8.2 표의 코드 6 종 추가,
                                    toJSON 을 transport 별로 분기 (§8.4 의 키 목록 그대로)
  packages/core/src/client.ts       diagnostics 콜백 타입을 McpDiagnostics 로 넓히고,
                                    OperationFailureKind 에 "httpSession" 을 더해
                                    HTTP_SESSION_LOST 로 매핑
  packages/core/tests/diagnostics.test.ts  설계 문서 §12.2 케이스 추가
  packages/core/tests/errors.test.ts       설계 문서 §12.3 케이스 추가
  그리고 transport: "stdio" 가 붙어서 깨지는 기존 단언만 수리해라 (§12.6).
  대상 후보는 tests/client.test.ts, tests/index.test.ts, tests/stdio-integration.test.ts,
  tests/lifecycle.test.ts 다. 실제로 깨진 것만 고쳐라.

절대 열지 마라:
  packages/core/src/index.ts        (Task H3 소유)
  packages/core/src/options.ts      (Task H2 소유)
  packages/core/tests/options.test.ts (Task H2 소유)
  packages/core/src/lifecycle.ts, packages/core/src/controlled-stdio.ts
  packages/core/src/types.ts        (동결 계약)
다른 패키지, 루트 빌드 설정, package.json 도 건드리지 마라. 수정이 필요해 보이면 고치지 말고
status: BLOCKED 로 보고해라.
의존 방향은 단방향이다(cli → runner/generate/record/mock → core). 역참조·순환 금지.
@modelcontextprotocol/sdk 는 1.x 고정이고 목록 밖 의존성 추가 금지다.

오류 문장 규칙: 설계 문서 §8.2 표의 message 와 hint 를 한 글자도 다르게 쓰지 마라. 더 나은
문안이 떠올라도 적용하지 말고 보고서에 제안으로만 적어라. CLI 가 이 문장을 그대로 사용자에게
보여 준다. 신규 6 종의 문장에 stdio, stdout, process, exit 라는 단어가 들어가면 안 된다.

깨진 stdio 단언을 toMatchObject 로 느슨하게 바꿔서 통과시키지 마라. 정확히
transport: "stdio" 를 더해서 고쳐라.

검증:
  pnpm test packages/core
  pnpm typecheck
  pnpm lint
세 명령의 출력에서 검사한 파일 수가 0 이 아닌지 눈으로 확인해라. 0 이면 통과가 아니다.

보고서를 docs/reports/task-h1-core-http-transport.md 에 써라. 변경 파일 목록,
git status --short 결과, 실행한 검증 명령과 출력 요약, 임의로 판단한 지점, 남은 위험을 담아라.
어떤 기존 테스트가 왜 깨졌고 어떻게 고쳤는지 파일별로 적어라.

금지: 백그라운드 실행, git commit, git merge, git push, 하위 에이전트 스폰,
다른 작업자의 변경 되돌리기.
최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작하고 변경 파일,
검증 명령과 결과, 보고서 경로, 남은 위험을 포함해라.
```

### 8.2 웨이브 1 / Task H2

권장 실행 설정: 모델 **표준 모델(Sonnet)**, 추론 수준 **보통**, 에이전트 종류 일반 구현 에이전트.

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.
  git worktree add .claude/worktrees/ohmymcp-h2-core-http -b feat/core-http-options main
를 실행한 뒤 그 경로로 세션을 옮겨라.
진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 status: BLOCKED 로 보고해라:
  - pwd 가 .claude/worktrees/ohmymcp-h2-core-http 로 끝나는지
  - git log --oneline -1 이 루트의 main HEAD 와 같은지
  - docs/superpowers/specs/2026-08-14-core-streamable-http-transport-design.md 가 존재하는지
  - docs/superpowers/plans/2026-08-14-core-streamable-http-transport-implementation.md 가 존재하는지
  - git status --short 가 비어 있는지
그다음 부트스트랩을 해라. 새 worktree 는 node_modules 를 상속하지 않는다.
  pnpm install
  pnpm build
그리고 pnpm test packages/core 가 실제로 실행되는지 확인해라(기존 테스트가 통과해야 한다).
출력에 "Test Files ... passed" 줄이 있는지 눈으로 봐라. 실행 자체가 안 되면
status: BLOCKED 로 보고하고 멈춰라.

[2단계: 실행] Task H2 — HTTP 옵션 검증

설계 문서 docs/superpowers/specs/2026-08-14-core-streamable-http-transport-design.md 와
구현 계획 docs/superpowers/plans/2026-08-14-core-streamable-http-transport-implementation.md 를
먼저 읽어라. 설계 문서 §5 전량과 §12.1 이 네 담당 범위다.

수정할 것:
  packages/core/src/options.ts        설계 문서 §5.1 의 타입 전량, §5.2 의 분기,
                                      §5.3 의 URL 규칙 4 행, §5.4 의 헤더 규칙 3 행과
                                      소문자 정규화·중복 키 규칙, §5.5 의 기본값
  packages/core/tests/options.test.ts 설계 문서 §12.1 케이스 전량 추가

resolveConnectOptions 의 이름을 바꾸지 마라. 매개변수 타입만 StdioConnectOptions 로 좁혀라.
개명하면 packages/core/src/index.ts 와 packages/core/tests/lifecycle.test.ts 를 함께 고쳐야
하는데 둘 다 네 파일이 아니다. 근거는 설계 문서 §5.1 에 있다.
기존 stdio 옵션 검증의 동작은 한 케이스도 바뀌면 안 된다. 기존 테스트가 전부 그대로 통과해야
한다.

절대 열지 마라:
  packages/core/src/index.ts          (Task H3 소유)
  packages/core/src/diagnostics.ts, errors.ts, client.ts  (Task H1 소유)
  packages/core/tests/lifecycle.test.ts
  packages/core/src/types.ts          (동결 계약)
다른 패키지, 루트 빌드 설정, package.json 도 건드리지 마라. 수정이 필요해 보이면 고치지 말고
status: BLOCKED 로 보고해라.
McpClientError 를 import 하지 마라. 옵션 검증은 소켓을 열기 전에 끝나므로 진단이 없다.
TypeError 와 RangeError 만 던진다. 기존 stdio 검증과 같은 규칙이다.
의존 방향은 단방향이다(cli → runner/generate/record/mock → core). 역참조·순환 금지.
@modelcontextprotocol/sdk 는 1.x 고정이고 목록 밖 의존성 추가 금지다.

비밀값 규칙: 헤더 값을 오류 메시지에 넣지 마라. 키 이름까지만 넣는다. 설계 문서 §11 이다.
§12.1 에 이걸 검증하는 케이스가 있다.

검증:
  pnpm test packages/core
  pnpm typecheck
  pnpm lint
세 명령의 출력에서 검사한 파일 수가 0 이 아닌지 눈으로 확인해라. 0 이면 통과가 아니다.

보고서를 docs/reports/task-h2-core-http-transport.md 에 써라. 변경 파일 목록,
git status --short 결과, 실행한 검증 명령과 출력 요약, 임의로 판단한 지점, 남은 위험을 담아라.

금지: 백그라운드 실행, git commit, git merge, git push, 하위 에이전트 스폰,
다른 작업자의 변경 되돌리기.
최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작하고 변경 파일,
검증 명령과 결과, 보고서 경로, 남은 위험을 포함해라.
```

### 8.3 웨이브 1 / Task H4

권장 실행 설정: 모델 **표준 모델(Sonnet)**, 추론 수준 **보통**, 에이전트 종류 일반 구현 에이전트.

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.
  git worktree add .claude/worktrees/ohmymcp-h4-core-http -b docs/core-http-transport main
를 실행한 뒤 그 경로로 세션을 옮겨라.
진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 status: BLOCKED 로 보고해라:
  - pwd 가 .claude/worktrees/ohmymcp-h4-core-http 로 끝나는지
  - git log --oneline -1 이 루트의 main HEAD 와 같은지
  - docs/superpowers/specs/2026-08-14-core-streamable-http-transport-design.md 가 존재하는지
  - docs/adr/0020-streamable-http-transport.md 가 존재하는지
  - git status --short 가 비어 있는지
부트스트랩은 pnpm install 까지만 해라. 이 태스크는 코드를 건드리지 않으므로 빌드가 필요 없다.
pnpm lint 가 실행되는지만 확인해라. 안 되면 status: BLOCKED 로 보고하고 멈춰라.

[2단계: 실행] Task H4 — 문서와 changeset

설계 문서 docs/superpowers/specs/2026-08-14-core-streamable-http-transport-design.md §14 와
docs/adr/0020-streamable-http-transport.md 의 결정 절을 먼저 읽어라.

수정할 것:
  docs/adr/0020-streamable-http-transport.md  머리의 상태를 "초안" 에서 "제안" 으로
  docs/adr/README.md                          0020 행의 상태를 "초안" 에서 "제안" 으로
  docs/architecture.md                        2 절 표의 core 입력 칸을
                                              ConnectOptions (command·args·env·cwd 또는 url·headers)
                                              로 바꾼다
  packages/core/README.md                     connect({ url }) 사용 예제 절 추가.
                                              OAuth 미지원과 재연결 미지원을 한 줄로 명시한다
만들 것:
  .changeset/core-streamable-http.md          @ohmymcp-hsu/core 의 minor.
                                              본문은 한국어 한 문단

절대 하지 마라:
  - docs/adr/0001-transport-strategy.md 수정. 승인된 결정이고 이번 ADR 이 그것이 예고한 후속이다
  - docs/adr/README.md 의 번호 충돌 경고 문단 수정. 0020 행의 상태 한 칸만 고친다
  - 코드 파일(.ts) 열기. 이 태스크는 문서 전용이다
  - 다른 ADR, 다른 패키지 README 수정

문서 산문에 대시(—) 기호를 쓰지 마라. 문장을 나누거나 쉼표·괄호로 풀어 써라.

검증:
  pnpm lint
출력에서 검사한 파일 수가 0 이 아닌지 확인해라.

보고서를 docs/reports/task-h4-core-http-transport.md 에 써라. 변경 파일 목록,
git status --short 결과, 임의로 판단한 지점을 담아라.

금지: 백그라운드 실행, git commit, git merge, git push, 하위 에이전트 스폰,
다른 작업자의 변경 되돌리기.
최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작하고 변경 파일,
보고서 경로, 남은 위험을 포함해라.
```

### 8.4 웨이브 2 / Task H3

**H1 과 H2 가 main 에 머지되고 통합 대장에 SHA 가 기록된 뒤에만 이 프롬프트를 실행한다.**

권장 실행 설정: 모델 **상위 모델(Opus)**, 추론 수준 **높음**, 에이전트 종류 일반 구현 에이전트.

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.
  git worktree add .claude/worktrees/ohmymcp-h3-core-http -b feat/core-http-connect main
를 실행한 뒤 그 경로로 세션을 옮겨라.
진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 status: BLOCKED 로 보고해라:
  - pwd 가 .claude/worktrees/ohmymcp-h3-core-http 로 끝나는지
  - git log --oneline -1 이 루트의 main HEAD 와 같은지
  - docs/superpowers/specs/2026-08-14-core-streamable-http-transport-design.md 가 존재하는지
  - packages/core/src/diagnostics.ts 에 McpHttpDiagnostics 가 있는지 (Task H1 결과)
  - packages/core/src/errors.ts 에 HTTP_SESSION_LOST 가 있는지 (Task H1 결과)
  - packages/core/src/options.ts 에 resolveHttpConnectOptions 가 있는지 (Task H2 결과)
  - git status --short 가 비어 있는지
위 세 심볼 중 하나라도 없으면 선행 태스크가 아직 안 들어온 것이다. 만들지 말고
status: BLOCKED 로 보고해라.
그다음 부트스트랩을 해라. 새 worktree 는 node_modules 를 상속하지 않는다.
  pnpm install
  pnpm build
그리고 pnpm test packages/core 가 실제로 실행되는지 확인해라(기존 테스트가 통과해야 한다).
출력에 "Test Files ... passed" 줄이 있는지 눈으로 봐라. 실행 자체가 안 되면
status: BLOCKED 로 보고하고 멈춰라.

[2단계: 실행] Task H3 — HTTP transport 연결

설계 문서 docs/superpowers/specs/2026-08-14-core-streamable-http-transport-design.md 와
구현 계획 docs/superpowers/plans/2026-08-14-core-streamable-http-transport-implementation.md 를
먼저 읽어라. 설계 문서 §3.3 · §4 · §6 · §8.3 · §9 · §10 · §12.0 · §12.4 · §12.5 가 네 담당
범위다.

만들 것:
  packages/core/src/http-transport.ts        StreamableHTTPClientTransport 구성(§6 의
                                             reconnectionOptions 값 그대로), SDK 오류에서
                                             McpClientError 로 가는 §8.3 의 6 단계 매핑,
                                             연결 후 오류를 "httpSession" 으로 판정하는 규칙,
                                             §9 의 close 정책
  packages/core/tests/fixtures/http-server.ts  §12.0 의 startMcpHttpServer 와 startRawServer
  packages/core/tests/http-integration.test.ts §12.4 의 18 케이스와 §12.5 의 3 케이스
수정할 것:
  packages/core/src/index.ts                 connectHttp, McpHttpConnection, connect 분기,
                                             신규 타입 재수출

절대 하지 마라:
  - packages/core/src/lifecycle.ts 와 controlled-stdio.ts 수정. HTTP 는 프로세스 수명주기
    코드를 재사용하지 않는다
  - connectStdio 의 시그니처나 동작 변경
  - packages/core/src/diagnostics.ts, errors.ts, options.ts, client.ts 수정.
    Task H1 · H2 가 만든 계약이다. 부족하면 고치지 말고 status: BLOCKED 로 보고해라
  - packages/core/src/types.ts 수정 (동결 계약)
  - McpHttpConnection 에 forceClose 추가. 죽일 프로세스가 없다 (설계 문서 §9)
  - packages/mock import. 의존 방향 역전이다. 테스트 서버는 SDK 의
    server/mcp.js 와 server/streamableHttp.js 로 직접 만들어라
  - 다른 패키지, 루트 빌드 설정, package.json 수정
@modelcontextprotocol/sdk 는 1.x 고정이고 목록 밖 의존성 추가 금지다.

결정론성 규칙(이 프로젝트의 핵심 가치다):
  - reconnectionOptions 를 설계 문서 §6 의 네 값 그대로 넣어라. maxRetries 는 0 이다.
    SDK 기본값에 맡기면 같은 중단이 실행마다 다른 시각·다른 오류로 관측된다
  - 테스트 서버는 host 127.0.0.1, port 0 으로만 띄워라. 고정 포트 금지, 외부 네트워크 접근 금지
  - 오류 message 는 H1 이 정한 고정 문자열이다. 서버 응답 본문이나 포트 번호를 이어붙이지 마라.
    원본은 cause 에만 남긴다 (설계 문서 §11)
  - §12.5 의 세 케이스가 이 규칙의 판정이다. 통과할 때까지 끝난 게 아니다

비밀값 규칙: 헤더 값을 진단·오류 메시지·toJSON 어디에도 싣지 마라 (설계 문서 §11).

검증:
  pnpm test packages/core
  pnpm typecheck
  pnpm lint
  pnpm build
네 명령의 출력에서 검사한 파일 수가 0 이 아닌지 눈으로 확인해라. 0 이면 통과가 아니다.
pnpm test packages/core 를 두 번 연속 돌려 두 번 다 같은 결과가 나오는지도 확인해라.

보고서를 docs/reports/task-h3-core-http-transport.md 에 써라. 변경 파일 목록,
git status --short 결과, 실행한 검증 명령과 출력 요약, §12.4 · §12.5 케이스 번호별 통과 여부,
임의로 판단한 지점, 남은 위험을 담아라.

금지: 백그라운드 실행, git commit, git merge, git push, 하위 에이전트 스폰,
다른 작업자의 변경 되돌리기.
최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작하고 변경 파일,
검증 명령과 결과, 보고서 경로, 남은 위험을 포함해라.
```

## 9. 통합 게이트

각 태스크 보고를 받으면 이 세션이 아래를 **직접** 확인한다. 자식의 완료 선언은 단서일 뿐이다.

1. 보고서를 읽고 `git -C <worktree> status --short` 로 허용 Files 밖 변경이 있는지 본다
2. `git -C <worktree> diff main --stat` 으로 범위를 확인한다. `packages/core` 밖의 소스,
   `packages/core/src/types.ts`, `package.json`, 루트 설정이 나오면 즉시 반려
3. worktree 에서 `pnpm test packages/core` · `pnpm typecheck` · `pnpm lint` · `pnpm build` 를
   직접 돌리고 검사 파일 수가 0 이 아닌지 본다
4. 설계 문서 §12 의 케이스가 실제로 존재하는지 **이름으로** 대조한다. 개수만 보지 않는다
5. H1 통합 전: 신규 오류 6종의 `message` 와 `hint` 를 설계 문서 §8.2 표와 한 글자씩 대조한다.
   `grep -n "stdio\|stdout\|process\|exit" packages/core/src/errors.ts` 로 신규 6종 문장에 그
   단어가 없는지 확인한다
6. H3 통합 전: `grep -rn "maxRetries" packages/core/src/http-transport.ts` 가 `0` 인지 확인한다.
   SDK 기본값에 맡기면 결정론성이 깨진다
7. H3 통합 전: §12.5 의 결정론성 케이스 3개를 이름으로 확인하고, `pnpm test packages/core` 를
   두 번 돌려 두 결과가 같은지 본다
8. 통과하면 사람에게 머지를 요청하고, 머지 SHA 를 `docs/task-integration-ledger.tsv` 에 아래
   형식으로 기록한다

```
H1-core-http-transport	<sha>	2026-08-14
H2-core-http-transport	<sha>	2026-08-14
H4-core-http-transport	<sha>	2026-08-14
H3-core-http-transport	<sha>	2026-08-14
```

9. 웨이브 2 를 시작하기 전에 H1 과 H2 의 SHA 가 대장에 있고 실제 커밋으로 존재하며 현재 HEAD 의
   조상인지 `git cat-file -e` 와 `git merge-base --is-ancestor` 로 확인한다. **브랜치나
   worktree 가 존재한다는 사실을 완료 근거로 쓰지 않는다**
10. H4 머지 직전에 `docs/adr/` 에 다른 브랜치가 만든 0020 이 들어왔는지 다시 본다. 있으면 이
    ADR 을 다음 빈 번호로 재번호하고 색인, 설계 문서, 이 계획서의 링크를 함께 고친다. 이 ADR 은
    이미 0019 에서 0020 으로 한 번 밀렸고, 저장소 전체로는 네 번째 사고다
    (`docs/adr/README.md`)

전체 통합 후 최종 게이트로 루트에서 `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm build`
를 한 번 더 돌린다.

## 10. 거짓 신호 점검

통합 게이트에서 아래를 의심한다.

| 거짓 신호 | 이 작업에서의 모습 | 진실 기준 |
|---|---|---|
| 테스트 명령이 즉시 exit 0 | `pnpm --filter @ohmymcp-hsu/core test` 는 존재하지 않는 스크립트다. 패키지 `package.json` 에 `test` 가 없어 아무것도 안 하고 성공한다 | 표적 검증은 `pnpm test packages/core`. 출력에 `Test Files ... passed` 줄이 있는지 확인 |
| 타입체크 · 린트 녹색 | 새 파일이 `index.ts` 에서 export 안 돼 검사 대상에서 빠짐 | 검사 파일 수를 출력에서 확인 |
| HTTP 테스트 녹색 | fixture 서버가 MCP 를 흉내만 내고 실제 handshake 를 안 함 | `listTools` 결과가 서버 등록 툴과 이름까지 같은지 (§12.4 의 1번) |
| 실패 케이스 녹색 | 오류가 나긴 나는데 전부 같은 코드(`HTTP_CONNECT_FAILED`)로 뭉개짐 | §12.4 의 7 · 8 · 9 · 10 · 11번이 서로 다른 코드를 단언하는지 이름으로 확인 |
| 재생 테스트가 가끔 실패 | SDK 자동 재연결이 살아 있어 실행마다 타이밍이 다름 | `maxRetries: 0` grep, `pnpm test packages/core` 2회 실행 |
| 진단이 그럴듯해 보임 | HTTP 오류인데 `exitCode` 필드가 `toJSON()` 에 남아 있음 | §12.3 의 키 집합 단언 |
| 포트 충돌로 간헐 실패 | fixture 가 고정 포트를 씀 | `grep -n "listen(" packages/core/tests/fixtures/http-server.ts` 가 `0` 인지 |
| 새 worktree 에서 테스트 타임아웃 | `pnpm install` 누락 | 출력에서 파일 없음 오류와 spawn 경로 확인 |
| 결함이 계속 재현 | 빌드 산출물이 낡음 | `pnpm build` 후 재확인 |

## 11. 롤백 경계

H1 이 반려되면 H3 을 시작하지 않는다. 진단 · 오류 계약이 바뀌면 H3 의 매핑을 처음부터 다시
해야 한다.

H2 가 반려되면 H3 을 시작하지 않는다. `resolveHttpConnectOptions` 없이는 `connectHttp` 가
입력을 받을 수 없다.

H1 과 H2 는 서로 의존하지 않는다. 하나가 반려돼도 다른 하나는 그대로 진행한다.

H4 는 코드에 영향을 주지 않으므로 언제 반려돼도 다른 태스크를 막지 않는다. 다만 H3 머지 전에는
들어가야 changeset 이 릴리스에 잡힌다.

H3 이 반려되면 H1 · H2 · H4 는 그대로 둔다. 그 상태의 `main` 은 stdio 동작이 그대로이고 HTTP
진입점만 없는 상태이므로 사용자에게 보이는 회귀가 없다.
