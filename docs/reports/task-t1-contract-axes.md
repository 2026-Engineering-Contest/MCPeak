# T1: 정규화와 기대값 판독을 내부 모듈로 추출

계획서 `docs/superpowers/plans/2026-08-15-contract-axis-coverage-implementation.md` 의 Task 1 을
그대로 구현했다. 판정 기준은 행위 변화 0 이고, `packages/runner/tests/input-contract.test.ts` 의
단언은 하나도 고치지 않았다.

## 바꾼 파일

- 신규 `packages/runner/src/input-schema.ts`
  - `input-contract.ts` 에서 `DeclaredType`, `NormalizedField`, `NormalizedInputSchema`,
    `BLOCKING_KEYWORDS`, `DECLARED_TYPES`, `hasBlockingKeyword`, `declaredType`,
    `normalizeInputSchema`, `judgeField` 를 옮겼다.
  - `normalizeInputSchema` 는 `analyzeInputSchema` 로 이름을 바꾸고 반환을 `InputSchemaAnalysis`
    (`schema` / `unanalyzableReason` / `unanalyzedFields`) 로 넓혔다.
  - 파일 머리에 패키지 내부 전용임을 적었다. `index.ts` 는 건드리지 않았다.
- 신규 `packages/runner/src/case-expectation.ts`
  - `expectedIsError(testCase)` 하나만 담는다. isError 단언이 없으면 `null`, 여러 개인데
    `expected` 가 갈리면 `null` 이다. 역시 패키지 내부 전용이다.
- 수정 `packages/runner/src/input-contract.ts`
  - 옮긴 정의를 지우고 `analyzeInputSchema`·`judgeField`·`NormalizedInputSchema` 를 import 한다.
  - `normalizeOnce` 본문이 `analyzeInputSchema(tool.inputSchema).schema` 로 바뀐 것 외에는
    판정 로직이 그대로다. `CODE_ORDER`, `levenshtein`, `suggestName`, `withSuggestion` 은
    `input-contract.ts` 에 남았다.

## 검증

| 명령 | 판정 줄 |
|---|---|
| `pnpm vitest run packages/runner/tests/input-contract.test.ts` | `Test Files  1 passed (1)` / `Tests  56 passed (56)` |
| `pnpm vitest run packages/runner` | `Test Files  20 passed (20)` / `Tests  417 passed (417)` |
| `pnpm typecheck --force` | `Tasks:    6 successful, 6 total` / `Cached:    0 cached, 6 total` |
| `pnpm lint` | `Checked 141 files in 49ms. No fixes applied.` |

검사 파일 수가 0 이 아님을 따로 확인했다. `packages/runner` 에서
`npx tsc --noEmit --listFiles | grep -c "packages/runner/src"` 가 23 이고, 그 목록에
`input-schema.ts` 와 `case-expectation.ts` 가 모두 들어 있다. `case-expectation.ts` 는 아직
아무 데서도 import 하지 않지만 tsconfig 의 `src` 포함 범위라 타입 검사를 받는다.

## 임의로 판단한 지점

1. 계획서 Step 1 이 허용한 대로 원본의 두 분기(`!plainObject(field) || hasBlockingKeyword(field)`
   와 `Array.isArray(field.type)`) 를 하나로 합쳤다. 두 분기 모두 같은 값을 넣고 continue 하므로
   결과가 같고, 미해석 필드 수집을 한 곳에서 하려면 합치는 편이 낫다. 원본 두 분기에 붙어 있던
   주석은 합친 분기 위에 함께 남겼다.
2. `judgeField` 의 반환 타입을 계획서 시그니처대로
   `"TYPE_MISMATCH" | "ENUM_MISMATCH" | null` 로 좁혔다. 원본은 `SpecFindingCode | null` 이었다.
   실제로 반환하던 값이 이 둘뿐이라 호출부 동작은 같고, `input-contract.ts` 에서
   `SpecFindingCode` import 가 필요 없어진다.
3. `expectedIsError` 의 문서 주석에 "isError 단언이 하나도 없어도 null 이다" 한 줄을 덧붙였다.
   계획서 코드의 동작을 적은 것이고 로직은 계획서 그대로다.

## 남은 위험

- `unanalyzableReason` 과 `unanalyzedFields` 는 아직 아무도 읽지 않는다. 값의 정확성은 T2 가
  축을 만들면서 처음 검증된다. 지금은 `input-contract.ts` 가 `.schema` 만 보므로 이 두 필드가
  틀려도 기존 테스트는 잡지 못한다.
- `case-expectation.ts` 는 소비자가 T4 에서 생긴다. 그때까지 미사용 모듈이다.
- `unanalyzedFields` 의 오름차순은 `Object.keys(properties).sort(byCodeUnit)` 순회에 기댄다.
  나중에 이 순회 순서를 바꾸면 정렬도 함께 깨진다.
