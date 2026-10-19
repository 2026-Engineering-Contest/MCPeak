**English** · [한국어](./README.ko.md)

# @mcpeak/perf

Splits the time a single MCP tool call takes into **external HTTP wait** and **in-server time**, and tells you in
plain sentences where changing the server code would make it shorter. From the CLI, use it as `mcpeak perf`.

## Installation

```bash
npm install -g @mcpeak/cli
```

`@mcpeak/cli` installs this package as a dependency. Requires Node 22.18 or later.

## Usage

```
mcpeak perf server.suite.json -- node ./server.mjs
mcpeak perf server.suite.json --tool get_forecast -- node ./server.mjs        # one tool only
mcpeak perf server.suite.json --repeat 10 --interval-ms 500 -- node ./server.mjs
mcpeak perf server.suite.json --baseline perf.baseline.json --update-baseline -- node ./server.mjs   # write a baseline
mcpeak perf server.suite.json --baseline perf.baseline.json -- node ./server.mjs                     # compare with it
mcpeak perf server.suite.json --json -- node ./server.mjs                     # result JSON
```

The first argument is the same suite file `mcpeak test` takes. Calling with real inputs a person approved is what
makes the latency of the real code path show up. Only `callTool` cases that do not expect a rejection
(`{ "type": "isError", "expected": true }`) are measured. Each case is called `--repeat` times in a row
(A×5, B×5, …), and the report has one row per case with:

- response time p50 and p95
- external wait p50: the union of the intervals from the start of each HTTP request observed inside the server
  process to the **end of its response body**
- in-server p50: the response time minus the external wait
- external requests per call
- cold start (launch plus handshake, first `tools/list`)

There are two diagnostic rules.

| Rule | What it looks for |
|---|---|
| `perf/sequential-independent` | Requests inside one call that do not depend on an earlier response are sent one after another. It also reports an upper bound on the time sending them in parallel could save |
| `perf/repeated-request` | One call sends the same request more than once, or several cases with different inputs get the same response to the same request every time |

Below is an example after adding a `compare_cities` tool, which looks up three cities one after another, to
`examples/live-weather-server`. The numbers are illustrative. The report is printed in Korean.

```
mcpeak perf 결과
서버 node examples/live-weather-server/server.mjs · 도구 11개 · 관측 Node 프리로드(fetch, node:http, http2, undici)
설정 반복 5회 · 호출 간격 0ms · 케이스 4개 (callTool 중 거절 기대 제외)
콜드 스타트 기동+핸드셰이크 312ms · tools/list 4ms

케이스                  n  응답 p50   p95  외부 대기 p50  서버 안 p50  외부 요청/호출
get-forecast-success    5       287   668            285            2               2
compare-cities-success  5      1310  1702           1301            9               6
lookup-country-success  5         1     3              0            1               0
convert-units-success   0                                                              측정 안 됨: isError 5회

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

> The diagnostic says: inside a `compare_cities` call, 2 independent requests go out one after another (in 5 of
> 5 runs). Sending them in parallel could save at most about 867ms (upper bound at p50). Send them at once with
> Promise.all, together with the other API's concurrency limit and a 429 backoff.

`get_forecast` is a dependency chain that puts the coordinates from the geocoding response into the forecast
request, so it gets no diagnostic. `compare_cities` gets one because the geocoding requests for the second and
third cities do not depend on any earlier response yet are sent in sequence. 867ms is the external wait of 1301ms
minus one city's chain (geocoding plus forecast, about 434ms).

## Options

```
mcpeak perf <suite.json> (-- <executable> [args...] | --command <executable> [--arg <value> ...] [--env <NAME> ...])
            [--repeat <n>] [--interval-ms <ms>] [--tool <name> ...]
            [--baseline <path> [--update-baseline]] [--threshold-pct <n>] [--threshold-ms <n>] [--json]
