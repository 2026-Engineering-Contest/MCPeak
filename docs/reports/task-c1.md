# Task C1 보고서 — 실제 Codex·Claude 호출 E2E

실행: 메인 오케스트레이터 세션, 직렬. 기점 `4b73848` (A1·A2·B1 통합 후).

## 결과

두 provider 모두 완주했다.

| provider | model | generate | `ohmymcp test` |
|---|---|---|---|
| codex | `gpt-5.6-sol` | 저장 성공 | `2 passed, 0 failed` |
| claude | `sonnet` | 저장 성공 | `2 passed, 0 failed` |

결정론성: 두 provider 각각 같은 입력으로 2회 실행해 저장된 suite 파일을 `cmp`로 비교했다. 1회차와
2회차가 바이트 동일하다. codex 산출물과 claude 산출물도 서로 바이트 동일하다.

## 프리플라이트

```
codex-cli 0.147.0
2.1.228 (Claude Code)
codex login status → Logged in using ChatGPT
examples/weather-server → 기동 확인
```

baseline만으로 돌린 사전 상태는 `1 passed, 1 failed`였다. `get-weather-success` 케이스의
`input.city`가 `"example"`인데 예제 서버는 서울·부산·제주만 안다. C1의 지시는 이 도시를 고치는
것이었고, 두 provider 모두 `input.city`를 `"서울"`로 바꾼 candidate를 돌려줬다. 나머지 case, suite
id, schemaVersion, 툴 이름, assertion은 그대로였다.

## 실행 방법

대화형 검토는 TTY를 요구한다(`GENERATE_INTERACTIVE_REQUIRED`). 파이프로 답을 밀어 넣는 방식은
프롬프트가 뜨기 전에 입력이 소비돼 동작하지 않는다. 프롬프트 문자열을 기다렸다가 답하는 expect
드라이버를 썼다. 응답 순서는 provider 선택, AI 요청 문장, 전송 확인, `apply-all`, 적용 확인,
`save`, 저장 확인이다.

## C1에서 발견해 고친 결함

**Claude 성공 응답을 전부 거절하던 판정.** A1 보고서의 "남은 위험" 3번이 실제였다. Claude
2.1.228의 성공 envelope는 `api_error_status`를 항상 담고 값이 `null`이다.

```
KEYS: ['api_error_status', ..., 'structured_output', 'subtype', 'type', ...]
type: result  subtype: success  is_error: False
api_error_status value: None  | present: True
```

`"api_error_status" in value`로 거절하던 판정이 모든 Claude 성공을 `schemaMismatch`로 떨어뜨렸다.
Task A2에서 키 존재가 아니라 값으로 판정하도록 고쳤다(통합 SHA `89d0aab`).

## C1에서 확인만 하고 문제 없던 것

- **`PROVIDER_OUTPUT_SCHEMA` 수용 여부**: Codex `--output-schema`와 Claude `--json-schema` 둘 다
  그대로 받아들였고 스키마대로 결과를 돌려줬다.
- **codex stdout 순수성**: `codex exec --output-schema`의 stdout은 배너 없이 JSON만 나온다. 배너와
  경고는 stderr로 간다. `provider-process.ts`의 `JSON.parse(stdout)`는 안전하다.
- **CLI 기본 모델**: `defaultModel`의 `gpt-5.6-luna`(codex)와 `haiku`(claude)를 각각 실제 호출해
  정상 동작을 확인했다. `gpt-5.1`과 `gpt-5.1-codex`는 ChatGPT 계정에서 거절되지만 기본값은
  아니므로 영향이 없다.

## C1에서 발견한 별개 결함

검토 메뉴에서 stdin이 EOF로 닫히면 CLI가 Node raw 스택을 그대로 뱉고 비정상 종료한다.

```
Error [ERR_USE_AFTER_CLOSE]: readline was closed
    at [kQuestion] (node:internal/readline/interface:441:13)
```

실패 메시지가 곧 제품인 프로젝트에서 내부 스택과 파일 경로 노출은 그 자체가 결함이다. 계획서
범위 밖이므로 Task B2로 분리했다.

## 남은 위험

`api_error_status` 판정은 Claude 2.1.228 한 버전의 실측에 기댄다. 다른 버전이 성공 응답에
`""`나 `0` 같은 값을 담으면 다시 전부 거절된다. 유닛테스트는 픽스처를 우리가 쓰므로 이것을
잡지 못한다. 실제 호출 E2E만이 판정 기준이다.
