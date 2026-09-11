import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startExternalCoordinator } from "../../src/external/coordinator.js";
import { createMemorySessionStore } from "../../src/external/session-store.js";
import { WRITER_HEADER } from "../../src/shared/writer.mjs";

const handles: Array<Awaited<ReturnType<typeof startExternalCoordinator>>> = [];

afterEach(async () => {
  await Promise.allSettled(handles.splice(0).map((handle) => handle.finish("failed")));
});

/**
 * 기록자 식별자는 실행마다 다른 값이다. 그래서 이 파일은 값 자체를 단언하지 않고 **같은가
 * 다른가**만 본다. 여기에 고정 문자열을 기대하는 단언이 들어오면 결정론성이 아니라 우연을
 * 재게 된다.
 */
const WRITER_A = "writer-a";
const WRITER_B = "writer-b";

/**
 * `fetch` 가 아니라 `node:http` 로 보낸다. 빈 문자열 헤더를 그대로 실어야 하는 케이스가 있고,
 * 그 값은 고수준 클라이언트가 조용히 지워 버릴 수 있다 — 그러면 "빈 문자열" 케이스가 "헤더
 * 없음" 케이스와 같아져 검사하려던 것이 사라진다.
 */
const post = (
  url: string,
  path: string,
  token: string,
  payload: unknown,
  writer: string | undefined,
): Promise<{
  status: number;
  body: { error?: { code?: string; message?: string } } & Record<string, unknown>;
}> =>
  new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload));
    const request = httpRequest(
      new URL(path, url),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "content-length": body.byteLength,
          ...(writer === undefined ? {} : { [WRITER_HEADER]: writer }),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
          });
        });
      },
    );
    request.on("error", reject);
    request.end(body);
  });

/** 규칙을 지킨 자식이 보낼 법한 요청. `coordinator-auth.test.ts` 의 것과 같은 모양이다. */
const normalizedRequest = (matchKey: string) => ({
  protocol: "http",
  interactionSchemaVersion: 1,
  matchKey,
  display: {
    method: "GET",
    url: "https://example.com/<redacted>",
    headers: { accept: ["application/json"] },
    body: { kind: "none" },
  },
});

const startRecord = async (sessionId: string) => {
  const store = createMemorySessionStore();
  const handle = await startExternalCoordinator({ mode: "record", sessionId, store });
  handles.push(handle);
  const token = handle.childEnvironment.MCPEAK_EXTERNAL_COORDINATOR_TOKEN ?? "";
  /**
   * `/begin` 만 보내고 두면 그 상호작용이 미완료로 남아 `finish("completed")` 가 던진다. 이
   * 파일이 보려는 것은 기록자 판정이지 미완료 처리가 아니므로, 통과한 예약은 곧바로 닫는다.
   */
  const begin = async (writer: string | undefined, matchKey = "a".repeat(64)) => {
    const response = await post(
      handle.url,
      "/begin",
      token,
      { schemaVersion: 1, request: normalizedRequest(matchKey) },
      writer,
    );
    if (response.status !== 200) return response;
    const { interactionId } = response.body.reservation as { interactionId: string };
    await post(
      handle.url,
      "/complete",
      token,
      {
        schemaVersion: 1,
        interactionId,
        outcome: { kind: "throw", failureKind: "network", name: "TypeError" },
      },
      writer,
    );
    return response;
  };
  return { store, handle, token, begin };
};

/**
 * 재생 Coordinator 를 띄우려면 완료된 원본이 있어야 한다(`createReplayEngine`). 상호작용은
 * 필요 없다 — 이 파일이 보는 것은 기록자 판정이고, 그 판정은 `/lookup` 이 원본을 뒤지기
 * 전에 끝난다.
 */
