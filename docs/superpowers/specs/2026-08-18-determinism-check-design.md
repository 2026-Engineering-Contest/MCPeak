# 결정론성 확인 설계 (2026-08-18)

- 담당 패키지: `runner` + `cli`
- 작성자: @seodduu
- 로드맵 단계 7 (마지막 미구현 계획 항목)
- 참조: `docs/adoption.md` §1.4.3(수동 실측), ADR-0018(비차단 진단 지위), ADR-0023(초기화
  명령), ADR-0027(응답 본문을 읽는 조건)
- 신규 ADR 대상: 비교 대상·캡처 위치·결론 강도 구분 (§10, ADR-0038 예정)

## 1. 배경

이 도구의 전제는 "명세가 무조건 옳고 실패는 서버 결함" 이다. 그런데 명세 자체가 시간·랜덤·
상태에 의존하면 그 전제가 무너진다. 서버를 안 고쳐도 내일 빨간불이 나고, 팀은 빨간불을
무시하기 시작한다.

2026-08-17 수동 실측(§1.4.3)에서 요구가 구체화됐다.

- `server-filesystem`: 매 실행 전 샌드박스를 복원하고 2회 실행해 54/54 · 54/54. **같은 초기
  상태에서 같은 결과**라고 말할 수 있었다.
- `mcp-server-git`: 복원 없이 2회 실행해 40/40 · 40/40. 1회차가 만든 커밋 위에서 2회차가
  돌았으므로 **"두 실행 모두 40/40" 까지만** 말할 수 있었다. 결정론성 판정이 아니다.

이 구분을 사람이 손으로 했다. 샌드박스를 만들고, 두 번 돌리고, 눈으로 diff 했다. 단계 7은
이것을 자동화한다.

## 2. 결정 요약

착수 전 미결이던 결정을 포함해 넷을 고정한다.

| 결정 | 선택 | 기각한 대안 |
|---|---|---|
| 비교 대상 | **케이스별 구조화 비교.** 응답을 정규화해 비교하고 첫 차이 지점의 경로를 짚는다 | 보고서 전체 바이트(로드맵 원문): "다르다" 만 알려주고 어디가 다른지는 사람이 diff 해야 한다. 실패 메시지가 제품이라는 원칙에 어긋난다. 판정만 비교: 단언이 안 걸린 비결정 필드를 놓친다 |
| 상태 복원 | **`--reset-cmd` 를 `test` 에 배선하되 선택적.** 유무에 따라 결론 문장의 강도를 구분한다 | 필수화: 읽기 전용 서버 사용자에게 불필요한 문턱. 미배선: 실측이 "복원이 검사의 전제" 라고 밝혔으므로 반쪽짜리가 된다 |
| 판정 영향 | **비차단 진단.** status·종료 코드·`RunnerReport` 불변 | 실패 처리: 날씨·시계 서버는 정상인데 비결정이다. 오탐이 CI 를 막으면 안 된다. `specFindings`·`rejectionBasis` 와 같은 지위다 |
| 실행 단위 | **스위트 전체 2회.** [복원] → 1회차 → [복원] → 2회차 → 케이스별 대조 | 케이스별 연속 2회 호출: 둘째 호출이 첫 호출이 바꾼 상태 위에서 돌아(`create_file` 2번 = `EEXIST`) 상태 의존 툴에서 오탐이 난다. 케이스 사이 복원도 불가능해진다 |

공식 판정과 보고서는 **1회차 것**이다. 2회차는 비교 전용이다.

## 3. 비범위

- **AI 진단.** 차이의 원인 분류는 §6의 결정론적 휴리스틱까지만 한다. AI 진단(#163 의
  `rejection-diagnosis` 패턴 재사용)은 별도 이슈로 미룬다. 결정론성 검사가 비결정 도구에
  기대는 자기모순을 피하고, 휴리스틱만으로 힌트 품질이 충분하다.
