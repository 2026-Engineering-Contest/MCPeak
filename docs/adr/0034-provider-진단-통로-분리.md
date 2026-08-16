# ADR-0034: provider 진단 통로를 authoring 통로와 분리한다

- 상태: 채택
- 날짜: 2026-08-16
- 담당: generate, cli
- 작성자: @seodduu (cli 파트)
- 승인: 승인 (2026-08-16, @seodduu)
- 참조: `docs/adr/0007-provider-전송-스키마-분리.md`,
  `docs/adr/0009-generate가-runner에-의존하는-예외.md`,
  `docs/adr/0025-시험-실행-입력값-교정-권한-경계.md`,
  `docs/superpowers/specs/2026-08-16-server-repair-design.md` §5.1·§5.2

## 배경

`ohmymcp repair` 는 실패한 테스트 실행을 근거로 **서버 코드의 원인 후보**를 AI 에게 묻는다.
`generate` 에는 이미 provider 로 나가는 통로가 하나 있다. 테스트 명세를 짓는 authoring
통로다(`prepareAuthoringRequest` · `dispatchAuthoringRequest` · `PROVIDER_OUTPUT_SCHEMA`).
둘 다 "외부 CLI 에게 JSON 을 물어본다" 는 점이 같아서 재사용이 자연스러워 보인다.

## 선택지

- C1: authoring 통로를 재사용한다. 요청 타입에 실패 목록을 더하고 출력 스키마를 넓힌다.
- C2: 진단 전용 통로를 새로 만든다. 요청·출력 스키마·프롬프트·검증을 따로 둔다.
- C3: 통로는 하나로 두고 프롬프트만 갈래로 나눈다.

## 결정

C2 를 채택한다. `generate` 안에 진단 전용 통로를 둔다. `DiagnosisRequest`,
`DIAGNOSIS_PROVIDER_SCHEMA`, `diagnosisPrompt`, `prepareDiagnosisRequest`,
`validateDiagnosisResult`, `dispatchDiagnosisRequest` 가 그것이다. authoring 통로의 타입과
스키마는 한 글자도 안 바꾼다.

## 이유

**출력 스키마가 명세를 담을 수 있으면 AI 가 명세를 고쳐 온다.** authoring 의
`PROVIDER_OUTPUT_SCHEMA` 는 `suiteJson` 을 필수로 요구한다. 그 통로로 "서버 원인을 말하라" 고
물으면 모델이 낼 수 있는 가장 쉬운 답은 **서버에 맞춰 고친 명세**다. 그것은 서버 버그를 정답으로
굳히는 것이고, 단계 3 승인 게이트의 존재 이유를 정면으로 무너뜨린다.

C1 으로 그것을 막으려면 `acceptProposal`(ADR-0025) 급의 권한 경계 검사를 또 한 벌 써야 한다.
전용 통로는 그 경로가 **구조적으로 없다.** 진단 출력 스키마에는 명세를 담을 칸이 아예 없다.
방어 코드가 필요 없는 쪽이 방어 코드를 쓰는 쪽보다 작다.

C3 은 프롬프트 안에 모순을 만든다. authoring 의 고정 지침은 "TestSuiteSpec 만 사용해 candidate
를 작성한다" 로 시작한다. 그 문장 뒤에 "명세를 고치지 마라" 를 붙이는 것은 같은 프롬프트가 두
가지를 동시에 요구하는 것이다.

## 결과

- `generate` 의 공개 API 가 늘었다. 진단 통로의 함수와 타입 전부를 `index.ts` 가 내보낸다.
  `cli` 는 그것만 보고 `repair` 를 만든다.
- 두 통로가 실행 경로는 공유한다. `makeProvider` 가 돌려주는 객체에 `diagnose` 를 **추가**했고,
  모델·env allowlist·샌드박스 설정은 한 벌뿐이다. claude envelope 해석도
  `claudeStructuredOutput` 한 곳을 둘이 함께 쓴다. 규칙이 갈라지면 한쪽만 고쳐지는 사고가 난다.
- provider 실패 매핑도 한 벌이다. 처음에는 진단 쪽에 사본을 뒀는데 닫힌 enum 목록이 두 벌이
  되어 한쪽만 늘어날 여지가 생겼다. `publicProviderFailure` 를 `authoring-request.ts` 에서
  내보내 합쳤다.
- 진단 통로는 `runner` 에서 새 심볼을 가져오지 않는다. `JsonValue` 는 `generate` 안의 로컬
  정의를 쓴다. ADR-0009 의 승인 심볼 목록을 넓히지 않기 위한 선택이고, 두 정의는 구조적으로
  같다.
- `cli` 는 `repair` 경로에서만 `generate` 를 동적 import 한다. `test` 경로는 지금처럼 `core` 와
  `runner` 만 로드한다. 파싱 기본값도 값 import 를 피하려고 `cli` 안에 상수로 두고, 두 상수가
  같은지는 테스트가 직접 단언한다.
