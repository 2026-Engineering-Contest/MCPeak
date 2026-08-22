---
"@mcpeak/core": patch
---

core: 동시에 실패한 HTTP 요청들이 하나의 마지막 오류 상태를 공유하지 않고, 각 요청의 실제
원인에 따라 `HTTP_SESSION_LOST` 또는 `OPERATION_FAILED`로 분류되도록 수정합니다.
