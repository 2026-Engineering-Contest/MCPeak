# 거절 근거 확인 구현 계획 (이슈 #89)

> **실행자에게:** 이 계획은 태스크 단위로 실행한다. 각 터미널은 §7 의 실행 프롬프트를 그대로
> 붙여넣어 시작한다. 스텝은 체크박스(`- [ ]`)로 추적한다.

**목표:** 거절을 기대한 케이스마다 "거절 근거를 확인했는가" 를 판정해 결과에 싣고, 확인하지
못한 케이스를 사용자에게 알린다. 판정과 종료 코드는 바꾸지 않는다.

**접근:** `runner` 가 응답 본문만 보는 순수 함수로 분류한다. 지문 셋을 화이트리스트로 두고,
모르는 것은 전부 `unverified`(모른다)로 떨어뜨린다. 확인하지 못한 케이스는 `generate` 승인
화면에서 AI 에게 참고 의견을 물을 수 있다.

**기술 스택:** TypeScript, vitest, pnpm workspace. 새 의존성 없음.

**설계 문서:** `docs/superpowers/specs/2026-08-18-rejection-basis-verification-design.md`
(실행자는 계획서와 설계 문서를 함께 읽는다.)

## 전역 제약

모든 태스크에 적용된다. 태스크별 요구사항에 암묵적으로 포함된다.

- **`core/src/types.ts` 의 `McpClient` · `ToolResult` 를 수정하지 않는다.** 5인 병렬 작업의
  기준점이다. 필요해 보이면 수정하지 말고 보고한다.
- **`@modelcontextprotocol/sdk` 는 1.x 고정.** `^` 를 붙이지 않는다.
- **목록에 없는 의존성을 추가하지 않는다.** 이 계획은 새 의존성이 필요 없다.
- **의존 방향은 단방향이다:** `cli` → `runner`/`generate`/`record`/`mock` → `core`. 역참조·순환
  금지.
- **자기 태스크의 Files 목록 밖 파일을 수정하지 않는다.** 특히 다른 오너의 패키지, 루트 빌드
  설정(`turbo.json` · `tsconfig.base.json` · `package.json`)은 공유 계약이다.
- **커밋·푸시는 사람이 한다.** 서브에이전트는 git 명령을 실행하지 않는다.
- **유닛테스트는 인메모리와 `fixtures/` 만 쓴다.** `examples/` 의 실제 서버 프로세스를 띄우는
  검증은 직렬 웨이브(W5)에서만 한다.
- **`RunnerReport.schemaVersion` 은 `1` 을 유지한다.** 이 계획의 필드는 전부 추가이고 기존
  필드의 의미를 바꾸지 않는다.
- 커밋 메시지는 한국어, Conventional Commits, scope 필수.

## 1. 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `packages/runner/src/rejection-basis.ts` | 분류 규칙. 순수 함수 하나와 타입 하나 | T1 |
| `packages/runner/tests/fixtures/rejection-bodies.json` | 관찰 80건 + 탐침 6건. **이미 존재한다** | T1 (읽기만) |
| `packages/runner/tests/rejection-basis.test.ts` | 분류 규칙 유닛테스트 | T1 |
| `packages/runner/src/executor.ts` | 케이스 결과와 요약에 분류를 싣는다 | T2 |
| `packages/runner/src/index.ts` | 새 타입을 내보낸다 | T2 |
| `packages/runner/src/reporter.ts` | `test` 요약의 고지 줄 | T3 |
| `packages/cli/src/generate-command.ts` | 승인 화면의 미확인 목록, AI 진단 메뉴 | T4 · T6 |
| `packages/generate/src/rejection-diagnosis.ts` | AI 요청 조립과 응답 검증 | T5 |
| `packages/generate/src/index.ts` | 새 타입과 함수를 내보낸다 | T5 |

## 2. 태스크

### Task T1: 분류 규칙 (`runner`)

**Files**
- 생성: `packages/runner/src/rejection-basis.ts`
- 생성: `packages/runner/tests/rejection-basis.test.ts`
- 읽기: `packages/runner/tests/fixtures/rejection-bodies.json` (이미 커밋돼 있다. 고치지 마라)

**인터페이스**
- 소비: 없음
- 산출: 아래 시그니처를 T2 가 그대로 쓴다.

