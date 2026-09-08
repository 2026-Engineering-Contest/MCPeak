# ADR-0086: 조합·참조·pattern 스키마는 갈래를 골라 합성하고 미지원 갈래만 건너뛴다

- 상태: 제안
- 날짜: 2026-09-08
- 담당: generate
- 작성자: @seodduu
- 참조: ADR-0004(생성 테스트의 자동화 범위), ADR-0015(입력 스키마 부분집합 경계),
  ADR-0036(미지원 스키마 툴의 부분 생성),
  `docs/2026-09-08-generate-스키마-키워드-확장-설계.md` §4·§5.5, 이슈 #389

## 배경

`generate` 의 `SUPPORTED_SCHEMA_KEYS` 에 없는 키가 하나라도 있으면 그 툴은 통째로 건너뛰어진다
(ADR-0036). 문제는 실제 SDK 가 내는 스키마가 그 목록 밖 키를 기본으로 붙인다는 것이다.
2026-09-08 실측에서 `@modelcontextprotocol/sdk@1.30.0` + `zod@4.4.3` 은 `.strict()` 에
`additionalProperties: false`, `z.string().regex` 에 `pattern`, `nullable`·`union` 에 `anyOf`,
`discriminatedUnion` 에 `oneOf`, 중첩·재귀 모델에 draft-07 의 `definitions` + `$ref` 를 냈다.
pydantic v2 는 같은 자리에 `$defs` 를 쓴다. 이슈 #389 의 재현 예는 `additionalProperties: false`
한 줄로 툴 하나짜리 서버의 생성이 0 이 되는 경우다.

`docs/adoption.md` §1.4.3 의 2026-08-17 실측도 같은 방향이다. `mcp-server-git` 은 루트 `anyOf`
(`[{ required: ["a"] }, { required: ["b", "c"] }]` 꼴)로 3툴을 잃었다. 이 꼴은 갈래에 `type` 이
없고 바깥 스키마와 합쳐야 뜻이 되므로, 갈래를 그냥 읽는 것만으로는 값을 만들 수 없다.

즉 남은 선택은 "이 키워드들을 어떻게 읽을 것인가" 이고, 읽는 방식마다 결정론성과 오해 위험이
다르게 걸린다. 무시하는 길은 이미 막혀 있다. `runner` 가 `additionalProperties === false` 를
`rejectsUndeclared` 로 읽고 있어서, `generate` 만 무시하면 두 패키지의 입력 계약 해석이 갈린다.

## 선택지

키워드별로 갈린 판단이라 항목마다 적는다. 각 줄의 뒤쪽이 기각한 대안이다.

- **키워드 추가 위치.** `SUPPORTED_SCHEMA_KEYS` 뒤에 `additionalProperties`, `pattern`, `$ref`,
  `$defs`, `definitions`, `anyOf`, `oneOf` 순으로 덧붙인다. 삽입 순서가 그대로 실패 문장의 hint
  가 되기 때문이다. 앞에 끼우는 안은 기각한다. `"description, title, $schema"` 단언이 깨진다.
- **`additionalProperties`.** boolean 과 스키마 객체를 모두 받는다. 합성값은 선언된 `required`
  만 넣으므로 어느 값이든 결과가 같다. 다만 후보값(`const`·`default`·`examples`)은 `false` 일 때
  선언 밖 키가 있으면 후보 불만족으로 거절한다. 무시하는 안은 위의 해석 분기 때문에 기각한다.
- **`pattern`.** ECMA-262 부분집합을 파싱해 최소 문자열을 만든다. 알려진 `format` 값이 있으면
  그것을 먼저 쓰고 `pattern` 으로 검증만 한다. 부분집합 밖 구문은 그 툴만 건너뛴다. "후보값이
  있을 때만 허용" 하는 안은 이슈의 재현 예(`z.string().regex`)를 그대로 막으므로 기각한다.
- **`$ref`.** `#` 로 시작하는 JSON Pointer 만 받고 대상은 루트 스키마에서 찾는다. 형제 키워드는
  대상과 병합한다. draft-07 규칙대로 형제를 무시하는 안은 기각한다. pydantic 이 `$ref` 옆에
  `default` 를 붙이는데 그것을 버리면 후보 우선순위가 깨진다.
- **`anyOf` / `oneOf`.** 선언 순서대로 갈래를 바깥 스키마와 병합해, 합성에 처음 성공하는 갈래를
  쓴다. `oneOf` 는 그 값이 정확히 한 갈래만 만족하는지 추가로 검증한다. null 갈래를 피하는 식의
  선호 규칙은 기각한다. 근거 없는 매직 규칙이고 zod·pydantic 은 어차피 non-null 을 앞에 둔다.
