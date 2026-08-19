import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { resolveProjectPath } from "./paths.js";

const WEB_DIST_MISSING_MESSAGE = "web 빌드가 없습니다. pnpm build를 실행하세요.\n";

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

/**
 * `webDist`(`dist/web`)가 있으면 그 아래를 정적 서빙한다. 없는 경로는 SPA fallback으로
 * `index.html`을 준다(해시 라우팅이라 서버는 실제 경로 존재 여부를 몰라도 된다).
 * `webDist` 자체가 없으면 안내문을 200으로 준다.
 */
export async function serveStatic(
  _request: IncomingMessage,
  response: ServerResponse,
  webDist: string,
  pathname: string,
): Promise<void> {
  const distExists = await stat(webDist)
    .then((stats) => stats.isDirectory())
    .catch(() => false);
  if (!distExists) {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end(WEB_DIST_MISSING_MESSAGE);
    return;
  }

  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let decoded: string;
  try {
    decoded = decodeURIComponent(requested);
  } catch {
    decoded = requested;
  }

  const resolved = resolveProjectPath(webDist, decoded);
  let filePath = resolved ?? join(webDist, "index.html");
  let fileStat = await stat(filePath).catch(() => null);
  if (fileStat === null || fileStat.isDirectory()) {
    // SPA fallback: 실제 파일이 없는 경로는 index.html로 보낸다.
    filePath = join(webDist, "index.html");
    fileStat = await stat(filePath).catch(() => null);
  }
  if (fileStat === null) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("index.html이 없습니다.\n");
    return;
  }

  const contentType = MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  response.writeHead(200, { "content-type": contentType, "content-length": fileStat.size });
  const stream = createReadStream(filePath);
  stream.once("error", () => {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("정적 파일을 읽을 수 없습니다.\n");
  });
  stream.pipe(response);
}
