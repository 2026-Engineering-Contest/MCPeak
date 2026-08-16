# T2 `prepareDiagnosisRequest` 보고서

status: READY_FOR_REVIEW

## 요약

계획서 §5 T2 의 시그니처·상수·절단 규칙 셋을 그대로 구현했다. 테스트 11개는 계획서 문장을
이름으로 썼고 전부 통과한다. 검증 넷 모두 초록이다.

## 바꾼 파일

- 생성: `packages/generate/src/diagnosis-request.ts`
- 생성: `packages/generate/tests/diagnosis-request.test.ts`
- 생성: `docs/reports/task-T2-server-repair.md` (이 파일)

목록 밖 파일 수정 0건. `diagnosis-schema.ts`·`authoring-request.ts`·`redaction.ts`·
`canonical.ts`·`index.ts` 손 안 댔다. 의존성 추가 0건. git 명령 0건.

## 검증

`pnpm vitest run packages/generate/tests/diagnosis-request.test.ts`

```
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

`pnpm vitest run packages/generate`

```
 Test Files  12 passed (12)
      Tests  202 passed | 1 skipped (203)
```

`pnpm typecheck --force`

```
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
```

`pnpm lint`

```
Checked 170 files in 41ms. No fixes applied.
```

## 계약을 어떻게 지켰는지

- 상수 둘을 이 파일에 뒀다. `DEFAULT_MAX_REPAIR_CASES = 10`, `MAX_REPAIR_STDERR_BYTES = 8192`.
  근거 주석은 계획서 문장 그대로다.
- 실패 개수는 **앞에서부터** 남긴다(`slice(0, maxCases)`). 정렬·선별 없음.
  `omitted.failures` 에 뺀 수를 담는다.
- stderr 는 **뒤에서부터** 남긴다. `Buffer` 로 바이트 경계를 잡고, 남긴 조각 앞머리의 UTF-8
  연속 바이트(`0b10xxxxxx`)를 문자 시작 바이트가 나올 때까지 걷어낸다. 잘라낸 바이트 수를
  `omitted.stderrBytes` 에 담고 `stderrTruncated` 를 `true` 로 만든다. 원본이 이미
  `stderrTruncated: true` 였으면 그 값을 유지한다(`source.stderrTruncated || tail.omitted > 0`).
- `MAX_REQUEST_BYTES` 는 `authoring-request.ts` 의 것을 import 했다. 상수를 두 벌로 만들지
  않았다. 넘으면 자르지 않고 `RangeError` 를 던지며, 메시지는 기존과 같은
  `"request byte limit을 초과했습니다."` 다.
- `includeStderr` 가 거짓이면 `processDiagnostics` 키를 스프레드로 아예 만들지 않는다.
  `"processDiagnostics" in request` 가 거짓임을 테스트로 고정했다.
- redaction 은 `failures[].input`, `failures[].diagnostics[].expected`·`actual`, `tools` 에만
  적용한다. `redaction.ts` 의 `sanitizeRedactable` 을 쓰고, `tools` 에는 기존
  `TOOL_CONTRACT_PATHS` 가드를 넘긴다. **stderr 에는 적용하지 않는다.** 이것이 의도된 동작임을
  테스트로 고정했다.
- `JsonValue` 는 T1 결정대로 `./schema.js` 로컬 정의를 쓴다. `@ohmymcp/runner` 에서 가져온 것은
  기존 승인 목록 안의 `RunnerRedactionOptions` 하나뿐이고, 그 심볼은 `authoring-request.ts` 가
  이미 쓰고 있다. 승인 목록은 안 넓혔다(`dependency-boundary.test.ts` 통과가 근거다).

## 임의로 판단한 지점

- **지문 계산을 `sha256(request)` 로 썼다.** 계획서 T2 는 `sha256(canonicalJson(request))` 라고
  적었지만, T5 의 승인 검사는 `sha256(preview.request)` 셋이 일치할 것을 요구한다. 이 둘을
  문자 그대로 각각 구현하면 값이 달라 T5 가 항상 `approvalInvalidated` 가 된다. runner 의
  `sha256` 은 `createHash("sha256").update(canonicalJson(value))` 이므로(`packages/runner/src/canonical.ts:101`)
  `sha256(request)` 가 곧 "canonicalJson 을 해시한 값" 이다. 계획서 문장은 이 의미로 읽었다.
  테스트는 `node:crypto` 로 `createHash("sha256").update(canonicalJson(preview.request))` 를
  직접 계산해 비교하므로, 계획서 문장과 T5 검사 양쪽을 동시에 고정한다.
- **선택 필드는 값이 없으면 키를 만들지 않는다.** `tool`·`input`·`approvedAs`·`expected`·
  `actual`·`notes` 를 `undefined` 로 넣으면 `JSON.stringify` 결과가 흔들려 요청 바이트가
  입력에 따라 달라진다. 완료 조건 3 을 지키기 위한 판단이다. `expected`·`actual` 은 값이
  `null` 일 수 있어 `in` 연산자로 키 존재를 본다.
- **`includeStderr: false` 일 때 `omitted.stderrBytes` 는 0 이다.** `omitted` 는 계획서 주석에
  "상한에 걸려 뺀 것들" 로 정의돼 있어, 사용자가 `--no-stderr` 로 통째로 뺀 것은 상한 위반이
  아니라고 봤다. 화면(T10)이 "stderr 제외" 를 따로 알린다는 전제다. 다르게 원하면 알려 달라.
- **`maxCases`·`providerTimeoutMs`·`maxResultBytes` 에 정수·하한 검사를 넣었다.** 계획서에 없는
  검사지만 `prepareAuthoringRequest` 가 같은 검사를 하고 있어 형제 함수와 맞췄다. 상한 검사는
  넣지 않았다(계획서에 근거가 없다).
- **biome 포매팅에 맞춰 줄바꿈을 조정했다.** `tailBytes`·`toFailure` 시그니처와 테스트의
  `TOOLS` 리터럴이 해당한다. 로직은 그대로다.
- 테스트에서 `DEFAULT_SENSITIVE_KEYS` 는 배열이 아니라 `Set` 이다(`packages/runner/src/sanitization.ts:6`).
  `[...DEFAULT_SENSITIVE_KEYS][0]` 로 꺼내 쓴다.

## 남은 위험

- **T5 가 쓸 preview 상태 저장소를 만들지 않았다.** `dispatchDiagnosisRequest` 는 preview 로
  찾아갈 상태(요청·지문·providerId·model)가 필요하고, `authoring-request.ts` 는 모듈 스코프
  `requests` 맵에 그것을 담는다. T2 의 시그니처에 그 요구가 없어 넣지 않았다. T5 가 같은
  파일을 수정하는 태스크이므로 거기서 `prepareDiagnosisRequest` 안에 등록 한 줄을 더하면 된다.
  T5 프롬프트에 이 사실을 넣어라.
  **(이후 경과) T5 에서 해소됐다.** `prepareDiagnosisRequest` 가 모듈 스코프 WeakMap 에 preview
  상태를 등록하고 `dispatchDiagnosisRequest` 가 그것으로 승인을 대조한다.
- `binding` 은 `frozen({} as never)` 다. `authoring-request.ts` 와 같은 방식이고, 브랜드 타입만
  구분한다. T5 가 실제 상태 키로 쓸지 여부는 T5 결정이다.
- `pnpm test` 전체는 안 돌렸다. T5 이후 한 번 도는 것이 계획서 절차다.
  **(이후 경과)** 루트 `test` 스크립트는 turbo 가 아니라 `vitest run` 이라 `--force` 를 받지
  않는다. 캐시 재생을 의심할 대상은 `typecheck` 와 `build` 뿐이고, 계획서 완료 조건도 그렇게
  정정했다.
