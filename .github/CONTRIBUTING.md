# MCPeak에 기여하기

MCPeak에 관심을 가져 주셔서 고맙습니다. 이 문서는 팀 밖에서 처음 기여하시는 분을 위한 안내입니다.
이 문서만 읽으면 기여할 수 있도록 썼습니다.

> **English.** Issues and pull requests in English are welcome. Small fixes (bugs, docs, examples)
> can go straight to a PR. For new features or anything listed under "이슈를 먼저 열어 주세요",
> please open an issue first. Security problems go to [SECURITY.md](../SECURITY.md), not public issues.
> English docs: https://2026-engineering-contest.github.io/MCPeak/

## 무엇부터 하면 좋을까요?

- **처음이라면** [`good first issue`](https://github.com/2026-Engineering-Contest/MCPeak/labels/good%20first%20issue)
  라벨이 붙은 이슈를 골라 보세요. 한두 파일 안에서 끝나는 일들입니다.
- **버그를 찾았다면** 이슈를 열어 주세요. 터미널에 나온 메시지를 그대로 붙여 주시면 원인을 찾기 쉽습니다.
- **내 MCP 서버에서 MCPeak가 잘 안 된다면** 그것도 이슈로 알려 주세요. 저희가 가장 알고 싶은 내용입니다.
- **보안 문제라면** 이슈로 올리지 말고 [SECURITY.md](../SECURITY.md)의 방법으로 알려 주세요.

## 이슈를 먼저 열어 주세요

버그 수정, 문서, 예제는 바로 PR을 올리셔도 됩니다. 아래 변경은 PR 전에 이슈에서 먼저 이야기해 주세요.
여러 패키지가 기대고 있는 부분이라, PR을 다 만든 뒤에 방향이 바뀌면 작업이 아깝기 때문입니다.

- 새 기능이나 CLI 옵션을 추가하거나 바꾸는 경우
- 새 의존성을 추가하는 경우. MIT 프로젝트라서 GPL, AGPL 라이선스 패키지는 넣을 수 없습니다
- `packages/core/src/types.ts`의 `McpClient`, `ToolResult`를 바꾸는 경우
- `@modelcontextprotocol/sdk` 버전을 바꾸는 경우. 지금은 1.x로 고정돼 있습니다
- 녹화 파일 형식을 바꾸는 경우. 이미 녹화된 파일을 못 읽게 될 수 있습니다

## 개발 환경 준비

Node 22.18.0 이상이 필요합니다. pnpm은 corepack으로 켭니다.

```bash
corepack enable
pnpm install
pnpm build
pnpm test
```

PR을 올리기 전에 아래 명령도 통과하는지 확인해 주세요. CI도 같은 검사를 합니다.

```bash
pnpm typecheck
pnpm lint
```

- `pnpm lint`가 포맷 문제로 실패하면 `pnpm format`으로 고칠 수 있습니다. 코드 스타일은 포매터 설정을 따르고,
  리뷰에서 스타일은 따로 지적하지 않습니다.
- Docker나 `uvx`가 없으면 일부 E2E 테스트는 자동으로 건너뜁니다. 그래도 괜찮습니다. CI에서 돌립니다.
- 저장소 안에서 CLI를 직접 실행할 때는 `node packages/cli/dist/cli.mjs`를 쓰세요. 소스를 고쳤다면
  `pnpm build`를 다시 해야 반영됩니다.

## 코드를 쓸 때 지켜 주세요

MCPeak는 MCP 서버를 테스트하는 도구입니다. 그래서 아래 세 가지를 특히 중요하게 봅니다.

**1. 같은 입력에는 항상 같은 결과가 나와야 합니다.**
현재 시각, 랜덤값, 실행 순서에 따라 결과가 달라지는 코드는 받지 않습니다. 테스트 도구의 결과가 매번
다르면 사용자가 믿을 수 없기 때문입니다.

**2. 실패 메시지는 읽는 사람이 바로 고칠 수 있어야 합니다.**
테스트가 실패했을 때 터미널에 나오는 문장이 이 도구의 화면입니다. `expected true, got false`처럼
쓰지 말고, 무엇이 다른지와 어떻게 고치면 되는지를 함께 알려 주세요.

```
→ 응답에 'temp' 필드가 없습니다. 발견된 필드: 'temperature'
→ 스키마 변경이 의도된 것이라면 테스트를 업데이트하세요.
```

**3. 패키지는 아래 계층만 가져다 쓸 수 있습니다.**
`core`가 가장 아래, `dashboard`가 가장 위입니다. 아래 패키지가 위 패키지를 가져다 쓰거나,
두 패키지가 서로를 가져다 쓰면 안 됩니다. 패키지 목록은 [README](../README.md)에 있습니다.

동작을 고치거나 추가했다면 그 동작을 확인하는 테스트도 함께 넣어 주세요.

## PR 올리기

**커밋 메시지**는 아래 형식을 씁니다. 괄호 안에는 고친 패키지 이름을 적습니다.

```
fix(runner): 빈 배열 응답에서 실패 메시지가 비어 있던 문제 수정
docs(cli): test 명령 예시 보완
```

종류는 `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci` 중에서 고릅니다.
형식을 맞추기 어려우면 그냥 올리셔도 됩니다. 외부 PR은 커밋을 하나로 합쳐서(squash) 머지하고,
그때 메인테이너가 제목을 정리합니다.

**changeset**은 릴리스 노트를 만드는 파일입니다. `packages/` 아래를 고쳤다면 `pnpm changeset`을 실행해서
어떤 변경인지 한 줄로 적어 주세요. 없으면 CI가 실패합니다. 어떻게 써야 할지 모르겠다면 PR에 그렇게
남겨 주세요. 메인테이너가 대신 추가할 수 있습니다.

**PR 설명**은 템플릿 항목을 채워 주시면 됩니다. 잘 모르는 칸은 비워 두셔도 괜찮습니다.

**리뷰**는 고친 패키지의 담당자에게 자동으로 요청됩니다. 처음 기여하시는 경우 CI는 메인테이너가
승인한 뒤에 돌기 시작합니다. 일주일이 지나도 답이 없으면 PR에 댓글로 한 번 불러 주세요.

## 라이선스

기여하신 코드는 이 프로젝트와 같은 [MIT 라이선스](../LICENSE)로 배포됩니다. 따로 서명할 문서(CLA)는 없습니다.

## 팀 내부 규칙과의 관계

저장소 루트의 [CONTRIBUTING.md](../CONTRIBUTING.md)는 팀원끼리 지키는 내부 규칙입니다. 외부 기여자는
그 문서를 따르지 않아도 됩니다. 예를 들어 "다른 담당자의 패키지를 고치지 않는다"는 팀원끼리의 규칙이라,
외부 기여자는 어느 패키지에든 PR을 올릴 수 있습니다.
