# repair 의 명세 오라클 판정 구현 계획 (이슈 #385)

> **실행자에게:** 이 계획은 태스크 단위로 실행한다. 터미널은 하나이고 §7 의 실행 프롬프트를
> 그대로 붙여넣어 시작한다. 스텝은 체크박스(`- [ ]`)로 추적한다.

**목표:** 지문 대조와 실행 기록을 별개의 값으로 다뤄, 시험 실행 없이 저장한 승인 명세를 오라클로
오판하지 않게 한다. 그 명세에는 서버와 명세 양쪽 원인을 허용한다.

**접근:** `DiagnosisRequest` 의 `specApproved: boolean` 을 `specTrust` 두 축 구조체로 바꾸고
`specIsOracle` 하나가 프롬프트 선택과 `target: "spec"` 폐기를 함께 판정한다. 번들은 `spec.runHistory`
를 실어 나르며 형식 버전이 2 가 된다. 화면은 실행 기록 유무를 전송 확인 · 경고 블록 · 분류 라벨
셋에서 말한다.

**기술 스택:** TypeScript, vitest, pnpm workspace, turbo. 새 의존성 없음.

**설계 문서:** `docs/superpowers/specs/2026-09-09-repair-spec-oracle-design.md`
(실행자는 계획서와 설계 문서를 함께 읽는다. 문안은 설계 §4 가 소유한다.)

## 전역 제약

모든 태스크에 적용된다.

- **`core/src/types.ts` 의 `McpClient` · `ToolResult` 를 수정하지 않는다.** 필요해 보이면 제안만
  하고 보고한다.
- **`@modelcontextprotocol/sdk` 는 1.x 고정.** `^` 를 붙이지 않는다.
- **목록에 없는 의존성을 추가하지 않는다.** 이 계획은 새 의존성이 필요 없다.
- **의존 방향은 단방향이다:** `cli` → `runner`/`generate`/`record`/`mock` → `core`. 역참조 · 순환
  금지. `packages/generate` 는 `packages/cli` 를 import 하지 않는다.
- **자기 태스크의 Files 목록 밖 파일을 수정하지 않는다.** T1 은 `packages/generate` 만, T2 는
  `packages/cli` 만, T3 은 문서와 `.changeset` 만 건드린다. `packages/record` · `packages/mock` ·
  `packages/dashboard` · `packages/runner` 는 읽기만 한다.
- **한 태스크는 한 패키지다.** 두 패키지를 한 태스크에서 고치지 않는다.
- **커밋 · 푸시는 사람이 한다.** 서브에이전트는 git 명령을 실행하지 않는다. worktree 를 만들고
  들어가는 것은 서브에이전트가 아니라 **프롬프트를 받은 오케스트레이터 세션**의 일이다(§7 의
  1단계).
- **유닛테스트는 인메모리와 `fixtures/` 만 쓴다.** 실제 서버 프로세스를 띄우는
  `repair-e2e.test.ts` 는 W4 직렬 웨이브에서만 돌린다.
- **타입 계약이 패키지를 넘는다.** T2 는 시작 전에 `pnpm build --force` 를 돌린다. 낡은
  `packages/generate/dist/*.d.ts` 를 읽으면 로컬 typecheck 가 녹색인데 CI 가 빨강이 된다.
- 산문에 대시(—)를 쓰지 않는다. 커밋 메시지는 한국어, Conventional Commits, scope 필수.

## 1. 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `packages/generate/src/diagnosis-schema.ts` | `DiagnosisSpecTrust` 타입, `specIsOracle`, `DiagnosisRequest.specTrust` | T1 |
| `packages/generate/src/diagnosis-prompt.ts` | 역할 문장 네 갈래, 승인 판정 읽는 법 블록 | T1 |
| `packages/generate/src/diagnosis-request.ts` | `prepareDiagnosisRequest` 옵션, `target: "spec"` 폐기 조건 | T1 |
| `packages/generate/src/index.ts` | `DiagnosisSpecTrust` · `specIsOracle` 공개 | T1 |
| `packages/generate/tests/diagnosis-{schema,prompt,request,result,dispatch}.test.ts` | T1 판정 | T1 |
| `packages/cli/src/spec-approval.ts` | `specRunHistory` | T2 |
| `packages/cli/src/repair-bundle.ts` | 번들 버전 2, `spec.runHistory` 생성과 검증 | T2 |
| `packages/cli/src/repair-command.ts` | `specTrust` 조립, 확인 화면 값 | T2 |
| `packages/cli/src/repair-render.ts` | 명세 상태 줄, 경고 블록, 분류 라벨 | T2 |
| `packages/cli/tests/{spec-approval,repair-bundle-write,repair-bundle-read,repair-command-parse,repair-render,repair-e2e}.test.ts` | T2 판정 | T2 |
| `docs/adr/0090-오라클-자격은-지문과-실행-기록의-합의다.md` | ADR 초안 | T3 |
| `docs/adr/README.md` | 색인 한 줄 | T3 |
| `.changeset/repair-spec-oracle.md` | `@mcpeak/generate` · `@mcpeak/cli` minor | T3 |

`packages/cli/README.md` 와 루트 `README.md` 는 바꾸지 않는다. 번들 형식과 `repair` 의 명세 상태
문안을 산문으로 적은 곳이 없다(`grep -n "repair" README.md packages/cli/README.md` 로 확인했다.
usage 줄만 나온다).

## 2. 태스크

### Task T1: 진단 요청의 오라클 판정 (`generate`)

**Files**
- 수정: `packages/generate/src/diagnosis-schema.ts`
- 수정: `packages/generate/src/diagnosis-prompt.ts`
- 수정: `packages/generate/src/diagnosis-request.ts` (`prepareDiagnosisRequest` 약 131-190행,
  `validateDiagnosisResult` 의 폐기 규칙 약 278-295행. 줄 번호는 심볼로 다시 찾는다)
- 수정: `packages/generate/src/index.ts`
- 수정: `packages/generate/tests/diagnosis-schema.test.ts`
- 수정: `packages/generate/tests/diagnosis-prompt.test.ts`
- 수정: `packages/generate/tests/diagnosis-request.test.ts`
- 수정: `packages/generate/tests/diagnosis-result.test.ts`
- 수정: `packages/generate/tests/diagnosis-dispatch.test.ts`
- 생성: `docs/reports/task-t1-repair-spec-oracle.md` (이 태스크의 보고서)

**인터페이스**
- 소비: 없음. 이 태스크가 계약의 출발점이다.
- 산출: T2 가 쓴다.
  ```ts
  export interface DiagnosisSpecTrust {
    readonly fingerprint: "matched" | "mismatched" | "absent";
    readonly runHistory: "present" | "absent";
  }
  export function specIsOracle(trust: DiagnosisSpecTrust): boolean;
  // DiagnosisRequest.specApproved: boolean  →  DiagnosisRequest.specTrust: DiagnosisSpecTrust
  // prepareDiagnosisRequest(options) 의 options.specApproved → options.specTrust
  ```
  `specApproved` 라는 이름은 `packages/generate` 어디에도 남지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

다섯 파일을 함께 고친다. 먼저 공용 상수를 각 파일 상단(기존 `TOOLS` 아래)에 둔다. 파일마다
따로 선언한다. 테스트끼리 import 하지 않는다.

```ts
const ORACLE = { fingerprint: "matched", runHistory: "present" } as const;
const UNRUN = { fingerprint: "matched", runHistory: "absent" } as const;
const MISMATCHED = { fingerprint: "mismatched", runHistory: "present" } as const;
const NO_APPROVAL = { fingerprint: "absent", runHistory: "absent" } as const;
```

`packages/generate/tests/diagnosis-schema.test.ts`. `request` 헬퍼의 `specApproved: true` 를
`specTrust: ORACLE` 로 바꾸고, `specIsOracle` 을 import 한 뒤 새 `describe` 를 파일 끝에 더한다.

```ts
describe("specIsOracle", () => {
  it("지문 일치와 실행 기록이 모두 있어야 참이다", () => {
    expect(specIsOracle(ORACLE)).toBe(true);
    expect(specIsOracle(UNRUN)).toBe(false);
    expect(specIsOracle(MISMATCHED)).toBe(false);
    expect(specIsOracle(NO_APPROVAL)).toBe(false);
  });
});
```

`packages/generate/tests/diagnosis-prompt.test.ts`. `request` 헬퍼의 시그니처를 바꾸고, 기존
두 갈래 테스트를 네 갈래 테스트로 대체한다. 나머지 테스트(`untrusted 경고로 끝난다`,
`MCP_SUITE_JSON_SCHEMA 가 들어가지 않는다`)의 `for (const specApproved of [true, false])` 는
`for (const trust of [ORACLE, UNRUN, MISMATCHED, NO_APPROVAL])` 로 바꾸고 본문의
`request(specApproved)` 를 `request(trust)` 로 바꾼다.

