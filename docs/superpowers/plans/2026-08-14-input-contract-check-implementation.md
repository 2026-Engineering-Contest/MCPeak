# 입력 계약 대조와 단언 실질성 검사 구현 계획 (2026-08-14)

- 설계 문서: `docs/superpowers/specs/2026-08-14-input-contract-check-design.md`
- 대상 패키지: `packages/runner` 단독
- 로드맵 단계 2 (웨이브 2 의 PR 2-A)

## 1. 실행 모델

이 세션은 오케스트레이터다. 구현과 테스트는 서브에이전트가 worktree 안에서 실행하고, 이 세션은
스폰·리뷰·통합 게이트만 한다. 모델 배분은 `CLAUDE.local.md` 의 표를 따른다(§6).

커밋·푸시는 사람이 한다. 서브에이전트는 git 명령을 실행하지 않는다. 단 worktree 생성은
프롬프트 1단계에서 에이전트가 직접 한다.

## 2. 목표와 완료 조건

설계 문서 §2 를 그대로 쓴다. 통합 게이트에서 판정하는 항목만 여기 다시 적는다.

- `pnpm test` · `pnpm typecheck` · `pnpm lint` 전부 통과하고, 각 출력의 검사 파일 수가 0 이 아님
- `packages/runner/tests/input-contract.test.ts` 와 `assertion-substance.test.ts` 의 설계 문서
  §10 케이스가 전부 존재하고 통과
- 미지원 JSON Schema 키워드가 있는 툴에서 `REQUIRED_MISSING` · `TYPE_MISMATCH` ·
  `UNDECLARED_FIELD` · `ENUM_MISMATCH` 가 한 건도 나오지 않음 (설계 문서 §10.3)
- 같은 `(suite, tools)` 로 두 번 호출한 결과가 `JSON.stringify` 기준 동일
- `packages/core` · 다른 패키지 · 루트 빌드 설정 변경 0 건
- `docs/adr/0015-입력-스키마-부분집합-경계.md` 존재

## 3. 공유 계약 (전량, T1 이 만들고 이후 수정 금지)

T2 · T3 이 동시에 여기 의존한다. 한 글자만 어긋나면 둘 다 깨진다. T1 이 아래를 **그대로**
만든다. 본문은 설계 문서 §3.2 에 전량으로 있고, 여기서는 파일 배치와 스텁 규칙만 정한다.

### 3.1 T1 이 만드는 파일

```
packages/runner/src/spec-findings.ts        전량 구현
packages/runner/src/input-contract.ts       시그니처 + 스텁만
packages/runner/src/assertion-substance.ts  시그니처 + 스텁만
packages/runner/src/index.ts                export 추가 (세 파일 전부)
```

**스텁을 T1 이 먼저 만드는 이유.** 이 저장소의 runner 테스트는 `../src/index.js` 에서
import 한다(`packages/runner/tests/schema-match.test.ts:2`). T2 와 T3 이 각자 `index.ts` 에
export 를 추가하면 같은 파일을 두 태스크가 쓰게 되어 소유권이 겹친다. 계약을 선행 태스크로
분리하라는 규칙에 따라 `index.ts` 는 T1 만 만지고, T2 · T3 은 자기 모듈 파일만 채운다.

스텁 본문은 이것뿐이다.

```ts
export function checkInputContract(options: InputContractOptions): SpecFindingsResult {
  throw new Error("not implemented");
}
```

타입만 맞으면 되므로 `pnpm typecheck` 가 통과한다. T1 단계에서 이 두 함수를 호출하는 테스트는
쓰지 않는다.

### 3.2 T2 · T3 이 지켜야 할 것

- `spec-findings.ts` 의 타입 · 상수 · `describeSpecFinding` 을 **수정하지 않는다.** 부족하면
  고치지 말고 `BLOCKED` 로 보고한다
- `index.ts` 를 수정하지 않는다
- 서로의 파일을 수정하지 않는다

## 4. 태스크

### Task T1 — 공유 계약과 문장

**목표.** 설계 문서 §3.2 의 타입 전량, §7 의 문장 전량, 그리고 두 모듈의 스텁을 만든다.

