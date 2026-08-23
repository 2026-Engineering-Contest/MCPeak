---
"@mcpeak/generate": minor
"@mcpeak/cli": minor
---

provider CLI 가 우리가 넘긴 옵션을 몰라 죽었을 때 **화면이 원인을 말합니다**([#285](https://github.com/2026-Engineering-Contest/MCPeak/issues/285), [ADR-0065](https://github.com/2026-Engineering-Contest/MCPeak/blob/main/docs/adr/0065-옵션-이름은-stderr-가-아니라-우리-args-에서-고른다.md)).

설치된 CLI 버전에 우리가 넘긴 옵션이 없으면 요청이 API 에 닿기도 전에 죽습니다. 이 실패는 HTTP 상태
코드를 남기지 않아 분류가 비었고, 화면은 `default` 갈래로 떨어져 **로그인과 모델을 확인하라고**
안내했습니다. 둘 다 원인이 아니므로 안내를 그대로 따라도 풀리지 않았습니다.

전:

```
오류 [GENERATE_PROVIDER_EXIT]: claude가 종료했습니다. 종료 코드: 1, 모델: sonnet
해결: `claude /status` 명령으로 로그인 상태를 확인하고, 모델 이름이 맞는지 확인하세요.
```

후:

```
오류 [GENERATE_PROVIDER_OPTION]: 설치된 claude가 우리가 넘긴 옵션을 모릅니다. 옵션: --safe-mode
  → 로그인도 모델도 원인이 아닙니다. CLI가 뜨기도 전에 옵션 해석에서 멈췄습니다.
해결: `claude --version` 으로 버전을 확인하고 최신 버전으로 올리세요.
```

`repair` 도 같은 사실을 말하며(`REPAIR_PROVIDER_OPTION`), 파일이 하나도 바뀌지 않았다는 약속은
그대로 유지합니다.

**stderr 를 화면에 찍지는 않습니다.** 거기에는 우리가 보낸 프롬프트가 echo 되고 그 안에 신뢰할 수
없는 툴 설명이 있습니다. 옵션 이름은 stderr 에서 읽는 대신 **우리가 넘긴 args 목록에서 고릅니다**
— 우리 것이 아니면 아무것도 말하지 않습니다.

**breaking**: `AuthoringProviderFailureReason` 에 `unknownOption` 이 추가되고, `classifyFailure` 의
반환형이 enum 에서 `ProviderFailureClassification` 객체로 바뀝니다. 사유만으로는 어느 옵션인지 말할
수 없기 때문입니다. `PublicProviderFailure` 에는 `option` 필드가 생깁니다.
