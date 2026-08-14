# T2 보고서: `generate` 로컬 후보 경로 배선

계획서 "Task 2: `generate` 로컬 후보 경로 배선" Step 1~5 를 수행했다. Step 6(커밋)은 하지 않았다.

**판정: BLOCKED.** 구현과 대상 테스트는 전부 통과한다. 다만 전체 게이트 두 개가 내 허용 파일
목록 **밖** 파일 때문에 막혀 있고, 둘 다 T2 만으로는 풀 수 없다. 4절에 정확한 내용을 적었다.

## 1. 바꾼 파일

| 파일 | 내용 |
|---|---|
| `packages/generate/src/authoring-types.ts` | `CandidateSpecFindings` 추가, `SanitizedAuthoringCandidate.specFindings` 추가, `LocalCandidateReviewOptions.tools` 에 `description?` · `inputSchema?` 를 열어 줌 |
| `packages/generate/src/authoring-session.ts` | `checkInputContract` · `checkAssertionSubstance` import, `candidateFor` 에서 `redactAuthoringSuite` **이전** 검사, `preview` 리터럴에 `specFindings` 추가 |
| `packages/generate/tests/authoring-session.test.ts` | 헬퍼 셋과 테스트 셋 추가 |

`packages/core/src/types.ts`, `packages/runner`, 루트 빌드 설정은 건드리지 않았다. 의존성 추가
0건(`@ohmymcp/core` 는 이미 `packages/generate/package.json` 의 dependency 다).
`fingerprint: sha256(frozenSuite)` 는 그대로 두었고 `specFindings` 는 `result` 밖에 있다.

## 2. 검증 명령과 판정 줄

| 명령 | 판정 줄 |
|---|---|
| `pnpm vitest run packages/generate/tests/authoring-session.test.ts` (Step 2, 구현 전) | `Tests  2 failed \| 13 passed (15)` — `TypeError: Cannot read properties of undefined (reading 'inputContract')` |
| 같은 명령 (Step 5, 구현 후) | `Test Files  1 passed (1)` / `Tests  15 passed (15)` |
| `pnpm vitest run packages/generate` | `Test Files  1 failed \| 6 passed (7)` / `Tests  1 failed \| 134 passed \| 1 skipped (136)` — 실패는 `dependency-boundary.test.ts` 하나뿐 |
| `pnpm test` | `Test Files  1 failed \| 42 passed (43)` / `Tests  1 failed \| 821 passed \| 1 skipped (823)` — 같은 실패 하나뿐 |
| `npx turbo typecheck --force` | `Tasks: 4 successful, 6 total` / `Cached: 0 cached, 6 total` / `Failed: @ohmymcp/generate#typecheck` |
| `pnpm lint` | `Checked 134 files in 30ms. No fixes applied.` (통과) |

`typecheck` 는 지시대로 `--force` 로 돌렸고 `Cached: 0 cached, 6 total` 로 캐시 재생이 아님을
확인했다.

지문 불변은 실제로 고정됐다. `KNOWN_CLEAN_FINGERPRINT` 를 구현 **이전** 실행에서 얻어
(`45dc074424110a20527c3856a026adc017013d25fc403f783f9eeab3a93ccc1c`) 상수로 박았고, 구현 이후에도
그 값이 그대로 나온다.

## 3. 임의로 판단한 지점

**1) 헬퍼 이름 대응.** 계획서 스니펫의 이름이 파일에 없어 실존 헬퍼로 바꾸거나 새로 만들었다.

| 계획서 | 실제 |
|---|---|
| `baselineFor(tools)` | `createBaselineSuite(tools, { suiteId: "weather", suiteName: "날씨" })` (파일의 `baseline()` 이 쓰는 그대로) |
| `suiteWith({...})` | 새 지역 헬퍼 `sessionWithCase(toolList, testCase)`. 세션을 만들고 승인 suite 의 `cases` 를 케이스 하나로 갈아끼운다. suite identity(`id`·`schemaVersion`)는 유지된다 |
| `cleanSuite` | 파일의 `candidate(session)` |
| `KNOWN_CLEAN_FINGERPRINT` | 파일에 없어 새로 만들었다. 구현 전 실행에서 얻은 값을 박았다 |