**Files (생성).**
```
packages/runner/src/spec-findings.ts
packages/runner/src/input-contract.ts        (스텁)
packages/runner/src/assertion-substance.ts   (스텁)
packages/runner/tests/spec-findings.test.ts
```
**Files (수정).**
```
packages/runner/src/index.ts                 (export 추가만)
```

**입력 계약.** 설계 문서 §3.2 · §7.

**산출 계약.** `SpecFinding` · `SpecFindingCode` · `MAX_FINDINGS_PER_CASE` ·
`SpecFindingsResult` · `describeSpecFinding` · `InputContractOptions` ·
`checkInputContract`(스텁) · `checkAssertionSubstance`(스텁) 이 `@ohmymcp/runner` 에서
import 가능하다.

**테스트.** 설계 문서 §10.5 전량.

**표적 검증.** `pnpm test packages/runner`
**회귀 검증.** `pnpm typecheck`, `pnpm lint`

**보고서.** `docs/reports/task-t1-input-contract.md`

**경계.** 문장을 §7 과 다르게 쓰지 않는다. 더 나은 문안이 떠오르면 적용하지 말고 보고서에
제안으로 적는다. 문장은 여러 소비자가 그대로 쓰는 계약이다.

---

### Task T2 — 입력 계약 대조

**목표.** 설계 문서 §4 · §5.1~§5.6 · §9 를 구현한다.

**Files (생성).**
```
packages/runner/tests/input-contract.test.ts
```
**Files (수정).**
```
packages/runner/src/input-contract.ts        (스텁 본문을 실제 구현으로)
```

**선행.** T1 통합 완료.

**입력 계약.** `checkInputContract(options: InputContractOptions): SpecFindingsResult`.
시그니처는 T1 이 확정했다.

**핵심 사양.** 아래는 틀리면 조용히 사고가 나는 지점이라 설계 문서에서 전량으로 옮겨온다.

- `normalizeInputSchema` 는 **부분 성공이 없다.** 해석 불가면 `null` 을 반환하고 호출부는
  `SCHEMA_NOT_ANALYZABLE` 한 건만 낸다 (설계 §4.2 · §4.3)
- 루트 차단 키워드 14 개: `anyOf` `oneOf` `allOf` `not` `if` `then` `else` `$ref`
  `$dynamicRef` `patternProperties` `dependentSchemas` `dependentRequired`
  `propertyNames` `unevaluatedProperties`
- `additionalProperties` 는 **정확히 `false` 일 때만** `UNDECLARED_FIELD` 를 낸다. 없거나
  `true` 이거나 객체이면 검사하지 않는다. JSON Schema 기본값이 "허용" 이기 때문이다
- `type` 이 배열이면 그 필드의 타입 · enum 검사를 건너뛴다
- `integer` 는 `Number.isInteger` 로 따로 본다. `number` 선언에 정수 값은 위반이 아니다
- 오타 후보 6 단계 규칙 (설계 §5.4). 거리 2 이하 **그리고** `floor(긴 쪽 길이 / 2)` 이하.
  동점이면 UTF-16 코드 단위 오름차순
- 정렬 순서 (설계 §9.2), 스택 안전 (설계 §9.3), 상한 `MAX_FINDINGS_PER_CASE` (설계 §9.4)

**재사용 (새로 구현하지 말 것).** `packages/runner/src/schema-match.ts` 의 `typeName`(39행),
`plainObject`(33행), `jsonEqual`(54행), `byCodeUnit` 기준(43행). 두 벌을 두면 `null` 과 배열
판정, 로캘 비교가 갈라진다.

**테스트.** 설계 문서 §10.1 · §10.3 · §10.4 전량.

**표적 검증.** `pnpm test packages/runner`
**회귀 검증.** `pnpm test`, `pnpm typecheck`, `pnpm lint`

**보고서.** `docs/reports/task-t2-input-contract.md`

**경계.** 오탐이 미탐보다 비싸다. 판정이 애매하면 finding 을 내지 말고 침묵한다. 설계 문서에
없는 새 `SpecFindingCode` 를 만들지 않는다.

