# Task T6 보고서: `buildViolationCases`

## 무엇을 했나

축을 재료로 위반 케이스를 합성하는 `buildViolationCases` 를 만들었다. 계획서 Task 6 의
Step 1~7 을 그대로 따랐고, 위반값 두 표는 값 하나도 바꾸지 않았다.

- `packages/generate/src/violation-cases.ts` 신규. `GeneratedCase`, `buildViolationCases`,
  `TYPE_VIOLATION_VALUE`, `INVALID_ENUM_VALUE`, `enumViolationValue`
- `packages/generate/src/render.ts` 의 지역 케이스 타입을 `GeneratedCase` 로 교체.
  `buildGeneratedCase` 의 반환 타입도 `GeneratedCase` 다. **`buildSuite` 에 위반 케이스를
  끼우지 않았다**(T8 의 일이다)
- `packages/generate/src/index.ts` 에 `buildViolationCases` 와 `GeneratedCase` export 추가
- `packages/generate/tests/violation-cases.test.ts` 신규. 19개

### 지킨 것 넷

1. `deriveContractAxes(tool)` 의 축만 순회한다. `required` 배열과 `properties` 를 직접 읽지
   않는다. `axes` 순서가 그대로 케이스 순서다. 여기서 다시 정렬하지 않는다.
2. `ENUM_VIOLATION` 축의 `declaredType` 이 `null` 이므로 `declaredTypeByField` 맵으로 같은
   필드의 `TYPE_VIOLATION` 축에서 가져온다. `ContractAxis` 객체는 바꾸지 않았다.
3. `REQUIRED_OMITTED` 에서 정상 입력에 키가 없으면 케이스를 만들지 않는다. 계획서의
   `Object.hasOwn` 가드와 주석 전문을 그대로 넣었다.
4. `assertions` 의 `expected` 는 `true | false` 리터럴 유니온이다. `boolean` 으로 넓히지
   않았다.

## 변경 파일

- Create: `packages/generate/src/violation-cases.ts`
- Modify: `packages/generate/src/render.ts`
- Modify: `packages/generate/src/index.ts`
- Create: `packages/generate/tests/violation-cases.test.ts`
- Create: `docs/reports/task-t6-contract-axes.md`

허용 목록 밖 파일은 건드리지 않았다. git 명령은 실행하지 않았다.

## 검증

| 명령 | 판정 줄 |
|---|---|
| `pnpm vitest run packages/generate/tests/violation-cases.test.ts` (구현 전) | `Test Files  1 failed (1)` / `Tests  no tests` (모듈 해석 실패) |
| `pnpm vitest run packages/generate/tests/violation-cases.test.ts` | `Test Files  1 passed (1)` / `Tests  19 passed (19)` |
| `pnpm vitest run packages/generate` | `Test Files  1 failed \| 8 passed (9)` / `Tests  1 failed \| 166 passed \| 1 skipped (168)` |
| `pnpm typecheck --force` | `Tasks: 6 successful, 6 total` / `Cached: 0 cached, 6 total` |
| `pnpm lint` | `Checked 146 files in 29ms. No fixes applied.` |

### 유일한 실패는 T10 이 고치는 것이다

```
× packages/generate가 runner에서 가져오는 심볼은 승인 목록과 정확히 일치한다
+ "ContractAxis"
+ "ContractDeclaredType"
+ "deriveContractAxes"
```

`dependency-boundary.test.ts` 의 `APPROVED_RUNNER_SYMBOLS` 는 정확한 일치를 요구한다. 그 파일은
T6 의 허용 목록에 없고, 계획서 **Task 10 Step 1~2** 가 실제 import 를 세어 목록을 고치는 일을
맡고 있다. 그래서 T6 시점에 이 테스트가 빨간 것은 계획서가 예정한 상태다.

T6 이 실제로 추가한 심볼은 셋이다(`grep -rn 'from "@ohmymcp-hsu/runner"' packages/generate/src` 로
확인).

```
deriveContractAxes  ContractAxis  ContractDeclaredType
```

