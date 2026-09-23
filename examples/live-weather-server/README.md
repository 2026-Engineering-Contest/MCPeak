# example-live-weather-server

mcpeak 의 **전 과정을 한 서버로 보여주는** 데모용 예제 MCP 서버. **stdio** 트랜스포트로 동작하고,
툴 10개가 각자 다른 단계를 맡는다. 일부는 **실제 공개 API 를 `fetch` 로 부르고**, 일부는 로컬에서
결정론적으로 동작하며, 한 곳에는 **일부러 둔 결함**이 있다. `McpServer.registerTool` 에 zod 스키마를
넘겨 SDK 가 JSON Schema 를 만들고 인자를 검증하는 경로를 쓴다(`zod-notes-server` 와 같은 조합).

```bash
node examples/live-weather-server/server.mjs
```

## 툴

| 툴 | 종류 | 입력 | 보여주는 것 |
|---|---|---|---|
| `get_forecast` | 외부 (Open-Meteo, fetch 2회) | `city` | 호출마다 기온이 바뀐다. 재생이 그것을 고정한다 |
| `convert_currency` | 외부 (Frankfurter) | `amount, from, to` | 환율 날짜가 날마다 바뀐다 |
| `search_city` | 외부 (Open-Meteo 지오코딩) | `query`, `count`(default 5), `language`(enum) | baseline 이 `default` · `enum` 에서 값을 고르는 자리 |
| `list_recent_quakes` | 외부 (USGS) | `minMagnitude`(default 5), `limit`(default 10) | 최근 N건. 요청에 시각을 넣지 않아 재생이 맞는다 |
| `add_note` | 로컬, 파일 상태 | `title, body, tags[]` | `--determinism` 이 `id` 차이를 잡고 `--reset-cmd` 로 통과한다 |
| `list_notes` | 로컬, 파일 상태 | `tag?` | 위 파일을 읽는다 |
| `convert_units` | 로컬 | `value`, `from` · `to`(enum, 길이·질량·온도) | **결함 A**. enum 정상 분기 4건이 함께 실패한다 |
| `summarize_text` | 로컬 | `text`, `options: { maxWords, style }` | 중첩 객체 baseline. 필수 `text` 누락은 zod 가 `-32602` 로 막는다 |
| `lookup_country` | 로컬 정적 표 | `code`(enum), `fields[]`(enum 배열) | enum 밖 코드는 zod 가 `-32602` 로 막는다 |
| `evaluate_expression` | 로컬 | `expression` | baseline 자리값 `"example"` 이 실패하고 AI 사전보완이 값을 제안하는 툴 |

외부 API 는 전부 무료·무인증이다. 로컬 툴은 네트워크 없이 돈다.

## 일부러 둔 결함 한 곳

`mcpeak test` 가 잡고 `mcpeak repair` 가 원인을 짚는 장면을 위한 것이다. `server.mjs` 안에
`// 결함 A` 표식이 있고 **한 줄만 고치면** 사라진다.

| 결함 | 툴 | 무엇이 틀렸나 | test 가 잡는 케이스 | 고치는 법 |
|---|---|---|---|---|
| A | `convert_units` | `outputSchema` 는 `converted` 를 선언하는데 `structuredContent` 에 `result` 로 싣는다 | `convert-units-success` | `result:` → `converted:` |

결함 A 의 실패 문장은 SDK 가 만든다. `McpServer` 가 핸들러의 `structuredContent` 를 `outputSchema`
로 검증해 `MCP error -32602: Output validation error: Invalid structured content for tool
convert_units: Invalid input: expected number, received undefined at converted` 를 던지고, mcpeak 은
그 오류를 그대로 실패 원인으로 보여준다.

결함 A 는 `convert_units` 케이스 5건(기준 정상 1건 + `from`·`to` 의 정상 분기 4건)을 한꺼번에
떨어뜨린다. 응답 모양이 틀렸으니 어떤 입력이든 같은 이유로 실패한다.

저수준 `Server` 로 짜던 시절에는 결함 B(`summarize_text` 가 필수 `text` 누락을 거절하지 않음)와
C(`lookup_country` 가 enum 밖 코드에 정상 응답)도 있었다. zod 로 옮기면서 둘 다 사라졌다. SDK 가
핸들러에 닿기 전에 인자를 검증하므로 스키마가 곧 거절이고, 그 종류의 결함은 만들 수 없다.
`summarize-text-missing-text` · `lookup-country-enum-code` 케이스는 그래서 통과한다.

