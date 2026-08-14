# CR1 보고서: CodeRabbit 지적 둘 (PR #80)

PR #80 의 CodeRabbit 지적 중 `packages/generate` 소관 둘을 고쳤다. 둘 다 실제 결함이 맞다.

**판정: READY_FOR_REVIEW.** 두 수정 각각 되돌려 새 테스트가 실제로 빨간불이 나는 것을 확인했다.

착수 전에 `docs/adr/0018-입력-계약-대조-소비자-배선.md` 로 파일명이 내려간 것을 확인했다
(`0017-승인-지문-계산-범위.md` 다음 번호다).

---

## 1. 8개 코드가 `expected` · `actual` · `suggestion` 에 담는 것 (실측)

추측이 아니라 `packages/runner/src/input-contract.ts` 와 `assertion-substance.ts` 를 읽고
만든 표다. 행 번호는 finding 을 만드는 지점이다.

| 코드 | `expected` | `actual` | `suggestion` | `path` | 값을 담나 |
|---|---|---|---|---|---|
| `TOOL_NOT_DECLARED` (238행) | — | 툴 **이름** (`toolName`) | 비슷한 툴 **이름** | `operation.tool` | ✗ |
| `SCHEMA_NOT_ANALYZABLE` (251행) | — | 툴 **이름** | — | `operation.tool` | ✗ |
| `REQUIRED_MISSING` (270행) | 선언된 필수 필드 **이름** | — | 입력에 있던 미선언 필드 **이름** | `input.<name>` | ✗ |
| `UNDECLARED_FIELD` (287행) | — | 입력 필드 **이름** (`key`) | 선언된 필드 **이름** | `input.<key>` | ✗ |
| `TYPE_MISMATCH` (307행) | 선언 **타입 이름** (`field.type`) | 입력 값의 **타입 이름** (`typeName(value)`) | — | `input.<key>` | ✗ |
| `ENUM_MISMATCH` (319행) | 선언된 enum **값 목록** (`[...allowed]`) | 명세가 쓴 **입력 값** (`value`) | enum 목록에서 고른 **문자열 값** | `input.<key>` | **✅** |
| `VACUOUS_MIN_LENGTH` (assertion-substance 40행) | — | — | — | `assertions[i].schema.minLength` | ✗ |
| `VACUOUS_MIN_ITEMS` (같은 곳) | — | — | — | `assertions[i].schema.minItems` | ✗ |

**오케스트레이터의 짐작이 맞았다.** `UNDECLARED_FIELD` 의 `actual` 은 필드 이름이고
`TYPE_MISMATCH` 의 둘은 타입 이름이라 값이 아니다. 값을 담는 것은 `ENUM_MISMATCH` 하나뿐이고
`expected` · `actual` 둘 다 샌다. `suggestion` 도 enum 목록에서 골라 온 값이라 함께 샌다.

단언 실질성 두 코드는 `perCase.push({ code, severity, caseId, path })` 로 값 필드를 아예 안
만든다.

`path` 는 여덟 코드 모두 이름이다. 치환 대상이 아니다.

---

## 2. 바꾼 파일

| 파일 | 내용 |
|---|---|
| `packages/generate/src/authoring-session.ts` | `redactSpecFindings` 추가(export), `CARRIES_VALUE` 표 추가, 로컬 경로 배선, 치환 옵션을 `redaction` 하나로 묶음 |
| `packages/generate/src/authoring-request.ts` | `redactSpecFindings` import 후 provider 경로 배선, `unredactedTools` 를 `frozen(options.tools)` 스냅샷으로 |
| `packages/generate/tests/authoring-request.test.ts` | 헬퍼에 `mutateToolsAfterPrepare` 추가, 테스트 셋 추가 |
| `packages/generate/tests/authoring-session.test.ts` | 로컬 경로 누출 테스트 추가 |
| `docs/adr/0018-입력-계약-대조-소비자-배선.md` | 결과 절에 두 문단 |

`packages/generate/src/authoring-types.ts` 는 손댈 필요가 없었다. 허용 목록에 있었지만 타입
변경 없이 끝났다.

`packages/cli/src/test-command.ts` 와 그 테스트는 건드리지 않았다. `git diff --stat` 에 보이는
것은 동시 작업자(`ohmymcp-a3`)의 변경이다. `packages/core` · `packages/runner` · 루트 빌드
설정은 변경 0건이다. 의존성 추가 0건.

---

## 3. 결함 1 수정: 치환한 값이 다시 새는 것

검사 위치는 그대로 두었다. 치환 이전 객체로 검사하는 근거(거짓 양성)는 유효하다. 고친 것은
**결과를 싣기 직전에 값 필드를 거르는 단계가 없다**는 것이다.

