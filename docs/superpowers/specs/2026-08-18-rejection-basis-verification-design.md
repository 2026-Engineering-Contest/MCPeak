# 거절 근거 확인 설계 (이슈 #89)

작성일: 2026-08-18. 담당: runner · cli · generate. 참조: 이슈 #89,
`docs/reports/observation-89-error-body.md`, ADR-0015, ADR-0025, ADR-0027, ADR-0033.

## 1. 배경

위반 케이스의 단언은 `isError: true` 하나다. 이 단언은 **서버가 입력을 정상 거절한 것**과
**서버가 다른 이유로 실패한 것**을 구분하지 못한다. 둘 다 초록으로 통과한다.

이슈 #89 는 오류 본문에 대한 단언(`errorBodyMatchesSchema` · `errorBodyContains`)을 후보로 들되,
형식을 가정하기 전에 실제 서버를 관찰하라는 선행 조건을 걸었다. 그 관찰을 두 번 했고 결과는
`docs/reports/observation-89-error-body.md` 에 있다. 요약하면 셋이다.

1. **구조화된 오류 본문이 없다.** 공개 서버 10개 + 자체 1개의 위반 응답 80건이 전부
   `{ content: [{ type: "text" }], isError: true }` 한 모양이다. `errorBodyMatchesSchema` 는
   대조할 구조가 없어 탈락한다.
2. **본문 문구로 크래시를 지목할 수 없다.** 필드 이름은 80건 중 일부에만 나오고, 크래시 문구가
   오히려 필드 이름을 포함한다(`Cannot read properties of undefined (reading 'city')`).
   FastMCP 는 거절과 크래시가 같은 접두어를 쓴다. 하위 API 서버는 둘 다 `-32603` 이다.
3. **stderr 로도 안 된다.** SDK 상위 API 는 핸들러 예외를 잡아 응답으로 바꾸고 로그를 남기지
   않는다. Node·Python 둘 다 그 경우 stderr 가 비어 있다. 로드맵 단계 9(케이스별 stderr 구간)는
   이 문제의 해법이 아니다.

**가능한 것은 반대 방향이다.** 크래시를 지목할 수는 없지만, **SDK 검증이 낸 거절임을 양성으로
확인**할 수는 있다. 관찰 80건 중 64건이 세 지문 중 하나에 걸린다.

## 2. 목표 / 비범위 / 완료 조건

### 목표

1. 거절을 기대하는 케이스마다 **거절 근거가 확인됐는지**를 판정해 결과에 싣는다.
2. 그 사실을 `test` 요약과 `generate` 승인 화면에서 사용자가 놓치지 않게 표시한다.
3. 확인하지 못한 케이스만 골라 AI 에게 **참고 의견**을 물을 수 있게 한다.
4. 판정과 종료 코드를 바꾸지 않는다. 기존 테스트가 그대로 통과한다.
5. 결정론성을 지킨다. 같은 응답에 항상 같은 분류가 나온다.

### 비범위

- **크래시 판정.** 관찰이 불가능함을 보였다. 어떤 규칙도 오탐 없이 크래시를 지목하지 못한다.
- **판정·종료 코드 변경.** 확인 못 한 케이스를 실패로 만들지 않는다. 근거는 §4.3 이다.
- **`errorBodyMatchesSchema` 단언.** 폐기한다(관찰 §2).
- **`errorBodyContains` 단언.** 이 설계와 독립이다. 필요하면 별도로 판단한다.
- **케이스별 stderr 구간(단계 9).** 이 문제의 해법이 아니다. 다만 관찰 §8 이 찾은 별개 결함
  (async 실패가 통과로 찍힘)의 근거로는 남는다.
- **JUnit XML 변경.** 판정이 안 바뀌므로 XML 도 안 바뀐다.
- **승인 지문 변경.** 지문은 명세에서 계산하고(ADR-0017) 보고서와 무관하다.

### 완료 조건

1. `classifyRejectionBasis` 가 관찰 데이터 80건 전부를 정확히 분류한다. 잘못된 `verified` 가
   0건이다.
2. 크래시 탐침에서 나온 본문 4건이 전부 `unverified` 다. 특히 FastMCP 의
   `Error executing tool get_weather: 2 validation errors for WeatherResponse`(응답 모델 검증
   실패)가 `unverified` 여야 한다. 같은 파일의 정상 거절 탐침 2건은 `verified` 다.
   탐침 실행은 13회였지만 응답 본문이 남은 것은 6건이다. 나머지는 프로세스가 죽어
   `PROCESS_EXITED` 로 끝났고 본문이 없다.
