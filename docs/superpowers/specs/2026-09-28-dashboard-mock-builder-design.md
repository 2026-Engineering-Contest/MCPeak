# 대시보드 "목 만들기" — 설계

- 날짜: 2026-09-28
- 패키지: `dashboard` (공동 소유 — CONTRIBUTING §2. 착수 전 팀에 알린다)
- 건드리지 않는 패키지: `mock` · `record` · `cli` · `core`

## 목적

`mock.json` 을 손으로 쓰지 않고 대시보드 화면에서 만들고 고친다. 값은 두 곳에서 온다.

1. **사람이 폼에 입력한다.** 도구 이름 · 설명 · 입력 필드 · "이 인자면 이 답".
2. **이미 저장된 녹화본에서 외부 API 응답을 골라 쓴다.** 지어낸 값 대신 진짜 외부 데이터로
   목을 채우려는 것이다. 녹화본은 시작 갈래가 아니라 **편집 중에 옆에 펴 두는 참고 패널**이다.

녹화본은 **읽기만 한다.** 서버를 띄우지 않고, 새로 녹화하지 않는다. 고른 응답 본문은 가공 없이
`result` 칸에 들어가고, 사람이 필요 없는 필드를 지운 뒤 저장한다.

## 범위

| 한다 | 하지 않는다 |
|---|---|
| 새 목을 폼으로 작성 | 목 정의 형식 변경 (`result` 그대로 쓴다) |
| 기존 목 정의 파일을 열어 폼으로 고치기 | 원본 파일 서식 보존 (다시 저장하면 정규화된다) |
| 편집 중 녹화본의 외부 호출 · 응답 본문 보기 | 서버 실행 · 재생 · 새 녹화 |
| 고른 응답 본문으로 응답 줄 추가, 또는 기존 응답 줄의 `result` 교체 | 응답 본문 자동 가공 (필드 매핑 등) |
| `assertMockDefinition` 검증 후 파일 저장 | 저장한 목을 대시보드에서 띄우기 |

## 화면 흐름

```
목 만들기 (사이드바 Mock, #/mock)
 ├─ [새로 만들기] ──────────────────────────────────┐
 └─ [기존 목 수정] — 목 정의 파일 목록 → [열기] ─────┤
                                                    ▼
 편집 화면                        [녹화본 보기] [← 처음으로]
 ┌ 폼 ─────────────────────────┐  ┌ 녹화본 패널 (열었을 때만) ─────────┐
 │ 도구: 이름 · 설명 · 입력 필드 │  │ 녹화본 [선택 ▾]  (GET /api/sessions) │
 │ 응답: args · result · isError │  │ 외부 호출 목록 — 행을 펼치면 본문    │
 │ 저장 위치 → [저장]            │  │  [새 응답으로 추가]                  │
 └─────────────────────────────┘  │  [넣을 응답 ▾] [result 로 넣기]      │
                                   └────────────────────────────────────┘
```

- 첫 화면은 두 카드다. **새로 만들기**는 빈 폼, **기존 목 수정**은 목 정의 파일 목록에서 하나를 연다.
- 편집 화면에서 **[녹화본 보기]** 를 누르면 폼 오른쪽에 녹화본 패널이 열린다. 두 갈래 모두 같다.
  패널을 연 채로 목을 끝까지 만들 수 있다.
- **[새 응답으로 추가]**: 도구 이름과 args(또는 "인자 무관")를 받아 응답 한 줄을 더한다. 도구가
  폼에 없으면 이름만 채운 도구도 함께 더한다. 가져온 응답 줄은 다음 편집 전까지 강조된다.
- **[result 로 넣기]**: 이미 있는 응답 줄 하나를 골라 그 `result` 만 이 본문으로 바꾼다. 그 칸이
  비어 있거나 `{}` 가 아니면 바꾸기 전에 확인받는다.
- 폼은 도구 여러 개를 다룬다. 한 도구에 응답 여러 줄.
- 입력 필드 폼은 평면만 다룬다. 중첩 object · array · enum 은 "JSON 으로 편집" 으로 전환한다.
  JSON 모드에서 평면으로 돌아갈 수 없는 스키마면 전환 버튼을 비활성화하고 이유를 적는다.
- **[← 처음으로]** 는 폼을 고친 뒤라면 버릴지 먼저 묻는다.

## 기존 목 열기

- 목록은 루트 아래 `.json` 중 `assertMockDefinition` 을 통과하는 파일이다(스위트 목록과 같은
  방식). 도구 수 · 응답 수를 함께 보인다. `tools` 만 있는 픽스처 파일도 유효한 목 정의라 목록에 나온다.