```ts
export type RejectionBasis = "verified" | "unverified" | "notApplicable";

export function classifyRejectionBasis(options: {
  readonly expectsRejection: boolean;
  readonly toolName: string | null;
  readonly bodyText: string | null;
}): RejectionBasis;
```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/runner/tests/rejection-basis.test.ts` 에 아래 케이스를 전량 만든다. 케이스 이름과
단언이 곧 사양이다.

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyRejectionBasis } from "../src/rejection-basis.js";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/rejection-bodies.json", import.meta.url)), "utf8"),
) as {
  관찰: { source: string; tool: string; kind: string; body: string | null; expected: string }[];
  탐침: { source: string; tool: string; kind: string; body: string | null; expected: string }[];
};

const classify = (tool: string | null, body: string | null) =>
  classifyRejectionBasis({ expectsRejection: true, toolName: tool, bodyText: body });

describe("classifyRejectionBasis", () => {
  it("거절을 기대하지 않는 케이스는 판정 대상이 아니다", () => {
    expect(
      classifyRejectionBasis({ expectsRejection: false, toolName: "t", bodyText: "무엇이든" }),
    ).toBe("notApplicable");
  });

  it("본문이 없으면 확인하지 않는다", () => {
    expect(classify("t", null)).toBe("unverified");
  });

  it("TS SDK 의 -32602 응답을 확인한다", () => {
    expect(
      classify(
        "echo",
        "MCP error -32602: Input validation error: Invalid arguments for tool echo: Invalid input: expected string, received number at message",
      ),
    ).toBe("verified");
  });

  it("Python 하위 SDK 의 검증 오류를 확인한다", () => {
    expect(classify("fetch", "Input validation error: 'url' is a required property")).toBe(
      "verified",
    );
  });

  it("FastMCP 의 입력 검증 오류를 확인한다", () => {
    expect(
      classify(
        "calculate",
        "Error executing tool calculate: 1 validation error for calculateArguments\nexpression\n  Field required",
      ),
    ).toBe("verified");
  });

  it("errors 복수형도 확인한다", () => {
    expect(
      classify(
        "calculate",
        "Error executing tool calculate: 2 validation errors for calculateArguments\nexpression\n  Field required",
      ),
    ).toBe("verified");
  });

  it("FastMCP 가 응답 모델 검증에서 터진 것은 확인하지 않는다", () => {
    expect(
      classify(
        "get_weather",
        "Error executing tool get_weather: 2 validation errors for WeatherResponse\ntemperature\n  Input should be a valid number",
      ),
    ).toBe("unverified");
  });

  it("툴 이름이 다른 Arguments 모델은 확인하지 않는다", () => {
    expect(classify("a", "Error executing tool a: 1 validation error for bArguments")).toBe(
      "unverified",
    );
  });

  it("핸들러 예외 문구는 확인하지 않는다", () => {
    expect(classify("get_weather", "Cannot read properties of undefined (reading 'city')")).toBe(
      "unverified",
    );
  });

  it("손으로 쓴 거절 문장은 확인하지 않는다", () => {
    expect(classify("get_weather", "→ 'city' 는 문자열이어야 합니다.")).toBe("unverified");
  });

  it("툴 이름의 정규식 메타문자를 리터럴로 다룬다", () => {
    // 이스케이프를 빼면 `a.b` 의 `.` 이 임의 문자와 맞아 `aXbArguments` 를 verified 로 찍는다.
    expect(
      classify("a.b", "Error executing tool a.b: 1 validation error for aXbArguments"),
    ).toBe("unverified");
  });

  it("툴 이름이 null 이면 FastMCP 지문을 쓰지 않는다", () => {
    expect(
      classify(null, "Error executing tool calculate: 1 validation error for calculateArguments"),
    ).toBe("unverified");
  });

  it("앞쪽 공백을 무시한다", () => {
    expect(classify("fetch", "  Input validation error: 'url' is a required property")).toBe(
      "verified",
    );
  });

  it("관찰 80건을 픽스처가 적은 대로 분류한다", () => {
    const actual = fixture.관찰.map((row) => classify(row.tool, row.body));
    expect(actual).toEqual(fixture.관찰.map((row) => row.expected));
    expect(actual.filter((value) => value === "verified")).toHaveLength(64);
    expect(actual.filter((value) => value === "unverified")).toHaveLength(16);
  });

  it("탐침 6건을 픽스처가 적은 대로 분류한다", () => {
    const actual = fixture.탐침.map((row) => classify(row.tool, row.body));
    expect(actual).toEqual(fixture.탐침.map((row) => row.expected));
    // 크래시 4건이 하나도 verified 로 새지 않는다. 이 단언이 이 설계의 안전선이다.
    const crashes = fixture.탐침.filter((row) => row.expected === "unverified");
    expect(crashes).toHaveLength(4);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

실행: `pnpm vitest run packages/runner/tests/rejection-basis.test.ts`
기대: 모듈을 찾지 못해 실패한다.

- [ ] **Step 3: 구현한다**

`packages/runner/src/rejection-basis.ts` 를 설계 문서 §4.1 의 코드 그대로 만든다. 주석도
그대로 옮긴다. 세 번째 지문이 툴 이름을 두 번 요구하는 이유가 주석에 남아야 한다. 그 근거를
모르면 다음 사람이 조건을 단순화하고, 그러면 서버 결함이 초록으로 숨는다.

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

실행: `pnpm vitest run packages/runner/tests/rejection-basis.test.ts`
기대: 전량 통과.

- [ ] **Step 5: 회귀를 확인한다**

실행: `pnpm test` · `pnpm typecheck`
기대: 통과. 기존 케이스 판정이 하나도 안 바뀐다.

---

### Task T2: 케이스 결과와 요약에 싣는다 (`runner`)

**Files**
- 수정: `packages/runner/src/executor.ts`
- 수정: `packages/runner/src/index.ts`
- 수정: `packages/runner/tests/executor.test.ts`

**인터페이스**
- 소비: T1 의 `classifyRejectionBasis` · `RejectionBasis`
- 산출: T3 · T4 가 아래 필드를 읽는다.

```ts
export interface TestCaseResult {
  spec: TestCaseSpec;
  status: "passed" | "failed" | "timedOut" | "cancelled" | "notRun";
  operation: OperationResult;
  assertions: AssertionResult[];
  rejectionBasis: RejectionBasis; // 추가
}

