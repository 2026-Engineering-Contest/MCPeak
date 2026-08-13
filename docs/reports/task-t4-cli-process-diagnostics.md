# Task T4 보고서: ADR-0014

- 상태: READY_FOR_REVIEW
- 날짜: 2026-08-14
- 계획서: `docs/superpowers/plans/2026-08-13-cli-process-diagnostics-implementation.md` §4 Task T4
- 설계 문서: `docs/superpowers/specs/2026-08-13-cli-process-diagnostics-design.md` §11

## 실행 환경

```
pwd:  /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-cli-process-diagnostics
HEAD: bd99647 (docs(cli): T2 통합 SHA를 대장에 기록한다)
브랜치: feat/cli-process-diagnostics
```

## 변경 파일

```
?? docs/adr/0014-진단-출력-채널.md
```

`docs/adr/README.md` 는 **고치지 않았다.** 사유는 아래 임의 판단 항목에 적었다.

## 내용

`docs/adr/0012-cli-기본-출력-전환.md` 와 같은 머리말(상태·날짜·관련 설계)과 다섯 항목
(배경 / 선택지 / 결정 / 이유 / 결과)을 따랐다.

- **배경**: 수집은 이미 `core` 에서 끝나 있었고 표시할 곳만 정하면 되는 상태였다는 것. 그리고
  `해결: exit code, signal, bounded stderr를 확인하세요` 라고 지시하면서 그 셋을 보여주지 않던
  모순(설계 §1).
- **선택지**: (1) `RunnerReport` 에 진단 필드 추가, (2) stdout 에 보고서와 함께 출력,
  (3) stderr 채널로 분리.
- **결정**: (3).
- **이유**: 설계 §4.2 의 결정론성 계약("두 번 실행한 `RunnerEvent[]` 와 `RunnerReport` 가 deep
  equality")이 stderr 의 타임스탬프·PID·절대 경로와 충돌한다는 것, `--json` 소비자 보호
  (`dist-cli-e2e.mjs` 가 stdout 을 `JSON.parse` 한다, ADR-0012 의 약속), 터미널에서는 두 스트림이
  함께 보이므로 사람 경험이 나빠지지 않는다는 것.
- **결과**: 실패 경로 셋에 진단이 붙는다, `--json` stdout 바이트 불변, `--stderr-lines 0` 탈출구,
  보고서 deep equality 유지, 잘림을 숨기지 않음.

계획서가 요구한 대로 결과 절 끝에 **이번 실행에서 실제로 드러난 것**을 한 절로 덧붙였다.
빈 진단 생략 규칙이 왜 필요했는지다. 정보량 0인 블록(`종료 코드: 0  시그널: 없음` +
`stderr: (비어 있음)`)이 "단언은 틀렸지만 서버는 멀쩡한" 가장 흔한 실패 모양마다 붙었고, 기존
테스트 5건과 충돌했다. 그 테스트들의 기대는 낡은 것이 아니라 "서버에 문제가 없으면 서버 이야기를
하지 않는다" 는 옳은 기대였다는 점, 그래서 판정을 렌더러가 아니라 호출부에 뒀다는 점을 적었다.

## 검증

```
$ pnpm lint
> biome check .
Checked 118 files in 26ms. No fixes applied.
```

문서 태스크라 다른 판정 명령은 대상이 아니다.

## 임의로 판단한 부분

**`docs/adr/README.md` 를 고치지 않았다.** 계획서는 "목록 줄이 있으면 함께 갱신한다" 이고,
실제 README 의 표는 0001~0006 의 초기 후보 목록이다. 0007~0013 이 이미 표에 없으므로 0014 만
넣으면 목록이 더 어긋난다. 표를 0007~0014 로 전부 채우는 것은 다른 오너들이 쓴 ADR 을 대신
정리하는 일이라 이 태스크의 범위를 넘는다고 봤다. 필요하다고 판단되면 별도로 지시해 달라.

**파일명.** 계획서가 지정한 `docs/adr/0014-진단-출력-채널.md` 를 그대로 썼다. 한글 파일명은
`0007-provider-전송-스키마-분리.md` 등 기존 관행과 같다.

## 남은 위험

- 없음. 문서 한 개 추가다.
- 커밋·푸시 하지 않았다.
