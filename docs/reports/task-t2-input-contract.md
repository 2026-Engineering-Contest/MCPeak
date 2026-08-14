# Task T2 보고서 — 입력 계약 대조

- 브랜치: `feat/runner-input-contract`
- 기점: `33e8e6d`
- worktree: `.claude/worktrees/ohmymcp-t2-input-contract`
- 설계 문서: `docs/superpowers/specs/2026-08-14-input-contract-check-design.md` §4 · §5.1~§5.6 · §9 · §10.1 · §10.3 · §10.4
- 판단 근거: `docs/adr/0015-입력-스키마-부분집합-경계.md`

## 1. 변경 파일

```
 M packages/runner/src/input-contract.ts
?? packages/runner/tests/input-contract.test.ts
```

허용 Files 2 개뿐이다. `spec-findings.ts` · `index.ts` · `assertion-substance.ts` · `packages/core` · 다른 패키지 · 루트 빌드 설정 변경은 0 건이다. 보고서(`docs/reports/task-t2-input-contract.md`)만 추가로 만들었다.

`packages/runner/src/input-contract.ts` 에 `not implemented` 는 0 건이다. `src/` 에 남은 3 건은 `assertion-substance.ts`(T3 담당)와 `index.ts` 의 ADR-0002 deprecated 함수 2 개다.

## 2. 구현 요약

| 부분 | 내용 |
|---|---|
| `normalizeInputSchema` | 부분 성공 없음. 해석 불가면 `null`. 루트 차단 키워드, 루트 비객체, `properties` 없음, 비객체 스키마 전부 `null` |
| 필드 단위 포기 | 필드 스키마가 객체가 아니거나 차단 키워드를 쓰면 그 필드만 `{ type: null, enumValues: null }`. `required` 검사는 계속 |
| `additionalProperties` | `=== false` 일 때만 `UNDECLARED_FIELD`. 없음 · `true` · 스키마 객체는 검사 안 함 |
| 타입 · enum 판정 | `schema-match.ts` 의 `matchResponseSchema` 에 위임 (§3.1 참고) |
| 오타 후보 | 설계 §5.4 6 단계. 거리 ≤ 2 **그리고** ≤ `floor(긴 쪽 길이 / 2)`, 동점은 UTF-16 코드 단위 앞선 것 |
| 정렬 | 케이스 인덱스 → 검사 종류 순서 → `path` UTF-16 |
| 상한 | 케이스마다 `MAX_FINDINGS_PER_CASE` 로 자르고 `totalFindings` 는 자르기 전 총합 |

`tools` 는 이름 맵으로만 조회하고 배열 순서를 쓰지 않는다. 시간 · 난수 · 로캘 의존이 없다.

## 3. 임의로 판단한 지점

### 3.1 `jsonEqual` 과 `byCodeUnit` 은 `schema-match.ts` 에서 export 돼 있지 않다

재사용하라는 지시를 받았으나 `schema-match.ts` 에서 export 된 것은 `plainObject`, `typeName`, `matchResponseSchema`, 상수 · 타입뿐이다. `jsonEqual`(54행)과 `byCodeUnit`(43행)은 모듈 내부 심볼이다. `schema-match.ts` 는 허용 Files 밖이라 export 를 추가하지 않았다.

두 벌을 만들지 않으려고 **타입 · enum 판정을 통째로 `matchResponseSchema` 에 위임했다.**

```ts
const probe: ResponseSchema = {};
if (field.type !== null) probe.type = field.type;
if (field.enumValues !== null) probe.enum = [...field.enumValues];
const violation = matchResponseSchema(probe, value).violations[0];
```

이러면 깊은 비교(`jsonEqual`)와 타입 판정(`matchesType`, `null`·배열·`integer` 처리)이 한 벌로 유지된다. 덤으로 "타입이 틀리면 enum 을 보지 않는다" 는 단락 순서까지 `schema-match.ts` 와 같아진다. `plainObject` 와 `typeName` 은 직접 import 해서 썼다.

남은 것은 `byCodeUnit` 하나다. `(a < b ? -1 : a > b ? 1 : 0)` 한 줄이고 프롬프트도 "`byCodeUnit`(43행) 의 **비교 기준**" 이라고 적었으므로 같은 기준으로 다시 적었다. 갈라질 여지가 있는 로직이 아니다. 다만 세 번째 사본이 생기기 전에(`assertions.ts`, `schema-match.ts`, 여기) `schema-match.ts` 가 `byCodeUnit` 과 `jsonEqual` 을 export 하도록 정리하는 것이 맞다고 본다. 그 파일이 내 소유가 아니라 제안만 한다.