- **repair 연결.** 2회차 미완주는 repair 번들에 넣지 않는다. 번들의 입력은 공식 보고서
  (1회차)이고, 2회차 크래시는 보고서 밖 사건이다. §7의 프로세스 진단 재사용까지만 한다.
- **`RunnerReport` 확장.** 새 필드를 넣지 않는다. 결과는 CLI 가 별도 블록으로 렌더한다.
  보고서 JSON 바이트를 흔들지 않기 위함이다(기존 소비자·JUnit 불변).
- **executor·이벤트 변경.** `runSuite` 와 `RunnerEvent` 를 고치지 않는다. 응답 캡처는 CLI 의
  클라이언트 래퍼가 한다(§5). "통과 케이스는 본문을 읽지 않는다"(ADR-0027) 배선도 그대로다.
- **비결정 필드의 무시 목록.** "이 필드는 비교에서 빼라" 는 명세 확장은 이번에 안 한다.
  그것은 `record` 파트의 카세트 매칭 키 책임과 겹치는 영역이라, 필요해지면 이슈로 협의한다.
- **`generate` 경로.** 이 검사는 `mcpeak test` 전용이다. 승인 전 dry run 에 붙이는 것은
  후속이다.

## 4. runner 공개 API — `packages/runner/src/determinism.ts` (신규)

순수 함수다. 서버 호출 0회, I/O 0회. 문장은 runner 가 단독 소유한다.

```ts
import type { AssertionResult } from "./assertions.js";
import type { TestCaseResult } from "./executor.js";
import type { RunnerRedactionOptions } from "./sanitization.js";

/** 한 회차에서 케이스 하나를 관찰한 것. CLI 래퍼(§5)가 만든다. */
export interface DeterminismCaseObservation {
  readonly caseId: string;
  readonly caseName: string;
  /** callTool 케이스의 툴 이름. listTools 케이스는 null. 케이스 블록 머리글에 쓴다. */
  readonly toolName: string | null;
  readonly status: TestCaseResult["status"];
  readonly assertionStatuses: readonly AssertionResult["status"][];
  /**
   * 캡처한 원본 응답(callTool 의 ToolResult 또는 listTools 의 ToolDef[]).
   * 호출이 오류·타임아웃으로 끝나 응답이 없으면 키를 만들지 않는다.
   */
  readonly response?: unknown;
}

export interface CheckDeterminismOptions {
  readonly first: readonly DeterminismCaseObservation[];
  readonly second: readonly DeterminismCaseObservation[];
  /** `--reset-cmd` 가 지정돼 각 회차 전에 복원이 실행됐는가. 결론 강도(§8)를 가른다. */
  readonly stateRestored: boolean;
  /**
   * 표시 값에 적용할 redaction. 차이 지점까지의 조상 키와 값의 직속 키로 판정해 **구조화된
   * 값을 먼저 가리고** 그 뒤에 문자열화한다(ADR-0082). text 블록 문자열 안의 비밀값은 키가
   * 없어 닿지 않는다.
   */
  readonly redaction?: RunnerRedactionOptions;
}

/** 휴리스틱 원인 추정(§6). 확정이 아니라 추정이므로 문장에도 "보입니다" 로 쓴다. */
export type DeterminismHint = "timestamp" | "randomId" | "numericDrift";

export interface DeterminismDifference {
  readonly caseId: string;
  readonly caseName: string;
  /** 케이스 블록 머리글에 쓴다. 관찰의 toolName 을 그대로 옮긴다. */
  readonly toolName: string | null;
  /** 무엇이 달랐나. status 가 다르면 그것만 보고하고 응답 비교는 하지 않는다. */
  readonly kind: "status" | "assertion" | "response";
  /**
   * kind 가 "response" 일 때 첫 차이 지점. 예: "content[0].text". 비교 대상이 원본
   * ToolResult 이므로 경로도 그 형태를 따른다. text 블록 안 JSON 을 파싱해 더 깊이
   * 들어가지 않는다 — 파싱하면 공백·키 순서 차이가 흡수돼 바이트 비결정을 놓친다.
   */
  readonly path?: string;
  /** 표시용 값. clampObservedText 를 거친 문자열이다(§6 비교·표시 분리). */
  readonly firstValue: string;
  readonly secondValue: string;
  readonly hint?: DeterminismHint;
}

export interface DeterminismResult {
  /** 비교를 수행한 케이스 수. */
  readonly compared: number;
  /** 양쪽 모두 notRun·cancelled 라 비교에서 제외한 케이스 수. */
  readonly skipped: number;
  readonly differences: readonly DeterminismDifference[];
  /**
   * - "deterministic": 차이 0 + 복원 있음. 결정론성 확인됨.
   * - "consistentWithoutReset": 차이 0 + 복원 없음. "같았다" 까지만 말할 수 있다.
   * - "nondeterministic": 차이 1건 이상. 복원 유무와 무관하게 유효한 신호다.
   */
  readonly conclusion: "deterministic" | "consistentWithoutReset" | "nondeterministic";
}

export function checkDeterminism(options: CheckDeterminismOptions): DeterminismResult;

/**
 * 차이 1건을 사람 문장으로. §8의 케이스 블록 형식을 만든다. status 차이의 안내 문장이
 * 복원 유무로 갈리므로(§8) stateRestored 를 받는다.
 */
export function describeDeterminismDifference(
  difference: DeterminismDifference,
  options: { readonly stateRestored: boolean },
): string;
```

