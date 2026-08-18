# 승인 지문 재현 고정 설계 (2026-08-14)

- 담당 패키지: `runner` · `generate` · `cli` (순차 3 PR)
- 작성자: @seodduu (파트①)
- 로드맵 단계 8
- 참조: ADR-0009(generate가 runner에 의존하는 예외), ADR-0013(렌더러 배치), ADR-0014(진단 출력 채널)
- 신규 ADR 대상: 지문 계산 범위와 자기참조 회피 규칙 (§11)

## 1. 배경

사용자는 `ohmymcp generate` 로 명세를 만들고 승인 화면에서 케이스를 하나씩 확인한 뒤 저장한다.
그 시점의 명세는 오라클 자격을 가진 것으로 취급된다.

몇 주 뒤 `ohmymcp test` 가 실패한다.

```
✗ weather-ok
  → isError false 를 기대했지만 true 를 받았습니다
```

사용자가 세울 수 있는 가설이 둘이다.

1. 서버가 그 사이 망가졌다
2. 명세가 그 사이 바뀌었다

지금 화면은 둘을 구분해주지 않는다. 2번을 배제하려면 파일을 열어 기억을 더듬거나 git 이력을
뒤져야 하고, 명세가 생성물이라 버전 관리 밖에 있으면 그것도 안 된다.

**실행 중에 명세가 바뀌는 것이 아니다.** 실행은 언제나 파일에 적힌 그대로 돈다. 문제는 승인
시점과 실행 시점 **사이**에 파일이 편집될 수 있고, 실행 시점의 화면이 그 사실을 모른다는 것이다.
팀원의 수정, 몇 주 전 자신의 수정, 머지로 딸려온 남의 수정, 스크립트의 자동 수정이 모두 여기
해당한다.

이미 있는 것과 없는 것은 이렇다.

| 있는 것 | 위치 |
|---|---|
| `canonicalJson` · `sha256` | `packages/generate/src/canonical.ts` |
| `AuthoringDraft.suiteFingerprint` | `packages/generate/src/authoring-session.ts:58` |
| 승인 시점의 `approval.fingerprint` 대조 | `packages/generate/src/authoring-session.ts` |
| 저장 직후 왕복 재검증 | `packages/cli/src/generate-command.ts:259` |

없는 것은 하나다. **지문이 파일에 안 들어간다.** `saveSuite` 가 저장 직후 "방금 쓴 바이트가
온전한가" 를 확인하는 데만 쓰고 버린다. 그래서 실행 시점에는 대조할 기준값이 없다.

## 2. 목표 / 비범위 / 완료 조건

### 목표

1. 승인 시점의 명세 지문을 명세 파일 안에 남긴다.
2. `ohmymcp test` 가 실행 시점에 지문을 다시 계산해 대조하고 결과를 보고서에 적는다.
3. 지문 계산이 자기 자신을 포함하지 않는다(§4).
4. 지문은 파일의 **내용**에만 의존한다. 들여쓰기·키 순서·줄바꿈이 달라도 같은 값이 나온다.
5. 지문 대조가 통과·실패 판정을 바꾸지 않는다. 종료 코드는 케이스 결과로만 정해진다.
6. 지문 계산 구현이 저장소에 한 벌만 존재한다.

### 비범위

- **어디가 바뀌었는지 보여주기.** 지문은 같다/다르다만 답한다. diff 는 사용자가 git 이나
  에디터로 본다. 승인 시점 명세의 사본을 우리가 들고 있지 않으므로 구조적으로 불가능하다.
- **서버 선언의 고정.** 이 지문은 명세만 덮는다. 서버가 선언한 `inputSchema` 가 바뀐 것은
  단계 2 의 `checkInputContract` 가 잡는 축이고 지문의 범위가 아니다. §4.4 에 근거가 있다.
- **승인 없는 편집 차단.** 불일치를 실패로 만들지 않는다. §6 에 근거가 있다.
- **지문 알고리즘 교체 경로.** `schemaVersion` 이 sha256 을 고정한다. 알고리즘이 바뀌면
  `schemaVersion` 이 올라가고 그때 마이그레이션을 설계한다.
- **`record` 카세트.** 무관하다.

### 완료 조건

- `pnpm test`, `pnpm typecheck`, `pnpm lint` 전부 통과. 검사 파일 수가 출력에서 0이 아님
- `approval` 이 없는 기존 명세 파일이 그대로 검증을 통과하고 실행된다(§10.1)
- `approval` 을 붙인 명세와 안 붙인 같은 명세의 지문이 동일하다(§10.2)
- `approval.fingerprint` 값만 바꾼 두 파일의 지문이 동일하다(§10.2)
- `ohmymcp generate` 로 저장한 파일을 `ohmymcp test` 로 돌리면 "승인 시점과 동일" 이 나온다(§10.5)
- 저장된 파일의 `cases` 한 글자를 바꾸면 "승인 시점 이후 변경됨" 이 나오고 **종료 코드는
  안 바뀐다**(§10.4)
