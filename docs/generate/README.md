# generate 문서

스키마에서 명세 생성 · AI provider 호출

이 폴더는 `generate` 에 속하는 설계 문서, 구현 계획, 작업 보고서를 모아 둡니다. ADR 본문은 번호가 전역이라 [`docs/adr/`](../adr/) 에 그대로 있고, 아래 표는 그중 `generate` 담당분만 고른 것입니다.

## ADR

| 번호 | 주제 | 담당 | 상태 |
|---|---|---|---|
| [0004](../adr/0004-generation-scope.md) | 생성 테스트의 자동화 범위 | generate | 제안 |
| [0006](../adr/0006-ai-assisted-test-authoring.md) | 결정론적 baseline과 AI 테스트 후보의 공존 방식 | generate | 승인 |
| [0007](../adr/0007-provider-전송-스키마-분리.md) | provider 전송 스키마를 로컬 검증 스키마와 분리한다 | generate | 제안 |
| [0008](../adr/0008-승인-화면-redaction-범위.md) | 승인 화면 redaction 범위를 넓히지 않는다 | generate, cli | 제안 |
| [0009](../adr/0009-generate가-runner에-의존하는-예외.md) | `generate`가 `runner`에 의존하는 예외를 명시적으로 승인한다 | generate, runner | 채택 |
| [0018](../adr/0018-입력-계약-대조-소비자-배선.md) | 입력 계약 대조는 값 치환 이전에 돌리고, 위반은 거부가 아니라 재확인으로 다룬다 | generate, cli | 제안 |
| [0022](../adr/0022-위반-케이스-생성-정책.md) | 위반 케이스는 기본으로, 필드마다, 상한 없이 만든다 | generate | 채택 |
| [0032](../adr/0032-미승인-명세에서의-repair-동작.md) | 미승인 명세에서 `repair` 는 차단하지 않고 전제를 바꾼다 | cli, generate | 채택 |
| [0033](../adr/0033-stderr-외부-전송-경계.md) | stderr 는 치환하지 않고 확인·상한·옵트아웃으로 다룬다 | cli, generate | 채택 |
| [0034](../adr/0034-provider-진단-통로-분리.md) | provider 진단 통로를 authoring 통로와 분리한다 | generate, cli | 채택 |
| [0036](../adr/0036-미지원-스키마-툴의-부분-생성.md) | 미지원 스키마 툴은 건너뛰고 나머지를 생성한다 | generate, cli | 제안 |
| [0049](../adr/0049-provider-자유-텍스트-값-치환-경계.md) | provider 로 보내는 자유 텍스트에는 값 치환을 적용하지 않는다 (ADR-0033 확장) | generate, cli | 채택 |
| [0064](../adr/0064-사전보완-제안-값을-json-문자열로-받는다.md) | 사전보완 제안 값을 JSON 문자열로 받는다 | generate | 채택 |
| [0065](../adr/0065-옵션-이름은-stderr-가-아니라-우리-args-에서-고른다.md) | 옵션 이름은 stderr 가 아니라 우리 args 에서 고른다 | generate, cli | 채택 |
| [0079](../adr/0079-claude-safe-mode-호환성.md) | Claude provider는 `--safe-mode` 없이 공통 지원 인자로 실행한다 | generate | 채택 |
| [0086](../adr/0086-조합-참조-pattern-스키마는-갈래를-골라-합성한다.md) | 조합·참조·pattern 스키마는 갈래를 골라 합성하고 미지원 갈래만 건너뛴다 | generate | 제안 |
| [0087](../adr/0087-임의-키-맵은-빈-객체로-합성하고-키-이름만-검사한다.md) | 임의 키 맵은 빈 객체로 합성하고 후보값의 키 이름만 검사한다 | generate | 제안 |
| [0090](../adr/0090-오라클-자격은-지문과-실행-기록의-합의다.md) | 오라클 자격은 지문과 실행 기록의 합의다 | generate · cli | 제안 |

## 설계 · 조사 · 인수인계

