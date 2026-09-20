# 핸드오프 — 4 단계 화면, 설계 끝 · 계획서부터

새 세션은 여기부터. 2026-09-21 작성.

## 0. 지금 어디인가

`superpowers:brainstorming` 으로 4 단계 설계를 **끝냈다.** 확정본은
`docs/superpowers/specs/2026-09-21-dashboard-relay-screen-design.md` 다.

**다음 할 일은 `superpowers:writing-plans` 로 T1(mock) 계획서를 쓰는 것이다.** 코드는 한 줄도
안 바꿨다. 설계 문서 §4 의 타입 시그니처와 §6 의 테스트 목록이 계획서의 재료다.

전 세션 핸드오프(`2026-09-20-dashboard-relay-handoff.md`)는 여전히 유효하다 — 저장소 상태와
중계기 계약(§3)은 거기가 더 자세하다. **이 문서는 그 뒤에 일어난 것만 담는다.**

## 1. 브레인스토밍에서 결정된 것 아홉

설계 문서 §2 가 전문이다. 요약하면:

1. 질문은 대시보드가 자동 생성한다 (사용자가 적지 않는다).
2. 근거는 고른 스위트의 케이스 (`tool` · `input`).
3. 케이스당 질문 하나 · 프로세스 N 개 · **동시 실행**.
4. 화면은 **케이스별로 나눈다** → 중계기가 케이스 꼬리표를 같이 적어야 한다.
5. 실물 응답은 **중계기가** 싣는다. AI 를 거치지 않는다.
6. 중계기는 자르지 않고 **화면이 접는다.**
7. `generate` 는 `runProviderProcess` 만 export 로 열고, MCP 를 여는 argv 는 대시보드에 둔다.
8. 중계기 전용 통로 셋 (`POST /api/relay` · SSE · `DELETE`). 기존 `/api/runs` 에 안 얹는다.
9. `mock` 이 `relayBinPath()` 로 실행 파일 위치를 내보낸다.

체크박스는 3 단계 실행 옵션에, 화면은 **Stepper 의 4 번째 스텝**으로 들어간다.

## 2. 설계 §4 가 또 틀렸다 — 이번엔 실측으로 고쳤다

전 핸드오프가 `runProviderProcess` 미export 를 잡았다면, 이번엔 **argv 자체**가 틀렸다.

- **`--allowedTools "mcp__target"` 이 없으면 툴을 한 번도 못 부른다.** `system permission_denied`
  가 나고 중계기에 `tools/call` 이 찍히지 않는다. **그런데 종료 코드는 0 이다.** 종료 코드로
  성공을 판정하면 안 된다.
- **`structuredContent` 는 AI 쪽으로 오지 않는다.** `convert_units`(결함 A)가 중계기 기준
  174 바이트인데 `tool_result` 로 온 것은 `content` 텍스트 49 자뿐. `tool_result.content` 의
  모양도 블록 배열/맨 문자열로 흔들린다. **이 실측 하나가 설계를 바꿨다** — 그래서 본문을
  중계기가 싣는다.
- **`content` 는 바이트 그대로 온다.** 그건 확인됐다.
- **`claude` 의 MCP 클라이언트는 `outputSchema` 를 검증하지 않는다.** 결함 A 가 `-32602` 없이
  `ok:true` 로 지나갔다.
- **프롬프트는 argv 가 아니라 stdin 이다** (`providers.ts:319-328` 의 `-p` 는 값을 안 받는다).

재현 스크립트는 남기지 않았다. 다시 재려면 `packages/mock/dist/relay.mjs` 를 `--json --port 0`
으로 띄워 기동 줄에서 URL 을 읽고, 그 URL 로 `--mcp-config` 를 만들어 `claude -p` 를
`--output-format stream-json --verbose` 로 돌린 뒤 `tool_result` 블록을 보면 된다.

## 3. 중계기에는 세션 개념이 없다