```ts
function request(trust: DiagnosisSpecTrust = ORACLE): DiagnosisRequest {
  return prepareDiagnosisRequest({
    specTrust: trust,
    suite: { id: "suite-1", name: "weather" },
    failures: [
      {
        caseId: "case-1",
        caseName: "케이스 1",
        tool: "get_weather",
        input: { city: "서울" },
        approvedAs: "serverDefect",
        diagnostics: [{ code: "FIELD_MISSING", message: "'temp' 필드가 없습니다." }],
      },
    ],
    tools: TOOLS,
    providerId: "codex",
    model: "m",
  }).request;
}
```

```ts
it("역할 문장이 네 갈래다", () => {
  const prompts = [ORACLE, UNRUN, MISMATCHED, NO_APPROVAL].map((trust) =>
    diagnosisPrompt(request(trust)),
  );
  expect(new Set(prompts).size).toBe(4);
  expect(prompts[0]).toContain(
    "테스트 명세는 승인 절차를 거쳤고 승인 시점에 실제 서버 실행 기록이 남아 있다. 옳다고 가정한다.",
  );
  expect(prompts[0].startsWith("역할: MCP 서버의 테스트 실패를 보고 서버 코드의 원인 후보를")).toBe(
    true,
  );
  expect(prompts[1]).toContain(
    "이 테스트 명세는 승인 절차를 거쳤지만 실제 서버에서 한 번도 실행되지 않은 채 저장됐다. 명세가 옳다고 가정하지 않는다.",
  );
  expect(prompts[1]).toContain("케이스의 입력값이 생성 시점의 자리값일 수 있다.");
  expect(prompts[2]).toContain(
    "이 테스트 명세는 승인 후 수정됐다. 저장된 승인 지문과 현재 명세의 지문이 다르다. 명세가 옳다고 가정하지 않는다.",
  );
  expect(prompts[3]).toContain(
    "이 테스트 명세에는 승인 지문이 없다. 승인 절차를 거치지 않았다. 명세가 옳다고 가정하지 않는다.",
  );
  for (const prompt of prompts.slice(1))
    expect(prompt).toContain(
      "서버 코드와 명세 양쪽을 원인 후보로 보고 어느 쪽이 더 유력한지 판단해 함께 적는다.",
    );
});

it("어떤 갈래도 통과 이력을 주장하지 않는다", () => {
  for (const trust of [ORACLE, UNRUN, MISMATCHED, NO_APPROVAL])
    expect(diagnosisPrompt(request(trust))).not.toContain("한 번 이상 통과가 확인된 것");
});

it("모든 갈래가 approvedAs 읽는 법을 담는다", () => {
  for (const trust of [ORACLE, UNRUN, MISMATCHED, NO_APPROVAL]) {
    const prompt = diagnosisPrompt(request(trust));
    expect(prompt).toContain("승인 시점 케이스 판정(approvedAs) 읽는 법:");
    expect(prompt).toContain("passed 는 승인 시점에 실제 서버에서 통과한 케이스다.");
    expect(prompt).toContain(
      'serverDefect 는 승인 시점에도 실패했고 사람이 "명세가 맞고 서버가 틀렸다" 고 판정한 케이스다. 한 번도 통과한 적이 없다.',
    );
    expect(prompt).toContain("표시가 없는 케이스는 승인 시점에 실행되지 않았다.");
  }
});

it("승인 판정 읽는 법이 역할 문장과 허용 caseId 목록 사이에 온다", () => {
  const prompt = diagnosisPrompt(request());
  expect(prompt.indexOf("승인 시점 케이스 판정(approvedAs) 읽는 법:")).toBeLessThan(
    prompt.indexOf("허용 caseId 목록:"),
  );
  expect(prompt.indexOf("역할: MCP 서버")).toBeLessThan(
    prompt.indexOf("승인 시점 케이스 판정(approvedAs) 읽는 법:"),
  );
});
```

`packages/generate/tests/diagnosis-request.test.ts`. `prepare` 헬퍼의 `specApproved: true` 를
`specTrust: ORACLE` 로 바꾸고, 기존 `specApproved 값이 request 에 그대로 실린다` 를 아래로
대체한다.

```ts
it("specTrust 값이 request 에 그대로 실린다", () => {
  expect(prepare({ specTrust: ORACLE }).request.specTrust).toEqual(ORACLE);
  expect(prepare({ specTrust: UNRUN }).request.specTrust).toEqual(UNRUN);
});

it("specTrust 가 다르면 요청 지문도 다르다", () => {
  expect(prepare({ specTrust: ORACLE }).fingerprint).not.toBe(
    prepare({ specTrust: UNRUN }).fingerprint,
  );
});
```

`packages/generate/tests/diagnosis-result.test.ts`. `preview` 헬퍼의 옵션을 바꾸고, 폐기 규칙
테스트 둘을 넷으로 늘린다.

```ts
function preview(
  options: { trust?: DiagnosisSpecTrust; caseIds?: readonly string[] } = {},
) {
  return prepareDiagnosisRequest({
    specTrust: options.trust ?? ORACLE,
    suite: { id: "suite-1", name: "weather" },
    failures: (options.caseIds ?? ["case-1"]).map((id) => failure(id)),
    tools: TOOLS,
    providerId: "codex",
    model: "gpt-5-codex",
  });
}
```

```ts
it('오라클 명세에서는 target: "spec" 항목이 버려진다', () => {
  const validation = validateDiagnosisResult(
    diagnosis([cause({ target: "spec" })]),
    preview({ trust: ORACLE }),
  );
  expect(validation).toEqual({
    status: "ok",
    result: { status: "unsure", shortfall: "", discarded: discarded({ specTarget: 1 }) },
  });
});

it('실행 기록이 없으면 target: "spec" 항목이 통과한다', () => {
  const validation = validateDiagnosisResult(
    diagnosis([cause({ target: "spec" })]),
    preview({ trust: UNRUN }),
  );
  expect(validation).toEqual({
    status: "ok",
    result: {
      status: "diagnosis",
      causes: [cause({ target: "spec" })],
      discarded: discarded(),
    },
  });
});

it('지문이 불일치하면 target: "spec" 항목이 통과한다', () => {
  const validation = validateDiagnosisResult(
    diagnosis([cause({ target: "spec" })]),
    preview({ trust: MISMATCHED }),
  );
  expect(validation).toEqual({
    status: "ok",
    result: {
      status: "diagnosis",
      causes: [cause({ target: "spec" })],
      discarded: discarded(),
    },
  });
});

it('승인 지문이 없으면 target: "spec" 항목이 통과한다', () => {
  const validation = validateDiagnosisResult(
    diagnosis([cause({ target: "spec" })]),
    preview({ trust: NO_APPROVAL }),
  );
  expect(validation).toEqual({
    status: "ok",
    result: {
      status: "diagnosis",
      causes: [cause({ target: "spec" })],
      discarded: discarded(),
    },
  });
});
```

기존 `여러 폐기 사유를 각각 세고 한 항목을 중복 집계하지 않는다` 의 `preview({ specApproved: true })`
는 `preview({ trust: ORACLE })` 로 바꾼다. 단언은 그대로다.

`packages/generate/tests/diagnosis-dispatch.test.ts` 는 `specApproved: true` 두 곳(약 21행,
184행)을 `specTrust: ORACLE` 로 바꾼다. 다른 변경은 없다.

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm vitest run --root . packages/generate/tests/diagnosis-schema.test.ts packages/generate/tests/diagnosis-prompt.test.ts packages/generate/tests/diagnosis-request.test.ts packages/generate/tests/diagnosis-result.test.ts packages/generate/tests/diagnosis-dispatch.test.ts`
Expected: FAIL. `specIsOracle` 이 export 되지 않았다는 오류와, `specTrust` 가
`prepareDiagnosisRequest` 옵션에 없다는 타입 오류. 이 출력을 보고서에 붙인다.

- [ ] **Step 3: `diagnosis-schema.ts` 에 계약을 넣는다**

`DiagnosisRequest` 의 `specApproved` 를 지우고 `specTrust` 를 그 자리에 둔다. 키 순서는 지금
`specApproved` 가 있던 첫 자리를 그대로 쓴다. 요청 지문은 `canonicalJson` 이 키를 정렬하므로
순서에 영향받지 않지만, 사람이 읽는 순서는 유지한다.

```ts
/**
 * 명세가 오라클 자격을 가지는지 판정하는 두 축. 지문 대조와 실행 기록은 별개다(#385).
 * 지문이 맞아도 `--baseline-only`·`--no-dry-run` 으로 저장한 명세에는 실행 기록이 없고,
 * 그런 명세의 입력값은 생성 시점 자리값 그대로일 수 있다.
 */
