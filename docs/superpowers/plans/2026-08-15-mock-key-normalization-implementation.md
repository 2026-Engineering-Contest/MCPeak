# 목 매칭 키 정규화 경계 구현 계획 (2026-08-15)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@ohmymcp/mock` 이 매칭 키를 만들 수 없는 인자를 주입 시점에 읽을 수 있는 문장으로 거부하고, 깊은 중첩이 목 서버 프로세스를 죽이지 않게 한다.

**Architecture:** 판정(`findKeyViolation`, 순수 함수) · 문장(`keyViolationMessage`) · 배선(`put`)을 세 층으로 나눈다. 주입 경로에서만 도달 가능한 네 부류는 `put` 에서 거부하고, 와이어로도 도달하는 깊이는 공유 함수 `stableKey` 에서 막아 조회 경로에서는 `isError` 응답으로 바꾼다.

**Tech Stack:** TypeScript 5.9 / vitest 4 / tsdown / pnpm workspace. 새 런타임 의존성 없음.

**설계 문서:** `docs/superpowers/specs/2026-08-15-mock-key-normalization-design.md`

## Global Constraints

모든 태스크의 요구사항에 아래가 암묵적으로 포함된다.

- **새 의존성을 추가하지 않는다.** 이 작업은 `node:` 내장조차 필요 없다 (CLAUDE.md).
- **`@modelcontextprotocol/sdk` 는 `catalog:` 고정.** 버전을 올리지 않고 `^` 를 붙이지 않는다.
- **`core/src/types.ts` 의 `McpClient` · `ToolResult` 를 건드리지 않는다.**
- **공개 API 를 바꾸지 않는다.** 패키지 진입점(`src/index.ts`)의 export 목록(`ANY`, `MockResponse`, `MockDefinition`, `MockOptions`, `MockServer`, `assertMockDefinition`, `createMockServer`, `serveStdio`)이 **한 줄도 늘거나 줄지 않는다.** 새 심볼은 `src/key-violation.ts` 에 두고 `index.ts` 가 import 만 한다 — 그 파일은 `tsdown` 진입점이 아니라 번들에 딸려 들어갈 뿐이라 패키지 밖에서 접근할 수 없다.
- **`packages/mock` 밖의 소스를 수정하지 않는다.** 다른 파트 소유다 (CLAUDE.md, CONTRIBUTING §2.2).
- **커밋은 사람이 한다.** 각 태스크의 마지막 단계는 `git commit` 실행이 아니라 **권장 커밋 메시지와 변경 파일 제시**다. 사람이 만든 SHA 를 확인한 뒤 다음 태스크를 시작한다 (CLAUDE.md, `CLAUDE.local.md` §4 — 이 규칙이 스킬 기본 템플릿보다 우선한다).
- **문장 규칙:** 변하는 값 뒤에 은/는 · 이/가 · 을/를 · 로/으로를 붙이지 않는다. 값은 콜론이나 대시 뒤에 둔다 (설계 §6.8).
- **`packages/mock/src` 안의 상대 import 는 확장자를 `.ts` 로 쓴다.** raw node 제약 때문이다 — 파일 구조 절 참조.
- **커밋 메시지:** Conventional Commits, scope 는 `mock` (CONTRIBUTING §4).

## 파일 구조

| 파일 | 변경 | 책임 |
|---|---|---|
| `packages/mock/src/key-violation.ts` | **생성** | 상한 상수 · 판정 · 문장 · `KeyDepthError`. 이 계획의 새 코드는 전부 여기 산다 |
| `packages/mock/src/index.ts` | 수정 | 배선만 — `put` · `seed` · `on` · `stableKey` 깊이 인자 · 핸들러 |
| `packages/mock/tests/key-violation.test.ts` | 생성 | 판정 표와 문장 전문 고정 (T1 · T2) |
| `packages/mock/tests/index.test.ts` | 수정 | 주입 배선 · `ANY` 회귀 · 조회 깊이 (T3 · T4) |
| `packages/mock/README.md` | 수정 | 거부 규칙 문서화 (T5) |
| `.changeset/mock-key-normalization.md` | 생성 | minor 범프 (T5) |
| `packages/mock/tsconfig.json` | 수정 | `allowImportingTsExtensions` — 아래 raw node 제약의 짝 (T3) |
| `packages/mock/tests/fixtures/stdio-entry.mjs` | 수정 | 주석만 — 왜 `.ts` 확장자여야 하는지 (T3) |
| `docs/adr/NNNN-목-매칭-키-정규화-경계.md` | 생성 | 번호는 T5 Step 1 에서 확인 (T5) |

**소스를 나누는 이유가 둘이다.**

1. **공개 API 를 지킨다.** 테스트가 판정 함수를 부르려면 export 가 필요한데, `index.ts` 에 두면 그것이 곧 패키지의 공개 API 가 된다. 별도 모듈이면 테스트는 `../src/key-violation.js` 로 직접 import 하고 패키지 밖에서는 보이지 않는다.
2. **`index.ts` 가 275 줄이다.** 판정·문장까지 얹으면 380 줄이 넘는다. 키 규칙은 한 덩어리로 같이 바뀌고 같이 읽히므로 떼어내는 편이 맞다.

배선 테스트는 서버를 띄우는 기존 `index.test.ts` 의 헬퍼(`start`, `connect`, `text`)를 그대로 쓴다.

`tsdown` 설정은 손대지 않는다. 진입점은 `index.ts` · `stdio.ts` 그대로이고 새 모듈은 번들에 딸려 들어간다.

### raw node 제약 — 이 패키지만의 것

`packages/mock/tests/fixtures/stdio-entry.mjs` 는 `src/index.ts` 를 **빌드 없이 raw node**
(`--experimental-strip-types`)로 돌린다. Node 의 ESM 리졸버는 `.js` 를 `.ts` 로 매핑하지 않으므로,
`index.ts` 가 부르는 상대 모듈은 **확장자를 `.ts` 로 써야 한다.** `.js` 를 쓰면
`ERR_MODULE_NOT_FOUND` 로 서버가 즉시 죽고, 테스트에는 *"요청 완료 전 MCP 서버가 종료되었습니다"*
로만 보인다.

