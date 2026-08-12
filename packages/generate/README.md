# @ohmymcp/generate

MCP 도구의 입력 스키마에서 검토 가능한 happy-path 테스트 초안을 생성합니다.

- **오너:** `@seodduu` `@endl24` `@sunghoon0303`
- **의존:** `@ohmymcp/core`, `@ohmymcp/runner`

## 테스트 생성

```ts
import { generateTests } from "@ohmymcp/generate";

const paths = await generateTests(tools, {
  outDir: "./generated",
});
```

각 도구마다 `<tool-name>.generated.ts` 파일이 만들어집니다. 생성 파일은 서버 연결 방법이나
`McpClient`를 포함하지 않고 Runner의 선언형 `generatedSuite`만 export합니다.

입력값은 `const` → `default` → `examples[0]` → `enum[0]` → 타입별 고정값 순서로 선택합니다.
객체에서는 필수 프로퍼티만 포함하고 배열에서는 `items`로 원소 한 개를 생성합니다. 생성된
happy-path는 도구 응답의 `isError`가 `false`인지 확인합니다.

첫 버전은 단일 `type`, `required`, `properties`, `items`, `enum`, `const`, `default`, `examples`를
지원합니다. `$ref`나 조합 스키마처럼 지원하지 않는 키워드가 있거나 후보값이 제약을 만족하지
않으면 파일을 쓰기 전에 `GenerateTestsError`를 발생시킵니다.

## 실제 client로 실행

생성 파일과 실제 서버 연결은 별도 실행 진입점에서 조합합니다.

```ts
import { runSuite } from "@ohmymcp/runner";
import { generatedSuite } from "./generated/get-weather.generated.js";

const execution = runSuite({
  client,
  suite: generatedSuite,
});

const report = await execution.report;
```

client와 transport를 만든 실행 진입점은 실행이 끝난 뒤 해당 client의 종료도 책임져야 합니다.
생성된 코드는 Vitest에 의존하지 않으므로 CLI, Dashboard 또는 별도 테스트 adapter에서도 같은
suite를 사용할 수 있습니다.

## 자동 생성 범위

스키마만으로 알 수 없는 비정상 입력, 구체적인 응답 본문, 비즈니스 규칙 검증은 생성하지 않습니다.
생성 결과를 초안으로 검토한 뒤 필요한 assertion과 케이스를 별도 파일에 추가하세요.