export interface DiagnosisSpecTrust {
  /** 저장된 승인 지문과 현재 명세로 계산한 지문의 대조 결과. */
  readonly fingerprint: "matched" | "mismatched" | "absent";
  /** 승인 시점의 실제 서버 실행 기록(`approval.cases`)이 남아 있는가. */
  readonly runHistory: "present" | "absent";
}

/**
 * 명세를 오라클로 놓아도 되는가. 프롬프트 선택과 `target: "spec"` 폐기가 이 하나를 본다.
 * 두 곳이 각자 조건을 쓰면 한쪽만 고쳐졌을 때 화면과 프롬프트가 어긋난다.
 */
export function specIsOracle(trust: DiagnosisSpecTrust): boolean {
  return trust.fingerprint === "matched" && trust.runHistory === "present";
}

export interface DiagnosisRequest {
  /** 명세가 오라클 자격을 가지는가. 프롬프트 갈래와 결과 검증이 이 값으로 갈린다. 설계서 §3.1. */
  readonly specTrust: DiagnosisSpecTrust;
  readonly suite: { readonly id: string; readonly name: string };
  readonly failures: readonly DiagnosisFailure[];
  readonly processDiagnostics?: DiagnosisProcessDiagnostics;
  readonly tools: readonly McpToolContext[];
}
```

- [ ] **Step 4: `diagnosis-prompt.ts` 의 문장을 네 갈래로 만든다**

상수 이름은 갈래를 그대로 부른다. 문안은 설계 §4.1 · §4.2 전량이고 한 글자도 바꾸지 않는다.

```ts
/**
 * 역할 문장은 `specTrust` 로 갈린다. 지문이 일치해도 실행 기록이 없으면 오라클이 아니다(#385).
 * 설계서 §4.1.
 */
const ORACLE_INSTRUCTION =
  "역할: MCP 서버의 테스트 실패를 보고 서버 코드의 원인 후보를 제시한다.\n테스트 명세는 승인 절차를 거쳤고 승인 시점에 실제 서버 실행 기록이 남아 있다. 옳다고 가정한다.\n명세를 고치라고 제안하지 않는다. 테스트 케이스를 작성하거나 수정하지 않는다.\n코드를 수정하지 않고 파일에 접근하지 않는다. 원인 후보와 확인할 위치만 반환한다.\n근거가 부족하면 추측하지 말고 unsure 로 반환하고, 무엇이 더 있으면 판단할 수 있는지 적는다.\n반드시 제공된 JSON Schema와 일치하는 결과만 반환한다.";
const APPROVED_UNRUN_INSTRUCTION =
  "역할: MCP 서버의 테스트 실패를 보고 원인 후보를 제시한다.\n이 테스트 명세는 승인 절차를 거쳤지만 실제 서버에서 한 번도 실행되지 않은 채 저장됐다. 명세가 옳다고 가정하지 않는다.\n케이스의 입력값이 생성 시점의 자리값일 수 있다. 서버 코드와 명세 양쪽을 원인 후보로 보고 어느 쪽이 더 유력한지 판단해 함께 적는다.\n코드나 명세 파일을 수정하지 않고 파일에 접근하지 않는다. 원인 후보와 확인할 위치만 반환한다.\n근거가 부족하면 추측하지 말고 unsure 로 반환하고, 무엇이 더 있으면 판단할 수 있는지 적는다.\n반드시 제공된 JSON Schema와 일치하는 결과만 반환한다.";
const MISMATCHED_INSTRUCTION =
  "역할: MCP 서버의 테스트 실패를 보고 원인 후보를 제시한다.\n이 테스트 명세는 승인 후 수정됐다. 저장된 승인 지문과 현재 명세의 지문이 다르다. 명세가 옳다고 가정하지 않는다.\n서버 코드와 명세 양쪽을 원인 후보로 보고 어느 쪽이 더 유력한지 판단해 함께 적는다.\n코드나 명세 파일을 수정하지 않고 파일에 접근하지 않는다. 원인 후보와 확인할 위치만 반환한다.\n근거가 부족하면 추측하지 말고 unsure 로 반환하고, 무엇이 더 있으면 판단할 수 있는지 적는다.\n반드시 제공된 JSON Schema와 일치하는 결과만 반환한다.";
const NO_APPROVAL_INSTRUCTION =
  "역할: MCP 서버의 테스트 실패를 보고 원인 후보를 제시한다.\n이 테스트 명세에는 승인 지문이 없다. 승인 절차를 거치지 않았다. 명세가 옳다고 가정하지 않는다.\n서버 코드와 명세 양쪽을 원인 후보로 보고 어느 쪽이 더 유력한지 판단해 함께 적는다.\n코드나 명세 파일을 수정하지 않고 파일에 접근하지 않는다. 원인 후보와 확인할 위치만 반환한다.\n근거가 부족하면 추측하지 말고 unsure 로 반환하고, 무엇이 더 있으면 판단할 수 있는지 적는다.\n반드시 제공된 JSON Schema와 일치하는 결과만 반환한다.";

/**
 * 승인 시점 판정 읽는 법. 네 갈래 모두에 붙인다.
 *
 * `approvedAs` 는 요청에 이미 실려 있는데 뜻이 프롬프트 어디에도 없었다. 그래서 오라클 갈래의
 * 역할 문장이 `serverDefect` 케이스까지 "통과가 확인된 것" 이라고 말했다(#385). 사실은 여기서
 * 한 번만 적고 역할 문장은 명세 전체에 참인 것만 말한다. 설계서 §4.2.
 */
const CASE_HISTORY_RULE =
  '승인 시점 케이스 판정(approvedAs) 읽는 법:\npassed 는 승인 시점에 실제 서버에서 통과한 케이스다.\nserverDefect 는 승인 시점에도 실패했고 사람이 "명세가 맞고 서버가 틀렸다" 고 판정한 케이스다. 한 번도 통과한 적이 없다.\n표시가 없는 케이스는 승인 시점에 실행되지 않았다.';

function instructionOf(trust: DiagnosisSpecTrust): string {
  // 지문이 맞을 때만 실행 기록을 본다. 지문이 다르면 그 기록이 어느 명세의 것인지 알 수 없다.
  if (trust.fingerprint === "mismatched") return MISMATCHED_INSTRUCTION;
  if (trust.fingerprint === "absent") return NO_APPROVAL_INSTRUCTION;
  return specIsOracle(trust) ? ORACLE_INSTRUCTION : APPROVED_UNRUN_INSTRUCTION;
}
```

`diagnosisPrompt` 본문은 역할 문장 뒤에 `CASE_HISTORY_RULE` 을 넣는다. 나머지 배치는 그대로다.

```ts
export function diagnosisPrompt(request: DiagnosisRequest): string {
  const instruction = instructionOf(request.specTrust);
  const caseIds = diagnosisCaseIds(request);
  return `${instruction}\n\n${CASE_HISTORY_RULE}\n\n허용 caseId 목록:\n${JSON.stringify(caseIds)}\n${CASE_ID_RULE}\n\n진단 결과 JSON Schema:\n${JSON.stringify(buildDiagnosisProviderSchema(request))}\n\n${JSON.stringify(request)}\n${UNTRUSTED_WARNING}`;
}
```

- [ ] **Step 5: `diagnosis-request.ts` 의 옵션과 폐기 규칙을 바꾼다**

`prepareDiagnosisRequest` 의 옵션 첫 필드를 `specTrust: DiagnosisSpecTrust` 로 바꾸고, 요청
조립에서 `specApproved: options.specApproved` 를 `specTrust: options.specTrust` 로 바꾼다.
폐기 규칙은 `specIsOracle` 을 부른다.

```ts
  // 4. 명세가 오라클이면 target: "spec" 항목을 버린다. 명세는 옳다는 전제로 물었고 그 전제를
  //    뒤집는 답은 요청 범위 밖이다. 오라클 판정은 지문 일치와 실행 기록이 모두 있을 때만
  //    참이다(#385). 실행 기록이 없는 명세는 그 전제로 묻지 않았으므로 통과시킨다.
  const oracle = specIsOracle(preview.request.specTrust);
  const discarded = { unknownCase: 0, specTarget: 0, unsureCauses: 0 };
  const kept = causes.filter((cause) => {
    // 한 후보가 두 조건을 모두 어기면 요청 범위 검사를 먼저 적용해 한 사유에만 센다.
    if (!known.has(cause.caseId)) {
      discarded.unknownCase += 1;
      return false;
    }
    if (oracle && cause.target === "spec") {
      discarded.specTarget += 1;
      return false;
    }
    return true;
  });