- 파일 → 폼:
  - 입력 스키마가 평면이면 필드 폼으로, 아니면 JSON 모드로 연다.
  - 응답에 `args` 키가 없으면 "인자 무관" 으로 연다. `"args": null` 은 인자가 null 인 응답이다.
  - **폼에 칸이 없는 키는 버리지 않는다.** 도구의 `outputSchema` · `annotations`, 응답의 사용자 키,
    최상위의 사용자 키를 초안에 그대로 들고 있다가 저장할 때 되돌려 쓴다. 화면에는 "폼에 칸이 없는
    키 N개를 그대로 보존합니다: …" 로 알린다.
- 다시 저장하면 **서식이 정규화된다**: 들여쓰기 2칸, 알려진 키 먼저(정해진 순서) · 보존 키는 원래
  순서로 뒤에, `"isError": false` 처럼 기본값을 명시한 키는 빠진다. 의미는 같고, 같은 초안이면 같은
  바이트다.

## 녹화본에서 고를 수 있는 것

`loadSession(path).interactions` 의 각 항목에 대해:

| 상태 | 표시 | 고를 수 있나 |
|---|---|---|
| `outcome.kind === "response"` | method · url · status, 펼치면 `body` | 예 |
| `outcome.kind === "throw"` | `failureKind` · `code` | 아니오 — 본문이 없다 |
| `status === "incomplete"` 또는 `outcome` 없음 | "녹화가 끝나지 않은 호출" | 아니오 |

`url` 은 녹화 때 이미 경로가 `<redacted>` 로 지워진 표시용 값(`HttpDisplayV1`)이다. 그대로 쓴다.

## 표시 억제

녹화 때 이미 가려진 것: body 의 민감 키 이름 값 · 헤더 · URL 경로 · query 의 민감 키.
**가려지지 않은 것: body 안의 URL 문자열**(ADR-0062). 녹화본은 개수만 세고 저장하지 않으므로
`loadSession` 결과에는 없다. 대시보드가 가져온 본문을 직접 훑는다.

- record 가 녹화 때 쓰는 판정과 같게 센다: 문자열 **전체**가 http(s) 절대 URL 인 값, 서로 다른 값의
  개수. 키 이름은 보지 않는다. 값은 화면에 따로 모으지 않는다.
- **녹화본에서 가져온 응답**(새 응답 추가 · result 교체)에만 경고한다. 손으로 친 값이나 기존 파일에서
  읽은 값에 "녹화 때 가려지지 않는 자리" 라고 말하면 틀린 문장이다.
- 응답 줄 아래(고칠 때마다 다시 센다)와 저장 버튼 위(가져온 응답 전체)에 띄운다.
- 저장을 막지 않는다. 판정은 사람이 한다.

```
→ 이 응답 본문에 URL 이 2개 있습니다. 녹화 때 가려지지 않는 자리라 자격증명이 담겼을 수 있습니다.
→ 저장 전에 result 에서 해당 값을 확인하세요.
```

## 서버 API

기존 `routes.ts` 패턴을 따른다.

```ts
// GET /api/sessions/<path>/interactions — 녹화본 하나의 외부 호출 목록.
export interface SessionInteractionEntry {
  /** 녹화 순서. 목록 정렬 키이자 식별자. */
  readonly ordinal: number;
  readonly method: string;
  /** 경로가 지워진 표시용 URL (HttpDisplayV1.url). */
  readonly url: string;
  readonly outcome:
    | { readonly kind: "response"; readonly status: number; readonly body: JsonValue }
    | { readonly kind: "throw"; readonly failureKind: string; readonly code?: string }
    | { readonly kind: "incomplete" };
}

// GET /api/mocks — 목 정의 파일 목록. assertMockDefinition 을 통과한 것만.
export interface MockFileEntry {
  readonly path: string;
  readonly toolCount: number;
  readonly responseCount: number;
}

// GET /api/mocks/<path> — 목 정의 파일 하나. 본문은 FileContent { path, content, mtimeMs }.
//   assertMockDefinition 을 통과하지 못하면 400 + 그 문장 그대로. 없으면 404.

// PUT /api/mocks/<path> — 목 정의 저장. 본문은 스위트 PUT 과 같은 { content, baseMtimeMs }이고
//   content 가 MockDefinition JSON 문자열이다. assertMockDefinition 을 서버에서 돌린다.
//   실패하면 400 + 그 오류 문장 그대로.
```