새 픽스처 파일은 만들지 않았다. 전부 이 테스트 파일 안의 인메모리 리터럴이다.

**2) 도구 목록을 둘로 나눴다.** 계획서 스니펫의 `weatherTools` 하나로는 두 검사를 못 태운다.
`createBaselineSuite` 가 `units: { enum: [...] }` 를 거부하고(`지원하는 단일 JSON Schema type이
필요합니다`) `additionalProperties` 도 거부한다(`지원하지 않는 JSON Schema 키워드
'additionalProperties'가 있습니다`). 반면 `UNDECLARED_FIELD` 는 `additionalProperties` 가 정확히
`false` 일 때만 난다(설계 문서 §5.3). 그래서 baseline 생성에는 `weatherBaselineTools`(축소
스키마)를, 대조 검사에는 `weatherTools`(`additionalProperties: false` 포함)를 쓴다. baseline
생성기가 지원하는 키워드 부분집합이 대조 검사보다 좁다는 사실을 그대로 드러낸 것이다.
계획서 스니펫에는 `units` 에 `type` 이 없고 `additionalProperties` 도 없어 그대로 쓰면
`UNDECLARED_FIELD` 가 아예 안 난다.

**3) `LocalCandidateReviewOptions.tools` 를 넓혔다.** 기존 타입이
`readonly { readonly name: string }[]` 이라 `inputSchema` 가 없었다. `checkInputContract` 는
`readonly ToolDef[]`(`inputSchema` 필수)를 받는다. 선택지가 셋이었다.

- A안: `readonly ToolDef[]` 로 바꾼다. `inputSchema` 를 **필수**로 만들어 이름만 넘기던 호출자를
  깬다. 저장소 안 호출자는 전부 이미 `inputSchema` 를 넘기지만(`cli/src/generate-command.ts:439`
  는 `readonly ToolDef[]`, `authoring-request.ts:458` 은 `McpToolContext[]`) 공개 타입이라
  바깥 호출자를 깬다.
- B안(채택): `description?` · `inputSchema?` 를 **optional** 로 더한다. 기존 호출자는 그대로
  유효하고, 새 정보를 넘기면 대조가 돌아간다.
- C안: 캐스팅으로 밀어 넣는다. 타입이 거짓말을 하게 된다.

B안을 택하고 `candidateFor` 에서 `ToolDef[]` 로 명시 매핑한다(캐스팅 없음). `inputSchema` 가
없는 도구는 `SCHEMA_NOT_ANALYZABLE` 하나만 나고 그 도구의 다른 검사를 건너뛴다. 위반이 아니라
advisory 이므로 T4 의 위반 개수에 들어가지 않는다.

**4) 검사 위치를 `knownTools` 통과 **뒤**로 뒀다.** 계획서는 "`redactAuthoringSuite` 호출 이전"
만 말한다. `validateMcpSuite` · identity · 툴 allowlist 를 전부 통과한 지점이면서 치환 이전인
자리는 한 곳뿐이라 거기에 뒀다. 그 앞으로 옮기면 검증 안 된 객체가 검사 안으로 들어가 던진다.

## 4. 막힌 지점 (오케스트레이터 판단 필요)

둘 다 내 허용 Files 목록 밖이라 손대지 않았다.

**(A) `packages/generate/tests/dependency-boundary.test.ts` 의 승인 심볼 목록.**

`generate → runner` 의존은 ADR-0009 로 승인된 예외이고, 참조 심볼을 이 테스트의
`APPROVED_RUNNER_SYMBOLS` 배열이 **정확히 일치**로 고정한다. 이번에 세 심볼이 늘었다.

```
+ SpecFindingsResult
+ checkAssertionSubstance
+ checkInputContract
```

