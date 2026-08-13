# 코드 리뷰 결함 7건 수정 보고

## 실행 환경

```
$ pwd
/Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-body-fix

$ git rev-parse HEAD
395f66fca3173ee93a1250e291569b162bd8308d
```

브랜치 `feat/runner-body-assertion`. git 명령은 조회만 했고 커밋·머지·푸시는 실행하지 않았다.

## 변경 파일

```
 M packages/runner/src/body.ts
 M packages/runner/src/diagnostics.ts
 M packages/runner/src/sanitization.ts
 M packages/runner/src/spec/validation.ts
 M packages/runner/tests/body.test.ts
 M packages/runner/tests/executor.test.ts
?? packages/runner/tests/body-fix-regressions.test.ts
?? docs/reports/task-fix.md
```

`packages/runner` 밖은 건드리지 않았다. `packages/cli` 무변경.
`packages/runner/src/index.ts` 는 고칠 필요가 없었다. 결함 5의 새 실패 코드는
`BodyExtractionFailure` 유니온 안에 들어가고 그 타입은 이미 재수출돼 있다.

재현 테스트는 `packages/runner/tests/body-fix-regressions.test.ts` 한 파일에 결함 번호별
describe로 모았다. 21개다. 구현 전에 실행해 19개 실패를 확인했다(2개는 정상 동작을 고정하는
대조군이라 처음부터 통과한다).

## 결함별 재현과 수정

### 1. (high, 회귀) 프로토타입 키가 `ALLOWED_ASSERTIONS` 를 뚫는다

**재현** `operation.type` 이 `"toString"` / `"constructor"` / `"valueOf"` /
`"hasOwnProperty"` 인 스위트를 `validateMcpSuite` 에 넘긴다. 객체 리터럴 색인이 프로토타입의
함수를 집어 `allowed.includes` 가 `TypeError` 를 던졌다.

**수정** `ALLOWED_ASSERTIONS` 를 `Map` 으로 바꾸고 `.get(kind)` 을 쓴다. 같은 패턴을 찾아
`KEYWORD_TYPES` 도 `Map` 으로 바꿨다. 이쪽은 색인 키가 우리 목록에서만 오므로 실제 취약점은
아니었지만 같은 종류의 실수를 다시 못 하게 막았다. `validateResponseSchema` 의 `type` 과
키워드 존재 판정도 `in` 대신 `Object.hasOwn` 으로 바꿨다.

**확인** 빌드 산출물로도 확인했다.

```
$ node -e '... m.validateMcpSuite(suite) ...'
NO THROW: ["INVALID_VALUE","INCOMPATIBLE_ASSERTION"]
```

변경 전 코드와 같은 이슈(`INCOMPATIBLE_ASSERTION`)를 낸다.

### 2. (medium) `CONST` 와 `ENUM` 이 차이를 안 보여준다

**재현** `expected` `{city:"서울",temp:21}`, `actual` `{city:"서울",temp:22}` 인
`CONST_MISMATCH` 의 문장이 양쪽 모두 `{"kind":"object","keys":2}` 였다.

**수정** 이 두 코드에 한해 객체와 배열을 요약하지 않고 compact JSON 으로 적는다
(`structuralValue`). 상한을 넘으면 JSON 을 자르고 말줄임과 원본 길이를 붙인다.
문자열은 따옴표를 뺀 원본 길이 기준으로 자른다. 요약 경로와 기준이 달라지면 보고서의
`actualChars` 와 잘린 값이 어긋나기 때문이다.

이제 문장이 이렇게 나온다.

```
$: 값이 다릅니다. 기대: {"city":"서울","temp":21}, 실제: {"city":"서울","temp":22}
$.hourly: 기대한 값 중 하나가 아닙니다. 기대: [1,2] | [3], 실제: [9]
```

### 3. (medium) 중첩 경로와 배열 경로에서 민감값이 샌다

**재현** 본문 `{"token":{"value":"sk-abc"}}` 의 `$.token.value` 위반에서 `sk-abc` 가 평문으로
남았다. `sanitizeValue` 는 객체의 직속 키만 보는데 `summarizeValue` 는 `{ [leafKey]: value }`
로 한 겹만 감쌌기 때문이다. `$.items[0]` 처럼 배열 인덱스로 끝나는 경로는 `leafKey` 가
`undefined` 라 키 기반 마스킹이 아예 걸리지 않았다.