export interface RunnerSummary {
  total: number;
  passed: number;
  failed: number;
  timedOut: number;
  cancelled: number;
  notRun: number;
  rejectionUnverified: number; // 추가. rejectionBasis 가 "unverified" 인 케이스 수
}
```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/runner/tests/executor.test.ts` 에 아래 네 케이스를 더한다. 기존 헬퍼와 목 클라이언트를
그대로 쓴다.

```ts
it("거절을 기대한 케이스의 응답 본문으로 rejectionBasis 를 채운다", async () => {
  // isError: true 를 기대하는 케이스 + 서버가 TS SDK 지문으로 거절한 응답
  // 기대: result.cases[0].rejectionBasis === "verified"
});

it("지문에 안 걸리면 unverified 다", async () => {
  // 같은 케이스 + 서버가 "→ 'city' 는 문자열이어야 합니다." 로 거절
  // 기대: "unverified"
});

it("거절을 기대하지 않는 케이스는 notApplicable 이다", async () => {
  // isError 단언이 없거나 expected: false 인 케이스
  // 기대: "notApplicable"
});

it("요약이 unverified 건수를 센다", async () => {
  // 위 케이스들을 한 스위트에 섞어 실행
  // 기대: report.summary.rejectionUnverified === 1
});
```

단언의 구체 값은 위 주석이 사양이다. 목 클라이언트가 돌려줄 응답은
`{ content: [{ type: "text", text: <본문> }], isError: true }` 형태로 만든다.

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

실행: `pnpm vitest run packages/runner/tests/executor.test.ts`
기대: `rejectionBasis` 가 없어 실패한다.

- [ ] **Step 3: 구현한다**

`executor.ts` 의 케이스 루프에서 단언 평가가 끝난 뒤 한 번 계산한다. 설계 문서 §4.2 가 사양이다.

- `expectsRejection` 은 `expectedIsError(spec) === true` 다. `null` 이면 `false` 로 본다.
- `toolName` 은 `spec.operation.type === "callTool"` 일 때 `spec.operation.tool`, 그 밖에는 `null`.
- `bodyText` 는 **이미 읽은 `readBody()` 결과를 재사용한다.** 새로 추출하지 마라. 케이스당 추출
  한 번이라는 현재 규칙(ADR-0027 배선)을 깨면 통과한 케이스에서 응답을 읽지 않는 지금 동작이
  바뀐다. 본문이 없으면 `null` 이다.
- `RunnerSummary.rejectionUnverified` 는 케이스 순회가 끝난 뒤 `cases` 를 세어 채운다.
- `index.ts` 에서 `RejectionBasis` 타입을 내보낸다.

**주의.** `readBody()` 는 지금 실패한 케이스에서만 호출된다. 거절을 기대한 케이스는 **통과했을
때도** 본문이 필요하다. 호출 조건을 넓히되, 거절을 기대하지 않는 케이스에서는 여전히 안 읽어야
한다. 이 조건을 잘못 넓히면 모든 통과 케이스가 본문을 읽게 되어 §비범위를 벗어난다.

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

실행: `pnpm vitest run packages/runner/tests/executor.test.ts`
기대: 신규 4건 통과, 기존 전량 통과.

- [ ] **Step 5: 회귀를 확인한다**

실행: `pnpm test` · `pnpm typecheck`
기대: 통과. **기존 케이스의 `status` 가 하나도 안 바뀐다.**

---

### Task T3: `test` 요약의 고지 줄 (`runner`)

**Files**
- 수정: `packages/runner/src/reporter.ts`
- 수정: `packages/runner/tests/reporter.test.ts`

**인터페이스**
- 소비: T2 의 `RunnerSummary.rejectionUnverified`
- 산출: 없음

- [ ] **Step 1: 실패하는 테스트를 쓴다**

문안이 곧 제품이다. 아래 두 케이스를 문자열 단언으로 못 박는다.

