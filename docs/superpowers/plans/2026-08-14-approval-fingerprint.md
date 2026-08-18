# 승인 지문 재현 고정 구현 계획 (2026-08-14)

**목표:** 승인 시점의 명세 지문을 명세 파일에 남기고, `ohmymcp test` 가 실행 시점에 대조해
"그 사이 명세가 바뀌지 않았음" 을 보고서에 적는다.

**설계 문서:** `docs/superpowers/specs/2026-08-14-approval-fingerprint-design.md`
설계서가 사양의 유일한 진실이다. 이 계획서와 어긋나면 설계서를 따르고 보고한다.

**로드맵 단계:** 8 (재현 고정)

**기점:** `main` `ae924c3`

---

## 0. 전 태스크 공통 제약

이 절은 모든 태스크의 요구사항에 포함된 것으로 본다.

- **자기 태스크의 Files 목록 밖 파일을 수정하지 않는다.** 특히 다른 오너의 패키지
  (`packages/record`, `packages/mock`), `packages/core/src/types.ts`, 루트 빌드 설정
  (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`)은 공유 계약이다.
  수정이 필요해 보이면 **고치지 말고 보고**한다.
- 의존 방향은 단방향이다: `cli` → `runner`/`generate`/`record`/`mock` → `core`.
  역참조·순환 금지.
- `@modelcontextprotocol/sdk` 는 1.x 고정. `^` 를 붙이지 않는다. 목록 밖 의존성 추가 금지.
  새 런타임 의존성이 필요해 보이면 멈추고 보고한다.
- **git 명령을 실행하지 않는다.** 커밋·푸시·머지는 사람이 한다.
- 유닛테스트는 인메모리와 `packages/*/tests/fixtures/` 만 쓴다. 실제 서버 프로세스를 띄우는
  검증은 태스크 3 의 E2E 하나뿐이다.
- 백그라운드 실행 금지. 하위 에이전트 스폰 금지. 다른 작업자의 변경을 되돌리지 않는다.
- 주석·커밋 메시지·문서는 한국어. 산문에 대시(—) 기호를 쓰지 않는다.
- 결정론성이 이 프로젝트의 핵심 가치다. 타임스탬프·난수·`Object.keys` 순회 순서·로캘에
  의존하는 코드를 넣지 않는다.
- 실패 메시지가 곧 제품이다. 설계서 §7.2 의 문안을 **글자 그대로** 구현한다. 임의로 바꾸지
  않는다. 개선안이 있으면 구현은 설계서대로 하고 보고서에 제안으로 적는다.

### 검증 명령

| 목적 | 명령 |
|---|---|
| 의존성 설치 | `pnpm install` |
| 선행 빌드 | `pnpm build` |
| 전체 판정 | `pnpm test` |
| 타입체크 | `pnpm typecheck` |
| 린트 | `pnpm lint` |

**거짓 신호 주의.** 타입체크·린트가 녹색이면 검사 파일 수가 0이 아닌지 출력에서 확인한다.
결함이 계속 재현되면 `pnpm build` 로 빌드 산출물을 갱신하고 다시 본다. 태스크 2·3 은
다른 패키지의 빌드 산출물을 보므로 이 확인이 특히 중요하다.

---

## 1. 실행 모델

메인 세션이 오케스트레이터다. 스폰·리뷰·통합·커밋을 소유한다. 구현과 테스트는 서브에이전트가
한다.

| 태스크 | 패키지 | 모델 | 사유 |
|---|---|---|---|
| 1 | `runner` | 표준 | 검증 규칙이 설계서 §5 표에 전량으로 적혀 있다 |
| 2 | `runner` · `generate` | **상위** | 패키지 경계·의존 방향 판단. 의존 경계 테스트의 구멍(설계서 §4.6)을 다룬다 |
| 3 | `cli` | **상위** | 실패 메시지 문안 설계와 표시 억제 규칙 판단 |

모델 배분 근거는 `CLAUDE.local.md` 의 표다. 상위 모델 예외는 "계획서에 코드로 못 박기 어려운
판단" 이 있는 태스크에만 준다.

---

## 2. 파일 구조

| 파일 | 태스크 | 책임 |
|---|---|---|
| `packages/runner/src/spec/types.ts` | 1 | `SuiteApproval` 타입, `TestSuiteSpec.approval` |
| `packages/runner/src/spec/validation.ts` | 1 | `approval` 형식 검증 |
| `packages/runner/src/spec/json-schema.ts` | 1 | 공개 JSON Schema 동기화 |
| `packages/runner/src/canonical.ts` | 2 | canonical JSON 과 sha256 (generate 에서 이관) |
| `packages/runner/src/fingerprint.ts` | 2 | `suiteFingerprint`. approval 제외 규칙의 유일한 구현 |
| `packages/generate/src/canonical.ts` | 2 | `runner` 재수출 한 줄로 축소 |
| `packages/cli/src/generate-command.ts` | 3 | 저장 시 `approval` 기록, 왕복 재검증 강화 |
| `packages/cli/src/spec-approval.ts` | 3 | 지문 대조와 표시 문장. `test` 경로가 쓴다 |
| `packages/cli/src/test-command.ts` | 3 | 대조 호출과 출력 배치 |

`spec-approval.ts` 를 새 파일로 빼는 이유는 `test-command.ts` 가 이미 458줄이고, 문장·억제
규칙·`--json` 조립이 한 덩어리로 테스트되어야 하기 때문이다. `process-diagnostics.ts` 가 같은
이유로 분리돼 있는 선례를 따른다.

---

## 3. 의존성과 웨이브

```
태스크 1 (runner 스키마)
    ↓  index.ts 를 같이 만지므로 순차
태스크 2 (canonical 이관 + suiteFingerprint)
    ↓  PR 1 머지 필요. cli 가 runner·generate 의 빌드 산출물을 본다
태스크 3 (cli 저장·표시)
```

병렬 태스크가 없다. 세 태스크가 모두 앞선 태스크의 산출 심볼을 쓴다.

| 웨이브 | 터미널 | worktree | 브랜치 | 태스크 |
|---|---|---|---|---|
| 1 | 터미널 A | `.claude/worktrees/ohmymcp-approval-fp-a` | `feat/runner-approval-fingerprint` | 1, 2 |
| 2 | 터미널 B | `.claude/worktrees/ohmymcp-approval-fp-b` | `feat/cli-approval-fingerprint` | 3 |

터미널 B 는 **PR 1 이 main 에 머지된 뒤에** 연다. 기점이 다르기 때문이다.

### 사람이 할 일 (터미널 A 를 열기 전, 프로젝트 루트에서)

```
git log --oneline -1        # ae924c3 인지 확인
git status --short          # 깨끗한지 확인
```

설계 문서와 이 계획서가 untracked 이면 새 worktree 에 딸려가지 않는다. 터미널을 열기 전에
루트에서 문서 커밋 하나로 보존한다.

```
docs/superpowers/specs/2026-08-14-approval-fingerprint-design.md
docs/superpowers/plans/2026-08-14-approval-fingerprint.md
```

커밋 메시지: `docs(runner): 승인 지문 설계와 구현 계획을 추가한다`

`ROADMAP.local.md` 는 `.git/info/exclude` 대상이라 커밋되지 않는다. 서브에이전트는 이 파일을
보지 못한다. 필요한 내용은 이 계획서와 설계서에 전부 들어 있다.

---

## 4. 태스크 1 — `runner` 명세 스키마에 `approval` 추가

**Files**
- 수정: `packages/runner/src/spec/types.ts`
- 수정: `packages/runner/src/spec/validation.ts`
- 수정: `packages/runner/src/spec/json-schema.ts`
- 수정: `packages/runner/src/index.ts` (타입 export 추가만)
- 테스트: `packages/runner/tests/spec-validation.test.ts` (추가)
- 테스트: `packages/runner/tests/spec-schema.test.ts` (추가)

**Consumes:** 없음
**Produces:** `SuiteApproval` 타입, `TestSuiteSpec.approval?: SuiteApproval`

### 4.1 타입 (전량)

```ts
// packages/runner/src/spec/types.ts
export interface SuiteApproval {
  /**
   * 승인 시점 명세의 sha256 hex 64자, 소문자.
   * 이 블록 자신은 지문 계산에서 제외된다. 계산 규칙은 suiteFingerprint 하나가 소유한다.
   */
  fingerprint: string;
}

