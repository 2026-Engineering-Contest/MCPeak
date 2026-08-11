# @ohmymcp/runner

선언형 MCP 테스트 명세를 순서대로 실행하고, assertion 결과와 구조화된 이벤트·보고서를 제공합니다.

- **오너:** `@seodduu` `@endl24` `@sunghoon0303` (① MCP 서버 테스트 파트)
- **의존:** `@ohmymcp/core`

## 명세 작성

`defineMcpSuite`로 TypeScript 리터럴 타입을 유지하면서 런타임 명세 검증을 수행합니다. 명세를 외부 JSON이나 생성 결과로 받는 경우에는 `validateMcpSuite`를 사용하세요.

```ts
import { defineMcpSuite } from "@ohmymcp/runner";

export const suite = defineMcpSuite({
  schemaVersion: 1,
  id: "weather-server",
  name: "날씨 MCP 서버 테스트",
  defaultTimeoutMs: 10_000,
  cases: [
    {
      id: "weather-tool-exists",
      name: "날씨 조회 툴을 제공한다",
      operation: { type: "listTools" },
      assertions: [{ type: "toolExists", tool: "get_weather" }],
    },
    {
      id: "weather-call-succeeds",
      name: "서울 날씨를 정상적으로 조회한다",
      operation: {
        type: "callTool",
        tool: "get_weather",
        input: { city: "서울" },
      },
      assertions: [{ type: "isError", expected: false }],
    },
  ],
});
```

`listTools`에는 `toolExists`만, `callTool`에는 `isError`만 쓸 수 있습니다. 명세와 실행 결과는 명세 순서대로 처리되며, `RunnerReport`와 `RunnerEvent`는 `JSON.stringify`할 수 있습니다.

## 실행과 종료 수명주기

`runSuite`는 주입받은 client를 절대로 닫지 않습니다. 실행을 시작한 쪽은 client와 정확히 같은 객체를 가진, 멱등적인 shutdown controller를 제공하고 `finalizeRunnerExecution`으로 종료를 마무리해야 합니다.

```ts
import {
  finalizeRunnerExecution,
  runSuite,
  type McpClientShutdownController,
  type RunnerEvent,
} from "@ohmymcp/runner";
import { suite } from "./weather-suite.js";

declare const shutdown: McpClientShutdownController;

const onEvent = (event: RunnerEvent) => {
  console.log(JSON.stringify(event));
};

const execution = runSuite({
  client: shutdown.client,
  suite,
  onEvent,
  redaction: {
    sensitiveKeys: ["sessionId"],
    sensitiveValues: [process.env.WEATHER_API_KEY ?? ""],
  },
  payloadLimits: {
    maxCaseBytes: 65_536,
    maxReportBytes: 1_048_576,
  },
  drainTimeoutMs: 5_000,
});

const report = await finalizeRunnerExecution({ execution, shutdown });
```

case `timeoutMs`가 있으면 그것이 우선하고, 없으면 suite의 `defaultTimeoutMs`, 둘 다 없으면 Runner의 10초 fallback을 사용합니다. timeout 또는 외부 `AbortSignal` 중단은 이후 케이스 실행을 멈춥니다.

`execution.drain`은 pending MCP 작업을 기다리는 비거부 결과입니다. 기본 마감은 `5_000ms`이고 결과는 `{ status: "settled" }` 또는 `{ status: "deadlineExceeded", pendingOperations: 1 }`입니다. drain 완료 뒤 graceful close와 force close는 각각 기본 `2_000ms`로 독립 제한됩니다. controller는 stdio라면 프로세스 종료 또는 kill, HTTP라면 요청 abort나 socket destroy 같은 실제 전송 계층 종료를 구현해야 합니다. 늦게 끝나거나 거부되는 MCP 작업의 rejection handler도 controller 수명주기 동안 유지하세요.

`drainTimeoutMs`는 `1..60_000`의 유한 정수여야 합니다. `closeTimeoutMs`와 `forceCloseTimeoutMs`는 각각 `1..10_000`의 유한 정수여야 합니다. 0, 비유한수, 음수, 소수는 실행 전에 동기 `RangeError`가 발생합니다.

## 관찰 데이터와 후속 수정

observer 이벤트와 보고서에는 기본 민감 키(authorization, cookie, password, secret, token 등)를 재귀적으로 마스킹합니다. 호출자는 `sensitiveKeys`와 `sensitiveValues`를 추가할 수 있습니다. 기본 한도는 case당 65,536 bytes, report당 1,048,576 bytes입니다. Runner는 이벤트나 보고서를 자동 저장하지 않습니다.

`RunnerReport`에는 실패한 case의 정제된 명세와 진단이 남습니다. 따라서 JSON-safe한 sanitized repair input으로 변환하여, 사용자 검토를 거치는 후속 repair 흐름에 사용할 수 있습니다. 원본 MCP 호출은 별도로 보관된 입력을 사용하므로 observer 데이터에 비밀값을 노출하지 않습니다.

## 현재 제외 범위

- generate provider 또는 repair validator 구현
- JUnit 출력과 Vitest adapter
- 병렬 실행

## 이전 API 호환성

`createMcpTest(config, body)`와 `toContainTool(result, name)`은 minor 버전 호환성을 위한 deprecated shim입니다. 기존 시그니처와 `not implemented` 오류를 그대로 유지하며, major release 전에는 제거하지 않습니다. 새 코드에서는 선언형 `defineMcpSuite`와 `runSuite`를 사용하세요.
