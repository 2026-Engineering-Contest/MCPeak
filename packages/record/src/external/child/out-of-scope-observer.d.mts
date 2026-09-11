export interface OutOfScopeObserverOptions {
  /**
   * `host:port` 형식. 이 대상으로 나가는 요청은 세지 않는다 — 어댑터 자신의 Coordinator
   * 클라이언트가 `node:http` 를 쓰므로, 필터가 없으면 우리 왕복이 유출로 잡힌다.
   */
  readonly coordinatorHostHeader: string;
  /**
   * 자식 종료 시 `{"outOfScope": N, "claimed": B}` 를 동기로 쓸 **디렉터리**. 파일 이름은
   * 프로세스마다 다르다 — 중간에 낀 Node 런처와 같은 경로를 덮어쓰지 않기 위해서다(ADR-0096).
   */
  readonly reportDir: string;
  /**
   * 이 프로세스가 이 세션의 기록자였는지. 종료 시점에 읽는다. 부모는 기록자의 보고가 있으면
   * 그것만 세고, 하나도 없으면 전부 센다(ADR-0096).
   */
  isClaimed(): boolean;
}

export interface OutOfScopeObserver {
  count(): number;
  uninstall(): void;
}

/** 구독하는 `diagnostics_channel` 이름. 테스트가 이 채널의 발행 여부를 단언한다. */
export function observerChannelName(): string;

export function installOutOfScopeObserver(options: OutOfScopeObserverOptions): OutOfScopeObserver;
