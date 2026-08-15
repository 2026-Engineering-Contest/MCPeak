# ADR-0009: `generate`가 `runner`에 의존하는 예외를 명시적으로 승인한다

- 상태: 채택
- 날짜: 2026-08-13
- 담당: generate, runner
- 작성자: @seodduu (generate·runner 파트)
- 승인: 승인 (2026-08-15, @seodduu · 파트 ① 오너). 아래 '승인' 절 참조
- 참조: `docs/architecture.md`, `CONTRIBUTING.md` §3

## 배경

프로젝트의 의존 방향 규칙은 단방향이다.

```
cli → runner / generate / record / mock → core
```

이 규칙을 문자 그대로 읽으면 `generate`는 `core`만 참조해야 한다. 그런데 `generate`는
`@ohmymcp/runner`를 직접 참조한다.

| 종류 | 심볼 |
|---|---|
| 타입 | `TestSuiteSpec`, `TestCaseSpec`, `SuiteValidationIssue`, `RunnerRedactionOptions`, `SpecFindingsResult`, `ContractAxis`, `ContractAxisKind`, `ContractDeclaredType` |
| 함수 | `validateMcpSuite`, `canonicalJson`, `sha256`, `deepFreeze`, `checkInputContract`, `checkAssertionSubstance`, `deriveContractAxes`, `matchCoveredAxes` |
| 상수 | `MCP_SUITE_JSON_SCHEMA`, `DEFAULT_SENSITIVE_KEYS`, `REDACTED` |

`checkInputContract` · `checkAssertionSubstance` · `SpecFindingsResult` 세 개는 2026-08-14 에
입력 계약 대조 결과를 승인 화면에 싣기 위해 추가했다. 두 검사는 명세와 서버 선언을 대조하는
`runner` 의 규칙이고, `generate` 는 후보를 만드는 시점에 그 결과를 candidate 에 실어 `cli`
승인 화면으로 넘긴다. 검사 로직을 `generate` 에 복제하면 `cli test` 가 쓰는 `runner` 쪽 구현과
갈려 같은 명세에 대해 두 화면이 다른 문장을 낸다.

`canonicalJson` · `sha256` · `deepFreeze` 세 개는 2026-08-14 에 추가했다. 원래 `generate` 에
있던 구현인데 `runner` 로 옮겼고, `generate` 는 `packages/generate/src/canonical.ts` 한 줄
재수출로 그것을 다시 쓴다. 승인 지문(단계 8)을 `ohmymcp test` 실행 경로에서 계산해야 하는데
그 경로는 `cli` 와 `runner` 만 쓰고, 의존 방향이 `generate → runner` 라 `runner` 가
`generate` 를 부를 수 없기 때문이다. canonical JSON 구현을 두 벌로 만들면 저장 시점 지문과
실행 시점 지문이 조용히 갈린다. 구현을 한 벌로 유지하려고 낮은 층으로 옮긴 것이고, 의존이
새로 늘어난 것이 아니라 같은 코드의 소유 패키지가 바뀐 것이다.

`deriveContractAxes` · `ContractAxis` · `ContractDeclaredType` 세 개는 2026-08-15 에 계약 축
커버리지를 위해 추가했다. 축 도출을 `runner` 에 두는 이유가 둘이다. 첫째, 정규화를 한 벌로
유지해야 한다. `input-contract.ts` 의 `normalizeInputSchema` 가 이미 `required` · 필드 `type` ·
`enum` · 차단 키워드를 정규화하고, 축 도출이 필요한 것이 정확히 그 구조체다. 두 벌이 되면 입력
계약 대조는 "이 툴 스키마는 해석 못 했다" 며 침묵하는데 커버리지는 "축 3개 미검증" 이라고 세는
상태가 만들어진다. 같은 화면의 두 줄이 서로를 부정한다. 둘째, `generate` 의 파서로는 이 일을 할
수 없다. `validateSchema` 는 허용 키워드 밖(`anyOf` 등)을 만나면 **던진다**. 커버리지 표시는
규칙 기반 baseline 뿐 아니라 AI 가 만든 명세와 손으로 쓴 명세에도 필요한데, 그 경로는 서버 선언을
`generate` 파서에 통과시키지 않는다(`authoring-session.ts` 가 서버 `tools` 를
`checkInputContract` 에 그대로 넘긴다). `anyOf` 하나 쓴 서버를 만나면 `generate` 파서 기반 도출은
화면 전체를 죽이고, `runner` 파서 기반 도출은 그 툴만 해석 불가로 빼고 나머지를 정상 표시한다.
같은 이유로 커버리지 판정이 `matchCoveredAxes` 와 `ContractAxisKind` 를 쓴다.

