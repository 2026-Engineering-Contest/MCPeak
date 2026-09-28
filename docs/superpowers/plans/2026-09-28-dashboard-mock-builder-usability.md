# 대시보드 "목 만들기" 사용 훑기 반영(U1–U7) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 목 만들기 화면이 "무엇을 어느 칸에 넣는지" 스스로 말하게 한다. 녹화본은 응답 카드 안에서 고르고, args 가 도구와 어긋나면 그 줄에서 말하고, 고친 뒤 떠나면 묻는다.

**Architecture:** args · 도구 점검은 순수 함수(`web/src/mock-builder/args-check.ts`)로 두고 `ResponseEditor` 가 부른다. 오른쪽 `RecordingPanel` 을 지우고, 응답 카드 안에 펼치는 `RecordingPicker` 로 바꾼다. 이탈 확인은 `web/src/leave-guard.ts` 의 모듈 하나가 화면(목 만들기)과 `App` 의 `hashchange` 처리 사이를 잇는다.

**Tech Stack:** TypeScript · React 19 · Vitest 4(jsdom, @testing-library/react)

**설계 문서:** `docs/superpowers/specs/2026-09-28-dashboard-mock-builder-design.md` §사용 훑기 반영 (U1–U7)
**시안:** https://claude.ai/artifact/56jXvSPfvJ5kEeZZ9j62eQ (U6)

## Global Constraints

- 작업 패키지: `dashboard` 하나. 서버(`packages/dashboard/src`)도 건드리지 않는다 — 웹(`packages/dashboard/web`)만.
- 의존 추가 금지. `web/` 은 `@mcpeak/mock` · `@mcpeak/record` 를 import 하지 않는다.
- `mock.json` 형식 · 저장 바이트를 바꾸지 않는다. 새 초안 필드 `recordedFrom` 은 화면 전용이라 저장 파일에 실리지 않는다.
- 결정론: 시각 · 랜덤 · `toLocale*` · 타이머를 쓰지 않는다.
- 문장은 설계 §사용 훑기 반영에 적힌 것 **그대로** 쓴다. 이 계획의 코드 블록이 그 문장을 옮겨 두었다.
- 문장 단언은 `toBe` / `toEqual` / `getByText("전문")` 으로 완전 일치를 건다. `toContain` · 정규식으로 문장 계약을 걸지 않는다(CLAUDE.local.md §2).
- 화면에서 테스트가 전문으로 찾는 문장은 JSX 보간으로 쪼개지 말고 **문자열 하나**로 렌더한다.
- 코드 블록은 biome 줄 폭을 다 맞추지 못했다. 태스크를 끝내기 전에 **자기 파일에만** `corepack pnpm biome format --write <파일>` 과 `corepack pnpm biome check <파일>` 을 돌린다.
- 로컬 Node 25 에서 웹 테스트가 localStorage 로 깨진다(작업 전부터). 웹 테스트 명령 앞에 `NODE_OPTIONS=--no-experimental-webstorage` 를 붙인다.
- 커밋은 메인 세션이 태스크 검토 뒤 경로를 하나씩 적어 한다. 자식 세션은 git 쓰기 명령을 쓰지 않는다. 워킹 트리의 `packages/mock/tests/stdio-e2e.test.ts` 와 `docs/2026-09-28-대시보드-목-만들기-세션-인수인계.md` 는 **커밋에 섞지 않는다.**

## 모델 배분 (CLAUDE.local.md §1)

문장 · 표시 판단은 설계에서 확정했다(사용자 확인 2026-09-28). 모든 태스크는 확정 문안을 옮기는 구현이라 **표준 모델**. 최종 계약 · 회귀 검토만 상위 모델.

## 확정한 판단 (설계가 계획에 넘긴 것)

| 항목 | 결정 | 이유 |
|---|---|---|
| args 채우기 값 | string `""` · number · integer `0` · boolean `false`, JSON 모드에서 타입을 모르면 `null`. 한 줄 JSON(`{"city":""}`) | 기존 테스트 · 화면이 한 줄 args 를 쓴다. |
| 채우는 때 | args 가 비었거나 `{}` 일 때만. 응답 줄의 도구를 고를 때와 [응답 추가] 때 | 사람이 적은 값은 덮지 않는다. |
| 점검 대상 도구 | 응답의 도구 이름(trim)과 같은 이름의 **첫** 도구 | 같은 이름 두 개는 저장 때 따로 걸린다. |
| 선택 창 | 한 번에 한 카드. 상태는 `MockBuilder` 의 `pickerAt: number \| null`. 응답을 지우면 닫는다 | 지운 뒤 번호가 밀려 다른 카드에서 열리는 것을 막는다. |
| 녹화본 목록 | 선택 창을 열 때마다 `GET /api/sessions` 를 다시 부른다(캐시 없음) | 로컬 서버라 싸다. 캐시는 무효화 규칙을 새로 만든다(YAGNI). |
| 출처 문장 | `${세션 경로} 의 ${ordinal + 1}번째 외부 호출에서 가져왔습니다.` 를 초안 `recordedFrom` 에 문장째 담는다 | `ordinal` 은 0부터다. 사람은 1부터 센다. |
| 이탈 되돌리기 | `App` 이 마지막으로 받아들인 해시를 ref 로 들고 있다가 `history.replaceState` 로 되돌린다 | `replaceState` 는 `hashchange` 를 다시 쏘지 않는다. `event.oldURL` 의 jsdom 지원에 기대지 않는다. |

## 남는 위험

- 되돌리기 뒤 브라우저 기록에 같은 해시가 두 번 남을 수 있다(사이드바 클릭은 새 항목을 쌓고, 되돌리기는 그것을 원래 해시로 바꾼다). 뒤로가기를 한 번 더 눌러야 할 뿐 내용은 잃지 않는다.
- `beforeunload` 경고 문장은 브라우저가 정한다. 테스트는 `defaultPrevented` 만 본다.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `web/src/mock-builder/args-check.ts` (신규) | 도구 입력 필드 읽기 · args 채우기 · args/도구 점검 문장 · 새 응답 |
| `web/src/mock-builder/draft.ts` (수정) | `recordedFrom` 필드, `pickedResult`. `PickedResponse` · `addPickedResponse` · `replaceResult` 삭제 |
| `web/src/mock-builder/ResponseEditor.tsx` (수정) | 도구 · args 점검 표시, 도구 고를 때 채우기, 녹화본 가져오기 버튼 · 출처 줄 |
| `web/src/mock-builder/RecordingPicker.tsx` (신규) | 카드 안 녹화본 선택 창 |
| `web/src/mock-builder/RecordingPanel.tsx` (삭제) | — |
| `web/src/leave-guard.ts` (신규) | 이탈 가드 모듈 · `useLeaveGuard` |
| `web/src/App.tsx` (수정) | `hashchange` 때 가드 확인 · 되돌리기 |
| `web/src/screens/MockBuilder.tsx` (수정) | 카드 머리 설명, `newResponseFor`, 선택 창 상태, 이탈 확인 줄 |
| `web/tests/args-check.test.ts` (신규) | 순수 함수 |
| `web/tests/mock-editors.test.tsx` (수정) | ResponseEditor 점검 · 채우기 |
| `web/tests/recording-picker.test.tsx` (신규) | 선택 창 |
| `web/tests/recording-panel.test.tsx` (삭제) | — |
| `web/tests/mock-draft.test.ts` (수정) | 지운 함수의 테스트 삭제, `pickedResult` |
| `web/tests/mock-builder.test.tsx` (수정) | 카드 머리 · 새 응답 채우기 · 카드 안 가져오기 |
| `web/tests/leave-guard.test.tsx` (신규) | App 수준 이탈 확인 |

경로는 모두 `packages/dashboard/` 기준이다.

---

### Task 1: args · 도구 점검 순수 함수 (U1 · U3 · U4)

**Files:**
- Create: `packages/dashboard/web/src/mock-builder/args-check.ts`
- Test: `packages/dashboard/web/tests/args-check.test.ts`

