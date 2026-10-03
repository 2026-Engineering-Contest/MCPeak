# Analyze 토큰 탭: 오버레이 저장을 빼고 "MCP 수정하기" 를 넣는다 (2026-10-03)

## 문서 지위

`docs/plans/2026-10-03-analyze-토큰탭-단계화면-비교.md`(U1·U2 통합 완료)의 후속이다. 결정 근거는
ADR-0106 이다. 태스크는 하나(V1)이고 `dashboard` 패키지만 고친다.

사용자 요청: 저장 경로·오버레이 저장을 화면에서 빼고, "MCP 수정하기" 로 지금 고른 서버의 소스를 고칠 수
있게 한다. 지금 단계는 개발자가 직접 고칠 수 있는 서버만 대상으로 한다.

## 1. 범위

- 한다: 결과 단계의 저장 카드를 없애고 `MCP 수정하기` 카드를 둔다. 미리보기(파일 diff, 변경별 상태) →
  확인 → 적용 → 다시 분석.
- 안 한다: 서버 라우트 `PUT /api/overlays/` 와 그 테스트·E2E 는 그대로 둔다(화면에서만 뺀다).
  LLM 수정, 진입 스크립트가 import 하는 다른 파일 수정, HTTP 서버.

## 2. 공유 계약 (`packages/dashboard/src/api-types.ts`)

```ts
type OverlayToolChange = OptimizeOverlay["tools"][number]["changes"][number];

/** 소스에 반영을 시도할 변경 하나. 화면이 `overlay.tools[].changes` 를 도구 이름과 함께 그대로 보낸다. */
export interface SourceEdit {
  readonly tool: string;
  readonly change: OverlayToolChange;
}

export type SourceEditStatus = "ready" | "not-found" | "ambiguous" | "unsupported";

export interface SourceEditResult {
  readonly tool: string;
  readonly change: OverlayToolChange;
  readonly status: SourceEditStatus;
  /** 사람이 읽는 한 줄. §3.4 의 문장 그대로다. */
  readonly detail: string;
}

/**
 * POST /api/analyze/source-edits. `apply` 가 없으면 미리보기다(파일을 쓰지 않는다).
 * `argv` 는 `AnalyzeTokensRequest.argv` 와 같은 배열이다.
 */
export interface SourceEditRequest {
  readonly argv: readonly string[];
  readonly edits: readonly SourceEdit[];
  readonly apply?: { readonly baseMtimeMs: number };
}

export interface SourceEditResponse {
  /** 프로젝트 루트 기준 상대경로. */
  readonly file: string;
  /** 미리보기면 지금 파일의 mtime, 적용했으면 쓴 뒤의 mtime. */
  readonly mtimeMs: number;
  /** 파일의 지금 내용과, ready 인 변경을 전부 반영한 내용. 적용 뒤에는 둘이 같다. */
  readonly before: string;
  readonly after: string;
  /** `edits` 와 같은 순서·같은 길이. */
  readonly results: readonly SourceEditResult[];
  readonly readyCount: number;
  readonly applied: boolean;
  /** `apply.baseMtimeMs` 가 지금 mtime 과 달라 쓰지 않았다. 본문은 새 미리보기다. */
  readonly conflict: boolean;
}
```

## 3. 서버 사양

### 3.1 `src/server/source-edits.ts` (새 파일. 순수 함수와 파일 찾기)

```ts
import type { SourceEdit, SourceEditResult } from "../api-types.js";

/** 소스 텍스트에 변경을 반영한다. 파일을 읽거나 쓰지 않는다. 같은 입력이면 같은 결과다. */
export function planSourceEdits(
  source: string,
  edits: readonly SourceEdit[],
): { readonly after: string; readonly results: readonly SourceEditResult[]; readonly readyCount: number };

export type SourceFileOutcome =
  | { readonly ok: true; readonly absolute: string; readonly relative: string }
  | { readonly ok: false; readonly error: string };

/** 실행 명령에서 고칠 소스 파일 하나를 찾는다(§3.3). */
export async function resolveSourceFile(root: string, argv: readonly string[]): Promise<SourceFileOutcome>;
```

### 3.2 `planSourceEdits` 규칙 (판단이 있는 곳이라 전량)

