---
"@ohmymcp/record": patch
---

민감 키 판정이 **이름에 포함되면 걸리는 방식에서 접미 단어열이 정확히 일치할 때 걸리는
방식으로** 바뀝니다. 그리고 `cookie` 가 목록에 추가됩니다.

**새로 마스킹되는 것** — `Cookie` · `Set-Cookie` 헤더. 세션 값을 나르는데도 목록에 없어
카세트 파일과 경고 출력에 원문으로 남고 있었습니다. `authorization` 은 이미 목록에 있었으니
같은 급인 쪽만 빠져 있던 셈입니다.

**더 이상 마스킹되지 않는 것** — `tokenCount` · `passwordPolicy` · `secretariat` 처럼 민감
단어를 품고 있을 뿐인 필드. 영어 합성명사는 마지막 단어가 머리라서 `accessToken` 은 토큰의
일종이지만 `tokenCount` 는 개수의 일종입니다.

| 키 | 이전 | 이후 |
|---|---|---|
| `Cookie` · `Set-Cookie` | 원문 노출 | 마스킹 |
| `accessToken` · `X-Api-Key` · `apiKey0` | 마스킹 | 마스킹 |
| `tokenCount` · `passwordPolicy` · `secretariat` | 마스킹 | 값 그대로 |

**카세트 파일의 내용이 바뀝니다.** 포맷과 버전은 그대로라 기존 카세트도 계속 읽히지만,
다시 녹화하기 전까지는 예전 마스킹 결과를 그대로 갖고 있습니다.

`tokenCount` 같은 필드를 단언하던 테스트는 이제 실제 값을 보게 됩니다. 근거는 ADR-0039 에
있습니다.