**Interfaces:**
- Consumes: `ToolDraft` · `ResponseDraft` · `newResponseDraft` · `isBlankResult`(`draft.ts`), `FIELD_TYPES` · `FieldType`(`schema-fields.ts`), `JsonValue`(`src/api-types.ts`)
- Produces:
  - `interface InputField { readonly name: string; readonly type: FieldType | null; readonly required: boolean }`
  - `inputFields(tool: ToolDraft): readonly InputField[] | null`
  - `findTool(tools: readonly ToolDraft[], name: string): ToolDraft | undefined`
  - `prefillArgs(response: ResponseDraft, tool: ToolDraft | undefined): ResponseDraft`
  - `newResponseFor(tools: readonly ToolDraft[]): ResponseDraft`
  - `toolProblem(tool: string, toolNames: readonly string[]): string | null`
  - `argsProblems(response: ResponseDraft, tools: readonly ToolDraft[]): readonly string[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// packages/dashboard/web/tests/args-check.test.ts
import { describe, expect, it } from "vitest";
import {
  argsProblems,
  inputFields,
  newResponseFor,
  prefillArgs,
  toolProblem,
} from "../src/mock-builder/args-check.js";
import { newResponseDraft, newToolDraft, type ToolDraft } from "../src/mock-builder/draft.js";

const weather: ToolDraft = {
  ...newToolDraft("get_weather"),
  fields: [
    { name: "city", type: "string", required: true },
    { name: "days", type: "integer", required: false },
  ],
};
const ping: ToolDraft = newToolDraft("ping");
const jsonTool: ToolDraft = {
  ...newToolDraft("search"),
  schemaMode: "json",
  schemaJson: JSON.stringify({
    type: "object",
    properties: { q: { type: "string" }, filter: { type: "object" } },
    required: ["q"],
  }),
};

const TAIL = "→ 도구에 입력 필드를 추가했거나 이름을 바꿨다면 args 도 같이 고치세요.";

describe("inputFields", () => {
  it("평면 폼은 이름이 빈 필드를 빼고 그대로 준다", () => {
    const tool = { ...weather, fields: [...weather.fields, { name: " ", type: "boolean" as const, required: false }] };
    expect(inputFields(tool)).toEqual([
      { name: "city", type: "string", required: true },
      { name: "days", type: "integer", required: false },
    ]);
  });

  it("JSON 모드는 properties · required 를 읽고, 모르는 타입은 null 이다", () => {
    expect(inputFields(jsonTool)).toEqual([
      { name: "q", type: "string", required: true },
      { name: "filter", type: null, required: false },
    ]);
  });

  it("JSON 을 읽을 수 없거나 properties 가 객체가 아니면 null 이다", () => {
    expect(inputFields({ ...jsonTool, schemaJson: "{" })).toBeNull();
    expect(inputFields({ ...jsonTool, schemaJson: '{"properties":[]}' })).toBeNull();
  });
});

describe("prefillArgs · newResponseFor", () => {
  it("args 가 {} 이면 입력 필드를 빈 값으로 채운다", () => {
    expect(prefillArgs(newResponseDraft("get_weather"), weather).argsJson).toBe('{"city":"","days":0}');
  });

  it("args 가 비어 있어도 채운다. 모르는 타입은 null 이다", () => {
    const blank = { ...newResponseDraft("search"), argsJson: "  " };
    expect(prefillArgs(blank, jsonTool).argsJson).toBe('{"q":"","filter":null}');
  });

  it("사람이 적은 args 는 덮지 않는다", () => {
    const written = { ...newResponseDraft("get_weather"), argsJson: '{"city":"Seoul"}' };
    expect(prefillArgs(written, weather)).toBe(written);
  });

  it("도구가 없거나 입력 필드가 없으면 그대로다", () => {
    const response = newResponseDraft("ping");
    expect(prefillArgs(response, undefined)).toBe(response);
    expect(prefillArgs(response, ping)).toBe(response);
  });

  it("새 응답은 이름이 있는 첫 도구로 만들고 채운다", () => {
    expect(newResponseFor([newToolDraft(""), weather])).toEqual({
      ...newResponseDraft("get_weather"),
      argsJson: '{"city":"","days":0}',
    });
    expect(newResponseFor([])).toEqual(newResponseDraft(""));
  });
});

describe("toolProblem", () => {
  it("비어 있으면 고르라고, 폼에 없으면 다시 고르라고 말한다", () => {
    expect(toolProblem(" ", ["get_weather"])).toBe("→ 어느 도구의 답인지 고르세요.");
    expect(toolProblem("get_weathr", ["get_weather"])).toBe(
      "→ 'get_weathr' 도구가 폼에 없습니다. 위 도구 목록에서 다시 고르세요.",
    );
    expect(toolProblem(" get_weather ", ["get_weather"])).toBeNull();
  });
});

describe("argsProblems", () => {
  const respond = (tool: string, argsJson: string) => ({ ...newResponseDraft(tool), argsJson });

  it("필수 입력이 빠지면 쓰이지 않는다고 말하고, 끝에 고칠 곳을 붙인다", () => {
    expect(argsProblems(respond("get_weather", "{}"), [weather])).toEqual([
      "→ args 에 get_weather 의 필수 입력 'city' 값이 없습니다. 목 서버가 이 호출을 인자 검사에서 거절하므로 이 응답은 쓰이지 않습니다.",
      TAIL,
    ]);
  });

  it("입력 필드에 없는 키는 있는 필드를 알려 준다", () => {
    expect(argsProblems(respond("get_weather", '{"city":"Seoul","town":"x"}'), [weather])).toEqual([
      "→ args 의 'town' 키는 get_weather 의 입력 필드에 없습니다. 입력 필드는 'city', 'days' 입니다.",
      TAIL,
    ]);
  });

  it("입력 필드가 없는 도구면 그렇게 말한다", () => {
    expect(argsProblems(respond("ping", '{"x":1}'), [ping])).toEqual([
      "→ args 의 'x' 키는 ping 의 입력 필드에 없습니다. 입력 필드가 없는 도구입니다.",
      TAIL,
    ]);
  });

  it("빠진 필수 입력을 먼저, 모르는 키를 args 순서로 적는다", () => {
    expect(argsProblems(respond("get_weather", '{"b":1,"a":2}'), [weather])).toEqual([
      "→ args 에 get_weather 의 필수 입력 'city' 값이 없습니다. 목 서버가 이 호출을 인자 검사에서 거절하므로 이 응답은 쓰이지 않습니다.",
      "→ args 의 'b' 키는 get_weather 의 입력 필드에 없습니다. 입력 필드는 'city', 'days' 입니다.",
      "→ args 의 'a' 키는 get_weather 의 입력 필드에 없습니다. 입력 필드는 'city', 'days' 입니다.",
      TAIL,
    ]);
  });

  it("맞으면 아무 말도 하지 않는다", () => {
    expect(argsProblems(respond("get_weather", '{"city":"Seoul"}'), [weather])).toEqual([]);
  });

  it.each([
    ["인자 무관", { ...respond("get_weather", "{}"), anyArgs: true }],
    ["폼에 없는 도구", respond("nope", "{}")],
    ["읽을 수 없는 args", respond("get_weather", "{")],
    ["객체가 아닌 args", respond("get_weather", "[]")],
    ["스키마를 못 읽는 JSON 모드", respond("search", "{}")],
  ])("%s 면 말하지 않는다", (_, response) => {
    expect(argsProblems(response, [weather, { ...jsonTool, schemaJson: "{" }])).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `NODE_OPTIONS=--no-experimental-webstorage corepack pnpm vitest run --project web packages/dashboard/web/tests/args-check.test.ts`
Expected: FAIL — `args-check.js` 를 찾을 수 없다.

- [ ] **Step 3: 구현한다**

```ts
// packages/dashboard/web/src/mock-builder/args-check.ts
import type { JsonValue } from "../../../src/api-types.js";
import { isBlankResult, newResponseDraft, type ResponseDraft, type ToolDraft } from "./draft.js";
import { FIELD_TYPES, type FieldType } from "./schema-fields.js";

/**
 * 응답 줄의 args 가 도구와 맞는지 그 줄에서 말한다(설계 §사용 훑기 반영 U1 · U3 · U4).
 *
 * 목 서버는 부를 때 인자를 `inputSchema` 로 먼저 검사한다(ADR-0048). 그래서 필수 입력이 빠진
 * args 를 적은 응답은 어떤 호출에도 쓰이지 않는다 — 그 입력 없이 부르면 검사에서 거절되고,
 * 넣고 부르면 args 가 달라 걸리지 않는다. 저장은 막지 않는다. 판단은 사람이 한다.
 */

