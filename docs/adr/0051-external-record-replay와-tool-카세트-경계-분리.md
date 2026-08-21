# ADR-0051: External Record/Replay와 기존 Tool 카세트의 경계를 분리한다

- 상태: 제안
- 날짜: 2026-08-21
- 담당: record, cli, dashboard
- 작성자: @ddxng5 (② replay/record 파트)
- 승인: 미승인
- 참조:
  [ADR-0003](./0003-cassette-matching-key.md),
  [ADR-0028](./0028-replay-서브커맨드의-서버-없는-실행.md)

## 배경

현재 `@mcpeak/record`는 `McpClient`를 `cassetteClient`로 감싼다. 매칭 키는 MCP Tool
이름과 Tool 인자이고, 저장 값은 `ToolResult`다. Replay는 실제 MCP 서버를 실행하지 않고
카세트의 Tool 응답을 Runner에 직접 반환한다. ADR-0003과 ADR-0028이 이 의미를 정했다.

새 External Record/Replay 설계에서 경계는 다르다. 실제 MCP 서버는 Record와 Replay 모두
실행하고, 그 서버 코드가 내보내는 HTTP·DB 같은 외부 호출만 기록하거나 저장된 결과로 대체한다.
매칭 키도 Tool 이름이 아니라 정규화된 외부 요청에서 만든다.

두 기능은 이름만 비슷할 뿐 기록 단위, Replay 수명주기, 저장 형식, 실패 의미가 다르다. 기존
`Cassette`에 외부 interaction을 더하거나 `cassetteClient`에 외부 모드 분기를 넣으면 다음 문제가
생긴다.

- `replay`가 서버를 실행하는 경우와 실행하지 않는 경우를 같은 이름이 가리킨다.
- Tool miss와 외부 요청 miss의 해결 방법이 다른데 같은 오류 계층에 섞인다.
- `McpClient`를 감싸는 코드가 자식 프로세스 내부의 `fetch`·DB 훅까지 알아야 한다.
- 기존 JSON 카세트의 version을 올리는 것만으로 의미 변경을 표현할 수 없다.
- 신규 코드가 이미 큰 `packages/record/src/index.ts`에 합쳐져 두 경계를 독립적으로 제거하거나
  변경하기 어려워진다.

검증된 기존 코드를 재사용하는 것은 가치가 있지만, 의미가 다른 코드를 재사용하면 조건 분기와
호환 계층을 장기간 유지하는 비용이 더 커진다. 무엇을 재사용하고 무엇을 분리할지 먼저 결정해야
한다.

현재 legacy 소비 면은 다음과 같다. 신규 External 구현 중에는 이 파일들을 함께 고치지 않는다.

| 소비 면 | 현재 역할 | 신규 경로에서의 방침 |
|---|---|---|
| `packages/record/src/index.ts` | Tool 카세트 타입·매칭·IO·검증·client wrapper | 동결. External 계약의 import 원본으로 사용하지 않음 |
| `packages/cli/src/cassette-wiring.ts` | `generate` dry-run의 auto·record 배선 | 신규 session 배선과 공유하지 않음 |
| `packages/cli/src/generate-command.ts` | `--cassette`·`--record` 사용자 흐름 | 신규 H1·H2 뒤 별도 마이그레이션 |
| `packages/cli/src/replay-command.ts` | 서버 없는 Tool 카세트 Replay | 신규 Replay 구현 기반으로 사용하지 않음 |
| `packages/cli/src/verify-command.ts` | Tool 카세트와 실서버 응답 비교 | legacy가 남는 동안 유지. External 경로의 외부 API 드리프트 재검증 수단은 이 ADR 범위 밖이며 미정 |
| `packages/cli/src/index.ts`, `help.ts` | legacy 명령 조립과 도움말 | CLI 전환 단계에서만 변경 |
| `packages/dashboard/src/server/files.ts`, `routes.ts`, `wiring.ts` | 카세트 탐색·Replay 실행 조립 | CLI 전환 뒤 후속 변경 |
| `packages/dashboard/web/src/screens/*` | 카세트 생성·탐색 UI | 신규 session UX가 확정된 뒤 변경 |

이 목록은 삭제 대상을 뜻하지 않는다. 현재 의미를 소유하는 파일을 표시해 신규 코드와 같은 변경
단위에 섞이지 않게 하는 영향 지도다.

## 선택지

### A안: 기존 `Cassette`와 `cassetteClient`를 확장한다

기존 공개 API와 파일 IO를 유지하면서 interaction에 Tool과 External 종류를 추가한다. 초기 파일
수는 적지만, Tool Replay와 External Replay의 프로세스 수명주기 및 miss 정책이 한 엔진 안에서
계속 분기한다.

### B안: 같은 공개 진입점 아래 두 엔진을 영구적으로 병렬 제공한다

내부 구현은 나누되 `record`, `replay`, `Cassette`라는 이름과 저장 형식을 계속 공유한다. 구현
분리는 가능하지만 사용자가 어느 Replay가 서버를 실행하는지 이름만으로 판단하기 어렵다.

### C안: 신규 External 경계를 별도로 만들고 기존 Tool 카세트를 동결한 뒤 단계적으로 이전한다

기존 공개 API와 동작은 신규 수직 기능이 검증될 때까지 그대로 둔다. 신규 구현은 별도 타입,
저장소, 진입점에서 시작하고 legacy 코드를 import하지 않는다. 신규 경로가 완성된 뒤 기존 Tool
카세트를 유지·개명·제거할지를 별도 마이그레이션 단계에서 결정한다.

## 결정

C안을 선택한다.

신규 External 구현과 기존 Tool 카세트 사이의 의존 관계는 다음으로 고정한다.

