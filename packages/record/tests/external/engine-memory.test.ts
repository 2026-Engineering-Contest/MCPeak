import { describe, expect, it } from "vitest";
import { createRecordEngine, createReplayEngine } from "../../src/external/engine.js";
import type {
  NormalizedExternalRequest,
  StoredExternalOutcome,
} from "../../src/external/protocol.js";
import { createMemorySessionStore } from "../../src/external/session-store.js";

const request = (matchKey = "match-a"): NormalizedExternalRequest => ({
  protocol: "http",
  schemaVersion: 1,
  matchKey,
  match: {
    method: "GET",
    url: `https://example.com/${matchKey}`,
    headers: {},
    body: { kind: "none" },
  },
  display: {
    method: "GET",
    url: `https://example.com/${matchKey}`,
    headers: {},
    body: { kind: "none" },
  },
});

const outcome = (value: number): StoredExternalOutcome => ({
  kind: "response",
  status: 200,
  statusText: "OK",
  headers: [["content-type", "application/json"]],
  url: "https://example.com/result",
  body: { value },
});

describe("memory external engine", () => {
  it("같은 matchKey에 occurrence를 0부터 부여하고 Replay에서 한 번씩 소비한다", () => {
    const store = createMemorySessionStore();
    const record = createRecordEngine({ sessionId: "source", store });

    const first = record.begin(request());
    expect(first).toMatchObject({ ordinal: 0, occurrence: 0 });
    expect(Number.isNaN(Date.parse(first.recordedAt))).toBe(false);
    record.complete({ interactionId: first.interactionId, outcome: outcome(1) });

    const second = record.begin(request());
    expect(second).toMatchObject({ ordinal: 1, occurrence: 1 });
    record.complete({ interactionId: second.interactionId, outcome: outcome(2) });
    record.finish("completed");

    const replay = createReplayEngine({ sourceSessionId: "source", store });
    expect(replay.lookup(request()).outcome).toEqual(outcome(1));
    expect(replay.lookup(request()).outcome).toEqual(outcome(2));
    expect(() => replay.lookup(request())).toThrowError(
      expect.objectContaining({ code: "REPLAY_MISS" }),
    );
    expect(replay.finish("completed")).toMatchObject({ consumedCount: 2, unusedCount: 0 });
  });

  it("앞 호출이 complete되기 전 같은 matchKey begin을 거절한다", () => {
    const store = createMemorySessionStore();
    const record = createRecordEngine({ sessionId: "concurrent", store });
    record.begin(request());

    expect(() => record.begin(request())).toThrowError(
      expect.objectContaining({ code: "CONCURRENT_MATCH" }),
    );
  });

  it("incomplete interaction이 있으면 세션을 failed로 만들고 Replay 원본으로 거절한다", () => {
    const store = createMemorySessionStore();
    const record = createRecordEngine({ sessionId: "broken", store });
    record.begin(request());

    expect(() => record.finish("completed")).toThrowError(
      expect.objectContaining({ code: "INCOMPLETE_SESSION" }),
    );
    expect(store.read("broken")?.status).toBe("failed");
    expect(() => createReplayEngine({ sourceSessionId: "broken", store })).toThrowError(
      expect.objectContaining({ code: "REPLAY_SOURCE_INVALID" }),
    );
  });

  it("Replay에 남은 interaction은 실패가 아니라 unused 요약으로 반환한다", () => {
    const store = createMemorySessionStore();
    const record = createRecordEngine({ sessionId: "partial", store });
    for (const key of ["a", "b"]) {
      const reservation = record.begin(request(key));
      record.complete({ interactionId: reservation.interactionId, outcome: outcome(1) });
    }
    record.finish("completed");

    const replay = createReplayEngine({ sourceSessionId: "partial", store });
    replay.lookup(request("a"));
    expect(replay.finish("completed")).toMatchObject({ consumedCount: 1, unusedCount: 1 });
  });
});
