# 4 단계 — 대시보드에 실제 응답 화면을 붙인다

대상 `@mcpeak/dashboard` (공동 영역) · `@mcpeak/mock` (오너 `@storyrago`) · `@mcpeak/generate` 한 줄.
2026-09-21 확정.

## 0. 이 문서의 상태

확정본이다. `2026-09-16-mock-to-relay-design.md` §7 의 **4 단계**를 여는 설계이고, 그 문서의
§4 「AI 호출 경로」를 **실측으로 고쳐 쓴다**(§3). 구현은 시작하지 않았다.

착수 배경은 `2026-09-20-dashboard-relay-handoff.md` 에 있다. 1 단계(중계기)는 끝났고
2·3 단계(목 소비자 이전 · 목 삭제)는 건너뛴 상태다.

## 1. 하려는 것

대시보드 테스트 흐름의 3 단계 실행 옵션에 체크박스를 하나 넣는다. 문안은
`판정 전에 서버의 실제 응답을 본다`.

켜면 Stepper 에 **4 단계 「실제 응답」**이 붙는다. 이 스텝에 들어서면 서버에서:

1. `mcpeak-relay --json --port 0 --env <이름>… -- <사용자 서버 명령>` 을 띄우고 기동 줄에서
   URL 을 읽는다.
2. 고른 스위트를 읽어 **케이스마다 질문을 하나씩** 짓는다. 재료는 케이스의 `tool` · `input`.
3. 케이스 수만큼 `claude` 를 **동시에** 띄운다. 각자 자기 케이스 꼬리표가 붙은 URL 을 받는다 —
   `http://127.0.0.1:<포트>/mcp?case=<케이스id>`.
4. 중계기가 오간 호출을 케이스 꼬리표와 함께 기록하고, 그 줄이 브라우저로 흐른다.

**화면은 케이스마다 칸 하나다.**

```
┌ get-weather-success ─────────────────── 성공 ┐
│ → get_weather  {"city":"서울"}                │
│ ← 성공 · 97바이트 · 0.0초                      │
│   사람이 읽는 칸  {"city":"서울","temp":21,…} │
│   기계가 읽는 칸  없음                         │
└───────────────────────────────────────────────┘
┌ add-missing-a ───────────────── 호출 없음 ────┐
│ AI 가 이 케이스에서 툴을 부르지 않았습니다.     │
└───────────────────────────────────────────────┘
```

본문이 길면 접어 두고 「더 보기」로 편다. 중계기는 자르지 않고 전부 보낸다.

**「호출 없음」 칸은 필수다.** 실측에서 AI 가 권한에 막혀 툴을 한 번도 안 불렀다(§3). 그때
빈 화면만 나오면 사용자는 자기 서버가 고장난 줄 안다.

**떠날 때 중계기를 닫는다.** `[실행 시작]` 은 **먼저** 중계기를 닫고, 닫힌 것을 확인한 뒤에
판정 실행을 시작한다. `[이전]` 과 화면 이탈도 같다. 안 닫으면 판정 실행이 같은 서버를 두 벌
띄운다(설계 §5 가 4 단계로 미뤄 둔 것).

## 2. 결정된 것

1. **질문은 대시보드가 자동 생성한다.** 사용자는 질문을 적지 않는다.
2. **근거는 고른 스위트의 케이스다.** 툴 목록을 따로 읽지 않는다 — 스위트에 `tool` · `input`
   이 이미 있고, 같은 스위트면 항상 같은 질문이 나온다.
3. **케이스당 질문 하나 · 프로세스 N 개 · 동시 실행.**
4. **화면은 케이스별로 나눈다.** 동시 실행이라 기록 줄이 섞이므로, 중계기가 케이스 꼬리표를
   같이 적는다(§4).
5. **실물 응답은 중계기가 싣는다. AI 를 거치지 않는다.** 근거는 §3 의 실측 — AI 쪽으로는
   `structuredContent` 가 오지 않는다.
6. **중계기는 자르지 않는다. 화면이 접는다.** 관찰 채널의 충실성을 우선한다.
7. **`generate` 는 문만 열어주고 argv 조립은 대시보드가 한다.** `runProviderProcess` 를
   export 로 한 줄 열고, MCP 를 여는 argv 는 대시보드에만 둔다. 이유는 §5.
8. **중계기 전용 통로를 따로 만든다.** 기존 `/api/runs` 에 얹지 않는다 — 중계기는 스스로
   끝나지 않는 유일한 실행이라 「그만」 이라고 말하는 길이 필요하고, 그 길이 run 쪽에는 없다.
