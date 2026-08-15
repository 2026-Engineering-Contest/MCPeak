# ADR-0028: `replay` 는 서버를 띄우지 않고, 더미 클라이언트는 `cli` 가 만든다

- 상태: 제안
- 날짜: 2026-08-16
- 담당: cli (replay 서브커맨드), record
- 작성자: @ddxng5 (② replay/record 파트)
- 승인: 미승인
- 참조: `docs/adr/0003-cassette-matching-key.md`,
  `docs/architecture.md`,
  `docs/superpowers/specs/2026-08-15-dry-run-approval-gate-design.md` §5.2 · §15,
  `packages/record/src/index.ts` (`cassetteClient`),
  `packages/cli/src/cassette-wiring.ts`,
  CONTRIBUTING §9 (W3 통과 기준)

## 배경

CONTRIBUTING §9 가 정한 W3 통과 기준은 `--record` → `--replay` 왕복 성공이다. `record` 패키지는
`replay` 모드를 이미 구현했는데 `packages/cli/src/test-command.ts` 가 `replay` 서브커맨드를
`COMMAND_NOT_IMPLEMENTED` 로 거부한다. 기능이 없는 것이 아니라 진입점이 없다.

진입점을 여는 데 걸리는 것이 하나 있다. ADR-0003 은 "`replay` 모드는 외부 호출 0회를 강제한다"
를 승인했고 `docs/architecture.md` 는 CI 에서 "네트워크 없이 동일 결과" 를 약속한다. 그런데
`cassetteClient(inner, options)` 는 감쌀 `inner` 를 요구한다. `inner` 를 만들려면 지금은
`connectStdio` 로 프로세스를 띄워야 한다. **호출은 0회지만 서버는 뜬다.** 승인 게이트 설계서
§15 가 이 공백을 이미 지적하고 "`cli` 가 더미 `inner` 를 넣는 처리가 필요하다" 로 미뤄 뒀다.
이 문서가 그 후속을 갚는다.

두 번째로 정할 것은 마스킹이다. 카세트는 `response.content` 를 마스킹해 저장한다(ADR-0003).
응답에 `token`·`apiKey` 같은 필드명이 있으면 저장된 값이 `"[redacted]"` 문자열이 되고, 재생
판정이 라이브 판정과 갈린다. `replay` 는 "같은 결과" 가 존재 이유인 커맨드라 이 상충을 무엇으로
갚을지 정하지 않고는 열 수 없다.

## 선택지

**더미 클라이언트를 누가 만드나**

- A안: `cli` 가 `McpClient` 를 만족하는 오프라인 객체를 만들어 `cassetteClient` 에 넘긴다.
- B안: `record` 가 `replayClient(cassette, options)` 같은 `inner` 없는 팩토리를 export 한다.

**카세트 배선을 어디에 태우나**

- C안: `wireCassette` 에 `mode` 를 받는 인자를 추가해 재사용한다.
- D안: `replay` 는 `cassetteClient` 를 직접 부른다. `cassette-wiring.ts` 를 안 건드린다.

**마스킹된 카세트를 만나면**

- E안: 실행을 거부한다. 판정 근거로 쓸 수 없는 카세트이므로 시작하지 않는다.
- F안: 경고하고 진행한다.

**`--command` 처럼 replay 에서 의미 없는 옵션은**

- G안: 조용히 무시한다.
- H안: 사용 오류로 거절한다.

## 결정

**A안 + D안 + F안 + H안**을 택한다.

1. **`cli` 가 오프라인 클라이언트를 만든다.** `listTools`/`callTool` 은 도달 불가이므로 던지고,
   `close` 만 resolve 한다.
2. **`replay` 는 `cassetteClient` 를 직접 부른다.** `wireCassette` 는 손대지 않는다.
3. **마스킹된 값이 있는 카세트는 경고와 함께 실행한다.** 거부하지 않는다.
4. **`--command`·`--arg`·`--stderr-lines` 는 사용 오류로 거절한다.** `--cassette` 는 필수다.

## 이유

**B안을 버린 이유는 의존 방향이 아니라 계약의 위치다.** `record` 에 `inner` 없는 팩토리를 두면
`replay` 전용 코드 경로가 하나 더 생기고, 그 경로만 `close()` 계약이 달라진다. 지금
`cassetteClient` 는 세 모드가 같은 골격을 공유하고 replay 분기가 `inner` 에 **도달하지 않는
것**으로 0회를 보장한다. 코드를 읽어 확인한 사실이다 — replay 에서 `listTools` 는 카세트를
반환하거나 던지고, `callTool` 은 히트면 복제본, 미스면 던지며, `inner.close()` 만 `finally` 에서
불린다. 보장이 이미 구조에 있으므로 새 진입점을 만들 이유가 없다. 더미는 그 사실을 **cli 쪽에서
드러내는 장치**이지 record 의 책임이 아니다.

