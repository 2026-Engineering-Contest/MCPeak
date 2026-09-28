# 대시보드 "목 만들기" 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대시보드에서 `mock.json` 을 새로 만들거나 기존 파일을 열어 고치고, 편집 중에 녹화본의 외부 API 응답을 골라 쓸 수 있게 한다.

**Architecture:** 서버에 라우트 넷을 더한다. `GET /api/sessions/<path>/interactions` 는 `loadSession` 으로 녹화본을 읽기만 한다. `GET /api/mocks` · `GET /api/mocks/<path>` · `PUT /api/mocks/<path>` 는 `assertMockDefinition` 으로 검증하고, 저장은 스위트 PUT 과 같은 경로(mtime 충돌 감지 · errno 문장)를 쓴다. 웹은 `@mcpeak/mock` 을 import 하지 않는다. 초안 ↔ 목 정의 변환 · 스키마 평면화 · body URL 세기는 순수 함수(`web/src/mock-builder/*.ts`)로 두고, 화면(첫 화면 → 편집 화면 + 녹화본 패널)은 그것을 부른다.

**Tech Stack:** TypeScript · Node `node:http` · React 19 · Vitest 4(jsdom, @testing-library/react) · `@mcpeak/record/external`(`loadSession`) · `@mcpeak/mock`(`assertMockDefinition`, 테스트의 `createMockServer`)

**설계 문서:** `docs/superpowers/specs/2026-09-28-dashboard-mock-builder-design.md`

## Global Constraints

- 작업 패키지: `dashboard` 하나. `mock` · `record` · `cli` · `core` 는 **읽기만** 한다. 한 PR 에서 다른 패키지를 건드리지 않는다.
- 녹화본은 `loadSession` 으로만 읽는다. SQLite 스키마를 직접 읽지 않는다. 서버 실행 · 재생 · 새 녹화를 하지 않는다.
- `mock.json` 형식을 바꾸지 않는다. 가져온 응답 본문은 가공 없이 `result` 에 들어간다. `content` 필드는 추가하지 않는다.
- 기존 파일에서 폼에 칸이 없는 키는 **버리지 않는다**(초안의 `extra` 로 들고 있다가 되돌려 쓴다).
- 새 의존: `"@mcpeak/mock": "workspace:*"` 하나(설계 §의존, ADR-0091 허용 방향). 그 밖의 의존 추가 금지.
- `web/` 은 `@mcpeak/mock` · `@mcpeak/record` 를 import 하지 않는다. 필요한 모양은 `src/api-types.ts` 나 web 쪽에 다시 적는다.
- 목 정의 오류 문장은 `assertMockDefinition` 의 문장을 그대로 쓴다. 새로 쓰지 않는다.
- 결정론: 같은 초안이면 저장 바이트가 같아야 한다. 시각 · 랜덤 · `toLocale*` · 타이머를 쓰지 않는다.
- 문자열 전문을 검사하는 단언은 `toBe` / `toEqual` 로 완전 일치를 건다. `toThrow("부분")` · `toContain` 으로 문장 계약을 걸지 않는다(CLAUDE.local.md §2).
- 화면에서 테스트가 전문으로 찾는 문장은 JSX 보간으로 쪼개지 말고 **템플릿 문자열 하나**로 렌더한다.
- 이 문서의 코드 블록은 biome 서식(줄 폭)을 다 맞추지 못했다. 태스크를 끝내기 전에 **자기 파일에만** `npx biome format --write <파일>` 과 `corepack pnpm biome check <파일>` 을 돌린다.
- `pnpm` 이 PATH 에 없을 수 있다. 명령은 `corepack pnpm …` 으로 적는다.
- 커밋 scope 는 `dashboard`(코드) · `adr`(ADR·설계·계획서) · `release`(changeset). `git add -A` 금지, 경로를 하나씩 적는다.
  워킹 트리의 `packages/mock/tests/stdio-e2e.test.ts` 미커밋 변경은 이 작업과 무관하다. **커밋에 섞지 않는다.**

---

## 착수 전 (사람이 한다)

1. 로컬 `main` 이 `origin/main` 보다 25 커밋 뒤다(2026-09-28 확인). `git pull --ff-only` 로 맞춘다.
   이 계획을 쓸 때 `dashboard` · `mock` · `record` 는 두 쪽이 같았다. 파일 경로와 줄 번호는 그 기준이다.
2. `dashboard` 는 공동 소유다(CONTRIBUTING §2.1). 설계 문서를 팀에 공유한다.
3. ADR 번호: `origin/main` 기준 마지막이 0100 이라 이 계획은 **0101** 을 쓴다. 병합 직전에 다시 확인한다.

## 모델 배분 (CLAUDE.local.md §1)

실패 문안 · 표시 억제 · 공개 타입은 **이 계획과 설계에서 확정했다**. 그래서 모든 태스크는 문안을 그대로
옮기는 구현이다 → **표준 모델**로 충분하다. 최종 계약 · 회귀 검토만 상위 모델이 한다.

## 확정한 판단 (설계가 계획에 넘긴 것)

| 항목 | 결정 | 이유 |
|---|---|---|
| 덮어쓰기 확인 | `PUT /api/mocks` 본문은 스위트 PUT 과 같은 `PutFileRequest { content, baseMtimeMs }`. 새 목은 `baseMtimeMs: 0`, 기존 목은 열 때 받은 mtime, 저장에 성공하면 그 경로 · 새 mtime 이 기준이 된다. | `writeFileContent` 가 "없는 파일은 충돌이 아님" 규칙을 이미 갖고 있다. 존재 확인용 요청이 따로 필요 없다. 본문이 문자열이라 저장 바이트를 웹의 `serializeMockDefinition` 이 정한다(결정론). |
| 충돌 문구 | 기준 mtime 이 0 이면 `이미 파일이 있습니다 — …`, 아니면 `이 파일이 불러온 뒤에 바뀌었습니다 — …`. | 불러온 파일에 "이미 있다" 라고 하면 사용자는 당연하다고 넘기고 남의 변경을 덮어쓴다. |
| 진입점 | 사이드바 항목 **Mock**(`#/mock`), Replay 와 Repair 사이. | 홈에는 카드 그리드가 없다(#459 이후 내비는 사이드바 한 곳). |
| 목 목록 | `.json` 중 `assertMockDefinition` 통과. `tools` 만 있는 픽스처도 나온다. | 스위트 목록과 같은 방식. 픽스처도 유효한 목 정의라 여는 것이 맞다. |
| 보존 키 | 도구 · 응답 · 최상위의 모르는 키는 초안 `extra` 에 담아 알려진 키 **뒤에** 원래 순서로 되돌려 쓴다. 도구 `description` 은 폼에 칸을 둔다. | 조용히 사라지면 사용자는 저장 뒤에야 안다. |
| 정규화 | 들여쓰기 2칸 · 끝 줄바꿈 하나 · 알려진 키 순서 고정 · `isError: false` 와 빈 `description` 은 뺀다 · 평면 스키마는 `{ type, properties, required? }` 로 다시 쓴다. | 원본 서식 보존은 문자열 단위 편집이 필요해 비용이 크다. 의미는 같고, 두 번째 저장부터는 바이트가 같다(멱등). |
| body URL 세기 | 문자열 **전체**가 `http:`/`https:` 절대 URL 인 값만, **서로 다른 값의 개수**. 키는 보지 않는다. 경고는 `origin: "recording"` 응답에만. | record 의 녹화 때 판정(`runtime.mjs` 의 `absoluteHttpUrl`, ADR-0062)과 같아야 화면과 녹화 요약이 같은 수를 말한다. |
| 강조 | 녹화본에서 가져온 응답 줄은 **다음 편집 전까지** 강조한다(타이머 없음). | 타이머는 결정론 원칙에 어긋나고 테스트가 시간을 기다려야 한다. |
| 왕복 테스트 | 저장한 파일을 `createMockServer`(HTTP, 포트 0)에 넣고 `core.connect({ url })` 로 본다. `*-e2e.test.ts` 라 직렬 갈래다. | `mcpeak-mock` bin 을 띄우려면 mock 패키지의 테스트 전용 로더나 빌드된 `dist` 가 필요하다. CI verify 잡은 빌드 없이 돈다. 정의 해석 경로(`assertMockDefinition` → `seed` → `buildServer`)는 stdio 와 같다. `cli/tests/http-remote-e2e.test.ts` 가 같은 방식을 쓴다. |

## 남는 위험 (이 계획이 해결하지 않는 것)

- `assertMockDefinition` 은 **같은 도구 · 같은 args 응답이 두 줄**인 것을 거르지 않는다. 대시보드는 저장하고, `mcpeak-mock` 은 뜰 때(`seed` → `put`) 거절한다. **mock 오너에게 이슈로 넘긴다.** 대시보드에서 매칭 키 규칙을 다시 구현하지 않는다.
- 보존 키 중 `outputSchema` 는 목 서버가 그대로 내보내면 SDK 클라이언트가 구조화 응답을 요구할 수 있다. 목의 동작이지 대시보드가 바꾸는 것이 아니다. 왕복 E2E 는 `outputSchema` 대신 `annotations` 로 보존을 검증한다.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `packages/dashboard/src/api-types.ts` (수정) | `JsonValue` · `SessionInteractionEntry` · `MockFileEntry` |
| `packages/dashboard/src/server/files.ts` (수정) | `readSessionInteractions`, `listMocks` |
| `packages/dashboard/src/server/routes.ts` (수정) | 라우트 넷, PUT 규칙 공통화 |
| `packages/dashboard/package.json` · `pnpm-lock.yaml` (수정) | `@mcpeak/mock` 의존 |
| `packages/dashboard/tests/session-interactions.test.ts` (신규) | `readSessionInteractions` 세 갈래 |
| `packages/dashboard/tests/routes.test.ts` (수정) | 라우트 HTTP 계약 |
| `packages/dashboard/tests/mock-builder-e2e.test.ts` (신규) | 새 목 · 기존 목 왕복, 바이트 결정론 |
| `packages/dashboard/web/src/mock-builder/schema-fields.ts` (신규) | 평면 입력 필드 ↔ `inputSchema` |
| `packages/dashboard/web/src/mock-builder/draft.ts` (신규) | 초안 타입 · 조립 · 직렬화 · 녹화 응답 넣기 · 경로 |
| `packages/dashboard/web/src/mock-builder/from-definition.ts` (신규) | 목 정의 파일 → 초안 |
| `packages/dashboard/web/src/mock-builder/body-urls.ts` (신규) | body URL 세기와 경고 문장 |
| `packages/dashboard/web/src/mock-builder/interactions.ts` (신규) | 외부 호출 한 건 → 표시 · 선택 가능 여부 |
| `packages/dashboard/web/src/mock-builder/ToolEditor.tsx` · `ResponseEditor.tsx` (신규) | 도구 · 응답 한 줄 편집 |
| `packages/dashboard/web/src/mock-builder/RecordingPanel.tsx` (신규) | 편집 중 옆에 펴는 녹화본 패널 |
| `packages/dashboard/web/src/mock-builder/MockStart.tsx` (신규) | 첫 화면(새로 만들기 · 기존 목 수정) |
| `packages/dashboard/web/src/screens/MockBuilder.tsx` (신규) | 화면 조립 · 저장 · 덮어쓰기 확인 · 처음으로 |
| `packages/dashboard/web/src/App.tsx` · `components/Sidebar.tsx` (수정) | `#/mock` 라우트 · 내비 항목 |
| `packages/dashboard/web/tests/*.test.ts(x)` (신규 9 · 수정 1) | 위 모듈별 |
| `docs/adr/0101-…md` · `.changeset/dashboard-mock-builder.md` (신규) | 판단 기록 · 릴리스 |

## 웨이브

| 웨이브 | 태스크 | 비고 |
|---|---|---|
| W1 (서버) | T1 → T2 → T3 | 셋 다 `routes.ts` 를 고친다. **직렬.** |
| W2 (웹 순수 함수) | T4 → T5 → T6 → T7 | 앞 태스크의 타입을 쓴다. |
| W3 (웹 화면) | T8 → T9 → T10 → T11 | |
| W4 (E2E, 직렬 전용) | T12 | 실제 HTTP 서버를 띄운다. 유닛과 같은 웨이브에 두지 않는다. |
| W5 | T13 | 문서 · changeset · 패키지 게이트 |

웨이브 사이에서 사람이 통합 SHA 를 확인한다(CLAUDE.local.md §3).

---

### Task 1: 녹화본의 외부 호출 목록 API

**Files:**
- Modify: `packages/dashboard/src/api-types.ts` (파일 끝에 추가)
- Modify: `packages/dashboard/src/server/files.ts` (import, `listSessions` 아래에 추가)
- Modify: `packages/dashboard/src/server/routes.ts` (import, `handleRequest` 분기, 새 핸들러)
- Create: `packages/dashboard/tests/session-interactions.test.ts`
- Modify: `packages/dashboard/tests/routes.test.ts` (import, 파일 끝 describe)

**Interfaces:**
- Consumes: `loadSession(path): SessionSnapshot | null`, `StoredInteraction`(`@mcpeak/record/external`), `resolveProjectPath(root, relative): string | null`
- Produces:
  - `type JsonValue`, `interface SessionInteractionEntry` (api-types)
  - `readSessionInteractions(absolute: string): Promise<SessionInteractionEntry[] | null>` (files.ts)
  - HTTP `GET /api/sessions/<encodeURIComponent(path)>/interactions` → 200 `SessionInteractionEntry[]` | 400 | 404

- [ ] **Step 1: 타입을 추가한다**

`packages/dashboard/src/api-types.ts` 끝에 붙인다.

```ts
/**
 * JSON 값. record 의 `JsonValue` 와 같은 모양이지만 여기서 다시 적는다 — web 이
 * `@mcpeak/record` 를 import 하지 않기 때문이다(`SessionEntry.status` 와 같은 이유).
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * GET /api/sessions/<path>/interactions — 녹화본 하나의 외부 호출 한 건.
 *
 * 녹화본은 `loadSession` 으로 **읽기만** 한다. 서버를 띄우거나 재생하지 않는다. 싣는 것은
 * 목의 답을 고르는 데 필요한 것뿐이다 — 응답 헤더와 `statusText` 는 싣지 않는다.
 */
export interface SessionInteractionEntry {
  /** 녹화 순서. 목록 정렬 키이자 식별자. */
  readonly ordinal: number;
  readonly method: string;
  /** 경로가 지워진 표시용 URL(`HttpDisplayV1.url`). 녹화 때 값 그대로다. */
  readonly url: string;
  readonly outcome:
    | { readonly kind: "response"; readonly status: number; readonly body: JsonValue }
    | { readonly kind: "throw"; readonly failureKind: string; readonly code?: string }
    | { readonly kind: "incomplete" };
}
```

- [ ] **Step 2: 실패하는 단위 테스트를 쓴다**

`packages/dashboard/tests/session-interactions.test.ts`:

```ts
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteSessionStore } from "@mcpeak/record/external";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSessionInteractions } from "../src/server/files.js";

/**
 * 녹화본 하나의 외부 호출 목록. 판정은 `loadSession` 이 하고, 여기서 보는 것은 세 갈래
 * (응답 · fetch 실패 · 끝나지 않은 호출)를 화면이 쓸 모양으로 옮기는지다.
 */

const request = (matchKey: string, url: string) => ({
  protocol: "http" as const,
  interactionSchemaVersion: 1 as const,
  matchKey,
  display: { method: "GET", url, headers: {}, body: { kind: "none" as const } },
});

/** 응답 · throw · incomplete 를 하나씩 담은 세션. 닫아야 Windows 에서 지울 수 있다. */
function writeThreeWaySession(path: string): void {
  const store = createSqliteSessionStore({ path });
  store.createSession("default");
  const ok = store.reserve({
    sessionId: "default",
    request: request("ok", "https://api.open-meteo.com/<redacted>?city=Seoul"),
  });
  store.complete({
    sessionId: "default",
    interactionId: ok.interactionId,
    outcome: {
      kind: "response",
      status: 200,
      statusText: "OK",
      headers: [["content-type", "application/json"]] as const,
      // 표시용 url 과 **다른** 값이다. 화면에 나가는 것이 display.url 인지 여기서 갈린다.
      url: "https://api.open-meteo.com/v1/forecast?city=Seoul",
      body: { temperature: 21.5, source: "https://api.open-meteo.com/docs" },
    },
  });
  const failed = store.reserve({
    sessionId: "default",
    request: request("dns", "https://nowhere.invalid/<redacted>"),
  });
  store.complete({
    sessionId: "default",
    interactionId: failed.interactionId,
    outcome: { kind: "throw", failureKind: "dns", name: "TypeError", code: "ENOTFOUND" },
  });
  // complete 를 부르지 않는다 — 녹화가 끊긴 호출의 모양이다.
  store.reserve({ sessionId: "default", request: request("cut", "https://api.example.com/<redacted>") });
  store.close();
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mcpeak-dashboard-interactions-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("readSessionInteractions", () => {
  it("응답 · fetch 실패 · 끝나지 않은 호출을 녹화 순서대로 옮긴다", async () => {
    const path = join(root, "weather.session.db");
    writeThreeWaySession(path);

    expect(await readSessionInteractions(path)).toEqual([
      {
        ordinal: 0,
        method: "GET",
        url: "https://api.open-meteo.com/<redacted>?city=Seoul",
        outcome: {
          kind: "response",
          status: 200,
          body: { temperature: 21.5, source: "https://api.open-meteo.com/docs" },
        },
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
    ]);
  });

  it("code 가 없는 throw 에는 code 키가 없다", async () => {
    const path = join(root, "abort.session.db");
    const store = createSqliteSessionStore({ path });
    store.createSession("default");
    const reservation = store.reserve({
      sessionId: "default",
      request: request("abort", "https://api.example.com/<redacted>"),
    });
    store.complete({
      sessionId: "default",
      interactionId: reservation.interactionId,
      outcome: { kind: "throw", failureKind: "abort", name: "AbortError" },
    });
    store.close();

    const [entry] = (await readSessionInteractions(path)) ?? [];
    expect(entry?.outcome).toEqual({ kind: "throw", failureKind: "abort" });
    expect(entry !== undefined && "code" in entry.outcome).toBe(false);
  });

  it("세션이 아닌 파일이면 null 이다", async () => {
    const path = join(root, "notes.db");
    await writeFile(path, "not a database", "utf8");
    expect(await readSessionInteractions(path)).toBeNull();
  });

  it("없는 파일이면 null 이고 파일을 만들지 않는다", async () => {
    const path = join(root, "missing.db");
    expect(await readSessionInteractions(path)).toBeNull();
    await expect(stat(path)).rejects.toThrow();
  });
});
```

`ordinal` 이 0 부터인 것은 record 의 `reserve` 가 `session.interactions.length` 로 매기기 때문이다(`packages/record/src/external/session-store.ts:293`). Step 5 에서 다르게 나오면 record 의 실제 값에 맞춰 기대값을 고치고 보고한다.

- [ ] **Step 3: 실패를 확인한다**

Run: `corepack pnpm vitest run packages/dashboard/tests/session-interactions.test.ts`
Expected: FAIL — `readSessionInteractions` 가 export 되지 않았다(`is not a function`)

- [ ] **Step 4: `readSessionInteractions` 를 구현한다**

`packages/dashboard/src/server/files.ts` 의 api-types import 를 바꾸고, 그 위에 record 타입 import 를 둔다.

```ts
import type { StoredInteraction } from "@mcpeak/record/external";
import type {
  FileContent,
  FileEntry,
  PutFileResponse,
  ServerCandidate,
  SessionEntry,
  SessionInteractionEntry,
} from "../api-types.js";
```

(`import type` 이라 `node:sqlite` 를 로드하지 않는다. 런타임 로딩은 기존 `loadExternal` 이 한다.)

`listSessions` 바로 아래에 추가한다.

```ts
/** 저장된 결과 → 화면 모양. 결과가 없거나 끝나지 않은 호출은 `incomplete` 다. */
function toEntryOutcome(interaction: StoredInteraction): SessionInteractionEntry["outcome"] {
  const outcome = interaction.outcome;
  if (interaction.status === "incomplete" || outcome === undefined) return { kind: "incomplete" };
  if (outcome.kind === "response") {
    return { kind: "response", status: outcome.status, body: outcome.body };
  }
  return {
    kind: "throw",
    failureKind: outcome.failureKind,
    ...(outcome.code === undefined ? {} : { code: outcome.code }),
  };
}

/**
 * 녹화본 하나의 외부 호출 목록. 세션이 아니면 `null` 이다(호출부가 404 로 옮긴다).
 *
 * 판정은 `listSessions` 처럼 `loadSession` 에 맡긴다. URL 은 녹화 때 경로를 지운 표시용
 * 값(`request.display.url`)을 쓴다 — 응답의 `url` 은 지우지 않은 값일 수 있다.
 */
export async function readSessionInteractions(
  absolute: string,
): Promise<SessionInteractionEntry[] | null> {
  const { loadSession } = await loadExternal();
  const snapshot = loadSession(absolute);
  if (snapshot === null) return null;
  return snapshot.interactions
    .map(
      (interaction): SessionInteractionEntry => ({
        ordinal: interaction.ordinal,
        method: interaction.request.display.method,
        url: interaction.request.display.url,
        outcome: toEntryOutcome(interaction),
      }),
    )
    .sort((a, b) => a.ordinal - b.ordinal);
}
```

- [ ] **Step 5: 단위 테스트 통과를 확인한다**

Run: `corepack pnpm vitest run packages/dashboard/tests/session-interactions.test.ts`
Expected: PASS, `Test Files  1 passed`

- [ ] **Step 6: 실패하는 라우트 테스트를 쓴다**

`packages/dashboard/tests/routes.test.ts` 상단 import 에 추가한다.

```ts
import { createSqliteSessionStore } from "@mcpeak/record/external";
```

파일 끝에 붙인다(기존 `startTestServer` · `server` 변수 · `afterEach` 를 그대로 쓴다. `mkdir` · `writeFile` · `join` 은 이미 import 돼 있다).

```ts
/** 완료된 응답 하나짜리 세션을 만든다. */
function writeOneResponseSession(path: string): void {
  const store = createSqliteSessionStore({ path });
  store.createSession("default");
  const reservation = store.reserve({
    sessionId: "default",
    request: {
      protocol: "http",
      interactionSchemaVersion: 1,
      matchKey: "a",
      display: {
        method: "GET",
        url: "https://api.open-meteo.com/<redacted>?city=Seoul",
        headers: {},
        body: { kind: "none" },
      },
    },
  });
  store.complete({
    sessionId: "default",
    interactionId: reservation.interactionId,
    outcome: {
      kind: "response",
      status: 200,
      statusText: "OK",
      headers: [],
      url: "https://api.open-meteo.com/v1/forecast?city=Seoul",
      body: { temperature: 21.5 },
    },
  });
  store.finish("default", "completed");
  store.close();
}

describe("GET /api/sessions/<path>/interactions", () => {
  it("녹화본의 외부 호출 목록을 준다", async () => {
    server = await startTestServer();
    await mkdir(join(server.root, "recordings"));
    writeOneResponseSession(join(server.root, "recordings", "weather.session.db"));

    const response = await fetch(
      `${server.baseUrl}/api/sessions/${encodeURIComponent("recordings/weather.session.db")}/interactions`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        ordinal: 0,
        method: "GET",
        url: "https://api.open-meteo.com/<redacted>?city=Seoul",
        outcome: { kind: "response", status: 200, body: { temperature: 21.5 } },
      },
    ]);
  });

  it("세션이 아닌 파일이면 404 와 고칠 방법을 말하는 문장 전문을 준다", async () => {
    server = await startTestServer();
    await writeFile(join(server.root, "weather.session.db"), "not a database", "utf8");

    const response = await fetch(
      `${server.baseUrl}/api/sessions/${encodeURIComponent("weather.session.db")}/interactions`,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: [
        "→ 이 녹화본을 읽을 수 없습니다 — weather.session.db",
        "→ MCPeak 이 녹화한 세션 파일인지 확인하세요. 목록에는 읽을 수 있는 파일만 나옵니다.",
      ].join("\n"),
    });
  });

  it("경로 탈출은 400 이다", async () => {
    server = await startTestServer();
    const response = await fetch(
      `${server.baseUrl}/api/sessions/${encodeURIComponent("../outside.db")}/interactions`,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "허용되지 않는 경로입니다." });
  });
});
```

- [ ] **Step 7: 실패를 확인한다**

Run: `corepack pnpm vitest run packages/dashboard/tests/routes.test.ts -t "interactions"`
Expected: FAIL — 세 테스트 모두 404 `그런 경로가 없습니다: GET /api/sessions/...`

- [ ] **Step 8: 라우트를 구현한다**

`routes.ts` 의 files import 에 `readSessionInteractions` 를 넣는다(알파벳 순서, `readFileContent` 다음).

`RUN_FLOWS` 아래에 상수를 둔다.

```ts
const INTERACTIONS_SUFFIX = "/interactions";
```

`handleRequest` 의 `GET /api/sessions` 분기 **바로 아래**에 넣는다.

```ts
  if (
    method === "GET" &&
    pathname.startsWith("/api/sessions/") &&
    pathname.endsWith(INTERACTIONS_SUFFIX)
  ) {
    await handleGetInteractions(
      response,
      options.root,
      decodeParam(pathname.slice(0, -INTERACTIONS_SUFFIX.length), "/api/sessions/"),
    );
    return;
  }
```

`handleGetFile` 아래에 핸들러를 추가한다.

```ts
/**
 * 녹화본 하나의 외부 호출 목록. 녹화본은 읽기만 한다 — 서버를 띄우거나 재생하지 않는다.
 * 세션이 아닌 파일은 404 다. 목록(`/api/sessions`)에는 안 나오는 파일을 손으로 친 경우다.
 */
async function handleGetInteractions(
  response: ServerResponse,
  root: string,
  relativeOrNull: string | null,
): Promise<void> {
  if (relativeOrNull === null) {
    sendJson(response, 400, { error: "경로를 해석할 수 없습니다." });
    return;
  }
  const absolute = resolveProjectPath(root, relativeOrNull);
  if (absolute === null) {
    sendJson(response, 400, { error: "허용되지 않는 경로입니다." });
    return;
  }
  const interactions = await readSessionInteractions(absolute);
  if (interactions === null) {
    sendJson(response, 404, {
      error: [
        `→ 이 녹화본을 읽을 수 없습니다 — ${relativeOrNull}`,
        "→ MCPeak 이 녹화한 세션 파일인지 확인하세요. 목록에는 읽을 수 있는 파일만 나옵니다.",
      ].join("\n"),
    });
    return;
  }
  sendJson(response, 200, interactions);
}
```

- [ ] **Step 9: 통과를 확인한다**

Run: `corepack pnpm vitest run packages/dashboard/tests/routes.test.ts packages/dashboard/tests/session-interactions.test.ts`
Expected: PASS, `Test Files  2 passed`. 기존 routes 테스트도 전부 통과.

- [ ] **Step 10: 타입체크**

Run: `corepack pnpm --filter @mcpeak/dashboard typecheck >/dev/null 2>&1; echo $?`
Expected: `0`

- [ ] **Step 11: 커밋**

```bash
git add packages/dashboard/src/api-types.ts packages/dashboard/src/server/files.ts \
  packages/dashboard/src/server/routes.ts packages/dashboard/tests/session-interactions.test.ts \
  packages/dashboard/tests/routes.test.ts
git commit -m "feat(dashboard): 녹화본 하나의 외부 호출 목록을 읽는 API 를 둔다"
```

---

### Task 2: 목 정의 저장 API (`PUT /api/mocks/<path>`)

**Files:**
- Modify: `packages/dashboard/package.json` (`dependencies`)
- Modify: `pnpm-lock.yaml` (install 결과)
- Modify: `packages/dashboard/src/server/routes.ts`
- Modify: `packages/dashboard/tests/routes.test.ts`

**Interfaces:**
- Consumes: `assertMockDefinition(value: unknown, source?: string): asserts value is MockDefinition`(`@mcpeak/mock`), `writeFileContent(absolute, content, baseMtimeMs): Promise<PutFileResponse>`, `PutFileRequest`
- Produces:
  - HTTP `PUT /api/mocks/<encodeURIComponent(path)>`, 본문 `PutFileRequest` → 200 `PutFileResponse` | 400 `ApiError`. 없는 파일은 `baseMtimeMs` 와 무관하게 저장, 있는 파일은 mtime 이 같을 때만 저장, 다르면 200 `{ saved:false, reason:"conflict", mtimeMs }`.
  - `validateMockContent(content: string, relative: string): string | null` (routes.ts 내부, T3 가 재사용)
  - `VALID_MOCK` 테스트 상수 (routes.test.ts, T3 가 재사용)

- [ ] **Step 1: 의존을 추가한다**

`packages/dashboard/package.json` 의 `dependencies` 를 이렇게 바꾼다.

```json
  "dependencies": {
    "@mcpeak/core": "workspace:*",
    "@mcpeak/generate": "workspace:*",
    "@mcpeak/mock": "workspace:*",
    "@mcpeak/record": "workspace:*",
    "@mcpeak/runner": "workspace:*",
    "@mcpeak/cli": "workspace:*"
  },
```

Run: `corepack pnpm install`
Expected: 성공. `git diff --stat pnpm-lock.yaml` 에 dashboard importer 의 `@mcpeak/mock` 링크만 늘어난다. 다른 버전이 바뀌었으면 멈추고 보고한다.

이 시점에 의존 경계 테스트는 **실패해야 정상이다**(선언했는데 import 0 건, #421 이 뺀 이유).

Run: `corepack pnpm vitest run packages/dashboard/tests/dependency-boundary.test.ts`
Expected: FAIL — `dashboard의 내부 의존 선언은 실제 소스 import와 정확히 일치한다` 에서 `mock` 이 한쪽에만 있다.

- [ ] **Step 2: 실패하는 라우트 테스트를 쓴다**

`routes.test.ts` 파일 끝에 붙인다.

```ts
async function putMock(
  server: TestServer,
  path: string,
  content: string,
  baseMtimeMs = 0,
): Promise<Response> {
  return fetch(`${server.baseUrl}/api/mocks/${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content, baseMtimeMs }),
  });
}

