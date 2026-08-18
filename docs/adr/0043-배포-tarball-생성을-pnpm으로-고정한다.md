# ADR-0043: 배포 tarball 생성을 pnpm 으로 고정하고 워크플로에서 검사한다

- 상태: 채택
- 날짜: 2026-08-17 (채택: 2026-08-19, Asia/Seoul)
- 작성자: @storyrago (③ mock server 파트 · 릴리스 담당)
- 승인 이력: PR #171 머지로 발효한다. 게이트 구현이 같은 PR 에 들어 있으므로 머지 =
  이 결정의 채택이다. 머지 전에는 `제안` 으로 읽는다.

## 배경

여섯 패키지 중 다섯이 `workspace:*` 로 서로를 참조한다.

```
ohmymcp            → @ohmymcp/{core,runner,generate,record,mock}
@ohmymcp/generate  → @ohmymcp/{core,runner}
@ohmymcp/mock      → @ohmymcp/core
@ohmymcp/record    → @ohmymcp/core
@ohmymcp/runner    → @ohmymcp/core
```

`workspace:*` 는 pnpm 의 프로토콜이고 npm 레지스트리는 이 문법을 모른다. 배포 시점에
실제 버전 번호로 치환되지 않으면 설치할 수 없는 패키지가 올라간다.

배포 리허설에서 두 도구의 동작이 갈리는 것을 확인했다.

| 도구 | tarball 안의 `dependencies` |
|---|---|
| `pnpm pack` | `"@ohmymcp/core": "0.2.0"` — 치환됨 |
| `npm pack` | `"@ohmymcp/core": "workspace:*"` — **치환 안 됨** |

`npm pack` 은 루트 `LICENSE` 도 각 패키지에 복사하지 않는다 (`@ohmymcp/core` 기준
pnpm 7 파일 vs npm 6 파일).

실패했을 때의 비용이 비대칭이다. `workspace:*` 가 남은 채로 발행되면 그 버전은 아무도
설치할 수 없고, npm 정책상 **72시간이 지나면 unpublish 가 막혀** 그 이름·버전이 영구히
죽는다. 되돌릴 수 없는 실수인데 실행 시점에는 아무 경고도 없다.

현재 배포 경로는 `changesets/action@v1` → `pnpm release` → `changeset publish` 다.
`@changesets/cli` 소스(`changesets-cli.cjs.js:885,904`)를 확인한 결과 `getPublishTool()`
이 pnpm 을 감지하면 `pnpm publish` 를 실행한다. 즉 **현재는 안전하다.** 다만 그 안전이
전적으로 "changesets 의 패키지 매니저 감지가 맞는다"는 런타임 추론 하나에 걸려 있다.
락파일이 빠지거나, PATH 에 `pnpm` 이 없거나, 상위 버전에서 감지 로직이 바뀌면 조용히
npm 으로 넘어간다.

## 선택지

- **A안: 아무것도 하지 않는다.** changesets 의 감지를 신뢰한다. 실제로 지금 동작한다.
- **B안: 문서로만 남긴다.** CONTRIBUTING 에 "배포는 반드시 pnpm 으로" 를 적는다.
- **C안: `packageManager` 필드와 CI 설정으로 pnpm 을 강제한다.** 이미 루트 package.json 에
  `"packageManager": "pnpm@10.34.5"` 가 있다. 여기에 의존한다.
- **D안: 실제 tarball 을 만들어 내용물을 검사하는 게이트를 배포 전에 둔다.** 도구가
  무엇이든 결과물을 직접 본다.

## 결정

**D안을 택한다.** `release.yml` 의 changesets 스텝 **앞에** 게이트 스텝을 둔다.
`packages/*/` 를 `pnpm pack` 으로 각각 포장하고, 각 tarball 안의 `package.json` 에
`"workspace:` 문자열이 남아 있으면 배포를 중단한다.

검사한 tarball 개수도 함께 확인한다. 0 건은 "깨끗함"이 아니라 "검사를 안 했음"이므로
개수가 0 이면 실패로 처리한다.

C안(`packageManager` 필드)은 이미 있으므로 유지하되, 그것만으로 충분하다고 보지 않는다.

## 이유

**추론이 아니라 결과물을 검사하기 때문이다.** A·B·C 는 전부 "이러이러하므로 pnpm 이
쓰일 것이다" 라는 추론이다. 추론의 전제가 깨지면 아무도 모르는 채로 통과한다. D 는
실제로 발행될 것과 같은 방법으로 만든 tarball 을 열어본다. 감지 로직이 바뀌든 락파일이
빠지든, 결과물에 `workspace:` 가 있으면 걸린다.

**실패 비용이 비대칭이라 게이트 값이 싸다.** 게이트는 6 개 패키지를 포장하는 몇 초짜리
스텝이고, 못 막았을 때의 대가는 되돌릴 수 없는 이름·버전 손실이다. 이 정도 비대칭에서는
중복으로 보이는 검사도 값어치가 있다.

**게이트를 배포 스텝 앞에 두는 이유.** `changeset publish` 는 포장과 발행을 한 번에
하므로 그 사이에 끼어들 수 없다. 앞에서 같은 내용을 미리 포장해 검사하는 것이 유일하게
가능한 지점이다. 그 대가로 포장을 두 번 하지만, 몇 초다.

**검사 대상을 `package.json` 문자열로 좁힌 이유.** tarball 전체를 grep 하면 `dist/` 안의
번들된 소스 문자열에도 걸려 거짓 양성이 난다. 실제 위험은 매니페스트의 의존 범위
표기 하나뿐이므로 거기만 본다.

**건수를 따로 세는 이유.** `for` 루프가 아무것도 못 돌아도 `bad=0` 이라 통과한다.
"결함 0 건" 과 "검사 0 건" 이 같은 출력으로 보이는 것은 이 저장소에서 이미 여러 번
사람을 속인 패턴이라, 검사 대상 개수를 명시적으로 확인하고 출력한다.

## 결과

**얻은 것**

- 배포 안전이 changesets 의 내부 동작 추론이 아니라 **결과물 검사**에 걸린다.
- 실패가 배포 **전에**, 되돌릴 수 있는 시점에 난다.
- 실패 메시지가 어느 패키지의 몇 번째 줄인지 지목한다 (`38: "@ohmymcp/core": "workspace:*"`).

**받아들인 비용**

- 배포 워크플로가 포장을 두 번 한다 (게이트 1회 + `changeset publish` 1회).
- 게이트가 잡는 것은 **형식 오류**뿐이다. "낼 생각이 없던 버전을 냈다" 는 못 잡는다.
  changesets 액션은 대기 중인 changeset 이 없으면 미배포분을 발행하므로, 버전 PR 머지
  외의 경로로 `main` 을 건드리면 의도치 않은 발행이 일어날 수 있다. 이건 게이트의
  범위 밖이고 운영 규약(§7)으로 다룬다.

**검증**

리허설에서 양방향으로 확인했다.

- 정상 경로(`pnpm pack`): `tarball 6 개 검사 완료 — workspace: 잔존 없음`, exit 0
- 결함 주입(`pnpm pack` → `npm pack` 으로 치환): 5/6 패키지를 지목하고 exit 1
  (`@ohmymcp/core` 만 통과 — workspace 의존이 없는 유일한 패키지라 정상이다)

**후속 과제**

- npm 이 `workspace:` 를 이해하게 되거나 changesets 가 도구를 명시적으로 고정하는 옵션을
  제공하면 이 게이트의 필요성을 다시 검토한다.
