# 대시보드 목 저장 위치 `mocks/` 고정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대시보드 목 만들기가 `<root>/mocks/` 아래만 목록에 올리고, 그 아래에만 저장하며, 저장할 때 폴더를 만든다.

**Architecture:** 서버(`packages/dashboard/src/server`)는 `listMocks` 탐색 시작점을 `mocks/` 로 좁히고, `PUT /api/mocks/<path>` 에 위치 검사(`mocks/` 밖이면 400)와 검증 통과 뒤 상위 폴더 생성을 더한다. API 경로 모양과 `api-types.ts` 는 그대로 두고, 화면이 입력칸의 이름 앞에 `mocks/` 를 붙여 보낸다. `GET /api/mocks/<path>` 는 바꾸지 않는다.

**Tech Stack:** TypeScript, Node `node:fs/promises`, React 19 + @testing-library/react(jsdom), vitest(projects: `unit` · `e2e` · `web`), biome, changesets.

**근거 문서:** `docs/2026-10-27-대시보드-목-mocks-폴더-인수인계.md` (커밋하지 않는 인수인계)

## Global Constraints

- 작업 패키지는 `packages/dashboard` **하나**. 다른 패키지(`mock`, `cli` 등)는 건드리지 않는다.
- `core/src/types.ts` 의 `McpClient` / `ToolResult` 는 손대지 않는다. `api-types.ts` 도 바꾸지 않는다.
- 새 의존성 추가 없음.
- 목 폴더 이름: `mocks` (서버 `MOCKS_DIR` · web `MOCKS_DIR` 두 곳, 같은 값).
- 폴더는 **저장할 때만**, **검증을 통과한 뒤에만** 만든다. 대시보드 기동 · 목록 조회로는 만들지 않는다.
- `mocks/` 밖 저장 거절 문장 전문(줄바꿈 `\n` 하나로 잇는다):
  ```
  → 목 정의는 mocks/ 폴더 안에만 저장할 수 있습니다 — 받은 이름이 폴더 밖을 가리킵니다: <이름>
  → '..' 없이 파일 이름만 적으세요. 예: weather.mock.json
  ```
  `<이름>` 은 받은 상대경로에서 앞의 `mocks/` 하나를 뗀 것(없으면 그대로). 화면에서 `../x.json` 을 치면 `../x.json` 이 보인다.
- 문장 비교는 `toEqual` 로 전문 일치(`toThrow("부분")` 금지 — CLAUDE.local.md §2).
- 결정론: 목록은 경로순 정렬 유지. 시각 · 랜덤 의존 금지.
- 커밋: Conventional Commits, scope `dashboard`. 말미에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git add -A` 금지, 경로를 하나씩. push · merge · rebase 는 사람이 한다.
- 미커밋 사용자 파일(`.github/CONTRIBUTING*.md`, `packages/mock/tests/stdio-e2e.test.ts`, `docs/2026-09-28-…`, `docs/2026-10-27-…` 인수인계)은 커밋에 섞지 않는다.
- 셸 cwd 가 호출 사이에 유지된다. 명령은 저장소 루트(`/Users/cheonjamin/projects/mcptest`)에서 친다.

## 모델 배분 (CLAUDE.local.md §1)

설계 · 문장 · 시그니처가 인수인계 문서에 전량 적혀 있으므로 Task 1~5 는 **표준 / 보통**. 최종 계약 · 회귀 검토(Task 6)만 상위.

## 웨이브

- 웨이브 A(병렬 불가 — 같은 패키지라 순서대로): Task 1 → Task 2 → Task 3
- 웨이브 B(직렬 전용, 실제 프로세스 E2E): Task 4
- 웨이브 C: Task 5(문서) → Task 6(게이트)

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `packages/dashboard/src/server/files.ts` | `MOCKS_DIR`, `isUnderMocksDir`, `listMocks` 시작점, `writeFileContent` 의 `createParentDir` 옵션 | Modify |
| `packages/dashboard/src/server/routes.ts` | `PutRules` 에 위치 검사 · 폴더 생성 플래그, 거절 문장 | Modify |
| `packages/dashboard/tests/files.test.ts` | `isUnderMocksDir` · `writeFileContent` 옵션 단위 테스트 | Modify |
| `packages/dashboard/tests/routes.test.ts` | `GET/PUT /api/mocks` 기대값 갱신 + 신규 1~6 | Modify |
| `packages/dashboard/web/src/mock-builder/draft.ts` | web `MOCKS_DIR`, `mockPathFromName`, `mockNameFromPath` | Modify |
| `packages/dashboard/web/tests/mock-draft.test.ts` | 위 두 함수 단위 테스트 | Modify |
| `packages/dashboard/web/src/screens/MockBuilder.tsx` | 입력칸 = 이름만, `mocks/` 접두 표시 | Modify |
| `packages/dashboard/web/tests/mock-builder.test.tsx` | 신규 7~9 + 기존 경로 기대값 갱신 | Modify |
| `packages/dashboard/tests/mock-builder-e2e.test.ts` | 저장 · 열기 경로를 `mocks/` 로 | Modify |
| `docs/adr/0121-대시보드-목은-mocks-폴더에만-두고-이름-규칙으로-고르지-않는다.md` | ADR 초안 | Create |
| `docs/adr/README.md` | 색인 한 줄 | Modify |
| `.changeset/dashboard-mocks-dir.md` | dashboard changeset | Create |

---

### Task 0: 출발점 맞추기 (사람 확인 필요)

**Files:** 없음

- [ ] **Step 1: 격차 확인**

Run: `git fetch -q && git status -sb | head -1`
Expected: `## main...origin/main [behind N]` — 2026-10-27 기준 14. dashboard 쪽 차이는 `build-analyze-requests*`, `CHANGELOG.md`, `package.json` 버전뿐이라 이 작업과 겹치지 않는다.

- [ ] **Step 2: 사람에게 fast-forward 를 요청한다**

에이전트는 merge/rebase 를 하지 않는다. 사용자에게 `! git pull --ff-only` 를 부탁하고, 끝나면 `git status -sb | head -1` 이 `## main...origin/main` 인지 본다.

- [ ] **Step 3: 브랜치와 설치**

```bash
git switch -c feat/dashboard-mocks-dir
corepack pnpm install
```
Expected: 브랜치 전환, install 성공. 미커밋 사용자 파일은 그대로 따라온다(건드리지 않는다).

- [ ] **Step 4: 기준선 녹색 확인**

Run: `corepack pnpm vitest run --project unit packages/dashboard/tests/routes.test.ts packages/dashboard/tests/files.test.ts`
Expected: 출력에 `Test Files  2 passed` 줄.

---

### Task 1: 목록을 `mocks/` 아래로 좁힌다