- `canonicalJson` · `sha256` 의 구현이 저장소에 한 벌이다(`grep -c "createHash(\"sha256\")"` 로 확인)
- `core` · `record` · `mock` 변경 0건, 루트 빌드 설정 변경 0건

## 3. 파일 형식

```json
{
  "schemaVersion": 1,
  "id": "weather",
  "name": "날씨 서버 회귀",
  "approval": {
    "fingerprint": "9f2c1a3b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8"
  },
  "defaultTimeoutMs": 5000,
  "cases": [ ... ]
}
```

`approval` 은 선택 필드다. 없으면 미고정 명세로 취급한다(§6).

### 3.1 왜 최상위 문자열이 아니라 객체인가

지금 담을 값은 지문 하나뿐이다. 그런데 이 블록에 나중에 붙을 후보가 이미 보인다.

- 승인 시점에 서버가 선언한 툴 목록의 지문(단계 3 dry run 게이트의 산물)
- 케이스별 승인 상태("통과" / "서버 결함으로 표시")

이것들이 최상위로 흩어지면 §4 의 제외 규칙이 항목 수만큼 늘어난다. 블록 하나로 묶으면
**"`approval` 전체를 제외한다"** 한 줄로 영원히 끝난다. 지금 필드가 하나뿐인 대가로 그 규칙을
고정한다.

### 3.2 값의 형식

소문자 hex 64자. 알고리즘 접두사(`sha256:`)를 붙이지 않는다. 파일의 `schemaVersion: 1` 이
알고리즘을 고정하고 있어 접두사는 같은 정보를 두 곳에 두는 것이다. 두 곳에 있으면 어긋날 수
있다. 화면 표시에만 접두사 없이 앞 12자를 쓴다(§7).

### 3.3 저장 시 키 순서

`renderSuite`(`packages/cli/src/generate-command.ts:199`)가 쓰는 순서를 이렇게 고정한다.

```
schemaVersion  id  name  approval  defaultTimeoutMs  cases
```

`approval` 을 `cases` 앞에 두는 이유는 사람이 파일을 열었을 때 첫 화면에서 보이게 하기
위해서다. 지문 계산은 `canonicalJson` 이 키를 정렬하므로 이 순서에 영향받지 않는다. 즉 이것은
가독성 결정이지 계약이 아니다.

## 4. 지문 계산 (이 설계의 핵심)

### 4.1 자기참조 문제

지문을 파일에 적으면, 다음 실행 때 계산 대상 안에 지문 자신이 들어 있다. 그 상태로 계산하면
승인 시점의 값과 절대 같을 수 없다. 자기를 포함한 채로 자기를 요약할 수 없기 때문이다.

### 4.2 규칙

```
지문 = sha256(canonicalJson(suite에서 approval 키를 제거한 객체))
```

`approval` 키 하나를 통째로 뺀다. 그 안의 어떤 필드도 계산에 들어가지 않는다. `approval` 이
없는 명세와 있는 명세는 나머지가 같으면 같은 지문을 낸다. 이것이 §2 완료 조건의 둘째·셋째
줄이고, 승인 이전에 계산한 값과 저장 이후에 계산한 값이 같아야 하므로 반드시 성립해야 한다.

```ts
// packages/runner/src/fingerprint.ts (신규)
import type { TestSuiteSpec } from "./spec/types.js";

/**
 * 승인 지문. approval 블록을 제외한 명세 전체의 sha256 hex 64자다.
 * approval 을 제외하는 이유는 자기참조 회피다. 이 함수 밖에서 지문을 계산하지 마라.
 */
export function suiteFingerprint(suite: TestSuiteSpec): string {
  const { approval: _approval, ...rest } = suite;
  return sha256(rest);
}
```

구조 분해로 빼는 이유. `delete` 를 쓰면 호출자가 넘긴 객체를 변형한다. `generate` 가 넘기는
draft suite 는 `deepFreeze` 된 객체라서 그 경로에서 조용히 실패하거나 던진다.

### 4.3 왜 파일 바이트가 아니라 파싱된 객체인가