export interface TestSuiteSpec {
  schemaVersion: 1;
  id: string;
  name: string;
  approval?: SuiteApproval;
  defaultTimeoutMs?: number;
  cases: TestCaseSpec[];
}
```

`SuiteValidationIssueCode` 에 새 코드를 **추가하지 않는다.** 기존 코드로 전부 표현된다.

### 4.2 검증 (전량)

`validateMcpSuite` 안, `defaultTimeoutMs` 검사 바로 다음, `unknowns` 호출 앞에 넣는다.
`unknowns` 의 허용 목록에 `"approval"` 을 추가한다.

```ts
const HEX64 = /^[0-9a-f]{64}$/;

if ("approval" in input) {
  const approval = input.approval;
  if (!plain(approval)) issue(issues, "INVALID_TYPE", "approval");
  else {
    if (!("fingerprint" in approval))
      issue(issues, "MISSING_REQUIRED_FIELD", "approval.fingerprint");
    else if (typeof approval.fingerprint !== "string")
      issue(issues, "INVALID_TYPE", "approval.fingerprint");
    else if (!HEX64.test(approval.fingerprint))
      issue(issues, "INVALID_VALUE", "approval.fingerprint");
    unknowns(approval, ["fingerprint"], "approval", issues);
  }
}
```

```ts
// 기존 줄을 이렇게 바꾼다 (validation.ts:340)
unknowns(input, ["schemaVersion", "id", "name", "approval", "defaultTimeoutMs", "cases"], "", issues);
```

**판단이 갈리는 지점 세 개를 못 박는다.**

1. `plain(approval)` 을 쓴다. 배열과 `null` 이 `typeof === "object"` 를 통과하기 때문이다.
   `plain` 은 이 파일에 이미 있는 헬퍼다.
2. 정규식에 대문자를 넣지 않는다. 대문자 hex 는 `INVALID_VALUE` 다. `sha256` 이 소문자만
   내므로 대문자가 있다는 것은 사람이 손으로 넣었거나 다른 도구가 만든 값이라는 뜻이다.
   받아주면 지문이 절대 일치하지 않는데 원인이 안 보인다.
3. **값이 맞는지는 검증하지 않는다.** 검증기는 파일 하나만 보고 판정하는 순수 함수다. 여기서
   대조하면 "바뀐 명세" 가 아예 실행되지 않아 설계서 §6 의 비차단 결정과 모순된다.

### 4.3 공개 JSON Schema (전량)

```jsonc
// properties 안에 추가
"approval": { "$ref": "#/$defs/suiteApproval" },
// $defs 안에 추가
"suiteApproval": {
  "type": "object",
  "additionalProperties": false,
  "required": ["fingerprint"],
  "properties": { "fingerprint": { "type": "string", "pattern": "^[0-9a-f]{64}$" } }
}
```

이 스키마는 `additionalProperties: false` 라서 넣지 않으면 공개 스키마가 `approval` 이 있는
파일을 거부한다. 런타임 검증과 갈라지는 것이 이 파일의 알려진 사고 유형이다
(`nonNegativeInteger` 주석 참고).

### 4.4 export

`packages/runner/src/index.ts` 의 타입 export 목록에 `SuiteApproval` 을 추가한다. 목록은
알파벳 순이므로 위치를 지킨다.

### 4.5 테스트 (단언 전량)

`packages/runner/tests/spec-validation.test.ts` 에 `describe("approval 검증")` 를 추가한다.

```
· approval 이 없는 기존 명세가 그대로 valid: true
· approval: { fingerprint: 64자 소문자 hex } 가 valid: true
· approval 이 배열이면 INVALID_TYPE, path 가 "approval"
· approval 이 문자열이면 INVALID_TYPE, path 가 "approval"
· approval 이 null 이면 INVALID_TYPE, path 가 "approval"
· approval: {} 이면 MISSING_REQUIRED_FIELD, path 가 "approval.fingerprint"
· fingerprint 가 숫자면 INVALID_TYPE, path 가 "approval.fingerprint"
· fingerprint 가 63자면 INVALID_VALUE
· fingerprint 가 65자면 INVALID_VALUE
· fingerprint 에 대문자가 섞이면 INVALID_VALUE
· fingerprint 에 hex 아닌 글자(z)가 있으면 INVALID_VALUE
· fingerprint 가 빈 문자열이면 INVALID_VALUE
· approval 에 approvedAt 이 있으면 UNKNOWN_FIELD, path 가 "approval.approvedAt"
· approval 이 잘못돼도 cases 검증 결과가 함께 나온다 (issue 배열에 둘 다 있다)
```

`packages/runner/tests/spec-schema.test.ts` 에 추가한다.

```
· MCP_SUITE_JSON_SCHEMA.properties.approval 이 "#/$defs/suiteApproval" 을 가리킨다
· $defs.suiteApproval 의 required 가 ["fingerprint"] 다
· $defs.suiteApproval 의 additionalProperties 가 false 다
· $defs.suiteApproval.properties.fingerprint.pattern 이 "^[0-9a-f]{64}$" 다
```

유효한 지문 리터럴은 `"a".repeat(64)` 로 만든다. 실제 해시값을 테스트에 박으면 구현이 바뀔 때
같이 고쳐야 하는데, 여기서 검증하는 것은 형식뿐이다.

### 4.6 검증

- 표적: `pnpm test packages/runner`
- 전체: `pnpm test`, `pnpm typecheck`, `pnpm lint`
- 기존 `spec-validation.test.ts` · `spec-schema.test.ts` 의 단언 변경 0건이어야 한다.
  기존 단언을 고쳐야 통과한다면 그것은 하위 호환이 깨진 것이다. 고치지 말고 보고한다.

### 4.7 커밋 (사람이 한다)

`feat(runner): 명세에 승인 지문 필드를 추가한다`

changeset 하나를 `.changeset/` 에 추가한다. `@ohmymcp-hsu/runner` `minor`.

---

## 5. 태스크 2 — canonical JSON 이관과 `suiteFingerprint`

**Files**
- 생성: `packages/runner/src/canonical.ts`
- 생성: `packages/runner/src/fingerprint.ts`
- 생성: `packages/runner/tests/canonical.test.ts`
- 생성: `packages/runner/tests/suite-fingerprint.test.ts`
- 수정: `packages/runner/src/index.ts` (export 추가만)
- 수정: `packages/generate/src/canonical.ts` (전체를 재수출로 교체)
- 수정: `packages/generate/tests/baseline.test.ts` (sha256 단언 4건 제거)
- 수정: `packages/generate/tests/dependency-boundary.test.ts` (목록·정규식)
- 수정: `packages/generate/tests/index.test.ts` (재수출 확인 추가)

**Consumes:** 태스크 1 의 `TestSuiteSpec.approval`
**Produces:**
```ts
// @ohmymcp-hsu/runner
export function canonicalJson(value: unknown): string;
export function sha256(value: unknown): string;
export function deepFreeze<T>(value: T): T;
export function suiteFingerprint(suite: TestSuiteSpec): string;
```

### 5.1 이관

`packages/generate/src/canonical.ts` 의 **내용을 그대로** `packages/runner/src/canonical.ts` 로
옮긴다. 로직·주석·에러 문안을 한 글자도 바꾸지 않는다. 이동이 동작을 바꾸지 않았다는 것이
이 태스크의 안전 조건이다. 개선하고 싶은 곳이 있으면 보고서에 적고 코드는 그대로 둔다.

`packages/generate/src/canonical.ts` 는 전체를 이 한 줄로 교체한다.

```ts
export { canonicalJson, deepFreeze, sha256 } from "@ohmymcp-hsu/runner";
```

`generate` 안의 4개 import 지점(`authoring-request.ts`, `authoring-session.ts`, `baseline.ts`,
`index.ts`)은 건드리지 않는다. 전부 `./canonical.js` 를 보고 있어 그대로 동작한다.

### 5.2 `suiteFingerprint` (전량)

```ts
// packages/runner/src/fingerprint.ts
import { sha256 } from "./canonical.js";
import type { TestSuiteSpec } from "./spec/types.js";

