# Task T4 보고서 (PR #51 리뷰 대응)

## 실행 환경

```
pwd
<repository-root>/.claude/worktrees/ohmymcp-cli-report-rendering

git rev-parse HEAD
4e4848f (feat/cli-report-rendering, origin/main 위로 리베이스된 상태)
```

## 변경 파일

```
 M docs/adr/0012-cli-기본-출력-전환.md
 M docs/reports/task-c1-cli-report-rendering.md
 M docs/reports/task-c2-cli-report-rendering.md
 M docs/reports/task-c3-cli-report-rendering.md
 M packages/cli/src/test-command.ts
 M packages/cli/tests/test-command.test.ts
 M packages/runner/src/reporter.ts
 M packages/runner/tests/reporter.test.ts
?? docs/reports/task-c4-cli-report-rendering.md
```

허용 목록 밖 수정은 없다. 새 changeset 을 만들지 않았다. git 명령은 조회만 했다.

## 1. C1 제어 문자 이스케이프

두 파일의 `escapeTerminalText` 조건을 똑같이 바꿨다. 기존 `codePoint === 0x7f` 단독 비교는 새 범위에
흡수됐다.

```ts
// 0x7f..0x9f 는 DEL 과 C1 제어 문자다. U+009B 를 8비트 CSI 로 해석하는 터미널이 있다.
return codePoint <= 0x1f ||
  (codePoint >= 0x7f && codePoint <= 0x9f) ||
  codePoint === 0x2028 ||
  codePoint === 0x2029
  ? `\\u${codePoint.toString(16).padStart(4, "0")}`
  : character;
```

- `packages/runner/src/reporter.ts:38` 의 `escapeTerminalText`
- `packages/cli/src/test-command.ts:152` 의 `escapeTerminalText`

두 함수의 조건식과 주석이 문자 단위로 같다. `grep -A6 "const escapeTerminalText"` 로 대조했다.

이스케이프와 패딩, 색상 삽입의 순서는 건드리지 않았다. 여전히 이스케이프가 먼저다.

### 회귀 테스트

`packages/runner/tests/reporter.test.ts` 에 `C1 제어 문자를 이스케이프한다` 를 추가했다. 기존 제어
문자 이스케이프 테스트들 사이, `이스케이프 뒤 길이로 열을 맞춘다` 바로 앞에 뒀다. `caseId` 와
`spec.name` 양쪽에 U+009B 를 넣고, 출력에 원문 문자가 남지 않으며 이스케이프 표기가 나오는지 본다.

`packages/cli/tests/test-command.test.ts` 에는 기존에
`아직 구현되지 않은 알려진 명령과 제어 문자를 구분한다` 가 U+001B 이스케이프를 단언하고 있었다.
그 바로 뒤에 같은 취지의 `C1 제어 문자도 이스케이프한다` 를 추가했다.

두 테스트 모두 raw 제어 바이트를 문자열 리터럴에 넣지 않는다. `String.fromCodePoint(0x9b)` 로 만들고
기대값은 `"\\u009b"` 로 쓴다.

## 2. 보고서의 절대경로 제거

`task-c1`, `task-c2`, `task-c3` 세 보고서의 pwd 출력에 있던 로컬 절대경로를
`<repository-root>/.claude/worktrees/ohmymcp-cli-report-rendering` 로 바꿨다. 각 파일에서 한 곳씩
모두 세 곳이다. `grep -rn` 으로 `docs/` 전체를 다시 훑어 남은 것이 없음을 확인했다. git SHA 와
브랜치명은 재현에 필요하므로 그대로 뒀다. 이 보고서에도 절대경로를 쓰지 않았다.

## 3. ADR-0012 문장 보정

"stdout 을 파싱하는 소비자는 저장소 안의 E2E 하나뿐이다" 를 실제 소비자 셋을 나열하는 문장으로
바꿨다. `dist-cli-e2e.mjs`, `cli-integration.test.ts`, `generate-integration.test.ts` 다. 주변 논지
(파괴적 변경 비용이 지금 가장 싸다, 미배포 알파, 같은 웨이브에서 함께 고친다)는 그대로 뒀다.

## 검증

```
pnpm vitest run packages/runner/tests/reporter.test.ts
 Test Files  1 passed (1)
      Tests  37 passed (37)

pnpm vitest run packages/cli/tests/test-command.test.ts
 Test Files  1 passed (1)
      Tests  31 passed (31)

pnpm build      Tasks: 6 successful, 6 total
pnpm typecheck  Tasks: 6 successful, 6 total
pnpm lint       Checked 116 files in 24ms. No fixes applied.
pnpm test
 Test Files  35 passed (35)
      Tests  557 passed | 1 skipped (558)

pnpm build && node packages/cli/tests/dist-cli-e2e.mjs
 (종료 코드 0)
```

테스트 수는 T3 시점의 555 에서 557 로 늘었다. 늘어난 둘이 이번에 더한 C1 회귀 테스트다.

## 임의로 판단한 부분

1. **C1 문자를 `String.fromCodePoint(0x9b)` 로 만들었다.** 유니코드 이스케이프 리터럴 대신 이 방식을
   쓴 이유는 편집 과정에서 raw 바이트가 파일에 섞여 들어갈 여지를 없애기 위해서다. 기대값 문자열
   `"\\u009b"` 는 리터럴 그대로 쓴다.
2. **runner 테스트 하나에 `caseId` 와 `spec.name` 두 자리를 한꺼번에 넣었다.** 기존 테스트들은 자리마다
   테스트를 나눴지만, 이번 지적의 핵심은 자리가 아니라 코드 포인트 범위라서 한 테스트로 묶었다.
3. **cli 쪽 테스트를 기존 제어 문자 테스트 바로 뒤에 별도 `it` 으로 뒀다.** 기존 테스트 안에 단언을
   덧붙이면 그 테스트의 이름과 실제 범위가 어긋난다.
4. **조건식을 여러 줄로 나눴다.** 한 줄로는 100 열 제한을 넘는다. biome 이 이 형태를 그대로 통과시킨다.

## 남은 위험

- `escapeTerminalText` 가 여전히 두 곳에 있다. 이번 변경으로 값이 다시 같아졌지만, 앞으로도 한쪽만
  고치면 stdout 과 stderr 의 방어 수준이 갈린다. ADR-0013 에 적힌 위험이 이번에 실제로 드러난 셈이다.
  셋째 사용처가 생기면 `core` 로 올리는 것을 다시 검토하라는 그 ADR 의 결론은 그대로 유효하다.
- U+0080..U+009F 를 이스케이프하면 그 범위를 정상 텍스트로 담은 응답도 이스케이프 표기로 보인다.
  실사용에서 이 범위는 표시 가능한 문자가 아니므로 손실이 아니라고 판단했다.
