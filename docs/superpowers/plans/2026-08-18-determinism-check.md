# 결정론성 확인 구현 계획 (2026-08-18)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 로
> 태스크 단위 실행. 스텝은 체크박스(`- [ ]`)로 추적한다.

**목표:** `ohmymcp test --determinism [--reset-cmd <cmd>]` 로 스위트를 2회 실행해 케이스별
구조화 비교를 하고, 차이의 경로·양쪽 값·휴리스틱 힌트를 비차단 진단으로 보고한다.

**아키텍처:** 비교와 문장은 `runner` 순수 함수(`determinism.ts`), 응답 캡처와 2회 실행 배선은
`cli`(클라이언트 래퍼 + test-command). `RunnerReport`·executor·이벤트는 불변.

**스펙:** `docs/superpowers/specs/2026-08-18-determinism-check-design.md` (이하 "설계").
계획은 설계에서 논증하므로 실행자는 둘 다 읽는다.

## 전역 제약 (모든 태스크에 적용)

- 다른 오너의 패키지·`core/src/types.ts` 의 `McpClient`/`ToolResult`·루트 빌드 설정 수정 금지.
- `@modelcontextprotocol/sdk` 1.x 고정, 목록 밖 의존성 추가 금지. 이 계획은 의존성 0개 추가다.
- 의존 방향 단방향: `cli` → `runner` → `core`. 역참조·순환 금지.
- **서브에이전트는 git 명령을 실행하지 않는다.** 커밋·머지는 오케스트레이터가
  `completing-wave-tasks` 규약으로 처리한다.
- 유닛테스트는 인메모리 + `fixtures/` 만. 실서버 E2E(T4)는 직렬 웨이브 전용.
- 재귀 금지 영역: 값 순회(§4.2). 명시적 스택으로 쓴다.
- `--determinism` 없이 실행한 기존 경로의 출력은 바이트 단위 불변이어야 한다.
- 커밋 메시지는 Conventional Commits + scope (`feat(runner):`, `feat(cli):`, `test(cli):`).

## 실행 모델과 터미널 분할

터미널 1개(= worktree 1개 = 브랜치 `feat/determinism-check`). 태스크 간 의존이 직렬이라
(T2·T3 이 T1 의 타입·함수를 소비, T4 가 T3 의 플래그를 소비) 병렬 이득이 없다.

| 웨이브 | 태스크 | 패키지 | 모델 | 사유 |
|---|---|---|---|---|
| 1 | T1 runner 비교 함수 + 문장 | `runner` | **상위 모델** | 비교 의미론이 곧 결정론성 판단이고 문장이 곧 제품. 로컬 지침의 상위 모델 예외 두 항목(실패 메시지 문안, 결정론성)에 해당 |
| 2 | T2 캡처 래퍼 | `cli` | 표준 모델 | 계약이 설계 §5.1 에 코드로 박혀 있다 |
| 2 | T3 test-command 배선 | `cli` | 표준 모델 | 문구는 설계 §8 전량 확정, 파싱은 기존 패턴 복제 |
| 3 (직렬) | T4 E2E + ADR 초안 | `cli` (fixtures) + `docs` | 표준 모델 | 실서버 프로세스를 띄우므로 직렬 |

각 태스크 완료 시 오케스트레이터가 리뷰(diff·테스트 결과 직접 확인) 후 다음 태스크를 스폰한다.
통합 게이트: `pnpm build --force` → `pnpm typecheck` → `pnpm lint` → `pnpm test` 전부 녹색,
turbo 출력에서 `Cached: 0 cached` 확인(거짓 신호 표).

---

### Task T1: runner 비교 함수와 문장 — `determinism.ts`

**Files:**
- Create: `packages/runner/src/determinism.ts`
- Modify: `packages/runner/src/index.ts` (재수출 추가만)
- Test: `packages/runner/tests/determinism.test.ts`

**Interfaces:**
- Consumes: `canonicalJson`(`./canonical.js`), `clampObservedText`(`./diagnostics.js`),
  `RunnerRedactionOptions`(`./sanitization.js`), `TestCaseResult`(`./executor.js`),
  `AssertionResult`(`./assertions.js`). 전부 기존 심볼, 수정 금지.
- Produces: 설계 §4 의 공개 API 전부 — `DeterminismCaseObservation`,
  `CheckDeterminismOptions`, `DeterminismHint`, `DeterminismDifference`,
  `DeterminismResult`, `checkDeterminism`, `describeDeterminismDifference`.
  T2·T3 이 이 이름·타입을 그대로 import 한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/runner/tests/determinism.test.ts` 에 설계 §9.1 의 19개 케이스를 전부 만든다.
케이스 이름과 단언은 §9.1 표가 사양이다. 관찰 픽스처는 헬퍼로 만든다:

```ts
import { describe, expect, it } from "vitest";
import {
  checkDeterminism,
  describeDeterminismDifference,
  type DeterminismCaseObservation,
} from "../src/determinism.js";

