# Task T5 보고서: `fieldSlug`

## 무엇을 했나

`packages/generate/src/filename.ts` 의 슬러그 계산 본체를 `slugify(name)` 로 분리하고,
`safeBaseName` 과 새 `fieldSlug` 가 그것을 공유하게 했다. 정규식은 한 벌만 남는다.

두 함수의 차이는 fallback 하나뿐이다.

| 함수 | fallback 조건 | fallback 값 |
|---|---|---|
| `safeBaseName` | 슬러그가 비었거나 Windows 예약어 | `tool-<sha256 앞 8자>` |
| `fieldSlug` | 슬러그가 비었을 때만 | `field-<sha256 앞 8자>` |

`fieldSlug` 는 Windows 예약어를 피하지 않는다. 케이스 id 는 파일 이름이 아니라서 피할 이유가
없고, fallback 이 `tool-` 이면 이름이 거짓이 되기 때문이다. 이 사실은 `fieldSlug` 의 JSDoc 에
주석으로 남겼고, 테스트로도 고정했다.

`safeBaseName` 의 관측 가능한 동작은 바뀌지 않았다. 시그니처, 정규화 순서, 자르기 길이(80),
fallback 해시 입력(`name.normalize("NFC")`) 전부 그대로다.

## 변경 파일

- Modify: `packages/generate/src/filename.ts`
- Create: `packages/generate/tests/filename.test.ts`
- Create: `docs/reports/task-t5-contract-axes.md`

## 검증

| 명령 | 판정 줄 |
|---|---|
| `pnpm vitest run packages/generate/tests/filename.test.ts` (구현 전) | `Tests  5 failed (5)`, `TypeError: fieldSlug is not a function` |
| `pnpm vitest run packages/generate/tests/filename.test.ts` | `Test Files  1 passed (1)` / `Tests  5 passed (5)` |
| `pnpm vitest run packages/generate` | `Test Files  8 passed (8)` / `Tests  148 passed \| 1 skipped (149)` |
| `pnpm typecheck --force` | `Tasks: 6 successful, 6 total` / `Cached: 0 cached, 6 total` |
| `pnpm lint` | `Checked 144 files in 46ms. No fixes applied.` |

## 임의로 판단한 지점

- `slugify` 를 export 하지 않고 모듈 내부에 두었다. 계획서 Step 3 에 export 지시가 없고,
  외부에 공개하면 fallback 없는 슬러그가 케이스 id 로 새어 나갈 수 있다.
- `fallbackBaseName` 은 그대로 두고 `fieldSlug` 안에서 해시를 직접 만들었다. 계획서 코드
  그대로다. 접두사만 다른 함수를 하나 더 만들어 공유하는 쪽도 가능했지만, 계획서가 정한
  형태를 바꾸지 않았다.

## 남은 위험

- `fieldSlug` 의 fallback 해시는 `NFC` 입력, `slugify` 는 `NFKD` 입력을 쓴다. 두 정규화가
  섞여 있는 것은 `safeBaseName` 의 기존 구조를 그대로 따른 결과다. 결정론성에는 영향이 없다
  (같은 입력이면 항상 같은 출력).
- `fieldSlug` 는 80자에서 잘린다. 앞 80자가 같은 서로 다른 긴 필드 이름은 같은 슬러그가 된다.
  T6 이 케이스 id 를 조립할 때 충돌 구분자가 필요한지는 그쪽에서 판정할 문제다.

## 커밋 제안

```
refactor(generate): 슬러그 규칙을 공유하고 fieldSlug 를 추가한다
```