9. **`mock` 이 실행 파일 위치를 내보낸다.** 경로를 짐작하지 않고, 의존 경계 테스트를 손대지
   않는다. 설계 §2-6 의 「exports 를 내지 않는다」를 한 칸 연다.

## 3. 실측 — 설계 §4 를 고쳐 쓴다

전부 이 저장소에서 직접 재봤다. 추측이 아니다.

### `--allowedTools` 가 없으면 툴을 한 번도 못 부른다

설계 §4 의 argv 그대로 돌리면 `system permission_denied` 가 나고, 중계기에 `tools/call` 이
찍히지 않는다. AI 는 "권한 승인 대기로 막혔습니다" 라고 답하고 종료 코드는 **0** 이다.
**종료 코드로는 실패를 알 수 없다.**

`--allowedTools "mcp__target"` 을 더하면 통과한다.

### `content` 는 바이트 그대로 온다

`weather-server` 의 `get_weather` 응답 텍스트가 AI 의 `tool_result` 까지 바이트 그대로 왔다.

### `structuredContent` 는 오지 않는다 ← 설계를 바꾼 것

`live-weather-server` 의 `convert_units` 는 중계기 기준 174 바이트인데, AI 의 `tool_result` 로
온 것은 `content` 텍스트 49 자뿐이다. `tool_result.content` 의 모양도 한 번은 블록 배열,
한 번은 맨 문자열로 **고정되어 있지 않다.**

스위트 단언 중 `structuredContentMatchesSchema` 6 건이 보는 값이 그것이라, AI 경유로는
사용자가 자기 서버 답의 반쪽만 본다. **그래서 중계기가 본문을 싣는 쪽으로 갔다.**

덤으로 알게 된 것 — `claude` 의 MCP 클라이언트는 `outputSchema` 를 검증하지 않는다.
결함 A 가 `-32602` 없이 `ok:true` 로 지나갔다. 설계 §4 가 SDK `Client` 브리지를 버린 그
검증은 여기에 없다.

### 중계기에는 세션 개념이 없다

`relay-server.ts:155-157` 이 stateless 다 — `sessionIdGenerator: undefined`, 요청마다 새
transport. **접속을 구분할 식별자가 없다.** 다만 경로·쿼리를 보지 않고 넘기므로
`?case=<id>` 를 붙여도 정상 동작한다(HTTP 200 확인). 케이스 꼬리표를 URL 로 나르는 근거다.

### 프롬프트는 argv 가 아니라 stdin 이다

`providers.ts:319-328` 의 `-p` 는 값을 받지 않고 질문은 `spec.stdin` 으로 간다. 대시보드도
같은 모양을 쓴다.

### 임시 cwd 가 필요한 이유

탐침을 프로젝트 폴더에서 돌렸더니 사용자 훅 6 개가 같이 실행됐다(`system hook_started` × 6).
`runProviderProcess` 의 임시 cwd · 환경변수 allowlist 가 그걸 막는다. 재사용하는 이유다.

## 4. 계약

### T1 · `@mcpeak/mock`

```ts
// relay-log.ts
export type RelayResponseEvent = {
  readonly id: number;
  readonly method: string;
  readonly tool?: string;
  readonly ms: number;
  readonly case?: string;                     // 새 필드
} & (
  | { readonly kind: "ok";            readonly bytes: number; readonly toolCount?: number; readonly body: unknown }
  | { readonly kind: "toolError";     readonly bytes: number; readonly body: unknown }
  | { readonly kind: "protocolError"; readonly code: number;  readonly message: string }
);

export interface RelayRequestEvent {
  readonly id: number;
  readonly method: string;
  readonly tool?: string;
  readonly args?: unknown;
  readonly case?: string;                     // 새 필드
}

/** URL 쿼리의 case 꼬리표. 순수 함수 — 길이·허용 문자 상한을 건다. */
export function readCaseTag(url: string | undefined): string | undefined;

// index.ts
/** 중계기 실행 파일의 절대경로. 대시보드가 spawn 대상으로 쓴다. */
export function relayBinPath(): string;
```

- `body` 는 JSON-RPC `result` **전체**다. `content` 와 `structuredContent` 가 같이 들어 있다.
- `protocolError` 에는 `body` 가 없다 — 서버가 결과를 준 적이 없어 지어낼 것이 없다.
- **사람이 읽는 줄에는 `body` 를 싣지 않는다.** 터미널 한 줄 문안은 지금 그대로 두고 본문은
  `--json` 줄에만 넣는다. 터미널에서 중계기를 쓰는 사람의 화면이 10MB 로 터지면 안 된다.
- `relayBinPath()` 의 구현은 tsdown 의 dual 빌드(`.mjs`/`.cjs`) 제약을 받는다. `import.meta`
  가 cjs 에서 안 되므로 **계획 단계에서 실측해 정한다.**

