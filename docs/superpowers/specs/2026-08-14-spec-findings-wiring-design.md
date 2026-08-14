# 입력 계약 대조 소비자 배선 (단계 2-B) 설계

- 날짜: 2026-08-14
- 대상 패키지: `runner`, `generate`, `cli`
- 선행: `docs/superpowers/specs/2026-08-14-input-contract-check-design.md`, ADR-0015
- 통합 SHA: `docs/task-integration-ledger.tsv` 의 `T1~T4-input-contract`

## 1. 배경

`runner` 가 세 함수를 export 하지만 아무도 쓰지 않는다.

```ts
checkInputContract({ suite, tools }): SpecFindingsResult
checkAssertionSubstance(suite): SpecFindingsResult
describeSpecFinding(finding): string
```

구현은 끝났고 테스트도 있다. 소비자가 없어서 사용자에게는 아무 변화가 없다. 이 문서는 두
소비자(`generate` 승인 화면, `cli test` 출력)에 배선하는 방법을 정한다.

착수 전에 정해야 했던 것이 둘 있었고, 코드를 읽어 답이 나왔다. 2절과 3절이 그것이다.

## 2. `UNCONSTRAINED_SCHEMA` 는 도달 불가다

`packages/generate/src/authoring-session.ts:93` 의 `candidateFor` 는 preview 를 만들기 전에
`validateMcpSuite` 를 돌리고, 위반이 하나라도 있으면 `status: "invalid"` 로 끝낸다.
`baseline.ts:80` 도 같다. 즉 승인 화면에 올라오는 후보는 전부 검증 통과분이다.

`validateMcpSuite` 는 빈 스키마를 중첩 레벨까지 거부한다.

```
거부  {}                                      INVALID_VALUE
거부  { minLength: 0 }                        SCHEMA_KEYWORD_REQUIRES_TYPE
거부  { type: object, properties: { a: {} } }  INVALID_VALUE
통과  { type: string, minLength: 0 }          VACUOUS_MIN_LENGTH
통과  { type: array,  minItems: 0 }           VACUOUS_MIN_ITEMS
```

**결정:** `UNCONSTRAINED_SCHEMA` 를 제거한다. 단언 실질성 검사에서 살아 있는 코드는
`VACUOUS_MIN_LENGTH` 와 `VACUOUS_MIN_ITEMS` 둘이다. 죽은 분기를 남기면 나중에 소비자가 그
코드를 근거로 분기를 짜게 된다.

## 3. 대조는 값 치환 이전에 해야 한다

`redactAuthoringSuite` 는 `operation.input` 의 민감 값을 `[REDACTED]` 문자열로 바꾼다
(`packages/generate/src/redaction.ts:22`). preview 에 담기는 suite 는 치환본이다.

숫자 필드가 치환되면 값이 문자열이 되므로 `TYPE_MISMATCH` 가 거짓으로 뜬다. 실패 메시지가
곧 제품인 프로젝트에서 거짓 양성은 그 메시지를 안 읽게 만드는 가장 빠른 길이다.

치환 이전 객체는 `candidateFor` 안의 지역 변수 `value` 에만 있다
(`authoring-session.ts:95`). 그래서 검사 위치가 정해진다.

### 검토한 선택지

| 선택지 | 내용 | 판단 |
|---|---|---|
| A. `generate` 안에서 검사 | 치환 전 `value` 로 돌리고 결과를 preview 에 실어 보낸다 | **채택** |
| B. `cli` 가 `runner` 를 직접 호출 | `generate` 무수정. 그런데 CLI 가 든 suite 는 치환본이라 거짓 양성이 난다. 치환 전 객체를 넘기려면 어차피 `generate` API 를 고쳐야 하므로 이득이 사라진다 | 기각 |
| C. `applyAuthoringChanges` 시점 검사 | 차단 지위는 자연스럽지만 사용자가 diff 를 다 읽고 승인을 누른 뒤에야 경고를 본다 | 기각 |

## 4. `runner` 변경

1. `SpecFindingCode` 에서 `UNCONSTRAINED_SCHEMA` 삭제. `assertion-substance.ts` 의 해당 분기와
   `describeSpecFinding` 의 `case` 도 함께 삭제한다.
2. `TYPE_MISMATCH` 문안에서 `선언:` 을 `서버 선언:` 으로 고친다. 어느 쪽이 서버이고 어느 쪽이
   테스트인지 낱말만으로 구분되게 한다(T1 보고서 문안 제안 1번).

   ```
   input.city 의 타입이 다릅니다. 서버 선언: 'string', 명세: 'number'
   ```