파일 바이트를 그대로 해싱하면 구현이 더 짧다. 쓰지 않는다. 들여쓰기 변경, 줄 끝 문자 변경
(CRLF↔LF), 에디터의 자동 포맷, 키 순서 정렬이 전부 "명세가 바뀌었다" 로 잡힌다. 그러면 경고가
일상이 되고 사용자는 그 줄을 읽지 않게 된다. 지문이 답해야 하는 질문은 "**테스트의 의미가**
바뀌었나" 이지 "바이트가 바뀌었나" 가 아니다.

`canonicalJson` 이 이 요구를 이미 만족한다. 키를 UTF-16 코드 단위로 정렬하고 배열 순서는
보존한다. 배열 순서를 보존하는 것은 옳다. 케이스 순서가 바뀌면 상태를 바꾸는 서버에서 결과가
달라지므로 그것은 의미 변경이다.

### 4.4 왜 서버 선언은 안 넣나

`{ suite, tools }` 를 함께 해싱하면 "서버 선언도 그때와 같음" 까지 보증할 수 있다. 하지 않는다.

- 서버 선언을 얻으려면 서버를 켜야 한다. 지문 확인이 서버 기동에 묶이면 파일만으로는 아무것도
  판정하지 못한다.
- 서버 선언이 바뀌는 것은 **정상적인 개발**이다. 사용자는 자기 MCP 서버를 개발 중이다. 매번
  불일치가 뜨면 신호가 죽는다.
- 선언 변경이 명세와 어긋나는지는 단계 2 의 `checkInputContract` 가 이미 답한다. 그쪽은 어느
  필드가 어떻게 어긋나는지까지 말해준다. 지문으로 같은 것을 흐릿하게 다시 말할 이유가 없다.

### 4.5 구현 위치: `canonical.ts` 를 `runner` 로 옮긴다

`test` 실행 경로는 `cli` 와 `runner` 만 쓴다. `sha256` 은 `generate` 에 있고, 의존 방향이
`generate → runner` 이므로 `runner` 가 `generate` 를 부를 수 없다. 선택지가 셋이었다.

- A안: `cli` 의 `test` 경로에서 `generate` 를 동적 import 한다. 패키지 이동 0건이지만
  `ohmymcp test` 가 `generate` 로드에 묶인다. `generate-command.ts:210` 의 주석이 `generate` 를
  `test` 경로에서 떼어놓기 위해 동적 import 를 쓴다고 명시하고 있어 그 의도와 정면으로 어긋난다.
- B안: `runner` 에 canonical JSON 을 새로 쓴다. 같은 주석이 "여기서 다시 구현하지 마라" 로
  금지한 것이다. 두 벌이 갈라지는 순간 승인 검증이 조용히 깨진다.
- C안: `canonical.ts` 를 `runner` 로 옮기고 `generate` 는 re-export 한다.

**C안을 택한다.** 구현이 한 벌로 유지되고, `generate` 의 공개 API(`export { canonicalJson,
sha256 }`, `packages/generate/src/index.ts:59`)가 그대로 살아 기존 소비자가 안 깨진다. 지문
규칙이 명세 타입 옆에 놓이므로 스키마가 늘 때 함께 검토된다. `runner` 와 `generate` 는 둘 다
파트① 소유라 소유권 규칙에 걸리지 않는다.

`generate` 내부의 `sha256` 용처는 suite 지문만이 아니다. AI 요청 payload 지문
(`authoring-request.ts:285`), 케이스 항목 비교(`authoring-session.ts:201`)가 같은 함수를 쓴다.
그래서 `suiteFingerprint` 만 옮기는 것으로는 부족하고 `canonical.ts` 전체가 옮겨간다.
`deepFreeze` 도 같은 파일에 있으므로 함께 간다.

이동 후 `packages/generate/src/canonical.ts` 는 이 한 줄만 남긴다.

```ts
export { canonicalJson, deepFreeze, sha256 } from "@ohmymcp-hsu/runner";
```

파일을 지우고 import 를 전부 고치는 대신 재수출 파일을 남기는 이유는 `generate` 안의 4개
import 지점(`authoring-request.ts` · `authoring-session.ts` · `baseline.ts` · `index.ts`)을
건드리지 않기 위해서다. diff 가 작을수록 이동이 안전하다.

### 4.6 의존 경계 테스트를 함께 고쳐야 한다

`packages/generate/tests/dependency-boundary.test.ts` 가 `generate` 가 `runner` 에서 가져오는
심볼을 목록으로 고정하고 있다(ADR-0009 의 승인 범위를 코드로 못 박은 것). `canonicalJson` ·
`deepFreeze` · `sha256` 이 그 목록에 없으므로 세 개를 추가하고 **ADR-0009 를 함께 개정한다.**

