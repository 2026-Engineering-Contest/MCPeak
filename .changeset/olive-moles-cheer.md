---
"@ohmymcp/runner": minor
"@ohmymcp/generate": patch
---

runner: canonical JSON 구현(`canonicalJson` · `sha256` · `deepFreeze`)을 `generate` 에서
이관하고, 승인 지문을 계산하는 `suiteFingerprint` 를 추가합니다. 지문은 `approval` 블록을
제외한 명세 전체의 sha256 이며, 제외 규칙은 이 함수 하나가 소유합니다. 파일에 적힌 지문이
다음 계산의 대상에 들어가면 승인 시점의 값과 절대 같아질 수 없기 때문입니다.

이관하면서 `canonicalJson` 과 `deepFreeze` 의 재귀 순회를 명시적 스택으로 바꿨습니다. 재귀판은
깊이 1500 부근에서 `RangeError` 로 죽었는데 `validateMcpSuite` 는 그 깊이를 통과시켜서, 검증을
통과한 명세가 지문 계산에서만 죽었습니다. 출력 문자열은 재귀판과 바이트 단위로 같습니다.
sparse array 판정도 own property 기준으로 바꿨습니다. 프로토타입 체인까지 보면
`Array.prototype` 에 인덱스가 정의됐을 때 hole 이 상속값으로 채워져 지문이 전역 상태에 따라
달라집니다.

generate: `canonical.ts` 가 `@ohmymcp/runner` 재수출 한 줄이 됩니다. 공개 API
(`canonicalJson` · `sha256`)는 그대로이며 동작도 같습니다. 구현이 한 벌로 유지되어야
저장 시점 지문과 실행 시점 지문이 갈리지 않습니다.
