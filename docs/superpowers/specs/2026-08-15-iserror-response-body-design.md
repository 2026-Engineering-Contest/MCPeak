# `isError` 진단의 서버 응답 본문 설계 (2026-08-15)

- 선행 ADR: ADR-0008(승인 화면 redaction 범위), ADR-0011(응답 본문 추출 규칙),
  ADR-0022(위반 케이스 생성 정책), ADR-0025(입력값 교정 권한 경계)
- 이 작업의 ADR: ADR-0027(`isError` 진단이 서버 응답 본문을 함께 싣는다)
- 대상 패키지: `runner`. `cli` 는 **소스를 한 줄도 안 고친다.** 테스트 기대값만 따라 바뀐다.
- 선행 작업: 시험 실행 입력값 교정(R0~R7, 통합 대장 기록 완료)

## 1. 배경

입력값 교정(ADR-0025)을 배선하고 나서 AI 제안 단계가 실제로는 돌지 않는다는 것이 드러났다.
사슬은 넷이다.

1. 생성기가 만드는 정상 케이스의 단언은 `{ type: "isError", expected: false }` 하나뿐이다
   (`packages/generate/src/render.ts`). 본문 단언을 안 붙인다.
2. 그 케이스가 실패하면 `isErrorMismatchDiagnostic` 이 도는데, 이 진단이 담는 것은 고정 문장
   하나와 `expected`·`actual` 두 불리언뿐이다(`packages/runner/src/diagnostics.ts`). 서버가
   무엇이라고 거절했는지는 한 글자도 안 담긴다.
3. `DryRunCaseOutcome.detail` 은 리포터 출력을 케이스별로 자른 것이다. 진단에 없는 값이
   렌더러에서 생길 수 없다.
4. 교정 대상 판별이 뽑는 `serverMessage` 는 `detail` 의 `→ ` 줄에서만 나오고, 그 줄을 만드는
   것은 본문 단언뿐이다. 그래서 항상 빈 문자열이고, 그러면 provider 를 안 부르고 곧바로 사람
   입력으로 간다(입력값 교정 설계 §4.4).

`get_weather` 에 `{"city":"example"}` 를 보내면 서버는 `알 수 없는 도시: example. 사용 가능한
도시: 서울, 부산, 제주` 라고 답한다. 답이 응답 안에 있는데 화면까지 오는 길이 없다.

교정 기능만의 문제가 아니다. **실패 메시지가 곧 제품인 프로젝트에서 실패 화면이 서버가 말해 준
이유를 버리고 있었다.**

## 2. 목표 / 비범위 / 완료 조건

**목표**

- `isError` 단언이 실패했을 때 실제로 받은 응답 본문을 실패 화면에 보여준다.
- 그 결과로 입력값 교정의 AI 제안이 근거를 얻는다.

**비범위**

- 생성기의 단언 구성 변경. ADR-0027 이 배제했다.
- `OperationResult` 나 `ToolResult` 확장. `core/src/types.ts` 는 변경 금지 계약이다.
- 다른 진단(`TOOL_NOT_FOUND`, `BODY_SCHEMA_MISMATCH` 등)의 출력 변경.
- `cli` 소스 변경. 이미 `→ ` 줄을 읽고 있어서 진단만 채우면 붙는다.

**완료 조건**

1. `isError` 로 실패한 케이스의 실패 블록에 응답 본문이 `→ ` 줄로 나온다.
2. `packages/cli/src/repair-target.ts` 를 안 고쳤는데 `serverMessage` 가 채워진다.
3. `examples/weather-server` 에 `{"city":"example"}` 를 보낸 실패 블록 전문이 보고서에 있다.
4. 프로젝트 루트에서 `pnpm test`, `pnpm typecheck --force`, `pnpm lint`,
   `pnpm build && pnpm --filter ohmymcp test:e2e` 가 통과한다.

## 3. 계약 변경 (전량)

```ts
// packages/runner/src/diagnostics.ts
export interface RunnerDiagnostic {
  code: RunnerDiagnosticCode;
  message: string;
  expected?: JsonValue;
  actual?: JsonValue;
  hint: string;
  violations?: SchemaViolationDiagnostic[];
  totalViolations?: number;
  /** 진단에 덧붙이는 자유 문장. 리포터가 violations 와 같은 `→ ` 형식으로 찍는다. */
  notes?: string[];
}
```

`notes` 는 선택이다. 안 채우면 지금과 완전히 같이 동작한다. 다른 진단은 안 고친다.