짝으로 `packages/mock/tsconfig.json` 에 `allowImportingTsExtensions: true` 가 필요하다.
`moduleResolution` 이 `Bundler` 이고 이 패키지의 `typecheck` 가 `tsc --noEmit` 이라 성립한다
(빌드는 tsdown 이 한다). 공유 `tsconfig.base.json` 은 건드리지 않는다.

**이것은 `packages/mock` 에만 해당한다.** 다른 패키지는 `.js` 를 쓰며, 그쪽에는 소스를 그대로
실행하는 테스트가 없다.

## 스펙과 다른 점 (의도된 것)

- 설계 §5 는 `assertKeyable(value, tool, source)` 였다. **`tool` 을 뺀다** — `source` 가 이미 `mock.on('add', ...)` 로 툴 이름을 담고 있어 두 인자가 어긋날 여지만 생긴다.

---

## Task 1: 판정 계층

**Files:**
- Create: `packages/mock/src/key-violation.ts`
- Test: `packages/mock/tests/key-violation.test.ts` (생성)

**Interfaces:**
- Consumes: 없음
- Produces: `MAX_KEY_DEPTH: 512`, `type KeyViolation`, `findKeyViolation(value: unknown): KeyViolation | undefined` — 전부 `src/key-violation.ts` 에서 export. `src/index.ts` 는 이 태스크에서 건드리지 않는다

- [ ] **Step 1: 판정 테스트를 먼저 쓴다**

`packages/mock/tests/key-violation.test.ts` 를 만든다. 테스트는 `src` 를 보고 빌드 산출물을 보지 않는다.

```ts
import { describe, expect, it } from "vitest";
import { findKeyViolation, MAX_KEY_DEPTH } from "../src/key-violation.js";

/** 깊이 n 짜리 중첩 객체를 만든다. 루트가 깊이 0. */
function nest(depth: number): unknown {
  let value: unknown = null;
  for (let i = 0; i < depth; i++) value = { a: value };
  return value;
}

describe("findKeyViolation — 통과하는 값", () => {
  it.each([
    ["빈 객체", {}],
    ["원시값만", { a: 1, b: "x", c: true, d: null }],
    ["중첩 객체", { a: { b: { c: 1 } } }],
    ["배열", { items: [1, "x", null, { a: 1 }] }],
    ["undefined 프로퍼티", { a: 1, b: undefined }],
    ["배열 안 undefined", { items: [1, undefined, 3] }],
    ["같은 객체를 두 번 참조 (순환 아님)", (() => { const s = { x: 1 }; return { a: s, b: s }; })()],
  ])("%s", (_name, value) => {
    expect(findKeyViolation(value)).toBeUndefined();
  });
});

describe("findKeyViolation — 거부하는 값", () => {
  it.each([
    ["루트의 NaN", { n: NaN }, { kind: "nonFinite", path: "args.n", found: "NaN" }],
    ["중첩된 Infinity", { a: { b: Infinity } }, { kind: "nonFinite", path: "args.a.b", found: "Infinity" }],
    ["배열 안 NaN", { items: [1, NaN] }, { kind: "nonFinite", path: "args.items[1]", found: "NaN" }],
    ["Date", { when: new Date(0) }, { kind: "notJson", path: "args.when", found: "Date" }],
    ["함수", { f: () => {} }, { kind: "notJson", path: "args.f", found: "function" }],
    ["Map", { m: new Map() }, { kind: "notJson", path: "args.m", found: "Map" }],
  ])("%s", (_name, value, expected) => {
    expect(findKeyViolation(value)).toEqual(expected);
  });

  it("희소 배열", () => {
    expect(findKeyViolation({ items: [1, , 3] })).toEqual({
      kind: "sparse",
      path: "args.items[1]",
    });
  });

  it("순환 참조", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(findKeyViolation(circular)).toEqual({ kind: "circular", path: "args.self" });
  });

  it("상한을 넘는 깊이", () => {
    const violation = findKeyViolation(nest(MAX_KEY_DEPTH + 2));
    expect(violation).toEqual({ kind: "tooDeep", depth: MAX_KEY_DEPTH + 1 });
  });

  it("상한과 같은 깊이는 통과한다", () => {
    expect(findKeyViolation(nest(MAX_KEY_DEPTH))).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패하는 것을 확인한다**

```bash
npx vitest run packages/mock/tests/key-violation.test.ts
```

기대: `../src/key-violation.js` 파일이 없어서 **import 단계에서 실패**한다.

> `pnpm --filter @ohmymcp/mock test` 를 쓰지 마라. `packages/mock/package.json` 에는 `test` 스크립트가 **없어서** 아무것도 안 하고 성공한다 (`CLAUDE.local.md` §2 첫 줄).

- [ ] **Step 3: 판정을 구현한다**

`packages/mock/src/key-violation.ts` 를 새로 만든다. 파일 머리에 다음 주석을 둔다.

```ts
/**
 * 매칭 키로 만들 수 없는 인자를 가려내는 계층.
 *
 * `index.ts` 에서 떼어낸 이유가 둘이다. 하나는 테스트가 판정 함수를 직접 부르려면 export 가
 * 필요한데 `index.ts` 는 패키지 진입점이라 그것이 곧 공개 API 가 되기 때문이고, 다른 하나는
 * 키 규칙이 한 덩어리로 같이 바뀌기 때문이다.
 *
 * 거부 집합은 `record` 의 `stableStringify`(ADR-0003)와 같다. 두 패키지가 같은 인자에 다른
 * 판정을 내리면 사용자가 혼란스럽다. 다만 `record` 는 키를 SHA-256 으로 해시하고 목은 하지
 * 않는다 — 목의 키는 파일에 남지 않고 실패 메시지에 그대로 찍히기 때문이다.
 */
```

이어서 아래를 넣는다.

```ts
/**
 * 매칭 키를 만들 때 허용하는 최대 중첩 깊이. 루트가 깊이 0 이다.
 *
 * 재귀인 `stableKey` 는 4000 단계쯤에서 스택이 터진다(측정값). 상한을 실패 지점 가까이
 * 두면 Node 버전과 스택 여유에 따라 흔들리므로 충분히 멀리 잡았다.
 * 상한을 없애려면 `record` 의 `stableStringify` 처럼 명시적 프레임 스택으로 다시 써야 한다 —
 * 그것이 업그레이드 경로다. 지금은 "프로세스가 읽을 수 없는 오류로 죽는 것" 만 닫는다.
 */