3. `ohmymcp test` 요약에 확인 못 한 건수가 나온다. 0건이면 그 줄이 안 나온다.
4. 같은 명세를 같은 서버에 2회 실행해 `--json` 출력 바이트가 같다.
5. `pnpm test` · `pnpm typecheck` 가 통과하고 기존 케이스 판정이 하나도 안 바뀐다.

## 3. 아키텍처

### 3.1 배치

```
runner/src/rejection-basis.ts   분류 규칙 (신규, 순수 함수)
runner/src/executor.ts          케이스 결과에 분류를 싣는다
runner/src/reporter.ts          test 화면에 요약 줄을 그린다
cli/src/generate-command.ts     승인 화면에 표시 + AI 진단 진입점
generate/src/rejection-diagnosis.ts   AI 요청·응답 (신규)
```

의존 방향은 그대로다. `runner` 는 아무 것도 새로 의존하지 않는다. 분류는 응답 본문 문자열만
보는 순수 함수다.

### 3.2 공개 계약

```ts
/** 거절을 기대한 케이스에서, 그 거절의 근거를 확인했는지. */
export type RejectionBasis =
  /** SDK 검증이 낸 거절임을 지문으로 확인했다. */
  | "verified"
  /** 거절인지 다른 실패인지 확인하지 못했다. 크래시일 수도 있다. */
  | "unverified"
  /** 거절을 기대하지 않는 케이스다. 판정 대상이 아니다. */
  | "notApplicable";

export interface TestCaseResult {
  spec: TestCaseSpec;
  status: "passed" | "failed" | "timedOut" | "cancelled" | "notRun";
  operation: OperationResult;
  assertions: AssertionResult[];
  /** 추가 필드. 기존 소비자는 무시해도 동작한다. */
  rejectionBasis: RejectionBasis;
}

export interface RunnerSummary {
  total: number;
  passed: number;
  failed: number;
  timedOut: number;
  cancelled: number;
  notRun: number;
  /** 추가 필드. rejectionBasis 가 "unverified" 인 케이스 수. */
  rejectionUnverified: number;
}
```

`RunnerReport.schemaVersion` 은 `1` 을 유지한다. 두 필드 다 **추가**이고 기존 필드의 의미가
바뀌지 않는다. 기존 `--json` 소비자는 새 키를 무시하면 종전과 같은 결과를 읽는다.

## 4. 판정 규칙

### 4.1 분류 함수 (전량)

판단이 갈리는 로직이므로 전량으로 적는다. 특히 세 번째 지문의 툴 이름 조건이 이 설계의
안전성을 지탱한다.