이 의존은 AI 보조 작성 기능 이전부터 있었고, PR #37이 `MCP_SUITE_JSON_SCHEMA`를 하나 더 참조하면서
코드 리뷰에서 지적됐다.

화살표 방향 자체는 어긋나지 않는다. `generate`는 `cli`를 참조하지 않고 순환도 없다. 어긋나는 것은
"각 패키지는 `core`의 타입만 있으면 된다"는 서술이다. 그 서술은 `core`에 대해서만 성립하고
`runner`에 대해서는 성립하지 않는다. `generate`는 `runner`의 구현(`validateMcpSuite`)에 의존한다.

## 선택지

- A안: suite 스펙과 검증기를 `core`로 옮긴다.
- B안: `runner`의 검증기를 `generate`에 주입한다.
- C안: 예외를 명시적으로 승인하고 참조 범위를 검사로 고정한다.
- D안: `generate`가 자체 검증기를 갖는다.

## 결정

C안을 채택한다. 이 의존을 예외로 승인하고, 참조하는 심볼 목록을 테스트로 고정한다. 목록 밖 심볼이
추가되면 테스트가 깨진다.

## 이유

D안은 배제한다. 검증기가 두 벌이 되면 `runner`가 실행을 거부하는 suite를 `generate`가 만들 수
있다. 실행기와 생성기의 판정이 갈리는 것이 이 도구에서 가장 나쁜 결함이다. 사용자는 통과한 suite가
실행되지 않는 것을 본다.

B안은 지금 문제를 해결하지 않는다. 주입은 런타임 결합을 옮길 뿐 `TestSuiteSpec` 타입 의존은
그대로다. 타입만 남겨도 `MCP_SUITE_JSON_SCHEMA`처럼 값이 필요한 자리가 있다.

A안이 원칙적으로 옳다. suite 스펙은 실행기와 생성기가 공유하는 계약이므로 더 낮은 층에 있어야
한다. 그러나 지금 하지 않는다. `core`의 책임 범위와 `runner`의 공개 API를 함께 바꾸는 작업이고,
`core/src/types.ts`는 다섯 명의 병렬 작업 기준점이라 변경에 전원 승인이 필요하다. AI 보조 작성
기능을 내보내는 이 PR에 그 변경을 얹으면 두 작업의 실패가 뒤섞인다.

C안은 A안을 막지 않는다. 참조 목록을 검사로 고정하면 의존이 조용히 커지는 것을 막고, 나중에 A안을
할 때 무엇을 옮겨야 하는지가 그 목록에 이미 적혀 있다.

## 결과

- `generate → runner` 의존은 승인된 예외다. 위 표의 심볼만 허용한다.
- 목록을 넓히려면 이 ADR을 고쳐야 한다. 테스트가 먼저 깨져 그 사실을 알린다.
- 의존 방향 규칙의 서술을 정정한다. "각 패키지는 `core`의 타입만 있으면 된다"는 `core`에 한한
  서술이고, `runner`에 대해서는 이 ADR이 정한 예외가 적용된다.
- A안은 열려 있다. 착수 조건은 `core`의 책임 범위 확대에 대한 오너 전원 합의다. 그때 옮길 대상은
  위 표와 같다.

## 승인

- 상태: 승인 (2026-08-15).
- 필요한 승인: `generate` 오너와 `runner` 오너. 예외의 대상이 두 패키지의 경계이므로 한쪽 승인으로
  부족하다.
- 승인한 사람: @seodduu. `CONTRIBUTING.md` §2.1 의 파트 ① 이 `core`·`runner`·`generate` 를 함께
  소유하고 "파트가 그 안의 패키지에 대한 설계 결정권과 최종 책임을 가진다" 고 정하므로, 두 패키지의
  경계에 대한 이 결정을 파트 오너가 승인했다.
- 남은 절차: 파트 ① 내부의 1인 1패키지 분할이 §2.1 표에 아직 반영되지 않았다. 그 표를 갱신할 때
  이 승인의 주체 표기도 함께 확인한다. 참조 범위는 승인 이후에도
  `packages/generate/tests/dependency-boundary.test.ts` 가 코드로 고정하고, 목록을 넓히려면 이 문서를
  먼저 고쳐야 한다는 규칙도 그대로다.
- 반대 결론이 나오면: A안(suite 스펙과 검증기를 `core`로 이동)을 별도 PR로 진행한다. 그 경우
  `core/src/types.ts`의 책임 범위가 바뀌므로 오너 전원 승인이 필요하다.
