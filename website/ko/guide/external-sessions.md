# External 세션

이 문서를 끝내면 서버가 밖으로 부르는 HTTP 호출을 한 번 녹화해 이후 실행에서 재생하고, 그
녹화가 무엇을 잡고 무엇을 못 잡는지, 세션 파일에 무엇이 남는지 아는 상태가 된다.

## 목으로 대체할 수 없는 것

테스트 대상 서버 자신이 밖으로 부르는 HTTP 호출은 서버를 목으로 바꿔치기해도 그대로 남고, 두면
테스트를 돌릴 때마다 실제로 나간다. 날씨 API, 결제, webhook 이 그렇다.

External 세션은 그 호출을 한 번 녹화해 두고 이후 실행에서 재생한다. 재생할 때도 서버는 실제로
뜬다. 멈추는 것은 서버가 아니라 그 서버가 밖에 부르는 쪽이다.

## 녹화하고 재생하기

```bash
# 1) 한 번은 진짜로 나간다. 그 응답이 세션 파일에 남는다.
mcpeak test weather.suite.json --record-session weather.session.db -- node ./server.mjs

# 2) 이후로는 세션 파일에서 재생한다. 외부 API 는 부르지 않는다.
mcpeak test weather.suite.json --session weather.session.db -- node ./server.mjs
```

세션 파일은 표준 SQLite 파일이다. 두 옵션은 서로, 그리고 `--determinism` 과 함께 쓸 수 없다.
`--determinism` 은 서버에 두 번 연결하는데 세션은 연결 하나에 묶여 있어서다.

저장소의 `examples/live-weather-server` 가 이 기능을 보여 주는 예제다. Open-Meteo 와
Frankfurter 를 `fetch` 로 부르므로 호출마다 기온과 환율이 바뀌고, 재생이 그것을 고정한다.

## 잡는 범위는 `globalThis.fetch` 하나다

아래는 범위 밖이라 녹화도 재생도 되지 않는다.

- `node:http` · `node:https` 직접 호출
- 그 위에 얹힌 axios · got · node-fetch
- Node 가 아닌 서버(Python · Go 등). 주입이 Node 의 `--import` 훅이라 애초에 닿지 않는다

범위 밖 호출은 재생 중에도 실제 네트워크로 나가고, 도구가 막지 못한다. 대신 그럴 정황이 보이면
실행이 끝날 때 알린다. 녹화가 0건이거나 재생이 0건인 경우다.

```
알림: 이 실행에서 외부 호출이 하나도 녹화되지 않았습니다.
→ 서버가 외부 API를 호출했다면 지원 범위를 벗어났는지 확인하세요.
→ MCPeak은 서버가 `globalThis.fetch`로 부른 것만 잡습니다.
```

목 서버를 세션으로 녹화하면 녹화 건수가 0 이다. 목은 정의 파일의 응답만 돌려주고 밖으로 나가는
코드가 없다.

## 세션 파일에 남는 것

세션 파일에는 외부 API 의 요청과 응답이 그대로 들어간다. 이름으로 알아볼 수 있는 비밀값은 저장
전에 가려진다.

| 자리 | 적용 |
|---|---|
| 요청·응답 JSON body | 키 이름이 `token` · `apiKey` · `secret` · `password` 등이면 값을 `[redacted]` 로 |
| 헤더 | 같은 이름 판정. `authorization` · `cookie` · `set-cookie` · `proxy-authorization` 은 항상 |
| URL query | 키 이름이 걸리면 값을 `[redacted]` 로 |
| URL 경로 | 이름이 없어 판정할 수 없으므로 통째로 `<redacted>` 로 |

```
https://hooks.example.com/services/T000/B111/XXXXsecret?token=abc
        ↓ 저장되는 값
https://hooks.example.com/<redacted>?token=[redacted]
```

이름 판정은 키를 `-` · `_` 구분자와 카멜케이스 경계로 나눈 뒤 뒤에서부터 이어붙인 접미 조합이
목록과 정확히 일치하는 자리만 잡는다. `X-Api-Key` 는 잡고 `tokenCount` 는 잡지 않는다.

이름으로 판정할 수 없는 자리는 가려지지 않는다. JSON body 안에 URL 문자열로 실린 값이
그렇다. 저장본이 곧 재생 입력이라 body 의 URL 을 지우면 `next` 링크를 따라가는 서버가 재생에서
깨지기 때문에 지우지 않고, 대신 녹화가 끝나면 그런 URL 이 몇 건 남았는지 센다. 경로 자체가
자격증명인 endpoint(Slack · Discord webhook)를 녹화했다면 커밋 전에 파일을 확인한다.

자격증명이 들어간 세션 파일을 커밋했다면 파일을 지우는 것으로 끝나지 않는다. git 이력에
남으므로 그 값은 노출된 것으로 다루고, 폐기하고 재발급한 뒤 다시 녹화한다.

## `node:sqlite` 실험 경고

런타임에 따라 세션 옵션을 쓴 실행에서 stderr 에 한 줄이 찍힌다.

```
(node:2845) ExperimentalWarning: SQLite is an experimental feature and might change at any time
```

`node:sqlite` 를 처음 로드할 때 한 번 나오므로 실행당 한 줄이다. Node 22.18.0 에서는 나오고
24.16.0 에서는 나오지 않는다. 그 사이 버전은 재지 않았다. Node 의 API 표면에 대한 경고이지
저장된 녹화에 대한 것이 아니다. 파일은 표준 SQLite 라 다른 도구로도 열린다.

## 라이브러리로 쓰기

`@mcpeak/record` 가 공개하는 것은 Store 와 Coordinator 둘이다. Coordinator 가 자식에게 실어
줄 환경 변수를 만들고, 그 환경 변수로 뜬 자식의 `fetch` 가 녹화·재생된다.

```ts
import { createSqliteSessionStore, startExternalCoordinator } from "@mcpeak/record";

const store = createSqliteSessionStore({ path: "weather.session.db" });
const handle = await startExternalCoordinator({ mode: "record", sessionId: "default", store });

let status: "completed" | "failed" = "completed";
try {
  await runServerWith(handle.childEnvironment);
} catch (error) {
  status = "failed";
  throw error;
} finally {
  try {
    await handle.finish(status);
  } finally {
    store.close();
  }
}
```

재생은 `{ mode: "replay", sourceSessionId, store }` 로 열고, store 는
`createSqliteSessionStore({ path, readOnly: true })` 로 연다. `finish()` 는 성공·실패 어느
경로에서도 부른다. 부르지 않으면 녹화 세션이 `running` 인 채로 남아 다음 실행이 이어 쓸 수 없다.