여기에 조용한 구멍이 하나 있다. 그 테스트의 정규식은 `^import\s+...from "@ohmymcp-hsu/runner"` 로
**`import` 문만** 잡는다. 우리가 쓰려는 `export ... from "@ohmymcp-hsu/runner"` 는 안 잡힌다. 즉
목록을 안 고쳐도 테스트가 초록으로 통과한다. 그러면 ADR-0009 가 지키려던 경계가 재수출 한 줄로
우회되고, 그 사실을 아무도 모른다.

그래서 PR B 에서 정규식을 `^(?:import|export)\s+...` 로 넓히고 목록에 세 심볼을 넣는다. 경계를
넓히는 변경과 그 경계를 감시하는 장치를 같은 PR 에서 고친다. 순서가 갈리면 그 사이에 목록 밖
심볼이 들어와도 안 잡힌다.

## 5. 검증 (`runner`)

`validateMcpSuite` 가 최상위 미지의 키를 `UNKNOWN_FIELD` 로 거부한다
(`packages/runner/src/spec/validation.ts:340`). 허용 목록에 `approval` 을 넣는다.

```ts
// spec/types.ts
export interface SuiteApproval {
  /** 승인 시점 명세의 sha256 hex 64자. 소문자. approval 자신은 계산에서 제외된다. */
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

검증 규칙 전량. 새 issue code 를 만들지 않는다. 기존 코드로 전부 표현된다.

| 입력 | 결과 |
|---|---|
| `approval` 없음 | 통과. 기존 명세가 그대로 산다 |
| `approval` 이 객체가 아님(배열·문자열·null 포함) | `INVALID_TYPE` `approval` |
| `approval.fingerprint` 없음 | `MISSING_REQUIRED_FIELD` `approval.fingerprint` |
| `fingerprint` 가 문자열이 아님 | `INVALID_TYPE` `approval.fingerprint` |
| `fingerprint` 가 `/^[0-9a-f]{64}$/` 불만족 | `INVALID_VALUE` `approval.fingerprint` |
| `approval` 안의 다른 키 | `UNKNOWN_FIELD` `approval.<키>` |

형식만 본다. **값이 맞는지는 검증하지 않는다.** 검증기는 명세 파일 하나만 보고 판정하는
순수 함수이고, 지문이 맞는지는 실행 시점의 관심사다. 여기서 대조하면 "유효하지 않은 명세" 와
"바뀐 명세" 가 한 코드로 뭉개지고, 바뀐 명세가 아예 실행되지 않게 되어 §6 의 비차단 결정과
모순된다.

`MCP_SUITE_JSON_SCHEMA`(`spec/json-schema.ts`)에도 같은 규칙을 넣는다. 이 스키마는
`additionalProperties: false` 이므로 넣지 않으면 공개 스키마와 런타임 검증이 갈라진다. 그
비대칭은 `nonNegativeInteger` 주석이 지적한 것과 같은 유형의 결함이다.

```jsonc
// properties 에 추가
"approval": { "$ref": "#/$defs/suiteApproval" }
// $defs 에 추가
"suiteApproval": {
  "type": "object",
  "additionalProperties": false,
  "required": ["fingerprint"],
  "properties": { "fingerprint": { "type": "string", "pattern": "^[0-9a-f]{64}$" } }
}
```

## 6. 불일치의 지위: 보고만 하고 차단하지 않는다

지문이 달라도 종료 코드를 바꾸지 않는다. 판정은 케이스 결과로만 정해진다.

명세를 고치는 것은 정상 작업이기 때문이다. 서버에 필드가 하나 늘면 명세도 따라 고친다. 그때마다
테스트가 막히면 도구가 개발을 방해하게 되고, 사용자는 확인 절차를 우회하는 방법부터 찾는다.

단계 2 가 입력 계약 위반을 `test` 에서 비차단으로 둔 것과 같은 판단이다. 그 문서 §6 의 근거가
여기에도 그대로 적용된다. 판정에 새 입력이 끼어들면 runner 설계의 결정론 계약(같은 스위트 두 번
실행 시 `RunnerReport` deep equality)에 명세 파일 밖의 요소가 들어온다.

`--require-approval` 같은 옵션을 지금 만들지 않는다. CI 에서 승인 없는 명세 변경을 막고 싶다는
요구가 실제로 나오면 그때 붙인다. 옵션은 문서·테스트·조합을 함께 늘리므로 수요를 확인하기 전에
만들지 않는다.

**지문이 없는 명세도 정상이다.** 손으로 쓴 명세, `generate` 이전에 만든 명세가 여기 해당한다.
실패로 취급하지 않는다.

## 7. 표시 (`cli`)

### 7.1 언제 찍나

매 실행 한 줄을 무조건 찍으면 손으로 명세를 쓰는 사용자에게는 영구적인 소음이다. 단계 1 이
진단 블록을 실패·비정상 종료 때만 찍는 규칙과 같은 기준을 쓴다.

| 지문 상태 | 전부 통과 | 실패·타임아웃 등이 있음 |
|---|---|---|
| 일치 | 침묵 | 표시 |
| 불일치 | **표시** | 표시 |
| 없음(미고정) | 침묵 | 표시 |

전부 통과인데 불일치일 때 표시하는 이유. 승인받지 않은 명세로 초록불이 뜬 상태다. 그 초록불의
근거가 승인 시점과 다르다는 사실은 실패보다 오히려 조용히 지나가기 쉬우므로 여기서만 예외를 둔다.

### 7.2 문장 (전량)

보고서 본문 뒤에 빈 줄 하나를 두고 stdout 에 쓴다. 진단 블록(stderr)보다 앞이다.

```
명세: 승인 시점과 동일 (9f2c1a3b4d5e…)