---

### Task T3 — 단언 실질성

**목표.** 설계 문서 §5.7 을 구현한다.

**Files (생성).**
```
packages/runner/tests/assertion-substance.test.ts
```
**Files (수정).**
```
packages/runner/src/assertion-substance.ts   (스텁 본문을 실제 구현으로)
```

**선행.** T1 통합 완료. T2 와는 무관하다.

**핵심 사양.**

- 제약으로 세는 키워드 12 개: `type` `const` `enum` `required`(길이 1 이상)
  `properties`(키 1 개 이상) `items` `minItems`(1 이상) `minLength`(1 이상) `maxLength`
  `stringContains` `minimum` `maximum` `additionalProperties === false`
- `minLength: 0` 과 `minItems: 0` 은 **제약으로 세지 않는다.** 그래서 다른 제약이 없으면
  `UNCONSTRAINED_SCHEMA` 만 나고, 다른 제약이 있으면 `VACUOUS_*` 만 난다. 둘이 동시에 나면 오답
- `required: []` 와 `properties: {}` 는 제약이 아니다
- `type` 만 있는 스키마는 실질적이다. finding 을 내지 않는다
- 중첩 `properties.*` 와 `items` 를 순회하고 `path` 에 전체 경로를 적는다
- 모든 finding 의 `severity` 는 `"advisory"`
- `isError` · `toolExists` 단언은 대상이 아니다. 단언 0 개는 `validateMcpSuite` 가 이미
  `EMPTY_ASSERTIONS` 로 잡으므로 여기서 다시 잡지 않는다

**테스트.** 설계 문서 §10.2 전량.

**표적 검증.** `pnpm test packages/runner`
**회귀 검증.** `pnpm test`, `pnpm typecheck`, `pnpm lint`

**보고서.** `docs/reports/task-t3-input-contract.md`

---

### Task T4 — ADR

**목표.** 설계 문서 §11 의 판단을 ADR 로 남긴다.

**Files (생성).**
```
docs/adr/0015-입력-스키마-부분집합-경계.md
```

**선행.** 없다. T1 · T2 · T3 과 병렬로 진행 가능하다.

**형식.** 배경 / 선택지 / 결정 / 이유 / 결과 다섯 항목. 기존 ADR 의 머리말 형식을 따른다
(`docs/adr/0010-응답-스키마-부분집합-경계.md` 참고). 상태는 `제안`, 담당은 `runner`,
작성자는 `@seodduu (runner 파트)`.

**내용.** 설계 문서 §11 의 A · B · C 세 선택지와 C 안 채택 이유를 옮긴다. ADR-0010 과 대상이
다르다는 점(응답 스키마는 우리가 정의하고 사용자가 쓰는 것, 입력 스키마는 남의 서버가 쓰고
우리가 읽기만 하는 것)을 반드시 포함한다.

**검증.** 다섯 항목이 모두 있고 각 항목이 비어 있지 않다. 코드 변경 0 건.

**보고서.** `docs/reports/task-t4-input-contract.md`

## 5. 의존성과 웨이브

```
T1 (공유 계약)
 ├─→ T2 (입력 계약 대조)
 └─→ T3 (단언 실질성)
T4 (ADR)  독립
```

| 웨이브 | 태스크 | 터미널 수 | 이유 |
|---|---|---|---|
| 1 | T1 | 1 | 공유 계약. `index.ts` 를 단독 소유 |
| 2 | T2 · T3 · T4 | 3 | 쓰기 파일이 겹치지 않음 |

T2 와 T3 의 쓰기 파일이 서로 겹치지 않고 `index.ts` 도 안 만지므로 병렬이 안전하다. T4 는
`docs/` 만 만진다.

E2E 나 실환경 검증은 없다. 이 PR 의 모든 테스트가 인메모리 리터럴이라 직렬 웨이브가 필요 없다.

## 6. 모델 배분

`CLAUDE.local.md` 의 표를 따른다.

