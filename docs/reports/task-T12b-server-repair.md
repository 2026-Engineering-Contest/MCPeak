# T12b CHANGELOG 를 changeset 으로 옮기기 보고서

status: READY_FOR_REVIEW

## 요약

T12 에서 CHANGELOG 두 개에 직접 쓴 `## Unreleased` 절을 지우고, 같은 내용을
`.changeset/server-repair.md` 하나로 옮겼다. 두 CHANGELOG 는 이 작업 이전 상태로 정확히
돌아갔다. 검증 셋 전부 초록이다.

## 바꾼 파일

- 수정: `packages/cli/CHANGELOG.md` (내가 추가했던 `## Unreleased` 절 삭제. 그 아래 기존 내용
  변경 0건)
- 수정: `packages/generate/CHANGELOG.md` (같음)
- 생성: `.changeset/server-repair.md`
- 생성: `docs/reports/task-T12b-server-repair.md` (이 파일)

목록 밖 파일 수정 0건. 코드 변경 0건. 의존성 추가 0건. git 명령 0건.

두 CHANGELOG 의 첫 줄이 각각 `# ohmymcp` → `## 0.7.0`, `# @ohmymcp-hsu/generate` → `## 0.4.2` 로
돌아온 것을 확인했다. 도구가 만든 버전 절만 남는다.

## 검증

`pnpm test`

```
 Test Files  68 passed (68)
      Tests  1411 passed | 1 skipped (1412)
```

`pnpm typecheck --force`

```
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
```

`pnpm lint`

```
Checked 183 files in 56ms. No fixes applied.
```

## 버전 등급 판단

**두 패키지 모두 `minor` 다.**

- `@ohmymcp-hsu/generate`: export 가 늘었다. 함수 넷, 상수 넷, 타입 열하나다. 기존 authoring API 의
  시그니처와 동작은 그대로다. `makeProvider` 반환 객체에 `diagnose` 가 **추가**됐을 뿐 기존
  `author` 는 안 바뀌었다. 추가만 있고 제거·변경이 없으므로 `major` 가 아니다. 공개 표면이
  늘었으므로 `patch` 도 아니다.
- `ohmymcp`(cli): 새 명령 `repair` 와 새 옵션 `--repair-bundle` 이 늘었다. `--repair-bundle` 을
  주지 않은 `test` 실행의 stdout · stderr · 종료 코드는 이전과 바이트 단위로 같다(테스트가
  고정한다). 사용자가 보던 동작이 바뀌지 않았으므로 `major` 가 아니다.

기존 `.changeset/mock-key-normalization.md` 도 새 동작 추가에 `minor` 를 썼다. 같은 기준이다.

## 임의로 판단한 지점

- **changeset 을 하나로 묶었다.** frontmatter 에 두 패키지를 함께 적었다. 두 패키지의 변경이
  같은 기능의 양면이고(진단 통로와 그 소비자), 릴리스 노트에서 갈라 읽을 이유가 없다. 기존
  `.changeset/eager-pumas-shave.md` 는 한 패키지짜리라 선례를 그대로 따르지는 못했지만,
  changesets 형식이 여러 패키지를 한 파일에 담는 것을 허용한다.
- **파일 이름을 `server-repair.md` 로 했다.** `mock-key-normalization.md` 처럼 내용으로 읽히는
  이름을 쓰는 선례가 있다. 자동 생성 이름(`eager-pumas-shave.md`)보다 이쪽이 낫다.
- **본문을 changeset 관례에 맞춰 문단 단위로 다시 묶었다.** CHANGELOG 에 쓸 때는 항목 둘로
  나눠 적었는데, changeset 은 항목 하나가 릴리스 노트의 한 덩이가 된다. `generate` 문단과
  `cli` 문단으로 나누고 각 문단 머리에 패키지 이름을 붙였다. 문장 내용은 그대로다.
- 산문에 대시(—)를 쓰지 않았다.

## 남은 위험

- 릴리스 시점에 `pnpm changeset version` 이 이 파일을 소비해 두 CHANGELOG 에 버전 절을 만든다.
  사람이 손댈 것은 없다. T12 가 만든 빚이 여기서 정리됐다.
- 계획서(`docs/superpowers/plans/2026-08-16-server-repair-implementation.md`)는 여전히 ADR
  0028~0031 을 예약한 문장을 갖고 있어 실제 번호와 다르다.
  **(이후 경과)** 계획서를 실제 번호로 고쳤다. provider 진단 통로 ADR 은 원격의 replay ADR 과
  0028 이 겹쳐 **0034** 가 됐고, 나머지는 0031 · 0032 · 0033 이다.
  계획서는 오케스트레이터 소유라 안 고쳤다.
