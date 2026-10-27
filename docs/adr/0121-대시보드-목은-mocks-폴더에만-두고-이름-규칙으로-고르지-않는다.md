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