```

- [ ] **Step 6: `index.ts` 에 공개한다**

`diagnosis-schema.js` 의 타입 export 목록에 `DiagnosisSpecTrust` 를 알파벳 순서(`DiagnosisResult`
뒤, `ServerDiagnosisProvider` 앞)로 넣고, 값 export 목록(`buildDiagnosisProviderSchema` ·
`DIAGNOSIS_PROVIDER_SCHEMA` · `diagnosisCaseIds` 가 있는 블록)에 `specIsOracle` 을 넣는다.

- [ ] **Step 7: 테스트가 통과하는 것을 확인한다**

Run: `pnpm vitest run --root . packages/generate/tests/`
Expected: PASS. 이어서 `pnpm --filter @mcpeak/generate test` 와
`pnpm biome ci packages/generate` 도 통과해야 한다.

`pnpm typecheck --force` 는 이 시점에 `packages/cli` 가 아직 낡은 계약을 쓰므로 실패한다. 그것이
정상이다. 실패가 `packages/cli/src/repair-command.ts` 의 `specApproved` 한 곳에서만 나는지
확인하고 보고서에 적는다. 다른 곳에서도 나면 그것은 이 계획이 놓친 사용처이므로 보고한다.

- [ ] **Step 8: 보고**

`docs/reports/task-t1-repair-spec-oracle.md` 에 Step 2 의 실패 출력, Step 7 의 통과 출력,
`pnpm typecheck --force` 가 가리킨 `cli` 의 실패 위치를 적는다. 커밋은 사람이 한다.
메시지: `feat(generate): 진단 요청의 오라클 판정을 지문과 실행 기록 두 축으로 나눈다`.

### Task T2: 번들과 화면 (`cli`)

**Files**
- 수정: `packages/cli/src/spec-approval.ts`
- 수정: `packages/cli/src/repair-bundle.ts`
- 수정: `packages/cli/src/repair-command.ts` (`preview` 조립 약 162-180행, `confirmView` 약 181-195행)
- 수정: `packages/cli/src/repair-render.ts`
- 수정: `packages/cli/tests/spec-approval.test.ts`
- 수정: `packages/cli/tests/repair-bundle-write.test.ts`
- 수정: `packages/cli/tests/repair-bundle-read.test.ts`
- 수정: `packages/cli/tests/repair-command-parse.test.ts`
- 수정: `packages/cli/tests/repair-render.test.ts`
- 수정: `packages/cli/tests/repair-e2e.test.ts`
- 생성: `docs/reports/task-t2-repair-spec-oracle.md` (이 태스크의 보고서)

**인터페이스**
- 소비: T1 의 `DiagnosisSpecTrust` 와 `prepareDiagnosisRequest({ specTrust, ... })`.
  `@mcpeak/generate` 에서 타입으로 import 한다. `specIsOracle` 은 import 하지 않는다
  (설계 §4.5. 렌더러는 진단 통로를 로드하지 않는다).
- 산출:
  ```ts
  export function specRunHistory(suite: TestSuiteSpec): "present" | "absent";
  export const REPAIR_BUNDLE_VERSION = 2;
  // RepairBundle["spec"] 에 readonly runHistory: "present" | "absent" 추가
  // RepairConfirmView 에 readonly runHistory: "present" | "absent" 추가
  // renderApprovalNotice(approval, runHistory)
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/cli/tests/spec-approval.test.ts` 파일 끝에 새 `describe` 를 더한다. 파일에 이미 있는
`suite` · `approved` · `fingerprint` 헬퍼를 그대로 쓰고, import 에 `specRunHistory` 를 더한다.

```ts
describe("specRunHistory", () => {
  it("approval 이 없으면 absent 다", () => {
    expect(specRunHistory(suite)).toBe("absent");
  });

  it("approval.cases 가 없으면 absent 다", () => {
    expect(specRunHistory(approved(fingerprint))).toBe("absent");
  });

  it("approval.cases 가 빈 배열이면 absent 다", () => {
    expect(specRunHistory({ ...suite, approval: { fingerprint, cases: [] } })).toBe("absent");
  });

  it("approval.cases 가 하나라도 있으면 present 다", () => {
    expect(
      specRunHistory({
        ...suite,
        approval: { fingerprint, cases: [{ id: "case-1", status: "serverDefect" }] },
      }),
    ).toBe("present");
  });
});
```

`packages/cli/tests/repair-bundle-write.test.ts`. 기존 `expect(bundle?.bundleVersion).toBe(REPAIR_BUNDLE_VERSION)`
는 그대로 두고(상수를 비교하므로 값이 바뀌어도 통과한다), `describe("buildRepairBundle")` 안에
새 테스트 둘을 더한다. 파일에 이미 있는 `suite(approval?)` · `caseResult()` · `build(cases, target)`
헬퍼를 그대로 쓴다.

```ts
it("approval.cases 가 없으면 번들의 runHistory 가 absent 다", () => {
  const target = suite({ fingerprint: "a".repeat(64) });
  expect(build([caseResult()], target)?.spec.runHistory).toBe("absent");
});

it("approval.cases 가 있으면 번들의 runHistory 가 present 다", () => {
  const target = suite({
    fingerprint: "a".repeat(64),
    cases: [{ id: "get-weather-unknown-city", status: "serverDefect" }],
  });
  const bundle = build([caseResult()], target);
  expect(bundle?.spec.runHistory).toBe("present");
  expect(bundle?.failures[0]?.approvedAs).toBe("serverDefect");
});
```

`packages/cli/tests/repair-bundle-read.test.ts`. `bundle()` 헬퍼의 `spec` 에
`runHistory: "present"` 를 더하고, 기존 `bundleVersion 이 2 면 versionMismatch 다` 를 아래로
대체한 뒤 새 테스트 둘을 더한다.

```ts
it("bundleVersion 이 1 이면 versionMismatch 다", () => {
  expect(readRepairBundle(text(bundle({ bundleVersion: 1 })))).toEqual({
    status: "invalid",
    reason: "versionMismatch",
  });
});

it("spec.runHistory 가 없으면 missingField 다", () => {
  const target = bundle();
  const { runHistory: _dropped, ...spec } = target.spec;
  expect(readRepairBundle(text({ ...target, spec }))).toEqual({
    status: "invalid",
    reason: "missingField",
  });
});

it("spec.runHistory 가 목록 밖 값이면 missingField 다", () => {
  const target = bundle();
  expect(
    readRepairBundle(text({ ...target, spec: { ...target.spec, runHistory: "unknown" } })),
  ).toEqual({ status: "invalid", reason: "missingField" });
});
```

`packages/cli/tests/repair-command-parse.test.ts` 는 두 리터럴을 고친다. `bundleVersion: 2` 를
쓰던 `번들이 형식에 안 맞으면 사유 문장과 함께 1 이다` 는 `bundleVersion: 3` 으로 바꾸고(이제
2 가 유효한 값이다), `진단 통로가 없으면 안내와 함께 1 이다` 의 리터럴은
`bundleVersion: 2` 와 `spec` 안의 `runHistory: "present"` 로 바꾼다.

`packages/cli/tests/repair-render.test.ts`. `bundle()` 헬퍼를 `bundleVersion: 2` 와
`spec.runHistory: "present"` 로 바꾸고, `diagnosis()` 안의 가짜 `prepare` 가 돌려주는
`request` 의 `specApproved: input.specApproved` 를 `specTrust: input.specTrust` 로 바꾼다.
그다음 새 테스트 넷을 `describe("repair 화면")` 안에 더한다.

```ts
it("전송 확인 화면이 지문 상태와 실행 기록을 함께 적는다", async () => {
  const present = deps({ diagnosis: diagnosis({ result: diagnosisResult([cause()]) }) });
  await runRepairCommand([...ARGV, "--yes"], present.value);
  expect(present.writes.out.join("")).toContain("명세 상태  승인 지문 일치 · 실행 기록 있음");
  const absent = deps({
    bundle: bundle({ spec: { ...bundle().spec, runHistory: "absent" } }),
    diagnosis: diagnosis({ result: diagnosisResult([cause()]) }),
  });
  await runRepairCommand([...ARGV, "--yes"], absent.value);
  expect(absent.writes.out.join("")).toContain("명세 상태  승인 지문 일치 · 실행 기록 없음");
});

it("지문이 맞고 실행 기록이 없으면 경고 블록이 붙는다", async () => {
  const context = deps({
    bundle: bundle({ spec: { ...bundle().spec, runHistory: "absent" } }),
    diagnosis: diagnosis({ result: diagnosisResult([cause()]) }),
  });
  expect(await runRepairCommand([...ARGV, "--yes"], context.value)).toBe(0);
  const screen = context.writes.out.join("");
  expect(screen).toContain("⚠ 이 명세는 승인 지문이 일치하지만 실제 서버 실행 기록이 없습니다.");
  expect(screen).toContain(
    "  --baseline-only 나 --no-dry-run 으로 저장하면 케이스가 한 번도 실행되지 않은 채 승인됩니다.",
  );
  expect(screen).toContain(
    "  입력값이 생성 시점의 자리값일 수 있어, 아래 제안은 명세 쪽 원인도 함께 받았습니다.",
  );
});