### T2 · `@mcpeak/generate`

```ts
export { runProviderProcess } from "./provider-process.js";
export { CLAUDE_ENV_ALLOWLIST, CODEX_ENV_ALLOWLIST } from "./providers.js";
```

타입 **7 개**(`ProviderProcessSpec` 등)는 이미 나가 있다. 새 타입 0 개.

> **정정 (2026-09-21, T2 계획 단계).** 처음에 이 절은 `runProviderProcess` 한 줄만 적었다.
> 실측해 보니 **그 함수는 환경변수를 거르지 않는다** — `spec.env` 를 그대로 spawn 에 넘기고
> (`provider-process.ts:155`), 거르는 것은 `providers.ts:285` 의 비공개 함수
> `environment()` 다. 실패 분류도 `spec.classifyFailure` 로 주입받는다.
>
> 그래서 함수만 열면 T3 가 env 를 스스로 정해야 하는데, 공개된 목록이 **두 provider 의
> 합집합** `PROVIDER_ENV_ALLOWLIST` 하나뿐이다. 그것을 쓰면 `claude` 자식이
> `OPENAI_API_KEY` 를 받는다 — `providers.ts:26-29` 의 주석이 금하는 바로 그것이다.
> **자격증명은 provider 별로 맞춘다**(사용자 결정). 반쪽 둘을 같이 연다.
>
> §5 의 비교표도 같이 고쳤다. 근거와 판단은
> `docs/superpowers/plans/2026-09-21-generate-provider-process-export.md` 와 ADR-0104 에 있다.

### T3 · `@mcpeak/dashboard`

```ts
POST   /api/relay            → { relayId, cases: [{ id, tool, input }] }
GET    /api/relay/:id/events → SSE
DELETE /api/relay/:id        → 중계기·자식 서버·AI 프로세스를 전부 닫고 나서 응답한다
```

AI argv — 집 방식(`providers.ts`)과 같은 모양에 세 칸만 다르다.

```
claude -p --model <모델> --no-session-persistence \
  --strict-mcp-config \
  --allowedTools "mcp__target" \                          ← 없으면 툴을 못 부른다
  --mcp-config '{"mcpServers":{"target":{"type":"http","url":"http://127.0.0.1:<포트>/mcp?case=<케이스id>"}}}'
  --output-format json
# 질문은 stdin 으로 간다. --json-schema 는 쓰지 않는다.
```

`--tools ""` 를 유지할지는 **계획 단계에서 실측한다.** 내장 도구를 끈 채로 MCP 툴이 살아
있는지 확인하지 않았다.

## 5. `generate` · `repair` 와 무엇이 다른가

| | generate · repair | 4 단계 |
|---|---|---|
| 임시 cwd · 타임아웃 · 출력 상한 · bounded 종료 | `runProviderProcess` | **똑같이 그것** |
| env allowlist 적용 · 실패 분류 | `providers.ts` (비공개) | **부르는 쪽이 한다** ⚠ 아래 정정 |
| 질문 전달 | stdin | stdin |
| `--mcp-config` | `{}` — 닫는다 | 중계기 URL — **연다** |
| `--allowedTools` | 없다 | **있다** |
| `--json-schema` | 답의 모양을 강제한다 | 쓰지 않는다 |
| 답을 어떻게 쓰나 | `structured_output` 을 꺼내 검증하고 그게 산출물 | **화면에 안 쓴다.** 툴을 불렀나 · 실패했나만 본다 |

**AI 의 역할이 다르다.** generate·repair 의 AI 는 **저자**다 — 케이스를 지어내고 그 결과가
파일로 남아 승인 게이트를 지난다. 그래서 스키마로 묶고 MCP 를 닫았다(ADR-0079). 케이스를
짓다 말고 진짜 서버를 호출하면 같은 입력에 다른 결과가 나오고 승인해 둔 것이 조용히 달라진다.

4 단계의 AI 는 **운전기사**다. 아무것도 지어내지 않고 사용자의 서버를 대신 두드릴 뿐이며,
화면에 나가는 값은 전부 중계기가 서버에서 직접 받은 것이다. AI 의 요약은 쓰지도 않는다.

**둘을 한 파일에 두면 경계가 흐려진다.** `generate` 안에 "MCP 를 여는 도구" 가 생기면 다음
사람이 저자 경로에서 그것을 집어 쓰는 날이 온다. 그래서 프로세스를 다루는 기계는 한 곳에서
공유하고, MCP 를 여는 argv 는 대시보드에만 둔다.

대가는 `generate` 의 공개 면이 함수 하나만큼 넓어지는 것이고, 한 번 나가면 major 없이 못
줄인다. ADR-A 에 적는다.

