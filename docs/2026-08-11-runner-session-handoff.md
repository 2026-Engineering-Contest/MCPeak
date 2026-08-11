# Runner 설계 논의 세션 인수인계

- 작성일: 2026-08-11
- 프로젝트: OhMyMCP
- 작업 위치: 저장소 루트
- 참고 제안서: 외부 자료 `mcp-test-프로젝트-제안서.md`
- 현재 단계: 설계 승인 및 구현 계획 작성 완료
- 후속 설계: `docs/superpowers/specs/2026-08-11-runner-design.md`
- 후속 구현 계획: `docs/superpowers/plans/2026-08-11-runner-implementation.md`

> 이 문서는 설계 논의 당시의 배경 기록이다. 미확정 사항과 시작 프롬프트는 이후 문서에서 해결됐으며, 다음 세션은 위 구현 계획을 실행 기준으로 삼는다.

## 1. 프로젝트 목표

OhMyMCP는 MCP 서버를 코드로 자동 테스트하는 TypeScript 모노레포다. 장기적으로 다음 항목을 검증하고 분석하는 것을 목표로 한다.

1. MCP 서버가 약속한 툴을 실제로 제공하는가
2. 각 툴이 정상·경계·잘못된 입력을 올바르게 처리하는가
3. 응답 구조와 값이 기대한 조건을 만족하는가
4. 오류를 MCP 응답으로 안전하게 처리하는가
5. 툴 정의와 호출에 필요한 예상 토큰은 얼마인가
6. 설명 및 스키마 정의 비용을 줄일 수 있는 최적화 지점은 무엇인가

현재 사용자는 팀에서 `runner` 구현을 우선 담당한다. 토큰 추정과 MCP 정의 최적화는 중요하지만 첫 runner 수직 기능 이후의 범위로 둔다.

## 2. 저장소 현황

모노레포 패키지는 다음과 같다.

| 패키지 | 책임 |
|---|---|
| `@ohmymcp/core` | MCP 연결, stdio 프로세스, 핸드셰이크, 수명주기 |
| `@ohmymcp/runner` | 테스트 실행, assertion, 실패 진단, 리포트 |
| `@ohmymcp/generate` | 스키마 및 자연어에서 테스트 명세 생성 |
| `@ohmymcp/record` | 녹화, 재생, 계약 스냅샷 |
| `@ohmymcp/mock` | Streamable HTTP 목 서버와 응답 주입 |
| `ohmymcp` CLI | 각 패키지를 호출하는 얇은 진입점 |

현재 `mock`을 제외한 주요 패키지는 대부분 `not implemented` 스텁 상태다. `runner`에는 `createMcpTest`와 `toContainTool` 시그니처만 있다.

## 3. 반드시 지킬 저장소 규칙

새 세션에서는 작업 전에 저장소의 `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`를 다시 읽는다.

- 한 번에 한 패키지만 작업한다.
- 다른 오너의 패키지를 직접 수정하지 않는다.
- `packages/core/src/types.ts`의 `McpClient`와 `ToolResult`는 동결되어 있으므로 수정하지 않는다.
- `@modelcontextprotocol/sdk` 버전을 올리지 않는다.
- 합의 없이 의존성을 추가하지 않는다.
- 타입 시그니처와 테스트를 구현 코드보다 먼저 제시한다.
- 실패 메시지는 원인, 실제 값, 해결 힌트를 포함해야 한다.
- 같은 입력에는 같은 결과가 나와야 한다.
- 커밋과 푸시는 사용자가 직접 한다.

## 4. 합의된 제품 구조

CLI와 로컬 Dashboard가 동일한 runner를 사용한다.

```text
브라우저 Dashboard UI
        ↕ HTTP / SSE
로컬 Dashboard Node 서버
        ↓
Runner API
        ↓
McpClient
        ↓
사용자의 MCP 서버 프로세스
```

Dashboard는 다른 팀원이 구현한다. 구체적인 workspace 이름과 실행 명령은 Dashboard 패키지가 추가될 때 그 패키지의 README에서 확정하며, 사용자는 로컬 서버와 브라우저에서 테스트 생성·실행 결과를 확인하는 흐름을 원한다.

Runner는 CLI, Dashboard, Vitest 중 어느 하나에도 직접 종속되지 않는 혼합형 구조로 만든다.

- Runner core: 테스트 실행 및 구조화된 결과 반환
- CLI reporter: 이벤트와 결과를 터미널 또는 JUnit으로 변환
- Dashboard adapter: 실행 이벤트를 SSE 또는 WebSocket으로 전달
- Vitest adapter: runner 결과를 matcher 결과로 변환

## 5. 테스트 케이스 유입 경로

테스트는 세 경로에서 만들어질 수 있지만 모두 공통 `TestSuiteSpec`으로 정규화한다.