```ts
const specFindings = deepFreeze({
  inputContract: redactSpecFindings(checkInputContract({ suite: value, tools: contractTools }), redaction),
  assertionSubstance: redactSpecFindings(checkAssertionSubstance(value), redaction),
});
```

**두 경로가 같은 함수를 쓴다.** `redactSpecFindings` 는 `authoring-session.ts` 에 한 벌만 있고
`authoring-request.ts` 가 그것을 import 한다. 치환 정책도 새로 만들지 않았다. 안에서
`sanitizeRedactable` 을 부르므로 `sensitiveValues` 와 `DEFAULT_SENSITIVE_KEYS` 와 `REDACTED` 가
`redactAuthoringSuite` 와 같은 것으로 적용된다.

로컬 경로에서 치환 옵션이 두 군데로 갈릴 뻔했다. suite 치환이 쓰던
`{ ...options.redaction, sensitiveValues: options.sensitiveValues ?? options.redaction?.sensitiveValues }`
를 `redaction` 상수로 뽑아 finding 치환도 같은 것을 쓰게 했다. 두 벌로 두면 한쪽만 고쳐져
조용히 어긋난다.

어느 코드를 거를지는 배열이 아니라 `Record<SpecFindingCode, boolean>` 이다. 배열로 두면 값을
담는 새 코드가 조용히 치환을 빠져나가고, 그것은 감춘 값이 화면에 뜨는 결과가 된다. `Record`
면 `runner` 가 코드를 늘릴 때 타입 오류가 먼저 난다. T4b 에서 쓴 것과 같은 방식이다.

---

## 4. 결함 2 수정: `unredactedTools` 스냅샷

```ts
unredactedTools: frozen(options.tools),
```

`frozen` 은 이 파일에 이미 있는 `deepFreeze(structuredClone(value))` 다(242행). 새로 만들지
않았다. `byte(...)` 계산과 `assertJson` 대상에는 여전히 안 들어간다. 그 두 곳은
`options.tools` 와 `request` 를 보고 `RequestState` 를 보지 않는다.

---

## 5. 검증

| 명령 | 판정 줄 |
|---|---|
| `pnpm vitest run packages/generate` | `Test Files  7 passed (7)` / `Tests  143 passed \| 1 skipped (144)` |
| `npx turbo typecheck --force` | `Tasks:    6 successful, 6 total` / `Cached:    0 cached, 6 total` |
| `npx biome check packages/generate` | `Checked 24 files in 11ms. No fixes applied.` |
| `npx biome ci packages/generate` | `Checked 24 files. No fixes applied.` |

전체 `pnpm test` 는 지시대로 판정 근거로 쓰지 않았다(`ohmymcp-a3` 가 `test-command.ts` 를
동시에 고친다).

`biome` 이 한 번 걸렸다. `CandidateSpecFindings` 를 별도 `import type` 줄로 넣어 정렬 규칙에
어긋났다. 기존 `./authoring-types.js` import 블록 안으로 합쳤다.

---

## 6. 무는지 확인 (두 수정 각각)

**프로브 1 — finding 치환을 끈다.** `redactSpecFindings` 의
`if (!CARRIES_VALUE[finding.code]) return finding;` 를 `if (true || …)` 로 바꿨다.

```
FAIL  authoring-request.test.ts > provider 경로의 specFindings 에 민감 값 원문이 남지 않는다
FAIL  authoring-request.test.ts > 세션 경로의 specFindings 에도 민감 값 원문이 남지 않는다
FAIL  authoring-session.test.ts > 로컬 경로의 specFindings 에 민감 값 원문이 남지 않는다
Tests  3 failed | 140 passed | 1 skipped (144)
```

세 경로가 각각 잡혔다.

**프로브 2 — 스냅샷을 참조로 되돌린다.** `unredactedTools: frozen(options.tools)` 를
`options.tools` 로 되돌렸다.

```
FAIL  authoring-request.test.ts > 요청 준비 뒤 호출자가 tools 를 바꿔도 검사 결과가 그대로다
Tests  1 failed | 142 passed | 1 skipped (144)
```

둘 다 원복했고 `pnpm vitest run packages/generate` 가 `143 passed` 로 돌아온 것과
`git diff --stat -- packages/generate` 가 의도한 네 파일만 담는 것을 확인했다.

---

## 7. 임의로 판단한 지점

