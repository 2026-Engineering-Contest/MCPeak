---
"@mcpeak/runner": patch
---

명세 검증 문장이 **코드마다 달라집니다** ([ADR-0078](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0078-명세-검증-문안은-코드별-표가-갖고-호출-지점이-문맥을-얹는다.md), [#352](https://github.com/2026-Engineering-Contest/MCPeak/issues/352)).

지금까지는 `validateSuite` 가 어떤 결함이든 같은 문장 하나를 붙였습니다. 필드가 **없는** 것과 값이 **틀린** 것과 단언이 operation 과 **안 맞는** 것이 화면에서 구분되지 않아, 코드 이름을 읽고 사용자가 스스로 해석해야 했습니다.

```
- [MISSING_REQUIRED_FIELD] schemaVersion: 명세 필드 'schemaVersion'가 유효하지 않습니다.
  해결: 명세 계약에 맞게 필드와 값을 확인하세요.
- [INCOMPATIBLE_ASSERTION] cases[0].assertions[0]: 명세 필드 'cases[0].assertions[0]'가 유효하지 않습니다.
  해결: 명세 계약에 맞게 필드와 값을 확인하세요.
```

이제 13개 코드가 저마다 다른 문장을 내고, 넣어야 할 값과 대조 대상을 싣습니다.

```
- [MISSING_REQUIRED_FIELD] schemaVersion: 'schemaVersion' 필드가 없습니다. 받는 값: 1.
  해결: 'schemaVersion' 필드를 명세에 추가하세요.
- [INCOMPATIBLE_ASSERTION] cases[0].assertions[0]: 'listTools' operation 은 'isError' 단언을 받지 않습니다. 허용: toolExists
  해결: 단언 type 을 허용 목록의 것으로 바꾸거나 operation 을 확인하세요.
```

모르는 필드는 그 자리가 받는 필드 목록을, 타임아웃은 받는 범위를, JSON 으로 옮길 수 없는 값은 원인(유한하지 않은 수 · 옮길 수 없는 타입 · 순환 참조)을 각각 구분해 말합니다. 긴 값과 승인 지문은 화면에 싣지 않고 형식만 말합니다.

`SuiteValidationIssue` 의 구조와 `SuiteValidationIssueCode` 목록은 그대로입니다. `message` · `hint` 문자열의 내용만 달라지므로 CLI 렌더링은 바뀌지 않습니다.