3. `VACUOUS_MIN_LENGTH` · `VACUOUS_MIN_ITEMS` 의 문장은 `path` 가 `minLength` 또는 `minItems`
   로 끝나는 것에 의존한다. 그 계약을 고정하는 테스트를 추가한다(제안 3번).
4. 선행 설계 문서 §8 의 예시 출력을 §7 의 실제 문안에 맞춘다. 지금은 따옴표 표기가 어긋나
   있어 배선하는 사람이 §8 을 그대로 옮기면 출력이 달라진다.

T1 보고서 문안 제안 2번(`UNCONSTRAINED_SCHEMA` 의 "스키마" 중복)은 그 코드를 지우면서 함께
사라진다.

## 5. `generate` 배선

`candidateFor` 안에서 `redactAuthoringSuite` 호출 이전에 검사한다.

```ts
const specFindings = deepFreeze({
  inputContract: checkInputContract({ suite: value, tools: options.tools }),
  assertionSubstance: checkAssertionSubstance(value),
});
```

두 결과를 병합하지 않고 필드 둘로 나눈다. 병합하면 두 검사 사이의 정렬 정책을 새로 정해야
하고 `totalFindings` 둘을 어떻게 합칠지가 애매해진다. 나누면 각 검사의 기존 정렬과
`totalFindings` 가 그대로 뜻을 유지한다.

`SanitizedAuthoringCandidate` 에 필드를 더한다.

```ts
readonly specFindings: {
  readonly inputContract: SpecFindingsResult;
  readonly assertionSubstance: SpecFindingsResult;
};
```

`options.tools` 는 `candidateFor` 가 이미 받고 있다. 서버를 다시 부르지 않는다.
`reviewLocalAuthoringCandidate` 를 직접 쓰는 프로그램 소비자도 같은 결과를 받는다.

### 5.1 경로가 둘이다

후보를 만드는 곳이 둘이다. 로컬 검토는 `authoring-session.ts` 의 `candidateFor` 이고, AI 경로는
`authoring-request.ts:414` 의 `dispatchAuthoringRequest` 다. 로드맵이 말한 "AI 케이스에 경고" 가
지나가는 곳은 뒤쪽이다. 둘 다 채운다.

provider 경로에는 조건이 하나 더 붙는다. `state.tools` 는 provider 로 보내려고 값 치환을 거친
사본이다(`authoring-request.ts:282`). `TOOL_CONTRACT_PATHS` 가 지키는 것은 `[i].name` 뿐이라
`inputSchema` 안의 `enum` 값은 치환될 수 있고, 그것으로 대조하면 정상 입력이 `ENUM_MISMATCH` 로
뒤집힌다. 그래서 `prepareAuthoringRequest` 가 받은 원본 툴 목록을 요청 상태에 따로 보관해 검사에만
쓴다. 원본은 provider 로 나가지 않고 payload 크기 계산에도 들어가지 않는다.

### 5.2 지문은 바뀌지 않는다

`specFindings` 는 `result` 바깥에 둔다. 후보 지문은 `sha256(result)`(provider 경로)와
`sha256(frozenSuite)`(로컬 경로)로 계산되므로, 안에 넣으면 이미 승인된 지문이 전부 어긋난다.

## 6. `cli` 승인 화면 배선

### 6.1 표시 시점

`showDiff` 직후가 아니라 **change ID 선택 뒤**에 찍는다. 선택한 change 의 `caseId` 집합에
걸린 finding 만 센다. 사용자가 위반 케이스를 선택에서 뺐다면 경고할 이유가 없다.
`apply-all` 은 모든 change 를 선택한 것이므로 같은 경로를 탄다.

`SCHEMA_NOT_ANALYZABLE` 은 위반이 아니라 건너뜀이다. 개수에서 빼고 별도 줄로 알린다.

### 6.2 문안

**두 검사를 한 머리글 아래 합치지 않는다.** 입력 계약 위반과 단언 실질성 위반은 고칠 자리가
다르다. `assertions[0].schema.minLength 는 0이라 모든 문자열이 통과합니다` 가 `입력 계약 위반`
아래 붙으면 읽는 사람이 입력을 고치러 간다. 이 프로젝트에서 화면에 찍히는 문장이 곧 제품이므로
어디를 고쳐야 하는지가 머리글에서 갈려야 한다.