- **미지원 갈래.** 갈래 하나가 `UNSUPPORTED_SCHEMA` 면 다음 갈래로 간다. 전부 실패하면 첫
  갈래의 원인으로 그 툴을 건너뛴다. 갈래 하나라도 못 읽으면 툴을 거절하는 안은 `anyOf` 의
  뜻(어느 하나) 에 어긋나므로 기각한다.
- **순환.** 검증은 활성 경로에 있는 참조 대상을 다시 만나면 조용히 멈춘다(이미 위에서 검증
  중이다). 합성은 필수 경로에서 다시 만나면 `UNSUPPORTED_SCHEMA` 다. 깊이 상한 숫자는
  기각한다. 근거 없는 매직넘버이고, 유한 스키마는 순환 탐지만으로 종료된다.
- **값 출처.** `pattern` 이 있는 문자열은 `declared`, 조합은 합성이 고른 갈래의 출처를
  물려받는다. 새 출처 값을 만드는 안은 기각한다. `ValueProvenance` 는 `cli` 가 소비하는 공개
  타입이라 다른 패키지 작업이 된다.
- **부분 생성.** ADR-0036 을 그대로 둔다. 새 오류는 전부 `UNSUPPORTED_SCHEMA`(툴 단위) 또는
  `INVALID_SCHEMA_CONSTRAINT`(전체 중단) 둘 중 하나로만 낸다. 새 오류 코드를 만드는 안은
  기각한다. `cli` 가 코드 문자열로 분기하므로 코드를 늘리면 다른 패키지 작업이 된다.

## 결정

`additionalProperties`·`pattern`·로컬 `$ref`(`$defs`·`definitions`)·`anyOf`/`oneOf` 를 지원
목록에 넣고, 위 선택지에 적은 규칙대로 읽는다. 어느 키워드도 무시하지 않는다.

조합과 참조는 한 가지 장치로 처리한다. 바깥 스키마에서 조합 키 하나를 풀어 갈래(또는 `$ref`
대상)와 AND 로 병합한 뒤, 그 결과를 다시 합성기에 넘긴다. 병합 표는 설계 §5.5 가 전량 갖는다.
요지는 `required` 합집합, 하한은 큰 값, 상한은 작은 값, `enum` 은 교집합, `type`·`const`·
`format`·`pattern` 은 같을 때만 허용, `default`·`examples` 는 다르면 바깥을 남기는 것이다.
병합 충돌은 그 갈래를 목록에서 빼는 것으로 처리하고, 전부 빠지면 첫 충돌을 오류로 낸다.

선택은 전부 "선언 순서의 첫 번째" 또는 "최소" 다. 갈래는 선언 순서, `pattern` 문자열은 최소
길이, 길이 채움은 왼쪽 수량자부터다. 같은 입력의 `baselineFingerprint` 는 두 번 돌려도 같다.

기존 지원 툴의 출력 바이트는 바뀌지 않으므로 `BASELINE_POLICY_VERSION` 은 올리지 않는다.

## 이유

- 무시가 선택지에서 빠지는 이유는 해석 분기다. `runner` 가 이미 `additionalProperties: false`
  를 읽고 있어서, `generate` 가 무시하면 같은 스키마를 두 패키지가 다르게 읽는다. ADR-0004 가
  세운 원칙("모르는 제약으로 값을 합성하지 않는다")도 그대로 유지된다.
- 갈래 단위 건너뜀은 ADR-0036 의 연장이다. 그 ADR 이 실패 반경을 서버에서 툴로 줄였고, 이
  문서는 같은 논리로 툴에서 갈래까지 줄인다. 키워드 하나의 무지가 툴 전체의 무지가 될 이유가
  없듯이, 갈래 하나의 무지가 조합 전체의 무지가 될 이유도 없다.
- 병합을 택한 것은 실측 때문이다. 루트 `anyOf` 갈래에 `type` 이 없는 꼴(`mcp-server-git`)은
  바깥과 합쳐야 뜻이 되고, `$ref` 옆의 `default`(pydantic)는 버리면 후보 우선순위가 깨진다.
  둘 다 병합이라는 같은 장치로 풀린다.
- 선호 규칙과 깊이 상한을 뺀 것은 결정론성 때문이다. 근거 없는 규칙은 스키마가 조금만 달라져도
  다른 값을 내고, 그 차이를 문서로 설명할 수 없다.

## 결과

- `.strict()`·`regex`·`nullable`·중첩 모델을 쓰는 실제 zod·pydantic 서버에서 정상 케이스가
  만들어진다. 이슈 #389 의 재현 예는 `{ x: "example" }` 을 낸다.