```ts
/**
 * 거절 근거를 확인한다. 서버를 호출하지 않는다.
 *
 * 화이트리스트다. 모르는 서버·SDK 는 전부 "unverified" 로 떨어진다. 그 방향이 안전한 쪽이다.
 * 반대 방향(크래시를 "verified" 로 찍는 것)은 크래시가 숨는다는 뜻이라 허용하지 않는다.
 */
export function classifyRejectionBasis(options: {
  readonly expectsRejection: boolean;
  readonly toolName: string | null;
  readonly bodyText: string | null;
}): RejectionBasis {
  const { expectsRejection, toolName, bodyText } = options;
  if (!expectsRejection) return "notApplicable";
  if (bodyText === null) return "unverified";
  const text = bodyText.trimStart();

  // TS SDK. 프로토콜 검증이 낸 잘못된 인자 오류다. 핸들러 코드는 이 접두어를 만들지 않는다.
  if (text.startsWith("MCP error -32602:")) return "verified";

  // Python 하위 SDK. jsonschema 검증 자리에서만 나온다.
  if (text.startsWith("Input validation error:")) return "verified";

  // FastMCP + pydantic. 여기가 위험한 자리다. FastMCP 는 **핸들러가 던진 예외도** 같은
  // 접두어로 감싼다. 실제로 서버가 자기 응답을 pydantic 으로 검증하다 터지면
  //   "Error executing tool get_weather: 2 validation errors for WeatherResponse"
  // 가 나온다. 입력 검증이 낸 것은 모델 이름이 반드시 `<툴이름>Arguments` 다.
  //   "Error executing tool get_weather: 1 validation error for get_weatherArguments"
  // 그래서 툴 이름을 두 번 요구한다. 이 조건을 빼면 서버 결함이 초록으로 숨는다.
  if (toolName !== null) {
    const pattern = new RegExp(
      `^Error executing tool ${escapeRegExp(toolName)}: \\d+ validation errors? for ${escapeRegExp(toolName)}Arguments\\b`,
    );
    if (pattern.test(text)) return "verified";
  }

  return "unverified";
}

/** 툴 이름은 서버가 준 임의 문자열이다. 정규식 메타문자가 들어와도 리터럴로 다뤄야 한다. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

### 4.2 호출 지점

`executor.ts` 의 케이스 루프에서 단언 평가가 끝난 뒤 한 번 계산한다.

- `expectsRejection` 은 `expectedIsError(spec) === true` 다. `null`(단언이 없거나 모순)이면
  `false` 로 본다. 모순 명세를 여기서 해석하지 않는다.
- `toolName` 은 `spec.operation.type === "callTool"` 일 때 `spec.operation.tool` 이고, 그 밖에는
  `null` 이다.
- `bodyText` 는 `extractResponseBody` 가 이미 읽은 값을 재사용한다. 케이스당 추출은 한 번이라는
  현재 규칙(ADR-0027 배선)을 깨지 않는다. 응답을 못 읽었으면 `null` 이다.
- 던져진 케이스(`operation.status === "failed"`)는 본문이 없으므로 `unverified` 다. 관찰에서
  `server-github` 12건이 여기 해당하고, 그 서버는 정상 거절이었다. **이것이 오탐이 아니라
  "모른다" 인 이유가 §4.3 이다.**

### 4.3 왜 실패로 만들지 않는가

관찰에서 `unverified` 16건의 정체는 전부 정상 거절이었다.

| 확인 못 한 것 | 건수 | 실제 |
|---|---|---|
| `server-github` (던져짐, cause `-32603`) | 12 | 정상 거절 |
| `examples/weather-server` (손으로 쓴 문장) | 4 | 정상 거절 |

`unverified` 를 실패로 올리면 서버 11개 중 2개가 통째로 빨개진다. 우리 예제 서버가 포함된다.
ADR-0015 의 원칙("오탐 1건이 미탐 1건보다 비싸다")이 그대로 적용된다.

`unverified` 는 **"거절이 아니다" 가 아니라 "확인하지 못했다"** 는 뜻이다. 화면 문구도 그렇게
쓴다(§5).

## 5. 출력 계약

문안을 전량으로 고정한다. 실패 메시지가 곧 제품이고, 이 화면은 "확인 못 함" 을 "결함" 으로
오해시키면 안 된다.

### 5.1 `test` 요약

기존 요약 아래에 한 줄을 더한다. `rejectionUnverified` 가 0이면 **아무 줄도 안 찍는다.**

```
2 passed

  → 거절을 기대한 케이스 3건은 거절 근거를 확인하지 못했습니다.
    서버가 거절한 것인지 다른 이유로 실패한 것인지 이 도구는 판단하지 못합니다.
    확인: ohmymcp generate 의 승인 화면에서 해당 케이스의 응답을 확인하세요.
```

케이스 목록에는 표시하지 않는다. 통과한 케이스 옆에 기호를 더하면 판정이 바뀐 것으로 읽힌다.

### 5.2 `generate` 승인 화면

시험 실행 결과 블록 아래에 붙인다. 케이스 id 를 나열해 사용자가 어느 것인지 알 수 있게 한다.

```
거절 근거 미확인 2건
  → fetch-url-required   응답: Input validation error: 'url' is a required property
  → fetch-url-type       응답: 12345 is not of type 'string'
  이 응답이 서버의 정상 거절인지 내부 오류인지 확인하지 못했습니다.
