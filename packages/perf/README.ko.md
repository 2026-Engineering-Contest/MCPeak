[English](./README.md) · **한국어**

# @mcpeak/perf

MCP 서버의 도구 호출 하나가 걸린 시간을 **외부 HTTP 대기**와 **서버 안 시간**으로 나누고, 서버 코드를 고치면
줄어들 자리를 문장으로 알려 준다. CLI 에서는 `mcpeak perf` 로 쓴다.

## 설치

```bash
npm install -g @mcpeak/cli
```

`@mcpeak/cli` 가 이 패키지를 의존성으로 함께 설치한다. Node 22.18 이상이 필요하다.

## 사용

```
mcpeak perf server.suite.json -- node ./server.mjs
mcpeak perf server.suite.json --tool get_forecast -- node ./server.mjs        # 한 도구만
mcpeak perf server.suite.json --repeat 10 --interval-ms 500 -- node ./server.mjs
mcpeak perf server.suite.json --baseline perf.baseline.json --update-baseline -- node ./server.mjs   # 기준 만들기
mcpeak perf server.suite.json --baseline perf.baseline.json -- node ./server.mjs                     # 기준과 비교
mcpeak perf server.suite.json --json -- node ./server.mjs                     # 결과 JSON
```

첫 인자는 `mcpeak test` 와 같은 명세 파일이다. 사람이 승인한 실제 입력으로 불러야 실제 경로의 지연이 나오기
때문이다. 명세의 `callTool` 케이스 가운데 거절(`{ "type": "isError", "expected": true }`)을 기대하지 않는
케이스만 잰다. 케이스마다 `--repeat` 회를 연속으로 부르고(A×5, B×5, …), 케이스별로 다음을 표로 낸다.

- 응답 시간 p50·p95
- 외부 대기 p50: 서버 프로세스 안에서 관측한 HTTP 요청의 시작부터 **응답 본문 끝**까지 구간의 합집합
- 서버 안 p50: 응답 시간에서 외부 대기를 뺀 나머지
- 호출당 외부 요청 수
- 콜드 스타트(기동+핸드셰이크, 첫 `tools/list`)

진단 규칙은 두 개다.

| 규칙 | 보는 것 |
|---|---|
| `perf/sequential-independent` | 한 호출 안에서 앞 응답과 무관한 요청이 순차로 나간다. 병렬로 보냈을 때 줄일 수 있는 시간의 상한을 함께 낸다 |
| `perf/repeated-request` | 한 호출 안에서 같은 요청을 여러 번 보내거나, 입력이 다른 여러 케이스가 매번 같은 요청에 같은 응답을 받는다 |

아래는 `examples/live-weather-server` 에 도시 셋을 차례로 조회하는 `compare_cities` 도구를 더한 뒤의 예시다.
수치는 설명용이다.

```
mcpeak perf 결과
서버 node examples/live-weather-server/server.mjs · 도구 11개 · 관측 Node 프리로드(fetch, node:http, http2, undici)
설정 반복 5회 · 호출 간격 0ms · 케이스 4개 (callTool 중 거절 기대 제외)
콜드 스타트 기동+핸드셰이크 312ms · tools/list 4ms

케이스                  n  응답 p50   p95  외부 대기 p50  서버 안 p50  외부 요청/호출
get-forecast-success    5       287   668            285            2               2
compare-cities-success  5      1310  1702           1301            9               6
lookup-country-success  5         1     3              0            1               0
convert-units-success   0                                                              측정 안 됨: threw 5회. 첫 오류: MCP error -32602: Output validation error: Invalid structured content for tool convert_units: Invalid input: expected number, received undefined at converted

진단 1건 (종료 코드에 영향 없음)
→ 'compare_cities' 호출 안에서 독립 요청 2건이 순차로 나갑니다 (5회 중 5회): GET geocoding-api.open-meteo.com/v1/search?name=…&count=…&language=… ×2
→ 병렬로 보내면 최대 약 867ms 줄일 수 있습니다 (p50 기준 상한).
→ Promise.all 로 한 번에 보내고, 상대 API 의 동시 요청 한도와 429 백오프를 함께 두세요.

기준선 비교 (perf.baseline.json)
→ 회귀 없음. 서버 안 p50 은 기준의 1.5배+20ms 안이고 외부 요청 수는 기준 이하입니다.

외부 대기는 서버 프로세스 안에서 관측한 HTTP 요청(fetch·node:http·http2·undici)의 시작부터 응답 본문 끝까지의 합집합입니다.
서버 안 시간은 응답 시간에서 그것을 뺀 나머지이고, 처리뿐 아니라 레이트리미터·타이머 대기, 첫 연결의 TLS, stdio 전송이 들어 있습니다.
수치는 이 컴퓨터와 이 네트워크에서 잰 값입니다. 전후 비교는 같은 조건에서 --baseline 으로 하세요.
```

`get_forecast` 는 지오코딩 응답의 좌표를 예보 요청에 넣는 의존 체인이라 진단이 나지 않는다. `compare_cities`
는 2·3번째 도시의 지오코딩이 앞 응답과 무관한데 순차로 나가서 진단이 난다. 867ms 는 외부 대기 1301ms 에서
도시 한 개의 체인(지오코딩+예보, 약 434ms)을 뺀 값이다.

## 옵션

```
mcpeak perf <suite.json> (-- <executable> [args...] | --command <executable> [--arg <value> ...] [--env <NAME> ...])
            [--repeat <n>] [--interval-ms <ms>] [--tool <name> ...]
            [--baseline <path> [--update-baseline]] [--threshold-pct <n>] [--threshold-ms <n>] [--json]
```

