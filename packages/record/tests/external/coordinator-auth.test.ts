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

describe("Store 직전 재검사 (ADR-0052)", () => {
  /** 규칙을 지킨 자식이 보낼 법한 값. 민감 값은 이미 마스킹돼 있다. */
  const redacted = {
    protocol: "http",
    schemaVersion: 1,
    matchKey: "a".repeat(64),
    match: {
      method: "GET",
      url: "https://example.com/data?apiKey=%5Bredacted%5D",
      headers: { accept: ["application/json"] },
      body: { kind: "none" },
    },
    display: {
      method: "GET",
      url: "https://example.com/data?apiKey=%5Bredacted%5D",
      headers: { accept: ["application/json"], authorization: ["[redacted]"] },
      body: { kind: "none" },
    },
  };

  const begin = async (
    handle: Awaited<ReturnType<typeof startExternalCoordinator>>,
    request: unknown,
  ) =>
    fetch(`${handle.url}/begin`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${handle.childEnvironment.MCPEAK_EXTERNAL_COORDINATOR_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ schemaVersion: 1, request }),
    });

  const start = async () => {
    const handle = await startExternalCoordinator({
      mode: "record",
      sessionId: "recheck",
      store: createMemorySessionStore(),
    });
    handles.push(handle);
    return handle;
  };

  it("제대로 마스킹된 요청은 그대로 통과한다 — 재적용이 멱등이다", async () => {
    const handle = await start();

    expect((await begin(handle, redacted)).status).toBe(200);
  });

  it("자식이 URL query의 토큰을 놓치면 저장 전에 실패한다", async () => {
    const handle = await start();
    const leaky = {
      ...redacted,
      match: { ...redacted.match, url: "https://example.com/data?apiKey=super-secret" },
    };

    const response = await begin(handle, leaky);
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain("EXTERNAL_REDACTION_INVARIANT_VIOLATION");
    // 오류 본문에 새어 나온 값을 다시 실으면 안 된다.
    expect(body).not.toContain("super-secret");
  });

  it("자식이 헤더의 자격증명을 놓치면 저장 전에 실패한다", async () => {
    const handle = await start();
    const leaky = {
      ...redacted,
      display: {
        ...redacted.display,
        headers: { ...redacted.display.headers, authorization: ["Bearer super-secret"] },
      },
    };

    const response = await begin(handle, leaky);
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain("EXTERNAL_REDACTION_INVARIANT_VIOLATION");
    expect(body).not.toContain("super-secret");
  });

  it("자식이 body의 민감 필드를 놓치면 저장 전에 실패한다", async () => {
    const handle = await start();
    const leaky = {
      ...redacted,
      match: {
        ...redacted.match,
        body: { kind: "json", value: { nested: { accessToken: "super-secret" } } },
      },
      display: {
        ...redacted.display,
        body: { kind: "json", value: { nested: { accessToken: "super-secret" } } },
      },
    };

    const response = await begin(handle, leaky);
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain("EXTERNAL_REDACTION_INVARIANT_VIOLATION");
    expect(body).not.toContain("super-secret");
  });
});

describe("불변식 위반 뒤 세션 상태 (ADR-0052)", () => {
  const clean = {
    protocol: "http",
    schemaVersion: 1,
    matchKey: "b".repeat(64),
    match: {
      method: "GET",
      url: "https://example.com/x",
      headers: { accept: ["application/json"] },
      body: { kind: "none" },
    },
    display: {
      method: "GET",
      url: "https://example.com/x",
      headers: { accept: ["application/json"] },
      body: { kind: "none" },
    },
  };

  it("누출된 outcome을 보낸 뒤에는 제대로 마스킹해 다시 보내도 통과하지 못한다", async () => {
    const store = createMemorySessionStore();
    const handle = await startExternalCoordinator({ mode: "record", sessionId: "leak", store });
    handles.push(handle);
    const auth = {
      authorization: `Bearer ${handle.childEnvironment.MCPEAK_EXTERNAL_COORDINATOR_TOKEN}`,
      "content-type": "application/json",
    };

    const began = await fetch(`${handle.url}/begin`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ schemaVersion: 1, request: clean }),
    });
    expect(began.status).toBe(200);
    const { reservation } = (await began.json()) as { reservation: { interactionId: string } };

    // 자식이 응답 헤더의 토큰을 놓친 채 보낸다.
    const leaky = await fetch(`${handle.url}/complete`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        schemaVersion: 1,
        interactionId: reservation.interactionId,
        outcome: {
          kind: "response",
          status: 200,
          statusText: "OK",
          headers: [["x-api-key", "super-secret"]],
          url: "https://example.com/x",
          body: { ok: true },
        },
      }),
    });
    expect(leaky.status).toBe(400);
    expect(await leaky.text()).toContain("EXTERNAL_REDACTION_INVARIANT_VIOLATION");

    // 세션이 이미 닫혔으므로 깨끗한 재시도도 받지 않는다. 400 만 주고 running 으로 두면
    // 여기서 통과해 "새는 Adapter 가 만든 깨끗해 보이는 녹화" 가 남는다.
    const retry = await fetch(`${handle.url}/complete`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        schemaVersion: 1,
        interactionId: reservation.interactionId,
        outcome: {
          kind: "response",
          status: 200,
          statusText: "OK",
          headers: [["x-api-key", "[redacted]"]],
          url: "https://example.com/x",
          body: { ok: true },
        },
      }),
    });

    expect(retry.status).not.toBe(200);
    expect(store.read("leak")?.status).toBe("failed");
    expect(store.read("leak")?.interactions[0]?.status).toBe("incomplete");
  });
});
