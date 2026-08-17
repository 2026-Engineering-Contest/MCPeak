# 스키마 제약 지원과 값 출처 계층 구현 계획

> **에이전트 실행자에게:** 이 계획은 `.claude/conventions/plan.md` 와
> `.claude/conventions/execution.md` 를 따른다. 코드 전량 표기 범위는 그 규약 §5 를 따르며
> `superpowers:writing-plans` 의 "모든 스텝에 완전한 코드" 요구를 덮어쓴다.

**목표:** `generate` 가 서버 선언의 제약 키워드를 읽고 그것을 지키는 입력값을 만든다. 값마다
근거의 유무를 표시해 근거 없는 값에만 AI 를 부른다.

**설계 문서:** `docs/superpowers/specs/2026-08-17-schema-constraint-support-design.md`
(이 계획은 설계서를 근거로 논증한다. 실행자는 둘 다 읽는다.)

**대상 패키지:** `runner`(파트①) · `generate`(파트①) · `cli`(공동)

---

## 전역 제약

설계서와 프로젝트 지침에서 그대로 옮긴 것이다. 모든 태스크의 요구사항에 암묵적으로 포함된다.

- **`core/src/types.ts` 의 `McpClient` · `ToolResult` 는 동결이다.** 이 계획은 건드리지 않는다.
- **의존 방향은 단방향이다.** `cli` → `runner`/`generate` → `core`. 역참조·순환 금지.
- **`@modelcontextprotocol/sdk` 는 1.x 고정이다.** `^` 를 붙이지 않는다. 새 의존성을 추가하지
  않는다. 이 계획에 새 런타임 의존성은 없다.
- **커밋·푸시는 사람이 한다.** 서브에이전트는 git 명령을 실행하지 않는다.
- **유닛테스트는 인메모리와 `fixtures/` 만 쓴다.** 실서버 프로세스를 띄우는 E2E 는 직렬 전용
  웨이브(T12)로 분리한다.
- **결정론성:** 타임스탬프·랜덤값·실행 순서에 의존하는 코드를 넣지 않는다. 같은 서버 선언이면
  같은 baseline 과 같은 `baselineFingerprint` 가 나와야 한다.
- **실패 메시지가 곧 제품이다.** 무엇이 왜 다른지, 어떻게 고치는지가 보여야 한다.
- **문장은 `runner` 의 `describeSpecFinding` 만 만든다.** 다른 패키지가 finding 문장을 만들지
  않는다(ADR-0018).
- 검증 명령: `pnpm install` · `pnpm build` · `pnpm test` · `pnpm typecheck` · `pnpm lint`.
  루트 `test` 는 turbo 가 아니라 `vitest run` 이므로 `--force` 옵션이 없다. 캐시 재생을 의심할
  대상은 `typecheck` 와 `build` 뿐이다.

---

## 1. 실행 모델

구현·테스트는 서브에이전트가 실행하고, 메인 세션은 오케스트레이터(스폰·리뷰·머지 게이트)로
남는다. 모델 배분은 `CLAUDE.local.md` 의 표를 따른다.

| 태스크 | 모델 | 사유 |
|---|---|---|
| T3 · T11 | **상위** | 실패 메시지·화면 문안 설계. 계획서에 코드로 못 박기 어려운 판단이다 |
| T4 | **상위** | 패키지 경계·의존 방향 판단(ADR-0009 개정) |
| T1 · T2 · T5 · T6 · T7 · T8 · T9 · T10 · T12 | 표준 | 설계서에 사양이 명확히 적혀 있다 |

---

## 2. 파일 구조

새로 만드는 파일과 각자의 책임이다.

| 파일 | 책임 |
|---|---|
| `packages/runner/src/contract-range.ts` | `ContractRange` 타입과 스키마에서 범위를 읽는 순수 함수. `input-schema.ts` 와 `contract-axes.ts` 가 함께 쓴다 |
| `packages/generate/src/constraints.ts` | `format` 표, 제약 검증, 모순 판정. `schema.ts` 와 `synthesize.ts` 가 함께 쓴다 |
| `packages/generate/src/provenance.ts` | `ValueProvenance` 판정 |
| `packages/generate/src/pre-fill.ts` | AI 사전보완 요청 조립과 응답 검증 |
| `packages/cli/src/pre-fill-wiring.ts` | 사전보완 배선과 후보 채택 규칙 |

기존 파일에 얹지 않고 나누는 이유: `schema.ts` 는 이미 300줄이 넘고 검증·타입·오류를 다 들고
있다. 제약 표와 모순 판정을 여기 더하면 한 파일이 두 가지 판단을 갖는다. `contract-range.ts` 는
`runner` 안에서 두 소비자가 있어 한쪽에 두면 다른 쪽이 역참조하게 된다.

---

## 3. 터미널 분할과 웨이브

터미널 1개 = worktree 1개 = 브랜치 1개 = PR 1개다.

| 웨이브 | 터미널 | 태스크 | 패키지 | PR |
|---|---|---|---|---|
| 1 | A | T1 ~ T8 | `runner` · `generate` | PR 1 |
| 2 | B | T9 ~ T11 | `generate` · `cli` | PR 2 |
| 3 | B (직렬) | T12 | E2E | PR 2 에 포함 |

**터미널 B 는 PR 1 이 머지된 뒤에 연다.** T9 가 T6 의 `ValueProvenance` 를, T10 이 T7 의
합성 규칙을 소비한다. 스택 PR 로 만들면 베이스가 피처 브랜치라 CodeRabbit 이 리뷰를 건너뛴다
(단계 8 에서 확인된 도구 제약이다).

T12 는 실서버 프로세스를 띄우므로 직렬 전용이다. 터미널 B 안에서 T11 다음에 순차로 돈다.

의존 그래프(터미널 A 내부):

```
T1 (contract-range)
 ├→ T2 (RANGE_VIOLATION 축)
 └→ T3 (checkInputContract + 문안)
T4 (ADR-0009 · 의존 경계)         ← T5~T8 이 runner 심볼을 가져오기 전에 끝나야 한다
 └→ T5 (schema 키워드 허용)
     └→ T6 (synthesize 하한 경계 + format)
         └→ T7 (ValueProvenance)
             └→ T8 (violation-cases + coverage)   ← T2 도 선행이다
```

T1~T3 과 T4~T8 은 파일이 겹치지 않으나 **같은 터미널에서 순차로 돈다.** 두 갈래를 병렬로 돌리면
T8 이 양쪽을 다 필요로 해 머지 지점이 생기고, 한 PR 안에서 그 조정 비용이 이득보다 크다.

---

## 4. 태스크

### T1 — `runner` 범위 읽기

**모델:** 표준

**Files**
- 생성: `packages/runner/src/contract-range.ts`
- 수정: `packages/runner/src/input-schema.ts`
- 테스트: `packages/runner/tests/input-contract.test.ts`

**Interfaces**

- Produces (공유 계약이므로 전량으로 적는다):

```ts
// packages/runner/src/contract-range.ts

/**
 * 선언된 범위 제약. 없는 항목은 null 이다.
 * 이 타입은 generate 가 소비한다(ADR-0009 승인 목록 대상).
 */
export interface ContractRange {
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly exclusiveMinimum: number | null;
  readonly exclusiveMaximum: number | null;
  readonly minItems: number | null;
  readonly maxItems: number | null;
  readonly minLength: number | null;
  readonly maxLength: number | null;
}

/**
 * 스키마 객체에서 범위를 읽는다. 하나도 없으면 null 을 돌려준다.
 *
 * 값이 우리가 다루는 형태가 아니면 그 항목만 null 로 둔다. runner 는 해석기이지 검증기가
 * 아니다. 깨진 선언을 거절하는 것은 generate 의 몫이다(설계서 §3.1).
 * 숫자 넷은 유한한 숫자만, 개수·길이 넷은 음이 아닌 정수만 받는다.
 */
export function readContractRange(schema: Record<string, unknown>): ContractRange | null;

/** 범위가 하나라도 있으면 true. */
export function hasRange(range: ContractRange | null): range is ContractRange;
```

- Consumes: 없음

**수정할 기존 계약**

```ts
// packages/runner/src/input-schema.ts 의 NormalizedField
export interface NormalizedField {
  readonly type: DeclaredType | null;
  readonly enumValues: readonly JsonValue[] | null;
  /** 선언된 범위. 없거나 판정하지 않기로 했으면 null 이다. */
  readonly range: ContractRange | null;
}
```

