# @ohmymcp/generate

MCP 도구의 입력 스키마에서 결정론적 baseline을 만들고, 사용자가 승인한 AI 보조 검토로 테스트
초안을 발전시킵니다.

- **오너:** `@seodduu` `@endl24` `@sunghoon0303`
- **생성 시 의존:** `@ohmymcp/core`, `@ohmymcp/runner`
- **생성 결과 실행 시 의존:** `@ohmymcp/runner`

## 결정론적 baseline

`createBaselineSuite()`는 하나의 서버에서 발견한 `ToolDef[]`를 메모리의 `TestSuiteSpec`으로
합성합니다. 같은 도구 정의와 옵션은 같은 suite와 fingerprint를 반환합니다. 이 API는 파일을
쓰거나 서버에 연결하지 않으므로, CLI와 다른 사용자 인터페이스가 안전하게 조립할 수 있습니다.

```ts
import { createBaselineSuite } from "@ohmymcp/generate";

const baseline = createBaselineSuite(tools, {
  suiteId: "weather",
  suiteName: "날씨 서버 baseline",
});

console.log(baseline.suiteFingerprint);
```

입력값은 `const` → `default` → `examples[0]` → `enum[0]` → 타입별 고정값 순서로 선택합니다.
객체에서는 필수 프로퍼티만 포함하고 배열에서는 `items`로 원소 한 개를 생성합니다. baseline의
happy-path는 도구 응답의 `isError`가 `false`인지 확인합니다.

`generateTests()`는 기존 TypeScript 파일 생성 API로 계속 제공됩니다. 생성 파일 이름과 입력값
선택 규칙은 아래 설명을 따릅니다.

## 테스트 생성

```ts
import { generateTests } from "@ohmymcp/generate";

const paths = await generateTests(tools, {
  outDir: "./generated",
});
```

기본적으로 생성 대상 파일이 이미 있으면 어떤 파일도 쓰지 않고 `OUTPUT_FILE_EXISTS` 오류로
중단합니다. 기존 생성 파일을 명시적으로 교체하려는 경우에만 `overwrite: true`를 지정하세요.
자동 생성 파일은 직접 수정하지 말고 사람이 작성하는 테스트는 별도 파일에 보관하는 것을 권장합니다.
덮어쓰기는 심볼릭 링크를 따라가지 않는 파일 열기를 지원하는 환경에서만 동작합니다. 대상이
심볼릭 링크이거나 플랫폼이 해당 기능을 지원하지 않으면 기존 파일을 변경하지 않고 중단합니다.

```ts
await generateTests(tools, {
  outDir: "./generated",
  overwrite: true,
});
```

도구 이름은 소문자 영문·숫자와 하이픈으로 정규화되고 최대 80자로 잘립니다. 정규화 결과가
비어 있거나 Windows 예약 이름이면 `tool-<순번>`을 사용합니다. 이미 예약된 이름과 충돌하면
비어 있는 이름을 찾을 때까지 `-2`, `-3`처럼 결정론적 접미사를 붙입니다. 따라서 호출자는
접미사가 없는 `<tool-name>.generated.ts`를 가정하지 말고 반환된 `paths`로 생성 파일을 찾아야
합니다. 생성 파일은 서버 연결 방법이나 `McpClient`를 포함하지 않고 Runner의 선언형
`generatedSuite`만 export합니다.

첫 버전은 단일 `type`, `required`, `properties`, `items`, `enum`, `const`, `default`, `examples`를
지원합니다. `$ref`나 조합 스키마처럼 지원하지 않는 키워드가 있거나 후보값이 제약을 만족하지
않으면 파일을 쓰기 전에 `GenerateTestsError`를 발생시킵니다.

## AI 보조 검토와 승인

AI 보조 흐름은 baseline, 현재 승인 draft, 검토 중 candidate, 최종 실행 snapshot을 분리합니다.
Codex 또는 Claude의 제안은 바로 실행하거나 저장되지 않습니다. 승인 draft는 사용자가 선택한
변경만 적용할 때 바뀝니다.

사용자가 재수정을 요청할 때마다 provider session을 재개하지 않는 stateless한 새 요청을 만듭니다.
각 요청은 baseline, 현재 working candidate, 사용자 피드백, 필요한 도구 정의와 고정 출력 계약을
다시 사용합니다. 이전 raw prompt나 provider 출력은 자동으로 다음 요청에 포함하지 않습니다.

승인은 세 단계입니다.

1. 전송 승인: provider, model, 정제된 payload, byte 길이, timeout, fingerprint를 검토합니다.
2. 변경 승인: 정제된 candidate와 로컬에서 계산한 diff를 검토하고 적용할 변경을 선택합니다.
3. 최종 실행 승인: 저장 또는 실행 전에 최종 suite snapshot의 fingerprint를 다시 확인합니다.

provider 결과는 runtime validation, 크기 제한, redaction을 통과한 candidate만 검토 화면에
노출합니다. raw prompt, provider stdout·stderr, native error stack, 실제 MCP 입력·응답은 public
상태, 로그, report에 보존하지 않습니다.

Codex와 Claude adapter는 각각 빈 임시 작업 디렉터리, stdin, 구조화 출력 계약을 사용합니다.
도구, MCP, 파일 쓰기와 provider session 영속화를 차단하고, 환경변수 allowlist, timeout, 취소와
bounded 종료를 적용합니다. 실제 provider 실행에는 사용자가 설치하고 인증한 CLI가 필요합니다.

`RunnerReport`를 바탕으로 provider를 호출해 테스트를 자동 repair하는 기능은 이 패키지의 현재
범위가 아닙니다. Runner의 실행과 report 계약도 변경하지 않습니다.

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
