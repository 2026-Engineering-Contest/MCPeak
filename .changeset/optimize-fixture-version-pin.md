---
---

`@mcpeak/optimize` 변환 테스트가 generator 버전을 `package.json` 에서 읽던 것을 픽스처와 같은
고정값으로 바꾼다. **빈 changeset 이다.** 테스트만 바뀌고 공개 면은 그대로다. 버전을 올리는
Version Packages PR 에서 기대 오버레이와의 바이트 비교가 깨지던 문제(PR 485)를 고친다.