```ts
// packages/runner/src/assertions.ts
export function assertIsError(
  result: ToolResult,
  spec: IsErrorAssertionSpec,
  extraction: BodyExtraction | undefined,
  options?: { redaction?: RunnerRedactionOptions },
): AssertionResult;
```

`extraction` 은 executor 가 케이스당 한 번 계산한 값을 그대로 넘긴 것이다. 두 번째 추출 구현을
만들지 않는다(ADR-0011). `runner` 안의 호출부는 `executor.ts` 하나다.

## 4. 본문을 싣는 규칙 (전량)

`assertIsError` 가 **실패**를 돌려줄 때만 `notes` 를 채운다.

| 조건 | 동작 |
|---|---|
| 단언이 통과 | `notes` 없음. 진단 자체가 없다 |
| `extraction` 이 `undefined` | `notes` 없음. 선행 작업 결과가 없는 경우다 |
| `extraction.ok === false` | `notes` 없음. 모양을 모르는 값을 짐작해 찍지 않는다 |
| `form === "text"` | 그 문자열을 한 줄로 싣는다 |
| `form === "json"` | 진단이 이미 쓰는 직렬화 규칙으로 한 줄로 만들어 싣는다 |

- `expected` 가 `false` 든 `true` 든 실패했으면 붙인다. 어느 쪽이든 실제로 받은 응답이고 그것이
  사람이 보고 싶은 것이다.
- redaction 을 적용한다. `assertBodyMatchesSchema` 가 이미 받는 `options.redaction` 과 같은
  값이고, 승인 화면과 같은 규칙이어야 한다(ADR-0008).
- `MAX_VALUE_STRING_CHARS` 로 자른다. `diagnostics.ts` 에 이미 있는 자르기 헬퍼를 쓴다. 새로
  만들지 않는다.
- **접두어를 붙이지 않는다.** `서버 응답: ` 같은 라벨을 붙이면 `cli` 의 교정 요청 문안에서
  라벨이 두 번 나온다(입력값 교정 설계 §4.4 가 `서버 응답: ` 을 이미 쓴다). 본문 텍스트만 넣는다.

## 5. 화면

리포터는 `notes` 를 `violations` 와 같은 `→ ` 형식으로 줄마다 찍는다. 자리는 단언 줄 다음,
`hint` 줄 앞이다. 둘 다 있으면 `violations` 를 먼저 찍는다. `escapeTerminalText` 를 `violations`
와 똑같이 적용한다.

지금 화면.

```
  [1] get_weather가 오류 없이 응답한다
      isError  정상 응답을 기대했지만 오류 응답을 받았습니다.
```

바뀐 뒤.

```
  [1] get_weather가 오류 없이 응답한다
      isError  정상 응답을 기대했지만 오류 응답을 받았습니다.
      → 알 수 없는 도시: example. 사용 가능한 도시: 서울, 부산, 제주
```

## 6. 결정론성

같은 응답이면 같은 줄이 나와야 한다. 타임스탬프·랜덤·객체 키 순서에 의존하지 않는다. JSON 본문은
진단이 쓰는 기존 정규화를 그대로 쓴다. 같은 명세를 두 번 돌려 출력 바이트가 같아야 한다.

## 7. 노출

**응답 본문이 터미널에 찍히고, 교정 제안 요청에 실려 외부 provider 로 나간다.** 이것이 이 변경의
유일한 새 노출이다. 경계는 ADR-0008 의 redaction 규칙을 그대로 따르고 새 규칙을 만들지 않는다.

## 8. 알려진 위험

- **기존 기대값이 깨진다.** `isError` 실패 화면 문자열을 단언하는 곳이 확인된 것만 둘이다
  (`packages/runner/tests/assertions.test.ts`, `packages/cli/tests/input-repair.test.ts`).
- **`packages/cli/tests/dry-run.test.ts` 와 `generate-command.test.ts` 는 PR #102 가 같은 시각에
  고치고 있다**(`a4d32ed`, `eaed970`). 이 작업의 기점은 그 커밋들보다 앞이다. 실제로 깨졌을 때만
  손대고, 손댔으면 보고한다. 머지 순서는 PR #102 가 먼저다.
- **`runner` 는 다른 오너의 패키지다.** 이번 변경은 사용자가 명시적으로 승인했다. 승인 범위는
  이 설계서의 계약 변경 두 개와 리포터 한 곳까지다.
