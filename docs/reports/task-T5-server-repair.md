# T5 `dispatchDiagnosisRequest` 와 export 보고서

status: READY_FOR_REVIEW

## 요약

`prepareDiagnosisRequest` 에 preview 상태 등록을 더하고, `dispatchAuthoringRequest` 와 같은
조건의 승인 검사를 갖춘 `dispatchDiagnosisRequest` 를 만들었다. `index.ts` 에 진단 통로의 계약을
전부 내보냈다. 터미널 A 의 마지막 태스크이므로 전체 테스트도 돌렸다.

## 바꾼 파일

- 수정: `packages/generate/src/diagnosis-request.ts` (상태 맵·등록·dispatch·failure 매핑 추가)
- 수정: `packages/generate/src/index.ts` (export 추가만)
- 생성: `packages/generate/tests/diagnosis-dispatch.test.ts`
- 수정: `packages/generate/src/providers.ts` (**주석 세 줄만.** 코드 변경 0건)
- 생성: `docs/reports/task-T5-server-repair.md` (이 파일)

목록 밖 파일 수정 0건. 의존성 추가 0건. git 명령 0건.

## 검증

`pnpm vitest run packages/generate/tests/diagnosis-dispatch.test.ts`

```
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

`pnpm vitest run packages/generate`

```
 Test Files  15 passed (15)
      Tests  230 passed | 1 skipped (231)
```

`pnpm typecheck --force`

```
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
```

`pnpm lint`

```
Checked 174 files in 41ms. No fixes applied.
```

`pnpm test`

```
 Test Files  63 passed (63)
      Tests  1354 passed | 1 skipped (1355)