```ts
it("확인 못 한 케이스가 없으면 고지 줄이 안 나온다", () => {
  // summary.rejectionUnverified === 0 인 보고서
  // 기대: 출력에 "거절 근거" 가 포함되지 않는다
});

it("확인 못 한 케이스가 있으면 건수와 안내를 찍는다", () => {
  // summary.rejectionUnverified === 3 인 보고서
  // 기대 출력에 아래 세 줄이 순서대로 들어 있다:
  //   "  → 거절을 기대한 케이스 3건은 거절 근거를 확인하지 못했습니다."
  //   "    서버가 거절한 것인지 다른 이유로 실패한 것인지 이 도구는 판단하지 못합니다."
  //   "    확인: mcpeak generate 의 승인 화면에서 해당 케이스의 응답을 확인하세요."
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

실행: `pnpm vitest run packages/runner/tests/reporter.test.ts`
기대: 고지 줄이 없어 실패한다.

- [ ] **Step 3: 구현한다**

기존 요약 아래에 붙인다. **케이스 목록에는 아무 표시도 더하지 않는다.** 통과한 케이스 옆에
기호를 더하면 판정이 바뀐 것으로 읽힌다. 색상은 기존 요약과 같은 규칙을 따르고, `colorEnabled`
가 false 면 SGR 을 넣지 않는다.

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

실행: `pnpm vitest run packages/runner/tests/reporter.test.ts`
기대: 전량 통과.

- [ ] **Step 5: 회귀를 확인한다**

실행: `pnpm test` · `pnpm typecheck`

---

### Task T4: 승인 화면의 미확인 목록 (`cli`)

**Files**
- 수정: `packages/cli/src/generate-command.ts`
- 수정: `packages/cli/tests/generate-command.test.ts`

**인터페이스**
- 소비: T2 의 `TestCaseResult.rejectionBasis`
- 산출: T6 이 이 블록 아래에 메뉴 항목을 붙인다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
it("미확인 케이스가 없으면 블록이 안 나온다", async () => {
  // 시험 실행 결과의 모든 케이스가 verified 또는 notApplicable
  // 기대: 화면에 "거절 근거 미확인" 이 없다
});

it("미확인 케이스를 id 와 응답 한 줄로 나열한다", async () => {
  // 케이스 둘이 unverified
  // 기대 출력:
  //   "거절 근거 미확인 2건"
  //   "  → fetch-url-required   응답: Input validation error: 'url' is a required property"
  //   "  → fetch-url-type       응답: 12345 is not of type 'string'"
  //   "  이 응답이 서버의 정상 거절인지 내부 오류인지 확인하지 못했습니다."
});

it("여러 줄 응답을 한 줄로 자르고 제어 문자를 이스케이프한다", async () => {
  // 응답 본문에 "\n" 과 "[31m" 이 섞인 케이스
  // 기대: 출력 한 줄, ESC 가 그대로 나가지 않는다
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

실행: `pnpm vitest run packages/cli/tests/generate-command.test.ts`

- [ ] **Step 3: 구현한다**

시험 실행 결과 블록 아래에 붙인다. 자르기와 이스케이프는 **기존 `escapeTerminalText` 와 진단
렌더러의 규칙을 재사용한다.** 새 규칙을 만들지 마라. 규칙이 두 벌이 되면 화면마다 다르게 잘린다.

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

실행: `pnpm vitest run packages/cli/tests/generate-command.test.ts`

- [ ] **Step 5: 회귀를 확인한다**

실행: `pnpm test` · `pnpm typecheck`

---

### Task T5: AI 진단 요청과 응답 (`generate`)

**Files**
- 생성: `packages/generate/src/rejection-diagnosis.ts`
- 수정: `packages/generate/src/index.ts`
- 생성: `packages/generate/tests/rejection-diagnosis.test.ts`

**인터페이스**
- 소비: 기존 provider 실행 통로(`provider-process.ts`)와 redaction 유틸. 새 통로를 만들지 마라.
- 산출: T6 이 아래를 쓴다.

```ts
export interface RejectionDiagnosisRequest {
  readonly caseId: string;
  readonly tool: string;
  readonly input: JsonObject;
  readonly inputSchema: JsonObject;
  readonly responseBody: string;
}

export type RejectionVerdict = "rejected" | "crashed" | "unsure";

export interface RejectionDiagnosisResult {
  readonly caseId: string;
  readonly verdict: RejectionVerdict;
  readonly reason: string;
}

export type RejectionDiagnosisDispatchResult =
  | { readonly type: "completed"; readonly results: readonly RejectionDiagnosisResult[] }
  | { readonly type: "failed"; readonly failure: PublicProviderFailure };
