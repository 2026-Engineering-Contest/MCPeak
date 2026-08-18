# Task T1 — 거절 근거 분류 규칙 (`runner`)

작성일: 2026-08-18. 이슈 #89. 참조: `docs/superpowers/specs/2026-08-18-rejection-basis-verification-design.md` §4.1,
`docs/superpowers/plans/2026-08-18-rejection-basis-verification-implementation.md` Task T1.

## 무엇을 만들었나

응답 본문 문자열만 보고 **SDK 검증이 낸 거절임을 양성으로 확인**하는 순수 함수다. 서버를
호출하지 않는다.

| 파일 | 상태 |
|---|---|
| `packages/runner/src/rejection-basis.ts` | 생성 |
| `packages/runner/tests/rejection-basis.test.ts` | 생성 (15건) |
| `packages/runner/tests/fixtures/rejection-bodies.json` | 읽기만. 안 고쳤다 |

설계 문서 §4.1 의 코드를 **주석까지 그대로** 옮겼다. 세 번째 지문이 툴 이름을 두 번 요구하는
이유가 주석에 남아 있다. 계획서가 특히 이것을 요구했다 — 근거를 모르면 다음 사람이 조건을
단순화하고, 그러면 서버 결함이 초록으로 숨는다.

`index.ts` 는 안 건드렸다. 새 타입 수출은 계획서의 파일 표가 **T2** 로 배정했다. 그래서 T1
단독으로는 공개 API 표면이 안 바뀌고 changeset 도 안 넣었다. T2 가 함께 낸다.

## 판정 규칙 요약

화이트리스트다. 지문 셋에 안 걸리면 전부 `unverified` 다. 모르는 서버·SDK 가 `unverified` 로
떨어지는 방향은 소음이 느는 쪽이라 안전하고, 반대 방향(크래시를 `verified` 로 찍는 것)은
크래시가 숨는다는 뜻이라 허용하지 않는다.

| 지문 | 출처 |
|---|---|
| `MCP error -32602:` 로 시작 | TS SDK 프로토콜 검증 |
| `Input validation error:` 로 시작 | Python 하위 SDK 의 jsonschema 검증 |
| `^Error executing tool <툴>: \d+ validation errors? for <툴>Arguments\b` | FastMCP + pydantic |

세 번째가 **툴 이름을 두 번** 요구하는 것이 이 설계의 안전선이다. FastMCP 는 핸들러가 던진
예외도 같은 접두어로 감싸므로, 모델 이름이 `<툴>Arguments` 인지까지 봐야 입력 검증이 낸 것과
서버가 자기 응답을 검증하다 터진 것이 갈린다.

## 검증

| 명령 | 결과 |
|---|---|
| `vitest run packages/runner/tests/rejection-basis.test.ts` | 15건 통과 |
| `pnpm test` | 1776건 통과 · 3 skipped (기점 1761 + 신규 15. 기존 케이스 판정 변화 없음) |
| `turbo run typecheck --force` | 6/6 통과, `Cached: 0 cached` |
| `biome ci .` | 200 파일 통과 |

### 완료 조건 대조

계획서 §5 의 통합 게이트 중 이 태스크가 책임지는 둘을 실측으로 확인했다.

- **게이트 4 — 관찰 픽스처가 `verified` 64 · `unverified` 16 을 재현한다.** 통과. 80건 전부
  픽스처가 적은 값과 일치하고, 잘못된 `verified` 는 0건이다.
- **게이트 5 — 탐침의 크래시 4건이 전부 `unverified` 다.** 통과. 특히 FastMCP 의
  `2 validation errors for WeatherResponse`(응답 모델 검증 실패)가 `unverified` 로 떨어지고,
  같은 파일의 정상 거절 탐침 2건은 `verified` 다.

`unverified` 16건의 출처도 설계 문서 §4.3 의 표와 정확히 맞는다.

| 출처 | 건수 | 실제 |
|---|---|---|
| `server-github` (던져짐, 본문 없음) | 12 | 정상 거절 |
| `examples/weather-server` (손으로 쓴 문장) | 4 | 정상 거절 |

게이트 6·7(`--json` 바이트 동일, e2e)은 T2 이후와 W5 의 몫이라 여기서 확인하지 않았다.

## 임의로 판단한 것

**없다.** 설계 문서 §4.1 이 함수를 전량으로 적어 뒀고 계획서가 테스트를 전량으로 적어 뒀다.
둘 다 그대로 옮겼다. `RejectionBasis` 타입 선언과 모듈 최상단 주석만 내가 썼고, 내용은 설계
문서 §3.2 의 주석을 옮긴 것이다.

## 남은 위험

- **화이트리스트는 낡는다.** SDK 가 문구를 바꾸면 `verified` 가 `unverified` 로 떨어진다. 소음이
  느는 방향이라 안전하지만, 지문이 낡았다는 사실은 알아야 한다. **이 픽스처 테스트가 그 감시
  장치다. `@modelcontextprotocol/sdk` 버전을 올릴 때 함께 본다.**
- **Go·JVM 구현 서버는 관찰하지 못했다.** 전부 `unverified` 로 떨어진다.
- **손으로 거절하는 서버의 크래시는 원리적으로 못 잡는다.** 거절도 크래시도 자유 문장이라
  구분되지 않는다. 우리 `examples/weather-server` 가 그 예이고, 위 표의 4건이 그것이다.

## T2 가 알아야 할 것

- 호출 지점은 설계 문서 §4.2 다. `executor.ts` 의 케이스 루프에서 단언 평가가 끝난 뒤 한 번
  계산한다.
- `expectsRejection` 은 `expectedIsError(spec) === true` 다. `null`(단언이 없거나 모순)이면
  `false` 로 본다. 모순 명세를 여기서 해석하지 않는다.
- `bodyText` 는 `extractResponseBody` 가 이미 읽은 값을 **재사용한다.** 케이스당 추출 한 번이라는
  현재 규칙(ADR-0027 배선)을 깨지 마라.
- 던져진 케이스(`operation.status === "failed"`)는 본문이 없으므로 `unverified` 다. 관찰의
  `server-github` 12건이 그 경우이고 실제로는 정상 거절이었다. **오탐이 아니라 "모른다" 인
  이유가 §4.3 이다.**
- `RunnerReport.schemaVersion` 은 `1` 을 유지한다. 두 필드 다 추가이고 기존 필드의 의미가
  안 바뀐다.
