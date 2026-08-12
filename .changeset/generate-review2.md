---
"@ohmymcp/generate": minor
---

계약 식별자(suite id, case id·name, operation type·tool, 도구 이름)를 값 기반 redaction 대상에서 제외해, 사용자가 그 문자열을 비밀값으로 선언해도 suite identity 대조와 도구 allowlist가 깨지지 않게 합니다. provider가 보고한 `summary`와 `warnings`를 공개 candidate 결과 타입에 노출하고, suite fingerprint 계산을 한 곳에 두도록 `sha256`과 `canonicalJson`을 export합니다. stdin 쓰기 오류 뒤 비정상 종료를 성공으로 넘기지 않고 `internal`로 보고합니다.
