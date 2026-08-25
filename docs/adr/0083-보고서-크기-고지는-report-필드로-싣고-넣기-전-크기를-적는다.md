# ADR-0083: 보고서 크기 고지는 report 필드로 싣고 넣기 전 크기를 적는다

- 상태: 제안
- 날짜: 2026-08-25
- 담당: runner, cli
- 작성자: @seodduu (① MCP 서버 테스트 파트)
- 참조: [#92](https://github.com/2026-Engineering-Contest/MCPeak/issues/92),
  `docs/superpowers/specs/2026-08-15-contract-axis-coverage-design.md` §9.2,
  `packages/runner/src/executor.ts`, `packages/runner/src/reporter.ts`,
  `packages/cli/src/test-command.ts`

## 배경

runner 보고서 상한은 1MB 이고 올릴 수 없다. 넘으면 테스트 실패가 아니라 예외다. 그 벽을 미리
알리는 장치가 `generate` 의 케이스 1500개 고지 하나였는데, 케이스당 600바이트라는 관측 추정
위에 있어 응답이 큰 서버는 고지 없이 벽에 닿고 작은 서버는 안전한데 경고를 본다(#92).

`test` 실행 시점에는 `executor.ts` 가 보고서 크기를 이미 잰다. 근접 판정을 그 자리에 넣는
것은 자명하고, 판단이 필요한 것은 **그 사실을 어디로 내보내느냐**다. 이슈 코멘트가 그 지점을
짚었다.

덧붙여 조사 중 발견한 것: `cli test` 는 `RunnerPayloadLimitError` 를 일반 종료 실패로 접어
"서버 응답과 종료 상태를 확인하세요" 를 찍고 있었다. 이슈 본문의 "예외 메시지에 실제 바이트가
들어 있어 원인은 알 수 있다" 는 runner 의 예외 객체 이야기고, 사용자 화면에는 닿지 않았다.

## 선택지

1. **`RunnerReport.payload` 필드.** 80% 이상일 때만 키를 만든다. reporter 가 그 키를 보고 줄을
   찍는다.
2. **새 `RunnerEvent`.** `reportSizeWarning` 같은 이벤트를 `suiteCompleted` 앞에 낸다.
3. **`RunnerSummary` 에 숫자 필드.** `rejectionUnverified` 처럼 항상 있는 숫자로 둔다.
4. **runner 는 침묵하고 cli 가 `byteLength(report)` 를 다시 잰다.**

## 결정

**선택지 1.** 그리고 두 가지를 못 박는다.

- **`reportBytes` 는 키를 넣기 전 크기다.** 자기 자신을 포함하면 순환이다. 상한 초과 판정도
  같은 값을 쓰므로 고지 때문에 상한을 넘는 일은 없다. 실제 직렬화 크기는 이 키만큼 더 크다.
- **임계는 80%, `REPORT_PAYLOAD_NOTICE_RATIO` 로 export.** 케이스 하나가 더 붙어도 대개 안
  넘는 여유이면서 대부분의 실행에서 조용한 값이다. 근거가 약한 상수라 이름을 붙여 내보낸다.

`cli test` 는 `RunnerPayloadLimitError` 를 `RUNNER_PAYLOAD_LIMIT_EXCEEDED` 로 갈라 실제 크기·
상한·"올릴 수 없음"·조치를 적는다. 케이스 초과는 그 케이스를 짚고 케이스 수를 줄이라고 하지
않는다(`dry-run.ts` 와 같은 구분).

`generate` 의 1500 고지는 상수 그대로 두고 문안에 추정임을 적는다. 생성 시점에는 응답 크기를
모른다.

## 이유

**크기는 report 를 다 만든 뒤에야 안다.** 그 시점의 유일한 출구가 `suiteCompleted` 이고 그
이벤트는 report 를 통째로 싣는다. report 에 있으면 이벤트 소비자도 본다. 이벤트 타입을 하나 더
늘리면 같은 사실이 두 경로로 나가고 순서 계약이 하나 더 생긴다(선택지 2).

**`--json` 이 `{...finalReport}` 스프레드다.** 필드를 더하면 기계 출력에 그대로 실린다. 키를
80% 이상일 때만 만들면 대부분의 실행에서 기존 JSON 이 바이트 그대로다. `determinism` 키와 같은
규칙이다. 항상 있는 숫자(선택지 3)는 그 불변을 깬다.

**cli 가 다시 재면(선택지 4) 두 값이 갈린다.** cli 는 `spec`·`determinism` 을 얹은 뒤의 객체를
갖고 있어 runner 가 판정한 크기와 다르다. 상한을 판정한 쪽이 크기도 말해야 한다.

## 결과

- `RunnerReport` 에 선택 필드 `payload` 가 생긴다. `core/src/types.ts` 는 건드리지 않는다.
- 80% 이상인 실행의 `--json` 출력에 `payload` 키가 추가된다. 그 아래에서는 바이트 그대로다.
- dashboard 는 report 를 그대로 받으므로 키가 있으면 보인다. 화면에 싣는 것은 별도 작업이다.
- `RUNNER_FINALIZATION_FAILED` 가 나오던 자리 중 상한 초과만 새 코드로 갈린다. 다른 종료 실패는
  그대로다.
- 임계 80% 의 근거는 약하다. 실서버 도그푸딩에서 너무 자주 뜨거나 너무 늦으면 상수만 바꾸면 된다.