const VALID_MOCK = {
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
  responses: [{ tool: "get_weather", args: { city: "Seoul" }, result: { temperature: 21.5 } }],
};

/** `responses[0]` 의 도구가 tools 에 없는 정의와, 그것을 `path` 로 저장할 때의 문장 전문. */
const INVALID_MOCK = { tools: VALID_MOCK.tools, responses: [{ tool: "nope", result: {} }] };
const invalidMockMessage = (path: string): string =>
  [
    `→ 올바르지 않은 목 정의입니다 — ${path}: responses[0] 의 툴 'nope' 이 tools 에 없습니다. 있는 툴: get_weather`,
    '→ 형식: { "tools": [ { "name": ..., "inputSchema": ... } ], "responses": [ { "tool": ..., "result": ... } ] }',
  ].join("\n");

describe("PUT /api/mocks/<path>", () => {
  it("올바른 목 정의를 content 바이트 그대로 저장한다", async () => {
    server = await startTestServer();
    const content = `${JSON.stringify(VALID_MOCK, null, 2)}\n`;

    const response = await putMock(server, "weather.mock.json", content);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ saved: true });
    await expect(readFile(join(server.root, "weather.mock.json"), "utf8")).resolves.toBe(content);
  });

  it("잘못된 정의면 400 과 assertMockDefinition 문장 전문을 주고 파일을 만들지 않는다", async () => {
    server = await startTestServer();
    await mkdir(join(server.root, "mocks"));

    const response = await putMock(server, "mocks/bad.mock.json", JSON.stringify(INVALID_MOCK));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: invalidMockMessage("mocks/bad.mock.json") });
    await expect(stat(join(server.root, "mocks", "bad.mock.json"))).rejects.toThrow();
  });

  it("content 가 JSON 이 아니면 400 이다", async () => {
    server = await startTestServer();
    const response = await putMock(server, "weather.mock.json", "{ tools: ");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "본문 content가 올바른 JSON이 아닙니다." });
  });

  it("이미 있는 파일은 baseMtimeMs 가 현재 mtime 과 같을 때만 덮어쓴다", async () => {
    server = await startTestServer();
    const target = join(server.root, "weather.mock.json");
    const original = '{"tools":[]}\n';
    await writeFile(target, original, "utf8");
    const before = await stat(target);
    const content = `${JSON.stringify(VALID_MOCK, null, 2)}\n`;

    // 새 목은 0 을 보낸다. 있는 파일이면 충돌로 돌아와야 확인을 받을 수 있다.
    const first = await putMock(server, "weather.mock.json", content, 0);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      saved: false,
      reason: "conflict",
      mtimeMs: before.mtimeMs,
    });
    await expect(readFile(target, "utf8")).resolves.toBe(original);

    const second = await putMock(server, "weather.mock.json", content, before.mtimeMs);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ saved: true });
    await expect(readFile(target, "utf8")).resolves.toBe(content);
  });

  it(".json 이 아니면 거절하고 파일을 만들지 않는다", async () => {
    server = await startTestServer();
    const response = await putMock(server, "weather.mock.txt", JSON.stringify(VALID_MOCK));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "목 정의는 .json 확장자 파일만 저장할 수 있습니다.",
    });
    await expect(stat(join(server.root, "weather.mock.txt"))).rejects.toThrow();
  });

  it("경로 탈출을 거절한다", async () => {
    server = await startTestServer();
    const response = await putMock(server, "../outside.mock.json", JSON.stringify(VALID_MOCK));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "허용되지 않는 경로입니다." });
    await expect(stat(join(server.root, "..", "outside.mock.json"))).rejects.toThrow();
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `corepack pnpm vitest run packages/dashboard/tests/routes.test.ts -t "PUT /api/mocks"`
Expected: FAIL — 6 건 모두 404 `그런 경로가 없습니다: PUT /api/mocks/...`

- [ ] **Step 4: PUT 규칙을 공통화하고 목 규칙을 더한다**

`routes.ts` 상단 import 에 추가한다.

```ts
import { assertMockDefinition } from "@mcpeak/mock";
```

`handleRequest` 의 `PUT /api/suites/` 분기를 바꾸고 바로 아래에 목 분기를 둔다.

```ts
  if (method === "PUT" && pathname.startsWith("/api/suites/")) {
    await handlePutFile(
      request,
      response,
      options.root,
      decodeParam(pathname, "/api/suites/"),
      SUITE_PUT_RULES,
    );
    return;
  }
  if (method === "PUT" && pathname.startsWith("/api/mocks/")) {
    await handlePutFile(
      request,
      response,
      options.root,
      decodeParam(pathname, "/api/mocks/"),
      MOCK_PUT_RULES,
    );
    return;
  }
```

`handlePutFile` 전체를 아래로 바꾼다. 스위트 쪽 동작과 문장은 그대로다.

```ts
/**
 * 파일 PUT 의 종류별 규칙. 스위트와 목 정의가 **같은 저장 경로**(mtime 충돌 감지 · errno
 * 문장)를 쓴다 — 두 벌이면 한쪽만 고쳐지는 날이 온다. 다른 것은 확장자 안내와 내용 검증뿐이다.
 */
interface PutRules {
  readonly extensionError: string;
  /** 저장해도 되면 `null`, 아니면 사용자에게 그대로 보일 문장. */
  validate(content: string, relative: string): string | null;
}

const SUITE_PUT_RULES: PutRules = {
  extensionError: "스위트는 .json 확장자 파일만 저장할 수 있습니다.",
  validate: (content) => validateSuiteContent(content),
};

const MOCK_PUT_RULES: PutRules = {
  extensionError: "목 정의는 .json 확장자 파일만 저장할 수 있습니다.",
  validate: validateMockContent,
};

async function handlePutFile(
  request: IncomingMessage,
  response: ServerResponse,
  root: string,
  relativeOrNull: string | null,
  rules: PutRules,
): Promise<void> {
  if (relativeOrNull === null) {
    sendJson(response, 400, { error: "경로를 해석할 수 없습니다." });
    return;
  }
  const absolute = resolveProjectPath(root, relativeOrNull);
  if (absolute === null) {
    sendJson(response, 400, { error: "허용되지 않는 경로입니다." });
    return;
  }
  if (!relativeOrNull.toLowerCase().endsWith(".json")) {
    sendJson(response, 400, { error: rules.extensionError });
    return;
  }
  const body = await readJsonBody<Partial<PutFileRequest>>(request);
  if (body === undefined) {
    sendJson(response, 400, { error: "본문이 올바른 JSON이 아닙니다." });
    return;
  }
  if (typeof body.content !== "string" || typeof body.baseMtimeMs !== "number") {
    sendJson(response, 400, { error: "content·baseMtimeMs가 필요합니다." });
    return;
  }
  const validationError = rules.validate(body.content, relativeOrNull);
  if (validationError !== null) {
    sendJson(response, 400, { error: validationError });
    return;
  }
  try {
    const result = await writeFileContent(absolute, body.content, body.baseMtimeMs);
    sendJson(response, 200, result);
  } catch (error) {
    const message = writeErrorMessage(error);
    if (message !== null) {
      sendJson(response, 400, { error: message });
      return;
    }
    throw error;
  }
}
```

기존 `validateFileContent` 를 아래 두 함수로 바꾼다(이름 변경 + `async` 제거 — 안에 `await` 가 없었다).

```ts
function validateSuiteContent(content: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return "본문 content가 올바른 JSON이 아닙니다.";
  }
  return validateMcpSuite(parsed).valid ? null : "본문 content가 올바른 MCP 스위트가 아닙니다.";
}

/**
 * 목 정의 검증은 `@mcpeak/mock` 의 `assertMockDefinition` 에 맡기고 **문장을 새로 쓰지 않는다.**
 * 대시보드와 `mcpeak-mock` 이 같은 파일에 다른 말을 하면 사용자가 둘을 잇지 못한다.
 * `source` 로 경로를 넘겨 문장이 어느 파일인지 말하게 한다.
 *
 * 같은 도구 · 같은 args 응답이 두 줄인 것은 여기서 걸리지 않는다. 그 검사는 목이 뜰 때
 * (`seed`) 한다 — 계획서 "남는 위험".
 */
function validateMockContent(content: string, relative: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return "본문 content가 올바른 JSON이 아닙니다.";
  }
  try {
    assertMockDefinition(parsed, relative);
    return null;
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `corepack pnpm vitest run packages/dashboard/tests/routes.test.ts packages/dashboard/tests/dependency-boundary.test.ts`
Expected: PASS, `Test Files  2 passed`. 스위트 PUT 기존 테스트 포함 전부 통과. 의존 경계는 이제 import 가 생겨 통과한다.

- [ ] **Step 6: 회귀 증명 — 문장 전문 단언이 실제로 경로를 보는지**

스크래치패드에 `routes.ts` 를 `cp` 로 백업한다. `validateMockContent` 의 `assertMockDefinition(parsed, relative)` 를 `assertMockDefinition(parsed)` 로 잠깐 바꾼다.

Run: `corepack pnpm vitest run packages/dashboard/tests/routes.test.ts -t "잘못된 정의면"`
Expected: FAIL — 받은 문장이 `→ 올바르지 않은 목 정의입니다 — 목 정의: …` 다.

백업을 `cp` 로 되돌리고 같은 명령이 PASS 인지 본다.

- [ ] **Step 7: 타입체크 · 빌드 산출물**

Run: `corepack pnpm --filter @mcpeak/dashboard typecheck >/dev/null 2>&1; echo $?`
Expected: `0`

Run: `(cd packages/dashboard && npx tsdown --config-loader native >/dev/null) && grep -l "@mcpeak/mock" packages/dashboard/dist/*.mjs`
Expected: 파일 하나 이상 — `@mcpeak/mock` 이 external import 로 남았다. tsdown 이 공통 청크(`src-<hash>.mjs`)로 쪼개므로 `index.mjs` 만 보면 0 이다. 청크에 `function assertMockDefinition` 이 있으면 인라인된 것이니 멈추고 보고한다.

- [ ] **Step 8: 커밋**

```bash
git add packages/dashboard/package.json pnpm-lock.yaml packages/dashboard/src/server/routes.ts \
  packages/dashboard/tests/routes.test.ts
git commit -m "feat(dashboard): 목 정의를 assertMockDefinition 으로 검증해 저장하는 API 를 둔다"
```

---

### Task 3: 목 정의 목록 · 읽기 API (`GET /api/mocks`, `GET /api/mocks/<path>`)

**Files:**
- Modify: `packages/dashboard/src/api-types.ts` (파일 끝)
- Modify: `packages/dashboard/src/server/files.ts` (import, `listSuites` 아래)
- Modify: `packages/dashboard/src/server/routes.ts`
- Modify: `packages/dashboard/tests/routes.test.ts` (파일 끝)

**Interfaces:**
- Consumes: `assertMockDefinition`, `MockDefinition`(`@mcpeak/mock`), `readFileContent(root, absolute): Promise<FileContent>`, `validateMockContent` (T2), `VALID_MOCK` · `INVALID_MOCK` · `invalidMockMessage` (T2 테스트)
- Produces:
  - `interface MockFileEntry { path: string; toolCount: number; responseCount: number }` (api-types)
  - `listMocks(root: string): Promise<MockFileEntry[]>` (files.ts)
  - HTTP `GET /api/mocks` → 200 `MockFileEntry[]`(경로순)
  - HTTP `GET /api/mocks/<encodeURIComponent(path)>` → 200 `FileContent` | 400(경로 · 무효 정의 문장 전문) | 404 `파일을 찾을 수 없습니다.`

- [ ] **Step 1: 타입을 추가한다**

`api-types.ts` 끝에 붙인다.

```ts
/**
 * GET /api/mocks — 목 정의 파일 한 건. `assertMockDefinition` 을 통과한 `.json` 만 나온다.
 * `tools` 만 있는 픽스처 파일도 유효한 목 정의라 함께 나온다.
 */
export interface MockFileEntry {
  /** 루트 기준 상대경로(`/` 구분). */
  readonly path: string;
  readonly toolCount: number;
  readonly responseCount: number;
}
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`routes.test.ts` 파일 끝에 붙인다.

