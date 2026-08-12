# ADR-0006: 결정론적 baseline과 AI 테스트 후보의 공존 방식

- 상태: 승인
- 날짜: 2026-08-12
- 담당: generate
- 상세 설계: [AI 보조 테스트 작성·반복 검토 설계](../superpowers/specs/2026-08-12-ai-assisted-test-authoring-design.md)

## 배경

스키마 기반 생성기는 도구마다 재현 가능한 happy-path를 만들 수 있지만, 유효한 도메인 값,
비정상 입력, 비즈니스 규칙을 알 수 없다. Codex와 Claude는 의미 있는 후보를 제안할 수 있지만 결과가
비결정적이고, 기존 case를 누락하거나 지원하지 않는 assertion과 비밀값을 만들 수 있다.

사용자는 최초 AI 결과만 검토하는 것이 아니라 검토 중에도 추가·수정을 다시 요청할 수 있어야 한다.
이때 승인된 테스트와 AI가 수정 중인 후보를 섞으면 어느 내용이 실제 실행 대상인지 알기 어렵다.

## 선택지

- A안: AI 결과가 결정론적 엔진 결과를 바로 교체한다.
- B안: AI가 JSON Patch를 반환하고 이를 승인 draft에 직접 적용한다.
- C안: 엔진 baseline, 승인 draft, AI working candidate를 분리하고 로컬에서 diff를 계산한다.
- D안: AI는 설명만 제공하고 테스트 변경은 전부 사용자가 직접 작성한다.

## 결정

C안을 채택한다.

결정론적 엔진 결과는 최초 `approvedDraft`가 되는 baseline이다. AI는 완전한 candidate suite를
구조화 출력으로 반환하지만 실행하거나 파일에 쓰지 않는다. 로컬 코드가 candidate와 승인 draft를
비교해 추가·교체·삭제·순서 변경 diff를 만들고, 사용자가 선택해 승인한 변경만 새 revision에
적용한다.

검토 중 AI 재호출은 provider session을 resume하지 않는 새 요청이다. 현재 working candidate,
baseline, 새 사용자 피드백과 제한된 툴 정의를 정제한 뒤 다시 전송한다. 매 호출은 전송 preview와
승인을 요구한다. provider 결과 적용과 최종 실행 snapshot도 별도 승인을 요구한다.

provider 실행은 사용자가 설치·인증한 Codex 또는 Claude CLI를 빈 임시 cwd에서 비대화형으로
수행한다. stdin, 구조화 출력, 도구·MCP·파일 쓰기 차단, 환경변수 allowlist, byte 제한,
timeout·취소·bounded 종료를 사용한다. 자동 재시도와 provider fallback은 하지 않는다.

## 이유

baseline은 스키마에서 확실히 아는 최소 사실을 보존한다. working candidate를 분리하면 사용자가 AI에
여러 번 수정을 요청해도 승인된 실행 대상이 바뀌지 않는다. 전체 candidate에서 로컬 diff를 만들면
AI가 선언한 patch 경로나 change 설명을 신뢰할 필요가 없고, 누락된 baseline case도 명시적인 삭제로
표시할 수 있다.

stateless 재호출은 비용이 조금 더 들지만 provider별 session 저장과 resume 의미에 의존하지 않으며,
매 요청에서 실제 전송 데이터를 검토할 수 있다. 사용자 계정의 CLI를 격리 실행하면 별도 API key
관리 없이 두 provider를 같은 공통 계약으로 사용할 수 있다.

## 결과

- `generate`는 baseline 합성뿐 아니라 authoring 상태, diff, 승인 binding과 provider adapter를
  소유한다.
- `generate → runner` 의존을 허용하고 Runner의 명세 타입·Schema·validator를 복사하지 않는다.
- CLI는 provider 선택, preview·diff 표시, 승인과 최종 JSON 저장을 담당하는 얇은 조립 계층이다.
- AI 후보, 질문, 실패와 거절은 승인 draft revision을 바꾸지 않는다.
- 최종 JSON suite에는 provider, provenance, revision 같은 authoring metadata를 넣지 않는다.
- 첫 버전은 메모리 세션만 제공하며 raw prompt와 raw provider 출력을 기본 저장하지 않는다.