**수정** `leafKey` 를 버리고 `pathKeys` 로 위반 경로의 **조상 키 전부**를 모은다. 그중 하나라도
민감 키면 값을 통째로 `[REDACTED]` 로 만든다(`redactByPath`). 배열 인덱스는 건너뛰므로
`$.credentials[0].id` 도 `credentials` 를 본다.

### 4. (medium) 영원히 초록인 스키마

**재현** `"schema": {}` 와 `{"type":"object","properties":{}}` 가 검증을 통과했다.

**수정** 지시대로 새 이슈 코드를 만들지 않고 `INVALID_VALUE` 로 내되 문안을 전용으로 썼다.
세 자리를 막는다.

- 키워드가 하나도 없는 스키마: `스키마가 비어 있어 검사할 제약이 없습니다.`
  힌트에 지원 키워드 목록 전체를 넣었다. 중첩된 `{}` 도 같은 순회에서 잡힌다.
- `properties: {}`: `properties가 비어 있어 검사할 필드가 없습니다.`
- `required: []`: `required가 비어 있어 검사할 필드가 없습니다.`

### 5. (low) `text` 필드 문제를 블록 `type` 문제로 보고한다

**재현** `[{type:"text"}]` 와 `[{type:"text",text:42}]` 가
`content 블록이 text가 아닙니다. 실제 type: undefined` 를 냈다. 블록 `type` 은 실제로 `text` 다.

**수정** `BodyExtractionFailure` 에 `CONTENT_TEXT_MISSING` 을 더하고 전용 문안을 만들었다.

```
응답에서 검사할 본문을 정할 수 없습니다. content 블록의 text 필드가 문자열이 아닙니다. 실제 타입: number
힌트: 서버가 text 블록의 text에 문자열을 넣는지 확인하세요.
```

기존 `body.test.ts` 의 해당 케이스를 새 코드로 갱신했다.

### 6. (low) `__proto__` 키가 사라진다

**재현** `JSON.parse('{"__proto__":"oops"}')` 를 `additionalProperties: {type:"number"}` 로
검사하면 위반의 `actual` 이 `object (키 0개)` 로 찍혔다. 원래 값은 문자열 `"oops"` 다.

**수정** 두 자리를 고쳤다. `summarizeValue` 의 `{ [key]: value }` 감싸기는 결함 3 수정으로
사라졌다. 남은 `sanitizeValue` 의 `copy[key] = ...` 는 `Object.defineProperty` 로 바꿨다.
`copy["__proto__"] = x` 는 `Object.prototype` 세터를 건드려 자기 속성을 만들지 못한다.

### 7. (low) 문자열 렌더가 이스케이프와 말줄임을 안 한다

**재현** `actual` 이 `깨\n"짐"` 이면 문장에 실제 개행과 따옴표가 그대로 들어가 줄이 깨졌다.
812자 문자열을 200자로 자른 뒤에도 잘렸다는 표시가 없었다.

**수정** `renderValue` 를 `JSON.stringify` 기반으로 바꿨다. 잘린 값에는
`…(총 812자)` 를 붙인다.

## 검증 명령과 출력

```
$ pnpm vitest run packages/runner/tests/body-fix-regressions.test.ts   # 구현 전
 Test Files  1 failed (1)
      Tests  19 failed | 2 passed (21)

$ pnpm vitest run packages/runner                                      # 구현 후
 Test Files  11 passed (11)
      Tests  198 passed (198)
```

2회 실행 모두 `198 passed` 로 동일했다.

```
$ pnpm build
 Tasks:    6 successful, 6 total

$ pnpm typecheck
 Tasks:    6 successful, 6 total

$ pnpm lint
> biome check .
Checked 113 files in 22ms. No fixes applied.

$ pnpm test
 Test Files  33 passed (33)
      Tests  497 passed | 1 skipped (498)

$ node packages/cli/tests/dist-cli-e2e.mjs
E2E EXIT 0
```

린트는 첫 실행에서 포맷 3건과 미사용 import 1건이 걸려 해당 파일만 고쳤다.
전체 테스트는 이전 476에서 재현 테스트 21개가 늘어 497이다.

