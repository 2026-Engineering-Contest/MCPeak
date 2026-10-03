---
"@mcpeak/cli": minor
"@mcpeak/audit": minor
---

`mcpeak audit --sandbox` 를 더한다. 서버를 Docker 컨테이너 안에서 띄워 모든 도구를 부르고, 그동안의 파일 읽기·자식 프로세스·나가는 접속을 관측해 `behavior`·`network` 발견으로 알린다. `--sandbox-session`·`--sandbox-replay` 로 네트워크를 녹화·재생하고, `--allow-host` 로 목적지를 선언하며, `--compare-host` 로 격리 안팎의 도구 표면을 비교하고, `--sandbox-mount` 로 컨테이너에 보일 범위를 정한다. Docker 가 없으면 격리 없이 점검하고 리포트 둘째 줄이 그 사실을 말한다. 격리가 실제로 켜진 실행의 호출 기본값은 `all` 이다(ADR-0107, ADR-0108).