| 태스크 | 모델 | 근거 |
|---|---|---|
| 오케스트레이터 (이 세션) | 상위 | 리뷰 · 머지 게이트 |
| T1 | **상위** | 예외 항목 "실패 메시지 문안 설계" 에 해당. 문장이 곧 제품이고 여러 소비자가 그대로 쓰는 계약이다 |
| T2 | 표준 | 판정 규칙 · 차단 키워드 목록 · 오타 후보 6 단계 · 정렬 순서가 설계 문서에 전량으로 적혀 있다 |
| T3 | 표준 | 제약 키워드 12 개와 경계 케이스가 설계 문서에 전량으로 적혀 있다 |
| T4 | 표준 | 판단은 설계 문서 §11 에서 이미 내렸다. 옮겨 적는 작업이다 |

추론 수준은 T1 을 높음, T2 · T3 을 보통, T4 를 보통으로 둔다.

## 7. 사람 몫 사전 조건

터미널을 열기 전에 프로젝트 루트에서 두 줄만 확인한다.

```bash
git log --oneline -1        # main 이고 설계 문서 커밋이 들어가 있어야 한다
git status --short          # 비어 있어야 한다
```

설계 문서와 이 계획서가 **`main` 에 커밋돼 있어야 한다.** untracked 면 새 worktree 에
안 따라간다. 아래 두 파일이다.

```
docs/superpowers/specs/2026-08-14-input-contract-check-design.md
docs/superpowers/plans/2026-08-14-input-contract-check-implementation.md
```

프롬프트는 기점을 SHA 가 아니라 `main` 으로 적는다. 커밋 직후 SHA 가 바뀌므로 계획서에 SHA 를
박아두면 반드시 낡는다. 대신 프롬프트 1 단계에서 설계 문서 존재를 직접 확인시킨다.

`ROADMAP.local.md` 는 `.git/info/exclude` 대상이라 worktree 에 안 간다. 이 작업에는 필요
없으므로 복사하지 않는다.

## 8. 실행 프롬프트

각 블록은 단독 실행 단위다. 프로젝트 루트에서 터미널을 열고 그대로 붙여넣는다.

### 8.1 웨이브 1 / Task T1

권장 실행 설정: 모델 **상위 모델(Opus)**, 추론 수준 **높음**, 에이전트 종류 일반 구현 에이전트.

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.
  git worktree add .claude/worktrees/ohmymcp-t1-input-contract -b feat/runner-spec-findings main
를 실행한 뒤 그 경로로 세션을 옮겨라.
진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 status: BLOCKED 로 보고해라:
  - pwd 가 .claude/worktrees/ohmymcp-t1-input-contract 로 끝나는지
  - git log --oneline -1 이 루트의 main HEAD 와 같은지
  - docs/superpowers/specs/2026-08-14-input-contract-check-design.md 가 존재하는지
  - docs/superpowers/plans/2026-08-14-input-contract-check-implementation.md 가 존재하는지
  - git status --short 가 비어 있는지
그다음 부트스트랩을 해라. 새 worktree 는 node_modules 를 상속하지 않는다.
  pnpm install
  pnpm build
그리고 pnpm test packages/runner 가 실제로 실행되는지 확인해라(기존 테스트가
통과해야 한다). 실행 자체가 안 되면 status: BLOCKED 로 보고하고 멈춰라.

[2단계: 실행] Task T1 — 공유 계약과 문장

설계 문서 docs/superpowers/specs/2026-08-14-input-contract-check-design.md 와 구현 계획
docs/superpowers/plans/2026-08-14-input-contract-check-implementation.md 를 먼저 읽어라.

만들 것:
  packages/runner/src/spec-findings.ts        설계 문서 §3.2 의 타입 전량과 §7 의 문장 전량
  packages/runner/src/input-contract.ts       설계 문서 §3.2 의 시그니처 + throw 스텁
  packages/runner/src/assertion-substance.ts  설계 문서 §3.2 의 시그니처 + throw 스텁
  packages/runner/tests/spec-findings.test.ts 설계 문서 §10.5 의 케이스 전량
수정할 것:
  packages/runner/src/index.ts                위 세 파일의 export 추가만

