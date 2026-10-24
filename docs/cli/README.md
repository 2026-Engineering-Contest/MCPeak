# cli 문서

mcpeak 명령 진입점 · 시험 실행 · repair

이 폴더는 `cli` 에 속하는 설계 문서, 구현 계획, 작업 보고서를 모아 둡니다. ADR 본문은 번호가 전역이라 [`docs/adr/`](../adr/) 에 그대로 있고, 아래 표는 그중 `cli` 담당분만 고른 것입니다.

## ADR

| 번호 | 주제 | 담당 | 상태 |
|---|---|---|---|
| [0008](../adr/0008-승인-화면-redaction-범위.md) | 승인 화면 redaction 범위를 넓히지 않는다 | generate, cli | 제안 |
| [0012](../adr/0012-cli-기본-출력-전환.md) | CLI 기본 출력 전환 | cli | 초안 |
| [0014](../adr/0014-진단-출력-채널.md) | 진단 출력 채널 | cli | 초안 |
| [0017](../adr/0017-승인-지문-계산-범위.md) | 승인 지문은 파싱된 명세 객체에서 approval 블록을 통째로 뺀 값으로 계산한다 | cli | 제안 |
| [0018](../adr/0018-입력-계약-대조-소비자-배선.md) | 입력 계약 대조는 값 치환 이전에 돌리고, 위반은 거부가 아니라 재확인으로 다룬다 | generate, cli | 제안 |
| [0019](../adr/0019-junit-리포터-cli-노출-방식.md) | JUnit 리포터를 `--junit <path>` 로 노출한다 | cli | 채택 |
| [0023](../adr/0023-시험-실행-전-서버-초기화-훅.md) | 시험 실행 전 서버 초기화를 옵션 훅으로 제공한다 | cli | 채택 |
| [0024](../adr/0024-케이스-분류-저장-위치.md) | 케이스 분류는 `approval.cases` 에 저장하고 `test` 는 참고 문장으로만 쓴다 | cli, runner | 채택 |
| [0025](../adr/0025-시험-실행-입력값-교정-권한-경계.md) | 입력값 교정에서 AI 는 값 후보만 내고, 재시도 상한은 2회다 | cli | 채택 |
| [0026](../adr/0026-승인-지문-표시-시점.md) | 승인 지문은 시험 실행과 분류가 끝난 뒤에 표시한다 | cli | 채택 |
| [0027](../adr/0027-isError-진단의-서버-응답-본문.md) | `isError` 진단이 서버 응답 본문을 함께 싣는다 | runner, cli | 채택 |
| [0028](../adr/0028-replay-서브커맨드의-서버-없는-실행.md) | `replay` 는 서버를 띄우지 않고, 더미 클라이언트는 `cli` 가 만든다 | cli, record | 제안 |
| [0031](../adr/0031-repair-번들과-json-분리.md) | repair 번들을 `--json` 보고서와 별도 파일로 만든다 | cli | 채택 |
| [0032](../adr/0032-미승인-명세에서의-repair-동작.md) | 미승인 명세에서 `repair` 는 차단하지 않고 전제를 바꾼다 | cli, generate | 채택 |
| [0033](../adr/0033-stderr-외부-전송-경계.md) | stderr 는 치환하지 않고 확인·상한·옵트아웃으로 다룬다 | cli, generate | 채택 |
| [0034](../adr/0034-provider-진단-통로-분리.md) | provider 진단 통로를 authoring 통로와 분리한다 | generate, cli | 채택 |
| [0036](../adr/0036-미지원-스키마-툴의-부분-생성.md) | 미지원 스키마 툴은 건너뛰고 나머지를 생성한다 | generate, cli | 제안 |
| [0037](../adr/0037-건너뛴-테스트의-ci-판정.md) | 설치로 해결되는 결핍 때문에 건너뛴 테스트는 CI 에서 실패로 올린다 | cli | 제안 |
| [0038](../adr/0038-결정론성-확인의-비교-대상과-캡처-위치.md) | 결정론성 확인은 케이스별 구조화 비교로 하고, 응답 캡처는 CLI 래퍼가 한다 | runner, cli | 제안 |
| [0046](../adr/0046-대시보드를-로컬-웹서버로-만든다.md) | 대시보드는 로컬 웹서버로 만들고 CLI 커맨드 함수를 재사용한다 | dashboard, cli | 제안 |
| [0049](../adr/0049-provider-자유-텍스트-값-치환-경계.md) | provider 로 보내는 자유 텍스트에는 값 치환을 적용하지 않는다 (ADR-0033 확장) | generate, cli | 채택 |
| [0051](../adr/0051-external-record-replay와-tool-카세트-경계-분리.md) | External Record/Replay와 기존 Tool 카세트의 경계를 분리한다 | record, cli, dashboard | 채택 |
| [0052](../adr/0052-coordinator가-engine과-session-store를-소유한다.md) | 부모 Coordinator가 Record/Replay Engine과 Session Store를 소유한다 | record, cli | 채택 |
| [0056](../adr/0056-node-sqlite-실험-경고를-external-사용자에게만-보인다.md) | `node:sqlite` 실험 경고는 External 사용자에게만 보이고, 그 이상 숨기지 않는다 | record, cli | 채택 |
| [0057](../adr/0057-external-어댑터는-global-fetch-까지만-가로챈다.md) | External 어댑터는 `globalThis.fetch` 까지만 가로채고, 범위 밖은 경고로 알린다 | record, cli | 채택 |
| [0058](../adr/0058-external-replay-miss-진단은-mcp-오류-채널을-타지-않는다.md) | External replay-miss 진단은 MCP 오류 채널을 타지 않는다 — 구조화된 값을 별도 stderr 블록으로 보여준다 | record, cli | 채택 |
| [0059](../adr/0059-tool-카세트를-제거한다.md) | Tool 카세트를 제거한다 (실행은 동결 이후, 표면 → 배선 → 구현 순서) | record, cli, dashboard | 채택 |
| [0062](../adr/0062-세션-본문의-url-은-지우지-않고-알린다.md) | 세션 본문의 URL 은 지우지 않고 알린다 | record, cli | 채택 |
| [0065](../adr/0065-옵션-이름은-stderr-가-아니라-우리-args-에서-고른다.md) | 옵션 이름은 stderr 가 아니라 우리 args 에서 고른다 | generate, cli | 채택 |
| [0066](../adr/0066-external-세션은-성공했을-때도-무엇을-했는지-말한다.md) | External 세션은 성공했을 때도 무엇을 했는지 말한다 | cli, record | 채택 |
| [0068](../adr/0068-재생-중-범위-밖-호출을-가로채지-않고-센다.md) | 재생 중 범위 밖 호출을 가로채지 않고 센다 | record, cli | 채택 |
| [0069](../adr/0069-녹화의-낡음은-시각을-보이되-판정하지-않는다.md) | 녹화의 낡음은 시각을 보이되 판정하지 않는다 | record, cli | 채택 |
| [0070](../adr/0070-원격-서버의-인증-헤더는-값이-아니라-환경변수-이름으로-받는다.md) | 원격 서버의 인증 헤더는 값이 아니라 환경변수 이름으로 받는다 | cli | 채택 |
| [0074](../adr/0074-시험-실행의-연결-상실은-진단-코드가-아니라-러너-신호로-판정한다.md) | 시험 실행의 연결 상실은 진단 코드가 아니라 러너 신호로 판정한다 | cli | 채택 |
| [0076](../adr/0076-대상-명령은-통과-인자로-받고-스위트-이름은-출력-파일명에서-뽑는다.md) | 대상 명령은 `--` 통과로 받고, 스위트 이름은 `--out` 파일명에서 뽑는다 | cli | 채택 |
| [0077](../adr/0077-서버-응답과-입력-계약-진단의-중복-억제.md) | 서버 응답과 입력 계약 진단은 확실히 같은 타입 위반일 때만 한 번 표시한다 | cli | 제안 |
| [0083](../adr/0083-보고서-크기-고지는-report-필드로-싣고-넣기-전-크기를-적는다.md) | 보고서 크기 고지는 report 필드로 싣고 넣기 전 크기를 적는다 | runner, cli | 제안 |
| [0088](../adr/0088-예제-서버는-정상값을-스키마-examples-로-선언하고-통제-변이로-검출력을-고정한다.md) | 예제 서버는 정상값을 스키마 `examples` 로 선언하고 통제 변이로 검출력을 고정한다 | examples · cli | 제안 |
| [0089](../adr/0089-시험-실행이-꺼지면-사전보완도-건너뛴다.md) | 시험 실행이 꺼지면 AI 사전보완도 건너뛴다 | cli | 제안 |
| [0090](../adr/0090-오라클-자격은-지문과-실행-기록의-합의다.md) | 오라클 자격은 지문과 실행 기록의 합의다 | generate · cli | 제안 |
| [0094](../adr/0094-녹화-완료-판정은-어댑터-동작으로만-정한다.md) | 녹화 완료 판정은 어댑터 동작으로만 정한다 | cli, record, dashboard | 제안 |
| [0095](../adr/0095-녹화-설정은-첫-가로챈-호출에서-소비하고-기록자는-하나로-고정한다.md) | 녹화 설정은 첫 가로챈 호출에서 소비하고 기록자는 하나로 고정한다 | record, cli | 제안 |
| [0097](../adr/0097-비밀값은-argv-가-아니라-환경변수로-넘기고-출처-인자는-가린다.md) | 비밀값은 argv 가 아니라 환경변수로 넘기고, 출처 인자는 가린다 | cli, record, dashboard | 제안 |
| [0098](../adr/0098-generate-승인-화면은-실패한-케이스만-AI-에-보낸다.md) | generate 승인 화면은 실패한 케이스만 AI 에 보낸다 | cli, runner | 제안 |
| [0099](../adr/0099-generate-화면은-제안-값과-실패-근거를-감추지-않는다.md) | generate 화면은 제안 값과 실패 근거를 감추지 않는다 | cli, dashboard | 제안 |
| [0103](../adr/0103-한-번에-검증은-승인-질문에-자동으로-답하고-생성과-실행을-잇는다.md) | 한 번에 검증은 승인 질문에 자동으로 답하고 생성과 실행을 잇는다 | cli, dashboard | 제안 |

