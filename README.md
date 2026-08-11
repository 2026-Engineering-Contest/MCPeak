# OhMyMCP

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

> ⚠️ **Skeleton / work in progress.** The public API is being frozen (CONTRIBUTING §3).
> Every package currently ships type signatures and `throw new Error("not implemented")`
> stubs only — the owners fill in the logic.

MCP(Model Context Protocol) 서버를 **코드로 자동 테스트**하는 오픈소스 프레임워크.
서버를 띄우고, 응답을 검증하고, 녹화·재생하고, 목 서버로 대체하는 것을 하나의 도구로 한다.

## 설치

> **아직 npm 에 배포되지 않았습니다.** 아래 명령은 첫 알파 배포 이후에 동작합니다.
> 그때까지는 저장소를 클론해 [개발](#개발) 절차를 따르세요.

```bash
npm install -D ohmymcp
# 또는
pnpm add -D ohmymcp
```

## 30초 예제

> **아직 동작하지 않습니다.** 아래는 목표로 하는 API 형태이며, `connect` 와
> `createMcpTest` 는 현재 스텁이라 실행하면 `Error: not implemented` 가 납니다.

```ts
import { createMcpTest, toContainTool } from "@ohmymcp/runner";
import { connect } from "@ohmymcp/core";

createMcpTest({ client: await connect({ command: "node", args: ["./server.js"] }) }, (t) => {
  // matcher · runner API 는 각 오너가 구현 중입니다.
});
```

## 기존 도구와의 차이

- **실패 메시지가 곧 제품이다.** `expected true, got false`가 아니라 *무엇이 왜 다른지*를 출력한다.
- **결정론적.** 같은 입력 → 같은 결과. 녹화·재생으로 네트워크 없이 재현한다.
- **스키마 → 테스트 자동 생성.** 툴 스키마에서 테스트 케이스를 합성한다.

## 패키지

| 패키지 | 역할 |
|---|---|
| [`@ohmymcp/core`](./packages/core) | 트랜스포트 · 프로세스 수명주기 · 핸드셰이크 |
| [`@ohmymcp/runner`](./packages/runner) | `createMcpTest` · matcher · 리포터 |
| [`@ohmymcp/generate`](./packages/generate) | 스키마 → 테스트 코드 생성 |
| [`@ohmymcp/record`](./packages/record) | 녹화 · 재생 · 계약 스냅샷 |
| [`@ohmymcp/mock`](./packages/mock) | 목 서버 · 가짜 데이터 |
| [`ohmymcp`](./packages/cli) | CLI 진입점 |

## 개발

```bash
corepack enable       # pnpm 활성화 (packageManager 핀 사용)
pnpm install
pnpm build            # 6개 패키지 dist/ 생성
pnpm typecheck
pnpm test
pnpm lint
```

기여 규칙은 [CONTRIBUTING.md](./CONTRIBUTING.md)를 먼저 읽으세요.

## 라이선스

[MIT](./LICENSE)
