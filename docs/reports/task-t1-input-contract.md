# Task T1 보고서 — 공유 계약과 문장 (입력 계약 대조)

- 브랜치: `feat/runner-spec-findings`
- 기점: `3d8f228`
- worktree: `.claude/worktrees/ohmymcp-t1-input-contract`
- 설계 문서: `docs/superpowers/specs/2026-08-14-input-contract-check-design.md` §3.2 · §7 · §10.5
- 구현 계획: `docs/superpowers/plans/2026-08-14-input-contract-check-implementation.md` §3 · §4 Task T1

## 1. 변경 파일

| 파일 | 성격 | 내용 |
|---|---|---|
| `packages/runner/src/spec-findings.ts` | 생성 | 설계 §3.2 의 타입 전량, `MAX_FINDINGS_PER_CASE`, `describeSpecFinding` (§7 문안 전량) |
| `packages/runner/src/input-contract.ts` | 생성 | `InputContractOptions` 와 `checkInputContract` 시그니처 + `throw new Error("not implemented")` 스텁 |
| `packages/runner/src/assertion-substance.ts` | 생성 | `checkAssertionSubstance` 시그니처 + 같은 스텁 |
| `packages/runner/tests/spec-findings.test.ts` | 생성 | 설계 §10.5 케이스 전량 (18 개) |
| `packages/runner/src/index.ts` | 수정 | 위 세 모듈의 export 추가만. 기존 export 문 변경 0 건 |

`git status --short` 결과가 위 5 개뿐이다. `packages/core`, 다른 패키지, 루트 빌드 설정 변경은 0 건이다.

```
 M packages/runner/src/index.ts
?? packages/runner/src/assertion-substance.ts
?? packages/runner/src/input-contract.ts
?? packages/runner/src/spec-findings.ts
?? packages/runner/tests/spec-findings.test.ts
```

## 2. 검증

### 2.1 `pnpm test packages/runner`

```
 RUN  v4.1.10 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-t1-input-contract

 Test Files  14 passed (14)
      Tests  262 passed (262)
   Start at  02:11:40
   Duration  252ms (transform 970ms, setup 0ms, import 1.33s, tests 84ms, environment 1ms)
```

기점의 13 파일 244 테스트에서 14 파일 262 테스트로 늘었다. 늘어난 1 파일 18 테스트가 이 태스크의 산출물이고 기존 테스트의 단언은 한 건도 고치지 않았다.

### 2.2 `pnpm typecheck`

```
 Tasks:    6 successful, 6 total
Cached:    3 cached, 6 total
  Time:    1.762s
```

`tsc --noEmit` 은 성공 시 아무것도 출력하지 않으므로 검사 대상이 0 개인지 따로 확인했다. `packages/runner` 에서 `npx tsc --noEmit --listFiles` 를 돌려 이 worktree 안의 프로젝트 파일이 32 개 잡히는 것과, 그 목록에 새 파일 4 개가 전부 있는 것을 눈으로 봤다.

```
.../packages/runner/src/spec-findings.ts
.../packages/runner/src/assertion-substance.ts
.../packages/runner/src/input-contract.ts
.../packages/runner/tests/spec-findings.test.ts
```

계획서 §10 의 "새 파일이 `index.ts` 에서 export 안 돼 검사 대상에서 빠짐" 거짓 신호를 이걸로 배제했다.

### 2.3 `pnpm lint`

```
Checked 122 files in 31ms. No fixes applied.
```

첫 실행에서 포맷 오류 4 건이 났다. 내가 만든 4 개 파일에만 `biome check --write` 를 돌려 고쳤고 다른 파일은 건드리지 않았다. 포맷 적용 뒤 테스트와 타입체크를 다시 돌려 위 결과를 얻었다.

## 3. 임의로 판단한 지점

### 3.1 문자열 표기: §7 의 규칙 문장을 따랐다 (§8 예시와 어긋난다)

설계 §7 마지막 규칙은 "`expected` 와 `actual` 이 문자열이면 작은따옴표로 감싸고, 그 외 JSON 값이면 `JSON.stringify` 결과를 그대로 쓴다" 이다. 이대로 구현했다.

그런데 §8 의 참고 화면에는 `ENUM_MISMATCH` 의 `actual` 이 큰따옴표로 찍혀 있다.

```
→ input.units 값 "celsius" 는 선언된 값이 아닙니다. 허용: ["c","f"]
```

구현 결과는 이렇다.

```
input.units 값 'celsius' 는 선언된 값이 아닙니다. 허용: ["c","f"]
```

§7 이 문안의 정본이고 §8 은 명시적으로 비범위 참고 화면이라 §7 을 따랐다. §8 예시를 §7 규칙에 맞게 고치는 편이 좋겠다. 문서 수정은 이 태스크의 허용 파일 밖이라 하지 않았다.

### 3.2 enum 배열의 공백

§7 본문에 "`enum` 배열은 `["c", "f"]` 형태로 찍힌다" 라고 쉼표 뒤 공백이 있게 적혀 있다. 같은 문단이 지시하는 `JSON.stringify` 는 `["c","f"]` 로 공백 없이 찍고, §8 의 예시도 공백이 없다. 규칙 문장과 §8 이 일치하므로 `JSON.stringify` 결과를 그대로 썼다.

### 3.3 `{expected}` · `{actual}` 자리의 따옴표

