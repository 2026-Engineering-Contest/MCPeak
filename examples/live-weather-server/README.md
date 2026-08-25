# example-live-weather-server

External 세션(녹화·재생) 데모용 예제 MCP 서버. **stdio** 트랜스포트로 동작하고, **실제 공개
API 를 `fetch` 로 부른다.**

```bash
node examples/live-weather-server/server.mjs
```

## 툴

| 툴 | 인자 | 응답 | 부르는 곳 |
|---|---|---|---|
| `get_forecast` | `{ city: string }` | `{ city, country, temp, condition, observedAt }` | Open-Meteo 지오코딩 → 예보 (fetch 2회) |
| `convert_currency` | `{ amount: number, from: string, to: string }` | `{ amount, from, to, converted, rate, date }` | Frankfurter (fetch 1회) |

둘 다 무료·무인증이다. API 키가 없다.

## 왜 `weather-server` 와 따로 있나

`weather-server` 는 고정 데이터라 결정론적이고, 그래서 CI 도그푸딩 대상이다. 이 서버는 정반대다.
같은 도시를 두 번 물으면 기온이 달라질 수 있고, 네트워크가 없으면 실패한다. **그 비결정성이
External 세션이 해결하는 문제**라, 그것을 보여주려면 실제로 밖에 나가는 서버가 필요하다.

CI 에는 넣지 않는다. 외부 API 에 기대는 순간 CI 가 그 API 의 가용성에 묶인다.

## 녹화하고 재생하기

```bash
# 1. 실제 API 를 부르며 녹화한다
mcpeak test examples/live-weather-server/server.suite.json \
  --command node --arg examples/live-weather-server/server.mjs \
  --record-session .mcpeak/live-weather.session.json

# 2. 네트워크를 끊어도 같은 결과가 나온다
mcpeak test examples/live-weather-server/server.suite.json \
  --command node --arg examples/live-weather-server/server.mjs \
  --session .mcpeak/live-weather.session.json
```

재생이 끝나면 stderr 에 `녹화된 외부 호출 N건을 재생했습니다: <경로> (<시각> UTC 녹화)` 가
찍힌다. 녹화에 없는 호출을 하면 실제 네트워크로 나가지 않고 `저장된 외부 응답을 찾지 못했습니다`
로 실패한다.

대시보드에서는 홈 실행 폼의 「External 세션」에서 갈래(외부 호출 녹화 / 녹화본 재생)와 세션
파일 경로를 고르면 같은 argv 가 만들어진다.

## 지킨 것

- **`globalThis.fetch` 만 쓴다.** `@mcpeak/record` 가 가로채는 경계가 그것 하나다(ADR-0057).
  `node:http`·axios 로 부르면 녹화되지 않고, 재생 중 실제 네트워크로 나간다.
- **실패 경로가 있다.** 모르는 도시, 모르는 통화 코드, 잘못된 인자는 `isError: true` 와 함께
  무엇을 고쳐야 하는지 말한다.
- **저수준 `Server` 를 쓴다.** `weather-server` 와 같은 이유다. JSON Schema 를 그대로 넘기고 zod
  의존성을 붙이지 않는다.

## 한계

- Open-Meteo 지오코딩은 한글 `서울` 을 못 찾는다(`부산`·`제주`·`Seoul` 은 찾는다). 스위트가 `부산`
  을 쓰는 이유다. 데모에서 도시를 바꿀 때는 먼저 한 번 실행해 찾히는지 본다.
- 녹화본은 녹화 시점의 날씨·환율이다. 낡은 녹화를 재생하면 낡은 값이 나온다. 러너가 녹화 시각을
  같이 찍는 이유다(ADR-0069).
- Open-Meteo 지오코딩이 같은 이름에 다른 결과를 돌려주면(순위 변동) 재생 매칭은 그대로지만
  새로 녹화할 때 값이 바뀔 수 있다.
