---
"@ohmymcp/generate": minor
"@ohmymcp/runner": minor
"ohmymcp": minor
---

입력 계약 대조 결과를 승인 화면과 `test` 출력에 배선한다.

`runner` 가 이미 갖고 있던 `checkInputContract` · `checkAssertionSubstance` 를 두 소비자에 연결해,
오타·타입 불일치·항상 참인 단언이 승인 전과 실패 직후에 문장으로 보인다.

- `ohmymcp generate` 승인 화면은 선택한 변경에 걸린 위반을 세어 보여 주고, 위반이 있으면 확인을
  한 번 더 받는다. 거부하지는 않는다.
- `ohmymcp test` 는 실패한 케이스에만 참고 문장을 붙인다. 판정과 exit code 는 바뀌지 않는다.
  `--json` 은 `spec.findings` 에 구조로 담는다.

공개 타입 변경 둘이 있다.

- `@ohmymcp/runner` 의 `SpecFindingCode` 에서 `UNCONSTRAINED_SCHEMA` 가 사라진다. 소비자 경로에서
  `validateMcpSuite` 가 먼저 거부해 도달할 수 없는 코드였다.
- `@ohmymcp/generate` 의 `SanitizedAuthoringCandidate` 에 `specFindings` 필드가 생긴다. 승인
  지문 계산 대상 밖이라 이미 승인된 지문은 그대로다.
