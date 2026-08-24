---
---

발행되는 패키지가 바뀌지 않아 빈 changeset 입니다.

ADR-0050 개명이 놓친 잔재 정리입니다 — `LICENSE` 저작권자 표기와, 테스트·CI 에서만 쓰는
환경변수 접두어(`OHMYMCP_` → `MCPEAK_`) 4 종입니다. 바뀐 파일이 전부 `tests/`,
`.github/workflows/`, `docs/`, `LICENSE` 라 각 패키지가 `files` 로 선언한 `dist` 에
들어가지 않습니다.