명세: 승인 시점 이후 변경됨
  → 승인 9f2c1a3b4d5e…   현재 41ab77c0e912…
  → 실패 원인에서 명세 변경을 배제할 수 없습니다. 명세 diff 를 먼저 확인하세요.

명세: 승인 지문이 없습니다 (미고정)
  → ohmymcp generate 로 승인한 명세가 아니거나 승인 이전 버전으로 만든 파일입니다.
```

앞 12자만 쓴다. 64자는 줄을 넘겨 읽히지 않고, 12자면 두 값이 다르다는 것을 눈으로 확인하기에
충분하다. 자르는 위치가 고정이므로 결정론에 영향이 없다.

지문 문자열은 우리가 만든 hex 라 제어 문자가 섞일 수 없다. 이스케이프 처리가 필요 없는 유일한
표시 항목이다.

### 7.3 `--json`

`RunnerReport` 객체에 `spec` 키를 하나 더해서 출력한다. 기존 키(`schemaVersion` · `suite` ·
`status` · `stopReason` · `cases` · `summary`, `packages/runner/src/executor.ts:54`)는 건드리지
않으므로 기존 소비자가 안 깨진다.

```jsonc
{
  "schemaVersion": 1,
  "suite": { "id": "weather", "name": "날씨 서버 회귀" },
  "status": "failed",
  "cases": [ ... ],
  "summary": { ... },
  "spec": {
    "approval": "matched",              // "matched" | "mismatched" | "absent"
    "fingerprint": "41ab…(64자)",        // 실행 시점에 계산한 값. 항상 있다
    "approvedFingerprint": "9f2c…(64자)" // 파일에 적힌 값. absent 면 이 키가 없다
  }
}
```

`--json` 에서는 §7.1 의 억제 규칙을 적용하지 않는다. 항상 넣는다. 기계가 읽는 출력에서 키가
조건부로 사라지면 소비자가 분기를 하나 더 써야 하고, 사람에게 소음이라는 이유는 기계에
해당하지 않는다.

`spec` 은 `RunnerReport` 가 아니라 `cli` 가 조립한다. `runner` 의 보고서 타입에 넣으면 실행
결과가 아닌 값이 결정론 계약 대상에 들어간다. ADR-0013 의 렌더러 배치 판단과 같은 이유다.

## 8. 저장 경로 (`cli`)

`saveSuite`(`packages/cli/src/generate-command.ts:236`)의 왕복 재검증에 한 줄을 더한다.

지금 검증은 `suiteFingerprint(validated.value) !== fingerprint` 다. `approval` 을 제외해
계산하므로 이 검사는 **파일에 적힌 `approval.fingerprint` 가 틀려도 통과한다.** `renderSuite`
가 지문을 잘못 써넣는 결함을 못 잡는다. 그래서 둘 다 본다.

```ts
if (
  !validated.valid ||
  suiteFingerprint(validated.value) !== fingerprint ||
  validated.value.approval?.fingerprint !== fingerprint
)
  throw new Error("invalid saved suite");
