# T5b provider 실패 매핑 한 벌로 합치기 보고서

status: READY_FOR_REVIEW

## 요약

`publicProviderFailure` 와 닫힌 enum 집합 둘을 `authoring-request.ts` 에서 내보내고,
`diagnosis-request.ts` 의 사본을 지워 그 import 로 바꿨다. 함수 본문과 집합 내용은 그대로다.
기존 authoring 테스트는 하나도 안 깨졌다.

## 바꾼 파일

- 수정: `packages/generate/src/authoring-request.ts` (export 셋. 함수 본문·집합 내용 변경 0건)
- 수정: `packages/generate/src/diagnosis-request.ts` (사본 57줄 삭제, import 로 교체)
- 생성: `docs/reports/task-T5b-server-repair.md` (이 파일)

`packages/generate/tests/diagnosis-dispatch.test.ts` 는 고칠 필요가 없었다. 동작이 같아서
그대로 통과한다. `index.ts` 는 안 건드렸다.

## 검증

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
Checked 174 files in 57ms. No fixes applied.
```

`pnpm test`

```
 Test Files  63 passed (63)
      Tests  1354 passed | 1 skipped (1355)
```

T5 직후와 같은 수치다. 회귀 0건.

## 임의로 판단한 지점

- **`publicProviderFailure` 의 두 번째 인자 타입을 넓혔다.** 원래는
  `state: RequestState` 였는데 진단 통로의 `DiagnosisState` 는 그 타입에 대입되지 않는다
  (`request`·`unredactedTools` 등이 없다). 함수 본문이 실제로 읽는 것은 `state.providerId` 와
  `state.timeoutMs` 둘뿐이라, 두 통로가 공통으로 가진 그 둘만 받는 구조적 타입으로 바꿨다.

  ```ts
  state: { readonly providerId: "codex" | "claude"; readonly timeoutMs: number }
  ```

  **본문은 한 글자도 안 바꿨다.** `RequestState` 는 이 모양을 만족하므로 authoring 호출부도
  그대로다. 지시가 "함수 본문과 집합 내용" 을 고정한 것이라 시그니처 조정은 범위 안이라고
  읽었다. 다르게 원하면 되돌리고 진단 쪽에서 어댑터를 만드는 방법도 있다.
- **함수 위에 공유 사실을 적는 주석을 붙였다.** 이 함수가 두 통로의 단일 구현이라는 것이
  코드에 남아야 다음 사람이 또 복사하지 않는다.
- `diagnosis-request.ts` 에서 쓰이지 않게 된 `AuthoringProviderFailureCode`·
  `AuthoringProviderFailureReason` 타입 import 를 지웠다. 남기면 lint 가 잡는다.

## 남은 위험

- 없다. 닫힌 enum 목록이 한 벌이 됐고, 한쪽만 늘어나는 경로가 사라졌다.
- `providerFailureCodes`·`providerFailureReasons` 는 패키지 내부에서만 보인다. `index.ts` 는
  안 건드렸으므로 공개 API 는 그대로다.
