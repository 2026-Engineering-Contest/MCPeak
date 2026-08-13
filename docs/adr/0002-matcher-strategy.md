# ADR-0002: matcher를 독립 구현으로 유지하고 외부 테스트 러너 확장은 제공하지 않는다

- 상태: 제안
- 날짜: 2026-08-13
- 작성자: @endl24 (runner 파트)
- 관련 설계: [Runner 설계 논의 인수인계](../2026-08-11-runner-session-handoff.md),
  [Runner 실행 설계](../superpowers/specs/2026-08-11-runner-design.md)

## 배경

`@ohmymcp/runner`는 검증된 `TestSuiteSpec`을 실행하고, 무엇이 왜 다른지 사람이 읽을 수 있는
실패 진단을 만든다. 그런데 현재 이 패키지에는 **성격이 다른 두 갈래의 공개 API가 공존한다.**

| API | 상태 | 성격 |
|---|---|---|
| `runSuite(options): RunnerExecution` | 구현됨 | 선언형 명세를 받아 순차 실행하는 독립 구현 |
| `createMcpTest(config, body)` | `not implemented` | 외부 테스트 러너(Vitest·Jest)의 `describe`/`it` 스타일 |
| `toContainTool(result, name): MatchResult` | `not implemented` | `pass` + `message()` 를 돌려주는 matcher 규약 |

`MatchResult`의 `{ pass, message: () => string }` 형태는 Vitest·Jest의 커스텀 matcher 규약
그대로다. 즉 스텁 두 개는 "외부 러너 위에 얹는다"는 방향을 전제하고 남겨진 시그니처다.

이 상태가 만드는 문제가 셋이다.

1. **README가 동작하지 않는다.** 저장소 최상단의 "30초 예제"가 `createMcpTest`와
   `toContainTool`을 쓴다. 지금 그대로 실행하면 `Error: not implemented`가 난다.
   사용자가 가장 먼저 만나는 코드가 거짓말을 하고 있다.
2. **경계 문서화가 숙제로 남아 있다.** CONTRIBUTING 부록 B가 Vitest 항목에 이렇게 적어뒀다 —
   *"우리가 만드는 것도 테스트 도구이므로 내부 러너와 개념이 겹치지 않게 경계를 문서화할 것."*
   그 경계가 아직 어디에도 없다.
3. **의존성 방향이 미정이다.** 저장소 루트는 Vitest(`^4.1.10`)를 devDependency로 쓰지만,
   `@ohmymcp/runner`의 런타임 의존성은 `@ohmymcp/core` 하나뿐이다. 어댑터를 제공하려면
   Vitest를 peerDependency로 올려야 하고, 이는 CONTRIBUTING §13.3에 따라 용도·라이선스를
   명시한 PR과 승인이 필요하다.

한편 이미 승인된 Runner 설계는 **혼합형 구조**를 전제한다. Runner core는 결과를 구조화해서
반환할 뿐이고, 터미널 출력·SSE 전달·matcher 변환은 각각 별도 adapter가 맡는다. Runner는
"CLI, Dashboard, Vitest 중 어느 하나에도 직접 종속되지 않는다"가 그 설계의 문장이다.

따라서 결정해야 할 것은 **"외부 러너 adapter를 첫 공개 범위에 포함할 것인가"** 하나다.

## 선택지

### A. 독립 구현만 유지하고 외부 러너 확장을 제공하지 않는다

`runSuite`를 유일한 실행 진입점으로 두고, 결과 소비는 우리가 만드는 리포터가 맡는다.
`createMcpTest`·`toContainTool`은 deprecated shim으로 남기고 major에서 제거한다.

- 장점
  - 실행 순서·병렬 여부·타임아웃을 전부 우리가 통제한다. 결정론성이 외부 설정에 의존하지 않는다.
  - 실패 진단을 `RunnerDiagnostic`(code·message·expected·actual·hint) 구조 그대로 출력할 수 있다.
  - 런타임 의존성이 `@ohmymcp/core` 하나로 유지된다. 의존성 승인 절차가 일정에 끼어들지 않는다.
  - 되돌리기 쉽다. 나중에 adapter를 추가하는 것은 minor 변경이다.
- 단점
  - 이미 Vitest를 쓰는 프로젝트는 MCP 테스트를 별도 명령(`ohmymcp test`)으로 돌려야 한다.
    CI 스텝이 하나 늘고, 도입 마찰이 그만큼 커진다.
  - README의 30초 예제를 `runSuite` 기준으로 다시 써야 한다.

