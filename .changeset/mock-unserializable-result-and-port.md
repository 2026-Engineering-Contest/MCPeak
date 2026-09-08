---
"@mcpeak/mock": patch
---

mock: 실을 수 없는 응답과 포트 충돌을 설계된 문장으로 거절한다. `result` 를 `JSON.stringify`
로 만들 수 없으면(undefined · 함수 · 심볼 · 순환 참조 · BigInt) 지금까지는 목이 아무 말도
하지 않아 사용자가 클라이언트 zod 덤프나 Node TypeError 원문을 받았다(#415). 이제 주입
시점에 거절하고, 값이 사라지는 갈래와 직렬화가 던지는 갈래를 갈라 고치는 법을 적는다.
고정 포트가 이미 물려 있을 때 나가던 `listen EADDRINUSE: ...` 도 같은 형식의 문장으로
바꾸고, listen 성공 후 남아 있던 error 리스너를 뗀다.