```

`suiteFingerprint` 를 `runner` 에서 정적으로 import 한다. `generate` 동적 import 로 `sha256` 을
끌어오던 `suiteFingerprint` 지역 함수(`generate-command.ts:219`)와 그 주석은 지운다. `runner` 는
이 모듈이 이미 정적으로 의존하는 패키지라 §4.5 가 막으려던 문제가 생기지 않는다.

`renderSuite` 는 지문을 인자로 받아 `approval` 블록을 §3.3 순서로 써넣는다. 지문을 알고 있는
호출 지점은 이미 둘 다 값을 들고 있다(`generate-command.ts:485`, `:633`).

## 9. 결정론성

- 같은 파일에 대해 `suiteFingerprint` 가 항상 같은 값을 낸다. 시간·난수·환경 변수·로캘·파일
  경로에 의존하지 않는다.
- 같은 내용을 다른 들여쓰기·키 순서로 저장한 두 파일이 같은 값을 낸다(§4.3).
- 지문 대조 결과가 `RunnerReport` 에 들어가지 않는다. 보고서의 deep equality 계약이 유지된다.
- `canonicalJson` 이 `undefined` · 비유한 수 · 순환 참조 · sparse array 에서 던진다. 이 입력들은
  `validateMcpSuite` 를 통과한 명세에서 나올 수 없다. `suiteFingerprint` 는 검증을 통과한
  객체에만 호출한다. 이 전제를 함수 주석에 적는다.

## 10. 테스트

전부 인메모리와 `fixtures/` 다. 서버를 띄우는 검증은 §10.5 의 E2E 하나뿐이고 직렬 웨이브다.

### 10.1 `packages/runner/tests/spec-validation.test.ts` (기존 파일에 추가)

```
approval 검증
  · approval 이 없는 기존 명세가 그대로 valid: true
  · approval: { fingerprint: 64자 소문자 hex } 가 valid: true
  · approval 이 배열이면 INVALID_TYPE, path 가 "approval"
  · approval 이 문자열이면 INVALID_TYPE
  · approval 이 null 이면 INVALID_TYPE
  · approval: {} 이면 MISSING_REQUIRED_FIELD, path 가 "approval.fingerprint"
  · fingerprint 가 숫자면 INVALID_TYPE, path 가 "approval.fingerprint"
  · fingerprint 가 63자면 INVALID_VALUE
  · fingerprint 가 65자면 INVALID_VALUE
  · fingerprint 에 대문자가 섞이면 INVALID_VALUE
  · fingerprint 에 hex 아닌 글자가 있으면 INVALID_VALUE
  · approval 에 approvedAt 같은 다른 키가 있으면 UNKNOWN_FIELD, path 가 "approval.approvedAt"
  · MCP_SUITE_JSON_SCHEMA.properties 에 approval 이 있고 $defs.suiteApproval 이 위 규칙과 같다
```

### 10.2 `packages/runner/tests/suite-fingerprint.test.ts` (신규)

```
suiteFingerprint
  · 반환이 /^[0-9a-f]{64}$/ 를 만족한다
  · approval 이 없는 suite 와 approval 을 붙인 같은 suite 의 지문이 같다   ← 자기참조 회피의 핵심
  · approval.fingerprint 값만 다른 두 suite 의 지문이 같다
  · cases 안의 문자열 한 글자를 바꾸면 지문이 달라진다
  · name 을 바꾸면 지문이 달라진다
  · defaultTimeoutMs 를 바꾸면 지문이 달라진다
  · 키 순서만 다른 동등한 두 suite 의 지문이 같다
  · cases 배열 순서를 바꾸면 지문이 달라진다   ← 순서는 의미다
  · 같은 suite 로 2회 호출한 결과가 동일하다
  · 호출 후 인자로 넘긴 객체가 변형되지 않는다 (approval 키가 그대로 남아 있다)
  · Object.freeze 된 suite 에도 던지지 않는다
```

### 10.3 `packages/runner/tests/canonical.test.ts` (신규) 와 의존 경계

`generate` 에는 canonical 전용 테스트 파일이 없다. `sha256` 단언 4건이
`packages/generate/tests/baseline.test.ts:148~163` 에 섞여 있다. 그 4건을 **단언 문구 그대로**
`runner` 의 새 파일로 옮기고, `baseline.test.ts` 에는 baseline 자체의 단언만 남긴다. 문구를
그대로 옮기는 것이 이동이 동작을 바꾸지 않았다는 근거다.

여기에 canonical 의 방어 계약을 새로 추가한다. 지금 어느 테스트도 안 덮고 있는데
`suiteFingerprint` 가 이 함수에 기대게 되므로 계약을 고정한다.

```
canonicalJson
  · undefined 를 넣으면 TypeError
  · NaN · Infinity 를 넣으면 TypeError
  · 순환 참조를 넣으면 TypeError
  · sparse array 를 넣으면 TypeError
  · Object.create(null) 로 만든 객체를 받는다
  · class 인스턴스를 넣으면 TypeError