### 3.2 루트 차단 키워드는 14 개다

설계 §4.2 의 코드 블록에 적힌 것이 14 개이고 계획서 §4 Task T2 본문은 "12 개" 라고 세면서 같은 14 개를 나열한다. 개수 표기가 어긋나므로 목록을 정본으로 보고 14 개를 전부 넣었다. 테스트도 14 개 각각을 돌린다.

```
anyOf oneOf allOf not if then else $ref $dynamicRef
patternProperties dependentSchemas dependentRequired propertyNames unevaluatedProperties
```

### 3.3 `TOOL_NOT_DECLARED` 와 `SCHEMA_NOT_ANALYZABLE` 의 `path`

설계는 이 둘의 `path` 를 정하지 않았다. 문장(§7)도 `path` 를 쓰지 않는다. `SpecFinding.path` 는 선택 필드가 아니므로 값이 필요해서 `"operation.tool"` 로 정했다. 명세 안의 실제 위치이고 점 표기 규칙에 맞는다.

### 3.4 한 필드에서 `TYPE_MISMATCH` 와 `ENUM_MISMATCH` 가 동시에 나지 않는다

§3.1 의 위임에서 자연히 따라온다. `{ type: "string", enum: [...] }` 선언에 숫자를 넣으면 `TYPE_MISMATCH` 하나만 난다. 둘 다 내면 같은 원인 하나가 두 줄로 보이고, `schema-math.ts` 의 기존 동작과도 어긋난다.

### 3.5 중복 툴 이름은 첫 번째가 이긴다

`tools` 에 같은 이름이 두 번 오면 먼저 온 선언을 쓴다. 이 경우에 한해 배열 순서가 결과를 바꿀 수 있다. 서버가 같은 이름을 두 번 선언하는 것은 MCP 상 잘못된 응답이고, 두 선언이 다를 때 어느 쪽이 참인지 우리가 알 방법이 없다. 새 `SpecFindingCode` 를 만들지 말라는 제약이 있어 별도 finding 도 내지 않았다.

### 3.6 침묵하기로 한 경계들

전부 "애매하면 침묵" 규칙을 적용한 자리다.

- `enum: []` (빈 배열)은 enum 선언이 없는 것으로 본다. 아무 값도 통과할 수 없다는 뜻이지만 그것을 위반으로 내면 서버 선언 실수를 명세 실수로 뒤집어씌운다
- `required` 안의 비문자열 원소는 걸러낸다
- `operation.input` 이 객체가 아니면 입력 검사를 건너뛴다. 명세 형식은 `validateMcpSuite` 가 잡는다

### 3.7 `totalFindings` 는 스위트 전체 합이다

상한은 케이스마다 적용하고(`MAX_FINDINGS_PER_CASE`), `totalFindings` 는 자르기 전 개수를 케이스 전체에 걸쳐 더한다. 설계 §9.3 이 상한을 케이스 단위로만 정의하고 결과 타입은 스위트 단위라 이렇게 읽었다.

### 3.8 설계 §8 의 예시는 §5.4 규칙상 나올 수 없다

§8 참고 화면에 이 줄이 있다.

```
→ input.units 값 "celsius" 는 선언된 값이 아닙니다. 허용: ["c","f"]. 비슷한 값: 'c'
```

`"celsius"` 와 `"c"` 의 레벤슈타인 거리는 6 이라 거리 2 조건에서 이미 탈락한다. 설령 통과해도 `floor(7/2) = 3` 조건에 걸린다. 즉 한 글자짜리 enum 값은 후보가 될 수 없다. §5.4 규칙을 그대로 구현했으므로 이 경우 `suggestion` 이 붙지 않으며, 그 사실을 테스트로 고정했다("한 글자 enum 은 길이 절반 조건에 걸려 후보가 붙지 않는다"). §8 은 비범위 참고 화면이라 고치지 않았다. 단계 3 배선 전에 §8 예시를 손보는 편이 좋다.

`ENUM_MISMATCH` 의 `suggestion` 자체는 살아 있다. `enum: ["celsius","fahrenheit"]` 에 `"celcius"` 를 넣으면 `'celsius'` 가 붙는다.

### 3.9 §10 에 없는 테스트를 5 건 더 넣었다

`additionalProperties` 가 스키마 객체인 경우, `UNDECLARED_FIELD` 의 후보군 방향, 문자열 enum 의 후보, 한 글자 enum 의 후보 없음, 차단 키워드 14 개 전량 루프다. §10 케이스는 하나도 빼지 않았다.

