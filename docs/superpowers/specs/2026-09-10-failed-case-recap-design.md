# 시험 실행 보고서의 실패 케이스 요약 절 설계 (2026-09-10)

- 이슈: [#446](https://github.com/2026-Engineering-Contest/MCPeak/issues/446) `[feat] 시험 실행 보고서에 실패한 케이스만 모은 절을 넣는다`
- 라벨: `pkg:runner` · `type:feat`
- 검토 기준 커밋: `ca3cce1`
- 관련 설계 문서: `docs/superpowers/specs/2026-08-13-cli-report-rendering-design.md` (이하 **렌더링 설계**)
- 관련 ADR: ADR-0013(렌더러 배치와 진단 무분기), ADR-0027(위반 다음에 notes)
- 근거 관측: `docs/2026-09-10-데모-리허설-런북.md` §2, `docs/2026-09-08-실전성-작업-순서.md` A-3
- 통합 이슈: 없음

## 1. 배경

### 1.1 지금 화면이 실제로 하는 일

`packages/runner/src/reporter.ts` 의 `renderReport` 는 순수 함수이고, 출력은 렌더링 설계 §5.1 의
구조를 그대로 따른다.

```
{suite.name}  ({N} cases)
                                  <- 빈 줄
{케이스 줄}                        <- report.cases 순서대로 전부
...
                                  <- 빈 줄
{중단 줄}                          <- stopReason 이 있을 때만, 그 뒤 빈 줄
{요약 줄}
{거절 근거 미확인 고지}             <- summary.rejectionUnverified > 0 일 때만
{보고서 크기 고지}                  <- report.payload 가 있을 때만
```

케이스 줄은 `reporter.ts:215-253` 의 단일 루프가 만든다. 통과 여부와 무관하게 모든 케이스가 한
줄을 얻고, 통과가 아닌 케이스만 그 아래에 4칸 들여쓴 진단 블록을 얻는다. 요약은
`summaryLine`(`reporter.ts:141`)이 만드는 한 줄이 전부다.

**실패한 케이스를 다시 모아 보여주는 자리가 코드에 없다.** 실패를 찾으려면 전체 목록에서
`✗` 를 눈으로 골라야 한다.

### 1.2 케이스 수는 이미 그 방식이 안 통하는 구간에 있다

리허설 실측(`docs/2026-09-10-데모-리허설-런북.md`)이다.

| 서버 | 툴 | 축(케이스) | 교정 전 판정 |
|---|---|---|---|
| `examples/weather-server` | 3 | 8 | 참고용 |
| `@modelcontextprotocol/server-memory` | 9 | 25 | 25/25 |
| `@modelcontextprotocol/server-filesystem` | 14 | 58 | 49 passed, 9 failed |
| `mcp-server-git` | 12 | 59 | 47 passed, 12 failed |

툴당 약 4케이스다. `mcp-server-git` 을 교정 전에 돌리면 실패 12건이 59줄에 흩어져 나오고,
각 실패는 진단 블록으로 2~4줄을 더 쓴다. 화면에서 실패만 골라 읽으려면 스크롤한다.

### 1.3 출력량을 줄이는 수단이 `test` 에는 없다

`--max-cases` 는 `repair` 전용이다(`packages/cli/src/help.ts:99`). `test` 에는 출력 상한도,
통과 케이스를 접는 옵션도 없다.

### 1.4 왜 이 이슈가 지금 3번인가

`docs/2026-09-08-실전성-작업-순서.md` A 절이 2026-09-10 에 이것을 3번으로 올렸다. 데모 서버를
툴이 많은 자체 서버로 바꾸면 `"example"` 자리값 계열 문제(#402)는 `.meta({ examples })` 로
없어지지만, **케이스 수가 늘어서 생기는 이 문제는 서버를 아무리 잘 설계해도 없어지지 않는다.**

## 2. 목표 / 비범위 / 완료 조건

### 2.1 목표

1. 실패한 케이스를 스크롤 없이 한자리에서 볼 수 있다.
2. 그 자리에 **새 문안을 만들지 않는다.** 이미 케이스 블록이 찍은 줄을 옮겨 온다.
3. 실패가 0건이면 화면이 이 변경 전과 **바이트 그대로** 같다.
4. `renderReport` 는 순수 함수로 남는다. `--json` 과 JUnit XML 은 바뀌지 않는다.
5. `runner` 패키지 안에서 끝난다. 다른 오너의 패키지를 고치지 않는다.

### 2.2 비범위

이슈 코멘트와 인접 논의에서 흘러들어온 것 중 이번에 하지 않는 것이다.

- **`test` 에 `--max-cases` 류 출력 상한을 주지 않는다.** 잘린 뒤의 실패를 못 보게 되므로 문제를
  바꾸기만 한다(이슈 §대안).
- **통과한 케이스를 기본으로 접지 않는다.** 통과 목록이 데모와 신뢰 형성에 쓰인다(이슈 §대안).
- **새 CLI 옵션을 만들지 않는다.** 절은 조건부로 항상 나온다.
- **`--json` 에 요약 필드를 더하지 않는다.** 기계 소비자는 `cases[].status` 로 이미 같은 목록을
  만들 수 있다. 키를 늘리면 기존 JSON 의 바이트 동일성이 깨진다.
- **진단 문안 자체를 손보지 않는다.** 리허설이 남긴 ④(시각 차이를 `numericDrift` 로 분류)는
  `determinism.ts` 소유이고 이 이슈가 아니다.
- **`--determinism` 차이 화면의 잘림(#447)을 고치지 않는다.** 별개 이슈다.
- **`cli` · `dashboard` 패키지를 고치지 않는다.** §6.2 가 왜 고칠 필요가 없는지 밝힌다.

### 2.3 완료 조건

검증 가능한 문장으로 다시 쓴 것이다. 이슈에는 체크리스트가 없어 여기서 만든다. 이 목록이 구현
PR 의 통과 기준이다.

| # | 조건 | 판정 방법 |
|---|---|---|
| C1 | `failed` 와 `timedOut` 이 모두 0인 보고서의 `renderReport` 출력이 변경 전과 바이트 그대로다 | 전부 통과 보고서의 기존 exact 단언이 수정 없이 통과 |
| C2 | `failed` 또는 `timedOut` 케이스가 하나라도 있으면 **요약 줄 바로 앞에** `실패한 케이스` 절이 나온다 | 절 머리글의 줄 번호 < 요약 줄의 줄 번호이고 그 사이에 빈 줄 하나만 있다 |
| C3 | 절의 행 수가 `summary.failed + summary.timedOut` 과 같다 | 절 본문 행을 세어 두 값의 합과 비교 |
| C4 | `cancelled` · `notRun` 케이스는 절에 나오지 않는다 | 중단된 보고서에서 해당 id 가 절에 없음 |
| C5 | 각 행이 케이스 id 와 **그 케이스 블록이 찍은 진단 줄 하나**를 담는다. 새 문안이 없다 | §4.3 의 선택 규칙별 단언 4건 |
| C6 | 절의 모든 문자열이 `escapeTerminalText` 를 거친다 | 제어 문자를 심은 id 와 진단으로 단언 |
| C7 | 서버 줄이 이미 `→` 로 시작하면 화살표가 겹치지 않는다 | `→ →` 가 출력에 없음 |
| C8 | `color: true` 에서 기호에만 SGR 이 붙고 글에는 안 붙는다 | 절 행의 SGR 개수 단언 |
| C9 | `--json` 출력이 바이트 그대로다 | `test --json` 경로가 `renderReport` 를 부르지 않음을 코드로 확인 + `packages/cli/tests` 전량 통과 |
| C10 | JUnit XML 이 바이트 그대로다 | `packages/runner/tests/junit.test.ts` 수정 없이 통과 |
| C11 | `cli` 의 `caseBlocks` 파싱이 영향받지 않는다 | `packages/cli/tests/dry-run.test.ts` · `repair-bundle-write.test.ts` 수정 없이 통과 |
| C12 | `pnpm test` · `pnpm typecheck --force` · `pnpm lint` 통과 | 출력에서 `Cached: 0 cached` 확인 |
| C13 | `examples/weather-server` 대상 E2E 가 통과한다 | `pnpm --filter @mcpeak/cli test:e2e` |
| C14 | 렌더링 설계 §5.1 과 새 §5.7 에 이 절이 기록된다 | 문서 diff |
| C15 | 실패 12건짜리 실서버 실행에서 절이 화면에 나오고 12행이다 | §7 실환경 검증 |

## 3. 검토한 대안

### 3.1 절을 어디에 두는가

이슈는 "합계 줄 앞이나 뒤" 로 열어 두고 예시는 뒤를 보였다. 셋을 검토했다.

| 안 | 결과 | 판단 |
|---|---|---|
| A. 요약 줄 **앞** | 절 다음에 빈 줄, 그다음 요약 줄. 요약 줄 이후는 한 바이트도 안 바뀐다 | **채택** |
| B. 요약 줄 **뒤**, 고지들 앞 | 요약 줄과 거절 고지 사이에 절이 끼어든다 | 기각 |
| C. 모든 고지 **뒤** (맨 끝) | 요약과 고지의 인접성은 지키지만 절이 고지에 밀려 내려간다 | 기각 |

**B 를 기각한 이유가 핵심이다.** 거절 근거 미확인 고지는 `reporter.ts:151-156` 이 명시하듯
**통과한 케이스**에 대한 각주다. 그 문장 바로 위에 실패 목록을 놓으면 "거절을 기대한 케이스
3건은 거절 근거를 확인하지 못했습니다" 가 방금 나열한 실패들에 대한 말로 읽힌다. 판정이 바뀐
것으로 읽히지 않게 하려고 그 자리를 잡아 둔 문장인데, 그 배려가 무효가 된다.

C 는 화면 맨 아래를 쓰지만, 그 이점이 실제로는 없다. `packages/cli/src/test-command.ts:1562`
이후가 보고서 뒤에 참고 문장 블록, 명세 승인 블록, 결정론성 블록을 더 찍는다. `renderReport`
의 마지막 줄은 사용자 화면의 마지막 줄이 아니다.

A 는 덤으로 회귀 위험을 거의 0으로 만든다. 요약 줄과 그 뒤 두 고지의 상대 순서가 그대로라
`report-payload-notice.test.ts:118` 의 "고지는 요약 줄 뒤에 온다" 가 수정 없이 통과한다.

### 3.2 어떤 상태를 절에 넣는가

`TestCaseResult["status"]` 는 다섯이다.

| status | 진단이 있는가 | 절에 넣는가 | 이유 |
|---|---|---|---|
| `passed` | 없음 | 아니오 | 절의 존재 이유가 실패를 고르는 것이다 |
| `failed` | 있음 | **예** | 본체다 |
| `timedOut` | 있음 (`CASE_TIMEOUT`) | **예** | 사용자가 손대야 하는 실패다. 목록에서 골라야 하는 것은 `✗` 와 다르지 않다 |
| `cancelled` | 있음 (`RUN_ABORTED`) | 아니오 | 서버 판정이 아니라 사용자가 멈춘 사실이다. 중단 줄이 이미 그것을 말한다 |
| `notRun` | 없음 (`executor.ts:518`) | 아니오 | 실행되지 않았다. 옮길 진단이 없다 |

`cancelled` 는 한 실행에 최대 한 건이므로(`executor.ts:389`, 나머지는 `notRun`) 넣어도 한 줄
늘 뿐이지만, "실패한 케이스" 라는 머리글 아래 두면 사용자가 멈춘 것을 도구가 실패로 부르게
된다. 중단 줄과 중복이기도 하다.

머리글은 `실패한 케이스` 로 두고 `timedOut` 을 포함한다. 기호가 `⧖` 로 나오므로 목록 안에서
구분되고, 요약 줄이 `timed out` 을 따로 세므로 숫자가 헷갈리지 않는다.

### 3.3 행에 어떤 글을 싣는가

이것이 이 설계에서 가장 갈리는 판단이다. 이슈 예시가 답을 보여 준다.

```
실패한 케이스
  ✗ git-status-success   → Repository path 'example' is outside the allowed repository '…'
```

리허설에서 이 케이스의 블록은 이렇게 찍혔다.

```
✗ git-status-success   git_status가 오류 없이 응답한다
    isError  정상 응답을 기대했지만 오류 응답을 받았습니다.
    → Repository path 'example' is outside the allowed repository '…/git-sandbox'
```

두 후보가 있다.

| 안 | 무엇을 싣나 | `mcp-server-git` 실패 12건에서의 결과 |
|---|---|---|
| R1 | 진단의 `message` | 12행이 `정상 응답을 기대했지만 오류 응답을 받았습니다.` 로 **전부 같다** |
| R2 | 가장 구체적인 줄 (`violations[0]` → `notes[0]` → `message`) | 서버가 준 이유가 행마다 실린다 |

**R2 를 채택한다.** R1 은 12행을 같은 문장으로 채워 절의 목적인 "어느 것을, 왜 봐야 하는가"에
답하지 못한다. `IS_ERROR_MISMATCH` 의 `message` 는 `diagnostics.ts:188` 이 보여 주듯 기대와
실제의 참거짓만 말하는 고정 문안이고, 서버가 준 이유는 `notes` 에 실린다(ADR-0027).
`BODY_SCHEMA_MISMATCH` 도 같다. `message` 는 `응답이 기대 스키마와 다릅니다. 위반 3건.` 이고
`violations[0].message` 가 `$.temp: 필수 필드가 없습니다. 발견된 필드: 'temperature'` 다.
프로젝트 지침이 실패 메시지의 본보기로 적어 둔 문장이 후자다.

R2 의 대가는 `위반 3건` 같은 총량 정보가 요약 행에서 빠지는 것이다. 받아들인다. 절은 짚어 주는
자리이고 총량은 바로 위 케이스 블록에 그대로 있다.

### 3.4 ADR 대상인가

그렇다. §3.1 과 §3.3 은 다르게 갈 수 있었고, 뒤집으면 화면 문안이 바뀐다. ADR-0092 로 남긴다.
§3.2 는 그 ADR 의 결과 항목에 함께 적는다.

## 4. 출력 계약

### 4.1 전체 구조 (렌더링 설계 §5.1 갱신본)

```
{suite.name}  ({N} cases)
                                  <- 빈 줄
{케이스 줄}
...
                                  <- 빈 줄
{중단 줄}                          <- stopReason 이 있을 때만, 그 뒤 빈 줄
실패한 케이스                       <- failed + timedOut > 0 일 때만
{요약 행}
...
                                  <- 빈 줄
{요약 줄}
{거절 근거 미확인 고지}
{보고서 크기 고지}
```

절이 없을 때 이 구조는 현행과 글자 하나 다르지 않다.

### 4.2 요약 행의 형태

```
{두 칸}{mark} {caseId 패딩}{두 칸}→ {진단 글}
```

- 들여쓰기는 두 칸이다. 케이스 줄(0칸)과 진단 블록(4칸) 사이에 놓아, 목록도 진단도 아닌
  중간 층위임을 보인다. 두 칸은 거절 고지·크기 고지의 첫 줄이 쓰는 `GAP` 과 같은 값이다.
- `mark` 는 케이스 줄과 같은 `MARKS[status]` 다. `failed` 는 `✗`, `timedOut` 은 `⧖`.
  새 기호를 만들지 않는다.
- `caseId` 열은 **절에 실린 케이스끼리만** 맞춘다. 보고서 전체 폭에 맞추면 긴 id 를 가진
  통과 케이스가 절 안에 빈 공백을 만든다. 단언 타입 열을 케이스 안에서만 맞추는 기존 규칙
  (`reporter.ts:232`)과 같은 판단이다.
- 열 사이는 `GAP`(두 칸)이다.
- 글머리는 `BULLET`(`→`)이다. 진단 글이 이미 `→` 로 시작하면 붙이지 않는다. 규칙은 케이스
  블록의 `bulletLine` 과 같은 것을 쓴다(#280 회귀 방지).

### 4.3 진단 글을 고르는 규칙

케이스 하나에 대해 아래 순서로 **처음 값이 있는 것**을 쓴다. 전부 없으면 그 행은 글 없이
기호와 id 만 낸다(계약상 오지 않지만 방어적으로 둔다).

1. **출처 진단을 고른다.**
   1. `result.operation.diagnostic` 이 있으면 그것. (케이스 레벨 진단이 있으면 단언까지 가지
      못한 실패이고, 케이스 블록도 이것을 먼저 찍는다. `reporter.ts:222`)
   2. 없으면 `result.assertions` 에서 **`status` 가 `failed` 이고 진단이 있는 첫 단언**의
      `diagnostic`. `skipped` 단언은 건너뛴다. 실패 케이스는 케이스 레벨 진단이 있거나 실패한
      단언이 반드시 있으므로(`executor.ts:482` 의 status 판정) 이렇게 좁혀도 잃는 것이 없다.
      PR #453 이 먼저 택한 규칙이고 그쪽이 더 정확해 가져왔다.
2. **그 진단에서 줄 하나를 고른다.**
   1. `violations[0].message`
   2. 없으면 `notes[0]`
   3. 없으면 `message`

`skipped` 단언은 출처가 되지 않는다. 그 진단은 "무엇을 못 검사했나" 이지 "왜 실패했나" 가
아니고, 요약 행이 답하는 것은 후자다. 건너뜀 여부는 케이스 블록에서 읽는다.

### 4.4 진단 글의 길이 상한

이스케이프를 마친 글이 **100 코드 포인트**를 넘으면 앞에서 99 코드 포인트를 취하고 `…`(U+2026)
을 붙인다. 결과는 정확히 100 코드 포인트다.

- **왜 자르는가.** 절의 값은 한 케이스당 한 행이다. 200자짜리 위반 문장이 들어오면 80열
  터미널에서 한 행이 세 줄로 접히고, 12건이면 절이 36줄이 되어 목적이 뒤집힌다.
- **왜 100인가.** 리허설에서 실제로 나온 실패 첫 줄 중 가장 긴 것이
  `Repository path 'example' is outside the allowed repository '<절대경로>'` 이고 경로를 포함해
  약 95자다. 100이면 실측 실패가 잘리지 않는다. 진단 값 자체는 `MAX_VALUE_STRING_CHARS`(200)로
  이미 한 번 잘려 오므로, 여기서 다시 자르는 폭은 그 절반이다.
- **#447 과 다르다.** #447 은 잘린 값이 그 정보의 **유일한 사본**이라 두 회차가 같아 보이는
  문제다. 여기서 잘린 글의 원본은 같은 화면 위쪽 케이스 블록에 온전히 있다. 요약 행은 가리키는
  자리이고 판정 근거가 아니다.
- 상한 상수는 이름과 근거 주석을 함께 둔다(`MAX_RECAP_TEXT_CHARS`).

### 4.5 순서 계약

- 절 안의 케이스 순서는 `report.cases` 순서다. 다시 정렬하지 않는다. 위 목록에서 본 순서와
  같아야 눈이 대응시킬 수 있고, 정렬은 결정론성에 새 변수를 들인다.
- 이스케이프가 먼저, 자르기가 그다음, 색상 삽입이 마지막이다. 렌더링 설계 §6 의 순서와 같다.
  뒤집으면 우리가 넣은 SGR 이 이스케이프되어 화면에 리터럴로 찍히거나, 자르기가 SGR 시퀀스를
  중간에서 끊는다.

### 4.6 색상 (렌더링 설계 §5.8 확장)

| 대상 | SGR |
|---|---|
| 절의 `✗` | `[31m` 빨강 (케이스 줄과 같음) |
| 절의 `⧖` | `[33m` 노랑 (케이스 줄과 같음) |
| 머리글 `실패한 케이스` | 없음 |
| `caseId` · `→` · 진단 글 | 없음 |

진단 문장 본문에 색을 넣지 않는 기존 규칙을 그대로 지킨다. `dashboard` 는 이 ANSI 를
`ansiToHtml` 로 옮기므로(`packages/dashboard/src/server/wiring.ts:138`) 새 SGR 코드를 만들지
않는 것이 그쪽 회귀도 막는다.

## 5. 구현

### 5.1 배치

전부 `packages/runner/src/reporter.ts` 안이다. 새 파일을 만들지 않는다. 이 모듈은 265줄이고
한 가지 책임(보고서 하나를 사람이 읽는 문자열로 그리기)만 갖는다. 절은 그 책임 안이다.

`renderReport` 는 순수 함수로 남는다. `process` · `stdout` · `isTTY` · `NO_COLOR` · `Date` ·
로케일을 읽지 않는다(ADR-0013).

### 5.2 기존 코드에 필요한 변경

`bulletLine` 의 화살표 겹침 방지 규칙을 절과 케이스 블록이 함께 쓴다. 들여쓰기가 서로 다르므로
(4칸 대 2칸) 규칙만 떼어 낸다. 이 리팩터로 `bulletLine` 의 외부 동작은 바뀌지 않는다.

```ts
/**
 * 글머리를 붙인 본문. **줄이 이미 `→` 로 시작하면 붙이지 않는다.** 붙이면 `→ → ...` 가
 * 된다(#280). 들여쓰기는 호출부가 정한다. 케이스 블록은 4칸, 실패 요약 절은 2칸이다.
 *
 * 인자는 **이미 이스케이프된 글**이다. 이스케이프가 먼저, 판정이 나중이다(설계 문서 §6).
 */
const bulletBody = (escaped: string): string =>
  escaped.trimStart().startsWith(BULLET) ? escaped : `${BULLET} ${escaped}`;

const bulletLine = (text: string): string => `${INDENT}${bulletBody(escapeTerminalText(text))}`;
```

### 5.3 새로 더하는 것

판단이 있는 곳이라 전량으로 적는다.

```ts
/** 실패 요약 절의 행 들여쓰기. 케이스 줄(0칸)과 진단 블록(4칸) 사이의 중간 층위다. 설계 문서 §4.2. */
const RECAP_INDENT = "  ";

/** 실패 요약 절의 머리글. 설계 문서 §3.2. */
const RECAP_HEADING = "실패한 케이스";

/**
 * 실패 요약 절에 싣는 케이스 상태. `cancelled` 는 사용자가 멈춘 사실이라 중단 줄이 이미
 * 말하고, `notRun` 은 옮길 진단이 없다. 설계 문서 §3.2.
 */
const RECAP_STATUSES: ReadonlySet<TestCaseResult["status"]> = new Set(["failed", "timedOut"]);

/**
 * 요약 행 한 줄에 싣는 진단 글의 상한(코드 포인트). 넘으면 99자에서 자르고 `…` 를 붙인다.
 *
 * 100 은 리허설 실측에서 나온 가장 긴 실패 첫 줄(`Repository path 'example' is outside the
 * allowed repository '<절대경로>'`, 약 95자)이 잘리지 않는 값이다. 진단 값 자체는
 * `MAX_VALUE_STRING_CHARS`(200)로 한 번 잘려 오므로 여기 상한은 그 절반이다.
 *
 * **자르기가 정보를 잃지 않는다.** 원본은 같은 화면 위 케이스 블록에 온전히 있다. 이 행은
 * 가리키는 자리이지 판정 근거가 아니다(#447 과 다른 점이다). 설계 문서 §4.4.
 */
const MAX_RECAP_TEXT_CHARS = 100;

/** 코드 포인트 기준으로 자른다. slice 는 서로게이트 페어를 쪼갠다. */
const clampRecapText = (escaped: string): string =>
  width(escaped) <= MAX_RECAP_TEXT_CHARS
    ? escaped
    : `${Array.from(escaped)
        .slice(0, MAX_RECAP_TEXT_CHARS - 1)
        .join("")}…`;

/**
 * 케이스 블록이 그 케이스에 대해 찍은 줄 중 가장 구체적인 하나를 고른다. 설계 문서 §4.3.
 *
 * **새 문안을 만들지 않는다.** 고르기만 한다. `message` 는 판정의 참거짓만 말하는 고정 문안인
 * 경우가 많아(`IS_ERROR_MISMATCH`) 실패 12건이 전부 같은 문장이 된다. 서버가 준 이유와 우리가
 * 낸 위반이 케이스를 구분하므로 그쪽을 먼저 본다(ADR-0027 의 순서와 같다).
 *
 * 반환값은 이스케이프하지 않은 원문이다. 이스케이프는 호출부가 한다.
 */
const recapText = (result: TestCaseResult): string | undefined => {
  const source =
    result.operation.diagnostic ??
    result.assertions.find((assertion) => assertion.status === "failed" && isDrawn(assertion))
      ?.diagnostic;
  if (source === undefined) return undefined;
  return source.violations?.[0]?.message ?? source.notes?.[0] ?? source.message;
};

/**
 * 실패한 케이스만 모은 절. 설계 문서 §4.
 *
 * **0건이면 아무 줄도 안 낸다.** 거절 고지·크기 고지와 같은 규칙이고, 그래야 전부 통과한
 * 실행의 출력이 이 변경 전과 바이트 그대로다.
 *
 * 반환 배열은 머리글, 행들, 빈 줄 하나로 끝난다. 그 빈 줄이 요약 줄과의 간격이다.
 */
const failedRecapLines = (report: RunnerReport, color: boolean): readonly string[] => {
  const members = report.cases.filter((result) => RECAP_STATUSES.has(result.status));
  if (members.length === 0) return [];
  // 이스케이프한 뒤의 폭으로 열을 맞춘다. 절에 실린 케이스끼리만 맞춘다(§4.2).
  const idColumn = members.reduce(
    (max, result) => Math.max(max, width(escapeTerminalText(result.spec.id))),
    0,
  );
  return [
    RECAP_HEADING,
    ...members.map((result) => {
      const mark = sgr(MARKS[result.status].sgr, MARKS[result.status].glyph, color);
      const id = pad(escapeTerminalText(result.spec.id), idColumn);
      const text = recapText(result);
      return text === undefined
        ? `${RECAP_INDENT}${mark} ${id}`
        : `${RECAP_INDENT}${mark} ${id}${GAP}${bulletBody(clampRecapText(escapeTerminalText(text)))}`;
    }),
    "",
  ];
};
```

`renderReport` 의 꼬리는 한 줄이 는다.

```ts
  lines.push("");
  if (report.stopReason !== undefined) {
    lines.push(stopReasonLine(report.stopReason, escapeTerminalText));
    lines.push("");
  }
  lines.push(...failedRecapLines(report, color));
  lines.push(summaryLine(report.summary));
  lines.push(...rejectionNoticeLines(report.summary));
  lines.push(...payloadNoticeLines(report.payload));
```

### 5.4 출력 예시

`mcp-server-git` 교정 전(리허설 §2)에 해당하는 형태다.

```
git 스위트  (59 cases)

✓ git-init-success        git_init가 오류 없이 응답한다
✗ git-status-success      git_status가 오류 없이 응답한다
    isError  정상 응답을 기대했지만 오류 응답을 받았습니다.
    → Repository path 'example' is outside the allowed repository '/tmp/mcpeak-rehearsal/git-sandbox'
    해결: 툴 입력값과 서버의 오류 응답을 확인하세요.
...

실패한 케이스
  ✗ git-status-success  → Repository path 'example' is outside the allowed repository '/tmp/mcp…
  ✗ git-diff-success    → Repository path 'example' is outside the allowed repository '/tmp/mcp…
  ✗ git-add-success     → Repository path 'example' is outside the allowed repository '/tmp/mcp…

47 passed, 12 failed  (59 total)
```

## 6. 다른 소비자에게 미치는 영향

### 6.1 같은 패키지 안

- `packages/runner/src/junit.ts` 는 `renderReport` 를 부르지 않고 `RunnerReport` 를 직접 읽는다.
  XML 은 바뀌지 않는다.
- `packages/runner/tests/report-payload-notice.test.ts` 는 `toContain` 과 요약 줄 대비 상대
  순서만 본다. 절이 요약 줄 앞에 오므로 수정이 필요 없다.
- `packages/runner/tests/reporter.test.ts` 의 exact 단언 중 **실패·타임아웃 케이스를 담은
  것**은 기대 문자열에 절이 추가되어야 한다. 이것이 이 작업 분량의 대부분이다.

### 6.2 `cli` 를 고치지 않아도 되는 근거

`cli` 는 `renderReport` 출력을 두 곳에서 **문자열로 파싱**한다. 둘 다 영향이 없다.

- `packages/cli/src/dry-run.ts:91-99` 의 `caseBlocks` 는 출력의 첫 두 줄을 버린 뒤
  **처음 만나는 빈 줄에서 `break` 한다.** 그 빈 줄은 케이스 목록 끝의 기존 빈 줄이고, 절은
  그보다 뒤에 생긴다. 루프가 절에 닿지 않는다.
- `packages/cli/src/repair-target.ts:47-70` 은 `caseBlocks` 가 잘라 준 케이스 본문만 받는다.
  절의 문자열이 그 안에 들어갈 경로가 없다.

`packages/cli/src/test-command.ts:1562` 는 텍스트 분기에서만 `renderReport` 를 부른다.
`--json` 분기(`test-command.ts:1559`)는 `JSON.stringify` 로 간다. C9 가 여기서 성립한다.

### 6.3 `dashboard`

`packages/dashboard/src/server/wiring.ts:133` 이 `renderReport` 를 그대로 물리고 `colorEnabled`
가 항상 참이다. 절이 HTML 화면에도 그대로 나오고, 새 SGR 코드를 만들지 않으므로
`ansiToHtml` 이 이미 아는 코드만 온다. 코드 변경이 필요 없다.

## 7. 실환경 검증

유닛테스트는 인메모리와 `fixtures/` 만 쓴다. 실서버 확인은 직렬 웨이브로 분리한다.

프리플라이트(읽기 전용)로 먼저 확인한다.

1. `uvx mcp-server-git --help` 가 도는가.
2. `docs/2026-09-10-데모-리허설-런북.md` §2 의 샌드박스 초기화 스크립트를 두 번 돌려
   `git rev-parse HEAD` 가 같은가.

그다음 런북 §2 의 **교정 전** 상태(값을 고치지 않은 명세)로 `test` 를 돌려 아래를 확인한다.

- 절이 화면에 나온다.
- 절의 행 수가 12다.
- 각 행이 `Repository path 'example' is outside…` 를 담는다.
- 요약 줄이 절 바로 다음 줄이다.
- 값을 고친 뒤 다시 돌리면 `59 passed  (59 total)` 이고 절이 **없다**.

샌드박스는 저장소 밖 임시 디렉터리에 만들고 쓰기는 그 안에서만 한다. 저장소 파일을 바꾸지
않으므로 백업이 필요 없다.

## 8. 거짓 신호

`CLAUDE.local.md` 의 표에서 이 작업에 실제로 걸릴 것들이다.

| 거짓 신호 | 이 작업에서의 모습 | 진실 기준 |
|---|---|---|
| `pnpm typecheck` 가 `Tasks: N successful` | turbo 캐시가 이전 녹색을 재생 | `--force` 로 돌리고 `Cached: 0 cached` 확인 |
| 유닛테스트 녹색, 실행 시 실패 | 픽스처만 검증했다 | §7 의 실서버 확인 |
| 결함이 계속 재현 | `dist` 가 낡았다 | `pnpm build --force` 후 다시 |
| 테스트 녹색인데 typecheck 만 빨강 | `RECAP_STATUSES` 가 상태 유니온을 손으로 복제한다 | `TestCaseResult["status"]` 를 그대로 참조한다. 이미 §5.3 이 그렇게 적었다 |

## 9. ADR 초안

`docs/adr/0092-실패-요약-절은-요약-줄-앞에-두고-가장-구체적인-진단-줄을-옮긴다.md`

- **배경**: 케이스가 수십 개인 서버에서 실패가 통과 줄 사이에 묻힌다(#446).
- **선택지**: 절을 요약 줄 앞 / 뒤 / 모든 고지 뒤. 행에 `message` / 가장 구체적인 줄.
- **결정**: 요약 줄 앞. 행에는 `violations[0]` → `notes[0]` → `message` 순으로 고른 한 줄.
- **이유**: 요약 줄 뒤에 두면 거절 근거 미확인 고지가 실패 목록의 각주로 읽힌다. `message` 만
  실으면 `IS_ERROR_MISMATCH` 실패 여러 건이 같은 문장으로 채워져 케이스를 구분하지 못한다.
- **결과**: 요약 줄 이후 출력이 바이트 그대로다. `cancelled` · `notRun` 은 절에 넣지 않는다.
  `위반 N건` 같은 총량은 요약 행에서 빠지고 케이스 블록에서만 읽는다. 행의 글은 100자에서
  잘린다.

## 10. 소유권

`pkg:runner` 하나다. `packages/runner/src/reporter.ts`, `packages/runner/tests/reporter.test.ts`,
렌더링 설계 문서, ADR, changeset 이 전부다. `core/src/types.ts` 를 건드리지 않고 의존 방향도
바뀌지 않는다. 새 의존성이 없다.
