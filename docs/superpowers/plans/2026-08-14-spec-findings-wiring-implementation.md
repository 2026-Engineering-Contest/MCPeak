# 입력 계약 대조 소비자 배선 (단계 2-B) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` 로 태스크
> 단위 실행. 스텝은 체크박스(`- [ ]`) 로 추적한다.

**목표:** `runner` 가 이미 export 하는 `checkInputContract` · `checkAssertionSubstance` 를
`generate` 승인 화면과 `cli test` 출력에 배선해, 오타·타입 불일치·항상 참인 단언이 승인 전과
실패 직후에 문장으로 보이게 한다.

**설계:** 검사는 `generate` 안에서 **값 치환 이전** 객체로 돌리고, 결과를 candidate 객체에
`specFindings` 로 실어 보낸다. `cli` 는 그 배열을 읽어 `describeSpecFinding` 문장만 찍는다.
`cli test` 는 파일에서 읽은 suite 를 그대로 검사하고 툴 목록만 `listTools()` 로 한 번 받는다.
판정과 exit code 는 바뀌지 않는다.

**기술 스택:** TypeScript, pnpm workspace, vitest, biome. `@modelcontextprotocol/sdk` 1.x 고정.

**설계 문서:** `docs/superpowers/specs/2026-08-14-spec-findings-wiring-design.md`
**선행 설계:** `docs/superpowers/specs/2026-08-14-input-contract-check-design.md`, ADR-0015

## 전역 제약

- 손대지 않는다: `packages/core/src/types.ts`, 루트 `package.json`·`pnpm-workspace.yaml`·
  `turbo.json`·`tsconfig.base.json`·`vitest.config.ts`.
- 의존 방향: `cli` → `runner`/`generate` → `core`. 역참조·순환 금지.
- 의존성 추가 0건. `@modelcontextprotocol/sdk` 버전 변경 금지.
- 서브에이전트는 git 명령을 실행하지 않는다. 커밋·머지·푸시는 사람이 한다.
- 유닛테스트는 인메모리 리터럴과 `packages/cli/tests/fixtures` 만 쓴다. `examples/` 의 실제 서버를
  띄우는 검증은 웨이브 3(직렬)로 분리한다.
- 문장은 `describeSpecFinding` 만 만든다. 소비자가 finding 문장을 새로 짓지 않는다.
- **후보 지문(`fingerprint`) 계산 입력을 바꾸지 않는다.** `specFindings` 는 지문 계산 대상 밖에
  둔다. 안에 넣으면 이미 승인된 지문이 전부 어긋난다.
- 커밋 메시지는 Conventional Commits, scope 필수(`runner`/`generate`/`cli`). 한국어.

## 완료 조건

1. `pnpm test`, `pnpm typecheck`, `pnpm lint` 전부 통과.
2. `UNCONSTRAINED_SCHEMA` 가 `packages/` 안에 0건.
3. 민감 키를 가진 숫자 필드가 있는 후보에서 `TYPE_MISMATCH` 가 나오지 않는 회귀 테스트가 있고
   통과한다.
4. `generate` 승인 화면에서 blocking finding 이 있으면 확인 프롬프트가 하나 더 나오고, 없으면
   나오지 않는다.
5. `cli test` 는 실패한 케이스에만 참고 문장을 붙이고 exit code 를 바꾸지 않는다.
6. `listTools()` 가 던져도 `cli test` 의 보고서에 추가 줄이 없다.

## 비범위

- `byCodeUnit` 사본 3곳 정리. 별도 PR.
- 중복 툴 이름일 때 `tools` 배열 순서 의존. 별도 PR.
- 단계 3 dry run 승인 게이트.
- `record`·`mock` 패키지.

---

## 1. 실행 모델

메인 세션은 오케스트레이터다. 태스크마다 서브에이전트를 스폰하고 사이사이 리뷰한다(테스트 통과 +
파일 소유권 준수). 구현은 서브에이전트가 한다.

| 태스크 | 모델 | 사유 |
|---|---|---|
| T1 `runner` 정리·문안 | 상위 | 실패 메시지 문안 설계. 이 프로젝트에서 문안은 제품이다 |
| T2 `generate` 로컬 경로 | 표준 | 사양이 계획서에 코드로 못 박혀 있다 |
| T3 `generate` provider 경로 | 상위 | 치환·지문 경계 판단이 있다. 틀리면 조용히 거짓 양성이나 지문 변화가 난다 |
| T4 `cli` 승인 화면 | 상위 | 표시 문안과 게이트 조건 설계 |
| T5 `cli test` 출력 | 상위 | 표시 문안과 무음 조건 설계 |
| T6 실환경 E2E 확인 | 상위 | 거짓 신호 판별 |

## 2. 터미널 분할

**터미널 1개, worktree 1개, 브랜치 1개다.** 분할하지 않는다.

이유는 둘이다. 첫째, 의존이 사슬이다. T1 이 `SpecFindingCode` 를 줄이고, T2·T3 이 그 결과를
candidate 에 싣고, T4 가 그 필드를 읽는다. 병렬로 나눌 지점이 T4 와 T5 뿐이고 둘 다 `cli` 다.
둘째, 사용자가 **단일 PR** 로 정했다. 브랜치를 나누면 합치는 비용만 늘고 얻는 것이 없다.

브랜치: `feat/spec-findings-wiring`
worktree: `.claude/worktrees/mcpeak-spec-findings-wiring`

웨이브는 한 터미널 안의 순서다.

| 웨이브 | 태스크 | 병렬 |
|---|---|---|
| 1 | T1 | 단독 |
| 2 | T2 → T3 | 순차(같은 패키지, 같은 타입 파일) |
| 3 | T4, T5 | 파일이 겹치지 않아 병렬 가능. 리뷰는 각각 |
| 4 | T6 | 직렬 전용. 실제 서버 프로세스를 띄운다 |

## 3. 사람 몫 사전 조건

터미널을 열기 전에 프로젝트 루트에서 두 가지만 확인한다.

1. 이 계획서와 설계 문서(`docs/superpowers/specs/2026-08-14-spec-findings-wiring-design.md`)를
   커밋했는지. **untracked 면 새 worktree 에 따라가지 않는다.**
2. `git status --short` 가 깨끗한지, `git log --oneline -1` 의 SHA 를 적어 둔다. 그 SHA 가 아래
   프롬프트의 기점 검증 값이다.

## 4. 실행 프롬프트

권장 실행 설정: 상위 모델, 추론 수준 높음, 에이전트 종류 `general-purpose`(이 세션이 오케스트레이터로
남고 태스크마다 서브에이전트를 스폰한다).

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

  git worktree add .claude/worktrees/mcpeak-spec-findings-wiring -b feat/spec-findings-wiring HEAD

를 실행한 뒤 그 경로(.claude/worktrees/mcpeak-spec-findings-wiring)로 세션을 옮겨라.
EnterWorktree 도구에 path 로 그 절대 경로를 넘긴다. name 으로 새로 만들게 하지 마라.

