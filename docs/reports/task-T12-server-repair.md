# T12 ADR 넷과 CHANGELOG 보고서

status: READY_FOR_REVIEW

## 요약

ADR 넷을 쓰고 색인에 넣었다. 번호는 착수 시점에 `ls docs/adr/` 로 다시 세어 확인했고,
지시받은 0028 · 0031 · 0032 · 0033 이 맞았다. CHANGELOG 두 개에 공개 API 변경을 적었다.
전체 테스트를 포함한 검증 넷 전부 초록이다.

## 착수 시점 번호 확인

```
0027-isError-진단의-서버-응답-본문.md
0029-목-매칭-키-정규화-경계.md
0030-mock-src-상대-import-확장자.md
```

`0028` 이 비어 있고 `0029`·`0030` 은 이미 쓰였다. `0031` 이후는 없다. 지시한 번호 넷이 그대로
빈 자리다. 그 사이 더 먹힌 번호는 없었다.

## 바꾼 파일

- 생성: `docs/adr/0034-provider-진단-통로-분리.md`
- 생성: `docs/adr/0031-repair-번들과-json-분리.md`
- 생성: `docs/adr/0032-미승인-명세에서의-repair-동작.md`
- 생성: `docs/adr/0033-stderr-외부-전송-경계.md`
- 수정: `docs/adr/README.md` (표에 넷 추가, 재번호 경위 한 문단 추가. 기존 줄 변경 0건)
- 수정: `packages/generate/CHANGELOG.md`
- 수정: `packages/cli/CHANGELOG.md`
- 생성: `docs/reports/task-T12-server-repair.md` (이 파일)

`packages/generate` 는 CHANGELOG 하나만 건드렸다. 그 패키지의 다른 파일 수정 0건. 코드 변경
0건. 의존성 추가 0건. git 명령 0건.

## 검증

`pnpm vitest run packages/cli`

```
 Test Files  20 passed (20)
      Tests  523 passed (523)
```

`pnpm typecheck --force`

```
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
```

`pnpm lint`

```
Checked 183 files in 63ms. No fixes applied.
```

`pnpm test`

```
 Test Files  68 passed (68)
      Tests  1411 passed | 1 skipped (1412)
```

## ADR 넷이 실제 구현의 무엇을 기록하는가

계획서 문장을 옮기지 않고 T1~T11 에서 실제로 내린 결정을 결과 항목에 적었다.

**0028 (provider 진단 통로 분리).** authoring 재사용을 버린 이유는 출력 스키마가 명세를 담을 수
있으면 AI 가 명세를 고쳐 온다는 것이다. 결과 항목에 이번 구현의 사실을 적었다. 실행 경로는
`makeProvider` 하나로 공유한다는 것, claude envelope 해석을 `claudeStructuredOutput` 한 곳에
합쳤다는 것, provider 실패 매핑을 사본으로 뒀다가 `publicProviderFailure` 로 다시 합쳤다는 것
(T5b), `JsonValue` 를 `generate` 로컬 정의로 쓴 것(T1), `DEFAULT_MAX_REPAIR_CASES` 를 값
import 하지 않고 `cli` 안에 상수로 둔 것(T9)이 전부 여기 걸린다.

**0031 (번들과 `--json` 분리).** 두 파일이 지는 계약이 다르다는 것이 핵심이다. 결과에 옵션 없는
실행의 바이트 동일성(완료 조건 2), 쓰기 실패 시 종료 코드 1, `hasDiagnosticContent` 를 화면과
같은 함수로 쓴 것, `truncated` 를 형식에만 두고 안 채운 것을 적었다.

**0032 (미승인 명세에서의 동작).** 차단이 아니라 전제 전환이다. 결과에 지문 상태별 상단 블록이
다른 문구인 것, 승인 상태에서 `target: "spec"` 을 버리고 그 개수를 화면에 적는 것, 전부
버려지면 `unsure` 로 접히는 것, 그때도 경계 문장이 찍히는 것을 적었다.

**0033 (stderr 외부 전송 경계).** "치환했으니 안전" 이라고 말하지 않기로 한 결정이다. 결과에
확인 화면의 세 표기(줄 수와 바이트, `(전송하지 않음)`, `없음`), `--no-stderr` 가 키 자체를
안 만든다는 것, 뒤에서부터 자르되 UTF-8 문자를 안 끊는다는 것, 비대화형에서 `--yes` 없이는
안 보낸다는 것, 그리고 같은 문자열이 `input` 에서는 치환되고 stderr 에서는 남는 테스트가
있다는 것을 적었다.

## 임의로 판단한 지점

- **재번호 문단을 "여섯 번째" 로 이어 썼다.** 앞의 다섯과 다른 점이 하나 있어 그것을 적었다.
  이번에는 충돌한 뒤에 옮긴 것이 아니라 착수 시점에 파일을 세어 처음부터 빈 번호를 잡았다.
  그래도 원인은 같으므로 "계획 문서가 번호를 미리 적어 두면 그 문서 자체가 새 충돌원이 된다"
  를 남겼다.
- **ADR 상태를 넷 다 `채택` 으로 썼다.** 전부 코드로 이미 구현돼 있고 테스트가 그 결정을
  고정한다. `제안` 으로 두면 "이 결정에 기대어 구현하지 마세요" 라는 색인의 문장과 실제 코드가
  어긋난다.
- **CHANGELOG 에 `## Unreleased` 절을 직접 썼다.** 이 저장소는 changesets 를 쓰고
  (`.changeset/` 에 항목 파일이 있다) 릴리스 때 CHANGELOG 를 생성한다. 지시받은 Files 가
  CHANGELOG 파일 자체라 거기 적었지만, **릴리스 시 changesets 가 이 절 위에 새 버전 절을
  덧붙이므로 사람이 한 번 정리해야 한다.** changeset 파일(`.changeset/*.md`)로 옮기는 편이
  도구와 맞는다. 그 파일은 Files 목록 밖이라 만들지 않았다. 판단이 필요하면 알려 달라.
- **generate CHANGELOG 에 export 목록을 전부 적었다.** 터미널 B 가 `index.ts` 만 보고 만들었던
  것처럼, 이 패키지를 쓰는 쪽은 export 목록이 계약이다.
- 산문에 대시(—)를 쓰지 않았다. 기존 줄에 있는 것은 건드리지 않았다.

## 남은 위험

- 위 changesets 문제. 릴리스 흐름과 어긋난 채로 두면 다음 릴리스에서 절이 두 벌 생긴다.
- ADR-0007 번호 중복(`mock-stdio-transport` 와 `provider-전송-스키마-분리`)은 여전히 미해소다.
  이번 작업 범위 밖이라 손대지 않았다.
- `docs/superpowers/plans/2026-08-16-server-repair-implementation.md` 는 아직 0028~0031 을
  예약한 문장을 갖고 있다. 계획서는 오케스트레이터 소유라 내가 안 고쳤다. 실제 번호와 다르다.