위 5 개 파일 밖은 건드리지 마라. 특히 packages/core/src/types.ts, 다른 패키지,
루트 빌드 설정은 공유 계약이다. 수정이 필요해 보이면 고치지 말고 보고해라.
의존 방향은 단방향이다(cli → runner/generate/record/mock → core). 역참조·순환 금지.
@modelcontextprotocol/sdk 는 1.x 고정이고 목록 밖 의존성 추가 금지다.

describeSpecFinding 의 문장은 설계 문서 §7 과 한 글자도 다르면 안 된다. 더 나은 문안이
떠올라도 적용하지 말고 보고서에 제안으로만 적어라. 여러 소비자가 이 문장을 그대로 쓴다.

검증:
  pnpm test packages/runner
  pnpm typecheck
  pnpm lint
세 명령의 출력에서 검사한 파일 수가 0 이 아닌지 눈으로 확인해라. 0 이면 통과가 아니다.

보고서를 docs/reports/task-t1-input-contract.md 에 써라. 변경 파일 목록, 실행한 검증 명령과
출력 요약, 임의로 판단한 지점, 남은 위험을 담아라.

금지: 백그라운드 실행, git commit, git merge, git push, 하위 에이전트 스폰,
다른 작업자의 변경 되돌리기.
최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작하고 변경 파일,
검증 명령과 결과, 보고서 경로, 남은 위험을 포함해라.
```

### 8.2 웨이브 2 / Task T2

권장 실행 설정: 모델 **표준 모델(Sonnet)**, 추론 수준 **보통**, 에이전트 종류 일반 구현 에이전트.

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.
  git worktree add .claude/worktrees/ohmymcp-t2-input-contract -b feat/runner-input-contract main
를 실행한 뒤 그 경로로 세션을 옮겨라.
진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 status: BLOCKED 로 보고해라:
  - pwd 가 .claude/worktrees/ohmymcp-t2-input-contract 로 끝나는지
  - git log --oneline -1 이 루트의 main HEAD 와 같은지
  - docs/superpowers/specs/2026-08-14-input-contract-check-design.md 가 존재하는지
  - packages/runner/src/spec-findings.ts 가 존재하는지 (T1 산출물이다. 없으면 BLOCKED)
  - packages/runner/src/input-contract.ts 에 checkInputContract 시그니처가 있는지
  - git status --short 가 비어 있는지
그다음 부트스트랩을 해라.
  pnpm install
  pnpm build
그리고 pnpm test packages/runner 가 실제로 실행되는지 확인해라. 실행 자체가 안 되면
status: BLOCKED 로 보고하고 멈춰라.

[2단계: 실행] Task T2 — 입력 계약 대조

설계 문서 docs/superpowers/specs/2026-08-14-input-contract-check-design.md 의 §4, §5.1~§5.6,
§9, §10.1, §10.3, §10.4 를 먼저 읽어라.

수정할 것:
  packages/runner/src/input-contract.ts       스텁 본문을 실제 구현으로
만들 것:
  packages/runner/tests/input-contract.test.ts  설계 문서 §10.1 · §10.3 · §10.4 케이스 전량

이 2 개 파일 밖은 건드리지 마라. 특히 아래는 절대 수정 금지다:
  packages/runner/src/spec-findings.ts   T1 이 만든 공유 계약이다
  packages/runner/src/index.ts           T1 이 소유한다
  packages/runner/src/assertion-substance.ts   T3 이 동시에 작업 중이다
  packages/core/src/types.ts, 다른 패키지, 루트 빌드 설정
부족하거나 틀려 보이면 고치지 말고 status: BLOCKED 로 보고해라.
의존 방향은 단방향이다(cli → runner/generate/record/mock → core). 역참조·순환 금지.
목록 밖 의존성 추가 금지. @modelcontextprotocol/sdk 는 1.x 고정.

새로 구현하지 말고 재사용해라. packages/runner/src/schema-match.ts 의
typeName(39행), plainObject(33행), jsonEqual(54행), 그리고 byCodeUnit(43행) 의 비교 기준.
두 벌을 두면 null·배열 판정과 로캘 비교가 갈라진다.

가장 중요한 제약: 오탐이 미탐보다 비싸다. 이 결과가 승인 화면에서 차단 근거로 쓰인다.
서버 스키마를 해석하지 못하면 위반을 내지 말고 SCHEMA_NOT_ANALYZABLE 하나만 내라.
판정이 애매하면 침묵해라. 설계 문서에 없는 새 SpecFindingCode 를 만들지 마라.

검증:
  pnpm test packages/runner
  pnpm test
  pnpm typecheck
  pnpm lint
출력에서 검사한 파일 수가 0 이 아닌지 눈으로 확인해라.
추가로 결정론성을 직접 확인해라. 같은 (suite, tools) 로 checkInputContract 를 두 번 호출해
JSON.stringify 결과가 같은지 보는 테스트가 있어야 한다.

보고서를 docs/reports/task-t2-input-contract.md 에 써라. 변경 파일 목록, 실행한 검증 명령과
출력 요약, 임의로 판단한 지점, 남은 위험을 담아라.

금지: 백그라운드 실행, git commit, git merge, git push, 하위 에이전트 스폰,
다른 작업자의 변경 되돌리기.
최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작하고 변경 파일,
검증 명령과 결과, 보고서 경로, 남은 위험을 포함해라.
```