E2E 는 `pnpm build` 뒤에 돌렸고 종료 코드 0 이다. 이 스크립트가 고정한
`$.temperature: 필수 필드가 없습니다. 발견된 필드: 'city', 'condition', 'temp'` 문장과
`bodyMatchesSchema` 가 없는 기존 스위트의 보고서 바이트 회귀 테스트가 모두 그대로 통과한다.

## 내가 임의로 판단한 부분

1. **결함 2에서 보고서 필드와 문장의 관계.** compact JSON 이 상한 이하이면 `expected` 와
   `actual` 에 구조를 그대로 담고, 상한을 넘으면 잘린 JSON 텍스트를 담고 `actualChars` 에 원본
   JSON 길이를 넣는다. 잘린 JSON 은 더 이상 그 값이 아니므로 구조인 척하지 않는 편이 정직하다고
   봤다. 상한은 그대로 유지돼 설계 문서 §8.4 의 "위반 하나 1KB 미만" 이 깨지지 않는다.

2. **결함 3에서 민감 판정의 범위를 "조상 키 중 하나라도" 로 잡았다.** 지시가 그렇고, 반대로
   가면(마지막 키만) 원래 결함이 그대로 남는다. 부작용은 `token` 아래 전부가 가려지는 것인데
   민감 데이터에서는 과하게 가리는 쪽이 맞다.

3. **결함 4에서 `required: []` 도 함께 거부했다.** 지시에 명시되지 않았지만 `properties: {}` 와
   완전히 같은 부류다. 빈 `required` 는 어떤 응답에도 위반을 내지 않는다. 이것 때문에
   `executor.test.ts` 의 `schemaOf` 헬퍼가 빈 값을 넣던 것을 고쳤다.

4. **결함 4에서 `{"type":"object"}` 는 계속 허용한다.** 리뷰 지시는 `{}` 와
   `{"type":"object","properties":{}}` 를 예로 들었다. `type` 만 있는 스키마는 응답이 객체가
   아닐 때 실제로 위반을 내므로 영원히 초록이 아니다. 이것까지 막으면 기존 스위트와 계획서의
   유효 예시가 대량으로 깨진다. 판정 기준을 "키워드가 하나도 없거나, 컨테이너 키워드가 비어
   있음" 으로 잡은 이유다.

5. **공개 JSON Schema(`MCP_SUITE_JSON_SCHEMA`)에는 결함 4의 규칙을 넣지 않았다.**
   `minProperties` / `minItems` 를 `responseSchema` 에 넣어야 하는데 parity 평가기가
   `minProperties` 를 모른다. 넣으면 `spec-schema.test.ts` 의 대조가 평가기 쪽에서 깨진다.
   설계 문서 §10.5 가 이미 같은 이유로 타입 짝 요구를 공개 스키마에서 뺐다. 지금은 validator
   전용 규칙이며, 필요하면 평가기 범위를 넓히는 별도 작업으로 다루는 것이 맞다고 본다.
   판단이 필요하면 알려달라.

6. **재현 테스트를 한 파일에 모았다.** 결함 번호별 describe 라 다음에 회귀가 나면 어느 결함이
   되살아났는지 바로 보인다. 기존 테스트 파일에 흩어 놓는 것보다 낫다고 봤다.

7. **`validateResponseSchema` 의 나머지 `in` 연산자는 그대로 뒀다.** `"const" in value` 처럼
   고정 리터럴 키로 사용자 객체를 보는 자리인데, 그 이름들이 `Object.prototype` 멤버가 아니라
   동작이 같다. `type` 과 `KEYWORD_TYPES` 순회만 `Object.hasOwn` 으로 바꿨다. 전면 교체는
   변경 폭만 키우고 얻는 것이 없다고 판단했다.

## 계약 관련 확인 사항

- `core/src/types.ts` 무변경. 의존성 추가 없음. sdk 버전 변경 없음.
- 의존 방향 그대로다. `diagnostics.ts` 는 `sanitization.ts` 와 `schema-match.ts` 만 더 참조한다.
- 결함 4와 5로 공개 계약이 넓어졌다. `bodyMatchesSchema` 가 없는 기존 스위트의 보고서 바이트
  회귀 테스트는 그대로 통과한다.
- E2E 단언 문장은 바뀌지 않았다. 결함 2와 7의 문안 변경은 `REQUIRED_MISSING` 문장에 영향이 없다.
- 유닛테스트는 인메모리 값과 `fixtures/` 만 쓴다.
