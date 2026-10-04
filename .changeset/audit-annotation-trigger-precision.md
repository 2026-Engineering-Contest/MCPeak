---
"@mcpeak/audit": patch
---

정적 규칙 두 개의 오탐을 줄인다. `schema/annotation-mismatch` 는 읽기 전용(`readOnlyHint: true`) 도구의 설명 전체를 훑지 않고 도구 이름의 첫 토큰과 설명·제목의 맨 앞 동사만 본다. 설명 중간에 명사나 리소스 이름, HTTP 메서드로 나온 `commit`·`deploy`·`POST` 같은 낱말 때문에 정상 도구가 high 로 잡히던 문제가 사라진다. `desc/implicit-trigger` 는 파라미터(`inputSchema` 속성) 설명에서는 돌지 않는다. 인자를 어떻게 채우는지 알려 주는 조건문이 자동 트리거로 오인되었기 때문이다. 두 규칙의 id·심각도·메시지는 그대로이고, 파라미터 설명에 대한 다른 규칙(injection, shadowing 등)도 그대로 돈다.