### 8.3 웨이브 2 / Task T3

권장 실행 설정: 모델 **표준 모델(Sonnet)**, 추론 수준 **보통**, 에이전트 종류 일반 구현 에이전트.

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.
  git worktree add .claude/worktrees/ohmymcp-t3-input-contract -b feat/runner-assertion-substance main
를 실행한 뒤 그 경로로 세션을 옮겨라.
진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 status: BLOCKED 로 보고해라:
  - pwd 가 .claude/worktrees/ohmymcp-t3-input-contract 로 끝나는지
  - git log --oneline -1 이 루트의 main HEAD 와 같은지
  - docs/superpowers/specs/2026-08-14-input-contract-check-design.md 가 존재하는지
  - packages/runner/src/spec-findings.ts 가 존재하는지 (T1 산출물이다. 없으면 BLOCKED)
  - packages/runner/src/assertion-substance.ts 에 checkAssertionSubstance 시그니처가 있는지
  - git status --short 가 비어 있는지
그다음 부트스트랩을 해라.
  pnpm install
  pnpm build
그리고 pnpm test packages/runner 가 실제로 실행되는지 확인해라. 실행 자체가 안 되면
status: BLOCKED 로 보고하고 멈춰라.

[2단계: 실행] Task T3 — 단언 실질성

설계 문서 docs/superpowers/specs/2026-08-14-input-contract-check-design.md 의 §5.7, §9, §10.2
를 먼저 읽어라.

수정할 것:
  packages/runner/src/assertion-substance.ts       스텁 본문을 실제 구현으로
만들 것:
  packages/runner/tests/assertion-substance.test.ts  설계 문서 §10.2 케이스 전량

이 2 개 파일 밖은 건드리지 마라. 특히 아래는 절대 수정 금지다:
  packages/runner/src/spec-findings.ts   T1 이 만든 공유 계약이다
  packages/runner/src/index.ts           T1 이 소유한다
  packages/runner/src/input-contract.ts  T2 가 동시에 작업 중이다
  packages/core/src/types.ts, 다른 패키지, 루트 빌드 설정
부족하거나 틀려 보이면 고치지 말고 status: BLOCKED 로 보고해라.
의존 방향은 단방향이다(cli → runner/generate/record/mock → core). 역참조·순환 금지.
목록 밖 의존성 추가 금지.

가장 헷갈리는 경계를 미리 못 박는다. 이대로 구현해라.
  - minLength: 0 과 minItems: 0 은 "제약" 으로 세지 않는다
  - 그래서 { minLength: 0 } 단독은 UNCONSTRAINED_SCHEMA 만 나고 VACUOUS_MIN_LENGTH 는 안 난다
  - { type: "string", minLength: 0 } 은 VACUOUS_MIN_LENGTH 만 난다
  - UNCONSTRAINED_SCHEMA 와 VACUOUS_* 가 같은 path 에서 동시에 나면 오답이다
  - required: [] 와 properties: {} 는 제약이 아니다
  - type 만 있는 스키마는 실질적이다. finding 을 내지 마라
  - 모든 finding 의 severity 는 "advisory" 다
  - isError · toolExists 단언은 대상이 아니다. 단언 0 개는 validateMcpSuite 가 이미 잡는다

