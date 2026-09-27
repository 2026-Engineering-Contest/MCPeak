# 명세 생성

이 문서를 끝내면 서버의 툴 스키마에서 명세를 만들어 승인하고, 그 명세에 찍힌 승인 지문이
이후 `mcpeak test` 에서 어떻게 쓰이는지 아는 상태가 된다.

## 한 줄로 만들기

```bash
mcpeak generate --out weather.suite.json -- node ./server.mjs
```

`--` 뒤는 `test` 와 같이 서버를 띄울 명령이다. 스위트 `id` 와 `name` 은 `--out` 파일명에서
뽑는다(`weather.suite.json` 이면 `weather`). 직접 정하려면 `--suite-id` 와 `--name` 을 쓴다.

## 무엇을 만드나

생성기는 서버의 `tools/list` 를 읽고 툴마다 케이스를 합성한다. 툴 하나에 대해 정상 호출 한
건과, `inputSchema` 가 정한 축을 하나씩 어기는 거절 케이스가 나온다.

```
baseline suite를 저장했습니다: weather.suite.json
커버리지  2 tools, 8 axes 전부 검증
```

`examples/weather-server` 의 `get_weather` 와 `add` 에서는 여덟 케이스가 나온다.

| 케이스 | 무엇을 보나 |
|---|---|
| `get-weather-success` | `{ "city": "…" }` 로 부르면 `isError: false` |
| `get-weather-missing-city` | 필수 `city` 를 빼면 거절한다 |
| `get-weather-type-city` | `city` 에 숫자를 주면 거절한다 |
| `add-success` · `add-missing-a` · `add-missing-b` · `add-type-a` · `add-type-b` | `add` 에 같은 규칙 |

정상 케이스의 입력값은 스키마에서 고른다. 순서는 `const`, `default`, `examples[0]`, `enum[0]`,
타입별 고정값이다. 객체는 필수 프로퍼티만, 배열은 원소 한 개만 만든다. 툴이 `outputSchema` 를
선언하면 정상 케이스에 `structuredContentMatchesSchema` 단언을 함께 넣는다.

같은 툴 정의와 같은 옵션은 같은 명세를 낸다. 실행 순서나 시각에 따라 달라지는 값은 들어가지
않는다.

## 시험 실행과 승인

기본 흐름에서는 저장 전에 만든 케이스를 실제 서버에 한 번 돌려 본다. 스키마에서 고른
자리값이 서버에서 통하는지 사람이 볼 수 있게 하기 위해서다. `"city": "example"` 처럼 스키마상
멀쩡하지만 서버가 모르는 값은 여기서 실패로 드러난다.

실패한 케이스는 분류 화면으로 간다. 서버 결함이라 남길지, 입력값을 고쳐 다시 시도할지 사람이
정한다. AI provider 가 있으면 실패한 케이스에 대해 고칠 값을 제안받을 수 있고, 제안은 승인한
것만 명세에 들어간다.

TTY 에서 provider 와 model 을 고르면 다음을 검토한 뒤에만 요청이 나간다.

1. 전송 승인. provider, model, 정제된 요청 크기, timeout, 지문을 보고 보낼지 정한다.
2. 변경 승인. 돌아온 후보와 로컬에서 계산한 diff 를 보고 적용할 변경을 고른다.
3. 저장 승인. 최종 명세의 지문을 다시 확인하고 파일을 쓴다.

승인하지 않으면 provider 를 부르지 않는다. 실제 Codex 나 Claude 호출은 사용자 계정과 비용을
쓰므로 자동 테스트에서는 돌리지 않는다.

## AI 없이 만들기

```bash
mcpeak generate --out weather.suite.json --baseline-only -- node ./server.mjs
```

`--baseline-only` 는 AI 를 부르지 않는 비대화형 승인이다. 시험 실행도 사전보완도 없이 스키마에서
합성한 그대로 저장한다. `--no-dry-run` 은 시험 실행만 건너뛴다. 서버의 도구를 한 번도 부르지
않으므로 부작용이 있는 서버에 쓴다.

## 픽스처

