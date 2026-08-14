# Task H2 — HTTP 옵션 검증 보고서

- 상태: **BLOCKED** (구현은 완료, 회귀 게이트 `pnpm typecheck` 가 H3 소유 파일에서 실패)
- 브랜치: `feat/core-http-options`
- 기준 커밋: `11f7e9b`
- 설계 문서: `docs/superpowers/specs/2026-08-14-core-streamable-http-transport-design.md` §5, §12.1
- 구현 계획: `docs/superpowers/plans/2026-08-14-core-streamable-http-transport-implementation.md` Task H2

## 1. 변경 파일

```
 M packages/core/src/options.ts
 M packages/core/tests/options.test.ts
```

`git status --short` 결과가 위 두 줄이 전부다. 담당 범위 밖 파일은 열지도 고치지도 않았다.

## 2. 구현 내용

### `packages/core/src/options.ts`

| 항목 | 설계 근거 | 구현 |
|---|---|---|
| `StdioConnectOptions` | §5.1 | 기존 `ConnectOptions` 인터페이스를 개명 |
| `HttpConnectOptions` | §5.1 | `url` · `headers?` · `connectTimeoutMs?` |
| `ConnectOptions` | §5.1 | `StdioConnectOptions \| HttpConnectOptions` 유니온 타입 별칭 |
| `ResolvedHttpConnectOptions` | §5.1 | `url` · `headers` · `connectTimeoutMs` 전부 readonly |
| `isHttpConnectOptions` | §5.2 | `"url" in input` 판정 |
| 배타성 검사 | §5.2 | `assertExactlyOneTransport`. `command` 와 `url` 이 둘 다 있거나 둘 다 없으면 `TypeError("options must set exactly one of command or url")` |
| `HTTP_OPTION_KEYS` | §5.2 | `{ url, headers, connectTimeoutMs }`. 기존 `OPTION_KEYS` 는 stdio 전용으로 남음. 교차 키는 `options.<키> is not supported` |
| URL 규칙 4행 | §5.3 | 절대 URL · `http:`/`https:` · 자격증명 금지 · fragment 금지. 정규화 결과는 `hash` 를 지운 `parsed.href` |
| 헤더 규칙 3행 | §5.4 | plain object · RFC 9110 token 키 · 값 문자열과 CR·LF·NUL 금지 |
| 헤더 소문자 정규화 · 중복 키 | §5.4 | 저장 시 `toLowerCase()`. 대소문자만 다른 중복은 `TypeError("headers has a duplicate key: <소문자키>")` |
| 기본값 | §5.5 | `connectTimeoutMs` 는 기존 `NUMERIC_OPTIONS` 규칙 그대로. 기본 10000, 최대 60000, 1 미만·비정수는 `RangeError` |
| 비밀값 | §11 | 헤더 값은 어떤 오류 메시지에도 넣지 않는다. 키 이름까지만 |

`resolveConnectOptions` 는 이름을 그대로 뒀고 매개변수 타입만 `StdioConnectOptions` 로 좁혔다
(§5.1, 계획 §3.3). `McpClientError` 를 import 하지 않았다. `TypeError` 와 `RangeError` 만 던진다.
새 의존성 없음. 다른 모듈 import 없음.

### `packages/core/tests/options.test.ts`

`describe("resolveHttpConnectOptions")` 블록을 추가했다. 설계 문서 §12.1 의 케이스를 전량 덮는다.
기존 `resolveConnectOptions` 블록은 한 줄도 고치지 않았다(회귀 보존).

## 3. 검증

| 명령 | 결과 | 검사 대상 수 |
|---|---|---|
| `pnpm test packages/core` | **통과** | `Test Files 7 passed (7)`, `Tests 56 passed (56)` (기준 48 에서 +8) |
| `pnpm lint` | **통과** | `Checked 134 files in 36ms. No fixes applied.` |
| `pnpm typecheck` | **실패** | `Tasks: 2 successful, 6 total` / `Failed: @ohmymcp/core#typecheck` |

typecheck 실패의 전문은 다음 한 건이다.

```
src/index.ts(25,76): error TS2345: Argument of type 'ConnectOptions' is not assignable to parameter of type 'StdioConnectOptions'.
  Property 'command' is missing in type 'HttpConnectOptions' but required in type 'StdioConnectOptions'.
```

`packages/core/src/options.ts` 와 `packages/core/tests/options.test.ts` 에는 타입 오류가 없다.

## 4. BLOCKED 사유와 필요한 조치

설계 문서 §5.1 이 요구하는 두 가지, 즉 `ConnectOptions` 를 유니온으로 만드는 것과
`resolveConnectOptions` 의 매개변수를 `StdioConnectOptions` 로 좁히는 것을 동시에 만족하면
`src/index.ts:25` 의 `connectStdio(options: ConnectOptions)` 가 유니온을 stdio 전용 함수에
그대로 넘기게 되어 타입이 깨진다. 이 파일은 Task H3 단독 소유이고 H2 는 열지 말라는 지시를
받았으므로 고치지 않았다.