진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 `BLOCKED: <사유>` 로 보고해라.
  - pwd 가 .claude/worktrees/mcpeak-spec-findings-wiring 인지
  - git log --oneline -1 이 루트에서 적어 둔 기점 SHA 와 같은지
  - docs/superpowers/plans/2026-08-14-spec-findings-wiring-implementation.md 가 존재하는지
  - docs/superpowers/specs/2026-08-14-spec-findings-wiring-design.md 가 존재하는지
  - docs/superpowers/specs/2026-08-14-input-contract-check-design.md 가 존재하는지
  - git status --short 가 비어 있는지
  - pnpm install 로 의존성을 설치하고 `pnpm vitest run packages/runner/tests/spec-findings.test.ts`
    가 실제로 실행되는지 (새 worktree 는 node_modules 를 상속하지 않는다)

[2단계: 실행]

역할: 오케스트레이터. 너는 직접 구현하지 않는다. 아래 계획서의 태스크마다 서브에이전트를
스폰하고, 보고를 받아 검증하고, 다음 태스크로 넘긴다.

계획서: docs/superpowers/plans/2026-08-14-spec-findings-wiring-implementation.md

순서는 계획서 §2 의 웨이브 표를 따른다. 웨이브 3 의 T4·T5 만 병렬로 스폰하고 나머지는 순차다.
각 태스크의 모델은 계획서 §1 의 표를 따른다.

각 서브에이전트 프롬프트에 다음을 그대로 넣어라.
  - 그 태스크의 Files 목록. 목록 밖 파일 수정 금지. 특히 packages/core/src/types.ts 와 루트 빌드
    설정은 공유 계약이다. 필요해 보이면 수정하지 말고 보고한다.
  - 의존 방향은 단방향(cli → runner/generate → core). 역참조·순환 금지.
  - @modelcontextprotocol/sdk 는 1.x 고정. 목록 밖 의존성 추가 금지.
  - git 명령을 실행하지 않는다. 커밋은 사람이 한다.
  - 테스트는 인메모리 리터럴과 packages/cli/tests/fixtures 만 쓴다.
  - 보고서를 docs/reports/task-<태스크ID>-spec-findings-wiring.md 절대 경로로 쓴다.
  - 완료 형식: 바꾼 파일 목록, 실행한 검증 명령과 그 출력의 판정 줄, 임의로 판단한 지점, 남은 위험.

태스크마다 아래를 통과해야 다음으로 넘어간다.
  - pnpm vitest run <해당 테스트 파일>  가 통과
  - pnpm typecheck  가 통과하고 검사 파일 수가 0이 아님
  - pnpm lint  가 통과
Files 목록 밖 변경이 있으면 되돌리게 하고 사유를 보고서에 남긴다.

전부 끝나면 pnpm test · pnpm typecheck · pnpm lint 를 한 번 더 돌리고, 커밋 제안 목록(태스크
단위, Conventional Commits, scope 필수, 한국어)을 사람에게 제시한다. 직접 커밋하지 마라.
```

---

## 5. 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `packages/runner/src/spec-findings.ts` | finding 타입과 문안 | T1 |
| `packages/runner/src/assertion-substance.ts` | 단언 실질성 검사 | T1 |
| `packages/generate/src/authoring-types.ts` | candidate 공개 타입 | T2 |
| `packages/generate/src/authoring-session.ts` | 로컬 후보 검토 경로 | T2 |
| `packages/generate/src/authoring-request.ts` | provider 후보 경로 | T3 |
| `packages/cli/src/generate-command.ts` | 승인 화면 표시·게이트 | T4 |
| `packages/cli/src/test-command.ts` | 실패 케이스 참고 문장·`--json` | T5 |

새 파일은 만들지 않는다. 표시 로직은 각 커맨드 파일 안의 지역 함수로 둔다. `cli` 의 두 커맨드는
서로 다른 화면이고 공유할 문장이 없다(문장은 `runner` 소유다).

---

## Task 1: `runner` 정리와 문안

**Files**
- Modify: `packages/runner/src/spec-findings.ts`
- Modify: `packages/runner/src/assertion-substance.ts`
- Modify: `packages/runner/tests/assertion-substance.test.ts`
- Modify: `packages/runner/tests/spec-findings.test.ts`
- Modify: `docs/superpowers/specs/2026-08-14-input-contract-check-design.md` (§7·§8 예시 정합)

**Interfaces**
- Produces: `SpecFindingCode` 에서 `"UNCONSTRAINED_SCHEMA"` 가 사라진다. T2~T5 는 남은 8개
  코드만 본다: `TOOL_NOT_DECLARED`, `REQUIRED_MISSING`, `UNDECLARED_FIELD`, `TYPE_MISMATCH`,
  `ENUM_MISMATCH`, `SCHEMA_NOT_ANALYZABLE`, `VACUOUS_MIN_LENGTH`, `VACUOUS_MIN_ITEMS`.
- Produces: `describeSpecFinding(finding: SpecFinding): string` 시그니처는 그대로다.

**근거(왜 지우는가)**

`packages/generate/src/authoring-session.ts:93` 과 `packages/generate/src/baseline.ts:80` 이
`validateMcpSuite` 를 먼저 돌리고 위반이 있으면 후보를 버린다. `validateMcpSuite` 는 빈 스키마를
중첩 레벨까지 거부한다(`{}`, `{minLength:0}`, `{required:[]}`, `{properties:{}}`,
`{type:"object",properties:{a:{}}}` 전부 거부). 그래서 소비자 경로에서 `UNCONSTRAINED_SCHEMA` 는
도달 불가다.

- [ ] **Step 1: 실패하는 테스트로 새 사양을 고정한다**

`packages/runner/tests/assertion-substance.test.ts` 의 `UNCONSTRAINED_SCHEMA` 기대 7곳을 아래로
바꾼다. 기존 헬퍼(`codes` 등)의 이름과 사용법은 파일에 있는 것을 그대로 쓴다.

```ts
it("제약이 없는 schema {} 는 finding 이 없다", () => {
  // UNCONSTRAINED_SCHEMA 제거 후의 사양. 이 스키마는 validateMcpSuite 가 이미 거부한다.
  expect(codes(suiteWithSchema({}))).toEqual([]);
});

it("schema { required: [] } 는 finding 이 없다", () => {
  expect(codes(suiteWithSchema({ required: [] }))).toEqual([]);
});

it("schema { properties: {} } 는 finding 이 없다", () => {
  expect(codes(suiteWithSchema({ properties: {} }))).toEqual([]);
});

it("schema { minLength: 0 } 은 type 없이도 VACUOUS_MIN_LENGTH", () => {
  // hasConstraint 게이트를 없앤 결과다. 검증을 안 거친 입력에서만 도달하며,
  // 그 경우에도 '이 단언은 아무것도 안 한다'가 참이므로 알리는 편이 맞다.
  expect(codes(suiteWithSchema({ minLength: 0 }))).toEqual([
    ["VACUOUS_MIN_LENGTH", "assertions[0].schema.minLength"],
  ]);
});

it("type 이 있는 schema 의 minLength: 0 은 VACUOUS_MIN_LENGTH", () => {
  expect(codes(suiteWithSchema({ type: "string", minLength: 0 }))).toEqual([
    ["VACUOUS_MIN_LENGTH", "assertions[0].schema.minLength"],
  ]);
});