### B. 독립 구현 + 별도 진입점의 Vitest adapter

`@ohmymcp/runner/vitest` 서브패스로 adapter를 제공하고 Vitest를 optional peerDependency로 둔다.
루트 export는 Vitest를 import하지 않는다.

- 장점
  - 사용자가 `vitest run` 하나로 자기 테스트와 MCP 테스트를 함께 돌린다. 도입 마찰이 가장 낮다.
  - 실패 화면이 사용자에게 이미 익숙하다.
- 단점
  - **adapter 구현 방식 두 가지가 각각 우리 핵심 가치 하나씩을 잃는다.**
    - suite 전체를 Vitest test 하나에 담으면 결정론성은 지켜지지만, 케이스 20개가 화면에
      "1개"로 보인다. 케이스별 진단을 문자열로 뭉쳐 던져야 하므로 실패 메시지 품질이 떨어진다.
    - 케이스마다 Vitest test를 만들면 화면은 좋아지지만, 실행 순서와 파일 단위 병렬을
      Vitest가 통제한다. 사용자가 `test.concurrent`를 켜면 우리가 막을 방법이 없다.
  - MCP 서버는 프로세스다. Vitest의 파일 단위 병렬과 겹치면 서버 프로세스가 중복 기동되거나
    하나를 공유하며 요청이 뒤섞인다. `core`가 소유한 프로세스 수명주기가 외부 설정에 노출된다.
  - 공개 API가 되므로 되돌리려면 major 릴리스가 필요하다.
  - 의존성 추가 승인이 크리티컬 패스에 들어간다.

### C. `createMcpTest`·`toContainTool`을 Vitest 위에 구현해 README 예제를 살린다

- 장점
  - README를 고치지 않아도 된다.
- 단점
  - Runner 루트 API가 Vitest에 직접 종속된다. **이미 승인된 혼합형 구조와 정면으로 충돌한다.**
  - CLI·Dashboard 경로까지 Vitest를 끌고 들어간다. Dashboard는 브라우저 UI라 Vitest가 무의미하다.

## 결정

**A안을 채택한다.**

1. `runSuite`가 유일한 실행 진입점이다. `@ohmymcp/runner`는 외부 테스트 러너 adapter를
   첫 공개 범위에 포함하지 않는다.
2. `createMcpTest`와 `toContainTool`은 현재 시그니처와 `not implemented` 동작을 유지한 채
   **deprecated로 명시**한다. 제거는 major 릴리스와 migration 문서를 동반한다. 이는 Runner
   설계가 이미 정한 제거 정책을 그대로 따르는 것이며, minor에서 삭제하지 않는다.
3. `@ohmymcp/runner`의 런타임 의존성은 `@ohmymcp/core` 하나로 유지한다. Vitest를
   `dependencies`·`peerDependencies` 어디에도 추가하지 않는다. 루트 `devDependencies`의
   Vitest는 우리 저장소가 우리를 테스트하는 용도이며 공개 계약이 아니다.
4. 실행 결과의 소비는 우리가 만드는 리포터가 맡는다. 터미널 출력과 JUnit XML이 그 대상이며,
   구체적인 출력 형식과 경계는 **별도 ADR**에서 결정한다.
5. README의 "30초 예제"를 `runSuite` 기준으로 다시 쓴다. 후속 PR로 처리한다.

## 이유

**결정론성은 이 프로젝트가 스스로 선언한 핵심 가치이고, B안은 그 가치를 우리가 통제할 수 없는
지점에 맡긴다.** CLAUDE.md는 "같은 입력에 항상 같은 결과가 나와야 한다"를 존재 이유로 적었고,
녹화·재생 기능이 있는 것도 그래서다. Vitest는 기본이 파일 단위 병렬이며 `test.concurrent`로
케이스 순서까지 사용자가 바꿀 수 있다. 우리 문서가 보장하는 것을 사용자 설정이 깨뜨릴 수 있다면
그것은 보장이 아니다.

**같은 이유가 실패 메시지에도 걸린다.** "실패 메시지가 곧 제품"인 도구가, 케이스 20개의 진단을
문자열 하나로 뭉쳐 던지면 제품이 사라진다. B안의 두 구현 방식은 결정론성과 실패 메시지 품질 중
하나를 반드시 포기하게 되어 있고, 둘 다 포기해선 안 되는 것이다.

**C안은 이미 승인된 설계와 충돌하므로 선택지에서 먼저 빠진다.** Runner를 CLI·Dashboard·Vitest
어디에도 종속시키지 않기로 한 것은 Dashboard가 브라우저 UI이기 때문이다. 루트 API가 Vitest를
import하는 순간 Dashboard 경로가 쓰지 않는 의존성을 끌고 다닌다.