```

`packages/generate` 쪽에는 재수출 확인만 남긴다.

```
· @ohmymcp-hsu/generate 의 sha256 이 @ohmymcp-hsu/runner 의 sha256 과 같은 함수 참조다
· @ohmymcp-hsu/generate 의 canonicalJson · deepFreeze 도 같다
```

`packages/generate/tests/dependency-boundary.test.ts` (§4.6)

```
· APPROVED_RUNNER_SYMBOLS 에 canonicalJson · deepFreeze · sha256 이 있다
· 정규식이 export ... from "@ohmymcp-hsu/runner" 구문의 심볼도 수집한다
  (canonical.ts 의 재수출 세 개가 실제로 used 집합에 잡히는지 단언한다)
· 목록에 없는 심볼을 재수출하는 가짜 소스를 넣으면 테스트가 실패한다
```

마지막 단언이 §4.6 의 구멍을 막는 장치다. 정규식만 고치고 그 사실을 검증하지 않으면 다음에
누가 되돌려도 안 잡힌다.

### 10.4 `packages/cli/tests/test-command.test.ts` (기존 파일에 추가)

```
지문 대조 표시
  · 전부 통과 + 지문 일치 → 명세 줄이 없다
  · 전부 통과 + 지문 없음 → 명세 줄이 없다
  · 전부 통과 + 지문 불일치 → "승인 시점 이후 변경됨" 이 stdout 에 있다
  · 실패 있음 + 지문 일치 → "승인 시점과 동일" 이 stdout 에 있다
  · 실패 있음 + 지문 없음 → "승인 지문이 없습니다 (미고정)" 가 stdout 에 있다
  · 실패 있음 + 지문 불일치 → 승인 값과 현재 값이 각각 앞 12자로 찍힌다
  · 명세 줄이 보고서 본문 뒤에 오고 그 앞에 빈 줄이 하나 있다

종료 코드
  · 지문 불일치인데 전부 통과면 종료 코드가 0
  · 지문 일치인데 실패가 있으면 종료 코드가 1
  · 지문 불일치와 지문 일치의 종료 코드가 같은 케이스 결과에서 동일하다

--json
  · spec.approval 이 "matched" | "mismatched" | "absent" 중 하나다
  · 전부 통과 + 일치여도 spec 키가 있다 (억제 규칙을 적용하지 않는다)
  · absent 일 때 spec.approvedFingerprint 키가 없다
  · spec.fingerprint 가 항상 64자 hex 다
  · 기존 키(schemaVersion, suite, status, cases, summary)가 그대로다
```

### 10.5 `packages/cli/tests/generate-command.test.ts` (기존 파일에 추가)

```
저장
  · 저장된 JSON 에 approval.fingerprint 가 있고 finalize 가 낸 값과 같다
  · 저장된 JSON 의 키 순서가 schemaVersion, id, name, approval, defaultTimeoutMs, cases 다
  · 저장된 파일을 다시 읽어 validateMcpSuite 에 넣으면 valid: true 다
  · renderSuite 가 approval 에 틀린 값을 쓰면 saveSuite 가 커밋하지 않는다
  · suiteFingerprint 가 approval 을 제외하므로, 저장 전 지문과 저장 후 파일의 지문이 같다
  · 기존 "키 순서가 다른 동등한 suite 는 같은 fingerprint 를 낸다" 단언이 변경 없이 통과한다
```

### 10.6 E2E (직렬 웨이브)

`examples/` 의 예제 서버 대상. 기존 E2E 스크립트에 이어 붙인다.

```
· generate --baseline-only 로 저장한 명세를 test 로 돌리면 지문 일치 경로를 탄다
· 저장된 파일의 케이스 이름 한 글자를 바꾸고 test 를 다시 돌리면
  "승인 시점 이후 변경됨" 이 나오고 종료 코드는 바꾸기 전과 같다
