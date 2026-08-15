# T1 보고서: `SuiteApproval.cases` 스키마 확장 (`runner`)

계획서: `docs/superpowers/plans/2026-08-15-dry-run-approval-gate-implementation.md` §4 T1
설계 근거: `docs/superpowers/specs/2026-08-15-dry-run-approval-gate-design.md` §7
커밋 메시지: `feat(runner): 승인 블록에 케이스별 판정을 추가한다`

## 바꾼 파일

| 파일 | 내용 |
|---|---|
| `packages/runner/src/spec/types.ts` | `CaseApprovalStatus`, `SuiteCaseApproval` 추가. `SuiteApproval` 에 `readonly cases?` 추가하고 `fingerprint` 를 `readonly` 로 바꿈 |
| `packages/runner/src/spec/validation.ts` | `validateApprovalCases` 추가. `approval` 의 허용 키에 `cases` 추가 |
| `packages/runner/src/spec/json-schema.ts` | `$defs.suiteCaseApproval` 추가, `suiteApproval.properties.cases` 추가 |
| `packages/runner/src/index.ts` | `CaseApprovalStatus`, `SuiteCaseApproval` 타입 재수출 |
| `packages/runner/tests/spec-validation.test.ts` | `validateMcpSuite / approval.cases` describe 추가 (10 케이스) |
| `packages/runner/tests/suite-fingerprint.test.ts` | 지문 불변 테스트 2개 추가 |

## 공개 계약

계획서 §4 T1 의 블록을 한 글자도 바꾸지 않고 그대로 넣었다.

```ts
export type CaseApprovalStatus = "passed" | "serverDefect";

export interface SuiteCaseApproval {
  readonly id: string;
  readonly status: CaseApprovalStatus;
}

export interface SuiteApproval {
  readonly fingerprint: string;
  readonly cases?: readonly SuiteCaseApproval[];
}
```

## 검증 규칙

계획서의 표 8줄을 그대로 구현했다. `approval.cases` 아래에서 나는 코드는 전부
`INVALID_VALUE` 다. `approval.cases[].id` 가 `cases[].id` 에 실재하는지는 검사하지 않는다
(설계서 §7.3).

## 검증

```
$ pnpm test
 Test Files  49 passed (49)
      Tests  1063 passed | 1 skipped (1064)
```

착수 시점 기준선은 1039 passed 였다. 늘어난 24개가 이번 두 태스크(T1 12개, T7 12개)에서
추가한 테스트다.

```
$ pnpm typecheck --force
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
```

```
$ pnpm lint
Checked 149 files in 32ms. No fixes applied.
```

## 임의로 판단한 지점

1. **`fingerprint` 가 `readonly` 가 됐다.** 계획서의 공개 계약 블록에 `readonly fingerprint`
   라고 적혀 있어 그대로 옮겼다. 기존 선언은 가변이었다. 어디서도 이 필드에 대입하지 않아
   타입체크가 통과한다. 계획서가 값 단위로 못 박은 것을 우선했다.

2. **지문 테스트를 `tests/suite-fingerprint.test.ts` 에 넣었다.** 허용 Files 목록에는
   `packages/runner/tests/fingerprint.test.ts` 가 적혀 있는데 그 파일은 저장소에 없다. 실제
   지문 테스트 파일은 `suite-fingerprint.test.ts` 이고, 계획서가 "기존 테스트 유지" 라고 적은
   `approval 블록 전체를 지워도 지문이 같다` 도 그 파일에 있다. 계획서의 파일명 오타로 보고
   같은 패키지의 실제 파일에 넣었다. 새 파일을 만들면 지문 테스트가 두 곳으로 갈린다.

3. **`MCP_SUITE_JSON_SCHEMA` 검사를 `spec-validation.test.ts` 에 넣었다.** 스키마 테스트의
   기존 자리는 `tests/spec-schema.test.ts` 지만 허용 Files 밖이다. 계획서가 이 단언을
   `spec-validation.test.ts` 의 테스트 목록에 적어 뒀으므로 그대로 따랐다. 그 결과 이 파일이
   `MCP_SUITE_JSON_SCHEMA` 와 `ReadonlyJsonObject` 를 새로 import 한다.

4. **중복 id 를 JSON Schema 로 막지 않았다.** `uniqueItems` 는 항목 전체가 같을 때만 걸려서
   `id` 는 같고 `status` 가 다른 중복을 통과시킨다. 런타임 검증만 잡는다는 사실을
   `json-schema.ts` 주석에 적어 뒀다.

5. **중복 id 와 잘못된 status 에만 전용 문안을 썼다.** 나머지는 기존 `issue()` 의 고정 문안을
   쓴다. 이 블록은 사람이 손으로 쓰는 자리가 아니라 `generate` 가 적는 자리라, 형식이
   어긋났다는 사실 하나로 고칠 곳이 정해진다고 봤다.

## 남은 위험

- 공개 JSON Schema 와 런타임 검증이 중복 id 에서 갈린다(위 4번). 스키마만 통과하고 런타임이
  거절하는 파일이 있을 수 있다. 사용자가 손으로 `approval.cases` 를 편집했을 때만 닿는
  경로다.
- `approval.cases` 의 순서를 명세 `cases` 순서와 맞추라는 설계서 §7.1 의 규칙은 검증하지
  않는다. 이것은 저장하는 쪽(T5·T6)의 책임이다.
