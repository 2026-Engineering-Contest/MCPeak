# runner 문서

명세 실행 · matcher · 리포터

이 폴더는 `runner` 에 속하는 설계 문서, 구현 계획, 작업 보고서를 모아 둡니다. ADR 본문은 번호가 전역이라 [`docs/adr/`](../adr/) 에 그대로 있고, 아래 표는 그중 `runner` 담당분만 고른 것입니다.

## ADR

| 번호 | 주제 | 담당 | 상태 |
|---|---|---|---|
| [0002](../adr/0002-matcher-strategy.md) | matcher를 독립 구현으로 유지하고 외부 테스트 러너 확장은 제공하지 않는다 | runner | 채택 |
| [0009](../adr/0009-generate가-runner에-의존하는-예외.md) | `generate`가 `runner`에 의존하는 예외를 명시적으로 승인한다 | generate, runner | 채택 |
| [0010](../adr/0010-응답-스키마-부분집합-경계.md) | 응답 스키마는 JSON Schema의 고정된 부분집합만 지원한다 | runner | 제안 |
| [0011](../adr/0011-응답-본문-추출-규칙.md) | 응답 본문은 JSON 객체와 배열만 구조로 해석한다 | runner | 제안 |
| [0013](../adr/0013-렌더러-배치와-진단-무분기.md) | 렌더러 배치와 진단 무분기 | runner | 초안 |
| [0015](../adr/0015-입력-스키마-부분집합-경계.md) | 서버 입력 스키마는 해석 가능한 부분집합만 검사하고 나머지는 침묵한다 | runner | 제안 |
| [0016](../adr/0016-junit-time-속성-고정.md) | JUnit XML 의 `time` 속성을 `0` 으로 고정한다 | runner | 채택 |
| [0021](../adr/0021-거절-기대-케이스의-입력-계약-대조-제외.md) | 거절을 기대하는 케이스는 입력 계약 대조에서 제외한다 | runner | 채택 |
| [0024](../adr/0024-케이스-분류-저장-위치.md) | 케이스 분류는 `approval.cases` 에 저장하고 `test` 는 참고 문장으로만 쓴다 | cli, runner | 채택 |
| [0027](../adr/0027-isError-진단의-서버-응답-본문.md) | `isError` 진단이 서버 응답 본문을 함께 싣는다 | runner, cli | 채택 |
| [0038](../adr/0038-결정론성-확인의-비교-대상과-캡처-위치.md) | 결정론성 확인은 케이스별 구조화 비교로 하고, 응답 캡처는 CLI 래퍼가 한다 | runner, cli | 제안 |
| [0060](../adr/0060-MCPeak-목의-inputSchema-거절을-접미어로-확인한다.md) | MCPeak 목의 `inputSchema` 거절을 고정 접미어로 확인한다 | runner | 채택 |
| [0067](../adr/0067-결정론성-힌트는-패턴-존재가-아니라-값-변화로-판정한다.md) | 결정론성 힌트는 패턴 존재가 아니라 값 변화로 판정한다 | runner | 채택 |
| [0073](../adr/0073-연결이-끝나면-남은-케이스를-부르지-않는다.md) | 연결이 끝나면 남은 케이스를 부르지 않는다 | runner | 채택 |
| [0075](../adr/0075-실패-안내는-오류를-낸-층이-갖는다.md) | 실패 안내는 오류를 낸 층이 갖고, 러너는 그것을 덮지 않는다 | runner | 채택 |
| [0078](../adr/0078-명세-검증-문안은-코드별-표가-갖고-호출-지점이-문맥을-얹는다.md) | 명세 검증 문안은 코드별 표가 갖고, 호출 지점이 문맥을 얹는다 | runner | 제안 |
| [0082](../adr/0082-runner-의-민감-키-판정을-record-와-같은-접미-단어열-규칙으로-맞춘다.md) | runner 의 민감 키 판정을 record 와 같은 접미 단어열 규칙으로 맞춘다 | runner | 제안 |
| [0083](../adr/0083-보고서-크기-고지는-report-필드로-싣고-넣기-전-크기를-적는다.md) | 보고서 크기 고지는 report 필드로 싣고 넣기 전 크기를 적는다 | runner, cli | 제안 |
| [0092](../adr/0092-실패-요약-절은-요약-줄-앞에-두고-가장-구체적인-진단-줄을-옮긴다.md) | 실패 요약 절은 요약 줄 앞에 두고 가장 구체적인 진단 줄을 옮긴다 | runner | 제안 |
| [0098](../adr/0098-generate-승인-화면은-실패한-케이스만-AI-에-보낸다.md) | generate 승인 화면은 실패한 케이스만 AI 에 보낸다 | cli, runner | 제안 |

## 설계 · 조사 · 인수인계

- [2026-08-11-runner-session-handoff.md](./2026-08-11-runner-session-handoff.md)
- [2026-08-18-rejection-basis-session-handoff.md](./2026-08-18-rejection-basis-session-handoff.md)

## 설계 명세 (specs)

- [2026-08-11-runner-design.md](./specs/2026-08-11-runner-design.md)
- [2026-08-13-response-body-assertion-design.md](./specs/2026-08-13-response-body-assertion-design.md)
- [2026-08-14-input-contract-check-design.md](./specs/2026-08-14-input-contract-check-design.md)
- [2026-08-15-contract-axis-coverage-design.md](./specs/2026-08-15-contract-axis-coverage-design.md)
- [2026-08-15-iserror-response-body-design.md](./specs/2026-08-15-iserror-response-body-design.md)
- [2026-08-18-rejection-basis-verification-design.md](./specs/2026-08-18-rejection-basis-verification-design.md)
- [2026-09-10-failed-case-recap-design.md](./specs/2026-09-10-failed-case-recap-design.md)

## 구현 계획 (plans)

- [2026-08-11-runner-implementation.md](./plans/2026-08-11-runner-implementation.md)
- [2026-08-13-response-body-assertion-implementation.md](./plans/2026-08-13-response-body-assertion-implementation.md)
- [2026-08-14-input-contract-check-implementation.md](./plans/2026-08-14-input-contract-check-implementation.md)
- [2026-08-15-contract-axis-coverage-implementation.md](./plans/2026-08-15-contract-axis-coverage-implementation.md)
- [2026-08-15-iserror-response-body-implementation.md](./plans/2026-08-15-iserror-response-body-implementation.md)
- [2026-08-18-rejection-basis-verification-implementation.md](./plans/2026-08-18-rejection-basis-verification-implementation.md)
- [2026-09-10-failed-case-recap-implementation.md](./plans/2026-09-10-failed-case-recap-implementation.md)

## 작업 보고서 (reports)

30 건. [reports/](./reports/) 폴더에 있습니다.