/** 관찰 픽스처. response 는 키 자체를 생략할 수 있어야 하므로 spread 로 만든다. */
const observation = (
  overrides: Partial<DeterminismCaseObservation> & { readonly response?: unknown },
): DeterminismCaseObservation => ({
  caseId: "case-1",
  caseName: "정상 조회",
  toolName: "get_weather",
  status: "passed",
  assertionStatuses: ["passed"],
  ...overrides,
});
```

대표 단언(전체 19개 중 판단이 실리는 것들, 나머지는 §9.1 표대로):

```ts
it("응답 필드 값이 다르면 경로와 양쪽 값을 짚는다", () => {
  const result = checkDeterminism({
    first: [observation({ response: { content: [{ type: "text", text: "a" }], isError: false, raw: {} } })],
    second: [observation({ response: { content: [{ type: "text", text: "b" }], isError: false, raw: {} } })],
    stateRestored: true,
  });
  expect(result.differences).toHaveLength(1);
  expect(result.differences[0]).toMatchObject({
    kind: "response",
    path: "content[0].text",
    firstValue: '"a"',
    secondValue: '"b"',
  });
  expect(result.conclusion).toBe("nondeterministic");
});

it("배열 순서만 달라도 차이다", () => {
  const result = checkDeterminism({
    first: [observation({ response: { content: [], isError: false, raw: { items: [1, 2] } } })],
    second: [observation({ response: { content: [], isError: false, raw: { items: [2, 1] } } })],
    stateRestored: true,
  });
  expect(result.differences).toHaveLength(1);
  expect(result.differences[0]?.path).toBe("raw.items[0]");
});

it("객체 키 순서만 다르면 차이가 아니다", () => {
  const result = checkDeterminism({
    first: [observation({ response: { b: 2, a: 1 } })],
    second: [observation({ response: { a: 1, b: 2 } })],
    stateRestored: true,
  });
  expect(result.differences).toHaveLength(0);
  expect(result.conclusion).toBe("deterministic");
});

it("status 가 다르면 status 차이만 보고하고 응답은 안 본다", () => {
  const result = checkDeterminism({
    first: [observation({ status: "passed", response: { v: 1 } })],
    second: [observation({ status: "failed", response: { v: 2 } })],
    stateRestored: false,
  });
  expect(result.differences).toHaveLength(1);
  expect(result.differences[0]?.kind).toBe("status");
});

it("깊이 1500 응답에서 죽지 않는다", () => {
  // canonical.ts 전례 회귀. 재귀 구현이면 여기서 RangeError 로 죽는다.
  const deep = (leaf: unknown): unknown => {
    let value = leaf;
    for (let i = 0; i < 1500; i += 1) value = { nested: value };
    return value;
  };
  const result = checkDeterminism({
    first: [observation({ response: deep("a") })],
    second: [observation({ response: deep("b") })],
    stateRestored: true,
  });
  expect(result.differences[0]?.path).toBe(`${"nested.".repeat(1500).slice(0, -1)}`);
});

it("케이스 수가 다르면 던진다", () => {
  expect(() =>
    checkDeterminism({ first: [observation({})], second: [], stateRestored: true }),
  ).toThrow("관찰한 케이스 수가 다릅니다");
});

it("describeDeterminismDifference 가 §8 케이스 블록을 만든다", () => {
  const text = describeDeterminismDifference(
    {
      caseId: "case-3",
      caseName: "정상 조회",
      toolName: "get_weather",
      kind: "response",
      path: "content[0].text",
      firstValue: '"{\\"fetchedAt\\":\\"2026-08-18T14:03:11Z\\"}"',
      secondValue: '"{\\"fetchedAt\\":\\"2026-08-18T14:03:12Z\\"}"',
      hint: "timestamp",
    },
    { stateRestored: true },
  );
  expect(text).toContain("get_weather / 정상 조회 (case-3)");
  expect(text).toContain("→ 다른 지점: content[0].text");
  expect(text).toContain("1회차:");
  expect(text).toContain("시간 의존으로 보입니다");
});
```

힌트 4개 테스트(timestamp·randomId·numericDrift·패턴 밖·한쪽만 일치)는 문자열/숫자 쌍을
response 의 `content[0].text` 자리에 넣어 §6 조건대로 단언한다. 제외 테스트는 양쪽
`status: "notRun"` 관찰로 `skipped === 1` 을 단언한다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/runner/tests/determinism.test.ts`
Expected: FAIL — `determinism.js` 모듈 없음.

- [ ] **Step 3: 구현**

`packages/runner/src/determinism.ts` 전문. 타입 선언은 설계 §4 코드 블록을 **그대로**
옮긴다(공유 계약, 한 글자도 바꾸지 않는다). 함수 구현:

