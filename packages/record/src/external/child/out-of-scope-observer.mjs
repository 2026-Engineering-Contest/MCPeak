import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { writeFileSync } from "node:fs";

/**
 * 재생 중 **어댑터 범위 밖으로 나간 HTTP 호출을 센다. 가로채지 않는다.**
 *
 * ADR-0057 이 금지한 것은 어댑터 범위를 넓혀 그 호출을 *대체*하는 것이다. 여기서 하는 것은
 * *관측*이라 다른 일이다 — 요청 객체를 읽지도 바꾸지도 않고 개수만 올린다. 관측 때문에 서버의
 * 동작이 달라지면 그 순간 이것은 관측이 아니게 되므로, 원숭이 패치 대신 Node 가 이 목적으로
 * 내놓은 `diagnostics_channel` 을 쓴다.
 *
 * **왜 세야 하는가.** 서버가 `globalThis.fetch` 와 `node:http` 를 섞어 쓰면 어댑터는 앞쪽만
 * 본다. 그러면 재생이 절반만 되고 나머지는 실제 네트워크로 나가는데, 기존 경고 네 갈래가
 * 전부 그 상황을 비켜간다(`interactionCount > 0`·`consumedCount > 0`·`unusedCount === 0`).
 * 사용자는 초록과 "N건을 재생했습니다" 만 본다 — 결정론성이 깨진 실행을 성공으로 읽는다.
 *
 * **덮는 범위.** `node:http`·`node:https` 와 그 위에 얹힌 것들(axios·got)이다. `fetch` 는
 * undici 채널(`undici:request:create`)이라 여기 안 잡힌다 — 어댑터가 이미 처리하므로 잡히면
 * 오히려 이중 계산이다. Python·Go 서버는 다른 런타임이라 닿지 않는다(그쪽은 녹화 0건이라
 * 기존 경고가 잡는다).
 */

/** `node:http`·`node:https` 클라이언트 요청이 만들어질 때 발행된다. */
const CHANNEL = "http.client.request.created";

/**
 * 이 채널이 이 Node 에서 실제로 발행되는지 확인한다.
 *
 * **`subscribe` 는 없는 이름에도 조용히 성공한다.** 채널이 없는 런타임에서는 콜백이 영원히 안
 * 불리고 개수가 늘 0 이 되는데, 그 0 은 "안 나갔다" 가 아니라 "못 봤다" 다. 둘을 같게 다루면
 * 이 기능이 막으려던 침묵을 그대로 되살린다. 그래서 테스트가 이 함수로 채널의 존재 자체를
 * 단언한다 — 지원 하한(Node 22.18)에서 채널이 없으면 CI 가 빨개져야 알 수 있다.
 */
export function observerChannelName() {
  return CHANNEL;
}

/**
 * @param {{ coordinatorHostHeader: string, reportPath: string }} options
 *   `coordinatorHostHeader` 는 `host:port` 형식이다. **이 필터가 없으면 안 된다** —
 *   어댑터 자신의 Coordinator 클라이언트가 `node:http` 를 쓰므로, 재생할 때마다 우리 왕복이
 *   "범위 밖 호출" 로 잡혀 매 실행이 거짓 경고를 낸다.
 */
export function installOutOfScopeObserver(options) {
  let count = 0;

  const onRequest = (message) => {
    const request = message?.request;
    if (request === undefined || request === null) return;
    // `host` 헤더만 본다. 생성 시점에는 소켓이 아직 없어 `remotePort` 가 비어 있고,
    // `request.port` 도 채워지지 않는다(실측). 헤더는 두 호출 형태 모두에서 `host:port` 다.
    let host;
    try {
      host = request.getHeader?.("host");
    } catch {
      // 헤더를 못 읽어도 관측이 서버를 깨뜨리면 안 된다. 세는 쪽을 포기한다.
      return;
    }
    if (host === options.coordinatorHostHeader) return;
    count += 1;
  };

  subscribe(CHANNEL, onRequest);

  /**
   * 종료 시점에 **동기로** 쓴다. 비동기 비콘은 마지막 호출이 종료와 경합해 개수를 잃는다 —
   * 그리고 잃는 자리가 하필 "마지막 in-scope 호출 뒤에 나간 범위 밖 호출", 즉 이 기능이
   * 잡으려는 바로 그 모양이다. `exit` 훅에서는 동기 IO 만 가능하므로 파일에 쓴다.
   *
   * **강제 종료(SIGKILL)에서는 이 훅이 안 뛴다.** 그때 부모는 파일을 못 찾고, 그것을 0 이
   * 아니라 "못 셌음" 으로 다룬다. 부재와 0 을 같게 만들면 안 되는 이유가 그것이다.
   */
  const flush = () => {
    try {
      writeFileSync(options.reportPath, JSON.stringify({ outOfScope: count }));
    } catch {
      // 쓰기에 실패해도 서버 종료를 막지 않는다. 부모는 "못 셌음" 으로 읽는다.
    }
  };
  process.on("exit", flush);

  return {
    count: () => count,
    uninstall: () => {
      unsubscribe(CHANNEL, onRequest);
      process.off("exit", flush);
    },
  };
}