`index.ts` 에 전부 재수출한다. redaction·clamp 는 기존 `clampObservedText` 를 재사용한다.

### 4.1 비교 규칙

케이스는 인덱스로 짝을 맞춘다(같은 스위트를 두 번 돌리므로 수와 순서가 같다. 다르면 그것
자체가 내부 오류이고 `CLI_INTERNAL_ERROR` 로 보고한다). 케이스마다 순서대로 셋을 대조하고,
**앞 단계가 다르면 뒤는 보지 않는다.** 하나의 케이스는 최대 1건의 차이만 만든다.

1. `status`. 다르면 kind `"status"`. (예: 1회차 passed, 2회차 failed)
2. 단언별 status 배열. 다르면 kind `"assertion"`, path 는 `assertions[i]`.
3. 응답. `canonicalJson` 으로 정규화해 문자열 비교. 같으면 통과. 다르면 첫 차이 지점을
   찾는다(§4.2). 한쪽만 응답이 없으면 그것도 차이다(path 없음, 값은 `(응답 없음)`).

정규화는 객체 키 순서만 흡수한다. **배열 순서 차이는 차이다.** 순서가 실행마다 바뀌는
서버는 그 자체로 비결정이고, 순서에 단언을 걸면 깨진다.

양쪽 status 가 같고 둘 다 `notRun` 또는 `cancelled` 면 비교 대상이 아니다. `skipped` 로
센다. 둘 다 `timedOut` 이면 응답이 양쪽에 없으므로 3단계가 자연히 통과한다(같은 지점에서
같은 방식으로 멈춘 것까지는 같다).

### 4.2 첫 차이 지점 찾기

정규화 문자열이 다를 때만 실행한다. 두 값을 명시적 스택으로 병행 순회한다(**재귀 금지.**
`canonical.ts` 가 재귀로 스택 오버플로를 겪고 스택 순회로 바뀐 전례가 §계보에 있고, 여기도
같은 깊이의 입력을 받는다). 순회 순서는 정렬된 객체 키, 배열 인덱스 순이다.

- 타입이 다르거나 원시 값이 다르면 그 지점이 답이다.
- 객체에서 한쪽에만 있는 키: 그 키가 답이다. 값은 `(없음)` 대 실제 값.
- 배열 길이가 다르면: 공통 접두 구간을 먼저 순회하고, 접두가 같으면 `배열[공통길이]` 가
  답이다.

경로 표기는 `body.fetchedAt` · `content[0].text` 꼴이다. 루트가 다르면 `(루트)`.