결함 A 를 고치면 baseline 스위트(`server.suite.json`)에서 `evaluate-expression-success` 하나만
실패로 남는다. 그 케이스는 결함이 아니라 자리값 `"example"` 이 유효한 수식이 아닌 것이고,
generate 의 AI 사전보완이나 시험 실행 뒤 교정이 `(2 + 3) * 4 / 5` 같은 값을 제안해 채우는
자리다. AI 로 생성한 명세는 그 값이 들어가 있으므로 결함 A 를 고치면 전부 녹색이다.

## 상태 파일

`add_note` · `list_notes` 는 `~/.live-weather-notes.json` 에 쓰고 읽는다. 서버를 다시 띄워도 남는다.

`os.tmpdir()` 을 쓰지 않는다. MCP SDK 는 자식 프로세스에 `HOME` · `PATH` 등 고정 목록만 넘기고
`TMPDIR` 은 넘기지 않아서, 서버는 `/tmp` 를 보고 부모 셸은 `/var/folders/…` 를 보는 식으로
어긋난다. 그러면 `--reset-cmd` 가 엉뚱한 파일을 지운다. `HOME` 은 양쪽이 같다.

## 데모 순서

**`mcpeak` 을 그대로 치지 않는다.** `PATH` 의 `mcpeak` 은 npm 에 배포된 버전이라 이 저장소의
main 보다 뒤에 있고, 이 명세의 `structuredContentMatchesSchema` 단언과 repair 번들 형식 3 을
모른다. `pnpm build --force` 로 `Cached: 0 cached` 를 확인한 뒤 로컬 산출물을 쓴다.

```bash
MCPEAK="node packages/cli/dist/cli.mjs"
SRV=examples/live-weather-server/server.mjs
RESET="rm -f $HOME/.live-weather-notes.json"

# 1. 명세 생성. 시험 실행과 승인 화면을 거치면 승인 지문이 찍힌다.
#    --reset-cmd 가 없으면 AI 사전보완은 "두 후보를 같은 초기 상태에서 실행할 수 없다" 며
#    비교를 통째로 건너뛴다(add_note 가 파일 상태를 바꾸기 때문이다). 그러면 evaluate_expression
#    의 자리값은 사전보완이 아니라 시험 실행 뒤 교정 단계에서 채워진다. 둘 다 같은 값을 낸다.
$MCPEAK generate --out live-weather.suite.json --command node --arg $SRV \
  --provider claude --model sonnet --reset-cmd "$RESET"

# 2. 실행. 결함 A 가 convert_units 5건을 떨어뜨린다.
$MCPEAK test live-weather.suite.json --command node --arg $SRV --repair-bundle repair.json

# 3. repair 가 번들을 보고 원인 후보를 짚는다. 서버 코드는 고치지 않는다. 1분 안팎 걸린다.
$MCPEAK repair repair.json --provider claude --model sonnet

# 4. 표식 한 줄을 고친 뒤 다시 실행하면 녹색이다.

# 5. 녹화. 외부 호출 12건이 세션에 저장된다(get_forecast 2 · convert_currency 1 · search_city 4 ·
#    list_recent_quakes 5). 끝에 "세션 파일 본문에 URL 이 남아 있다" 는 알림이 붙는데 오류가 아니다.
#    이 서버의 외부 API 는 자격증명이 없으므로 그대로 두면 된다.
$MCPEAK test live-weather.suite.json --command node --arg $SRV --record-session live-weather.session.json

# 6. 재생. 네트워크 없이 녹화 때와 같은 결과가 나온다. 실패도 녹화 때와 같은 6건뿐이다.
#    요청이 입력만으로 정해지므로 외부 호출 12건 전부 녹화본에서 찾는다.
$MCPEAK test live-weather.suite.json --command node --arg $SRV --session live-weather.session.json

# 7. 결정론. add_note 의 id 가 회차마다 달라진다. 초기화 명령을 주면 같아진다.
#    외부 툴은 두 회차 사이에 실제 데이터(기온·환율·지진 목록)가 바뀌면 그만큼 차이로 보인다.
$MCPEAK test live-weather.suite.json --command node --arg $SRV --determinism
$MCPEAK test live-weather.suite.json --command node --arg $SRV --determinism --reset-cmd "$RESET"
```

`server.suite.json` 으로 2번부터 시작해도 된다. 그 경우 실패는 결함 A 5건에
`evaluate-expression-success` 가 더해져 6건이다.

