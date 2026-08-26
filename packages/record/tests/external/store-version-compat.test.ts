import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionStore } from "../../src/external/session-store.js";
import { createSqliteSessionStore, loadSession } from "../../src/external/session-store-sqlite.js";

/**
 * store version 1 파일과의 호환(ADR-0085). 버전을 2 로 올리면서 지켜야 하는 것은 두 가지다.
 *
 * 1. **v1 세션은 그대로 읽힌다** — 재생·목록·조회 전부. 버전을 올렸다고 기존 녹화가 "우리
 *    세션이 아니다" 가 되면 사용자는 아무 잘못 없이 재녹화를 강요당한다.
 * 2. **여는 것만으로는 v1 파일을 바꾸지 않는다.** 녹화를 거절하는 경로(#290)가 사용자 파일을
 *    올려 버리면, 실패한 실행이 파일을 바꾼 것이다. 올리는 것은 실제로 세션을 만드는 순간뿐이다.
 */

const directories: string[] = [];
const opened: SessionStore[] = [];

const newDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "mcpeak-store-compat-"));
  directories.push(dir);
  return dir;
};

const track = (store: SessionStore): SessionStore => {
  opened.push(store);
  return store;
};

/**
 * v1 스키마 그대로의 세션 파일. 코드가 아니라 **버전 1 의 DDL 을 손으로 재현**한다 — 지금
 * 코드로 만들면 v2 파일이 되므로, 과거 파일의 모양은 여기 박제해 둔 것이 정본이다.
 */
function writeV1Session(
  path: string,
  options: { readonly withSession?: boolean; readonly status?: string } = {},
): void {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY,
      status     TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed'))
    );
    CREATE TABLE interactions (
      session_id     TEXT    NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      interaction_id TEXT    NOT NULL,
      ordinal        INTEGER NOT NULL,
      occurrence     INTEGER NOT NULL,
      recorded_at    TEXT    NOT NULL,
      status         TEXT    NOT NULL CHECK (status IN ('incomplete', 'complete')),
      protocol       TEXT    NOT NULL,
      match_key      TEXT    NOT NULL,
      request_json   TEXT    NOT NULL,
      outcome_json   TEXT,
      PRIMARY KEY (session_id, interaction_id)
    );
    CREATE UNIQUE INDEX interactions_lookup
      ON interactions (session_id, protocol, match_key, occurrence);
    CREATE INDEX interactions_ordinal ON interactions (session_id, ordinal);
    INSERT INTO meta (key, value) VALUES ('store_version', '1');
  `);
  if (options.withSession !== false) {
    db.prepare("INSERT INTO sessions (session_id, status) VALUES ('default', ?)").run(
      options.status ?? "completed",
    );
    db.prepare(
      `INSERT INTO interactions
         (session_id, interaction_id, ordinal, occurrence, recorded_at, status, protocol, match_key, request_json, outcome_json)
       VALUES ('default', 'default:0', 0, 0, '2026-08-01T00:00:00.000Z', 'complete', 'http', 'key-a', ?, ?)`,
    ).run(
      JSON.stringify({
        protocol: "http",
        interactionSchemaVersion: 1,
        matchKey: "key-a",
        display: {
          method: "GET",
          url: "https://example.com/a",
          headers: {},
          body: { kind: "none" },
        },
      }),
      JSON.stringify({
        kind: "response",
        status: 200,
        statusText: "OK",
        headers: [["content-type", "application/json"]],
        url: "https://example.com/a",
        body: { ok: true },
      }),
    );
  }
  db.close();
}

const storedVersion = (path: string): string => {
  const db = new DatabaseSync(path, { readOnly: true });
  const row = db.prepare("SELECT value FROM meta WHERE key = 'store_version'").get() as {
    value: string;
  };
  db.close();
  return row.value;
};

afterEach(() => {
  for (const store of opened.splice(0)) store.close();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("store version 1 호환", () => {
  it("loadSession 은 v1 세션을 그대로 읽고 origin 만 없다", () => {
    const path = join(newDir(), "v1.db");
    writeV1Session(path);

    const snapshot = loadSession(path);

    expect(snapshot?.status).toBe("completed");
    expect(snapshot?.interactions).toHaveLength(1);
    expect(snapshot?.origin).toBeUndefined();
  });

  it("v1 세션을 읽기 전용으로 열어 재생 조회를 할 수 있다", () => {
    const path = join(newDir(), "v1.db");
    writeV1Session(path);

    const store = track(createSqliteSessionStore({ path, readOnly: true }));
    const interaction = store.lookup({
      sourceSessionId: "default",
      protocol: "http",
      matchKey: "key-a",
      occurrence: 0,
    });

    expect(interaction?.outcome).toMatchObject({ kind: "response", status: 200 });
  });

  it("녹화가 든 v1 파일에 다시 녹화하면 거절하고, 파일 버전을 올리지 않는다", () => {
    const path = join(newDir(), "v1.db");
    writeV1Session(path);

    const store = track(createSqliteSessionStore({ path }));
    expect(() =>
      store.createSession("default", { command: "node", args: [], suitePath: "a.suite.json" }),
    ).toThrow();
    store.close();

    // 거절당한 실행이 사용자 파일을 바꾸지 않았다는 단언이다.
    expect(storedVersion(path)).toBe("1");
  });

  it("빈 v1 파일에 세션을 만들면 그때 현재 버전으로 올리고 출처를 저장한다", () => {
    const path = join(newDir(), "v1-empty.db");
    writeV1Session(path, { withSession: false });

    const store = track(createSqliteSessionStore({ path }));
    store.createSession("default", {
      command: "node",
      args: ["server.mjs"],
      suitePath: "a.suite.json",
    });

    expect(store.read("default")?.origin).toEqual({
      command: "node",
      args: ["server.mjs"],
      suitePath: "a.suite.json",
    });
    store.close();
    expect(storedVersion(path)).toBe("2");
  });

  it("모르는 버전의 파일은 세션으로 보지 않는다", () => {
    const path = join(newDir(), "v9.db");
    writeV1Session(path);
    const db = new DatabaseSync(path);
    db.prepare("UPDATE meta SET value = '9' WHERE key = 'store_version'").run();
    db.close();

    expect(loadSession(path)).toBeNull();
  });
});