const startReplay = async (sourceSessionId: string) => {
  const store = createMemorySessionStore();
  store.createSession(sourceSessionId);
  store.finish(sourceSessionId, "completed");
  const handle = await startExternalCoordinator({ mode: "replay", sourceSessionId, store });
  handles.push(handle);
  const token = handle.childEnvironment.MCPEAK_EXTERNAL_COORDINATOR_TOKEN ?? "";
  const lookup = (writer: string | undefined, matchKey = "b".repeat(64)) =>
    post(
      handle.url,
      "/lookup",
      token,
      { schemaVersion: 1, request: normalizedRequest(matchKey) },
      writer,
    );
  return { store, handle, token, lookup };
};

describe("단일 기록자 판정 (ADR-0095)", () => {
  it("기록자 식별자 헤더가 없으면 400 으로 거절한다", async () => {
    const session = await startRecord("no-header");

    const response = await session.begin(undefined);

    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe("REQUEST_INVALID");
  });

  it("빈 문자열 식별자도 없는 것과 같이 거절한다", async () => {
    const session = await startRecord("empty-header");

    const response = await session.begin("");

    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe("REQUEST_INVALID");
  });

  it("같은 식별자로 여러 번 보내면 전부 통과하고 예약은 서로 다르다", async () => {
    const session = await startRecord("same-writer");

    const first = await session.begin(WRITER_A);
    const second = await session.begin(WRITER_A);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstId = (first.body.reservation as { interactionId: string }).interactionId;
    const secondId = (second.body.reservation as { interactionId: string }).interactionId;
    expect(firstId).not.toBe(secondId);
  });

  it("먼저 온 식별자가 임자이고 다른 식별자는 409 로 거절한다", async () => {
    const session = await startRecord("conflict");

    expect((await session.begin(WRITER_A)).status).toBe(200);
    const rejected = await session.begin(WRITER_B);

    expect(rejected.status).toBe(409);
    expect(rejected.body.error?.code).toBe("WRITER_CONFLICT");
  });

  it("거절한 횟수를 요약에 싣는다", async () => {
    const session = await startRecord("counted");
    expect((await session.begin(WRITER_A)).status).toBe(200);
    for (let index = 0; index < 3; index += 1)
      expect((await session.begin(WRITER_B)).status).toBe(409);

    const summary = await session.handle.finish("completed");

    expect(summary.otherProcessCalls).toBe(3);
  });

  it("경합이 없었던 세션은 0 을 싣는다 — 없음이 아니라 0 이다", async () => {
    const session = await startRecord("clean");
    expect((await session.begin(WRITER_A)).status).toBe(200);

    const summary = await session.handle.finish("completed");

    expect(summary.otherProcessCalls).toBe(0);
  });

  it("거절이 임자의 자격을 빼앗지 않는다", async () => {
    const session = await startRecord("keeps-claim");
    expect((await session.begin(WRITER_A)).status).toBe(200);
    expect((await session.begin(WRITER_B)).status).toBe(409);

    const again = await session.begin(WRITER_A);

    expect(again.status).toBe(200);
  });

  it("경합은 세션을 실패로 닫지 않는다 — 마스킹 불변식 위반과 다른 갈래다", async () => {
    const session = await startRecord("stays-open");
    expect((await session.begin(WRITER_A)).status).toBe(200);
    expect((await session.begin(WRITER_B)).status).toBe(409);

    const summary = await session.handle.finish("completed");

    expect(summary.status).toBe("completed");
    expect(session.store.read("stays-open")?.status).toBe("completed");
  });

  it("재생에서는 거절 문구가 실제 네트워크로 나가지 않았음을 말한다", async () => {
    const session = await startReplay("replay-source");
    // 임자를 먼저 세운다. 원본이 비어 있어 `/lookup` 자체는 못 찾지만, 기록자 판정은 그 앞에서
    // 끝나므로 A 가 임자가 된다.
    await session.lookup(WRITER_A);

    const rejected = await session.lookup(WRITER_B);

    expect(rejected.status).toBe(409);
    expect(rejected.body.error?.code).toBe("WRITER_CONFLICT");
    expect(rejected.body.error?.message).toContain("실제 네트워크는 호출하지 않았습니다");
  });
});