```text
사용자가 직접 작성한 명세 ──────────┐
                                     │
JSON Schema 기반 자동 생성 ─────────┼─→ TestSuiteSpec → Runner
                                     │
자연어 + Codex/Claude 변환 ─────────┘
```

### 사용자 직접 작성

사용자는 자동 생성된 테스트를 그대로 사용하거나 수정할 수 있고, 처음부터 테스트를 직접 작성할 수도 있어야 한다. 직접 작성 방식은 JSON 명세와 TypeScript helper를 모두 고려한다.

### 결정론적 자동 생성

MCP `tools/list`의 `inputSchema`를 이용해 다음 테스트를 자동 생성할 수 있다.

- 툴 존재 여부
- 필수 입력 누락
- 잘못된 타입
- `enum`, `minimum`, `maximum`, `pattern` 등 JSON Schema 제약
- 유효한 샘플 입력의 프로토콜상 정상 응답
- 존재하지 않는 툴과 잘못된 입력에서 서버가 크래시하지 않는지

도메인 의미와 구체적인 응답 필드는 스키마만으로 완전히 알 수 없다. 현재 동결된 `ToolDef`에도 `outputSchema`가 없다.

### 자연어 테스트 작성

사용자는 다음처럼 자연어만 작성할 수 있어야 한다.

```text
서울의 날씨를 조회한다
도시가 없으면 오류를 반환한다
```

자유로운 자연어를 하드코딩된 규칙만으로 안정적으로 변환하는 것은 범위에서 제외했다. Codex 또는 Claude CLI가 자연어와 MCP 툴 정의를 공통 `TestSuiteSpec` JSON으로 변환한다.

AI에게 임의의 `test.ts`를 바로 작성시키지 않는다. 제한된 JSON Schema에 맞는 데이터만 생성하게 하고, 생성 결과를 자체 validator로 다시 검증한 뒤 사용자에게 미리 보여준다.

## 6. Codex 및 Claude CLI 지원 결정

MVP에서 Codex CLI와 Claude CLI를 모두 지원한다. 두 CLI가 설치되고 로그인되어 있다고 가정하며, 오프라인 자연어 파서는 제공하지 않는다.

Provider별 adapter를 둔다.

```ts
interface NaturalLanguageCompiler {
  readonly id: "codex" | "claude";
  checkAvailability(): Promise<ProviderStatus>;
  compile(request: CompileRequest): Promise<CompileResult>;
}
```

- Codex adapter: 비대화형 `codex exec`와 JSON Schema 구조화 출력 사용
- Claude adapter: 비대화형 `claude -p`와 `--json-schema` 사용
- 공통 처리: stdin 입력, timeout, 종료 코드, stderr, JSON 파싱, schema 검증
- provider 고유의 출력 envelope는 adapter 내부에서 제거
- runner에는 provider 정보가 아니라 검증된 `TestSuiteSpec`만 전달

Provider adapter는 runner가 아니라 `generate` 측 책임이다. 이번 runner 작업에서는 adapter를 구현하지 않고, adapter가 생성해야 할 공개 계약만 제공한다.

보안과 안정성 원칙은 다음과 같다.

- 자연어와 툴 정의를 안전한 stdin으로 전달한다.
- AI CLI의 파일 수정 및 불필요한 도구 사용을 제한한다.
- 별도 일회성 세션을 사용한다.
- 제한 시간 초과 시 자식 프로세스를 종료한다.
- 사용자 승인 전 실제 MCP 툴을 실행하지 않는다.
- 모호한 변환을 추측하지 않고 `needsReview` 또는 구조화된 오류로 반환한다.

## 7. Runner 책임과 제안된 구조

Runner는 테스트의 생성 출처를 알 필요가 없다. 검증된 `TestSuiteSpec`을 받아 실행하고 `RunnerEvent` 및 `RunnerReport`를 만든다.

```text
packages/runner/src/
├── spec.ts          # TestSuiteSpec 공개 타입과 구조 검증
├── executor.ts      # 순차 실행, timeout, 중단
├── assertions.ts    # 툴, 입력, 응답, 오류 assertion
├── diagnostics.ts   # 사람이 읽는 실패 메시지
├── sanitization.ts  # observer payload 마스킹과 크기 제한
└── index.ts         # 공개 API 재수출
```

후속 설계에서 확정한 lifecycle의 핵심은 다음과 같다. 전체 타입은 설계 문서를 따른다.

```ts
export function defineMcpSuite(spec: TestSuiteSpec): TestSuiteSpec;

export interface RunnerExecution {
  report: Promise<RunnerReport>;
  drain: Promise<void>;
}

export function runSuite(options: {
  client: McpClient;
  suite: TestSuiteSpec;
  signal?: AbortSignal;
  onEvent?: (event: RunnerEvent) => void;
}): RunnerExecution;
```