export const MAX_KEY_DEPTH = 512;

/**
 * `stableKey` 로 키를 만들 수 없는 값. 판별 유니온이라 문장이 쓰는 필드가
 * `kind` 마다 정확히 하나로 정해진다 — 없는 필드를 참조할 수 없다.
 *
 * `path` 는 루트가 `"args"`, 중첩은 `args.items[2].when`.
 * `tooDeep` 에는 `path` 가 없다. 512 단계짜리 경로는 문장에 넣을 수 없다.
 */
export type KeyViolation =
  | { kind: "circular"; path: string }
  | { kind: "sparse"; path: string }
  | { kind: "nonFinite"; path: string; found: string }
  | { kind: "notJson"; path: string; found: string }
  | { kind: "tooDeep"; depth: number };

/** plain object 인가. `Date` · `Map` · 클래스 인스턴스를 거른다. */
function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** 문장에 넣을 짧은 표기. */
function describeValue(value: unknown): string {
  if (typeof value === "number") return String(value); // NaN · Infinity
  if (typeof value === "function") return "function";
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "bigint") return "bigint";
  return (value as object)?.constructor?.name ?? "알 수 없는 값";
}

/**
 * 키로 만들 수 없는 값을 찾는다. 없으면 `undefined`.
 *
 * 던지지 않는 순수 함수다 — 판정과 문장을 분리해야 판정을 표로 전량 고정할 수 있다.
 * 거부 집합은 `record` 의 `stableStringify`(ADR-0003)와 같다. 두 패키지가 같은 인자에
 * 다른 판정을 내리면 사용자가 혼란스럽다.
 */
export function findKeyViolation(value: unknown): KeyViolation | undefined {
  // 조상 집합. 형제가 같은 객체를 참조하는 것은 순환이 아니므로 빠져나올 때 지운다.
  const active = new Set<object>();

  function walk(current: unknown, path: string, depth: number): KeyViolation | undefined {
    if (depth > MAX_KEY_DEPTH) return { kind: "tooDeep", depth };
    if (current === undefined || current === null) return undefined;
    if (typeof current === "boolean" || typeof current === "string") return undefined;
    if (typeof current === "number") {
      return Number.isFinite(current)
        ? undefined
        : { kind: "nonFinite", path, found: describeValue(current) };
    }
    if (typeof current !== "object" || (!Array.isArray(current) && !isPlainObject(current))) {
      return { kind: "notJson", path, found: describeValue(current) };
    }
    if (active.has(current)) return { kind: "circular", path };

    active.add(current);
    try {
      if (Array.isArray(current)) {
        for (let i = 0; i < current.length; i++) {
          if (!Object.hasOwn(current, i)) return { kind: "sparse", path: `${path}[${i}]` };
          const found = walk(current[i], `${path}[${i}]`, depth + 1);
          if (found) return found;
        }
        return undefined;
      }
      const obj = current as Record<string, unknown>;
      for (const key of Object.keys(obj).sort()) {
        if (obj[key] === undefined) continue; // stableKey 와 같은 규칙
        const found = walk(obj[key], `${path}.${key}`, depth + 1);
        if (found) return found;
      }
      return undefined;
    } finally {
      active.delete(current);
    }
  }

  return walk(value, "args", 0);
}
```

- [ ] **Step 4: 통과하는 것을 확인한다**

```bash
npx vitest run packages/mock/tests/key-violation.test.ts
```

기대: `Test Files 1 passed`, `Tests 16 passed`.

- [ ] **Step 5: 공개 API 가 안 늘었는지 확인한다**

`src/key-violation.ts` 의 export 는 모듈 내부용이다. `index.ts` 를 안 건드렸으므로 패키지 진입점의 export 목록이 그대로여야 한다.

```bash
git diff -- packages/mock/src/index.ts
```

기대: **출력 없음.** 이 태스크는 `index.ts` 를 건드리지 않는다.

- [ ] **Step 6: 검사 명령 전부**

```bash
npx vitest run packages/mock && npx biome check packages/mock && (cd packages/mock && npx tsc --noEmit)
```

기대: 테스트 통과, `Checked N files ... No fixes applied`, tsc 무출력.

- [ ] **Step 7: 커밋 요청 (사람이 실행)**

변경 파일: `packages/mock/src/key-violation.ts`(신규), `packages/mock/tests/key-violation.test.ts`(신규)

```
feat(mock): 매칭 키를 만들 수 없는 값을 찾는 판정 함수 추가
```

사람이 만든 SHA 를 확인한 뒤 Task 2 를 시작한다.

---

## Task 2: 문장 계층

**Files:**
- Modify: `packages/mock/src/key-violation.ts` — `findKeyViolation` 바로 아래
- Test: `packages/mock/tests/key-violation.test.ts` — describe 블록 추가

**Interfaces:**
- Consumes: `KeyViolation`, `findKeyViolation`, `MAX_KEY_DEPTH` (Task 1)
- Produces: `keyViolationMessage(violation: KeyViolation, source: string): string`, `assertKeyable(value: unknown, source: string): void`

- [ ] **Step 1: 문장 전문을 고정하는 테스트를 쓴다**

`key-violation.test.ts` 하단에 붙인다. import 를 `import { assertKeyable, findKeyViolation, MAX_KEY_DEPTH } from "../src/key-violation.js";` 로 늘린다.

```ts
describe("assertKeyable — 문장 전문", () => {
  const source = "mock.on('add', ...)";

  it("순환 참조", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => assertKeyable(circular, source)).toThrow(
      [
        "→ mock.on('add', ...) 의 인자로 매칭 키를 만들 수 없습니다: 순환 참조",
        "→ 위치: args.self",
        "→ JSON 에는 순환 참조가 없어서 이 주입은 어떤 호출과도 맞지 않습니다. 참조를 끊고 값을 펼쳐 넘기세요.",
      ].join("\n"),
    );
  });

  it("희소 배열", () => {
    expect(() => assertKeyable({ items: [1, , 3] }, source)).toThrow(
      [
        "→ mock.on('add', ...) 의 인자로 매칭 키를 만들 수 없습니다: 희소 배열",
        "→ 위치: args.items[1] — 비어 있는 자리",
        "→ 와이어를 건너오면 빈 자리가 null 로 채워집니다. 빈 자리에 null 을 명시하세요.",
      ].join("\n"),
    );
  });

  it("유한하지 않은 수", () => {
    expect(() => assertKeyable({ n: NaN }, source)).toThrow(
      [
        "→ mock.on('add', ...) 의 인자로 매칭 키를 만들 수 없습니다: 유한하지 않은 수",
        "→ 위치: args.n — 발견: NaN",
        "→ JSON 에는 NaN · Infinity 가 없습니다. 유한한 수를 쓰거나 그 상태를 나타내는 문자열을 쓰세요.",
      ].join("\n"),
    );
  });

  it("JSON 으로 표현할 수 없는 값", () => {
    expect(() => assertKeyable({ when: new Date(0) }, source)).toThrow(
      [
        "→ mock.on('add', ...) 의 인자로 매칭 키를 만들 수 없습니다: JSON 으로 표현할 수 없는 값",
        "→ 위치: args.when — 발견: Date",
        "→ 매칭 키가 되는 것은 객체 · 배열 · 문자열 · 유한한 수 · 불리언 · null 뿐입니다. 직렬화한 값으로 바꿔 넘기세요 (예: Date → toISOString()).",
      ].join("\n"),
    );
  });

  it("너무 깊은 중첩", () => {
    expect(() => assertKeyable(nest(MAX_KEY_DEPTH + 2), source)).toThrow(
      [
        "→ mock.on('add', ...) 의 인자로 매칭 키를 만들 수 없습니다: 중첩이 너무 깊습니다",
        `→ 위치: 깊이 ${MAX_KEY_DEPTH + 1} — 상한: ${MAX_KEY_DEPTH}`,
        "→ 목에 넘기는 인자는 테스트가 읽을 수 있는 크기여야 합니다. 필요한 필드만 넘기세요.",
      ].join("\n"),
    );
  });

  it("정의 파일 경로는 진입점 표기만 바뀐다", () => {
    expect(() => assertKeyable({ n: NaN }, "정의 파일의 responses[0]")).toThrow(
      "→ 정의 파일의 responses[0] 의 인자로 매칭 키를 만들 수 없습니다: 유한하지 않은 수",
    );
  });

  it("문제가 없으면 던지지 않는다", () => {
    expect(() => assertKeyable({ a: 1, b: undefined }, source)).not.toThrow();
  });
});
```

- [ ] **Step 2: 실패하는 것을 확인한다**

```bash
npx vitest run packages/mock/tests/key-violation.test.ts
```

기대: `assertKeyable` 이 없어서 import 실패.

- [ ] **Step 3: 문장을 구현한다**

`findKeyViolation` 바로 아래에 넣는다.

```ts
/**
 * 위반을 사람이 읽는 문장으로 바꾼다. 실패 메시지가 곧 제품이다 (CLAUDE.md).
 *
 * 변하는 값(`path` · `found`) 뒤에 조사를 붙이지 않는다. 받침 유무가 갈려서
 * 어느 쪽으로 고정해도 한쪽이 틀린다 — `docs/reports/task-b6.md` 에서 모델 이름으로
 * 같은 문제를 겪고 내린 결론이다. 그래서 값은 전부 콜론이나 대시 뒤에 둔다.
 */