계획 §4 는 H2 의 회귀 검증으로 `pnpm typecheck` 를 걸어 뒀지만, H2 만으로는 이 게이트를 통과할
수 없다. 계획의 웨이브 분할과 검증 게이트가 어긋난 지점이다.

필요한 조치는 H3 의 작업 범위 안에 있고 두 줄이다.

```ts
// packages/core/src/index.ts
export async function connectStdio(options: StdioConnectOptions): Promise<McpStdioConnection>
// connect() 는 유니온을 받아 isHttpConnectOptions 로 분기한다 (설계 문서 §4)
```

즉 이 오류는 H3 이 `connect()` 분기를 구현하는 순간 함께 사라진다. H2 쪽에서 따로 고칠 것이
없다. 오케스트레이터가 택할 수 있는 길은 둘이다.

1. H2 를 이대로 병합하고 H3 가 끝날 때까지 `@ohmymcp/core#typecheck` 가 빨간 것을 감수한다.
2. H2 의 병합 게이트에서 typecheck 를 빼고, H1·H2·H3 통합 후에 한 번에 판정한다.

어느 쪽이든 H2 단독 브랜치에서 typecheck 를 녹색으로 만들려면 H3 소유 파일을 건드려야 한다.

## 5. 임의로 판단한 지점

1. **배타성 검사를 `resolveConnectOptions` 와 `resolveHttpConnectOptions` 양쪽에 넣었다.**
   설계 §5.2 는 "분기 전에 거절한다"고만 적혀 있고 그 코드가 어느 함수에 사는지는 적지 않았다.
   분기 지점은 `index.ts`(H3) 라서 H2 가 손댈 수 없다. 두 resolve 함수 양쪽에 두면 H3 가
   `isHttpConnectOptions` 로 어느 쪽으로 분기하든 `{ command, url }` 과 `{}` 가 같은 메시지로
   거절된다. `isHttpConnectOptions` 자체는 §5.2 대로 `"url" in input` 순수 판정으로 남겼다.
2. **헤더 값이 문자열이 아닐 때의 메시지를 따로 만들었다.** §5.4 표는 "값이 문자열이고 CR·LF·NUL
   을 포함하지 않음" 한 행에 위반 메시지 하나(`must not contain control characters`)만 준다.
   값이 숫자 `1` 인 입력에 "제어문자를 포함하면 안 된다"고 말하면 사용자가 엉뚱한 곳을 본다.
   그래서 `headers.<키> must be a string` 을 썼다. §12.1 의 해당 케이스는 키 이름 `x-a` 만
   확인하므로 계약 위반은 아니다. 표를 한 행 더 늘리는 것이 맞다고 보면 설계 문서 쪽을 고쳐야
   한다.
3. **`{}` 를 `resolveConnectOptions` 에 넣었을 때의 메시지가 바뀐다.** 기존에는
   `command must be a non-empty string`, 지금은 `options must set exactly one of command or url`.
   둘 다 `TypeError` 이고 기존 테스트에 이 입력이 없어 회귀는 아니다. stdio 검증의 "동작"이
   바뀐 유일한 지점이라 명시해 둔다. `{ command: "" }` 는 기존 그대로 `command` 메시지다.
4. **`url` 규칙 위반 세 가지 중 파싱 실패·비 HTTP 프로토콜·타입 불일치에 같은 메시지를 썼다.**
   §5.3 표가 앞의 둘에 같은 메시지를 지정했고, `url` 이 문자열이 아닌 경우는 표에 없어 같은
   메시지로 합쳤다.
5. **`http://host/mcp#` 처럼 빈 fragment 만 붙은 입력을 통과시킨다.** `URL.hash` 가 빈 문자열이라
   §5.3 의 fragment 규칙에 걸리지 않는다. 정규화 단계에서 `hash = ""` 를 대입해 `href` 끝의 `#`
   를 지우므로 결과는 `#` 없는 URL 이다.

## 6. 남은 위험

- **typecheck 게이트.** 4절 그대로다. H3 병합 전까지 `pnpm typecheck` 는 빨갛다.
- **헤더 키 순서.** `Object.entries` 의 삽입 순서를 그대로 따르므로 입력 객체의 키 순서가 다르면
  결과 객체의 키 순서도 다르다. 값 비교(`toEqual`)와 실제 요청에는 영향이 없지만, 진단이나
  카세트에서 헤더를 직렬화하는 코드가 생기면 정렬이 필요해진다. 지금은 어디에도 직렬화하지
  않는다(§11 이 헤더 직렬화를 금지한다).
- **`ConnectOptions` 유니온의 하위 호환.** `@ohmymcp/core` 의 공개 타입 `ConnectOptions` 가
  인터페이스에서 유니온 별칭으로 바뀌었다. `interface X extends ConnectOptions` 로 확장하던
  외부 코드가 있으면 깨진다. 저장소 안에는 그런 사용처가 없다(`grep ConnectOptions` 로 확인).
- **쿼리 문자열은 보존한다.** §11·§15 의 결정대로 URL 정규화가 쿼리를 지우지 않으므로, 토큰을
  쿼리로 받는 서버의 자격증명이 정규화 URL 에 남는다. 이 URL 을 진단에 싣는 것은 H1·H3 범위다.
