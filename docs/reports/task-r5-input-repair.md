# Task R5: 분류 화면의 시도 이력 (`cli`)

계획서 `docs/superpowers/plans/2026-08-15-dry-run-input-repair-implementation.md` §4 R5 를
구현했다. 화면 문안은 설계 문서 §8.7 을 그대로 옮겼다.

## 바꾼 파일

| 파일 | 상태 |
|---|---|
| `packages/cli/src/dry-run-review.ts` | 수정 |
| `packages/cli/tests/dry-run-review.test.ts` | 수정 (기존 테스트 그대로 두고 뒤에 추가) |

`reviewDryRun` 의 세 번째 인자 `attempts?: ReadonlyMap<string, readonly RepairAttempt[]>` 를
추가했다. 선택이고, 안 넘기면 화면과 반환값이 이전과 완전히 같다. 기존 호출부
(`generate-command.ts`)는 손대지 않았다. 그것은 R6 의 일이다.

## 검증 명령과 실제 출력

### `pnpm test`

```
 Test Files  56 passed (56)
      Tests  1175 passed | 1 skipped (1176)
   Start at  18:17:54
   Duration  1.84s (transform 2.75s, setup 0ms, import 5.18s, tests 7.00s, environment 3ms)
```

`packages/core/tests/stdio-integration.test.ts` 는 이번 실행에서 실패하지 않았다. 재실행이
필요하지 않았다.

R5 파일만 따로 돌린 결과. 기존 14건에 새 8건이 붙어 22건이다.

```
 Test Files  1 passed (1)
      Tests  22 passed (22)
   Duration  89ms (transform 17ms, setup 0ms, import 22ms, tests 3ms, environment 0ms)
```

### `pnpm typecheck --force`

```
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
  Time:    2.304s
```

`Cached: 0 cached` 를 확인했다.

### `pnpm lint`

```
> biome check .

Checked 162 files in 34ms. No fixes applied.
```

## 임의로 판단한 지점

1. **결과 낱말을 `오류` 로 고정한다.** `RepairAttempt.passed` 를 화면에 반영하지 않는다. §8.7 이
   고정한 낱말이 `오류` 하나뿐이고, 통과한 케이스는 애초에 분류 화면의 실패 목록에 오르지
   않는다. `통과` 같은 낱말을 새로 만들지 않았다.
2. **콜론 정렬은 필드명에만 건다.** §8.7 본문이 "필드명 뒤 콜론을 세로로 맞춘다. 가장 긴
   필드명 기준이다" 라고 못 박았다. 예시의 값 뒤 여백은 맞추지 않는다. 한글은 터미널에서 두 칸
   폭이라 문자 수로 맞추면 오히려 어긋난다.
3. **시도가 3건 이상이면 `3번` 처럼 숫자로 적는다.** 교정은 케이스당 최대 2회라(§4.1) 도달할 수
   없는 분기이지만, 화면이 조용히 틀린 낱말을 쓰는 것보다 낫다.
4. **이력 블록 뒤에 빈 줄 한 개를 찍는다.** §8.7 예시가 이력과 선택지 사이를 한 줄 띄운다.

## 남은 위험

- `attempts` 를 넘기는 쪽이 아직 없다. 실제 화면은 R6 배선 뒤에야 확인된다. 지금 검증은
  인메모리 IO 로 찍은 문자열 대조까지다.
- 필드명이나 값이 아주 길면 줄이 접힌다. 설계서가 줄바꿈 규칙을 정하지 않아 자르지 않았다.

## 커밋 메시지

```
feat(cli): 분류 화면에 입력값 교정 시도 이력을 표시한다
```