function keyViolationMessage(violation: KeyViolation, source: string): string {
  const head = `→ ${source} 의 인자로 매칭 키를 만들 수 없습니다`;
  switch (violation.kind) {
    case "circular":
      return [
        `${head}: 순환 참조`,
        `→ 위치: ${violation.path}`,
        "→ JSON 에는 순환 참조가 없어서 이 주입은 어떤 호출과도 맞지 않습니다. 참조를 끊고 값을 펼쳐 넘기세요.",
      ].join("\n");
    case "sparse":
      return [
        `${head}: 희소 배열`,
        `→ 위치: ${violation.path} — 비어 있는 자리`,
        "→ 와이어를 건너오면 빈 자리가 null 로 채워집니다. 빈 자리에 null 을 명시하세요.",
      ].join("\n");
    case "nonFinite":
      return [
        `${head}: 유한하지 않은 수`,
        `→ 위치: ${violation.path} — 발견: ${violation.found}`,
        "→ JSON 에는 NaN · Infinity 가 없습니다. 유한한 수를 쓰거나 그 상태를 나타내는 문자열을 쓰세요.",
      ].join("\n");
    case "notJson":
      return [
        `${head}: JSON 으로 표현할 수 없는 값`,
        `→ 위치: ${violation.path} — 발견: ${violation.found}`,
        "→ 매칭 키가 되는 것은 객체 · 배열 · 문자열 · 유한한 수 · 불리언 · null 뿐입니다. 직렬화한 값으로 바꿔 넘기세요 (예: Date → toISOString()).",
      ].join("\n");
    case "tooDeep":
      return [
        `${head}: 중첩이 너무 깊습니다`,
        `→ 위치: 깊이 ${violation.depth} — 상한: ${MAX_KEY_DEPTH}`,
        "→ 목에 넘기는 인자는 테스트가 읽을 수 있는 크기여야 합니다. 필요한 필드만 넘기세요.",
      ].join("\n");
  }
}

/**
 * 주입 경로 전용. 키로 만들 수 없는 값이면 던진다.
 *
 * `source` 는 문장에 들어갈 진입점 표기다 — `mock.on('add', ...)` 또는
 * `정의 파일의 responses[0]`. 툴 이름을 따로 받지 않는 이유는 `source` 가 이미 담고 있어
 * 두 인자가 어긋날 여지만 생기기 때문이다.
 */