**던지는 더미를 쓰는 이유는 모드가 새는 것을 잡기 위해서다.** `listTools` 가 조용히 `[]` 를
반환하면, 실수로 `mode` 가 `auto` 로 새어도 화면에는 "툴 0개" 만 뜨고 서버를 안 띄운 것이
정상처럼 보인다. 던지면 그 순간 터진다. 결정론성이 핵심 가치인 도구에서 조용한 성공은 시끄러운
실패보다 나쁘다.

**C안 대신 D안인 이유는 `wireCassette` 의 복잡성이 녹화용이기 때문이다.** 그 파일의 주석 전부가
`close()` 가 연결까지 닫는 부작용에서 카세트 저장을 떼어내는 이야기다. `replay` 는 저장할 것이
없어 `flush()` 가 필요 없다. `resolveMode` 에 우회를 뚫으면 "replay 는 쓰지 않는다" 고 적힌
주석과 코드가 어긋난다. 그 파일은 `generate` 승인 게이트가 소유하고 있으므로 건드리지 않는 편이
소유권 경계에도 맞다.

**E안을 버린 것이 이 문서에서 가장 무거운 판단이다.** 마스킹이 판정을 바꾸는 것은 응답에 민감
필드명이 있을 때뿐이고, 그렇지 않은 카세트에서는 재생이 라이브와 정확히 일치한다.
`examples/weather-server` 를 포함해 대부분이 후자다. 거부하면 조건부 결함 때문에 정상 사용자까지
기능을 못 쓴다. 반대로 침묵하면 도구가 틀린 판정을 조용히 내는 것이 되어 더 나쁘다. 그래서
**경고로 갚는다** — 무엇이 어느 경로에서 마스킹됐는지 짚어 사용자가 그 판정을 믿을지 스스로 정하게
한다. 실패 메시지가 제품이라는 원칙의 적용이다.

이 선택은 **한계를 인정하는 것이지 해결하는 것이 아니다.** 근본 수정은 카세트의 마스킹 범위를
판정 경로 밖으로 좁히는 것이고, 그것은 ADR-0003 의 승인된 결정을 뒤집으므로 별도 ADR 이 선행해야
한다. 이 문서는 그때까지의 상태를 명시적으로 고정한다.

**H안인 이유는 무의미한 옵션이 오해를 낳기 때문이다.** `replay ... --command node` 를 조용히
받으면 사용자는 서버가 떴다고 믿는다. `--stderr-lines` 도 마찬가지로 프로세스가 없어 보여 줄
stderr 가 없다. `generate` 가 `--no-dry-run` 과 `--cassette` 조합을 사용 오류로 돌려주는 선례를
따른다.

## 결과

- `cli` 한 패키지만 바뀐다. `record` 는 읽기만 한다. 의존 방향(`cli → record`)에 영향이 없다.
- **`replay` 는 `connect` 를 의존성으로 받지 않는다.** 서버를 안 띄운다는 것이 주석이 아니라 타입에
  드러난다. E2E 는 PID 파일이 생기지 않는다는 부재 단언으로 이를 고정한다.
- `startRunner({ client })` 와 shutdown 컨트롤러의 `client` 는 동일 참조여야 하므로
  (`packages/runner/src/shutdown.ts`), `cassetteClient` 가 만든 래퍼를 양쪽에 같이 넘긴다.
  `forceClose` 도 같은 `close()` 를 부른다 — 죽일 프로세스가 없다.
- 카세트 미스와 `listTools` 부재의 실패 문장은 `record` 가 만든 것을 그대로 전달한다. `cli` 가
  다시 만들지 않는다. 승인 게이트 설계서 §5.3 이 `onWarning` 에 대해 정한 것과 같은 정책이다.
- **마스킹 경고는 이번 범위에서 로드 시점 1회다.** 케이스마다 내지 않는다. 반복 문장이 리포트를
  덮으면 정작 필요한 줄이 안 읽힌다.
- 재검토 조건: 마스킹 범위를 좁히는 ADR 이 채택되면 F안의 경고는 근거를 잃는다. 그때 이 결정의
  3번 항목을 지우고 경고도 함께 뺀다. 반대로 마스킹을 유지하기로 확정되면 `replay` 전용
  `--allow-redacted` 같은 명시적 옵트인으로 승격할지 다시 본다.
- 이 문서는 `replay` 만 다룬다. `record` 서브커맨드는 열지 않는다. 녹화는 기존
  `generate --cassette --record` 가 맡고, 독립 `record` 진입점이 필요한지는 실사용을 보고 정한다.