## 6. 테스트

**되돌려서 실패를 본 뒤에만 통과로 친다.**

| # | 어디 | 무엇을 고정하나 |
|---|---|---|
| 1 | mock | `--json` 응답 줄에 `body` 가 실리고 그 안에 `content` · `structuredContent` 가 다 있다 |
| 2 | mock | 사람이 읽는 줄은 `body` 를 싣지 않는다 (한 줄 유지) |
| 3 | mock | `protocolError` 줄에는 `body` 가 없다 |
| 4 | mock | 케이스 꼬리표가 요청·응답 줄에 실리고, 없으면 필드 자체가 없다 |
| 5 | mock | `readCaseTag` — 없음 · 빈 값 · 상한 초과 · 이상한 문자 |
| 6 | mock | `relayBinPath()` 가 가리키는 파일이 실제로 있다 |
| 6b | generate | `index` 의 `runProviderProcess` 가 `provider-process` 의 그 함수다 (공개 면 회귀) |
| 6c | generate | `CLAUDE_ENV_ALLOWLIST` 에 OpenAI 키가, `CODEX_ENV_ALLOWLIST` 에 Anthropic 키가 없다 |
| 7 | dashboard | 스위트 → 질문 목록. 같은 스위트면 **항상 같은 순서** |
| 8 | dashboard | argv 조립 — `--allowedTools` 가 붙고 URL 에 케이스 꼬리표가 붙는다 |
| 9 | dashboard | 줄 파서가 **JSON 이 아닌 줄을 건너뛴다** (자식 서버 로그가 같은 채널로 섞인다) |
| 10 | dashboard | `[실행 시작]` 이 **닫기를 먼저** 부르고 그 다음 판정 실행을 시작한다 |
| 11 | dashboard | AI 가 툴을 안 불렀을 때 「호출 없음」 칸이 뜬다 |
| 12 | E2E (직렬 웨이브) | 진짜 `mcpeak-relay` + `examples/weather-server`. **AI 는 가짜로 대체** — 진짜를 쓰면 같은 입력에 같은 결과가 안 나온다 |

## 7. 태스크 순서

**한 번에 한 패키지.** 사이에 사람이 만든 SHA 를 확인하고 넘어간다.

1. **T1 · mock** — `body` · 케이스 꼬리표 · `relayBinPath()` · 테스트 1–6 · **ADR-B**.
2. **T2 · generate** — `runProviderProcess` + provider 별 env 목록 둘 · 공개 면 테스트 · **ADR-A**.
   (처음엔 "export 한 줄 · 테스트 없음" 이었다. §4 의 정정 참고.)
3. **T3 · dashboard** — 통로 셋 · 화면 · 테스트 7–12.

ADR 둘:

- **ADR-A** 합성 경로는 MCP 를 닫아 두고 실제 응답 경로에서만 연다. `generate` 를 한 줄만
  여는 판단을 같이 적는다. (설계 §7 이 예고한 ADR)
- **ADR-B** 중계기 기록 줄이 응답 본문을 싣는다. 사람 줄엔 안 싣고 `--json` 줄에만, 자르지
  않는다는 판단.

## 8. 주의사항

- **결정론성.** ①은 테스트 경로가 아니다(설계 §2-3). 진짜 서버와 AI 가 끼므로 같은 결과를
  보장하지 않는다. **그래서 E2E 에서 AI 를 가짜로 바꾼다.** 이 구분이 흐려지면 안 된다.
- **동시 실행의 대가.** 케이스들이 한 서버를 동시에 친다. 상태를 가진 서버는 돌릴 때마다
  결과가 달라질 수 있다. 사용자가 이것을 알고 고른 것이다.
- **종료 코드 0 이 성공이 아니다.** 권한에 막혀도 `claude` 는 0 으로 끝난다(§3). 툴을 불렀는지는
  **중계기 기록 줄로** 판정한다.
- **stderr 에 JSON 이 아닌 줄이 섞인다.** 자식 서버의 stderr 가 같은 채널로 흐른다. 파싱
  실패한 줄은 건너뛴다.
- **빌드 산출물을 의심한다.** turbo 캐시가 낡은 `dist` 를 복원해도 빌드는 성공했다고 찍힌다.
  고친 심볼이 `dist` 에 있는지 grep 하고, 없으면 `npx tsdown --config-loader native`.
- **대시보드 web 테스트 81 건이 이미 깨져 있다**(`localStorage.clear is not a function`, jsdom).
  중계기 작업과 무관하다. 시작 전에 기준선을 찍어 둔다.
- **커밋·발행은 사람이 한다.**