- **`runner` 는 이 필드의 위반 축을 만들지 않는다(ADR-0015).** `analyzeInputSchema` 는 필드에
  `anyOf`·`$ref` 가 있으면 그 필드의 해석을, 루트에 있으면 툴 전체의 해석을 포기한다. 그래서
  필드 `anyOf` 는 `REQUIRED_OMITTED` 축만 남고 `TYPE`·`ENUM`·`RANGE` 축이 없으며, 루트 `anyOf`
  는 커버리지에 `analyzable: false` 로 실려 정상 케이스만 생긴다. 이 문서는 그 결정을 바꾸지
  않고 결과로 받아들인다. 정상 케이스가 0 이던 툴이 1 이 되는 것이 이번 목표다.
- **`UNDECLARED_FIELD` 축은 후속이다.** `additionalProperties: false` 서버가 선언 밖 필드를
  실제로 거절하는지 검증하려면 `ContractAxisKind` 에 축을 더해야 하는데, 그것은 `runner` 오너
  작업이라 별도 이슈로 연다.
- 미지원 목록이 줄어든 만큼 ADR-0004 의 「자동 생성하지 않는 범위」를 함께 개정한다. 남는 것은
  `allOf`·`not`·`if`·`patternProperties`·`propertyNames`·배열 `type`·튜플 `items`·원격 `$ref`
  다.
- `pattern` 이 만든 최소 문자열은 규칙은 지키지만 도메인 값으로 약할 수 있다(`^[a-z]+$` 에서
  `"a"`). 출처가 `declared` 라 AI 사전보완이 덮어쓰지 못하므로, dry run 실패 분류에서 사후수리가
  이어받는 현재 경로로 충분한지 실측 뒤 다시 본다.

### 2026-09-08 개정 (#428)

위 후속을 정한다. **`pattern` 만 있는 문자열의 출처를 `placeholder` 로 내린다.** 새 출처 값은
만들지 않는다. 위 「선택지」의 값 출처 항목이 그 안을 이미 기각했고(`ValueProvenance` 는 `cli` 가
소비하는 공개 타입이다), 그 제약과 양립하는 갈래는 이것뿐이다.

- `^[a-z]+$` 가 만드는 `"a"` 는 규칙은 지키지만 도메인 값으로 약하다. `declared` 로 세면 AI
  사전보완이 그 필드를 대상에서 빼므로 약한 값이 그대로 나간다.
- 같은 날 실측(`docs/adoption.md` §1.6)에서 정상 케이스 실패는 전부 "규칙은 맞지만 도메인이 틀린
  값" 이었다. `mcp-server-git` 의 `repo_path: "example"` 이 그것이다. `pattern` 파생값은 그 계열과
  같은 위험을 가지면서 근거만 강하게 표시돼 있었다.
- `placeholder` 로 내리면 AI 가 덮을 수 있다. 덮은 값이 `pattern` 을 어기면 후보 검사
  (`valueMatchesSchema` 의 `pattern` 검사)가 걸러 준다. 우리 규칙이 뚫리지 않는다.
- 잃는 것은 "선언된 규칙을 따랐다" 는 정보다. 비용은 `pattern` 필드가 있는 툴이 AI 사전보완 대상에
  들어가는 것이다.
- `format` 과 `pattern` 이 함께 있고 format 값이 그 `pattern` 을 통과하는 경우는 종전대로
  `declared` 다. `isKnownFormat` 분기가 먼저 돌기 때문이다. 바뀌는 것은 `pattern` 만 있는 경우다.

길이 제약만 있는 문자열도 같은 의심을 받을 수 있으나 실측 없이 바꾸지 않는다.

### 2026-09-08 개정 (#427)

위 「`UNDECLARED_FIELD` 축은 후속이다」 항목이 닫혔다. `runner` 가 축을 냈고(#427, ADR-0015),
`generate` 는 `additionalProperties: false` 인 툴에 선언 밖 키 하나를 얹은 거절 기대 케이스를
하나 만든다. 키는 예약 문자열이고 서버가 그 이름을 선언했으면 접미사로 피한다. 값은 가장 평범한
문자열(`"example"`)이다. 값이 이상하면 서버가 "선언 밖 키" 가 아니라 "이상한 값" 때문에 거절할 수
있고, 그러면 케이스가 통과해도 무엇을 검증한 것인지 알 수 없다.

`BASELINE_POLICY_VERSION` 은 올리지 않는다. 이 상수는 배포된 baseline 이 조용히 바뀌는 것을 막는
장치인데, 새 축과 nullable 해석(#426)의 영향을 받는 툴은 전부 #423 전에는 생성 자체가 되지 않던
것들이고 #423 은 아직 배포되지 않았다. 바뀌는 배포본이 없다.
