---
"@ohmymcp/runner": minor
---

`RunnerReport` 를 JUnit XML 로 그리는 `renderJUnit(report, options?)` 을 추가합니다. CI 가 테스트
결과를 화면에 렌더하려면 이 포맷이 필요합니다. CONTRIBUTING §2.1 이 JUnit XML 을 `runner` 책임으로
규정하고, CLI 보고서 렌더링 설계 §9.3 이 `junit.ts` 자리를 열어 둔 것을 채웁니다.

`renderReport` 와 같은 순수성 경계를 지킵니다 — `process` · `Date` · 로케일 · 난수를 읽지 않으므로
같은 보고서는 항상 같은 바이트를 냅니다.

케이스 상태는 JUnit 관례대로 나눕니다. 단언이 틀린 경우는 `<failure>`, 작업이 실행되지 못한 경우
(작업 실패 · 시간 초과)는 `<error>`, `cancelled` 와 `notRun` 은 `<skipped/>` 입니다. CI 화면에서
"서버가 죽었다" 와 "응답이 다르다" 가 구별됩니다. 실패 본문에는 `diagnostics.ts` 가 만든 문장을
그대로 싣고 `expected` · `actual` · 스키마 위반 목록 · `hint` 를 함께 담습니다.

서버 응답 문자열이 그대로 XML 에 들어가므로 두 단계를 거칩니다. `&` `<` `>` `"` 는 이스케이프하고,
XML 1.0 이 허용하지 않는 제어문자와 짝 없는 서로게이트는 제거합니다. 후자는 수치 참조로도 담을 수
없어 제거가 유일한 방법이며, 빠뜨리면 서버가 뱉은 제어문자 하나로 리포트 파일 전체가 파싱 불가가
됩니다.

`time` 속성은 항상 `0` 입니다. `RunnerReport` 는 결정론성을 위해 시간 필드를 갖지 않으므로
`0` 은 "0초 걸렸다" 가 아니라 "시간 정보가 없다" 의 표현입니다. 실제 경과 시간이 필요해지면
`RunnerReport` 를 바꾸지 않고 `JUnitRenderOptions` 를 확장합니다.
