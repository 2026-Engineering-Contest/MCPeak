import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteSessionStore } from "@mcpeak/record/external";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSessionInteractions } from "../src/server/files.js";

/**
 * 녹화본 하나의 외부 호출 목록. 판정은 `loadSession` 이 하고, 여기서 보는 것은 세 갈래
 * (응답 · fetch 실패 · 끝나지 않은 호출)를 화면이 쓸 모양으로 옮기는지다.
 */

const request = (matchKey: string, url: string) => ({
  protocol: "http" as const,
  interactionSchemaVersion: 1 as const,
  matchKey,
  display: { method: "GET", url, headers: {}, body: { kind: "none" as const } },
});

/** 응답 · throw · incomplete 를 하나씩 담은 세션. 닫아야 Windows 에서 지울 수 있다. */
function writeThreeWaySession(path: string): void {
  const store = createSqliteSessionStore({ path });
  store.createSession("default");
  const ok = store.reserve({
    sessionId: "default",
    request: request("ok", "https://api.open-meteo.com/<redacted>?city=Seoul"),
  });
  store.complete({
    sessionId: "default",
    interactionId: ok.interactionId,
    outcome: {
      kind: "response",
      status: 200,
      statusText: "OK",
      headers: [["content-type", "application/json"]] as const,
      // 표시용 url 과 **다른** 값이다. 화면에 나가는 것이 display.url 인지 여기서 갈린다.
      url: "https://api.open-meteo.com/v1/forecast?city=Seoul",
      body: { temperature: 21.5, source: "https://api.open-meteo.com/docs" },
    },
  });
  const failed = store.reserve({
    sessionId: "default",
    request: request("dns", "https://nowhere.invalid/<redacted>"),
  });
  store.complete({
    sessionId: "default",
    interactionId: failed.interactionId,
    outcome: { kind: "throw", failureKind: "dns", name: "TypeError", code: "ENOTFOUND" },
  });
  // complete 를 부르지 않는다 — 녹화가 끊긴 호출의 모양이다.
  store.reserve({
    sessionId: "default",
    request: request("cut", "https://api.example.com/<redacted>"),
  });
  store.close();
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mcpeak-dashboard-interactions-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("readSessionInteractions", () => {
  it("응답 · fetch 실패 · 끝나지 않은 호출을 녹화 순서대로 옮긴다", async () => {
    const path = join(root, "weather.session.db");
    writeThreeWaySession(path);

    expect(await readSessionInteractions(path)).toEqual([
      {
        ordinal: 0,
        method: "GET",
        url: "https://api.open-meteo.com/<redacted>?city=Seoul",
        outcome: {
          kind: "response",
          status: 200,
          body: { temperature: 21.5, source: "https://api.open-meteo.com/docs" },
        },
      },
      {
        ordinal: 1,
        method: "GET",
        url: "https://nowhere.invalid/<redacted>",
        outcome: { kind: "throw", failureKind: "dns", code: "ENOTFOUND" },
      },
      {
        ordinal: 2,
        method: "GET",
        url: "https://api.example.com/<redacted>",
        outcome: { kind: "incomplete" },
      },
    ]);
  });

  it("code 가 없는 throw 에는 code 키가 없다", async () => {
    const path = join(root, "abort.session.db");
    const store = createSqliteSessionStore({ path });
    store.createSession("default");
    const reservation = store.reserve({
      sessionId: "default",
      request: request("abort", "https://api.example.com/<redacted>"),
    });
    store.complete({
      sessionId: "default",
      interactionId: reservation.interactionId,
      outcome: { kind: "throw", failureKind: "abort", name: "AbortError" },
    });
    store.close();

    const [entry] = (await readSessionInteractions(path)) ?? [];
    expect(entry?.outcome).toEqual({ kind: "throw", failureKind: "abort" });
    expect(entry !== undefined && "code" in entry.outcome).toBe(false);
  });

  it("세션이 아닌 파일이면 null 이다", async () => {
    const path = join(root, "notes.db");
    await writeFile(path, "not a database", "utf8");
    expect(await readSessionInteractions(path)).toBeNull();
  });

  it("없는 파일이면 null 이고 파일을 만들지 않는다", async () => {
    const path = join(root, "missing.db");
    expect(await readSessionInteractions(path)).toBeNull();
    await expect(stat(path)).rejects.toThrow();
  });
});