```ts
describe("GET /api/mocks", () => {
  it("유효한 목 정의만 경로순으로 도구 · 응답 수와 함께 싣는다", async () => {
    server = await startTestServer();
    await mkdir(join(server.root, "mocks"));
    await writeFile(join(server.root, "mocks", "weather.mock.json"), JSON.stringify(VALID_MOCK));
    await writeFile(
      join(server.root, "a-tools-only.json"),
      JSON.stringify({ tools: VALID_MOCK.tools }),
    );
    await writeFile(join(server.root, "bad.mock.json"), JSON.stringify(INVALID_MOCK));
    await writeFile(join(server.root, "broken.json"), "{");
    await writeFile(join(server.root, "package.json"), '{"name":"x"}');

    const response = await fetch(`${server.baseUrl}/api/mocks`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { path: "a-tools-only.json", toolCount: 1, responseCount: 0 },
      { path: "mocks/weather.mock.json", toolCount: 1, responseCount: 1 },
    ]);
  });
});

describe("GET /api/mocks/<path>", () => {
  it("파일 하나를 내용 · mtime 과 함께 준다", async () => {
    server = await startTestServer();
    const content = `${JSON.stringify(VALID_MOCK, null, 2)}\n`;
    const target = join(server.root, "weather.mock.json");
    await writeFile(target, content, "utf8");
    const stats = await stat(target);

    const response = await fetch(`${server.baseUrl}/api/mocks/${encodeURIComponent("weather.mock.json")}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      path: "weather.mock.json",
      content,
      mtimeMs: stats.mtimeMs,
    });
  });

  it("목 정의가 아니면 400 과 assertMockDefinition 문장 전문을 준다", async () => {
    server = await startTestServer();
    await writeFile(join(server.root, "bad.mock.json"), JSON.stringify(INVALID_MOCK));

    const response = await fetch(`${server.baseUrl}/api/mocks/${encodeURIComponent("bad.mock.json")}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: invalidMockMessage("bad.mock.json") });
  });

  it("없는 파일은 404 다", async () => {
    server = await startTestServer();
    const response = await fetch(`${server.baseUrl}/api/mocks/${encodeURIComponent("none.json")}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "파일을 찾을 수 없습니다." });
  });

  it("경로 탈출은 400 이다", async () => {
    server = await startTestServer();
    const response = await fetch(
      `${server.baseUrl}/api/mocks/${encodeURIComponent("../outside.mock.json")}`,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "허용되지 않는 경로입니다." });
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `corepack pnpm vitest run packages/dashboard/tests/routes.test.ts -t "GET /api/mocks"`
Expected: FAIL — 5 건 모두 404 `그런 경로가 없습니다: GET /api/mocks...`

- [ ] **Step 4: `listMocks` 를 구현한다**

`files.ts` 상단 import 에 추가한다.

```ts
import { assertMockDefinition, type MockDefinition } from "@mcpeak/mock";
```

api-types import 에 `MockFileEntry` 를 더한다. `listSuites` 바로 아래에 붙인다.

```ts
/**
 * `**\/*.json` 중 `assertMockDefinition` 을 통과하는 파일. 무효 JSON · 무효 정의는 조용히
 * 뺀다(`listSuites` 와 같은 정책). 판정 규칙은 mock 안에 있다 — 여기서 다시 쓰지 않는다.
 */
export async function listMocks(root: string): Promise<MockFileEntry[]> {
  const files = await walkJsonFiles(root);
  const results: MockFileEntry[] = [];
  for (const absolute of files) {
    let definition: MockDefinition;
    try {
      const parsed: unknown = JSON.parse(await readFile(absolute, "utf8"));
      assertMockDefinition(parsed);
      definition = parsed;
    } catch {
      continue;
    }
    results.push({
      path: toRelative(root, absolute),
      toolCount: definition.tools.length,
      responseCount: definition.responses?.length ?? 0,
    });
  }
  return results.sort((a, b) => a.path.localeCompare(b.path));
}
```

- [ ] **Step 5: 라우트를 구현한다**

`routes.ts` 의 files import 에 `listMocks` 를 넣는다. `handleRequest` 에서 `GET /api/suites/` 분기 **앞**에 둔다.

```ts
  if (method === "GET" && pathname === "/api/mocks") {
    sendJson(response, 200, await listMocks(options.root));
    return;
  }
  if (method === "GET" && pathname.startsWith("/api/mocks/")) {
    await handleGetMock(response, options.root, decodeParam(pathname, "/api/mocks/"));
    return;
  }
```

`handleGetFile` 아래에 추가한다.

```ts
/**
 * 목 정의 파일 하나. 목록에는 유효한 것만 나오지만, 목록을 본 뒤 파일이 바뀌었을 수 있다.
 * 그때는 폼으로 옮길 수 없으므로 `assertMockDefinition` 문장 그대로 400 이다.
 */
async function handleGetMock(
  response: ServerResponse,
  root: string,
  relativeOrNull: string | null,
): Promise<void> {
  if (relativeOrNull === null) {
    sendJson(response, 400, { error: "경로를 해석할 수 없습니다." });
    return;
  }
  const absolute = resolveProjectPath(root, relativeOrNull);
  if (absolute === null) {
    sendJson(response, 400, { error: "허용되지 않는 경로입니다." });
    return;
  }
  let content: FileContent;
  try {
    content = await readFileContent(root, absolute);
  } catch {
    sendJson(response, 404, { error: "파일을 찾을 수 없습니다." });
    return;
  }
  const problem = validateMockContent(content.content, relativeOrNull);
  if (problem !== null) {
    sendJson(response, 400, { error: problem });
    return;
  }
  sendJson(response, 200, content);
}
```

api-types import 에 `FileContent` 를 더한다(`import type`).

- [ ] **Step 6: 통과를 확인한다**

Run: `corepack pnpm vitest run packages/dashboard/tests/routes.test.ts`
Expected: PASS, `Test Files  1 passed`

Run: `corepack pnpm --filter @mcpeak/dashboard typecheck >/dev/null 2>&1; echo $?`
Expected: `0`

- [ ] **Step 7: 커밋**

```bash
git add packages/dashboard/src/api-types.ts packages/dashboard/src/server/files.ts \
  packages/dashboard/src/server/routes.ts packages/dashboard/tests/routes.test.ts
git commit -m "feat(dashboard): 목 정의 파일 목록과 파일 하나를 읽는 API 를 둔다"
```

---

### Task 4: 평면 입력 필드 ↔ `inputSchema`

**Files:**
- Create: `packages/dashboard/web/src/mock-builder/schema-fields.ts`
- Create: `packages/dashboard/web/tests/schema-fields.test.ts`

**Interfaces:**
- Consumes: `JsonValue` (`../../../src/api-types.js`)
- Produces:
  - `type FieldType = "string" | "number" | "integer" | "boolean"`, `FIELD_TYPES: readonly FieldType[]`
  - `interface FieldDraft { name: string; type: FieldType; required: boolean }`
  - `type JsonObject = { readonly [key: string]: JsonValue }`
  - `fieldsToSchema(fields: readonly FieldDraft[]): JsonObject`
  - `type FlattenResult = { ok: true; fields: readonly FieldDraft[] } | { ok: false; reason: string }`
  - `schemaToFields(schema: unknown): FlattenResult`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/dashboard/web/tests/schema-fields.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fieldsToSchema, schemaToFields } from "../src/mock-builder/schema-fields.js";

describe("fieldsToSchema", () => {
  it("필드 순서대로 properties 를, 필수만 required 에 담는다", () => {
    expect(
      fieldsToSchema([
        { name: "city", type: "string", required: true },
        { name: "days", type: "integer", required: false },
      ]),
    ).toEqual({
      type: "object",
      properties: { city: { type: "string" }, days: { type: "integer" } },
      required: ["city"],
    });
  });

  it("필수가 없으면 required 키가 없다", () => {
    expect(fieldsToSchema([{ name: "verbose", type: "boolean", required: false }])).toEqual({
      type: "object",
      properties: { verbose: { type: "boolean" } },
    });
  });

  it("필드가 없으면 빈 properties 다", () => {
    expect(fieldsToSchema([])).toEqual({ type: "object", properties: {} });
  });
});

describe("schemaToFields", () => {
  it("fieldsToSchema 결과를 되돌린다", () => {
    const fields = [
      { name: "city", type: "string" as const, required: true },
      { name: "lat", type: "number" as const, required: false },
    ];
    expect(schemaToFields(fieldsToSchema(fields))).toEqual({ ok: true, fields });
  });

  it("properties 가 없는 object 는 빈 필드다", () => {
    expect(schemaToFields({ type: "object" })).toEqual({ ok: true, fields: [] });
  });

  it.each([
    [{ type: "array" }, '최상위 type 이 "object" 가 아닙니다.'],
    [
      { type: "object", properties: {}, additionalProperties: false },
      "최상위 키 'additionalProperties' 는 평면 폼에 자리가 없습니다.",
    ],
    [
      { type: "object", properties: { unit: { type: "string", enum: ["c", "f"] } } },
      "필드 'unit' 의 'enum' 은(는) 평면 폼에 자리가 없습니다.",
    ],
    [
      { type: "object", properties: { at: { type: "object" } } },
      '필드 \'at\' 의 타입 "object" 은(는) 평면 폼이 다루지 않습니다 (string · number · integer · boolean 만).',
    ],
    [
      { type: "object", properties: { tags: { type: "array" } } },
      '필드 \'tags\' 의 타입 "array" 은(는) 평면 폼이 다루지 않습니다 (string · number · integer · boolean 만).',
    ],
    [{ type: "object", properties: { any: {} } }, "필드 'any' 에 type 이 없습니다."],
    [
      { type: "object", properties: { city: { type: "string" } }, required: ["country"] },
      "required 의 'country' 이(가) properties 에 없습니다.",
    ],
    [
      { type: "object", properties: {}, required: ["toString"] },
      "required 의 'toString' 이(가) properties 에 없습니다.",
    ],
  ])("평면이 아니면 이유를 준다: %j", (schema, reason) => {
    expect(schemaToFields(schema)).toEqual({ ok: false, reason });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `corepack pnpm vitest run --project web packages/dashboard/web/tests/schema-fields.test.ts`
Expected: FAIL — `Failed to resolve import "../src/mock-builder/schema-fields.js"`

- [ ] **Step 3: 구현한다**

`packages/dashboard/web/src/mock-builder/schema-fields.ts`:

```ts
import type { JsonValue } from "../../../src/api-types.js";

/**
 * 목 만들기 폼의 평면 입력 필드. 중첩 object · array · enum 은 다루지 않는다 — 그런 스키마는
 * "JSON 으로 편집" 으로 넘긴다(설계 §화면 흐름). 평면 폼이 스키마의 일부를 조용히 버리면
 * 사용자는 저장한 목이 왜 인자를 다르게 검사하는지 알 수 없다. 그래서 되돌릴 때는
 * 옮길 수 없는 것이 하나라도 있으면 통째로 거절하고 이유를 준다.
 */
export type FieldType = "string" | "number" | "integer" | "boolean";

export const FIELD_TYPES: readonly FieldType[] = ["string", "number", "integer", "boolean"];

export interface FieldDraft {
  readonly name: string;
  readonly type: FieldType;
  readonly required: boolean;
}

export type JsonObject = { readonly [key: string]: JsonValue };

/** 필드 순서가 곧 properties 키 순서다. 같은 필드면 같은 바이트가 나온다. */
export function fieldsToSchema(fields: readonly FieldDraft[]): JsonObject {
  const properties: Record<string, JsonValue> = {};
  for (const field of fields) properties[field.name] = { type: field.type };
  const required = fields.filter((field) => field.required).map((field) => field.name);
  return required.length === 0
    ? { type: "object", properties }
    : { type: "object", properties, required };
}

export type FlattenResult =
  | { readonly ok: true; readonly fields: readonly FieldDraft[] }
  | { readonly ok: false; readonly reason: string };

const TOP_KEYS = new Set(["type", "properties", "required"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFieldType(value: unknown): value is FieldType {
  return typeof value === "string" && (FIELD_TYPES as readonly string[]).includes(value);
}

/** 스키마를 평면 필드로 되돌린다. 하나라도 옮길 수 없으면 첫 이유를 준다. */
export function schemaToFields(schema: unknown): FlattenResult {
  if (!isRecord(schema) || schema.type !== "object") {
    return { ok: false, reason: '최상위 type 이 "object" 가 아닙니다.' };
  }
  for (const key of Object.keys(schema)) {
    if (!TOP_KEYS.has(key)) {
      return { ok: false, reason: `최상위 키 '${key}' 는 평면 폼에 자리가 없습니다.` };
    }
  }
  const properties = schema.properties ?? {};
  if (!isRecord(properties)) return { ok: false, reason: "properties 가 객체가 아닙니다." };
  const required = schema.required ?? [];
  if (!Array.isArray(required) || !required.every((name) => typeof name === "string")) {
    return { ok: false, reason: "required 가 문자열 배열이 아닙니다." };
  }
  const requiredNames = required as string[];
  for (const name of requiredNames) {
    // `in` 은 `toString` 같은 상속 키에 참이 된다. 자기 키만 본다.
    if (!Object.hasOwn(properties, name)) {
      return { ok: false, reason: `required 의 '${name}' 이(가) properties 에 없습니다.` };
    }
  }
  const fields: FieldDraft[] = [];
  for (const [name, property] of Object.entries(properties)) {
    if (!isRecord(property)) {
      return { ok: false, reason: `필드 '${name}' 의 정의가 객체가 아닙니다.` };
    }
    for (const key of Object.keys(property)) {
      if (key !== "type") {
        return { ok: false, reason: `필드 '${name}' 의 '${key}' 은(는) 평면 폼에 자리가 없습니다.` };
      }
    }
    if (property.type === undefined) {
      return { ok: false, reason: `필드 '${name}' 에 type 이 없습니다.` };
    }
    if (!isFieldType(property.type)) {
      return {
        ok: false,
        reason: `필드 '${name}' 의 타입 ${JSON.stringify(property.type)} 은(는) 평면 폼이 다루지 않습니다 (string · number · integer · boolean 만).`,
      };
    }
    fields.push({ name, type: property.type, required: requiredNames.includes(name) });
  }
  return { ok: true, fields };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `corepack pnpm vitest run --project web packages/dashboard/web/tests/schema-fields.test.ts`
Expected: PASS, `Test Files  1 passed`

- [ ] **Step 5: 커밋**

```bash
git add packages/dashboard/web/src/mock-builder/schema-fields.ts \
  packages/dashboard/web/tests/schema-fields.test.ts
git commit -m "feat(dashboard): 목 만들기의 평면 입력 필드와 inputSchema 를 오가는 함수를 둔다"
```

---

### Task 5: 폼 초안 → `MockDefinition` JSON

**Files:**
- Create: `packages/dashboard/web/src/mock-builder/draft.ts`
- Create: `packages/dashboard/web/tests/mock-draft.test.ts`

**Interfaces:**
- Consumes: `FieldDraft`, `fieldsToSchema`, `JsonObject` (T4), `JsonValue`
- Produces:
  - `interface ToolDraft { name: string; description: string; schemaMode: "fields" | "json"; fields: readonly FieldDraft[]; schemaJson: string; extra: JsonObject }`
  - `interface ResponseDraft { tool: string; anyArgs: boolean; argsJson: string; resultJson: string; isError: boolean; origin: "manual" | "recording"; extra: JsonObject }`
  - `interface MockDraft { tools: readonly ToolDraft[]; responses: readonly ResponseDraft[]; extra: JsonObject }`, `EMPTY_MOCK_DRAFT`
  - `newToolDraft(name?: string): ToolDraft`, `newResponseDraft(tool?: string): ResponseDraft`
  - `interface MockDefinitionJson`, `MockToolJson`, `MockResponseJson`
  - `buildMockDefinition(draft: MockDraft): BuildResult` — `{ ok: true; definition } | { ok: false; errors: readonly string[] }`
  - `serializeMockDefinition(definition: MockDefinitionJson): string`
  - `interface PickedResponse { tool: string; argsJson: string | null; body: JsonValue }`
  - `addPickedResponse(draft: MockDraft, pick: PickedResponse): MockDraft`
  - `replaceResult(draft: MockDraft, index: number, body: JsonValue): MockDraft`
  - `isBlankResult(resultJson: string): boolean`
  - `preservedKeysNote(extra: JsonObject): string | null`
  - `mockFilePath(path: string): string`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/dashboard/web/tests/mock-draft.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addPickedResponse,
  buildMockDefinition,
  EMPTY_MOCK_DRAFT,
  isBlankResult,
  type MockDraft,
  mockFilePath,
  newResponseDraft,
  newToolDraft,
  preservedKeysNote,
  type ResponseDraft,
  replaceResult,
  serializeMockDefinition,
  type ToolDraft,
} from "../src/mock-builder/draft.js";

const weatherTool: ToolDraft = {
  name: "get_weather",
  description: "",
  schemaMode: "fields",
  fields: [{ name: "city", type: "string", required: true }],
  schemaJson: "",
  extra: {},
};

const response = (overrides: Partial<ResponseDraft> = {}): ResponseDraft => ({
  tool: "get_weather",
  anyArgs: false,
  argsJson: '{"city":"Seoul"}',
  resultJson: '{"temperature":21.5}',
  isError: false,
  origin: "manual",
  extra: {},
  ...overrides,
});

const draftOf = (tools: ToolDraft[], responses: ResponseDraft[]): MockDraft => ({
  tools,
  responses,
  extra: {},
});

const WEATHER_SCHEMA = {
  type: "object",
  properties: { city: { type: "string" } },
  required: ["city"],
};

describe("buildMockDefinition", () => {
  it("인자 무관이면 args 키가 없고, isError 는 켰을 때만 true 로 들어간다", () => {
    const draft = draftOf(
      [weatherTool],
      [
        response(),
        response({ argsJson: '{"city":"Nowhere"}', resultJson: '{"error":"unknown"}', isError: true }),
        response({ anyArgs: true, argsJson: "이 값은 보지 않는다", resultJson: '{"temperature":0}' }),
      ],
    );
    expect(buildMockDefinition(draft)).toEqual({
      ok: true,
      definition: {
        tools: [{ name: "get_weather", inputSchema: WEATHER_SCHEMA }],
        responses: [
          { tool: "get_weather", args: { city: "Seoul" }, result: { temperature: 21.5 } },
          {
            tool: "get_weather",
            args: { city: "Nowhere" },
            result: { error: "unknown" },
            isError: true,
          },
          { tool: "get_weather", result: { temperature: 0 } },
        ],
      },
    });
  });

  it("args 가 null 이면 null 인자 응답이다", () => {
    const built = buildMockDefinition(draftOf([weatherTool], [response({ argsJson: "null" })]));
    expect(built.ok && built.definition.responses[0]).toEqual({
      tool: "get_weather",
      args: null,
      result: { temperature: 21.5 },
    });
  });

  it("도구 여러 개와 JSON 모드 스키마를 그대로 싣는다", () => {
    const draft = draftOf(
      [
        weatherTool,
        {
          ...newToolDraft("search"),
          schemaMode: "json",
          schemaJson: '{"type":"object","properties":{"tags":{"type":"array"}}}',
        },
      ],
      [response({ tool: "search", anyArgs: true, resultJson: "[]" })],
    );
    const built = buildMockDefinition(draft);
    expect(built.ok && built.definition.tools.map((tool) => tool.inputSchema)).toEqual([
      WEATHER_SCHEMA,
      { type: "object", properties: { tags: { type: "array" } } },
    ]);
  });

  it("설명과 보존 키를 알려진 키 뒤에 원래 순서로 싣는다. 공백뿐인 설명은 뺀다", () => {
    const built = buildMockDefinition({
      tools: [
        {
          ...weatherTool,
          description: "도시의 현재 날씨",
          extra: { annotations: { readOnlyHint: true }, "x-owner": "mock" },
        },
        { ...newToolDraft("ping"), description: "   " },
      ],
      responses: [response({ extra: { note: "녹화에서 가져옴" } })],
      extra: { $comment: "손으로 적은 메모" },
    });
    if (!built.ok) throw new Error(built.errors.join("\n"));
    expect(serializeMockDefinition(built.definition)).toBe(
      `${JSON.stringify(
        {
          tools: [
            {
              name: "get_weather",
              description: "도시의 현재 날씨",
              inputSchema: WEATHER_SCHEMA,
              annotations: { readOnlyHint: true },
              "x-owner": "mock",
            },
            { name: "ping", inputSchema: { type: "object", properties: {} } },
          ],
          responses: [
            {
              tool: "get_weather",
              args: { city: "Seoul" },
              result: { temperature: 21.5 },
              note: "녹화에서 가져옴",
            },
          ],
          $comment: "손으로 적은 메모",
        },
        null,
        2,
      )}\n`,
    );
  });

  it("이름 · 필드 · JSON 문제를 전부 모아 문장으로 준다", () => {
    const draft = draftOf(
      [
        { ...weatherTool, name: " " },
        {
          ...weatherTool,
          fields: [
            { name: "", type: "string", required: false },
            { name: "city", type: "string", required: false },
            { name: "city", type: "number", required: false },
          ],
        },
        { ...newToolDraft("search"), schemaMode: "json", schemaJson: "{ type: object" },
        weatherTool,
      ],
      [response({ tool: "" }), response({ argsJson: "{city:'Seoul'}" }), response({ resultJson: "" })],
    );
    expect(buildMockDefinition(draft)).toEqual({
      ok: false,
      errors: [
        "도구 1번의 이름이 비어 있습니다. 목이 tools/list 로 내보낼 이름을 적으세요.",
        "도구 'get_weather' 의 입력 필드 1번 이름이 비어 있습니다.",
        "도구 'get_weather' 에 입력 필드 'city' 이(가) 두 번 있습니다.",
        "도구 'search' 의 입력 스키마 JSON 을 읽을 수 없습니다. 따옴표·쉼표·괄호 짝을 확인하세요.",
        "도구 'get_weather' 이(가) 두 번 있습니다. 목은 이름으로 도구를 찾으므로 하나로 합치세요.",
        "응답 1번의 도구를 고르세요.",
        '응답 2번 (\'get_weather\') 의 args JSON 을 읽을 수 없습니다. 따옴표·쉼표·괄호 짝을 확인하세요. 인자를 가리지 않으려면 "인자 무관" 을 켜세요.',
        "응답 3번 ('get_weather') 의 result JSON 을 읽을 수 없습니다. 따옴표·쉼표·괄호 짝을 확인하세요.",
      ],
    });
  });

  it("앞뒤 공백은 이름에서 지운다", () => {
    const built = buildMockDefinition(
      draftOf(
        [
          {
            ...weatherTool,
            name: " get_weather ",
            fields: [{ name: " city ", type: "string", required: true }],
          },
        ],
        [response({ tool: " get_weather " })],
      ),
    );
    expect(built.ok && built.definition.tools[0]?.name).toBe("get_weather");
    expect(built.ok && built.definition.tools[0]?.inputSchema).toEqual(WEATHER_SCHEMA);
    expect(built.ok && built.definition.responses[0]?.tool).toBe("get_weather");
  });

  it("빈 초안은 빈 정의다", () => {
    expect(buildMockDefinition(EMPTY_MOCK_DRAFT)).toEqual({
      ok: true,
      definition: { tools: [], responses: [] },
    });
  });
});

describe("serializeMockDefinition", () => {
  it("두 칸 들여쓰기에 끝 줄바꿈 하나다. 같은 초안이면 같은 바이트다", () => {
    const draft = draftOf([weatherTool], [response({ anyArgs: true })]);
    const first = buildMockDefinition(draft);
    const second = buildMockDefinition(draft);
    if (!first.ok || !second.ok) throw new Error("초안이 유효해야 한다");
    const bytes = serializeMockDefinition(first.definition);
    expect(bytes).toBe(serializeMockDefinition(second.definition));
    expect(bytes).toBe(
      [
        "{",
        '  "tools": [',
        "    {",
        '      "name": "get_weather",',
        '      "inputSchema": {',
        '        "type": "object",',
        '        "properties": {',
        '          "city": {',
        '            "type": "string"',
        "          }",
        "        },",
        '        "required": [',
        '          "city"',
        "        ]",
        "      }",
        "    }",
        "  ],",
        '  "responses": [',
        "    {",
        '      "tool": "get_weather",',
        '      "result": {',
        '        "temperature": 21.5',
        "      }",
        "    }",
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
  });
});

describe("녹화 응답 넣기", () => {
  const body = { temperature: 21.5, source: "https://api.open-meteo.com/docs" };

  it("addPickedResponse: 도구가 없으면 이름만 채운 도구를 함께 추가하고, 본문을 가공 없이 result 에 넣는다", () => {
    const next = addPickedResponse(EMPTY_MOCK_DRAFT, {
      tool: "get_weather",
      argsJson: '{"city":"Seoul"}',
      body,
    });
    expect(next.tools).toEqual([newToolDraft("get_weather")]);
    expect(next.responses).toEqual([
      {
        tool: "get_weather",
        anyArgs: false,
        argsJson: '{"city":"Seoul"}',
        resultJson: JSON.stringify(body, null, 2),
        isError: false,
        origin: "recording",
        extra: {},
      },
    ]);
  });

  it("addPickedResponse: 도구가 있으면 늘리지 않는다. argsJson 이 null 이면 인자 무관이다", () => {
    const next = addPickedResponse(draftOf([weatherTool], []), {
      tool: "get_weather",
      argsJson: null,
      body,
    });
    expect(next.tools).toEqual([weatherTool]);
    expect(next.responses[0]?.anyArgs).toBe(true);
  });

  it("replaceResult: 그 줄의 result 만 바꾸고 녹화 응답으로 표시한다", () => {
    const start = draftOf([weatherTool], [response(), response({ argsJson: '{"city":"Busan"}' })]);
    const next = replaceResult(start, 1, body);
    expect(next.responses[0]).toEqual(start.responses[0]);
    expect(next.responses[1]).toEqual({
      ...start.responses[1],
      resultJson: JSON.stringify(body, null, 2),
      origin: "recording",
    });
  });

  it.each([
    ["", true],
    ["  {}  ", true],
    ["{ }", false],
    ['{"a":1}', false],
    ["[]", false],
  ])("isBlankResult(%j) = %s", (text, blank) => {
    expect(isBlankResult(text)).toBe(blank);
  });
});

describe("초안 기본값 · 안내 · 경로", () => {
  it("새 응답은 인자 지정 · 빈 객체로 시작한다", () => {
    expect(newResponseDraft("get_weather")).toEqual({
      tool: "get_weather",
      anyArgs: false,
      argsJson: "{}",
      resultJson: "{}",
      isError: false,
      origin: "manual",
      extra: {},
    });
  });

  it("보존 키 안내 문장", () => {
    expect(preservedKeysNote({})).toBeNull();
    expect(preservedKeysNote({ outputSchema: {}, annotations: {} })).toBe(
      "폼에 칸이 없는 키 2개를 그대로 보존합니다: outputSchema, annotations",
    );
  });

  it("파일 경로는 한 세그먼트로 인코딩한다", () => {
    expect(mockFilePath("mocks/weather mock.json")).toBe("/api/mocks/mocks%2Fweather%20mock.json");
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `corepack pnpm vitest run --project web packages/dashboard/web/tests/mock-draft.test.ts`
Expected: FAIL — `Failed to resolve import "../src/mock-builder/draft.js"`

- [ ] **Step 3: 구현한다**

`packages/dashboard/web/src/mock-builder/draft.ts`:

```ts
import type { JsonValue } from "../../../src/api-types.js";
import { type FieldDraft, fieldsToSchema, type JsonObject } from "./schema-fields.js";

/**
 * 목 만들기 폼의 상태와, 그것을 `mock.json` 으로 옮기는 순수 함수들.
 *
 * web 은 `@mcpeak/mock` 을 import 하지 않는다. 그래서 출력 모양(`MockDefinitionJson`)을 여기
 * 다시 적고, 그 정의가 맞는지는 저장할 때 서버가 `assertMockDefinition` 으로 본다. 여기서
 * 잡는 것은 **JSON 을 만들 수조차 없는 문제**(빈 이름 · 읽을 수 없는 JSON · 중복 이름)뿐이다.
 *
 * `extra` 는 폼에 칸이 없는 키다. 기존 파일에서 읽은 그대로 들고 있다가 알려진 키 **뒤에**
 * 원래 순서로 되돌려 쓴다 — 조용히 사라지면 사용자는 저장한 뒤에야 안다(설계 §기존 목 열기).
 */

export interface ToolDraft {
  readonly name: string;
  /** 공백뿐이면 저장하지 않는다. */
  readonly description: string;
  /** `fields` 면 평면 폼, `json` 이면 `schemaJson` 이 inputSchema 의 정본이다. */
  readonly schemaMode: "fields" | "json";
  readonly fields: readonly FieldDraft[];
  readonly schemaJson: string;
  readonly extra: JsonObject;
}

export interface ResponseDraft {
  /** 고른 도구의 이름. */
  readonly tool: string;
  /** 켜면 `args` 를 적지 않는다 — 목이 인자를 가리지 않는다(ANY). */
  readonly anyArgs: boolean;
  readonly argsJson: string;
  readonly resultJson: string;
  readonly isError: boolean;
  /**
   * 녹화본에서 가져온 result 인가. `mock.json` 에는 실리지 않는다. body URL 경고를 녹화 응답에만
   * 띄우는 데 쓴다 — 손으로 친 값에 "녹화 때 가려지지 않는 자리" 라고 말하면 틀린 문장이다.
   */
  readonly origin: "manual" | "recording";
  readonly extra: JsonObject;
}

export interface MockDraft {
  readonly tools: readonly ToolDraft[];
  readonly responses: readonly ResponseDraft[];
  readonly extra: JsonObject;
}

export const EMPTY_MOCK_DRAFT: MockDraft = { tools: [], responses: [], extra: {} };

export function newToolDraft(name = ""): ToolDraft {
  return { name, description: "", schemaMode: "fields", fields: [], schemaJson: "", extra: {} };
}

export function newResponseDraft(tool = ""): ResponseDraft {
  return {
    tool,
    anyArgs: false,
    argsJson: "{}",
    resultJson: "{}",
    isError: false,
    origin: "manual",
    extra: {},
  };
}

/** `@mcpeak/mock` 의 `ToolDef` 와 같은 모양 + 보존 키. 키 순서는 name · description · inputSchema · 보존 키. */
export interface MockToolJson {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: JsonValue;
  readonly [key: string]: JsonValue | undefined;
}

/** `@mcpeak/mock` 의 `MockResponse` 와 같은 모양 + 보존 키. 키 순서는 tool · args · result · isError · 보존 키. */
export interface MockResponseJson {
  readonly tool: string;
  readonly args?: JsonValue;
  readonly result: JsonValue;
  readonly isError?: true;
  readonly [key: string]: JsonValue | undefined;
}

export interface MockDefinitionJson {
  readonly tools: readonly MockToolJson[];
  readonly responses: readonly MockResponseJson[];
  readonly [key: string]: JsonValue | undefined | readonly MockToolJson[] | readonly MockResponseJson[];
}

export type BuildResult =
  | { readonly ok: true; readonly definition: MockDefinitionJson }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * JSON.parse 의 오류 문구는 엔진마다 다르다. 싣지 않고 **무엇을 볼지**만 말한다 — 같은 입력에
 * 같은 문장이 나와야 한다.
 */
const JSON_HINT = "따옴표·쉼표·괄호 짝을 확인하세요.";

function parseJson(text: string): { readonly value: JsonValue } | null {
  try {
    return { value: JSON.parse(text) as JsonValue };
  } catch {
    return null;
  }
}

function fieldProblems(label: string, fields: readonly FieldDraft[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  fields.forEach((field, index) => {
    const name = field.name.trim();
    if (name === "") {
      problems.push(`${label} 의 입력 필드 ${index + 1}번 이름이 비어 있습니다.`);
      return;
    }
    if (seen.has(name)) problems.push(`${label} 에 입력 필드 '${name}' 이(가) 두 번 있습니다.`);
    seen.add(name);
  });
  return problems;
}

/**
 * 초안 → 목 정의. 문제는 멈추지 않고 **전부** 모은다 — 저장을 누를 때마다 하나씩 알게 하면
 * 사용자는 같은 버튼을 문제 수만큼 누른다. 순서는 도구 → 응답, 각 안에서는 화면 순서다.
 */
export function buildMockDefinition(draft: MockDraft): BuildResult {
  const errors: string[] = [];
  const tools: MockToolJson[] = [];
  const seenTools = new Set<string>();

  draft.tools.forEach((tool, index) => {
    const name = tool.name.trim();
    const label = name === "" ? `도구 ${index + 1}번` : `도구 '${name}'`;
    if (name === "") {
      errors.push(`도구 ${index + 1}번의 이름이 비어 있습니다. 목이 tools/list 로 내보낼 이름을 적으세요.`);
    }
    let inputSchema: JsonValue | undefined;
    if (tool.schemaMode === "json") {
      const parsed = parseJson(tool.schemaJson);
      if (parsed === null) {
        errors.push(`${label} 의 입력 스키마 JSON 을 읽을 수 없습니다. ${JSON_HINT}`);
      } else {
        inputSchema = parsed.value;
      }
    } else {
      const problems = fieldProblems(label, tool.fields);
      errors.push(...problems);
      if (problems.length === 0) {
        inputSchema = fieldsToSchema(
          tool.fields.map((field) => ({ ...field, name: field.name.trim() })),
        );
      }
    }
    if (name !== "" && seenTools.has(name)) {
      errors.push(`${label} 이(가) 두 번 있습니다. 목은 이름으로 도구를 찾으므로 하나로 합치세요.`);
    }
    if (name !== "") seenTools.add(name);
    if (inputSchema === undefined) return;
    const description = tool.description.trim();
    tools.push({
      name,
      ...(description === "" ? {} : { description }),
      inputSchema,
      ...tool.extra,
    });
  });

  const responses: MockResponseJson[] = [];
  draft.responses.forEach((response, index) => {
    const tool = response.tool.trim();
    if (tool === "") {
      errors.push(`응답 ${index + 1}번의 도구를 고르세요.`);
      return;
    }
    const label = `응답 ${index + 1}번 ('${tool}')`;
    const args = response.anyArgs ? undefined : parseJson(response.argsJson);
    if (args === null) {
      errors.push(
        `${label} 의 args JSON 을 읽을 수 없습니다. ${JSON_HINT} 인자를 가리지 않으려면 "인자 무관" 을 켜세요.`,
      );
    }
    const result = parseJson(response.resultJson);
    if (result === null) errors.push(`${label} 의 result JSON 을 읽을 수 없습니다. ${JSON_HINT}`);
    if (args === null || result === null) return;
    responses.push({
      tool,
      ...(args === undefined ? {} : { args: args.value }),
      result: result.value,
      ...(response.isError ? { isError: true as const } : {}),
      ...response.extra,
    });
  });

  return errors.length === 0
    ? { ok: true, definition: { tools, responses, ...draft.extra } }
    : { ok: false, errors };
}

/** 저장 바이트. 키 순서는 `buildMockDefinition` 이 고정하므로 같은 초안이면 같은 바이트다. */
export function serializeMockDefinition(definition: MockDefinitionJson): string {
  return `${JSON.stringify(definition, null, 2)}\n`;
}

/** 녹화본에서 고른 응답. `argsJson` 이 `null` 이면 인자 무관(ANY)이다. */
export interface PickedResponse {
  readonly tool: string;
  readonly argsJson: string | null;
  readonly body: JsonValue;
}

/**
 * 고른 응답을 "응답 추가" 한 줄로 넣는다. 본문은 **가공 없이** result 에 들어간다 — 필요 없는
 * 필드를 지우는 것은 사람이 한다(설계 §목적). 도구가 폼에 없으면 이름만 채운 도구도 함께 넣는다.
 */
export function addPickedResponse(draft: MockDraft, pick: PickedResponse): MockDraft {
  const tool = pick.tool.trim();
  const hasTool = draft.tools.some((existing) => existing.name.trim() === tool);
  return {
    ...draft,
    tools: hasTool ? draft.tools : [...draft.tools, newToolDraft(tool)],
    responses: [
      ...draft.responses,
      {
        ...newResponseDraft(tool),
        anyArgs: pick.argsJson === null,
        argsJson: pick.argsJson ?? "{}",
        resultJson: JSON.stringify(pick.body, null, 2),
        origin: "recording",
      },
    ],
  };
}

/** 이미 있는 응답 줄의 result 만 녹화 본문으로 바꾼다. 도구 · args · isError 는 그대로다. */
export function replaceResult(draft: MockDraft, index: number, body: JsonValue): MockDraft {
  return {
    ...draft,
    responses: draft.responses.map((response, i) =>
      i === index
        ? { ...response, resultJson: JSON.stringify(body, null, 2), origin: "recording" as const }
        : response,
    ),
  };
}

/** 바꾸기 전에 확인을 받지 않아도 되는 result 인가 — 비었거나 새 응답의 기본값 `{}` 이다. */
export function isBlankResult(resultJson: string): boolean {
  const trimmed = resultJson.trim();
  return trimmed === "" || trimmed === "{}";
}

/** 보존 키가 있으면 알리는 문장. 없으면 `null`. */
export function preservedKeysNote(extra: JsonObject): string | null {
  const keys = Object.keys(extra);
  return keys.length === 0
    ? null
    : `폼에 칸이 없는 키 ${keys.length}개를 그대로 보존합니다: ${keys.join(", ")}`;
}

/** `GET` · `PUT /api/mocks/<path>`. 경로 전체를 한 세그먼트로 인코딩한다(`/api/suites` 와 같은 규칙). */
export function mockFilePath(path: string): string {
  return `/api/mocks/${encodeURIComponent(path)}`;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `corepack pnpm vitest run --project web packages/dashboard/web/tests/mock-draft.test.ts`
Expected: PASS, `Test Files  1 passed`

Run: `corepack pnpm --filter @mcpeak/dashboard typecheck >/dev/null 2>&1; echo $?`
Expected: `0`. `MockDefinitionJson` 의 인덱스 시그니처에서 오류가 나면 **인덱스 시그니처만** 넓혀 맞추고(값 타입에 빠진 멤버 추가) 보고한다. 출력 모양은 바꾸지 않는다.

- [ ] **Step 5: 커밋**

```bash
git add packages/dashboard/web/src/mock-builder/draft.ts packages/dashboard/web/tests/mock-draft.test.ts
git commit -m "feat(dashboard): 목 만들기 폼 초안을 mock.json 으로 조립하는 함수를 둔다"
```

---

### Task 6: 목 정의 파일 → 초안

**Files:**
- Create: `packages/dashboard/web/src/mock-builder/from-definition.ts`
- Create: `packages/dashboard/web/tests/from-definition.test.ts`

**Interfaces:**
- Consumes: `schemaToFields`, `JsonObject` (T4), `MockDraft`, `ToolDraft`, `ResponseDraft`, `buildMockDefinition`, `serializeMockDefinition` (T5 — 테스트만)
- Produces: `draftFromDefinition(definition: JsonValue): MockDraft` — 서버가 `assertMockDefinition` 으로 검증한 JSON 을 받는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/dashboard/web/tests/from-definition.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { JsonValue } from "../../src/api-types.js";
import { buildMockDefinition, serializeMockDefinition } from "../src/mock-builder/draft.js";
import { draftFromDefinition } from "../src/mock-builder/from-definition.js";

/** 손으로 쓴 파일 모양. 키 순서 · 기본값 명시 · 보존 키가 섞여 있다. */
const HANDWRITTEN = {
  $comment: "손으로 적은 메모",
  tools: [
    {
      name: "get_weather",
      description: "도시의 현재 날씨",
      inputSchema: {
        type: "object",
        required: ["city"],
        properties: { city: { type: "string" } },
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "search",
      inputSchema: { type: "object", properties: { filter: { type: "object" } } },
    },
  ],
  responses: [
    {
      tool: "get_weather",
      args: { city: "Seoul" },
      result: { temperature: 21.5 },
      isError: false,
      note: "녹화에서 가져옴",
    },
    { tool: "get_weather", result: { temperature: 0 } },
    { tool: "search", args: null, result: [], isError: true },
  ],
  // `as const` 가 없으면 배열 안 객체 리터럴의 합집합이 `filter?: undefined` 로 정규화돼
  // JsonValue 에 맞지 않는다(TS2345).
} as const;

/** 위 파일을 열어 손대지 않고 저장했을 때의 정규화된 모양. */
const NORMALIZED = {
  tools: [
    {
      name: "get_weather",
      description: "도시의 현재 날씨",
      inputSchema: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "search",
      inputSchema: { type: "object", properties: { filter: { type: "object" } } },
    },
  ],
  responses: [
    {
      tool: "get_weather",
      args: { city: "Seoul" },
      result: { temperature: 21.5 },
      note: "녹화에서 가져옴",
    },
    { tool: "get_weather", result: { temperature: 0 } },
    { tool: "search", args: null, result: [], isError: true },
  ],
  $comment: "손으로 적은 메모",
};

function saveBytes(definition: JsonValue): string {
  const built = buildMockDefinition(draftFromDefinition(definition));
  if (!built.ok) throw new Error(built.errors.join("\n"));
  return serializeMockDefinition(built.definition);
}

describe("draftFromDefinition", () => {
  const draft = draftFromDefinition(HANDWRITTEN);

  it("평면 스키마는 필드 폼으로, 아니면 JSON 모드로 연다", () => {
    expect(draft.tools[0]).toMatchObject({
      name: "get_weather",
      description: "도시의 현재 날씨",
      schemaMode: "fields",
      fields: [{ name: "city", type: "string", required: true }],
    });
    expect(draft.tools[1]).toMatchObject({
      name: "search",
      description: "",
      schemaMode: "json",
      fields: [],
      schemaJson: JSON.stringify(HANDWRITTEN.tools[1]?.inputSchema, null, 2),
    });
  });

  it("args 키가 없으면 인자 무관, null 이면 null 인자다", () => {
    expect(draft.responses.map((r) => [r.anyArgs, r.argsJson])).toEqual([
      [false, JSON.stringify({ city: "Seoul" }, null, 2)],
      [true, "{}"],
      [false, "null"],
    ]);
  });

  it("폼에 칸이 없는 키를 도구 · 응답 · 최상위에 보존한다. 불러온 응답은 녹화 응답이 아니다", () => {
    expect(draft.tools[0]?.extra).toEqual({ annotations: { readOnlyHint: true } });
    expect(draft.responses[0]?.extra).toEqual({ note: "녹화에서 가져옴" });
    expect(draft.extra).toEqual({ $comment: "손으로 적은 메모" });
    expect(draft.responses.every((r) => r.origin === "manual")).toBe(true);
  });

  it("문자열이 아닌 description 은 보존 키로 남긴다", () => {
    const odd = draftFromDefinition({
      tools: [{ name: "t", description: 42, inputSchema: { type: "object" } }],
    });
    expect(odd.tools[0]?.description).toBe("");
    expect(odd.tools[0]?.extra).toEqual({ description: 42 });
  });

  it("열어서 그대로 저장하면 정규화된 모양이 나오고, 두 번째부터는 바이트가 같다", () => {
    const first = saveBytes(HANDWRITTEN);
    expect(first).toBe(`${JSON.stringify(NORMALIZED, null, 2)}\n`);
    expect(saveBytes(JSON.parse(first) as JsonValue)).toBe(first);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `corepack pnpm vitest run --project web packages/dashboard/web/tests/from-definition.test.ts`
Expected: FAIL — `Failed to resolve import "../src/mock-builder/from-definition.js"`

- [ ] **Step 3: 구현한다**

`packages/dashboard/web/src/mock-builder/from-definition.ts`:

```ts
import type { JsonValue } from "../../../src/api-types.js";
import type { MockDraft, ResponseDraft, ToolDraft } from "./draft.js";
import { type JsonObject, schemaToFields } from "./schema-fields.js";

/**
 * 목 정의 파일 → 폼 초안. 입력은 서버가 `assertMockDefinition` 으로 검증한 JSON 이다.
 * 그래도 모양을 믿고 캐스트만 하지 않는다 — 기대와 다른 값은 빈 값으로 두고 원래 키는
 * 보존 키로 남긴다. 사라지는 것이 없어야 저장했을 때 놀라지 않는다.
 *
 * 폼에 칸이 있는 키만 폼으로 옮기고 나머지는 전부 `extra` 다(설계 §기존 목 열기).
 */

const TOP_KEYS = ["tools", "responses"];
const RESPONSE_KEYS = ["tool", "args", "result", "isError"];

function asObject(value: JsonValue | undefined): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asArray(value: JsonValue | undefined): readonly JsonValue[] {
  return Array.isArray(value) ? (value as readonly JsonValue[]) : [];
}

/** `known` 에 없는 키만 원래 순서로. */
function without(object: JsonObject, known: readonly string[]): JsonObject {
  const extra: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(object)) {
    if (!known.includes(key)) extra[key] = value;
  }
  return extra;
}

const pretty = (value: JsonValue): string => JSON.stringify(value, null, 2);

function toToolDraft(tool: JsonObject): ToolDraft {
  const description = typeof tool.description === "string" ? tool.description : null;
  const known = description === null ? ["name", "inputSchema"] : ["name", "description", "inputSchema"];
  const inputSchema = tool.inputSchema ?? null;
  const flat = schemaToFields(inputSchema);
  return {
    name: typeof tool.name === "string" ? tool.name : "",
    description: description ?? "",
    schemaMode: flat.ok ? "fields" : "json",
    fields: flat.ok ? flat.fields : [],
    schemaJson: flat.ok ? "" : pretty(inputSchema),
    extra: without(tool, known),
  };
}

function toResponseDraft(response: JsonObject): ResponseDraft {
  // `"args": null` 은 인자가 null 인 응답이다. 키가 없을 때만 인자 무관이다.
  const hasArgs = Object.hasOwn(response, "args");
  return {
    tool: typeof response.tool === "string" ? response.tool : "",
    anyArgs: !hasArgs,
    argsJson: hasArgs ? pretty(response.args ?? null) : "{}",
    resultJson: pretty(response.result ?? null),
    isError: response.isError === true,
    // 파일에서 읽은 값은 어디서 왔는지 모른다. "녹화 때 가려지지 않는 자리" 라고 말하지 않는다.
    origin: "manual",
    extra: without(response, RESPONSE_KEYS),
  };
}

export function draftFromDefinition(definition: JsonValue): MockDraft {
  const top = asObject(definition);
  return {
    tools: asArray(top.tools).map((tool) => toToolDraft(asObject(tool))),
    responses: asArray(top.responses).map((response) => toResponseDraft(asObject(response))),
    extra: without(top, TOP_KEYS),
  };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `corepack pnpm vitest run --project web packages/dashboard/web/tests/from-definition.test.ts`
Expected: PASS, `Test Files  1 passed`

- [ ] **Step 5: 회귀 증명 — 보존이 실제로 검증되는지**

스크래치패드에 `from-definition.ts` 를 백업하고 `toToolDraft` 의 `extra: without(tool, known)` 을 `extra: {}` 로 잠깐 바꾼다.

Run: `corepack pnpm vitest run --project web packages/dashboard/web/tests/from-definition.test.ts`
Expected: FAIL — "보존한다" 와 "정규화된 모양" 두 테스트가 `annotations` 누락으로 실패한다.

백업을 되돌리고 PASS 를 다시 본다.

- [ ] **Step 6: 커밋**

```bash
git add packages/dashboard/web/src/mock-builder/from-definition.ts \
  packages/dashboard/web/tests/from-definition.test.ts
git commit -m "feat(dashboard): 기존 목 정의를 폼 초안으로 옮기고 폼에 없는 키를 보존한다"
```

---

### Task 7: body URL 세기 · 외부 호출 표시

**Files:**
- Create: `packages/dashboard/web/src/mock-builder/body-urls.ts`
- Create: `packages/dashboard/web/src/mock-builder/interactions.ts`
- Create: `packages/dashboard/web/tests/body-urls.test.ts`
- Create: `packages/dashboard/web/tests/interactions.test.ts`

**Interfaces:**
- Consumes: `JsonValue`, `SessionInteractionEntry` (T1), `MockDraft`, `newResponseDraft` (T5)
- Produces:
  - `countBodyUrls(value: JsonValue): number`
  - `responseUrlCount(resultJson: string): number` — 읽을 수 없으면 0
  - `recordingUrlCount(draft: MockDraft): number` — `origin: "recording"` 응답 result 전체의 서로 다른 URL 수
  - `bodyUrlWarning(count: number, place: "response" | "definition"): readonly string[]` — 0 이면 빈 배열
  - `type InteractionView`, `describeInteraction(entry: SessionInteractionEntry): InteractionView`
  - `interactionsPath(sessionPath: string): string`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/dashboard/web/tests/body-urls.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  bodyUrlWarning,
  countBodyUrls,
  recordingUrlCount,
  responseUrlCount,
} from "../src/mock-builder/body-urls.js";
import { newResponseDraft } from "../src/mock-builder/draft.js";

describe("countBodyUrls", () => {
  it("중첩 객체와 배열 안의 http(s) 절대 URL 을 센다", () => {
    expect(
      countBodyUrls({
        forecast: { next: "https://api.example.com/v1/page/2?token=abc" },
        links: ["http://a.example/x", { self: "https://b.example/y" }],
      }),
    ).toBe(3);
  });

  it("같은 URL 은 한 번만 센다", () => {
    expect(countBodyUrls(["https://a.example/x", { again: "https://a.example/x" }])).toBe(1);
  });

  it("상대경로 · 문장에 섞인 URL · http(s) 가 아닌 scheme · 키 이름은 세지 않는다", () => {
    expect(
      countBodyUrls({
        path: "/v1/forecast",
        note: "자세한 건 https://a.example/docs 를 보세요",
        mail: "mailto:ops@example.com",
        label: "note:hello",
        "https://key.example/": 1,
      }),
    ).toBe(0);
  });

  it("스칼라 · null", () => {
    expect(countBodyUrls(null)).toBe(0);
    expect(countBodyUrls(21.5)).toBe(0);
    expect(countBodyUrls("https://a.example/")).toBe(1);
  });
});

describe("bodyUrlWarning", () => {
  it("0 이면 아무 줄도 없다", () => {
    expect(bodyUrlWarning(0, "response")).toEqual([]);
  });

  it("응답 한 줄에 대한 경고 전문", () => {
    expect(bodyUrlWarning(2, "response")).toEqual([
      "→ 이 응답 본문에 URL 이 2개 있습니다. 녹화 때 가려지지 않는 자리라 자격증명이 담겼을 수 있습니다.",
      "→ 저장 전에 result 에서 해당 값을 확인하세요.",
    ]);
  });

  it("저장 직전 경고 전문. 막지 않는다고 말한다", () => {
    expect(bodyUrlWarning(3, "definition")).toEqual([
      "→ 녹화본에서 가져온 result 에 URL 이 3개 있습니다. 녹화 때 가려지지 않는 자리라 자격증명이 담겼을 수 있습니다.",
      "→ 저장은 막지 않습니다. 값을 확인한 뒤 저장하세요.",
    ]);
  });
});

describe("초안 단위 개수", () => {
  it("녹화 응답만, 여러 응답에 걸쳐 서로 다른 URL 을 센다. 읽을 수 없는 result 는 건너뛴다", () => {
    const recorded = (resultJson: string) => ({
      ...newResponseDraft("t"),
      resultJson,
      origin: "recording" as const,
    });
    expect(
      recordingUrlCount({
        tools: [],
        responses: [
          recorded('{"a":"https://a.example/"}'),
          recorded('{"b":"https://a.example/","c":"https://c.example/"}'),
          recorded("{ 깨진"),
          { ...newResponseDraft("t"), resultJson: '{"d":"https://d.example/"}' },
        ],
        extra: {},
      }),
    ).toBe(2);
  });

  it("responseUrlCount 는 읽을 수 없으면 0 이다", () => {
    expect(responseUrlCount('{"a":"https://a.example/"}')).toBe(1);
    expect(responseUrlCount("{ 깨진")).toBe(0);
  });
});
```

`packages/dashboard/web/tests/interactions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SessionInteractionEntry } from "../../src/api-types.js";
import { describeInteraction, interactionsPath } from "../src/mock-builder/interactions.js";

const base = { ordinal: 0, method: "GET", url: "https://api.open-meteo.com/<redacted>?city=Seoul" };

describe("describeInteraction", () => {
  it("응답은 고를 수 있고 method · url · status 를 보여준다", () => {
    const entry: SessionInteractionEntry = {
      ...base,
      outcome: { kind: "response", status: 200, body: { temperature: 21.5 } },
    };
    expect(describeInteraction(entry)).toEqual({
      pickable: true,
      label: "GET https://api.open-meteo.com/<redacted>?city=Seoul · 200",
      body: { temperature: 21.5 },
    });
  });

  it("fetch 실패는 고를 수 없고 failureKind · code 를 말한다", () => {
    expect(
      describeInteraction({
        ...base,
        outcome: { kind: "throw", failureKind: "dns", code: "ENOTFOUND" },
      }),
    ).toEqual({
      pickable: false,
      label: "GET https://api.open-meteo.com/<redacted>?city=Seoul",
      reason:
        "→ 이 호출은 응답 본문이 없어 목의 답으로 쓸 수 없습니다 — fetch 가 실패했습니다 (dns · ENOTFOUND)",
    });
  });

  it("code 가 없으면 failureKind 만 말한다", () => {
    const view = describeInteraction({ ...base, outcome: { kind: "throw", failureKind: "abort" } });
    expect(view.pickable === false && view.reason).toBe(
      "→ 이 호출은 응답 본문이 없어 목의 답으로 쓸 수 없습니다 — fetch 가 실패했습니다 (abort)",
    );
  });

  it("끝나지 않은 호출은 고를 수 없다", () => {
    expect(describeInteraction({ ...base, outcome: { kind: "incomplete" } })).toEqual({
      pickable: false,
      label: "GET https://api.open-meteo.com/<redacted>?city=Seoul",
      reason:
        "→ 녹화가 끝나지 않은 호출입니다. 응답이 저장되지 않아 목의 답으로 쓸 수 없습니다.",
    });
  });
});

describe("interactionsPath", () => {
  it("세션 경로를 한 세그먼트로 인코딩한다", () => {
    expect(interactionsPath("recordings/weather.session.db")).toBe(
      "/api/sessions/recordings%2Fweather.session.db/interactions",
    );
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `corepack pnpm vitest run --project web packages/dashboard/web/tests/body-urls.test.ts packages/dashboard/web/tests/interactions.test.ts`
Expected: FAIL — 두 파일 모두 `Failed to resolve import`

- [ ] **Step 3: 구현한다**

`packages/dashboard/web/src/mock-builder/body-urls.ts`:

```ts
import type { JsonValue } from "../../../src/api-types.js";
import type { MockDraft } from "./draft.js";

/**
 * body 안의 URL 문자열은 녹화 때 **가려지지 않는다**(ADR-0062). 녹화본은 개수만 세고 값은
 * 저장하지 않으므로 `loadSession` 결과에 그 정보가 없다. 그래서 가져온 본문을 여기서 다시 센다.
 *
 * 판정은 record 가 녹화 때 쓰는 것과 같다(`runtime.mjs` 의 `absoluteHttpUrl`): 문자열 **전체**가
 * http(s) 절대 URL 인 값만, 서로 다른 값의 개수. 기준이 다르면 화면과 녹화 요약이 다른 수를 말한다.
 * 값은 모으기만 하고 화면에 따로 내놓지 않는다 — 경고가 새 유출 경로가 되면 안 된다.
 */
function isAbsoluteHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "http:" || url.protocol === "https:";
}

function collect(value: JsonValue, found: Set<string>): void {
  if (typeof value === "string") {
    if (isAbsoluteHttpUrl(value)) found.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value as readonly JsonValue[]) collect(item, found);
    return;
  }
  if (value !== null && typeof value === "object") {
    // 값만 본다. 키 이름은 대상이 아니다(record 와 같다).
    for (const item of Object.values(value as { readonly [key: string]: JsonValue })) {
      collect(item, found);
    }
  }
}

export function countBodyUrls(value: JsonValue): number {
  const found = new Set<string>();
  collect(value, found);
  return found.size;
}

function parsedOrUndefined(text: string): JsonValue | undefined {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
  }
}

/** 응답 한 줄의 result 에 든 URL 수. 읽을 수 없는 JSON 은 0 이다 — 그 문제는 조립이 말한다. */
export function responseUrlCount(resultJson: string): number {
  const parsed = parsedOrUndefined(resultJson);
  return parsed === undefined ? 0 : countBodyUrls(parsed);
}

/** 녹화본에서 가져온 응답들의 result 전체에서 서로 다른 URL 수. */
export function recordingUrlCount(draft: MockDraft): number {
  const found = new Set<string>();
  for (const response of draft.responses) {
    if (response.origin !== "recording") continue;
    const parsed = parsedOrUndefined(response.resultJson);
    if (parsed !== undefined) collect(parsed, found);
  }
  return found.size;
}

/**
 * 경고 문장. 저장을 막지 않는다 — 판정은 사람이 한다(설계 §표시 억제).
 * `response` 는 응답 한 줄 아래, `definition` 은 저장 버튼 위에 뜬다.
 */
export function bodyUrlWarning(count: number, place: "response" | "definition"): readonly string[] {
  if (count === 0) return [];
  return place === "response"
    ? [
        `→ 이 응답 본문에 URL 이 ${count}개 있습니다. 녹화 때 가려지지 않는 자리라 자격증명이 담겼을 수 있습니다.`,
        "→ 저장 전에 result 에서 해당 값을 확인하세요.",
      ]
    : [
        `→ 녹화본에서 가져온 result 에 URL 이 ${count}개 있습니다. 녹화 때 가려지지 않는 자리라 자격증명이 담겼을 수 있습니다.`,
        "→ 저장은 막지 않습니다. 값을 확인한 뒤 저장하세요.",
      ];
}
```

`packages/dashboard/web/src/mock-builder/interactions.ts`:

```ts
import type { JsonValue, SessionInteractionEntry } from "../../../src/api-types.js";

/** 외부 호출 한 건을 화면에 어떻게 보이고 고를 수 있는지. */
export type InteractionView =
  | { readonly pickable: true; readonly label: string; readonly body: JsonValue }
  | { readonly pickable: false; readonly label: string; readonly reason: string };

/**
 * 응답이 있는 호출만 고를 수 있다(설계 §녹화본에서 고를 수 있는 것). 못 고르는 행은 숨기지
 * 않고 이유를 적는다 — 빠진 행은 사용자가 녹화가 덜 됐는지 우리가 버렸는지 알 수 없다.
 *
 * url 은 녹화 때 경로가 지워진 표시용 값 그대로다. 여기서 다시 가공하지 않는다.
 */
export function describeInteraction(entry: SessionInteractionEntry): InteractionView {
  const request = `${entry.method} ${entry.url}`;
  const outcome = entry.outcome;
  switch (outcome.kind) {
    case "response":
      return { pickable: true, label: `${request} · ${outcome.status}`, body: outcome.body };
    case "throw": {
      const detail =
        outcome.code === undefined ? outcome.failureKind : `${outcome.failureKind} · ${outcome.code}`;
      return {
        pickable: false,
        label: request,
        reason: `→ 이 호출은 응답 본문이 없어 목의 답으로 쓸 수 없습니다 — fetch 가 실패했습니다 (${detail})`,
      };
    }
    case "incomplete":
      return {
        pickable: false,
        label: request,
        reason:
          "→ 녹화가 끝나지 않은 호출입니다. 응답이 저장되지 않아 목의 답으로 쓸 수 없습니다.",
      };
  }
}

/** `GET /api/sessions/<path>/interactions`. 경로 전체를 한 세그먼트로 인코딩한다. */
export function interactionsPath(sessionPath: string): string {
  return `/api/sessions/${encodeURIComponent(sessionPath)}/interactions`;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `corepack pnpm vitest run --project web packages/dashboard/web/tests/body-urls.test.ts packages/dashboard/web/tests/interactions.test.ts`
Expected: PASS, `Test Files  2 passed`

- [ ] **Step 5: 커밋**

```bash
git add packages/dashboard/web/src/mock-builder/body-urls.ts \
  packages/dashboard/web/src/mock-builder/interactions.ts \
  packages/dashboard/web/tests/body-urls.test.ts packages/dashboard/web/tests/interactions.test.ts
git commit -m "feat(dashboard): 녹화 응답 본문의 URL 을 세고 외부 호출을 고를 수 있는지 가른다"
```

---

### Task 8: 도구 · 응답 편집기

**Files:**
- Create: `packages/dashboard/web/src/mock-builder/ToolEditor.tsx`
- Create: `packages/dashboard/web/src/mock-builder/ResponseEditor.tsx`
- Create: `packages/dashboard/web/tests/mock-editors.test.tsx`

**Interfaces:**
- Consumes: `ToolDraft`, `ResponseDraft`, `newToolDraft`, `newResponseDraft`, `preservedKeysNote` (T5), `FIELD_TYPES`, `fieldsToSchema`, `schemaToFields` (T4), `bodyUrlWarning`, `responseUrlCount` (T7), `Button`, `INPUT_CLASS`, `Toggle`
- Produces:
  - `ToolEditor(props: { index: number; tool: ToolDraft; onChange(tool: ToolDraft): void; onRemove(): void })`
  - `ResponseEditor(props: { index: number; response: ResponseDraft; toolNames: readonly string[]; highlighted: boolean; onChange(response: ResponseDraft): void; onRemove(): void })` — 강조되면 fieldset 에 `data-highlighted="true"`
  - 접근성 이름 — 도구: `도구 이름` · `설명` · `필드 N 이름` · `필드 N 타입` · `필드 N 필수` · 버튼 `필드 추가` · `JSON 으로 편집` · `입력 스키마 (JSON)` · 버튼 `폼으로 돌아가기` · `도구 삭제`. 응답: `도구` · `인자 무관 (ANY)` · `args (JSON)` · `result (JSON)` · `서버의 거절로 표시 (isError)` · 버튼 `응답 삭제`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/dashboard/web/tests/mock-editors.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  newResponseDraft,
  newToolDraft,
  type ResponseDraft,
  type ToolDraft,
} from "../src/mock-builder/draft.js";
import { ResponseEditor } from "../src/mock-builder/ResponseEditor.js";
import { ToolEditor } from "../src/mock-builder/ToolEditor.js";

afterEach(() => {
  cleanup();
});

/** 편집기는 상태를 갖지 않는다. 부모 흉내를 내며 마지막 값을 들고 있는다. */
function ToolHarness(props: { initial: ToolDraft; onLatest?: (tool: ToolDraft) => void }) {
  const [tool, setTool] = useState(props.initial);
  return (
    <ToolEditor
      index={0}
      tool={tool}
      onChange={(next) => {
        setTool(next);
        props.onLatest?.(next);
      }}
      onRemove={() => undefined}
    />
  );
}

function ResponseHarness(props: {
  initial: ResponseDraft;
  highlighted?: boolean;
  onLatest?: (response: ResponseDraft) => void;
}) {
  const [response, setResponse] = useState(props.initial);
  return (
    <ResponseEditor
      index={0}
      response={response}
      toolNames={["get_weather", "search"]}
      highlighted={props.highlighted ?? false}
      onChange={(next) => {
        setResponse(next);
        props.onLatest?.(next);
      }}
      onRemove={() => undefined}
    />
  );
}

describe("ToolEditor", () => {
  it("이름 · 설명과 평면 필드를 고친다", () => {
    let latest: ToolDraft | undefined;
    render(<ToolHarness initial={newToolDraft()} onLatest={(tool) => { latest = tool; }} />);
    fireEvent.change(screen.getByLabelText("도구 이름"), { target: { value: "get_weather" } });
    fireEvent.change(screen.getByLabelText("설명"), { target: { value: "도시의 현재 날씨" } });
    fireEvent.click(screen.getByRole("button", { name: "필드 추가" }));
    fireEvent.change(screen.getByLabelText("필드 1 이름"), { target: { value: "days" } });
    fireEvent.change(screen.getByLabelText("필드 1 타입"), { target: { value: "integer" } });
    fireEvent.click(screen.getByLabelText("필드 1 필수"));
    expect(latest).toMatchObject({
      name: "get_weather",
      description: "도시의 현재 날씨",
      fields: [{ name: "days", type: "integer", required: true }],
    });
  });

  it("JSON 으로 편집하면 지금 필드로 만든 스키마가 채워지고, 평면이면 폼으로 돌아간다", () => {
    let latest: ToolDraft | undefined;
    render(
      <ToolHarness
        initial={{ ...newToolDraft("get_weather"), fields: [{ name: "city", type: "string", required: true }] }}
        onLatest={(tool) => { latest = tool; }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "JSON 으로 편집" }));
    expect((screen.getByLabelText("입력 스키마 (JSON)") as HTMLTextAreaElement).value).toBe(
      JSON.stringify(
        { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
        null,
        2,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "폼으로 돌아가기" }));
    expect(latest?.schemaMode).toBe("fields");
    expect(latest?.fields).toEqual([{ name: "city", type: "string", required: true }]);
  });

  it("평면으로 못 돌아가는 스키마면 버튼을 끄고 이유를 적는다", () => {
    render(
      <ToolHarness
        initial={{
          ...newToolDraft("get_weather"),
          schemaMode: "json",
          schemaJson: '{"type":"object","properties":{"unit":{"type":"string","enum":["c","f"]}}}',
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "폼으로 돌아가기" })).toHaveProperty("disabled", true);
    expect(
      screen.getByText(
        "평면 폼으로 돌아갈 수 없습니다 — 필드 'unit' 의 'enum' 은(는) 평면 폼에 자리가 없습니다.",
      ),
    ).toBeTruthy();
  });

  it("JSON 을 읽을 수 없어도 버튼을 끄고 이유를 적는다", () => {
    render(<ToolHarness initial={{ ...newToolDraft("t"), schemaMode: "json", schemaJson: "{ type:" }} />);
    expect(
      screen.getByText(
        "평면 폼으로 돌아갈 수 없습니다 — 스키마 JSON 을 읽을 수 없습니다. 따옴표·쉼표·괄호 짝을 확인하세요.",
      ),
    ).toBeTruthy();
  });

  it("보존 키가 있으면 알린다", () => {
    render(
      <ToolHarness
        initial={{ ...newToolDraft("t"), extra: { outputSchema: {}, annotations: {} } }}
      />,
    );
    expect(
      screen.getByText("폼에 칸이 없는 키 2개를 그대로 보존합니다: outputSchema, annotations"),
    ).toBeTruthy();
  });
});

describe("ResponseEditor", () => {
  it("인자 무관을 켜면 args 칸이 꺼진다", () => {
    let latest: ResponseDraft | undefined;
    render(
      <ResponseHarness initial={newResponseDraft("get_weather")} onLatest={(r) => { latest = r; }} />,
    );
    fireEvent.click(screen.getByLabelText("인자 무관 (ANY)"));
    expect(latest?.anyArgs).toBe(true);
    expect(screen.getByLabelText("args (JSON)")).toHaveProperty("disabled", true);
  });

  it("도구 · result · isError 를 고친다", () => {
    let latest: ResponseDraft | undefined;
    render(
      <ResponseHarness initial={newResponseDraft("get_weather")} onLatest={(r) => { latest = r; }} />,
    );
    fireEvent.change(screen.getByLabelText("도구"), { target: { value: "search" } });
    fireEvent.change(screen.getByLabelText("result (JSON)"), { target: { value: "[]" } });
    fireEvent.click(screen.getByLabelText("서버의 거절로 표시 (isError)"));
    expect(latest).toMatchObject({ tool: "search", resultJson: "[]", isError: true });
  });

  it("녹화 응답의 result 에 URL 이 있으면 경고하고, 지우면 사라진다", () => {
    render(
      <ResponseHarness
        initial={{
          ...newResponseDraft("get_weather"),
          origin: "recording",
          resultJson: '{"next":"https://a.example/p/2","docs":"https://b.example/"}',
        }}
      />,
    );
    const first =
      "→ 이 응답 본문에 URL 이 2개 있습니다. 녹화 때 가려지지 않는 자리라 자격증명이 담겼을 수 있습니다.";
    expect(screen.getByText(first)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("result (JSON)"), {
      target: { value: '{"temperature":21.5}' },
    });
    expect(screen.queryByText(first)).toBeNull();
  });

  it("손으로 친 응답은 URL 이 있어도 경고하지 않는다", () => {
    render(
      <ResponseHarness
        initial={{ ...newResponseDraft("get_weather"), resultJson: '{"a":"https://a.example/"}' }}
      />,
    );
    expect(screen.queryByText(/URL 이 1개 있습니다/)).toBeNull();
  });

  it("강조되면 data-highlighted 가 붙는다", () => {
    const { container } = render(
      <ResponseHarness initial={newResponseDraft("get_weather")} highlighted />,
    );
    expect(container.querySelector("fieldset")?.getAttribute("data-highlighted")).toBe("true");
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `corepack pnpm vitest run --project web packages/dashboard/web/tests/mock-editors.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/mock-builder/ResponseEditor.js"`

- [ ] **Step 3: `ToolEditor` 를 구현한다**

`packages/dashboard/web/src/mock-builder/ToolEditor.tsx`:

```tsx
import type { JSX } from "react";
import { Button } from "../components/Button.js";
import { INPUT_CLASS } from "../components/Field.js";
import { preservedKeysNote, type ToolDraft } from "./draft.js";
import {
  FIELD_TYPES,
  type FieldDraft,
  type FieldType,
  fieldsToSchema,
  schemaToFields,
} from "./schema-fields.js";

export interface ToolEditorProps {
  readonly index: number;
  readonly tool: ToolDraft;
  readonly onChange: (tool: ToolDraft) => void;
  readonly onRemove: () => void;
}

/** JSON 모드에서 평면 폼으로 돌아갈 수 있으면 그 필드, 없으면 이유. */
function backToFields(
  schemaJson: string,
): { readonly fields: readonly FieldDraft[] } | { readonly reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(schemaJson);
  } catch {
    return { reason: "스키마 JSON 을 읽을 수 없습니다. 따옴표·쉼표·괄호 짝을 확인하세요." };
  }
  const result = schemaToFields(parsed);
  return result.ok ? { fields: result.fields } : { reason: result.reason };
}

/**
 * 도구 하나. 상태는 부모가 갖는다. 평면 폼은 중첩 · enum 을 다루지 않으므로 "JSON 으로 편집"
 * 을 둔다. JSON 에서 평면으로 돌아갈 수 없는 스키마면 버튼을 끄고 이유를 적는다 — 눌러서
 * 스키마 일부가 조용히 사라지면 저장한 목이 왜 인자를 다르게 검사하는지 알 수 없다.
 */
export function ToolEditor({ index, tool, onChange, onRemove }: ToolEditorProps): JSX.Element {
  const id = `tool-${index}`;
  const patchField = (at: number, patch: Partial<FieldDraft>): void => {
    onChange({
      ...tool,
      fields: tool.fields.map((field, i) => (i === at ? { ...field, ...patch } : field)),
    });
  };
  const back = tool.schemaMode === "json" ? backToFields(tool.schemaJson) : null;
  const preserved = preservedKeysNote(tool.extra);

  return (
    <fieldset className="space-y-3 rounded border border-line p-4">
      <legend className="px-1 text-sm font-semibold text-ink">{`도구 ${index + 1}`}</legend>
      <div className="space-y-1">
        <label className="block text-sm font-medium text-ink" htmlFor={`${id}-name`}>
          도구 이름
        </label>
        <input
          id={`${id}-name`}
          className={INPUT_CLASS}
          value={tool.name}
          onChange={(event) => onChange({ ...tool, name: event.target.value })}
        />
      </div>
      <div className="space-y-1">
        <label className="block text-sm font-medium text-ink" htmlFor={`${id}-description`}>
          설명
        </label>
        <input
          id={`${id}-description`}
          className={INPUT_CLASS}
          value={tool.description}
          onChange={(event) => onChange({ ...tool, description: event.target.value })}
        />
      </div>
      {tool.schemaMode === "fields" ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">입력 필드</p>
          {tool.fields.map((field, at) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: 필드 이름은 비거나 겹칠 수 있어 유일 키가 없고, 목록은 변경마다 통째로 재생성된다
              key={at}
              className="flex items-center gap-2"
            >
              <input
                aria-label={`필드 ${at + 1} 이름`}
                className={INPUT_CLASS}
                value={field.name}
                onChange={(event) => patchField(at, { name: event.target.value })}
              />
              <select
                aria-label={`필드 ${at + 1} 타입`}
                className={INPUT_CLASS}
                value={field.type}
                onChange={(event) => patchField(at, { type: event.target.value as FieldType })}
              >
                {FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <label className="flex shrink-0 items-center gap-1 text-sm text-ink">
                <input
                  type="checkbox"
                  aria-label={`필드 ${at + 1} 필수`}
                  checked={field.required}
                  onChange={(event) => patchField(at, { required: event.target.checked })}
                />
                필수
              </label>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => onChange({ ...tool, fields: tool.fields.filter((_, i) => i !== at) })}
              >
                필드 삭제
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() =>
                onChange({
                  ...tool,
                  fields: [...tool.fields, { name: "", type: "string", required: false }],
                })
              }
            >
              필드 추가
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange({
                  ...tool,
                  schemaMode: "json",
                  schemaJson: JSON.stringify(fieldsToSchema(tool.fields), null, 2),
                })
              }
            >
              JSON 으로 편집
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-ink" htmlFor={`${id}-schema`}>
            입력 스키마 (JSON)
          </label>
          <textarea
            id={`${id}-schema`}
            className={`${INPUT_CLASS} font-mono`}
            rows={8}
            value={tool.schemaJson}
            onChange={(event) => onChange({ ...tool, schemaJson: event.target.value })}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={back !== null && "reason" in back}
            onClick={() => {
              if (back !== null && "fields" in back) {
                onChange({ ...tool, schemaMode: "fields", fields: back.fields });
              }
            }}
          >
            폼으로 돌아가기
          </Button>
          {back !== null && "reason" in back && (
            <p className="text-xs text-ink-muted">{`평면 폼으로 돌아갈 수 없습니다 — ${back.reason}`}</p>
          )}
        </div>
      )}
      {preserved !== null && <p className="text-xs text-ink-muted">{preserved}</p>}
      <Button variant="ghost" size="sm" onClick={onRemove}>
        도구 삭제
      </Button>
    </fieldset>
  );
}
```

- [ ] **Step 4: `ResponseEditor` 를 구현한다**

`packages/dashboard/web/src/mock-builder/ResponseEditor.tsx`:

```tsx
import type { JSX } from "react";
import { Button } from "../components/Button.js";
import { INPUT_CLASS, Toggle } from "../components/Field.js";
import { bodyUrlWarning, responseUrlCount } from "./body-urls.js";
import { preservedKeysNote, type ResponseDraft } from "./draft.js";

export interface ResponseEditorProps {
  readonly index: number;
  readonly response: ResponseDraft;
  readonly toolNames: readonly string[];
  /** 녹화본에서 방금 가져온 줄. 다음 편집 전까지 강조한다(타이머 없음). */
  readonly highlighted: boolean;
  readonly onChange: (response: ResponseDraft) => void;
  readonly onRemove: () => void;
}

/**
 * 응답 한 줄. 녹화본에서 가져온 result 면 남은 URL 을 **고칠 때마다** 다시 센다 — 값을
 * 지우면 경고가 사라져 사람이 한 확인이 바로 보인다. 저장은 막지 않는다.
 */
export function ResponseEditor({
  index,
  response,
  toolNames,
  highlighted,
  onChange,
  onRemove,
}: ResponseEditorProps): JSX.Element {
  const id = `response-${index}`;
  // 폼에서 도구 이름을 고치면 이 응답의 도구가 목록에서 사라질 수 있다. 그 값도 보여야
  // 사용자가 무엇을 다시 골라야 하는지 안다.
  const options = toolNames.includes(response.tool) ? toolNames : [response.tool, ...toolNames];
  const warning =
    response.origin === "recording"
      ? bodyUrlWarning(responseUrlCount(response.resultJson), "response")
      : [];
  const preserved = preservedKeysNote(response.extra);

  return (
    <fieldset
      data-highlighted={highlighted ? "true" : undefined}
      className={`space-y-3 rounded border p-4 ${highlighted ? "border-accent bg-accent-soft" : "border-line"}`}
    >
      <legend className="px-1 text-sm font-semibold text-ink">{`응답 ${index + 1}`}</legend>
      <div className="space-y-1">
        <label className="block text-sm font-medium text-ink" htmlFor={`${id}-tool`}>
          도구
        </label>
        <select
          id={`${id}-tool`}
          className={INPUT_CLASS}
          value={response.tool}
          onChange={(event) => onChange({ ...response, tool: event.target.value })}
        >
          {options.map((name) => (
            <option key={name} value={name}>
              {name === "" ? "(도구를 고르세요)" : name}
            </option>
          ))}
        </select>
      </div>
      <Toggle
        id={`${id}-any`}
        label="인자 무관 (ANY)"
        checked={response.anyArgs}
        hint="켜면 args 를 적지 않습니다. 인자를 지정한 응답이 항상 먼저 매칭됩니다."
        onChange={(anyArgs) => onChange({ ...response, anyArgs })}
      />
      <div className="space-y-1">
        <label className="block text-sm font-medium text-ink" htmlFor={`${id}-args`}>
          args (JSON)
        </label>
        <textarea
          id={`${id}-args`}
          className={`${INPUT_CLASS} font-mono`}
          rows={3}
          disabled={response.anyArgs}
          value={response.argsJson}
          onChange={(event) => onChange({ ...response, argsJson: event.target.value })}
        />
      </div>
      <div className="space-y-1">
        <label className="block text-sm font-medium text-ink" htmlFor={`${id}-result`}>
          result (JSON)
        </label>
        <textarea
          id={`${id}-result`}
          className={`${INPUT_CLASS} font-mono`}
          rows={8}
          value={response.resultJson}
          onChange={(event) => onChange({ ...response, resultJson: event.target.value })}
        />
      </div>
      {warning.length > 0 && (
        <div role="note" className="space-y-0.5 text-xs text-ink">
          {warning.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
      <Toggle
        id={`${id}-error`}
        label="서버의 거절로 표시 (isError)"
        checked={response.isError}
        onChange={(isError) => onChange({ ...response, isError })}
      />
      {preserved !== null && <p className="text-xs text-ink-muted">{preserved}</p>}
      <Button variant="ghost" size="sm" onClick={onRemove}>
        응답 삭제
      </Button>
    </fieldset>
  );
}
```

`bg-accent-soft` · `border-accent` 는 Sidebar 가 이미 쓰는 토큰(`bg-accent-soft`, `text-accent`)이다. `border-accent` 유틸리티가 테마에 없으면 `border-accent-border`(`INPUT_ON_ACCENT_CLASS` 가 씀)로 바꾼다.

- [ ] **Step 5: 통과를 확인한다**

Run: `corepack pnpm vitest run --project web packages/dashboard/web/tests/mock-editors.test.tsx`
Expected: PASS, `Test Files  1 passed`

- [ ] **Step 6: 커밋**

```bash
git add packages/dashboard/web/src/mock-builder/ToolEditor.tsx \
  packages/dashboard/web/src/mock-builder/ResponseEditor.tsx \
  packages/dashboard/web/tests/mock-editors.test.tsx
git commit -m "feat(dashboard): 목 만들기의 도구 · 응답 편집기를 둔다"
```

---

### Task 9: 녹화본 패널

**Files:**
- Create: `packages/dashboard/web/src/mock-builder/RecordingPanel.tsx`
- Create: `packages/dashboard/web/tests/recording-panel.test.tsx`

**Interfaces:**
- Consumes: `GET /api/sessions` → `SessionEntry[]`, `GET interactionsPath(path)` → `SessionInteractionEntry[]` (T1), `describeInteraction`, `interactionsPath` (T7), `PickedResponse`, `isBlankResult` (T5), `apiGet`
- Produces:
  - `interface ResponseTarget { label: string; resultJson: string }`
  - `RecordingPanel(props: { toolNames: readonly string[]; responses: readonly ResponseTarget[]; onAdd(pick: PickedResponse): void; onReplaceResult(index: number, body: JsonValue): void })`
  - 접근성 이름: 선택 `녹화본` · 버튼 `새 응답으로 추가` · 입력 `어느 도구의 답인가` · 체크 `인자 무관으로 넣기` · 입력 `어떤 인자일 때 (JSON)` · 버튼 `목에 넣기` · `취소` · 선택 `넣을 응답` · 버튼 `result 로 넣기` · `바꾸기`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/dashboard/web/tests/recording-panel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JsonValue, SessionEntry, SessionInteractionEntry } from "../../src/api-types.js";
import type { PickedResponse } from "../src/mock-builder/draft.js";
import { RecordingPanel, type ResponseTarget } from "../src/mock-builder/RecordingPanel.js";

const SESSION = "recordings/weather.session.db";

const INTERACTIONS: SessionInteractionEntry[] = [
  {
    ordinal: 0,
    method: "GET",
    url: "https://api.open-meteo.com/<redacted>?city=Seoul",
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

let requested: string[];

function mockApi(options: { sessions?: SessionEntry[]; interactions?: () => Response } = {}): void {
  requested = [];
  const sessions = options.sessions ?? [{ path: SESSION, status: "completed", interactionCount: 3 }];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("/api/sessions")) return new Response(JSON.stringify(sessions));
      if (url.endsWith("/interactions")) {
        return options.interactions?.() ?? new Response(JSON.stringify(INTERACTIONS));
      }
      throw new Error(`예상하지 못한 요청: ${url}`);
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface Calls {
  readonly added: PickedResponse[];
  readonly replaced: [number, JsonValue][];
}

function renderPanel(responses: readonly ResponseTarget[] = []): Calls {
  const calls: Calls = { added: [], replaced: [] };
  render(
    <RecordingPanel
      toolNames={["get_weather"]}
      responses={responses}
      onAdd={(pick) => calls.added.push(pick)}
      onReplaceResult={(index, body) => calls.replaced.push([index, body])}
    />,
  );
  return calls;
}

async function openSession(): Promise<void> {
  await screen.findByRole("option", { name: `${SESSION} · 외부 호출 3건` });
  fireEvent.change(screen.getByLabelText("녹화본"), { target: { value: SESSION } });
  await screen.findByText("GET https://api.open-meteo.com/<redacted>?city=Seoul · 200");
}

describe("RecordingPanel", () => {
  it("녹화본을 고르면 세 갈래를 보여주고, 응답만 쓸 수 있다", async () => {
    mockApi();
    renderPanel();
    await openSession();

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
    expect(screen.getAllByRole("button", { name: "새 응답으로 추가" })).toHaveLength(1);
    expect(requested).toContain("/api/sessions/recordings%2Fweather.session.db/interactions");
  });

  it("새 응답으로 추가: 도구 이름과 인자를 적어 넣고, 넣으면 입력 칸을 닫는다", async () => {
    mockApi();
    const calls = renderPanel();
    await openSession();
    fireEvent.click(screen.getByRole("button", { name: "새 응답으로 추가" }));
    fireEvent.change(screen.getByLabelText("어느 도구의 답인가"), { target: { value: "get_weather" } });
    fireEvent.change(screen.getByLabelText("어떤 인자일 때 (JSON)"), {
      target: { value: '{"city":"Seoul"}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "목에 넣기" }));

    expect(calls.added).toEqual([
      { tool: "get_weather", argsJson: '{"city":"Seoul"}', body: { temperature: 21.5 } },
    ]);
    expect(screen.queryByRole("button", { name: "목에 넣기" })).toBeNull();
  });

  it("인자 무관으로 넣으면 argsJson 이 null 이다", async () => {
    mockApi();
    const calls = renderPanel();
    await openSession();
    fireEvent.click(screen.getByRole("button", { name: "새 응답으로 추가" }));
    fireEvent.change(screen.getByLabelText("어느 도구의 답인가"), { target: { value: "get_weather" } });
    fireEvent.click(screen.getByLabelText("인자 무관으로 넣기"));
    fireEvent.click(screen.getByRole("button", { name: "목에 넣기" }));
    expect(calls.added[0]?.argsJson).toBeNull();
  });

  it("도구 이름이 비면 넣지 않고 말한다", async () => {
    mockApi();
    const calls = renderPanel();
    await openSession();
    fireEvent.click(screen.getByRole("button", { name: "새 응답으로 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "목에 넣기" }));
    expect(calls.added).toEqual([]);
    expect(
      screen.getByText("어느 도구의 답인지 적으세요. 폼에 없는 도구면 이름만 채워 새로 만듭니다."),
    ).toBeTruthy();
  });

  it("result 로 넣기: 비어 있는 줄은 확인 없이 바꾼다", async () => {
    mockApi();
    const calls = renderPanel([
      { label: "응답 1 (get_weather)", resultJson: '{"temperature":1}' },
      { label: "응답 2 (get_weather)", resultJson: "{}" },
    ]);
    await openSession();
    fireEvent.change(screen.getByLabelText("넣을 응답"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "result 로 넣기" }));
    expect(calls.replaced).toEqual([[1, { temperature: 21.5 }]]);
  });

  it("result 로 넣기: 값이 있는 줄은 확인을 받는다", async () => {
    mockApi();
    const calls = renderPanel([{ label: "응답 1 (get_weather)", resultJson: '{"temperature":1}' }]);
    await openSession();
    fireEvent.click(screen.getByRole("button", { name: "result 로 넣기" }));
    expect(calls.replaced).toEqual([]);
    expect(
      screen.getByText("응답 1 (get_weather) 의 result 를 이 본문으로 바꿉니다. 지금 적힌 값은 사라집니다."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "바꾸기" }));
    expect(calls.replaced).toEqual([[0, { temperature: 21.5 }]]);
  });

  it("폼에 응답이 없으면 result 로 넣기가 없다", async () => {
    mockApi();
    renderPanel([]);
    await openSession();
    expect(screen.queryByRole("button", { name: "result 로 넣기" })).toBeNull();
  });

  it("녹화본을 읽을 수 없으면 서버 문장을 줄 그대로 보여준다", async () => {
    const message = [
      `→ 이 녹화본을 읽을 수 없습니다 — ${SESSION}`,
      "→ MCPeak 이 녹화한 세션 파일인지 확인하세요. 목록에는 읽을 수 있는 파일만 나옵니다.",
    ].join("\n");
    mockApi({ interactions: () => new Response(JSON.stringify({ error: message }), { status: 404 }) });
    renderPanel();
    await screen.findByRole("option", { name: `${SESSION} · 외부 호출 3건` });
    fireEvent.change(screen.getByLabelText("녹화본"), { target: { value: SESSION } });
    expect((await screen.findByRole("alert")).textContent).toBe(message);
  });

  it("녹화본이 없으면 어떻게 만드는지 말한다", async () => {
    mockApi({ sessions: [] });
    renderPanel();
    expect(
      await screen.findByText(
        "이 디렉터리 아래에 녹화본이 없습니다. mcpeak test --record-session <path> 로 녹화한 파일이 여기에 나옵니다.",
      ),
    ).toBeTruthy();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `corepack pnpm vitest run --project web packages/dashboard/web/tests/recording-panel.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/mock-builder/RecordingPanel.js"`

- [ ] **Step 3: 구현한다**

`packages/dashboard/web/src/mock-builder/RecordingPanel.tsx`:

```tsx
import type { JSX } from "react";
import { useEffect, useState } from "react";
import type { JsonValue, SessionEntry, SessionInteractionEntry } from "../../../src/api-types.js";
import { apiGet } from "../api.js";
import { Button } from "../components/Button.js";
import { INPUT_CLASS } from "../components/Field.js";
import { isBlankResult, type PickedResponse } from "./draft.js";
import { describeInteraction, interactionsPath } from "./interactions.js";

/** 폼의 응답 줄 하나. "result 로 넣기" 의 대상 목록이다. */
export interface ResponseTarget {
  readonly label: string;
  readonly resultJson: string;
}

export interface RecordingPanelProps {
  /** 폼에 이미 있는 도구 이름. 입력 칸의 제안 목록이다. */
  readonly toolNames: readonly string[];
  readonly responses: readonly ResponseTarget[];
  readonly onAdd: (pick: PickedResponse) => void;
  readonly onReplaceResult: (index: number, body: JsonValue) => void;
}

/** 한 번에 한 호출에서만 입력을 받는다. */
type Action =
  | {
      readonly kind: "add";
      readonly ordinal: number;
      readonly tool: string;
      readonly anyArgs: boolean;
      readonly argsJson: string;
      readonly error: string | null;
    }
  | { readonly kind: "confirm-replace"; readonly ordinal: number; readonly index: number };

/**
 * 편집 중 폼 옆에 펴 두는 녹화본 패널(설계 §화면 흐름). 녹화본은 **읽기만** 한다 — 서버 실행 ·
 * 재생 · 새 녹화 없음. 가져온 본문은 가공하지 않고 넘긴다. 무엇을 지울지는 폼에서 사람이 정한다.
 */
export function RecordingPanel({
  toolNames,
  responses,
  onAdd,
  onReplaceResult,
}: RecordingPanelProps): JSX.Element {
  const [sessions, setSessions] = useState<readonly SessionEntry[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [sessionPath, setSessionPath] = useState("");
  const [interactions, setInteractions] = useState<readonly SessionInteractionEntry[] | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  /** 호출(ordinal)마다 고른 "넣을 응답" 번호. 고르지 않았으면 0 이다. */
  const [targets, setTargets] = useState<Record<number, number>>({});

  useEffect(() => {
    apiGet<SessionEntry[]>("/api/sessions")
      .then(setSessions)
      .catch((err: unknown) => setListError(err instanceof Error ? err.message : String(err)));
  }, []);

  function open(path: string): void {
    setSessionPath(path);
    setInteractions(null);
    setOpenError(null);
    setAction(null);
    if (path === "") return;
    apiGet<SessionInteractionEntry[]>(interactionsPath(path))
      .then(setInteractions)
      .catch((err: unknown) => setOpenError(err instanceof Error ? err.message : String(err)));
  }

  function submitAdd(current: Extract<Action, { kind: "add" }>, body: JsonValue): void {
    const tool = current.tool.trim();
    if (tool === "") {
      setAction({
        ...current,
        error: "어느 도구의 답인지 적으세요. 폼에 없는 도구면 이름만 채워 새로 만듭니다.",
      });
      return;
    }
    onAdd({ tool, argsJson: current.anyArgs ? null : current.argsJson, body });
    setAction(null);
  }

  function replace(ordinal: number, body: JsonValue): void {
    // 폼에서 응답을 지우면 고른 번호가 범위를 벗어날 수 있다. 마지막 줄로 붙인다.
    const index = Math.min(targets[ordinal] ?? 0, responses.length - 1);
    const target = responses[index];
    if (target === undefined) return;
    if (isBlankResult(target.resultJson)) {
      onReplaceResult(index, body);
      return;
    }
    setAction({ kind: "confirm-replace", ordinal, index });
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
    <div className="space-y-4">
      <div className="space-y-1">
        <label className="block text-sm font-medium text-ink" htmlFor="recording-session">
          녹화본
        </label>
        <select
          id="recording-session"
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

      {interactions !== null && (
        <ol className="space-y-2">
          {interactions.map((entry) => {
            const view = describeInteraction(entry);
            if (!view.pickable) {
              return (
                <li key={entry.ordinal} className="space-y-1 rounded border border-line p-3">
                  <p className="font-mono text-xs text-ink-muted">{view.label}</p>
                  <p className="text-xs text-ink-muted">{view.reason}</p>
                </li>
              );
            }
            const current = action?.ordinal === entry.ordinal ? action : null;
            return (
              <li key={entry.ordinal} className="space-y-2 rounded border border-line p-3">
                <details>
                  <summary className="cursor-pointer font-mono text-xs text-ink">{view.label}</summary>
                  <pre className="mt-2 overflow-auto text-xs text-ink">
                    {JSON.stringify(view.body, null, 2)}
                  </pre>
                </details>

                {current?.kind === "add" && (
                  <div className="space-y-2">
                    <label className="block text-sm text-ink" htmlFor="pick-tool">
                      어느 도구의 답인가
                    </label>
                    <input
                      id="pick-tool"
                      list="pick-tool-names"
                      className={INPUT_CLASS}
                      value={current.tool}
                      onChange={(event) =>
                        setAction({ ...current, tool: event.target.value, error: null })
                      }
                    />
                    <datalist id="pick-tool-names">
                      {toolNames.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={current.anyArgs}
                        onChange={(event) => setAction({ ...current, anyArgs: event.target.checked })}
                      />
                      인자 무관으로 넣기
                    </label>
                    <label className="block text-sm text-ink" htmlFor="pick-args">
                      어떤 인자일 때 (JSON)
                    </label>
                    <textarea
                      id="pick-args"
                      className={`${INPUT_CLASS} font-mono`}
                      rows={2}
                      disabled={current.anyArgs}
                      value={current.argsJson}
                      onChange={(event) => setAction({ ...current, argsJson: event.target.value })}
                    />
                    {current.error !== null && <p className="text-xs text-ink">{current.error}</p>}
                    <div className="flex gap-2">
                      <Button size="sm" variant="primary" onClick={() => submitAdd(current, view.body)}>
                        목에 넣기
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setAction(null)}>
                        취소
                      </Button>
                    </div>
                  </div>
                )}

                {current?.kind === "confirm-replace" && (
                  <div className="space-y-2">
                    <p className="text-sm text-ink">
                      {`${responses[current.index]?.label ?? ""} 의 result 를 이 본문으로 바꿉니다. 지금 적힌 값은 사라집니다.`}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          onReplaceResult(current.index, view.body);
                          setAction(null);
                        }}
                      >
                        바꾸기
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setAction(null)}>
                        취소
                      </Button>
                    </div>
                  </div>
                )}

                {current === null && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="xs"
                      onClick={() =>
                        setAction({
                          kind: "add",
                          ordinal: entry.ordinal,
                          tool: "",
                          anyArgs: false,
                          argsJson: "{}",
                          error: null,
                        })
                      }
                    >
                      새 응답으로 추가
                    </Button>
                    {responses.length > 0 && (
                      <>
                        <select
                          aria-label="넣을 응답"
                          className={INPUT_CLASS}
                          value={String(Math.min(targets[entry.ordinal] ?? 0, responses.length - 1))}
                          onChange={(event) =>
                            setTargets({ ...targets, [entry.ordinal]: Number(event.target.value) })
                          }
                        >
                          {responses.map((target, index) => (
                            <option key={target.label} value={String(index)}>
                              {target.label}
                            </option>
                          ))}
                        </select>
                        <Button size="xs" onClick={() => replace(entry.ordinal, view.body)}>
                          result 로 넣기
                        </Button>
                      </>
                    )}
                  </div>
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

`ResponseTarget.label` 은 화면이 `응답 N (도구)` 로 만들어 번호가 들어가므로 키로 유일하다.

- [ ] **Step 4: 통과를 확인한다**

Run: `corepack pnpm vitest run --project web packages/dashboard/web/tests/recording-panel.test.tsx`
Expected: PASS, `Test Files  1 passed`

- [ ] **Step 5: 커밋**

```bash
git add packages/dashboard/web/src/mock-builder/RecordingPanel.tsx \
  packages/dashboard/web/tests/recording-panel.test.tsx
git commit -m "feat(dashboard): 편집 중 녹화본 응답을 골라 쓰는 패널을 둔다"
```

---

### Task 10: 첫 화면 (새로 만들기 · 기존 목 수정)

**Files:**
- Create: `packages/dashboard/web/src/mock-builder/MockStart.tsx`
- Create: `packages/dashboard/web/tests/mock-start.test.tsx`

**Interfaces:**
- Consumes: `GET /api/mocks` → `MockFileEntry[]`, `GET mockFilePath(path)` → `FileContent` (T3), `draftFromDefinition` (T6), `mockFilePath`, `MockDraft` (T5), `apiGet`, `Button`, `Card`
- Produces:
  - `interface LoadedMock { path: string; mtimeMs: number; draft: MockDraft }`
  - `MockStart(props: { onNew(): void; onOpen(mock: LoadedMock): void })`
  - 접근성 이름: 버튼 `시작` · `<path> 열기`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/dashboard/web/tests/mock-start.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileContent, MockFileEntry } from "../../src/api-types.js";
import { type LoadedMock, MockStart } from "../src/mock-builder/MockStart.js";

const LIST: MockFileEntry[] = [
  { path: "examples/weather.mock.json", toolCount: 1, responseCount: 3 },
  { path: "mocks/search.mock.json", toolCount: 2, responseCount: 5 },
];

const FILE: FileContent = {
  path: "examples/weather.mock.json",
  content: JSON.stringify({
    tools: [{ name: "get_weather", description: "도시의 현재 날씨", inputSchema: { type: "object" } }],
    responses: [],
  }),
  mtimeMs: 7,
};

function mockApi(list: MockFileEntry[], file: () => Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/api/mocks")) return new Response(JSON.stringify(list));
      if (url.startsWith("/api/mocks/")) return file();
      throw new Error(`예상하지 못한 요청: ${url}`);
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MockStart", () => {
  it("새로 만들기를 누르면 onNew 다", async () => {
    mockApi(LIST, () => new Response(JSON.stringify(FILE)));
    const onNew = vi.fn();
    render(<MockStart onNew={onNew} onOpen={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    expect(onNew).toHaveBeenCalledOnce();
  });

  it("기존 목 목록을 도구 · 응답 수와 함께 보이고, 열면 초안으로 옮겨 넘긴다", async () => {
    mockApi(LIST, () => new Response(JSON.stringify(FILE)));
    const opened: LoadedMock[] = [];
    render(<MockStart onNew={() => undefined} onOpen={(mock) => opened.push(mock)} />);

    expect(await screen.findByText("도구 2 · 응답 5")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "examples/weather.mock.json 열기" }));

    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]?.path).toBe("examples/weather.mock.json");
    expect(opened[0]?.mtimeMs).toBe(7);
    expect(opened[0]?.draft.tools[0]).toMatchObject({
      name: "get_weather",
      description: "도시의 현재 날씨",
    });
  });

  it("열 수 없으면 서버 문장을 줄 그대로 보여준다", async () => {
    const message = "→ 올바르지 않은 목 정의입니다 — examples/weather.mock.json: 객체가 아닙니다\n→ 형식: …";
    mockApi(LIST, () => new Response(JSON.stringify({ error: message }), { status: 400 }));
    render(<MockStart onNew={() => undefined} onOpen={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "examples/weather.mock.json 열기" }));
    expect((await screen.findByRole("alert")).textContent).toBe(message);
  });

  it("목 정의 파일이 없으면 그렇게 말한다", async () => {
    mockApi([], () => new Response("{}"));
    render(<MockStart onNew={() => undefined} onOpen={() => undefined} />);
    expect(
      await screen.findByText("이 디렉터리 아래에 목 정의 파일이 없습니다. 새로 만들기로 시작하세요."),
    ).toBeTruthy();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `corepack pnpm vitest run --project web packages/dashboard/web/tests/mock-start.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/mock-builder/MockStart.js"`

- [ ] **Step 3: 구현한다**

`packages/dashboard/web/src/mock-builder/MockStart.tsx`:

```tsx
import type { JSX } from "react";
import { useEffect, useState } from "react";
import type { FileContent, JsonValue, MockFileEntry } from "../../../src/api-types.js";
import { apiGet } from "../api.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { type MockDraft, mockFilePath } from "./draft.js";
import { draftFromDefinition } from "./from-definition.js";

/** 기존 목을 연 결과. `mtimeMs` 는 저장할 때 덮어쓰기 기준이 된다. */
export interface LoadedMock {
  readonly path: string;
  readonly mtimeMs: number;
  readonly draft: MockDraft;
}

export interface MockStartProps {
  readonly onNew: () => void;
  readonly onOpen: (mock: LoadedMock) => void;
}

/**
 * 첫 화면. 새로 만들기 · 기존 목 수정 둘 중 하나다. 녹화본은 여기서 고르지 않는다 — 편집 중
 * 옆에 펴 두는 참고 패널이다(설계 §화면 흐름).
 */
export function MockStart({ onNew, onOpen }: MockStartProps): JSX.Element {
  const [mocks, setMocks] = useState<readonly MockFileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    apiGet<MockFileEntry[]>("/api/mocks")
      .then(setMocks)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  function open(path: string): void {
    setOpening(true);
    setError(null);
    apiGet<FileContent>(mockFilePath(path))
      .then((file) => {
        // 서버가 assertMockDefinition 으로 본 내용이다. 여기서는 모양만 옮긴다.
        const draft = draftFromDefinition(JSON.parse(file.content) as JsonValue);
        onOpen({ path: file.path, mtimeMs: file.mtimeMs, draft });
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setOpening(false);
      });
  }

  return (
    <div className="grid grid-cols-2 items-start gap-6">
      <Card className="space-y-3 p-6">
        <h2 className="text-title font-semibold text-ink">새로 만들기</h2>
        <p className="text-sm text-ink-muted">빈 폼에서 도구와 응답을 적습니다.</p>
        <Button variant="primary" onClick={onNew}>
          시작
        </Button>
      </Card>
      <Card className="space-y-3 p-6">
        <h2 className="text-title font-semibold text-ink">기존 목 수정</h2>
        <p className="text-sm text-ink-muted">저장된 목 정의 파일을 열어 고칩니다.</p>
        {mocks === null && error === null && <p className="text-sm text-ink-muted">찾는 중…</p>}
        {mocks !== null && mocks.length === 0 && (
          <p className="text-sm text-ink-muted">
            이 디렉터리 아래에 목 정의 파일이 없습니다. 새로 만들기로 시작하세요.
          </p>
        )}
        {mocks !== null && mocks.length > 0 && (
          <ul className="space-y-1">
            {mocks.map((mock) => (
              <li key={mock.path} className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{mock.path}</span>
                  <span className="block text-xs text-ink-muted">
                    {`도구 ${mock.toolCount} · 응답 ${mock.responseCount}`}
                  </span>
                </span>
                <Button
                  size="xs"
                  disabled={opening}
                  aria-label={`${mock.path} 열기`}
                  onClick={() => open(mock.path)}
                >
                  열기
                </Button>
              </li>
            ))}
          </ul>
        )}
        {mocks !== null && mocks.length > 0 && (
          <p className="text-xs text-ink-muted">목 정의 검사를 통과한 .json 만 나옵니다.</p>
        )}
        {error !== null && (
          <p role="alert" className="whitespace-pre-line text-sm text-ink">
            {error}
          </p>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `corepack pnpm vitest run --project web packages/dashboard/web/tests/mock-start.test.tsx`
Expected: PASS, `Test Files  1 passed`

- [ ] **Step 5: 커밋**

```bash
git add packages/dashboard/web/src/mock-builder/MockStart.tsx packages/dashboard/web/tests/mock-start.test.tsx
git commit -m "feat(dashboard): 목 만들기 첫 화면에 새로 만들기와 기존 목 수정을 둔다"
```

---

### Task 11: 화면 조립 · 라우트 · 사이드바

**Files:**
- Create: `packages/dashboard/web/src/screens/MockBuilder.tsx`
- Modify: `packages/dashboard/web/src/App.tsx` (주석 표, `Route`, `parseRoute`, `Screen`)
- Modify: `packages/dashboard/web/src/components/Sidebar.tsx` (`NavId`, `NAV_ITEMS`, 주석)
- Create: `packages/dashboard/web/tests/mock-builder.test.tsx`
- Modify: `packages/dashboard/web/tests/app-shell.test.tsx:11,33`

**Interfaces:**
- Consumes: T5 · T7 · T8 · T9 · T10 전부, `apiSend`, `PutFileRequest`, `PutFileResponse`, `PageHeader`, `Card`, `Field`, `INPUT_CLASS`
- Produces: `MockBuilder(): JSX.Element`, 라우트 `#/mock`, `NavId` 에 `"mock"`
  - 접근성 이름: 버튼 `녹화본 보기` / `녹화본 닫기` · `← 처음으로` · `버리고 돌아가기` · `도구 추가` · `응답 추가` · `저장` · `덮어쓰기` · `취소`, 입력 `저장 위치`

- [ ] **Step 1: 실패하는 화면 테스트를 쓴다**

`packages/dashboard/web/tests/mock-builder.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  FileContent,
  MockFileEntry,
  SessionEntry,
  SessionInteractionEntry,
} from "../../src/api-types.js";
import { MockBuilder } from "../src/screens/MockBuilder.js";

interface Put {
  readonly url: string;
  readonly body: { content: string; baseMtimeMs: number };
}

let puts: Put[];

const LOADED: FileContent = {
  path: "examples/weather.mock.json",
  content: JSON.stringify({
    tools: [
      {
        name: "get_weather",
        description: "도시의 현재 날씨",
        inputSchema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    ],
    responses: [
      { tool: "get_weather", args: { city: "Seoul" }, result: { temperature: 21.5 }, isError: false },
    ],
  }),
  mtimeMs: 7,
};

/** PUT 응답을 차례대로 돌려준다. GET 은 목 하나 · 녹화본 하나 · 응답 하나다. */
function mockApi(putResponses: Response[]): void {
  puts = [];
  const mocks: MockFileEntry[] = [{ path: LOADED.path, toolCount: 1, responseCount: 1 }];
  const sessions: SessionEntry[] = [
    { path: "weather.session.db", status: "completed", interactionCount: 1 },
  ];
  const interactions: SessionInteractionEntry[] = [
    {
      ordinal: 0,
      method: "GET",
      url: "https://api.open-meteo.com/<redacted>?city=Seoul",
      outcome: {
        kind: "response",
        status: 200,
        body: { temperature: 21.5, next: "https://api.open-meteo.com/v1/page/2?key=abc" },
      },
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
      const url = String(input);
      if (init?.method === "PUT") {
        puts.push({ url, body: JSON.parse(init.body ?? "{}") });
        const next = putResponses.shift();
        if (next === undefined) throw new Error("PUT 응답이 더 없다");
        return next;
      }
      if (url.endsWith("/api/mocks")) return new Response(JSON.stringify(mocks));
      if (url.startsWith("/api/mocks/")) return new Response(JSON.stringify(LOADED));
      if (url.endsWith("/api/sessions")) return new Response(JSON.stringify(sessions));
      if (url.endsWith("/interactions")) return new Response(JSON.stringify(interactions));
      throw new Error(`예상하지 못한 요청: ${url}`);
    }),
  );
}

const saved = (mtimeMs = 1) =>
  new Response(JSON.stringify({ saved: true, mtimeMs }), { status: 200 });
const conflict = (mtimeMs: number) =>
  new Response(JSON.stringify({ saved: false, reason: "conflict", mtimeMs }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function startNew(): Promise<void> {
  render(<MockBuilder />);
  fireEvent.click(await screen.findByRole("button", { name: "시작" }));
}

async function openLoaded(): Promise<void> {
  render(<MockBuilder />);
  fireEvent.click(await screen.findByRole("button", { name: `${LOADED.path} 열기` }));
  await screen.findByText(`편집 중: ${LOADED.path}`);
}

/** 도구 하나 · 응답 하나를 폼으로 채운다. */
function fillWeather(): void {
  fireEvent.click(screen.getByRole("button", { name: "도구 추가" }));
  fireEvent.change(screen.getByLabelText("도구 이름"), { target: { value: "get_weather" } });
  fireEvent.click(screen.getByRole("button", { name: "필드 추가" }));
  fireEvent.change(screen.getByLabelText("필드 1 이름"), { target: { value: "city" } });
  fireEvent.click(screen.getByLabelText("필드 1 필수"));
  fireEvent.click(screen.getByRole("button", { name: "응답 추가" }));
  fireEvent.change(screen.getByLabelText("args (JSON)"), { target: { value: '{"city":"Seoul"}' } });
  fireEvent.change(screen.getByLabelText("result (JSON)"), {
    target: { value: '{"temperature":21.5}' },
  });
}

const WEATHER_SCHEMA = {
  type: "object",
  properties: { city: { type: "string" } },
  required: ["city"],
};

const NEW_BYTES = `${JSON.stringify(
  {
    tools: [{ name: "get_weather", inputSchema: WEATHER_SCHEMA }],
    responses: [{ tool: "get_weather", args: { city: "Seoul" }, result: { temperature: 21.5 } }],
  },
  null,
  2,
)}\n`;

const LOADED_BYTES = `${JSON.stringify(
  {
    tools: [{ name: "get_weather", description: "도시의 현재 날씨", inputSchema: WEATHER_SCHEMA }],
    responses: [{ tool: "get_weather", args: { city: "Seoul" }, result: { temperature: 21.5 } }],
  },
  null,
  2,
)}\n`;

describe("MockBuilder — 새로 만들기", () => {
  it("폼으로 채워 저장한다. 처음은 baseMtimeMs 0, 저장 뒤에는 받은 mtime 이 기준이다", async () => {
    mockApi([saved(1), saved(2)]);
    await startNew();
    fillWeather();
    fireEvent.change(screen.getByLabelText("저장 위치"), {
      target: { value: "mocks/weather.mock.json" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText("저장했습니다 — mocks/weather.mock.json")).toBeTruthy();
    expect(screen.getByText("편집 중: mocks/weather.mock.json")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts).toEqual([
      { url: "/api/mocks/mocks%2Fweather.mock.json", body: { content: NEW_BYTES, baseMtimeMs: 0 } },
      { url: "/api/mocks/mocks%2Fweather.mock.json", body: { content: NEW_BYTES, baseMtimeMs: 1 } },
    ]);
  });

  it("경로에 파일이 있으면 '이미 파일이 있습니다' 로 묻고, 받은 mtime 으로 다시 보낸다", async () => {
    mockApi([conflict(42), saved()]);
    await startNew();
    fillWeather();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText("이미 파일이 있습니다 — mock.json. 덮어쓸까요?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "덮어쓰기" }));
    expect(await screen.findByText("저장했습니다 — mock.json")).toBeTruthy();
    expect(puts.map((put) => put.body.baseMtimeMs)).toEqual([0, 42]);
  });

  it("서버가 거절하면 그 문장을 줄 그대로 보여준다", async () => {
    const message = [
      "→ 올바르지 않은 목 정의입니다 — mock.json: responses[0] 의 툴 'x' 이 tools 에 없습니다. 있는 툴: get_weather",
      '→ 형식: { "tools": [ { "name": ..., "inputSchema": ... } ], "responses": [ { "tool": ..., "result": ... } ] }',
    ].join("\n");
    mockApi([new Response(JSON.stringify({ error: message }), { status: 400 })]);
    await startNew();
    fillWeather();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect((await screen.findByRole("alert")).textContent).toBe(message);
  });

  it("조립할 수 없으면 PUT 하지 않고 문제를 전부 적는다", async () => {
    mockApi([]);
    await startNew();
    fireEvent.click(screen.getByRole("button", { name: "도구 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "응답 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    const alert = await screen.findByRole("alert");
    expect(Array.from(alert.querySelectorAll("li")).map((li) => li.textContent)).toEqual([
      "도구 1번의 이름이 비어 있습니다. 목이 tools/list 로 내보낼 이름을 적으세요.",
      "응답 1번의 도구를 고르세요.",
    ]);
    expect(puts).toEqual([]);
  });
});

describe("MockBuilder — 기존 목 수정", () => {
  it("파일 내용으로 폼을 채우고, 같은 경로에 열 때 받은 mtime 으로 저장한다", async () => {
    mockApi([saved()]);
    await openLoaded();
    expect((screen.getByLabelText("도구 이름") as HTMLInputElement).value).toBe("get_weather");
    expect((screen.getByLabelText("설명") as HTMLInputElement).value).toBe("도시의 현재 날씨");
    expect((screen.getByLabelText("저장 위치") as HTMLInputElement).value).toBe(LOADED.path);

    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      url: "/api/mocks/examples%2Fweather.mock.json",
      body: { content: LOADED_BYTES, baseMtimeMs: 7 },
    });
  });

  it("열어 둔 사이 파일이 바뀌었으면 '불러온 뒤에 바뀌었습니다' 로 묻는다", async () => {
    mockApi([conflict(9), saved()]);
    await openLoaded();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(
      await screen.findByText(`이 파일이 불러온 뒤에 바뀌었습니다 — ${LOADED.path}. 덮어쓸까요?`),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "덮어쓰기" }));
    await waitFor(() => expect(puts.map((put) => put.body.baseMtimeMs)).toEqual([7, 9]));
  });

  it("저장 위치를 다른 경로로 바꾸면 새 파일처럼 0 을 보낸다", async () => {
    mockApi([saved()]);
    await openLoaded();
    fireEvent.change(screen.getByLabelText("저장 위치"), { target: { value: "copy.mock.json" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(puts[0]?.body.baseMtimeMs).toBe(0));
  });
});

describe("MockBuilder — 녹화본 패널 · 처음으로", () => {
  it("녹화본에서 새 응답으로 넣으면 도구와 함께 폼에 들어가 강조되고, URL 경고가 줄과 저장 위에 뜬다", async () => {
    mockApi([saved()]);
    await startNew();
    fireEvent.click(screen.getByRole("button", { name: "녹화본 보기" }));
    await screen.findByRole("option", { name: "weather.session.db · 외부 호출 1건" });
    fireEvent.change(screen.getByLabelText("녹화본"), { target: { value: "weather.session.db" } });
    fireEvent.click(await screen.findByRole("button", { name: "새 응답으로 추가" }));
    fireEvent.change(screen.getByLabelText("어느 도구의 답인가"), { target: { value: "get_weather" } });
    fireEvent.click(screen.getByLabelText("인자 무관으로 넣기"));
    fireEvent.click(screen.getByRole("button", { name: "목에 넣기" }));

    expect((screen.getByLabelText("도구 이름") as HTMLInputElement).value).toBe("get_weather");
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

  it("고친 뒤 처음으로 가려면 버릴지 묻는다. 고치지 않았으면 바로 간다", async () => {
    mockApi([]);
    await startNew();
    fireEvent.click(screen.getByRole("button", { name: "← 처음으로" }));
    expect(await screen.findByRole("button", { name: "시작" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    fireEvent.click(await screen.findByRole("button", { name: "도구 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "← 처음으로" }));
    expect(screen.getByText("→ 지금 폼의 내용을 버리고 처음으로 돌아갑니다.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "버리고 돌아가기" }));
    expect(await screen.findByRole("button", { name: "시작" })).toBeTruthy();
  });
});
```

`packages/dashboard/web/tests/app-shell.test.tsx` 를 고친다.

```ts
const NAV_LABELS = ["Test", "Runs", "Generate", "Replay", "Mock", "Repair"];
```

```ts
  it("사이드바 라벨이 순서대로 Test, Runs, Generate, Replay, Mock, Repair 이고 그 뒤에 Settings, Help & Docs 가 온다", async () => {
```

- [ ] **Step 2: 실패를 확인한다**

Run: `corepack pnpm vitest run --project web packages/dashboard/web/tests/mock-builder.test.tsx packages/dashboard/web/tests/app-shell.test.tsx`
Expected: FAIL — `mock-builder.test.tsx` 는 import 해석 실패, `app-shell` 은 라벨 배열에 `Mock` 이 없다.

- [ ] **Step 3: 화면을 구현한다**

`packages/dashboard/web/src/screens/MockBuilder.tsx`:

```tsx
import type { JSX } from "react";
import { useState } from "react";
import type { PutFileRequest, PutFileResponse } from "../../../src/api-types.js";
import { apiSend } from "../api.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { Field, INPUT_CLASS } from "../components/Field.js";
import { PageHeader } from "../components/PageHeader.js";
import { bodyUrlWarning, recordingUrlCount } from "../mock-builder/body-urls.js";
import {
  addPickedResponse,
  buildMockDefinition,
  EMPTY_MOCK_DRAFT,
  type MockDraft,
  mockFilePath,
  newResponseDraft,
  newToolDraft,
  preservedKeysNote,
  replaceResult,
  serializeMockDefinition,
} from "../mock-builder/draft.js";
import { MockStart } from "../mock-builder/MockStart.js";
import { RecordingPanel } from "../mock-builder/RecordingPanel.js";
import { ResponseEditor } from "../mock-builder/ResponseEditor.js";
import { ToolEditor } from "../mock-builder/ToolEditor.js";

/** 무엇을 편집 중인가. `file` 의 `mtimeMs` 가 저장할 때 덮어쓰기 기준이다. */
type EditSource =
  | { readonly kind: "new" }
  | { readonly kind: "file"; readonly path: string; readonly mtimeMs: number };

type SaveState =
  | { readonly kind: "idle" }
  | { readonly kind: "invalid"; readonly errors: readonly string[] }
  | { readonly kind: "saving" }
  | {
      readonly kind: "conflict";
      readonly path: string;
      readonly mtimeMs: number;
      /** `exists`: 새 목인데 경로에 파일이 있다. `changed`: 연 뒤 누가 파일을 바꿨다. */
      readonly reason: "exists" | "changed";
    }
  | { readonly kind: "saved"; readonly path: string }
  | { readonly kind: "failed"; readonly message: string };

const DEFAULT_TARGET = "mock.json";

/**
 * 목 만들기 — `mock.json` 을 새로 만들거나 기존 파일을 열어 고친다(설계 2026-09-28).
 *
 * 첫 화면에서 새로 만들기 · 기존 목 수정을 고른다. 녹화본은 시작 갈래가 아니라 편집 화면
 * 옆에 펴 두는 패널이다. 검증은 서버가 `assertMockDefinition` 으로 한다 — web 은
 * `@mcpeak/mock` 을 import 하지 않는다.
 *
 * 덮어쓰기: 새 목은 `baseMtimeMs: 0`, 연 파일은 열 때 받은 mtime 을 보낸다. 저장에 성공하면
 * 그 경로 · 새 mtime 이 기준이 된다 — 같은 목을 다시 저장할 때마다 확인을 묻지 않는다.
 */
export function MockBuilder(): JSX.Element {
  const [source, setSource] = useState<EditSource | null>(null);
  const [draft, setDraft] = useState<MockDraft>(EMPTY_MOCK_DRAFT);
  const [dirty, setDirty] = useState(false);
  const [targetPath, setTargetPath] = useState(DEFAULT_TARGET);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [showRecordings, setShowRecordings] = useState(false);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [leaving, setLeaving] = useState(false);

  function begin(next: EditSource, nextDraft: MockDraft, path: string): void {
    setSource(next);
    setDraft(nextDraft);
    setTargetPath(path);
    setDirty(false);
    setSave({ kind: "idle" });
    setShowRecordings(false);
    setHighlighted(null);
    setLeaving(false);
  }

  if (source === null) {
    return (
      <div className="space-y-6">
        <PageHeader title="목 만들기" description="어떻게 시작할지 고르세요." />
        <MockStart
          onNew={() => begin({ kind: "new" }, EMPTY_MOCK_DRAFT, DEFAULT_TARGET)}
          onOpen={(mock) =>
            begin({ kind: "file", path: mock.path, mtimeMs: mock.mtimeMs }, mock.draft, mock.path)
          }
        />
      </div>
    );
  }

  const editing = source;
  const toolNames = draft.tools.map((tool) => tool.name.trim()).filter((name) => name !== "");
  const urlWarning = bodyUrlWarning(recordingUrlCount(draft), "definition");
  const topPreserved = preservedKeysNote(draft.extra);

  /** `touched` 는 녹화본에서 방금 가져온 줄. 그 밖의 편집은 강조를 지운다. */
  function update(next: MockDraft, touched: number | null = null): void {
    setDraft(next);
    setDirty(true);
    setSave({ kind: "idle" });
    setHighlighted(touched);
  }

  function baseMtimeFor(path: string): number {
    return editing.kind === "file" && editing.path === path ? editing.mtimeMs : 0;
  }

  async function submit(baseMtimeMs: number): Promise<void> {
    const built = buildMockDefinition(draft);
    if (!built.ok) {
      setSave({ kind: "invalid", errors: built.errors });
      return;
    }
    const path = targetPath.trim();
    if (path === "") {
      setSave({
        kind: "invalid",
        errors: ["저장 위치를 적으세요. 대시보드를 띄운 디렉터리 기준 상대경로입니다."],
      });
      return;
    }
    setSave({ kind: "saving" });
    const request: PutFileRequest = {
      content: serializeMockDefinition(built.definition),
      baseMtimeMs,
    };
    try {
      const result = await apiSend<PutFileResponse>("PUT", mockFilePath(path), request);
      if (result.saved) {
        setSource({ kind: "file", path, mtimeMs: result.mtimeMs });
        setDirty(false);
        setSave({ kind: "saved", path });
        return;
      }
      setSave({
        kind: "conflict",
        path,
        mtimeMs: result.mtimeMs,
        reason: baseMtimeMs === 0 ? "exists" : "changed",
      });
    } catch (err: unknown) {
      setSave({ kind: "failed", message: err instanceof Error ? err.message : String(err) });
    }
  }

  function leave(): void {
    if (dirty) {
      setLeaving(true);
      return;
    }
    setSource(null);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="목 만들기"
        description={editing.kind === "new" ? "새 목" : `편집 중: ${editing.path}`}
        aside={
          <div className="flex gap-2">
            <Button onClick={() => setShowRecordings((shown) => !shown)}>
              {showRecordings ? "녹화본 닫기" : "녹화본 보기"}
            </Button>
            <Button variant="ghost" onClick={leave}>
              ← 처음으로
            </Button>
          </div>
        }
      />

      {leaving && (
        <div className="flex items-center gap-3">
          <p className="text-sm text-ink">→ 지금 폼의 내용을 버리고 처음으로 돌아갑니다.</p>
          <Button size="sm" variant="primary" onClick={() => setSource(null)}>
            버리고 돌아가기
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setLeaving(false)}>
            취소
          </Button>
        </div>
      )}

      {topPreserved !== null && <p className="text-xs text-ink-muted">{topPreserved}</p>}

      <div className={showRecordings ? "grid grid-cols-2 items-start gap-6" : ""}>
        <div className="space-y-6">
          <Card className="space-y-4 p-6">
            <h2 className="text-title font-semibold text-ink">도구</h2>
            {draft.tools.map((tool, index) => (
              <ToolEditor
                // biome-ignore lint/suspicious/noArrayIndexKey: 도구 이름은 비거나 겹칠 수 있어 유일 키가 없고, 목록은 변경마다 통째로 재생성된다
                key={index}
                index={index}
                tool={tool}
                onChange={(next) =>
                  update({ ...draft, tools: draft.tools.map((t, i) => (i === index ? next : t)) })
                }
                onRemove={() =>
                  update({ ...draft, tools: draft.tools.filter((_, i) => i !== index) })
                }
              />
            ))}
            <Button onClick={() => update({ ...draft, tools: [...draft.tools, newToolDraft()] })}>
              도구 추가
            </Button>
          </Card>

          <Card className="space-y-4 p-6">
            <h2 className="text-title font-semibold text-ink">응답</h2>
            {draft.responses.map((response, index) => (
              <ResponseEditor
                // biome-ignore lint/suspicious/noArrayIndexKey: 같은 도구 · 같은 인자 응답이 겹칠 수 있어 유일 키가 없고, 목록은 변경마다 통째로 재생성된다
                key={index}
                index={index}
                response={response}
                toolNames={toolNames}
                highlighted={highlighted === index}
                onChange={(next) =>
                  update({
                    ...draft,
                    responses: draft.responses.map((r, i) => (i === index ? next : r)),
                  })
                }
                onRemove={() =>
                  update({ ...draft, responses: draft.responses.filter((_, i) => i !== index) })
                }
              />
            ))}
            <Button
              onClick={() =>
                update({
                  ...draft,
                  responses: [...draft.responses, newResponseDraft(toolNames[0] ?? "")],
                })
              }
            >
              응답 추가
            </Button>
          </Card>

          <Card className="space-y-3 p-6">
            <Field
              label="저장 위치"
              htmlFor="mock-target"
              hint="대시보드를 띄운 디렉터리 기준 상대경로"
            >
              <input
                id="mock-target"
                className={INPUT_CLASS}
                value={targetPath}
                onChange={(event) => {
                  setTargetPath(event.target.value);
                  setSave({ kind: "idle" });
                }}
              />
            </Field>
            {urlWarning.length > 0 && (
              <div role="note" className="space-y-0.5 text-xs text-ink">
                {urlWarning.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            )}
            <Button
              variant="primary"
              disabled={save.kind === "saving"}
              onClick={() => void submit(baseMtimeFor(targetPath.trim()))}
            >
              저장
            </Button>
            <SaveStatus
              state={save}
              onOverwrite={(mtimeMs) => void submit(mtimeMs)}
              onCancel={() => setSave({ kind: "idle" })}
            />
          </Card>
        </div>

        {showRecordings && (
          <Card className="sticky top-0 p-6">
            <RecordingPanel
              toolNames={toolNames}
              responses={draft.responses.map((response, index) => ({
                label: `응답 ${index + 1} (${response.tool.trim() === "" ? "도구 없음" : response.tool.trim()})`,
                resultJson: response.resultJson,
              }))}
              onAdd={(pick) => update(addPickedResponse(draft, pick), draft.responses.length)}
              onReplaceResult={(index, body) => update(replaceResult(draft, index, body), index)}
            />
          </Card>
        )}
      </div>
    </div>
  );
}

function SaveStatus(props: {
  readonly state: SaveState;
  readonly onOverwrite: (mtimeMs: number) => void;
  readonly onCancel: () => void;
}): JSX.Element | null {
  const { state } = props;
  switch (state.kind) {
    case "idle":
    case "saving":
      return null;
    case "saved":
      return <p className="text-sm text-ink">{`저장했습니다 — ${state.path}`}</p>;
    case "conflict":
      return (
        <div className="flex items-center gap-3">
          <p className="text-sm text-ink">
            {state.reason === "exists"
              ? `이미 파일이 있습니다 — ${state.path}. 덮어쓸까요?`
              : `이 파일이 불러온 뒤에 바뀌었습니다 — ${state.path}. 덮어쓸까요?`}
          </p>
          <Button size="sm" variant="primary" onClick={() => props.onOverwrite(state.mtimeMs)}>
            덮어쓰기
          </Button>
          <Button size="sm" variant="ghost" onClick={props.onCancel}>
            취소
          </Button>
        </div>
      );
    case "invalid":
      return (
        <ul role="alert" className="list-disc space-y-0.5 pl-5 text-sm text-ink">
          {state.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      );
    case "failed":
      return (
        <p role="alert" className="whitespace-pre-line text-sm text-ink">
          {state.message}
        </p>
      );
  }
}
```

`PageHeader` 의 `description` 이 `ReactNode` 라 문자열 하나로 넘기면 `getByText("편집 중: …")` 로 찾힌다. PageHeader 가 description 을 다른 요소로 감싸도 텍스트 노드는 하나다.

- [ ] **Step 4: 라우트 · 사이드바를 연결한다**

`App.tsx`:

주석 표에 줄을 더한다.

```ts
 * | `#/mock` | MockBuilder (목 만들기) |
```

import 에 추가한다.

```ts
import { MockBuilder } from "./screens/MockBuilder.js";
```

`Route` 에 갈래를 더한다(`replay` 다음).

```ts
  | { readonly screen: "mock" }
```

`parseRoute` 의 `replay` 분기 아래.

```ts
  if (first === "mock") {
    return { screen: "mock" };
  }
```

`Screen` 의 `case "replay"` 아래.

```tsx
    case "mock":
      return <MockBuilder />;
```

`Sidebar.tsx`:

```ts
export type NavId = "home" | "runs" | "generate" | "replay" | "mock" | "repair" | "settings";
```

`NAV_ITEMS` 에서 `replay` 항목 바로 뒤에 넣는다.

```tsx
  {
    id: "mock",
    label: "Mock",
    hash: "#/mock",
    icon: (
      // biome-ignore lint/a11y/noSvgWithoutTitle: 장식용 아이콘, 라벨 텍스트가 인접
      <svg {...ICON_PROPS}>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M9 9h6v6H9z" />
      </svg>
    ),
  },
```

파일 머리 주석의 "내비 5항목" 을 "내비 6항목" 으로 고친다.

- [ ] **Step 5: 통과를 확인한다**

Run: `corepack pnpm vitest run --project web packages/dashboard/web/tests/mock-builder.test.tsx packages/dashboard/web/tests/app-shell.test.tsx packages/dashboard/web/tests/app.test.ts`
Expected: PASS, `Test Files  3 passed`

- [ ] **Step 6: web 전체 · 타입 · 린트**

Run: `corepack pnpm vitest run --project web >/dev/null 2>&1; echo $?`
Expected: `0`. 이어서 파이프 없이 다시 돌려 출력의 `Test Files  N passed` 가 이 작업 전보다 **9** 늘었는지 본다(schema-fields · mock-draft · from-definition · body-urls · interactions · mock-editors · recording-panel · mock-start · mock-builder).

Run: `corepack pnpm --filter @mcpeak/dashboard typecheck >/dev/null 2>&1; echo $?`
Expected: `0`

Run: `corepack pnpm biome check packages/dashboard >/dev/null 2>&1; echo $?`
Expected: `0`. 아니면 `corepack pnpm biome check --write packages/dashboard` 로 포맷만 고치고 다시 본다. 린트 규칙 위반은 손으로 고친다.

- [ ] **Step 7: 커밋**

```bash
git add packages/dashboard/web/src/screens/MockBuilder.tsx packages/dashboard/web/src/App.tsx \
  packages/dashboard/web/src/components/Sidebar.tsx packages/dashboard/web/tests/mock-builder.test.tsx \
  packages/dashboard/web/tests/app-shell.test.tsx
git commit -m "feat(dashboard): 목 만들기 화면을 사이드바에 붙인다"
```

---

### Task 12: 왕복 E2E (직렬 웨이브)

**Files:**
- Create: `packages/dashboard/tests/mock-builder-e2e.test.ts`

**Interfaces:**
- Consumes: `startDashboardServer({ port: 0, root })`, `GET` · `PUT /api/mocks/<path>` (T2 · T3), `buildMockDefinition` · `serializeMockDefinition` · `mockFilePath` · `MockDraft` (T5), `draftFromDefinition` (T6), `assertMockDefinition` · `createMockServer` (`@mcpeak/mock`), `connect({ url })` (`@mcpeak/core`)
- Produces: 없음(검증만)

- [ ] **Step 1: 테스트를 쓴다**

`packages/dashboard/tests/mock-builder-e2e.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpClient } from "@mcpeak/core";
import { connect } from "@mcpeak/core";
import { assertMockDefinition, createMockServer, type MockServer } from "@mcpeak/mock";
import { afterEach, describe, expect, it } from "vitest";
import type { FileContent, JsonValue, PutFileResponse } from "../src/api-types.js";
import { type DashboardServer, startDashboardServer } from "../src/index.js";
import {
  buildMockDefinition,
  type MockDraft,
  mockFilePath,
  serializeMockDefinition,
} from "../web/src/mock-builder/draft.js";
import { draftFromDefinition } from "../web/src/mock-builder/from-definition.js";

/**
 * 폼 초안 → 대시보드 PUT → 파일 → 목 서버. 그리고 기존 파일 → GET → 초안 → PUT → 목 서버.
 * 사용자가 화면에서 만들거나 고친 파일이 **목이 읽는 그대로** 동작하는지 본다.
 * 파일명이 `*-e2e.test.ts` 라 직렬 갈래로 수집된다.
 *
 * `mcpeak-mock` bin(stdio) 대신 `createMockServer`(HTTP)를 쓴다. 정의를 해석하는 경로
 * (`assertMockDefinition` → `seed` → `buildServer`)가 같고, bin 을 띄우려면 빌드 산출물이나
 * mock 패키지의 테스트 전용 로더가 필요하기 때문이다(계획서 "확정한 판단").
 */

const WEATHER_TOOL = {
  name: "get_weather",
  description: "",
  schemaMode: "fields" as const,
  fields: [{ name: "city", type: "string" as const, required: true }],
  schemaJson: "",
  extra: {},
};

const DRAFT: MockDraft = {
  tools: [WEATHER_TOOL],
  responses: [
    {
      tool: "get_weather",
      anyArgs: false,
      argsJson: '{"city":"Seoul"}',
      resultJson: '{"temperature":21.5}',
      isError: false,
      origin: "recording",
      extra: {},
    },
    {
      tool: "get_weather",
      anyArgs: false,
      argsJson: '{"city":"Nowhere"}',
      resultJson: '{"error":"unknown city"}',
      isError: true,
      origin: "manual",
      extra: {},
    },
    {
      tool: "get_weather",
      anyArgs: true,
      argsJson: "",
      resultJson: '{"temperature":0}',
      isError: false,
      origin: "manual",
      extra: {},
    },
  ],
  extra: {},
};

/** 손으로 쓴 기존 파일. 서식 · 기본값 명시 · 보존 키가 섞여 있다. */
const HANDWRITTEN = `{"$comment":"손으로 적은 메모","tools":[{"name":"get_weather","annotations":{"readOnlyHint":true},"inputSchema":{"type":"object","required":["city"],"properties":{"city":{"type":"string"}}}}],"responses":[{"tool":"get_weather","args":{"city":"Seoul"},"result":{"temperature":21.5},"isError":false}]}`;

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => undefined);
});

async function startDashboard(): Promise<{ base: string; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "mcpeak-mock-builder-e2e-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const server: DashboardServer = await startDashboardServer({ port: 0, root });
  cleanups.push(() => server.close());
  return { base: `http://127.0.0.1:${server.port}`, root };
}

async function saveDraft(
  base: string,
  path: string,
  draft: MockDraft,
  baseMtimeMs = 0,
): Promise<void> {
  const built = buildMockDefinition(draft);
  if (!built.ok) throw new Error(built.errors.join("\n"));
  const response = await fetch(`${base}${mockFilePath(path)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: serializeMockDefinition(built.definition), baseMtimeMs }),
  });
  expect(response.status).toBe(200);
  expect(((await response.json()) as PutFileResponse).saved).toBe(true);
}

/** 화면의 "기존 목 수정" 과 같은 길로 연다. */
async function openMock(base: string, path: string): Promise<{ draft: MockDraft; mtimeMs: number }> {
  const response = await fetch(`${base}${mockFilePath(path)}`);
  expect(response.status).toBe(200);
  const file = (await response.json()) as FileContent;
  return { draft: draftFromDefinition(JSON.parse(file.content) as JsonValue), mtimeMs: file.mtimeMs };
}

/** 저장된 파일을 목이 읽는 방식 그대로 읽어 띄우고 붙는다. */
async function connectToSavedMock(file: string): Promise<McpClient> {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  assertMockDefinition(parsed, file);
  const mock: MockServer = await createMockServer(parsed);
  cleanups.push(() => mock.close());
  const client = await connect({ url: mock.url });
  cleanups.push(() => client.close());
  return client;
}

function textOf(result: { content: unknown }): unknown {
  const content = result.content as { type: string; text: string }[];
  const first = content[0];
  if (first?.type !== "text") throw new Error("text content 가 없다");
  return JSON.parse(first.text);
}

describe.sequential("목 만들기 왕복", () => {
  it("새로 만든 파일을 목이 tools/list · tools/call 로 적은 대로 내놓는다", async () => {
    const { base, root } = await startDashboard();
    await saveDraft(base, "weather.mock.json", DRAFT);

    const client = await connectToSavedMock(join(root, "weather.mock.json"));

    const tools = await client.listTools();
    expect(tools.map((tool) => ({ name: tool.name, inputSchema: tool.inputSchema }))).toEqual([
      {
        name: "get_weather",
        inputSchema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    ]);

    const seoul = await client.callTool("get_weather", { city: "Seoul" });
    expect(seoul.isError).toBe(false);
    expect(textOf(seoul)).toEqual({ temperature: 21.5 });

    const nowhere = await client.callTool("get_weather", { city: "Nowhere" });
    expect(nowhere.isError).toBe(true);
    expect(textOf(nowhere)).toEqual({ error: "unknown city" });

    // 인자 무관(ANY) 응답이 지정되지 않은 인자를 받는다.
    const busan = await client.callTool("get_weather", { city: "Busan" });
    expect(busan.isError).toBe(false);
    expect(textOf(busan)).toEqual({ temperature: 0 });
  });

  it("같은 초안을 두 번 저장하면 두 파일이 바이트 단위로 같다", async () => {
    const { base, root } = await startDashboard();
    await saveDraft(base, "a.mock.json", DRAFT);
    await saveDraft(base, "b.mock.json", DRAFT);

    const [a, b] = await Promise.all([
      readFile(join(root, "a.mock.json")),
      readFile(join(root, "b.mock.json")),
    ]);
    expect(a.equals(b)).toBe(true);
  });

  it("기존 파일을 열어 응답을 더해 저장하면 보존 키가 살고, 목이 새 응답까지 내놓는다", async () => {
    const { base, root } = await startDashboard();
    await writeFile(join(root, "weather.mock.json"), HANDWRITTEN, "utf8");

    const opened = await openMock(base, "weather.mock.json");
    const edited: MockDraft = {
      ...opened.draft,
      responses: [
        ...opened.draft.responses,
        { ...DRAFT.responses[2], extra: {} } as MockDraft["responses"][number],
      ],
    };
    await saveDraft(base, "weather.mock.json", edited, opened.mtimeMs);

    const saved = JSON.parse(await readFile(join(root, "weather.mock.json"), "utf8")) as {
      $comment?: string;
      tools: { annotations?: unknown }[];
      responses: { isError?: boolean }[];
    };
    expect(saved.$comment).toBe("손으로 적은 메모");
    expect(saved.tools[0]?.annotations).toEqual({ readOnlyHint: true });
    expect("isError" in (saved.responses[0] ?? {})).toBe(false);

    const client = await connectToSavedMock(join(root, "weather.mock.json"));
    expect(textOf(await client.callTool("get_weather", { city: "Seoul" }))).toEqual({
      temperature: 21.5,
    });
    expect(textOf(await client.callTool("get_weather", { city: "Busan" }))).toEqual({
      temperature: 0,
    });
  });

  it("열어서 그대로 두 번 저장하면 두 번째부터 바이트가 같다", async () => {
    const { base, root } = await startDashboard();
    const file = join(root, "weather.mock.json");
    await writeFile(file, HANDWRITTEN, "utf8");

    const first = await openMock(base, "weather.mock.json");
    await saveDraft(base, "weather.mock.json", first.draft, first.mtimeMs);
    const afterFirst = await readFile(file);

    const second = await openMock(base, "weather.mock.json");
    await saveDraft(base, "weather.mock.json", second.draft, second.mtimeMs);
    expect((await readFile(file)).equals(afterFirst)).toBe(true);
  });
});
```

`textOf` 는 목이 `result` 를 `content[{ type: "text", text: JSON.stringify(result) }]` 로 포장한다는 전제다(`packages/mock/src/index.ts` 의 `MockResponse.result` 주석). Step 2 에서 포장 모양이 다르게 나오면 `packages/mock/tests/stdio-e2e.test.ts` 의 `text()` 도우미가 읽는 방식에 맞추고 보고한다. mock 코드는 고치지 않는다.

- [ ] **Step 2: 실행한다 (이 파일만, 직렬)**

Run: `corepack pnpm vitest run --project e2e packages/dashboard/tests/mock-builder-e2e.test.ts`
Expected: PASS, `Test Files  1 passed`, `Tests  4 passed`

- [ ] **Step 3: 회귀 증명 — 이 테스트가 실제로 조립 경로를 타는지**

스크래치패드에 `draft.ts` 를 백업한 뒤, `buildMockDefinition` 안의 `...(args === undefined ? {} : { args: args.value })` 를 `args: args?.value ?? {}` 로 잠깐 바꾼다(ANY 응답에 빈 args 가 실리는 결함).

Run: `corepack pnpm vitest run --project e2e packages/dashboard/tests/mock-builder-e2e.test.ts`
Expected: FAIL — `Busan` 호출이 ANY 응답이 아니라 미스 안내를 받는다.

백업으로 되돌린 뒤 `git diff --stat` 에 `draft.ts` 가 없는지 확인하고 다시 돌려 PASS 를 본다.

- [ ] **Step 4: 커밋**

```bash
git add packages/dashboard/tests/mock-builder-e2e.test.ts
git commit -m "test(dashboard): 목 만들기로 만들고 고친 파일을 목 서버에 넣어 왕복 검증한다"
```

---

### Task 13: ADR · changeset · 패키지 게이트

**Files:**
- Create: `docs/adr/0101-목-만들기는-스위트-PUT-의-저장-계약을-쓰고-녹화-응답의-URL-만-경고한다.md`
- Create: `.changeset/dashboard-mock-builder.md`
- Add: `docs/superpowers/specs/2026-09-28-dashboard-mock-builder-design.md` (지금 untracked) · 이 계획서

- [ ] **Step 1: ADR 을 쓴다**

`docs/adr/0101-목-만들기는-스위트-PUT-의-저장-계약을-쓰고-녹화-응답의-URL-만-경고한다.md`:

```markdown
# ADR-0101: 목 만들기는 스위트 PUT 의 저장 계약을 쓰고, 녹화 응답의 URL 만 경고한다

- 상태: 채택
- 날짜: 2026-09-28
- 관련: 설계 `docs/superpowers/specs/2026-09-28-dashboard-mock-builder-design.md`, ADR-0062, ADR-0091

## 배경

대시보드에 `mock.json` 을 새로 만들고 기존 파일을 고치는 화면을 둔다. 녹화본은 편집 중 옆에 펴
두는 참고 패널이다. 판단이 필요한 곳은 다섯이었다. 덮어쓰기를 어떻게 확인받는가, 폼에 칸이 없는
키를 어떻게 하는가, 다시 저장할 때 서식을 지키는가, body 안의 URL 을 어떤 기준으로 세는가, 만든
파일이 목에서 동작하는지를 무엇으로 검증하는가.

## 선택지

1. 저장 본문 — (a) `MockDefinition` JSON 을 그대로 받고 존재 확인용 요청을 따로 둔다 /
   (b) 스위트 PUT 의 `{ content, baseMtimeMs }` 를 그대로 쓴다.
2. 폼에 칸이 없는 키 — (a) 버린다 / (b) 초안에 들고 있다가 되돌려 쓴다.
3. 서식 — (a) 원본 서식을 지키는 문자열 단위 편집 / (b) 정규화(고정 키 순서 · 2칸 들여쓰기 ·
   기본값 제거).
4. URL 세기 — (a) `new URL()` 이 받는 모든 문자열 / (b) record 와 같이 문자열 전체가 http(s)
   절대 URL 인 값의 서로 다른 개수. 대상은 (가) 모든 응답 / (나) 녹화본에서 가져온 응답.
5. 왕복 검증 — (a) `mcpeak-mock` bin 을 자식 프로세스로 / (b) `createMockServer`(HTTP) 를 테스트
   프로세스 안에서.

## 결정

1-(b), 2-(b), 3-(b), 4-(b)(나), 5-(b).

## 이유

- 1: `writeFileContent` 에 "없는 파일은 충돌이 아니다" 가 이미 있다. 새 목은 `baseMtimeMs: 0`,
  연 파일은 열 때의 mtime 을 보내면 확인이 필요한 경우에만 충돌이 온다. 충돌 문구는 기준이 0 인지로
  "이미 파일이 있습니다" 와 "불러온 뒤에 바뀌었습니다" 를 가른다 — 연 파일에 앞 문장을 쓰면 사용자는
  당연하다고 넘기고 남의 변경을 덮어쓴다. 본문이 문자열이라 저장 바이트를 웹의 직렬화 함수 하나가
  정한다(결정론).
- 2: 조용히 사라지면 사용자는 저장한 뒤에야 안다. 화면에 "그대로 보존합니다" 를 적는다.
- 3: 원본 서식 보존은 JSON 을 문자열로 편집해야 해서 비용이 크다. 정규화는 의미를 바꾸지 않고,
  두 번째 저장부터 바이트가 같다(멱등).
- 4: 녹화 요약(ADR-0062)과 화면이 같은 수를 말해야 사람이 둘을 잇는다. 경고 문장이 "녹화 때
  가려지지 않는 자리" 라고 말하므로, 손으로 친 값이나 파일에서 읽은 값에 띄우면 틀린 문장이 된다.
- 5: bin 을 띄우려면 빌드 산출물(CI verify 잡에는 없다)이나 mock 패키지의 테스트 전용 로더가
  필요하다. 정의를 해석하는 코드는 두 트랜스포트가 같다.

## 결과

- `PUT /api/mocks/<path>` 와 `PUT /api/suites/<path>` 가 `PutRules` 하나로 갈린다.
- 기존 목을 열어 저장하면 git diff 에 서식 변경이 섞일 수 있다. 첫 저장 한 번뿐이다.
- `assertMockDefinition` 은 같은 도구 · 같은 args 응답이 두 줄인 것을 거르지 않는다. 대시보드는
  그런 파일을 저장하고, `mcpeak-mock` 은 뜰 때 거절한다. 매칭 키 규칙을 대시보드에 다시 쓰지
  않고 mock 오너에게 넘긴다.
- stdio 트랜스포트 자체의 회귀는 이 E2E 가 잡지 않는다. 그것은 mock 패키지의 `stdio-e2e` 몫이다.
```

- [ ] **Step 2: changeset 을 쓴다**

`.changeset/dashboard-mock-builder.md`:

```markdown
---
"@mcpeak/dashboard": minor
---

대시보드에 "목 만들기" 화면(사이드바 Mock)을 추가한다. `mock.json` 을 폼으로 새로 만들거나 기존 파일을 열어 고칠 수 있고, 편집 중에 녹화본 패널을 열어 외부 API 응답을 새 응답 줄로 넣거나 기존 줄의 `result` 로 넣을 수 있다. 녹화본은 읽기만 하고, 저장 전 `assertMockDefinition` 으로 검증한다. 폼에 칸이 없는 키는 보존한다. 녹화 때 가려지지 않는 body 안의 URL 은 개수로 경고한다.
```

- [ ] **Step 3: 패키지 전체 게이트 (메인 세션이 직접 돌린다, 파이프 없이)**

```bash
corepack pnpm --filter @mcpeak/dashboard test; echo "test=$?"
corepack pnpm --filter @mcpeak/dashboard typecheck; echo "typecheck=$?"
corepack pnpm biome check .; echo "biome=$?"
corepack pnpm vitest run --project e2e packages/dashboard; echo "e2e=$?"
corepack pnpm --filter @mcpeak/dashboard build; echo "build=$?"
```

Expected: 다섯 값 모두 `0`. 추가로 확인한다.
- `test` 출력에 `Test Files … passed` 줄이 **두 번**(서버 · web) 있다.
- `grep -rn "not implemented" packages/dashboard/src packages/dashboard/web/src` → 0 건.
- `build` 뒤 `grep -l "api/mocks" packages/dashboard/dist/*.mjs` 가 파일 하나 이상을 낸다(turbo 캐시가 낡은 dist 를 복원하지 않았다). `index.mjs` 는 청크를 다시 내보내기만 하므로 거기만 보면 안 된다.

- [ ] **Step 4: 커밋 (경로 지정)**

```bash
git add docs/superpowers/specs/2026-09-28-dashboard-mock-builder-design.md \
  docs/superpowers/plans/2026-09-28-dashboard-mock-builder-implementation.md \
  "docs/adr/0101-목-만들기는-스위트-PUT-의-저장-계약을-쓰고-녹화-응답의-URL-만-경고한다.md"
git commit -m "docs(adr): 목 만들기의 저장 계약 · 키 보존 · URL 경고 · 왕복 검증 판단을 적는다"

git add .changeset/dashboard-mock-builder.md
git commit -m "chore(release): 대시보드 목 만들기 changeset 을 넣는다"
```

커밋 뒤 `git log --name-only origin/main..HEAD` 로 `packages/mock/tests/stdio-e2e.test.ts` 가 **어느 커밋에도 없는지** 확인한다. 설계 · 계획 문서 커밋은 T1 앞에 두어도 된다. 순서는 메인 세션이 정한다.

---

## 자체 점검

**설계 대비 누락:**

| 설계 항목 | 태스크 |
|---|---|
| 첫 화면: 새로 만들기 · 기존 목 수정 | T10 · T11 |
| 기존 목 목록(`assertMockDefinition` 통과 `.json`) · 열기 | T3 · T10 |
| 파일 → 폼(평면/JSON 모드, args 없음 = 인자 무관, `null` 은 null 인자) | T6 |
| 폼에 칸 없는 키 보존 + 안내 | T5 · T6 · T8 · T11 |
| 다시 저장 시 정규화 · 멱등 | T5 · T6 · T12 |
| 폼으로 도구 · 설명 · 입력 필드 · 응답 작성, 여러 도구 · 여러 응답 | T5 · T8 · T11 |
| 평면 폼 / JSON 전환 / 못 돌아가면 비활성 + 이유 | T4 · T8 |
| 편집 중 녹화본 패널(`GET /api/sessions` 재사용) → 외부 호출 → 펼쳐서 본문 | T1 · T9 · T11 |
| response 만 쓸 수 있음, throw · incomplete 는 이유 | T7 · T9 |
| 새 응답으로 추가(도구 없으면 이름만 채워 추가) · 강조 | T5 · T9 · T11 |
| result 로 넣기(비었으면 바로, 값 있으면 확인) | T5 · T9 |
| url 은 녹화된 표시용 값 그대로 | T1 · T7 |
| body URL 세기 · 가져온 응답만 · 줄 · 저장 위 경고 · 저장 안 막음 | T7 · T8 · T11 |
| `PUT /api/mocks` · 서버 검증 · 400 + 문장 그대로 | T2 |
| 덮어쓰기: 새 목 0 · 연 파일 mtime · 저장 뒤 기준 갱신 · 충돌 문구 두 갈래 | T2 · T11 |
| 경로 규칙 · 탈출 검사 | T1 · T2 · T3 |
| 처음으로(고쳤으면 확인) | T11 |
| `dashboard → mock` 의존과 경계 검사 | T2 |
| web 은 mock 을 import 하지 않음 | T5 (`MockDefinitionJson` 재선언) |
| 왕복 · 바이트 결정론 | T12 |

**설계와 다르게 옮긴 것:** 없음. 계획 단계에서 정한 것(강조에 타이머 없음, 왕복 트랜스포트 HTTP)은 "확정한 판단" 과 ADR-0101 에 적었다.
