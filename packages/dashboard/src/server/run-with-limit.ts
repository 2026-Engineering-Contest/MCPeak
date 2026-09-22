/**
 * 항목을 일꾼 `limit` 명이 앞에서부터 하나씩 집어가며 처리한다. 계약 넷:
 *
 * - 동시에 진행 중인 `worker` 는 절대 `limit` 을 넘지 않는다.
 * - `worker` 가 던져도 풀은 멈추지 않고 남은 항목을 마저 돈다. **실패를 판단하지도, 모아
 *   두지도 않는다** — 보고는 `worker` 안의 몫이다. 삼킴이 숨는 것을 걱정하지 않아도 되는
 *   이유는, 이 자리의 소비자가 항목마다 자기 실패를 따로 알리기 때문이다.
 * - `signal?.aborted` 면 **새 항목을 집지 않는다.** 이미 진행 중인 것은 기다린다.
 * - 전부 끝나면(중단된 경우 진행 중이던 것이 끝나면) resolve 한다. **절대 reject 하지 않는다.**
 *
 * 프로세스도 시계도 쓰지 않는다. 동시성 규칙을 단독으로 돌려볼 수 있는 것이 이 모듈을
 * 따로 둔 이유다.
 */
export async function runWithLimit<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let next = 0;
  const pull = async (): Promise<void> => {
    while (next < items.length) {
      if (signal?.aborted === true) return;
      const item = items[next] as T;
      next += 1;
      try {
        await worker(item);
      } catch {
        // 한 항목의 실패로 풀을 멈추지 않는다. 보고는 worker 안에서 한다.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => pull()));
}