## 5. CLI — 캡처 래퍼와 2회 실행

### 5.1 응답 캡처 — `packages/cli/src/determinism-capture.ts` (신규)

`McpClient` 를 감싸 호출 결과를 케이스에 귀속시켜 기록한다. `cassetteClient` 와 같은 패턴이라
runner 를 안 고친다.

```ts
export interface DeterminismCapture {
  readonly client: McpClient;
  /** runSuite 의 onEvent 를 이 함수에 연결한다. caseStarted 로 현재 케이스를 추적한다. */
  readonly onEvent: (event: RunnerEvent) => void;
  /** 실행이 끝난 뒤 케이스별 관찰을 회수한다. */
  readonly observations: () => readonly DeterminismCaseObservation[];
}

export function createDeterminismCapture(inner: McpClient): DeterminismCapture;
```

- 귀속은 **호출 시점**의 현재 케이스 인덱스로 한다. 타임아웃 뒤 늦게 도착한 응답이 다음
  케이스로 새는 것을 막는다(executor 는 케이스를 직렬로 돌리지만, 응답 resolve 는 케이스
  경계를 넘을 수 있다).
- `status`·`assertionStatuses` 는 `caseCompleted` 이벤트의 `TestCaseResult` 에서 옮긴다.
- 원본 응답은 자르지 않고 메모리에 든다. **비교는 원본, 표시는 clamp** 다(§6). 잘린 값끼리
  비교하면 "잘려서 같아 보임" 오판이 난다. 응답은 프로세스 수명 동안만 살고 어디에도
  저장되지 않는다. 스위트는 이미 `RunnerPayloadLimits` 로 보고서 상한이 잡혀 있어 회차당
  메모리도 그 규모에 머문다.
- 기존 `test` 경로(플래그 없음)에서는 이 래퍼를 아예 안 만든다. 캡처 비용 0.

### 5.2 test-command 배선

새 플래그 둘. 파싱 규칙은 `--junit` 과 같다(중복 금지, 값 자리의 `--` 접두 토큰은 값 누락
오류).

```
mcpeak test <suite.json> --command <executable> [--arg <value> ...]
  [--determinism] [--reset-cmd <command>]
  [--json] [--junit <path>] [--repair-bundle <path>] [--stderr-lines <N>]
```

- `--determinism`: 값 없는 스위치. 지정 시 2회 실행 + 비교.
- `--reset-cmd <command>`: `generate` 와 같은 의미·같은 구현(`reset-hook.ts` 의
  `runResetCommand` 재사용, 셸 미경유·60초 제한·실패 시 `ResetCommandError`).
  `--determinism` 없이 단독 지정도 허용한다(1회 실행 전 1번 복원). `--determinism` 과 함께면
  **각 회차 전에 1번씩, 총 2번** 실행한다.
- 복원 실패는 시험 실행을 시작하지 않는 실패다(`generate` 와 동일). 새 오류 코드
  `RESET_COMMAND_FAILED` 를 `CliErrorCode` 에 추가하고, 명령·종료 코드·stderr 꼬리를
  안내에 싣는다.

실행 흐름:

```
[reset] → 1회차 runSuite(캡처 A) → 보고서 렌더(1회차, 기존 그대로)
        → [reset] → 2회차 runSuite(캡처 B)
        → checkDeterminism(A, B, stateRestored) → 결과 블록 렌더(§8)
```

- 2회차도 같은 연결 절차를 밟는다. **서버 프로세스를 새로 띄운다**(연결을 재사용하지
  않는다). 프로세스 내부 상태도 초기화 대상이기 때문이다. 1회차 연결은 2회차 시작 전에
  기존 종료 절차로 닫는다.
- JUnit·`--json`·repair 번들은 **1회차 보고서만** 쓴다. 형식 불변.
- `TestCommandDependencies` 에는 `checkInputContract` 와 같은 방식의 선택 주입 필드
  `checkDeterminism?` 를 추가한다. 캡처 래퍼는 CLI 내부 구현이므로 주입 대상이 아니다.