`server.suite.json` 은 `--baseline-only --no-dry-run` 으로 뽑은 baseline 이다. 승인 지문이 없으므로
그 파일로 `repair` 를 부르면 명세 쪽 원인도 함께 후보로 본다(ADR-0032). 데모에서는 1번처럼
직접 생성해 승인 지문을 찍는 것을 권한다.

대시보드에서는 Test 폼의 「External 세션」에서 녹화를, Replay 탭에서 재생을 고르면 같은 argv 가
만들어진다. Generate 2단계의 저장 위치 기본값은 이 디렉터리의 `server.suite.json` 이다. 그대로
두면 추적 파일을 덮어쓰므로 `.mcpeak/` 아래 경로로 바꾼다. 이 디렉터리에 `server.suite_*.json`
같은 이름으로 만든 일회성 명세는 gitignore 되지만 대시보드 목록에는 그대로 뜨니 촬영 전에
지운다.

## 왜 `weather-server` 와 따로 있나

`weather-server` 는 고정 데이터라 결정론적이고, 그래서 CI 도그푸딩 대상이다. 이 서버는 외부에
기대는 툴과 파일 상태를 가진 툴이 있어 같은 입력에 항상 같은 응답이 나오지 않는다. **그
비결정성이 External 세션과 `--determinism` 이 해결하는 문제**라, 그것을 보여주려면 실제로
흔들리는 서버가 필요하다.

CI 에는 넣지 않는다. 외부 API 에 기대는 순간 CI 가 그 API 의 가용성에 묶인다.

## 지킨 것

- **`globalThis.fetch` 만 쓴다.** `@mcpeak/record` 가 가로채는 경계가 그것 하나다(ADR-0057).
  `node:http`·axios 로 부르면 녹화되지 않고, 재생 중 실제 네트워크로 나간다.
- **요청에 현재 시각을 넣지 않는다.** 재생이 요청 해시로 응답을 찾기 때문이다(위 한계 참고).
- **실패 경로가 있다.** 모르는 도시, 모르는 통화 코드, 해석 못 하는 수식, 종류가 다른 단위는
  `isError: true` 와 함께 무엇을 고쳐야 하는지 말한다.
- **`McpServer` + zod 를 쓴다.** `registerTool` 에 zod 스키마를 넘겨 SDK 가 JSON Schema 를
  만들고 인자를 검증한다. 핸들러는 스키마로 못 적는 의미 검증만 맡는다. `outputSchema` 를
  선언한 툴은 같은 값을 `structuredContent` 에도 싣는다.

## 한계

- Open-Meteo 지오코딩은 한글 `서울`·`제주` 를 못 찾는다(`부산`·`Seoul`·`Tokyo` 는 찾는다).
  스키마의 `examples` 가 `부산` 인 이유다. 데모에서 도시를 바꿀 때는 먼저 한 번 실행해 찾히는지
  본다. IPv6 가 막힌 망에서는 서버 상단의 `ipv4first` 가 없으면 `ETIMEDOUT` 이 난다. 그 줄을
  지우지 않는다.
- `list_recent_quakes` 는 예전에 요청 URL 에 `starttime=<현재 시각>` 을 넣어 재생 때 "재생 원본에서
  찾지 못한 호출" 로 실패했다. 재생은 요청(메서드·URL·본문)의 해시로 응답을 찾으므로 요청에
  실행마다 바뀌는 값이 들어가면 같은 입력이라도 못 찾는다. 지금은 `limit` 으로 최근 N건을 받아
  요청이 입력만으로 정해진다. 사용자 서버가 같은 패턴이면 재생이 그 툴만 떨어지고, 세션 요약에
  빠진 요청 URL 이 실린다.
- `convert_units` 의 enum 순서(`km · m · kg · lb · c · f · mi`)는 generate 의 정상 분기 규칙에
  맞춘 것이다. generate 는 enum 의 첫·두 번째·마지막 값을 밟으면서 상대 필드를 기준값에
  고정하므로, 그 세 값이 같은 종류가 아니면 `f → km` 같은 케이스가 생겨 서버가 옳게 거절해도
  영원히 실패한다. **도구는 enum 값 사이의 관계를 모른다.** 사용자 서버에서 같은 일이 나면
  승인 화면에서 그 케이스를 `[m]` 로 빼는 수밖에 없다. 그 출구를 도구에 넣는 일은 후속이다.
