# 프로젝트 지침

MCP 서버를 코드로 자동 테스트하는 오픈소스 프레임워크. 5인 팀이 패키지별 오너를 나눠 병렬 개발한다.
팀 운영 규칙 전문은 `CONTRIBUTING.md`. 이 파일은 그중 **매 세션 지켜야 할 것**만 담는다.

## 절대 하지 말 것

- **다른 오너의 패키지를 수정하지 마라.** 패키지마다 담당자가 다르고, 커밋이 섞이면 기여 이력을 증명할 수 없다. 다른 패키지 수정이 필요하면 멈추고 사용자에게 알려라.
- **`core/src/types.ts`의 `McpClient` / `ToolResult` 인터페이스를 바꾸지 마라.** 5명의 병렬 작업 기준점이라 여기가 바뀌면 전원이 깨진다. 변경이 필요해 보이면 제안만 하고 진행하지 마라.
- **`@modelcontextprotocol/sdk` 버전을 올리지 마라.** 1.x로 고정돼 있다. 분리 패키지 구조의 2.0이 개발 중이라 자동 업그레이드되면 `core`가 통째로 깨진다. `^` 붙이지 마라.
- **목록에 없는 의존성을 임의로 추가하지 마라.** 추가가 필요하면 용도와 라이선스를 먼저 물어봐라. GPL·AGPL 계열은 런타임 의존성으로 금지(MIT 프로젝트라 충돌).
- **커밋·푸시는 사람이 한다.** 요청받지 않은 git 명령을 실행하지 마라.

## 이 프로젝트의 특이사항

- **실패 메시지가 곧 제품이다.** 테스트 도구의 UI는 실패했을 때 터미널에 찍히는 문장이다. `expected true, got false` 수준으로 만들지 마라. 무엇이 왜 다른지, 어떻게 고치는지가 보여야 한다.
  ```
  → 응답에 'temp' 필드가 없습니다. 발견된 필드: 'temperature'
  → 스키마 변경이 의도된 것이라면 테스트를 업데이트하세요.
  ```
- **결정론성이 핵심 가치다.** 같은 입력에 항상 같은 결과가 나와야 한다. 타임스탬프·랜덤값·실행 순서에 의존하는 코드를 넣지 마라. 녹화·재생 기능의 존재 이유가 이것이다.
- **우리 도구로 우리를 검증한다.** `examples/`의 예제 서버에 이 도구를 적용하는 E2E가 CI에 있다. 이게 깨지면 사용자에게도 깨진 것이다.
- 의존 방향은 단방향이다: `dashboard` → `cli` → `runner`/`generate`/`record`/`mock` → `core`.
  역방향 참조나 순환을 만들지 마라. `dashboard` 층은 ADR-0046 이 얹은 것이다.

## 작업 방식

- 한 번에 한 패키지만 작업한다. 여러 패키지를 동시에 고치는 제안은 하지 마라.
- 확신 없는 버전·API는 추측하지 말고 실제로 확인해라.
- 작업 후 무엇을 바꿨고, 내가 임의로 판단한 부분이 무엇인지 보고해라.

## 커밋 메시지

Conventional Commits, scope 필수. 나중에 `git log --grep "(record)"`로 개인 기여를 뽑아야 한다.

```
feat(runner): toMatchSchema matcher 추가
fix(core): 서버 종료 시 좀비 프로세스 잔존 문제 해결
```

`type`: feat / fix / docs / test / refactor / chore / ci
`scope`: core / runner / generate / record / mock / cli / dashboard / release / adr

`release` 는 npm 배포·릴리스 워크플로·버저닝, `adr` 는 여러 패키지에 걸친 설계 결정 기록.
둘 다 소유 패키지가 없는 작업이라 패키지 scope 로는 집계되지 않는다.

## PR 생성

- PR 생성시 **먼저 템플릿이 있는지 확인하고** 템플릿이 있다면 반드시 그 템플릿을 지켜서 PR을 생성한다.

## 리뷰 코멘트는 그 스레드 안에서 답한다

`main` 보호 설정에 `required_conversation_resolution` 이 켜져 있다. **리뷰 스레드가 하나라도
미해결이면 CI 가 전부 녹색이어도 머지가 막힌다.** 이때 `mergeStateStatus` 는 `BLOCKED` 로만
나오고 이유를 말해 주지 않아서, 사람 승인이 없어서라고 오진하기 쉽다. 이 저장소는
`required_pull_request_reviews` 를 안 쓰므로 승인은 처음부터 필요 없다.

- 지적을 받아 고쳤으면 봇이 스레드를 자동으로 닫는다. 따로 할 일이 없다.
- **지적을 안 받을 때가 문제다.** 사유를 PR 본문이나 새 코멘트에 적으면 스레드는 그대로 열려
  있다. 반드시 **그 스레드 안에 답글**을 달고 스레드를 해제해야 한다.

```sh
# 미해결 스레드 찾기
gh api graphql -f query='{repository(owner:"<owner>",name:"<repo>"){pullRequest(number:<N>){
  reviewThreads(first:30){nodes{id isResolved path comments(first:1){nodes{databaseId}}}}}}}' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false)'

# 그 스레드 안에 답글 (databaseId 는 스레드 첫 코멘트의 것)
gh api repos/<owner>/<repo>/pulls/<N>/comments/<databaseId>/replies -f body='...'

# 해제 (id 는 PRRT_ 로 시작하는 threadId)
gh api graphql -f query='mutation{resolveReviewThread(input:{threadId:"<id>"}){thread{isResolved}}}'
```

막힌 이유를 추측하지 말고 보호 설정을 먼저 읽어라.

```sh
gh api repos/<owner>/<repo>/branches/main/protection
```

## 설계 결정은 기록한다

"다르게 갈 수도 있었던" 판단을 했다면 `docs/adr/`에 ADR 초안을 만들어라. 배경 / 선택지 / 결정 / 이유 / 결과 다섯 항목, 한 페이지면 충분하다. 단순 구현은 대상이 아니다.