자리값으로는 서버가 모르는 값이 나오기 쉽다. 실재하는 자원을 가리키는 값은 픽스처 파일에 적어
둔다. `mcpeak.fixtures.json` 을 자동으로 찾고, 다른 경로는 `--fixtures` 로 준다.

```
▸ 픽스처: mcpeak.fixtures.json (도구 1개, 필드 1개)
```

픽스처 값은 생성된 명세에 그대로 들어간다. 토큰이나 비밀번호를 적으면 명세 파일에 남으므로,
인증은 서버 기동 환경변수(`--env`)로 넘기고 픽스처에는 그 자격으로 접근 가능한 자원의 식별자만
적는다.

## 승인 지문

저장한 명세에는 `approval` 블록이 붙는다.

```json
{
  "schemaVersion": 1,
  "id": "weather",
  "name": "weather",
  "approval": {
    "fingerprint": "992133b77bf8fe75234d5397b5810c0eaac0e5813b01750dde01a6b7723501c6",
    "cases": [{ "id": "get-weather-success", "status": "passed" }]
  },
  "defaultTimeoutMs": 10000,
  "cases": []
}
```

`fingerprint` 는 승인 시점의 명세를 요약한 hex 64자다. 파일 바이트가 아니라 파싱된 명세 객체를
요약하므로 들여쓰기, 줄 끝 문자, 키 순서를 바꿔도 값이 같다. `approval` 블록 자신은 계산에서
빠진다. `cases` 에는 시험 실행에서 각 케이스가 어떻게 분류됐는지가 남는다.

`--out` 파일명이 지문에 들어간다. `id` 와 `name` 을 파일명에서 뽑았다면 파일명을 바꿔 다시
생성할 때 지문이 달라져 재승인이 뜬다. 고정하려면 `--suite-id` 와 `--name` 을 직접 준다.

`mcpeak test` 는 실행할 명세의 지문을 계산해 파일의 값과 대조하고 보고서 끝에 적는다. 판정은
바꾸지 않는다. 종료 코드는 케이스 결과로만 정해진다.

```
명세: 승인 시점과 동일 (992133b77bf8…)
```

이 줄은 전부 통과했고 지문이 일치하면 침묵한다. 손으로 쓰는 사용자에게 매번 찍히면 소음이 되고,
그러면 정작 필요할 때 읽지 않기 때문이다. 전부 통과했는데 지문이 다를 때는 반드시 표시한다.
승인받지 않은 명세로 초록불이 뜬 상태라, 실패보다 조용히 지나가기 쉬운 경우다.

## 다시 만들기

`--out` 경로에 파일이 있으면 저장을 멈춘다. 의도한 재생성이면 `--force` 를 붙인다.

## 거절 근거 진단

`--diagnose-rejections` 를 켜면 통과한 거절 케이스의 응답을 나열하고, provider 가 있으면 그
거절이 입력 검증 때문인지 서버 내부 오류인지 참고 의견을 묻는다. 서버가 잘못된 입력에 그냥
터지는 것을 거절로 오인하고 있지 않은지 의심될 때 쓴다.

## 지원하는 스키마 키워드

`type`(단일), `required`, `properties`, `items`(단일 스키마), `enum`, `const`, `default`,
`examples`, 범위·길이·개수 제약, 일부 `format`, `pattern`(ECMA-262 부분집합),
`additionalProperties`, `propertyNames`, 로컬 `$ref`, `anyOf`, `oneOf`.

`allOf`, `not`, `if`, `patternProperties`, 배열 형태 `type`, 튜플 `items`, 원격 `$ref` 가 있는
툴은 건너뛰고 나머지 툴을 만든다. 건너뛴 툴은 출력에서 알려 준다.

## 만들지 않는 것

스키마만으로 알 수 없는 것은 만들지 않는다. 업무 규칙 위반 입력, 구체적인 결과값 검증이 그렇다.
`sum: 999` 처럼 타입만 맞는 계산 오답도 판정하지 않는다. 생성 결과는 초안으로 보고, 그런 단언은
별도 케이스로 손으로 더한다.
