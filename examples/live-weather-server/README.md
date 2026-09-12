# example-live-weather-server

mcpeak 의 **전 과정을 한 서버로 보여주는** 데모용 예제 MCP 서버. **stdio** 트랜스포트로 동작하고,
툴 10개가 각자 다른 단계를 맡는다. 일부는 **실제 공개 API 를 `fetch` 로 부르고**, 일부는 로컬에서
결정론적으로 동작하며, 세 곳에는 **일부러 둔 결함**이 있다.

```bash
node examples/live-weather-server/server.mjs
```

## 툴

| 툴 | 종류 | 입력 | 보여주는 것 |
|---|---|---|---|
| `get_forecast` | 외부 (Open-Meteo, fetch 2회) | `city` | 호출마다 기온이 바뀐다. 재생이 그것을 고정한다 |
| `convert_currency` | 외부 (Frankfurter) | `amount, from, to` | 환율 날짜가 날마다 바뀐다 |
| `search_city` | 외부 (Open-Meteo 지오코딩) | `query`, `count`(default 5), `language`(enum) | baseline 이 `default` · `enum` 에서 값을 고르는 자리 |
| `list_recent_quakes` | 외부 (USGS) | `minMagnitude`(default 5), `hours`(default 24) | 요청 URL 에 **현재 시각**을 넣는다. 재생 때 "재현 가능하지 않다" 진단이 뜨는 툴 |
| `add_note` | 로컬, 파일 상태 | `title, body, tags[]` | `--determinism` 이 `id` 차이를 잡고 `--reset-cmd` 로 통과한다 |
| `list_notes` | 로컬, 파일 상태 | `tag?` | 위 파일을 읽는다 |
| `convert_units` | 로컬 | `value`, `from` · `to`(enum) | **결함 A** |
| `summarize_text` | 로컬 | `text`, `options: { maxWords, style }` | 중첩 객체 baseline. **결함 B** |
| `lookup_country` | 로컬 정적 표 | `code`(enum), `fields[]`(enum 배열) | **결함 C** |
| `evaluate_expression` | 로컬 | `expression` | baseline 자리값 `"example"` 이 실패하고 AI 사전보완이 값을 제안하는 툴 |

외부 API 는 전부 무료·무인증이다. 로컬 툴은 네트워크 없이 돈다.

## 일부러 둔 결함 세 곳

`mcpeak test` 가 잡고 `mcpeak repair` 가 원인을 짚는 장면을 위한 것이다. `server.mjs` 안에
`// 결함 A` · `// 결함 B` · `// 결함 C` 표식이 있고, 각각 **한 줄만 고치면** 사라진다.

| 결함 | 툴 | 무엇이 틀렸나 | test 가 잡는 케이스 | 고치는 법 |
|---|---|---|---|---|
| A | `convert_units` | `outputSchema` 는 `converted` 를 선언하는데 `structuredContent` 에 `result` 로 싣는다 | `convert-units-success` | `result:` → `converted:` |
| B | `summarize_text` | 필수 필드 `text` 가 빠져도 거절하지 않고 빈 요약을 돌려준다 | `summarize-text-missing-text` | `body === undefined` 를 `fail` 로 보낸다 |
| C | `lookup_country` | enum 밖의 코드에 `isError: false` 로 `not found` 를 돌려준다 | `lookup-country-enum-code` | `text(...)` → `fail(...)` |

결함 A 의 실패 문장은 SDK 가 만든다. MCP SDK 클라이언트가 `structuredContent` 를 `outputSchema`
로 검증해 `MCP error -32602: Structured content does not match the tool's output schema` 를 던지고,
mcpeak 은 그 오류를 그대로 실패 원인으로 보여준다.

결함 셋을 다 고치면 baseline 스위트에서 `evaluate-expression-success` 하나만 실패로 남는다.
그 케이스는 결함이 아니라 자리값 `"example"` 이 유효한 수식이 아닌 것이고, generate 의 AI
사전보완이 `2 + 2` 같은 값을 제안해 채우는 자리다.

## 상태 파일

`add_note` · `list_notes` 는 `~/.live-weather-notes.json` 에 쓰고 읽는다. 서버를 다시 띄워도 남는다.

