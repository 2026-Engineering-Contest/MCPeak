---
"@mcpeak/cli": patch
---

`test --junit`이 XML 파일을 쓰지 못해도 통과·실패 케이스와 요약을 stdout에 보존합니다(#294).
종료 코드 1과 `JUNIT_WRITE_FAILED`는 유지하며, 오류 메시지에 시도한 경로와 errno를 표시합니다.
