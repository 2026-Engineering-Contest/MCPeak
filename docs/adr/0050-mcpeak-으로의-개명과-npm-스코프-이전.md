# ADR-0050: 제품명을 MCPeak 으로 바꾸고 npm 스코프를 `@mcpeak` 으로 옮긴다

- 상태: 채택
- 날짜: 2026-08-20
- 담당: 전 패키지 (core · runner · generate · record · mock · dashboard · cli)
- 작성자: @storyrago (③ mock server 파트 · 릴리스 담당)
- 승인: **이 결정을 실행하는 PR 의 리뷰로 갈음한다.** ADR 과 구현이 한 PR 에 함께 있고,
  CODEOWNERS 가 지정하는 리뷰어(`core`·`runner`·`generate` 오너와 `cli` 공동 오너)가
  ADR 본문과 치환 결과를 같이 본다. 그 승인이 이 ADR 의 승인이다.
  [ADR-0044](./0044-npm-스코프-선점에-따른-패키지-개명.md) 가 PR #173 머지를 승인 이력으로
  삼은 것과 같은 방식이다. 코드 동결(2026-08-24)까지 남은 시간을 고려해 별도 승인 라운드를
  두지 않는다.
- 참조: [ADR-0044](./0044-npm-스코프-선점에-따른-패키지-개명.md),
  `CONTRIBUTING.md` §일정 (코드 동결 2026-08-24),
  `docs/architecture.md`,
  `.github/workflows/release.yml`

## 배경

팀이 제품명을 **MCPeak** 으로 정했다. 저장소와 발표 자료는 문서만 고치면 되지만 npm 은
그렇지 않다. [ADR-0044](./0044-npm-스코프-선점에-따른-패키지-개명.md) 로 확보한
`@ohmymcp-hsu` 스코프에 **여섯 패키지가 이미 발행돼 있다**(2026-08-19).

| 패키지 | 버전 | 상태 |
|---|---|---|
| `@ohmymcp-hsu/core` | 0.3.0 | 발행됨 |
| `@ohmymcp-hsu/runner` | 0.8.0 | 발행됨 |
| `@ohmymcp-hsu/generate` | 0.5.0 | 발행됨 |
| `@ohmymcp-hsu/record` | 0.1.2 | 발행됨 |
| `@ohmymcp-hsu/mock` | 0.2.0 | 발행됨 |
| `@ohmymcp-hsu/dashboard` | 0.1.1 | 발행됨 |
| `ohmymcp` (CLI) | — | **미발행 (404)** |

ADR-0044 는 개명 비용이 "첫 발행 전까지만" 감당 가능하다고 적었다. 그 조건은 이미 지났다.
그런데도 지금 개명하는 이유는 제품명이 바뀌었기 때문이고, 이 문서는 그 판단과 비용을 고정한다.

### 이름 확보 상황 (2026-08-20 확인)

원래 후보였던 `@mymcp` 는 **조직 생성이 거부됐다**("This name is unavailable"). 무스코프
`mymcp` 도 `my-mcp`(2025-03-14, `yudi455`)와 구두점 제거 후 같은 문자열이 되어 npm 의 유사
이름 차단에 걸릴 위험이 있었다.

`mcpeak` 은 조직 생성에 성공했다.

```
@mcpeak                 조직 생성 완료 (소유자 storyrago, Free 플랜)
mcpeak                  무스코프 404
mc-peak · mc_peak · mcpeaks   전부 404
```

**무스코프 404 를 가용으로 읽지 않는다.** 이 프로젝트는 그 오판을 이미 두 번 했다.

- `@ohmymcp` — 스코프가 선점돼 있었다 (ADR-0044)
- `ohmymcp` — 404 를 보고 가용으로 판단했으나 발행에서 거부됐다

```
E403 Forbidden - PUT https://registry.npmjs.org/ohmymcp
Package name too similar to existing package oh-my-mcp
```