§7 템플릿 중 일부는 `'{actual}'` 처럼 작은따옴표를 문안 안에 직접 적어놨고, `TYPE_MISMATCH` 처럼 안 적은 것도 있다. 두 표기를 각각 따로 구현하면 문자열 값에서 따옴표가 두 번 붙는다. 템플릿의 그 따옴표가 곧 §7 규칙 문장의 적용 예시라고 보고, 값 표기 함수 하나(`literal`)로 통일했다. 결과 문장은 템플릿에 따옴표가 적힌 코드에서도 §7 과 글자 단위로 같다.

`TYPE_MISMATCH` 의 `expected` · `actual` 은 타입 이름 문자열이므로 이 규칙에 따라 작은따옴표가 붙는다.

```
input.city 의 타입이 다릅니다. 선언: 'string', 명세: 'number'
```

`path` 는 `expected` · `actual` 이 아니므로 따옴표 없이 그대로 넣는다.

### 3.4 `suggestion` 은 언제나 문자열

타입이 `string` 이라 JSON 값 표기 규칙 대상이 아니다. §7 템플릿 그대로 작은따옴표만 붙였다.

### 3.5 `describeSpecFinding` 을 `switch` 로 썼다

`SpecFindingCode` 9 개를 전부 다루는 `switch` 라 `default` 없이도 반환 타입이 `string` 으로 좁혀진다. 코드가 늘면 타입 오류로 잡힌다. 문자열 맵으로 두면 새 코드가 조용히 빠질 수 있어 피했다.

### 3.6 export 순서

`biome check` 가 export 문 정렬을 강제한다. `spec-findings.js` 의 export 위치는 포매터가 정한 자리다.

### 3.7 §10.5 에 없는 테스트 2 건을 더 넣었다

- 숫자 `expected` 가 따옴표 없이 JSON 표기로 찍히는지 (§7 규칙의 반대편 분기)
- `MAX_FINDINGS_PER_CASE` 가 10 인지 (설계 §9.3 이 `schema-match.ts` 와 같은 값이라고 못박음)

둘 다 §10.5 케이스를 줄이지 않고 추가만 했다.

## 4. 문안 제안 (적용하지 않음)

계획서 §4 의 경계 조항에 따라 적용하지 않고 제안만 적는다.

1. `TYPE_MISMATCH` 는 "선언" 과 "명세" 라는 낱말만으로 어느 쪽이 서버이고 어느 쪽이 테스트인지 처음 보는 사용자가 헷갈릴 수 있다. "서버 선언: ..., 명세: ..." 가 더 분명하다.
2. `UNCONSTRAINED_SCHEMA` 의 `{path}` 는 `assertions[0].schema` 형태라 문장이 "assertions[0].schema 스키마에" 로 시작해 "스키마" 가 두 번 나온 것처럼 읽힌다.
3. `VACUOUS_MIN_LENGTH` · `VACUOUS_MIN_ITEMS` 는 `{path}` 끝의 키워드 이름에 기대어 "는 0이라" 로 이어진다. `path` 가 `minLength` 로 끝나지 않는 경로가 생기면 문장이 깨진다. T3 이 `path` 를 반드시 그 키워드까지 찍어야 한다.

## 5. 남은 위험

| 위험 | 내용 | 대응 |
|---|---|---|
| 스텁이 그대로 남는다 | `src/` 에 `not implemented` 가 3 건 있다. 기존 `index.ts` 의 deprecated 함수 2 건과 이번 스텁 2 건이다 | T2 · T3 통합 후 `input-contract.ts` · `assertion-substance.ts` 에 `not implemented` 가 0 건인지 확인한다. `index.ts` 의 2 건은 ADR-0002 에 따라 의도된 것이라 남는다 |
| §7 과 §8 의 따옴표 불일치 | 소비자 배선(단계 3 PR 2-B)에서 §8 화면을 그대로 옮기면 출력이 다르게 보인다 | §3.1 참고. §8 예시를 §7 에 맞춰 고치는 문서 수정이 필요하다 |
| `path` 문안 결합 | §4 제안 3 번. `VACUOUS_*` 문장이 `path` 의 끝 낱말에 의존한다 | T3 프롬프트에 이미 "path 를 그 키워드로 찍어 낸다" 가 있다. 통합 게이트에서 확인 |
| 스텁의 미사용 파라미터 | `checkInputContract(options)` 와 `checkAssertionSubstance(suite)` 가 인자를 쓰지 않는다. 현재 lint · typecheck 설정에서는 통과한다(`index.ts` 의 기존 deprecated 함수와 같은 형태) | T2 · T3 이 본문을 채우면 사라진다 |

## 6. 지키지 않은 것 없음 확인

- `packages/core/src/types.ts` 변경 0 건. `ToolDef` 를 `import type` 으로 읽기만 한다
- 다른 패키지 변경 0 건. 루트 빌드 설정 변경 0 건
- 의존 방향은 `runner` → `core` 뿐이다. 역참조 · 순환 없음
- 의존성 추가 0 건. `@modelcontextprotocol/sdk` 변경 없음
- git commit · merge · push 실행하지 않음. 백그라운드 실행 없음. 하위 에이전트 스폰 없음
- 테스트는 전부 인메모리 리터럴이다. 서버를 띄우지 않고 픽스처 파일도 만들지 않았다