**1) `runner` 에서 새 심볼을 안 가져왔다.** `SpecFinding` 과 `SpecFindingCode` 타입이 필요했는데
그것을 import 하면 ADR-0009 의 승인 심볼 목록이 늘어 `dependency-boundary.test.ts` 가 깨진다.
그 파일은 이번 허용 목록 밖이다. 이미 승인된 `SpecFindingsResult` 에서 인덱스 접근으로 뽑았다.

```ts
type SpecFinding = CandidateSpecFindings["inputContract"]["findings"][number];
type SpecFindingCode = SpecFinding["code"];
```

새 의존이 아니라 승인된 타입의 파생이라 목록을 넓힐 이유가 없다.

**2) `redactSpecFindings` 를 `authoring-session.ts` 에 뒀다.** 두 경로가 공유해야 하는데 허용
파일이 `authoring-session.ts` · `authoring-request.ts` · `authoring-types.ts` 셋뿐이다.
`authoring-types.ts` 는 타입만 있는 파일이고, `authoring-request.ts` 는 이미
`authoring-session.ts` 를 import 하므로(`reviewLocalAuthoringCandidate`) 그쪽에 두는 것이
방향에 맞는다. `redaction.ts` 가 더 자연스러운 자리일 수 있으나 허용 목록 밖이라 안 건드렸다.

**3) 키가 없던 필드를 만들지 않는다.** `expected` 나 `actual` 이 `undefined` 면 스프레드에서
빼서 키 자체가 안 생기게 했다. `input-contract.ts` 의 `withSuggestion` 이 "suggestion 이 없으면
키 자체를 만들지 않는다. 소비자가 존재 여부로 분기한다" 는 계약을 세워 뒀고, 치환 단계가 그것을
깨면 안 된다.

**4) 테스트 명세에 민감 값을 양쪽에 심었다.** `sensitiveValues: ["c", "secret-unit"]` 이고
선언 enum 은 `["c", "f"]`, 입력은 `"secret-unit"` 이다. `expected` 누출(서버 선언 쪽)과
`actual` 누출(명세 입력 쪽)이 서로 다른 경로라 하나만 심으면 반쪽만 잡는다. 기대값을
`[REDACTED, "f"]` 로 두어 **치환되지 않아야 할 `"f"` 가 그대로 남는 것**도 함께 고정했다.

**5) 결함 2 테스트의 변형을 "오타를 정답으로 만드는" 방향으로 잡았다.** `required` 를
`["citi"]` 로 바꾸고 `properties.citi` 를 더한다. 참조를 들고 있으면 `REQUIRED_MISSING` 이
**사라지는** 방향이라, finding 개수가 줄어드는 것으로 확실히 잡힌다. 배열에 도구를 하나
끼워 넣는 것도 같이 해서 배열 자체의 변형도 덮는다.

**6) `authoring-types.ts` 를 안 고쳤다.** 허용 목록에 있었지만 타입 변경 없이 끝났다.
`specFindings` 의 타입은 그대로이고 값만 걸러진다.

---

## 8. 남은 위험

1. **`CARRIES_VALUE` 는 코드를 빠뜨리는 것만 막는다.** 값을 담는 새 코드를 `false` 로 적으면
   타입은 통과하고 값이 샌다. T4b 의 `FINDING_GROUP` 과 같은 한계다. ADR-0018 결과 절에
   적었다. 코드를 늘리는 PR 에서 사람이 봐야 한다.
2. **`describeSpecFinding` 이 앞으로 다른 필드를 문장에 넣으면 그것도 새 누출 경로다.** 지금은
   `expected` · `actual` · `suggestion` · `path` 넷만 쓴다. `runner` 가 finding 에 필드를
   더하고 문장에 넣으면 `redactSpecFindings` 도 함께 늘려야 한다. 이 결합을 타입으로 잡는
   장치는 없다.
3. **`unredactedTools` 가 payload 밖이라는 보장은 여전히 코드 위치뿐이다.** T3 보고서에 적은
   위험 그대로다. 스냅샷이 되면서 호출자 변형에는 안전해졌지만, 누가 `RequestState` 를
   직렬화하거나 `preview` 에 실으면 원본 스키마가 provider 로 샌다. `WeakMap` 안에만 있고
   `preview` 에 노출되지 않는다는 사실을 고정하는 테스트는 없다.
4. **`cli` 쪽 표시 코드는 이번에 안 봤다.** 승인 화면은 candidate 에 실린 값을 그대로 찍으므로
   이 수정으로 함께 안전해진다. 다만 그 사실을 `cli` 테스트가 직접 고정하지는 않는다. 지금
   확인은 `generate` 쪽 `JSON.stringify(preview)` 와 `describeSpecFinding` 결과로 한다.