- `<path>` 는 기존 `/api/suites/<path>` 와 같은 루트 기준 상대경로 규칙 · 탈출 검사를 쓴다.
- **덮어쓰기는 스위트 PUT 의 mtime 규칙을 그대로 쓴다.** 없는 파일은 `baseMtimeMs` 와 무관하게
  저장되고, 있는 파일은 `baseMtimeMs` 가 현재 mtime 과 같을 때만 저장된다. 다르면
  `{ saved: false, reason: "conflict", mtimeMs }` 다.
  - 새로 만들기: `baseMtimeMs: 0` 을 보낸다. 경로에 파일이 있으면 충돌이 오고 확인을 받는다.
  - 기존 목 수정: 열 때 받은 mtime 을 보낸다. 그 사이 누가 파일을 바꿨을 때만 충돌이 온다.
  - 저장에 성공하면 그 경로 · 새 mtime 을 기준으로 삼는다. 다시 저장해도 확인을 묻지 않는다.
- 녹화본은 `loadSession` 으로만 읽는다. SQLite 스키마를 직접 읽지 않는다(`files.ts` 의 기존 원칙).

## 의존

- `@mcpeak/record` 의 `loadSession` — 이미 쓰고 있다.
- `@mcpeak/mock` 의 `assertMockDefinition` · `MockDefinition` 타입 — **새로 import 한다.**
  `dashboard → mock` 은 허용 방향이다(ADR-0091). #421 에서 "선언만 하고 import 0 건" 이라 뺀
  의존이 실제 사용과 함께 돌아오는 것이므로 의존 경계 검사(#445)가 통과하는지 확인한다.
- 웹(`web/`)은 `@mcpeak/mock` 을 import 하지 않는다(기존 관례). 검증은 서버 API 를 부른다.

## 오류 · 안내 문장

```
→ 이 녹화본을 읽을 수 없습니다 — weather.session.db
→ MCPeak 이 녹화한 세션 파일인지 확인하세요. 목록에는 읽을 수 있는 파일만 나옵니다.

→ 이 호출은 응답 본문이 없어 목의 답으로 쓸 수 없습니다 — fetch 가 실패했습니다 (dns · ENOTFOUND)
→ 녹화가 끝나지 않은 호출입니다. 응답이 저장되지 않아 목의 답으로 쓸 수 없습니다.

이미 파일이 있습니다 — mock.json. 덮어쓸까요?
이 파일이 불러온 뒤에 바뀌었습니다 — examples/weather.mock.json. 덮어쓸까요?
```

충돌 문구를 둘로 나누는 이유: 불러온 파일에 "이미 파일이 있습니다" 라고 하면 사용자는 자기가 연
파일이니 당연하다고 넘기고 남이 바꾼 내용을 덮어쓴다.

목 정의 오류(저장 · 열기)는 `assertMockDefinition` 의 문장을 그대로 보여준다(새로 쓰지 않는다).

## 테스트

- **서버 단위**: `/interactions` 가 response · throw · incomplete 세 갈래를 위 모양으로 돌려준다.
  URL 은 녹화된 표시용 값 그대로다.
- **서버 단위**: `GET /api/mocks` 가 유효한 목 정의만 경로순으로 싣는다. `GET /api/mocks/<path>` 가
  내용과 mtime 을 주고, 무효 파일에 400 + 문장 전문을 준다.
- **서버 단위**: `PUT /api/mocks` 가 잘못된 정의에 400 과 `assertMockDefinition` 문장 전문을
  돌려준다 — `toThrow` 부분 일치가 아니라 문장 전문 일치로 건다(CLAUDE.local.md §2).
  있는 파일은 mtime 이 맞을 때만 덮어쓴다.
- **서버 단위**: 경로 탈출(`../`)을 거절한다.
- **웹 단위**: 폼 → `MockDefinition` 조립. args 생략(ANY) · isError · 여러 도구 · 보존 키.
- **웹 단위**: 파일 → 폼 → 파일. 보존 키가 살아남고, 정규화 규칙대로 나온다.
- **웹 단위**: body URL 세기 — 중첩 객체 · 배열 · 상대경로(세지 않음).
- **웹 단위**: 녹화본 패널의 새 응답 추가 · result 교체(빈 칸은 바로, 값이 있으면 확인).
- **왕복**: 폼으로 만든 파일, 그리고 기존 파일을 열어 다시 저장한 파일을 목 서버에 넣어
  `tools/list` · `tools/call` 이 적은 대로 나오는지 본다. 같은 입력 2 회의 저장 파일이 바이트 단위로
  같은지 본다(결정론).

## 남은 확인

- 대시보드 공동 소유 — 착수 전 팀에 이 문서를 공유한다.
- `assertMockDefinition` 은 같은 도구 · 같은 args 응답이 두 줄인 것을 거르지 않는다(목이 뜰 때
  걸린다). 대시보드에서 매칭 키 규칙을 다시 쓰지 않고 mock 오너에게 넘긴다.