it("실행 기록이 없으면 spec 항목에 분류 라벨이 붙는다", async () => {
  const context = deps({
    bundle: bundle({ spec: { ...bundle().spec, runHistory: "absent" } }),
    diagnosis: diagnosis({ result: diagnosisResult([cause({ target: "spec" })]) }),
  });
  await runRepairCommand([...ARGV, "--yes"], context.value);
  expect(context.writes.out.join("")).toContain("분류       명세 쪽 원인으로 봄");
});

it("네 경로의 화면이 서로 다르고 오라클 경로에만 경고가 없다", async () => {
  const paths = [
    { approval: "matched", runHistory: "present" },
    { approval: "matched", runHistory: "absent" },
    { approval: "mismatched", runHistory: "present" },
    { approval: "absent", runHistory: "absent" },
  ] as const;
  const screens: string[] = [];
  for (const path of paths) {
    const context = deps({
      bundle: bundle({ spec: { ...bundle().spec, ...path } }),
      diagnosis: diagnosis({ result: diagnosisResult([cause()]) }),
    });
    expect(await runRepairCommand([...ARGV, "--yes"], context.value)).toBe(0);
    screens.push(context.writes.out.join(""));
  }
  expect(new Set(screens).size).toBe(4);
  expect(screens[0]).not.toContain("⚠");
  expect(screens[1]).toContain("실제 서버 실행 기록이 없습니다");
  expect(screens[2]).toContain("승인 상태가 아닙니다 (지문 불일치)");
  expect(screens[3]).toContain("승인 지문이 없습니다");
});
```

기존 `지문 일치·불일치·없음 셋에서 상단 블록이 각각 다르다` 와
`승인 상태에서 target: "spec" 항목에만 분류 라벨이 붙는다` 는 지우지 않는다. 앞의 것은
`spec` 을 스프레드로 만들므로 `runHistory: "present"` 를 상속해 그대로 통과한다.

`packages/cli/tests/repair-e2e.test.ts` 의 `expect(bundle.bundleVersion).toBe(1)` 을 2 로 바꾸고
바로 아래에 한 줄을 더한다. 이 파일의 `SUITE` 에는 `approval` 이 없다.

```ts
expect(bundle.spec.runHistory).toBe("absent");
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm vitest run --root . packages/cli/tests/spec-approval.test.ts packages/cli/tests/repair-bundle-write.test.ts packages/cli/tests/repair-bundle-read.test.ts packages/cli/tests/repair-render.test.ts`
Expected: FAIL. `specRunHistory` 가 없다는 오류, `runHistory` 가 번들에 없다는 오류, 화면 문자열
불일치. 이 출력을 보고서에 붙인다.

- [ ] **Step 3: `spec-approval.ts` 에 판정을 넣는다**

`caseApprovalStatuses` 바로 뒤에 둔다.

```ts
/**
 * 승인 시점에 실제 서버 실행 기록이 남았는가. `approval.cases` 의 존재가 기준이다.
 *
 * `generate` 는 시험 실행을 마치고 사람이 분류를 끝냈을 때만 이 키를 쓴다(`renderSuite` 의
 * 주석과 `reviewDryRun`). 그래서 `--baseline-only`·`--no-dry-run` 으로 저장한 명세는 지문이
 * 있어도 이 키가 없다. 지문 일치와 실행 기록은 별개다(#385).
 *
 * 빈 배열은 저장되지 않지만 손으로 쓴 파일에는 있을 수 있으므로 길이로 본다.
 */