export function assertKeyable(value: unknown, source: string): void {
  const violation = findKeyViolation(value);
  if (violation !== undefined) throw new Error(keyViolationMessage(violation, source));
}
```

- [ ] **Step 4: 통과하는 것을 확인한다**

```bash
npx vitest run packages/mock/tests/key-violation.test.ts
```

기대: `Tests 23 passed`.

- [ ] **Step 5: 역검증 — 판정을 빼고 실패를 본다**

`assertKeyable` 본문을 잠시 `return;` 한 줄로 바꾸고 돌린다.

```bash
npx vitest run packages/mock/tests/key-violation.test.ts
```

기대: 문장 테스트 6 건이 "던지지 않음" 으로 실패한다. **실패를 눈으로 본 뒤** 원래대로 되돌린다. 통과만 보고 넘기면 아무것도 검증하지 않는 테스트가 섞인다 (`CLAUDE.local.md` §2 마지막 줄).

- [ ] **Step 6: 검사 명령 전부**

```bash
npx vitest run packages/mock && npx biome check packages/mock && (cd packages/mock && npx tsc --noEmit)
```

- [ ] **Step 7: 커밋 요청 (사람이 실행)**

변경 파일: `packages/mock/src/key-violation.ts`, `packages/mock/tests/key-violation.test.ts`

```
feat(mock): 매칭 키 위반을 사람이 읽는 문장으로 바꾸는 계층 추가
```

---

## Task 3: 주입 경로 배선

**Files:**
- Modify: `packages/mock/src/index.ts` — `put` (87-90줄), `seed` (179-185줄), `createMockServer` 의 `on` (251-253줄)
- Test: `packages/mock/tests/index.test.ts`

**Interfaces:**
- Consumes: `assertKeyable` (Task 2)
- Produces: `put(registry, tool, args, result, source)` — 인자 5 개로 확장

- [ ] **Step 1: 배선 테스트를 쓴다**

`packages/mock/tests/index.test.ts` 의 `describe("@ohmymcp/mock")` 블록 안, 마지막 `it` 뒤에 붙인다.

```ts
  it("키로 만들 수 없는 인자를 주입하면 진입점과 위치를 알려준다", async () => {
    const server = await start();
    expect(() => server.on("add", { a: 1, b: NaN }, { sum: 1 })).toThrow(
      "→ mock.on('add', ...) 의 인자로 매칭 키를 만들 수 없습니다: 유한하지 않은 수",
    );
    expect(() => server.on("add", { a: 1, b: NaN }, { sum: 1 })).toThrow("→ 위치: args.b — 발견: NaN");
  });

  it("ANY 는 심볼이지만 거부되지 않는다", async () => {
    const server = await start();
    expect(() => server.on("add", ANY, { sum: 0 })).not.toThrow();
    const client = await connect(server);

    const result = await client.callTool({ name: "add", arguments: { a: 7, b: 7 } });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toEqual({ sum: 0 });

    await client.close();
  });

  it("인자 지정본이 ANY 보다 우선한다", async () => {
    const server = await start();
    server.on("add", ANY, { sum: 0 });
    server.on("add", { a: 1, b: 2 }, { sum: 3 });
    const client = await connect(server);

    expect(JSON.parse(text(await client.callTool({ name: "add", arguments: { a: 1, b: 2 } })))).toEqual({ sum: 3 });
    expect(JSON.parse(text(await client.callTool({ name: "add", arguments: { a: 9, b: 9 } })))).toEqual({ sum: 0 });

    await client.close();
  });

  it("정의 파일의 responses 도 같은 판정을 받는다", async () => {
    await expect(
      createMockServer({ tools, responses: [{ tool: "add", args: { a: NaN }, result: { sum: 0 } }] }),
    ).rejects.toThrow("→ 정의 파일의 responses[0] 의 인자로 매칭 키를 만들 수 없습니다: 유한하지 않은 수");
  });
```

파일 상단 import 에 `ANY` 를 추가한다.

```ts
import { ANY, createMockServer, type MockServer } from "../src/index.js";
```

- [ ] **Step 2: 실패하는 것을 확인한다**

```bash
npx vitest run packages/mock/tests/index.test.ts
```

기대: 4 건 중 3 건 실패 — `on` 이 던지지 않고, 정의 파일 경로도 던지지 않는다. `ANY` 관련 2 건은 이미 통과한다(회귀 방지용이라 지금은 초록이 맞다).

- [ ] **Step 3: 배선한다**

먼저 `packages/mock/src/index.ts` 의 import 블록 끝에 한 줄을 넣는다. **확장자가 `.ts` 다** — 이유는 아래 "raw node 제약" 참조.

```ts
import { assertKeyable } from "./key-violation.ts";
```

`put` 을 바꾼다 (현재 87-90줄).

```ts
function put(
  registry: Registry,
  tool: string,
  args: unknown,
  result: unknown,
  source: string,
): void {
  // ANY 는 Symbol.for(...) 라서 assertKeyable 의 notJson 에 걸린다.
  // 검사를 이 분기보다 앞에 두면 정상 기능이 죽는다.
  if (args === ANY) {
    registry.any.set(tool, result);
    return;
  }
  assertKeyable(args ?? {}, source);
  registry.exact.set(`${tool}|${stableKey(args ?? {})}`, result);
}
```

`seed` 를 바꾼다 (현재 179-185줄).

```ts
function seed(definition: MockDefinition): Registry {
  const registry = createRegistry();
  const responses = definition.responses ?? [];
  for (const [index, r] of responses.entries()) {
    put(registry, r.tool, "args" in r ? r.args : ANY, r.result, `정의 파일의 responses[${index}]`);
  }
  return registry;
}
```

`createMockServer` 가 돌려주는 `on` 을 바꾼다 (현재 251-253줄).

```ts
    on(tool, args, result) {
      put(registry, tool, args, result, `mock.on('${tool}', ...)`);
    },
```

- [ ] **Step 4: 통과하는 것을 확인한다**

```bash
npx vitest run packages/mock
```

기대: `Test Files 3 passed`. `index.test.ts` 의 기존 8 건이 모두 그대로 통과해야 한다 — 특히 **#69 에서 넣은 "값이 undefined 인 키는 없는 것으로 친다"** 가 초록이어야 한다.

- [ ] **Step 5: 역검증 — `ANY` 순서를 뒤집어 본다**

`put` 에서 `assertKeyable` 호출을 `if (args === ANY)` 분기 **위**로 옮기고 돌린다.

```bash
npx vitest run packages/mock/tests/index.test.ts
```

기대: `ANY` 관련 테스트가 `notJson ... 발견: symbol` 로 실패한다. **이 실패를 눈으로 본 뒤** 원래 순서로 되돌린다. 이것이 이 태스크에서 가장 깨지기 쉬운 지점이다.

- [ ] **Step 6: 검사 명령 전부**

```bash
npx vitest run packages/mock && npx biome check packages/mock && (cd packages/mock && npx tsc --noEmit)
```

- [ ] **Step 7: 커밋 요청 (사람이 실행)**

변경 파일: `packages/mock/src/index.ts`, `packages/mock/tests/index.test.ts`

```
feat(mock): 주입 시점에 매칭 키로 만들 수 없는 인자를 거부

