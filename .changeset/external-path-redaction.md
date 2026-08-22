---
"@mcpeak/record": minor
---

**Breaking**: External 세션이 URL 경로를 더 이상 저장하지 않습니다(ADR-0053). 저장하는 표준
URL 필드 넷(요청 `display.url`, 저장 outcome의 `url`, `location`·`content-location` 헤더)에서
pathname 을 `<redacted>` 로 지웁니다. `location`·`content-location` 이 상대 참조(RFC 9110)여도
거부하지 않고 응답 URL 기준으로 절대 URL 로 해석한 뒤 같은 규칙을 적용합니다.

matchKey 계산에는 영향이 없습니다 — 정확한 pathname(매칭 재료)은 여전히 매칭에 쓰이고, 다만
자식 프로세스 밖으로 나가지 않습니다. `/hooks/AAA` 와 `/hooks/BBB` 는 여전히 다른 matchKey 를
냅니다. 그래서 이 개정 **이전에 만든 세션 파일도 Replay 는 계속 됩니다** — 다만 경로가 원문으로
남아 있으므로, README의 정리 절차(삭제 → 자격증명 재발급 → 재녹화)를 따르세요.

응답의 `redirect: "manual"` 로 받은 301·302·303·307·308 도 `Response.redirected` 값과 무관하게
거부합니다 — 그 응답의 `Location` 이 경로가 든 절대 URL 이라, 지우려던 경로가 응답 쪽으로
되돌아오는 구멍이었습니다.

`NormalizedExternalRequest` 의 `match` 필드가 없어지고 `schemaVersion` 은
`interactionSchemaVersion` 으로 개명됩니다. 둘 다 `@mcpeak/record/external` 의 공개 표면에는
없는 내부 타입이라 소비자(`cli`)에는 영향이 없습니다.

**진단이 약해지는 자리가 하나 있습니다.** replay miss·incomplete 메시지의 URL 이
`GET https://api.example.com/<redacted>` 까지만 말합니다. **경로로 자원을 가르는 API 는 miss 줄이
서로 같아집니다** — `/weather/seoul` 과 `/weather/busan` 이 둘 다 `https://api.example.com/<redacted>`
로 보입니다. 함께 표시되는 matchKey 로 구분해야 합니다. query 로 가르는 API(`?city=seoul`)는
query 가 남으므로 영향이 없습니다.

함께 고친 것들:

- **Coordinator 가 URL 오류를 500 으로 뭉개고 세션을 열어 두던 문제.** `runtime.mjs` 는 자식에서도
  돌아 `.ts` 를 import 할 수 없어 오류를 직접 만들어 썼는데, 그 값이 `ExternalRecordReplayError`
  의 인스턴스가 아니라서 부모의 분기를 빠져나갔습니다. 자격증명이 든 URL 처럼 재검사 도중 나는
  오류가 분류된 4xx 대신 `COORDINATOR_INTERNAL` 500 으로 나가고, ADR-0052 가 요구한 "불변식이
  깨지면 세션을 즉시 실패로 닫는다" 도 건너뛰었습니다. 오류 클래스를 `errors.mjs` 로 내려 부모와
  자식이 같은 인스턴스를 보게 했습니다.
- **`throw` 결과에 재구성이 없어 재검사가 항등식이던 문제.** `redactStoredOutcome` 이 response 가
  아닌 값을 입력 그대로 돌려주어 바이트 비교가 같은 참조끼리의 비교가 됐고, 자식이 실어 보낸
  낯선 필드가 검증 없이 저장됐습니다. 이제 두 갈래 다 알려진 필드만 옮겨 담습니다.
- **낯선 필드의 진단이 뒤바뀌던 문제.** 스키마에 없는 필드가 원인인데도 "민감 값 마스킹을
  놓쳤다" 는 문장이 나가, 사용자가 민감 키 목록 version 을 뒤지게 했습니다. 요청의 중첩
  `display` 와 저장 결과(`response`·`throw`) 모두 `unknown-field` 로 분류합니다.
- **재검사의 예외를 전부 위반으로 단정하던 문제.** 우리 쪽 실패까지 "자식과 부모의 build 가
  다르다" 로 나갔습니다. 이제 의도적으로 거절한 오류만 위반으로 분류하고 나머지는 그대로 올립니다.
- **전송 표현 헤더를 저장하던 문제.** `content-encoding`·`transfer-encoding`·`content-length` 는
  원래 전송 형태를 가리키는데 저장하는 body 는 이미 압축이 풀린 최종 바이트라, 재생 때 평문 body
  에 "gzip 이다" 라는 헤더가 붙어 나갔습니다.