npm 은 발행 시점에 기존 이름과의 유사도를 따로 검사하고, **이 검사는 미리 조회할 방법이
없다.** 구두점을 제거하면 `oh-my-mcp` 와 `ohmymcp` 가 같은 문자열이 된다. 같은 조사에서
`oh-my-mcp` 가 200 인 것을 보고도 신호로 읽지 못했다.

`mcpeak` 은 `mc-peak`·`mc_peak`·`mcpeaks` 가 모두 비어 있어 지금은 충돌 후보가 안 보이지만,
**보이지 않는 것과 없는 것은 다르다.** 따라서 CLI 도 스코프 안에 둔다 — **스코프 안의
이름은 유사 검사를 받지 않는다.**

### 지금 발견된 결함 하나

개명과 별개로 **`@ohmymcp-hsu/dashboard@0.1.1` 은 지금 설치가 불가능하다.**

```
$ npm install @ohmymcp-hsu/dashboard
npm error 404 Not Found - GET https://registry.npmjs.org/ohmymcp
npm error 404  'ohmymcp@0.8.0' could not be found
```

dashboard 가 `ohmymcp@0.8.0` 을 런타임 의존성으로 선언했는데 그 패키지는 발행된 적이 없다.
개명하든 안 하든 CLI 를 발행해야 풀린다.

## 선택지

**A안: 스코프까지 개명한다.** `@mcpeak/*` + 무스코프 `mcpeak`. 288 파일을 고치고 일곱
패키지를 새 이름으로 발행한 뒤 옛 여섯을 정리한다.

**B안: `bin` 이름만 바꾼다.** npm 주소는 `@ohmymcp-hsu/*` 로 두고 사용자가 치는 명령만
`mcpeak`·`mcpeak-mock`·`mcpeak-dashboard` 로 바꾼다. `package.json` 세 줄과 문서 약 81 파일.
`import` 문은 한 줄도 안 바뀌고 재발행 리스크가 없다.

**C안: 개명하지 않는다.** 제품명만 MCPeak 으로 부르고 npm 은 그대로 둔다.

### 옛 이름 처리 (A안을 택할 때)

- **D안: unpublish.** 의존 역순으로 지운다. 레지스트리에서 완전히 사라진다. 되돌릴 수 없다.
- **E안: deprecate.** 설치 시 새 이름을 가리키는 경고가 붙고 패키지는 남는다.

unpublish 조건을 실제로 확인했다. 발행 후 72시간이 지나면 **불가능해지는 것이 아니라
조건이 붙는다.**

| 조건 | 우리 상태 (2026-08-20) |
|---|---|
| 그 버전에 의존하는 패키지가 없을 것 | 서로 물려 있으나 **역순으로 지우면 해소** |
| 최근 1주 다운로드 300 미만 | core 124 · runner 86 · generate 78 · record 73 · mock 65 · dashboard 61 — **전부 미달** |
| 오너 1명 | `storyrago` 단독 |

**셋 다 만족하므로 72시간 창(2026-08-22 경)을 넘겨도 지울 수 있다.** 초안은 이 창을
마감으로 잡고 D안을 배제했으나, 그 전제가 틀렸다.

## 결정

**A안 + D안을 택한다.**

### 이름 대응표

| 지금 | 바뀐 뒤 |
|---|---|
| `@ohmymcp-hsu/core` | `@mcpeak/core` |
| `@ohmymcp-hsu/runner` | `@mcpeak/runner` |
| `@ohmymcp-hsu/generate` | `@mcpeak/generate` |
| `@ohmymcp-hsu/record` | `@mcpeak/record` |
| `@ohmymcp-hsu/mock` | `@mcpeak/mock` |
| `@ohmymcp-hsu/dashboard` | `@mcpeak/dashboard` |
| `ohmymcp` (CLI) | **`@mcpeak/cli`** (무스코프로 두지 않는다) |

`bin` 과 서브패스도 함께 바뀐다. **`bin` 은 레지스트리 유사 검사를 받지 않으므로 사용자가
치는 명령은 짧게 유지한다.**