mock.on() 과 정의 파일 responses 양쪽에 같은 판정을 건다. ANY 는 심볼이라
검사보다 앞에서 갈라낸다.
```

---

## Task 4: 조회 경로 깊이 상한

**Files:**
- Modify: `packages/mock/src/key-violation.ts` — `KeyDepthError` 추가
- Modify: `packages/mock/src/index.ts` — import 확장, `stableKey` (66-75줄), `missMessage` 아래, `buildServer` 의 CallTool 핸들러 (194-205줄)
- Test: `packages/mock/tests/index.test.ts`

**Interfaces:**
- Consumes: `MAX_KEY_DEPTH` (Task 1)
- Produces: `class KeyDepthError` (`key-violation.ts` 에서 export), `stableKey(value, depth?)`

- [ ] **Step 1: 조회 깊이 테스트를 쓴다**

`index.test.ts` 에 붙인다.

```ts
  it("너무 깊은 호출 인자는 서버를 죽이지 않고 오류 응답이 된다", async () => {
    const server = await start();
    server.on("add", { a: 1, b: 2 }, { sum: 3 });
    const client = await connect(server);

    // 루트가 깊이 0. 상한을 넘기려면 상한 + 2 단계가 필요하다.
    let deep: unknown = null;
    for (let i = 0; i < 514; i++) deep = { a: deep };

    const result = await client.callTool({ name: "add", arguments: { deep } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("→ 툴 'add' 의 호출 인자로 매칭 키를 만들 수 없습니다: 중첩이 너무 깊습니다");
    expect(text(result)).toContain("→ 목은 이 인자를 주입된 어떤 응답과도 비교할 수 없습니다. 호출 쪽 인자를 줄이세요.");

    // 서버가 살아 있어야 한다 — 이 갈래를 만든 이유가 그것이다.
    const after = await client.callTool({ name: "add", arguments: { a: 1, b: 2 } });
    expect(after.isError).toBeFalsy();
    expect(JSON.parse(text(after))).toEqual({ sum: 3 });

    await client.close();
  });
```

- [ ] **Step 2: 실패하는 것을 확인한다**

```bash
npx vitest run packages/mock/tests/index.test.ts
```

기대: `RangeError: Maximum call stack size exceeded` 또는 프로토콜 오류로 실패한다. **지금은 이것이 정상이다.**

- [ ] **Step 3: `stableKey` 에 깊이를 넣는다**

먼저 `packages/mock/src/key-violation.ts` 하단에 예외 클래스를 넣는다. 상한 상수와 같은 파일에
둬야 둘이 갈리지 않는다.

```ts
/** 조회 경로에서 깊이 상한을 넘었을 때. 핸들러가 잡아 isError 응답으로 바꾼다. */
class KeyDepthError extends Error {
  constructor(readonly depth: number) {
    super(`중첩이 너무 깊습니다 (깊이 ${depth}, 상한 ${MAX_KEY_DEPTH})`);
    this.name = "KeyDepthError";
  }
}
```

그리고 `index.ts` 의 import 를 늘린다. 확장자는 `.ts` 를 유지한다.

```ts
import { assertKeyable, KeyDepthError, MAX_KEY_DEPTH } from "./key-violation.ts";
```

`stableKey` 를 바꾼다. **`value.map(stableKey)` 를 그대로 두면 안 된다** — `map` 이 두 번째 인자로 **배열 인덱스**를 넘기므로 그것이 `depth` 로 들어간다. 반드시 화살표로 감싼다.

```ts
function stableKey(value: unknown, depth = 0): string {
  if (depth > MAX_KEY_DEPTH) throw new KeyDepthError(depth);
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => stableKey(v, depth + 1)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableKey(obj[k], depth + 1)}`)
    .join(",")}}`;
}
```

- [ ] **Step 4: 핸들러가 잡게 한다**

`buildServer` 의 CallTool 핸들러(현재 194-205줄)를 바꾼다.

```ts
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    let outcome: { hit: boolean; result: unknown };
    try {
      outcome = lookup(registry, req.params.name, req.params.arguments);
    } catch (error) {
      // KeyDepthError 만 응답으로 바꾼다. 다른 예외를 삼키면 목의 버그가 조용히 묻힌다.
      if (!(error instanceof KeyDepthError)) throw error;
      return {
        content: [{ type: "text", text: depthMissMessage(req.params.name, error) }],
        isError: true,
      };
    }
    if (!outcome.hit) {
      return {
        content: [
          { type: "text", text: missMessage(req.params.name, req.params.arguments, registry) },
        ],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(outcome.result) }] };
  });
```

`missMessage` 바로 아래에 문장 함수를 넣는다.

```ts
/** 조회 인자가 너무 깊어 키를 못 만들 때. 던지지 않고 응답으로 나간다. */
function depthMissMessage(tool: string, error: KeyDepthError): string {
  return [
    `→ 툴 '${tool}' 의 호출 인자로 매칭 키를 만들 수 없습니다: 중첩이 너무 깊습니다 (깊이 ${error.depth}, 상한 ${MAX_KEY_DEPTH})`,
    "→ 목은 이 인자를 주입된 어떤 응답과도 비교할 수 없습니다. 호출 쪽 인자를 줄이세요.",
  ].join("\n");
}
```

- [ ] **Step 5: 통과하는 것을 확인한다**

```bash
npx vitest run packages/mock
```

기대: `Test Files 3 passed`. 기존 결정론성 테스트("같은 호출 3회가 바이트 단위로 동일하다")가 그대로 초록이어야 한다 — `map` 트랩을 밟았다면 여기서 키가 달라져 깨진다.

- [ ] **Step 6: `map` 트랩을 직접 확인한다**

`stableKey` 의 배열 분기를 `value.map(stableKey)` 로 잠시 되돌리고 돌린다.

```bash
npx vitest run packages/mock/tests/index.test.ts
```

기대: 배열을 쓰는 케이스에서 키가 어긋나 실패한다. **실패를 본 뒤** 화살표 버전으로 되돌린다.

- [ ] **Step 7: 검사 명령 전부**

```bash
npx vitest run packages/mock && npx biome check packages/mock && (cd packages/mock && npx tsc --noEmit)
```

- [ ] **Step 8: 커밋 요청 (사람이 실행)**

변경 파일: `packages/mock/src/key-violation.ts`, `packages/mock/src/index.ts`, `packages/mock/tests/index.test.ts`

```
fix(mock): 깊게 중첩된 호출 인자가 목 서버를 죽이던 문제 해결

