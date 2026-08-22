# ADR-0058: External replay-miss 진단은 MCP 오류 채널을 타지 않는다

- 상태: 제안
- 날짜: 2026-08-22
- 담당: record, cli
- 작성자: @ddxng5 (② replay/record 파트)
- 승인: 미승인
- 선행 결정:
  [ADR-0013](./0013-렌더러-배치와-진단-무분기.md),
  [ADR-0052](./0052-coordinator가-engine과-session-store를-소유한다.md)
- 참조: 이슈 [#259](https://github.com/2026-Engineering-Contest/MCPeak/issues/259)

## 배경

`record` 의 External Replay 엔진은 원본에 없는 호출을 만나면 `REPLAY_MISS` 를 던진다. 그
메시지는 어떤 호출이 왜 빠졌고 무엇을 해야 하는지 여러 줄로 공들여 쓴 진단이다
(`packages/record/src/external/engine.ts`). 이 예외는 Coordinator HTTP 응답을 거쳐 자식
프로세스의 `fetch()` 호출자에게 던져지고, 테스트 대상 서버 코드가 그것을 잡아 자신의 MCP
`tools/call` 오류 메시지로 relay 한다 — 그 relay 는 서버 저자의 선택이라 우리가 통제하지 않는다.

[#259](https://github.com/2026-Engineering-Contest/MCPeak/issues/259) 가 실측한 결과, 그 문구가
사용자 화면에서 이렇게 망가진다.

```
→ 원인: MCP error -32000: 저장된 외부 응답을 찾지 못했습니다. 실제 네트워크는 호출하지
  않았습니다.[개행이 이스케이프 시퀀스로 찍힘]  GET http://127.0.0.1:.../weather?...
  [반복][이스케이프 시퀀스] occurrence 0 · matchKey 949ea7651109…[이스케이프 시퀀스]→ 이 호출이 녹화된
  뒤에 추가되었거나, 요청이 녹…(총 273자)
```

**원인은 `runner` 가 틀려서가 아니다.** `packages/runner/src/reporter.ts` 의
`escapeTerminalText` 는 MCP 오류 텍스트를 "테스트 대상 서버가 보낸, 신뢰할 수 없는 문자열"로
취급해 제어 문자(개행 포함)를 이스케이프하고, `packages/runner/src/diagnostics.ts` 의
`MAX_VALUE_STRING_CHARS`(200)가 그것을 자른다. 둘 다 서버가 터미널 이스케이프나 거대한
문자열을 밀어 넣는 것을 막는 정당한 방어다. 문제는 **우리 자신이 공들여 쓴 진단이 그 방어망을
"서버 텍스트" 자격으로 통과하면서 남의 텍스트 취급을 받는다**는 것이다. `record` 는 여러 줄로
쓸 수 있다고 보고 썼고, `runner` 는 한 줄로 눌러 잘랐다 — 어느 쪽도 혼자서는 틀리지 않았다.

구조적으로, Coordinator(부모 프로세스, CLI 안)는 miss 가 발생하는 그 순간 전체 진단을 이미
완전한 형태로 쥐고 있다(`packages/record/src/external/coordinator.ts` 의 HTTP 핸들러). 지금은
그것을 HTTP 오류 응답으로 자식에게 돌려주고 버린다. 자식 안의 테스트 대상 서버가 그 오류를
어떻게 relay 하는지(그대로 전달하는지, 자르는지, 무시하는지)에 사용자에게 닿는 진단의 품질이
좌우되는 것이 설계 결함이다.

## 선택지

- **A안**: 그대로 둔다. `record` 의 진단이 짧아지도록 문구를 줄인다.
- **B안**: `runner` 의 이스케이프·절단 규칙을 이 경로만 완화한다 — "어디까지가 우리 텍스트인가"
  를 `runner` 가 판단하게 만든다.
- **C안**: `runner` 에 새 진단 채널을 만들어 `record` 가 그리로 보내고 `runner` 가 특별
  취급한다 — `record` → `runner` 계약이 새로 생긴다.
- **D안**: MCP 오류 채널을 아예 거치지 않는다. Coordinator 가 이미 쥐고 있는 진단을
  `finish()` 요약에 구조화해 담고, `cli` 가 그 값을 `runner` 를 거치지 않는 별도 채널로
  직접 보여준다.

## 결정

**D안**을 택한다.

1. `record` 의 `ReplayEngine` 은 miss 가 날 때마다 `{ method, url, occurrence, matchKeyPrefix }`
   를 내부에 쌓아 두고, `finish()` 가 돌려주는 `ReplaySessionSummary` 에 `misses` 로 싣는다.
   `display` 필드만 담으므로 그대로 보여도 안전하다([ADR-0053](./0053-http-외부-요청-매칭과-반복-호출-정책.md)).
   MCP 오류로 던지는 기존 메시지는 그대로 둔다 — relay 하는 서버에게는 여전히 유용하다.
2. `cli` 는 `wiring.finish()` 가 돌려주는 요약에서 `misses` 를 읽어, `runner` 의 리포트
   렌더링과 **완전히 별개인 블록**으로 stderr 에 직접 쓴다. `record`·`runner` 어느 쪽도
   이 블록의 존재를 모른다.
3. 이 블록은 `packages/cli/src/process-diagnostics.ts` 와 같은 원칙을 따른다 — 정적 문구의
   개행은 구조를 이루므로 손대지 않고, 사용자가 통제하지 않는 값(테스트 대상 서버가 실제로
   시도한 요청에서 유래한 method·url)만 필드 단위로 이스케이프한다. `runner`·`process-diagnostics.ts`
   의 것과 같은 계열이되 독립된 사본이다([ADR-0013] 과 같은 근거).
4. 케이스별 실패 줄(`✗ ...  MCP error -32000: ...`)은 그대로 둔다. 그건 `runner` 가 "이 툴
   호출이 실패했다"를 보여주는 정상 동작이고, 그 실패를 만드는 것도 여전히 MCP 오류다 — 이
   ADR 은 **보너스 진단 채널을 하나 더한다**, 기존 채널을 없애지 않는다.

## 이유

**A안은 문제를 없애지 않고 옮긴다.** 진단을 줄이면 "무엇이 왜 다른지, 어떻게 고치는지" 를
요구하는 `CLAUDE.md` 의 제품 정의와 부딪힌다. 그리고 근본 원인 — relay 를 통제하지 못한다 —
은 그대로다. 서버가 relay 방식을 바꾸면(예: 첫 줄만 취함) 아무리 짧게 써도 다시 잘린다.

**B안은 경계를 흐린다.** `runner` 가 "이 텍스트는 특별하니 다르게 다룬다"를 판단하려면 어떤
신호(코드 패턴, 발신자 식별)가 필요하다. 그 신호는 MCP 프로토콜에 없다. 만들면 `runner` 가
`record` 의 존재를 알아야 하고, 그 반대 방향의 의존을 만든다 — 저장소의 단방향 의존 원칙
(`dashboard` → `cli` → `runner`/`generate`/`record`/`mock` → `core`)에 어긋난다.

**C안은 성립하지만 비용이 크다.** `runner` 오너 승인, 새 타입 계약, `RunnerReport` 스키마
확장이 필요하고 ADR-0013 이 이미 "렌더러는 진단 코드로 분기하지 않는다"고 정한 무분기 원칙과
충돌한다 — `REPLAY_MISS` 만을 위한 특수 채널은 그 원칙이 막으려던 바로 그 분기다.

**D안이 이긴 이유는 이미 있는 데이터를 옮기기만 하면 되기 때문이다.** Coordinator 는 miss 의
전체 맥락을 이미 프로세스 메모리에 쥐고 있다 — 자식에게 물어볼 필요도, relay 를 신뢰할 필요도
없다. `record` 는 `runner` 를 몰라도 되고 `cli` 는 `runner` 의 이스케이프 규칙을 몰라도 된다.
`packages/cli/src/process-diagnostics.ts`(서버 stderr 를 `runner` 밖에서 보여주는 선례)와 같은
모양이라 저장소에 새 패턴을 들이는 것도 아니다.

**케이스별 실패 줄을 손대지 않는 이유는 그 줄의 임무가 다르기 때문이다.** 그 줄은 "이 MCP 호출이
실패했다"를 즉시 보여준다 — 그 자체로는 짧아도 의미가 있다. 잘리고 이스케이프된 채로 남는 것이
어색하지만, 대체할 진짜 신뢰 채널이 실행 끝에 따로 생기므로 사용자는 결국 온전한 답을 본다. 그
줄을 억지로 고치려 하면 B안·C안으로 돌아간다.

## 결과

- `ReplaySessionSummary` 에 `misses: readonly ReplayMissDetail[]` 가 추가된다. 기존 필드는
  그대로라 이미 `finish()` 를 소비하는 코드는 깨지지 않는다 — 추가적(additive) 변경이다.
- `record` 는 `runner` 를 참조하지 않는다. 이 결정은 CLI 쪽 조립(`test-command.ts`)에서만
  실현된다 — `record` 오너 단독 작업으로 반쪽(요약 확장)을, `cli` 공동 작업으로 나머지 반쪽
  (렌더링)을 낸다.
- 회귀는 `packages/record/tests/external/engine-memory.test.ts`(구조화된 값이 맞는지)와
  `packages/cli/tests/external-session-e2e.test.ts`(실제 자식 프로세스로 stderr 에 잘리지 않고
  개행이 살아있는 채로 닿는지)가 각각 고정한다. 후자가 지워지면 #259 가 다시 조용히 재발할 수
  있다.
- 이 패턴이 세 번째로 필요해지면(예: `RECORD_MISS` 류의 record 모드 진단) 공통 유틸로 올리는
  것을 검토한다 — 지금은 사용처가 하나뿐이라 이르다.
- `runner` 의 이스케이프·절단 정책은 이 ADR 로 바뀌지 않는다. 여전히 옳은 기본값이다 — 오직
  진짜 서버 텍스트에 대해서.
