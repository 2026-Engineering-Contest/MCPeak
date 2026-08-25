# ADR-0082: runner 의 민감 키 판정을 record 와 같은 접미 단어열 규칙으로 맞춘다

- 상태: 제안
- 날짜: 2026-08-25
- 담당: runner
- 작성자: @seodduu (① MCP 서버 테스트 파트)
- 참조: [#183](https://github.com/2026-Engineering-Contest/MCPeak/issues/183),
  ADR-0039 · ADR-0045 (record 의 규칙), ADR-0033 (E3 방식),
  `packages/runner/src/sanitization.ts`, `packages/runner/src/determinism.ts`,
  `packages/record/src/shared/sensitive-keys.mjs`

## 배경

#183 은 `--determinism` 비교 표시값에 redaction 이 안 걸린다는 보고였다. 원인은 두 겹이었다.

**첫째, 순서.** `formatValue` 가 값을 `canonicalJson` 으로 **문자열로 만든 뒤** 마스킹했다.
키 기반 판정은 객체 구조에서만 되므로, 문자열이 된 시점에는 `sessionToken` 이라는 키가 이미
없다. 남는 방어는 `sensitiveValues` 정확 일치뿐인데 서버가 실행마다 새로 발급하는 값은 미리
알 수 없다. 이 부분은 판단이 아니라 결함이라 이 ADR 의 대상이 아니다. 순서를 바꿨다.

**둘째, 규칙이 두 벌.** 순서를 고쳐도 이슈가 든 예시 `sessionToken` 은 여전히 새는 것을
테스트로 확인했다. runner 의 `DEFAULT_SENSITIVE_KEYS` 는 `normalizeSensitiveKey` 를 거친
**정확 일치**였다. `sessiontoken` 은 목록에 없다. 같은 저장소의 record 는 ADR-0039·0045 로
**접미 단어열 일치**를 채택해 `sessionToken` · `X-Api-Key` · `privateKey` 를 가린다.

| 키 | runner (정확 일치) | record (접미 단어열) |
|---|---|---|
| `token` | 마스킹 | 마스킹 |
| `sessionToken` · `bearerToken` | 통과 | 마스킹 |
| `X-Api-Key` | 통과 | 마스킹 |
| `privateKey` · `secretKey` | 통과 | 마스킹 |
| `tokens` · `cookies` | 통과 | 마스킹 |
| `tokenCount` · `passwordPolicy` | 통과 | 통과 |

이것은 `--determinism` 만의 문제가 아니다. `sanitizeJsonValue` 와 `redactByPath` 를 쓰는
runner 의 **모든 단언 진단**이 같은 목록을 쓴다. 같은 서버 응답이 카세트에서는 가려지고 실패
메시지에는 원문으로 찍힌다. #165 가 지적한 "규칙이 두 벌" 문제의 반복이다.

## 선택지

1. **runner 의 규칙을 record 와 같게 맞춘다.** 접미 단어열 일치 + 복수형 흡수 + 목록 항목 동기화.
   알고리즘은 사본으로 둔다(의존 방향이 `runner` → `core` 뿐이라 record 를 import 할 수 없다).
2. **runner 목록에 항목만 더한다.** `sessiontoken` · `bearertoken` … 을 열거한다. 규칙은 정확
   일치 그대로.
3. **공통 패키지를 만든다.** `core` 에 민감 키 모듈을 두고 runner 와 record 가 함께 쓴다.
4. **아무것도 안 한다.** 순서 교정만 하고 `sessionToken` 은 새는 채로 둔다.

## 결정

**선택지 1 을 고른다.**

- `packages/runner/src/sanitization.ts` 에 `isSensitiveKey(keys, key)` 를 두고, 판정을
  `keys.has(normalizeSensitiveKey(key))` 에서 이 함수로 바꾼다. 알고리즘은 record 의
  `sensitiveKeyIn` 과 같다. 카멜케이스·구분자로 쪼개고, 꼬리 숫자를 떼고, 뒤에서부터 이어붙인
  조합이 목록과 정확히 일치하면 민감이다. 조합이 `s` 로 끝나면 `s` 를 뗀 형태도 조회한다.
- `DEFAULT_SENSITIVE_KEYS` 에 ADR-0045 항목(`privatekey` · `secretkey` · `signingkey` ·
  `sessionkey` · `credential`)을 더한다. `clientsecret` 은 record 에 없지만 남긴다.
  `clientSecret` 은 접미 `secret` 으로 이미 걸려 판정이 달라지지 않는다.
- `redactByPath`(조상 키 판정)도 같은 함수를 쓴다.
- `determinism.ts` 의 `formatValue` 는 `redactByPath` 로 **구조화된 값을 먼저 가리고** 그 뒤에
  `canonicalJson` 으로 문자열화한다. 첫 차이 지점까지의 조상 키를 순회 중에 모아 넘긴다.
- 사용자 정의 목록(`sensitiveKeys` 옵션)도 같은 규칙으로 판정한다. `tenantId` 를 넘기면
  `legacyTenantId` 는 걸리고 `tenantIdCount` 는 통과한다.

## 이유

**같은 응답은 같은 자리에서 같은 값이어야 한다.** 카세트와 실패 메시지가 다르게 가리면
사용자는 어느 쪽을 믿을지 모른다. 규칙이 두 벌인 채 각자 고쳐지면 #165 · #183 이 반복된다.

**선택지 2 를 버린 이유.** 열거는 언제나 하나 모자란다. ADR-0039 가 `X-Api-Key` 때문에
`apikey` 를 열거했고, ADR-0045 가 `secretKey` 때문에 또 열거했다. 같은 구멍이 세 번째 반복되는
것이다. 그리고 항목을 늘리면서 정확 일치를 유지해도 복수형(`tokens`)은 여전히 안 걸린다.

**선택지 3 을 지금 안 하는 이유.** `core` 는 트랜스포트·프로세스 층이라 마스킹 정책이 들어갈
자리가 아니다. record 는 자식 프로세스가 `--import` 로 로드하는 순수 ESM(`.mjs`)이 필요해
어차피 자기 사본을 가져야 한다. 사본 두 벌을 한 벌로 줄이는 것은 이득이 작고 두 파트의 빌드
경계를 건드린다. 사본이 갈라지는 것은 **양쪽 테스트가 같은 표를 보게** 해서 막는다.

**선택지 4 를 버린 이유.** 설계 문서와 타입 주석이 "redaction 이 적용된다" 고 적고 있다. 실제로
안 되는데 된다고 적혀 있으면 사용자는 `--determinism` 출력을 CI 로그에 안심하고 남긴다. 아무
보증이 없는 것보다 나쁘다.

## 결과

- **실패 메시지 내용이 바뀐다.** runner 의 모든 진단에서 `sessionToken` · `X-Api-Key` ·
  `privateKey` · 복수형이 새로 가려진다. 반대로 새로 통과하는 항목은 없다. 정확 일치가 가리던
  키는 접미 규칙에서도 마지막 조합이 그 키 자체이므로 전부 그대로 걸린다.
- 공개 API 는 그대로다. `DEFAULT_SENSITIVE_KEYS` 의 항목이 늘어나고 `isSensitiveKey` 가 새로
  export 된다. `normalizeSensitiveKey` 는 사용자 정의 목록 항목을 정규화하는 데 계속 쓴다.
- `generate` 는 runner 의 `DEFAULT_SENSITIVE_KEYS` 를 가져다 **자기 정확 일치**로 판정한다
  (`packages/generate/src/redaction.ts`, `authoring-request.ts`). 목록 확장은 그대로 받지만
  규칙은 여전히 다르다. 같은 파트 소유지만 다른 패키지라 이 ADR 에서 고치지 않는다. 후속 이슈로
  연다.
- **가리지 못하는 자리가 남는다.** 서버가 결과를 JSON 으로 직렬화해 text 블록 문자열 하나로
  싣는 형태(`content[0].text`)가 그렇다. 비밀값은 그 문자열 **안**에 있고 경로상의 키는 `text`
  뿐이라 키 기반 판정이 닿지 않는다. 실서버의 기본 응답 형태가 정확히 이것이다. ADR-0033 의
  E3(치환 대신 명시)를 따라 `--determinism` 안내 문구에 이 한계를 적어야 한다. `cli` 작업이라
  별도 커밋이다.
- 사용자 정의 목록의 판정 규칙이 바뀐다. `sensitiveKeys: ["id"]` 처럼 짧은 단어를 넘기던
  사용자는 `userId` · `sessionId` 가 새로 걸린다. 접미 규칙의 의도된 동작이다.
