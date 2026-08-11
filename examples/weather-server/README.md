# example-weather-server

도그푸딩용 예제 MCP 서버. **stdio** 트랜스포트로 동작한다.

```bash
node examples/weather-server/server.mjs
```

MCP 클라이언트(Claude Desktop 등)에 붙이려면 위 명령을 서버 실행 커맨드로 지정하면 된다.

## 툴

| 툴 | 인자 | 응답 |
|---|---|---|
| `get_weather` | `{ city: string }` | `{ city, temp, condition }` |
| `add` | `{ a: number, b: number }` | `{ sum }` |

`get_weather` 는 **서울 · 부산 · 제주** 세 도시만 안다. 그 외에는 `isError: true` 와 함께 사용 가능한 도시를 알려준다.

## 왜 이렇게 만들었나

**결정론적이다.** 외부 날씨 API 를 부르지 않고 파일 안의 고정 테이블에서 답한다. 같은 도시를 몇 번 물어도 항상 같은 값이 나오고, 랜덤값·타임스탬프를 쓰지 않는다. 이 저장소의 핵심 가치가 결정론성이라 예제부터 그것을 지킨다 (`CLAUDE.md`).

**API 키가 필요 없다.** 클론해서 바로 돌아가야 예제다. 키를 요구하면 CI 에서도 못 돌리고 처음 온 사람도 못 돌린다.

**실패 경로를 일부러 넣었다.** 모르는 도시를 물으면 이렇게 답한다.

```
→ '도쿄' 의 날씨 데이터가 없습니다. 사용 가능한 도시: 서울, 부산, 제주
→ 이 예제 서버는 고정 데이터만 가지고 있습니다.
```

`runner` 의 실패 메시지 품질을 검증하려면 **실패하는 대상**이 필요하다. 항상 성공하는 서버로는 그걸 확인할 수 없다.

**저수준 `Server` 를 쓴다.** `McpServer.registerTool` 은 Zod 스키마를 요구하는데, 이 서버의 툴 정의는 JSON Schema 다. 저수준 API 는 변환 없이 그대로 넘길 수 있어 zod 의존성이 붙지 않는다.

**툴 정의를 `fixtures/tools-list.sample.json` 과 맞췄다.** 픽스처로 개발한 코드가 이 서버에도 그대로 통해야 한다.

## 이 서버의 쓸모

`CONTRIBUTING.md` §6 의 **"우리 도구로 우리를 검증한다"** 가 여기에 걸려 있다. `ohmymcp` 로 이 서버를 테스트하는 E2E 를 CI 에 넣는 것이 목표다.

아직 붙이지 못했다. `core.connect()` 가 구현되지 않아서다 (#16). `core` 가 올라오면 그때 CI 에 E2E 잡을 추가한다.

## 배포되지 않는다

`package.json` 에 `"private": true` 가 있다. Changesets 릴리스 워크플로가 npm 에 올리지 않는다.
