# Task T1 보고서 (runner 렌더러)

## 실행 환경

```
pwd
<repository-root>/.claude/worktrees/ohmymcp-cli-report-rendering

git rev-parse HEAD
efb1c9c9a6aeb1ba27557bf13c319b8cab1bdfbc

git rev-parse --abbrev-ref HEAD
feat/cli-report-rendering
```

## 변경 파일

`git status --short` 결과다. 계획서 T1의 Files 목록 밖 파일은 없다. 이 보고서 파일만 추가로 만들었다.

```
 M packages/runner/src/index.ts
?? docs/adr/0013-렌더러-배치와-진단-무분기.md
?? packages/runner/src/reporter.ts
?? packages/runner/tests/reporter.test.ts
```

- 신규 `packages/runner/src/reporter.ts`: `renderReport`, `RenderReportOptions`. 계획서 §4-1부터 §4-7까지 그대로.
- 수정 `packages/runner/src/index.ts`: 한 줄 추가. `export { type RenderReportOptions, renderReport } from "./reporter.js";`
- 신규 `packages/runner/tests/reporter.test.ts`: 테스트 36개. 계획서 §5 T1 표의 35개를 모두 포함한다.
- 신규 `docs/adr/0013-렌더러-배치와-진단-무분기.md`.

`packages/runner/src/diagnostics.ts` 는 손대지 않았다. 문안을 단언하는 테스트도 넣지 않았다.

## 구현 순서

테스트를 먼저 쓰고 실패를 실제로 확인했다.

```
pnpm vitest run packages/runner/tests/reporter.test.ts   (구현 전)
 Test Files  1 failed (1)
      Tests  36 failed (36)
TypeError: renderReport is not a function
```

그다음 `reporter.ts` 를 구현하고, `index.ts` 에서 재수출하고, ADR 을 썼다.

## 검증

### 표적

```
pnpm vitest run packages/runner/tests/reporter.test.ts

 Test Files  1 passed (1)
      Tests  36 passed (36)
   Start at  19:02:10
   Duration  121ms (transform 43ms, setup 0ms, import 55ms, tests 3ms, environment 0ms)
```

### 전체 회귀

```
pnpm build
 Tasks:    6 successful, 6 total
Cached:    3 cached, 6 total
  Time:    1.991s

pnpm typecheck
 Tasks:    6 successful, 6 total
Cached:    5 cached, 6 total
  Time:    803ms

pnpm lint
> biome check .
Checked 116 files in 24ms. No fixes applied.

pnpm test
 Test Files  35 passed (35)
      Tests  542 passed | 1 skipped (543)
   Start at  19:02:30
   Duration  1.52s (transform 1.84s, setup 0ms, import 3.10s, tests 4.12s, environment 1ms)
```

### 검사 대상이 0이 아닌지 확인

`tsc --noEmit` 은 파일 수를 찍지 않으므로 `--listFiles` 로 직접 셌다.

```
cd packages/runner && tsc --noEmit --listFiles | grep reporter
.../packages/runner/src/reporter.ts
.../packages/runner/tests/reporter.test.ts

tsc --noEmit --listFiles | grep -c "packages/runner"
28
```

린트는 `Checked 116 files` 로 0이 아니다.

### raw ESC 바이트 점검

```
grep -rlP '\x1b' packages/runner/src packages/cli/src packages/runner/tests docs/adr/0013-*.md
없음
```

소스와 테스트와 ADR 모두 유니코드 이스케이프 표기만 쓴다.

## 실제 렌더링 결과

빌드된 `packages/runner/dist/index.mjs` 를 직접 불러 인메모리 보고서를 그린 결과다.

