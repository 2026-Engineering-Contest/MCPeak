# ADR-0008: 승인 화면 redaction 범위를 넓히지 않는다

- 상태: 제안
- 날짜: 2026-08-12
- 담당: generate, cli
- 작성자: @seodduu (generate·cli 파트)
- 승인: 미승인. 아래 '승인' 절 참조
- 참조: [ADR-0007](./0007-provider-전송-스키마-분리.md), `docs/reports/task-b4.md`

## 배경

`generate` AI 검토의 승인 화면은 원래 변경 식별자만 찍었다.

```
change-001 replaceCase get-weather-success
```

무엇이 무엇으로 바뀌는지 알 수 없어 승인이 형식일 뿐이었다. Task B4에서 leaf 경로 단위로 내용을
보여주도록 바꿨다.

```
change-001 replaceCase get-weather-success
  - operation.input.city: "example"
  + operation.input.city: "서울"
```

그 과정에서 `redactAuthoringSuite`(`packages/generate/src/redaction.ts`)의 적용 범위가 좁다는 것이
드러났다. `callTool` 케이스의 `operation.input`만 훑는다.

| 경로 | redaction 적용 |
|---|---|
| `operation.input.*` (callTool) | 적용됨 |
| `id`, `name` | 없음 |
| `operation.type`, `operation.tool` | 없음 |
| `assertions[*].*` | 없음 |
| `timeoutMs` | 없음 |
| `listTools` 케이스 전체 | 없음 |

내용을 찍지 않던 동안에는 노출 표면이 없었다. 이제 `name`에 비밀값이 든 suite는 승인 화면에 원문이
나온다.

## 선택지

- A안: 그대로 둔다. 비밀값은 `operation.input`에 들어가는 것이 정상 사용이고 그곳은 이미 가려진다.
- B안: 저장되는 값은 그대로 두고 화면 출력 시점에만 민감 키를 마스킹한다.
- C안: `redactAuthoringSuite`의 범위를 `operation.input` 밖으로 넓힌다.

## 결정

A안을 채택한다. 코드 변경 없이 현재 동작을 유지하고, 노출 범위를 문서로 고정한다.
Task B4가 현재 동작을 테스트로 못 박아 두었다.

## 이유

C안은 멀쩡한 테스트를 막는다. 변경 적용은 `executable` 게이트를 통과해야 하고
(`authoring-session.ts`의 `redactedPaths.length === 0`), redaction 대상이 늘면 정상 suite가 승인
자체를 못 하게 된다. 케이스 이름이 `"token 갱신을 테스트한다"`이면 `token`이라는 단어 때문에
가려지고, 가려졌으니 승인이 막힌다. 보안 조치가 기능을 죽이는 교환은 위험 대비 비용이 맞지 않는다.

B안은 마스킹 규칙이 `generate`와 `cli` 두 곳으로 갈라진다. 한쪽만 고치면 어긋나고, 어긋난 사실이
드러나는 시점은 비밀값이 이미 노출된 뒤다. 규칙이 한 곳에 있는 편이 낫다.

A안의 실제 위험은 낮다. 승인 화면은 사용자 자신의 터미널이고, 비밀값을 케이스 이름이나 assertion
기대값에 적는 것은 정상 사용이 아니다. 정상 사용 경로(`operation.input`)는 이미 가려진다.

## 결과

- 승인 화면은 `operation.input` 밖의 필드를 원문으로 보여준다. 위 표가 그 범위다.
- 화면 공유나 터미널 로깅 환경에서는 이 범위를 알고 있어야 한다.
- 비밀값을 넣을 자리는 `operation.input`이다. 다른 필드에 넣으면 가려지지 않는다.
- 이 판단은 위험도 평가에 기댄다. `assertions`나 `name`에 비밀값이 들어가는 실사용 사례가
  발견되면 B안을 다시 검토한다. 그때는 마스킹 규칙을 `generate` 한 곳에 두고 `cli`가 그것을
  호출하는 형태를 먼저 따진다.

## 승인

- 상태: 미승인. PR #37 리뷰에서 검토 중이다.
- 필요한 승인: `generate` 오너. redaction 범위는 `generate`의 `redactAuthoringSuite`가 정하고,
  이 결정은 그것을 넓히지 않기로 한 것이다.
- 확정 방법: PR #37이 머지되면 현재 동작이 확정된다. 그때 상태를 `승인`으로 바꾸고 `승인일`과
  승인한 오너를 적는다.
- 다시 검토하는 조건: `assertions`나 `name`에 비밀값이 들어가는 실사용 사례가 발견되면 B안
  (화면 출력만 마스킹)을 다시 따진다.
