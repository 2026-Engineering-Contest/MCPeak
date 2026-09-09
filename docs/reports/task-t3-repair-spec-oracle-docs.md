# Task T3 보고서: ADR 과 changeset (문서)

확정한 ADR 번호는 **0090** 이다. 계획서가 제안한 번호를 그대로 썼다.

이슈 #385. 계획서 `docs/superpowers/plans/2026-09-09-repair-spec-oracle-implementation.md` Task T3.
브랜치 `fix/repair-spec-oracle`, 기점 `7a1a4f0`(T2 통합 커밋).

## Step 1: 번호 확인

```
$ ls docs/adr | tail -3
0087-임의-키-맵은-빈-객체로-합성하고-키-이름만-검사한다.md
0088-예제-서버는-정상값을-스키마-examples-로-선언하고-통제-변이로-검출력을-고정한다.md
0089-시험-실행이-꺼지면-사전보완도-건너뛴다.md

$ grep -c "^| \[00" docs/adr/README.md
87
```

디렉터리의 최대값이 0089 이고 0090 은 비어 있다. 색인의 마지막 줄도 0089 다. 번호를 바꿀
이유가 없어 계획서대로 0090 을 썼다.

## 무엇을 만들었나

- `docs/adr/0090-오라클-자격은-지문과-실행-기록의-합의다.md` (신규). 다섯 항목이다.
  배경 · 선택지 · 결정 · 이유 · 결과. 본문은 계획서 Step 2 전량 그대로다.
- `docs/adr/README.md` (수정). 0089 줄 다음에 한 줄을 더했다.
  ```
  | [0090](./0090-오라클-자격은-지문과-실행-기록의-합의다.md) | 오라클 자격은 지문과 실행 기록의 합의다 | generate · cli | 제안 |
  ```
  열은 넷(번호 · 주제 · 담당 · 상태)이고, 담당이 둘일 때 가운뎃점으로 잇는 것은 0088 줄의
  `examples · cli` 와 같은 표기다.
- `.changeset/repair-spec-oracle.md` (신규). `@mcpeak/generate` 와 `@mcpeak/cli` 가 둘 다
  `minor` 다. 문안은 계획서 Step 4 전량 그대로다.

소스 코드는 한 줄도 건드리지 않았다.

## 검증

```
$ pnpm biome ci .
Checked 391 files in 104ms. No fixes applied.
```

`pnpm changeset status --since=main` 은 지금 실패한다.

```
$ pnpm changeset status --since=main
🦋  error Some packages have been changed but no changesets were found. Run `changeset add` to resolve this error.
🦋  error If this change doesn't need a release, run `changeset add --empty`.
```

**아직 커밋되지 않았기 때문이다.** 이 명령은 `main` 과의 git diff 에서 새로 추가된
`.changeset/*.md` 만 세는데, 방금 만든 파일은 추적되지 않은 상태라 그 diff 에 잡히지 않는다.
파일 자체는 정상이고 의도한 두 패키지를 정확히 가리킨다. changesets 가 읽은 내용을 그대로
꺼내 확인했다.

```
$ pnpm changeset status --output=<임시파일>
# 임시파일에서 id 가 repair-spec-oracle 인 항목의 releases
[{"name": "@mcpeak/generate", "type": "minor"}, {"name": "@mcpeak/cli", "type": "minor"}]
```

커밋에 이 파일이 포함되면 `--since=main` 도 두 패키지를 잡는다. 이것은 프로젝트 지침이 이미
적어 둔 동작이다("이 명령은 브랜치가 추가한 changeset 만 센다").

## 임의로 판단한 것

ADR 머리말의 항목 이름을 저장소 관례에 맞췄다. 계획서는 `- 범위: generate · cli` 와
`- 관련: ...` 로 적었는데, 기존 ADR 은 0086 · 0088 · 0089 가 모두
`상태 · 날짜 · 담당 · 작성자 · 참조` 를 쓴다. 그래서 `범위` 를 `담당` 으로, `관련` 을 `참조` 로
바꾸고 `- 작성자: @seodduu` 를 더했다. 본문 다섯 항목의 문장은 계획서 그대로다. 색인의 담당
표기를 다른 줄과 맞추라는 지시와 같은 취지로 판단했는데, 문서 형식을 계획서 글자 그대로
유지해야 한다면 되돌리면 된다.

## 남은 위험

- **`pnpm changeset status --since=main` 은 커밋 후에 다시 확인해야 한다.** 위 사유로 지금은
  판정할 수 없다. CI 의 `changeset-check` 잡이 같은 명령을 쓰므로, 커밋에
  `.changeset/repair-spec-oracle.md` 가 빠지면 거기서 빨강이 된다.
- **ADR 번호 충돌은 머지 시점에 다시 볼 여지가 있다.** 번호를 브랜치에서 배정하는 한 다른
  브랜치가 같은 0090 을 쓸 수 있다. `docs/adr/README.md` 가 이 위험을 이미 적어 두었다.
- **W4 직렬 웨이브가 남아 있다.** `repair-e2e.test.ts` 와 실환경 검증은 이 태스크 범위 밖이다.
