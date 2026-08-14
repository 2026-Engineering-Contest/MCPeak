# T1 보고서: `runner` 정리와 문안

계획서 `docs/superpowers/plans/2026-08-14-spec-findings-wiring-implementation.md` 의
"Task 1: `runner` 정리와 문안" Step 1~7 을 수행했다. Step 8(커밋)은 하지 않았다.

## 1. 바꾼 파일

| 파일 | 내용 |
|---|---|
| `packages/runner/src/spec-findings.ts` | `SpecFindingCode` 에서 `UNCONSTRAINED_SCHEMA` 삭제, `describeSpecFinding` 의 해당 `case` 삭제, `TYPE_MISMATCH` 문안을 `선언:` 에서 `서버 선언:` 으로 변경 |
| `packages/runner/src/assertion-substance.ts` | `CODE_ORDER` 에서 해당 항목 제거하고 값을 0·1 로 당김, `hasConstraint` 함수와 `walk` 안의 분기 삭제 |
| `packages/runner/tests/assertion-substance.test.ts` | 제거된 코드를 기대하던 테스트를 새 사양으로 교체, 정렬 계약 테스트와 중첩 순회 증거 테스트 추가 |
| `packages/runner/tests/spec-findings.test.ts` | `UNCONSTRAINED_SCHEMA` 문안 테스트 삭제, 개행 이스케이프 테스트 두 곳의 코드 교체, `TYPE_MISMATCH` 문안 기대 갱신 |
| `docs/superpowers/specs/2026-08-14-input-contract-check-design.md` | §3.2 코드 목록, §5.7 규칙과 제거 사유, §7 문안, §10.2 테스트 목록, §10.5 코드 개수 갱신 |

허용 목록 밖 파일은 건드리지 않았다. `packages/core/src/types.ts` 와 루트 빌드 설정은 변경 0건이다.
의존성 추가 0건, `@modelcontextprotocol/sdk` 변경 없음.

## 2. 검증

| 명령 | 판정 줄 |
|---|---|
| `pnpm vitest run packages/runner/tests/assertion-substance.test.ts packages/runner/tests/spec-findings.test.ts` (Step 2, 구현 전) | `Test Files 2 failed (2)` / `Tests 7 failed \| 33 passed (40)` |
| 같은 명령 (Step 5, 구현 후) | `Test Files 2 passed (2)` / `Tests 40 passed (40)` |
| `grep -rn "UNCONSTRAINED_SCHEMA" packages/ --include="*.ts"` | 출력 0줄 |
| `pnpm test` | `Test Files 43 passed (43)` / `Tests 819 passed \| 1 skipped (820)` |
| `pnpm typecheck` | `Tasks: 6 successful, 6 total` |
| `pnpm lint` | `Checked 134 files in 42ms. No fixes applied.` |

`typecheck` 의 검사 파일 수를 따로 확인했다. `pnpm typecheck` 출력에서 `runner` 를 뺀 다섯
패키지가 `cache hit, replaying logs` 였고 그 로그의 경로가 worktree 가 아니라 원본 저장소
경로였다. 캐시 재생이 이 worktree 를 실제로 검사한 증거가 되지 않으므로
`packages/runner` 에서 `npx tsc --noEmit --listFiles` 를 직접 돌려 이 worktree 경로의 파일이
**40개** 검사됐음을 확인했다. 0이 아니다. `runner` 외 패키지는 이 태스크에서 변경이 없으므로
캐시 재생을 그대로 뒀다.

## 3. 임의로 판단한 지점

계획서에 없거나 계획서와 어긋나 내가 정한 것 넷이다.

**1) 테스트 헬퍼 이름.** 계획서 Step 1 의 스니펫은 `codes(...)` 를 쓰는데 파일에 실제로 있는
헬퍼는 `codesAndPaths(...)` 다. "파일에 있는 것을 그대로 쓴다" 는 지시를 따라
`codesAndPaths` 로 적었다.

**2) 깊이 20000·10000 중첩 테스트를 살렸다.** 이 두 테스트는 맨 안쪽 빈 스키마에서
`UNCONSTRAINED_SCHEMA` 가 나는 것으로 "끝까지 순회했다" 를 증명하고 있었다. 코드를 지우면
빈 스키마는 아무 finding 도 내지 않아 증거가 사라진다. 헬퍼 `deepProperties` · `deepItems` 의
맨 안쪽 스키마를 각각 `{ type: "string", minLength: 0 }` · `{ type: "array", minItems: 0 }` 로
바꿔 스택 안전 계약(설계 문서 §9.3)의 회귀 커버리지를 유지했다. 기대 `path` 는 leaf 경로 뒤에
`.minLength` · `.minItems` 가 붙는다.