```text
legacy ──→ shared ←── external

legacy ──X── external
```

- `external`은 `Cassette`, `CassetteInteraction`, `CassetteMode`, `cassetteClient`, `McpClient`,
  `ToolResult`를 계약이나 구현에 사용하지 않는다.
- legacy 구현도 신규 `external` 모듈을 import하지 않는다.
- `shared`에는 어느 기록 경계에도 종속되지 않는 순수 알고리즘과 불변 version 데이터만 둔다.
  External 공개 배선에 앞서 `stable JSON`과 민감 키 판정 알고리즘을 별도 동작 보존 변경으로
  추출하고, legacy 테스트를 그대로 통과시킨다.
- 민감 키 목록은 `shared`가 `V1`, `V2`처럼 이미 배포된 값을 바꾸지 않는 version별 스냅샷으로
  제공한다. legacy는 항상 최신 목록을 쓰고, External은 해당 interaction schema version에 묶인
  목록만 쓴다. External은 `latest` 별칭을 사용하지 않는다.
- 민감 키 판정 알고리즘 변경은 두 경계의 계약을 함께 검토하지만, 목록 추가는 기존 스냅샷을
  수정하지 않고 새 목록을 추가한다. legacy의 Tool matchKey는 마스킹 목록을 입력으로 쓰지 않으며,
  External은 새 목록을 채택할 때 새 interaction schema version을 만든다.
- 기존 `packages/record/src/index.ts`를 신규 구현 전에 대규모로 이동하거나 분할하지 않는다.
  먼저 동결하고, 필요한 순수 함수만 작은 변경 단위로 추출한다.
- 기존 JSON 카세트와 신규 External Session은 schema version, 타입 이름, 저장 위치를 공유하지
  않는다.
- 두 경계는 해시 입력 domain도 공유하지 않는다. legacy matchKey는 그대로 유지하고, External
  matchKey에는 External domain과 interaction schema version을 포함한다.
- 기존 `mcpeak replay --cassette`와 `generate --cassette`는 신규 External 흐름의 구현 기반으로
  사용하지 않는다.
- 신규 사용자 흐름은 실제 MCP 서버를 실행하는 `test` 실행 경로에 별도 session 옵션으로
  연결한다. 정확한 옵션 이름은 CLI 설계에서 정한다.

신규 `fetch` Record 수직 기능에서 실제 외부 호출과 interaction 기록 생성을 검증하고, Replay
수직 기능에서는 같은 시나리오의 대상 외부 서버 호출 0회를 지원하는 Node 내장 `fetch` 경계에서
검증한다. 두 E2E와 CLI 배선이 모두 검증되기 전에는 legacy 코드를 삭제하지 않는다. 검증 후 최종
제품에서 Tool 카세트의 독립 가치가 없다고 판단하면 0.x breaking 변경으로 제거한다. 실제 MCP
서버를 대신하는 장기 책임은 `mock`에 있다.

경계를 문서 약속에만 맡기지 않는다. 구현 단계에서 다음을 자동 검사한다.

- `external` 소스가 legacy 진입점이나 타입을 import하지 않는 의존성 경계 테스트
- External 공개 타입에 Tool 카세트 타입이 나타나지 않는 타입 검사
- legacy 변경과 External 기능 추가를 같은 작업 단위에 섞지 않는 변경 범위 검사
- legacy JSON 카세트와 External Session을 서로의 로더가 받아들이지 않는 스키마 테스트

## 이유

새 External Record/Replay 결정의 핵심은 실제 MCP 서버 코드를 Replay에서도 실행하는 것이다.
기존 Tool 카세트는 그 서버를 실행하지 않으므로 신규 엔진의 출발점으로 삼을 수 없다. 공통점은
JSON 직렬화와 마스킹 같은 일부 기술뿐이고 제품 의미는 다르다.

C안은 한동안 두 경로가 공존하는 비용이 있지만 그 비용이 명시적이고 제거 가능하다. 반대로 A안과
B안은 신규 기능이 완성된 뒤에도 두 Replay 의미를 같은 타입과 이름 아래 유지해야 한다. 일시적인
중복보다 영구적인 의미 혼합이 더 큰 비용이다.

기존 파일을 먼저 물리적으로 재배치하지 않는 이유도 같다. 동작 변경 없이 1,000줄이 넘는 파일을
옮기는 작업은 diff와 회귀 범위를 키우지만 신규 경계가 맞는지는 증명하지 못한다. 경계를 먼저
고정하고 신규 수직 기능이 실제로 필요한 순수 함수만 드러내게 한다.

## 결과

- `record` 패키지 안에 일정 기간 legacy와 External 두 구현이 공존한다.
- 신규 External 구현은 별도 디렉터리와 빌드 진입점을 갖는다.
- 기존 카세트의 공개 API와 문서는 신규 기능이 검증될 때까지 바뀌지 않는다.
- 공통화는 범용 추상화가 아니라 경계가 확인된 순수 알고리즘의 동작 보존 추출로 제한한다.
- 민감 키 목록의 새 version은 기존 External 세션을 무효화하지 않는다. 기존 세션은 녹화 당시
  interaction schema version에 묶인 목록으로 계속 매칭한다.
- CLI와 dashboard는 신규 External 흐름을 연결할 때 기존 Replay 조립을 재사용하지 않는다.
- legacy 제거는 신규 H1·H2와 CLI 전환 이후 별도 breaking 변경 및 마이그레이션 안내로 수행한다.
- 이 ADR 번호는 병합 직전에 `docs/adr/`와 진행 중인 변경을 다시 확인한다. 충돌하면 파일명,
  제목, 색인 링크를 함께 재번호한다.