**Files:**
- Modify: `packages/dashboard/src/server/files.ts` (`listMocks`, 새 `MOCKS_DIR` · `isUnderMocksDir`)
- Test: `packages/dashboard/tests/routes.test.ts` (`describe("GET /api/mocks")`), `packages/dashboard/tests/files.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  ```ts
  export const MOCKS_DIR = "mocks";
  /** `absolute` 가 `<root>/mocks/` **안**(폴더 자신 제외)인가. 둘 다 정규화된 절대경로로 비교한다. */
  export function isUnderMocksDir(root: string, absolute: string): boolean;
  /** `<root>/mocks/` 아래(하위 폴더 포함)의 유효 목. `path` 는 root 기준 "mocks/...". 폴더가 없으면 []. */
  export async function listMocks(root: string): Promise<MockFileEntry[]>;
  ```

- [ ] **Step 1: 실패하는 테스트 — 목록 (routes.test.ts)**

`describe("GET /api/mocks", …)` 블록 전체(현재 783~803행)를 아래로 바꾼다.

```ts
describe("GET /api/mocks", () => {
  it("mocks/ 아래(하위 폴더 포함)의 유효한 목 정의만 경로순으로 싣는다. 루트 · 다른 폴더의 목은 뺀다", async () => {
    server = await startTestServer();
    await mkdir(join(server.root, "mocks", "sub"), { recursive: true });
    await mkdir(join(server.root, "examples"));
    await writeFile(join(server.root, "mocks", "a.mock.json"), JSON.stringify(VALID_MOCK));
    await writeFile(
      join(server.root, "mocks", "sub", "b.mock.json"),
      JSON.stringify({ tools: VALID_MOCK.tools }),
    );
    await writeFile(join(server.root, "mocks", "bad.mock.json"), JSON.stringify(INVALID_MOCK));
    await writeFile(join(server.root, "mocks", "broken.json"), "{");
    // mocks/ 밖의 유효한 목은 목록에 오르지 않는다.
    await writeFile(join(server.root, "root.mock.json"), JSON.stringify(VALID_MOCK));
    await writeFile(join(server.root, "examples", "weather.mock.json"), JSON.stringify(VALID_MOCK));

    const response = await fetch(`${server.baseUrl}/api/mocks`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { path: "mocks/a.mock.json", toolCount: 1, responseCount: 1 },
      { path: "mocks/sub/b.mock.json", toolCount: 1, responseCount: 0 },
    ]);
  });

  it("mocks/ 가 없으면 200 과 빈 배열이고, 폴더를 만들지 않는다", async () => {
    server = await startTestServer();
    await writeFile(join(server.root, "root.mock.json"), JSON.stringify(VALID_MOCK));

    const response = await fetch(`${server.baseUrl}/api/mocks`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    await expect(stat(join(server.root, "mocks"))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 실패하는 테스트 — `isUnderMocksDir` (files.test.ts)**

import 목록에 `isUnderMocksDir` 를 더하고(알파벳순: `ensureRepairBundleDir,` 다음), 파일 끝에 붙인다.

```ts
describe("isUnderMocksDir", () => {
  it("mocks/ 안의 파일과 하위 폴더 파일만 참이다", () => {
    expect(isUnderMocksDir(root, join(root, "mocks", "a.mock.json"))).toBe(true);
    expect(isUnderMocksDir(root, join(root, "mocks", "sub", "b.mock.json"))).toBe(true);
  });

  it("mocks 폴더 자신 · 이름이 mocks 로 시작하는 옆 폴더 · 루트 · 루트 밖은 거짓이다", () => {
    expect(isUnderMocksDir(root, join(root, "mocks"))).toBe(false);
    expect(isUnderMocksDir(root, join(root, "mocks-old", "a.mock.json"))).toBe(false);
    expect(isUnderMocksDir(root, join(root, "a.mock.json"))).toBe(false);
    expect(isUnderMocksDir(root, join(root, "..", "a.mock.json"))).toBe(false);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `corepack pnpm vitest run --project unit packages/dashboard/tests/routes.test.ts packages/dashboard/tests/files.test.ts -t "GET /api/mocks|isUnderMocksDir"`
Expected: FAIL — files.test 는 `isUnderMocksDir is not a function`(또는 import 오류), routes.test 두 케이스 모두 실패 — 첫 케이스는 `root.mock.json` · `examples/weather.mock.json` 이 목록에 섞이고, 두 번째는 `[]` 대신 `root.mock.json` 이 나온다.

- [ ] **Step 4: 구현 (files.ts)**

`listMocks` 위에 상수 · 함수를 더하고 `listMocks` 를 바꾼다.

```ts
/** 대시보드가 목 정의를 읽고 쓰는 폴더. 루트 기준. 프론트의 MOCKS_DIR 와 같은 값(ADR-0121). */
export const MOCKS_DIR = "mocks";

/**
 * `absolute` 가 `<root>/mocks/` **안**인가. 폴더 자신은 파일 자리가 아니라 거짓이다.
 * `mocks-old/` 같은 옆 폴더를 접두 일치로 삼키지 않도록 구분자까지 붙여 비교한다.
 */
export function isUnderMocksDir(root: string, absolute: string): boolean {
  return resolve(absolute).startsWith(resolve(root, MOCKS_DIR) + sep);
}

/**
 * `<root>/mocks/` 아래 `**\/*.json` 중 `assertMockDefinition` 을 통과하는 파일. 무효 JSON ·
 * 무효 정의는 조용히 뺀다(`listSuites` 와 같은 정책). 판정 규칙은 mock 안에 있다 — 여기서 다시
 * 쓰지 않는다. 폴더가 없으면 빈 목록이고, 폴더를 만들지 않는다(만드는 것은 저장뿐이다).
 *
 * 루트 전체를 보지 않는 이유: worktree 복사본 · 벤치 결과 · 다른 패키지의 fixture 가 목으로
 * 잡혔다(ADR-0121). `path` 는 여전히 root 기준이라 `GET /api/mocks/<path>` 로 그대로 연다.
 */
export async function listMocks(root: string): Promise<MockFileEntry[]> {
  const files = await walkJsonFiles(join(root, MOCKS_DIR));
```

함수 나머지 본문(`const results … return results.sort(…)`)은 그대로 둔다. `walkFiles` 는 없는 디렉터리에서 `readdir` 실패를 `[]` 로 받으므로 따로 처리하지 않는다.

- [ ] **Step 5: 통과 확인**

Run: `corepack pnpm vitest run --project unit packages/dashboard/tests/routes.test.ts packages/dashboard/tests/files.test.ts`
Expected: `Test Files  2 passed`. 실패가 있으면 `GET /api/mocks/<path>` 블록은 손대지 않았는지 확인.

- [ ] **Step 6: 회귀 증명 (수정 빼고 실패 보기)**

```bash
SP=/private/tmp/claude-501/-Users-cheonjamin-projects-mcptest/a6ceb575-7924-4d19-b5fe-e85fdcfcbc0a/scratchpad
cp packages/dashboard/src/server/files.ts "$SP/files.ts.fixed"
sed -i '' 's|walkJsonFiles(join(root, MOCKS_DIR))|walkJsonFiles(root)|' packages/dashboard/src/server/files.ts
corepack pnpm vitest run --project unit packages/dashboard/tests/routes.test.ts -t "GET /api/mocks" >/dev/null 2>&1; echo "exit=$?"
cp "$SP/files.ts.fixed" packages/dashboard/src/server/files.ts
git diff --stat
```
Expected: `exit=1`(목록 두 케이스 실패), 복구 후 `git diff --stat` 에 files.ts · 두 테스트 파일만.

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/server/files.ts packages/dashboard/tests/routes.test.ts packages/dashboard/tests/files.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): 목 목록을 mocks/ 폴더 아래로 좁힌다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 저장을 `mocks/` 안으로 제한하고 폴더를 만든다

**Files:**
- Modify: `packages/dashboard/src/server/files.ts` (`writeFileContent`)
- Modify: `packages/dashboard/src/server/routes.ts` (`PutRules`, `MOCK_PUT_RULES`, `handlePutFile`, 새 `outsideMocksDirMessage`)
- Test: `packages/dashboard/tests/routes.test.ts` (`describe("PUT /api/mocks/<path>")`), `packages/dashboard/tests/files.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `MOCKS_DIR`, `isUnderMocksDir(root, absolute)`
- Produces:
  ```ts
  // files.ts — 기존 3인자 호출은 그대로 동작한다
  export async function writeFileContent(
    absolute: string,
    content: string,
    baseMtimeMs: number,
    options?: { readonly createParentDir?: boolean },
  ): Promise<PutFileResponse>;
  ```
  ```ts
  // routes.ts (비공개)
  interface PutRules {
    readonly extensionError: string;
    /** 저장 위치 제한. `null` 이면 통과, 아니면 사용자에게 보일 문장. 없으면 루트 안 어디든. */
    readonly checkLocation?: (root: string, relative: string) => string | null;
    /** 검증을 통과한 뒤 상위 폴더를 만드는가. */
    readonly createParentDir?: boolean;
    validate(content: string, relative: string): string | null;
  }
  ```
  `handlePutFile` 순서: 경로 해석 실패 → **`checkLocation`** → `resolveProjectPath` → 확장자 → 본문 → `validate` → `writeFileContent(…, { createParentDir })`.
  위치 검사를 `resolveProjectPath` 보다 먼저 두는 이유: 화면에서 `../../x.json` 을 치면 `mocks/../../x.json` 이 와서 루트 밖이 되는데, 그때도 "파일 이름만 적으세요" 문장이 나와야 사용자가 고칠 수 있다. `mocks/` 는 루트 안이므로 위치 검사를 통과한 경로는 루트 탈출이 아니다(`\0` 은 뒤의 `resolveProjectPath` 가 계속 거른다).

- [ ] **Step 1: 실패하는 테스트 — routes.test.ts**

`invalidMockMessage` 정의 바로 아래에 더한다.

```ts
/** `mocks/` 밖을 가리키는 이름으로 저장할 때의 문장 전문. `name` 은 앞의 `mocks/` 를 뗀 것. */
const outsideMocksMessage = (name: string): string =>
  [
    `→ 목 정의는 mocks/ 폴더 안에만 저장할 수 있습니다 — 받은 이름이 폴더 밖을 가리킵니다: ${name}`,
    "→ '..' 없이 파일 이름만 적으세요. 예: weather.mock.json",
  ].join("\n");
```

`describe("PUT /api/mocks/<path>", …)` 블록 전체를 아래로 바꾼다(기존 케이스는 경로만 `mocks/` 로 옮기고, 신규 3~6 을 더한다).

```ts
describe("PUT /api/mocks/<path>", () => {
  it("올바른 목 정의를 content 바이트 그대로 저장한다", async () => {
    server = await startTestServer();
    await mkdir(join(server.root, "mocks"));
    const content = `${JSON.stringify(VALID_MOCK, null, 2)}\n`;

    const response = await putMock(server, "mocks/weather.mock.json", content);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ saved: true });
    await expect(readFile(join(server.root, "mocks", "weather.mock.json"), "utf8")).resolves.toBe(
      content,
    );
  });

  it("mocks/ 가 없으면 저장할 때 하위 폴더까지 만든다", async () => {
    server = await startTestServer();
    const content = `${JSON.stringify(VALID_MOCK, null, 2)}\n`;

    const response = await putMock(server, "mocks/sub/new.mock.json", content);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ saved: true });
    await expect(
      readFile(join(server.root, "mocks", "sub", "new.mock.json"), "utf8"),
    ).resolves.toBe(content);
  });

  it("잘못된 정의면 400 과 assertMockDefinition 문장 전문을 주고 파일을 만들지 않는다", async () => {
    server = await startTestServer();
    await mkdir(join(server.root, "mocks"));

    const response = await putMock(server, "mocks/bad.mock.json", JSON.stringify(INVALID_MOCK));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: invalidMockMessage("mocks/bad.mock.json") });
    await expect(stat(join(server.root, "mocks", "bad.mock.json"))).rejects.toThrow();
  });

  it("mocks/ 가 없을 때 잘못된 정의를 보내면 폴더도 만들지 않는다", async () => {
    server = await startTestServer();

    const response = await putMock(server, "mocks/bad.mock.json", JSON.stringify(INVALID_MOCK));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: invalidMockMessage("mocks/bad.mock.json") });
    await expect(stat(join(server.root, "mocks"))).rejects.toThrow();
  });

  it("content 가 JSON 이 아니면 400 이다", async () => {
    server = await startTestServer();
    const response = await putMock(server, "mocks/weather.mock.json", "{ tools: ");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "본문 content가 올바른 JSON이 아닙니다." });
    await expect(stat(join(server.root, "mocks"))).rejects.toThrow();
  });

  it("이미 있는 파일은 baseMtimeMs 가 현재 mtime 과 같을 때만 덮어쓴다", async () => {
    server = await startTestServer();
    await mkdir(join(server.root, "mocks"));
    const target = join(server.root, "mocks", "weather.mock.json");
    const original = '{"tools":[]}\n';
    await writeFile(target, original, "utf8");
    const before = await stat(target);
    const content = `${JSON.stringify(VALID_MOCK, null, 2)}\n`;

    // 새 목은 0 을 보낸다. 있는 파일이면 충돌로 돌아와야 확인을 받을 수 있다.
    const first = await putMock(server, "mocks/weather.mock.json", content, 0);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      saved: false,
      reason: "conflict",
      mtimeMs: before.mtimeMs,
    });
    await expect(readFile(target, "utf8")).resolves.toBe(original);

    const second = await putMock(server, "mocks/weather.mock.json", content, before.mtimeMs);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ saved: true });
    await expect(readFile(target, "utf8")).resolves.toBe(content);
  });

  it(".json 이 아니면 거절하고 파일 · 폴더를 만들지 않는다", async () => {
    server = await startTestServer();
    const response = await putMock(server, "mocks/weather.mock.txt", JSON.stringify(VALID_MOCK));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "목 정의는 .json 확장자 파일만 저장할 수 있습니다.",
    });
    await expect(stat(join(server.root, "mocks"))).rejects.toThrow();
  });

  it("mocks/ 밖 경로는 400 과 문장 전문을 주고 파일 · 폴더를 만들지 않는다", async () => {
    server = await startTestServer();
    const response = await putMock(server, "other/x.mock.json", JSON.stringify(VALID_MOCK));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: outsideMocksMessage("other/x.mock.json") });
    await expect(stat(join(server.root, "other"))).rejects.toThrow();
    await expect(stat(join(server.root, "mocks"))).rejects.toThrow();
  });

  it("mocks/../x.json 은 mocks/ 를 뗀 이름으로 거절한다 — 화면에서 ../x.json 을 친 경우다", async () => {
    server = await startTestServer();
    const response = await putMock(server, "mocks/../x.json", JSON.stringify(VALID_MOCK));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: outsideMocksMessage("../x.json") });
    await expect(stat(join(server.root, "x.json"))).rejects.toThrow();
    await expect(stat(join(server.root, "mocks"))).rejects.toThrow();
  });

  it("루트 밖으로 나가는 이름도 같은 문장으로 거절한다", async () => {
    server = await startTestServer();
    const response = await putMock(server, "../outside.mock.json", JSON.stringify(VALID_MOCK));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: outsideMocksMessage("../outside.mock.json") });
    await expect(stat(join(server.root, "..", "outside.mock.json"))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 실패하는 테스트 — files.test.ts**

`describe("files.ts", …)` 블록 안, `"mtime이 다르면 conflict를 주고 …"` 케이스 뒤에 더한다.

```ts
  it("createParentDir 이면 상위 폴더를 만들어 저장하고, 없으면 만들지 않고 던진다", async () => {
    const nested = join(root, "mocks", "sub", "a.json");
    await expect(writeFileContent(nested, "{}", 0)).rejects.toThrow();
    await expect(stat(join(root, "mocks"))).rejects.toThrow();

    const result = await writeFileContent(nested, "{}", 0, { createParentDir: true });
    expect(result.saved).toBe(true);
    await expect(readFile(nested, "utf8")).resolves.toBe("{}");
  });
```

- [ ] **Step 3: 실패 확인**

Run: `corepack pnpm vitest run --project unit packages/dashboard/tests/routes.test.ts packages/dashboard/tests/files.test.ts -t "PUT /api/mocks|createParentDir"`
Expected: FAIL — "하위 폴더까지 만든다"(ENOENT 문장 400), "mocks/ 밖 경로"(200 저장됨), "mocks/../x.json"(200), "루트 밖"(`허용되지 않는 경로입니다.`), createParentDir(ENOENT).

- [ ] **Step 4: 구현 — files.ts `writeFileContent`**

```ts
/**
 * mtime이 기대값과 다르면 파일을 건드리지 않고 `conflict`를 준다. 파일이 아직 없으면
 * (신규 저장) 충돌이 아니라고 본다.
 *
 * `createParentDir` 이면 쓰기 직전에 상위 폴더를 만든다. 호출부가 내용 검증을 마친 뒤에만
 * 부르므로, 거절된 저장이 빈 폴더를 남기지 않는다.
 */
export async function writeFileContent(
  absolute: string,
  content: string,
  baseMtimeMs: number,
  options: { readonly createParentDir?: boolean } = {},
): Promise<PutFileResponse> {
  const currentMtimeMs = await stat(absolute)
    .then((stats) => stats.mtimeMs)
    .catch(() => baseMtimeMs);
  if (currentMtimeMs !== baseMtimeMs) {
    return { saved: false, reason: "conflict", mtimeMs: currentMtimeMs };
  }
  if (options.createParentDir === true) await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content, "utf8");
  const stats = await stat(absolute);
  return { saved: true, mtimeMs: stats.mtimeMs };
}
```

(`mkdir` · `dirname` 은 files.ts 에 이미 import 돼 있다.)

- [ ] **Step 5: 구현 — routes.ts**

`./files.js` import 목록에 `isUnderMocksDir,` 와 `MOCKS_DIR,` 를 더한다(biome 이 정렬하므로 `listMocks,` 근처에 넣고 Step 7 의 `biome check --write` 로 맞춘다). `path` 의 `resolve` 가 필요하므로 파일 맨 위에 `import { resolve } from "node:path";` 를 더한다(`node:http` import 다음 줄).

`PutRules` 를 바꾼다.

```ts
interface PutRules {
  readonly extensionError: string;
  /**
   * 저장 위치 제한. `null` 이면 통과, 아니면 사용자에게 그대로 보일 문장. 없으면 루트 안 어디든.
   * 루트 탈출 검사보다 **먼저** 본다 — 화면에서 `../../x.json` 을 친 사람도 "파일 이름만
   * 적으세요" 를 봐야 고칠 수 있다.
   */
  readonly checkLocation?: (root: string, relative: string) => string | null;
  /** 검증을 통과한 뒤 상위 폴더를 만드는가. 거절된 저장은 폴더를 남기지 않는다. */
  readonly createParentDir?: boolean;
  /** 저장해도 되면 `null`, 아니면 사용자에게 그대로 보일 문장. */
  validate(content: string, relative: string): string | null;
}
```

`MOCK_PUT_RULES` 를 바꾸고, 그 위에 문장 함수를 둔다.

```ts
/**
 * `mocks/` 밖 저장 거절 문장. 화면은 입력칸 이름 앞에 `mocks/` 를 붙여 보내므로, 그 접두를
 * 떼고 보여 줘야 사용자가 자기가 친 글자를 알아본다. 접두가 없는 이름(API 를 직접 부른 경우)은
 * 그대로 보인다.
 */
function outsideMocksDirMessage(relative: string): string {
  const prefix = `${MOCKS_DIR}/`;
  const name = relative.startsWith(prefix) ? relative.slice(prefix.length) : relative;
  return [
    `→ 목 정의는 ${MOCKS_DIR}/ 폴더 안에만 저장할 수 있습니다 — 받은 이름이 폴더 밖을 가리킵니다: ${name}`,
    "→ '..' 없이 파일 이름만 적으세요. 예: weather.mock.json",
  ].join("\n");
}

const MOCK_PUT_RULES: PutRules = {
  extensionError: "목 정의는 .json 확장자 파일만 저장할 수 있습니다.",
  checkLocation: (root, relative) =>
    isUnderMocksDir(root, resolve(root, relative)) ? null : outsideMocksDirMessage(relative),
  createParentDir: true,
  validate: validateMockContent,
};
```

`handlePutFile` 의 앞부분과 쓰기 호출을 바꾼다.

```ts
  if (relativeOrNull === null) {
    sendJson(response, 400, { error: "경로를 해석할 수 없습니다." });
    return;
  }
  const locationError = rules.checkLocation?.(root, relativeOrNull) ?? null;
  if (locationError !== null) {
    sendJson(response, 400, { error: locationError });
    return;
  }
  const absolute = resolveProjectPath(root, relativeOrNull);
```

```ts
    const result = await writeFileContent(absolute, body.content, body.baseMtimeMs, {
      createParentDir: rules.createParentDir === true,
    });
```

- [ ] **Step 6: 통과 확인**

Run: `corepack pnpm vitest run --project unit packages/dashboard/tests/routes.test.ts packages/dashboard/tests/files.test.ts`
Expected: `Test Files  2 passed`. `PUT /api/suites` · `PUT /api/overlays` 케이스가 그대로 녹색인지(규칙에 `checkLocation` 이 없어 동작 불변) 같이 본다.

- [ ] **Step 7: 포맷 · 타입**

```bash
corepack pnpm biome check --write packages/dashboard/src/server packages/dashboard/tests
corepack pnpm --filter @mcpeak/dashboard typecheck >/dev/null 2>&1; echo "exit=$?"
```
Expected: biome 수정 후 오류 0, `exit=0`.

- [ ] **Step 8: 회귀 증명**

```bash
SP=/private/tmp/claude-501/-Users-cheonjamin-projects-mcptest/a6ceb575-7924-4d19-b5fe-e85fdcfcbc0a/scratchpad
cp packages/dashboard/src/server/routes.ts "$SP/routes.ts.fixed"
sed -i '' 's|^  createParentDir: true,$||; s|^  checkLocation: (root, relative) =>$|  checkLocationOff: (root: string, relative: string) =>|' packages/dashboard/src/server/routes.ts
corepack pnpm vitest run --project unit packages/dashboard/tests/routes.test.ts -t "PUT /api/mocks" 2>&1 | grep -E "✗|×|FAIL" | head
cp "$SP/routes.ts.fixed" packages/dashboard/src/server/routes.ts
git diff --stat
```
Expected: "하위 폴더까지 만든다", "mocks/ 밖 경로", "mocks/../x.json", "루트 밖" 이 실패로 찍힌다(sed 가 타입 오류를 내도 vitest 는 esbuild 로 돌므로 실행된다). 복구 후 diff 에 routes.ts · files.ts · 두 테스트 파일만.

- [ ] **Step 9: Commit**

```bash
git add packages/dashboard/src/server/files.ts packages/dashboard/src/server/routes.ts packages/dashboard/tests/routes.test.ts packages/dashboard/tests/files.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): 목 저장을 mocks/ 안으로 제한하고 저장할 때 폴더를 만든다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 화면 — 입력칸은 이름만, `mocks/` 고정 접두

**Files:**
- Modify: `packages/dashboard/web/src/mock-builder/draft.ts` (`mockFilePath` 근처, 244행)
- Modify: `packages/dashboard/web/src/screens/MockBuilder.tsx`
- Test: `packages/dashboard/web/tests/mock-draft.test.ts`, `packages/dashboard/web/tests/mock-builder.test.tsx`

**Interfaces:**
- Consumes: 서버 계약 — `PUT /api/mocks/<mocks/…>` 만 받는다, 거절 문장은 Global Constraints 의 전문.
- Produces (web):
  ```ts
  /** 서버 MOCKS_DIR 와 같은 값. web 은 src 를 import 하지 않아 두 곳에 있다. */
  export const MOCKS_DIR = "mocks";
  /** 입력칸 이름 → 루트 기준 경로. "weather.mock.json" → "mocks/weather.mock.json" */
  export function mockPathFromName(name: string): string;
  /** 루트 기준 경로 → 입력칸 이름. 앞의 "mocks/" 하나를 뗀다. 없으면 그대로. */
  export function mockNameFromPath(path: string): string;
  ```
  화면 상태: `targetPath` → **`targetName`**(입력칸 값, 이름만). `EditSource.path` · `SaveState.path` 는 **루트 기준 경로**(`mocks/…`) 그대로.

- [ ] **Step 1: 실패하는 테스트 — mock-draft.test.ts**

import 목록에 `MOCKS_DIR, mockNameFromPath, mockPathFromName` 을 더하고 파일 끝에 붙인다.

```ts
describe("목 이름 ↔ 경로", () => {
  it("이름 앞에 mocks/ 를 붙인다", () => {
    expect(MOCKS_DIR).toBe("mocks");
    expect(mockPathFromName("weather.mock.json")).toBe("mocks/weather.mock.json");
    expect(mockPathFromName("sub/a.json")).toBe("mocks/sub/a.json");
  });

  it("경로 앞의 mocks/ 하나만 떼고, 없으면 그대로 둔다", () => {
    expect(mockNameFromPath("mocks/weather.mock.json")).toBe("weather.mock.json");
    expect(mockNameFromPath("mocks/sub/a.json")).toBe("sub/a.json");
    expect(mockNameFromPath("mocks/mocks/a.json")).toBe("mocks/a.json");
    expect(mockNameFromPath("examples/a.json")).toBe("examples/a.json");
  });
});
```

- [ ] **Step 2: 실패하는 테스트 · 기존 기대값 갱신 — mock-builder.test.tsx**

1. `LOADED.path` 를 `"mocks/weather.mock.json"` 으로 바꾼다(목록은 이제 `mocks/` 아래만 준다).
2. `describe("MockBuilder — 새로 만들기")` 첫 케이스: 입력값 `"mocks/weather.mock.json"` → `"weather.mock.json"`. 나머지 기대값(저장했습니다 · 편집 중 · URL)은 그대로.
3. 같은 describe 의 충돌 케이스: 문장을 `"이미 파일이 있습니다 — mocks/mock.json. 덮어쓸까요?"`, `"저장했습니다 — mocks/mock.json"` 로.
4. 서버 거절 케이스의 예시 문장 첫 줄 `— mock.json:` 을 `— mocks/mock.json:` 로(서버가 실제로 내는 모양에 맞춤).
5. 같은 describe 끝에 신규 7 · 9 를 더한다.

```ts
  it("저장 위치는 mocks/ 접두를 보이고 입력칸 기본값은 mock.json 이며, mocks/mock.json 으로 보낸다", async () => {
    mockApi([saved(1)]);
    await startNew();
    fillWeather();
    const input = screen.getByLabelText("저장 위치") as HTMLInputElement;
    expect(input.value).toBe("mock.json");
    expect(screen.getByText("mocks/")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("저장했습니다 — mocks/mock.json")).toBeTruthy();
    expect(puts.map((put) => put.url)).toEqual(["/api/mocks/mocks%2Fmock.json"]);
  });

  it("폴더 밖을 가리키는 이름이면 서버 문장을 줄 그대로 보여준다", async () => {
    const message = [
      "→ 목 정의는 mocks/ 폴더 안에만 저장할 수 있습니다 — 받은 이름이 폴더 밖을 가리킵니다: ../x.json",
      "→ '..' 없이 파일 이름만 적으세요. 예: weather.mock.json",
    ].join("\n");
    mockApi([new Response(JSON.stringify({ error: message }), { status: 400 })]);
    await startNew();
    fillWeather();
    fireEvent.change(screen.getByLabelText("저장 위치"), { target: { value: "../x.json" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(puts.map((put) => put.url)).toEqual(["/api/mocks/mocks%2F..%2Fx.json"]);
  });

  it("이름이 비면 PUT 하지 않고 무엇을 적을지 말한다", async () => {
    mockApi([]);
    await startNew();
    fillWeather();
    fireEvent.change(screen.getByLabelText("저장 위치"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    const alert = await screen.findByRole("alert");
    expect(Array.from(alert.querySelectorAll("li")).map((li) => li.textContent)).toEqual([
      "파일 이름을 적으세요. mocks/ 폴더 안에 저장합니다.",
    ]);
    expect(puts).toEqual([]);
  });
```

6. `describe("MockBuilder — 기존 목 수정")` 첫 케이스: 입력칸 기대값을 `"weather.mock.json"` 으로(신규 8), PUT URL 을 `"/api/mocks/mocks%2Fweather.mock.json"` 으로.

```ts
    expect((screen.getByLabelText("저장 위치") as HTMLInputElement).value).toBe(
      "weather.mock.json",
    );

    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      url: "/api/mocks/mocks%2Fweather.mock.json",
      body: { content: LOADED_BYTES, baseMtimeMs: 7 },
    });
```

7. 같은 describe 의 "저장 위치를 다른 경로로 바꾸면" 케이스 끝에 URL 단언을 더한다.

```ts
    expect(puts[0]?.url).toBe("/api/mocks/mocks%2Fcopy.mock.json");
```

8. `grep -n "examples/\|— mock.json" packages/dashboard/web/tests/mock-builder.test.tsx` 로 남은 옛 경로가 없는지 본다. 출력 0줄이어야 한다.

- [ ] **Step 3: 실패 확인**

Run: `corepack pnpm vitest run --project web packages/dashboard/web/tests/mock-draft.test.ts packages/dashboard/web/tests/mock-builder.test.tsx`
Expected: FAIL — import 오류(`mockPathFromName` 없음), 화면은 URL 이 `/api/mocks/mock.json`, 입력칸이 `mocks/weather.mock.json`, `mocks/` 텍스트 없음 등.

- [ ] **Step 4: 구현 — draft.ts**

`mockFilePath` 바로 위에 더한다.

```ts
/** 목 정의 폴더. 서버의 MOCKS_DIR 와 같은 값 — web 이 src 를 import 하지 않아 두 곳에 있다(ADR-0121). */
export const MOCKS_DIR = "mocks";

/** 입력칸의 이름 → 루트 기준 경로. 화면은 이름만 받고 폴더는 여기서 붙인다. */
export function mockPathFromName(name: string): string {
  return `${MOCKS_DIR}/${name}`;
}

/** 루트 기준 경로 → 입력칸의 이름. 앞의 `mocks/` 하나만 뗀다. 없으면 그대로 둔다. */
export function mockNameFromPath(path: string): string {
  const prefix = `${MOCKS_DIR}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}
```

- [ ] **Step 5: 구현 — MockBuilder.tsx**

draft import 에 `MOCKS_DIR, mockNameFromPath, mockPathFromName` 을 더한다.

`DEFAULT_TARGET` 을 바꾼다.

```ts
/** 입력칸 기본값. 실제 경로는 `mocks/mock.json` 이다. */
const DEFAULT_NAME = "mock.json";
```

상태 · `begin` 을 이름 기준으로 바꾼다.

```ts
  /** 입력칸 값 — `mocks/` 안의 이름만. 경로는 `mockPathFromName` 으로 만든다. */
  const [targetName, setTargetName] = useState(DEFAULT_NAME);
```

```ts
  function begin(next: EditSource, nextDraft: MockDraft, name: string): void {
    setSource(next);
    setDraft(nextDraft);
    setTargetName(name);
```

시작 화면 호출부:

```tsx
        <MockStart
          onNew={() => begin({ kind: "new" }, EMPTY_MOCK_DRAFT, DEFAULT_NAME)}
          onOpen={(mock) =>
            begin(
              { kind: "file", path: mock.path, mtimeMs: mock.mtimeMs },
              mock.draft,
              mockNameFromPath(mock.path),
            )
          }
        />
```

`submit` 의 경로 부분:

```ts
    const name = targetName.trim();
    if (name === "") {
      setSave({
        kind: "invalid",
        errors: [`파일 이름을 적으세요. ${MOCKS_DIR}/ 폴더 안에 저장합니다.`],
      });
      return;
    }
    const path = mockPathFromName(name);
    setSave({ kind: "saving" });
```

(그 뒤 `mockFilePath(path)` · `setSource({ kind: "file", path, … })` · `setSave({ kind: "saved", path })` · conflict 의 `path` 는 그대로 — 모두 루트 기준 경로다.)

저장 버튼:

```tsx
            onClick={() => void submit(baseMtimeFor(mockPathFromName(targetName.trim())))}
```

저장 위치 Field:

```tsx
          <Field
            label="저장 위치"
            htmlFor="mock-target"
            hint={`대시보드를 띄운 디렉터리의 ${MOCKS_DIR}/ 폴더 안에 저장합니다. 파일 이름만 적으세요.`}
          >
            <div className="flex items-center gap-1">
              <span className="font-mono text-sm text-ink-muted">{`${MOCKS_DIR}/`}</span>
              <input
                id="mock-target"
                className={INPUT_CLASS}
                value={targetName}
                onChange={(event) => {
                  setTargetName(event.target.value);
                  setSave({ kind: "idle" });
                }}
              />
            </div>
          </Field>
```

컴포넌트 머리 주석 첫 줄 `` `mock.json` 을 새로 만들거나 `` 를 `` `mocks/` 아래 목 정의를 새로 만들거나 `` 로 고친다.

- [ ] **Step 6: 통과 확인**

Run: `corepack pnpm vitest run --project web packages/dashboard/web/tests`
Expected: `Test Files  N passed`(실패 0). `mock-start.test.tsx` 도 녹색이어야 한다(MockStart 는 바꾸지 않았다).

- [ ] **Step 7: 포맷 · 타입**

```bash
corepack pnpm biome check --write packages/dashboard/web
corepack pnpm --filter @mcpeak/dashboard typecheck >/dev/null 2>&1; echo "exit=$?"
```
Expected: `exit=0`.

- [ ] **Step 8: 회귀 증명**

```bash
SP=/private/tmp/claude-501/-Users-cheonjamin-projects-mcptest/a6ceb575-7924-4d19-b5fe-e85fdcfcbc0a/scratchpad
cp packages/dashboard/web/src/mock-builder/draft.ts "$SP/draft.ts.fixed"
sed -i '' 's|return `${MOCKS_DIR}/${name}`;|return name;|' packages/dashboard/web/src/mock-builder/draft.ts
corepack pnpm vitest run --project web packages/dashboard/web/tests/mock-builder.test.tsx >/dev/null 2>&1; echo "exit=$?"
cp "$SP/draft.ts.fixed" packages/dashboard/web/src/mock-builder/draft.ts
git diff --stat
```
Expected: `exit=1`, 복구 후 diff 에 draft.ts · MockBuilder.tsx · 두 테스트 파일만.

- [ ] **Step 9: Commit**

```bash
git add packages/dashboard/web/src/mock-builder/draft.ts packages/dashboard/web/src/screens/MockBuilder.tsx packages/dashboard/web/tests/mock-draft.test.ts packages/dashboard/web/tests/mock-builder.test.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): 목 만들기 저장 위치를 mocks/ 고정 접두와 파일 이름으로 받는다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: E2E 왕복을 `mocks/` 로 옮긴다 (직렬 웨이브)

**Files:**
- Modify: `packages/dashboard/tests/mock-builder-e2e.test.ts`

**Interfaces:**
- Consumes: Task 2 서버 계약(`mocks/` 아래만 저장, 폴더 자동 생성), Task 3 의 `mockFilePath`(그대로)
- Produces: 없음

- [ ] **Step 1: 실패 확인 (서버 변경 뒤 옛 E2E 가 깨지는 것을 먼저 본다)**

Run: `corepack pnpm vitest run --project e2e packages/dashboard/tests/mock-builder-e2e.test.ts`
Expected: FAIL — 루트 `weather.mock.json` · `a.mock.json` 저장이 400(`saveDraft` 의 `expect(response.status).toBe(200)`).

- [ ] **Step 2: 경로 갱신**

1. 맨 위 `node:fs/promises` import 에 `mkdir` 을 더한다: `import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";`
2. `describe.sequential("목 만들기 왕복", …)` 안에서 다음을 바꾼다.

첫 케이스(폴더가 없는 상태에서 저장 → 폴더가 생기는 것까지 실제 서버로 확인):

```ts
    await saveDraft(base, "mocks/weather.mock.json", DRAFT);

    const client = await connectToSavedMock(join(root, "mocks", "weather.mock.json"));
```

두 번째 케이스:

```ts
    await saveDraft(base, "mocks/a.mock.json", DRAFT);
    await saveDraft(base, "mocks/b.mock.json", DRAFT);

    const [a, b] = await Promise.all([
      readFile(join(root, "mocks", "a.mock.json")),
      readFile(join(root, "mocks", "b.mock.json")),
    ]);
```

세 번째 케이스:

```ts
    await mkdir(join(root, "mocks"));
    await writeFile(join(root, "mocks", "weather.mock.json"), HANDWRITTEN, "utf8");

    const opened = await openMock(base, "mocks/weather.mock.json");
```
```ts
    await saveDraft(base, "mocks/weather.mock.json", edited, opened.mtimeMs);

    const saved = JSON.parse(
      await readFile(join(root, "mocks", "weather.mock.json"), "utf8"),
    ) as {
```
```ts
    const client = await connectToSavedMock(join(root, "mocks", "weather.mock.json"));
```

네 번째 케이스:

```ts
    await mkdir(join(root, "mocks"));
    const file = join(root, "mocks", "weather.mock.json");
    await writeFile(file, HANDWRITTEN, "utf8");

    const first = await openMock(base, "mocks/weather.mock.json");
    await saveDraft(base, "mocks/weather.mock.json", first.draft, first.mtimeMs);
    const afterFirst = await readFile(file);

    const second = await openMock(base, "mocks/weather.mock.json");
    await saveDraft(base, "mocks/weather.mock.json", second.draft, second.mtimeMs);
```

3. `grep -n '"weather.mock.json"\|"a.mock.json"\|"b.mock.json"' packages/dashboard/tests/mock-builder-e2e.test.ts` → 0줄.

- [ ] **Step 3: 통과 확인 (다른 테스트와 같이 돌리지 않는다)**

Run: `corepack pnpm vitest run --project e2e packages/dashboard/tests/mock-builder-e2e.test.ts`
Expected: `Test Files  1 passed`, `Tests  4 passed`.

- [ ] **Step 4: 결정론 — 두 번 돌려 같은 결과**

같은 명령을 한 번 더 돌려 `Tests  4 passed` 를 다시 본다.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/tests/mock-builder-e2e.test.ts
git commit -m "$(cat <<'EOF'
test(dashboard): 목 만들기 왕복 E2E 를 mocks/ 폴더 저장으로 옮긴다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: ADR · changeset

**Files:**
- Create: `docs/adr/0121-대시보드-목은-mocks-폴더에만-두고-이름-규칙으로-고르지-않는다.md`
- Modify: `docs/adr/README.md` (131행 0119 줄 다음)
- Create: `.changeset/dashboard-mocks-dir.md`

- [ ] **Step 1: 번호 충돌 확인**

Run: `git fetch -q && git -c core.quotepath=off ls-tree --name-only origin/main docs/adr/ | grep -c "^docs/adr/0121"`
Expected: stdout `0`(grep 이 exit 1 이어도 건수는 stdout 의 0 이다 — CLAUDE.local.md §2). 0 이 아니면 다음 빈 번호로 바꾸고 이 계획의 `ADR-0121` 언급(files.ts · draft.ts 주석 포함)을 같이 고친다.

- [ ] **Step 2: ADR 작성**

```markdown
# ADR-0121: 대시보드 목은 `mocks/` 폴더에만 두고, 이름 규칙으로 고르지 않는다

- 상태: 제안
- 날짜: 2026-10-27
- 담당: dashboard
- 작성자: @storyrago
- 참조: `docs/superpowers/plans/2026-10-27-dashboard-mocks-dir.md`

## 배경

목 만들기의 "기존 목 수정" 목록은 실행 폴더 아래 모든 `.json` 중 `assertMockDefinition` 을 통과하는
파일을 보여 줬다. 제외 폴더가 `node_modules` · `.git` · `dist` 뿐이라 `.claude/worktrees/*` 복사본,
`bench/repair-effect/results*`, `fixtures/tools-list.sample.*`, 다른 패키지의 테스트 fixture 가 목으로
잡혔다. 저장 기본값은 루트의 `mock.json` 이었고, 저장 위치는 자유 입력이었다.

## 선택지

1. **`*.mock.json` 이름 규칙** — 루트 전체를 보되 이 접미사만 목으로 본다.
2. **`mocks/` 폴더 고정** — 목록 · 저장 모두 `<root>/mocks/` 아래만.
3. 제외 폴더 목록을 늘린다(`.claude`, `bench`, `fixtures`, `tests` …).

## 결정

2 를 택한다. `GET /api/mocks` 는 `mocks/` 아래(하위 폴더 포함)만 싣고, `PUT /api/mocks/<path>` 는
`mocks/` 밖이면 400 으로 거절한다. 폴더는 내용 검증을 통과한 저장에서만 만든다. 화면은 `mocks/` 를
고정 접두로 보이고 파일 이름만 받는다. API 경로 모양과 `api-types.ts` 는 바꾸지 않았다.

## 이유

- 잡음이 **확실히** 사라진다. 1 은 worktree 복사본(`.claude/worktrees/*/…/weather.mock.json`)을 여전히
  잡는다 — 복사본도 같은 이름이다. 3 은 저장소마다 잡음 폴더가 달라 목록이 끝나지 않는다.
- 규칙이 하나다. "어디에 저장됐나" 와 "목록에 왜 안 보이나" 의 답이 같은 문장(`mocks/` 안)이다.
- 위치 검사를 루트 탈출 검사보다 먼저 둬서, 화면에서 `../x.json` 을 친 사람도 "파일 이름만 적으세요"
  라는 고칠 수 있는 문장을 본다.

## 결과

- `mocks/` 밖에 둔 목은 목록에 나오지 않는다. 예: `examples/mock-server/weather.mock.json`. 열기
  (`GET /api/mocks/<path>`)는 그대로라 경로를 알면 API 로는 열 수 있다.
- 기존에 루트에 `mock.json` 을 저장해 쓰던 사용자는 파일을 `mocks/` 로 옮겨야 목록에서 다시 본다
  (changeset 에 적는다).
- `MOCKS_DIR` 이 서버(`src/server/files.ts`)와 web(`web/src/mock-builder/draft.ts`) 두 곳에 있다.
  web 이 src 를 import 하지 않는 기존 구조(`REPAIR_BUNDLE_DIR` 와 같은 사정) 때문이다.
- `mcpeak-mock` CLI 는 어느 경로의 파일이든 그대로 읽는다. 이 결정은 대시보드에만 걸린다.
```

- [ ] **Step 3: 색인 한 줄**

`docs/adr/README.md` 의 0119 줄 바로 다음에:

```markdown
| [0121](./0121-대시보드-목은-mocks-폴더에만-두고-이름-규칙으로-고르지-않는다.md) | 대시보드 목은 `mocks/` 폴더에만 두고, 이름 규칙으로 고르지 않는다 | dashboard | 제안 |
```

- [ ] **Step 4: changeset**

`.changeset/dashboard-mocks-dir.md`:

```markdown
---
"@mcpeak/dashboard": minor
---

목 만들기가 실행 폴더의 `mocks/` 아래에만 목 정의를 저장하고, "기존 목 수정" 목록도 `mocks/` 아래(하위 폴더 포함)만 보여 줍니다. 저장 위치 칸은 `mocks/` 를 고정으로 보이고 파일 이름만 받으며(기본값 `mock.json` → `mocks/mock.json`), 폴더가 없으면 저장할 때 만듭니다. `mocks/` 밖을 가리키는 이름은 거절합니다. 루트 등 다른 곳에 둔 목은 더 이상 목록에 나오지 않으니 `mocks/` 로 옮기세요.
```

(minor 인 이유: 목록에서 파일이 사라지는 사용자 눈에 보이는 동작 변경. 판단이 다르면 사람이 고친다.)

- [ ] **Step 5: Commit**

```bash
git add "docs/adr/0121-대시보드-목은-mocks-폴더에만-두고-이름-규칙으로-고르지-않는다.md" docs/adr/README.md .changeset/dashboard-mocks-dir.md
git commit -m "$(cat <<'EOF'
docs(dashboard): 목을 mocks/ 폴더에만 두는 결정을 ADR-0121 과 changeset 으로 남긴다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 패키지 전체 게이트 · 계약 검토 (상위 모델)

**Files:** 없음(실패 시 해당 Task 로 되돌아간다)

- [ ] **Step 1: 유닛 · web**

```bash
corepack pnpm vitest run --project unit packages/dashboard >/dev/null 2>&1; echo "unit exit=$?"
corepack pnpm vitest run --project web >/dev/null 2>&1; echo "web exit=$?"
```
Expected: 둘 다 `exit=0`. 이어서 파이프 없이 한 번 더 돌려 출력에 `Test Files … passed` 줄이 있는지 눈으로 본다(존재하지 않는 프로젝트명이면 즉시 exit 0 이 날 수 있다).

- [ ] **Step 2: 타입 · 린트**

```bash
corepack pnpm --filter @mcpeak/dashboard typecheck >/dev/null 2>&1; echo "typecheck exit=$?"
corepack pnpm biome check . >/dev/null 2>&1; echo "biome exit=$?"
```
Expected: 둘 다 `exit=0`. biome 출력의 `Checked N files` 에서 N 이 0 이 아닌지 본다.

- [ ] **Step 3: dashboard E2E (직렬)**

Run: `corepack pnpm vitest run --project e2e packages/dashboard`
Expected: `Test Files … passed`, 실패 0. 다른 vitest 를 동시에 돌리지 않는다.

- [ ] **Step 4: 빌드 · dist 확인 (turbo 캐시 함정)**

```bash
corepack pnpm --filter @mcpeak/dashboard build >/dev/null 2>&1; echo "build exit=$?"
grep -c "목 정의는 mocks/ 폴더 안에만" packages/dashboard/dist/*.mjs
```
Expected: `build exit=0`, grep stdout 에 1 이상인 파일이 하나 있다. 0 뿐이면 `cd packages/dashboard && npx tsdown --config-loader native` 로 직접 빌드 후 다시 본다(그 뒤 루트로 돌아온다).

- [ ] **Step 5: 계약 검토 체크리스트**

- [ ] `api-types.ts` · `GET /api/mocks/<path>` 변경 없음: `git diff main -- packages/dashboard/src/api-types.ts` 0줄, `handleGetMock` 변경 없음.
- [ ] 다른 패키지 변경 없음: `git diff --stat main -- packages | grep -v "packages/dashboard/"` 에 변경 줄 없음.
- [ ] `PUT /api/suites` · `/api/overlays` 동작 불변(규칙에 `checkLocation` · `createParentDir` 없음).
- [ ] 거절 문장이 Global Constraints 전문과 바이트 일치(서버 routes.ts · routes.test.ts · mock-builder.test.tsx 세 곳).
- [ ] `not implemented` grep: `grep -rn "not implemented" packages/dashboard/src packages/dashboard/web/src | wc -l` 가 작업 전과 같다.

- [ ] **Step 6: 커밋 범위 확인**

Run: `git log --name-only main..HEAD`
Expected: 커밋 5개(Task 1~5), 파일은 File Structure 표의 것만. `.github/CONTRIBUTING*`, `packages/mock/tests/stdio-e2e.test.ts`, `docs/2026-*-인수인계.md`, 이 계획서가 섞이지 않았다.

- [ ] **Step 7: 보고**

바꾼 것, 임의로 판단한 것(아래 "계획 단계에서 내린 판단")을 사용자에게 보고하고 push 는 사람에게 넘긴다.

---

## 계획 단계에서 내린 판단 (인수인계 문서에 없던 것)

1. **위치 검사를 루트 탈출 검사보다 먼저 둔다.** 그래서 기존 테스트 "경로 탈출을 거절한다"(`../outside.mock.json`)의 기대 문장이 `허용되지 않는 경로입니다.` 에서 새 문장으로 바뀐다. 화면에서 `../../x.json` 을 쳐도 고칠 수 있는 문장이 나오게 하려는 것이다.
2. **문장의 `<이름>` 은 앞의 `mocks/` 하나만 뗀 것.** API 를 직접 `other/x.json` 으로 부르면 `other/x.json` 이 그대로 보인다(이때 "'..' 없이" 줄은 딱 맞지 않지만 화면 경로가 아니라 감수).
3. **폴더 생성은 `writeFileContent` 의 옵션으로** 넣는다. routes.ts 에 `node:fs` 를 새로 끌어오지 않고, 충돌 검사 뒤 · 쓰기 직전에 만든다.
4. **빈 이름 문장**을 `파일 이름을 적으세요. mocks/ 폴더 안에 저장합니다.` 로 바꾼다(옛 문장은 "상대경로" 를 말했다).
5. **changeset 은 minor.** 목록에서 파일이 사라지는 눈에 보이는 변경이라서.
6. ADR 은 `0121`(열린 PR #542 가 0120 을 먼저 씀), 작성자 `@storyrago`(CODEOWNERS 의 dashboard 공동 오너 핸들 — 다르면 고친다).