export function specRunHistory(suite: TestSuiteSpec): "present" | "absent" {
  return (suite.approval?.cases?.length ?? 0) > 0 ? "present" : "absent";
}
```

- [ ] **Step 4: `repair-bundle.ts` 를 버전 2 로 올린다**

넷을 고친다.

1. `REPAIR_BUNDLE_VERSION` 을 `2` 로. 주석에 이유를 한 줄 더한다.
   ```ts
   /**
    * 번들 형식 버전. 형식이 바뀌면 `repair` 가 "이 번들은 버전 N 입니다. 최신 test 로 다시
    * 만드세요" 라고 말할 수 있다. 없으면 낡은 번들에서 키가 빠졌을 때 조용히 반쪽으로 돈다.
    * 설계서 §4.2.
    *
    * 2 는 `spec.runHistory` 를 더하며 올렸다(#385). 선택 필드로 두면 낡은 번들이 오라클 판정만
    * 조용히 달라진 채 통과한다.
    */
   export const REPAIR_BUNDLE_VERSION = 2;
   ```
2. `RepairBundle["spec"]` 에 `readonly runHistory: "present" | "absent";` 를 `approval` 뒤에 둔다.
3. `buildRepairBundle` 의 `spec` 리터럴에 `runHistory: specRunHistory(options.suite)` 를 넣는다.
   `specRunHistory` 는 `./spec-approval.js` 에서 import 한다(같은 파일이 이미
   `caseApprovalStatuses` 를 거기서 가져온다).
4. 읽기 검증에 상수와 검사를 더하고 `missingField` 문장을 고친다.
   ```ts
   const RUN_HISTORIES = ["present", "absent"] as const;
   ```
   ```ts
   if (!isOneOf(spec.runHistory, RUN_HISTORIES)) return false;
   ```
   `describeRepairBundleInvalid` 의 `missingField` 문장에서 `` `spec` 의 `suiteId`·`suiteName`·`approval` ``
   을 `` `spec` 의 `suiteId`·`suiteName`·`approval`·`runHistory` `` 로 바꾼다. 나머지 문장은 그대로다.

- [ ] **Step 5: `repair-command.ts` 의 조립을 바꾼다**

```ts
  const preview = deps.diagnosis.prepare({
    specTrust: { fingerprint: bundle.spec.approval, runHistory: bundle.spec.runHistory },
    ...
```

`confirmView` 에 `runHistory: bundle.spec.runHistory` 를 `approval` 바로 뒤에 더한다.

- [ ] **Step 6: `repair-render.ts` 의 세 자리를 바꾼다**

```ts
const RUN_HISTORY_LABEL: Readonly<Record<RepairBundle["spec"]["runHistory"], string>> = {
  present: "실행 기록 있음",
  absent: "실행 기록 없음",
};

/**
 * 명세를 오라클로 볼 수 있는가. `generate` 의 `specIsOracle` 과 같은 뜻이지만 여기서 다시
 * 판정한다. 화면 렌더러는 진단 통로를 로드하지 않는다(설계서 §4.5).
 */
const isOracle = (bundle: RepairBundle): boolean =>
  bundle.spec.approval === "matched" && bundle.spec.runHistory === "present";
```

1. `renderApprovalNotice(approval, runHistory)` 로 인자를 늘리고, `matched` 인 경우를 실행 기록으로
   다시 가른다. 나머지 문안은 그대로다.
   ```ts
   export function renderApprovalNotice(
     approval: RepairBundle["spec"]["approval"],
     runHistory: RepairBundle["spec"]["runHistory"],
   ): string {
     if (approval === "matched")
       return runHistory === "present"
         ? ""
         : "⚠ 이 명세는 승인 지문이 일치하지만 실제 서버 실행 기록이 없습니다.\n  --baseline-only 나 --no-dry-run 으로 저장하면 케이스가 한 번도 실행되지 않은 채 승인됩니다.\n  입력값이 생성 시점의 자리값일 수 있어, 아래 제안은 명세 쪽 원인도 함께 받았습니다.\n\n";
     if (approval === "mismatched")
       return "⚠ 이 명세는 승인 상태가 아닙니다 (지문 불일치).\n  실패 원인이 서버가 아니라 명세일 수 있습니다. 아래 제안은 그 전제로 받았습니다.\n\n";
     return "⚠ 이 명세는 승인 지문이 없습니다.\n  실제 서버로 검증된 적이 없는 명세일 수 있습니다. 아래 제안은 그 전제로 받았습니다.\n\n";
   }
   ```
   호출 지점(`renderRepairResult` 의 `parts` 초기값)을
   `renderApprovalNotice(options.bundle.spec.approval, options.bundle.spec.runHistory)` 로 바꾼다.
2. `RepairConfirmView` 에 `readonly runHistory: RepairBundle["spec"]["runHistory"];` 를 `approval`
   뒤에 더하고, `명세 상태` 줄을 바꾼다.
   ```ts
   `  명세 상태  ${APPROVAL_LABEL[view.approval]} · ${RUN_HISTORY_LABEL[view.runHistory]}\n`,
   ```
3. 분류 라벨 조건을 오라클 판정으로 바꾼다.
   ```ts
   // 오라클이 아닐 때만 spec 항목이 통과한다(§5.6-4, #385). 그 사실을 화면이 말한다.
   if (cause.target === "spec" && !isOracle(options.bundle))
     parts.push("  분류       명세 쪽 원인으로 봄\n");
   ```

- [ ] **Step 7: 테스트가 통과하는 것을 확인한다**

Run 순서대로:
```
pnpm build --force
pnpm typecheck --force
pnpm --filter @mcpeak/cli test
pnpm biome ci packages/cli
```
Expected: `typecheck` 출력에 `Cached: 0 cached` 가 있고 통과. `pnpm --filter @mcpeak/cli test`
전량 통과. `pnpm build --force` 를 먼저 돌리는 이유는 `cli` 의 typecheck 가
`packages/generate/dist/*.d.ts` 를 읽기 때문이다. 낡은 산출물이면 T1 의 계약을 못 본다.

- [ ] **Step 8: 보고**

`docs/reports/task-t2-repair-spec-oracle.md` 에 Step 2 의 실패 출력과 Step 7 의 통과 출력을
적는다. 커밋은 사람이 한다.
메시지: `fix(cli): repair 가 미실행 승인 명세를 오라클로 오판하지 않는다`.

### Task T3: ADR 과 changeset (문서)

**Files**
- 생성: `docs/adr/0090-오라클-자격은-지문과-실행-기록의-합의다.md` (번호는 Step 1 결과)
- 수정: `docs/adr/README.md`
- 생성: `.changeset/repair-spec-oracle.md`
- 생성: `docs/reports/task-t3-repair-spec-oracle-docs.md` (이 태스크의 보고서)

**인터페이스**
- 소비: T1 · T2 의 결과. 새 코드 없음.
- 산출: 없음.

- [ ] **Step 1: ADR 번호를 확인한다**

Run: `ls docs/adr | tail -3` 과 `grep -c "^| \[00" docs/adr/README.md`
현재 최대값은 0089 다. 0090 이 비어 있으면 그대로 쓰고, 그사이 누가 0090 을 썼으면 최대값 + 1 로
바꾼 뒤 그 사실을 보고서에 적는다.

- [ ] **Step 2: ADR 초안을 쓴다**

다섯 항목이다. 배경 · 선택지 · 결정 · 이유 · 결과. 한 페이지면 충분하다. 내용은 설계 문서
§1 · §3.1 · §3.2 · §3.4 를 요약하고, 선택지는 셋을 적는다.

```markdown
# ADR-0090: 오라클 자격은 지문과 실행 기록의 합의다

- 상태: 제안
- 날짜: 2026-09-09
- 범위: generate · cli
- 관련: #385, ADR-0089, `docs/superpowers/specs/2026-09-09-repair-spec-oracle-design.md`

## 배경

`repair` 는 승인 지문이 일치하면 명세를 오라클로 놓았다. `--baseline-only` 와 `--no-dry-run` 은
지문은 쓰고 `approval.cases` 는 쓰지 않으므로, 한 번도 실행되지 않은 명세가 오라클이 됐다. 그
결과 프롬프트가 "실제 서버에서 한 번 이상 통과가 확인된 것" 이라는 거짓을 보냈고, 생성 시점
자리값을 지적한 `target: "spec"` 후보를 전부 버렸다.

## 선택지

1. 요청에 `specTrust` 두 축(지문 · 실행 기록)을 싣고 번들 형식 버전을 2 로 올린다.
2. `cli` 에서 `specApproved` 계산식만 고친다. `generate` 는 그대로 둔다.
3. 번들에 `runHistory` 를 선택 필드로 더하고 없으면 `absent` 로 본다.

## 결정

1 을 고른다.

## 이유

2 는 요청에 실린 값이 "지문이 맞다" 인지 "오라클이다" 인지 읽는 쪽이 알 수 없게 만든다. 프롬프트가
네 갈래를 구분할 근거도 사라진다. 3 은 낡은 번들이 오라클 판정만 조용히 달라진 채 통과하게
만든다. 번들 파일은 이미 "모르는 버전은 거절한다" 는 규칙을 갖고 있고, 그 규칙의 이유가 정확히
이 상황이다. 번들은 `test` 가 직전에 만드는 일회성 산출물이라 다시 만드는 비용이 낮다.

케이스 단위로 `serverDefect` 항목만 명세 수정 제안을 여는 안은 함께 기각했다. `serverDefect` 는
사람이 명세 쪽을 검토하고 통과시킨 표시라, 거기서 명세 수정을 다시 열면 사람의 판정을 AI 가
뒤집는 통로가 된다. 사실이 어긋났던 것은 폐기 규칙이 아니라 프롬프트의 설명이었다.

## 결과

- 버전 1 번들은 `versionMismatch` 로 거절된다. 사용자는 `mcpeak test --repair-bundle` 을 다시
  돌린다. `packages/dashboard` 는 번들을 저장만 하므로 코드 변경이 없다.
- 프롬프트 역할 문장이 둘에서 넷으로 늘었다. 갈래는 `specTrust` 두 축의 조합으로만 갈리고
  요청 내용으로 합성하지 않는다. 결정론성은 그대로다.
- 케이스 단위 폐기 규칙은 열지 않는다. 후속 논의는 #393 · #394 다.
```

- [ ] **Step 3: 색인에 한 줄 넣는다**

`docs/adr/README.md` 의 표 끝(0089 줄 다음)에 같은 형식으로 더한다.

```markdown
| [0090](./0090-오라클-자격은-지문과-실행-기록의-합의다.md) | 오라클 자격은 지문과 실행 기록의 합의다 | generate · cli | 제안 |
```

같은 표의 다른 줄에서 열 개수와 범위 표기법을 확인하고 맞춘다. 다르면 그 파일의 형식을 따른다.

- [ ] **Step 4: changeset 을 만든다**

```markdown
---
"@mcpeak/generate": minor
"@mcpeak/cli": minor
---

`repair` 가 시험 실행 없이 저장된 승인 명세를 정답으로 놓지 않습니다. 승인 지문 일치와 실제 서버
실행 기록을 별도로 봅니다. 실행 기록이 없으면(`--baseline-only`·`--no-dry-run` 으로 저장한 명세)
서버와 명세 양쪽 원인을 받고, 화면이 그 사실을 알립니다. 진단 프롬프트는 승인 시점 케이스 판정을
정확히 설명하며, `serverDefect` 케이스를 통과 이력이 있는 것으로 말하지 않습니다.

repair 번들 형식이 버전 2 가 됩니다. 이전 번들은 거절되므로 `mcpeak test --repair-bundle` 로 다시
만드세요.
```

`minor` 인 이유는 둘 다 공개 계약이 바뀌기 때문이다. `@mcpeak/generate` 는 `DiagnosisRequest` 의
필드가 바뀌고, `@mcpeak/cli` 는 번들 형식 버전이 올라 이전 번들을 거절한다.

- [ ] **Step 5: 확인과 보고**

Run: `pnpm changeset status --since=main` 과 `pnpm biome ci .`
Expected: `@mcpeak/generate` 와 `@mcpeak/cli` 가 둘 다 잡힌다. biome 통과.
`docs/reports/task-t3-repair-spec-oracle-docs.md` 에 결과와 확정한 ADR 번호를 적는다. 커밋은
사람이 한다.
메시지: `docs(adr): 오라클 자격을 지문과 실행 기록의 합의로 정한 결정을 기록한다`.

## 3. 의존성과 웨이브

```
T1 ──▶ T2 ──▶ T3 ──▶ W4(실환경 검증)
```

| 웨이브 | 태스크 | 병렬 | 선행 |
|---|---|---|---|
| W1 | T1 (`generate`) | 단독 | 없음 |
| W2 | T2 (`cli`) | 단독 | T1 (타입 계약과 `pnpm build --force` 산출물) |
| W3 | T3 (문서) | 단독 | T2 (번들 버전이 확정돼야 changeset 문장이 참이다) |
| W4 | 실환경 검증 | 직렬 전용 | T3 |

병렬 태스크가 없다. T1 이 만든 타입 없이는 T2 가 컴파일되지 않으므로 순서가 강제된다. 터미널
하나, worktree 하나, 브랜치 하나(`fix/repair-spec-oracle`)로 순차 실행하고 PR 은 하나다.
프로젝트 지침의 "한 번에 한 패키지" 는 태스크 단위로 지켜진다. T1 은 `generate` 만, T2 는 `cli`
만 건드린다.

## 4. 모델 배분

| 태스크 | 모델 | 근거 |
|---|---|---|
| T1 | 상위 | 진단 프롬프트 문안은 이 프로젝트에서 곧 제품이고, 패키지를 넘는 공개 계약을 바꾼다. 로컬 지침의 상위 모델 예외 두 항목("실패 메시지 문안 설계", "패키지 경계 판단")에 걸린다 |
| T2 | 표준 | 계약은 T1 이 확정했고 화면 문안은 설계 §4.3 · §4.4 · §4.5 와 이 계획이 전량 고정했다 |
| T3 | 표준 | 문서 전사다 |

## 5. 완료 조건 (통합 게이트)

설계 §2 완료 조건 1~12 는 T1 · T2 · T3 의 테스트와 파일로 판정한다. 아래는 오케스트레이터가
통합 직전에 직접 돌린다.

1. `pnpm build --force` 뒤 `pnpm typecheck --force` 가 `Cached: 0 cached` 로 통과한다.
2. `pnpm test` 전량 통과.
3. `pnpm biome ci .` 통과.
4. `pnpm --filter @mcpeak/cli test:e2e` 통과.
5. `pnpm changeset status --since=main` 에 `@mcpeak/generate` 와 `@mcpeak/cli` 가 둘 다 잡힌다.
6. `grep -rn "specApproved" packages/generate/src packages/cli/src` 가 아무것도 찾지 못한다.
7. 기존 테스트의 케이스 이름이 이유 없이 사라지지 않았다.
   `git diff main -- packages/generate/tests packages/cli/tests | grep "^-.*it("` 의 결과가
   이 계획이 대체한다고 적은 것(폐기 규칙 둘, 프롬프트 두 갈래, `specApproved 값이 request 에
   그대로 실린다`, `bundleVersion 이 2 면 versionMismatch 다`)뿐이다.
8. W4 의 관측이 §7 W4 의 기대와 같다.

## 6. 사람이 할 사전 확인 (2줄)

설계 문서와 이 계획서를 루트에서 먼저 커밋한 뒤 확인한다. untracked 문서는 worktree 에 딸려가지
않는다.

```sh
git log --oneline -1     # 기점 커밋 확인. 이 값이 <기점SHA> 다
git status --short       # 깨끗한지 확인
```

## 7. 실행 프롬프트

터미널 하나다. 프로젝트 루트에서 열고 그대로 붙여넣는다. `<기점SHA>` 는 §6 의 값으로 바꾼다.
오케스트레이터 세션이 이 프롬프트를 받아 T1 · T2 · T3 를 서브에이전트로 순서대로 스폰하고
사이에 리뷰한다.

### W1 · T1 (권장: 상위 모델, 추론 수준 높음, 구현 에이전트)

```
[1단계: 작업 공간 만들기] 이 단계는 이 프롬프트를 받은 너, 즉 오케스트레이터 세션이 직접
한다. 서브에이전트를 스폰하기 전이다. 다른 무엇보다 먼저 이것부터 해라.
  git worktree add .claude/worktrees/mcpeak-385 -b fix/repair-spec-oracle <기점SHA>
를 실행한 뒤 그 경로로 세션을 옮겨라(EnterWorktree 에 path 로 넘긴다). 이어서 pnpm install 을
돌리고, 다른 패키지의 산출물을 읽도록 pnpm build 도 한 번 돌려라.
진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 BLOCKED 로 보고해라:
  - pwd 가 .claude/worktrees/mcpeak-385 로 끝나는지
  - git log --oneline -1 이 <기점SHA> 인지
  - docs/superpowers/plans/2026-09-09-repair-spec-oracle-implementation.md 와
    docs/superpowers/specs/2026-09-09-repair-spec-oracle-design.md 가 존재하는지
  - git status --short 가 비어 있는지
  - pnpm vitest --version 이 실행되는지

[2단계: 실행] 여기서부터가 서브에이전트에게 줄 지시다. 1단계를 끝낸 뒤 아래를 그대로
구현 서브에이전트에게 넘겨라. 아래에서 "너" 는 그 서브에이전트다.

너는 Task T1 의 구현자다.
계획서 docs/superpowers/plans/2026-09-09-repair-spec-oracle-implementation.md 의 Task T1 을
스텝 순서대로 수행해라. Step 1 의 테스트를 먼저 쓰고 Step 2 에서 실패를 눈으로 확인한 뒤에만
구현으로 넘어가라. 설계 문서 §3.1 · §4.1 · §4.2 가 문안의 사양이고 한 글자도 바꾸지 마라.
허용 Files 는 다음뿐이다:
  - 수정 packages/generate/src/diagnosis-schema.ts
  - 수정 packages/generate/src/diagnosis-prompt.ts
  - 수정 packages/generate/src/diagnosis-request.ts
  - 수정 packages/generate/src/index.ts
  - 수정 packages/generate/tests/diagnosis-schema.test.ts
  - 수정 packages/generate/tests/diagnosis-prompt.test.ts
  - 수정 packages/generate/tests/diagnosis-request.test.ts
  - 수정 packages/generate/tests/diagnosis-result.test.ts
  - 수정 packages/generate/tests/diagnosis-dispatch.test.ts
  - 생성 docs/reports/task-t1-repair-spec-oracle.md (아래에서 쓰라고 한 보고서다)
그 밖의 파일은 수정 금지다. 특히 core/src/types.ts, packages/cli, packages/runner,
packages/record, packages/mock, packages/dashboard, 루트 빌드 설정은 공유 계약이거나 다른
오너의 것이다. packages/cli 가 깨지는 것은 정상이고 T2 가 고친다. 필요해 보여도 고치지 말고
보고해라. packages/generate 가 packages/cli 를 import 하지 않게 해라(의존 방향은 단방향이다).
@modelcontextprotocol/sdk 버전을 건드리지 말고 새 의존성을 추가하지 마라.
기존 테스트의 케이스 이름과 단언을 계획서가 대체하라고 적은 것 외에는 지우지 마라.
git 명령을 실행하지 마라. worktree 는 오케스트레이터가 1단계에서 이미 만들어 두었다.
커밋·푸시·머지는 사람이 한다. 백그라운드 실행과 하위 에이전트 스폰도 금지다. 다른 작업자의
변경을 되돌리지 마라.
검증 명령:
  pnpm vitest run --root . packages/generate/tests/
  pnpm --filter @mcpeak/generate test
  pnpm biome ci packages/generate
  pnpm typecheck --force   (이 시점에는 packages/cli 에서만 실패해야 한다. 다른 곳에서 실패하면
                            고치지 말고 보고해라)
보고서를 docs/reports/task-t1-repair-spec-oracle.md 에 써라. Step 2 에서 본 실패 출력을 그대로
붙여라. 그것이 이슈 재현 증거다.
최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작하고, 변경 파일, 검증 명령과
결과, 보고서 경로, 남은 위험을 포함해라.
```

### W2 · T2 (권장: 표준 모델, 추론 수준 중간, 구현 에이전트)

T1 을 리뷰해 통과시킨 뒤 같은 worktree 에서 스폰한다.

```
[1단계: 작업 공간 확인] 이 단계는 오케스트레이터 세션이 한다. 이미 만들어진 worktree 를
쓴다. 새로 만들지 마라.
  .claude/worktrees/mcpeak-385 로 세션을 옮겨라(EnterWorktree 에 path 로 넘긴다).
그 안에서 pnpm build --force 를 돌려라. packages/cli 의 typecheck 가 packages/generate 의
dist/*.d.ts 를 읽기 때문에, 이것을 건너뛰면 T1 의 계약을 못 보고 낡은 타입으로 판정한다.
진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 BLOCKED 로 보고해라:
  - pwd 가 .claude/worktrees/mcpeak-385 로 끝나는지
  - git log --oneline -1 이 <기점SHA> 이거나 그 위에 T1 커밋 하나가 얹힌 상태인지
  - docs/superpowers/plans/2026-09-09-repair-spec-oracle-implementation.md 와
    docs/superpowers/specs/2026-09-09-repair-spec-oracle-design.md 가 존재하는지
  - git status --short 에 T1 의 파일 외의 변경이 없는지
  - packages/generate/src/diagnosis-schema.ts 에 specIsOracle 이 있는지 (T1 이 반영된 상태여야
    한다)
  - pnpm build --force 가 성공하는지

[2단계: 실행] 여기서부터가 서브에이전트에게 줄 지시다. 아래에서 "너" 는 그 서브에이전트다.

너는 Task T2 의 구현자다.
계획서 docs/superpowers/plans/2026-09-09-repair-spec-oracle-implementation.md 의 Task T2 를
스텝 순서대로 수행해라. Step 1 의 테스트를 먼저 쓰고 Step 2 에서 실패를 눈으로 확인한 뒤에만
구현으로 넘어가라. 설계 문서 §4.3 · §4.4 · §4.5 가 화면 문안의 사양이고 한 글자도 바꾸지 마라.
허용 Files 는 다음뿐이다:
  - 수정 packages/cli/src/spec-approval.ts
  - 수정 packages/cli/src/repair-bundle.ts
  - 수정 packages/cli/src/repair-command.ts
  - 수정 packages/cli/src/repair-render.ts
  - 수정 packages/cli/tests/spec-approval.test.ts
  - 수정 packages/cli/tests/repair-bundle-write.test.ts
  - 수정 packages/cli/tests/repair-bundle-read.test.ts
  - 수정 packages/cli/tests/repair-command-parse.test.ts
  - 수정 packages/cli/tests/repair-render.test.ts
  - 수정 packages/cli/tests/repair-e2e.test.ts
  - 생성 docs/reports/task-t2-repair-spec-oracle.md (아래에서 쓰라고 한 보고서다)
그 밖의 파일은 수정 금지다. 특히 core/src/types.ts, packages/generate, packages/runner,
packages/record, packages/mock, packages/dashboard, 루트 빌드 설정은 공유 계약이거나 다른
오너의 것이다. packages/generate 에 무엇이 부족해 보여도 고치지 말고 보고해라.
packages/cli 의 test 명령 화면(renderSpecApproval)은 이번 범위가 아니다(설계 §2 비범위).
@modelcontextprotocol/sdk 버전을 건드리지 말고 새 의존성을 추가하지 마라.
기존 테스트의 케이스 이름과 단언을 계획서가 대체하라고 적은 것 외에는 지우지 마라.
git 명령을 실행하지 마라. worktree 는 오케스트레이터가 1단계에서 이미 만들어 두었다.
커밋·푸시·머지는 사람이 한다. 백그라운드 실행과 하위 에이전트 스폰도 금지다. 다른 작업자의
변경을 되돌리지 마라.
검증 명령:
  pnpm vitest run --root . packages/cli/tests/spec-approval.test.ts packages/cli/tests/repair-bundle-write.test.ts packages/cli/tests/repair-bundle-read.test.ts packages/cli/tests/repair-command-parse.test.ts packages/cli/tests/repair-render.test.ts
  pnpm --filter @mcpeak/cli test
  pnpm typecheck --force   (출력에 Cached: 0 cached 가 있어야 하고 전부 통과해야 한다)
  pnpm biome ci packages/cli
보고서를 docs/reports/task-t2-repair-spec-oracle.md 에 써라. Step 2 에서 본 실패 출력을 그대로
붙여라.
최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작하고, 변경 파일, 검증 명령과
결과, 보고서 경로, 남은 위험을 포함해라.
```

### W3 · T3 (권장: 표준 모델, 추론 수준 낮음, 구현 에이전트)

T2 를 리뷰해 통과시킨 뒤 같은 worktree 에서 스폰한다.

```
[1단계: 작업 공간 확인] 이 단계는 오케스트레이터 세션이 한다. 이미 만들어진 worktree 를
쓴다. 새로 만들지 마라.
  .claude/worktrees/mcpeak-385 로 세션을 옮겨라(EnterWorktree 에 path 로 넘긴다).
진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 BLOCKED 로 보고해라:
  - pwd 가 .claude/worktrees/mcpeak-385 로 끝나는지
  - docs/superpowers/plans/2026-09-09-repair-spec-oracle-implementation.md 와
    docs/superpowers/specs/2026-09-09-repair-spec-oracle-design.md 가 존재하는지
  - packages/cli/src/repair-bundle.ts 의 REPAIR_BUNDLE_VERSION 이 2 인지 (T2 가 반영된
    상태여야 한다)
  - git status --short 에 T1·T2 의 파일 외의 변경이 없는지

[2단계: 실행] 여기서부터가 서브에이전트에게 줄 지시다. 아래에서 "너" 는 그 서브에이전트다.

너는 Task T3 의 구현자다.
계획서 docs/superpowers/plans/2026-09-09-repair-spec-oracle-implementation.md 의 Task T3 을
스텝 순서대로 수행해라. Step 1 에서 ADR 번호를 실제로 확인하고, 0090 이 이미 있으면 최대값 + 1 로
바꾼 뒤 파일명·색인·본문 제목을 그 값으로 맞추고 보고서에 적어라.
허용 Files 는 다음뿐이다:
  - 생성 docs/adr/0090-오라클-자격은-지문과-실행-기록의-합의다.md (번호는 Step 1 결과)
  - 수정 docs/adr/README.md
  - 생성 .changeset/repair-spec-oracle.md
  - 생성 docs/reports/task-t3-repair-spec-oracle-docs.md (아래에서 쓰라고 한 보고서다)
그 밖의 파일은 수정 금지다. 소스 코드는 한 줄도 건드리지 마라. 산문에 대시(—)를 쓰지 마라.
git 명령을 실행하지 마라. 커밋·푸시·머지는 사람이 한다. 백그라운드 실행과 하위 에이전트 스폰도
금지다. 다른 작업자의 변경을 되돌리지 마라.
검증 명령:
  pnpm changeset status --since=main
  pnpm biome ci .
보고서를 docs/reports/task-t3-repair-spec-oracle-docs.md 에 써라. 확정한 ADR 번호를 첫 줄에
적어라.
최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작하고, 변경 파일, 검증 명령과
결과, 보고서 경로, 남은 위험을 포함해라.
```

### W4 · 실환경 검증 (직렬 전용, 오케스트레이터가 직접 수행)

서브에이전트에 넘기지 않는다. 실제 서버 프로세스를 띄우므로 직렬 웨이브다. 상태를 바꾸는
서버는 쓰지 않는다. 저장소 안의 예제 서버만 쓴다.

1. worktree 에서 `pnpm build --force` 뒤 `pnpm --filter @mcpeak/cli test:e2e`.
2. 이슈의 재현 절차를 그대로 밟는다. 임시 경로만 세션 스크래치패드로 바꾼다.
   ```sh
   node packages/cli/dist/cli.mjs generate --baseline-only \
     --out /tmp/mcpeak-385/weather-review.suite.json -- node examples/weather-server/server.mjs
   node packages/cli/dist/cli.mjs test /tmp/mcpeak-385/weather-review.suite.json --json \
     --repair-bundle /tmp/mcpeak-385/weather-review.bundle.json -- node examples/weather-server/server.mjs
   ```
   기대: 저장된 명세에 `approval.cases` 가 없고, 번들의 `bundleVersion` 이 2,
   `spec.approval` 이 `matched`, `spec.runHistory` 가 `absent` 다. 앞의 두 값은 `jq` 로 읽는다.
3. provider 를 부르지 않고 화면만 본다. `--yes` 없이 비대화형으로 부르면 전송 확인 화면을 찍고
   `REPAIR_CONFIRM_REQUIRED` 로 멈춘다. provider 호출은 0회다.
   ```sh
   node packages/cli/dist/cli.mjs repair /tmp/mcpeak-385/weather-review.bundle.json \
     --provider codex --model gpt-5-codex
   ```
   기대: `명세 상태  승인 지문 일치 · 실행 기록 없음` 줄이 나온다.
4. 이슈의 3번 절차(고정 응답 주입)는 유닛테스트가 대신한다. 실제 유료 provider 를 부르지 않는다.
   `repair-render.test.ts` 의 `실행 기록이 없으면 spec 항목에 분류 라벨이 붙는다` 가 같은 입력을
   주입으로 판정한다. 그 사실을 보고에 적는다.
5. 결과를 `docs/adoption.md` 에 한 줄로 누적 기록한다. 이 파일은 오케스트레이터가 직접 쓴다.
   T1 · T2 · T3 의 허용 Files 에 없는 것은 그 때문이다.
6. 임시 파일을 지운다. `examples/` 아래에 산출물을 만들지 않는다. 저장소 루트에 이미 있는
   untracked 예제 suite 파일들은 건드리지 않는다.

## 8. 자체 검토

- 설계 완료 조건 1~13 이 각각 대응한다. 1·2 → T1 Step 3, 3·4 → T1 Step 4, 5 → T1 Step 5,
  6 → T2 Step 4, 7 → T2 Step 3·4, 8 → T2 Step 6-2, 9 → T2 Step 6-1, 10 → T2 Step 6-3,
  11 → T1 Step 1 과 T2 Step 1 의 네 경로 테스트, 12 → T3, 13 → 통합 게이트 1~4.
- 플레이스홀더 없음. 프롬프트 문안, 화면 문안, 테스트 케이스 이름과 단언은 전량이다.
- 타입 이름이 태스크를 건너 일관된다. T1 이 만든 `DiagnosisSpecTrust` · `specIsOracle` ·
  `specTrust` 를 T2 가 같은 이름으로 소비하고, T2 가 만든 `specRunHistory` ·
  `RepairBundle["spec"].runHistory` · `RepairConfirmView.runHistory` 를 같은 파일 안에서 쓴다.
  `cli` 는 `specIsOracle` 을 import 하지 않고 같은 뜻의 지역 함수 `isOracle` 을 둔다. 그 이유는
  설계 §4.5 에 있다.
- 병렬 태스크가 없다. 파일 겹침 없음. 한 태스크가 한 패키지만 건드린다.
- 실환경 검증은 W4 직렬이고 저장소 안의 예제 서버만 쓴다. 유료 provider 를 부르지 않는다.
- T1 이 끝난 시점에 `pnpm typecheck --force` 가 실패하는 것이 정상이라는 사실을 T1 Step 7 과
  실행 프롬프트에 함께 적었다. 이것을 안 적으면 실행자가 T1 에서 `cli` 를 고치려 든다.
