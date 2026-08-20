import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const streamControl = vi.hoisted(() => ({ emitError: false }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    createReadStream: (path: string) => {
      if (!streamControl.emitError) return actual.createReadStream(path);
      let sent = false;
      return new Readable({
        read() {
          if (sent) return;
          sent = true;
          this.push("a");
          queueMicrotask(() => this.destroy(new Error("스트림 읽기 실패")));
        },
      });
    },
  };
});

import { serveStatic } from "../src/server/static.js";

let directory: string;

afterEach(async () => {
  streamControl.emitError = false;
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
});

describe("serveStatic", () => {
  it("헤더 전송 뒤 읽기 스트림 오류가 나면 응답 연결을 종료한다", async () => {
    directory = await mkdtemp(join(tmpdir(), "mcpeak-dashboard-static-"));
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "index.html"), "본문 내용", "utf8");
    streamControl.emitError = true;

    const server = createServer((request, response) => {
      void serveStatic(request, response, directory, "/");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("포트를 열지 못했습니다.");

    try {
      await expect(
        new Promise<void>((resolve, reject) => {
          const request = get(`http://127.0.0.1:${address.port}/`, (response) => {
            expect(response.statusCode).toBe(200);
            response.resume();
            response.once("aborted", resolve);
            response.once("error", reject);
            response.once("end", () => reject(new Error("응답이 오류 없이 끝났습니다.")));
          });
          request.once("error", reject);
        }),
      ).resolves.toBeUndefined();
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