**3) 빈 스키마 테스트를 지우지 않고 둘로 나눴다.** 계획서는 중첩 `properties` · `items` 의 빈
스키마 테스트를 "finding 이 없다" 로만 바꾸라고 한다. 그것만 남기면 중첩을 순회한다는 사실을
확인하는 테스트가 통째로 없어진다(빈 결과는 순회를 안 해도 나온다). 그래서 "제약 없는 중첩은
finding 이 없다" 두 건은 계획서대로 두고, 중첩 경로에서 `VACUOUS_MIN_LENGTH` ·
`VACUOUS_MIN_ITEMS` 를 실제로 잡고 `path` 가 중첩 경로로 찍히는 테스트 두 건을 새로 더했다.

**4) 계획서 스니펫의 주석 한 줄을 고쳤다.** 계획서 Step 1 의 첫 테스트 주석이
`// UNCONSTRAINED_SCHEMA 제거 후의 사양...` 인데, 이것을 그대로 넣으면 계획서 §6 통합 게이트의
`grep -rn "UNCONSTRAINED_SCHEMA" packages/ --include="*.ts"` 가 0줄이 아니게 된다. 계획서 안에서
두 지시가 충돌한다. 게이트를 살리는 쪽을 택해 주석을 "제약 없는 스키마 코드를 제거한 뒤의
사양이다" 로 고쳐 뜻은 유지하고 토큰만 뺐다.

**5) 설계 문서에서 §7·§8 밖도 손댔다.** 계획서 Step 6 은 §7·§8 정합만 말한다. 실제로는
§3.2(공개 계약의 `SpecFindingCode` 전량), §5.7(검사 규칙 본문), §10.2(테스트 목록),
§10.5("9개 코드")에도 제거된 코드가 남아 있었다. 전량으로 적힌 계약 문서에 죽은 코드가 남으면
다음 소비자가 그것을 보고 분기를 짠다. 같은 파일 안이고 같은 사실을 가리키므로 함께 고쳤다.
§8 의 따옴표 표기는 확인 결과 이미 §7 규칙과 일치했고(`'city'`, `["c","f"]`), §8 예시에
`TYPE_MISMATCH` 가 없어 §7 템플릿 수정으로 충분했다. §8 본문은 바꾸지 않았다.

`hasConstraint` 제거로 `{ minLength: 0 }` 처럼 다른 제약이 없는 스키마도 이제
`VACUOUS_MIN_LENGTH` 를 낸다. 계획서가 명시한 사양이며 §5.7 에 근거를 적어 뒀다.

## 4. 남은 위험

1. **`VACUOUS_*` 가 나는 입력 범위가 넓어졌다.** `hasConstraint` 게이트가 사라져
   `{ minLength: 0 }` 단독처럼 예전에 `UNCONSTRAINED_SCHEMA` 하나만 나던 스키마가 이제
   `VACUOUS_MIN_LENGTH` 를 낸다. 소비자 경로에서는 `validateMcpSuite` 가 그런 명세를 먼저
   거부하므로 도달하지 않지만, 검증을 거치지 않은 입력을 `checkAssertionSubstance` 에 직접
   넘기는 새 호출자가 생기면 출력이 달라진다. T2~T5 는 검증 이후 지점에서만 부른다.

2. **다른 문서에 옛 사양이 남아 있다.** 내 허용 목록 밖이라 손대지 않았다. 최소
   `docs/superpowers/plans/2026-08-14-input-contract-check-implementation.md:173,437,439`,
   `docs/reports/task-t3-input-contract.md`, `docs/reports/task-t1-input-contract.md:131` 이
   제거된 코드를 사양처럼 적고 있다. 완료된 태스크의 기록물이라 그대로 두는 편이 맞을 수도
   있으나, 판단이 필요하면 오케스트레이터가 정해 달라.

3. **`typecheck` 캐시가 원본 저장소 경로를 재생한다.** 이번엔 `runner` 만 바꿔서 문제가 없었다.
   뒤 웨이브에서 `generate` · `cli` 를 고칠 때 같은 캐시 재생이 나오면 그 패키지도 실제로
   worktree 를 검사했는지 따로 확인해야 한다.

4. **`describeSpecFinding` 의 `switch` 가 이제 8개 코드를 덮는다.** 반환 타입이 `string` 이고
   모든 분기가 `return` 하므로 코드를 다시 늘릴 때 분기를 빠뜨리면 `undefined` 가 새는 대신
   타입 오류가 난다. 현재 상태는 안전하다.
