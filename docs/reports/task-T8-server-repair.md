# T8 번들 읽기와 검증 보고서

status: READY_FOR_REVIEW

## 요약

`repair-bundle.ts` 에 `readRepairBundle` 과 사유별 안내 문장을 더했다. `buildRepairBundle` 은
안 건드렸다. 거절 조건은 계획서 목록 그대로이고 넓히지도 좁히지도 않았다. 테스트 8개는 계획서
문장을 이름으로 썼고 전부 통과한다.

## 바꾼 파일

- 수정: `packages/cli/src/repair-bundle.ts` (읽기 타입·`describeRepairBundleInvalid`·
  `readRepairBundle` 추가만. 기존 함수 변경 0건)
- 생성: `packages/cli/tests/repair-bundle-read.test.ts`
- 생성: `docs/reports/task-T8-server-repair.md` (이 파일)

목록 밖 파일 수정 0건. 다른 패키지 수정 0건. 의존성 추가 0건. git 명령 0건.

## 검증

`pnpm vitest run packages/cli/tests/repair-bundle-read.test.ts`

```
      Tests  8 passed (8)
```

`pnpm vitest run packages/cli`

```
 Test Files  17 passed (17)
      Tests  492 passed (492)
```

T7 직후의 484 에서 8 이 늘었다. 기존 484 는 하나도 안 깨졌다.

`pnpm typecheck --force`

```
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
```

`pnpm lint`

```
Checked 177 files in 42ms. No fixes applied.
```

## 거절 조건을 어떻게 지켰는지

| 입력 | 사유 |
|---|---|
| `JSON.parse` 실패 | `notJson` |
| 최상위가 배열·문자열·숫자·`null` | `notObject` |
| `bundleVersion` 이 `REPAIR_BUNDLE_VERSION` 이 아님(없는 경우 포함) | `versionMismatch` |
| `spec` 누락·비객체, `failures` 누락·비배열, 항목 비객체, 항목의 `caseId` 비문자열, 항목의 `diagnostics` 비배열 | `missingField` |
| `failures` 가 빈 배열 | `emptyFailures` |

버전 검사를 필드 검사보다 **먼저** 한다. 모르는 버전에서 필드 누락을 말하면 사용자는 파일을
고치려 들지만 할 일은 다시 만드는 것이다.

빈 배열 검사는 항목 검사 **뒤**다. 항목이 깨진 번들과 실패가 없는 번들은 다음에 할 일이 다르다.

## 안내 문장

사유 다섯의 문장이 서로 다르고, 각각 무엇이 왜 다른지와 다음에 할 일을 담는다. 테스트가
문장 집합의 크기가 5 인지 단언한다.

- `versionMismatch` 는 "최신 `ohmymcp test --repair-bundle` 로 다시 만드세요" 를 안내한다.
- `emptyFailures` 는 "진단할 근거가 없으므로 provider 를 부르지 않습니다" 로 이유를 밝힌다.
- `notObject` 는 경로를 잘못 준 경우를 짚는다. 이 사유는 파일을 다시 만들 일이 아니다.

## 임의로 판단한 지점

- **안내 문장을 문자열로만 돌려준다.** 계획서는 문장이 사유마다 다를 것만 요구했고 반환 형태를
  정하지 않았다. `describeRepairBundleInvalid(reason): string` 로 뒀다. `repair` 명령의 화면
  배선은 T9·T10 이 정하므로, 거기서 `CliFailure` 의 message·hint 로 나눠 담고 싶으면 이 함수를
  두 개로 쪼개면 된다. 지금 쪼개면 쓰지도 않는 형태를 먼저 정하는 것이 된다.
- **`readRepairBundle` 은 `failures` 항목의 `caseId`·`diagnostics` 존재만 본다.** `caseName`·
  `status`·`tool`·`input` 은 검사하지 않는다. 계획서 목록에 없기 때문이다. 조건을 넓히면 다른
  버전의 우리 번들이 거절될 수 있다.
- **`diagnostics` 배열 안의 항목 모양은 검사하지 않는다.** 같은 이유다. 진단 항목의 모양은
  `generate` 의 `validateDiagnosisResult` 가 아니라 요청 조립이 다루는 영역이고, 여기서 거절
  하면 T9 이 쓸 수 있는 번들이 줄어든다.
- **`ok` 반환에서 `parsed` 를 `RepairBundle` 로 단언한다.** 구조 검사를 통과한 값이지만 전체
  필드가 타입과 일치한다는 보장까지는 아니다. 계획서 시그니처가 `bundle: RepairBundle` 이라
  그대로 뒀다.
- biome 포매팅에 맞춰 따옴표와 줄바꿈을 다듬었다. 단언 내용은 같다.

## 남은 위험

- 읽기 함수를 부르는 쪽이 아직 없다. T9 이 `repair` 명령을 배선한다.
- 안내 문장은 T10 의 화면 문안 확정 대상이다. 문장이 바뀌면 이 파일과 테스트를 함께 고쳐야
  한다. 테스트는 `versionMismatch`·`emptyFailures` 두 문장의 핵심 구절만 부분 문자열로 본다.
