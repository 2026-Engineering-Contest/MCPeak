import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { ApiError } from "./api-types.js";

export type { ApiError } from "./api-types.js";

export interface DashboardServerOptions {
  /** 0을 주면 빈 포트를 커널이 고르고, 고른 값이 반환값의 `port`에 담긴다. */
  readonly port: number;
  /** 스위트·카세트 탐색과 경로 가드의 기준이 되는 프로젝트 루트(절대경로). */
  readonly root: string;
}

export interface DashboardServer {
  /** 실제로 열린 포트. `port: 0`으로 띄웠을 때 이 값을 봐야 한다. */
  readonly port: number;
  close(): Promise<void>;
}

/**
 * 대시보드 HTTP 서버를 띄운다. 지금 응답하는 경로는 `GET /api/health` 하나다.
 * 나머지 `/api` 면은 계획서 §4-4 표대로 이후 태스크가 채운다.
 */
export function startDashboardServer(options: DashboardServerOptions): Promise<DashboardServer> {
  const server = createServer((request, response) => {
    handle(request, response, options.root);
  });

  return new Promise<DashboardServer>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      const address = server.address() as AddressInfo;
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((done, fail) => {
            server.closeAllConnections();
            server.close((error) => {
              if (error) fail(error);
              else done();
            });
          }),
      });
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.port);
  });
}

function handle(request: IncomingMessage, response: ServerResponse, _root: string): void {
  const path = (request.url ?? "/").split("?")[0];
  if (request.method === "GET" && path === "/api/health") {
    sendJson(response, 200, { ok: true });
    return;
  }
  const error: ApiError = {
    error: `그런 경로가 없습니다: ${request.method ?? "GET"} ${path}. 사용 가능한 경로는 /api 아래에 있습니다.`,
  };
  sendJson(response, 404, error);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}
