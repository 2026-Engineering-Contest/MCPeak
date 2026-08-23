# ADR-0063: changeset 누락은 경고가 아니라 실패다

- 상태: 채택
- 날짜: 2026-08-23
- 담당: release (`.github/workflows/ci.yml` — CODEOWNERS 상 전원)
- 작성자: @ddxng5 (② replay/record 파트)
- 승인: **전원 리뷰 필요.** CI 게이트는 전원의 코드 경로를 막거나 통과시킨다
- 참조: [#264](https://github.com/2026-Engineering-Contest/MCPeak/issues/264) (@storyrago 제기)

## 배경

`changeset-check` 는 누락을 **정확히 탐지하고, 그 결과를 버렸다.**

```yaml
pnpm changeset status --since=origin/${{ github.base_ref }} \
  || echo "::warning::changeset 이 없습니다. …"
```

`||` 가 실패를 삼켜 스텝이 exit 0 이 된다. 잡은 사실은 로그 속 annotation 한 줄로만 남고
체크는 **SUCCESS 로 찍힌다.** 이 설정은 실수가 아니라 판단이었다 — 워크플로 주석이
"경고만 남긴다 (머지 차단 아님)" 이라고 적고 있었다.

**그 판단이 실측으로 반증됐다.** External Record/Replay 기능 전체가 changeset 없이 PR 4개로
나갔다.

| PR | changeset | changeset-check |
|---|---|---|
| #234 `feat(record)` 인메모리 최소 수직 기능 | 없음 | SUCCESS |
| #245 `feat(record)` SQLite Session Store | 없음 | SUCCESS |
| #247 `feat(record)` `/external` subpath 공개 | 없음 | SUCCESS |
| #249 `feat(cli)` External 을 test 에 배선 | 없음 | SUCCESS |

새 공개 서브패스 하나(`@mcpeak/record/external`)와 CLI 플래그 둘(`--session`·
`--record-session`)이 **CHANGELOG 에 한 줄도 없이** 발행될 뻔했다. 발견한 경로는 CI 가 아니라
릴리스 직전에 사람이 대기 changeset 을 눈으로 센 것이었고, 그 뒤 #261 이 사후에 채웠다.

**도구는 제대로 동작한다.** 막힌 곳은 도구가 아니라 그 결과를 버리는 `||` 하나였다.

## 선택지

- **A안**: 그대로 둔다. 경고를 유지하고 사람이 읽기를 기대한다.
- **B안**: PR 템플릿에 체크박스를 넣는다.
- **C안**: 필수 체크 목록에 `changeset-check` 를 넣는다.
- **D안**: 실패시킨다. 빈 changeset(`--empty`)을 공식 탈출구로 안내한다.

## 결정

**D안 — 실패시킨다.** `||` 를 걷고 명시적으로 `exit 1` 한다. 실패 문구에 **두 갈래**를 다 싣는다.

```
::error::changeset 이 없습니다. 'pnpm changeset' 으로 릴리스 노트를 추가하세요.
::error::릴리스가 필요 없는 변경이면 'pnpm changeset add --empty' 로 빈 changeset 을 넣으세요.
```

이 게이트가 요구하는 것은 "changeset 을 쓰라" 가 아니라 **"넣거나, 안 넣는 이유를 남기라"** 다.

## 이유

**A안을 버린 이유는 이미 반증됐기 때문이다.** 4연속으로 아무도 그 경고를 읽지 않았다.
읽히지 않는 경고는 없는 것과 같다. 이 저장소는 같은 판단을 다른 자리에서도 했다 —
ADR-0057 은 "막을 수 없는 것" 이라서 경고를 골랐는데, 여기는 **막을 수 있는데** 안 막고 있었다.
그 차이가 결정을 가른다.

**B안을 버린 이유는 실패한 것이 정확히 사람 규율이기 때문이다.** 체크박스는 경고보다 약하다 —
경고는 최소한 기계가 만들지만 체크박스는 사람이 체크한다.

**C안은 이 수정의 대안이 아니라 후속이다.** 스텝이 exit 0 인 한 필수 체크로 올려도 소용없다.
이 개정이 선행돼야 C안이 의미를 갖는다.

**`--empty` 가 실제 CI 조건에서 통과하는 것을 실측했다.** 이 확인이 없으면 D안은 탈출구 없는
차단이 된다.

| 상황 | `changeset status` 종료 코드 |
|---|---|
| 패키지 소스 변경 + changeset 없음 | **1** (차단이 작동한다) |
| 위 + **커밋된** 빈 changeset | **0** (탈출구가 작동한다) |
| `packages/*/README.md` 만 변경 | **1** (문서도 패키지 변경이다) |

**함정을 하나 적어 둔다.** 빈 changeset 을 만들고 **커밋하지 않은 채** 로컬에서 `status` 를
돌리면 여전히 1 이다 — `--since` 가 git diff 기준이라 untracked 파일을 세지 않는다. CI 는
언제나 커밋된 상태를 보므로 문제가 없지만, 로컬에서 시험한 사람은 "탈출구가 안 먹는다" 고
오해하기 쉽다.

## 결과

- **문서 PR 도 changeset 을 요구받는다.** `packages/*/` 아래면 README 도 "패키지 변경" 이다
  (위 실측 셋째 줄). 한 줄 추가라 마찰이 크지 않다고 봤고, **`paths-ignore` 로 `**/*.md` 를
  빼는 길은 택하지 않았다** — README 에 적힌 공개 계약이 바뀔 때 릴리스 노트가 빠진다.
  실사용에서 마찰이 크다고 판명되면 그때 다시 본다.
- **이 저장소 밖의 파일만 고치는 PR 은 걸리지 않는다.** `.github/`·`docs/`·`CONTRIBUTING.md`
  는 `packages/*` 가 아니라 `changeset status` 의 관심 밖이다. 이 ADR 을 담은 PR 자체가
  그 경우다.
- **CONTRIBUTING §5-5 의 "없으면 CI가 경고한다" 가 낡는다.** 같은 PR 에서 "실패한다" 로 고친다.
  규칙 문서와 게이트가 어긋나면 사람은 문서를 믿는다.
- **동결(8/24) 하루 전에 넣는다.** 늦출 이유가 있었다 — 전원의 작업 흐름을 바꾸는 변경을
  동결 직전에 하는 것은 ADR-0059 가 경계한 모양이다. 그럼에도 지금 넣는 이유는 **막으려는
  사고가 정확히 동결 직전 러시에서 나기 때문**이다. 실제로 그 4개 PR 이 그런 시기에 나갔다.
  변경 자체는 워크플로 4줄이고 되돌리기도 4줄이라, 조각의 크기와 위험이 ADR-0059 가 다룬
  다중 패키지 제거와 다르다.
- **뒤집히려면** 빈 changeset 을 넣는 마찰이 실제 작업을 막는다는 실측이 나와야 한다. 그때는
  A안으로 돌아가는 것이 아니라 `paths-ignore` 로 범위를 좁히는 쪽을 먼저 본다.