`BLOCKING_KEYWORDS`(`input-schema.ts:50`)는 **바꾸지 않는다.** 범위 키워드는 지금도 차단 목록에
없어 조용히 무시되고 있었다. 차단 키워드가 있는 필드는 종전대로 통째로 포기하므로 `range` 도
`null` 이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/runner/tests/input-contract.test.ts` 에 더한다.

```ts
describe("readContractRange", () => {
  it("범위 키워드가 없으면 null 이다", () => {
    expect(readContractRange({ type: "integer" })).toBeNull();
  });

  it("숫자 범위를 읽는다", () => {
    expect(readContractRange({ type: "integer", minimum: 1, maximum: 10 })).toEqual({
      minimum: 1, maximum: 10,
      exclusiveMinimum: null, exclusiveMaximum: null,
      minItems: null, maxItems: null, minLength: null, maxLength: null,
    });
  });

  it("exclusive 형식을 읽는다", () => {
    const range = readContractRange({ type: "integer", exclusiveMinimum: 0, exclusiveMaximum: 100 });
    expect(range?.exclusiveMinimum).toBe(0);
    expect(range?.exclusiveMaximum).toBe(100);
    expect(range?.minimum).toBeNull();
  });

  it("개수와 길이를 읽는다", () => {
    expect(readContractRange({ type: "array", minItems: 2, maxItems: 5 })?.minItems).toBe(2);
    expect(readContractRange({ type: "string", minLength: 3, maxLength: 8 })?.maxLength).toBe(8);
  });

  it("draft-04 의 boolean exclusiveMinimum 은 읽지 않는다", () => {
    expect(readContractRange({ type: "integer", exclusiveMinimum: true })).toBeNull();
  });

  it("음수 minItems 는 읽지 않는다", () => {
    expect(readContractRange({ type: "array", minItems: -1 })).toBeNull();
  });

  it("정수가 아닌 minLength 는 읽지 않는다", () => {
    expect(readContractRange({ type: "string", minLength: 1.5 })).toBeNull();
  });

  it("무한대는 읽지 않는다", () => {
    expect(readContractRange({ type: "number", minimum: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it("일부만 유효하면 그 항목만 담는다", () => {
    const range = readContractRange({ type: "integer", minimum: 1, maximum: "10" });
    expect(range?.minimum).toBe(1);
    expect(range?.maximum).toBeNull();
  });
});

describe("analyzeInputSchema 가 필드의 range 를 담는다", () => {
  it("범위 있는 필드", () => {
    const analysis = analyzeInputSchema({
      type: "object",
      required: ["count"],
      properties: { count: { type: "integer", minimum: 1, maximum: 10 } },
    });
    expect(analysis.schema?.fields.get("count")?.range?.minimum).toBe(1);
  });

  it("차단 키워드가 있는 필드는 range 도 null 이다", () => {
    const analysis = analyzeInputSchema({
      type: "object",
      required: ["count"],
      properties: { count: { anyOf: [{ type: "integer", minimum: 1 }] } },
    });
    expect(analysis.schema?.fields.get("count")?.range).toBeNull();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

`pnpm vitest run packages/runner/tests/input-contract.test.ts`
기대: `readContractRange is not defined` 로 FAIL.

- [ ] **Step 3: 구현한다**

`contract-range.ts` 를 만들고 `input-schema.ts` 의 필드 정규화에서 호출한다. 이 파일은 패키지
내부 전용이 아니다. `ContractRange` 는 `index.ts` 로 내보낸다(`generate` 가 쓴다).
`readContractRange` 는 내부 전용이라 내보내지 않는다.

- [ ] **Step 4: 통과를 확인한다**

`pnpm vitest run packages/runner/tests/input-contract.test.ts` → PASS
`pnpm vitest run packages/runner` → 기존 테스트 회귀 없음
`pnpm typecheck`

- [ ] **Step 5: 보고한다**

커밋하지 않는다. `status: READY_FOR_REVIEW` 로 보고하고 변경 파일과 검증 결과를 적는다.

---

### T2 — `RANGE_VIOLATION` 축

**모델:** 표준

**Files**
- 수정: `packages/runner/src/contract-axes.ts`
- 테스트: `packages/runner/tests/contract-axes.test.ts`

**Interfaces**

- Consumes: T1 의 `ContractRange` · `NormalizedField.range`
- Produces (공유 계약, 전량):

```ts
export type ContractAxisKind =
  | "HAPPY_PATH"
  | "REQUIRED_OMITTED"
  | "TYPE_VIOLATION"
  | "ENUM_VIOLATION"
  | "RANGE_VIOLATION"; // 선언된 범위 밖 값을 거절한다

export interface ContractAxis {
  readonly kind: ContractAxisKind;
  readonly tool: string;
  readonly field: string | null;
  readonly declaredType: ContractDeclaredType | null;
  readonly declaredEnum: readonly JsonValue[] | null;
  /** 선언된 범위. RANGE_VIOLATION 에서만 값이 있고 그 밖에는 null 이다. */
  readonly declaredRange: ContractRange | null;
}
```

**판단이 갈리는 규칙 (전량으로 적는다)**

축을 만드는 조건이다. 이걸 틀리면 위반 값을 만들 수 없는 축이 커버리지 분모에 들어가 영원히
못 채우는 빈틈이 생긴다.

```
축을 만든다:
  하한이 있고 그 한 칸 밖 값이 존재한다
    minimum: n            → 항상 (n - 1 이 존재)
    exclusiveMinimum: n   → 항상 (n 자신이 위반)
    minItems: n (n >= 1)  → n - 1 개
    minLength: n (n >= 1) → n - 1 자
  또는 하한이 없고 상한이 있다
    maximum / exclusiveMaximum / maxItems / maxLength

축을 만들지 않는다:
  minItems: 0 이고 maxItems 가 없다     (원소 -1 개는 존재하지 않는다)
  minLength: 0 이고 maxLength 가 없다   (길이 -1 은 존재하지 않는다)
  범위가 전혀 없다
```

`minItems: 0` 단독을 축으로 만들지 않는 것은 단계 2 의 `VACUOUS_MIN_ITEMS` 판단과 같은 계열이다.
아무것도 제약하지 않는 선언은 검증할 축이 아니다.

축 순서는 기존과 같이 필드 이름 코드 단위 오름차순이고, 같은 필드에서는
`REQUIRED_OMITTED` → `TYPE_VIOLATION` → `ENUM_VIOLATION` → `RANGE_VIOLATION` 순이다.
`cases` 배열 순서는 승인 지문에 들어가는 의미이므로 서버가 `required` 순서를 바꾸는 것만으로
지문이 흔들리면 안 된다(기존 주석 `contract-axes.ts:95`).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
describe("RANGE_VIOLATION 축 도출", () => {
  const tool = (props: Record<string, unknown>, required: string[]) => ({
    name: "t",
    inputSchema: { type: "object", required, properties: props },
  });

  it("minimum 이 있으면 축을 만든다", () => {
    const axes = deriveContractAxes(tool({ count: { type: "integer", minimum: 1 } }, ["count"]));
    const range = axes.filter((a) => a.kind === "RANGE_VIOLATION");
    expect(range).toHaveLength(1);
    expect(range[0]?.field).toBe("count");
    expect(range[0]?.declaredRange?.minimum).toBe(1);
    expect(range[0]?.declaredType).toBeNull();
    expect(range[0]?.declaredEnum).toBeNull();
  });

  it("minimum 이 0 이어도 축을 만든다", () => {
    const axes = deriveContractAxes(tool({ count: { type: "integer", minimum: 0 } }, ["count"]));
    expect(axes.filter((a) => a.kind === "RANGE_VIOLATION")).toHaveLength(1);
  });

  it("minItems: 0 단독은 축이 아니다", () => {
    const axes = deriveContractAxes(
      tool({ tags: { type: "array", items: { type: "string" }, minItems: 0 } }, ["tags"]),
    );
    expect(axes.filter((a) => a.kind === "RANGE_VIOLATION")).toHaveLength(0);
  });

  it("minItems: 0 이라도 maxItems 가 있으면 축이다", () => {
    const axes = deriveContractAxes(
      tool({ tags: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 3 } }, ["tags"]),
    );
    expect(axes.filter((a) => a.kind === "RANGE_VIOLATION")).toHaveLength(1);
  });

  it("minLength: 0 단독은 축이 아니다", () => {
    const axes = deriveContractAxes(tool({ q: { type: "string", minLength: 0 } }, ["q"]));
    expect(axes.filter((a) => a.kind === "RANGE_VIOLATION")).toHaveLength(0);
  });

  it("범위가 없으면 축이 아니다", () => {
    const axes = deriveContractAxes(tool({ count: { type: "integer" } }, ["count"]));
    expect(axes.filter((a) => a.kind === "RANGE_VIOLATION")).toHaveLength(0);
  });

  it("한 필드에 축은 하나다", () => {
    const axes = deriveContractAxes(
      tool({ count: { type: "integer", minimum: 1, maximum: 10 } }, ["count"]),
    );
    expect(axes.filter((a) => a.kind === "RANGE_VIOLATION")).toHaveLength(1);
  });

  it("축 순서가 결정론적이다", () => {
    const schema = tool(
      { b: { type: "integer", minimum: 1 }, a: { type: "integer", minimum: 1 } },
      ["b", "a"],
    );
    const first = deriveContractAxes(schema).map((a) => `${a.kind}:${a.field}`);
    const second = deriveContractAxes(schema).map((a) => `${a.kind}:${a.field}`);
    expect(first).toEqual(second);
    const rangeFields = deriveContractAxes(schema)
      .filter((a) => a.kind === "RANGE_VIOLATION")
      .map((a) => a.field);
    expect(rangeFields).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

`pnpm vitest run packages/runner/tests/contract-axes.test.ts` → FAIL

- [ ] **Step 3: 구현한다**

`ContractAxisKind` 에 값을 더하고 `ContractAxis` 에 `declaredRange` 를 더한다. 기존 축 생성
함수가 `declaredRange: null` 을 넣도록 전부 고친다(타입체커가 잡아준다). `matchCoveredAxes`
쪽도 새 축을 인식하게 한다.

- [ ] **Step 4: 통과를 확인한다**

`pnpm vitest run packages/runner` → PASS
`pnpm typecheck`

- [ ] **Step 5: 보고한다**

---

### T3 — `checkInputContract` 범위 위반과 실패 문안

**모델:** 상위 (실패 메시지 문안 설계)

**Files**
- 수정: `packages/runner/src/spec-findings.ts` · `packages/runner/src/input-contract.ts`
- 테스트: `packages/runner/tests/input-contract.test.ts` · `packages/runner/tests/spec-findings.test.ts`

**Interfaces**

- Consumes: T1 의 `NormalizedField.range`
- Produces (공유 계약, 전량):

```ts
export type SpecFindingCode =
  | "TOOL_NOT_DECLARED"
  | "REQUIRED_MISSING"
  | "UNDECLARED_FIELD"
  | "TYPE_MISMATCH"
  | "ENUM_MISMATCH"
  | "SCHEMA_NOT_ANALYZABLE"
  | "REJECTION_WITHOUT_VIOLATION"
  | "RANGE_MISMATCH"          // 명세의 입력값이 선언된 범위를 벗어난다
  | "VACUOUS_MIN_LENGTH"
  | "VACUOUS_MIN_ITEMS";
```

이름은 `RANGE_MISMATCH` 다. 기존 코드가 `TYPE_MISMATCH` · `ENUM_MISMATCH` 로 통일돼 있어 그
계열을 따른다. 축 이름(`RANGE_VIOLATION`)과 finding 이름이 다른 것은 기존 `ENUM_VIOLATION` 축과
`ENUM_MISMATCH` finding 이 이미 그런 관계라서다. **설계서는 계획 작성 시점에 이미 이 이름으로
맞춰 뒀다.** 설계서를 고칠 필요가 없다.

**비차단이다.** 통과·실패 판정을 바꾸지 않는다. 단계 2 의 결정을 그대로 따른다.

**문안 (전량으로 적는다. 이 프로젝트에서 실패 메시지는 제품이다)**

`describeSpecFinding` 이 만드는 문장이다. 두 줄이고, 첫 줄은 무엇이 어떻게 다른지, 둘째 줄은
무엇을 하면 되는지다. 기존 finding 문장의 형식을 그대로 따른다.

```
→ 'count' 값 0 이 선언된 범위를 벗어납니다. 서버 선언: 1 이상 10 이하
→ 값을 범위 안으로 고치거나, 거절을 기대하는 케이스라면 expectError 를 지정하세요.
```

범위 문구는 선언된 항목만 적는다. 없는 항목을 추측해 적지 않는다.

| 선언 | 문구 |
|---|---|
| `minimum: 1, maximum: 10` | `1 이상 10 이하` |
| `minimum: 1` | `1 이상` |
| `maximum: 10` | `10 이하` |
| `exclusiveMinimum: 0` | `0 초과` |
| `exclusiveMaximum: 100` | `100 미만` |
| `exclusiveMinimum: 0, maximum: 10` | `0 초과 10 이하` |
| `minItems: 2, maxItems: 5` | `원소 2개 이상 5개 이하` |
| `minLength: 3` | `3자 이상` |

`ADR-0021` 정합: 거절 기대 케이스에서는 이 finding 을 억제한다. 그리고 PR #144 의
`REJECTION_WITHOUT_VIOLATION` 판정 재료에 **범위 위반을 포함시킨다.** 안 넣으면 범위 위반만
있는 거절 기대 케이스가 "아무것도 위반하지 않는다" 로 잘못 걸린다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
const tools = [{
  name: "get",
  inputSchema: {
    type: "object",
    required: ["count"],
    properties: { count: { type: "integer", minimum: 1, maximum: 10 } },
  },
}];

const suiteWith = (args: unknown, expectError = false) => ({
  schemaVersion: 1, id: "s", name: "s",
  cases: [{
    name: "c",
    operation: { type: "callTool", tool: "get", arguments: args },
    assertions: expectError ? [{ type: "isError", value: true }] : [{ type: "isError", value: false }],
  }],
});

describe("RANGE_MISMATCH", () => {
  it("범위 밖 값을 잡는다", () => {
    const result = checkInputContract({ suite: suiteWith({ count: 0 }), tools });
    expect(result.findings.map((f) => f.code)).toContain("RANGE_MISMATCH");
  });

  it("범위 안 값은 잡지 않는다", () => {
    const result = checkInputContract({ suite: suiteWith({ count: 1 }), tools });
    expect(result.findings.map((f) => f.code)).not.toContain("RANGE_MISMATCH");
  });

  it("경계값은 위반이 아니다", () => {
    expect(
      checkInputContract({ suite: suiteWith({ count: 10 }), tools }).findings.map((f) => f.code),
    ).not.toContain("RANGE_MISMATCH");
  });

  it("거절 기대 케이스에서는 억제된다", () => {
    const result = checkInputContract({ suite: suiteWith({ count: 0 }, true), tools });
    expect(result.findings.map((f) => f.code)).not.toContain("RANGE_MISMATCH");
  });

  it("범위 위반만 있는 거절 기대 케이스는 REJECTION_WITHOUT_VIOLATION 이 아니다", () => {
    const result = checkInputContract({ suite: suiteWith({ count: 0 }, true), tools });
    expect(result.findings.map((f) => f.code)).not.toContain("REJECTION_WITHOUT_VIOLATION");
  });

  it("배열 개수 위반을 잡는다", () => {
    const arrayTools = [{
      name: "get",
      inputSchema: {
        type: "object", required: ["tags"],
        properties: { tags: { type: "array", items: { type: "string" }, minItems: 2 } },
      },
    }];
    const result = checkInputContract({ suite: suiteWith({ tags: ["a"] }), tools: arrayTools });
    expect(result.findings.map((f) => f.code)).toContain("RANGE_MISMATCH");
  });
});

describe("describeSpecFinding 의 범위 문안", () => {
  const sentence = (args: unknown) =>
    checkInputContract({ suite: suiteWith(args), tools }).findings
      .filter((f) => f.code === "RANGE_MISMATCH")
      .map((f) => describeSpecFinding(f))[0] ?? "";

  it("양쪽 경계를 모두 적는다", () => {
    const text = sentence({ count: 0 });
    expect(text).toContain("1 이상 10 이하");
    expect(text).toContain("expectError");
  });

  it("선언되지 않은 경계를 추측하지 않는다", () => {
    const oneSided = [{
      name: "get",
      inputSchema: {
        type: "object", required: ["count"],
        properties: { count: { type: "integer", minimum: 1 } },
      },
    }];
    const text = checkInputContract({ suite: suiteWith({ count: 0 }), tools: oneSided }).findings
      .filter((f) => f.code === "RANGE_MISMATCH")
      .map((f) => describeSpecFinding(f))[0] ?? "";
    expect(text).toContain("1 이상");
    expect(text).not.toContain("이하");
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

`pnpm vitest run packages/runner/tests/input-contract.test.ts` → FAIL

- [ ] **Step 3: 구현한다**

`SpecFindingCode` 에 값을 더하고, **`input-contract.ts` 의 `CODE_ORDER`** 에도 넣는다(순서가
결정론적이어야 한다). `describeSpecFinding` 에 문안을 더한다.

**정정(실행 중 확인):** 착수 시 이 지시가 `assertion-substance.ts:10` 을 가리켰는데 그 상수는
`Partial<Record<...>>` 이고 단언 실질성 코드 둘만 담는다. 입력 계약 대조의 순서를 정하는
`CODE_ORDER` 는 `input-contract.ts` 에 있는 **다른 상수**다. 같은 이름이 두 파일에 있다.

- [ ] **Step 4: 통과를 확인한다**

`pnpm vitest run packages/runner` → PASS
`pnpm typecheck`

- [ ] **Step 5: 보고한다**

---

### T4 — 의존 경계 확장과 ADR-0009 개정

**모델:** 상위 (패키지 경계·의존 방향 판단)

**Files**
- 수정: `docs/adr/0009-*.md` · `packages/generate/tests/dependency-boundary.test.ts`
- 테스트: 같은 파일

**Interfaces**

- Consumes: T1 의 `ContractRange`, T2 의 `ContractAxis.declaredRange`, T3 의 `RANGE_MISMATCH`
- Produces: 넓어진 승인 심볼 목록

**왜 이 태스크가 T5 보다 먼저인가**

`dependency-boundary.test.ts` 가 ADR-0009 의 승인 심볼 목록을 코드로 고정하고 **정확한 일치**를
요구한다. `generate` 가 `ContractRange` 를 가져오는 순간 이 테스트가 깨진다. 그리고 그 테스트의
주석에 "목록을 늘리려면 ADR 을 먼저 고쳐야 한다" 는 규칙이 적혀 있다.

단계 4 에서는 이 벽에 부딪혀 목록을 넓히지 않고 **`generate` 로컬 정의**로 우회했다(`JsonValue`).
**이번에는 우회하지 않는다.** `ContractRange` 는 `runner` 가 스키마에서 읽어 축에 싣는 값이고
`generate` 는 그것을 받아 위반 케이스를 만든다. 구조가 같은 로컬 정의를 두면 두 벌이 되어
`runner` 가 항목을 늘릴 때 조용히 어긋난다. 단계 5·6 이 T6b 에서 목록을 넓히고 ADR 을 고친
전례를 따른다.

- [ ] **Step 1: ADR-0009 를 읽고 승인 심볼 목록에 더한다**

더할 것: `ContractRange` · `ContractAxisKind` 의 `RANGE_VIOLATION` · `ContractAxis.declaredRange` ·
`SpecFindingCode` 의 `RANGE_MISMATCH`.

개정 사유를 ADR 본문에 적는다. 무엇을 왜 넓혔는지가 남아야 다음 사람이 판단할 수 있다.

- [ ] **Step 2: 테스트 정규식이 재수출을 잡는지 확인한다**

단계 8 에서 이 정규식이 `export ... from` 을 안 잡는 구멍이 발견돼 `^(?:import|export)` 로
넓혔다. 현재 상태를 실제로 읽어 확인하고, 안 넓혀져 있으면 넓힌다. 넓혔다는 사실 자체를
단언하는 테스트가 있는지도 확인한다.

```ts
it("재수출도 경계 검사 대상이다", () => {
  // export ... from "@ohmymcp/runner" 형태가 정규식에 잡히는지 직접 단언한다.
  // 전제로 삼은 장치를 실제로 밟아보지 않으면 그 전제가 참인지 모른다(단계 8 의 교훈).
});
```

- [ ] **Step 3: 목록을 넓힌 테스트가 통과하는지 확인한다**

`pnpm vitest run packages/generate/tests/dependency-boundary.test.ts` → PASS

- [ ] **Step 4: 보고한다**

**주의:** ADR 번호는 개정이므로 새로 잡지 않는다. 이 태스크는 문서와 테스트만 건드린다.
`packages/generate/src/` 를 수정하지 않는다.

---

### T5 — `generate` 제약 키워드 허용과 검증

**모델:** 표준

**Files**
- 생성: `packages/generate/src/constraints.ts`
- 수정: `packages/generate/src/schema.ts`
- 테스트: `packages/generate/tests/index.test.ts`

**Interfaces**

- Consumes: T4 의 넓어진 경계
- Produces:

```ts
// packages/generate/src/constraints.ts

/** format 표. 순서는 hint 문자열에 쓰이므로 삽입 순서가 의미를 갖는다. */
export const FORMAT_VALUES: ReadonlyMap<string, string>;

/** 표에 있는 format 인지. */
export function isKnownFormat(format: string): boolean;

/**
 * 제약 키워드의 값과 상호 모순을 검사한다. 문제가 있으면 INVALID_SCHEMA_CONSTRAINT 로 던진다.
 * 통과하면 아무것도 돌려주지 않는다.
 */
export function assertConstraints(schema: JsonSchema, path: string): void;
```

**공유 계약 (전량)**

```ts
// packages/generate/src/schema.ts
export type GenerateTestsErrorCode =
  | "INVALID_OPTIONS"
  | "INVALID_TOOL"
  | "OUTPUT_FILE_EXISTS"
  | "UNSUPPORTED_SCHEMA"
  | "INVALID_SCHEMA_CONSTRAINT" // 제약 키워드의 값이 깨졌거나 서로 모순이다
  | "GENERATED_SUITE_INVALID";
```

`SUPPORTED_SCHEMA_KEYS` 에 더할 것: `minimum` · `maximum` · `exclusiveMinimum` ·
`exclusiveMaximum` · `minItems` · `maxItems` · `minLength` · `maxLength` · `format`.

**`UNSUPPORTED_SCHEMA` 와 코드를 나누는 이유 (판단이 갈리는 지점이므로 적는다)**

`baseline.ts:104` 는 `UNSUPPORTED_SCHEMA` 만 툴 단위로 건너뛰고 나머지는 전체를 멈춘다
(ADR-0036). 같은 코드를 쓰면 **깨진 서버 선언이 조용히 건너뛰어진다.** "우리가 아직 지원하지
않는다" 는 건너뛰어도 되지만 "선언이 깨졌다" 는 사용자가 알아야 할 결함이다.

**모순 판정 (전량)**

```
minimum > maximum
exclusiveMinimum >= maximum
minimum >= exclusiveMaximum
exclusiveMinimum >= exclusiveMaximum
minItems > maxItems
minLength > maxLength
type: "integer" 이고 [하한, 상한] 사이에 정수가 없다
```

마지막 항목의 판정: 유효 하한을 `lo`, 유효 상한을 `hi` 라 할 때
`Math.ceil(lo) > Math.floor(hi)` 이면 정수가 없다. `exclusive` 는 경계를 한 칸 좁힌 뒤 본다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/generate/tests/index.test.ts` 에 더한다.

```ts
describe("제약 키워드 허용", () => {
  const toolWith = (schema: Record<string, unknown>) => ({
    name: "t", inputSchema: { type: "object", required: ["v"], properties: { v: schema } },
  });

  it.each([
    ["minimum", { type: "integer", minimum: 1 }],
    ["maximum", { type: "integer", maximum: 10 }],
    ["exclusiveMinimum", { type: "integer", exclusiveMinimum: 0 }],
    ["exclusiveMaximum", { type: "integer", exclusiveMaximum: 100 }],
    ["minItems", { type: "array", items: { type: "string" }, minItems: 2 }],
    ["maxItems", { type: "array", items: { type: "string" }, maxItems: 3 }],
    ["minLength", { type: "string", minLength: 3 }],
    ["maxLength", { type: "string", maxLength: 20 }],
    ["format", { type: "string", format: "uri" }],
  ])("%s 를 거절하지 않는다", (_label, schema) => {
    expect(() => validateSchema(toolWith(schema).inputSchema, "t.inputSchema")).not.toThrow();
  });

  it("pattern 은 종전대로 거절한다", () => {
    expect(() => validateSchema(toolWith({ type: "string", pattern: "^a$" }).inputSchema, "p"))
      .toThrow(/UNSUPPORTED_SCHEMA|지원하지 않는/);
  });
});

describe("INVALID_SCHEMA_CONSTRAINT", () => {
  const check = (schema: Record<string, unknown>) => () => assertConstraints(schema, "p");

  it.each([
    ["minimum > maximum", { type: "integer", minimum: 10, maximum: 1 }],
    ["정수 없음", { type: "integer", minimum: 1.2, maximum: 1.8 }],
    ["minItems > maxItems", { type: "array", minItems: 3, maxItems: 1 }],
    ["minLength > maxLength", { type: "string", minLength: 5, maxLength: 2 }],
    ["minimum 이 숫자가 아님", { type: "integer", minimum: "1" }],
    ["minItems 가 음수", { type: "array", minItems: -1 }],
    ["minLength 가 정수가 아님", { type: "string", minLength: 1.5 }],
    ["format 이 문자열이 아님", { type: "string", format: 3 }],
    ["exclusiveMinimum 이 boolean", { type: "integer", exclusiveMinimum: true }],
    ["minimum 이 무한대", { type: "number", minimum: Number.POSITIVE_INFINITY }],
  ])("%s 는 INVALID_SCHEMA_CONSTRAINT 다", (_label, schema) => {
    expect(check(schema)).toThrow(
      expect.objectContaining({ code: "INVALID_SCHEMA_CONSTRAINT" }),
    );
  });

  it("number 는 minimum 1.2 maximum 1.8 이 정상이다", () => {
    expect(check({ type: "number", minimum: 1.2, maximum: 1.8 })).not.toThrow();
  });

  it("경계가 같으면 정상이다", () => {
    expect(check({ type: "integer", minimum: 5, maximum: 5 })).not.toThrow();
  });
});

describe("INVALID_SCHEMA_CONSTRAINT 는 부분 생성으로 건너뛰지 않는다", () => {
  it("한 툴이 모순 제약이면 전체가 멈춘다", () => {
    const tools = [
      { name: "ok", inputSchema: { type: "object", required: [], properties: {} } },
      {
        name: "broken",
        inputSchema: {
          type: "object", required: ["v"],
          properties: { v: { type: "integer", minimum: 10, maximum: 1 } },
        },
      },
    ];
    expect(() => createBaselineSuite(tools, { suiteId: "s", suiteName: "s" })).toThrow(
      expect.objectContaining({ code: "INVALID_SCHEMA_CONSTRAINT" }),
    );
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

`pnpm vitest run packages/generate/tests/index.test.ts` → FAIL

- [ ] **Step 3: 구현한다**

- [ ] **Step 4: 기존 거절 테스트를 뒤집는다**

`packages/generate/tests/index.test.ts:624-666` 의 세 건이 지금 **거절**을 단언한다.
`maximum · minimum (get-resource-links)` · `minimum 단독` · `format (gzip-file-as-resource)` 다.
이제 **생성 성공**을 단언하도록 고친다.

`packages/generate/tests/baseline.test.ts:62` 의 부분 생성 테스트는 `maximum` 을 쓰고 있다.
`pattern` 으로 바꿔 유지한다. **부분 생성 자체는 살아 있어야 한다.**

- [ ] **Step 5: 통과를 확인한다**

`pnpm vitest run packages/generate` → PASS
`pnpm typecheck`

- [ ] **Step 6: 보고한다**

---

### T6 — 하한 경계값 합성과 `format` 표

**모델:** 표준

**Files**
- 수정: `packages/generate/src/synthesize.ts` · `packages/generate/src/constraints.ts`
- 테스트: `packages/generate/tests/synthesize.test.ts` (생성)

**Interfaces**

- Consumes: T5 의 `FORMAT_VALUES` · `assertConstraints`
- Produces: 제약을 지키는 `synthesizeValue`

**값 선택 규칙 (전량. 매직넘버와 근거를 적는다)**

기존 우선순위(`const` → `default` → `examples[0]` → `enum[0]`)는 그대로다. **타입별 고정값
단계에만** 제약을 반영한다.

숫자:

| 선언 | 값 | 근거 |
|---|---|---|
| `minimum: n` | `n` | 하한을 그대로 쓴다 |
| `exclusiveMinimum: n`, `integer` | `n + 1` | |
| `exclusiveMinimum: n`, `number` | `n + 1` | 정수 단위로 올린다. 임의의 엡실론은 부동소수 재현성이 나쁘다 |
| `maximum: n` (하한 없음) | `n` | |
| `exclusiveMaximum: n`, `integer` | `n - 1` | |
| `exclusiveMaximum: n`, `number` | `n - 1` | |
| 제약 없음 | `0` | 종전과 동일 |

**하한이 상한보다 우선한다.** 둘 다 있으면 하한을 쓴다.

중간값을 쓰지 않는 이유: 한쪽 경계만 선언된 경우에 규칙이 정의되지 않는다. `+1` 인지 `+100`
인지 근거가 없고, 근거 없는 매직넘버는 나중에 아무도 못 고친다.

문자열 길이: `"example"`(7자)에서 시작해 `minLength` 에 못 미치면 `"x"` 를 채우고, `maxLength`
를 넘으면 앞에서 자른다.

배열: 원소 개수는 `max(minItems, 1)`. `maxItems: 0` 이면 빈 배열. 원소는 전부 같은 값이다
(결정론성).

`format` 표:

| `format` | 값 | 근거 |
|---|---|---|
| `uri` · `uri-reference` · `iri` | `"https://example.com"` | RFC 2606 예약 도메인 |
| `date` | `"2000-01-01"` | |
| `date-time` | `"2000-01-01T00:00:00Z"` | |
| `time` | `"00:00:00Z"` | |
| `duration` | `"P1D"` | |
| `email` · `idn-email` | `"user@example.com"` | RFC 2606 |
| `uuid` | `"00000000-0000-4000-8000-000000000000"` | 버전 4 형식을 만족하는 최소값 |
| `hostname` | `"example.com"` | RFC 2606 |
| `ipv4` | `"192.0.2.1"` | RFC 5737 문서용 |
| `ipv6` | `"2001:db8::1"` | RFC 3849 문서용 |

전부 문서용 예약 자원이다. 실존 자원을 가리키지 않으므로 dry run 이 외부에 부작용을 내지 않는다.

**`format` 이 `minLength`·`maxLength` 와 함께 오면 `format` 값을 그대로 쓰고 길이를 무시한다.**
자르면 형식이 깨져 둘 다 못 지킨다.

**표 밖 `format` 은 거절하지 않는다.** `"example"` 을 넣는다. 출처 표시는 T7 이 한다.

`valueMatchesSchema` 에도 같은 제약 검사를 더한다. `const`·`default`·`examples[0]` 후보가 자기
제약을 어기면 `UNSUPPORTED_SCHEMA` 로 처리한다(기존 동작 유지).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/generate/tests/synthesize.test.ts` 를 만든다.

```ts
import { describe, expect, it } from "vitest";
import { synthesizeValue } from "../src/synthesize.js";

const value = (schema: Record<string, unknown>) => synthesizeValue(schema, "p");

describe("숫자 하한 경계값", () => {
  it.each([
    [{ type: "integer", minimum: 1, maximum: 10 }, 1],
    [{ type: "integer", minimum: 0 }, 0],
    [{ type: "integer", minimum: -5 }, -5],
    [{ type: "integer", exclusiveMinimum: 0 }, 1],
    [{ type: "number", exclusiveMinimum: 0 }, 1],
    [{ type: "integer", maximum: 10 }, 10],
    [{ type: "integer", exclusiveMaximum: 1000000 }, 999999],
    [{ type: "number", exclusiveMaximum: 100 }, 99],
    [{ type: "integer" }, 0],
    [{ type: "number" }, 0],
    [{ type: "integer", minimum: 1, exclusiveMaximum: 5 }, 1],
  ])("%j → %s", (schema, expected) => {
    expect(value(schema)).toBe(expected);
  });
});

describe("문자열 길이", () => {
  it.each([
    [{ type: "string" }, "example"],
    [{ type: "string", minLength: 3 }, "example"],
    [{ type: "string", minLength: 10 }, "examplexxx"],
    [{ type: "string", maxLength: 3 }, "exa"],
    [{ type: "string", minLength: 2, maxLength: 4 }, "exam"],
  ])("%j → %s", (schema, expected) => {
    expect(value(schema)).toBe(expected);
  });
});

describe("format 표", () => {
  it.each([
    ["uri", "https://example.com"],
    ["uri-reference", "https://example.com"],
    ["iri", "https://example.com"],
    ["date", "2000-01-01"],
    ["date-time", "2000-01-01T00:00:00Z"],
    ["time", "00:00:00Z"],
    ["duration", "P1D"],
    ["email", "user@example.com"],
    ["idn-email", "user@example.com"],
    ["uuid", "00000000-0000-4000-8000-000000000000"],
    ["hostname", "example.com"],
    ["ipv4", "192.0.2.1"],
    ["ipv6", "2001:db8::1"],
  ])("format %s → %s", (format, expected) => {
    expect(value({ type: "string", format })).toBe(expected);
  });

  it("표 밖 format 은 거절하지 않고 example 을 넣는다", () => {
    expect(value({ type: "string", format: "json-pointer" })).toBe("example");
  });

  it("format 이 길이 제약보다 우선한다", () => {
    expect(value({ type: "string", format: "uri", maxLength: 5 })).toBe("https://example.com");
  });
});

describe("배열 개수", () => {
  it.each([
    [{ type: "array", items: { type: "string" } }, ["example"]],
    [{ type: "array", items: { type: "string" }, minItems: 2 }, ["example", "example"]],
    [{ type: "array", items: { type: "string" }, maxItems: 0 }, []],
    [{ type: "array", items: { type: "integer", minimum: 3 }, minItems: 2 }, [3, 3]],
  ])("%j → %j", (schema, expected) => {
    expect(value(schema)).toEqual(expected);
  });
});

describe("우선순위가 제약보다 앞선다", () => {
  it("default 가 범위를 만족하면 default 를 쓴다", () => {
    expect(value({ type: "integer", minimum: 5, default: 7 })).toBe(7);
  });

  it("enum[0] 이 범위를 만족하면 그것을 쓴다", () => {
    expect(value({ type: "integer", minimum: 5, enum: [7, 9] })).toBe(7);
  });

  it("default 가 범위 밖이면 거절한다", () => {
    expect(() => value({ type: "integer", minimum: 5, default: 1 })).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_SCHEMA" }),
    );
  });

  it("examples[0] 이 minItems 를 어기면 거절한다", () => {
    expect(() =>
      value({ type: "array", items: { type: "string" }, minItems: 2, examples: [["a"]] }),
    ).toThrow(expect.objectContaining({ code: "UNSUPPORTED_SCHEMA" }));
  });
});

describe("중첩", () => {
  it("객체 안의 제약을 지킨다", () => {
    expect(
      value({
        type: "object", required: ["count", "url"],
        properties: {
          count: { type: "integer", minimum: 1 },
          url: { type: "string", format: "uri" },
        },
      }),
    ).toEqual({ count: 1, url: "https://example.com" });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

`pnpm vitest run packages/generate/tests/synthesize.test.ts` → FAIL

- [ ] **Step 3: 구현한다**

- [ ] **Step 4: 결정론성을 단언한다**

`packages/generate/tests/baseline.test.ts` 에 더한다.

```ts
it("범위와 format 이 있는 툴도 baselineFingerprint 가 재현된다", () => {
  const tools = [{
    name: "t",
    inputSchema: {
      type: "object", required: ["count", "url", "tags"],
      properties: {
        count: { type: "integer", minimum: 1, maximum: 10 },
        url: { type: "string", format: "uri" },
        tags: { type: "array", items: { type: "string" }, minItems: 2 },
      },
    },
  }];
  const first = createBaselineSuite(tools, { suiteId: "s", suiteName: "s" });
  const second = createBaselineSuite(tools, { suiteId: "s", suiteName: "s" });
  expect(first.baselineFingerprint).toBe(second.baselineFingerprint);
  expect(JSON.stringify(first.suite)).toBe(JSON.stringify(second.suite));
});
```

- [ ] **Step 5: 통과를 확인한다**

`pnpm vitest run packages/generate` → PASS
`pnpm typecheck` · `pnpm lint`

- [ ] **Step 6: 보고한다**

---

### T7 — 값 출처

**모델:** 표준

**Files**
- 생성: `packages/generate/src/provenance.ts`
- 수정: `packages/generate/src/baseline.ts`
- 테스트: `packages/generate/tests/provenance.test.ts` (생성)

**Interfaces**

- Consumes: T6 의 `FORMAT_VALUES`
- Produces (공유 계약, 전량):

```ts
// packages/generate/src/provenance.ts

/** 합성한 값의 근거. */
export type ValueProvenance = "declared" | "placeholder" | "unknownFormat";

/** 툴 하나의 출처 집계. */
export interface ToolProvenance {
  readonly tool: string;
  readonly declared: number;
  readonly placeholder: number;
  /** 표 밖 format 을 만난 필드 경로. 코드 단위 오름차순이다. */
  readonly unknownFormatFields: readonly string[];
  /** placeholder 또는 unknownFormat 이 하나라도 있으면 true. AI 사전보완 대상 판정이다. */
  readonly needsAssist: boolean;
}

export function analyzeToolProvenance(tool: ToolDef): ToolProvenance;
```

`BaselineGenerationResult` 에 필드를 더한다.

```ts
/** 툴별 값 출처. 명세 파일에는 들어가지 않는다. */
readonly provenance: readonly ToolProvenance[];
```

**출처를 케이스에 저장하지 않는 이유 (판단이 갈리는 지점)**

명세 파일에 들어가면 승인 지문의 계산 대상이 된다(지문은 `approval` 키만 빼고 전체를 해싱한다).
우리 판정 규칙이 바뀔 때마다 사용자 명세의 지문이 흔들려 "명세가 바뀌었다" 경고가 일상이 된다.
단계 8 이 들여쓰기 변경을 지문에서 뺀 것과 같은 판단이다. baseline 생성 결과의 **부속 정보로만**
전달한다.

**판정 규칙 (전량)**

| 출처 | 언제 |
|---|---|
| `declared` | `const` · `default` · `examples[0]` · `enum[0]` · 표에 있는 `format` · 범위 제약 하나 이상 · `boolean` · `null` · 필수 필드 없는 객체 |
| `placeholder` | 제약이 하나도 없어 `"example"` · `0` 을 넣은 경우 |
| `unknownFormat` | 표 밖 `format` |

`boolean` 과 `null` 이 `declared` 인 이유: 후보가 사실상 하나뿐이라 AI 가 개선할 여지가 없다.

배열은 `items` 스키마의 출처를 그대로 물려받는다. 객체는 `required` 필드를 재귀로 집계한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
import { describe, expect, it } from "vitest";
import { analyzeToolProvenance } from "../src/provenance.js";

const tool = (v: Record<string, unknown>) => ({
  name: "t", inputSchema: { type: "object", required: ["v"], properties: { v } },
});

describe("필드 단위 출처", () => {
  it.each([
    [{ type: "string" }, "placeholder"],
    [{ type: "integer" }, "placeholder"],
    [{ type: "string", format: "uri" }, "declared"],
    [{ type: "string", format: "hostname" }, "declared"],
    [{ type: "string", format: "json-pointer" }, "unknownFormat"],
    [{ type: "integer", minimum: 1 }, "declared"],
    [{ type: "integer", maximum: 10 }, "declared"],
    [{ type: "string", minLength: 3 }, "declared"],
    [{ type: "boolean" }, "declared"],
    [{ type: "null" }, "declared"],
    [{ type: "string", const: "x" }, "declared"],
    [{ type: "string", default: "x" }, "declared"],
    [{ type: "string", enum: ["a", "b"] }, "declared"],
    [{ type: "string", examples: ["a"] }, "declared"],
  ])("%j → %s", (schema, expected) => {
    const result = analyzeToolProvenance(tool(schema));
    if (expected === "declared") {
      expect(result.declared).toBe(1);
      expect(result.placeholder).toBe(0);
      expect(result.unknownFormatFields).toEqual([]);
    } else if (expected === "placeholder") {
      expect(result.placeholder).toBe(1);
    } else {
      expect(result.unknownFormatFields).toHaveLength(1);
    }
  });
});

describe("needsAssist 판정", () => {
  it("전 필드가 declared 면 false", () => {
    expect(analyzeToolProvenance(tool({ type: "integer", minimum: 1 })).needsAssist).toBe(false);
  });

  it("placeholder 가 하나라도 있으면 true", () => {
    const t = {
      name: "t",
      inputSchema: {
        type: "object", required: ["a", "b"],
        properties: { a: { type: "integer", minimum: 1 }, b: { type: "string" } },
      },
    };
    expect(analyzeToolProvenance(t).needsAssist).toBe(true);
  });

  it("unknownFormat 이 있으면 true", () => {
    expect(
      analyzeToolProvenance(tool({ type: "string", format: "json-pointer" })).needsAssist,
    ).toBe(true);
  });

  it("필수 필드가 없는 객체는 declared 다", () => {
    const t = { name: "t", inputSchema: { type: "object", required: [], properties: {} } };
    expect(analyzeToolProvenance(t).needsAssist).toBe(false);
  });
});

describe("중첩 집계", () => {
  it("배열은 items 의 출처를 물려받는다", () => {
    const t = tool({ type: "array", items: { type: "string" }, minItems: 2 });
    expect(analyzeToolProvenance(t).placeholder).toBe(1);
  });

  it("객체는 required 필드를 재귀로 센다", () => {
    const t = tool({
      type: "object", required: ["x", "y"],
      properties: { x: { type: "string" }, y: { type: "integer", minimum: 1 } },
    });
    const result = analyzeToolProvenance(t);
    expect(result.placeholder).toBe(1);
    expect(result.declared).toBe(1);
  });

  it("unknownFormatFields 가 코드 단위 오름차순이다", () => {
    const t = {
      name: "t",
      inputSchema: {
        type: "object", required: ["b", "a"],
        properties: {
          b: { type: "string", format: "json-pointer" },
          a: { type: "string", format: "relative-json-pointer" },
        },
      },
    };
    const fields = analyzeToolProvenance(t).unknownFormatFields;
    expect([...fields]).toEqual([...fields].sort());
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

`pnpm vitest run packages/generate/tests/provenance.test.ts` → FAIL

- [ ] **Step 3: 구현하고 `BaselineGenerationResult` 에 싣는다**

- [ ] **Step 4: 지문이 안 바뀌는지 단언한다**

```ts
it("provenance 를 더해도 baselineFingerprint 가 그대로다", () => {
  // 출처는 명세 파일에 들어가지 않으므로 지문 계산 대상이 아니다.
  const tools = [{ name: "t", inputSchema: { type: "object", required: ["v"], properties: { v: { type: "string" } } } }];
  const result = createBaselineSuite(tools, { suiteId: "s", suiteName: "s" });
  expect(JSON.stringify(result.suite)).not.toContain("provenance");
  expect(JSON.stringify(result.suite)).not.toContain("placeholder");
});
```

- [ ] **Step 5: 통과를 확인한다**

`pnpm vitest run packages/generate` → PASS · `pnpm typecheck`

- [ ] **Step 6: 보고한다**

---

### T8 — `RANGE_VIOLATION` 위반 케이스와 커버리지

**모델:** 표준

**Files**
- 수정: `packages/generate/src/violation-cases.ts` · `packages/generate/src/coverage.ts`
- 테스트: `packages/generate/tests/violation-cases.test.ts` · `packages/generate/tests/coverage.test.ts`

**Interfaces**

- Consumes: T2 의 `ContractAxis.declaredRange`, T6 의 합성 규칙
- Produces: `RANGE_VIOLATION` 축을 덮는 케이스

**위반 값 규칙 (전량. 판단이 갈리는 지점이다)**

**하한을 한 칸 밖으로 넘긴 값**을 쓴다. 정상 경로가 하한 경계값이므로 위반도 같은 쪽에서
만들어야 사용자가 대응을 읽기 쉽다.

| 선언 | 위반 값 |
|---|---|
| `minimum: n` | `n - 1` |
| `exclusiveMinimum: n` | `n` |
| `minItems: n` (n ≥ 1) | 원소 `n - 1` 개 |
| `minLength: n` (n ≥ 1) | 길이 `n - 1` 문자열 |
| 하한 없이 `maximum: n` | `n + 1` |
| 하한 없이 `exclusiveMaximum: n` | `n` |
| 하한 없이 `maxItems: n` | 원소 `n + 1` 개 |
| 하한 없이 `maxLength: n` | 길이 `n + 1` 문자열 |

**하한이 `0` 이고 타입이 `integer` 이면 위반 값은 `-1` 이다.** 음수를 못 받는 서버가 있을 수
있으나 그것이 곧 검증 대상이다.

생성한 케이스는 거절 기대다. `isError: true` 를 단언한다. ADR-0021 에 따라 입력 계약 대조에서
제외된다.

**커버리지 분모가 늘어난다.** 범위 제약이 있는 툴에 축이 하나 늘고 그것을 덮는 케이스가
없으면 수치가 내려간다. 결함이 아니라 이전에 안 보이던 빈틈이 드러난 것이다. T11 이 화면에
그 사실을 적는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
describe("RANGE_VIOLATION 위반 케이스", () => {
  const axisFor = (v: Record<string, unknown>) =>
    deriveContractAxes({ name: "t", inputSchema: { type: "object", required: ["v"], properties: { v } } })
      .filter((a) => a.kind === "RANGE_VIOLATION");

  const argsOf = (v: Record<string, unknown>) => {
    const cases = synthesizeViolationCases({ tool: { name: "t", inputSchema: { type: "object", required: ["v"], properties: { v } } }, axes: axisFor(v) });
    return (cases[0]?.operation as { arguments: Record<string, unknown> }).arguments.v;
  };

  it.each([
    [{ type: "integer", minimum: 1 }, 0],
    [{ type: "integer", minimum: 0 }, -1],
    [{ type: "integer", minimum: -3 }, -4],
    [{ type: "integer", exclusiveMinimum: 0 }, 0],
    [{ type: "integer", maximum: 10 }, 11],
    [{ type: "integer", exclusiveMaximum: 100 }, 100],
  ])("%j → 위반 값 %s", (schema, expected) => {
    expect(argsOf(schema)).toBe(expected);
  });

  it("minItems: 2 는 원소 1개다", () => {
    expect(argsOf({ type: "array", items: { type: "string" }, minItems: 2 })).toEqual(["example"]);
  });

  it("maxItems: 1 (하한 없음) 은 원소 2개다", () => {
    expect(argsOf({ type: "array", items: { type: "string" }, maxItems: 1 })).toEqual([
      "example", "example",
    ]);
  });

  it("minLength: 3 은 길이 2 문자열이다", () => {
    expect(String(argsOf({ type: "string", minLength: 3 }))).toHaveLength(2);
  });

  it("maxLength: 3 (하한 없음) 은 길이 4 문자열이다", () => {
    expect(String(argsOf({ type: "string", maxLength: 3 }))).toHaveLength(4);
  });

  it("거절을 기대하는 케이스다", () => {
    const v = { type: "integer", minimum: 1 };
    const cases = synthesizeViolationCases({
      tool: { name: "t", inputSchema: { type: "object", required: ["v"], properties: { v } } },
      axes: axisFor(v),
    });
    expect(cases[0]?.assertions).toContainEqual({ type: "isError", value: true });
  });

  it("두 번 생성해도 같다", () => {
    const v = { type: "integer", minimum: 1, maximum: 10 };
    expect(JSON.stringify(argsOf(v))).toBe(JSON.stringify(argsOf(v)));
  });
});

describe("커버리지에 RANGE_VIOLATION 이 들어간다", () => {
  it("범위 축이 분모에 포함된다", () => {
    const tool = {
      name: "t",
      inputSchema: { type: "object", required: ["v"], properties: { v: { type: "integer", minimum: 1 } } },
    };
    const coverage = computeCoverage({ tools: [tool], suite: { schemaVersion: 1, id: "s", name: "s", cases: [] } });
    expect(coverage.axes.some((a) => a.kind === "RANGE_VIOLATION")).toBe(true);
  });

  it("위반 케이스가 있으면 덮인 것으로 센다", () => {
    // synthesizeViolationCases 로 만든 케이스를 넣으면 그 축이 covered 다.
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

`pnpm vitest run packages/generate/tests/violation-cases.test.ts` → FAIL

- [ ] **Step 3: 구현한다**

- [ ] **Step 4: 통과를 확인한다**

`pnpm test` (전체) · `pnpm typecheck` · `pnpm lint`

- [ ] **Step 5: 보고한다**

---

### T8b — `cli` 의 exhaustive Record 파장 (웨이브 1 에서 처리 완료)

**모델:** 상위 (화면 문안) · **상태: 완료** (통합 SHA `bb18b13`)

**계획 작성 시점에 예측하지 못한 파장이다.** `runner` 가 `SpecFindingCode` 와
`ContractAxisKind` 를 늘리자 `cli` 의 exhaustive `Record` 셋이 컴파일에서 깨졌다.
**PR 1 은 이것 없이 `pnpm typecheck` 가 녹색이 될 수 없다.**

| 파일 | 상수 | 더한 값 |
|---|---|---|
| `packages/cli/src/generate-command.ts` | `FINDING_GROUP` | `RANGE_MISMATCH: "inputContract"` |
| `packages/cli/src/test-command.ts` | `FINDING_GROUP` | `RANGE_MISMATCH: "inputContract"` |
| `packages/cli/src/generate-command.ts` | `AXIS_LABEL` | `RANGE_VIOLATION: "선언된 범위 밖 값 거절"` |
| `packages/cli/tests/generate-command.test.ts` | `createBaselineSuite` 목 | `provenance: []` |

`FINDING_GROUP` 이 `inputContract` 인 근거: `checkInputContract` 가 만드는 finding 이다.
`AXIS_LABEL` 문안은 형제 항목(`타입 위반 거절` · `선언되지 않은 값 거절`)의 어법을 따랐다.

**T11 이 화면 문안을 다시 볼 때 이 라벨도 함께 확인한다.**

---

> **웨이브 1 에서 확인된 것: 계획서 테스트 스니펫의 API 이름이 실제 저장소와 다르다.**
> 아래 T9~T12 의 스니펫도 같은 위험이 있다. **단언의 의미는 계획서대로 지키되, 이름과 형태는
> 실제 코드를 읽고 맞춰라.** 웨이브 1 에서 실제로 어긋난 것들:
> `operation.arguments` → `operation.input`,
> `{type:"isError", value:true}` → `{type:"isError", expected:true}`,
> `synthesizeViolationCases({tool, axes})` → `buildViolationCases({tool, happyInput, baseName})`,
> `coverage.axes` → `coverage.tools[i].axes`.

### T9 — AI 사전보완 요청과 응답 검증

**모델:** 표준

**Files**
- 생성: `packages/generate/src/pre-fill.ts`
- 테스트: `packages/generate/tests/pre-fill.test.ts` (생성)

**Interfaces**

- Consumes: T7 의 `ToolProvenance` · `needsAssist`
- Produces (공유 계약, 전량):

```ts
// packages/generate/src/pre-fill.ts

export interface PreFillProposal {
  /** 요청별 enum 으로 제한된다. */
  readonly caseId: string;
  /** baseline 이 placeholder 또는 unknownFormat 을 넣은 필드만 허용한다. */
  readonly field: string;
  readonly value: JsonValue;
}

export interface PreFillDiscard {
  readonly caseId: string;
  readonly field: string;
  /** 사람이 읽는 사유. 개수만 남기지 않는다(이슈 #120 계열). */
  readonly reason: string;
}

export interface PreFillResult {
  readonly accepted: readonly PreFillProposal[];
  readonly discarded: readonly PreFillDiscard[];
}

/** needsAssist 인 툴만 담은 요청을 만든다. 대상이 없으면 null 이다. */
export function preparePreFillRequest(options: {
  readonly tools: readonly ToolDef[];
  readonly provenance: readonly ToolProvenance[];
  readonly baseline: TestSuiteSpec;
}): PreFillRequest | null;

/** provider 응답을 검증한다. 규칙을 어긴 항목은 사유와 함께 버린다. */
export function validatePreFillResult(
  raw: unknown,
  request: PreFillRequest,
): PreFillResult;
```

**판단이 갈리는 규칙 (전량)**

버리는 조건과 사유 문안이다.

| 조건 | 사유 문안 |
|---|---|
| `caseId` 가 요청 enum 밖 | `요청에 없는 케이스입니다` |
| `field` 가 그 케이스에 없음 | `그 케이스에 없는 필드입니다` |
| `field` 의 출처가 `declared` | `근거 있는 값을 덮어쓰려 해서 버렸습니다` |
| 값이 그 필드의 선언을 어김 | `제안 값이 서버 선언을 어깁니다` |

**`caseId` 를 요청별 `enum` 으로 못 박는다.** PR #131 에서 이것을 안 해서 provider 가 여러 id 를
콤마로 이어 붙여 한 항목에 담았고, 검증이 그것을 버려 근거 충분한 답이 통째로 접혔다.
**지킬 수 없는 계약을 놓고 어겼다고 버린 셈이었다.** 규칙을 검증에만 두지 말고 요청에도 둔다.

**authoring 통로를 재사용하지 않는다.** authoring 출력 스키마는 `suiteJson` 을 요구해 AI 가
케이스 구조 전체를 바꿀 수 있다. 여기서 받을 것은 값뿐이다. ADR-0034 가 진단 통로를 분리한
것과 같은 이유다.

서버를 호출하지 않는다. provider 호출은 서버당 1회로 묶는다. `MAX_TOOLS_BYTES` 상한
(`authoring-request.ts:283`)과 같은 상한을 쓰고, 넘치면 잘린 사실을 결과에 싣는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
describe("preparePreFillRequest", () => {
  it("전 필드 declared 인 툴만 있으면 null 이다", () => {
    // provenance 가 전부 needsAssist: false
    expect(preparePreFillRequest({ tools, provenance, baseline })).toBeNull();
  });

  it("needsAssist 인 툴만 요청에 싣는다", () => {
    const request = preparePreFillRequest({ tools, provenance, baseline });
    expect(request?.tools.map((t) => t.name)).toEqual(["needs-help"]);
  });

  it("caseId 허용 값이 요청 스키마에 박힌다", () => {
    const request = preparePreFillRequest({ tools, provenance, baseline });
    expect(request?.outputSchema).toMatchObject({
      properties: {
        proposals: {
          items: { properties: { caseId: { enum: expect.arrayContaining(["needs-help-happy"]) } } },
        },
      },
    });
  });
});

describe("validatePreFillResult", () => {
  it("정상 제안을 받는다", () => {
    const result = validatePreFillResult(
      { proposals: [{ caseId: "needs-help-happy", field: "timezone", value: "Asia/Seoul" }] },
      request,
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.discarded).toHaveLength(0);
  });

  it("요청 enum 밖 caseId 는 사유와 함께 버린다", () => {
    const result = validatePreFillResult(
      { proposals: [{ caseId: "a,b,c", field: "timezone", value: "Asia/Seoul" }] },
      request,
    );
    expect(result.accepted).toHaveLength(0);
    expect(result.discarded[0]?.reason).toContain("요청에 없는 케이스");
  });

  it("declared 필드를 가리키면 버린다", () => {
    const result = validatePreFillResult(
      { proposals: [{ caseId: "needs-help-happy", field: "unit", value: "F" }] },
      request,
    );
    expect(result.discarded[0]?.reason).toContain("근거 있는 값");
  });

  it("선언을 어기는 값은 버린다", () => {
    const result = validatePreFillResult(
      { proposals: [{ caseId: "needs-help-happy", field: "count", value: 0 }] },
      request,
    );
    expect(result.discarded[0]?.reason).toContain("서버 선언");
  });

  it("그 케이스에 없는 필드는 버린다", () => {
    const result = validatePreFillResult(
      { proposals: [{ caseId: "needs-help-happy", field: "nope", value: 1 }] },
      request,
    );
    expect(result.discarded[0]?.reason).toContain("없는 필드");
  });

  it("응답이 배열이 아니면 전부 버리고 죽지 않는다", () => {
    expect(() => validatePreFillResult({ proposals: "nope" }, request)).not.toThrow();
  });
});
```

`request` · `tools` · `provenance` · `baseline` 픽스처는 테스트 파일 상단에 인메모리로 만든다.
`fixtures/` 파일을 새로 만들지 않는다.

- [ ] **Step 2: 실패를 확인한다** · **Step 3: 구현한다** · **Step 4: 통과를 확인한다**

`pnpm vitest run packages/generate/tests/pre-fill.test.ts` → PASS
`pnpm vitest run packages/generate` · `pnpm typecheck`

- [ ] **Step 5: 보고한다**

---

### T10 — `cli` 사전보완 배선과 후보 채택

**모델:** 표준

**Files**
- 생성: `packages/cli/src/pre-fill-wiring.ts`
- 수정: `packages/cli/src/generate-command.ts`
- 테스트: `packages/cli/tests/pre-fill-wiring.test.ts` (생성)

**Interfaces**

- Consumes: T9 의 `preparePreFillRequest` · `validatePreFillResult` · `PreFillResult`
- Produces: 채택된 케이스가 실린 suite

**후보 채택 규칙 (전량. 이 규칙이 실측 사고를 막는다)**

**AI 값이 baseline 값을 덮어쓰지 않는다.** 케이스마다 baseline 값과 AI 값 두 벌을 dry run 에
넘기고 실행 결과로 채택한다.

| baseline | AI | 채택 |
|---|---|---|
| 통과 | 통과 | **baseline** |
| 통과 | 실패 | baseline |
| 실패 | 통과 | **AI** |
| 실패 | 실패 | baseline (분류 화면으로. 사후수리가 이어받는다) |

둘 다 통과하면 baseline 을 쓴다. 결정론적이고 재현 가능한 쪽이 기본값이다.

**근거:** 실측에서 `server-filesystem` 이 baseline 6/14, AI 1/14 였다. AI 가 덮어썼으면 5개를
잃는다. 그 툴들에서 baseline 은 통과하고 AI 는 실패하므로 이 규칙이 baseline 을 지킨다.

서버 호출이 대상 케이스당 최대 2회로 는다. 대상은 `needsAssist` 로 걸러진 툴뿐이다.

**채택한 케이스의 출처를 정직하게 적는다(실행 중 결정).** `TestCaseOrigin` 에
`"schemaBaselinePreFilled"` 를 더한다. `"schemaBaseline"` 으로 두면 AI 값을 채택한 케이스가
순수 baseline 으로 기록돼 거짓이 된다. 동작 위험은 없다. `repair-target.ts` 가 `"user"` 하나만
분기하고 나머지는 동일 취급이기 때문이다. 같은 파일이 `TestCaseOrigin` 을 안 쓰고 유니온을
복제해 두고 있으므로 **그 복제도 함께 없앤다.** 두면 다음에 값이 늘 때 조용히 어긋난다.

**provider 를 부를 수 없는 경로**(`--baseline-only`, 자격증명 없음, 비대화형)에서는 사전보완을
건너뛴다. 그리고 `unknownFormatFields` 가 있는 툴은 T11 의 고지와 함께 **건너뛴다.**

**정정(실행 중 확인): 전송 전 확인 화면을 authoring 것으로 그대로 태울 수 없다.** 그 화면은
`AuthoringRequestPreview` 를 받는데 사전보완이 보내는 것은 값뿐이라 모양이 다르다. 계획서가
틀렸다. `diagnosis-request.ts` 를 본으로 삼아 한 벌 만든다. 아래 T10b 로 뗐다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

provider 와 서버를 둘 다 가짜로 주입한다. 실제 프로세스를 띄우지 않는다.

```ts
describe("후보 채택 규칙", () => {
  it.each([
    ["baseline 통과 + AI 통과", true, true, "baseline"],
    ["baseline 통과 + AI 실패", true, false, "baseline"],
    ["baseline 실패 + AI 통과", false, true, "ai"],
    ["baseline 실패 + AI 실패", false, false, "baseline"],
  ])("%s → %s 채택", async (_label, baselinePasses, aiPasses, expected) => {
    const result = await applyPreFill({
      client: fakeClient({ baselinePasses, aiPasses }),
      preFill: { accepted: [{ caseId: "c", field: "v", value: "AI" }], discarded: [] },
      baseline: baselineSuite,
    });
    expect(result.cases[0]?.source).toBe(expected);
  });

  it("baseline 실패 + AI 실패면 분류 대상으로 남는다", async () => {
    const result = await applyPreFill({
      client: fakeClient({ baselinePasses: false, aiPasses: false }),
      preFill: { accepted: [{ caseId: "c", field: "v", value: "AI" }], discarded: [] },
      baseline: baselineSuite,
    });
    expect(result.cases[0]?.needsClassification).toBe(true);
  });
});

describe("provider 를 못 부르는 경로", () => {
  it("--baseline-only 면 사전보완을 건너뛴다", async () => {
    const provider = vi.fn();
    await runGenerate({ baselineOnly: true, provider });
    expect(provider).not.toHaveBeenCalled();
  });

  it("--baseline-only 에서 unknownFormat 툴은 건너뛴다", async () => {
    const result = await runGenerate({ baselineOnly: true, tools: [unknownFormatTool, okTool] });
    expect(result.suite.cases.map((c) => c.name)).not.toContain("lookup-host-happy");
    expect(result.skipped).toContainEqual(
      expect.objectContaining({ tool: "lookup_host", reason: expect.stringContaining("format") }),
    );
  });

  it("사전보완 대상이 없으면 provider 를 안 부른다", async () => {
    const provider = vi.fn();
    await runGenerate({ baselineOnly: false, tools: [allDeclaredTool], provider });
    expect(provider).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패를 확인한다** · **Step 3: 구현한다** · **Step 4: 통과를 확인한다**

`pnpm vitest run packages/cli` → PASS · `pnpm typecheck`

- [ ] **Step 5: 보고한다**

---

### T10b — provider 호출 경로 (실행 중 추가)

**모델:** 표준

**Files**
- 수정: `packages/generate/src/pre-fill.ts` (요청 조립과 같은 파일에 preview·dispatch 를 둔다)
- 수정: `packages/cli/src/pre-fill-wiring.ts` · `packages/cli/src/generate-command.ts` · `packages/cli/src/index.ts`
- 수정: `packages/generate/src/providers.ts` (`makeProvider` 에 `preFill` 추가)
- 테스트: `packages/generate/tests/pre-fill.test.ts` · `packages/cli/tests/pre-fill-command.test.ts`

**정정(실행 중 확인):** 착수 시 `pre-fill-request.ts` 를 새로 만들도록 적었으나 파일을 나누지
않았다. 진단은 `diagnosis-prompt.ts` 로 나눴지만 사전보완 프롬프트는 20줄이라 분리 이득이
작고, 허용 목록 밖 파일만 하나 더 생긴다.

**왜 생겼나.** T9 · T10 은 요청 조립과 채택 규칙을 만들었지만 **실제로 provider 를 부르는
경로가 없다.** 그 상태로 머지하면 `applyPreFill` 이 아무 데서도 안 불려 사용자에게 안 닿는다.
계획서 §4.5 가 authoring 확인 화면을 재사용하라고 적었는데 타입이 안 맞는다.

**authoring 통로를 재사용하지 않는다.** authoring 출력 스키마는 `suiteJson` 을 요구해 AI 가
케이스 구조 전체를 바꿀 수 있다. 여기서 받을 것은 값뿐이다. ADR-0034 가 진단 통로를 분리한
것과 같은 이유이므로 `diagnosis-request.ts` 를 본으로 삼는다.

**만들 것**

- `PreFillRequestPreview` — provider id, model, byte length, fingerprint, 전송 데이터 요약
- 전송 전 확인 화면. 문안은 authoring 것의 어법을 따르되 **전송 데이터 목록은 사실대로**
  적는다: 툴 이름·설명·`inputSchema`·baseline 값·값 출처. **suite 전체가 아니다.**
- provider 호출과 타임아웃
- 바이트 상한은 `MAX_TOOLS_BYTES` 와 같은 값. 넘쳐 잘리면 **그 사실을 화면에 적는다.**
  조용히 자르지 않는다.

**provider 실패 처리 (계획서 §9 의 미결을 여기서 확정한다)**

**baseline 값으로 진행하고 화면에 그 사실을 적는다. 툴을 건너뛰지 않는다.** provider 실패는
사용자 서버의 문제가 아니라 우리 쪽 사정이므로, 그것 때문에 케이스를 잃는 손해가 더 크다.
`unknownFormat` 툴 건너뜀은 `--baseline-only` 처럼 **애초에 provider 를 안 부르기로 한
경로에서만** 적용한다.

---

### T11 — 화면 문안

**모델:** 상위 (실패 메시지·화면 문안 설계)

**Files**
- 수정: `packages/cli/src/generate-command.ts` (화면 출력부)
- 테스트: `packages/cli/tests/` 의 화면 스냅샷 테스트

**Interfaces**

- Consumes: T7 의 `ToolProvenance`, T9 의 `PreFillResult`, T8 의 커버리지

**문안 (전량. 이 프로젝트에서 실패 메시지는 제품이다)**

**① AI 없이 표 밖 `format` 툴을 건너뛸 때.** 부분 생성(ADR-0036)의 기존 고지와 같은 자리에
붙인다.

```text
경고: 툴 'lookup_host' 를 건너뜁니다.
      format 'hostname' 은 AI 없이 채울 수 없습니다.
      AI 검토(--baseline-only 없이 실행)를 켜면 생성됩니다.
```

"지원하지 않는다" 로 끝내지 않는다. 사용자가 할 수 있는 일을 같은 문장에 적는다.

**② 사전보완 결과.**

```text
AI 사전보완: 툴 8개 중 5개에 값 제안을 받았습니다.
  채택 3 (실제 서버에서 baseline 값이 실패하고 제안 값이 통과)
  미채택 2 (baseline 값이 이미 통과)
  버림 1 (근거 있는 값을 덮어쓰려 해서 버렸습니다: get_weather.unit)
```

**`버림` 은 사유와 대상을 반드시 적는다.** 개수만 적으면 이슈 #120 과 같은 문제가 된다.
버림이 0건이면 그 줄을 아예 안 찍는다.

**③ 커버리지 분모 변화 고지.** 범위 축이 새로 들어가 기존 명세의 수치가 내려간다.

```text
참고: 이번 버전부터 범위 제약(minimum·maxItems 등)이 검증 축에 포함됩니다.
      이전보다 커버리지가 낮게 보이면 새로 드러난 빈틈입니다.
```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

각 문안이 실제로 나오는지, 조건이 아닐 때 안 나오는지 단언한다.

```ts
it("버림이 0건이면 버림 줄을 찍지 않는다", () => {
  expect(render({ discarded: [] })).not.toContain("버림");
});

it("버림 사유와 대상을 적는다", () => {
  const text = render({ discarded: [{ caseId: "c", field: "get_weather.unit", reason: "근거 있는 값을 덮어쓰려 해서 버렸습니다" }] });
  expect(text).toContain("get_weather.unit");
  expect(text).toContain("근거 있는 값");
});

it("건너뜀 고지에 해결 수단이 있다", () => {
  const text = render({ skipped: [{ tool: "lookup_host", format: "hostname" }] });
  expect(text).toContain("--baseline-only 없이");
});
```

- [ ] **Step 2: 실패를 확인한다** · **Step 3: 구현한다** · **Step 4: 통과를 확인한다**

`pnpm vitest run packages/cli` · `pnpm test` (전체) · `pnpm typecheck` · `pnpm lint`

- [ ] **Step 5: 보고한다**

---

### T12 — E2E (직렬 전용)

**모델:** 표준

**Files**
- 수정: `packages/cli/tests/` 의 E2E 스펙

**이 태스크는 실서버 프로세스를 띄운다. 다른 태스크와 병렬로 돌리지 않는다.**

- [ ] **Step 1: `mcp-server-fetch` E2E 를 쓴다**

이 서버는 툴이 1개고 `exclusiveMaximum` 을 가져 지금은 케이스가 0개다. 이 계획의 완료 조건
§1.1-3 이다.

**Python `mcp` 2.x 에서 `McpError` 임포트가 깨지므로 `uvx --with "mcp<2" mcp-server-fetch` 로
고정해 띄운다**(`docs/adoption.md` §1.5). 고정하지 않으면 서버가 시작조차 못 하고, 우리 도구의
결함으로 오진하기 쉽다.

```
ohmymcp generate --server 'uvx --with "mcp<2" mcp-server-fetch' --baseline-only --out <임시경로>
기대: 케이스 1개 이상. url 필드 값이 "https://example.com"
```

- [ ] **Step 2: 기존 `examples/weather-server` E2E 가 통과하는지 확인한다**

우리 도구로 우리를 검증하는 E2E 가 CI 에 있다. 이게 깨지면 사용자에게도 깨진 것이다.

- [ ] **Step 3: 전체 판정**

`pnpm build --force` 로 산출물을 새로 만든 뒤 `pnpm typecheck` 를 돌린다. 패키지 간 타입 계약을
바꿨으므로 낡은 `dist` 타입을 읽으면 로컬만 초록이고 CI 에서 깨진다.

```
pnpm build --force
pnpm typecheck
pnpm test
pnpm lint
```

- [ ] **Step 4: 보고한다**

---

## 5. 실행 프롬프트

사람은 프로젝트 루트에서 터미널을 열고 아래 프롬프트를 붙여넣기만 한다. git 명령을 손으로 치지
않는다.

### 사전 조건 확인 (사람 몫, 2줄)

```sh
git log --oneline -1     # 기점이 70a051a 인지 확인
git status --short       # 설계서와 계획서가 커밋돼 있는지 확인
```

**설계서와 이 계획서가 커밋돼 있어야 한다.** untracked 면 새 worktree 에 딸려가지 않는다.

---

### 터미널 A — `runner` + `generate` (T1 ~ T8, PR 1)

권장 실행 설정: 오케스트레이터 세션은 상위 모델. 태스크 서브에이전트는 표준 모델이되
**T3 과 T4 만 상위 모델**로 스폰한다. 에이전트 종류는 범용(`general-purpose`).

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

  git worktree add .claude/worktrees/schema-constraint-a -b feat/schema-constraint-runner-generate 70a051a

를 실행한 뒤 그 경로로 세션을 옮겨라.

진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 BLOCKED 로 보고해라:
  - pwd 가 <프로젝트루트>/.claude/worktrees/schema-constraint-a 인지
  - git log --oneline -1 이 70a051a 인지
  - docs/superpowers/specs/2026-08-17-schema-constraint-support-design.md 가 존재하는지
  - docs/superpowers/plans/2026-08-17-schema-constraint-support-implementation.md 가 존재하는지
  - git status --short 가 깨끗한지
  - pnpm install 을 돌린 뒤 pnpm vitest run packages/runner 가 실제로 실행되는지
    (새 worktree 는 gitignore 된 node_modules 를 상속하지 않는다. 설치를 건너뛰면
     테스트가 실패하는 것이 아니라 자식 프로세스가 시작조차 못 해 타임아웃처럼 보인다)

[2단계: 실행]

너는 이 터미널의 오케스트레이터다. 직접 구현하지 마라. 태스크마다 서브에이전트를 하나씩
스폰하고, 보고를 받으면 diff 와 테스트 결과를 직접 확인한 뒤 다음 태스크로 넘어가라.

계획서
  docs/superpowers/plans/2026-08-17-schema-constraint-support-implementation.md
의 T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 을 이 순서대로 실행해라. 각 태스크의 Files,
Interfaces, 테스트 단언은 계획서에 전량 적혀 있다.

모델 배분: T3 과 T4 는 상위 모델로 스폰한다(T3 은 실패 메시지 문안 설계, T4 는 패키지 경계
판단이라 계획서에 코드로 못 박기 어려운 판단이 들어간다). 나머지는 표준 모델이다.

모든 서브에이전트에게 아래를 그대로 지시해라:
  - 자기 태스크의 Files 목록 밖 파일을 수정하지 마라. 특히 core/src/types.ts 의
    McpClient·ToolResult, 루트 빌드 설정, 다른 오너의 패키지는 공유 계약이다.
    안 맞으면 수정하지 말고 보고해라.
  - 의존 방향은 단방향이다(cli → runner/generate → core). 역참조·순환을 만들지 마라.
  - @modelcontextprotocol/sdk 는 1.x 고정이다. 목록 밖 의존성을 추가하지 마라.
  - 커밋·푸시·머지를 하지 마라. 백그라운드 실행을 하지 마라. 하위 에이전트를 스폰하지 마라.
  - 다른 작업자의 변경을 되돌리지 마라.
  - 유닛테스트는 인메모리와 fixtures/ 만 써라. 실서버 프로세스를 띄우지 마라.
  - 최종 응답을 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작하고, 변경 파일,
    실행한 검증 명령과 결과, 남은 위험을 적어라.

T8 까지 끝나면 통합 게이트를 돌려라:
  pnpm build --force
  pnpm typecheck        (Cached: 0 cached 인지 확인해라)
  pnpm test
  pnpm lint

전부 통과하면 변경 요약과 검증 결과를 사람에게 보고하고 멈춰라. 커밋과 PR 생성은 사람이 한다.
PR 을 만들 때는 저장소에 PR 템플릿이 있는지 먼저 확인하고 있으면 그 템플릿을 지켜라.
```

---

### 터미널 B — `generate` + `cli` (T9 ~ T12, PR 2)

**PR 1 이 `main` 에 머지된 뒤에 연다.** 아래 `<PR1머지SHA>` 를 실제 머지 커밋 SHA 로 바꿔서
붙여넣는다. 스택 PR 로 만들지 않는다(베이스가 피처 브랜치면 CodeRabbit 이 리뷰를 건너뛴다).

권장 실행 설정: 오케스트레이터 세션은 상위 모델. 태스크 서브에이전트는 표준 모델이되
**T11 만 상위 모델**로 스폰한다. 에이전트 종류는 범용(`general-purpose`).

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

  git worktree add .claude/worktrees/schema-constraint-b -b feat/schema-constraint-prefill-cli <PR1머지SHA>

를 실행한 뒤 그 경로로 세션을 옮겨라.

진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 BLOCKED 로 보고해라:
  - pwd 가 <프로젝트루트>/.claude/worktrees/schema-constraint-b 인지
  - git log --oneline -1 이 <PR1머지SHA> 인지
  - PR 1 의 산출물이 실제로 있는지: packages/generate/src/provenance.ts 와
    packages/runner/src/contract-range.ts 가 존재하는지
    (브랜치나 worktree 가 존재한다는 사실을 완료 근거로 쓰지 마라)
  - docs/superpowers/specs/2026-08-17-schema-constraint-support-design.md 가 존재하는지
  - docs/superpowers/plans/2026-08-17-schema-constraint-support-implementation.md 가 존재하는지
  - git status --short 가 깨끗한지
  - pnpm install 과 pnpm build 를 돌린 뒤 pnpm vitest run packages/cli 가 실제로 실행되는지
    (cli 는 다른 패키지의 빌드 산출물을 본다. 산출물이 낡으면 낡은 계약으로 판정한다)

[2단계: 실행]

너는 이 터미널의 오케스트레이터다. 직접 구현하지 마라. 태스크마다 서브에이전트를 하나씩
스폰하고, 보고를 받으면 diff 와 테스트 결과를 직접 확인한 뒤 다음 태스크로 넘어가라.

계획서
  docs/superpowers/plans/2026-08-17-schema-constraint-support-implementation.md
의 T9 → T10 → T11 → T12 를 이 순서대로 실행해라. 각 태스크의 Files, Interfaces, 테스트 단언은
계획서에 전량 적혀 있다.

모델 배분: T11 은 상위 모델로 스폰한다(화면 문안 설계라 계획서에 코드로 못 박기 어려운 판단이
들어간다). 나머지는 표준 모델이다.

T12 는 실서버 프로세스를 띄우는 직렬 전용 태스크다. 다른 태스크와 겹쳐 돌리지 마라.
mcp-server-fetch 는 반드시 uvx --with "mcp<2" mcp-server-fetch 로 고정해 띄워라.
고정하지 않으면 Python mcp 2.x 의 McpError 개명 때문에 서버가 시작조차 못 하고, 그것을
우리 도구의 결함으로 오진하게 된다.

모든 서브에이전트에게 아래를 그대로 지시해라:
  - 자기 태스크의 Files 목록 밖 파일을 수정하지 마라. 특히 core/src/types.ts 의
    McpClient·ToolResult, 루트 빌드 설정, 다른 오너의 패키지는 공유 계약이다.
    안 맞으면 수정하지 말고 보고해라.
  - 의존 방향은 단방향이다(cli → runner/generate → core). 역참조·순환을 만들지 마라.
  - @modelcontextprotocol/sdk 는 1.x 고정이다. 목록 밖 의존성을 추가하지 마라.
  - 커밋·푸시·머지를 하지 마라. 백그라운드 실행을 하지 마라. 하위 에이전트를 스폰하지 마라.
  - 다른 작업자의 변경을 되돌리지 마라.
  - T9 · T10 · T11 의 유닛테스트는 인메모리와 fixtures/ 만 써라. provider 와 MCP 클라이언트를
    가짜로 주입하고 실제 프로세스를 띄우지 마라.
  - 최종 응답을 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작하고, 변경 파일,
    실행한 검증 명령과 결과, 남은 위험을 적어라.

T12 까지 끝나면 통합 게이트를 돌려라:
  pnpm build --force
  pnpm typecheck        (Cached: 0 cached 인지 확인해라)
  pnpm test
  pnpm lint

전부 통과하면 변경 요약과 검증 결과를 사람에게 보고하고 멈춰라. 커밋과 PR 생성은 사람이 한다.
PR 을 만들 때는 저장소에 PR 템플릿이 있는지 먼저 확인하고 있으면 그 템플릿을 지켜라.
```

---

## 6. ADR

| 번호 | 내용 | 태스크 |
|---|---|---|
| ADR-0004 개정 | 「값 선택 규칙」에 범위 제약과 `format` 표를 더한다. 「자동 생성하지 않는 범위」에서 `minimum`·`maximum`·`format` 을 뺀다 | T6 |
| ADR-0009 개정 | `generate` → `runner` 승인 심볼 목록 확장 | T4 |
| 신규 | AI 사전보완층. 자동 provider 호출 경계, 후보 추가 규칙, `declared` 필드 보호 | T9 · T10 |
| 신규 | 값 출처 계층. 세 범주와 각 범주의 해결 주체, 실측 근거 | T7 |

**번호는 착수 시점에 빈 것을 잡되 머지 시점에 밀릴 수 있다.** 현재 최대는 0036 이다. 단계 4
에서 착수 시 0028 을 잡았는데 그 사이 다른 ADR 이 들어와 0034 로 밀린 전례가 있다. 착수 시점
확인으로도 못 막는다. 번호가 밀리면 참조 문서를 함께 고친다.

---

## 7. 통합 대장

태스크를 통합한 직후 `docs/task-integration-ledger.tsv` 에 SHA 를 기록하고 별도 문서 커밋으로
보존한다. 대장에 없는 결과는 후속 태스크의 선행 근거로 쓰지 않는다.

줄 이름은 `T1-schema-constraint` ~ `T12-schema-constraint` 다.

---

## 8. 자체 검토 결과

계획을 내놓기 전에 규약 §6 을 스스로 확인했다.

- **설계서 각 절이 태스크에 대응하는가.** §3.1→T5, §3.2·3.3→T6, §3.4→T6·T10·T11, §3.5→T5,
  §3.6→T7, §4→T9·T10, §5→T2·T8, §6→T1·T3, §7→T4, §8→T11, §9→각 태스크의 테스트 스텝,
  §10→설계서에만 있는 재현 절차라 태스크 없음(의도적), §11→T4·T6·T7·T9.
- **공유 계약이 선행 태스크로 분리됐는가.** `ContractRange`(T1) · `ContractAxis`(T2) ·
  `SpecFindingCode`(T3) · 의존 경계(T4) · `ValueProvenance`(T7) · `PreFillProposal`(T9) 이
  모두 소비자보다 앞선다.
- **병렬 태스크의 쓰기 파일이 겹치는가.** 겹치지 않는다. 모든 태스크가 순차이므로 겹칠 수
  없다. 터미널 A 와 B 는 웨이브가 갈린다.
- **모델과 사유가 적혔는가.** §1 표에 있다. 상위 모델 셋(T3 · T4 · T11)에 사유를 적었다.
- **테스트가 격리된 자원만 쓰는가.** T1~T11 은 인메모리다. 실서버를 띄우는 T12 는 직렬 웨이브로
  분리했다.
- **리뷰·수정 루프·최종 게이트가 있는가.** 각 태스크가 보고로 끝나고 오케스트레이터가 diff 를
  확인한다. 터미널마다 통합 게이트가 있다.
- **설계서와 어긋난 곳.** 하나 찾았고 고쳤다. 설계서 §6 이 finding 코드를
  `RANGE_VIOLATION_IN_INPUT` 으로 적었는데 기존 코드가 `TYPE_MISMATCH` · `ENUM_MISMATCH`
  계열이라 `RANGE_MISMATCH` 로 통일했다. **설계서 세 곳을 계획 작성 시점에 이미 고쳤으므로
  두 문서가 지금 일치한다.** 실행자가 다시 고칠 것은 없다.

## 9. 남은 위험

- **커버리지 수치 하락.** 범위 축이 분모에 들어가 기존 명세의 수치가 내려간다. T11 이 고지를
  찍지만, 사용자가 CI 에서 커버리지 임계값을 걸어 뒀다면 그것이 깨질 수 있다. 임계값 옵션이
  현재 있는지 T8 착수 시 확인하고, 있으면 사람에게 보고한다.
- **AI 사전보완의 provider 실패 처리가 미결이다.** 설계서 §12 에 남아 있다. 실패하면 baseline
  값으로 진행하고 화면에 적는 것이 기본이나, `--baseline-only` 가 아닌데 provider 가 죽은 경우
  `unknownFormat` 툴을 건너뛸지 정하지 않았다. **T10 착수 전에 사람에게 물어본다.**
- **`format` 표 확장 기준이 미결이다.** 실측에서 나온 것만 넣는 원칙은 정했으나, 사용자가 표에
  없는 `format` 을 자주 만나면 이슈로 받을지 옵션으로 열지 정하지 않았다.