```ts
import { canonicalJson } from "./canonical.js";
import { clampObservedText } from "./diagnostics.js";
import type { RunnerRedactionOptions } from "./sanitization.js";

// ── 설계 §4 의 타입 선언을 여기 그대로 둔다 (생략하지 말 것) ──

/** 한쪽에만 존재하는 자리를 나타내는 내부 표지. 공개 API 밖으로 나가지 않는다. */
const MISSING: unique symbol = Symbol("missing");
type MaybeMissing = unknown | typeof MISSING;

type ValueKind = "missing" | "null" | "boolean" | "number" | "string" | "array" | "object";

const kindOf = (value: MaybeMissing): ValueKind => {
  if (value === MISSING) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const primitive = typeof value;
  if (primitive === "boolean" || primitive === "number" || primitive === "string")
    return primitive;
  return "object";
};

interface DiffHit {
  readonly path: string;
  readonly first: MaybeMissing;
  readonly second: MaybeMissing;
}

/**
 * 두 값을 병행 순회해 첫 차이 지점을 찾는다. 순회 순서는 정렬된 객체 키, 배열 인덱스 순으로
 * canonicalJson 의 직렬화 순서와 같다. **재귀를 쓰지 않는다** — canonical.ts 가 깊이 1500
 * 입력에서 재귀로 죽은 전례가 있고, 여기도 같은 입력을 받는다(설계 §4.2).
 */
const findFirstDifference = (firstRoot: unknown, secondRoot: unknown): DiffHit | null => {
  type Frame = { readonly first: MaybeMissing; readonly second: MaybeMissing; readonly path: string };
  const frames: Frame[] = [{ first: firstRoot, second: secondRoot, path: "" }];
  while (frames.length > 0) {
    const frame = frames.pop();
    if (frame === undefined) break;
    const { first, second, path } = frame;
    const firstKind = kindOf(first);
    if (firstKind !== kindOf(second)) return { path, first, second };
    if (firstKind === "missing" || firstKind === "null") continue;
    if (firstKind === "boolean" || firstKind === "number" || firstKind === "string") {
      if (!Object.is(first, second)) return { path, first, second };
      continue;
    }
    // LIFO 스택이므로 뒤 자식부터 push 해야 앞 자식을 먼저 방문한다.
    if (firstKind === "array") {
      const left = first as readonly unknown[];
      const right = second as readonly unknown[];
      const longest = Math.max(left.length, right.length);
      for (let index = longest - 1; index >= 0; index -= 1) {
        frames.push({
          first: index < left.length ? left[index] : MISSING,
          second: index < right.length ? right[index] : MISSING,
          path: `${path}[${index}]`,
        });
      }
      continue;
    }
    const left = first as Record<string, unknown>;
    const right = second as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      if (key === undefined) continue;
      frames.push({
        first: Object.hasOwn(left, key) ? left[key] : MISSING,
        second: Object.hasOwn(right, key) ? right[key] : MISSING,
        path: path === "" ? key : `${path}.${key}`,
      });
    }
  }
  return null;
};

/** 표시용 문자열. 비교는 원본으로 하고 표시만 자른다(설계 §6). */
const formatValue = (value: MaybeMissing, redaction?: RunnerRedactionOptions): string =>
  value === MISSING ? "(없음)" : clampObservedText(canonicalJson(value), redaction);

/** §6 휴리스틱. 양쪽 모두 패턴에 맞을 때만 힌트를 단다. 넓히지 않는다. */
const TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const detectHint = (first: MaybeMissing, second: MaybeMissing): DeterminismHint | undefined => {
  if (typeof first === "string" && typeof second === "string") {
    if (TIMESTAMP_PATTERN.test(first) && TIMESTAMP_PATTERN.test(second)) return "timestamp";
    if (UUID_PATTERN.test(first) && UUID_PATTERN.test(second)) return "randomId";
    return undefined;
  }
  if (typeof first === "number" && typeof second === "number") return "numericDrift";
  return undefined;
};

const firstAssertionMismatch = (
  first: readonly string[],
  second: readonly string[],
): number | null => {
  const longest = Math.max(first.length, second.length);
  for (let index = 0; index < longest; index += 1)
    if (first[index] !== second[index]) return index;
  return null;
};

export function checkDeterminism(options: CheckDeterminismOptions): DeterminismResult {
  const { first, second, stateRestored, redaction } = options;
  if (first.length !== second.length)
    throw new Error(
      `관찰한 케이스 수가 다릅니다: 1회차 ${first.length}개, 2회차 ${second.length}개. ` +
        "같은 스위트를 두 번 실행했다면 일어날 수 없는 일입니다.",
    );
  let compared = 0;
  let skipped = 0;
  const differences: DeterminismDifference[] = [];
  for (let index = 0; index < first.length; index += 1) {
    const left = first[index];
    const right = second[index];
    if (left === undefined || right === undefined) continue; // 길이 검사로 도달 불가. 인덱스 접근 방어.
    const excluded = left.status === "notRun" || left.status === "cancelled";
    if (left.status === right.status && excluded) {
      skipped += 1;
      continue;
    }
    compared += 1;
    const identity = { caseId: left.caseId, caseName: left.caseName, toolName: left.toolName };
    if (left.status !== right.status) {
      differences.push({ ...identity, kind: "status", firstValue: left.status, secondValue: right.status });
      continue;
    }
    const mismatch = firstAssertionMismatch(left.assertionStatuses, right.assertionStatuses);
    if (mismatch !== null) {
      differences.push({
        ...identity,
        kind: "assertion",
        path: `assertions[${mismatch}]`,
        firstValue: left.assertionStatuses[mismatch] ?? "(없음)",
        secondValue: right.assertionStatuses[mismatch] ?? "(없음)",
      });
      continue;
    }
    const leftHas = left.response !== undefined;
    const rightHas = right.response !== undefined;
    if (leftHas !== rightHas) {
      differences.push({
        ...identity,
        kind: "response",
        firstValue: leftHas ? formatValue(left.response, redaction) : "(응답 없음)",
        secondValue: rightHas ? formatValue(right.response, redaction) : "(응답 없음)",
      });
      continue;
    }
    if (!leftHas) continue;
    if (canonicalJson(left.response) === canonicalJson(right.response)) continue;
    const hit = findFirstDifference(left.response, right.response);
    if (hit === null)
      throw new Error("정규화 결과가 다른데 차이 지점을 찾지 못했습니다. determinism.ts 의 결함입니다.");
    const hint = detectHint(hit.first, hit.second);
    differences.push({
      ...identity,
      kind: "response",
      path: hit.path === "" ? "(루트)" : hit.path,
      firstValue: formatValue(hit.first, redaction),
      secondValue: formatValue(hit.second, redaction),
      ...(hint !== undefined ? { hint } : {}),
    });
  }
  return {
    compared,
    skipped,
    differences,
    conclusion:
      differences.length > 0
        ? "nondeterministic"
        : stateRestored
          ? "deterministic"
          : "consistentWithoutReset",
  };
}

export function describeDeterminismDifference(
  difference: DeterminismDifference,
  options: { readonly stateRestored: boolean },
): string {
  const header =
    difference.toolName === null
      ? `  ${difference.caseName} (${difference.caseId})`
      : `  ${difference.toolName} / ${difference.caseName} (${difference.caseId})`;
  if (difference.kind === "status") {
    const guidance = options.stateRestored
      ? "  → 상태를 복원하고도 판정이 갈렸으므로, 서버가 같은 입력에 다른 판정을 냈습니다."
      : "  → 이 케이스는 이전 실행이 남긴 상태에 의존할 수 있습니다. --reset-cmd 로 상태를\n" +
        "    복원하거나, 상태 비의존 케이스로 바꾸세요.";
    return [
      header,
      `  → 판정이 다릅니다: 1회차 ${difference.firstValue}, 2회차 ${difference.secondValue}`,
      guidance,
    ].join("\n");
  }
  const lines = [
    header,
    `  → 다른 지점: ${difference.path ?? "(응답 유무)"}`,
    `     1회차: ${difference.firstValue}`,
    `     2회차: ${difference.secondValue}`,
  ];
  if (difference.kind === "assertion")
    lines.push("  → 같은 판정 절차가 다른 결과를 냈습니다. 응답이 실행마다 달라졌는지 확인하세요.");
  else if (difference.hint === "timestamp")
    lines.push("  → 시간 의존으로 보입니다. 이 값은 실행마다 바뀌므로 단언 기준이 될 수 없습니다.");
  else if (difference.hint === "randomId")
    lines.push("  → 실행마다 새로 발급되는 식별자로 보입니다. 이 값은 단언 기준이 될 수 없습니다.");
  else if (difference.hint === "numericDrift")
    lines.push("  → 측정값 변동으로 보입니다. 이 값은 단언 기준이 될 수 없습니다.");
  return lines.join("\n");
}
```

