---
---

발행되는 패키지가 바뀌지 않아 빈 changeset 입니다.

`packages/mock/tests/stdio-e2e.test.ts` 하나만 바뀌었습니다 — `src/stdio.ts` 는 한 줄도
고치지 않았고, `@mcpeak/mock` 이 `files` 로 선언한 `dist` 에 들어가는 파일이 없습니다.
배포 진입점의 오류 경로 네 문장(#416)에 회귀 방지를 붙인 것입니다.