- [2026-09-08-generate-스키마-키워드-확장-설계.md](./2026-09-08-generate-스키마-키워드-확장-설계.md)
- [2026-09-12-generate-승인-화면은-실패한-케이스만-AI-에-보낸다-설계.md](./2026-09-12-generate-승인-화면은-실패한-케이스만-AI-에-보낸다-설계.md)
- [2026-09-13-generate-화면은-제안-값과-실패-근거를-감추지-않는다-설계.md](./2026-09-13-generate-화면은-제안-값과-실패-근거를-감추지-않는다-설계.md)
- [2026-09-13-범위-위반은-상한과-하한을-따로-검증한다-설계.md](./2026-09-13-범위-위반은-상한과-하한을-따로-검증한다-설계.md)
- [2026-09-13-생성용-픽스처-계약-설계.md](./2026-09-13-생성용-픽스처-계약-설계.md)
- [2026-09-13-정상-입력도-분기를-밟는다-설계.md](./2026-09-13-정상-입력도-분기를-밟는다-설계.md)
- [2026-09-13-중첩-필드도-계약-축을-가진다-설계.md](./2026-09-13-중첩-필드도-계약-축을-가진다-설계.md)
- [2026-09-13-후보-비교와-최종-검증은-같은-초기-상태에서-한다-설계.md](./2026-09-13-후보-비교와-최종-검증은-같은-초기-상태에서-한다-설계.md)
- [ai-provider-schema-compatibility.md](./ai-provider-schema-compatibility.md)

## 설계 명세 (specs)

- [2026-08-12-ai-assisted-test-authoring-design.md](./specs/2026-08-12-ai-assisted-test-authoring-design.md)
- [2026-08-14-approval-fingerprint-design.md](./specs/2026-08-14-approval-fingerprint-design.md)
- [2026-08-14-spec-findings-wiring-design.md](./specs/2026-08-14-spec-findings-wiring-design.md)
- [2026-08-15-dry-run-input-repair-design.md](./specs/2026-08-15-dry-run-input-repair-design.md)
- [2026-08-17-schema-constraint-support-design.md](./specs/2026-08-17-schema-constraint-support-design.md)
- [2026-09-09-repair-spec-oracle-design.md](./specs/2026-09-09-repair-spec-oracle-design.md)

## 구현 계획 (plans)

- [2026-08-12-ai-assisted-test-authoring-implementation.md](./plans/2026-08-12-ai-assisted-test-authoring-implementation.md)
- [2026-08-12-ai-assisted-test-authoring-ledger.tsv](./plans/2026-08-12-ai-assisted-test-authoring-ledger.tsv)
- [2026-08-12-ai-provider-호출-복구-구현계획.md](./plans/2026-08-12-ai-provider-호출-복구-구현계획.md)
- [2026-08-14-approval-fingerprint.md](./plans/2026-08-14-approval-fingerprint.md)
- [2026-08-14-spec-findings-wiring-implementation.md](./plans/2026-08-14-spec-findings-wiring-implementation.md)
- [2026-08-15-dry-run-input-repair-implementation.md](./plans/2026-08-15-dry-run-input-repair-implementation.md)
- [2026-08-17-schema-constraint-support-implementation.md](./plans/2026-08-17-schema-constraint-support-implementation.md)
- [2026-09-08-generate-스키마-키워드-확장-구현계획.md](./plans/2026-09-08-generate-스키마-키워드-확장-구현계획.md)
- [2026-09-09-repair-spec-oracle-implementation.md](./plans/2026-09-09-repair-spec-oracle-implementation.md)
- [2026-09-12-generate-거절-진단-옵션화와-사전보완-요약-구현계획.md](./plans/2026-09-12-generate-거절-진단-옵션화와-사전보완-요약-구현계획.md)
- [2026-09-13-generate-화면은-제안-값과-실패-근거를-감추지-않는다-구현계획.md](./plans/2026-09-13-generate-화면은-제안-값과-실패-근거를-감추지-않는다-구현계획.md)
- [2026-09-13-동일-초기-상태-검증-구현계획.md](./plans/2026-09-13-동일-초기-상태-검증-구현계획.md)
- [2026-09-13-범위-위반-상하한-분리-구현계획.md](./plans/2026-09-13-범위-위반-상하한-분리-구현계획.md)
- [2026-09-13-생성용-픽스처-계약-구현계획.md](./plans/2026-09-13-생성용-픽스처-계약-구현계획.md)
- [2026-09-13-정상-입력-분기-구현계획.md](./plans/2026-09-13-정상-입력-분기-구현계획.md)
- [2026-09-13-중첩-필드-계약-축-구현계획.md](./plans/2026-09-13-중첩-필드-계약-축-구현계획.md)

## 작업 보고서 (reports)

24 건. [reports/](./reports/) 폴더에 있습니다.
