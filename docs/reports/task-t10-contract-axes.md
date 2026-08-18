# Task T10 보고서: ADR-0022 와 최종 확인

## 무엇을 했나

문서만 바꿨다. `packages/**` 는 건드리지 않았다.

- `docs/adr/0022-위반-케이스-생성-정책.md` 신규
- `docs/adr/README.md` 색인에 0022 행 추가
- 의존 경계 최종 확인

## Step 1: 번호 확인

`ls docs/adr/` 결과 `0021` 까지 있고 `0022` 는 비어 있다. 충돌 없이 0022 를 썼다.

README 가 0016·0017·0018·0019 에서 네 번의 번호 충돌을 기록하고 있다. 그 전례가 모두 "브랜치가
번호를 집은 채 리뷰 중일 때 다른 브랜치가 먼저 머지" 였다. 지금은 이 브랜치가 유일한 미머지
ADR 이지만, **머지 직전에 `docs/adr/` 를 한 번 더 봐야 한다.** 이 보고서를 쓴 시점의 확인은
그때의 보장이 아니다.

## Step 2: ADR-0022

제목은 "위반 케이스는 기본으로, 필드마다, 상한 없이 만든다" 다. 설계서 §11.2 의 세 판단을
선택지 A~D 로 펼쳐 담았다.

| 판단 | 결정 | 배제한 대안과 이유 |
|---|---|---|
| 기본 생성 대 옵트인 | 기본 생성 | 옵트인은 옵션을 아는 사용자만 혜택을 받는다. 입력 검증이 빠진 서버를 쓰는 사용자가 정확히 그 옵션을 켜지 않을 사람이다 |
| 필드마다 대 축마다 | 필드마다 | 서버 코드가 필드별로 갈린다. `if (!args.a) throw` 만 쓰고 `b` 를 빼먹는 것이 잡으려는 결함이다. `{}` 하나로 합치면 어느 필드 검사가 빠졌는지 못 짚는다 |
| 상한 대 무제한 | 무제한 | 축 수가 선형이라 조합 폭발이 없다. 상한을 두면 필드 20개 툴을 가진 사용자가 영구히 미검증을 안고 살고 할 수 있는 조치가 없다. 실재하는 벽은 `runner` 보고서 1MB 이고 그것은 고지로 다룬다 |

결과 절에 실제로 구현된 사실을 적었다.

- `BASELINE_POLICY_VERSION` 이 v2 로 올랐고 기존 승인 지문이 전부 바뀐다
- `fixtures` 두 툴이 8케이스를 만든다(이전 2개). `get_weather` 3개, `add` 5개
- 위반값 표를 고정한다(`string`→`0`, `integer`→`1.5`, enum→`__ohmymcp_invalid_enum__` 또는 `max+1`)
- 필수 필드가 정상 입력에 없으면 케이스를 만들지 않고 미검증으로 남긴다
- 커버리지가 `generate` 화면에 표시된다
- ADR-0021 이 이 결정의 전제다
- 단계 3 의 호출 수가 케이스 수만큼 늘고, 비용이 가장 큰 경우가 결함이 있는 경우다

재검토 조건도 적었다. 실사용에서 파일 크기나 dry run 비용이 문제가 되면 상한이 아니라 "축
종류별 옵트아웃" 을 먼저 본다. 상한은 어느 축이 빠지는지 사용자가 고를 수 없어 같은 크기를
줄이면서 정보를 더 잃는다.

## Step 3: README 색인

0021 행 다음에 한 행을 추가했다. 형식은 기존 행과 같다.

```
| [0022](./0022-위반-케이스-생성-정책.md) | 위반 케이스는 기본으로, 필드마다, 상한 없이 만든다 | generate | 제안 |
```

## Step 4: 최종 확인

`grep -rn 'from "@ohmymcp-hsu/runner"' packages/generate/src` 로 센 실제 import 심볼과
`APPROVED_RUNNER_SYMBOLS` 가 정확히 일치한다. 어긋난 것이 없다.

```
ContractAxis ContractAxisKind ContractDeclaredType DEFAULT_SENSITIVE_KEYS
MCP_SUITE_JSON_SCHEMA REDACTED RunnerRedactionOptions SpecFindingsResult
SuiteValidationIssue TestCaseSpec TestSuiteSpec canonicalJson
checkAssertionSubstance checkInputContract deepFreeze deriveContractAxes
matchCoveredAxes sha256 validateMcpSuite
```

