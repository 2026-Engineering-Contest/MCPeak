---
"@mcpeak/audit": minor
---

격리 실행(행위 관측)의 공유 계약을 더한다. 타입(`SandboxOptions`·`SandboxReport`·`Observation`·`SyscallEvent`·`ObservedRequest`·`PlannedCall`·`HomePlan` 등), 규칙 가족 `behavior`·`network`, 위치 `call`, 오류 코드 `SANDBOX_CLEANUP_FAILED`·`SANDBOX_SESSION_UNREADABLE`, 격리 백엔드 인터페이스(`SandboxBackend`·`SandboxHandle`·`SandboxSpec`)와 모듈 시그니처가 들어 있고 검사 본문은 아직 없다. `AuditOptions.sandbox` 와 `AuditReport.sandbox` 는 선택 필드라서 `--sandbox` 없는 출력과 기준 파일 형식은 그대로다(`AUDIT_SCHEMA_VERSION` 은 1). 배포본에 격리 이미지 재료(`sandbox/Dockerfile`, `sandbox/gateway`)가 실린다.