검증:
  pnpm test packages/runner
  pnpm test
  pnpm typecheck
  pnpm lint
출력에서 검사한 파일 수가 0 이 아닌지 눈으로 확인해라.

보고서를 docs/reports/task-t3-input-contract.md 에 써라. 변경 파일 목록, 실행한 검증 명령과
출력 요약, 임의로 판단한 지점, 남은 위험을 담아라.

금지: 백그라운드 실행, git commit, git merge, git push, 하위 에이전트 스폰,
다른 작업자의 변경 되돌리기.
최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작하고 변경 파일,
검증 명령과 결과, 보고서 경로, 남은 위험을 포함해라.
```

### 8.4 웨이브 2 / Task T4

권장 실행 설정: 모델 **표준 모델(Sonnet)**, 추론 수준 **보통**, 에이전트 종류 일반 문서 에이전트.

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.
  git worktree add .claude/worktrees/ohmymcp-t4-input-contract -b docs/adr-0015-input-schema-subset main
를 실행한 뒤 그 경로로 세션을 옮겨라.
진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 status: BLOCKED 로 보고해라:
  - pwd 가 .claude/worktrees/ohmymcp-t4-input-contract 로 끝나는지
  - git log --oneline -1 이 루트의 main HEAD 와 같은지
  - docs/superpowers/specs/2026-08-14-input-contract-check-design.md 가 존재하는지
  - docs/adr/0010-응답-스키마-부분집합-경계.md 가 존재하는지
  - git status --short 가 비어 있는지
이 태스크는 문서만 만들므로 pnpm install 은 하지 않아도 된다.

[2단계: 실행] Task T4 — ADR-0015

설계 문서 docs/superpowers/specs/2026-08-14-input-contract-check-design.md 의 §4 와 §11 을
읽고, 형식 참고로 docs/adr/0010-응답-스키마-부분집합-경계.md 를 읽어라.

만들 것:
  docs/adr/0015-입력-스키마-부분집합-경계.md

이 1 개 파일 밖은 건드리지 마라. 코드 변경은 0 건이어야 한다.

구성은 배경 / 선택지 / 결정 / 이유 / 결과 다섯 항목이다. 머리말은 ADR-0010 의 형식을 따르고
상태는 "제안", 담당은 "runner", 작성자는 "@seodduu (runner 파트)" 로 적어라.

반드시 담을 것:
  - 서버의 inputSchema 는 우리가 통제하지 않는 임의의 JSON Schema 라는 점
  - 설계 문서 §4.1 의 anyOf 오탐 예시
  - 선택지 A(미지원 키워드 무시) · B(완전한 검증기 도입) · C(부분집합만 검사하고 침묵)
  - C 안 채택과 그 이유: 승인 화면에서 차단 근거로 쓰이므로 오탐 1 건이 미탐 1 건보다 비싸다
  - B 안을 버린 이유: 새 런타임 의존성이 필요하고(프로젝트 지침상 임의 추가 금지), 우리가
    통제하지 못하는 코드가 승인 차단 권한을 갖게 된다
  - ADR-0010 과 대상이 다르다는 점: 응답 스키마는 우리가 정의하고 사용자가 쓰는 것이고,
    입력 스키마는 남의 서버가 쓰고 우리가 읽기만 하는 것이다. 전자는 지원 범위를 정하면
    끝이지만 후자는 못 읽는 경우의 행동을 정해야 한다
  - 결과 항목에 SCHEMA_NOT_ANALYZABLE 을 조용히 삼키지 않고 finding 으로 내보내는 이유
    (finding 0 건이 "깨끗함" 인지 "검사를 못 했음" 인지 소비자가 구분해야 한다)

산문에 대시(—) 를 쓰지 마라. 문장을 나누거나 쉼표·괄호로 풀어 써라.

보고서를 docs/reports/task-t4-input-contract.md 에 써라.

금지: 백그라운드 실행, git commit, git merge, git push, 하위 에이전트 스폰,
다른 작업자의 변경 되돌리기.
최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작해라.
```

