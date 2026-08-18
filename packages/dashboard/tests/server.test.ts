import { Server } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startDashboardServer } from "../src/index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startDashboardServer", () => {
  it("설정 포트를 유지하며 루프백 주소에만 바인딩한다", async () => {
    const listen = vi.spyOn(Server.prototype, "listen");
    const server = await startDashboardServer({ port: 0, root: process.cwd() });
    try {
      expect(listen).toHaveBeenCalledWith(0, "127.0.0.1");
    } finally {
      await server.close();
    }
  });
});