```
name  ohmymcp            → @mcpeak/cli
bin   ohmymcp            → mcpeak
bin   ohmymcp-mock       → mcpeak-mock
bin   ohmymcp-dashboard  → mcpeak-dashboard
서브패스 ohmymcp/commands → @mcpeak/cli/commands
```

```bash
npm i -g @mcpeak/cli
mcpeak test suite.json        # ← 설치 줄만 스코프고, 매일 치는 명령은 짧다
```

### 기계적 치환에서 **제외**하는 문자열

`ohmymcp` 는 패키지 이름 밖에도 박혀 있다. 전량 치환하면 안 된다.

| 위치 | 문자열 | 처리 |
|---|---|---|
| `packages/runner/src/spec/json-schema.ts:13` | `$id: "https://ohmymcp.dev/schemas/test-suite/v1.json"` | **별도 판단.** 아래 참조 |
| `packages/generate/src/violation-cases.ts:45` | `__ohmymcp_invalid_enum__` | **별도 판단.** 아래 참조 |
| `packages/mock/src/index.ts:26` | `Symbol.for("ohmymcp.mock.any")` | 치환한다. 한 패키지 안에서만 쓰이므로 무해 |
| `packages/generate/src/provider-process.ts:120` | `mkdtemp` 접두어 `ohmymcp-provider-` | 치환한다. 임시 디렉터리 표시용 |
| `packages/dashboard/src/server/routes.ts:338` | `mkdtemp` 접두어 `ohmymcp-dashboard-cassette-` | 치환한다 |
| `packages/cli/src/generate-command.ts:445` | 임시 파일명 `.<basename>.ohmymcp.<pid>.tmp` | 치환한다 |
| `docs/adr/*.md` | 옛 이름 전반 | **치환하지 않는다.** 기록물이다. 이 ADR 이 대응표다 |

**`$id` 도메인은 그냥 바꾸면 안 된다.**

```
ohmymcp.dev   DNS 없음 — 우리 소유가 아니고 아무도 안 쓴다. 지어낸 식별자다
mcpeak.dev    DNS 없음 — 마찬가지다. 바꿔도 여전히 소유하지 않은 도메인이다
```

JSON Schema 의 `$id` 는 공개 식별자다. 소유하지 않은 도메인을 가리키게 두면 나중에 그
도메인의 주인이 다른 스키마를 올렸을 때 충돌한다. `runner` 오너가 셋 중 하나를 정한다 —
도메인을 실제로 확보하거나, 저장소 URL 로 바꾸거나, 현재 값을 그대로 둔다.

**`__ohmymcp_invalid_enum__` 은 승인 지문을 바꾼다.**

이 문자열은 `generate` 가 만든 suite 파일 안에 그대로 들어간다. 바꾸면 suite 내용이 달라져
`suiteFingerprint` 가 바뀌고, 기존 suite 를 쓰던 사용자는 재승인해야 한다. 기능은 깨지지
않는다(`runner` 는 이 값을 특별 취급하지 않고 문자열 그대로 서버에 보낸다). `generate`
오너가 정한다.

### 발행 순서

의존 역순이라 선택의 여지가 없다.

```
1. @mcpeak/core
2. @mcpeak/runner · @mcpeak/record · @mcpeak/mock
3. @mcpeak/generate
4. @mcpeak/cli           ← 이번에 반드시 발행한다
5. @mcpeak/dashboard
```

**4번을 빠뜨리면 5번이 지금과 똑같이 E404 로 죽는다.** 검증은 `npm install @mcpeak/dashboard`
가 통과하는지로 한다.

### 발행에서 이미 밟은 함정 (2026-08-19 실측)

리허설(`pnpm pack` → 설치 → 실행)로는 **하나도 재현되지 않는다.** 전부 레지스트리가 받을
때 판정하는 것이다.