```

응답 본문은 한 줄로 자른다. 자르는 규칙은 기존 진단 렌더러(`renderProcessDiagnostics`)의 줄
분할·이스케이프 규칙을 그대로 쓴다. 제어 문자가 터미널을 깨뜨리면 안 된다.

## 6. AI 진단 통로

### 6.1 어디에 두는가

`generate` 의 승인 화면이다. 근거 셋이다.

- `test` 는 CI 에서 도는 명령이고 오프라인·결정론이 그 성격이다. provider 를 들이면 그 성격이
  바뀐다.
- `repair` 는 **실패가 있어야** 도달한다. 우리가 다루는 케이스는 통과한 케이스라 그 통로로는
  영영 도달하지 않는다.
- `generate` 승인 화면에는 **사람이 이미 앉아 있고**, 저장할지 말지 결정할 일이 그 자리에 있다.
  참고 의견이 붙을 판단이 실제로 존재한다.

### 6.2 계약

```ts
export interface RejectionDiagnosisRequest {
  readonly caseId: string;
  readonly tool: string;
  /** 우리가 보낸 입력. redaction 이 적용된 값이다. */
  readonly input: JsonObject;
  /** 서버가 선언한 입력 스키마. */
  readonly inputSchema: JsonObject;
  /** 서버 응답 본문. redaction 이 적용된 값이다. */
  readonly responseBody: string;
}

export type RejectionVerdict =
  /** 서버가 자기 코드로 정상 거절한 것으로 보인다. */
  | "rejected"
  /** 서버 내부 오류로 보인다. */
  | "crashed"
  /** 판단하지 못하겠다. */
  | "unsure";

export interface RejectionDiagnosisResult {
  readonly caseId: string;
  readonly verdict: RejectionVerdict;
  /** 근거 한 문장. 화면에 그대로 나간다. */
  readonly reason: string;
}
```

### 6.3 규칙

- **판정을 바꾸지 않는다.** AI 결과는 화면에만 나온다. 케이스 결과, 종료 코드, `--json`,
  `RunnerReport` 어디에도 안 들어간다. AI 출력은 비결정적이므로 판정에 들어가면 같은 입력에 다른
  결과가 나온다(ADR-0006 · ADR-0025 와 같은 선).
- **대상은 `unverified` 케이스뿐이다.** `verified` 는 이미 확인됐고, `notApplicable` 은 대상이
  아니다.
- **`unsure` 를 허용한다.** repair 의 `unsure` 와 같은 취급이다. AI 가 모르면 모른다고 답하는
  것이 답을 지어내는 것보다 낫다.
- **전송이므로 redaction 을 적용한다.** 입력과 응답 본문이 provider 로 나간다. ADR-0033 의
  경계를 그대로 쓴다. 새 규칙을 만들지 않는다.
- **호출은 사용자가 시작한다.** 승인 화면의 메뉴 항목이다. 자동으로 부르지 않는다. 케이스가
  많으면 비용이 곱해지고, provider 가 없는 사용자가 대다수다.

### 6.4 화면

```
거절 근거 미확인 2건에 대해 AI 진단을 요청했습니다.

  fetch-url-required   거절로 보임
    → 응답이 JSON Schema 검증기의 문구이고 누락된 필드 이름을 정확히 지목합니다.
  fetch-url-type       판단 불가
    → 응답이 값만 언급하고 서버가 어느 단계에서 실패했는지 드러내지 않습니다.