**무엇을 포기했는지 분명히 한다.** A안의 대가는 도입 마찰이다. 이미 Vitest를 쓰는 프로젝트는
`vitest run` 외에 `ohmymcp test`를 따로 돌려야 하고, CONTRIBUTING §13.1이 지적했듯 개발자
도구에서 도입 마찰은 곧 사용자 수다. 이 비용을 알면서 치른다. 대신 첫 공개 범위에서
"우리 도구는 항상 같은 결과를 낸다"와 "실패했을 때 무엇을 고쳐야 하는지 알려준다"를
지킨다. 두 가지가 기존 도구와의 차별점으로 README에 적힌 항목이기도 하다.

**되돌릴 수 있는 방향을 골랐다.** adapter를 나중에 추가하는 것은 서브패스 export를 늘리는
minor 변경이다. 반대로 지금 공개해두고 없애는 것은 major 릴리스와 migration 문서를 요구한다.
마감까지 11일 남은 시점에서, 되돌리기 어려운 쪽을 승인 대기와 함께 크리티컬 패스에 올리지 않는다.

## 결과

- `@ohmymcp/runner`의 공개 실행 API는 `runSuite` 하나다. 외부 러너 adapter는 첫 공개 범위에
  포함되지 않는다.
- `createMcpTest`·`toContainTool`은 deprecated shim으로 남는다. 호출하면 계속
  `not implemented`가 나며, 이는 의도된 동작이다. 제거는 major에서만 한다.
- `@ohmymcp/runner`의 런타임 의존성은 `@ohmymcp/core` 하나로 고정된다. Vitest 관련 의존성
  추가 PR은 이 ADR이 폐기되기 전까지 승인 대상이 아니다.
- README의 30초 예제 수정이 후속 과제로 남는다. 현재 예제는 실행하면 실패하므로, 이 ADR이
  승인되는 즉시 별도 PR로 처리한다.
- 결과 소비 경로 전체를 우리가 책임지게 된다. 터미널 렌더러는
  [CLI 보고서 렌더링 설계](../superpowers/specs/2026-08-13-cli-report-rendering-design.md)가
  `packages/runner/src/reporter.ts`로 이미 다루고 있으며, 그 설계의 ADR-0012·0013이 출력 전환과
  배치를 결정한다. 이 ADR은 그 방향과 충돌하지 않는다 — 렌더러가 `runner`에 있는 근거가
  "`RunnerReport` 타입을 소유한 쪽이 렌더도 소유한다"이고, A안은 그 타입의 유일한 생산자를
  `runSuite`로 고정하기 때문이다.
- **JUnit XML 리포터는 여전히 미결이다.** 위 설계가 §2에서 명시적 비범위로 두고 §9.3에서
  `junit.ts`와 `renderJUnit(report): string`이라는 자리만 열어 뒀다. 출력 형식은 **후속 ADR에서
  결정한다.** 특히 JUnit 스키마가 기대하는 `testcase@time` 속성을 `RunnerReport`가 갖고 있지
  않다는 점 — 결정론성을 위해 시간 필드를 의도적으로 제외했다 — 이 그 ADR의 핵심 쟁점이 된다.
- Vitest adapter는 영구히 배제된 것이 아니다. 실사용 요구가 확인되면 — 예를 들어 도그푸딩
  대상 저장소가 별도 명령을 이유로 도입을 거부하는 사례가 나오면 — 별도 ADR로 재검토한다.
  그때 판단 재료는 "결정론성을 어떻게 지킬 것인가"에 대한 구체적 답이어야 한다.
- 이 결정은 `packages/core/src/types.ts`의 동결된 타입에 영향을 주지 않는다. 패키지 간 의존
  방향(`cli → runner → core`)도 바뀌지 않는다.

### 승인 상태

- 상태: **미승인.** 이 ADR을 담은 PR에서 검토 중이다.
- 확정 방법: PR이 머지되면 상태를 `승인`으로 바꾸고 승인일과 승인한 오너를 적는다.
- 함께 확정되어야 하는 것: CONTRIBUTING §2.1의 파트 ① 내부 패키지 분담. 현재 표는 3명이
  `core`·`runner`·`generate`를 공동 소유하는 상태이며, 1인 1패키지 분할이 미정으로 남아 있다
  (이슈 #2 항목 1). 이 ADR의 작성자 표기는 그 분담이 확정된 뒤 최종 확인한다.
