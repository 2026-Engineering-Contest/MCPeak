# Repair

이 문서를 끝내면 실패한 실행의 근거를 번들 파일로 남기고, 그 번들로 서버 코드의 원인 후보를
AI 에게 제안받는 흐름을 아는 상태가 된다.

## 번들 만들기

`test` 에 `--repair-bundle` 을 붙이면 실패한 케이스만 모은 파일을 따로 쓴다.

```bash
mcpeak test weather.suite.json --repair-bundle repair.json -- node ./server.mjs
```

번들에는 `bundleVersion`, 실행한 명세, 실패한 케이스의 진단, 서버가 광고한 툴 정의, 대상 서버
정보가 들어간다. 서버 stderr 도 함께 싣는다. 실패가 없으면 번들도 만들지 않는다.

`--json` 보고서와 별도 파일인 이유는 두 파일이 지는 계약이 달라서다. `--json` 은 CI 가 읽는
판정 출력이라 사실상 동결이고, 번들은 AI 에게 줄 근거라 필드가 계속 는다.

## 원인 후보 제안받기

```bash
mcpeak repair repair.json --provider claude --model sonnet
```

`--provider` 와 `--model` 에 기본값은 없다. 사용자가 설치하고 인증한 Codex 또는 Claude CLI 가
필요하다. 전송 전에 무엇을 보낼지 확인 화면이 뜨고, 승인해야 나간다.

| 옵션 | 뜻 |
|---|---|
| `--max-cases <N>` | 한 번에 보낼 실패 개수 상한. 넘으면 앞에서부터 남긴다 |
| `--no-stderr` | 서버 stderr 를 전송에서 뺀다. stderr 는 서버가 자유롭게 쓰는 텍스트라 경로·토큰·데이터가 섞일 수 있다 |
| `--yes` | 확인 화면을 건너뛴다. 비대화형 환경에서 필요하다 |

제안은 서버 코드의 원인 후보다. 파일을 고치지 않는다. 명세를 고치는 것도 아니다. 명세 쪽 문제는
[명세 생성](/ko/guide/generate)의 시험 실행에서 다룬다.

## 예제로 보기

`examples/live-weather-server` 에는 일부러 둔 결함이 하나 있다. `convert_units` 가
`outputSchema` 에는 `converted` 를 선언하고 `structuredContent` 에는 `result` 로 싣는다. SDK 가
그 응답을 검증해 `-32602` 로 거절하고, `test` 는 그 오류를 실패 원인으로 보여 준다. 그 번들을
`repair` 에 넣으면 한 줄짜리 원인 후보가 나오는 장면을 위한 서버다.

## 대시보드에서

[대시보드](/ko/guide/dashboard)는 실패한 실행에서 곧바로 repair 로 넘어가는 동선을 갖고 있다.
번들 경로를 묻지 않고 스스로 정한다.
