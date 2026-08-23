# @mcpeak/record

MCP 서버가 **밖으로 부르는 HTTP 호출**을 녹화·재생하고(External 세션), **이름으로 판정 가능한**
비밀값을 프로세스 밖으로 나가는 경계에서 제거한다. URL 경로에는 판정에 쓸 이름이 없어서, 그쪽은
저장 직전에 통째로 지운다([자세히](#external-세션은-url-경로를-저장하지-않는다)).

- **오너:** `@ddxng5` (② replay/record 파트)
- **의존:** 없다. Node 내장(`node:sqlite`·`node:http`)만 쓴다.
- **결정:** [ADR-0051](../../docs/adr/0051-external-record-replay와-tool-카세트-경계-분리.md),
  [ADR-0052](../../docs/adr/0052-coordinator가-engine과-session-store를-소유한다.md),
  [ADR-0053](../../docs/adr/0053-http-외부-요청-매칭과-반복-호출-정책.md),
  [ADR-0057](../../docs/adr/0057-external-어댑터는-global-fetch-까지만-가로챈다.md),
  [ADR-0059](../../docs/adr/0059-tool-카세트를-제거한다.md)
- **마스킹 결정:** [ADR-0039](../../docs/adr/0039-민감-키-목록과-매칭-경계.md),
  [ADR-0041](../../docs/adr/0041-마스킹의-적용-경계.md),
  [ADR-0045](../../docs/adr/0045-민감-키-목록의-복수형과-key-합성어.md)

## Tool 카세트는 제거됐다

이 패키지에는 한때 **Tool 카세트**가 있었다. MCP 클라이언트를 감싸 *우리가 서버에게 물어본
것*(`listTools`·`callTool`)을 녹화해, 재생할 때 **서버를 아예 띄우지 않는** 기능이었다.
[ADR-0059](../../docs/adr/0059-tool-카세트를-제거한다.md)가 그것을 제거했고, 이 패키지는 이제
External 세션 전용이다.

| 사라진 것 | 대신 |
|---|---|
| `cassetteClient` · `loadCassette` · `saveCassette` · `matchKey` · `redact` | `@mcpeak/record` 는 이제 External API 만 내보낸다 |
| `verifyCassette` · `mcpeak verify` | 없다. 카세트가 만든 드리프트 문제라 카세트와 함께 사라졌다 |
| `mcpeak replay` | `mcpeak test <suite> --session <path>` |
| `generate --cassette` · `--record` | `generate` 는 항상 실제 서버를 호출한다 |

목적별로 갈아탈 곳이 다르다.

- **서버의 외부 API 호출을 막고 싶다** → 아래 External 세션. 서버는 실제로 뜨고 그 서버가
  밖에 부르는 호출만 멈춘다.
- **서버 자체를 실행하지 않고 결정론적 응답으로 테스트하고 싶다** → `@mcpeak/mock`.
  사람이 지정한 응답이라 녹화본처럼 낡지 않는다.

**External 이 카세트를 그대로 대신하지는 못한다.** 잡는 범위가 `globalThis.fetch` 하나라
(아래 절), 서버 자체가 비결정적이거나 Node 가 아닌 서버는 덮지 못한다. ADR-0059 「결과」에
후속 과제로 적혀 있다.

## 공개 API

```ts
import {
  createSqliteSessionStore,
  startExternalCoordinator,
  loadSession,
  ExternalRecordReplayError,
} from "@mcpeak/record";
```

루트(`@mcpeak/record`)와 `@mcpeak/record/external` 은 **같은 것**을 가리킨다. 카세트가 사라져
이 패키지의 API 가 하나뿐이기 때문이고, 서브패스는 이미 그것을 부르고 있는 소비자를 위해
남겨 둔다. 쓰는 법은 [라이브러리로 쓰기](#라이브러리로-쓰기).

## 마스킹

이름으로 판정한다. 키를 `-`·`_` 구분자와 카멜케이스 경계로 단어를 나눈 뒤, **뒤에서부터
이어붙인 접미 조합**이 `authorization`, `apikey`, `accesstoken`, `refreshtoken`, `token`,
`secret`, `password`, `cookie`, `secretkey` 중 하나와 정확히 일치하는 자리만 `"[redacted]"`
로 바꾼다. 대소문자는 구분하지 않는다. 부분 문자열 포함이 아니라 접미 일치이므로
`tokenCount`·`passwordPolicy`처럼 머리 명사가 다른 합성어는 마스킹하지 않고, 반대로
`X-Api-Key`처럼 앞단어와 합쳐 목록에 걸리는 이름은 마스킹한다. 판정 규칙과 한계는
[ADR-0039](../../docs/adr/0039-민감-키-목록과-매칭-경계.md) ·
[ADR-0045](../../docs/adr/0045-민감-키-목록의-복수형과-key-합성어.md).

External 세션에서 이 판정이 걸리는 자리는 넷이다.

| 자리 | 적용 |
|---|---|
| 요청·응답 JSON body | 키 이름이 걸리면 그 값을 `[redacted]` |
| 헤더 이름 | 위와 같은 단어 판정. 더해 `authorization`·`cookie`·`set-cookie`·`proxy-authorization` 은 이름 판정과 무관하게 항상 마스킹한다 |
| URL query 파라미터 | 키 이름이 걸리면 그 값을 `[redacted]` |
| URL 경로 | 이름이 없어 판정할 수 없다. 그래서 통째로 지운다 — [아래 절](#external-세션은-url-경로를-저장하지-않는다) |

**이름으로 판정할 수 없는 자리는 마스킹되지 않는다.** JSON body 안에 URL 문자열로 실린 값,
자유 텍스트에 섞인 토큰이 그렇다. `fetch` 가 던진 오류의 `message`·`stack`·`cause` 를 아예
저장하지 않는 것도 같은 이유다(ADR-0053) — 자유 텍스트에는 키가 없어 마스킹이 작동하지 않고,
네트워크 오류 문구에는 실패한 URL 이 통째로 들어가는 경우가 흔하다. 저장하는 것은 닫힌
열거형(`failureKind`·`name`·`code`)뿐이다.

## External 세션

**서버가 밖으로 부르는 HTTP 호출**을 녹화·재생한다. 유료 API 나 부작용이 있는 endpoint 를
부르는 서버가 대상이며, 재생할 때도 **서버 자체는 실제로 뜬다** — 멈추는 것은 서버가 아니라
그 서버가 밖에 부르는 쪽이다.

### 잡는 범위는 `globalThis.fetch` 하나다

첫 어댑터의 이름이 `node.fetch.v1` 이고, 그 이름 안의 `fetch` 가 곧 범위다. 아래는 **범위 밖**이라
녹화도 재생도 되지 않는다.

- `node:http` · `node:https` 직접 호출
- 그 위에 얹힌 axios · got · node-fetch
- Node 가 아닌 서버(Python · Go 등) — 주입이 Node 의 `--import` 훅이라 애초에 닿지 않는다

**범위 밖 호출은 Coordinator 에 도달하지 않는다.** 그래서 재생 중에도 실제 네트워크로 나가고,
막지 못한다. 대신 CLI 가 녹화 0건 · 재생 0건 · 부분 재생 같은 종료 요약으로 그 가능성을 알린다.
범위를 이렇게 정한 이유와 대안 비교는
[ADR-0057](../../docs/adr/0057-external-어댑터는-global-fetch-까지만-가로챈다.md).

### CLI 로 쓰기

**CLI 에서는** 세션 파일 하나가 세션 하나다 — `sessionId` 를 고정값 `"default"` 로 쓴다. Store
자체는 `sessionId` 로 세션을 구분하므로 한 SQLite 파일에 여러 세션을 담을 수 있다(아래 라이브러리
예제 참고). 왕복 예제는 [루트 README](../../README.md#외부-api-를-부르는-서버).

```bash
mcpeak test suite.json --command node --arg ./server.js --record-session weather.session.db
mcpeak test suite.json --command node --arg ./server.js --session weather.session.db
```

### 라이브러리로 쓰기

`@mcpeak/record/external` 이 공개하는 것은 Store 와 Coordinator 둘이다. Coordinator 가 자식에게
실어 줄 환경 변수를 만들고, 그 환경 변수로 뜬 자식의 `fetch` 가 녹화·재생된다.

```ts
import { createSqliteSessionStore, startExternalCoordinator } from "@mcpeak/record/external";

const store = createSqliteSessionStore({ path: "weather.session.db" });
const handle = await startExternalCoordinator({
  mode: "record",
  sessionId: "default",
  store,
});

let status: "completed" | "failed" = "completed";
try {
  // handle.childEnvironment 를 그대로 자식 프로세스의 env 에 실어 띄운다.
  await runServerWith(handle.childEnvironment);
} catch (error) {
  status = "failed";
  throw error;
} finally {
  try {
    const summary = await handle.finish(status);
    console.log(summary.interactionCount);
  } finally {
    store.close();
  }
}
```

재생은 `{ mode: "replay", sourceSessionId, store }` 로 열고, **그 store 는
`createSqliteSessionStore({ path, readOnly: true })` 로 연다.** 재생은 읽기이므로 파일을 만들
이유도 고칠 이유도 없다 — 읽기 전용으로 열지 않으면 스키마 DDL 이 무조건 돌아서, 읽기
전용(chmod 444) 세션은 재생되지 않고 0바이트 파일을 넘기면 실패한 실행이 그 파일을 빈 세션
DB 로 덮어쓴다.

재생은 `{ mode: "replay", sourceSessionId, store }` 로 연다. `finish()` 를 **성공·실패 어느
경로에서도 부르고**, 그 뒤에 `store.close()` 한다 — 안 부르면 SQLite 파일 핸들이 남고 녹화 세션이
`running` 인 채로 남아 다음 실행이 이어 쓸 수 없다. 반환된 요약의 `interactionCount` ·
`consumedCount` · `unusedCount` 가 CLI 종료 알림의 근거다.

### `node:sqlite` 실험 경고

External 세션은 `node:sqlite` 로 저장한다. Node 가 이 모듈을 아직 실험적으로 표시하므로,
런타임에 따라 stderr 에 경고가 한 줄 찍힌다.

```
(node:2845) ExperimentalWarning: SQLite is an experimental feature and might change at any time
```

**프로세스에서 `node:sqlite` 를 처음 로드하는 순간 한 번** 나온다. 세션 하나당도, 호출
하나당도 아니다 — 모듈 로드는 프로세스에서 한 번뿐이라 한 프로세스가 세션을 여러 개 열어도
줄은 하나다. `mcpeak test` 한 번은 프로세스 하나이므로 실행당 최대 한 줄이 된다.

실측한 것은 두 버전이다.

| 런타임 | |
|---|---|
| Node 22.18.0 | 경고가 나온다 |
| Node 24.16.0 | 나오지 않는다 |

그 사이 버전은 재지 않았다. 경고가 어느 패치에서 빠졌는지 모르므로 "22 대는 나오고 24 대는
안 나온다" 로 일반화하지 않는다.

이 경고는 **Node 의 API 표면**에 대한 것이지 저장된 녹화에 대한 것이 아니다. 파일은 헤더가
`SQLite format 3` 인 표준 SQLite 라서 다른 도구로도 열리고, Node 가 바인딩을 바꿔도 그대로
읽힌다. 경고를 지우지 않는 이유와 범위를 좁힌 방법은
[ADR-0056](../../docs/adr/0056-node-sqlite-실험-경고를-external-사용자에게만-보인다.md).

### External 세션은 URL 경로를 저장하지 않는다

마스킹은 **이름**으로 판정한다. URL 경로 세그먼트에는 판정에 쓸 이름이 없어서, 이름 기반
마스킹으로는 무엇이 비밀인지 가릴 수 없다. 그래서 matchKey 를 계산한 **뒤**, 저장 직전에
pathname 을 통째로 지운다.

```
https://hooks.example.com/services/T000/B111/XXXXsecret?token=abc
        ↓ 저장되는 값
https://hooks.example.com/<redacted>?token=[redacted]
```

**표준 URL 필드 넷**에 같은 규칙이 적용된다. `location`·`content-location` 은 상대 참조(RFC
9110, `Location: /hooks/SECRET`)여도 거부하지 않고 응답 URL 기준으로 절대 URL 로 해석한 뒤
같은 규칙으로 지운다. 값 **안에** URL 을 담는 `link`(RFC 8288)·`refresh` 는 문법을 해석해 URL
부분만 같은 규칙으로 지우고 나머지 구조는 남긴다 — pagination 진단(`rel="next"`)이 남아야
해서다.

| 자리 | 적용 |
|---|---|
| 요청 `display.url` | pathname → `<redacted>` |
| 저장 outcome `url` | 위와 같다 |
| `location` 헤더 | 절대 URL 로 해석 후 pathname → `<redacted>` |
| `content-location` 헤더 | 위와 같다 |
| `link` 헤더 | 각 `<URI>` 를 위와 같이 지운다. 파라미터는 `rel` 이 등록 값(`next`·`prev`·`first`·`last`·`self` 등)일 때만 남기고, 그 밖의 `rel` 값과 다른 파라미터(`title`·`type`·`anchor`·확장 파라미터)는 이름째 `param=[redacted]` 로 |
| `refresh` 헤더 | 지연 초는 남기고 `url=` 의 URL 을 위와 같이 지운다. 구분자 뒤에 `url=` 이 없으면 해석 실패로 본다 |

`link`·`refresh` 값이 문법대로 해석되지 않으면 통째로 `[redacted]` 다 — 무엇을 지워야 할지
모르는 값을 원문으로 남기지 않는다. `link` 파라미터 값은 문법상 임의 문자열이라(`title="sk_…"`
도 문법에 맞는다) 이름으로 토큰을 가려낼 수 없어서, 등록된 `rel` 값 외에는 아무 값도 원문으로
남기지 않는다. 파라미터 **이름**도 외부가 정하는 임의 token 이라(`sk_live_…=1`) 같이 지운다.

```
Link: </services/T00/B00/XXXXSECRET?cursor=2>; rel="next"
        ↓ 저장되는 값
Link: <https://hooks.example.com/<redacted>?cursor=2>; rel="next"
```

matchKey 계산에 쓰는 정확한 pathname(매칭 재료)은 **자식 프로세스 밖으로 나가지 않는다** —
Coordinator 로 보내지도, Store 에 실리지도 않는다. `/hooks/AAA` 와 `/hooks/BBB` 는 여전히
다른 matchKey 를 낸다. pathname 이 없어도 매칭 정확도가 변하지 않는 이유다.

**이것이 전부는 아니다.** JSON body 안의 URL 문자열(pagination 의 `next`, HATEOAS 링크)에는
경로가 그대로 남는다. 값의 이름으로 판정할 수 없는 자리라 ADR-0053 도 이를 보장 범위 밖으로
둔다. **자격증명이 어디에 실려 나가든 아래 정리 절차는 똑같이 적용된다.**

Slack·Discord webhook처럼 **경로 자체가 자격증명**인 endpoint를 녹화해도, 그 값은 위 URL
필드·헤더에서는 남지 않는다. 다만 그 endpoint 가 JSON body 로 자기 URL 을 되돌려주면 그
자리로는 여전히 샌다.

### body 의 URL 은 지우지 않고 센다

**지우지 않는 이유는 저장본이 곧 재생 입력이기 때문이다.** `restoreHttpOutcome` 이 저장한
body 를 그대로 서버에게 돌려주므로, 여기서 경로를 지우면 `next` 를 따라가는 서버가 없는
경로로 요청해 재생이 깨진다 — body 에 URL 이 있는 서버, 즉 지켜야 할 바로 그 서버가 깨진다.
근거와 버린 대안들은 [ADR-0062](../../docs/adr/0062-세션-본문의-url-은-지우지-않고-알린다.md).

대신 **녹화가 끝나면 무엇이 남았는지 센다.** 갈래는 둘이다.

| 갈래 | 뜻 |
|---|---|
| 되돌아온 경로 | body 의 URL 이 **그 요청의 경로를 그대로 담고 있다.** 자식이 정확한 경로를 쥐고 판정하므로 추측이 없다 — ADR-0053 이 표준 자리에서 지운 값이 body 로 되돌아왔다는 뜻이다 |
| 그 밖의 URL | 되돌아온 경로는 아니지만 URL 로 해석되는 문자열. 약한 신호다 |

세는 것은 **세션 안에서 서로 다른 URL 의 개수**이고, 값은 어디에도 싣지 않는다 — 부모로
나가는 것은 SHA-256 지문뿐이라 세는 쪽이 URL 을 볼 수 없다. 진단이 새 유출 경로가 되지 않게
하는 형식적 보장이다.

**되돌아온 경로가 1건이라도 잡힌 세션은 커밋하지 마라.** 그 세션에는 ADR-0053 이 지우려던
경로가 body 로 되돌아와 원문으로 들어 있다. 이미 커밋했다면 아래 정리 절차를 따른다.

**이 절 위에 있던 서술("URL 경로가 원문으로 저장된다")은 ADR-0053 의 구현 PR 이전 버전에
해당한다.** 그 시점에 만든 세션 파일에는 경로가 원문으로 남아 있으므로, 아래 정리 절차가
여전히 필요하다.

### 세션 파일에 자격증명이 들어갔을 때

이 문서의 이전 버전(경로 제거 구현 이전)에서 녹화한 세션에는 경로가 원문으로 들어 있다.
**파일을 지우는 것으로 끝나지 않는다.**

1. 세션 파일을 삭제한다.
2. 노출된 자격증명을 **폐기하고 재발급한다.** 커밋했다면 파일을 지워도 git 히스토리에
   남아 있으므로, 그 값은 이미 노출된 것으로 다뤄야 한다.
3. 새 자격증명으로 다시 녹화한다.

## 제외 범위

첫 버전은 사용자 정의 매칭 함수, 사용자 정의 마스킹 규칙, TTL, 부분 매칭을 제공하지 않는다.
필요성이 확인되면 별도 ADR로 확장한다.

**계약 스냅샷(`snapshotContract`)과 비결정 필드 제거도 제공하지 않는다.** 이 패키지는
비결정성을 지워서 감추지 않고, 같은 키에 다른 응답이 오면 경고해서 드러낸다. 실행 간
차이를 판정하는 일은 `runner` 의 결정론성 확인이 맡는다
([ADR-0038](../../docs/adr/0038-결정론성-확인의-비교-대상과-캡처-위치.md)). 근거는
[ADR-0047](../../docs/adr/0047-계약-스냅샷-api-철회.md).