## 4. 검증

### 4.1 `pnpm test packages/runner`

```
 RUN  v4.1.10 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-t2-input-contract

 Test Files  15 passed (15)
      Tests  314 passed (314)
   Start at  02:20:36
   Duration  334ms (transform 1.20s, setup 0ms, import 1.67s, tests 133ms, environment 1ms)
```

기점 14 파일 262 테스트에서 15 파일 314 테스트로 늘었다. 늘어난 52 건이 `input-contract.test.ts` 다. 기존 테스트 단언 변경은 0 건이다.

### 4.2 `pnpm test` (전체 회귀)

```
 Test Files  38 passed (38)
      Tests  677 passed | 1 skipped (678)
   Duration  1.79s
```

skip 1 건은 기점에도 있던 것이다.

### 4.3 `pnpm typecheck --force`

```
 Tasks:    6 successful, 6 total
Cached:    0 cached, 6 total
  Time:    1.536s
```

`Cached: 0 cached` 이므로 FULL TURBO 로 건너뛴 것이 아니라 실제로 6 개 패키지를 전부 검사했다. `tsc --noEmit` 은 성공 시 출력이 없어 대상 개수를 따로 봤다. `packages/runner` 에서 `npx tsc --noEmit --listFiles` 결과 이 worktree 의 `runner/src` · `runner/tests` 파일이 33 개 잡힌다.

### 4.4 `pnpm lint`

```
Checked 123 files in 34ms. No fixes applied.
```

첫 실행에서 포맷 오류 3 건이 났다. 내 파일 2 개에만 `biome check --write` 를 돌렸고 그 뒤 위 네 명령을 다시 돌린 결과가 이 보고서의 출력이다.

### 4.5 중간에 실패한 것

`문자열 enum 이면 ENUM_MISMATCH 에도 후보가 붙는다` 가 처음에 실패했다. 내가 쓴 테스트가 `enum: ["c","f"]` 에 `"d"` 를 넣고 `'c'` 를 기대했는데, §5.4 의 길이 절반 조건상 한 글자 값은 후보가 될 수 없다. 구현이 아니라 테스트가 틀렸다. 규칙을 바꾸지 않고 테스트를 §5.4 에 맞게 고쳤고, 같은 사실을 고정하는 테스트를 하나 더 넣었다. §3.8 과 같은 사안이다.

## 5. 남은 위험

| 위험 | 내용 | 대응 |
|---|---|---|
| `byCodeUnit` 사본 3 개 | `assertions.ts` · `schema-match.ts` · `input-contract.ts` 에 같은 비교자가 따로 있다 | `schema-match.ts` 소유자가 `byCodeUnit` 과 `jsonEqual` 을 export 하도록 정리. 이 태스크 범위 밖 |
| §8 예시와 §5.4 규칙 불일치 | 단계 3 배선에서 §8 화면을 그대로 옮기면 실제 출력과 다르다 | §3.8 참고. §8 수정 필요 |
| 중복 툴 이름에서의 순서 의존 | 서버가 같은 이름을 두 번 선언하면 첫 선언이 이긴다 | §3.5 참고. 잘못된 서버 응답이라 감수 |
| 미탐 | 조합자를 쓰는 툴은 입력 검사를 통째로 못 받는다 | ADR-0015 가 감수하기로 한 비용. `SCHEMA_NOT_ANALYZABLE` 개수로 소비자가 구분 가능 |
| 리터럴 스키마만 검증 | 실제 서버 선언은 더 지저분하다 | §10.3 의 차단 키워드 14 개 전량 테스트로 오탐 경로를 막았다. 실환경 확인은 단계 3 배선 후 |

## 6. 경계 준수 확인

- `packages/core/src/types.ts` 변경 0 건. `ToolDef` 를 `import type` 으로 읽기만 한다
- `spec-findings.ts` · `index.ts` · `assertion-substance.ts` 변경 0 건
- 다른 패키지 · 루트 빌드 설정 변경 0 건
- 의존 방향은 `runner` → `core` 뿐. 역참조 · 순환 없음
- 의존성 추가 0 건. 설계에 없는 새 `SpecFindingCode` 추가 0 건
- git commit · merge · push 실행 안 함. 백그라운드 실행 없음. 하위 에이전트 스폰 없음
- 테스트는 전부 인메모리 리터럴이다. 서버를 띄우지 않고 픽스처 파일도 만들지 않았다