## 9. 통합 게이트

각 태스크 보고를 받으면 이 세션이 아래를 **직접** 확인한다. 자식의 완료 선언은 단서일 뿐이다.

1. 보고서를 읽고, 허용 Files 밖 변경이 있는지 `git -C <worktree> status --short` 로 본다
2. `git -C <worktree> diff main --stat` 으로 변경 범위를 확인한다.
   `packages/core` · 다른 패키지 · 루트 설정이 나오면 즉시 반려
3. worktree 에서 `pnpm test packages/runner` · `pnpm typecheck` · `pnpm lint` 를
   직접 돌리고 검사 파일 수가 0 이 아닌지 본다
4. 설계 문서 §10 의 테스트 케이스가 실제로 존재하는지 이름으로 대조한다. 개수만 보지 않는다
5. T2 통합 전 §10.3 의 오탐 방지 케이스가 전부 있는지 따로 확인한다. 완료 조건이다
6. 통과하면 사람에게 머지를 요청하고, 머지 SHA 를 `docs/task-integration-ledger.tsv` 에
   아래 형식으로 기록한다

```
T1-input-contract	<sha>	2026-08-14
T2-input-contract	<sha>	2026-08-14
T3-input-contract	<sha>	2026-08-14
T4-input-contract	<sha>	2026-08-14
```

7. 웨이브 2 를 시작하기 전에 T1 의 SHA 가 대장에 있고 실제 커밋으로 존재하며 현재 HEAD 의
   조상인지 `git cat-file -e` 와 `git merge-base --is-ancestor` 로 확인한다. **브랜치나
   worktree 가 존재한다는 사실을 완료 근거로 쓰지 않는다**

전체 통합 후 최종 게이트로 `pnpm test` · `pnpm typecheck` · `pnpm lint` 를 루트에서 한 번 더
돌린다.

## 10. 거짓 신호 점검

통합 게이트에서 아래를 의심한다.

| 거짓 신호 | 이 작업에서의 모습 | 진실 기준 |
|---|---|---|
| 테스트 명령이 즉시 exit 0 | `pnpm --filter @ohmymcp/runner test` 는 **존재하지 않는 스크립트**다. 패키지 `package.json` 에 `test` 가 없어 아무것도 안 하고 성공한다 | 출력에 `Test Files ... passed` 줄이 있는지 확인. 표적 검증은 `pnpm test packages/runner` |
| 타입체크 · 린트 녹색 | 새 파일이 `index.ts` 에서 export 안 돼 검사 대상에서 빠짐 | 세 명령의 검사 파일 수를 출력에서 확인 |
| 테스트 녹색 | T1 의 스텁이 그대로 남아 `throw` 하는데 아무도 호출 안 함 | T2 · T3 통합 후 `not implemented` 문자열이 `src/` 에 0 건인지 grep |
| finding 0 건이라 깨끗해 보임 | 스키마 해석 불가로 전부 건너뜀 | `SCHEMA_NOT_ANALYZABLE` 개수를 따로 확인 (§10.3 테스트) |
| 새 worktree 에서 테스트 타임아웃 | `pnpm install` 누락 | 출력에서 파일 없음 오류와 spawn 경로 확인 |
| 결함이 계속 재현 | 빌드 산출물이 낡음 | `pnpm build` 후 재확인 |

## 11. 롤백 경계

T1 이 반려되면 웨이브 2 를 시작하지 않는다. 공유 계약이 바뀌면 T2 · T3 을 처음부터 다시
해야 한다.

T2 나 T3 이 반려되면 다른 하나는 그대로 진행한다. 둘은 서로 의존하지 않는다.

T4 는 코드에 영향을 주지 않으므로 언제 반려돼도 다른 태스크를 막지 않는다.
