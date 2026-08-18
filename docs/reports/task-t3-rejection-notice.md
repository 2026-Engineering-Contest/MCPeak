# Task T3 — `test` 요약의 고지 줄 (`runner`)

작성일: 2026-08-18. 이슈 #89. 참조: 설계 문서 §5.1, 계획서 Task T3. 선행: T2(`4e2c6df`).

## 무엇을 만들었나

`renderReport` 의 요약 줄 아래에 거절 근거 미확인 고지를 붙였다. 설계 문서 §5.1 이 문안을
전량 고정했고 그대로 옮겼다.

| 파일 | 상태 |
|---|---|
| `packages/runner/src/reporter.ts` | 수정 — `rejectionNoticeLines` 추가, 요약 뒤에 붙임 |
| `packages/runner/tests/reporter.test.ts` | 수정 — 신규 6건 |
| `.changeset/runner-rejection-notice.md` | 생성 |

**이번엔 계획서 Files 목록 밖으로 안 나갔다.** T2 와 달리 타입이 안 바뀌어서 파급이 없다.

## 실제 출력

`renderReport` 를 실측 모양의 보고서로 돌려 확인했다.

```
날씨 서버 계약  (3 cases)

✓ get-weather-success       정상 조회
✓ get-weather-missing-city  city 누락 거절
✓ get-weather-type-city     city 타입 위반 거절

3 passed  (3 total)

  → 거절을 기대한 케이스 2건은 거절 근거를 확인하지 못했습니다.
    서버가 거절한 것인지 다른 이유로 실패한 것인지 이 도구는 판단하지 못합니다.
    확인: ohmymcp generate 의 승인 화면에서 해당 케이스의 응답을 확인하세요.
```

세 케이스가 전부 `✓` 다. **케이스 목록에 아무 표시도 안 붙었다.** 통과한 케이스 옆에 기호가
붙으면 판정이 바뀐 것으로 읽힌다는 §5.1 의 요구를 테스트가 문자열 완전 일치로 고정한다
(`"✓ u0  미확인0"`).

## 임의로 판단한 것

### 1. 고지에 색을 안 넣었다

계획서는 "색상은 기존 요약과 같은 규칙을 따르고, `colorEnabled` 가 false 면 SGR 을 넣지
않는다" 고 적었다. **기존 요약 줄(`summaryLine`)에는 SGR 이 하나도 없다.** 그래서 "같은 규칙" 을
"색을 안 넣는다" 로 읽었다. 결과적으로 `color: true` 와 `false` 의 고지 줄이 바이트까지 같고,
그 사실을 테스트가 단언한다.

다르게 읽을 수도 있다. 2·3번째 줄을 `해결:` 힌트처럼 dim(`SGR 2`)으로 칠하는 안이었다. 그쪽이
보기에는 낫지만 계획서 문장의 근거가 약해서 안 했다. 뒤집으려면 `rejectionNoticeLines` 에
`color` 인자를 넘기고 `sgr("2", ...)` 를 두 줄에 두르면 된다.

### 2. 고지 앞에 빈 줄을 하나 넣었다

설계 문서 §5.1 의 예시가 요약과 고지 사이를 비워 뒀다. 그 모양 그대로다.

### 3. 1건일 때도 같은 문장을 쓴다

"케이스 1건은" 이 된다. §5.1 이 단수형을 따로 안 줬고, 낱말을 우리가 지어내는 것보다 문안을
하나로 두는 편이 낫다고 봤다. 테스트가 고정한다.

## 검증

| 명령 | 결과 |
|---|---|
| `vitest run packages/runner/tests/reporter.test.ts` | 46건 통과 (신규 6 포함) |
| `pnpm test` | 1788건 통과 · 3 skipped (기점 1782 + 신규 6) |
| `turbo run typecheck --force` | 6/6 통과, `Cached: 0 cached` |
| `biome ci .` | 200 파일 통과 |

기존 렌더러 테스트 40건이 전부 그대로 통과한다. `rejectionUnverified` 가 0 인 보고서는 출력이
한 글자도 안 바뀐다는 뜻이다. `SUMMARY_LABELS` 에 새 키를 넣지 않았으므로 요약 줄 자체도
그대로다.

## 남은 것

- **W5 실환경 검증(게이트 6·7)은 아직이다.** `examples/weather-server` 는 `rejectionUnverified`
  가 6 이므로(T2 에서 실측) 실제 `ohmymcp test` 에 이 고지가 뜬다. `pnpm build` 후
  `pnpm --filter ohmymcp test:e2e` 로 확인할 자리다.
- 다음은 **T4**(`cli` 승인 화면). T2 보고서에 적은 문제가 그대로 남아 있다 — **`TestCaseResult`
  에 응답 본문이 없어서** §5.2 의 `응답: ...` 줄을 지금 계약으로는 못 그린다. T4 가 시작 전에
  본문을 어디서 가져올지 정해야 한다.