## 6. 표시 값과 휴리스틱 힌트

차이의 양쪽 값은 `redactByPath`(조상 키·직속 키 마스킹)를 **먼저** 거친 뒤 `canonicalJson`
으로 문자열화하고 `clampObservedText`(기존 상한)로 자른 문자열로 싣는다. 마스킹이 문자열화보다
뒤에 오면 키 정보가 사라져 아무것도 못 가린다(#183, ADR-0082). 원인
추정은 결정론적 휴리스틱 셋이다. **양쪽 값이 모두** 패턴에 맞을 때만 힌트를 단다.

| 힌트 | 조건 | 문장 |
|---|---|---|
| `timestamp` | 양쪽 다 `\d{4}-\d{2}-\d{2}T\d{2}:\d{2}` 를 포함하는 문자열 | 시간 의존으로 보입니다 |
| `randomId` | 양쪽 다 UUID 형식(`8-4-4-4-12` hex) 문자열 | 실행마다 새로 발급되는 식별자로 보입니다 |
| `numericDrift` | 양쪽 다 number 이고 값만 다름 | 측정값 변동으로 보입니다 |

셋 다 아니면 힌트 없이 값만 보여준다. 패턴을 넓히지 않는다. 틀린 추정을 확신조로 말하는
것이 추정 없음보다 나쁘다.

## 7. 2회차 미완주

2회차 보고서의 `status` 가 `"aborted"` 이거나 연결·실행이 오류로 끝나면 비교하지 않는다.

- 종료 코드는 여전히 1회차 판정을 따른다(비차단 유지).
- 결과 블록에 사실과 사유를 적고, **반복 실행 취약 의심** 문장을 단다. 1회차는 완주했는데
  2회차만 죽은 것은 이전 실행이 남긴 상태(잠금·포트 점유·파일)가 원인일 확률이 높다.
- 2회차 연결의 프로세스 진단(stderr 꼬리·exit code)을 단계 1의 `renderProcessDiagnostics`
  로 그대로 렌더한다. §1.5(원인까지 3계층을 파야 했던 사례)의 재발 방지 배선이다.

```
결정론성 확인
→ 2회차 실행이 완주하지 못해 비교할 수 없습니다. (사유: 서버 프로세스 종료)
→ 1회차는 완주했으므로, 서버가 반복 실행 자체에 취약할 수 있습니다
  (이전 실행이 남긴 상태·잠금·포트 점유 등).
[서버 프로세스 진단]
  exit code: 1
  Error: EADDRINUSE: address already in use :::8080
```

repair 번들에는 넣지 않는다(§3).

## 8. 화면 — 문구 전량

기존 보고서 뒤, 프로세스 진단과 같은 위치에 블록을 렌더한다. `--determinism` 없이는 한 줄도
안 찍는다.

**차이 0 + 복원 있음** (`deterministic`):

```
결정론성 확인
→ 같은 초기 상태에서 2회 실행한 결과가 모든 케이스에서 같습니다. (12/12)
```

**차이 0 + 복원 없음** (`consistentWithoutReset`):

```
결정론성 확인
→ 2회 실행 결과가 같았습니다. (40/40)
→ 단, 실행 사이에 상태를 복원하지 않았으므로 결정론성 확인은 아닙니다.
  --reset-cmd 로 초기 상태 복원 명령을 지정하면 확인이 됩니다.
```

**차이 있음** (`nondeterministic`), 케이스 블록은 `describeDeterminismDifference` 가 만든다:

```
결정론성 확인
→ 2/12 케이스에서 2회 실행 결과가 다릅니다.

  get_weather / 정상 조회 (case-3)
  → 다른 지점: content[0].text
     1회차: "{\"temp\":24,\"fetchedAt\":\"2026-08-18T14:03:11Z\"}"
     2회차: "{\"temp\":24,\"fetchedAt\":\"2026-08-18T14:03:12Z\"}"
  → 시간 의존으로 보입니다. 이 값은 실행마다 바뀌므로 단언 기준이 될 수 없습니다.

  create_file / 새 파일 (case-9)
  → 판정이 다릅니다: 1회차 passed, 2회차 failed
  → 이 케이스는 이전 실행이 남긴 상태에 의존할 수 있습니다. --reset-cmd 로 상태를
    복원하거나, 상태 비의존 케이스로 바꾸세요.
```

- kind `"status"` 의 안내 문장은 복원 유무로 갈린다. 복원이 **있었으면** "상태" 문장 대신
  "서버가 같은 입력에 다른 판정을 냈습니다" 로 쓴다(복원했는데 다르면 상태 탓이 아니다).
- 비교 제외가 있으면 괄호로 덧붙인다: `(12/12, 제외 2: 실행되지 않은 케이스)`.
- 힌트 문장이 없으면 값 두 줄까지만 찍는다.
- `--json` 출력에는 `determinism` 키로 `DeterminismResult` 를 그대로 싣는다. `--json` 만
  있고 `--determinism` 이 없으면 키를 만들지 않는다(기존 JSON 바이트 불변).

help 의 `--determinism` 설명에 부작용 경고를 넣는다:

```
  --determinism         스위트를 2회 실행해 결과가 같은지 확인합니다. 툴을 2회
                        호출하므로 부작용이 있는 서버에서는 샌드박스에서 쓰세요.
                        --reset-cmd 와 함께 쓰면 결정론성 확인이 되고, 없으면
                        "2회 결과가 같았다" 까지만 확인합니다.
```

## 9. 테스트

### 9.1 runner 유닛 (`packages/runner/tests/determinism.test.ts`, 인메모리)

| 케이스 이름 | 단언 |
|---|---|
| 모든 케이스가 같고 복원 있음이면 deterministic 을 낸다 | `conclusion === "deterministic"`, `differences.length === 0`, `compared === 케이스 수` |
| 모든 케이스가 같고 복원 없음이면 consistentWithoutReset 을 낸다 | `conclusion === "consistentWithoutReset"` |
| 응답 필드 값이 다르면 경로와 양쪽 값을 짚는다 | `kind === "response"`, `path === "raw.result.value"` 류의 실제 경로, firstValue·secondValue 에 두 값 |
| 중첩 배열 원소가 다르면 인덱스 경로를 만든다 | `path === "content[0].text"` |
| 배열 순서만 달라도 차이다 | `differences.length === 1` (정렬로 흡수하지 않음) |
| 객체 키 순서만 다르면 차이가 아니다 | `differences.length === 0` (canonicalJson 흡수) |
| 한쪽에만 있는 키를 짚는다 | path 가 그 키, 값 한쪽이 `(없음)` |
| status 가 다르면 status 차이만 보고하고 응답은 안 본다 | `kind === "status"`, 응답이 서로 달라도 차이 1건 |
| 단언 status 가 다르면 assertion 차이를 보고한다 | `kind === "assertion"`, `path === "assertions[1]"` |
| 한쪽만 응답이 없으면 차이다 | `kind === "response"`, 값 한쪽이 `(응답 없음)` |
| 양쪽 다 notRun 이면 제외로 센다 | `skipped === 1`, differences 에 없음 |
| 케이스 수가 다르면 던진다 | throw (CLI 가 내부 오류로 변환) |
| ISO 타임스탬프 쌍에 timestamp 힌트를 단다 | `hint === "timestamp"` |
| UUID 쌍에 randomId 힌트를 단다 | `hint === "randomId"` |
| 숫자 쌍에 numericDrift 힌트를 단다 | `hint === "numericDrift"` |
| 패턴 밖 문자열 쌍에는 힌트가 없다 | `hint === undefined` |
| 한쪽만 타임스탬프 패턴이면 힌트가 없다 | `hint === undefined` (양쪽 일치 조건) |
| 깊이 1500 응답에서 죽지 않는다 | 깊이 1500 중첩 객체 쌍 입력, throw 없이 경로 반환 (canonical.ts 전례 회귀) |
| describeDeterminismDifference 가 §8 케이스 블록을 만든다 | 경로·두 값·힌트 문장이 출력에 포함 |

### 9.2 cli 유닛 (`packages/cli/tests/`, 가짜 client·인메모리)

| 케이스 이름 | 단언 |
|---|---|
| 캡처가 호출을 현재 케이스에 귀속시킨다 | 케이스 2개 실행 후 observations 의 caseId·response 대응 |
| 늦게 도착한 응답도 호출 시점 케이스에 귀속된다 | 케이스 1 타임아웃 후 resolve, 케이스 2 오염 없음 |
| --determinism 이 스위트를 2회 실행한다 | 가짜 connect 호출 2회, runSuite 2회 |
| --reset-cmd 와 함께면 각 회차 전에 복원한다 | reset 호출 2회, 순서가 reset→run→reset→run |
| --reset-cmd 단독이면 1회 실행 전 1번 복원한다 | reset 1회, runSuite 1회 |
| 복원 실패면 실행을 시작하지 않는다 | `RESET_COMMAND_FAILED`, runSuite 0회 |
| 2회차 미완주면 비교 없이 사유와 프로세스 진단을 찍는다 | §7 문구 + 진단 블록, 종료 코드는 1회차 판정 |
| 판정·종료 코드가 1회차를 따른다 | 차이 있어도 1회차 전부 통과면 종료 코드 0 |
| JUnit·repair 번들이 1회차 보고서로 만들어진다 | 2회차 결과가 XML·번들에 없음 |
| --json 에 determinism 키가 실린다 | `--determinism --json` 출력 파싱, 키 존재 |
| --determinism 없으면 determinism 키가 없다 | 기존 JSON 스냅샷과 바이트 동일 |
| --determinism 없으면 캡처 래퍼를 만들지 않는다 | 래퍼 팩토리 호출 0회 |
| 플래그 파싱 오류 문구 | `--reset-cmd` 값 누락·중복 각각 §5.2 규칙 |

### 9.3 E2E (직렬 웨이브 전용, `examples/` 실서버)

| 케이스 이름 | 단언 |
|---|---|
| weather-server 는 차이 0 이다 | `--determinism` 실행, "모든 케이스에서 같습니다" 출력, 종료 코드 0 |
| 비결정 예제 서버에서 차이를 짚는다 | 타임스탬프를 응답에 넣는 픽스처 서버 신설(`examples/` 가 아니라 `packages/cli/tests/fixtures/` 의 테스트 전용 서버), 경로 `content[0].text` 가 출력에 있음 |

유닛은 인메모리 + `fixtures/` 만 쓴다. 실서버 E2E 는 직렬 웨이브로 분리한다(팀 규칙).

## 10. ADR 대상 (ADR-0038)

"다르게 갈 수 있었던" 판단 셋을 ADR 하나로 기록한다.

1. 비교 대상: 보고서 바이트(로드맵 원문) → 케이스별 구조화 비교로 뒤집었다.
2. 캡처 위치: runner 이벤트 확장 대신 CLI 클라이언트 래퍼. `RunnerReport` 와 executor 를
   불변으로 지킨 이유.
3. 결론 강도 구분: 복원 없는 실행을 거부하지 않고 문장 강도를 낮춘 이유(§1.4.3 실측의
   구분을 제품 문장으로 옮긴 것).

## 11. 완료 조건

- `pnpm test` · `pnpm typecheck --force` · `pnpm lint` 전부 녹색 (turbo 캐시 아님을
  `Cached: 0 cached` 로 확인).
- §9 의 테스트가 전부 존재하고 통과한다.
- `--determinism` 없이 실행한 기존 경로의 출력이 바이트 단위로 불변이다.
- `examples/weather-server` 대상 E2E 가 "차이 0" 경로를 실제로 지난다.
- ADR-0038 초안이 `docs/adr/` 에 있다.
