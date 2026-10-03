# ADR-0110: 보안 탭의 점검은 run 으로 돌리고 화면 문장은 audit 가 만든다

- 상태: 제안
- 날짜: 2026-10-04
- 담당: dashboard
- 작성자: @seodduu
- 참조: ADR-0046, ADR-0091, ADR-0107, `docs/plans/2026-10-03-analyze-보안탭-구현계획.md` §3·§4.3·§4.4·§5.4,
  `docs/2026-10-03-analyze-로드맵.md` 단계 3b

## 배경

Analyze 의 보안 탭은 `mcpeak audit` 의 결과를 화면에 보인다. 판정은 CLI 와 같은 함수(`runAuditCommand`)가
하고 대시보드는 그 출력을 받기만 한다(ADR-0046). 남는 질문은 다섯이다. 점검을 어떻게 돌리는가, 그 실행을
무엇이라고 부르는가, 실행 이력에 싣는가, 결과를 어디에 두는가, 화면의 위치 문장과 격리 상태 문장을 누가
만드는가.

토큰 탭은 수 초 안에 끝나는 동기 `POST` 한 번이다. 보안 점검은 다르다. 격리 실행(`--sandbox`)은 이미지를
처음 만들 때 수 분이 걸리고, 그동안 CLI 는 진행 문장을 stderr 로 낸다. 그리고 리포트에는 서버가 보낸 글자
(도구 이름, 경로)가 실리는데, 그 글자에 보이지 않는 문자가 섞여 있을 수 있다.

## 선택지

| 항목 | 채택 | 버린 것 |
|---|---|---|
| 실행 방식 | run 으로 돌린다. `POST /api/analyze/security` 가 `{ runId }` 를 바로 돌려주고, 진행은 기존 `GET /api/runs/<id>/events`(SSE), 결과는 `GET /api/analyze/security/<id>` 로 받는다. 격리 없는 점검도 같은 길이다 | 토큰 탭처럼 동기 `POST`. 격리만 run 으로 가르는 것 |
| run 의 종류 | `RunSummary.flow` 를 `RunFlow = StartRunRequest["flow"] \| "audit"` 로 넓힌다. `StartRunRequest` 에는 넣지 않는다 | `StartRunRequest` 에 `audit` 을 넣는 것 |
| Runs 목록 | `GET /api/runs` 는 `flow === "audit"` 을 싣지 않는다 | 목록에 싣는 것 |
| 결과의 자리 | 라우트 모듈의 `WeakMap<RunHandle, SecuritySlot>` | `RunRegistry` 에 결과 필드를 더하는 것 |
| 위치·격리 문장 | `@mcpeak/audit` 가 `describeLocation`·`escapeInvisible` 을 내보내고 서버가 발견마다 `where`·`tool` 을 만들어 응답에 싣는다. 격리 상태 줄과 한계 문장은 `renderReport` 출력에서 줄 위치로 꺼낸다 | 웹이 `describeLocation` 과 숨은 문자 표를 복제하는 것. 웹이 `@mcpeak/audit` 를 값으로 import 하는 것 |

## 결정

- 점검은 `RunRegistry` 의 run 이다. `POST /api/analyze/security` 는 요청을 가둔 뒤(경로 가드, argv 가드) run 을
  시작하고 `{ runId }` 만 돌려준다. 거절하면 run 이 생기지 않는다.
- `RunFlow` 에만 `audit` 이 있다. `POST /api/runs` 로는 점검을 시작할 수 없다.
- `GET /api/runs` 목록에서 점검 run 을 뺀다. `GET /api/runs/<id>` 와 SSE 는 점검 run 에도 그대로 답한다.
  주소를 손으로 쳐서 실행 화면을 연 경우에 대비해 제목(`보안 점검`)과 집계 칸 조건만 맞춘다.
- 결과는 `routes.ts` 의 `WeakMap<RunHandle, SecuritySlot>` 에 둔다. run 과 수명이 같고 영속하지 않는다.
- 응답의 `views`(발견마다 `where`·`tool`·`toolIndex`), `sandboxLine`, `limits`, `rendered` 는 전부
  `@mcpeak/audit` 의 함수가 만든 글자다. 대시보드는 문장을 새로 쓰지 않는다. 그래서 `dashboard` 가
  `@mcpeak/audit` 를 직접 의존한다(아래 방향 직접 의존은 ADR-0091 이 허용한다).

## 이유

- 동기 `POST` 로 두면 격리 이미지를 처음 만드는 수 분 동안 화면이 멈춘 것처럼 보인다. 격리 실행만 run 으로
  가르면 화면이 상태 기계를 둘 갖게 된다. 한 길로 모으면 화면은 "시작, 진행, 결과" 하나만 안다.
- `StartRunRequest` 에 `audit` 을 넣으면 브라우저가 보낸 argv 가 `--baseline <경로>` 를 그대로 싣는다. 경로
  가드를 `wiring.ts` 안에서 다시 해야 하고, 결과를 맡길 자리가 `RunIo` 에 없다. 전용 경로는 점검 옵션을
  필드로 받아 서버가 argv 를 조립하므로 가드가 한 곳이다.
- 실행 화면(`RunView`)은 터미널 출력이 주인공이다. 점검 run 을 거기서 열면 진행 문장 몇 줄만 보이고 결과가
  없다. 토큰 분석도 이력에 남지 않는다.
- `RunRegistry` 에 결과 필드를 더하면 레지스트리가 flow 별 결과 타입을 알게 된다. `WeakMap` 은 레지스트리를
  건드리지 않고 같은 수명을 얻는다.
- 웹이 숨은 문자 표를 복제하면 두 표가 어긋나는 날 `get<U+200B>time` 이 화면에서 `gettime` 으로 보인다.
  숨은 문자를 찾아 주는 도구가 정작 그 문자를 숨기는 셈이다. 웹이 `@mcpeak/audit` 를 값으로 import 하면
  브라우저 번들에 서버 코드(Docker 백엔드)가 섞인다. 서버가 글자를 만들어 싣는 쪽이 둘 다 피한다.

## 결과

- 얻는 것: 화면의 상태 기계가 하나다. 위치 문장과 격리 상태 문장이 CLI 리포트와 글자 단위로 같다. 경로와
  argv 의 가드가 `prepareSecurityRun` 한 곳에 있다.
- 치르는 것: `sandboxLine` 과 `limits` 는 `renderReport` 의 줄 배치(둘째 줄, 마지막 빈 줄 뒤)에 기댄다. 그
  배치가 바뀌면 `packages/dashboard/tests/analyze-security.test.ts` 의 두 테스트가 빨개진다. 실제
  `renderReport` 를 쓰는 테스트라 조용히 어긋나지는 않는다.
- 치르는 것: 점검 결과는 메모리에만 있다. 대시보드 서버를 다시 시작하면 사라지고, 그때의
  `GET /api/analyze/security/<id>` 는 다시 점검하라는 문장과 함께 404 다.
- 치르는 것: "언제 무엇을 점검했는지" 가 이력에 남지 않는다. 목록에 싣기로 바꾸려면 `GET /api/runs` 의 filter
  한 줄을 빼고, 실행 화면이 점검 run 을 열었을 때 보안 탭으로 보내는 링크를 더하는 후속이 필요하다(계획서
  §11-1).
- `dependency-boundary.test.ts` 의 `dashboard` 허용 목록에 `audit` 가 들어간다.