`index.ts` 재수출(알파벳 순서에 맞춰 기존 export 블록 사이에):

```ts
export {
  checkDeterminism,
  describeDeterminismDifference,
  type CheckDeterminismOptions,
  type DeterminismCaseObservation,
  type DeterminismDifference,
  type DeterminismHint,
  type DeterminismResult,
} from "./determinism.js";
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run packages/runner/tests/determinism.test.ts`
Expected: 19 passed.

- [ ] **Step 5: 회귀 확인**

Run: `pnpm vitest run packages/runner/tests/` 후 `pnpm typecheck`
Expected: 전부 녹색. 기존 테스트 결과 불변.

- [ ] **Step 6: 보고**

보고서를 `<worktree>/reports/T1.md` 에 쓰고 `status: READY_FOR_REVIEW` 로 끝낸다.
(커밋은 오케스트레이터 몫. 서브에이전트는 git 명령 금지.)

---

### Task T2: 응답 캡처 래퍼 — `determinism-capture.ts`

**Files:**
- Create: `packages/cli/src/determinism-capture.ts`
- Test: `packages/cli/tests/determinism-capture.test.ts`

**Interfaces:**
- Consumes: `McpClient`(`@ohmymcp/core`), `RunnerEvent`·`DeterminismCaseObservation`
  (`@ohmymcp/runner`, T1 산출). T1 통합 후에만 시작한다.
- Produces: `DeterminismCapture` 인터페이스와 `createDeterminismCapture(inner: McpClient)`.
  T3 이 이 이름으로 import 한다.

- [ ] **Step 1: 실패하는 테스트 작성**

설계 §9.2 앞 두 줄이 이 태스크 몫이다. 가짜 client 는 지연 resolve 를 제어할 수 있게 만든다:

