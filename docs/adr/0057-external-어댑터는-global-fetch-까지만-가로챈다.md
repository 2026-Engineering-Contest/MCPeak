# ADR-0057: External 어댑터는 `globalThis.fetch` 까지만 가로채고, 범위 밖은 경고로 알린다

- 상태: 채택
- 날짜: 2026-08-22
- 담당: record, cli
- 작성자: @ddxng5 (② replay/record 파트)
- 승인: 승인 (2026-08-22, @ddxng5)
- 선행 결정:
  [ADR-0051](./0051-external-record-replay와-tool-카세트-경계-분리.md),
  [ADR-0052](./0052-coordinator가-engine과-session-store를-소유한다.md),
  [ADR-0053](./0053-http-외부-요청-매칭과-반복-호출-정책.md)
- 참조: 이슈 [#258](https://github.com/2026-Engineering-Contest/MCPeak/issues/258),
  [#263](https://github.com/2026-Engineering-Contest/MCPeak/issues/263)

## 배경

External Record/Replay 는 세 ADR 위에 서 있다. 0051 이 Tool 카세트와의 경계를, 0052 가
Coordinator·Engine·Store 의 소유를, 0053 이 HTTP 요청 매칭과 반복 호출을 정했다.

**셋 중 어느 것도 "무엇을 가로채는가" 를 정하지 않았다.** 구현은 자식 프로세스의
`globalThis.fetch` 하나를 교체하는 것으로 나갔고(`packages/record/src/external/child/fetch-adapter.mjs:17`),
어댑터 열거값 `node.fetch.v1` 이 그 사실을 이름에 담고 있다. 확장 자리를 만들어 둔 설계지만,
**지금 그 범위가 어디까지인지는 저장소 어디에도 사용자용으로 적혀 있지 않다.** `globalThis.fetch`
라는 문자열이 나오는 곳은 내부 구현 계획서 두 줄뿐이다.

[#258](https://github.com/2026-Engineering-Contest/MCPeak/issues/258) 이 그 대가를 보여줬다.
호출 방식만 `fetch` → `node:http` 로 바꾼 픽스처로 재현했다(`main` `0ce4e7d`, Node v24.16.0).

| 실행 | 결과 | origin 호출수 | 세션 |
|---|---|---|---|
| `--record-session` | ✓ 1 passed, exit 0 | 0 → 1 | `sessions` 1행(`completed`), `interactions` **0행** |
| `--session` (재생) | ✓ 1 passed, exit 0 | 1 → **2** | 아무것도 소비하지 않음 |
| 대조군 (`fetch` 픽스처) | ✓ 1 passed, exit 0 | 1 → 1 | 정상 재생 |

**재생인데 실제 네트워크로 나갔고, 초록이었고, 경고가 한 줄도 없었다.** `mcpeak help test` 는
`--session` 을 "외부 API 는 부르지 않습니다. 녹화에 없는 호출을 만나면 실패합니다" 로 설명한다.
범위 밖에서는 그 두 문장이 모두 거짓이다.

침묵은 한 군데가 아니라 네 군데가 겹친 결과다.

1. 어댑터가 `globalThis.fetch` 만 교체하므로 범위 밖 호출은 **Coordinator 에 도달조차 하지 않는다.**
2. 그래서 녹화 0건인 채로 세션이 `completed` 로 닫힌다. 개수를 보는 곳이 없다.
3. **비었지만 완료된 세션이 재생 원본 게이트를 통과한다** — 게이트는 "없거나 미완료" 만 막는다
   (`packages/record/src/external/engine.ts:52`).
4. 유일한 종료 경고 조건이 `unusedCount > 0` 인데, 빈 세션에서는 `max(0, 0 - 0) = 0` 이라
   항상 거짓이다(`packages/cli/src/test-command.ts:1201`).

## 선택지

- **A안**: 그대로 둔다. 범위는 구현 세부이고 사용자는 `fetch` 를 쓸 것이라고 가정한다.
- **B안**: 범위 밖을 하드 실패로 만든다. 재생에서 소비가 0건이면 실행을 실패시킨다.
- **C안**: `node:http`·`node:https` 계층 어댑터를 추가해 범위 자체를 넓힌다.
- **D안**: 네트워크 샌드박스나 프록시로 자식 프로세스의 외부 접근을 물리적으로 막는다.
- **E안**: v1 의 범위를 `globalThis.fetch` 로 **명시**하고, 범위 밖일 가능성을 종료 시점 경고와
  사용자 문서로 알린다. 범위 확장은 별도 버전 어댑터로 미룬다.

## 결정

**E안**을 택한다.

1. **v1 어댑터는 Node 의 `globalThis.fetch` 만 가로챈다.** 열거값은 `node.fetch.v1` 이고,
   이름 안의 `fetch` 가 곧 그 범위다.
2. **범위 밖을 명시한다**: `node:http`·`node:https`, 그리고 그것을 직접 쓰는 axios·got·node-fetch,
   Node 가 아닌 서버(Python·Go 등 — `--import` 훅 자체가 Node 전용이다).
3. 범위 밖일 가능성은 **종료 시점 경고 네 갈래**로 알린다. 갈래는 **배타적**이며 한 실행에
   하나만 나온다.

   | 갈래 | 조건 | 사용자가 확인할 것 |
   |---|---|---|
   | 녹화 0건 | `record && interactionCount === 0` | 서버가 외부를 불렀다면 범위 밖인가 |
   | 원본이 빔 | `replay && interactionCount === 0` | 녹화 단계가 아무것도 못 잡았다 |
   | 소비 0건 | `replay && interactionCount > 0 && consumedCount === 0` | 세션 파일이 맞는가, 호출 방식이 바뀌었나 |
   | 부분 재생 | `replay && consumedCount > 0 && unusedCount > 0` | 서버 코드나 실행 경로가 달라졌나 |

   네 문구는 마지막 줄을 공유한다: `MCPeak은 서버가 globalThis.fetch로 부른 것만 잡습니다.`
4. **0건을 하드 실패로 만들지 않는다.** 경고로 알리고 종료 코드는 케이스 결과로만 정한다.
5. 범위를 사용자 문서 세 곳에 적는다: `mcpeak help test`, `packages/record/README.md`,
   루트 `README.md`. `help` 의 "외부 API 는 부르지 않습니다" 라는 절대 표현은 제거한다.
6. **이후 확장은 `node.http.v1` 같은 별도 버전 어댑터로 한다.** `node.fetch.v1` 의 의미를
   나중에 넓히지 않는다 — 넓히면 같은 이름의 세션이 판본에 따라 다른 것을 뜻하게 된다.

## 이유

**하드 실패(B안)를 택하지 않는 이유는 0건을 구분할 수 없기 때문이다.** 외부 호출이 원래 없는
정상적인 서버도 0건이고, 범위 밖으로 새어 나간 서버도 0건이다. 우리가 보는 자리에서 둘은
같은 숫자다. 오탐으로 멀쩡한 스위트가 빨개지면 사용자는 경고를 고치지 않고 **기능을 끈다.**

그리고 더 결정적인 이유가 있다. **종료 시점의 실패는 이미 나간 네트워크 호출을 되돌리지 못한다.**
유료 API 를 부른 것도, 부작용이 있는 endpoint 를 건드린 것도 그대로 일어난 뒤다. 막지 못하는
것을 실패로 표시하는 것은 안전을 주지 않으면서 신뢰만 깎는다. 실제로 막으려면 D안이어야 하는데,
그것은 아래 이유로 우리 권한 밖이다.

**C안이 옳은 방향이지만 지금이 아니다.** `http.request` 계층은 표면이 `fetch` 보다 훨씬 넓다 —
`Agent` 와 소켓 재사용, 스트림 본문, 수동 리다이렉트, `ClientRequest` 의 이벤트 수명주기가 전부
매칭 대상에 들어온다. ADR-0053 이 `fetch` 위에 세운 정규화·matchKey 계약을 그 계층에서 다시
세워야 한다. 8/24 동결까지 남은 이틀에 들어갈 크기가 아니고, **반쯤 된 어댑터는 지금보다 나쁘다** —
한 실행 안에서 잡히는 호출과 안 잡히는 호출이 섞이면 세션이 무엇을 담고 있는지 아무도 말할 수
없게 된다. C안은 폐기가 아니라 연기이며, 결정 6번이 그 자리를 비워 둔다.

**D안은 테스트 러너의 권한 밖이다.** 프로세스가 아니라 OS·네트워크 계층의 일이고, Windows·macOS·CI
가 각각 다르다. 사용자 머신의 네트워크 정책을 도구가 바꾸는 것은 우리가 요구할 수 있는 것이
아니다.

**A안을 버리는 이유는 이 프로젝트가 스스로 적어 둔 두 가지에 정면으로 걸리기 때문이다.**
결정론성이 핵심 가치이고, 실패 메시지가 곧 제품이다. 앞선 진단 문제들은 "실패했을 때 메시지가
나쁘다" 였지만 이것은 **실패했는데 성공이라고 말한다.** 재생이 조용히 실제 호출로 떨어지는 것은
두 가치가 동시에 깨지는 자리다.

**경고가 완전한 해결이 아니라는 것을 인정하고 택한다.** 경고는 호출이 나간 뒤에 뜬다. 그럼에도
A안과의 차이는 크다 — 사용자가 **두 번째 실행 전에** 안다. 그리고 범위가 문서에 적혀 있으면
첫 실행 전에 안다. 이 ADR 이 사는 곳은 그 두 지점이다.

## 결과

- 경고 네 갈래는 **순서와 조건이 곧 계약이다.** 빈 재생 원본에서는
  `interactionCount === 0` 과 `consumedCount === 0` 이 동시에 참이므로, 소비 0건 갈래는
  `interactionCount > 0` 일 때만 본다. 또 `consumedCount === 0` 과 `unusedCount > 0` 도 동시에
  참일 수 있어, 조건을 독립적으로 세우면 한 실행에 경고가 두 번 찍힌다. 판정은 순수 함수 하나로
  모으고 그 배타성을 단위 테스트로 고정한다.
- **`record` 패키지는 바뀌지 않는다.** `interactionCount`·`consumedCount`·`unusedCount` 가 이미
  `finish()` 반환값에 있다(`session-store.ts` 의 `SessionSummary`). 이 결정은 `cli` 의 종료 진단만
  넓힌다.
- 회귀는 `node:http` 픽스처 e2e 가 고정한다 — #258 의 재현 조건 자체를 테스트로 박는다.
  **그 픽스처를 지우면 이 ADR 의 근거도 함께 사라진다.**
- `mcpeak help test` 에서 "외부 API 는 부르지 않습니다" 는 참이 아니므로 고친다. 범위 안에서만
  참인 문장을 조건 없이 적어 두는 것이 #258 을 사고로 만든 마지막 조각이다.
- 확장 시점의 호환은 Bootstrap 이 이미 지킨다. `bootstrap.mjs:24` 의 어댑터 검사는 정확 일치라,
  구버전 CLI 가 `node.http.v1` 을 만나면 `EXTERNAL_BOOTSTRAP_FAILED` 로 떨어진다 — 모르는 범위를
  조용히 통과시키지 않는다.
- 이 ADR 은 **범위를 좁게 유지하는 것을 정당화하지, 좁은 것이 충분하다고 말하지 않는다.**
  `node:http` 를 쓰는 서버가 흔하다는 사용자 보고가 쌓이면 C안을 다시 연다.