/**
 * 승인 지문. approval 블록을 제외한 명세 전체의 sha256 hex 64자다.
 *
 * approval 을 제외하는 이유는 자기참조 회피다. 지문을 파일에 적으면 다음 계산의 대상 안에
 * 지문 자신이 들어가고, 그러면 승인 시점의 값과 절대 같아질 수 없다. 설계 문서 §4.
 *
 * **이 함수 밖에서 명세 지문을 계산하지 마라.** 저장 경로와 실행 경로가 각자 제외 규칙을
 * 구현하면 한쪽만 고쳐졌을 때 지문이 영원히 불일치하고 원인이 안 보인다.
 *
 * 전제: validateMcpSuite 를 통과한 객체를 넘긴다. canonicalJson 은 undefined · 비유한 수 ·
 * 순환 참조 · sparse array 에서 던지는데, 검증을 통과한 명세에는 그것들이 없다.
 */
export function suiteFingerprint(suite: TestSuiteSpec): string {
  const { approval: _approval, ...rest } = suite;
  return sha256(rest);
}
```

**`delete` 를 쓰지 않는다.** 호출자가 넘긴 객체를 변형하게 되고, `generate` 가 넘기는 draft
suite 는 `deepFreeze` 된 객체라서 그 경로에서 조용히 실패하거나 던진다.

`_approval` 앞의 밑줄은 이 저장소의 미사용 변수 규칙이다. 린트가 다른 규칙을 요구하면 린트를
따르고 보고한다.

### 5.3 의존 경계 테스트 (판단이 필요한 지점)

`packages/generate/tests/dependency-boundary.test.ts` 는 `generate` 가 `runner` 에서 가져오는
심볼을 목록으로 고정한다. ADR-0009 의 승인 범위를 코드로 못 박은 장치다.

**여기에 구멍이 있다.** 현재 정규식은 `import` 문만 잡는다.

```ts
const statement = /^import\s+([^"';]*?)\s+from\s+"@ohmymcp-hsu\/runner"/gm;
```

§5.1 이 쓰는 `export ... from "@ohmymcp-hsu/runner"` 는 안 잡힌다. 즉 목록을 안 고쳐도 테스트가
초록으로 통과하고, ADR-0009 의 경계가 재수출 한 줄로 우회된다. 둘 다 고친다.

```ts
const statement = /^(?:import|export)\s+([^"';]*?)\s+from\s+"@ohmymcp-hsu\/runner"/gm;

const APPROVED_RUNNER_SYMBOLS = [
  "DEFAULT_SENSITIVE_KEYS",
  "MCP_SUITE_JSON_SCHEMA",
  "REDACTED",
  "RunnerRedactionOptions",
  "SuiteValidationIssue",
  "TestCaseSpec",
  "TestSuiteSpec",
  "canonicalJson",
  "deepFreeze",
  "sha256",
  "validateMcpSuite",
];
```

목록 정렬은 기존 파일의 방식(`[...used].sort()` 와 비교)을 따른다. `sort()` 는 UTF-16 코드
단위 정렬이므로 대문자가 소문자보다 앞선다. 위 순서가 그것이다. 순서가 틀리면 테스트가
실패하므로 실행 결과로 확인한다.

기존 주석("이 목록 밖 심볼을 가져오면 이 테스트가 깨진다. 목록을 늘리려면 ADR 을 먼저 고쳐야
한다")은 그대로 두고, 정규식 위에 `export ... from` 도 세는 이유를 한 줄 적는다.

**ADR-0009 를 함께 고친다.** `docs/adr/0009-generate가-runner에-의존하는-예외.md` 의 승인 심볼
목록에 세 개를 추가하고, 추가 사유(canonical JSON 구현을 한 벌로 유지하기 위한 이관)를 적는다.
ADR 본문 구조는 바꾸지 않는다.

### 5.4 테스트 (단언 전량)

`packages/runner/tests/canonical.test.ts` (신규). 앞 4건은
`packages/generate/tests/baseline.test.ts:148~163` 에서 **단언 문구 그대로** 옮긴다.

```
canonicalJson · sha256 (generate 에서 이관)
  · sha256은 같은 값에 항상 같은 해시를 준다
  · sha256은 결과가 /^[0-9a-f]{64}$/ 를 만족한다
  · sha256은 key 순서가 다른 동등한 객체에 같은 해시를 준다
  · sha256은 배열 순서가 다르면 다른 해시를 준다

canonicalJson 방어 계약 (신규)
  · undefined 를 넣으면 TypeError
  · NaN 을 넣으면 TypeError
  · Infinity 를 넣으면 TypeError
  · 순환 참조를 넣으면 TypeError
  · sparse array 를 넣으면 TypeError
  · Object.create(null) 로 만든 객체를 받는다
  · class 인스턴스를 넣으면 TypeError
```

방어 계약을 새로 넣는 이유는 `suiteFingerprint` 가 이 함수의 예외 동작에 기대게 되기
때문이다. 지금은 어느 테스트도 안 덮고 있다.

`packages/generate/tests/baseline.test.ts` 에서는 위 4건을 **삭제**한다. baseline 자체의 단언은
건드리지 않는다.

`packages/runner/tests/suite-fingerprint.test.ts` (신규).

```
suiteFingerprint
  · 반환이 /^[0-9a-f]{64}$/ 를 만족한다
  · approval 이 없는 suite 와 approval 을 붙인 같은 suite 의 지문이 같다
  · approval.fingerprint 값만 다른 두 suite 의 지문이 같다
  · cases 안의 문자열 한 글자를 바꾸면 지문이 달라진다
  · name 을 바꾸면 지문이 달라진다
  · id 를 바꾸면 지문이 달라진다
  · defaultTimeoutMs 를 바꾸면 지문이 달라진다
  · 키 순서만 다른 동등한 두 suite 의 지문이 같다
  · cases 배열 순서를 바꾸면 지문이 달라진다
  · 같은 suite 로 2회 호출한 결과가 동일하다
  · 호출 후 인자 객체가 변형되지 않는다 (approval 키가 그대로 남아 있다)
  · Object.freeze 한 suite 에 호출해도 던지지 않는다
```

둘째·셋째 단언이 이 태스크의 핵심이다. 이것이 깨지면 저장 시점 지문과 실행 시점 지문이
영원히 불일치한다.

`packages/generate/tests/index.test.ts` 에 추가한다.

```
· @ohmymcp-hsu/generate 의 sha256 이 @ohmymcp-hsu/runner 의 sha256 과 같은 함수 참조다
· canonicalJson · deepFreeze 도 같은 함수 참조다
```

`packages/generate/tests/dependency-boundary.test.ts` 에 추가한다.

```
· APPROVED_RUNNER_SYMBOLS 에 canonicalJson · deepFreeze · sha256 이 있다
· 정규식이 export ... from "@ohmymcp-hsu/runner" 구문의 심볼을 수집한다
    (실제 소스를 읽는 기존 테스트와 별개로, 문자열 리터럴 소스를 runnerImports 에 직접
     넣어 export 구문에서 세 심볼이 나오는지 단언한다)
· 목록에 없는 심볼을 export ... from 으로 가져오는 문자열 소스를 넣으면 수집 결과에 그
  심볼이 포함된다 (경계 감시가 실제로 동작한다는 근거)
```

마지막 두 건이 §5.3 의 구멍을 막는 장치다. 정규식만 고치고 검증하지 않으면 다음에 누가
되돌려도 안 잡힌다. `runnerImports` 가 파일 안의 지역 함수라면 테스트에서 부를 수 있도록
export 한다. export 를 늘리는 것이 부담이면 임시 파일 대신 `sourceFiles` 가 읽는 실제
`canonical.ts` 재수출이 목록에 잡히는지로 대신하고, 그 판단을 보고서에 적는다.

### 5.5 검증

- 표적: `pnpm test packages/runner`, `pnpm test packages/generate`
- 전체: `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`
- 구현이 한 벌인지 확인: `grep -rn "createHash(\"sha256\")" packages/*/src` 의 결과가 세 줄이고,
  그중 canonical JSON 지문은 `packages/runner/src/canonical.ts` 한 줄뿐이어야 한다. 나머지 두
  줄은 `packages/generate/src/filename.ts:6` 과 `:12` 다. 파일명 판별자용으로 NFC 정규화본과
  원본을 각각 해싱하며 용도가 다르고 이 작업의 대상이 아니다. 작업 전에도 세 줄이었으므로
  줄 수는 그대로이고 소유 패키지만 옮겨간다.
- `packages/generate` 의 기존 테스트 단언이 위에 명시한 삭제 4건 말고는 변경 0건이어야 한다.

### 5.6 커밋 (사람이 한다)

`refactor(runner): canonical JSON 구현을 generate 에서 이관한다`

changeset 하나. `@ohmymcp-hsu/runner` `minor`, `@ohmymcp-hsu/generate` `patch`.

여기까지가 PR 1 이다. 머지 후 태스크 3 을 시작한다.

---

## 6. 태스크 3 — `cli` 저장과 표시

**선행:** PR 1 이 `main` 에 머지돼 있어야 한다.

**Files**
- 생성: `packages/cli/src/spec-approval.ts`
- 생성: `packages/cli/tests/spec-approval.test.ts`
- 수정: `packages/cli/src/generate-command.ts`
- 수정: `packages/cli/src/test-command.ts`
- 수정: `packages/cli/tests/generate-command.test.ts` (추가)
- 수정: `packages/cli/tests/test-command.test.ts` (추가)
- 수정: `packages/cli/tests/dist-cli-e2e.mjs` (추가)
- 수정: `packages/cli/README.md`

**Consumes:** `suiteFingerprint`, `SuiteApproval` (`@ohmymcp-hsu/runner`)
**Produces:** 없음 (최종 소비자)

### 6.1 `spec-approval.ts` (전량)

문안이 곧 제품이므로 전량으로 못 박는다.

```ts
import type { TestSuiteSpec } from "@ohmymcp-hsu/runner";
import { suiteFingerprint } from "@ohmymcp-hsu/runner";

export type SpecApprovalState = "matched" | "mismatched" | "absent";

export interface SpecApprovalResult {
  readonly state: SpecApprovalState;
  /** 실행 시점에 계산한 지문. 항상 있다. hex 64자. */
  readonly fingerprint: string;
  /** 파일에 적힌 지문. state 가 "absent" 면 없다. */
  readonly approvedFingerprint?: string;
}

/** 표시용 축약 길이. 64자는 줄을 넘겨 읽히지 않고, 12자면 눈으로 다르다는 것을 알 수 있다. */
const DISPLAY_LENGTH = 12;
const short = (value: string): string => `${value.slice(0, DISPLAY_LENGTH)}…`;

export function checkSpecApproval(suite: TestSuiteSpec): SpecApprovalResult {
  const fingerprint = suiteFingerprint(suite);
  const approved = suite.approval?.fingerprint;
  if (approved === undefined) return { state: "absent", fingerprint };
  return {
    state: approved === fingerprint ? "matched" : "mismatched",
    fingerprint,
    approvedFingerprint: approved,
  };
}

/**
 * 표시 여부. 설계 문서 §7.1.
 * 전부 통과일 때는 불일치만 알린다. 매 실행 한 줄은 손으로 명세를 쓰는 사용자에게 영구
 * 소음이고, 그러면 정작 필요할 때 그 줄을 안 읽는다.
 * 전부 통과 + 불일치만 예외인 이유는 승인받지 않은 명세로 초록불이 뜬 상태라서다.
 */
export function shouldShowSpecApproval(result: SpecApprovalResult, allPassed: boolean): boolean {
  return allPassed ? result.state === "mismatched" : true;
}

/** 반환은 개행으로 끝난다. 호출자가 앞에 빈 줄을 붙인다. 설계 문서 §7.2. */
export function renderSpecApproval(result: SpecApprovalResult): string {
  if (result.state === "matched")
    return `명세: 승인 시점과 동일 (${short(result.fingerprint)})\n`;
  if (result.state === "absent")
    return (
      "명세: 승인 지문이 없습니다 (미고정)\n" +
      "  → ohmymcp generate 로 승인한 명세가 아니거나 승인 이전 버전으로 만든 파일입니다.\n"
    );
  return (
    "명세: 승인 시점 이후 변경됨\n" +
    `  → 승인 ${short(result.approvedFingerprint ?? "")}   현재 ${short(result.fingerprint)}\n` +
    "  → 실패 원인에서 명세 변경을 배제할 수 없습니다. 명세 diff 를 먼저 확인하세요.\n"
  );
}
```

지문은 우리가 만든 hex 라 제어 문자가 섞일 수 없다. `test-command.ts` 의 이스케이프 처리를
거치지 않는 유일한 표시 항목이고, 그래서 위 문자열을 그대로 쓴다.

### 6.2 `test-command.ts` 배선

- `dependencies` 에 주입 지점을 만들지 않는다. `checkSpecApproval` 은 순수 함수이고 외부
  자원을 안 쓴다. 주입하면 테스트가 실제 대조 로직을 안 거치게 된다.
- 호출 지점은 `validated.valid` 확인 직후다. 서버 연결 전에 계산한다. 연결이 실패해도 파일에
  대한 사실은 변하지 않는다.
- 텍스트 출력: 보고서 본문을 쓴 **뒤**, 앞에 빈 줄 하나를 붙여 `writeStdout` 으로 쓴다.
  진단 블록(stderr)보다 앞이다.
- `--json` 출력: `{ ...finalReport, spec: {...} }` 로 조립한다. `spec` 키는 억제 규칙과 무관하게
  **항상** 넣는다. `approvedFingerprint` 는 `absent` 일 때 키 자체가 없어야 하므로 조건부로
  넣는다(`undefined` 를 넣으면 `JSON.stringify` 가 키를 지우지만, 의도를 코드에 남긴다).
- `allPassed` 판정은 `finalReport.status === "passed"` 다. 종료 코드 계산과 같은 식을 쓴다.

`spec` 키 이름이 `RunnerReport` 의 기존 키와 겹치지 않는다(`schemaVersion` · `suite` ·
`status` · `stopReason` · `cases` · `summary`). 구현 중 겹치는 것을 발견하면 멈추고 보고한다.

### 6.3 `generate-command.ts` 변경

**지역 `suiteFingerprint` 를 지운다.** `generate` 를 동적 import 해 `sha256` 을 끌어오던
219줄 함수와 그 앞의 주석 블록이 대상이다. 대신 `@ohmymcp-hsu/runner` 에서 정적으로 가져온다.
`runner` 는 이 모듈이 이미 정적으로 의존하는 패키지라 주석이 막으려던 문제(=`test` 경로가
`generate` 로드에 묶이는 것)가 생기지 않는다. 주석이 지시하는 "여기서 다시 구현하지 마라" 는
그대로 지켜진다.

`renderSuite` 는 지문을 두 번째 인자로 받는다. 키 순서를 이렇게 고정한다.

```
schemaVersion  id  name  approval  defaultTimeoutMs  cases
```

`saveSuite` 의 왕복 재검증을 세 조건으로 바꾼다.

```ts
if (
  !validated.valid ||
  suiteFingerprint(validated.value) !== fingerprint ||
  validated.value.approval?.fingerprint !== fingerprint
)
  throw new Error("invalid saved suite");
```

셋째 조건이 필요한 이유. 첫째 조건은 `approval` 을 제외해 계산하므로 **파일에 적힌 지문이
틀려도 통과한다.** `renderSuite` 가 지문을 잘못 써넣는 결함을 못 잡는다.

호출 지점 두 곳(`generate-command.ts:485`, `:633`)은 이미 지문을 인자로 들고 있다. 시그니처
변경에 맞춰 `renderSuite` 로 전달만 한다.

`await` 가 사라지므로 `suiteFingerprint` 를 부르던 자리의 `async`/`await` 를 정리한다.
`saveSuite` 자체는 파일 I/O 때문에 계속 `async` 다.

### 6.4 테스트 (단언 전량)

`packages/cli/tests/spec-approval.test.ts` (신규)

```
checkSpecApproval
  · approval 이 없으면 state 가 "absent" 이고 approvedFingerprint 키가 없다
  · approval.fingerprint 가 계산값과 같으면 "matched"
  · approval.fingerprint 가 다르면 "mismatched" 이고 두 값이 모두 들어 있다
  · fingerprint 가 항상 64자 hex 다

shouldShowSpecApproval
  · allPassed=true, matched  → false
  · allPassed=true, absent   → false
  · allPassed=true, mismatched → true
  · allPassed=false, matched  → true
  · allPassed=false, absent   → true
  · allPassed=false, mismatched → true

renderSpecApproval
  · matched 문장이 "명세: 승인 시점과 동일 (" 로 시작하고 앞 12자와 "…" 를 포함한다
  · absent 문장 2줄이 설계 문서 §7.2 와 정확히 일치한다
  · mismatched 문장 3줄이 설계 문서 §7.2 와 정확히 일치하고 승인·현재 값이 각각 앞 12자다
  · 세 문장 모두 개행으로 끝난다
  · 반환에 ANSI 이스케이프가 없다
```

`packages/cli/tests/test-command.test.ts` 에 추가

```
지문 대조 표시
  · 전부 통과 + 지문 일치 → stdout 에 "명세:" 가 없다
  · 전부 통과 + 지문 없음 → stdout 에 "명세:" 가 없다
  · 전부 통과 + 지문 불일치 → stdout 에 "승인 시점 이후 변경됨" 이 있다
  · 실패 있음 + 지문 일치 → stdout 에 "승인 시점과 동일" 이 있다
  · 실패 있음 + 지문 없음 → stdout 에 "승인 지문이 없습니다 (미고정)" 가 있다
  · 실패 있음 + 지문 불일치 → 승인 값과 현재 값이 각각 앞 12자로 찍힌다
  · 명세 줄이 렌더링된 보고서 뒤에 오고 그 앞에 빈 줄이 하나 있다
  · 명세 줄이 stdout 이다 (stderr 에 없다)

종료 코드
  · 지문 불일치 + 전부 통과면 종료 코드가 0
  · 지문 일치 + 실패 있음이면 종료 코드가 1
  · 같은 케이스 결과에서 지문 상태만 바꿔도 종료 코드가 같다

--json
  · spec.approval 이 "matched" | "mismatched" | "absent" 중 하나다
  · 전부 통과 + 일치여도 spec 키가 있다
  · absent 일 때 spec 에 approvedFingerprint 키가 없다
  · spec.fingerprint 가 64자 hex 다
  · 기존 키(schemaVersion, suite, status, cases, summary)가 그대로다
  · --json 일 때 "명세:" 텍스트 줄이 stdout 에 없다
```

기존 테스트의 `validateSuite` 스텁은 고정 `suite` 객체를 돌려준다. 지문 시나리오는 그
객체에 `approval` 을 붙이거나 붙이지 않는 방식으로 만든다. 실제 해시값이 필요하면
`suiteFingerprint(suite)` 를 테스트 안에서 불러 쓴다. 상수로 박지 않는다. 명세 리터럴이
바뀌면 같이 깨지기 때문이다.

`packages/cli/tests/generate-command.test.ts` 에 추가

```
저장
  · 저장된 JSON 에 approval.fingerprint 가 있고 finalize 가 낸 값과 같다
  · 저장된 JSON 의 키 순서가 schemaVersion, id, name, approval, defaultTimeoutMs, cases 다
  · 저장된 파일을 다시 읽어 validateMcpSuite 에 넣으면 valid: true 다
  · 저장 전 지문과 저장된 파일로 계산한 suiteFingerprint 가 같다
  · renderSuite 가 approval 에 틀린 값을 쓰면 saveSuite 가 link 를 부르지 않는다
  · 기존 "키 순서가 다른 동등한 suite 는 같은 fingerprint 를 낸다" 단언이 변경 없이 통과한다
  · 기존 "저장된 suite 의 fingerprint 가 다르면 커밋하지 않는다" 가 변경 없이 통과한다
```

`packages/cli/tests/dist-cli-e2e.mjs` 에 추가. 기존 generate → test 흐름(151~190줄 부근)에
이어 붙인다.

```
· generate --baseline-only 로 저장한 파일에 approval.fingerprint 가 있다
· 그 파일을 test 로 돌리면 stdout 에 "승인 시점과 동일" 또는 침묵 (규칙표대로)
· 그 파일의 케이스 name 한 글자를 바꾸고 test 를 다시 돌리면
  "승인 시점 이후 변경됨" 이 나오고 종료 코드가 바꾸기 전과 같다
· approval 블록을 통째로 지운 파일도 검증을 통과하고 실행된다
```

마지막 단언이 하위 호환의 실측이다. 깨지면 기존 사용자의 명세가 전부 못 돌게 된다.
`packages/cli/tests/fixtures/` 의 기존 suite 파일들은 `approval` 이 없으므로 이 경로를 이미
밟고 있다. **그 파일들에 `approval` 을 추가하지 않는다.**

### 6.5 문서

`packages/cli/README.md` 에 두 가지를 적는다.

- 저장된 명세에 `approval.fingerprint` 가 들어간다는 사실과 그 값의 의미
- `test` 가 지문을 대조하며 **판정을 바꾸지 않는다**는 것, 표시 규칙표(설계 문서 §7.1)

### 6.6 검증

- 표적: `pnpm test packages/cli`
- E2E: `pnpm build` 후 `pnpm --filter ohmymcp test:e2e`
- 전체: `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`
- `packages/cli/tests/fixtures/` 의 기존 파일 변경 0건

### 6.7 커밋 (사람이 한다)

`feat(cli): 승인 지문 대조 결과를 보고서에 표시한다`

changeset 하나. `ohmymcp` `minor`.

---

## 7. 실행 프롬프트

각 블록은 단독 실행 단위다. 다른 표나 앞선 프롬프트를 참조하지 않는다.

### 터미널 A (태스크 1·2, PR 1)

권장 실행 설정: 오케스트레이터 세션은 상위 모델. 태스크 1 서브에이전트는 **표준 모델**
(`general-purpose`), 태스크 2 서브에이전트는 **상위 모델**(`general-purpose`, 사유: 패키지
경계·의존 방향 판단). 추론 수준은 둘 다 높음.

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

  git worktree add /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-approval-fp-a -b feat/runner-approval-fingerprint

를 프로젝트 루트에서 실행한 뒤 그 경로로 세션을 옮겨라.

진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 BLOCKED 로 보고해라.
  - pwd 가 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-approval-fp-a 인가
  - git log --oneline -1 이 루트에서 본 기점 커밋과 같은가
  - docs/superpowers/plans/2026-08-14-approval-fingerprint.md 가 있는가
  - docs/superpowers/specs/2026-08-14-approval-fingerprint-design.md 가 있는가
  - git status --short 가 비어 있는가
  - pnpm install 이 성공하는가 (새 worktree 는 node_modules 를 상속하지 않는다)
  - pnpm build 가 성공하는가
  - pnpm test 가 현재 상태에서 통과하는가 (기점이 초록인지 먼저 확인한다)

[2단계: 실행]

너는 이 터미널의 오케스트레이터다. 직접 구현하지 말고 태스크마다 서브에이전트를 스폰해
실행시키고, 보고를 받으면 diff 와 테스트 결과를 직접 확인한 뒤 다음으로 넘어가라.

계획서 docs/superpowers/plans/2026-08-14-approval-fingerprint.md 의 §4(태스크 1)와
§5(태스크 2)를 순서대로 실행한다. 설계 문서
docs/superpowers/specs/2026-08-14-approval-fingerprint-design.md 가 사양의 유일한 진실이다.
계획서와 설계서가 어긋나면 설계서를 따르고 보고해라.

태스크 1 (표준 모델로 스폰): runner 명세 스키마에 approval 필드 추가.
  허용 Files 는 계획서 §4 의 Files 목록뿐이다.
  표적 검증 pnpm test packages/runner, 전체 검증 pnpm test / pnpm typecheck / pnpm lint.

태스크 2 (상위 모델로 스폰): canonical JSON 이관과 suiteFingerprint.
  허용 Files 는 계획서 §5 의 Files 목록뿐이다.
  packages/generate/src/canonical.ts 의 내용을 packages/runner/src/canonical.ts 로 한 글자도
  바꾸지 않고 옮기는 것이 안전 조건이다.
  packages/generate/tests/dependency-boundary.test.ts 의 정규식 구멍(계획서 §5.3)을 반드시
  함께 고친다.
  표적 검증 pnpm test packages/runner 와 pnpm test packages/generate,
  전체 검증 pnpm build / pnpm test / pnpm typecheck / pnpm lint.

모든 서브에이전트에 다음을 명시해라.
  - 자기 태스크의 Files 목록 밖 파일 수정 금지. 특히 다른 오너의 패키지(packages/record,
    packages/mock), packages/core/src/types.ts, 루트 빌드 설정은 공유 계약이다. 안 맞으면
    고치지 말고 보고.
  - 의존 방향은 단방향(cli → runner/generate/record/mock → core). 역참조·순환 금지.
  - @modelcontextprotocol/sdk 는 1.x 고정. 목록 밖 의존성 추가 금지.
  - git 명령 실행 금지. 커밋·푸시는 사람이 한다.
  - 백그라운드 실행 금지. 하위 에이전트 스폰 금지.
  - 유닛테스트는 인메모리와 fixtures 만 쓴다.
  - 주석·문서는 한국어. 산문에 대시(—) 기호 금지.
  - 최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작하고 변경 파일,
    실행한 검증 명령과 결과, 남은 위험을 포함한다.

각 태스크가 끝나면 나(사람)에게 변경 파일, 검증 결과, 임의로 판단한 지점을 보고해라.
커밋은 내가 한다. 태스크 2 는 docs/adr/0009-generate가-runner에-의존하는-예외.md 개정을
포함한다. changeset 도 계획서에 적힌 대로 각 태스크에서 만들어라.

작업이 끝나면 worktree 에서 고친 문서를 루트로 되돌려 복사할 필요가 있는지 확인해라
(설계서·계획서를 고쳤다면 그렇다).
```

### 터미널 B (태스크 3, PR 2) — PR 1 머지 후에 연다

권장 실행 설정: 오케스트레이터 세션은 상위 모델. 태스크 3 서브에이전트는 **상위 모델**
(`general-purpose`, 사유: 실패 메시지 문안 설계와 표시 억제 규칙 판단). 추론 수준 높음.

```
[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.

프로젝트 루트에서 git fetch 후 git log --oneline -1 origin/main 을 확인해 PR 1
(feat/runner-approval-fingerprint) 이 실제로 머지됐는지 본다. 머지 커밋이 안 보이면
중단하고 BLOCKED 로 보고해라. 브랜치나 worktree 가 존재한다는 사실을 완료 근거로 쓰지 마라.

확인되면 그 커밋 SHA 를 기록하고 아래를 실행한 뒤 그 경로로 세션을 옮겨라.

  git worktree add /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-approval-fp-b -b feat/cli-approval-fingerprint origin/main

진입 후 아래를 확인하고, 하나라도 어긋나면 중단하고 BLOCKED 로 보고해라.
  - pwd 가 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-approval-fp-b 인가
  - git log --oneline -1 이 위에서 기록한 origin/main 커밋과 같은가
  - docs/superpowers/plans/2026-08-14-approval-fingerprint.md 가 있는가
  - docs/superpowers/specs/2026-08-14-approval-fingerprint-design.md 가 있는가
  - git status --short 가 비어 있는가
  - pnpm install 이 성공하는가
  - pnpm build 가 성공하는가
  - node -e "import('@ohmymcp-hsu/runner').then(m => console.log(typeof m.suiteFingerprint))" 가
    function 을 출력하는가 (PR 1 의 산출물이 실제로 보이는지 확인한다. 빌드 산출물이 낡으면
    낡은 계약으로 판정하게 된다)
  - pnpm test 가 현재 상태에서 통과하는가

[2단계: 실행]

너는 이 터미널의 오케스트레이터다. 직접 구현하지 말고 서브에이전트를 스폰해 실행시키고,
보고를 받으면 diff 와 테스트 결과를 직접 확인해라.

계획서 docs/superpowers/plans/2026-08-14-approval-fingerprint.md 의 §6(태스크 3)을 실행한다.
설계 문서 docs/superpowers/specs/2026-08-14-approval-fingerprint-design.md 가 사양의 유일한
진실이다. 어긋나면 설계서를 따르고 보고해라.

태스크 3 (상위 모델로 스폰): cli 저장 시 approval 기록과 test 의 명세 상태 줄.
  허용 Files 는 계획서 §6 의 Files 목록뿐이다.
  계획서 §6.1 의 문장은 글자 그대로 구현한다. 개선안이 있으면 코드는 그대로 두고 보고서에
  제안으로 적어라. 실패 메시지가 이 프로젝트의 제품이라 문안 변경은 사람이 판단한다.
  표시 억제 규칙(설계서 §7.1)의 여섯 조합을 테스트로 전부 덮는다.
  표적 검증 pnpm test packages/cli.
  E2E 검증 pnpm build 후 pnpm --filter ohmymcp test:e2e.
  전체 검증 pnpm build / pnpm test / pnpm typecheck / pnpm lint.

서브에이전트에 다음을 명시해라.
  - 자기 태스크의 Files 목록 밖 파일 수정 금지. 특히 packages/runner, packages/generate,
    packages/record, packages/mock, packages/core/src/types.ts, 루트 빌드 설정은 이 태스크의
    대상이 아니다. 고쳐야 할 것 같으면 고치지 말고 보고.
  - packages/cli/tests/fixtures/ 의 기존 suite 파일에 approval 을 추가하지 마라. 그 파일들이
    지문 없는 명세의 하위 호환 경로를 덮고 있다.
  - 의존 방향은 단방향(cli → runner/generate/record/mock → core). 역참조·순환 금지.
  - @modelcontextprotocol/sdk 는 1.x 고정. 목록 밖 의존성 추가 금지.
  - git 명령 실행 금지. 커밋·푸시는 사람이 한다.
  - 백그라운드 실행 금지. 하위 에이전트 스폰 금지.
  - E2E 는 examples/weather-server 의 실제 프로세스를 띄운다. 다른 터미널과 동시에 돌리지
    마라. 이 터미널이 직렬 전용이다.
  - 주석·문서는 한국어. 산문에 대시(—) 기호 금지.
  - 최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작하고 변경 파일,
    실행한 검증 명령과 결과, 남은 위험을 포함한다.

끝나면 변경 파일, 검증 결과, 임의로 판단한 지점을 나에게 보고해라. 커밋은 내가 한다.
changeset 은 계획서 §6.7 대로 만들어라.
```

---

## 8. 통합 게이트

각 태스크를 통합한 직후 `docs/task-integration-ledger.tsv` 에 한 줄을 추가하고 별도 문서
커밋으로 보존한다. 형식은 기존 줄과 같다(태스크명 · SHA · 날짜, 탭 구분).

```
T1-approval-fingerprint	<SHA>	2026-08-XX
T2-approval-fingerprint	<SHA>	2026-08-XX
T3-approval-fingerprint	<SHA>	2026-08-XX
```

대장에 없는 결과는 후속 태스크의 선행 근거로 쓰지 않는다. 터미널 B 를 열기 전에
`git cat-file -e <SHA>` 와 `git merge-base --is-ancestor <SHA> HEAD` 로 T2 의 SHA 가 실제
커밋이고 현재 HEAD 의 조상인지 확인한다.

### 머지 직전 재확인

- 빌드 산출물을 재생성한 뒤 다시 확인한다. 태스크 2 가 패키지 사이에서 파일을 옮기므로 낡은
  산출물이 고쳐진 결함을 계속 재현시킨다.
- 타입체크·린트가 녹색이면 검사한 파일 수가 0이 아닌지 출력에서 확인한다.
- 태스크 3 의 E2E 는 실제 서버 프로세스를 띄운다. 다른 터미널이 도는 중이면 돌리지 않는다.

---

## 9. 자체 검토

**설계서 대응 확인.**

| 설계서 절 | 대응 |
|---|---|
| §3 파일 형식 | 태스크 1 (타입·검증), 태스크 3 (§6.3 키 순서) |
| §4.2 지문 규칙 | 태스크 2 §5.2 |
| §4.5 계산기 위치 | 태스크 2 §5.1 |
| §4.6 의존 경계 구멍 | 태스크 2 §5.3 |
| §5 검증 | 태스크 1 §4.2·§4.3 |
| §6 비차단 | 태스크 3 §6.4 "종료 코드" 단언 3건 |
| §7.1 표시 규칙 | 태스크 3 §6.1 `shouldShowSpecApproval`, §6.4 6조합 |
| §7.2 문장 | 태스크 3 §6.1 전량 |
| §7.3 `--json` | 태스크 3 §6.2·§6.4 |
| §8 저장 경로 | 태스크 3 §6.3 |
| §9 결정론성 | 태스크 2 §5.4 (2회 호출 동일), 태스크 3 (`spec` 이 보고서 밖) |
| §10 테스트 | 태스크별 테스트 절에 전량 반영 |
| §11 ADR | 태스크 2 §5.3 (0009 개정) + 아래 |
| §12 거짓 신호 | §0 검증 명령, §8 머지 직전 재확인 |
| §13 PR | §3 웨이브 표, §4.7·§5.6·§6.7 |

**ADR-0017 은 사람이 쓴다.** `docs/adr/0017-승인-지문-계산-범위.md`. 배경 / 선택지 / 결정 /
이유 / 결과 다섯 항목이고 내용은 설계서 §11 에 있다. 서브에이전트에 넘기지 않는 이유는 설계
결정의 기록이라 판단의 소유자가 써야 하기 때문이다. PR 1 에 포함한다.

**타입 일관성.** `suiteFingerprint(suite: TestSuiteSpec): string`, `SuiteApproval.fingerprint`,
`SpecApprovalResult.state` · `.fingerprint` · `.approvedFingerprint`,
`checkSpecApproval` · `shouldShowSpecApproval` · `renderSpecApproval` 의 이름과 시그니처가
태스크 1·2·3 에서 같다.

**남은 위험 둘.**

1. 태스크 2 의 `runnerImports` 가 테스트 파일의 지역 함수다. export 하지 않으면 문자열 소스로
   직접 검증할 수 없다. §5.4 에 대안과 보고 의무를 적어뒀다.
2. `--json` 의 `spec` 키는 CLI 출력 계약의 추가 변경이다. 기존 키를 안 건드리므로 하위 호환이
   깨지지 않지만, `--json` 을 파싱하는 소비자가 `additionalProperties: false` 로 검증 중이면
   깨진다. 그런 소비자는 저장소 안에 없다(`packages/cli/tests/dist-cli-e2e.mjs` 확인). 외부
   소비자는 알파 이전이라 없다고 본다.