```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
it("unverified 케이스만 요청에 실린다", () => {
  // verified 1 + unverified 2 를 넘김
  // 기대: 요청 payload 의 케이스가 2건이고 id 가 unverified 쪽과 같다
});

it("전송 payload 에 redaction 이 적용된다", () => {
  // 입력에 토큰처럼 보이는 값과 절대 경로가 섞인 케이스
  // 기대: 기존 redaction 계약(ADR-0033)과 같은 결과
});

it("verdict 가 셋 중 하나가 아니면 응답을 거부한다", () => {
  // provider 가 verdict: "maybe" 를 돌려줌
  // 기대: type === "failed", 사용자에게 나가는 문장에 원인이 적힌다
});

it("reason 이 비면 응답을 거부한다", () => {
  // 기대: type === "failed"
});

it("케이스 id 가 요청에 없던 것이면 거부한다", () => {
  // provider 가 지어낸 id 를 돌려줌
  // 기대: type === "failed"
});

it("정상 응답을 그대로 통과시킨다", () => {
  // verdict 셋과 reason 이 유효
  // 기대: type === "completed", results 길이가 요청과 같다
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

실행: `pnpm vitest run packages/generate/tests/rejection-diagnosis.test.ts`

- [ ] **Step 3: 구현한다**

기존 `diagnosis-request.ts` · `provider-process.ts` 의 구조를 따른다. 프롬프트에는 다음을 적는다.

- 우리가 보낸 입력과 서버가 선언한 스키마
- 서버 응답 본문
- "이 응답이 서버의 의도된 거절인지, 서버 내부 오류인지 판단하라. 확신이 없으면 `unsure` 로
  답하라" 는 지시
- 답변 형식은 `verdict` 와 `reason` 두 필드

**응답 검증을 느슨하게 하지 마라.** 모르는 `verdict` 를 임의로 `unsure` 로 바꾸면 provider 가
형식을 어긴 사실이 숨는다.

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

실행: `pnpm vitest run packages/generate/tests/rejection-diagnosis.test.ts`

- [ ] **Step 5: 회귀를 확인한다**

실행: `pnpm test` · `pnpm typecheck`

---

### Task T6: 승인 화면에 AI 진단을 배선한다 (`cli`)

**Files**
- 수정: `packages/cli/src/generate-command.ts`
- 수정: `packages/cli/tests/generate-command.test.ts`

**인터페이스**
- 소비: T4 의 미확인 목록, T5 의 `RejectionDiagnosisDispatchResult`
- 산출: 없음

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
it("provider 가 없으면 진단 항목이 안 뜬다", async () => {
  // 기대: 메뉴에 진단 항목이 없고, 기존 provider 부재 안내와 같은 규칙으로 처리된다
});

it("미확인이 0건이면 진단 항목이 안 뜬다", async () => {});

it("진단 결과를 케이스별로 찍고 참고임을 명시한다", async () => {
  // 기대 출력:
  //   "  fetch-url-required   거절로 보임"
  //   "    → <reason>"
  //   "  fetch-url-type       판단 불가"
  //   "    → <reason>"
  //   "이 진단은 참고입니다. 케이스 판정과 저장 여부를 바꾸지 않습니다."
});

it("진단 결과가 저장 여부와 케이스 판정을 바꾸지 않는다", async () => {
  // 기대: 진단 전후로 저장 흐름과 결과 JSON 이 같다
});

it("provider 실패는 흐름을 끊지 않는다", async () => {
  // 기대: 실패 안내만 찍고 승인 화면이 이어진다
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

실행: `pnpm vitest run packages/cli/tests/generate-command.test.ts`

- [ ] **Step 3: 구현한다**

호출은 **사용자가 시작한다.** 자동으로 부르지 않는다. `verdict` 를 화면 문구로 옮기는 표는
`Readonly<Record<RejectionVerdict, string>>` 로 둔다. 문자열 배열로 두면 `verdict` 가 늘 때 새
값이 조용히 빠진다.

```ts
const VERDICT_LABEL: Readonly<Record<RejectionVerdict, string>> = {
  rejected: "거절로 보임",
  crashed: "서버 내부 오류로 보임",
  unsure: "판단 불가",
};
```

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

실행: `pnpm vitest run packages/cli/tests/generate-command.test.ts`

- [ ] **Step 5: 회귀를 확인한다**

실행: `pnpm test` · `pnpm typecheck`

## 3. 의존성과 웨이브

```
T1 ──▶ T2 ──▶ T3
              └▶ T4 ──▶ T6
       T5 ─────────────┘