```
입력 계약 위반 2건 (선택한 변경 기준)
  → change-002 seoul-weather
     필수 필드 'city' 가 입력에 없습니다. 비슷한 필드: 'citi'
     'citi' 는 서버가 선언하지 않은 필드입니다. 비슷한 필드: 'city'
항상 통과하는 단언 1건 (선택한 변경 기준)
  → change-002 seoul-weather
     assertions[0].schema.minLength 는 0이라 모든 문자열이 통과합니다
```

둘 다 있으면 **입력 계약 블록이 먼저**다. 명세를 고칠 때 입력이 먼저 맞아야 단언을 볼 수 있다.
한쪽이 0건이면 그 머리글은 아예 안 나온다.

문장은 전부 `describeSpecFinding` 이 만든다. CLI 는 들여쓰기와 화살표만 붙인다. 문안을 CLI 가
새로 지으면 같은 위반이 두 화면에서 다르게 읽힌다.

코드를 어느 블록에 넣을지는 `Record<SpecFindingCode, ...>` 로 적는다. 문자열 배열로 두면
`runner` 가 코드를 늘렸을 때 새 코드가 어느 블록에도 못 들어간 채 조용히 사라진다. 이 화면에서
누락은 "위반이 없다" 로 읽히므로 가장 나쁜 실패다. `Record` 면 타입 오류로 먼저 걸린다.

### 6.3 재확인

blocking finding 이 1건 이상이면 기존 `io.confirm("선택한 변경을 적용할까요?")` 앞에 확인을
하나 더 넣는다. **확인은 종류와 무관하게 하나뿐이고 개수는 두 종류의 합이다.** 종류마다 확인을
받으면 화면만 길어지고 사용자가 내리는 판단은 여전히 "그래도 적용할까" 하나다.

```
위반 2건이 남아 있습니다. 그래도 적용합니까?
```

거부하지는 않는다. 이 검사는 100% 정확하지 않다. 서버가 `inputSchema` 를 느슨하게 선언했거나
`additionalProperties` 를 적지 않으면 정상 명세도 `UNDECLARED_FIELD` 로 걸린다. 거부하면
사용자가 옳은 명세를 저장할 방법이 없어진다. 그래서 진행은 열어 두고 손이 한 번 더 가게 한다.

## 7. `cli test` 배선

### 7.1 툴 목록

연결 직후 `listTools()` 를 한 번 부른다. 실패하거나 목록이 비면 입력 계약 대조를 **조용히**
건너뛴다. 비차단 진단이 실행 자체를 깨뜨리면 안 되고, 실패 원인과 무관한 줄이 보고서에 섞이면
정작 필요한 줄이 안 읽힌다.

`checkAssertionSubstance` 는 툴 목록이 필요 없으므로 항상 돈다.

### 7.2 표시

실패한 케이스에 한해서만 찍는다. 위치는 `renderReport` 출력 뒤, 명세 승인 블록 앞이다.

**머리글은 검사 종류마다 다르다.** 세 종류로 가른다.

| 그룹 | 코드 | 머리글 |
|---|---|---|
| 입력 계약 | `TOOL_NOT_DECLARED` · `REQUIRED_MISSING` · `UNDECLARED_FIELD` · `TYPE_MISMATCH` · `ENUM_MISMATCH` | `참고: <caseId> 의 입력이 서버 선언과 다릅니다` |
| 단언 실질성 | `VACUOUS_MIN_LENGTH` · `VACUOUS_MIN_ITEMS` | `참고: <caseId> 의 단언은 무엇이 와도 통과합니다` |
| 건너뜀 | `SCHEMA_NOT_ANALYZABLE` | `참고: <caseId> 의 입력 검사를 건너뛰었습니다` |

```
참고: seoul-weather 의 입력이 서버 선언과 다릅니다
  → 필수 필드 'city' 가 입력에 없습니다. 비슷한 필드: 'citi'

참고: seoul-weather 의 단언은 무엇이 와도 통과합니다
  → assertions[0].schema.minLength 는 0이라 모든 문자열이 통과합니다

참고: busan-weather 의 입력 검사를 건너뛰었습니다
  → 'get_weather' 의 입력 스키마를 해석하지 못해 이 툴의 입력 검사를 건너뜁니다
```

이유는 고칠 곳이 다르다는 것이다. `minLength: 0` 은 입력의 문제가 아니라 단언의 문제다.
`SCHEMA_NOT_ANALYZABLE` 은 아예 위반이 아니다. 서버 스키마를 못 읽어 검사를 못 한 것이지
명세가 틀린 것이 아니다. 어느 쪽이든 `… 의 입력이 서버 선언과 다릅니다` 아래에 붙이면 읽는
사람이 멀쩡한 입력을 고치러 간다. 이 프로젝트에서 문안은 곧 제품이므로 머리글이 내용과
어긋나는 것을 남기지 않는다. 승인 화면이 건너뜀을 위반 개수에서 빼는 것(§6.1)과 같은 선이다.

