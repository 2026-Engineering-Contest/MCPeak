# T4 선행 — 응답 본문을 `runner` 가 실어 낸다

작성일: 2026-08-18. 이슈 #89. 계획서에 없는 작업이다. 선행: T3(`4558ef9`).

## 왜 필요했나

설계 문서 §5.2 가 승인 화면 문안을 전량 고정했고 계획서가 "그 문장을 한 글자도 바꾸지 마라" 로
못 박았다. 그 문안이 이렇다.

```
거절 근거 미확인 2건
  → fetch-url-required   응답: Input validation error: 'url' is a required property
```

**`응답:` 뒤에 넣을 본문이 어디에도 없다.** T2 가 실은 것은 `rejectionBasis` 판정뿐이고,
`cli` 의 `DryRunCaseOutcome`(`caseId`·`caseName`·`status`·`detail`)에도 본문이 없다.
계획서가 이 구멍을 안 적었다.

## 무엇을 골랐나

세 안을 놓고 **`runner` 가 싣는 쪽**을 골랐다.

| 안 | 왜 안 골랐나 |
|---|---|
| `cli` 가 client 를 감싸 따로 녹음 | 본문 추출 규칙(ADR-0011)이 두 벌이 된다. 같은 응답이 자리에 따라 다르게 읽힌다 |
| 본문 없이 id 만 나열 | §5.2 문안과 달라진다. 고치려면 설계 문서를 먼저 고쳐야 한다 |

`runner` 안은 **추출을 새로 하지 않는다.** T2 가 `readBody()` 를 부른 그 케이스들이 정확히
본문이 필요한 케이스라, 이미 손에 든 값을 넘기는 것뿐이다. ADR-0027 배선도 안 깨진다.

## 무엇을 만들었나

| 파일 | 내용 |
|---|---|
| `packages/runner/src/executor.ts` | `TestCaseResult.rejectionBody?: string` 추가, 채우기 |
| `packages/runner/src/diagnostics.ts` | `clampObservedText` 추출·수출 |
| `packages/runner/src/index.ts` | `clampObservedText` 수출 |
| `packages/runner/tests/executor.test.ts` | 신규 5건 |
| `.changeset/runner-rejection-basis.md` | 본문 필드 설명 추가 |

### 좁게 잡은 것들

- **`unverified` 이고 본문을 읽었을 때만 키를 만든다.** `verified` 는 사람이 다시 볼 이유가
  없고, 전량을 실으면 통과한 모든 케이스의 응답이 보고서에 들어간다. 값이 없을 때 `undefined`
  로 넣지 않고 **키 자체를 안 만든다** — 넣으면 기존 보고서의 JSON 바이트가 흔들린다. 골든
  보고서 테스트가 손대지 않고 그대로 통과하는 것이 그 증거다.
- **자르기와 치환은 진단 값과 같은 규칙이다.** `diagnostics.ts` 안에만 있던 `cut` +
  `withEllipsis` 를 `clampObservedText` 로 묶어 수출하고 그것을 쓴다. 규칙을 두 벌로 두면 같은
  서버 응답이 자리에 따라 다르게 잘린다.
- **치환이 먼저, 자르기가 나중이다.** `renderedValue` 가 지키던 순서 그대로다. 뒤집으면 잘린
  조각이 `sensitiveValues` 일치 검사를 통과하지 못해 `[REDACTED]` 가 안 붙는다.

## 임의로 판단한 것

**상한을 `MAX_VALUE_STRING_CHARS`(200자)로 뒀다.** 보고서의 다른 관찰 값과 같은 상한이라는 것이
근거다. 관찰 코퍼스의 오류 본문은 대부분 150자 안쪽이라 실측 범위는 덮는다.

다만 이 값이 **T6 의 AI 진단에도 그대로 넘어간다.** 200자에서 잘린 본문을 provider 가 보게 되고,
FastMCP 처럼 여러 줄로 길게 오는 응답은 뒤쪽이 잘릴 수 있다. 잘렸다는 사실은 `…(총 N자)` 로
남으므로 조용히 사라지지는 않는다. T6 에서 판단이 부족해 보이면 이 상한을 다시 볼 자리다.

## 검증

| 명령 | 결과 |
|---|---|
| `vitest run packages/runner/tests/executor.test.ts` | 34건 통과 (신규 5 포함) |
| `pnpm test` | 1793건 통과 · 3 skipped (기점 1788 + 신규 5) |
| `turbo run typecheck --force` | 6/6 통과, `Cached: 0 cached` |
| `biome ci .` | 200 파일 통과 |

골든 보고서 테스트를 **이번엔 안 고쳤다.** 그 fixture 의 케이스가 전부 `notApplicable` 이라
`rejectionBody` 키가 안 생긴다. 필드를 좁게 잡은 것이 그대로 확인된 셈이다.

## T4 가 이제 쓸 수 있는 것

```ts
result.rejectionBasis === "unverified"   // 목록에 올릴 케이스
result.rejectionBody                     // "응답: " 뒤에 넣을 문자열. 없을 수 있다
```

`rejectionBody` 가 **없을 수 있다**는 것을 T4 가 처리해야 한다. 던져진 케이스(`server-github`
관찰 12건이 그 경우)는 본문이 없어서 키가 안 생긴다. 그때 §5.2 의 `응답:` 자리를 무엇으로
채울지는 T4 의 판단이다.

`cli` 쪽에서는 `DryRunCaseOutcome` 에 두 값을 옮기는 배선이 먼저 필요하다
(`packages/cli/src/dry-run.ts` 의 `toResult`).