```

| 웨이브 | 태스크 | 병렬 | 선행 |
|---|---|---|---|
| W1 | T1 | 단독 | 없음 |
| W2 | T2 | 단독 | T1 |
| W3 | T3, T4, T5 | 3개 병렬 | T2 (T5 는 선행 없음) |
| W4 | T6 | 단독 | T4, T5 |
| W5 | 실환경 검증 | 직렬 전용 | T6 |

T3·T4·T5 는 쓰는 파일이 겹치지 않는다(`reporter.ts` / `generate-command.ts` / 신규 generate
모듈). T4 와 T6 은 같은 파일을 쓰므로 반드시 순차다.

**PR 은 패키지별로 나눈다.** `runner`(T1~T3), `cli`(T4·T6), `generate`(T5) 셋이다. 한 PR 이 여러
패키지를 건드리지 않는다.

## 4. 모델 배분

| 태스크 | 모델 | 근거 |
|---|---|---|
| T1 | **상위** | 판정 규칙 자체다. 지문 조건을 잘못 단순화하면 서버 결함이 초록으로 숨는다 |
| T2 | 표준 | 배선이고 사양이 명확하다 |
| T3 | **상위** | 화면 문안 설계. 이 프로젝트에서 실패 메시지는 제품이다 |
| T4 | **상위** | 같은 이유 |
| T5 | 표준 | 기존 provider 통로를 따르는 배선이다 |
| T6 | 표준 | 문안은 T4·설계 문서가 이미 고정했다 |

## 5. 완료 조건 (통합 게이트)

1. `pnpm typecheck --force` 가 `Cached: 0 cached` 로 통과한다.
2. `pnpm test` 전량 통과. **기존 케이스 판정과 종료 코드가 하나도 안 바뀐다.**
3. `pnpm biome ci .` 통과.
4. 관찰 픽스처 테스트가 `verified` 64 · `unverified` 16 을 재현한다.
5. 탐침 픽스처의 크래시 4건이 전부 `unverified` 다.
6. `examples/weather-server` 에 같은 명세를 2회 실행해 `--json` 바이트가 같다.
7. `pnpm build` 후 `pnpm --filter @mcpeak/cli test:e2e` 통과.

## 6. 사람이 할 사전 확인 (2줄)

```sh
git log --oneline -1     # 기점 커밋 확인
git status --short       # 깨끗한지 확인
```

## 7. 실행 프롬프트

각 프롬프트는 단독 실행 단위다. 프로젝트 루트에서 터미널을 열고 그대로 붙여넣는다.
`<기점SHA>` 는 사람이 §6 에서 확인한 값으로 바꾼다.

### W1 · T1 (권장: 상위 모델, 추론 수준 높음, 구현 에이전트)

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.
  git worktree add .claude/worktrees/mcpeak-t1 -b feat/rejection-basis-rule <기점SHA>
를 실행한 뒤 그 경로로 세션을 옮겨라. 이어서 pnpm install 을 돌려라.
진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 BLOCKED 로 보고해라:
  - pwd 가 .claude/worktrees/mcpeak-t1 인지
  - git log --oneline -1 이 <기점SHA> 인지
  - docs/superpowers/plans/2026-08-18-rejection-basis-verification-implementation.md 와
    docs/superpowers/specs/2026-08-18-rejection-basis-verification-design.md 가 존재하는지
  - packages/runner/tests/fixtures/rejection-bodies.json 이 존재하는지
  - git status --short 가 비어 있는지
  - pnpm vitest --version 이 실행되는지

[2단계: 실행] 너는 Task T1 의 구현자다.
계획서의 Task T1 을 스텝 순서대로 수행해라. 설계 문서 §4.1 이 분류 함수의 사양이다.
허용 Files 는 다음뿐이다:
  - 생성 packages/runner/src/rejection-basis.ts
  - 생성 packages/runner/tests/rejection-basis.test.ts
packages/runner/tests/fixtures/rejection-bodies.json 은 읽기만 해라. 고치지 마라.
그 밖의 파일은 수정 금지다. 특히 core/src/types.ts, 루트 빌드 설정, 다른 패키지는
공유 계약이다. 필요해 보이면 수정하지 말고 보고해라.
git 명령을 실행하지 마라. 커밋·푸시·머지는 사람이 한다. 백그라운드 실행과 하위 에이전트
스폰도 금지다. 다른 작업자의 변경을 되돌리지 마라.
검증 명령: pnpm vitest run packages/runner/tests/rejection-basis.test.ts, pnpm test, pnpm typecheck
보고서를 docs/reports/task-t1-rejection-basis.md 에 써라.
최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작하고, 변경 파일, 검증 명령과
결과, 보고서 경로, 남은 위험을 포함해라.
```

### W2 · T2 (권장: 표준 모델, 추론 수준 중간, 구현 에이전트)

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.
  git worktree add .claude/worktrees/mcpeak-t2 -b feat/rejection-basis-wiring <T1통합SHA>
를 실행한 뒤 그 경로로 세션을 옮겨라. 이어서 pnpm install 을 돌려라.
진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 BLOCKED 로 보고해라:
  - pwd 가 .claude/worktrees/mcpeak-t2 인지
  - git log --oneline -1 이 <T1통합SHA> 인지
  - packages/runner/src/rejection-basis.ts 가 존재하는지 (T1 산출물)
  - 계획서와 설계 문서가 존재하는지
  - git status --short 가 비어 있는지
  - pnpm vitest --version 이 실행되는지

[2단계: 실행] 너는 Task T2 의 구현자다.
계획서의 Task T2 를 스텝 순서대로 수행해라. 설계 문서 §4.2 가 호출 지점의 사양이다.
허용 Files 는 다음뿐이다:
  - 수정 packages/runner/src/executor.ts
  - 수정 packages/runner/src/index.ts
  - 수정 packages/runner/tests/executor.test.ts