```

| Option | Default | Meaning |
|---|---|---|
| `<suite.json>` | required | The same suite `test` takes. Uses the `callTool` cases that do not expect a rejection |
| target options | required | `--`, or `--command`/`--arg`/`--env`. Same as `mcpeak test`. `--url` and `--header-env` are rejected |
| `--repeat <n>` | 5 | Calls per case. An integer from 1 to 100 |
| `--interval-ms <ms>` | 0 | Wait between calls. An integer from 0 to 60000. Shown in the report's settings line |
| `--tool <name>` | none | Repeatable. Only the cases for that tool |
| `--baseline <path>` | none | The baseline file. Compared against when given; written when combined with `--update-baseline` |
| `--update-baseline` | off | Writes the baseline file from this measurement. Does not compare |
| `--threshold-pct <n>` | 50 | The ratio part of the in-server regression threshold. An integer from 0 to 1000 |
| `--threshold-ms <n>` | 20 | The floor of the in-server regression threshold. An integer from 0 to 60000 |
| `--json` | off | Prints only the report JSON to stdout |

Options that take a value accept both `--x v` and `--x=v`. Every option except `--tool` is rejected when given
twice. Options only `test` has (`--junit`, `--repair-bundle`, `--determinism`, `--reset-cmd`, `--stderr-lines`,
`--session`, `--record-session`) are not accepted.

Because `--interval-ms` defaults to 0, a server with a rate limiter may show that wait as in-server time. Any
positive default would pretend to know that server's limit, so the default is 0 and the settings line states it so
the reader can judge.

A baseline comparison checks two things for every case present in both the baseline and this run.

- In-server p50 above `baseline × (1 + threshold-pct / 100) + threshold-ms` is a regression. By default that is
  1.5 times the baseline plus 20ms.
- External requests per call (p50) going up by even one is a regression.

Response time and external wait are compared and shown, but not judged. External wait swings with the network
regardless of the server code.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Measurement finished. Still 0 when there are diagnostics |
| 2 | Baseline regression (in-server time, external request count, or a case in the baseline that could not be measured this time) |
| 1 | Usage error, connection failure, suite error, missing or malformed baseline file. Also 1, after the report is printed, when `--baseline` is given but no external calls could be observed |

A run where the call throws, times out, returns `isError: true`, or returns an empty response is left out of the
latency statistics and counted separately. After a timeout the server may still be working on that call and would
mix its requests into later measurements, so the remaining calls are skipped, the measurement ends, and the report
says so.

## Limitations

- **Remote (Streamable HTTP) servers are not measured.** The observation code can only be loaded into a server
  process this tool starts, so `--url` is rejected.
- **Only Node servers are split.** Observation is a preload loaded into the server process through
  `NODE_OPTIONS=--import`, which other runtimes such as Python do not pick up. For those, only response time and
  cold start are reported, and the report says nothing was observed.
- **Paths whose bodies are not visible cannot be judged for dependency.** Direct `node:http` (axios, node-fetch,
  and so on), http2, and undici requests show their timing but not their bodies, so the sequential independence
  check counts them as "cannot judge". It errs toward no false warning.
- **In-server time is not "server processing".** It also includes rate limiter and timer waits, DNS lookups and
  first connection TLS outside the observed channels, and stdio transport.
- **The numbers belong to that computer and that network.** There is no mode yet that replays recorded external
  call durations to remove external variance. Compare before and after under the same conditions with
  `--baseline`.
- **It is not a load tool.** It calls one at a time, so it does not measure throughput or concurrency limits. It
  does not fix diagnostics automatically either.

Reports and baseline files never carry request or response headers or bodies, and URLs only appear with query
values masked as `…`. The same trace and the same measurements always produce byte-identical reports. The latency
numbers themselves are measurements and differ from run to run.

The design and its evidence are in `docs/2026-10-18-perf-지연-분해-설계.md` and ADR-0118 (written in Korean).