`os.tmpdir()` 을 쓰지 않는다. MCP SDK 는 자식 프로세스에 `HOME` · `PATH` 등 고정 목록만 넘기고
`TMPDIR` 은 넘기지 않아서, 서버는 `/tmp` 를 보고 부모 셸은 `/var/folders/…` 를 보는 식으로
어긋난다. 그러면 `--reset-cmd` 가 엉뚱한 파일을 지운다. `HOME` 은 양쪽이 같다.

## 데모 순서

```bash
SRV=examples/live-weather-server/server.mjs

# 1. 명세 생성. 시험 실행과 승인 화면을 거치면 승인 지문이 찍힌다.
#    evaluate_expression 의 자리값은 AI 사전보완(--provider)이 채운다.
mcpeak generate --out live-weather.suite.json --command node --arg $SRV --provider claude --model sonnet

# 2. 실행. 결함 A · B · C 가 각자 다른 문장으로 실패한다.
mcpeak test live-weather.suite.json --command node --arg $SRV --repair-bundle repair.json

# 3. repair 가 번들을 보고 원인 후보를 짚는다. 서버 코드는 고치지 않는다.
mcpeak repair repair.json --provider claude --model sonnet

# 4. 표식 세 줄을 고친 뒤 다시 실행하면 녹색이다.

# 5. 녹화. 외부 호출 5건이 세션에 저장된다.
mcpeak test live-weather.suite.json --command node --arg $SRV --record-session live-weather.session.json

# 6. 재생. 네트워크 없이 같은 결과가 나온다. list_recent_quakes 만 "재현 가능하지 않다" 로 진단된다.
mcpeak test live-weather.suite.json --command node --arg $SRV --session live-weather.session.json

# 7. 결정론. add_note 의 id 가 회차마다 달라진다. 초기화 명령을 주면 같아진다.
mcpeak test live-weather.suite.json --command node --arg $SRV --determinism
mcpeak test live-weather.suite.json --command node --arg $SRV --determinism --reset-cmd "rm -f $HOME/.live-weather-notes.json"
```

`server.suite.json` 은 `--baseline-only --no-dry-run` 으로 뽑은 baseline 이다. 승인 지문이 없으므로
그 파일로 `repair` 를 부르면 명세 쪽 원인도 함께 후보로 본다(ADR-0032). 데모에서는 1번처럼
직접 생성해 승인 지문을 찍는 것을 권한다.

대시보드에서는 홈 실행 폼의 「External 세션」에서 갈래(외부 호출 녹화 / 녹화본 재생)와 세션
파일 경로를 고르면 같은 argv 가 만들어진다.

## 왜 `weather-server` 와 따로 있나

`weather-server` 는 고정 데이터라 결정론적이고, 그래서 CI 도그푸딩 대상이다. 이 서버는 외부에
기대는 툴과 파일 상태를 가진 툴이 있어 같은 입력에 항상 같은 응답이 나오지 않는다. **그
비결정성이 External 세션과 `--determinism` 이 해결하는 문제**라, 그것을 보여주려면 실제로
흔들리는 서버가 필요하다.

CI 에는 넣지 않는다. 외부 API 에 기대는 순간 CI 가 그 API 의 가용성에 묶인다.

## 지킨 것

- **`globalThis.fetch` 만 쓴다.** `@mcpeak/record` 가 가로채는 경계가 그것 하나다(ADR-0057).
  `node:http`·axios 로 부르면 녹화되지 않고, 재생 중 실제 네트워크로 나간다.
- **실패 경로가 있다.** 모르는 도시, 모르는 통화 코드, 해석 못 하는 수식, 종류가 다른 단위는
  `isError: true` 와 함께 무엇을 고쳐야 하는지 말한다.
- **저수준 `Server` 를 쓴다.** JSON Schema 를 그대로 넘기고 zod 의존성을 붙이지 않는다.
  `outputSchema` 를 선언한 툴은 같은 값을 `structuredContent` 에도 싣는다.

## 한계

- Open-Meteo 지오코딩은 한글 `서울` 을 못 찾는다(`부산`·`제주`·`Seoul` 은 찾는다). 스키마의
  `examples` 가 `부산` 인 이유다. 데모에서 도시를 바꿀 때는 먼저 한 번 실행해 찾히는지 본다.
- `list_recent_quakes` 는 재생이 어긋나는 것이 **의도**다. 깨끗한 재생 장면이 필요하면 그 툴의
  케이스를 스위트에서 뺀다.