이 진단은 참고입니다. 케이스 판정과 저장 여부를 바꾸지 않습니다.
```

마지막 줄을 뺄 수 없다. AI 답변이 판정으로 읽히면 사용자가 초록·빨강을 잘못 해석한다.

## 7. 결정론성

- 분류는 응답 본문 문자열에 대한 순수 함수다. 타임스탬프·난수·실행 순서에 의존하지 않는다.
- 같은 서버가 같은 입력에 같은 응답을 주면 분류도 같다. 서버가 응답을 바꾸면 분류가 바뀔 수
  있는데, 그것은 서버가 바뀐 것이지 우리 도구의 비결정이 아니다.
- AI 결과는 보고서에 안 들어가므로 `--json` 은 종전대로 결정론적이다.
- 승인 지문은 명세에서 계산하므로(ADR-0017) 이 변경의 영향을 받지 않는다.

## 8. 테스트

### 8.1 `runner` 유닛 (`packages/runner/tests/rejection-basis.test.ts`)

관찰 데이터를 픽스처로 고정한다. 픽스처 경로는
`packages/runner/tests/fixtures/rejection-bodies.json` 이고, 관찰 문서 §9 의 응답 본문을 서버별로
담는다.

| 케이스 이름 | 입력 | 기대 |
|---|---|---|
| `TS SDK 의 -32602 응답을 확인한다` | `MCP error -32602: Input validation error: …` | `verified` |
| `Python 하위 SDK 의 검증 오류를 확인한다` | `Input validation error: 'url' is a required property` | `verified` |
| `FastMCP 의 입력 검증 오류를 확인한다` | `Error executing tool calculate: 1 validation error for calculateArguments…` | `verified` |
| `FastMCP 가 응답 모델 검증에서 터진 것은 확인하지 않는다` | `Error executing tool get_weather: 2 validation errors for WeatherResponse…` | `unverified` |
| `툴 이름이 다른 Arguments 모델은 확인하지 않는다` | `Error executing tool a: 1 validation error for bArguments` | `unverified` |
| `핸들러 예외 문구는 확인하지 않는다` | `Cannot read properties of undefined (reading 'city')` | `unverified` |
| `손으로 쓴 거절 문장은 확인하지 않는다` | `→ 'city' 는 문자열이어야 합니다.` | `unverified` |
| `본문이 없으면 확인하지 않는다` | `null` | `unverified` |
| `거절을 기대하지 않으면 판정 대상이 아니다` | `expectsRejection: false` | `notApplicable` |
| `툴 이름의 정규식 메타문자를 리터럴로 다룬다` | 툴 이름 `a.b`, 본문 `Error executing tool a.b: 1 validation error for aXbArguments` | `unverified` |

마지막 케이스가 `escapeRegExp` 의 사양이다. 이스케이프를 빼면 `a.b` 의 `.` 이 임의 문자와 맞아
`aXbArguments` 를 `verified` 로 찍는다.

### 8.2 `runner` 통합

- 관찰 데이터 80건 전량을 픽스처(`packages/runner/tests/fixtures/rejection-bodies.json`)로
  돌려 분류가 `verified` 64 · `unverified` 16 로 나오는 것을 단언한다.
- 탐침 본문 6건(크래시 4 · 정상 거절 2)을 픽스처로 돌려 크래시 4건이 전부 `unverified` 임을
  단언한다.
- 기존 스위트 실행에서 케이스 판정과 종료 코드가 하나도 안 바뀌는 것을 단언한다.

### 8.3 `cli`

- `rejectionUnverified` 가 0이면 요약에 줄이 안 나온다.
- 1 이상이면 §5.1 문안이 그대로 나온다.
- `--json` 출력에 `rejectionBasis` 와 `rejectionUnverified` 가 실린다.
- `examples/weather-server` 에 같은 명세를 2회 실행해 `--json` 바이트가 같다.

### 8.4 `generate`

- `unverified` 케이스만 AI 요청에 실린다.
- provider 가 없으면 메뉴 항목이 안 뜨거나 안내가 나간다(기존 provider 부재 처리와 같은 규칙).
- AI 결과가 케이스 판정·저장 여부를 안 바꾼다.
- 전송 페이로드에 redaction 이 적용된다.

## 9. 한계

이 설계가 못 하는 것을 적는다. 사용자에게도 같은 문장으로 알린다.

- **손으로 거절하는 서버의 크래시는 못 잡는다.** 그 서버는 거절도 크래시도 자유 문장이라
  원리적으로 구분되지 않는다. 우리 `examples/weather-server` 가 그 예다.
- **화이트리스트는 낡는다.** SDK 가 문구를 바꾸면 `verified` 가 `unverified` 로 떨어진다. 소음이
  느는 방향이라 안전하지만, 지문이 낡았다는 사실을 알아야 한다. §8.2 의 관찰 픽스처 테스트가
  그 감시 장치다. SDK 버전을 올릴 때 이 테스트를 함께 본다.
- **Go·JVM 구현 서버는 관찰하지 못했다.** 전부 `unverified` 로 떨어진다.
- **AI 진단은 참고다.** 틀릴 수 있고, 틀려도 판정은 안 바뀐다.

## 10. 후속

- 관찰 §8 이 찾은 별개 결함(Python 상위 API 에서 async 작업이 실패해도 응답이 정상이라 케이스가
  통과)은 이 설계 범위 밖이다. 별도 이슈로 등록한다.
- `errorBodyContains` 단언을 만들지는 별도 판단이다. 이 설계는 그것 없이 성립한다.
- 지문 목록이 셋을 넘어가면 그때 확장 방식(사용자 정의 허용 여부)을 다시 본다. 지금은 셋
  고정이다.