특히 주의할 것: readBody() 는 지금 실패한 케이스에서만 호출된다. 거절을 기대한 케이스는
통과했을 때도 본문이 필요하다. 호출 조건을 넓히되 거절을 기대하지 않는 케이스에서는 여전히
읽지 않아야 한다. RunnerReport.schemaVersion 은 1 을 유지해라.
그 밖의 파일은 수정 금지다. core/src/types.ts 와 루트 빌드 설정은 공유 계약이다.
git 명령을 실행하지 마라. 백그라운드 실행과 하위 에이전트 스폰도 금지다.
검증 명령: pnpm vitest run packages/runner/tests/executor.test.ts, pnpm test, pnpm typecheck
보고서를 docs/reports/task-t2-rejection-basis-wiring.md 에 써라.
최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작해라.
```

### W3 · T3 (권장: 상위 모델, 추론 수준 높음, 구현 에이전트)

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.
  git worktree add .claude/worktrees/mcpeak-t3 -b feat/rejection-basis-reporter <T2통합SHA>
를 실행한 뒤 그 경로로 세션을 옮겨라. 이어서 pnpm install 을 돌려라.
진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 BLOCKED 로 보고해라:
  - pwd 가 .claude/worktrees/mcpeak-t3 인지
  - git log --oneline -1 이 <T2통합SHA> 인지
  - RunnerSummary 에 rejectionUnverified 가 있는지 (T2 산출물)
  - 계획서와 설계 문서가 존재하는지
  - git status --short 가 비어 있는지
  - pnpm vitest --version 이 실행되는지

[2단계: 실행] 너는 Task T3 의 구현자다.
계획서의 Task T3 을 스텝 순서대로 수행해라. 설계 문서 §5.1 이 문안의 사양이고, 그 문장을
한 글자도 바꾸지 마라. 이 프로젝트에서 실패 메시지는 제품이다.
허용 Files 는 다음뿐이다:
  - 수정 packages/runner/src/reporter.ts
  - 수정 packages/runner/tests/reporter.test.ts
케이스 목록에는 아무 표시도 더하지 마라. 통과한 케이스 옆의 기호는 판정이 바뀐 것으로 읽힌다.
colorEnabled 가 false 면 SGR 을 넣지 마라.
그 밖의 파일은 수정 금지다. git 명령을 실행하지 마라. 하위 에이전트 스폰 금지다.
검증 명령: pnpm vitest run packages/runner/tests/reporter.test.ts, pnpm test, pnpm typecheck
보고서를 docs/reports/task-t3-rejection-basis-reporter.md 에 써라.
최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작해라.
```

### W3 · T4 (권장: 상위 모델, 추론 수준 높음, 구현 에이전트)

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.
  git worktree add .claude/worktrees/mcpeak-t4 -b feat/rejection-basis-approval-screen <T2통합SHA>
를 실행한 뒤 그 경로로 세션을 옮겨라. 이어서 pnpm install 을 돌려라.
진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 BLOCKED 로 보고해라:
  - pwd 가 .claude/worktrees/mcpeak-t4 인지
  - git log --oneline -1 이 <T2통합SHA> 인지
  - TestCaseResult 에 rejectionBasis 가 있는지 (T2 산출물)
  - 계획서와 설계 문서가 존재하는지
  - git status --short 가 비어 있는지
  - pnpm vitest --version 이 실행되는지

[2단계: 실행] 너는 Task T4 의 구현자다.
계획서의 Task T4 를 스텝 순서대로 수행해라. 설계 문서 §5.2 가 문안의 사양이고, 그 문장을
한 글자도 바꾸지 마라.
허용 Files 는 다음뿐이다:
  - 수정 packages/cli/src/generate-command.ts
  - 수정 packages/cli/tests/generate-command.test.ts
자르기와 이스케이프는 기존 escapeTerminalText 와 진단 렌더러 규칙을 재사용해라. 새 규칙을
만들면 화면마다 다르게 잘린다.
AI 진단은 이 태스크가 아니다. 표시까지만 해라.
그 밖의 파일은 수정 금지다. 의존 방향은 cli → runner/generate → core 다. 역참조 금지.
git 명령을 실행하지 마라. 하위 에이전트 스폰 금지다.
검증 명령: pnpm vitest run packages/cli/tests/generate-command.test.ts, pnpm test, pnpm typecheck
보고서를 docs/reports/task-t4-rejection-basis-approval.md 에 써라.
최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작해라.
```

### W3 · T5 (권장: 표준 모델, 추론 수준 중간, 구현 에이전트)

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.
  git worktree add .claude/worktrees/mcpeak-t5 -b feat/rejection-diagnosis-provider <기점SHA>
를 실행한 뒤 그 경로로 세션을 옮겨라. 이어서 pnpm install 을 돌려라.
진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 BLOCKED 로 보고해라:
  - pwd 가 .claude/worktrees/mcpeak-t5 인지
  - git log --oneline -1 이 <기점SHA> 인지
  - packages/generate/src/provider-process.ts 와 diagnosis-request.ts 가 존재하는지
  - 계획서와 설계 문서가 존재하는지
  - git status --short 가 비어 있는지
  - pnpm vitest --version 이 실행되는지

[2단계: 실행] 너는 Task T5 의 구현자다.
계획서의 Task T5 를 스텝 순서대로 수행해라. 설계 문서 §6.2·§6.3 이 계약과 규칙의 사양이다.
허용 Files 는 다음뿐이다:
  - 생성 packages/generate/src/rejection-diagnosis.ts
  - 수정 packages/generate/src/index.ts
  - 생성 packages/generate/tests/rejection-diagnosis.test.ts
기존 provider 실행 통로(provider-process.ts)와 redaction 유틸을 재사용해라. 새 통로를 만들지
마라. 전송이므로 ADR-0033 의 redaction 계약이 적용된다. 새 의존성을 추가하지 마라.
응답 검증을 느슨하게 하지 마라. 모르는 verdict 를 임의로 unsure 로 바꾸면 provider 가 형식을
어긴 사실이 숨는다.
그 밖의 파일은 수정 금지다. git 명령을 실행하지 마라. 하위 에이전트 스폰 금지다.
검증 명령: pnpm vitest run packages/generate/tests/rejection-diagnosis.test.ts, pnpm test, pnpm typecheck
보고서를 docs/reports/task-t5-rejection-diagnosis.md 에 써라.
최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작해라.
```