| 옵션 | 기본 | 뜻 |
|---|---|---|
| `<suite.json>` | 필수 | `test` 와 같은 명세. `callTool` 중 거절 기대가 아닌 케이스를 쓴다 |
| 대상 옵션 | 필수 | `--`, `--command`/`--arg`/`--env`. `mcpeak test` 와 같다. `--url`·`--header-env` 는 거절 |
| `--repeat <n>` | 5 | 케이스당 호출 수. 1 이상 100 이하 정수 |
| `--interval-ms <ms>` | 0 | 호출 사이 대기. 0 이상 60000 이하 정수. 리포트 설정 줄에 표시 |
| `--tool <name>` | 없음 | 반복 가능. 그 도구의 케이스만 |
| `--baseline <path>` | 없음 | 기준 파일. 있으면 비교, `--update-baseline` 과 함께면 쓰기 |
| `--update-baseline` | 꺼짐 | 측정 결과로 기준 파일을 쓴다. 비교하지 않는다 |
| `--threshold-pct <n>` | 50 | 서버 안 회귀 임계의 비율. 0 이상 1000 이하 정수 |
| `--threshold-ms <n>` | 20 | 서버 안 회귀 임계의 바닥. 0 이상 60000 이하 정수 |
| `--json` | 꺼짐 | stdout 에 리포트 JSON 하나만 |

값을 받는 옵션은 `--x v` 와 `--x=v` 를 모두 받는다. `--tool` 외에는 두 번 주면 거절한다. `test` 전용 옵션
(`--junit`, `--repair-bundle`, `--determinism`, `--reset-cmd`, `--stderr-lines`, `--session`, `--record-session`)은
받지 않는다.

`--interval-ms` 의 기본이 0 이라, 서버에 레이트리미터가 있으면 그 대기가 서버 안 시간으로 보일 수 있다. 어떤
양수도 그 서버의 한도를 아는 척하는 값이라 기본을 0 으로 두고, 설정 줄에 적어 읽는 사람이 판단하게 한다.

기준선 비교는 기준과 현재에 모두 있는 케이스마다 두 가지를 본다.

- 서버 안 p50 이 `기준 × (1 + threshold-pct / 100) + threshold-ms` 를 넘으면 회귀다. 기본으로는 기준의 1.5배+20ms.
- 호출당 외부 요청 수 p50 이 기준보다 하나라도 늘면 회귀다.

응답 시간과 외부 대기는 비교해서 보여주기만 하고 판정에 넣지 않는다. 외부 대기는 네트워크 변동이 커서 서버
코드와 무관하게 흔들리기 때문이다.

## 종료 코드

| 코드 | 뜻 |
|---|---|
| 0 | 측정 완료. 진단이 있어도 0 이다 |
| 2 | 기준선 회귀(서버 안 시간, 외부 요청 수, 기준에 있던 케이스가 이번에 측정 불가) |
| 1 | 사용 오류, 연결 실패, 명세 오류, 기준 파일 없음·형식 오류. 외부 호출을 관측하지 못했는데 `--baseline` 을 준 경우도 리포트를 낸 뒤 1 이다 |

측정 중 호출이 던지거나, 타임아웃이 나거나, `isError: true` 이거나, 응답이 비면 그 반복은 지연 통계에서 빼고
따로 센다. 타임아웃이 나면 서버가 아직 그 호출을 처리하고 있어 뒤 호출의 측정이 섞이므로, 남은 호출을 부르지
않고 측정을 끝낸 뒤 그 사실을 리포트에 적는다.

## 한계

- **원격(Streamable HTTP) 서버는 재지 않는다.** 관측 코드는 이 도구가 띄운 서버 프로세스에만 실을 수 있어
  `--url` 을 거절한다.
- **Node 서버만 분해한다.** 관측은 `NODE_OPTIONS=--import` 로 서버 프로세스에 싣는 프리로드라, Python 등 다른
  런타임에는 실리지 않는다. 그때는 응답 시간과 콜드 스타트만 내고 리포트에 "관측 안 함" 으로 적는다.
- **본문이 안 보이는 경로는 의존 여부를 가리지 못한다.** `node:http`(axios, node-fetch 등)·http2·undici 직접
  요청은 시각은 보이지만 본문이 안 보여, 순차 독립 판정에서 "판정 불가" 로 센다. 거짓 경고를 내지 않는 쪽이다.
- **서버 안 시간은 "서버 처리" 가 아니다.** 레이트리미터·타이머 대기, 채널 밖 DNS 조회와 첫 연결의 TLS, stdio
  전송이 함께 들어 있다.
- **수치는 그 컴퓨터와 그 네트워크의 값이다.** 녹화한 외부 호출 시간을 재생해 외부 변동을 없애는 비교는 아직
  없다. 전후 비교는 같은 조건에서 `--baseline` 으로 한다.
- **부하 도구가 아니다.** 한 번에 하나씩 부르므로 처리량이나 동시성 한계는 재지 않는다. 진단을 자동으로
  고치지도 않는다.

리포트와 기준 파일에는 요청·응답 헤더와 본문을 싣지 않고, URL 은 쿼리 값을 `…` 로 가린 모양만 싣는다. 같은
추적과 같은 측정값을 넣으면 리포트가 바이트 단위로 같다. 지연 수치 자체는 측정값이라 실행마다 다르다.

설계와 근거는 `docs/2026-10-18-perf-지연-분해-설계.md` 와 ADR-0117 에 있다.
