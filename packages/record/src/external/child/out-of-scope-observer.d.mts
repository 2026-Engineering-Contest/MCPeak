export interface OutOfScopeObserverOptions {
  /**
   * `host:port` 형식. 이 대상으로 나가는 요청은 세지 않는다 — 어댑터 자신의 Coordinator
   * 클라이언트가 `node:http` 를 쓰므로, 필터가 없으면 우리 왕복이 유출로 잡힌다.
   */
  readonly coordinatorHostHeader: string;
  /** 자식 종료 시 `{"outOfScope": N}` 을 동기로 쓸 경로. */
  readonly reportPath: string;
}

export interface OutOfScopeObserver {
  count(): number;
  uninstall(): void;
}

/** 구독하는 `diagnostics_channel` 이름. 테스트가 이 채널의 발행 여부를 단언한다. */
export function observerChannelName(): string;

export function installOutOfScopeObserver(options: OutOfScopeObserverOptions): OutOfScopeObserver;