```ts
import { describe, expect, it } from "vitest";
import type { McpClient, ToolResult } from "@ohmymcp/core";
import { createDeterminismCapture } from "../src/determinism-capture.js";

const toolResult = (text: string): ToolResult => ({
  content: [{ type: "text", text }],
  isError: false,
  raw: {},
});

it("캡처가 호출을 현재 케이스에 귀속시킨다", async () => {
  const inner: McpClient = {
    listTools: async () => [],
    callTool: async (_name, args) => toolResult(String((args as { v: string }).v)),
    close: async () => {},
  };
  const capture = createDeterminismCapture(inner);
  capture.onEvent({ type: "caseStarted", sequence: 1, caseId: "c1", caseIndex: 0,
    case: { id: "c1", name: "첫째", operation: { type: "callTool", tool: "echo", input: { v: "a" } },
      assertions: [{ type: "isError", expected: false }] } });
  await capture.client.callTool("echo", { v: "a" });
  capture.onEvent({ type: "caseStarted", sequence: 2, caseId: "c2", caseIndex: 1,
    case: { id: "c2", name: "둘째", operation: { type: "callTool", tool: "echo", input: { v: "b" } },
      assertions: [{ type: "isError", expected: false }] } });
  await capture.client.callTool("echo", { v: "b" });
  const observations = capture.observations();
  expect(observations).toHaveLength(2);
  expect(observations[0]?.caseId).toBe("c1");
  expect((observations[0]?.response as ToolResult).content).toEqual([{ type: "text", text: "a" }]);
  expect(observations[1]?.caseId).toBe("c2");
});

it("늦게 도착한 응답도 호출 시점 케이스에 귀속된다", async () => {
  let release: ((value: ToolResult) => void) | undefined;
  const inner: McpClient = {
    listTools: async () => [],
    callTool: () => new Promise<ToolResult>((resolve) => { release = resolve; }),
    close: async () => {},
  };
  const capture = createDeterminismCapture(inner);
  capture.onEvent({ type: "caseStarted", sequence: 1, caseId: "c1", caseIndex: 0,
    case: { id: "c1", name: "느린 케이스", operation: { type: "callTool", tool: "echo", input: { v: "late" } },
      assertions: [{ type: "isError", expected: false }] } });
  const pending = capture.client.callTool("echo", { v: "late" });
  // 케이스 1 이 타임아웃 처리되고 케이스 2 가 시작된 뒤에 응답이 도착한다.
  capture.onEvent({ type: "caseStarted", sequence: 2, caseId: "c2", caseIndex: 1,
    case: { id: "c2", name: "다음 케이스", operation: { type: "callTool", tool: "echo", input: { v: "next" } },
      assertions: [{ type: "isError", expected: false }] } });
  release?.(toolResult("late"));
  await pending;
  const observations = capture.observations();
  expect((observations[0]?.response as ToolResult | undefined)?.content)
    .toEqual([{ type: "text", text: "late" }]);
  expect(observations[1]?.response).toBeUndefined(); // 키 자체가 없어야 한다
  expect(Object.hasOwn(observations[1] ?? {}, "response")).toBe(false);
});
```

`caseCompleted` 이벤트로 `status`·`assertionStatuses` 가 옮겨지는 단언과, 어떤 케이스도
시작되기 전 호출(`caseIndex` 미확정)은 버려지는 단언도 추가한다. 이벤트 리터럴의 타입이
길므로 테스트 상단에 이벤트 빌더 헬퍼를 둬도 된다. 단 실제 `RunnerEvent` 타입에 맞춘다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/cli/tests/determinism-capture.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

```ts
import type { McpClient } from "@ohmymcp/core";
import type { DeterminismCaseObservation, RunnerEvent } from "@ohmymcp/runner";

/**
 * McpClient 를 감싸 응답을 케이스에 귀속시켜 기록한다(설계 §5.1). cassetteClient 와 같은
 * 래퍼 패턴이라 runner 를 고치지 않는다.
 *
 * 귀속은 **호출 시점**의 현재 케이스 인덱스다. executor 는 케이스를 직렬로 돌리지만 응답
 * resolve 는 케이스 경계를 넘을 수 있다(타임아웃 뒤 늦게 도착). 호출 시점에 인덱스를 잡아
 * 두면 늦은 응답이 다음 케이스로 새지 않는다.
 */
export interface DeterminismCapture {
  readonly client: McpClient;
  readonly onEvent: (event: RunnerEvent) => void;
  readonly observations: () => readonly DeterminismCaseObservation[];
}

interface Slot {
  caseId: string;
  caseName: string;
  toolName: string | null;
  status: DeterminismCaseObservation["status"];
  assertionStatuses: readonly DeterminismCaseObservation["assertionStatuses"][number][];
  response?: unknown;
  captured: boolean;
}

export function createDeterminismCapture(inner: McpClient): DeterminismCapture {
  const slots: Slot[] = [];
  let current = -1;

  const record = (index: number, response: unknown): void => {
    const slot = slots[index];
    if (slot === undefined || slot.captured) return; // 케이스당 호출은 1회. 중복은 버린다.
    slot.captured = true;
    slot.response = response;
  };

  const onEvent = (event: RunnerEvent): void => {
    if (event.type === "caseStarted") {
      current = event.caseIndex;
      slots[event.caseIndex] = {
        caseId: event.caseId,
        caseName: event.case.name,
        toolName: event.case.operation.type === "callTool" ? event.case.operation.tool : null,
        status: "notRun",
        assertionStatuses: [],
        captured: false,
      };
    } else if (event.type === "caseCompleted") {
      const slot = slots[event.caseIndex];
      if (slot === undefined) return;
      slot.status = event.result.status;
      slot.assertionStatuses = event.result.assertions.map((assertion) => assertion.status);
    }
  };

  const client: McpClient = {
    listTools: () => {
      const at = current;
      return inner.listTools().then((tools) => {
        record(at, tools);
        return tools;
      });
    },
    callTool: (name, args) => {
      const at = current;
      return inner.callTool(name, args).then((result) => {
        record(at, result);
        return result;
      });
    },
    close: () => inner.close(),
  };

  return {
    client,
    onEvent,
    observations: () =>
      slots.map((slot) => ({
        caseId: slot.caseId,
        caseName: slot.caseName,
        toolName: slot.toolName,
        status: slot.status,
        assertionStatuses: slot.assertionStatuses,
        // 키는 캡처했을 때만 만든다. undefined 로 넣으면 "응답 없음" 판정이 흐려진다.
        ...(slot.captured ? { response: slot.response } : {}),
      })),
  };
}
```

