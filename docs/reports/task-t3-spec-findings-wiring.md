# T3 보고서: `generate` provider 후보 경로 배선

계획서 "Task 3: `generate` provider 후보 경로 배선" Step 1~5 를 수행했다. Step 6(커밋)은 하지
않았다. 함께 승인받은 (A) ADR-0009 심볼 목록 확장도 포함한다.

**판정: READY_FOR_REVIEW.** 네 게이트 전부 녹색이다.

## 1. 바꾼 파일

| 파일 | 내용 |
|---|---|
| `packages/generate/src/authoring-request.ts` | `checkInputContract`·`checkAssertionSubstance` import, `RequestState` 에 `unredactedTools` 추가, `contextIssues` 분기 뒤 치환 이전 검사, candidate 리터럴에 `specFindings` 추가, 세션 경로에 넘기는 도구 목록을 원본으로 교체 |
| `packages/generate/tests/authoring-request.test.ts` | `dispatchWithProviderSuite` 헬퍼와 상수 둘, 테스트 셋 추가 |
| `packages/generate/tests/dependency-boundary.test.ts` | `APPROVED_RUNNER_SYMBOLS` 에 세 심볼 추가 (승인 (A)) |
| `docs/adr/0009-generate가-runner에-의존하는-예외.md` | 심볼 표 확장과 확장 사유 한 문단 (승인 (A)) |

T2 에서 고친 세 파일(`authoring-types.ts`·`authoring-session.ts`·`authoring-session.test.ts`)은
이번에 추가로 손대지 않았다. `packages/core/src/types.ts`·`packages/runner`·루트 빌드 설정은
변경 0건이다. 의존성 추가 0건.

## 2. 검증 명령과 판정 줄

| 명령 | 판정 줄 |
|---|---|
| `pnpm vitest run packages/generate/tests/authoring-request.test.ts` (Step 2, 구현 전) | `Tests  3 failed \| 31 passed (34)` — `TypeError: Cannot read properties of undefined (reading 'inputContract')` |
| `pnpm vitest run packages/generate` (Step 5) | `Test Files  7 passed (7)` / `Tests  138 passed \| 1 skipped (139)` |
| `pnpm test` | `Test Files  43 passed (43)` / `Tests  825 passed \| 1 skipped (826)` |
| `npx turbo typecheck --force` | `Tasks:    6 successful, 6 total` / `Cached:    0 cached, 6 total` |
| `pnpm lint` | `Checked 134 files in 28ms. No fixes applied.` |

`typecheck` 는 `Cached: 0 cached, 6 total` 이라 여섯 패키지 전부 실제로 검사했다. T2 보고서가
남긴 위험 3번(캐시 재생이 검사 증거가 아님)이 여기서 해소됐다.

`KNOWN_PROVIDER_FINGERPRINT` 는 구현 **이전** 실행에서 얻어
(`77840d3e4dd6f4ccb1048a05deae403302d9c95723266fb428eed1394fa01b61`) 상수로 박았고, 구현 후에도
같은 값이 나온다. provider 경로 지문도 안 바뀌었다.

## 3. 임의로 판단한 지점

**1) 세션 경로에 넘기는 도구 목록도 원본으로 바꿨다.** 계획서 Step 3·4 는
`validateAuthoringProviderResult` 안의 candidate 만 말한다. 그런데
`dispatchAuthoringRequest` 는 `options.session` 이 있으면 결과를
`reviewLocalAuthoringCandidate({ ..., tools: state.tools })` 로 넘긴다(구 458행). 그 `state.tools`
가 provider 로 보내려고 **치환한** 사본이라, T2 가 세션 경로 안에서 도는 대조에 그대로 들어가
계획서가 막으려던 `ENUM_MISMATCH` 거짓 양성이 그쪽에도 난다. 같은 근거가 같은 값에 적용되므로
`state.unredactedTools` 로 함께 바꿨다. 도구 **이름** allowlist 는 `TOOL_CONTRACT_PATHS` 가
`[i].name` 을 치환에서 빼 주므로 두 목록에서 같고, 그래서 이 교체가 allowlist 판정을 바꾸지
않는다. 계획서에 없는 변경이지만 계획서의 의도를 완성하는 쪽이다.

**2) 헬퍼를 새로 만들었다.** 계획서가 이름을 댄 `dispatchWithProviderSuite` ·
`suiteWith` · `cleanTools` · `cleanSuite` · `KNOWN_PROVIDER_FINGERPRINT` 는 이 파일에 하나도
없었다. 새 픽스처 파일을 만들지 말라는 지시에 따라 전부 테스트 파일 안의 지역 헬퍼로 만들었다.