### W4 · T6 (권장: 표준 모델, 추론 수준 중간, 구현 에이전트)

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.
  git worktree add .claude/worktrees/mcpeak-t6 -b feat/rejection-diagnosis-wiring <T4T5통합SHA>
를 실행한 뒤 그 경로로 세션을 옮겨라. 이어서 pnpm install 을 돌려라.
진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 BLOCKED 로 보고해라:
  - pwd 가 .claude/worktrees/mcpeak-t6 인지
  - git log --oneline -1 이 <T4T5통합SHA> 인지
  - packages/generate/src/rejection-diagnosis.ts 가 존재하는지 (T5 산출물)
  - 승인 화면에 "거절 근거 미확인" 블록이 있는지 (T4 산출물)
  - 계획서와 설계 문서가 존재하는지
  - git status --short 가 비어 있는지
  - pnpm vitest --version 이 실행되는지

[2단계: 실행] 너는 Task T6 의 구현자다.
계획서의 Task T6 을 스텝 순서대로 수행해라. 설계 문서 §6.3·§6.4 가 규칙과 문안의 사양이다.
허용 Files 는 다음뿐이다:
  - 수정 packages/cli/src/generate-command.ts
  - 수정 packages/cli/tests/generate-command.test.ts
AI 결과는 케이스 판정, 종료 코드, --json, RunnerReport 어디에도 들어가지 않는다. 화면에만
나온다. "이 진단은 참고입니다. 케이스 판정과 저장 여부를 바꾸지 않습니다." 줄을 빼지 마라.
호출은 사용자가 시작한다. 자동으로 부르지 마라.
verdict 문구 표는 Readonly<Record<RejectionVerdict, string>> 로 둬라. 문자열 배열로 두면
verdict 가 늘 때 새 값이 조용히 빠진다.
그 밖의 파일은 수정 금지다. git 명령을 실행하지 마라. 하위 에이전트 스폰 금지다.
검증 명령: pnpm vitest run packages/cli/tests/generate-command.test.ts, pnpm test, pnpm typecheck
보고서를 docs/reports/task-t6-rejection-diagnosis-wiring.md 에 써라.
최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작해라.
```

### W5 · 실환경 검증 (직렬 전용, 오케스트레이터가 직접 수행)

서브에이전트에 넘기지 않는다. 실제 외부 서버를 띄우므로 직렬 웨이브다.

1. `pnpm build --force` 후 `pnpm --filter @mcpeak/cli test:e2e`.
2. `examples/weather-server` 에 기존 명세를 2회 실행해 `--json` 바이트 비교.
3. 공개 서버 3개(`mcp-server-time` · `server-memory` · `mcp-server-calculator`)에 `generate`
   를 돌려 화면에 `거절 근거 미확인` 블록이 관찰과 같은 건수로 나오는지 대조한다. 기대값은
   `server-memory` 0건, `mcp-server-time` 2건(타입 위반 쪽), `mcp-server-calculator` 0건이다.
4. 결과를 `docs/adoption.md` 에 누적 기록한다.

## 8. 자체 검토

- 설계 문서의 각 절이 태스크에 대응한다. §4.1→T1, §4.2→T2, §5.1→T3, §5.2→T4, §6.2·§6.3→T5,
  §6.3·§6.4→T6, §8→각 태스크의 테스트 스텝, §7 결정론성→통합 게이트 6번.
- 플레이스홀더 없음. 문안과 테스트 케이스 이름은 전량으로 적었다.
- 타입 이름이 태스크 사이에서 일치한다: `RejectionBasis`(T1→T2), `rejectionBasis`(T2→T4),
  `rejectionUnverified`(T2→T3), `RejectionDiagnosisDispatchResult`(T5→T6).
- 병렬 태스크의 쓰기 파일이 겹치지 않는다. T4 와 T6 은 같은 파일이라 순차로 뒀다.