블록 순서는 입력 계약, 단언 실질성, 건너뜀이다. 위반 사이에서는 입력이 먼저 맞아야 단언을 볼
수 있으므로 입력 계약이 앞이다. 건너뜀이 맨 뒤인 이유는 그것만 있을 때 위에 아무 위반도 없다는
사실이 먼저 읽혀야 하기 때문이다. 한 그룹이 0건이면 그 머리글은 아예 안 나온다.

케이스 사이 순서와 블록 안 순서는 `runner` 가 준 순서 그대로다. 소비자가 재정렬하지 않는다.

한 케이스는 툴 하나만 부르므로 입력 계약 위반과 건너뜀이 같은 케이스에 함께 오지 않는다. 루트
스키마를 해석하지 못하면 그 툴의 입력 검사가 통째로 빠지기 때문이다(ADR-0015). 세 블록이 한
케이스에 다 나오는 출력은 존재하지 않는다.

코드를 종류로 가르는 표는 `SpecFindingCode` 전체를 키로 갖는다. 배열이나 부분 집합으로
두면 `runner` 가 코드를 늘렸을 때 새 코드가 조용히 한쪽 머리글로 흘러간다.

`--json` 은 갈라진 머리글과 무관하다(§7.3). 문장을 싣지 않으므로 나눌 이유가 없다.

판정과 exit code 는 바뀌지 않는다.

### 7.3 `--json`

`spec` 객체 아래에 구조로 담는다. 코드·caseId·path·severity 를 그대로 싣고 문장은 싣지 않는다.
문장은 사람이 읽는 출력의 것이고, 기계는 코드로 분기하면 된다. 지문 관련 필드는 손대지 않고
필드만 추가한다.

## 8. 결정론성

- 두 검사는 순수 함수이고 정렬이 이미 고정돼 있다.
- CLI 는 finding 을 재정렬하지 않는다. `caseId` 집합 필터만 적용한다.
- `listTools()` 결과 순서에 표시 순서가 의존하지 않는다. 표시 순서는 명세의 케이스 순서다.
- 타임스탬프와 난수는 쓰지 않는다.

## 9. 테스트

| 대상 | 내용 | 방식 |
|---|---|---|
| `runner` | `UNCONSTRAINED_SCHEMA` 제거 반영, `VACUOUS_*` 의 `path` 끝 키워드 계약 | 인메모리 |
| `generate` | 민감 키를 가진 숫자 필드가 있는 후보에서 `TYPE_MISMATCH` 가 나오지 않는다 | 인메모리 |
| `generate` | `specFindings` 두 필드가 각 검사 결과를 그대로 담는다 | 인메모리 |
| `cli` | 선택에서 뺀 케이스의 finding 은 세지 않는다 | 인메모리 |
| `cli` | blocking 이 있으면 확인이 하나 더 나온다. 없으면 나오지 않는다 | mock stdio E2E |
| `cli` | `listTools()` 실패 시 보고서에 추가 줄이 없다 | mock stdio E2E |
| `cli` | `--json` 에 finding 구조가 실린다 | 인메모리 |

`generate` 의 회귀 테스트가 이 설계의 핵심 근거다. 3절의 거짓 양성이 재발하면 그 테스트가
깨진다.

## 10. 범위 밖

- `byCodeUnit` 사본 3곳 정리(`assertions.ts`, `schema-match.ts`, `input-contract.ts`). 별도 PR.
- 중복 툴 이름일 때 `tools` 배열 순서가 결과를 바꾸는 문제. 별도 PR.
- 단계 3 의 dry run 승인 게이트.

## 11. ADR

다음 판단을 ADR-0018 로 남긴다.

- 검사를 `generate` 안(치환 이전)에서 돌린다는 결정과 그 근거(3절)
- 위반을 거부가 아니라 재확인으로 다룬다는 결정과 그 근거(6.3절)

## 12. 팀 규칙 관련

세 패키지를 한 PR 로 묶는다. 팀 `CLAUDE.md` 의 "한 번에 한 패키지만" 과 어긋나지만 사용자가
명시적으로 그렇게 정했다. 세 패키지가 모두 파트 ①(`runner`, `generate`)과 공용 `cli` 이므로
CONTRIBUTING §2.2 의 "한 PR 에서 여러 오너의 영역을 동시에 건드리지 않는다" 는 위반하지 않는다.