`onEvent`는 CLI의 실시간 터미널 출력과 Dashboard의 SSE 전달에 사용한다. 최종 `RunnerReport`는 sanitized JSON 응답에 사용하며, timeout·abort 뒤에는 `drain`을 기다린 후 client를 닫는다.

## 8. Runner 최우선 구현 범위

가장 먼저 구현할 것은 `TestSuiteSpec → RunnerReport`가 실제로 끝까지 동작하는 최소 수직 기능이다.

첫 수직 기능은 다음 두 assertion만 포함한다.

```ts
{ type: "toolExists", tool: "get_weather" }
{ type: "isError", expected: false }
```

첫 PR의 성공 기준은 다음과 같다.

> 가짜 `McpClient`와 직접 작성한 `TestSuiteSpec`을 runner에 넘기면, 툴 존재와 정상·오류 응답을 검사하고 CLI와 Dashboard가 소비 가능한 이벤트 및 보고서를 반환한다.

권장 구현 순서:

1. `TestSuiteSpec`, `TestCaseSpec`, `AssertionSpec`, `RunnerEvent`, `RunnerReport` 공개 계약 제안
2. 해당 타입을 사용하는 실패 테스트 작성 및 팀 확인
3. `toolExists`와 `isError` assertion 구현
4. 순차 실행하는 최소 executor 구현
5. 원인, 실제 값, 해결 힌트를 담는 진단 구현
6. 테스트별 timeout과 `AbortSignal` 중단
7. 입력 및 응답 schema assertion
8. JUnit 및 Vitest adapter
9. 필요성이 확인된 뒤 병렬 실행

첫 구현은 결정론성을 위해 테스트를 명세에 정의된 순서대로 실행한다.

## 9. 실패 결과 원칙

실패는 단순 문자열만 반환하지 않고, 기계가 읽을 수 있는 필드와 사람이 읽을 수 있는 문장을 함께 제공한다.

```ts
{
  code: "TOOL_NOT_FOUND",
  message: "툴 'get_weather'를 찾을 수 없습니다.",
  expected: "get_weather",
  actual: ["get_forecast"],
  hint: "서버의 tools/list 응답과 테스트 명세를 확인하세요."
}
```

CLI는 이를 여러 줄의 터미널 메시지로 표시하고, Dashboard는 동일한 필드를 UI 요소로 렌더링한다.

## 10. 확정 결과

이 문서에서 열어 둔 항목 가운데 첫 Runner 수직 기능에 필요한 사항은 후속 설계에서 확정했다.

- `TestSuiteSpec`, assertion, event, report의 정확한 공개 타입
- 한 케이스에 MCP 작업 하나와 assertion 여러 개를 두는 규칙
- 결정론적인 이벤트 순서와 시간 필드를 제외한 보고서
- case → suite → Runner 10초 fallback timeout과 외부 취소 정책
- Generate가 Runner 루트 공개 API의 JSON Schema와 validator를 소비하는 경계
- 단일 실패 케이스와 전체 실패 케이스를 AI 수정 입력으로 선택하는 미래 repair 계약

`ToolResult.content`의 범용 JSON 추출, 자유로운 Vitest bridge, 토큰 추정과 정의 최적화는 첫 Runner 구현의 비범위로 남는다. 세부 근거와 테스트 매트릭스는 후속 설계 문서를 따른다.

## 11. 새 세션에서 바로 할 일

1. 현재 저장소의 `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`를 읽는다.
2. `execution-conventions`와 구현 계획이 요구하는 실행 스킬을 적용한다.
3. 후속 설계와 구현 계획을 끝까지 읽고 기점 및 worktree 사전 조건을 확인한다.
4. 구현 계획 Task 1부터 순차 TDD로 실행하고, 각 Task 뒤 사용자 커밋 게이트에서 멈춘다.

## 12. 새 세션 시작용 프롬프트

아래 문장을 새 세션에 붙여 넣는다.

```text
OhMyMCP의 Runner 구현 계획을 실행해줘.

먼저 저장소의 AGENTS.md, CLAUDE.md, CONTRIBUTING.md와
docs/2026-08-11-runner-session-handoff.md,
docs/superpowers/specs/2026-08-11-runner-design.md,
docs/superpowers/plans/2026-08-11-runner-implementation.md를 읽어줘.

설계는 승인됐으므로 다시 설계하지 말고 구현 계획의 Single-Terminal Execution Prompt를
그대로 따라 Task 1부터 진행해줘. 프로젝트 규칙대로 테스트를 먼저 RED로 확인하고,
각 Task의 리뷰와 검증이 끝나면 사용자 커밋 게이트에서 멈춰줘.
```
