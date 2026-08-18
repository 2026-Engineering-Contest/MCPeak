---
"@ohmymcp/runner": minor
---

`runner`: 거절을 기대한 케이스마다 **거절 근거를 확인했는지**를 판정해 결과에 싣습니다. `TestCaseResult.rejectionBasis`(`verified` · `unverified` · `notApplicable`)와 `RunnerSummary.rejectionUnverified` 두 필드가 늘었습니다. 위반 케이스의 단언은 `isError: true` 하나라 "서버가 입력을 거절한 것"과 "서버가 다른 이유로 실패한 것"이 구분되지 않았고, 관찰 80건은 응답 본문 형식으로 크래시를 지목할 수 없음을 보였습니다. 그래서 방향을 뒤집어 **SDK 검증이 낸 거절임을 양성으로 확인**합니다. 지문 셋(TS SDK 의 `MCP error -32602:`, Python 하위 SDK 의 `Input validation error:`, FastMCP 의 `<툴>Arguments` 모델)에 안 걸리면 전부 `unverified` 로 떨어지는 화이트리스트입니다.

확인하지 못한 케이스에는 응답 본문도 함께 싣습니다(`TestCaseResult.rejectionBody`). 승인 화면이 "이 응답이 정상 거절인지 내부 오류인지"를 사람에게 보여주려면 본문이 필요한데 판정만으로는 그 자리를 채울 수 없기 때문입니다. `unverified` 이고 본문을 읽었을 때만 **키가 생기고**, 진단 값과 같은 상한(200자)에서 잘리며 같은 redaction 을 받습니다. `verified` 와 `notApplicable` 에는 키 자체가 없어서 통과한 모든 케이스의 응답이 보고서에 들어가지 않습니다.

**판정과 종료 코드는 바뀌지 않습니다.** `unverified` 는 "거절이 아니다"가 아니라 "확인하지 못했다"는 뜻이고, 이것을 실패로 올리면 관찰한 서버 11개 중 2개가 통째로 빨개집니다(ADR-0015). `RunnerReport.schemaVersion` 은 `1` 을 유지합니다 — 늘어난 필드가 전부 추가이고 기존 필드의 의미가 바뀌지 않아, 기존 `--json` 소비자는 새 키를 무시하면 종전과 같은 결과를 읽습니다. 분류는 응답 본문 문자열만 보는 순수 함수라 같은 응답에 항상 같은 값이 나옵니다.
