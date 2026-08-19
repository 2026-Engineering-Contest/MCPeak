import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ApiError } from "./api-types.js";
import { handleRequest } from "./server/routes.js";
import { RunRegistry } from "./server/run-registry.js";

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
 * 빌드 산출물 기준 `dist/web`(vite가 이 자리에 SPA를 낸다). 이 모듈 자신의 위치를 기준으로
 * 계산해, 프로젝트 루트(`options.root`, 사용자의 cwd)와는 별개로 항상 dashboard 패키지의
 * 산출물을 가리키게 한다. src를 직접 실행하는 vitest에서는 `web` 디렉터리가 없을 수 있고,
 * 그 경우 `static.ts`가 안내문을 낸다.
 */
const WEB_DIST = join(dirname(fileURLToPath(import.meta.url)), "web");

/**
 * 대시보드 HTTP 서버를 띄운다. `/api` 아래 라우팅은 계획서 §4-4 표대로 `routes.ts`가
 * 전부 처리하고, 그 밖은 `static.ts`가 SPA를 서빙한다.
 */
export function startDashboardServer(options: DashboardServerOptions): Promise<DashboardServer> {
  const registry = new RunRegistry();
  const server = createServer((request, response) => {
    handleRequest(request, response, {
      root: options.root,
      webDist: WEB_DIST,
      registry,
    }).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const body: ApiError = {
        error: `서버 내부 오류: ${error instanceof Error ? error.message : String(error)}`,
      };
      const payload = JSON.stringify(body);
      response.writeHead(500, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(payload),
      });
      response.end(payload);
    });
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
    server.listen(options.port, "127.0.0.1");
  });
}
