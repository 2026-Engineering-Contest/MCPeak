---
"@ohmymcp/generate": minor
---

provider 비정상 종료의 원인을 닫힌 enum(`AuthoringProviderFailureReason`)으로 분류해 `PublicProviderFailure.reason`으로 올립니다. 미인증, 없는 모델, 쿼터 초과, 잘못된 요청, 서버 오류가 `nonZeroExit` 하나에 뭉쳐 있던 문제를 풉니다. 분류에는 CLI가 돌려준 숫자 상태 코드만 쓰며, stdout·stderr 원문은 어떤 결과에도 담기지 않습니다.