/** 도구의 입력 필드 하나. JSON 모드에서 타입을 모르면 `null`. */
export interface InputField {
  readonly name: string;
  readonly type: FieldType | null;
  readonly required: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFieldType(value: unknown): value is FieldType {
  return typeof value === "string" && (FIELD_TYPES as readonly string[]).includes(value);
}

/** JSON 모드에서 `properties` 를 읽을 수 없으면 `null` — 그때는 아무 말도 하지 않는다. */
export function inputFields(tool: ToolDraft): readonly InputField[] | null {
  if (tool.schemaMode === "fields") {
    return tool.fields
      .filter((field) => field.name.trim() !== "")
      .map((field) => ({ name: field.name, type: field.type, required: field.required }));
  }
  let schema: unknown;
  try {
    schema = JSON.parse(tool.schemaJson);
  } catch {
    return null;
  }
  if (!isRecord(schema)) return null;
  const properties = schema.properties ?? {};
  if (!isRecord(properties)) return null;
  const required = Array.isArray(schema.required)
    ? schema.required.filter((name): name is string => typeof name === "string")
    : [];
  return Object.entries(properties).map(([name, property]) => ({
    name,
    type: isRecord(property) && isFieldType(property.type) ? property.type : null,
    required: required.includes(name),
  }));
}

/** 같은 이름이 둘이면 첫 도구. 중복은 저장 때 따로 걸린다. */
export function findTool(tools: readonly ToolDraft[], name: string): ToolDraft | undefined {
  const wanted = name.trim();
  return tools.find((tool) => tool.name.trim() === wanted);
}

const BLANK: Readonly<Record<FieldType, JsonValue>> = {
  string: "",
  number: 0,
  integer: 0,
  boolean: false,
};

/** args 가 비었거나 `{}` 일 때만 도구의 입력 필드로 채운다. 사람이 적은 args 는 덮지 않는다. */
export function prefillArgs(response: ResponseDraft, tool: ToolDraft | undefined): ResponseDraft {
  if (tool === undefined || !isBlankResult(response.argsJson)) return response;
  const fields = inputFields(tool);
  if (fields === null || fields.length === 0) return response;
  const args: Record<string, JsonValue> = {};
  for (const field of fields) args[field.name] = field.type === null ? null : BLANK[field.type];
  return { ...response, argsJson: JSON.stringify(args) };
}

/** [응답 추가] 의 새 줄. 이름이 있는 첫 도구를 고르고 args 를 채운다. */
export function newResponseFor(tools: readonly ToolDraft[]): ResponseDraft {
  const first = tools.find((tool) => tool.name.trim() !== "");
  return prefillArgs(newResponseDraft(first?.name.trim() ?? ""), first);
}

/** 응답 줄의 도구가 폼에 없을 때 그 줄에 띄울 문장(U4). 맞으면 `null`. */
export function toolProblem(tool: string, toolNames: readonly string[]): string | null {
  const name = tool.trim();
  if (name === "") return "→ 어느 도구의 답인지 고르세요.";
  return toolNames.includes(name)
    ? null
    : `→ '${name}' 도구가 폼에 없습니다. 위 도구 목록에서 다시 고르세요.`;
}

/**
 * args 가 도구의 입력 필드와 어긋나는 곳(U1 · U3). 빠진 필수 입력을 필드 순서로, 모르는 키를
 * args 순서로 적고, 하나라도 있으면 끝에 고칠 곳을 붙인다.
 *
 * 말하지 않는 경우: 인자 무관 · 도구가 폼에 없음(U4 가 말한다) · 스키마를 못 읽음 · args 가
 * JSON 객체가 아님(저장 때의 문장이 따로 있다).
 */
export function argsProblems(
  response: ResponseDraft,
  tools: readonly ToolDraft[],
): readonly string[] {
  if (response.anyArgs) return [];
  const tool = findTool(tools, response.tool);
  if (tool === undefined) return [];
  const fields = inputFields(tool);
  if (fields === null) return [];
  let args: unknown;
  try {
    args = JSON.parse(response.argsJson);
  } catch {
    return [];
  }
  if (!isRecord(args)) return [];

  const name = tool.name.trim();
  const keys = Object.keys(args);
  const known = new Set(fields.map((field) => field.name));
  const listed =
    fields.length === 0
      ? "입력 필드가 없는 도구입니다."
      : `입력 필드는 ${fields.map((field) => `'${field.name}'`).join(", ")} 입니다.`;
  const lines: string[] = [];
  for (const field of fields) {
    if (field.required && !keys.includes(field.name)) {
      lines.push(
        `→ args 에 ${name} 의 필수 입력 '${field.name}' 값이 없습니다. 목 서버가 이 호출을 인자 검사에서 거절하므로 이 응답은 쓰이지 않습니다.`,
      );
    }
  }
  for (const key of keys) {
    if (!known.has(key)) lines.push(`→ args 의 '${key}' 키는 ${name} 의 입력 필드에 없습니다. ${listed}`);
  }
  if (lines.length > 0) {
    lines.push("→ 도구에 입력 필드를 추가했거나 이름을 바꿨다면 args 도 같이 고치세요.");
  }
  return lines;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: 위 Step 2 명령.
Expected: PASS, 출력에 `Test Files  1 passed`.

- [ ] **Step 5: 서식 · 린트** — `corepack pnpm biome format --write packages/dashboard/web/src/mock-builder/args-check.ts packages/dashboard/web/tests/args-check.test.ts` 뒤 `corepack pnpm biome check` 같은 두 파일. exit 0.

- [ ] **Step 6: 보고** — 권장 커밋: `feat(dashboard): 응답의 args 가 도구 입력 필드와 어긋나는 곳을 문장으로 만든다`

---

### Task 2: 응답 줄에 점검을 붙이고 카드 머리에 설명을 둔다 (U1 · U3 · U4)

**Files:**
- Modify: `packages/dashboard/web/src/mock-builder/ResponseEditor.tsx`
- Modify: `packages/dashboard/web/src/screens/MockBuilder.tsx`
- Test: `packages/dashboard/web/tests/mock-editors.test.tsx`, `packages/dashboard/web/tests/mock-builder.test.tsx`

**Interfaces:**
- Consumes: Task 1 의 `findTool` · `prefillArgs` · `newResponseFor` · `toolProblem` · `argsProblems`
- Produces: `ResponseEditorProps` 에서 `toolNames: readonly string[]` 가 **`tools: readonly ToolDraft[]`** 로 바뀐다. (Task 3 이 이 위에 props 를 더한다.)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`web/tests/mock-editors.test.tsx`:

1. import 에 `type ToolDraft` 는 이미 있다. 파일 위쪽(하네스 앞)에 도구 둘을 둔다.

```tsx
const TOOLS: readonly ToolDraft[] = [
  { ...newToolDraft("get_weather"), fields: [{ name: "city", type: "string", required: true }] },
  newToolDraft("search"),
];
```

2. `ResponseHarness` 의 `toolNames={["get_weather", "search"]}` 를 `tools={TOOLS}` 로 바꾼다.

3. `describe("ResponseEditor", …)` 안 끝에 넣는다.

```tsx
  it("도구를 고르면 args 가 {} 일 때만 그 도구의 입력 필드로 채운다", () => {
    let latest: ResponseDraft | undefined;
    render(
      <ResponseHarness
        initial={newResponseDraft("search")}
        onLatest={(r) => {
          latest = r;
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText("도구"), { target: { value: "get_weather" } });
    expect(latest?.argsJson).toBe('{"city":""}');

    fireEvent.change(screen.getByLabelText("args (JSON)"), { target: { value: '{"city":"Seoul"}' } });
    fireEvent.change(screen.getByLabelText("도구"), { target: { value: "search" } });
    fireEvent.change(screen.getByLabelText("도구"), { target: { value: "get_weather" } });
    expect(latest?.argsJson).toBe('{"city":"Seoul"}');
  });

  it("필수 입력이 빠진 args 는 그 줄에서 말하고, 채우면 사라진다", () => {
    render(<ResponseHarness initial={newResponseDraft("get_weather")} />);
    const missing =
      "→ args 에 get_weather 의 필수 입력 'city' 값이 없습니다. 목 서버가 이 호출을 인자 검사에서 거절하므로 이 응답은 쓰이지 않습니다.";
    expect(screen.getByText(missing)).toBeTruthy();
    expect(
      screen.getByText("→ 도구에 입력 필드를 추가했거나 이름을 바꿨다면 args 도 같이 고치세요."),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("args (JSON)"), { target: { value: '{"city":"Seoul"}' } });
    expect(screen.queryByText(missing)).toBeNull();
  });

  it("응답의 도구가 폼에 없으면 그 줄에서 바로 말한다", () => {
    render(<ResponseHarness initial={newResponseDraft("get_weathr")} />);
    expect(
      screen.getByText("→ 'get_weathr' 도구가 폼에 없습니다. 위 도구 목록에서 다시 고르세요."),
    ).toBeTruthy();
  });

  it("도구가 비어 있으면 고르라고 말한다", () => {
    render(<ResponseHarness initial={newResponseDraft("")} />);
    expect(screen.getByText("→ 어느 도구의 답인지 고르세요.")).toBeTruthy();
  });
```

`web/tests/mock-builder.test.tsx` — `describe("MockBuilder — 새로 만들기", …)` 안 끝에 넣는다.

```tsx
  it("카드 머리가 도구와 응답이 무엇인지 말하고, 새 응답은 첫 도구의 입력 필드로 args 를 채운다", async () => {
    mockApi([]);
    await startNew();
    expect(
      screen.getByText(
        '목 서버가 "이런 도구가 있다" 고 알려 주는 목록입니다. 입력 필드는 그 도구를 부를 때 넘기는 값입니다.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "도구가 불렸을 때 목이 돌려줄 답입니다. 도구와 args 가 호출과 똑같을 때 그 줄의 result 를 돌려줍니다.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "도구 추가" }));
    fireEvent.change(screen.getByLabelText("도구 이름"), { target: { value: "get_weather" } });
    fireEvent.click(screen.getByRole("button", { name: "필드 추가" }));
    fireEvent.change(screen.getByLabelText("필드 1 이름"), { target: { value: "city" } });
    fireEvent.click(screen.getByLabelText("필드 1 필수"));
    fireEvent.click(screen.getByRole("button", { name: "응답 추가" }));
    expect((screen.getByLabelText("args (JSON)") as HTMLTextAreaElement).value).toBe('{"city":""}');
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `NODE_OPTIONS=--no-experimental-webstorage corepack pnpm vitest run --project web packages/dashboard/web/tests/mock-editors.test.tsx packages/dashboard/web/tests/mock-builder.test.tsx`
Expected: FAIL — 새 테스트 5건(문장 없음 · args 가 `{}`). 타입 오류(`tools` prop)는 vitest 가 무시하므로 실패 이유는 단언이다.

- [ ] **Step 3: `ResponseEditor.tsx` 를 고친다**

import 를 바꾼다.

```tsx
import { argsProblems, findTool, prefillArgs, toolProblem } from "./args-check.js";
import { preservedKeysNote, type ResponseDraft, type ToolDraft } from "./draft.js";
```

props 의 `toolNames` 를 바꾼다.

```tsx
  /** 폼의 도구 전부. 도구 선택지 · args 점검 · 채우기에 쓴다. */
  readonly tools: readonly ToolDraft[];
```

구조 분해의 `toolNames,` 를 `tools,` 로 바꾸고, `const options = …` **앞에** 넣는다.

```tsx
  const toolNames = tools.map((tool) => tool.name.trim()).filter((name) => name !== "");
  const toolIssue = toolProblem(response.tool, toolNames);
  const argsIssues = argsProblems(response, tools);
```

도구 `<select>` 의 `onChange` 를 바꾼다.

```tsx
          onChange={(event) =>
            onChange(
              prefillArgs(
                { ...response, tool: event.target.value },
                findTool(tools, event.target.value),
              ),
            )
          }
```

도구 `<select>` 를 감싼 `<div className="space-y-1">` 의 `</select>` 바로 뒤에 넣는다.

```tsx
        {toolIssue !== null && (
          <p role="note" className="text-xs text-ink">
            {toolIssue}
          </p>
        )}
```

args `<textarea>` 를 감싼 `<div className="space-y-1">` 의 `/>`(textarea 끝) 바로 뒤에 넣는다.

```tsx
        {argsIssues.length > 0 && (
          <div role="note" className="space-y-0.5 text-xs text-ink">
            {argsIssues.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
```

- [ ] **Step 4: `MockBuilder.tsx` 를 고친다**

import 에 넣는다: `import { newResponseFor } from "../mock-builder/args-check.js";`. `draft.js` import 에서 `newResponseDraft,` 를 뺀다(더 쓰지 않는다).

도구 카드의 `<h2 …>도구</h2>` 바로 뒤에:

```tsx
            <p className="text-sm text-ink-muted">
              {'목 서버가 "이런 도구가 있다" 고 알려 주는 목록입니다. 입력 필드는 그 도구를 부를 때 넘기는 값입니다.'}
            </p>
```

응답 카드의 `<h2 …>응답</h2>` 바로 뒤에:

```tsx
            <p className="text-sm text-ink-muted">
              {"도구가 불렸을 때 목이 돌려줄 답입니다. 도구와 args 가 호출과 똑같을 때 그 줄의 result 를 돌려줍니다."}
            </p>
```

`<ResponseEditor` 의 `toolNames={toolNames}` 를 `tools={draft.tools}` 로 바꾼다.

[응답 추가] 의 `responses: [...draft.responses, newResponseDraft(toolNames[0] ?? "")],` 를 `responses: [...draft.responses, newResponseFor(draft.tools)],` 로 바꾼다.

`toolNames` 는 `RecordingPanel` 이 아직 쓰므로 이 태스크에서는 남긴다(Task 3 이 지운다).

- [ ] **Step 5: 통과 · 회귀를 확인한다**

Run: Step 2 명령. Expected: PASS.
Run: `NODE_OPTIONS=--no-experimental-webstorage corepack pnpm vitest run --project web packages/dashboard/web/tests` — Expected: PASS(기존 목 만들기 테스트 포함. `fillWeather` 는 args 를 덮어쓰므로 저장 바이트가 그대로다).
Run: `cd packages/dashboard && corepack pnpm typecheck; echo $?` — Expected: `0`.

- [ ] **Step 6: 회귀 증명** — `args-check.ts` 의 `prefillArgs` 첫 줄을 `return response;` 로 바꿔 Step 2 의 새 테스트 중 채우기 두 건이 **실패하는 것**을 보고 되돌린다(스크래치패드 `cp` 백업 → 수정 → 실행 → `cp` 복구 → `git diff --stat` 확인).

- [ ] **Step 7: 서식 · 린트** — 바꾼 네 파일에만 Global Constraints 의 biome 두 명령.

- [ ] **Step 8: 보고** — 권장 커밋: `feat(dashboard): 응답 줄에서 도구 · args 가 어긋나면 바로 말하고 카드 머리에 설명을 둔다`

---

### Task 3: 녹화본을 응답 카드 안에서 고른다 (U6 · U5)

**Files:**
- Create: `packages/dashboard/web/src/mock-builder/RecordingPicker.tsx`
- Delete: `packages/dashboard/web/src/mock-builder/RecordingPanel.tsx`, `packages/dashboard/web/tests/recording-panel.test.tsx`
- Modify: `packages/dashboard/web/src/mock-builder/draft.ts`, `packages/dashboard/web/src/mock-builder/ResponseEditor.tsx`, `packages/dashboard/web/src/screens/MockBuilder.tsx`
- Test: `packages/dashboard/web/tests/recording-picker.test.tsx`(신규), `packages/dashboard/web/tests/mock-draft.test.ts`, `packages/dashboard/web/tests/mock-builder.test.tsx`, `packages/dashboard/web/tests/mock-editors.test.tsx`

**Interfaces:**
- Consumes: `describeInteraction` · `interactionsPath`(`interactions.ts`), `isBlankResult`(`draft.ts`), `apiGet`(`../api.js`), Task 2 의 `ResponseEditorProps`
- Produces:
  - `ResponseDraft.recordedFrom?: string` — 화면 전용 출처 문장
  - `pickedResult(response: ResponseDraft, body: JsonValue, recordedFrom: string): ResponseDraft`
  - `recordedFromNote(sessionPath: string, ordinal: number): string`(`RecordingPicker.tsx`)
  - `RecordingPicker` props `{ id: string; resultJson: string; onPick: (body: JsonValue, recordedFrom: string) => void }`
  - `ResponseEditorProps` 에 `pickerOpen: boolean` · `onTogglePicker: () => void` · `onPicked: (response: ResponseDraft) => void` 추가
  - 삭제: `PickedResponse` · `addPickedResponse` · `replaceResult` · `RecordingPanel` · `ResponseTarget`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`web/tests/recording-picker.test.tsx`(신규):

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JsonValue, SessionEntry, SessionInteractionEntry } from "../../src/api-types.js";
import { RecordingPicker, recordedFromNote } from "../src/mock-builder/RecordingPicker.js";

const SESSION = "recordings/weather.session.db";
const OTHER = "recordings/other.session.db";
const LONG_URL =
  "https://api.open-meteo.com/<redacted>?latitude=36.3809&longitude=128.3681&current=temperature_2m%2Cweather_code";

const INTERACTIONS: SessionInteractionEntry[] = [
  {
    ordinal: 0,
    method: "GET",
    url: LONG_URL,
    outcome: { kind: "response", status: 200, body: { temperature: 21.5 } },
  },
  {
    ordinal: 1,
    method: "GET",
    url: "https://nowhere.invalid/<redacted>",
    outcome: { kind: "throw", failureKind: "dns", code: "ENOTFOUND" },
  },
  {
    ordinal: 2,
    method: "GET",
    url: "https://api.example.com/<redacted>",
    outcome: { kind: "incomplete" },
  },
];

function mockApi(sessions: SessionEntry[], interactions?: () => Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/api/sessions")) return new Response(JSON.stringify(sessions));
      if (url.endsWith("/interactions")) {
        return interactions?.() ?? new Response(JSON.stringify(INTERACTIONS));
      }
      throw new Error(`예상하지 못한 요청: ${url}`);
    }),
  );
}

const ONE: SessionEntry[] = [{ path: SESSION, status: "completed", interactionCount: 3 }];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPicker(resultJson = "{}"): [JsonValue, string][] {
  const picks: [JsonValue, string][] = [];
  render(
    <RecordingPicker id="response-0" resultJson={resultJson} onPick={(b, n) => picks.push([b, n])} />,
  );
  return picks;
}

describe("RecordingPicker", () => {
  it("출처 문장은 사람이 세는 순서(1부터)로 쓴다", () => {
    expect(recordedFromNote(SESSION, 0)).toBe(
      "recordings/weather.session.db 의 1번째 외부 호출에서 가져왔습니다.",
    );
  });

  it("녹화본이 하나면 골라 두고 세 갈래를 보여준다. 긴 URL 은 줄을 바꾼다", async () => {
    mockApi(ONE);
    renderPicker();
    const label = await screen.findByText(`GET ${LONG_URL} · 200`);
    expect(label.className.split(" ")).toContain("break-all");
    expect(
      screen.getByText(
        "→ 이 호출은 응답 본문이 없어 목의 답으로 쓸 수 없습니다 — fetch 가 실패했습니다 (dns · ENOTFOUND)",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "→ 녹화가 끝나지 않은 호출입니다. 응답이 저장되지 않아 목의 답으로 쓸 수 없습니다.",
      ),
    ).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "이걸로 채우기" })).toHaveLength(1);
  });

  it("녹화본이 여럿이면 고를 때까지 목록을 부르지 않는다", async () => {
    mockApi([...ONE, { path: OTHER, status: "completed", interactionCount: 0 }]);
    renderPicker();
    await screen.findByRole("option", { name: `${OTHER} · 외부 호출 0건` });
    expect(screen.queryByRole("button", { name: "이걸로 채우기" })).toBeNull();
    fireEvent.change(screen.getByLabelText("녹화본"), { target: { value: SESSION } });
    expect(await screen.findByRole("button", { name: "이걸로 채우기" })).toBeTruthy();
  });

  it("result 가 비었으면 바로 채운다", async () => {
    mockApi(ONE);
    const picks = renderPicker("{}");
    fireEvent.click(await screen.findByRole("button", { name: "이걸로 채우기" }));
    expect(picks).toEqual([
      [{ temperature: 21.5 }, "recordings/weather.session.db 의 1번째 외부 호출에서 가져왔습니다."],
    ]);
  });

  it("result 에 값이 있으면 확인을 받는다", async () => {
    mockApi(ONE);
    const picks = renderPicker('{"temperature":1}');
    fireEvent.click(await screen.findByRole("button", { name: "이걸로 채우기" }));
    expect(picks).toEqual([]);
    expect(
      screen.getByText("지금 적힌 result 를 이 본문으로 바꿉니다. 지금 값은 사라집니다."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "바꾸기" }));
    expect(picks).toHaveLength(1);
  });

  it("녹화본을 읽을 수 없으면 서버 문장을 줄 그대로 보여준다", async () => {
    const message = [
      `→ 이 녹화본을 읽을 수 없습니다 — ${SESSION}`,
      "→ MCPeak 이 녹화한 세션 파일인지 확인하세요. 목록에는 읽을 수 있는 파일만 나옵니다.",
    ].join("\n");
    mockApi(ONE, () => new Response(JSON.stringify({ error: message }), { status: 404 }));
    renderPicker();
    expect((await screen.findByRole("alert")).textContent).toBe(message);
  });

  it("녹화본이 없으면 어떻게 만드는지 말한다", async () => {
    mockApi([]);
    renderPicker();
    expect(
      await screen.findByText(
        "이 디렉터리 아래에 녹화본이 없습니다. mcpeak test --record-session <path> 로 녹화한 파일이 여기에 나옵니다.",
      ),
    ).toBeTruthy();
  });
});
```

`web/tests/mock-draft.test.ts`: `addPickedResponse` · `replaceResult` 테스트 세 건(264–305줄 근처 `it("addPickedResponse: …")` 두 건, `it("replaceResult: …")` 한 건)과 import 의 `addPickedResponse,` · `replaceResult,` 를 지우고, import 에 `pickedResult,` 를 넣은 뒤 같은 자리에 넣는다.

```ts
  it("pickedResult: 그 줄의 result 만 바꾸고 녹화 응답 · 출처로 표시한다", () => {
    const start = { ...newResponseDraft("get_weather"), argsJson: '{"city":"Seoul"}', isError: true };
    expect(pickedResult(start, { temperature: 21.5 }, "w.session.db 의 1번째 외부 호출에서 가져왔습니다.")).toEqual({
      ...start,
      resultJson: JSON.stringify({ temperature: 21.5 }, null, 2),
      origin: "recording",
      recordedFrom: "w.session.db 의 1번째 외부 호출에서 가져왔습니다.",
    });
  });

  it("출처는 저장 파일에 실리지 않는다", () => {
    const response = pickedResult(newResponseDraft("ping"), { ok: true }, "출처");
    const built = buildMockDefinition({ tools: [newToolDraft("ping")], responses: [response], extra: {} });
    expect(built).toEqual({
      ok: true,
      definition: {
        tools: [{ name: "ping", inputSchema: { type: "object", properties: {} } }],
        responses: [{ tool: "ping", args: {}, result: { ok: true } }],
      },
    });
  });
```

(`buildMockDefinition` · `newToolDraft` · `newResponseDraft` 가 import 에 없으면 넣는다.)

`web/tests/mock-editors.test.tsx`: `ResponseHarness` 의 `<ResponseEditor` 에 `pickerOpen={false}` `onTogglePicker={() => undefined}` `onPicked={() => undefined}` 를 넣는다.

`web/tests/mock-builder.test.tsx`: `describe("MockBuilder — 녹화본 패널 · 처음으로", …)` 를 `describe("MockBuilder — 녹화본 가져오기 · 처음으로", …)` 로 바꾸고, 첫 `it("녹화본에서 새 응답으로 넣으면 …")` 를 통째로 아래 둘로 바꾼다.

```tsx
  it("응답 카드에서 녹화본을 가져오면 result 가 채워져 강조되고, 출처와 URL 경고가 뜬다", async () => {
    mockApi([saved()]);
    await startNew();
    fireEvent.click(screen.getByRole("button", { name: "도구 추가" }));
    fireEvent.change(screen.getByLabelText("도구 이름"), { target: { value: "get_weather" } });
    fireEvent.click(screen.getByRole("button", { name: "응답 추가" }));
    expect(screen.queryByRole("button", { name: "녹화본 보기" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "녹화본에서 가져오기" }));
    fireEvent.click(await screen.findByRole("button", { name: "이걸로 채우기" }));

    expect((screen.getByLabelText("result (JSON)") as HTMLTextAreaElement).value).toBe(
      JSON.stringify(
        { temperature: 21.5, next: "https://api.open-meteo.com/v1/page/2?key=abc" },
        null,
        2,
      ),
    );
    expect(
      screen.getByLabelText("result (JSON)").closest("fieldset")?.getAttribute("data-highlighted"),
    ).toBe("true");
    expect(screen.getByText("weather.session.db 의 1번째 외부 호출에서 가져왔습니다.")).toBeTruthy();
    expect(screen.queryByLabelText("녹화본")).toBeNull(); // 채우면 선택 창을 닫는다
    expect(
      screen.getByText(
        "→ 이 응답 본문에 URL 이 1개 있습니다. 녹화 때 가려지지 않는 자리라 자격증명이 담겼을 수 있습니다.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "→ 녹화본에서 가져온 result 에 URL 이 1개 있습니다. 녹화 때 가려지지 않는 자리라 자격증명이 담겼을 수 있습니다.",
      ),
    ).toBeTruthy();

    // 경고는 저장을 막지 않는다.
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(puts).toHaveLength(1));
  });

  it("선택 창은 한 카드에서만 열린다", async () => {
    mockApi([]);
    await startNew();
    fireEvent.click(screen.getByRole("button", { name: "응답 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "응답 추가" }));
    const [first, second] = screen.getAllByRole("button", { name: "녹화본에서 가져오기" });
    fireEvent.click(first as HTMLElement);
    await screen.findByLabelText("녹화본");
    fireEvent.click(second as HTMLElement);
    await screen.findByLabelText("녹화본");
    expect(screen.getAllByLabelText("녹화본")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "녹화본 닫기" })).toHaveLength(1);
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `NODE_OPTIONS=--no-experimental-webstorage corepack pnpm vitest run --project web packages/dashboard/web/tests/recording-picker.test.tsx packages/dashboard/web/tests/mock-draft.test.ts packages/dashboard/web/tests/mock-builder.test.tsx`
Expected: FAIL — `RecordingPicker.js` 없음, `pickedResult` 없음, "녹화본에서 가져오기" 없음.

- [ ] **Step 3: `draft.ts` 를 고친다**

`ResponseDraft` 의 `origin` 필드 바로 뒤에:

```ts
  /** 녹화본에서 가져왔다면 어디서인지 알리는 문장. 화면 전용이라 `mock.json` 에 실리지 않는다. */
  readonly recordedFrom?: string;
```

`PickedResponse` 인터페이스, `addPickedResponse`, `replaceResult` 를 지우고 그 자리에:

```ts
/**
 * 녹화 본문으로 이 응답 줄의 result 만 바꾼다. 도구 · args · isError 는 그대로다. 본문은
 * **가공 없이** 들어간다 — 필요 없는 필드를 지우는 것은 사람이 한다(설계 §목적).
 */
export function pickedResult(
  response: ResponseDraft,
  body: JsonValue,
  recordedFrom: string,
): ResponseDraft {
  return {
    ...response,
    resultJson: JSON.stringify(body, null, 2),
    origin: "recording",
    recordedFrom,
  };
}
```

- [ ] **Step 4: `RecordingPicker.tsx` 를 만든다**

```tsx
// packages/dashboard/web/src/mock-builder/RecordingPicker.tsx
import type { JSX } from "react";
import { useEffect, useState } from "react";
import type { JsonValue, SessionEntry, SessionInteractionEntry } from "../../../src/api-types.js";
import { apiGet } from "../api.js";
import { Button } from "../components/Button.js";
import { INPUT_CLASS } from "../components/Field.js";
import { isBlankResult } from "./draft.js";
import { describeInteraction, interactionsPath } from "./interactions.js";

/** 채운 result 아래 출처 한 줄. `ordinal` 은 0부터라 사람이 세는 번호로 바꾼다. */
export function recordedFromNote(sessionPath: string, ordinal: number): string {
  return `${sessionPath} 의 ${ordinal + 1}번째 외부 호출에서 가져왔습니다.`;
}

export interface RecordingPickerProps {
  /** 이 응답 줄의 칸 id 접두사. */
  readonly id: string;
  /** 지금 result. 비었거나 `{}` 가 아니면 바꾸기 전에 확인받는다. */
  readonly resultJson: string;
  readonly onPick: (body: JsonValue, recordedFrom: string) => void;
}

interface Pending {
  readonly body: JsonValue;
  readonly recordedFrom: string;
}

/**
 * 응답 카드 안에 펼치는 녹화본 선택 창(설계 §사용 훑기 반영 U6). 채우고 있는 칸에서 출발하므로
 * "어느 줄에 넣을지" 를 따로 묻지 않는다. 녹화본은 **읽기만** 한다 — 서버 실행 · 재생 · 새 녹화
 * 없음. 본문은 가공하지 않고 넘긴다.
 */
export function RecordingPicker({ id, resultJson, onPick }: RecordingPickerProps): JSX.Element {
  const [sessions, setSessions] = useState<readonly SessionEntry[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [sessionPath, setSessionPath] = useState("");
  const [interactions, setInteractions] = useState<readonly SessionInteractionEntry[] | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  function open(path: string): void {
    setSessionPath(path);
    setInteractions(null);
    setOpenError(null);
    setPending(null);
    if (path === "") return;
    apiGet<SessionInteractionEntry[]>(interactionsPath(path))
      .then(setInteractions)
      .catch((err: unknown) => setOpenError(err instanceof Error ? err.message : String(err)));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: 열 때 한 번만 목록을 부른다
  useEffect(() => {
    apiGet<SessionEntry[]>("/api/sessions")
      .then((found) => {
        setSessions(found);
        const only = found.length === 1 ? found[0] : undefined;
        if (only !== undefined) open(only.path);
      })
      .catch((err: unknown) => setListError(err instanceof Error ? err.message : String(err)));
  }, []);

  function pick(body: JsonValue, ordinal: number): void {
    const recordedFrom = recordedFromNote(sessionPath, ordinal);
    if (isBlankResult(resultJson)) {
      onPick(body, recordedFrom);
      return;
    }
    setPending({ body, recordedFrom });
  }

  if (listError !== null) {
    return (
      <p role="alert" className="whitespace-pre-line text-sm text-ink">
        {listError}
      </p>
    );
  }
  if (sessions === null) return <p className="text-sm text-ink-muted">녹화본을 찾는 중…</p>;
  if (sessions.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        {
          "이 디렉터리 아래에 녹화본이 없습니다. mcpeak test --record-session <path> 로 녹화한 파일이 여기에 나옵니다."
        }
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded border border-accent bg-accent-soft p-3">
      <div className="space-y-1">
        <label className="block text-sm font-medium text-ink" htmlFor={`${id}-recording`}>
          녹화본
        </label>
        <select
          id={`${id}-recording`}
          className={INPUT_CLASS}
          value={sessionPath}
          onChange={(event) => open(event.target.value)}
        >
          <option value="">녹화본을 고르세요</option>
          {sessions.map((session) => (
            <option key={session.path} value={session.path}>
              {`${session.path} · 외부 호출 ${session.interactionCount}건`}
            </option>
          ))}
        </select>
      </div>

      {openError !== null && (
        <p role="alert" className="whitespace-pre-line text-sm text-ink">
          {openError}
        </p>
      )}

      {pending !== null && (
        <div className="space-y-2">
          <p className="text-sm text-ink">
            지금 적힌 result 를 이 본문으로 바꿉니다. 지금 값은 사라집니다.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                onPick(pending.body, pending.recordedFrom);
                setPending(null);
              }}
            >
              바꾸기
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
              취소
            </Button>
          </div>
        </div>
      )}

      {interactions !== null && pending === null && (
        <ol className="space-y-2">
          {interactions.map((entry) => {
            const view = describeInteraction(entry);
            return (
              <li key={entry.ordinal} className="space-y-2 rounded border border-line bg-canvas p-3">
                <p className="break-all font-mono text-xs text-ink">{view.label}</p>
                {view.pickable ? (
                  <>
                    <pre className="max-h-32 overflow-auto text-xs text-ink-muted">
                      {JSON.stringify(view.body, null, 2)}
                    </pre>
                    <Button size="xs" variant="primary" onClick={() => pick(view.body, entry.ordinal)}>
                      이걸로 채우기
                    </Button>
                  </>
                ) : (
                  <p className="text-xs text-ink-muted">{view.reason}</p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
```

`bg-canvas` · `bg-accent-soft` · `border-accent` 는 `ResponseEditor` · `App` 이 이미 쓰는 테마 클래스다. biome 가 `useExhaustiveDependencies` 를 다르게 부르면(규칙 이름 확인) 억제 주석을 그 이름으로 맞춘다.

- [ ] **Step 5: `ResponseEditor.tsx` 에 버튼 · 선택 창 · 출처 줄을 붙인다**

import 에 `import { RecordingPicker } from "./RecordingPicker.js";` 와 `pickedResult` 를 넣는다(`import { pickedResult, preservedKeysNote, type ResponseDraft, type ToolDraft } from "./draft.js";`).

props 에 넣는다.

```tsx
  /** 이 줄의 녹화본 선택 창이 열려 있나. 한 번에 한 줄만 열린다 — 부모가 정한다. */
  readonly pickerOpen: boolean;
  readonly onTogglePicker: () => void;
  /** 녹화본에서 result 를 채운 줄. 부모가 강조하고 선택 창을 닫는다. */
  readonly onPicked: (response: ResponseDraft) => void;
```

구조 분해에 `pickerOpen, onTogglePicker, onPicked,` 를 넣는다.

result 칸 `<div className="space-y-1">` 를 통째로 바꾼다.

```tsx
      <div className="space-y-1">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <label className="block text-sm font-medium text-ink" htmlFor={`${id}-result`}>
            result (JSON)
          </label>
          <Button size="xs" aria-expanded={pickerOpen} onClick={onTogglePicker}>
            {pickerOpen ? "녹화본 닫기" : "녹화본에서 가져오기"}
          </Button>
        </div>
        {pickerOpen && (
          <RecordingPicker
            id={id}
            resultJson={response.resultJson}
            onPick={(body, recordedFrom) => onPicked(pickedResult(response, body, recordedFrom))}
          />
        )}
        <textarea
          id={`${id}-result`}
          className={`${INPUT_CLASS} font-mono`}
          rows={8}
          value={response.resultJson}
          onChange={(event) => onChange({ ...response, resultJson: event.target.value })}
        />
        {response.origin === "recording" && response.recordedFrom !== undefined && (
          <p className="text-xs text-ink-muted">{response.recordedFrom}</p>
        )}
      </div>
```

`Button` 이 `aria-expanded` 를 넘기지 않으면(`components/Button.tsx` 의 props 확인) 이 속성은 빼고 진행한다. 테스트는 이 속성을 보지 않는다.

- [ ] **Step 6: `MockBuilder.tsx` 를 고친다**

- import 에서 `RecordingPanel`, `addPickedResponse,`, `replaceResult,` 를 지운다.
- `const [showRecordings, setShowRecordings] = useState(false);` 를 `const [pickerAt, setPickerAt] = useState<number | null>(null);` 로 바꾸고, `begin()` 안 `setShowRecordings(false);` 를 `setPickerAt(null);` 로 바꾼다.
- `const toolNames = …` 줄을 지운다(더 쓰는 곳이 없다).
- `PageHeader` 의 `aside` 에서 [녹화본 보기] 버튼을 지운다. `aside` 는 [← 처음으로] 하나만 남긴다.

```tsx
        aside={
          <Button variant="ghost" onClick={leave}>
            ← 처음으로
          </Button>
        }
```

- `<div className={showRecordings ? "grid grid-cols-2 items-start gap-6" : ""}>` 와 그 짝 `</div>`, 그리고 `{showRecordings && (<Card …><RecordingPanel …/></Card>)}` 블록을 지운다. 안쪽 `<div className="space-y-6">` 는 남긴다.
- `<ResponseEditor` 에 넣고 `onRemove` 를 바꾼다.

```tsx
                pickerOpen={pickerAt === index}
                onTogglePicker={() => setPickerAt(pickerAt === index ? null : index)}
                onPicked={(next) => {
                  update(
                    { ...draft, responses: draft.responses.map((r, i) => (i === index ? next : r)) },
                    index,
                  );
                  setPickerAt(null);
                }}
                onRemove={() => {
                  update({ ...draft, responses: draft.responses.filter((_, i) => i !== index) });
                  setPickerAt(null);
                }}
```

- 파일 머리 주석의 "녹화본은 시작 갈래가 아니라 편집 화면 옆에 펴 두는 패널이다." 를 "녹화본은 시작 갈래가 아니라 응답 카드 안에서 result 를 채울 때 고르는 곳이다." 로 바꾼다.

- [ ] **Step 7: 지운다**

`packages/dashboard/web/src/mock-builder/RecordingPanel.tsx`, `packages/dashboard/web/tests/recording-panel.test.tsx` 를 `rm` 으로 지운다(git 명령 아님).
`grep -rn "RecordingPanel\|addPickedResponse\|replaceResult\|PickedResponse" packages/dashboard/web packages/dashboard/tests` — 0 건이어야 한다(건수는 stdout 으로 읽는다).

- [ ] **Step 8: 통과 · 회귀를 확인한다**

Run: Step 2 명령 — PASS.
Run: `NODE_OPTIONS=--no-experimental-webstorage corepack pnpm vitest run --project web packages/dashboard/web/tests` — PASS.
Run: `corepack pnpm vitest run --project e2e packages/dashboard; echo $?` — `0`. (왕복 E2E 는 `origin: "recording"` 리터럴을 쓰고 `recordedFrom` 은 선택 필드라 그대로 통과해야 한다.)
Run: `cd packages/dashboard && corepack pnpm typecheck; echo $?` — `0`.

- [ ] **Step 9: 회귀 증명** — `RecordingPicker.tsx` 의 `pick()` 에서 `if (isBlankResult(resultJson))` 를 `if (true)` 로 바꿔 "result 에 값이 있으면 확인을 받는다" 가 **실패하는 것**을 보고, `MockBuilder.tsx` 의 `onPicked` 에서 `setPickerAt(null);` 을 빼 mock-builder 의 "채우면 선택 창을 닫는다" 단언이 **실패하는 것**을 본다. 둘 다 `cp` 백업 · 복구.

- [ ] **Step 10: 서식 · 린트** — 바꾼 · 만든 파일에만 biome 두 명령.

- [ ] **Step 11: 보고** — 권장 커밋: `feat(dashboard): 녹화본을 응답 카드 안에서 골라 result 를 채운다`

---

### Task 4: 고친 뒤 화면을 떠나면 묻는다 (U7)

**Files:**
- Create: `packages/dashboard/web/src/leave-guard.ts`
- Modify: `packages/dashboard/web/src/App.tsx`, `packages/dashboard/web/src/screens/MockBuilder.tsx`
- Test: `packages/dashboard/web/tests/leave-guard.test.tsx`(신규)

**Interfaces:**
- Consumes: 없음(React `useEffect` 만)
- Produces:
  - `leaveBlocker(): ((targetHash: string) => void) | null`
  - `leaveAnyway(targetHash: string): void`
  - `useLeaveGuard(active: boolean, onBlocked: (targetHash: string) => void): void`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```tsx
// packages/dashboard/web/tests/leave-guard.test.tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";

const LEAVE = "→ 저장하지 않은 목을 버리고 다른 화면으로 이동합니다.";

/** GET 은 전부 빈 목록, PUT 은 저장 성공. */
function fakeFetch(): typeof fetch {
  return vi.fn(async (_input: unknown, init?: { method?: string }) =>
    init?.method === "PUT"
      ? new Response(JSON.stringify({ saved: true, mtimeMs: 1 }))
      : new Response("[]"),
  ) as unknown as typeof fetch;
}

async function editMock(): Promise<void> {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "시작" }));
  fireEvent.click(screen.getByRole("button", { name: "도구 추가" }));
}

function unloadPrevented(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("목 만들기 이탈 확인", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fakeFetch());
    window.location.hash = "#/mock";
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.location.hash = "";
  });

  it("고친 뒤 해시가 바뀌면 되돌리고 묻는다. 버리고 이동하면 간다", async () => {
    await editMock();
    window.location.hash = "#/runs";
    expect(await screen.findByText(LEAVE)).toBeTruthy();
    expect(window.location.hash).toBe("#/mock");
    expect(screen.getByLabelText("도구 이름")).toBeTruthy(); // 폼이 남아 있다

    fireEvent.click(screen.getByRole("button", { name: "버리고 이동" }));
    await waitFor(() => expect(window.location.hash).toBe("#/runs"));
    await waitFor(() => expect(screen.queryByLabelText("도구 이름")).toBeNull());
  });

  it("취소하면 확인 줄만 닫고 그대로 있는다", async () => {
    await editMock();
    window.location.hash = "#/runs";
    fireEvent.click(await screen.findByRole("button", { name: "취소" }));
    expect(screen.queryByText(LEAVE)).toBeNull();
    expect(window.location.hash).toBe("#/mock");
    expect(screen.getByLabelText("도구 이름")).toBeTruthy();
  });

  it("고치지 않았으면 묻지 않고 간다", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "시작" }));
    window.location.hash = "#/runs";
    await waitFor(() => expect(screen.queryByRole("button", { name: "도구 추가" })).toBeNull());
    expect(screen.queryByText(LEAVE)).toBeNull();
  });

  it("저장하면 다시 묻지 않는다", async () => {
    await editMock();
    fireEvent.change(screen.getByLabelText("도구 이름"), { target: { value: "ping" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("저장했습니다 — mock.json");
    window.location.hash = "#/runs";
    await waitFor(() => expect(screen.queryByLabelText("도구 이름")).toBeNull());
    expect(screen.queryByText(LEAVE)).toBeNull();
  });

  it("고친 동안만 새로고침 · 탭 닫기를 막는다", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "시작" }));
    expect(unloadPrevented()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "도구 추가" }));
    expect(unloadPrevented()).toBe(true);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `NODE_OPTIONS=--no-experimental-webstorage corepack pnpm vitest run --project web packages/dashboard/web/tests/leave-guard.test.tsx`
Expected: FAIL — 첫 · 둘째 · 다섯째 테스트(확인 줄 없음, 해시가 `#/runs`, `defaultPrevented` false). 셋째 · 넷째는 지금도 통과할 수 있다 — 회귀 방지용이다.

- [ ] **Step 3: `leave-guard.ts` 를 만든다**

```ts
// packages/dashboard/web/src/leave-guard.ts
import { useEffect } from "react";

/**
 * 화면 하나가 "지금 떠나면 잃는 것이 있다" 고 App 에 알리는 자리(설계 §사용 훑기 반영 U7).
 *
 * 해시 변경은 취소할 수 없다. 그래서 App 이 `hashchange` 를 받으면 이 자리를 보고, 막혀 있으면
 * 해시를 되돌린 뒤 가려던 해시를 `onBlocked` 로 넘긴다. 화면은 확인을 받고 `leaveAnyway` 로
 * 보낸다. 한 번에 한 화면만 떠 있으므로 자리는 하나다.
 */
type OnBlocked = (targetHash: string) => void;

let blocker: OnBlocked | null = null;

export function leaveBlocker(): OnBlocked | null {
  return blocker;
}

/** 자리를 비우고 가려던 곳으로 보낸다. 화면의 "버리고 이동" 이 부른다. */
export function leaveAnyway(targetHash: string): void {
  blocker = null;
  window.location.hash = targetHash;
}

function preventUnload(event: BeforeUnloadEvent): void {
  event.preventDefault();
}

/** `active` 인 동안 해시 이동을 막고 새로고침 · 탭 닫기에 브라우저 기본 경고를 건다. */
export function useLeaveGuard(active: boolean, onBlocked: OnBlocked): void {
  useEffect(() => {
    if (!active) return;
    blocker = onBlocked;
    window.addEventListener("beforeunload", preventUnload);
    return () => {
      if (blocker === onBlocked) blocker = null;
      window.removeEventListener("beforeunload", preventUnload);
    };
  }, [active, onBlocked]);
}
```

(현행 브라우저는 `preventDefault()` 만으로 경고를 띄운다. 오래된 Chrome 이 `returnValue` 를 요구하던 것은 이 대시보드의 지원 범위 밖이다.)

- [ ] **Step 4: `App.tsx` 를 고친다**

import 를 `import { useEffect, useRef, useState } from "react";` 로 바꾸고 `import { leaveBlocker } from "./leave-guard.js";` 를 넣는다.

`App()` 의 `useState` 와 첫 `useEffect` 를 바꾼다.

```tsx
  const [hash, setHash] = useState<string>(() => window.location.hash);
  /** 마지막으로 받아들인 해시. 이탈을 막을 때 여기로 되돌린다. */
  const accepted = useRef(window.location.hash);

  useEffect(() => {
    const onHashChange = (): void => {
      const onBlocked = leaveBlocker();
      if (onBlocked !== null) {
        const target = window.location.hash;
        // replaceState 는 hashchange 를 다시 쏘지 않는다.
        window.history.replaceState(null, "", accepted.current);
        onBlocked(target);
        return;
      }
      accepted.current = window.location.hash;
      setHash(window.location.hash);
    };
    window.addEventListener("hashchange", onHashChange);
    return (): void => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);
```

`#/home` 리다이렉트 `useEffect` 의 `setHash("#/home");` 앞에 `accepted.current = "#/home";` 를 넣는다.

파일 머리 주석 표 아래에 한 줄: `이탈 확인: 화면이 \`useLeaveGuard\` 로 막아 두면 해시를 되돌리고 그 화면이 묻는다(leave-guard.ts).`

- [ ] **Step 5: `MockBuilder.tsx` 를 고친다**

import 에 `import { leaveAnyway, useLeaveGuard } from "../leave-guard.js";`.

상태 선언들 바로 뒤, `function begin` **앞에**(조기 return 보다 앞이어야 한다):

```tsx
  /** 막힌 이동의 목적지. 확인 줄을 띄운다. */
  const [leavingTo, setLeavingTo] = useState<string | null>(null);
  useLeaveGuard(source !== null && dirty, setLeavingTo);
```

`begin()` 안에 `setLeavingTo(null);` 을 넣는다.

`{leaving && ( … )}` 블록 바로 뒤에:

```tsx
      {leavingTo !== null && (
        <div className="flex items-center gap-3">
          <p className="text-sm text-ink">→ 저장하지 않은 목을 버리고 다른 화면으로 이동합니다.</p>
          <Button size="sm" variant="primary" onClick={() => leaveAnyway(leavingTo)}>
            버리고 이동
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setLeavingTo(null)}>
            취소
          </Button>
        </div>
      )}
```

- [ ] **Step 6: 통과 · 회귀를 확인한다**

Run: Step 2 명령 — PASS, `Test Files  1 passed`.
Run: `NODE_OPTIONS=--no-experimental-webstorage corepack pnpm vitest run --project web packages/dashboard/web/tests` — PASS(특히 `app-shell.test.tsx` · `app.test.ts`).
Run: `cd packages/dashboard && corepack pnpm typecheck; echo $?` — `0`.

- [ ] **Step 7: 회귀 증명** — `App.tsx` 의 `if (onBlocked !== null) { … }` 블록을 통째로 주석 처리해 첫 테스트가 **실패하는 것**을 보고, `leave-guard.ts` 의 `window.addEventListener("beforeunload", …)` 를 빼 다섯째가 **실패하는 것**을 본다. `cp` 백업 · 복구.

- [ ] **Step 8: 서식 · 린트** — 바꾼 · 만든 파일에만 biome 두 명령.

- [ ] **Step 9: 보고** — 권장 커밋: `feat(dashboard): 목을 고친 뒤 사이드바 · 뒤로가기 · 새로고침으로 떠나면 묻는다`

---

### Task 5: 문서 — ADR-0101 · changeset · 설계 정리

**Files:**
- Modify: `docs/adr/0101-목-만들기는-스위트-PUT-의-저장-계약을-쓰고-녹화-응답의-URL-만-경고한다.md`
- Modify: `.changeset/dashboard-mock-builder.md`
- Modify: `docs/superpowers/specs/2026-09-28-dashboard-mock-builder-design.md` (필요할 때만)

- [ ] **Step 1: ADR-0101 에 절을 덧붙인다** — 파일 끝에:

```markdown
## 추가 결정 — 녹화본은 응답 카드 안에서 고른다 (2026-09-28, 사용 훑기 U6)

- **배경**: 처음 구현은 녹화본 패널을 폼 오른쪽에 두고, 본문마다 [새 응답으로 추가] · [넣을 응답 ▾] ·
  [result 로 넣기] 를 달았다. 직접 써 보니 사용자가 두 버튼의 차이를 알 수 없었고, 드롭다운이 어느
  버튼 것인지도 보이지 않았다. 문구를 여러 번 고쳐 봐도 추상적이었다.
- **선택지**: (a) 패널을 두고 문구 · 배치만 고친다 / (b) 방향을 뒤집어 응답 카드의 result 칸에서
  녹화본을 골라 온다.
- **결정**: (b).
- **이유**: 녹화본에서 출발하면 본문을 보는 순간 "새 줄을 만들까, 있는 줄을 바꿀까" 를 먼저 골라야
  하고, 그 선택은 설명을 붙여도 구체적이지 않았다. 채우고 있는 칸에서 출발하면 넣을 곳이 이미 정해져
  있어 설명이 필요 없다. 녹화본 쪽의 도구 · 인자 칸이 사라져, 그 칸이 녹화 URL 의 query 와 헷갈리던
  문제(U2)도 함께 없어진다.
- **결과**: 여러 호출을 한 패널에서 훑기와 녹화본에서 곧바로 새 줄 만들기를 잃는다. 새 줄은
  [응답 추가] 뒤 가져오기 두 번이다. 폼에 없는 도구를 이름만 채워 함께 만들던 동작도 없어졌다.
```

같은 파일 `## 배경` 첫 문단의 "녹화본은 편집 중 옆에 펴 두는 참고 패널이다." 를 "녹화본은 편집 중 응답 칸에서 골라 오는 곳이다(아래 추가 결정)." 로 바꾼다.

- [ ] **Step 2: changeset 을 고친다** — `.changeset/dashboard-mock-builder.md` 본문의 "편집 중에 녹화본 패널을 열어 외부 API 응답을 새 응답 줄로 넣거나 기존 줄의 `result` 로 넣을 수 있다." 를 다음으로 바꾼다.

```
응답 줄의 `result` 칸에서 녹화본의 외부 API 응답을 골라 채울 수 있다. 응답의 도구가 폼에 없거나 args 가 도구의 입력 필드와 어긋나면 그 줄에서 바로 말하고, 고친 뒤 화면을 떠나면 버릴지 묻는다.
```

- [ ] **Step 3: 설계와 구현을 맞춰 본다** — 설계 §사용 훑기 반영의 문장 여덟 가지(카드 머리 둘, args 셋, 도구 둘, 출처 하나)와 U7 확인 줄을 구현 파일에서 `grep -F` 로 하나씩 찾는다. 다르면 **설계를 기준으로** 구현을 고친다. 설계에 없던 문장(확인 "지금 적힌 result 를 이 본문으로 바꿉니다. 지금 값은 사라집니다.", 버튼 "녹화본 닫기" · "이걸로 채우기" · "버리고 이동")은 설계 U6 · U7 절에 한 줄씩 적어 넣는다.

- [ ] **Step 4: 보고** — 권장 커밋 둘:
  - `docs(adr): 녹화본을 응답 카드 안에서 고르기로 한 판단을 ADR-0101 에 덧붙인다` (ADR · 설계 · 이 계획서)
  - `chore(release): 목 만들기 changeset 에 사용 훑기 반영을 적는다`

---

## 최종 게이트 (메인 세션)

파이프 없이 종료 코드를 읽는다.

```bash
cd packages/dashboard
NODE_OPTIONS=--no-experimental-webstorage corepack pnpm test >/tmp/t.log 2>&1; echo $?   # 0, 로그에 서버 · 웹 Test Files … passed 두 줄
corepack pnpm typecheck; echo $?                                                       # 0
cd ../.. && corepack pnpm biome check .; echo $?                                       # 0, 검사 파일 수 확인
corepack pnpm vitest run --project e2e packages/dashboard; echo $?                     # 0
corepack pnpm --filter @mcpeak/dashboard build; echo $?                                # 0
grep -l "녹화본에서 가져오기" packages/dashboard/dist/web/assets/*.js                  # 비면 turbo 캐시 — tsdown 으로 직접 빌드
grep -rn "not implemented" packages/dashboard/web/src | wc -l                          # 0
```

그 뒤 사람이 연습 폴더(`~/mcpeak-mock-try`)에서 U1–U7 을 다시 밟고, 사용 훑기 가이드의 남은 항목(C-3 · D · E · F)을 잇는다.