계약 축 작업이 더한 것 다섯: `ContractAxis`, `ContractAxisKind`, `ContractDeclaredType`,
`deriveContractAxes`, `matchCoveredAxes`. ADR-0009 의 심볼 표도 이 다섯을 담고 있다.

`render.ts:75` 의 `@ohmymcp-hsu/runner` 는 생성 파일에 넣을 문자열 리터럴이고 이 패키지의 의존이
아니다. 경계 테스트가 줄 시작 앵커로 그것을 이미 걸러낸다.

## 검증

| 명령 | 판정 줄 |
|---|---|
| `pnpm test` | `Test Files  49 passed (49)` / `Tests  1010 passed \| 1 skipped (1011)` |
| `pnpm typecheck --force` | `Tasks: 6 successful, 6 total` / `Cached: 0 cached, 6 total` |
| `pnpm lint` | `Checked 148 files in 57ms. No fixes applied.` |

이번에는 `core` flake 없이 첫 실행에서 통과했다.

## 계획서 전체를 돌아본 남은 위험

이 작업(T5~T10)이 끝난 시점에 남는 것들이다. T1~T4 는 다른 터미널의 결과라 여기 적지 않는다.

### 1. ADR 표와 승인 심볼 목록을 잇는 자동 검사가 없다

`dependency-boundary.test.ts` 는 실제 import 와 `APPROVED_RUNNER_SYMBOLS` 만 대조하고 ADR-0009 의
심볼 표는 보지 않는다. 이 작업에서 T6b 와 T7 이 연달아 손으로 맞췄다. 두 번 손으로 맞춘 것은
세 번째에 잊는다는 뜻이다. ADR 표를 파싱해 목록과 대조하는 테스트가 있으면 닫힌다.

### 2. 지문 상수의 소재가 어디에도 적혀 있지 않다

`KNOWN_CLEAN_FINGERPRINT`(`authoring-session.test.ts`)와
`KNOWN_PROVIDER_FINGERPRINT`(`authoring-request.test.ts`) 둘이다. 계획서 Task 8 의 Files 목록이
이 둘을 세지 않아 범위 확장이 필요했다. baseline 출력을 바꾸는 다음 변경에서 같은 일이 난다.

### 3. `isError: true` 는 거절과 다른 실패를 구분하지 못한다

설계서 §12 가 이미 적은 구조적 한계다. 서버가 다른 이유로 죽어도 위반 케이스는 초록이다. 오류
본문을 단언하면 구분되지만 MCP 규격에 형식이 없다. 단계 4(repair)에서 요구로 올라온다.

### 4. 기존 승인 지문이 전부 무효가 된다

`BASELINE_POLICY_VERSION` v2 의 목적이지만, 이미 승인해 둔 사용자는 재승인 흐름을 한 번 거쳐야
한다. 그 안내 문구가 지금 화면에 없다. 지문이 안 맞는다는 사실만 보이고 왜 안 맞는지는 안 보인다.

### 5. 커버리지 화면이 큰 서버에서 길어진다

미검증이 하나라도 있으면 전부 검증된 툴도 함께 찍는다(설계서 §7.2). 툴 30개 서버에서 31줄이다.
그 결정 자체는 옳지만(미검증 툴만 찍으면 나머지 상태를 모른다) 실사용 전에는 읽히는 정도를
알 수 없다.

### 6. 케이스 수 고지 임계는 가정 위에 있다

케이스당 600 바이트는 관측 범위의 상한이다. 응답 본문이 큰 서버는 1500 미만에서도 1MB 에 닿을
수 있다. 고지는 상한이 아니라 안내라 막지 않는다.

### 7. `computeCoverage` 주입 경로를 테스트가 덮지 않는다

`cli` 의 선택 의존성이라 주입이 빠지면 대화형 경로에서 커버리지가 조용히 사라진다. 실제 주입은
`packages/cli/src/index.ts` 한 줄이고 그 줄을 판정하는 테스트가 없다.

### 8. `core` stdio 통합 테스트의 기존 flake

`packages/core/tests/stdio-integration.test.ts` 의 PID 판정이 `pnpm test` 첫 실행에서 한 번
실패했다. `docs/core-stdio-integration-flaky.md` 에 이미 문서화된 기존 결함이고 원인은 PID 파일
대기 예산 200ms 다. 이 작업과 무관하지만 E2E 프로세스가 늘어 재현 빈도가 오를 수 있다.

## 커밋 제안

```
docs(generate): 위반 케이스 생성 정책 ADR-0022 를 추가한다
```
