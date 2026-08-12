---
"@ohmymcp/generate": patch
---

Claude 성공 응답을 오류로 오판하던 문제를 고칩니다. Claude CLI는 성공 응답에도 `api_error_status`를 `null`로 항상 담기 때문에, 키 존재가 아니라 값으로 판정합니다.