· approval 블록을 통째로 지우고 test 를 돌리면 검증을 통과하고 "미고정" 경로를 탄다
```

세 번째가 하위 호환의 실측이다. 이것이 깨지면 기존 사용자의 명세가 전부 못 돌게 된다.

표적 검증: `pnpm test packages/runner`, `pnpm test packages/cli`
전체 회귀: `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`

## 11. ADR

**신규 ADR 대상: 승인 지문의 계산 범위와 자기참조 회피.**

다르게 갈 수 있었던 판단이 셋이고 서로 얽혀 있어 한 문서로 묶는다.

1. **무엇을 해싱하나.** 파일 바이트 / 파싱된 객체 / 객체 + 서버 선언. 파싱된 객체를 택했다
   (§4.3, §4.4).
2. **지문을 어디에 두나.** 파일 안 / 사이드카 파일. 파일 안을 택했다. 사이드카는 복사·이동·
   머지에서 본체와 어긋나고, 어긋난 것을 아무도 모른다.
3. **자기참조를 어떻게 피하나.** 필드 단위 제외 / 블록 단위 제외. 블록 단위를 택했다(§3.1).

`docs/adr/0017-승인-지문-계산-범위.md` 로 초안을 만든다. 배경 / 선택지 / 결정 / 이유 / 결과
다섯 항목.

**ADR-0009 개정도 함께 한다.** `generate → runner` 예외의 승인 심볼 목록에 `canonicalJson` ·
`deepFreeze` · `sha256` 이 들어간다. 목록을 늘리려면 ADR 을 먼저 고쳐야 한다는 것이
`dependency-boundary.test.ts` 주석에 적힌 규칙이다(§4.6).

## 12. 거짓 신호

`CLAUDE.local.md` 표에서 이 작업에 해당하는 항목.

| 거짓 신호 | 이 작업에서의 모습 | 진실 기준 |
|---|---|---|
| 결함이 계속 재현 | `runner` 이동분의 빌드 산출물이 낡아 `generate` 가 옛 `canonical.ts` 를 봄 | `pnpm build` 후 재확인 |
| 유닛테스트 녹색, 실행 시 실패 | 지문을 인메모리 객체로만 검증. 파일 왕복에서 깨질 수 있음 | §10.5 · §10.6 의 왕복 테스트 |
| 타입체크 녹색 | `suiteFingerprint` 가 `index.ts` 에 export 안 돼 `cli` 에서 안 보임 | export 문과 검사 파일 수 확인 |

이 작업 고유의 것 둘.

| 거짓 신호 | 원인 | 진실 기준 |
|---|---|---|
| 지문이 항상 일치해서 잘 도는 것처럼 보임 | 대조 대상이 파일이 아니라 방금 계산한 값이라 자기 자신과 비교 중 | 파일의 `cases` 를 손으로 고쳐 불일치가 실제로 나오는지 확인(§10.6) |
| 지문이 항상 불일치 | `approval` 제외를 안 했거나 한쪽에서만 했다 | §10.2 의 "approval 붙인 것과 안 붙인 것이 같다" 단언 |

두 번째가 §4.1 의 함정 그 자체다. 제외를 저장 경로와 실행 경로 **양쪽**에서 같은 함수로 해야
하고, 그래서 `suiteFingerprint` 를 두 곳에서 각자 구현하지 않고 `runner` 하나에 둔다.

## 13. 소유권과 PR

**PR 2개, 커밋 3개.** 두 번째 PR 은 첫 번째가 머지된 뒤에 시작한다.

| PR | 커밋 | 패키지 | 내용 | 커밋 메시지 |
|---|---|---|---|---|
| 1 | 1 | `runner` | `SuiteApproval` 타입, 검증, `MCP_SUITE_JSON_SCHEMA` | `feat(runner): 명세에 승인 지문 필드를 추가한다` |
| 1 | 2 | `runner` · `generate` | `canonical.ts` 이관, `suiteFingerprint`, 재수출, 의존 경계(§4.6) | `refactor(runner): canonical JSON 구현을 generate 에서 이관한다` |
| 2 | 3 | `cli` | 저장 시 `approval` 기록, `test` 의 명세 상태 줄, `--json` 의 `spec` 키 | `feat(cli): 승인 지문 대조 결과를 보고서에 표시한다` |

**패키지별 PR 로 나누지 않은 이유.** `canonical.ts` 이관은 `runner` 에 파일이 생기는 것과
`generate` 가 재수출로 바뀌는 것이 한 몸이다. 나누면 중간 커밋에서 같은 구현이 두 벌 존재하고,
§2 완료 조건("구현이 저장소에 한 벌")이 그 시점에 거짓이 된다. 두 패키지가 같은 파트① 소유라
CONTRIBUTING §2.2(한 PR 에 여러 오너 영역 금지)에 걸리지 않는다. `cli` 는 공동 소유이므로
PR 을 분리한다.

- `core` · `record` · `mock` 변경 0건. `core/src/types.ts` 는 읽지도 않는다
- changeset 을 PR 마다 하나씩 넣는다. 둘 다 `minor`(공개 계약 추가)

## 14. 후속 연동

- 단계 3(dry run 승인 게이트)이 `approval` 블록에 케이스별 승인 상태를 더한다. §3.1 의 블록
  단위 제외 규칙 덕분에 그때 §4 를 고칠 필요가 없다
- 단계 7(결정론성 확인)과 짝이 된다. 지문은 "명세가 그대로인가", 단계 7 은 "서버가 그대로인가"
  를 답한다. 둘이 모이면 실패 원인 후보가 상당히 좁혀진다
- `--require-approval` 은 CI 에서 승인 없는 명세 변경을 막자는 요구가 실제로 나오면 그때
  검토한다(§6)
