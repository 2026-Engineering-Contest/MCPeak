/**
 * 화면을 **떠날 때** 중계기를 닫는다. 새로고침·탭 닫기·앞뒤 이동 전부가 여기에 걸린다.
 *
 * React 언마운트 정리만으로는 모자란다. 새로고침은 컴포넌트를 언마운트하지 않고 문서를
 * 통째로 버리므로 정리 함수가 돌지 않고, 새 페이지에는 `relayId` 가 없어 **아무도 그
 * 세션을 DELETE 할 수 없다.** 그 상태로 「실행 시작」을 누르면 판정 실행이 사용자 서버를
 * 두 벌 띄운다 — 이 기능이 막으려던 바로 그 상태다(설계 §1).
 *
 * **`beforeunload` 가 아니라 `pagehide` 인 이유:** `beforeunload` 는 모바일 브라우저에서
 * 자주 생략되고, 등록 자체가 bfcache 를 막아 앞뒤 이동을 느리게 만든다. `pagehide` 는
 * 진짜 언로드와 bfcache 진입 양쪽에서 모두 발화한다. bfcache 로 들어갔다가 복원되는
 * 경우에는 중계기가 이미 닫혀 있지만, 그때 화면이 들고 있는 `relayId` 는 이미 닫힌
 * 세션을 가리킬 뿐이라 서버가 404 로 답한다 — 살아 있는 서버가 남는 쪽보다 낫다.
 *
 * **`keepalive` 가 요점이다.** 이것이 없으면 문서가 사라지는 순간 요청이 취소돼, 신호는
 * 보냈는데 서버는 못 받는 상태가 된다. `sendBeacon` 은 DELETE 를 못 보내므로 쓸 수 없다.
 */
export interface UnloadCloseTarget {
  addEventListener(type: "pagehide", listener: () => void): void;
  removeEventListener(type: "pagehide", listener: () => void): void;
}

export function relayDeletePath(relayId: string): string {
  return `/api/relay/${encodeURIComponent(relayId)}`;
}

/**
 * `pagehide` 에 닫기를 건다. 반환값은 해제 함수다(언마운트에서 부른다 — 리스너가 쌓이면
 * 한 번 떠날 때 DELETE 가 여러 번 나간다).
 *
 * `getRelayId` 로 **그때의** id 를 읽는다. 값으로 받으면 등록 시점의 id 에 묶여, 그 뒤에
 * 뜬 중계기를 놓친다.
 */
export function installUnloadClose(
  target: UnloadCloseTarget,
  getRelayId: () => string | null,
  fetchImpl: (input: string, init: RequestInit) => Promise<unknown>,
): () => void {
  const onPageHide = (): void => {
    const relayId = getRelayId();
    if (relayId === null) return;
    // 실패는 삼킨다. 문서가 사라지는 중이라 사용자에게 보여 줄 화면이 없고, 못 닫은
    // 세션은 서버의 유휴 수거가 다시 집는다(`RelaySessionRegistry.reapIdle`).
    void Promise.resolve(fetchImpl(relayDeletePath(relayId), { method: "DELETE", keepalive: true }))
      .then(() => undefined)
      .catch(() => undefined);
  };
  target.addEventListener("pagehide", onPageHide);
  return () => target.removeEventListener("pagehide", onPageHide);
}
