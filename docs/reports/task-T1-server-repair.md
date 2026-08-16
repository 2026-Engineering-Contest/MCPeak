# T1 진단 타입과 출력 스키마 보고서

status: READY_FOR_REVIEW

## 요약

계획서 §5 T1 의 계약대로 `packages/generate/src/diagnosis-schema.ts` 와 그 테스트를 만들었다.
검증 넷 전부 통과한다. 1차 시도에서 BLOCKED 였던 의존 경계 충돌은 계획서 정정(B안)으로
해소했다. 아래 "해소된 막힘" 절에 경위를 남긴다.

## 바꾼 파일

- 생성: `packages/generate/src/diagnosis-schema.ts`
- 생성: `packages/generate/tests/diagnosis-schema.test.ts`
- 생성: `docs/reports/task-T1-server-repair.md` (이 파일)

목록 밖 파일 수정 0건. `dependency-boundary.test.ts` 와 ADR 은 손대지 않았다. git 명령 0건.

## 검증

`pnpm vitest run packages/generate/tests/diagnosis-schema.test.ts`

```
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

`pnpm vitest run packages/generate`

```
 Test Files  11 passed (11)
      Tests  191 passed | 1 skipped (192)
```

`pnpm typecheck --force`

```
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
```

검사 파일 수는 0이 아니다. `packages/generate` 에서 `tsc --noEmit --listFiles` 가 `src` 파일
17개를 싣는다.

`pnpm lint`

```
Checked 168 files in 41ms. No fixes applied.
```

## 해소된 막힘

1차 보고는 BLOCKED 였다. 계획서 초안의 계약 첫 줄
`import type { JsonValue } from "@ohmymcp/runner";` 가
`packages/generate/tests/dependency-boundary.test.ts` 를 깼기 때문이다. 그 테스트는
`APPROVED_RUNNER_SYMBOLS` 와 **정확한 일치**를 단언하는데(`expect([...used].sort()).toEqual(...)`)
`JsonValue` 는 목록에 없다. 계획서 전역 제약 25행과 설계서 §8 은 그 목록을 넓히지 말라고 적고
있어, 계약을 그대로 두면 초록이 될 수 없었다.

오케스트레이터(ohmymcp-b2)가 B안으로 결정했고 계획서 §5 T1 계약을 직접 정정했다. 정정 근거는
`packages/runner/src/spec/types.ts:2` 의 `JsonValue` 와 `packages/generate/src/schema.ts:1` 의
`JsonValue` 가 구조적으로 동일하고, 형제 모듈 `authoring-request.ts` 도 runner 의 것을 쓰지 않는
다는 것이다. 나는 계약대로 import 한 줄만 `./schema.js` 로 바꿨다. 타입 정의·스키마 본문·
`MAX_CAUSE_CHARS` 는 한 글자도 안 건드렸다. 승인 심볼 목록은 안 넓혔다.

## 임의로 판단한 지점

- **import 두 줄의 순서를 바꿨다.** `./schema.js` 로 바꾼 직후 biome 이 정렬 위반을 냈다.

  ```
  packages/generate/src/diagnosis-schema.ts:1:1 assist/source/organizeImports  FIXABLE
    × Sort these imports.
  ```

  `authoring-request.js` 를 위로, `schema.js` 를 아래로 놓아 해소했다. 계약의 import 대상과
  심볼은 그대로다. 줄 순서만 다르다. 정정된 계획서는 초안의 순서(`schema.js` 가 위)를 그대로
  이어받았는데 그 순서로는 lint 가 통과하지 않는다. 계획서 §5 의 코드 블록도 같은 순서로
  맞추는 편이 좋다. 계획서는 오케스트레이터 소유라 내가 고치지 않았다.
- 테스트의 재귀 순회 함수 `walk` 를 직접 짰다. 배열 원소와 객체 값을 모두 방문하고, 객체
  노드만 `visit` 에 넘긴다. 계획서가 순회 방식을 지정하지 않아 내가 정했다.
- 동결 테스트는 최상위 `Object.isFrozen` 단언에 더해, 순회로 만난 모든 객체 노드 중 동결되지
  않은 것을 모아 빈 배열임을 단언한다. 계획서의 "최상위와 중첩 객체 모두" 를 이렇게 읽었다.
- `freeze` 헬퍼는 `authoring-schema.ts:8` 의 것과 같은 구현을 계약대로 이 파일 안에 다시 뒀다.
  공용으로 빼면 다른 파일을 고쳐야 해서 하지 않았다.
- `MAX_CAUSE_CHARS` 는 계약의 배치대로 타입 선언 뒤, 스키마 앞에 뒀다.

## 남은 위험

- `DiagnosisDiagnostic.expected`·`actual` 과 `DiagnosisFailure.input` 의 `JsonValue` 가 이제
  generate 로컬 정의다. 번들을 만드는 `cli`(터미널 B)가 runner 의 `JsonValue` 로 값을 넘길 때
  두 정의가 구조적으로 같아 지금은 문제가 없다. 한쪽 정의가 나중에 갈라지면 조용히 어긋난다.
  터미널 B 프롬프트에 이 결정을 전달해야 한다.
- `pnpm test` 전체는 안 돌렸다. 계획서 터미널 A 절차상 T5 이후에 `--force` 로 한 번 도는 것이
  맞다. 이 태스크 범위에서는 `packages/generate` 전체 초록까지 확인했다.
- git 명령은 하나도 실행하지 않았다. 커밋·머지·푸시는 사람 몫이다.
