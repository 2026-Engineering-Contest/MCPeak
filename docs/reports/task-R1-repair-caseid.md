# R1 `caseId` 를 요청별 enum 으로 박기 보고서

status: READY_FOR_REVIEW

## 요약

`caseId` 의 허용 값을 요청 단계에서 알려준다. 요청별 출력 스키마를 만드는
`buildDiagnosisProviderSchema(request)` 를 더하고, 프롬프트에 허용 목록과 규칙 문장을 넣고,
`diagnose` 가 고정 스키마 대신 요청별 스키마를 넘기게 했다. `validateDiagnosisResult` 는 안
건드렸다. 기존 테스트는 하나도 안 깨졌다.

## 바꾼 파일

- 수정: `packages/generate/src/diagnosis-schema.ts` (`buildDiagnosisProviderSchema`,
  `diagnosisCaseIds` 추가. `DIAGNOSIS_PROVIDER_SCHEMA` 는 그대로 남겼다)
- 수정: `packages/generate/src/diagnosis-prompt.ts` (허용 목록과 규칙 문장 추가, 스키마를
  요청별로 만든다)
- 수정: `packages/generate/src/providers.ts` (`diagnose` 가 넘기는 스키마 한 줄)
- 수정: `packages/generate/src/index.ts` (새 함수 둘 export)
- 수정: `packages/generate/tests/diagnosis-schema.test.ts` (테스트 8개 추가, 기존 4개 무변경)
- 수정: `packages/generate/tests/diagnosis-prompt.test.ts` (테스트 2개 추가, 기존 단언 3곳을
  요청별 스키마 기준으로 갱신)
- 생성: `docs/reports/task-R1-repair-caseid.md` (이 파일)

`packages/cli` 수정 0건. `validateDiagnosisResult` 수정 0건. 의존성 추가 0건. git 명령 0건.
실제 `codex`·`claude` 프로세스 호출 0건.

## 검증

`pnpm vitest run packages/generate`

```
 Test Files  15 passed (15)
      Tests  240 passed | 1 skipped (241)
```

main 기준 230 에서 10 이 늘었다. 늘어난 10 이 이번에 추가한 테스트이고 기존 230 은 전부 통과한다.

`pnpm typecheck --force`

```
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
```

`pnpm lint`

```
Checked 183 files in 45ms. No fixes applied.
```

## 무엇을 어떻게 고쳤는가

- `buildDiagnosisProviderSchema(request)` 가 요청의 실패 `caseId` 를
  `properties.causes.items.properties.caseId.enum` 에 넣는다. 순서는 요청 순서 그대로이고
  중복은 한 번만 담는다. 정렬하지 않는다. 다시 정렬하면 같은 입력에서 스키마 바이트가 흔들린다.
- ADR-0007 제약은 그대로다. 최상위 조합자 없음, `$ref`/`$defs` 없음, 재귀 없음,
  `minLength`·`minItems` 없음. `enum` 은 고정 스키마도 이미 `status`·`target` 에 쓰는
  키워드다. 결과는 고정 스키마와 같이 동결한다.
- 프롬프트에 허용 목록과 규칙 두 문장을 넣었다. 배치는 역할 문장 바로 뒤, 스키마 앞이다.
  역할 문장 두 갈래와 맨 뒤 untrusted 경고는 한 글자도 안 바꿨다.

  ```
  허용 caseId 목록:
  ["get-weather-success","get-weather-busan-success"]
  caseId 는 위 목록의 값 하나여야 한다. 여러 값을 이어 붙이지 않는다.
  여러 케이스가 같은 원인이면 항목을 나눠 각각 낸다. 같은 문장이 반복돼도 된다.
  ```
- `diagnose` 가 codex `--output-schema` 파일 내용과 claude `--json-schema` 인자 둘 다
  요청별 스키마로 넘긴다. 가짜 runner 로 두 경로 모두 `"enum":["case-1"]` 이 실제로 나가는지
  단언한다.

## 임의로 판단한 지점

- **스키마의 `caseId` 에서 `pattern` 을 뺐다.** `enum` 이 값 집합을 이미 닫으므로 `pattern` 은
  같은 것을 두 번 말하는 것이고, 두 제약이 어긋날 여지만 남는다. 목록의 값에 공백만 있는
  `caseId` 는 애초에 명세 검증이 막는다.
- **실패가 0건인 요청에서는 빈 `enum` 을 만들지 않고 원래 제약(`type: "string"`,
  `pattern: "\\S"`)으로 돌아간다.** 빈 `enum` 은 어떤 값도 만족시킬 수 없어 provider 가 무엇을
  보내든 스키마 위반이 된다. 그 경로는 `repair` 의 `emptyFailures` 검사가 이미 막지만,
  스키마 함수 자체가 쓸 수 없는 스키마를 만들지 않게 뒀다. 테스트로 고정했다.
- **`diagnosisCaseIds(request)` 를 따로 export 했다.** 프롬프트의 목록과 스키마의 `enum` 이
  같은 값이어야 하는데, 두 곳에서 각자 계산하면 갈라질 수 있다. 한 함수를 두 곳이 쓰고,
  둘이 같은 값을 낸다는 것을 테스트가 단언한다.
- **기존 프롬프트 테스트 셋의 단언 대상을 요청별 스키마로 바꿨다.** `프롬프트에
  DIAGNOSIS_PROVIDER_SCHEMA 가 들어간다`, codex 파일 내용, claude `--json-schema` 인자 셋이다.
  테스트 **이름**은 그대로 뒀다. 고정 스키마 상수의 정적 형태는 `diagnosis-schema.test.ts` 의
  기존 4개가 계속 고정한다.
- **`DIAGNOSIS_PROVIDER_SCHEMA` 를 `index.ts` 에서 계속 내보낸다.** `cli` 가 지금 쓰지는
  않지만 공개 API 를 좁히는 것은 이번 결함과 무관한 변경이다.

## 남은 위험

- **provider 가 enum 을 어겨도 우리는 여전히 그 항목을 버린다.** 이번 변경은 어길 이유를 줄인
  것이지 없앤 것이 아니다. 두 CLI 의 structured output 이 `enum` 을 얼마나 강하게 강제하는지는
  우리가 통제하지 못한다. 버린 개수는 화면에 `※ 제안 N건이 검증에서 제외됐습니다` 로 이미
  뜬다. 다만 그 문장은 **왜** 버렸는지 말하지 않는다. R2 가 화면에서 다룰 부분이다.
- 여러 케이스가 한 원인일 때 같은 문장이 여러 번 찍힌다. 합의된 트레이드오프다. 화면에서
  묶어 보여줄지는 R2 판단이다.
- 프롬프트가 조금 길어졌다. 허용 목록은 `caseId` 문자열 수에 비례한다. 실패 개수 상한
  (`DEFAULT_MAX_REPAIR_CASES` 10)이 이미 걸려 있어 요청 바이트 상한에 닿지는 않는다.
