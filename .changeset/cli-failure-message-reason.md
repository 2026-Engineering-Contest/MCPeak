---
"ohmymcp": patch
---

generate의 provider 실패 안내를 원인별로 다시 쓴다. `nonZeroExit`의 `reason`에 따라
`GENERATE_PROVIDER_MODEL`, `GENERATE_PROVIDER_AUTH`, `GENERATE_PROVIDER_RATE_LIMIT`,
`GENERATE_PROVIDER_REQUEST`, `GENERATE_PROVIDER_SERVER`로 나눠 안내하고, 실패한 모델 이름과
provider 기본 모델을 함께 보여준다. 로그인 확인 명령도 해당 provider의 것만 찍는다.
지금까지는 codex로 실패해도 `claude /status`가 같이 나왔다.