```
weather-server 스위트  (3 cases)

✓ tools          툴 목록을 반환한다
✗ weather-seoul  서울 날씨를 반환한다
    bodyMatchesSchema  응답 본문이 스키마와 다릅니다. 위반 1건.
    → $.temperature: 필수 필드가 없습니다. 발견된 필드: 'city', 'condition', 'temp'
    해결: 스키마 변경이 의도된 것이라면 테스트를 업데이트하세요.
⧖ slow-call      대용량 예보를 반환한다
    테스트 '대용량 예보를 반환한다'가 제한 시간 10000ms 안에 완료되지 않았습니다.
    해결: 서버 응답 지연과 테스트의 timeoutMs 설정을 확인하세요.

중단: 케이스 'slow-call' 타임아웃으로 실행을 멈췄습니다.

1 passed, 1 failed, 1 timed out  (3 total)
```

## 임의로 판단한 부분

1. **`stopReasonLine` 의 인자 이름을 `escape` 에서 `escapeText` 로 바꿨다.** 계획서 §4-5 코드를
   그대로 넣으면 biome 의 `lint/suspicious/noShadowRestrictedNames` 가 "Do not shadow the global
   escape property" 로 거부해 `pnpm lint` 가 깨진다. 출력 문자열과 공개 계약은 그대로이고 바뀐 것은
   지역 인자 이름뿐이다. 코드에 그 사유를 주석으로 남겼다.
2. **케이스 사이에 빈 줄을 넣지 않았다.** 계획서 §4-4의 줄 목록에는 케이스 블록 뒤에 빈 줄이 하나
   있는데, 그것을 케이스마다가 아니라 전체 케이스 목록 뒤 한 번으로 읽었다. 설계 문서 §5.1의 전체
   구조가 케이스 줄들을 연속으로 그리고 그 뒤에 빈 줄 하나를 두기 때문이다.
3. **헤더의 케이스 수를 `report.summary.total` 에서 읽었다.** `report.cases.length` 와 같은 값이다.
   계획서 §4-4가 `${total}` 이라고만 적어 요약 줄과 같은 출처를 골랐다.
4. **`idColumn` 과 `typeColumn` 을 `reduce` 로 계산했다.** `Math.max(...list)` 는 빈 배열에서
   `-Infinity` 를 낸다. 케이스가 빈 보고서는 `EMPTY_CASES` 검증이 막지만, 그려야 할 단언이 없는
   케이스는 흔하므로 초깃값 0을 주는 쪽을 택했다.
5. **테스트가 36개다.** 계획서 표의 35개를 모두 옮겼고, 표에는 `단수 케이스에 case를 쓴다` 와
   `복수 케이스에 cases를 쓴다` 가 각각 있으므로 그대로 두 개로 뒀다. 빠뜨린 항목은 없다.
6. **`diagnostic이 없는 failed 단언은 건너뛴다` 를 타입 가드로 구현했다.** 계획서 §4-7의 방어적
   처리를 `isDrawn` 하나로 모아 그 단언의 줄, 위반 줄, 힌트 줄이 모두 빠지게 했다.

## 남은 위험

- **`pnpm test` 첫 실행에서 `packages/core/tests/stdio-integration.test.ts` 가 1건 실패했다.**
  실제 서버 프로세스를 띄우는 테스트이고 `expect(pid).toSatisfy(...)` 지점이다. 같은 파일만 다시
  돌리면 5개 전부 통과하고, 전체 `pnpm test` 를 다시 돌려도 35 파일 542개가 전부 통과한다.
  `packages/runner` 변경과 무관한 플레이키 실패로 보이며 이 태스크에서 손대지 않았다.
  병렬로 다른 worktree가 프로세스를 띄우고 있으면 재현될 수 있다.
- 열 정렬은 코드 포인트 수 기준이라 `caseId` 에 전각 문자가 섞이면 어긋난다. 설계 문서 §5.2가
  알려진 한계로 못 박은 사항이며 이 구현은 그것을 그대로 받았다.
- 이스케이프 규칙이 `packages/cli/src/test-command.ts` 와 `packages/runner/src/reporter.ts`
  두 곳에 있다. 값이 어긋나면 stdout 과 stderr 의 방어 수준이 달라진다. ADR-0013에 적었다.
- T2가 소비할 계약(`renderReport`, `RenderReportOptions`)은 계획서 §4-1과 글자 그대로 같다.