| 오류 | 원인 | 상태 |
|---|---|---|
| `EOTP` | 토큰에 2FA 우회가 꺼져 있었다 | 토큰 재발급 시 `Bypass two-factor authentication` 체크 |
| `E422` | provenance 가 `repository.url` 을 검증한다 | PR #191 로 7 패키지에 `repository` 추가됨. **개명 시 URL 도 따라 고친다** |
| `E403` | 무스코프 이름의 유사 검사 | 위 「이름 확보 상황」 참조. 스코프 안에 두어 회피 |

### 옛 이름은 지운다

**새 이름 발행이 검증된 뒤에** 의존 역순으로 지운다. 순서를 뒤집으면 옛 것도 없고 새 것도
아직 없는 구간이 생긴다.

```bash
# 1) @mcpeak/* 발행  2) npm i -g @mcpeak/dashboard 로 검증  3) 그 다음 아래
npm unpublish @ohmymcp-hsu/dashboard --force
npm unpublish @ohmymcp-hsu/generate  --force
npm unpublish @ohmymcp-hsu/runner    --force
npm unpublish @ohmymcp-hsu/record    --force
npm unpublish @ohmymcp-hsu/mock      --force
npm unpublish @ohmymcp-hsu/core      --force
```

`ohmymcp-hsu` 조직 자체는 빈 채로 남긴다. `ohmymcp-dev` 와 같은 상태가 되며 무해하다.

## 이유

**B안을 버린 이유는 제품명이 바뀌었기 때문이다.** `bin` 만 바꾸면 사용자가 치는 명령은
`mcpeak` 이 되지만 `npm install @ohmymcp-hsu/mock` 은 남는다. 이름을 바꾼 이유가 제품
정체성이라면 설치 줄에 옛 이름이 남는 것은 목표를 절반만 달성하는 것이다.

다만 **B안은 진짜 후퇴선이다.** 코드 동결(2026-08-24)까지 A안이 안 끝날 것 같으면 B안으로
내려와야 한다. `package.json` 세 줄이라 언제든 갈아탈 수 있고, 사용자 체감은 A안과 같다.
그 판단 시점은 아래 「결과」에 적는다.

**`@mymcp` 대신 `@mcpeak` 인 것은 선택이 아니라 결과다.** `@mymcp` 는 조직 생성이 거부됐다.
이름을 다시 고른 것이 아니라 고를 수 있는 것 중에서 정해졌다.

**E안(deprecate) 대신 D안(unpublish)인 이유는 보호할 사용자가 없기 때문이다.** 옛 이름을
남기고 새 이름을 가리키게 하는 것은 개명의 표준 관행이지만, 그 관행은 **이미 그 패키지를
설치해 쓰고 있는 사람을 깨뜨리지 않으려고** 있다. 발행 하루 뒤이고 주간 다운로드가 61~124
(대부분 미러·스캐너로 보인다)인 상태에서는 깨질 사용자가 없다. 규범만 남고 목적이 없다.

반대편에는 실질적인 이득이 있다. npm 에서 이 프로젝트를 찾는 사람에게 보이는 것이
`@mcpeak/*` 일곱 개냐, 그 위에 버려진 조직의 deprecated 여섯 개가 더 붙은 열세 개냐가
갈린다. 후자는 정리가 안 된 것으로 읽힌다.

**되돌릴 수 없다는 비용은 인정하고 받는다.** `이름@버전` 은 재사용할 수 없으므로, B안으로
후퇴하면서 `@ohmymcp-hsu/*` 를 되살려야 하면 버전을 올려서 다시 올려야 한다. 막히지는
않는다. 이 비용을 감수할 수 있는 것은 삭제를 **새 이름 발행이 검증된 뒤에만** 하기
때문이다 — 그 순서를 지키면 아무것도 없는 구간이 생기지 않는다.