| 계획서 | 실제 |
|---|---|
| `dispatchWithProviderSuite` | 새 지역 헬퍼. baseline 을 만들고 `prepareAuthoringRequest` → `dispatchAuthoringRequest` 를 한 번 돌린다. **session 을 넘기지 않는다** |
| `suiteWith({...})` | 헬퍼 없이 `{ ...base, cases: [ ... ] }` 리터럴 |
| `cleanTools` | 파일에 이미 있는 모듈 스코프 `tools` |
| `cleanSuite` | 새 헬퍼 `cleanProviderSuite()`. baseline suite 를 그대로 돌려준다 |
| `KNOWN_PROVIDER_FINGERPRINT` | 새 상수. 구현 전 값을 얻어 박았다 |

`session` 을 안 넘기는 것이 중요하다. 넘기면 `dispatchAuthoringRequest` 가 T2 의
`reviewLocalAuthoringCandidate` 로 빠져 T3 이 고친 코드를 지나지 않는다. 그러면 T3 테스트가
T2 를 검증하는 꼴이 된다.

**3) 도구 목록 분리를 여기서도 썼다.** T2 와 같은 이유다. `UNDECLARED_FIELD` 는
`additionalProperties` 가 정확히 `false` 일 때만 나는데 `createBaselineSuite` 는 그 키워드를
거부한다. 그래서 `dispatchWithProviderSuite` 에 `baselineTools` 를 optional 로 두고, 첫 테스트만
baseline 용 축소 목록과 대조용 목록을 따로 넘긴다. 나머지 두 테스트는 두 목록이 같아도 되므로
하나만 넘긴다.

**4) `suite` 를 다시 캐스팅하지 않았다.** 계획서 스니펫은 `suite as TestSuiteSpec` 을 두 번
쓴다. 그 지점의 `suite` 는 이미 위쪽에서 `const suite = raw.suite as unknown as TestSuiteSpec`
으로 좁혀져 있어 캐스팅이 없어도 타입이 맞는다. 불필요한 캐스팅은 나중에 위쪽 좁히기가
사라져도 오류가 안 나게 만들어 오히려 위험해서 뺐다.

**5) ADR-0009 확장 문안.** 심볼 표에 셋을 넣고, 기존 `canonicalJson` 문단과 같은 형식으로
"왜 늘었는가" 를 한 문단 남겼다. 근거는 검사 로직을 `generate` 에 복제하면 `cli test` 가 쓰는
`runner` 구현과 갈려 같은 명세에 두 화면이 다른 문장을 낸다는 것이다.

## 4. 남은 위험

1. **`unredactedTools` 는 `RequestState` 에만 있고 payload 밖이다.** `byte(request)` 와
   `assertJson` 대상에 들어가지 않는 것을 코드 위치로만 보장한다. 나중에 누가 `RequestState`
   전체를 직렬화하거나 `preview` 에 실으면 원본 스키마가 provider 로 새어 나간다. `RequestState`
   는 `WeakMap` 안에만 있고 `preview` 에 노출되지 않으므로 현재는 안전하다. 이 사실을 고정하는
   테스트는 없다.
2. **`MAX_TOOLS_BYTES` 판정은 원본 기준 그대로다.** `prepareAuthoringRequest` 는 예전부터
   `byte(options.tools)` 로 원본을 재고 있었고 이번에 그 계산을 건드리지 않았다. 원본을 한 벌 더
   들고 있게 됐지만 메모리 참조일 뿐 크기 계산에는 안 들어간다.
3. **provider 경로 `specFindings` 는 `result` 밖이라 `sha256(result)` 에 안 들어간다.** 테스트로
   고정했다. 다만 그 상수도 T2 것과 마찬가지로 baseline 생성이나 request 조립이 바뀌면 함께
   바뀐다. 이 상수가 지키는 것은 "T3 이 지문을 안 바꿨다" 이지 값의 영속성이 아니다.
4. **T4 가 읽을 때 두 경로의 `specFindings` 모양이 같은지는 타입으로만 보장된다.** 둘 다
   `CandidateSpecFindings` 를 채우지만, 로컬 경로는 `deepFreeze`, provider 경로는 `frozen` 을
   쓴다(같은 구현의 다른 이름이다). 런타임 동작 차이는 없다.
5. **세션 경로 도구 목록 교체(임의 판단 1)는 T2 테스트가 직접 덮지 않는다.** provider→세션
   경로에서 enum 거짓 양성이 안 나는 것을 고정하는 테스트가 없다. 회귀를 막으려면 T3 의
   ENUM 테스트에 `session` 을 넘기는 변형을 하나 더 두는 편이 낫다. 이번 태스크 범위 밖이라
   하지 않았다.
