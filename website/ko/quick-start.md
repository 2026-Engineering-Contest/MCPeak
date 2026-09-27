# 빠른 시작

이 문서를 끝내면 `mcpeak` 이 설치되고, JSON 명세 하나로 MCP 서버를 띄워 검증한 뒤 통과·실패
보고서를 터미널에서 직접 본 상태가 된다.

## 요구 사항

- Node.js 22.18 이상. CI 는 22.18.0 과 24 에서 검사한다.
- 테스트할 MCP 서버. 없어도 된다. [목 서버](/ko/guide/mock-server)로 시작할 수 있다.

## 설치

```bash
npm install -g @mcpeak/cli
```

설치하면 `mcpeak` 명령이 `PATH` 에 놓인다. 한 번만 쓸 거라면 설치 없이 `npx @mcpeak/cli test ...`
도 된다.

목 서버와 웹 UI 는 별도 패키지다. 전역 설치는 그 패키지 자신의 실행 파일만 `PATH` 에 놓으므로,
의존성으로 딸려 와도 `mcpeak-mock` · `mcpeak-dashboard` 명령은 따로 설치해야 생긴다.

```bash
npm install -g @mcpeak/cli @mcpeak/mock @mcpeak/dashboard
```

## 확인

```bash
mcpeak --help
```

첫 줄은 다음과 같다.

```
MCPeak — MCP 서버 테스트 프레임워크
```

`mcpeak --version` 은 설치된 버전을 찍는다. 도움말과 버전은 오류가 아니므로 stdout 으로 나가고
종료 코드는 0 이다.

## 5분 만에 하는 첫 테스트

### 1. 명세를 적는다

테스트할 것을 JSON 으로 적는다. 케이스마다 서버에 할 일(`operation`)과 그 결과에 기대하는
것(`assertions`)을 쓴다.

```json
{
  "schemaVersion": 1,
  "id": "weather",
  "name": "날씨 서버",
  "cases": [
    {
      "id": "tool-exists",
      "name": "get_weather 도구를 제공한다",
      "operation": { "type": "listTools" },
      "assertions": [{ "type": "toolExists", "tool": "get_weather" }]
    },
    {
      "id": "seoul-succeeds",
      "name": "서울 날씨를 정상 조회한다",
      "operation": { "type": "callTool", "tool": "get_weather", "input": { "city": "서울" } },
      "assertions": [{ "type": "isError", "expected": false }]
    }
  ]
}
```

`weather.suite.json` 으로 저장한다. 어떤 필드를 쓸 수 있는지는 [명세 형식](/ko/reference/suite-spec)
에 있다.

### 2. 서버를 띄우는 방법과 함께 넘긴다

`--` 뒤가 서버를 띄울 명령이다. 첫 토큰이 실행 파일, 나머지가 그 인자이고, 그 뒤는 해석하지
않으므로 `--port 0` 같은 값을 그대로 넘길 수 있다.

```bash
mcpeak test weather.suite.json -- node ./server.mjs
```

::: tip 붙일 서버가 아직 없다면
저장소의 `examples/weather-server/` 가 위 명세를 그대로 통과하는 예제 서버다. npm 으로만
설치했다면 [목 서버](/ko/guide/mock-server)를 대신 띄운다. 목 정의 JSON 하나만 더 만들면 같은
두 케이스가 그대로 통과한다.
:::

### 3. 보고서를 읽는다

```
날씨 서버  (2 cases)

✓ tool-exists     get_weather 도구를 제공한다
✓ seoul-succeeds  서울 날씨를 정상 조회한다

2 passed  (2 total)
```

전부 통과하면 종료 코드 0, 하나라도 실패하면 1 이다. 실패는 출력이 두 갈래다.

케이스가 실패하면 어느 단언이 무엇과 왜 다른지, 어떻게 고치는지가 나온다.

```
✗ missing-tool  존재하지 않는 도구를 요구한다
    toolExists  툴 'missing_weather_tool'을(를) 찾을 수 없습니다. 발견된 툴: 'add', 'get_weather'
    해결: 서버의 tools/list 응답과 테스트 명세를 확인하세요.

1 failed  (1 total)

명세: 승인 지문이 없습니다 (미고정)
  → mcpeak generate 로 승인한 명세가 아니거나 승인 이전 버전으로 만든 파일입니다.
```

마지막 두 줄은 손으로 쓴 명세에 붙는다. `generate` 로 승인받은 명세면 대신 승인 시점과
같은지를 알려준다.

명세를 못 읽거나 서버에 못 붙어서 실행 자체가 실패하면 원인 코드와 해결 방법이 나온다.

```
오류 [MCP_CONNECTION_FAILED/PROCESS_START_FAILED]: MCP 서버 프로세스를 시작하지 못했습니다.
해결: command 실행 가능 여부와 cwd를 확인하세요.
```

## 다음 단계

명세를 손으로 쓰지 않아도 된다. 서버의 툴 스키마를 읽어 명세를 만들어 주는 흐름은
[명세 생성](/ko/guide/generate)에 있다. 케이스에 무엇을 적을 수 있는지는
[명세 작성](/ko/guide/writing-suites)을 본다. 서버가 유료 API 를 부른다면
[External 세션](/ko/guide/external-sessions)으로 그 호출을 한 번만 녹화한다. 도구가 내부에서
어떻게 맞물리는지는 [동작 원리](/ko/concepts/how-it-works)를 본다.