stableKey 에 깊이 상한을 두고, 조회 경로에서는 예외 대신 isError 응답으로
바꾼다. 목은 테스트 대상 프로세스라 죽으면 테스트 전체가 무너진다.
```

---

## Task 5: 문서와 릴리스

**Files:**
- Create: `.changeset/mock-key-normalization.md`
- Modify: `packages/mock/README.md` — "응답 매칭 규칙" 절 아래
- Create: `docs/adr/NNNN-목-매칭-키-정규화-경계.md`

**Interfaces:**
- Consumes: Task 1-4 의 동작 전부
- Produces: 없음

- [ ] **Step 1: ADR 번호를 확인한다**

```bash
git fetch origin main && git ls-tree -r origin/main --name-only docs/adr | sed 's|.*/||' | grep -o '^[0-9]\{4\}' | sort -u | tail -3
```

가장 큰 번호 + 1 을 쓴다. **하드코딩하지 마라** — 이 계획을 쓰는 사이에도 0019 에서 0024 까지 늘었고, 이미 `0007` 이 두 개다.

- [ ] **Step 2: ADR 을 쓴다**

CONTRIBUTING §8 의 다섯 항목(배경 / 선택지 / 결정 / 이유 / 결과)으로 쓴다. 담을 판단 세 가지:

1. **`record` 처럼 해시 키로 가지 않는다.** ADR-0003 이 `matchKey` 를 SHA-256 hex 로 정한 이유는 결정론성이 아니라 **비밀값 누출** 이다 — 카세트는 파일로 남고 키 문자열은 `redact()` 를 거치지 않는다. `mock` 의 키는 디스크에 가지 않으므로 그 구멍이 없고, 반대로 키가 **실패 메시지에 그대로 찍히는 사용자 화면**이다. 해시로 바꾸면 `→ 이 툴에 주입된 인자: 3f2a9c...` 가 되어 "실패 메시지가 곧 제품" 에 어긋난다. 정규화는 공유하고 직렬화는 다르게 둔다.
2. **검사를 두 곳에 나눈다.** 네 부류는 와이어로 도달 불가라 주입 경로에서, 깊이는 도달 가능하라 공유 경로에서 막는다.
3. **깊이는 상한으로 막고 반복문 재작성을 미룬다.** `record` 의 프레임 스택 40 여 줄 대비 `mock` 은 8 줄이다. 고칠 값어치가 있는 것은 "4000 단계 지원" 이 아니라 "읽을 수 없는 오류로 죽는 것" 이다.

상태는 `제안`, 작성자는 `@storyrago (③ mock server 파트)`.

- [ ] **Step 3: README 를 갱신한다**

`packages/mock/README.md` 의 "응답 매칭 규칙" 절 끝에 붙인다.

```markdown
### 키로 만들 수 없는 인자

아래는 주입 시점에 거부됩니다. MCP 호출은 JSON 으로 오므로 **어떤 호출로도 도달할 수 없는
값**이고, 그대로 두면 주입은 성공한 것처럼 보이는데 영영 안 맞거나 다른 주입과 같은 키가 됩니다.

| 값 | 예 |
|---|---|
| 순환 참조 | `o.self = o` |
| 희소 배열 | `[1, , 3]` |
| `NaN` · `Infinity` | `{ n: NaN }` |
| JSON 이 아닌 값 | `Date` · 함수 · 심볼 · `BigInt` · `Map` |

`undefined` 는 거부하지 않습니다 — 객체 프로퍼티면 빼고, 배열 원소면 `null` 로 둡니다.

중첩 깊이 상한은 512 입니다. 호출 인자가 이를 넘으면 서버를 죽이지 않고 `isError: true`
응답으로 알려줍니다.

거부 집합은 `record` 의 카세트 매칭 키(ADR-0003)와 같습니다. 다만 `record` 는 키를 SHA-256 으로
해시하고 목은 하지 않습니다 — 목의 키는 파일에 남지 않고 실패 메시지에 그대로 찍히기 때문입니다.
```

- [ ] **Step 4: changeset 을 쓴다**

`.changeset/mock-key-normalization.md`:

```markdown
---
"@ohmymcp/mock": minor
---