설계서 §3.3 은 `ContractDeclaredType` 을 "넣지 않는다" 로 예상했지만 실제로는 필요하다.
`TYPE_VIOLATION_VALUE` 의 `Readonly<Record<ContractDeclaredType, JsonValue>>` 와
`declaredTypeByField` 맵의 값 타입에 이름이 필요하다. 계획서 Task 10 Step 1 이 "예상과 다르면
예상을 고치고 그 사실을 보고서에 적는다" 를 지시하므로 여기 적는다. `matchCoveredAxes` 와
`ContractAxisKind` 는 T6 이 쓰지 않는다. T7 의 몫이다.

기존 baseline 테스트는 전부 통과한다. T6 은 baseline 출력을 바꾸지 않는다.

## 임의로 판단한 지점

1. **`GeneratedCase.assertions` 의 배열에 `readonly` 를 걸지 않았다.** 설계서 §3.2 는
   `readonly [...]` 로 적었지만 그대로 두면 `baseline.ts:78` 이 컴파일되지 않는다.

   ```
   src/baseline.ts(78,5): error TS2322: Type 'GeneratedCase[]' is not assignable to type 'TestCaseSpec[]'.
     The type 'readonly [...]' is 'readonly' and cannot be assigned to the mutable type
     'ToolResultAssertionSpec[]'.
   ```

   runner 의 `TestSuiteSpec` 이 `cases: TestCaseSpec[]` 이고 그 안의 `assertions` 도 가변
   배열이다. `baseline.ts` 는 T6 의 허용 파일이 아니라 그쪽을 고칠 수 없다. 프로퍼티 수준
   `readonly` 와 리터럴 유니온은 그대로 남겼으므로 "정상 케이스에 `true` 를 넣는 실수를
   컴파일러가 잡는다" 는 요구는 지켜진다. 이유를 타입 주석에 남겼다.

2. **테스트 하나의 기대값을 내가 잘못 썼다가 고쳤다.** "optional 필드면 정상 입력에 없던 키가
   추가된다" 케이스에서 두 번째 케이스의 기대 입력을 `{ opt: "example", req: 0 }` 으로 썼는데
   실제는 `{ req: 0 }` 이다. 정상 입력에 `opt` 가 없으므로 `req` 축의 케이스에도 없는 것이
   옳다. 구현이 아니라 기대값을 고쳤다.

3. 설계서 §10.2 의 18개 항목에 `REQUIRED_OMITTED` 미생성 케이스를 하나 더해 19개다.
   계획서 Step 4 의 `Object.hasOwn` 가드를 코드로 고정하는 테스트가 §10.2 목록에는 없었다.

4. 픽스처는 `readFileSync(new URL("../../../fixtures/tools-list.sample.json", import.meta.url))`
   로 읽는다. `baseline.test.ts` 가 쓰는 `readFileSync(new URL(...))` 방식과 같다.

## 남은 위험

- `dependency-boundary.test.ts` 가 T10 까지 빨간불이다. 위에 적은 심볼 셋을 그대로 목록에
  넣으면 된다. T7 이 `matchCoveredAxes` 와 `ContractAxisKind` 를 추가할 것이므로 T10 은 T7
  이후의 실제 import 를 다시 세야 한다.
- `TYPE_VIOLATION_VALUE[axis.declaredType as ContractDeclaredType]` 의 단언이 남아 있다.
  계획서 코드 그대로다. `TYPE_VIOLATION` 축은 `declaredType` 이 항상 있다는 것이 runner 의
  계약이라(`contract-axes.ts:105` 가 `field.type !== null` 일 때만 축을 만든다) 실제로는 안전
  하지만, 그 계약이 깨지면 `undefined` 가 입력값이 되고 `JSON.stringify` 에서 키가 사라진다.
- 케이스 id 슬러그 충돌 해소는 `usedIds` 순회 순서에 의존한다. 그 순서는 `deriveContractAxes`
  가 코드 단위로 정렬해 준 것이므로 결정론적이다. runner 가 정렬을 바꾸면 여기 id 가 흔들린다.
  `violation-cases.test.ts` 의 `a-b` / `a_b` 테스트가 그것을 잡는다.

## 커밋 제안

```
feat(generate): 선언을 어긴 입력 케이스를 합성한다
```