## 설계 · 조사 · 인수인계

- [2026-09-13-repair-번들은-대조한-계약을-싣는다-설계.md](./2026-09-13-repair-번들은-대조한-계약을-싣는다-설계.md)

## 설계 명세 (specs)

- [2026-08-12-cli-test-command-design.md](./specs/2026-08-12-cli-test-command-design.md)
- [2026-08-13-cli-process-diagnostics-design.md](./specs/2026-08-13-cli-process-diagnostics-design.md)
- [2026-08-13-cli-report-rendering-design.md](./specs/2026-08-13-cli-report-rendering-design.md)
- [2026-08-15-dry-run-approval-gate-design.md](./specs/2026-08-15-dry-run-approval-gate-design.md)
- [2026-08-15-generate-out-precheck-design.md](./specs/2026-08-15-generate-out-precheck-design.md)
- [2026-08-16-server-repair-design.md](./specs/2026-08-16-server-repair-design.md)
- [2026-08-18-determinism-check-design.md](./specs/2026-08-18-determinism-check-design.md)
- [2026-09-09-pre-fill-no-dry-run-design.md](./specs/2026-09-09-pre-fill-no-dry-run-design.md)

## 구현 계획 (plans)

- [2026-08-12-cli-test-command-implementation.md](./plans/2026-08-12-cli-test-command-implementation.md)
- [2026-08-13-cli-process-diagnostics-implementation.md](./plans/2026-08-13-cli-process-diagnostics-implementation.md)
- [2026-08-13-cli-report-rendering-implementation.md](./plans/2026-08-13-cli-report-rendering-implementation.md)
- [2026-08-15-dry-run-approval-gate-implementation.md](./plans/2026-08-15-dry-run-approval-gate-implementation.md)
- [2026-08-15-generate-out-precheck-implementation.md](./plans/2026-08-15-generate-out-precheck-implementation.md)
- [2026-08-16-server-repair-implementation.md](./plans/2026-08-16-server-repair-implementation.md)
- [2026-08-18-determinism-check.md](./plans/2026-08-18-determinism-check.md)
- [2026-09-09-pre-fill-no-dry-run-implementation.md](./plans/2026-09-09-pre-fill-no-dry-run-implementation.md)
- [2026-09-13-repair-번들-계약-포함-구현계획.md](./plans/2026-09-13-repair-번들-계약-포함-구현계획.md)
- [2026-10-08-generate-show-도구별-요약-구현계획.md](./plans/2026-10-08-generate-show-도구별-요약-구현계획.md)

## 작업 보고서 (reports)

54 건. [reports/](./reports/) 폴더에 있습니다.