ADR-0009 결과 절이 "목록을 넓히려면 이 ADR을 고쳐야 한다. 테스트가 먼저 깨져 그 사실을
알린다" 라고 적고 있다. 지금 그 설계대로 동작한 것이다. 계획서는 이 게이트를 예상하지 못했고
(T2 Step 5 는 `dependency-boundary.test.ts` 가 "통과한다"고 적혀 있다) 파일도 태스크 Files 에
없다. 필요한 조치는 둘이다.

1. `docs/adr/0009-generate가-runner에-의존하는-예외.md` 의 심볼 표에 위 셋을 더한다.
2. `packages/generate/tests/dependency-boundary.test.ts` 의 `APPROVED_RUNNER_SYMBOLS` 에 위 셋을
   알파벳 순서로 끼워 넣는다(`SpecFindingsResult` 는 대문자 그룹, 나머지 둘은 소문자 그룹).

**(B) `packages/generate/src/authoring-request.ts` 의 candidate 리터럴.**

```
src/authoring-request.ts(423,18): error TS2345: ... Property 'specFindings' is missing
src/authoring-request.ts(424,31): error TS2741: Property 'specFindings' is missing
```

`specFindings` 를 필수 필드로 만든 결과다. provider 경로의 candidate 리터럴
(`authoring-request.ts:414`)이 그 필드를 안 채워서 타입 오류가 난다. **이 파일을 채우는 것이
바로 T3 이다.** 즉 계획서 설계상 T2 종료 시점의 typecheck 는 원래 깨져 있고, T3 이 끝나야
녹색이 된다. 계획서 T2 Step 5 가 `pnpm vitest run packages/generate` 만 요구하고 typecheck 를
요구하지 않는 것과, 오케스트레이터 지시가 `npx turbo typecheck --force` 통과를 요구하는 것이
어긋난다.

선택지가 둘이다.

- **T3 을 이어서 돌린다(권장).** 계획서의 원래 순서다. T2+T3 을 한 덩어리로 보고 게이트를 T3
  끝에서 건다. `specFindings` 는 필수로 남아 T4 가 optional 분기를 안 써도 된다.
- `specFindings` 를 optional 로 만든다. T2 단독으로 게이트가 녹색이 되지만, T4 가
  `candidate.specFindings?.inputContract` 같은 분기를 써야 하고 provider 경로에 값이 안 실린
  상태가 타입으로 잡히지 않는다. 권하지 않는다.

## 5. 남은 위험

1. **A·B 를 풀기 전에는 `pnpm test` 와 `turbo typecheck --force` 가 빨간불이다.** 두 실패 모두
   원인이 특정돼 있고 다른 회귀는 없다. 실패 1건 외 `821 passed`, typecheck 는 `generate` 외
   4개 패키지 성공이다.
2. **`inputSchema` 를 안 넘기는 호출자는 `SCHEMA_NOT_ANALYZABLE` 만 받는다.** 조용한 침묵이
   아니라 advisory 한 줄로 드러나므로 T4 화면에서 "해석하지 못한 서버 스키마 N건" 으로 보인다.
   의도한 동작이지만, 어떤 호출자가 이름만 넘기고 있으면 그 화면에 줄이 하나 는다. 저장소 안
   호출자는 전부 `inputSchema` 를 넘기므로 지금은 해당 없음이다.
3. **테스트의 도구 목록이 둘로 나뉜 것이 baseline 생성기의 제약에 묶여 있다.**
   `createBaselineSuite` 가 나중에 `additionalProperties` 를 지원하면 둘을 합칠 수 있다. 지금
   합치면 baseline 생성이 던진다.
4. **`KNOWN_CLEAN_FINGERPRINT` 는 baseline 생성 로직이 바뀌면 함께 바뀐다.** 이 상수가 지키는
   것은 "T2 가 지문을 안 바꿨다" 이지 "지문 값이 영원히 이것이다" 가 아니다. baseline 생성을
   고치는 PR 에서 이 테스트가 깨지면 그건 옳은 신호이므로 값을 갱신하면 된다.