```

**`pnpm test --force` 는 못 돌렸다.** 루트 `package.json:15` 의 `test` 스크립트는 turbo 가 아니라
`vitest run` 이다. `--force` 는 vitest 옵션이 아니라서 그대로 실패한다.

```
CACError: Unknown option `--force`
```

따라서 이 명령에는 turbo 캐시가 끼지 않고 `Cached: 0 cached` 줄도 나오지 않는다. 캐시 재생을
의심해야 하는 것은 `typecheck`·`build` 쪽이고, 그쪽은 `--force` 로 돌려 `Cached: 0 cached` 를
확인했다. 계획서나 로컬 운용 문서에 `pnpm test --force` 가 적혀 있다면 그 문장이 사실과 다르다.

## 계약을 어떻게 지켰는지

- **상태 등록.** `prepareDiagnosisRequest` 가 preview 를 만든 뒤
  `diagnosisRequests.set(preview, { request, fingerprint, providerId, timeoutMs })` 로 잠근다.
  맵은 `WeakMap` 이고 이 파일에만 있다. `authoring-request.ts` 의 맵과 섞지 않았다.
- **승인 검사.** `dispatchAuthoringRequest` 와 같은 조건이다.
  - `approval.approved` 거짓 → `notApproved`
  - 상태 없음, `approval.fingerprint`·`preview.fingerprint`·`sha256(preview.request)` 불일치,
    provider id 불일치, provider model 이 있고 `preview.model` 과 다름 → `approvalInvalidated`
- **보내는 것은 `state.request` 다.** preview 가 들고 있는 것이 아니라 준비 시점에 잠근 사본을
  보낸다. 정상 경로에서 둘이 같다는 것은 지문 검사가 보장한다.
- provider 가 던지면 `providerFailed` 다. `failure` 는 닫힌 enum 으로만 채우고 raw stdout·
  stderr 문자열은 담지 않는다. 테스트가 `UNTRUSTED_MARKER` 와 `"stdout"` 이 결과 직렬화에 0건임을
  단언한다.
- 응답은 `validateDiagnosisResult` 를 거친다. `schemaMismatch` 면 `invalid` 다.
- `index.ts` 에 계획서가 요구한 것을 전부 내보냈다. `prepareDiagnosisRequest`,
  `dispatchDiagnosisRequest`, `validateDiagnosisResult`, `DEFAULT_MAX_REPAIR_CASES`,
  `MAX_REPAIR_STDERR_BYTES`, `MAX_CAUSE_CHARS`, `DIAGNOSIS_PROVIDER_SCHEMA`, T1 의 타입 일곱
  (`DiagnosisDiagnostic`·`DiagnosisFailure`·`DiagnosisProcessDiagnostics`·`DiagnosisRequest`·
  `DiagnosisCause`·`DiagnosisResult`·`ServerDiagnosisProvider`).

## 임의로 판단한 지점

- **`publicProviderFailure` 를 재사용하지 못해 같은 로직을 `diagnosis-request.ts` 에 다시 썼다.**
  그 함수도 `providerFailureCodes`·`providerFailureReasons` 집합도 `authoring-request.ts` 안에
  비공개다. 내보내려면 그 파일을 고쳐야 하는데 T5 의 Files 목록 밖이다. **닫힌 enum 목록이 두
  벌이 됐으니 한쪽만 늘면 조용히 갈라진다.** 후속으로 `authoring-request.ts` 에서
  `publicProviderFailure` 를 내보내 한 벌로 합치는 것을 권한다. 그것은 오너 판단이라 여기서
  하지 않았다.
  **(이후 경과) T5b 에서 합쳤다.** `authoring-request.ts` 가 `publicProviderFailure` 와 두 집합을
  내보내고 `diagnosis-request.ts` 가 그것을 import 한다. 사본은 남아 있지 않다.
- **`index.ts` 에 계획서 목록 밖 넷을 더 내보냈다.** `diagnosisPrompt`,
  `DiagnosisRequestPreview`, `DiagnosisRequestBinding`, `DiagnosisDispatchResult`,
  `DiagnosisValidation` 이다. `dispatchDiagnosisRequest` 의 인자와 반환 타입이라 이것 없이는
  터미널 B 가 타입을 쓸 수 없다. `diagnosisPrompt` 는 화면·테스트에서 프롬프트를 확인할 수
  있게 열어 뒀다. 불필요하면 빼도 된다.
- **`maxResultBytes` 검사를 넣지 않았다.** 계획서의 `DiagnosisDispatchResult` 에
  `resultLimitExceeded` 갈래가 없다. authoring 은 그 갈래가 있어서 검사한다. 진단 응답은 provider
  프로세스 단계에서 `DEFAULT_MAX_RESULT_BYTES` 로 이미 잘리므로 무방하다고 봤다.
- **테스트를 일곱 개 썼다.** 계획서의 여섯에 `index 가 진단 통로의 계약을 전부 내보낸다` 를
  더했다. 터미널 B 가 `index.ts` 만 보고 만들기 때문에 export 누락을 여기서 잡는 편이 낫다.
- **biome 포매팅에 맞춰 `index.ts` 의 export 순서를 정렬했다.** `biome check --write` 를 그 파일
  하나에만 돌렸다.
- `providers.ts` 주석은 세 줄이다. 한 줄로는 "임시 cwd 라 이름이 동작에 영향 없음" 과 "차이를
  둘로 유지" 두 이유를 다 못 적었다.

## 남은 위험

- 위의 닫힌 enum 두 벌 문제. 이번 PR 리뷰에서 정리할지, 별도 후속으로 둘지 판단이 필요하다.
- `dispatchDiagnosisRequest` 는 `AbortSignal` 을 provider 에 그대로 넘긴다. 취소 시 동작은
  provider 구현(`provider-process.ts`)이 정한다. 진단 경로 전용 처리는 없다.
- 터미널 B 는 `packages/generate` 의 **빌드 산출물**을 본다. `pnpm build` 를 먼저 돌리지 않으면
  낡은 계약으로 판정한다. 계획서 §4.2 에 이미 적혀 있다.
