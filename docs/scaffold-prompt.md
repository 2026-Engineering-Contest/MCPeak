# 저장소 스캐폴딩 요청 프롬프트

> 아래 `---` 사이 내용을 그대로 복사해 코딩 에이전트에 붙여넣는다.
> **먼저 채울 것**: `<PKG_SCOPE>` (npm 스코프, 예: `@mcp-test`), `<REPO_NAME>` (저장소명).

---

## 요청

MCP 테스트 프레임워크의 pnpm 모노레포 **뼈대만** 만들어줘. 5명이 서로 다른 패키지를 동시에 개발할 수 있는 상태까지가 목표다.

### 가장 중요한 제약 — 기능 로직을 구현하지 마라

- matcher, 카세트 포맷, 테스트 생성기, 목 데이터 생성기의 **실제 동작은 짜지 마라.**
- 대신 **타입 시그니처와 `throw new Error("not implemented")` 스텁**만 만든다.
- 이유: 각 패키지에 담당자가 따로 있고, 설계는 그 사람이 한다. 미리 구현된 코드는 오히려 걷어내야 할 부채가 된다.
- 예외: `core/src/types.ts`의 인터페이스는 아래에 명시한 대로 **정확히** 작성한다. 이게 5명의 병렬 작업 기준점이다.

### 기술 스택

- TypeScript (strict), ESM, Node 20/22/24 지원
- pnpm workspace + catalog
- Turborepo (빌드·테스트 태스크 오케스트레이션)
- Vitest (테스트)
- Biome (린트 + 포맷)
- tsdown (번들, ESM/CJS + d.ts 출력)
- Changesets (버저닝·릴리스)
- `@modelcontextprotocol/sdk`는 **1.x 안정 버전으로 고정**한다. `^`나 `latest` 금지. 2.0이 개발 중이라 자동 업그레이드되면 코어가 깨진다.

### 만들 파일 구조

```
<REPO_NAME>/
├── .changeset/config.json
├── .github/
│   ├── CODEOWNERS
│   ├── ISSUE_TEMPLATE/bug_report.md
│   ├── ISSUE_TEMPLATE/feature_request.md
│   ├── pull_request_template.md
│   └── workflows/
│       ├── ci.yml
│       └── release.yml
├── docs/adr/
│   ├── README.md
│   └── 0001-transport-strategy.md ~ 0005-mock-data-strategy.md   # 제목·상태만, 내용은 비움
├── fixtures/
│   ├── README.md
│   └── tools-list.sample.json     # tools/list 응답 형태의 더미 샘플
├── packages/
│   ├── core/       # 트랜스포트 · 프로세스 수명주기 · 핸드셰이크
│   ├── runner/     # createMcpTest · matcher · 리포터
│   ├── generate/   # 스키마 → 테스트 코드 생성
│   ├── record/     # 녹화 · 재생 · 계약 스냅샷
│   ├── mock/       # 목 서버 · 가짜 데이터
│   └── cli/        # 실행 진입점 (얇게)
├── examples/README.md
├── .gitignore
├── .npmrc
├── biome.json
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── turbo.json
├── vitest.config.ts
├── LICENSE          # MIT
└── README.md
```

각 패키지는 동일한 형태로 만든다:

```
packages/<name>/
├── src/index.ts
├── src/types.ts        # 필요한 패키지만
├── tests/index.test.ts # 스텁이 정의돼 있는지 확인하는 최소 테스트 1개
├── package.json
├── tsconfig.json
└── README.md           # 한 줄 소개 + 담당자 칸
```

### 패키지 규칙

- 이름: `<PKG_SCOPE>/core`, `<PKG_SCOPE>/runner` … `cli`만 `<REPO_NAME>` (실행 파일명이 되므로)
- 버전 전부 `0.0.0`, `"private": false`, `publishConfig.access: "public"`
- ESM 우선 `exports` 필드 + `types` 경로 정확히
- 패키지 간 의존은 `workspace:*` 프로토콜 사용
- 의존 방향은 **단방향**: `cli` → `runner`/`generate`/`record`/`mock` → `core`. 역방향 참조나 순환이 생기면 안 된다.

### core/src/types.ts — 이 내용 그대로

```ts
export interface McpClient {
  listTools(): Promise<ToolDef[]>;
  callTool(name: string, args: unknown): Promise<ToolResult>;
  close(): Promise<void>;
}

export type ToolDef = {
  name: string;
  description?: string;
  inputSchema: unknown;
};

export type ToolResult = {
  content: unknown;
  isError: boolean;
  raw: unknown;
};
```

### CI 워크플로 (ci.yml)

PR과 main 푸시에서 실행:
1. pnpm 설치 (캐시 사용)
2. `pnpm biome ci .`
3. `pnpm typecheck`
4. `pnpm test`
5. `pnpm build`
- Node 20 / 22 / 24 매트릭스
- changeset 없는 기능 PR에 경고를 남기는 스텝 추가

### release.yml

Changesets 액션으로 main 머지 시 "Version Packages" PR 생성 → 머지되면 npm 배포.
npm 토큰은 시크릿 참조만 해두고, 실제 값은 넣지 마라.

### 루트 스크립트

`build` `test` `typecheck` `lint` `format` `changeset` `release` — 전부 turbo 또는 pnpm 필터로 연결.

### 완료 조건 (이게 안 되면 완료 아님)

1. `pnpm install` 성공
2. `pnpm typecheck` 통과
3. `pnpm build` 통과 — 6개 패키지 전부 `dist/` 생성
4. `pnpm test` 통과 — 각 패키지 최소 1개 테스트
5. `pnpm lint` 통과
6. 순환 의존 없음

### 작업 방식

- 위에 명시하지 않은 의존성을 추가해야 하면 **먼저 물어보고** 진행해라. 임의 추가 금지.
- 버전을 확신할 수 없는 패키지는 추측하지 말고 실제 레지스트리에서 확인해라.
- 끝나면 다음을 보고해라: ① 생성한 파일 목록 ② 내가 지정하지 않아 네가 판단한 결정과 그 이유 ③ 완료 조건 6개의 실행 결과 ④ 사람이 직접 채워야 하는 빈칸 목록

---

## 실행 후 사람이 확인할 것

- [ ] `core/src/types.ts`가 명시한 내용과 정확히 일치하는가 (여기가 틀리면 4명의 작업이 어긋난다)
- [ ] `package.json`의 `exports`·`types` 경로가 실제 빌드 산출물과 맞는가
- [ ] `@modelcontextprotocol/sdk` 버전이 고정(`1.x.y`)되어 있는가 — `^` 붙어 있으면 지운다
- [ ] 기능 로직이 임의로 구현된 곳이 없는가 (`grep -r "not implemented"`로 스텁 확인)
- [ ] CODEOWNERS의 계정명을 실제 GitHub 아이디로 교체했는가
- [ ] `.github/workflows`에 토큰 값이 하드코딩되지 않았는가

## 이어서 던질 후속 요청

뼈대가 통과하면 아래를 각 담당자가 자기 패키지에 대해 개별로 요청한다. 한 번에 다 시키지 않는다.

1. `core`: SDK의 stdio 트랜스포트로 실제 서버에 붙어 `listTools()`가 동작하는 최소 구현
2. `runner`: `createMcpTest` 공개 API와 `toContainTool` matcher 1개, **실패 메시지 출력 포함**
3. `fixtures`: 실제 공개 MCP 서버에서 `tools/list` 응답을 받아 저장 (이후 4명의 개발 재료)
