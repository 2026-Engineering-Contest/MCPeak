---
"@mcpeak-examples/live-weather-server": patch
---

live-weather-server 를 현재 generate 산출물에 맞춘다. `convert_units` 에 길이 단위 `m` 을 더하고 enum 순서를 첫·두 번째·마지막 값이 전부 길이가 되게 두어, 정상 분기 케이스가 종류가 다른 단위 조합으로 영원히 실패하던 것을 없앤다. baseline 명세를 82케이스로 다시 뽑고, README 의 데모 명령을 로컬 CLI 산출물 기준으로 바꾸고 `--reset-cmd` 를 1단계에 넣는다.