mock: 매칭 키로 만들 수 없는 인자를 주입 시점에 거부한다. 순환 참조 · 희소 배열 · `NaN` · `Infinity` · `Date` · 함수처럼 JSON 으로 표현할 수 없는 값은 어떤 호출로도 도달할 수 없어, 그대로 두면 주입이 영영 안 맞거나(희소 배열) 서로 다른 주입이 같은 키가 되어 엉뚱한 응답이 나갔다(`NaN` 과 `Infinity` 가 둘 다 `null`). 거부 집합은 `record` 의 카세트 매칭 키(ADR-0003)와 같게 맞췄다. 또한 깊게 중첩된 호출 인자가 스택을 터뜨려 목 서버 프로세스를 죽이던 문제를 고친다 — 깊이 512 를 넘으면 `isError: true` 응답으로 알린다.
```

**breaking change 라 minor 다.** `@ohmymcp/mock` 은 `0.1.2` → `0.2.0` 이 된다. CONTRIBUTING §7 상 0.x 에서 허용되지만 CHANGELOG 에 반드시 남긴다.

- [ ] **Step 5: 저장소 전체 게이트**

```bash
pnpm install && pnpm build && pnpm typecheck && pnpm lint && npx vitest run && pnpm --filter ohmymcp test:e2e
```

기대: `Test Files N passed`, `Tasks: 6 successful`, e2e 는 파이프 없이 `echo $?` 가 `0`.

- [ ] **Step 6: 커밋 요청 (사람이 실행)**

변경 파일: `.changeset/mock-key-normalization.md`, `packages/mock/README.md`, `docs/adr/NNNN-*.md`

```
docs(mock): 매칭 키 정규화 경계 문서화와 changeset
```

---

## 의존성과 웨이브

```
T1 판정 → T2 문장 → T3 주입 배선 → T4 조회 깊이 → T5 문서·릴리스
```

**전부 직렬이다.** 다섯 태스크가 모두 `packages/mock/src/index.ts` 한 파일을 만지므로 병렬로 돌리면 충돌만 난다. 웨이브 사이에는 **사람이 만든 통합 SHA** 를 확인한 뒤 다음으로 넘어간다 (`CLAUDE.local.md` §3).

실제 프로세스를 띄우는 E2E 를 새로 추가하지 않으므로 직렬 전용 웨이브 분리는 해당하지 않는다.

## 모델 배분

`CLAUDE.local.md` §1 의 표를 따른다.

| 태스크 | 모델 | 추론 | 근거 |
|---|---|---|---|
| 오케스트레이터 (메인 세션) | 상위 | 높음 | 리뷰 · 통합 게이트 |
| T1 | 표준 | 보통 | 거부 집합과 판정 술어가 설계 §3 에 전량으로 적혀 있다 |
| T2 | 표준 | 보통 | 문장 6 종이 설계 §6 에 전문으로 고정돼 있다. 문안 **설계**는 이미 끝났고 옮겨 적는 작업이다 |
| T3 | 표준 | 보통 | 배선 코드가 설계 §4.1 에 그대로 있다 |
| T4 | 표준 | 보통 | 핸들러 처리 방식이 설계 §4.2 에 적혀 있다 |
| T5 | 표준 | 보통 | 이미 내린 판단을 문서로 옮기는 작업 (ADR 작성은 승급 대상이 아니다) |
| 최종 계약 · 회귀 검토 | 상위 | 높음 | 공개 API 불변과 #69 회귀를 함께 본다 |

상위 모델 예외 목록에 걸리는 태스크가 없다. "실패 메시지 문안 설계" 는 예외 1 번이지만, **설계 단계에서 이미 문장을 확정했으므로** 구현은 전량 지정된 작업이다.

## 사람 몫 사전 조건

1. 브랜치를 판다 — `fix/mock-key-normalization` (CONTRIBUTING §4)
2. `main` 이 최신인지 확인한다 (`git fetch` 로 격차를 먼저 본다)
3. `pnpm install` 로 의존성을 맞춘다
4. 각 태스크 끝에서 커밋한다 — 에이전트는 커밋하지 않는다

## 통합 게이트

```bash
pnpm build && pnpm typecheck && pnpm lint && npx vitest run
pnpm --filter ohmymcp test:e2e; echo "e2e exit=$?"
```

추가로 확인한다.

- [ ] `packages/mock/src/index.ts` 에 `not implemented` 가 0 건
- [ ] 공개 API 가 그대로다 — `git diff origin/main -- packages/mock/src/index.ts | grep '^[-+]export'` 가 **아무것도 출력하지 않는다**. 새 심볼은 전부 `key-violation.ts` 에 있고 진입점에서 re-export 하지 않는다
- [ ] #69 회귀("값이 undefined 인 키는 없는 것으로 친다")가 초록이다
- [ ] `packages/cli/tests/fixtures/mock-definition.json` 이 여전히 통과한다 (E2E 4/4)

## 거짓 신호 점검

`CLAUDE.local.md` §2 중 이 작업에서 실제로 밟을 것들이다.

| 거짓 신호 | 이 작업에서의 모습 | 진실 기준 |
|---|---|---|
| 테스트 명령이 즉시 exit 0 | `pnpm --filter @ohmymcp/mock test` 는 **존재하지 않는 스크립트**다. `packages/mock/package.json` 에 `test` 가 없다 | `npx vitest run packages/mock` 을 쓰고 출력에 `Test Files ... passed` 가 있는지 본다 |
| 문장 테스트 녹색 | `toThrow(문자열)` 은 **부분 일치**다 — chai 가 `indexOf` 로 본다. 문장 뒤에 줄이 더 붙어도 통과하고, **전문을 통째로 넘겨도 마찬가지다** | `toThrow(new Error(전문))` 으로 넘겨 완전 일치를 건다. 실제로 고정됐는지는 문장 끝에 한 줄을 임시로 붙여 **실패를 본 뒤** 되돌려 확인한다 |
| 깊이 테스트 녹색 | 상한 계산을 틀려 실제로는 상한 아래를 넣었다 | 실패하는 깊이를 `MAX_KEY_DEPTH + 2` 로 쓰고, 상한과 같은 깊이가 **통과하는** 테스트를 짝으로 둔다 |
| 결정론성 테스트 녹색 | `value.map(stableKey)` 가 인덱스를 `depth` 로 넘기는데 얕은 배열이라 안 걸렸다 | T4 Step 6 에서 일부러 되돌려 실패를 본다 |
| 종료 코드가 0 으로 보임 | 파이프 뒤에서 `$?` 를 읽었다 | `cmd >/dev/null 2>&1; echo $?` |
| CI 초록이라 안전해 보임 | 목 경로를 타는 잡을 지목할 수 있어야 한다 | `build` 잡의 "Verify built CLI" 스텝이 `dist/stdio.mjs` 를 띄운다 |

## 롤백 경계

태스크마다 커밋이 하나씩이므로 되돌리기는 커밋 단위다.

- T4 만 되돌리면 깊이 상한이 사라지고 나머지는 남는다 (독립적이다)
- T3 을 되돌리면 T1 · T2 가 **호출되지 않는 코드**가 된다. 그 상태로 두지 말고 T1 · T2 도 함께 되돌린다
- T5 만 되돌리면 동작은 그대로이고 문서와 changeset 이 빠진다 — 릴리스 전에 반드시 복구한다
