---
"@mcpeak/dashboard": minor
---

Generate의 AI 모델 입력을 도구별 선택 목록으로 바꿉니다. Claude에서는 Sonnet·Haiku·Opus를,
Codex에서는 Sol·Terra·Luna를 고를 수 있으며, 선택한 모델은 generate CLI의 `--model` 인자로
전달됩니다.

AI 도구를 바꾸면 이전 도구의 모델 선택을 초기화합니다. 서로 호환되지 않는 모델 값이 새 도구에
그대로 전달되는 일을 막고, 모델을 고르지 않으면 지금처럼 각 도구의 기본값을 사용합니다.
