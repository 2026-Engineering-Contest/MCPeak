import { createServer } from "node:http";

/**
 * `serial`·`parallel`·`http` 도구의 요청 하나가 기다리는 시간(설계 §10.3, 계획 E16).
 * 서버는 이 값을 `MCPEAK_PERF_FIXTURE_DELAY_MS` 로 받는다. 단언은 이 상수를 읽는다.
 */
export const DELAY_MS = 100;

/**
 * `127.0.0.1` 의 임의 포트에 루프백 응답 서버를 띄운다(설계 §10.3 의 응답 규칙).
 *
 * - `/config` 는 고정 `{"config":"v1"}`, `/first` 는 고정 `{"id":48213}` 이다.
 * - `/flaky` 는 이 서버가 받은 `/flaky` 요청 중 홀수 번째에 429, 짝수 번째에 200 을 준다.
 * - 그 밖 경로는 `{"path":"<pathname>","n":<카운터>}` 이다. 카운터는 받은 전체 요청 수라 본문이 매번 달라
 *   케이스 간 반복 규칙 (b) 가 `/config` 에서만 나게 한다.
 *
 * 응답은 `?ms=` 만큼 기다린 뒤 보낸다. 카운터는 호출마다 새로 0 이라, 두 실행의 응답 본문을 맞추려면
 * 실행마다 새로 띄운다.
 */
export async function startOrigin(): Promise<{
  readonly origin: string;
  readonly close: () => Promise<void>;
}> {
  let total = 0;
  let flaky = 0;
  const server = createServer((req, res) => {
    total += 1;
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const ms = Number(url.searchParams.get("ms") ?? "0");
    let status = 200;
    let body: unknown;
    if (url.pathname === "/config") {
      body = { config: "v1" };
    } else if (url.pathname === "/first") {
      body = { id: 48213 };
    } else if (url.pathname === "/flaky") {
      flaky += 1;
      if (flaky % 2 === 1) {
        status = 429;
        body = { retry: true, n: total };
      } else {
        body = { ok: true, n: total };
      }
    } else {
      body = { path: url.pathname, n: total };
    }
    const text = JSON.stringify(body);
    setTimeout(
      () => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(text);
      },
      Number.isFinite(ms) && ms > 0 ? ms : 0,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("루프백 응답 서버의 포트를 알 수 없습니다");
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
