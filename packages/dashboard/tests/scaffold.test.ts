import { runCli } from "@ohmymcp-hsu/cli/commands";
import { describe, expect, it } from "vitest";
import { startDashboardServer } from "../src/index.js";

describe("대시보드 스캐폴드", () => {
  it("health가 200과 ok:true를 준다", async () => {
    const server = await startDashboardServer({ port: 0, root: process.cwd() });
    const response = await fetch(`http://127.0.0.1:${server.port}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    await server.close();
    await expect(fetch(`http://127.0.0.1:${server.port}/api/health`)).rejects.toThrow();
  });

  it("ohmymcp/commands가 해석된다", () => {
    expect(typeof runCli).toBe("function");
  });
});