**문자열 리터럴 `LIT(x)`.** 내용이 `x` 인 JS/TS/Python 문자열 리터럴이다. 따옴표는 `"`, `'`, `` ` `` 셋을
모두 본다. 소스 안의 내용 표기는 둘을 본다: `x` 를 글자 그대로 적은 것, 그리고 `JSON.stringify(x)` 의
바깥 따옴표를 뗀 것(`\n`, `\"` 같은 이스케이프 표기). 여는 따옴표와 닫는 따옴표가 같아야 한다.

**변경별 패턴.**

| 변경 | 찾는 것 | 반영 |
|---|---|---|
| `description-cleaned` (before, after) | `LIT(before)` | 따옴표는 그대로 두고 내용을 `after` 로 바꾼다. `after` 는 그 따옴표에 맞게 이스케이프한다(`\`, 그 따옴표 문자, 개행은 `\n`, 백틱이면 `${` 도) |
| `description-removed` (before), reason 이 `promoted` 가 아닐 때 | `.describe(LIT(before))`(괄호 안 공백·끝 쉼표 허용) 또는 속성 `description: LIT(before)`(키에 따옴표 허용) | `.describe(...)` 는 통째로 지운다. 속성은 속성 삭제 규칙으로 지운다 |
| `description-removed` reason=`promoted` | 없음(찾지 않는다) | `unsupported`. 압축기는 이 설명을 서버 `instructions` 사전으로 옮긴다. 소스에서 설명만 지우면 정보가 사라진다. 같은 before 를 가진 다른 사유의 `description-removed` 그룹이 있으면 그 그룹은 `ambiguous` 다(소스의 출현이 어느 쪽 것인지 가릴 수 없다) |
| `schema-key-removed` key=`properties` | 속성 `properties: {}` | 속성 삭제 |
| `schema-key-removed` key=`required` | 속성 `required: []` | 속성 삭제 |
| `schema-key-removed` key=`additionalProperties` | 속성 `additionalProperties: true` | 속성 삭제 |
| `schema-key-removed` key=`$schema`·`$id`·`$comment`·`title` | 속성 `<key>: <아무 문자열 리터럴>` | 속성 삭제 |
| 그 밖의 key | 없음 | `unsupported` |

속성의 키는 따옴표가 있어도 없어도 된다(`properties`, `"properties"`, `'properties'`). 키와 `:` 와 값
사이 공백, `{}`·`[]` 안의 공백은 허용한다. Python 의 `"properties": {}` 도 같은 패턴에 걸린다.

**속성 삭제 규칙.** 결과가 문법상 유효하고 빈 줄을 남기지 않아야 한다. 테스트가 아래 넷을 단언한다.

| 원본 | 결과 |
|---|---|
| `{ type: "object", properties: {} }` | `{ type: "object" }` |
| `{ properties: {}, type: "object" }` | `{ type: "object" }` |
| `{ properties: {} }` | `{}` |
| 줄 전체가 `      properties: {},` 인 여러 줄 객체 | 그 줄이 통째로 사라진다(앞뒤 줄은 그대로) |

**`.describe(...)` 삭제 규칙.** 호출이 줄의 첫 토큰이면(앞이 그 줄의 들여쓰기 공백뿐이면) 앞 줄의 개행과
그 들여쓰기까지 함께 지운다. 빈 줄이나 쉼표만 남은 줄을 만들지 않는다. 테스트가 아래를 단언한다.

| 원본 | 결과 |
|---|---|
| `z.string().describe("id")` | `z.string()` |
| `  .uuid()\n  .describe("id"),` | `  .uuid(),` |

**개수 규칙.** 변경을 그룹으로 묶는다. 그룹 키는 `description-cleaned`·`description-removed` 는
`kind + before`, `schema-key-removed` 는 `kind + key` 다. 그룹의 변경 수를 n, 소스에서 찾은 출현 수를 m
이라 하면:

- m = 0 → 그룹 전체 `not-found`
- m ≠ n → 그룹 전체 `ambiguous`
- m = n → 그룹 전체 `ready`. 출현 m 곳을 전부 반영한다(어느 출현이 어느 도구인지 가릴 필요가 없다)
- `description-cleaned` 그룹 안에서 `after` 가 서로 다르면 그룹 전체 `ambiguous`(m = n 이어도)
- `ready` 인 두 그룹의 반영 범위가 겹치면 두 그룹 모두 `ambiguous` 로 내린다

반영은 원본 기준 위치로 계산해 뒤에서 앞으로 적용한다. `results` 는 `edits` 와 같은 순서다.
`readyCount` 는 `ready` 인 결과 수다. `ready` 가 없으면 `after === source` 다.

### 3.3 `resolveSourceFile` 규칙

1. argv 에 `--url` 이 있으면 `{ ok: false, error: "원격(HTTP) 서버는 소스 파일 위치를 알 수 없어 고칠 수 없습니다." }`
2. 후보는 `--command` 의 값, 그 뒤 `--arg` 의 값들이다(순서대로). `--env` 값은 보지 않는다.
3. 각 후보를 `path.resolve(root, 후보)` 로 풀어(절대경로면 그대로) 다음을 전부 만족하는 첫 번째를 고른다.
   - 프로젝트 루트 안이다(`paths.ts` 의 판정과 같은 식: 루트 자체가 아니고 `root + sep` 로 시작)
   - 경로 조각에 `node_modules` 가 없다
   - 확장자가 `.js`·`.mjs`·`.cjs`·`.ts`·`.mts`·`.cts`·`.py` 중 하나다
   - 실제로 있는 일반 파일이다(`stat().isFile()`)
4. 없으면 `{ ok: false, error: "실행 명령에서 프로젝트 안의 서버 소스 파일을 찾지 못했습니다.\n해결: 인자에 스크립트 경로가 있어야 합니다(예: node ./server.mjs)." }`

### 3.4 `detail` 문장 (글자 그대로)

| status | detail |
|---|---|
| `ready` | `소스에서 ${m}곳을 찾았습니다.` |
| `not-found` | `소스 파일에서 찾지 못했습니다. SDK 나 라이브러리가 만드는 값이면 소스에서 고칠 수 없습니다.` |
| `ambiguous` (m ≠ n) | `소스에서 ${m}곳을 찾았는데 변경은 ${n}건입니다. 어느 것이 도구 정의인지 가릴 수 없어 건드리지 않습니다.` |
| `ambiguous` (after 불일치) | `같은 문자열을 서로 다르게 바꾸는 변경이 있어 건드리지 않습니다.` |
| `ambiguous` (범위 겹침) | `다른 변경과 같은 자리를 고치게 되어 건드리지 않습니다.` |
| `unsupported` | `이 종류의 변경은 자동으로 고치지 않습니다. 직접 고쳐야 합니다.` |
| `ambiguous` (promoted 와 같은 before) | `같은 설명이 공통 파라미터 변경에도 있어 어느 것인지 가릴 수 없습니다. 건드리지 않습니다.` |
| `unsupported` (reason=`promoted`) | `공통 파라미터 설명은 서버 instructions 에 사전을 함께 더해야 뜻이 남습니다. 자동으로 고치지 않습니다.` |

### 3.5 `routes.ts`: `POST /api/analyze/source-edits`

`POST /api/analyze/tokens` 분기 바로 뒤에 둔다. `handleSourceEdits`:

1. `readJsonBody` → undefined 면 `400 "본문이 올바른 JSON이 아닙니다."`
2. 형식 검사: `argv` 문자열 배열, `edits` 배열이고 각 원소가 `{ tool: string, change: { kind: string, path: string } }`,
   `apply` 는 없거나 `{ baseMtimeMs: number }`. 아니면 `400 "요청 형식이 올바르지 않습니다."`
3. `resolveSourceFile(root, argv)` → 실패면 `400 { error }`
4. `readFileContent` 로 내용과 mtime 을 읽고 `planSourceEdits`
5. `apply` 가 없으면 `200` 미리보기(`applied: false, conflict: false`)
6. `apply` 가 있으면:
   - `readyCount === 0` → `400 "적용할 수 있는 변경이 없습니다."`
   - `apply.baseMtimeMs !== 지금 mtime` → `200` 에 `conflict: true, applied: false`(본문은 새 미리보기)
   - 아니면 `writeFileContent(absolute, after, baseMtimeMs)`. `saved: false` 면 위와 같은 conflict 응답.
     성공하면 `200` 에 `applied: true, conflict: false, before: after, after, mtimeMs: 새 값`,
     `results`·`readyCount` 는 쓰기 전 계획의 것 그대로다

`files.ts`·`paths.ts` 는 고치지 않는다(`readFileContent`·`writeFileContent` 를 import 해서 쓴다).

## 4. 웹 사양

### 4.1 `web/src/analyze/tool-diff.ts` 에 더하는 것

```ts
export interface HunkLine {
  readonly kind: "same" | "removed" | "added";
  readonly text: string;
  /** 원본 파일의 줄 번호(1 기반). added 면 undefined. */
  readonly beforeNo?: number;
  /** 고친 파일의 줄 번호(1 기반). removed 면 undefined. */
  readonly afterNo?: number;
}

/**
 * 파일 전체 대신 달라진 줄과 그 앞뒤 `context` 줄만 묶음으로 돌려준다. 묶음 사이가 `2 * context` 줄
 * 이하로 가까우면 하나로 합친다. 달라진 줄이 없으면 빈 배열이다.
 */
export function diffHunks(before: string, after: string, context?: number): readonly (readonly HunkLine[])[];
```

`context` 기본값 2. 묶음 안의 순서는 통합 diff 와 같다(같은 자리의 removed 가 added 보다 먼저).
`diffLines` 의 LCS 표를 공유한다.

### 4.2 `TokensPanel.tsx`

- `TokensResult` 에 `argv`(분석에 쓴 배열 그대로)와 `onReanalyze`(`() => void`, 같은 argv 로 다시 분석)를 넘긴다.
  분석에 성공한 argv 와 serverId 를 상태로 기억해, 다시 분석이 폼을 다시 읽지 않고 같은 요청을 보낸다.
- 다시 분석 중에는 결과 단계에 머문다(단계 0 으로 돌아가지 않는다). 실패하면 결과 단계 위에
  `<pre role="alert">` 로 CLI 문장을 보이고 이전 결과는 그대로 둔다.

### 4.3 `TokensResult.tsx`

저장 카드(저장 경로 `Field`, `오버레이 저장` 버튼, 저장 문장)와 `DEFAULT_OVERLAY_PATH`·`save()` 를 지운다.
그 자리에 `<SourceEditCard />` 를 둔다. `PutFileResponse` import 도 없어진다.

### 4.4 `web/src/analyze/SourceEditCard.tsx` (새 파일)

`({ result, argv, onReanalyze }: { result: AnalyzeTokensResponse; argv: readonly string[]; onReanalyze: () => void })`

- `edits` 는 `result.overlay.tools` 를 원본 순서로 돌며 `changes` 를 `{ tool: tool.name, change }` 로 편 것이다.
- 제목 `<h3>` `MCP 수정하기`, 설명 `<p>`
  `압축 변경을 서버 소스 파일에 직접 반영합니다. 적용 전에 바뀔 줄을 먼저 보여 줍니다.`
- `edits` 가 비면 버튼 대신 `<p>` `반영할 변경이 없습니다.`
- 처음: `Button variant="primary"` `MCP 수정하기`. 누르면 `POST /api/analyze/source-edits { argv, edits }`.
  요청 중 라벨 `확인 중…`. `ApiRequestError` 면 `<p role="alert" className="whitespace-pre-line">` 에 message 그대로.
- 미리보기를 받으면:
  - `<p>` `파일: ${file}` (`file` 은 `<code>`)
  - `<p>` `적용 가능 ${readyCount}건 / 전체 ${results.length}건`
  - 결과 목록 `<ul aria-label="변경별 상태">`: 각 `<li data-status={status}>` 에 `${tool}` , `<code>${change.path}</code>`,
    `describeChangeParts(change).text`, 줄을 바꿔 `detail`. `ready` 는 `--status-done-fg`, 나머지는 `text-ink-muted`.
  - `readyCount > 0` 이면 `<div aria-label="파일 변경 미리보기">` 에 `diffHunks(before, after)` 의 묶음마다 `<pre>`.
    줄은 U2 의 `data-diff` 방식 그대로이고 앞에 줄 번호(removed·same 은 `beforeNo`, added 는 `afterNo`)를 둔다.
    묶음 사이에는 `<hr>`.
  - `readyCount === 0` 이면 `<p>` `소스에서 고칠 수 있는 변경이 없습니다. 위 목록의 사유를 확인하세요.`
  - 버튼 둘: `Button variant="primary"` `적용`(`readyCount === 0` 이면 비활성), `Button` `취소`(미리보기를 닫는다).
- `적용` 을 누르면 같은 요청에 `apply: { baseMtimeMs: preview.mtimeMs }`. 요청 중 라벨 `적용 중…`.
  - `applied: true` → 미리보기를 닫고 `<p role="status">`
    `${file} 에 ${readyCount}건을 적용했습니다. 다시 분석하면 줄어든 결과를 확인할 수 있습니다.` 와
    `Button variant="primary"` `다시 분석`(누르면 `onReanalyze()`).
  - `conflict: true` → 미리보기를 응답의 것으로 바꾸고 `<p role="alert">`
    `미리보기 뒤에 ${file} 이 바뀌었습니다. 바뀐 내용으로 다시 계산했으니 확인하고 적용하세요.`
  - `ApiRequestError` → message 그대로 `<p role="alert">`.
- 타이머 없음. `result` 가 바뀌면(다시 분석) 카드 상태를 처음으로 돌린다(`key` 로 다시 마운트).

## 5. 테스트

### 5.1 `packages/dashboard/tests/source-edits.test.ts` (새 파일. 인메모리와 임시 디렉터리만)

```
describe("planSourceEdits")
  it("description-cleaned 는 따옴표를 지키고 내용만 바꾼다")   "…" · '…' · `…` 각각
  it("after 에 따옴표·개행이 있으면 그 따옴표에 맞게 이스케이프한다")
  it("이스케이프 표기(\\n, \\\")로 적힌 리터럴도 찾는다")
  it("description-removed 는 .describe(…) 를 통째로 지운다")   z.string().describe("id") → z.string()
  it("description-removed 는 description 속성을 지운다")   { type: "string", description: "id" } → { type: "string" }
  it("빈 properties·required, additionalProperties:true 속성을 지운다")
  it("문자열 값의 $schema·$id·$comment·title 속성을 지운다")
  it("속성 삭제 규칙 네 가지")   §3.2 표의 원본 → 결과 넷
  it("키에 따옴표가 있어도 찾는다")   "properties": {}
  it("출현 수가 0 이면 not-found 이고 소스는 그대로다")
  it("출현 수가 변경 수와 다르면 ambiguous 이고 건드리지 않는다")   properties: {} 가 3곳인데 변경 2건
  it("출현 수가 변경 수와 같으면 전부 ready 이고 전부 반영한다")   4곳·4건
  it("같은 before 를 다르게 바꾸는 cleaned 는 ambiguous 다")
  it("지원하지 않는 key 는 unsupported 다")   key "default"
  it("reason 이 promoted 인 description-removed 는 소스에 있어도 unsupported 이고 건드리지 않는다")   detail 은 promoted 문장
  it("promoted 와 같은 before 를 가진 다른 사유 변경은 ambiguous 다")   restates-name 1건 + promoted 1건, 출현 1곳 → restates-name 은 ambiguous(위 문장), promoted 는 unsupported, 소스 그대로
  it("results 는 edits 와 같은 순서이고 detail 은 §3.4 문장이다")   네 status 각각 문장 전체 비교
  it("같은 입력은 같은 결과다")
  it("examples/audit-target-server/server.mjs 의 properties 변경 4건이 전부 ready 다")
    실제 파일을 읽어 넣는다. after 에 `properties: {}` 가 없고 `{ type: "object" }` 가 4곳 있다
  it("examples/zod-notes-server/server.mjs 는 describe 1건만 ready 이고 $schema 3건은 not-found 다")

describe("resolveSourceFile")
  it("--arg 의 스크립트 경로를 찾는다")   ["--command","node","--arg","srv/server.mjs"] → relative "srv/server.mjs"
  it("--command 자체가 스크립트면 그것을 고른다")
  it("절대경로도 루트 안이면 받는다")
  it("--url 이면 원격 문장으로 거절한다")
  it("루트 밖·node_modules·없는 파일·다른 확장자는 건너뛰고, 남는 게 없으면 찾지 못함 문장이다")
```

### 5.2 `packages/dashboard/tests/routes.test.ts` 에 더하는 것

```
describe("POST /api/analyze/source-edits")
  it("apply 가 없으면 파일을 쓰지 않고 미리보기를 준다")   applied false, 파일 바이트 그대로, before ≠ after
  it("apply 면 파일을 고치고 applied:true 를 준다")   파일 바이트 === 미리보기의 after
  it("baseMtimeMs 가 다르면 conflict 이고 파일을 쓰지 않는다")
  it("ready 가 없는데 apply 면 400 이다")   "적용할 수 있는 변경이 없습니다."
  it("--url 이면 400 이고 원격 문장이다")
  it("형식이 틀리면 400 이다")   "요청 형식이 올바르지 않습니다."
  it("본문이 JSON 이 아니면 400 이다")
```

### 5.3 `web/tests/tool-diff.test.ts` 에 더하는 것

- `diffHunks`: 달라진 줄이 없으면 `[]`. 가운데 한 줄을 바꾸면 묶음 하나에 앞뒤 2줄 문맥과 줄 번호. 멀리 떨어진
  두 변경은 묶음 둘, 가까우면 하나. 같은 입력은 같은 결과.

### 5.4 `web/tests/analyze-view.test.tsx`

저장 관련 기존 테스트 둘(`오버레이 저장은 …`, `이미 있는 파일이면 …`)은 지운다. 더한다.

```
it("결과 단계에 저장 경로와 오버레이 저장 버튼이 없다")
it("MCP 수정하기를 누르면 argv 와 변경 목록을 POST 하고 미리보기를 보인다")
  fetch 가 POST /api/analyze/source-edits, body { argv, edits: [{ tool, change }…] }(apply 없음)
  → "파일: srv/server.mjs", "적용 가능 1건 / 전체 2건", 상태 목록 2줄(data-status), 미리보기에 removed 줄
it("적용을 누르면 baseMtimeMs 를 실어 보내고 결과 문장과 다시 분석 버튼을 보인다")
it("다시 분석을 누르면 같은 argv 로 POST /api/analyze/tokens 를 다시 보낸다")
it("conflict 면 다시 계산했다는 문장을 보이고 미리보기를 바꾼다")
it("ready 가 0 이면 적용 버튼이 비활성이고 사유 안내를 보인다")
it("취소를 누르면 미리보기가 닫힌다")
it("요청이 실패하면 error 문장을 그대로 보인다")
it("변경이 없는 결과에서는 반영할 변경이 없습니다 를 보인다")
```

## 6. 태스크

| ID | 패키지 | 생성·수정 Files | 금지 |
|---|---|---|---|
| V1 | dashboard | `src/api-types.ts`, `src/server/source-edits.ts`(새), `src/server/routes.ts`, `tests/source-edits.test.ts`(새), `tests/routes.test.ts`, `web/src/analyze/{tool-diff.ts,TokensPanel.tsx,TokensResult.tsx,SourceEditCard.tsx(새)}`, `web/tests/{tool-diff.test.ts,analyze-view.test.tsx}`, `.changeset/dashboard-analyze-source-edit.md`(`@mcpeak/dashboard` minor), `docs/reports/2026-10-03-analyze-V1.md` | 그 밖의 모든 파일. `files.ts`·`paths.ts`·`analyze.ts`·`examples/`(읽기만)·기존 컴포넌트 포함 |

테스트는 `examples/` 의 파일을 **읽기만** 한다. 쓰기 테스트는 `mkdtemp` 임시 루트에서만 한다.

검증: `pnpm build --force`, `pnpm typecheck --force`, `pnpm lint`, `pnpm test`. `Cached: 0 cached` 확인.
끝에 `git status --short examples/` 가 비어 있는지 확인한다. 통합 시 대장에 `analyze-V1`.

## 7. 후속 W1: 변경별 상태를 사유별로 묶는다 (2026-10-03 사용자 피드백)

V1 통합(`caecd58`) 뒤 live-weather-server 로 미리보기를 열면 같은 두 줄이 도구 수만큼(10번) 되풀이된다.
적용 가능 0건일 때 무엇을 하면 되는지도 화면이 말하지 않는다. 웹만 고친다. 서버 응답은 그대로다.

### 7.1 `web/src/analyze/source-edit-groups.ts` (새 파일. 테스트가 전량 단언한다)

```ts
import type { SourceEditResult, SourceEditStatus } from "../../../src/api-types.js";

export interface SourceEditGroup {
  readonly status: SourceEditStatus;
  /** 변경의 경로(`change.path`). */
  readonly path: string;
  /** `describeChangeParts(change).text`. */
  readonly text: string;
  readonly detail: string;
  /** 이 묶음에 든 도구 이름. 응답 순서 그대로이고 같은 이름이 두 번 올 수 있다. */
  readonly tools: readonly string[];
}

/**
 * 상태·경로·변경 문장·사유가 전부 같은 결과를 한 묶음으로 합친다. 묶음 순서는 `ready` 가 먼저이고,
 * 같은 쪽 안에서는 처음 나온 순서다(안정 정렬).
 */
export function groupSourceEditResults(results: readonly SourceEditResult[]): readonly SourceEditGroup[];

/** 묶음의 도구 표기. 1개면 그 이름, 2개 이상이면 `${첫 이름} 외 ${n - 1}개`. */
export function toolsLabel(tools: readonly string[]): string;
```

### 7.2 `SourceEditCard.tsx`

- `<ul aria-label="변경별 상태">` 의 `<li>` 를 결과마다가 아니라 묶음마다 그린다. `data-status` 는 그대로 단다.
- 묶음 한 칸:
  - 첫 줄: `<code>{path}</code> {text}` 뒤에 `<span>` `${tools.length}건 · ${toolsLabel(tools)}`
  - 둘째 줄: `detail`
  - `tools.length > 1` 이면 `<details>` `<summary>도구 ${tools.length}개 보기</summary>` 안에 도구 이름을 `, ` 로 이은 한 줄
- 요약 줄 `적용 가능 ${readyCount}건 / 전체 ${results.length}건` 은 그대로다(건수는 묶음 수가 아니라 변경 수).
- `readyCount === 0` 일 때:
  - 안내 문장을 바꾼다. 결과가 전부 `not-found` 면
    `소스에서 고칠 수 있는 변경이 없습니다. 전부 SDK 나 라이브러리가 만드는 값으로 보입니다. 이런 값은 서버 소스가 아니라 프록시(mcpeak-optimize-proxy)로 줄입니다.`
    그 밖이면 `소스에서 고칠 수 있는 변경이 없습니다. 위 사유를 확인하세요.`
  - `적용` 버튼을 그리지 않는다. 남는 버튼의 라벨은 `취소` 대신 `닫기` 다.
- `readyCount > 0` 이면 버튼은 지금대로(`적용`, `취소`)다.

### 7.3 테스트

`web/tests/source-edit-groups.test.ts` (새 파일).
- `같은 상태·경로·문장·사유는 한 묶음이다`: `$schema` not-found 10건 → 묶음 1개, tools 10개(순서 유지).
- `경로나 사유가 다르면 다른 묶음이다`.
- `ready 묶음이 먼저 오고 나머지는 처음 나온 순서다`.
- `같은 입력은 같은 결과다`.
- `toolsLabel`: 1개 `"a"`, 3개 `"a 외 2개"`.

`web/tests/analyze-view.test.tsx`.
- `같은 사유의 변경은 한 줄로 묶어 건수와 도구를 보인다`: not-found 3건(같은 path·key) → 상태 목록 `<li>` 1개, `3건 · a 외 2개`, `도구 3개 보기`.
- `전부 not-found 면 프록시 안내를 보이고 적용 버튼이 없다`: 위 문장 전체, `적용` 버튼 없음, `닫기` 버튼 있음.
- `not-found 가 아닌 사유가 섞이면 사유 확인 안내를 보인다`.
- 기존 `ready 가 0 이면 적용 버튼이 비활성이고 …` 테스트는 새 동작(버튼 없음)에 맞게 고친다. 상태 목록 줄 수를 세던 기존 단언도 묶음 기준으로 고친다.

### 7.4 태스크

| ID | 패키지 | 생성·수정 Files | 금지 |
|---|---|---|---|
| W1 | dashboard(웹) | `web/src/analyze/source-edit-groups.ts`(새), `web/src/analyze/SourceEditCard.tsx`, `web/tests/source-edit-groups.test.ts`(새), `web/tests/analyze-view.test.tsx`, `.changeset/dashboard-analyze-source-edit-groups.md`(`@mcpeak/dashboard` patch), `docs/reports/2026-10-03-analyze-W1.md` | 그 밖의 모든 파일(서버·`api-types.ts` 포함) |

검증: `pnpm vitest run --root . --project web`, `pnpm build --force`, `pnpm typecheck --force`, `pnpm lint`, `pnpm test`. 통합 시 대장에 `analyze-W1`.
