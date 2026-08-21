import { afterEach, describe, expect, it } from "vitest";
import { startExternalCoordinator } from "../../src/external/coordinator.js";
import { MAX_COORDINATOR_PAYLOAD_BYTES } from "../../src/external/protocol.js";
import { createMemorySessionStore } from "../../src/external/session-store.js";

const handles: Array<Awaited<ReturnType<typeof startExternalCoordinator>>> = [];

afterEach(async () => {
  await Promise.allSettled(handles.splice(0).map((handle) => handle.finish("failed")));
});

describe("external coordinator authentication", () => {
  it("token 누락은 401, 틀린 token은 403이며 오류 본문에 token을 싣지 않는다", async () => {
    const handle = await startExternalCoordinator({
      mode: "record",
      sessionId: "auth",
      store: createMemorySessionStore(),
    });
    handles.push(handle);
    const token = handle.childEnvironment.MCPEAK_EXTERNAL_COORDINATOR_TOKEN ?? "";

    const missing = await fetch(`${handle.url}/begin`, { method: "POST", body: "{}" });
    expect(missing.status).toBe(401);
    expect(await missing.text()).not.toContain(token);

    const wrongToken = "wrong-token-value";
    const wrong = await fetch(`${handle.url}/begin`, {
      method: "POST",
      headers: { authorization: `Bearer ${wrongToken}` },
      body: "{}",
    });
    expect(wrong.status).toBe(403);
    const body = await wrong.text();
    expect(body).not.toContain(token);
    expect(body).not.toContain(wrongToken);
  });

  it("알 수 없는 schema version과 payload 상한 초과를 fail-closed로 거절한다", async () => {
    const handle = await startExternalCoordinator({
      mode: "record",
      sessionId: "limits",
      store: createMemorySessionStore(),
    });
    handles.push(handle);
    const token = handle.childEnvironment.MCPEAK_EXTERNAL_COORDINATOR_TOKEN ?? "";
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };

    const unknown = await fetch(`${handle.url}/begin`, {
      method: "POST",
      headers,
      body: JSON.stringify({ schemaVersion: 999 }),
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ error: { code: "SCHEMA_VERSION_UNSUPPORTED" } });

    const oversized = await fetch(`${handle.url}/begin`, {
      method: "POST",
      headers,
      body: "x".repeat(MAX_COORDINATOR_PAYLOAD_BYTES + 1),
    });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
  });
});