`record(at, ...)` 에서 `at === -1` 이면 `slots[-1]` 이 `undefined` 라 자연히 버려진다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run packages/cli/tests/determinism-capture.test.ts`
Expected: PASS.

- [ ] **Step 5: 보고**

`<worktree>/reports/T2.md`, `status: READY_FOR_REVIEW`.

---

### Task T3: test-command 배선 — 플래그·2회 실행·렌더

**Files:**
- Modify: `packages/cli/src/test-command.ts` (파싱·의존성·실행 흐름·렌더)
- Modify: `packages/cli/src/help.ts` (`TEST_USAGE` 와 옵션 설명)
- Test: `packages/cli/tests/test-command.test.ts` (기존 파일에 케이스 추가)

**Interfaces:**
- Consumes: T1 의 `checkDeterminism`·`describeDeterminismDifference`·`DeterminismResult`,
  T2 의 `createDeterminismCapture`, 기존 `runResetCommand`·`ResetCommandError`
  (`./reset-hook.js`), 기존 `renderProcessDiagnostics`(`./process-diagnostics.js`).
- Produces: CLI 사용자 표면. 후속 태스크 소비자는 T4(E2E)뿐이다.

- [ ] **Step 1: 실패하는 테스트 작성**

설계 §9.2 의 나머지 11개를 기존 `test-command.test.ts` 의 관례(가짜
`TestCommandDependencies`)로 추가한다. 케이스 이름·단언은 §9.2 표가 사양이다. 판단이 실리는
단언 셋:

```ts
it("--reset-cmd 와 함께면 각 회차 전에 복원한다", async () => {
  const calls: string[] = [];
  // deps.runResetCommand 가짜: calls.push("reset"), deps.startRunner 가짜: calls.push("run")
  // ... 실행 후:
  expect(calls).toEqual(["reset", "run", "reset", "run"]);
});

it("판정·종료 코드가 1회차를 따른다", async () => {
  // 1회차 전부 통과 + 2회차 응답 차이가 나는 가짜 러너 구성
  expect(exitCode).toBe(0);
  expect(stdout).toContain("케이스에서 2회 실행 결과가 다릅니다");
});

