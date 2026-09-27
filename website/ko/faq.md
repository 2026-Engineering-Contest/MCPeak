# FAQ

이 문서는 설치를 마친 다음에야 나오는 질문에 답한다.

## `mcpeak-mock` 이나 `mcpeak-dashboard` 가 "command not found" 다

`@mcpeak/cli` 만 전역 설치했기 때문이다. npm 의 전역 설치는 그 패키지 자신의 실행 파일만 `PATH`
에 놓는다. 의존성으로 딸려 와도 다른 패키지의 bin 은 생기지 않는다.

```bash
npm install -g @mcpeak/mock @mcpeak/dashboard
```

## 통과했는데 "거절 근거를 확인하지 못했습니다" 가 뜬다

`isError: true` 를 기대한 케이스가 통과했을 때, 그 오류가 입력 검증에서 나온 거절인지 서버가
다른 이유로 터진 것인지를 도구가 판단하지 못했다는 뜻이다. 도구는 SDK 의 입력 검증 접두어
(`MCP error -32602:` 등)만 알아본다. 서버가 직접 쓴 거절 문장, 그리고 목 서버의 거절문은 목록에
없어 항상 이 경고가 붙는다. 판정은 바뀌지 않는다. 의심되면 `mcpeak generate --diagnose-rejections`
로 응답을 나열해 본다.

## `generate` 로 만든 정상 케이스가 실패한다

스키마에서 고른 자리값(`"example"`, `0`)이 서버가 모르는 값이라서다. 서버가 서울·부산·제주만 안다면
`{ "city": "example" }` 은 거절된다. 기본 흐름의 시험 실행이 이것을 저장 전에 드러내고, 입력값을
고쳐 다시 시도하거나 AI 제안을 받을 수 있다. 실재하는 값을 `mcpeak.fixtures.json` 에 적어 두면
처음부터 그 값을 쓴다. `--baseline-only` 로 만들었다면 시험 실행이 없었으므로 이 실패가 그대로
남는다.

## 전부 통과했는데 "승인 시점과 다릅니다" 가 뜬다

`generate` 로 승인한 뒤 명세를 손으로 고쳤다는 뜻이다. 판정은 바뀌지 않고 종료 코드도 0 이다.
승인받지 않은 명세로 초록불이 뜬 상태라 실패보다 조용히 지나가기 쉬워서 이 경우에만 반드시
표시한다. 의도한 변경이면 같은 설정의 `mcpeak generate --force` 로 다시 생성·승인하거나, 그냥
둔다. 손으로 쓴 명세에는 지문이 없고, 그것도 정상이다.

## 재생 중인데 실제 네트워크로 나간다

세션이 잡는 것은 `globalThis.fetch` 하나다. `node:http` · `node:https` 를 직접 쓰거나 그 위에
얹힌 axios · got · node-fetch 로 부르는 호출, 그리고 Node 가 아닌 서버는 범위 밖이라 재생되지 않고
실제로 나간다. 녹화가 0건이거나 재생이 0건이면 실행이 끝날 때 알려 준다.

## `--determinism` 이 "확인은 아닙니다" 라고 한다

두 번 결과가 같았지만 실행 사이에 상태를 복원하지 않았다는 뜻이다. 두 번째 실행이 첫 번째가
남긴 상태 위에서 돌면 우연히 같아 보일 수 있다. `--reset-cmd` 로 초기 상태 복원 명령을 주면
결론이 `deterministic` 이 된다. [결정론성 확인](/ko/guide/determinism)에 세 결론이 있다.

## 세션 옵션을 쓰면 `ExperimentalWarning: SQLite` 가 찍힌다

Node 가 `node:sqlite` 를 아직 실험적으로 표시해서다. 처음 로드할 때 한 번이라 실행당 한 줄이고,
Node 22.18.0 에서는 나오고 24.16.0 에서는 나오지 않는다. 저장된 녹화는 표준 SQLite 파일이라
영향받지 않는다.

## 서버가 API 키를 못 읽는다

`core` 는 부모의 환경변수를 통째로 넘기지 않는다. `--env WEATHER_API_KEY` 처럼 이름을 지정한
것만 간다. 값을 명령줄에 쓰지 않는 이유는 `ps` 목록과 셸 히스토리에 남기 때문이다.

## `mcpeak test` 에 `--url` 을 쓰면 stdio 옵션이 거절된다

`--url` 은 이미 떠 있는 서버에 붙는 것이라 띄울 프로세스가 없다. `--env` 와 `--reset-cmd` 처럼
프로세스를 전제하는 옵션은 함께 쓸 수 없고, 어느 옵션이 그런지는 함께 썼을 때 오류 문장이 말한다.
HTTP 에는 `--header-env` 를 쓴다.

## 저장소에서 작업할 때 `mcpeak` 을 그대로 치면 안 되는 이유

`PATH` 의 `mcpeak` 은 npm 에 배포된 버전이라 저장소의 main 보다 뒤에 있을 수 있다. 저장소에서는
`pnpm build` 뒤에 빌드 산출물을 부른다.

```bash
node packages/cli/dist/cli.mjs test <suite.json> -- node ./server.mjs
```

`pnpm build` 를 건너뛰면 낡은 `dist/` 를 문다. 소스를 고쳤으면 다시 빌드한다.