`relay-server.ts:155-157` 이 stateless 다 — `sessionIdGenerator: undefined`, 요청마다 새
transport. **접속을 구분할 식별자가 없다.** 동시 실행에서 케이스를 가르려면 다른 축이 필요했고,
경로·쿼리를 보지 않고 넘긴다는 점을 이용한다 — `?case=<id>` 를 붙여도 HTTP 200 으로 정상
동작하는 것을 확인했다.

즉 **꼬리표는 URL 로 나르고, 중계기가 `req.url` 에서 읽어 기록 줄에 싣는다.**

## 4. 태스크 셋 · 사이에 사람의 SHA

**한 번에 한 패키지.** 설계 문서 §7 이 전문이다.

| | 패키지 | 무엇 | 테스트 |
|---|---|---|---|
| T1 | mock | `body` · 케이스 꼬리표 · `relayBinPath()` · **ADR-B** | 1–6 |
| T2 | generate | export 한 줄 · **ADR-A** | — |
| T3 | dashboard | 통로 셋 · 화면 | 7–12 |

**T1 부터다.** 남의 패키지 수정은 오너 허락을 받아 뒀다(전 핸드오프 §5, 사용자 확인).

## 5. 계획 단계에서 **실측해야** 할 것 둘

추측하지 말고 확인해라. 이 문서의 §2 가 그렇게 해서 나왔다.

- **`relayBinPath()` 를 어떻게 구현하나.** tsdown 이 `.mjs` · `.cjs` 를 둘 다 낸다.
  `import.meta.url` 은 cjs 에서 안 된다. 두 산출물에서 다 도는 방법을 실제로 확인해라.
- **`--tools ""` 를 유지할 수 있나.** 내장 도구를 끈 채로 MCP 툴이 살아 있는지 확인하지
  않았다. 탐침에서 AI 가 내장 도구를 한 번 썼다.

## 6. 함정 — 전 핸드오프에서 아직 유효한 것

- **로컬 `main` 이 `origin/main` 대비 ahead 19 / behind 2.** 리베이스가 먼저이고, 그때
  ADR 번호가 origin 쪽과 겹치는지 확인해야 한다. **ADR-A · ADR-B 의 번호는 리베이스 뒤에 딴다.**
- **`packages/mock/tests/stdio-e2e.test.ts` 가 미커밋 상태다.** #418 관련 주석 5 줄이고
  사용자 것이다. **커밋 범위에 넣지 마라.**
- **대시보드 web 테스트 81 건이 이미 깨져 있다**(jsdom `localStorage.clear`). 당신이 깬 것이
  아니다. 다만 T3 시작 전에 기준선을 한 번 찍어 둬라.
- **`pnpm build` 성공이 최신 `dist` 를 뜻하지 않는다.** turbo 캐시. 고친 심볼을 `dist` 에서
  grep 해라.
- **회귀 테스트는 수정을 빼고 한 번 돌려 실패하는 것을 봐라.** 특히 테스트 10(닫기 순서)과
  11(호출 없음) — 둘 다 "아무것도 검증하지 않는 테스트" 가 되기 쉬운 모양이다.
- **종료 코드 0 이 성공이 아니다**(§2). 툴을 불렀는지는 중계기 기록 줄로 판정한다.

## 7. 착수 순서

1. `git fetch` 로 격차를 먼저 본다.
2. 설계 문서 `2026-09-21-dashboard-relay-screen-design.md` 를 읽는다. §3(실측)과 §4(계약)가 핵심.
3. `superpowers:writing-plans` 로 **T1 계획서**를 쓴다.
4. §5 의 실측 둘을 계획서 안에서 닫는다.
5. 구현 전에 타입 시그니처와 테스트를 제시하고 확인받는다.

**규칙은 `CLAUDE.md` 와 `CLAUDE.local.md` 가 전부다. 커밋·푸시는 사람이 한다.**