it("--determinism 없으면 기존 출력이 바이트 단위로 같다", async () => {
  // 같은 가짜 의존성으로 플래그 없이 실행한 출력 스냅샷과 비교
  expect(withoutFlag).toBe(baselineSnapshot);
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/cli/tests/test-command.test.ts`
Expected: 새 케이스만 FAIL(플래그 미인식), 기존 케이스는 PASS 유지.

- [ ] **Step 3: 구현**

변경 다섯 곳. 파싱과 위임은 기존 패턴 복제라 사양 문장으로 적고, 순서가 판단인 실행 흐름만
코드 수준으로 적는다.

1. **파싱.** `--determinism`(값 없는 스위치, 중복 지정은 무해하므로 그냥 true 유지)과
   `--reset-cmd <command>`(중복 금지·값 누락 검사, `--junit` 분기 복제. 오류 문구는
   `` `--reset-cmd`는 한 번만 사용할 수 있습니다. `` / `` `--reset-cmd` 옵션 값이 필요합니다. ``).
2. **오류 코드.** `CliErrorCode` 유니온에 `"RESET_COMMAND_FAILED"` 추가.
   `ResetCommandError` 를 잡아 `{ code: "RESET_COMMAND_FAILED", message: 초기화 명령이
   실패했습니다: <command>, hint: 종료 코드와 stderr 마지막 3줄 }` 로 변환한다.
   generate 쪽의 같은 오류 처리 문구를 참조하되 복제는 하지 않는다(문장 소유는 각 커맨드).
3. **의존성.** `TestCommandDependencies` 에 선택 주입 둘 추가(§7 의 `checkInputContract`
   패턴과 동일). 기본값은 실제 함수다.

   ```ts
   checkDeterminism?(options: CheckDeterminismOptions): DeterminismResult;
   runResetCommand?(command: string): Promise<void>;
   ```

4. **실행 흐름.** 순서가 판단이다:

   ```
   resetCmd 지정 시: runResetCommand(resetCmd)            // 실패하면 실행 시작 전 중단
   1회차: connect → (determinism 이면 capture A 로 client·onEvent 감싸기) → runSuite
          → finalize → renderReport → JUnit·repair 번들·specFindings (전부 기존 그대로, 1회차만)
          → 1회차 연결 종료 (기존 종료 절차)
   determinism 이면:
     resetCmd 지정 시: runResetCommand(resetCmd)          // 2번째 복원
     2회차: connect (새 프로세스) → capture B → runSuite → finalize
            → 2회차 연결 종료
     2회차가 aborted·연결 실패·실행 오류면: §8 미완주 블록 + 2회차 연결의
            renderProcessDiagnostics 출력. 비교하지 않는다.
     정상이면: checkDeterminism({ first: A.observations(), second: B.observations(),
            stateRestored: resetCmd !== undefined, redaction }) → 결과 블록 렌더
   종료 코드: 기존 로직 그대로 (1회차 판정만 반영)
   ```

   2회차의 실패는 **CLI 오류로 던지지 않는다.** 1회차 보고가 이미 화면에 있고 종료 코드도
   1회차 몫이다. 2회차 문제는 결정론성 블록 안의 문장으로만 존재한다.

5. **렌더.** 결과 블록 문장은 설계 §8 이 전량이다. 요약 줄 형식:

   - `deterministic`: `→ 같은 초기 상태에서 2회 실행한 결과가 모든 케이스에서 같습니다. (N/N)`
   - `consistentWithoutReset`: §8 의 두 줄.
   - `nondeterministic`: `→ D/N 케이스에서 2회 실행 결과가 다릅니다.` + 빈 줄 + 케이스 블록들
     (`describeDeterminismDifference(difference, { stateRestored })` 을 빈 줄로 이어 붙임).
   - `skipped > 0` 이면 개수 뒤에 ` (제외 S: 실행되지 않은 케이스)` 를 덧붙인다.
   - 블록 제목은 `결정론성 확인`, 위치는 프로세스 진단과 같은 채널·같은 자리.
   - `--json` 이면 기존 JSON 객체에 `determinism` 키로 `DeterminismResult` 를 그대로 싣는다.
     플래그가 없으면 키를 만들지 않는다.

   help(`TEST_USAGE` 와 옵션 설명)는 설계 §8 끝의 문구를 그대로 쓴다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run packages/cli/tests/test-command.test.ts`
Expected: 전부 PASS (기존 + 신규).

- [ ] **Step 5: 회귀 확인**

Run: `pnpm vitest run packages/cli/tests/` 후 `pnpm typecheck` · `pnpm lint`
Expected: 전부 녹색.

- [ ] **Step 6: 보고**

`<worktree>/reports/T3.md`, `status: READY_FOR_REVIEW`.

---

### Task T4: E2E(직렬) + ADR 초안

**Files:**
- Create: `packages/cli/tests/fixtures/nondeterministic-weather-server.mjs`
- Create: `packages/cli/tests/fixtures/nondeterministic-weather.suite.json`
- Create: `packages/cli/tests/determinism-e2e.test.ts`
- Create: `docs/adr/0038-결정론성-확인의-비교-대상과-캡처-위치.md`

**Interfaces:**
- Consumes: T3 의 `--determinism`·`--reset-cmd` 플래그, `examples/weather-server`
  (읽기 전용, 수정 금지), `broken-weather-server.mjs` 의 stdio JSON-RPC 골격.
- Produces: 없음 (종단).

- [ ] **Step 1: 비결정 픽스처 서버 작성**

`broken-weather-server.mjs` 의 프로토콜 골격(readline + 줄 단위 JSON-RPC, SDK 미사용 사유
주석 포함)을 복사하고, 툴과 응답만 바꾼다:

```js
const TOOLS = [
  {
    name: "get_weather",
    description: "지정한 도시의 현재 날씨를 반환한다. 응답에 조회 시각이 들어간다.",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string", description: "도시 이름" } },
      required: ["city"],
    },
  },
];

const WEATHER = { 서울: { temp: 21, condition: "맑음" } };

function handleCall(name, args) {
  if (name !== "get_weather") return fail(`→ '${name}' 툴이 없습니다.`);
  const city = args?.city;
  if (typeof city !== "string" || !Object.hasOwn(WEATHER, city))
    return fail(`→ '${String(city)}' 의 날씨 데이터가 없습니다.`);
  // 심은 비결정: 조회 시각. 단계 7 E2E 가 이 필드를 잡는 것이 존재 이유다.
  return text({ ...WEATHER[city], fetchedAt: new Date().toISOString() });
}
```

스위트 픽스처는 케이스 1개(`get_weather`, `{ "city": "서울" }`, `isError: false` 단언 1개)로
충분하다. 형식은 `weather-suite.json` 을 따른다.

- [ ] **Step 2: 실패하는 E2E 작성**

`determinism-e2e.test.ts`. 실서버 프로세스를 띄우므로 이 파일은 직렬 웨이브에서만 돌린다.
기존 E2E 파일(`fetch-server-e2e.test.ts` 류)의 CLI 스폰 관례를 따른다.

```ts
it("weather-server 는 차이 0 이다", async () => {
  // examples/weather-server 대상, --determinism 지정
  expect(stdout).toContain("결정론성 확인");
  expect(stdout).toContain("2회 실행 결과가 같았습니다");
  expect(exitCode).toBe(0);
});

it("비결정 예제 서버에서 차이를 짚는다", async () => {
  // fixtures/nondeterministic-weather-server.mjs 대상, --determinism 지정
  expect(stdout).toContain("1/1 케이스에서 2회 실행 결과가 다릅니다");
  expect(stdout).toContain("content[0].text");
  expect(stdout).toContain("시간 의존으로 보입니다");
  expect(exitCode).toBe(0); // 비차단
});
```

weather-server 케이스는 `--reset-cmd` 없이 돌리므로 `consistentWithoutReset` 문장
("같았습니다")을 단언한다. 고정 데이터 서버라 상태 복원이 필요 없지만 문장은 복원 유무를
따른다는 사실 자체가 검증 대상이다.

- [ ] **Step 3: 실행·통과 확인**

Run: `pnpm vitest run packages/cli/tests/determinism-e2e.test.ts`
Expected: PASS. 실패하면 T3 결함이므로 `BLOCKED` 로 보고하고 수정은 오케스트레이터 판단에
맡긴다.

- [ ] **Step 4: ADR-0038 초안**

`docs/adr/0038-결정론성-확인의-비교-대상과-캡처-위치.md`. 배경 / 선택지 / 결정 / 이유 /
결과 다섯 항목, 한 페이지. 내용은 설계 §10 의 셋이다: 비교 대상(바이트 → 구조화로 뒤집은
경위와 §1.4.3 실측 근거), 캡처 위치(runner 이벤트 확장 대신 CLI 래퍼, `RunnerReport` 불변
이유), 결론 강도 구분(복원 없는 실행을 거부하지 않은 이유). 형식은 `docs/adr/` 의 최근
ADR(0036·0037)을 따른다.

- [ ] **Step 5: 보고**

`<worktree>/reports/T4.md`, `status: READY_FOR_REVIEW`.

---

## 통합 게이트 (오케스트레이터, 각 웨이브 뒤)

1. 보고서·허용 Files 의 diff·테스트 결과를 직접 확인한다. 자식의 "완료" 는 단서일 뿐이다.
2. `pnpm build --force` → `pnpm typecheck` → `pnpm lint` → `pnpm test`. turbo 출력에서
   `Cached: 0 cached` 확인. T1 이 패키지 간 타입 계약을 신설하므로 `--force` 가 필수다
   (거짓 신호 표: 낡은 `dist/*.d.ts`).
3. 최종 웨이브 뒤 실환경 확인 한 번: 루트에서
   `node packages/cli/dist/cli.mjs test <임시 스위트> --command node --arg examples/weather-server/server.mjs --determinism`
   을 직접 실행해 §8 블록이 실제로 찍히는지 본다(빌드 산출물 경로는 실행 시점에 확인).
4. 통합 SHA 를 `docs/task-integration-ledger.tsv` 에 기록한다.
5. 완료 후 로드맵(`ROADMAP.local.md`)의 단계 7 항목과 「다음 작업」 D 를 갱신한다.

## 실행 프롬프트 (터미널 1, 유일)

사람 사전 조건 2줄: 루트에서 `git log --oneline -1` 로 스펙·계획 커밋이 HEAD 에 있는지,
`git status` 가 깨끗한지 확인한다. (이 계획서와 스펙은 커밋돼 있어야 worktree 에 딸려간다.)

권장 실행 설정: 오케스트레이터 세션은 상위 모델. 태스크 스폰 시 모델은 위 웨이브 표를 따른다
(T1 상위, T2·T3·T4 표준). 에이전트 종류는 general-purpose.

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.
프로젝트 루트 /Users/doo._.hyun/Study/Project/OhMyMCP 에서 시작한다.
  git rev-parse HEAD
로 기점 커밋을 기록한 뒤,
  git worktree add /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-determinism -b feat/determinism-check
를 실행하고 그 경로로 세션을 옮겨라(EnterWorktree 에 path 로 넘긴다. name 으로 새로 만들게
하지 마라).
진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 BLOCKED 로 보고해라:
  - pwd 가 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-determinism 인지
  - git log --oneline -1 이 루트에서 기록한 기점 커밋과 같은지
  - docs/superpowers/specs/2026-08-18-determinism-check-design.md 와
    docs/superpowers/plans/2026-08-18-determinism-check.md 가 실제로 존재하는지
  - git status --short 가 깨끗한지
  - pnpm install 후 pnpm build 가 성공하는지, pnpm vitest --version 이 실행되는지
[2단계: 실행]
너는 오케스트레이터다. 직접 구현하지 말고 execution-conventions 스킬을 읽은 뒤
docs/superpowers/plans/2026-08-18-determinism-check.md 의 태스크를 T1 → T2 → T3 → T4
순서로 서브에이전트에 넘겨라. 스폰 프롬프트에 반드시 넣을 것:
  - Task 식별자, worktree 경로(위와 같음), 허용 Files(계획서의 해당 태스크 Files 목록),
    테스트 명령, 보고서 경로 <worktree>/reports/T<N>.md, 모델(T1 상위, 나머지 표준)
  - 금지: 허용 Files 밖 수정, 다른 오너 패키지, core/src/types.ts, 루트 빌드 설정,
    의존성 추가, git 명령 전부, 백그라운드 실행, 하위 에이전트 스폰
  - 완료 형식: status: READY_FOR_REVIEW 또는 BLOCKED + 변경 파일 + 검증 명령과 결과
각 태스크 보고 후 diff 와 테스트 결과를 직접 확인하고, 계획서의 통합 게이트를 통과시킨 뒤
다음 태스크로 넘어가라. T4 는 실서버를 띄우므로 앞 태스크가 전부 통합된 뒤 단독으로 돌려라.
전체 게이트가 녹색이면 completing-wave-tasks 스킬을 읽고 커밋·정리하고, 통합 SHA 를
docs/task-integration-ledger.tsv 에 기록해라. 커밋 메시지 scope 는 runner·cli 태스크별로
나눈다(전역 제약 참조).
```