it("중첩 properties 의 제약 없는 스키마도 finding 이 없다", () => {
  expect(
    codes(suiteWithSchema({ type: "object", properties: { temp: {} } })),
  ).toEqual([]);
});

it("items 의 제약 없는 스키마도 finding 이 없다", () => {
  expect(codes(suiteWithSchema({ type: "array", items: {} }))).toEqual([]);
});
```

정렬 계약 테스트를 하나 추가한다. `VACUOUS_MIN_LENGTH` 가 `VACUOUS_MIN_ITEMS` 보다 앞이고, 같은
코드끼리는 `path` 의 UTF-16 코드 단위 오름차순이다.

```ts
it("VACUOUS_MIN_LENGTH 가 VACUOUS_MIN_ITEMS 보다 앞에 온다", () => {
  const schema = {
    type: "object",
    properties: {
      b: { type: "array", minItems: 0 },
      a: { type: "string", minLength: 0 },
    },
  };
  expect(codes(suiteWithSchema(schema))).toEqual([
    ["VACUOUS_MIN_LENGTH", "assertions[0].schema.properties.a.minLength"],
    ["VACUOUS_MIN_ITEMS", "assertions[0].schema.properties.b.minItems"],
  ]);
});
```

`packages/runner/tests/spec-findings.test.ts` 에서 세 곳을 고친다.

1. `it("UNCONSTRAINED_SCHEMA", ...)` (97행) 블록을 삭제한다.
2. 150행의 `finding({ code: "UNCONSTRAINED_SCHEMA", path: "assertions[0].schema" })` 를
   `finding({ code: "VACUOUS_MIN_LENGTH", path: "assertions[0].schema.minLength" })` 로 바꾼다.
3. 206행의 개행 이스케이프 테스트는 코드만 바꿔 **커버리지를 유지한다.** 이 테스트가 지키는 것은
   "남의 스키마 프로퍼티 이름에 개행이 있어도 반환에 줄바꿈이 없다" 이므로 코드가 무엇이든
   상관없다.

```ts
expect(
  describeSpecFinding(
    finding({
      code: "VACUOUS_MIN_LENGTH",
      path: "assertions[0].schema.properties.a\nb.minLength",
    }),
  ),
).not.toContain("\n");
```

`TYPE_MISMATCH` 문안 테스트를 새 문장으로 고친다.

```ts
it("TYPE_MISMATCH 는 어느 쪽이 서버인지 낱말로 구분한다", () => {
  expect(
    describeSpecFinding(
      finding({ code: "TYPE_MISMATCH", path: "input.city", expected: "string", actual: "number" }),
    ),
  ).toBe("input.city 의 타입이 다릅니다. 서버 선언: 'string', 명세: 'number'");
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run packages/runner/tests/assertion-substance.test.ts packages/runner/tests/spec-findings.test.ts`
Expected: FAIL. 새 기대와 현재 구현이 어긋난다.

- [ ] **Step 3: `spec-findings.ts` 를 고친다**

`SpecFindingCode` 의 `| "UNCONSTRAINED_SCHEMA" // 제약이 하나도 없는 스키마` 줄을 삭제한다.
`describeSpecFinding` 의 해당 `case` 두 줄을 삭제한다. `TYPE_MISMATCH` 문장을 고친다.

```ts
    case "TYPE_MISMATCH":
      return `${path} 의 타입이 다릅니다. 서버 선언: ${literal(expected)}, 명세: ${literal(actual)}`;
```

- [ ] **Step 4: `assertion-substance.ts` 를 고친다**

`CODE_ORDER` 에서 `UNCONSTRAINED_SCHEMA` 항목을 지우고 값을 당긴다.

```ts
const CODE_ORDER: Readonly<Partial<Record<SpecFindingCode, number>>> = {
  VACUOUS_MIN_LENGTH: 0,
  VACUOUS_MIN_ITEMS: 1,
};
```

`hasConstraint` 함수(30~46행)와 `walk` 안의 분기를 지운다. `hasConstraint` 의 유일한 목적이
`UNCONSTRAINED_SCHEMA` 판정이었으므로 함수째 사라진다. `walk` 의 본문은 아래가 된다.

```ts
        // 제약 유무를 따지지 않는다. minLength: 0 · minItems: 0 은 그 자체로 통과가 보장된
        // 단언이고, 그 사실은 같은 스키마에 다른 제약이 있든 없든 참이다.
        if (schema.minLength === 0) add("VACUOUS_MIN_LENGTH", `${path}.minLength`);
        if (schema.minItems === 0) add("VACUOUS_MIN_ITEMS", `${path}.minItems`);
```

`SpecFindingCode` import 는 `add` 의 파라미터 타입으로 계속 쓰이므로 남긴다.

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm vitest run packages/runner/tests/assertion-substance.test.ts packages/runner/tests/spec-findings.test.ts`
Expected: PASS

Run: `grep -rn "UNCONSTRAINED_SCHEMA" packages/ --include="*.ts"`
Expected: 출력 0줄

- [ ] **Step 6: 선행 설계 문서를 정합화한다**

`docs/superpowers/specs/2026-08-14-input-contract-check-design.md` 에서
`UNCONSTRAINED_SCHEMA` 항목을 제거하고 제거 사유를 한 문단으로 남긴다(도달 불가, 근거 파일·행
번호 포함). §8 의 예시 출력 따옴표 표기를 §7 의 실제 문안과 같게 맞춘다. `TYPE_MISMATCH` 예시를
`서버 선언:` 으로 고친다.

- [ ] **Step 7: 전체 회귀**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: 전부 통과. `typecheck` 출력의 검사 파일 수가 0이 아닌지 확인한다.

- [ ] **Step 8: 커밋 제안 (사람이 실행)**

```
refactor(runner): 도달 불가한 UNCONSTRAINED_SCHEMA 를 제거하고 TYPE_MISMATCH 문안을 다듬는다
```

---

## Task 2: `generate` 로컬 후보 경로 배선

**Files**
- Modify: `packages/generate/src/authoring-types.ts`
- Modify: `packages/generate/src/authoring-session.ts`
- Modify: `packages/generate/tests/authoring-session.test.ts`

**Interfaces**
- Consumes: T1 이 줄인 `SpecFindingCode`. `checkInputContract` · `checkAssertionSubstance` 는
  이미 `@mcpeak/runner` 에서 export 돼 있다.
- Produces: 아래 타입. T3 이 같은 필드를 provider 경로에 채우고 T4 가 읽는다.

```ts
export interface CandidateSpecFindings {
  readonly inputContract: SpecFindingsResult;
  readonly assertionSubstance: SpecFindingsResult;
}
```

`SanitizedAuthoringCandidate` 에 `readonly specFindings: CandidateSpecFindings;` 를 더한다.
`result` 안에 넣지 않는다. `fingerprint` 가 `result` 로 계산되므로 안에 넣으면 이미 승인된
지문이 전부 어긋난다.

**두 결과를 병합하지 않는 이유**

병합하면 두 검사 사이의 정렬 정책을 새로 정해야 하고 `totalFindings` 둘을 어떻게 합칠지가
애매해진다. 나누면 각 검사의 기존 정렬과 `totalFindings` 가 뜻을 그대로 유지한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/generate/tests/authoring-session.test.ts` 에 추가한다. 이 파일의 기존 헬퍼로 세션과
후보를 만든다.

```ts
const weatherTools = [
  {
    name: "get_weather",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string" }, units: { enum: ["c", "f"] } },
      required: ["city"],
    },
  },
] as const;

it("오타·enum 위반·항상 참인 단언을 specFindings 로 보고한다", () => {
  const session = createAuthoringSession(baselineFor(weatherTools));
  const result = reviewLocalAuthoringCandidate({
    session,
    tools: weatherTools,
    candidate: suiteWith({
      id: "seoul-weather",
      operation: { type: "callTool", tool: "get_weather", input: { citi: "Seoul", units: "celsius" } },
      assertions: [{ type: "bodyMatchesSchema", schema: { type: "string", minLength: 0 } }],
    }),
  });
  if (result.status !== "preview") throw new Error(`preview 가 아니다: ${result.status}`);
  expect(result.preview.specFindings.inputContract.findings.map((f) => f.code)).toEqual([
    "REQUIRED_MISSING",
    "UNDECLARED_FIELD",
    "ENUM_MISMATCH",
  ]);
  expect(result.preview.specFindings.assertionSubstance.findings.map((f) => f.code)).toEqual([
    "VACUOUS_MIN_LENGTH",
  ]);
});

it("치환된 민감 필드 때문에 TYPE_MISMATCH 가 나지 않는다", () => {
  // 이 테스트가 '검사를 치환 이전에 돌린다'는 설계의 유일한 근거다. 치환 이후로 옮기면
  // token 값이 '[REDACTED]' 문자열이 되어 number 선언과 어긋나 거짓 양성이 난다.
  const tools = [
    {
      name: "auth",
      inputSchema: {
        type: "object",
        properties: { token: { type: "number" } },
        required: ["token"],
      },
    },
  ] as const;
  const session = createAuthoringSession(baselineFor(tools));
  const result = reviewLocalAuthoringCandidate({
    session,
    tools,
    candidate: suiteWith({
      id: "auth-case",
      operation: { type: "callTool", tool: "auth", input: { token: 12345 } },
      assertions: [{ type: "bodyMatchesSchema", schema: { type: "string", minLength: 1 } }],
    }),
  });
  if (result.status !== "preview") throw new Error(`preview 가 아니다: ${result.status}`);
  expect(result.preview.specFindings.inputContract.findings).toEqual([]);
  expect(result.preview.redactedPaths).toEqual(["cases[0].operation.input"]);
});

it("specFindings 는 fingerprint 를 바꾸지 않는다", () => {
  // 승인 지문 계약이 깨지지 않는 것을 고정한다.
  const session = createAuthoringSession(baselineFor(weatherTools));
  const result = reviewLocalAuthoringCandidate({ session, tools: weatherTools, candidate: cleanSuite });
  if (result.status !== "preview") throw new Error(`preview 가 아니다: ${result.status}`);
  expect(result.preview.fingerprint).toBe(KNOWN_CLEAN_FINGERPRINT);
});
```

`KNOWN_CLEAN_FINGERPRINT` 는 새로 만들지 말고, 이 파일에 이미 지문을 단언하는 테스트가 있으면 그
값을 쓴다. 없으면 구현 전에 현재 구현으로 한 번 얻어 상수로 박고, 구현 후 그 값이 유지되는지
본다. 얻은 방법을 보고서에 적는다.

`baselineFor` · `suiteWith` · `cleanSuite` 는 파일에 이미 있는 헬퍼를 쓴다. 이름이 다르면 기존
이름을 그대로 쓰고 보고서에 무엇으로 바꿨는지 적는다. 새 픽스처 파일을 만들지 않는다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run packages/generate/tests/authoring-session.test.ts`
Expected: FAIL. `specFindings` 가 없다.

- [ ] **Step 3: 타입을 더한다**

`packages/generate/src/authoring-types.ts`:

```ts
import type { SpecFindingsResult } from "@mcpeak/runner";

/**
 * 승인 화면이 읽는 비차단 진단. 두 검사를 병합하지 않고 따로 담는다. 각 검사의 정렬과
 * totalFindings 가 그대로 뜻을 유지해야 한다.
 * 지문(fingerprint) 계산 대상이 아니다. 계산에 넣으면 승인된 지문이 전부 어긋난다.
 */
export interface CandidateSpecFindings {
  readonly inputContract: SpecFindingsResult;
  readonly assertionSubstance: SpecFindingsResult;
}
```

`SanitizedAuthoringCandidate` 에 필드를 더한다.

```ts
  readonly specFindings: CandidateSpecFindings;
```

- [ ] **Step 4: `candidateFor` 를 고친다**

`packages/generate/src/authoring-session.ts` 의 `candidateFor` 에서 `redactAuthoringSuite` 호출
**이전**에 검사한다. `value` 가 치환 전 객체다.

```ts
  // 검사는 값 치환 이전 객체로 한다. 치환 후에 하면 숫자 필드가 '[REDACTED]' 문자열이 되어
  // TYPE_MISMATCH 거짓 양성이 난다. 설계 문서 §3.
  const specFindings = deepFreeze({
    inputContract: checkInputContract({ suite: value, tools: options.tools }),
    assertionSubstance: checkAssertionSubstance(value),
  });
  const redacted = redactAuthoringSuite(value, { ... });   // 기존 호출 그대로
```

`preview` 객체 리터럴에 `specFindings` 를 더한다. `fingerprint: sha256(frozenSuite)` 는 그대로
둔다.

import 를 더한다.

```ts
import { checkAssertionSubstance, checkInputContract, validateMcpSuite } from "@mcpeak/runner";
```

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm vitest run packages/generate/tests/authoring-session.test.ts`
Expected: PASS

Run: `pnpm vitest run packages/generate`
Expected: PASS. `dependency-boundary.test.ts` 가 의존 방향을 함께 지킨다.

- [ ] **Step 6: 커밋 제안 (사람이 실행)**

```
feat(generate): 로컬 후보 검토에 입력 계약 대조 결과를 싣는다
```

---

## Task 3: `generate` provider 후보 경로 배선

**Files**
- Modify: `packages/generate/src/authoring-request.ts`
- Modify: `packages/generate/tests/authoring-request.test.ts`

**Interfaces**
- Consumes: T2 의 `CandidateSpecFindings` 와 `SanitizedAuthoringCandidate.specFindings`.
- Produces: provider 경로 candidate 도 같은 필드를 채운다. T4 는 두 경로를 구분하지 않는다.

**이 태스크가 따로 있는 이유**

AI 경로의 candidate 는 `authoring-session.ts` 가 아니라 `authoring-request.ts:414` 에서 만들어진다
(`dispatchAuthoringRequest` → `status: "preview"`). 로드맵이 말한 "AI 케이스에 경고" 가 실제로
지나가는 경로가 이쪽이다. T2 만 하면 AI 후보에는 경고가 안 붙는다.

**여기서 갈리는 판단 둘**

1. **검사 대상 suite.** `authoring-request.ts:394` 의 `redactAuthoringSuite(suite, ...)` 이전
   변수 `suite`(provider 원본)를 쓴다. `sanitized.suite` 를 쓰면 T2 와 같은 거짓 양성이 난다.
2. **검사에 쓸 툴 목록.** `state.tools` 는 provider 로 보내려고 **치환된** 사본이다
   (`authoring-request.ts:282`). `TOOL_CONTRACT_PATHS` 가 지키는 것은 `[i].name` 뿐이라
   `inputSchema` 안의 `enum` 값은 치환될 수 있고, 그러면 `ENUM_MISMATCH` 거짓 양성이 난다.
   그래서 `prepareAuthoringRequest` 가 받은 **원본** `options.tools` 를 요청 상태에 따로
   보관하고 검사에만 쓴다. 원본은 provider 로 나가지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/generate/tests/authoring-request.test.ts` 에 추가한다. 이 파일의 기존 방식대로 가짜
provider 응답을 넣는다.

```ts
it("provider 후보에도 specFindings 가 붙는다", async () => {
  const result = await dispatchWithProviderSuite({
    tools: [
      {
        name: "get_weather",
        inputSchema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    ],
    providerSuite: suiteWith({
      id: "seoul-weather",
      operation: { type: "callTool", tool: "get_weather", input: { citi: "Seoul" } },
      assertions: [{ type: "bodyMatchesSchema", schema: { type: "string", minLength: 1 } }],
    }),
  });
  if (result.status !== "preview") throw new Error(`preview 가 아니다: ${result.status}`);
  expect(result.preview.specFindings.inputContract.findings.map((f) => f.code)).toEqual([
    "REQUIRED_MISSING",
    "UNDECLARED_FIELD",
  ]);
});

it("enum 값이 민감 값과 같아도 ENUM_MISMATCH 가 나지 않는다", async () => {
  // 검사에 치환된 tools 를 쓰면 선언 enum 이 '[REDACTED]' 가 되어 정상 입력이 위반으로 뒤집힌다.
  const result = await dispatchWithProviderSuite({
    redaction: { sensitiveValues: ["c"] },
    tools: [
      {
        name: "get_weather",
        inputSchema: {
          type: "object",
          properties: { units: { enum: ["c", "f"] } },
          required: ["units"],
        },
      },
    ],
    providerSuite: suiteWith({
      id: "units-case",
      operation: { type: "callTool", tool: "get_weather", input: { units: "f" } },
      assertions: [{ type: "bodyMatchesSchema", schema: { type: "string", minLength: 1 } }],
    }),
  });
  if (result.status !== "preview") throw new Error(`preview 가 아니다: ${result.status}`);
  expect(result.preview.specFindings.inputContract.findings).toEqual([]);
});

it("specFindings 는 provider candidate 의 fingerprint 를 바꾸지 않는다", async () => {
  const before = await dispatchWithProviderSuite({ tools: cleanTools, providerSuite: cleanSuite });
  if (before.status !== "preview") throw new Error("preview 가 아니다");
  expect(before.preview.fingerprint).toBe(KNOWN_PROVIDER_FINGERPRINT);
});
```

`dispatchWithProviderSuite` · `suiteWith` · `cleanTools` · `cleanSuite` ·
`KNOWN_PROVIDER_FINGERPRINT` 는 이 파일에 이미 있는 헬퍼와 상수를 쓴다. 이름이 다르면 기존
이름을 쓰고 보고서에 적는다. 지문 상수가 없으면 구현 전 현재 값을 얻어 박고 구현 후 유지되는지
본다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run packages/generate/tests/authoring-request.test.ts`
Expected: FAIL

- [ ] **Step 3: 원본 툴 목록을 요청 상태에 보관한다**

`prepareAuthoringRequest` 가 만드는 요청 상태에 필드를 하나 더한다. provider 로 나가는 payload
에는 넣지 않는다.

```ts
  // 검사용 원본이다. provider 로 보내는 사본은 치환돼 있어 enum 값이 바뀔 수 있고, 그것으로
  // 대조하면 정상 입력이 ENUM_MISMATCH 로 뒤집힌다. payload 에는 넣지 않는다.
  unredactedTools: options.tools,
```

`byte(...)` 로 payload 크기를 재는 계산과 `assertJson` 검사 대상에는 이 필드를 넣지 않는다.
넣으면 `MAX_TOOLS_BYTES` 판정이 두 배로 세어져 정상 요청이 거부된다.

- [ ] **Step 4: candidate 에 검사 결과를 싣는다**

`authoring-request.ts:394` 의 `redactAuthoringSuite` 호출 **이전**에 검사하고, 414행의 candidate
리터럴에 필드를 더한다.

```ts
  const specFindings = frozen({
    inputContract: checkInputContract({
      suite: suite as TestSuiteSpec,
      tools: state.unredactedTools,
    }),
    assertionSubstance: checkAssertionSubstance(suite as TestSuiteSpec),
  });
```

`suite` 는 이 지점에서 이미 `validateMcpSuite` 와 identity·툴 allowlist 검사를 통과했다
(`contextIssues.length` 분기 뒤). 그래서 `TestSuiteSpec` 으로 좁혀도 된다. 그 앞으로 옮기지 마라.
검증 안 된 객체를 검사에 넘기면 검사 안에서 던진다.

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm vitest run packages/generate`
Expected: PASS

- [ ] **Step 6: 커밋 제안 (사람이 실행)**

```
feat(generate): provider 후보에도 입력 계약 대조 결과를 싣는다
```

---

## Task 4: `cli` 승인 화면 표시와 재확인

**Files**
- Modify: `packages/cli/src/generate-command.ts`
- Modify: `packages/cli/tests/generate-command.test.ts`

**Interfaces**
- Consumes: `SanitizedAuthoringCandidate.specFindings` (T2·T3), `describeSpecFinding` (T1),
  `AuthoringDiffPreview.changes[].caseId`.
- Produces: 없음. 화면이 끝이다.

**표시 규칙 (설계 문서 §6)**

1. `showDiff` 직후가 아니라 **change ID 선택 뒤**에 찍는다. 선택한 change 의 `caseId` 집합에
   걸린 finding 만 센다. 위반 케이스를 선택에서 뺐으면 경고할 이유가 없다.
2. `caseId` 가 없는 change 종류(`suiteMetadata`, `caseOrder`)는 집합에 아무것도 넣지 않는다.
3. `SCHEMA_NOT_ANALYZABLE` 은 위반이 아니라 건너뜀이다. 개수에서 빼고 별도 줄로 알린다.
4. 문장은 `describeSpecFinding` 만 만든다. CLI 는 들여쓰기와 화살표만 붙인다.
5. blocking 이 1건 이상이면 기존 `io.confirm("선택한 변경을 적용할까요?")` **앞에** 확인을 하나
   더 넣는다. 거부하지 않는다. 서버가 `inputSchema` 를 느슨하게 선언하면 정상 명세도
   `UNDECLARED_FIELD` 로 걸리므로, 거부하면 옳은 명세를 저장할 길이 막힌다.

**출력 형태**

```
입력 계약 위반 2건 (선택한 변경 기준)
  → change-002 seoul-weather
     필수 필드 'city' 가 입력에 없습니다. 비슷한 필드: 'citi'
     'citi' 는 서버가 선언하지 않은 필드입니다. 비슷한 필드: 'city'
  → 해석하지 못한 서버 스키마 1건은 검사에서 빠졌습니다.
```

`위반 N건이 남아 있습니다. 그래도 적용합니까?` 가 재확인 문구다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/cli/tests/generate-command.test.ts` 에 추가한다. 이 파일의 기존 가짜 `ReviewIO` 와
의존성 주입 방식을 그대로 쓴다.

```ts
it("선택한 change 의 케이스에 걸린 finding 만 센다", async () => {
  // change-001 은 깨끗하고 change-002 만 위반이다. change-001 만 고르면 경고가 없다.
  const io = fakeIO(["select", "change-001", "y", "cancel"]);
  await runGenerate({ io, candidate: candidateWithFindings });
  expect(io.written.join("")).not.toContain("입력 계약 위반");
  expect(io.confirms).toEqual(["선택한 변경을 적용할까요?"]);
});

it("위반 케이스를 고르면 문장과 재확인이 나온다", async () => {
  const io = fakeIO(["select", "change-002", "y", "y", "cancel"]);
  await runGenerate({ io, candidate: candidateWithFindings });
  const out = io.written.join("");
  expect(out).toContain("입력 계약 위반 2건 (선택한 변경 기준)");
  expect(out).toContain("필수 필드 'city' 가 입력에 없습니다. 비슷한 필드: 'citi'");
  expect(io.confirms).toEqual([
    "위반 2건이 남아 있습니다. 그래도 적용합니까?",
    "선택한 변경을 적용할까요?",
  ]);
});

it("재확인에서 거부하면 적용하지 않는다", async () => {
  const io = fakeIO(["select", "change-002", "n", "cancel"]);
  const applied = await runGenerate({ io, candidate: candidateWithFindings });
  expect(applied).toBe(0);
});

it("SCHEMA_NOT_ANALYZABLE 은 위반 개수에서 빠지고 별도 줄로 나온다", async () => {
  const io = fakeIO(["apply-all", "y", "cancel"]);
  await runGenerate({ io, candidate: candidateWithUnanalyzableSchema });
  const out = io.written.join("");
  expect(out).toContain("해석하지 못한 서버 스키마 1건은 검사에서 빠졌습니다.");
  expect(out).not.toContain("입력 계약 위반");
  expect(io.confirms).toEqual(["선택한 변경을 적용할까요?"]);
});

it("finding 이 없으면 아무 줄도 늘지 않는다", async () => {
  const io = fakeIO(["apply-all", "y", "cancel"]);
  await runGenerate({ io, candidate: cleanCandidate });
  expect(io.written.join("")).not.toContain("입력 계약");
  expect(io.confirms).toEqual(["선택한 변경을 적용할까요?"]);
});
```

`candidateWithFindings` 는 `specFindings.inputContract.findings` 에 `REQUIRED_MISSING` ·
`UNDECLARED_FIELD` 를 `caseId: "seoul-weather"` 로 담고, diff 가 `change-001`(다른 케이스)과
`change-002`(seoul-weather)를 내게 구성한다. 실제 `generate` 함수를 부르지 않고 리터럴로 만든다.
`cli` 테스트는 `generate` 를 주입으로 받는다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run packages/cli/tests/generate-command.test.ts`
Expected: FAIL

- [ ] **Step 3: 지역 함수 둘을 더한다**

`generate-command.ts` 에 추가한다.

```ts
/** 위반으로 세는 것만 남긴다. SCHEMA_NOT_ANALYZABLE 은 건너뜀이라 위반이 아니다. */
const isViolation = (finding: SpecFinding): boolean => finding.code !== "SCHEMA_NOT_ANALYZABLE";

/**
 * 선택한 change 의 caseId 집합에 걸린 finding 만 뽑는다. 순서는 재정렬하지 않는다.
 * runner 가 정한 순서가 곧 사양이고, 여기서 다시 정렬하면 화면마다 순서가 갈린다.
 */
function findingsForSelection(
  candidate: SanitizedAuthoringCandidate,
  preview: AuthoringDiffPreview,
  selectedChangeIds: readonly string[],
): readonly SpecFinding[] {
  const ids = new Set(selectedChangeIds);
  const caseIds = new Set(
    preview.changes
      .filter((change) => ids.has(change.id) && "caseId" in change)
      .map((change) => (change as { caseId: string }).caseId),
  );
  return [
    ...candidate.specFindings.inputContract.findings,
    ...candidate.specFindings.assertionSubstance.findings,
  ].filter((finding) => caseIds.has(finding.caseId));
}
```

- [ ] **Step 4: 표시와 게이트를 넣는다**

`runInteractiveReview` 의 `apply-all`/`select` 분기에서 `selected` 를 정한 직후, 기존
`io.confirm("선택한 변경을 적용할까요?")` 앞에 넣는다.

```ts
        const findings = findingsForSelection(candidate, diff, selected);
        const violations = findings.filter(isViolation);
        const skipped = findings.length - violations.length;
        if (violations.length > 0) {
          const byCase = new Map<string, SpecFinding[]>();
          for (const finding of violations) {
            const list = byCase.get(finding.caseId) ?? [];
            list.push(finding);
            byCase.set(finding.caseId, list);
          }
          io.write(`입력 계약 위반 ${violations.length}건 (선택한 변경 기준)\n`);
          for (const [caseId, list] of byCase) {
            const change = diff.changes.find((item) => "caseId" in item && item.caseId === caseId);
            io.write(`  → ${change?.id ?? ""} ${caseId}\n`);
            for (const finding of list) io.write(`     ${describeSpecFinding(finding)}\n`);
          }
        }
        if (skipped > 0)
          io.write(`  → 해석하지 못한 서버 스키마 ${skipped}건은 검사에서 빠졌습니다.\n`);
        if (
          violations.length > 0 &&
          !(await io.confirm(`위반 ${violations.length}건이 남아 있습니다. 그래도 적용합니까?`))
        )
          continue;
```

`byCase` 의 순회 순서는 `Map` 삽입 순서이고, 삽입 순서는 `runner` 의 finding 순서다. 정렬하지
않는다.

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm vitest run packages/cli/tests/generate-command.test.ts packages/cli/tests/generate-integration.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋 제안 (사람이 실행)**

```
feat(cli): 승인 화면에 입력 계약 위반을 표시하고 재확인을 받는다
```

---

## Task 5: `cli test` 참고 문장과 `--json`

**Files**
- Modify: `packages/cli/src/test-command.ts`
- Modify: `packages/cli/tests/test-command.test.ts`

**Interfaces**
- Consumes: `checkInputContract` · `checkAssertionSubstance` · `describeSpecFinding` (`runner`),
  `connection.client.listTools()` (`core` 의 `McpClient`), `finalReport.cases[].status`.
- Produces: 없음.

**규칙 (설계 문서 §7)**

1. `listTools()` 는 연결 성공 직후 한 번 부른다. 던지거나 빈 배열이면 입력 계약 대조를 **조용히**
   건너뛴다. 비차단 진단이 실행을 깨뜨리면 안 되고, 실패 원인과 무관한 줄이 섞이면 정작 필요한
   줄이 안 읽힌다.
2. `checkAssertionSubstance` 는 툴이 필요 없으므로 항상 돈다.
3. 표시는 `status !== "passed"` 인 케이스에 한한다. 위치는 `renderReport` 출력 뒤, 명세 승인 블록
   앞이다.
4. exit code 와 `finalReport` 내용은 바뀌지 않는다.
5. `--json` 은 `spec.findings` 에 구조로 담는다. 문장은 담지 않는다. 기계는 코드로 분기한다.

**출력 형태**

```
참고: seoul-weather 의 입력이 서버 선언과 다릅니다
  → 필수 필드 'city' 가 입력에 없습니다. 비슷한 필드: 'citi'
```

`--json` 은 기존 `spec` 객체에 키 하나를 더한다. 키는 억제 규칙과 무관하게 **항상** 있다
(빈 배열이라도). 조건부로 사라지면 소비자가 분기를 하나 더 써야 한다.

```json
"spec": {
  "approval": "matched",
  "fingerprint": "…",
  "findings": [
    { "code": "REQUIRED_MISSING", "severity": "blocking", "caseId": "seoul-weather", "path": "input.city" }
  ]
}
```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/cli/tests/test-command.test.ts` 에 추가한다. 기존 가짜 `connect` · `startRunner` ·
`finalize` 주입 방식을 그대로 쓴다.

```ts
it("실패한 케이스에만 참고 문장을 붙인다", async () => {
  const out = await runTest({
    suite: seoulSuiteWithTypo,
    tools: weatherTools,
    report: reportWith({ "seoul-weather": "failed", "busan-weather": "passed" }),
  });
  expect(out.stdout).toContain("참고: seoul-weather 의 입력이 서버 선언과 다릅니다");
  expect(out.stdout).toContain("→ 필수 필드 'city' 가 입력에 없습니다. 비슷한 필드: 'citi'");
  expect(out.stdout).not.toContain("busan-weather 의 입력이");
});

it("전부 통과면 참고 문장이 없다", async () => {
  const out = await runTest({
    suite: seoulSuiteWithTypo,
    tools: weatherTools,
    report: reportWith({ "seoul-weather": "passed" }),
  });
  expect(out.stdout).not.toContain("참고:");
  expect(out.exitCode).toBe(0);
});

it("listTools 가 던지면 추가 줄이 없고 판정도 그대로다", async () => {
  const out = await runTest({
    suite: seoulSuiteWithTypo,
    listTools: () => Promise.reject(new Error("boom")),
    report: reportWith({ "seoul-weather": "failed" }),
  });
  expect(out.stdout).not.toContain("입력이 서버 선언과 다릅니다");
  expect(out.exitCode).toBe(1);
});

it("listTools 가 빈 배열이면 입력 계약 대조를 건너뛴다", async () => {
  const out = await runTest({
    suite: seoulSuiteWithTypo,
    tools: [],
    report: reportWith({ "seoul-weather": "failed" }),
  });
  expect(out.stdout).not.toContain("입력이 서버 선언과 다릅니다");
});

it("항상 참인 단언은 툴 목록 없이도 참고 문장이 나온다", async () => {
  const out = await runTest({
    suite: suiteWithVacuousAssertion,
    listTools: () => Promise.reject(new Error("boom")),
    report: reportWith({ "vacuous-case": "failed" }),
  });
  expect(out.stdout).toContain("는 0이라 모든 문자열이 통과합니다");
});

it("--json 은 findings 를 구조로 담고 문장을 담지 않는다", async () => {
  const out = await runTest({
    json: true,
    suite: seoulSuiteWithTypo,
    tools: weatherTools,
    report: reportWith({ "seoul-weather": "failed" }),
  });
  const parsed = JSON.parse(out.stdout);
  expect(parsed.spec.findings).toEqual([
    { code: "REQUIRED_MISSING", severity: "blocking", caseId: "seoul-weather", path: "input.city" },
    { code: "UNDECLARED_FIELD", severity: "blocking", caseId: "seoul-weather", path: "input.citi" },
  ]);
});

it("--json 의 findings 키는 finding 이 없어도 있다", async () => {
  const out = await runTest({
    json: true,
    suite: cleanSuite,
    tools: weatherTools,
    report: reportWith({ "clean-case": "passed" }),
  });
  expect(JSON.parse(out.stdout).spec.findings).toEqual([]);
});
```

`path` 와 `severity` 기대값은 리터럴로 박지 말고, 먼저 `checkInputContract` 를 그 입력으로 직접
불러 실제 값을 확인한 뒤 그 값으로 적는다. 확인한 값을 보고서에 남긴다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run packages/cli/tests/test-command.test.ts`
Expected: FAIL

- [ ] **Step 3: 툴 목록을 받는다**

연결 성공 직후, `startRunner` 호출 전에 넣는다.

```ts
  /**
   * 비차단 진단용 툴 목록. 실패하면 조용히 빈 배열로 둔다. 진단이 실행을 깨뜨리면 안 되고,
   * 실패 원인과 무관한 줄이 보고서에 섞이면 정작 필요한 줄이 안 읽힌다. 설계 문서 §7.1.
   */
  const tools = await (async () => {
    try {
      return await connection.client.listTools();
    } catch {
      return [];
    }
  })();
```

- [ ] **Step 4: 검사하고 실패 케이스로 좁힌다**

`finalReport` 를 받은 뒤, 출력 분기 앞에 넣는다.

```ts
  /**
   * 툴 목록이 비면 입력 계약 대조는 건너뛴다. 단언 실질성은 툴이 필요 없어 항상 돈다.
   * 판정과 exit code 는 바뀌지 않는다. 설계 문서 §7.
   */
  const failedCaseIds = new Set(
    finalReport.cases.filter((item) => item.status !== "passed").map((item) => item.spec.id),
  );
  const specFindings = [
    ...(tools.length === 0
      ? []
      : dependencies.checkInputContract({ suite: validated.value, tools }).findings),
    ...dependencies.checkAssertionSubstance(validated.value).findings,
  ].filter((finding) => failedCaseIds.has(finding.caseId));
```

두 함수는 `dependencies` 에 주입 지점을 만든다. `checkSpecApproval` 과 달리 여기서는 가짜
finding 으로 표시 분기를 검증할 필요가 있고, 실제 검사 로직은 `runner` 테스트가 이미 덮는다.
기본값은 `runner` 의 실제 함수로 둔다(`packages/cli/src/index.ts` 의 기존 주입 지점과 같은
방식).

- [ ] **Step 5: 표시와 `--json` 을 넣는다**

`--json` 분기의 `spec` 객체에 키를 더한다.

```ts
      const spec: {
        approval: SpecApprovalState;
        fingerprint: string;
        approvedFingerprint?: string;
        findings: readonly { code: string; severity: string; caseId: string; path: string }[];
      } = {
        approval: specApproval.state,
        fingerprint: specApproval.fingerprint,
        // 문장은 담지 않는다. 사람이 읽는 출력의 것이고, 기계는 code 로 분기한다.
        findings: specFindings.map(({ code, severity, caseId, path }) => ({
          code,
          severity,
          caseId,
          path,
        })),
      };
```

사람이 읽는 분기에서는 `renderReport` 출력 뒤, 명세 승인 블록 **앞**에 찍는다.

```ts
      if (specFindings.length > 0) {
        const byCase = new Map<string, SpecFinding[]>();
        for (const finding of specFindings) {
          const list = byCase.get(finding.caseId) ?? [];
          list.push(finding);
          byCase.set(finding.caseId, list);
        }
        for (const [caseId, list] of byCase) {
          // caseId 는 남이 쓴 명세에서 온다. 다른 표시 항목과 같은 이스케이프를 쓴다.
          dependencies.writeStdout(
            `\n참고: ${escapeTerminalText(caseId)} 의 입력이 서버 선언과 다릅니다\n` +
              list.map((finding) => `  → ${describeSpecFinding(finding)}\n`).join(""),
          );
        }
      }
```

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm vitest run packages/cli`
Expected: PASS

- [ ] **Step 7: 커밋 제안 (사람이 실행)**

```
feat(cli): test 실패 케이스에 입력 계약 참고 문장을 덧붙인다
```

---

## Task 6: 실환경 확인 (직렬 전용)

**Files**
- Modify: 없음. 확인만 한다. 결함을 찾으면 보고하고 멈춘다.
- 보고서: `docs/reports/task-t6-spec-findings-wiring.md`

**전제:** 웨이브 1~3 이 끝나 있고 `pnpm test` 가 통과한다. 이 태스크는 다른 태스크와 동시에
돌리지 않는다. `examples/` 의 실제 서버 프로세스를 띄운다.

- [ ] **Step 1: 예제 서버로 오타 명세를 만든다**

`examples/` 의 예제 서버가 선언한 툴 하나를 골라, 그 필수 필드 이름에서 한 글자를 바꾼 명세
JSON 을 `/tmp` 에 만든다. 저장소에 커밋하지 않는다. 어떤 서버·어떤 필드를 썼는지 보고서에 적는다.

- [ ] **Step 2: `test` 를 돌려 참고 문장을 확인한다**

Run: `pnpm build && node packages/cli/dist/cli.js test /tmp/<파일>.json --command <예제 서버 실행 명령>`

Expected: 실패 보고서 뒤에 `참고: … 의 입력이 서버 선언과 다릅니다` 와 필드 이름 제안이 나온다.
exit code 1.

`pnpm build` 를 먼저 하는 이유는 낡은 산출물이 결함을 재현하거나 숨기기 때문이다.

- [ ] **Step 3: 결정론성을 확인한다**

같은 명령을 두 번 돌려 stdout 바이트를 비교한다.

Run: `node packages/cli/dist/cli.js test /tmp/<파일>.json --command <…> --json > /tmp/a.json && node packages/cli/dist/cli.js test /tmp/<파일>.json --command <…> --json > /tmp/b.json && cmp /tmp/a.json /tmp/b.json`
Expected: `cmp` 무출력

- [ ] **Step 4: 옳은 명세에는 아무것도 안 붙는 것을 확인한다**

필드 이름을 바로잡은 명세로 같은 명령을 돌린다.
Expected: `참고:` 가 없다. exit code 0.

- [ ] **Step 5: 기존 E2E 를 확인한다**

Run: `pnpm test`
Expected: 전부 통과. `packages/cli/tests/dist-cli-e2e.mjs` 가 포함된 경로도 통과.

- [ ] **Step 6: 보고서를 쓴다**

무엇을 확인했고, 무엇이 예상과 달랐고, 임의로 판단한 지점이 무엇인지 적는다.

---

## 6. 통합 게이트

전체가 끝난 뒤 오케스트레이터가 확인한다.

| 항목 | 명령 | 통과 조건 |
|---|---|---|
| 전체 테스트 | `pnpm test` | 전부 통과. 수집된 테스트 파일 수가 0이 아님 |
| 타입체크 | `pnpm typecheck` | 통과. 검사 파일 수가 0이 아님 |
| 린트 | `pnpm lint` | 통과 |
| 죽은 코드 | `grep -rn "UNCONSTRAINED_SCHEMA" packages/ --include="*.ts"` | 0줄 |
| 의존 방향 | `pnpm vitest run packages/generate/tests/dependency-boundary.test.ts` | 통과 |
| 공유 계약 | `git diff --stat -- packages/core/src/types.ts` | 변경 0 |
| 루트 설정 | `git diff --stat -- package.json turbo.json tsconfig.base.json vitest.config.ts pnpm-workspace.yaml` | 변경 0 |
| SDK 버전 | `grep -rn "modelcontextprotocol/sdk" packages/*/package.json` | 1.x 고정, `^` 없음 |

## 7. ADR

웨이브 3 이 끝난 뒤 `docs/adr/0018-*.md` 를 만든다. 번호 충돌을 먼저 확인한다(현재 0017 까지).
항목 다섯: 배경 / 선택지 / 결정 / 이유 / 결과.

- 검사를 `generate` 안(값 치환 이전)에서 돌린다는 결정. 근거는 `TYPE_MISMATCH` 거짓 양성이다.
- 위반을 거부가 아니라 재확인으로 다룬다는 결정. 근거는 느슨한 `inputSchema` 선언에서 나오는
  거짓 양성이다.

## 8. 자체 검토 결과

- 설계 문서 4~9절이 각각 T1~T6 에 대응한다. 10절(범위 밖)은 태스크가 없다. 의도된 것이다.
- 설계 문서 5절이 로컬 경로만 적고 있었는데, 실제 AI 경로는 `authoring-request.ts` 다. 그래서
  T3 을 따로 뒀다. 설계 문서에 이 구분이 없으므로 T3 의 "이 태스크가 따로 있는 이유" 에
  근거를 적었다.
- 치환된 `tools` 로 검사하면 `ENUM_MISMATCH` 거짓 양성이 난다는 문제는 설계 문서에 없다.
  T3 Step 3 에서 원본 툴 목록 보관으로 막는다.
- 병렬 태스크(T4·T5)의 쓰기 파일이 겹치지 않는다. `generate-command.ts` 와 `test-command.ts`,
  그리고 각자의 테스트 파일이다.
- 지문 불변을 T2·T3 양쪽에서 테스트로 고정했다.
- 실제 서버 프로세스를 띄우는 확인은 T6 으로 분리했고 직렬 전용으로 표시했다.
- 모든 명령이 실행 가능한 실제 명령이다. `pnpm vitest run <파일>` 형식은 이 저장소의
  `vitest.config.ts` 수집 설정(`packages/*/tests/**/*.test.ts`)과 맞다.
