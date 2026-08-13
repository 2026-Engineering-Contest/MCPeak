---
"@ohmymcp/runner": minor
---

명세를 서버에 돌리기 전에 종이 위에서 검사하는 순수 함수 세 개를 추가합니다. 서버를 호출하지
않습니다.

`checkInputContract({ suite, tools })` 는 명세의 `callTool` 입력을 서버가 선언한
`inputSchema` 와 대조합니다. 필수 필드 누락, 선언에 없는 필드, 타입 불일치, enum 밖 값을
찾고, 이름이 비슷한 후보가 있으면 함께 알려줍니다. 지금까지는 오타 하나짜리 명세도 서버를
띄워 실행한 뒤에 `isError false 를 기대했지만 true 를 받았습니다` 로만 드러나서, 서버가
고장난 것인지 명세가 틀린 것인지 구분할 수 없었습니다.

`checkAssertionSubstance(suite)` 는 통과가 보장된 단언을 찾습니다. `minLength: 0` 처럼 모든
값이 통과하는 키워드가 그렇습니다. 이런 단언은 초록불을 켜지만 아무것도 검증하지 않습니다.

`describeSpecFinding(finding)` 이 사용자에게 보여줄 문장을 만듭니다. 소비자가 문안을 각자
짓지 않도록 한 곳에 둡니다.

해석하지 못하는 서버 스키마에는 침묵합니다. `ToolDef.inputSchema` 는 우리가 통제하지 않는
임의의 JSON Schema 라서, `anyOf` 같은 조합자를 무시하고 `properties` 만 보면 맞는 명세를
위반으로 잡게 됩니다. 그런 스키마에는 `SCHEMA_NOT_ANALYZABLE` 하나만 내고 그 툴의 입력 검사를
건너뜁니다. 자세한 근거는 ADR-0015 에 있습니다.

아직 어느 명령에도 연결돼 있지 않습니다. `ohmymcp` CLI 의 동작은 이전과 같습니다.