**조직을 세 번째로 만들었다는 사실을 기록해 둔다.** `ohmymcp-dev`(2026-08-17) →
`ohmymcp-hsu`(2026-08-18) → `mcpeak`(2026-08-20). npm 은 조직 개명 기능이 없어서 이름을
바꾸려면 매번 새로 만들어야 한다. 앞의 둘은 그대로 남는다 — 위 삭제를 마치면 `ohmymcp-hsu`
도 `ohmymcp-dev` 와 같이 패키지가 하나도 없는 빈 조직이 되므로 무해하다.

## 결과

**얻는 것**

- npm 주소와 제품명이 일치한다. `-hsu` 접미사도 떨어진다.
- 무스코프 `mcpeak` 이 가용이라 CLI 설치가 `npm i -g mcpeak` 로 짧게 끝난다.
- CLI 를 처음으로 발행하게 되므로 `dashboard` 의 E404 결함이 함께 해소된다.

**받아들이는 비용**

- **288 파일** 치환. 일곱 패키지 전부를 건드리므로 **오너 전원의 합의와 협조**가 필요하다
  (CLAUDE.md "다른 오너의 패키지를 수정하지 마라").
- `@ohmymcp-hsu/*` 여섯을 지우면 그 `이름@버전` 은 영구히 재사용할 수 없다. B안으로
  후퇴하면서 되살려야 하면 버전을 올려야 한다.
- `.changeset/*.md` 4 개가 패키지명을 담고 있어 함께 바꿔야 changesets 가 깨지지 않는다.
- `.github/workflows/ci.yml:138` 의 `pnpm --filter ohmymcp test:e2e` 도 따라 바뀐다.

**순서 제약 — ADR-0044 에서 밟은 것**

> **개명과 버전 PR 은 순서를 정하는 문제가 아니라, 개명 후 버전 PR 을 반드시 재생성해야
> 하는 문제다.** 봇이 만든 브랜치는 개명을 따라오지 않는다.

지난번 #112 가 이것으로 죽었다. 개명을 머지한 뒤 changesets 봇 브랜치를 폐기하고 `main`
기준으로 버전 PR 을 새로 만들게 한다.

**미머지 브랜치와 겹친다**

`fix/cli-package-name` (2026-08-19, main 미머지)이 같은 문제의 앞부분을 이미 고쳐 뒀다 —
CLI 를 `@ohmymcp-hsu/cli` 로 옮기고 `ohmymcp/commands` 서브패스 참조를 따라 옮긴 두 커밋이다.
건드린 파일 9 개가 이 개명의 대상과 전부 겹친다.

```
packages/cli/package.json          packages/dashboard/package.json
packages/cli/src/commands.ts       packages/dashboard/src/server/wiring.ts
tsconfig.base.json                 packages/dashboard/src/server/review-bridge.ts
vitest.config.ts                   packages/dashboard/tests/scaffold.test.ts
pnpm-lock.yaml
```

**둘 중 하나를 먼저 정한다.** 그 브랜치를 머지하고 그 위에서 개명하거나, 폐기하고 개명이
그 내용을 흡수하거나. 방치하면 리베이스에서 9 파일 전부 충돌한다.

**후퇴 판단 시점**

**2026-08-22 까지 개명 PR 이 머지되지 않으면 B안으로 내려간다.** 동결(8/24)까지 이틀이
남아야 재발행과 검증을 할 수 있다. 이 날짜를 넘기면 A안은 동결일에 깨진 상태를 남길
위험이 크고, 그때는 `bin` 세 줄만 바꾸는 편이 낫다.

**후속 과제**

- `README.md` 의 "배포 전이라 실행 파일이 `PATH` 에 없습니다" 는 이미 사실이 아니다
  (여섯 패키지가 2026-08-19 에 발행됐다). 개명 여부와 무관하게 고친다.
- `docs/architecture.md:22` 가 `ohmymcp record` 서브커맨드를 그리고 있으나 그 명령은
  미구현이고 [ADR-0028](./0028-replay-서브커맨드의-서버-없는-실행.md) 이 "열지 않는다" 로
  결정했다. 개명 작업 중에 함께 바로잡는다.
