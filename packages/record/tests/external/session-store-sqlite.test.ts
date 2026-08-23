import { chmodSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ExternalRecordReplayError } from "../../src/external/errors.js";
import type {
  NormalizedExternalRequest,
  StoredExternalOutcome,
} from "../../src/external/protocol.js";
import {
  createSqliteSessionStore,
  SQLITE_STORE_VERSION,
  type SqliteSessionStoreOptions,
} from "../../src/external/session-store-sqlite.js";

/**
 * 계약(`session-store-contract.test.ts`)이 아니라 **SQLite 구현에만 있는 성질**을 본다.
 * 계약은 매체를 가리지 않는 스펙이고, 여기는 "영속이라서 되는 것" 을 확인한다.
 */

const directories: string[] = [];
const opened: { close(): void }[] = [];

/** 연 Store 를 모아 두고 정리 때 닫는다. Windows 는 핸들이 열린 파일을 지우지 못한다. */
const open = (path?: string) => {
  const store =
    path === undefined ? createSqliteSessionStore() : createSqliteSessionStore({ path });
  opened.push(store);
  return store;
};

/** 옵션을 그대로 넘겨 여는 갈래. `readOnly` 처럼 `path` 밖의 옵션을 볼 때 쓴다. */
const open2 = (options: SqliteSessionStoreOptions) => {
  const store = createSqliteSessionStore(options);
  opened.push(store);
  return store;
};

/** 계약 밖의 테이블을 직접 볼 때 쓴다. 열린 핸들은 정리 때 함께 닫는다. */
const openRaw = (path: string) => {
  const db = new DatabaseSync(path);
  opened.push({ close: () => db.close() });
  return db;
};

afterEach(() => {
  for (const store of opened.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const newDbPath = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "mcpeak-sqlite-"));
  directories.push(directory);
  return join(directory, "sessions.db");
};

const request = (matchKey: string): NormalizedExternalRequest => ({
  protocol: "http",
  interactionSchemaVersion: 1,
  matchKey,
  display: {
    method: "GET",
    url: `https://example.com/${matchKey}`,
    headers: {},
    body: { kind: "none" },
  },
});

const outcome = (): StoredExternalOutcome => ({
  kind: "response",
  status: 200,
  statusText: "OK",
  headers: [["content-type", "application/json"]],
  url: "https://example.com/a",
  body: { weather: "sunny" },
});

describe("SQLite Session Store", () => {
  it("프로세스를 새로 열어도 녹화가 남는다 — 이것이 메모리 구현과 다른 점이다", () => {
    const path = newDbPath();

    const recording = open(path);
    recording.createSession("s1");
    const reservation = recording.reserve({ sessionId: "s1", request: request("a") });
    recording.complete({
      sessionId: "s1",
      interactionId: reservation.interactionId,
      outcome: outcome(),
    });
    recording.finish("s1", "completed");

    // 같은 파일을 새 Store 인스턴스로 연다. 프로세스가 다시 뜬 상황과 같다.
    const replaying = open(path);
    const found = replaying.lookup({
      sourceSessionId: "s1",
      protocol: "http",
      matchKey: "a",
      occurrence: 0,
    });

    expect(found?.outcome).toEqual(outcome());
    expect(replaying.read("s1")?.status).toBe("completed");
  });

  it("저장한 request를 그대로 돌려준다 — 불투명 JSON 칼럼을 왕복시킨다", () => {
    const path = newDbPath();
    const store = open(path);
    store.createSession("s1");
    const original = request("round-trip");
    const reservation = store.reserve({ sessionId: "s1", request: original });
    store.complete({
      sessionId: "s1",
      interactionId: reservation.interactionId,
      outcome: outcome(),
    });

    const reopened = open(path);
    const stored = reopened.read("s1")?.interactions[0];

    expect(stored?.request).toEqual(original);
  });

  it("실패로 끝난 세션도 실패인 채로 남는다", () => {
    const path = newDbPath();
    const store = open(path);
    store.createSession("s1");
    store.reserve({ sessionId: "s1", request: request("a") });
    expect(() => store.finish("s1", "completed")).toThrow();

    expect(open(path).read("s1")?.status).toBe("failed");
  });

  it("스키마 버전을 기록한다 — 나중에 마이그레이션 판단의 근거가 된다", () => {
    const path = newDbPath();
    open(path);

    // meta 는 계약에 없는 SQLite 내부 테이블이라 직접 확인한다.
    const db = openRaw(path);
    const row = db.prepare("SELECT value FROM meta WHERE key = 'store_version'").get() as {
      value: string;
    };

    expect(Number(row.value)).toBe(SQLITE_STORE_VERSION);
  });

  it("같은 자리에 두 건이 생기지 않도록 DB가 막는다", () => {
    const path = newDbPath();
    const store = open(path);
    store.createSession("s1");
    const first = store.reserve({ sessionId: "s1", request: request("a") });
    store.complete({ sessionId: "s1", interactionId: first.interactionId, outcome: outcome() });

    // (session, protocol, matchKey, occurrence) 는 UNIQUE 다. 같은 자리에 두 건이 있으면
    // Replay 가 어느 쪽을 돌려줄지 실행 순서에 달리므로 결정론성이 깨진다.
    const db = openRaw(path);
    expect(() =>
      db
        .prepare(
          `INSERT INTO interactions
             (session_id, interaction_id, ordinal, occurrence, recorded_at, status, protocol, match_key, request_json)
           VALUES ('s1', 's1:99', 99, 0, '2026-01-01T00:00:00.000Z', 'incomplete', 'http', 'a', '{}')`,
        )
        .run(),
    ).toThrow(/UNIQUE/i);
  });

  it("인메모리 모드는 파일을 만들지 않는다", () => {
    const store = open();
    store.createSession("s1");

    expect(store.read("s1")?.status).toBe("running");
  });

  /**
   * #291. 재생은 읽기인데 저장소가 DDL 을 무조건 돌려, 실패한 실행이 **사용자 파일을 바꿨다.**
   * 아래 넷이 그 결함의 발현이고, `readOnly` 가 그것을 막는지 본다.
   */
  describe("readOnly — 재생은 파일을 만들지도 고치지도 않는다", () => {
    /** 녹화가 끝난 정상 세션 파일 하나를 만들어 둔다. */
    const recorded = (): string => {
      const path = newDbPath();
      const store = createSqliteSessionStore({ path });
      store.createSession("s1");
      const reservation = store.reserve({ sessionId: "s1", request: request("a") });
      store.complete({
        sessionId: "s1",
        interactionId: reservation.interactionId,
        outcome: outcome(),
      });
      store.finish("s1", "completed");
      store.close();
      return path;
    };

    it("정상 세션은 읽기 전용으로도 그대로 재생된다", () => {
      const path = recorded();

      const store = open2({ path, readOnly: true });
      const found = store.lookup({
        sourceSessionId: "s1",
        protocol: "http",
        matchKey: "a",
        occurrence: 0,
      });

      expect(found?.outcome).toEqual(outcome());
      expect(store.read("s1")?.status).toBe("completed");
    });

    /**
     * 저장소에 커밋한 세션·CI 아티팩트 캐시·읽기 전용 마운트가 이 자리다. 기본 모드는
     * `attempt to write a readonly database` 로 한 건도 재생하지 못했다.
     *
     * Windows 는 `chmod` 로 소유자의 쓰기를 막지 못해 이 단언이 성립하지 않는다. 이
     * 결함이 실제로 보고된 환경은 POSIX 이고, CI 의 verify 잡도 ubuntu 다.
     */
    it.skipIf(process.platform === "win32")("읽기 전용(444) 파일도 재생된다", () => {
      const path = recorded();
      chmodSync(path, 0o444);

      const store = open2({ path, readOnly: true });

      expect(
        store.lookup({
          sourceSessionId: "s1",
          protocol: "http",
          matchKey: "a",
          occurrence: 0,
        })?.outcome,
      ).toEqual(outcome());
    });

    it("0바이트 파일로 열면 거부하고 그 파일을 건드리지 않는다", () => {
      const path = join(mkdtempSync(join(tmpdir(), "mcpeak-sqlite-")), "empty.session");
      directories.push(dirname(path));
      writeFileSync(path, "");

      expect(() => createSqliteSessionStore({ path, readOnly: true })).toThrow(
        ExternalRecordReplayError,
      );
      // 기본 모드는 이 자리에서 36,864바이트 빈 세션 DB 로 덮어썼다.
      expect(statSync(path).size).toBe(0);
    });

    it("없는 경로로 열면 거부하고 파일을 만들지 않는다", () => {
      const path = newDbPath();

      expect(() => createSqliteSessionStore({ path, readOnly: true })).toThrow(
        /경로가 없거나 읽을 수 없습니다/,
      );
      expect(existsSync(path)).toBe(false);
    });

    it("우리 세션이 아닌 SQLite 파일은 SESSION_NOT_FOUND 로 거부한다", () => {
      const path = newDbPath();
      const raw = openRaw(path);
      raw.exec("CREATE TABLE unrelated (id INTEGER);");

      expect(() => createSqliteSessionStore({ path, readOnly: true })).toThrow(
        /녹화된 External 세션이 없습니다/,
      );
    });

    /**
     * `meta.store_version` 만으로는 우리 파일임을 다 말하지 못한다. 그 행 하나만 든 파일도
     * 판정을 통과해서, 문장 준비 단계에서 `no such table: sessions` 라는 SQLite 원문이
     * 사용자에게 그대로 나가고 **DB 핸들도 열린 채 남았다.**
     */
    it("meta 만 있고 세션 테이블이 없는 파일도 우리 문장으로 거부한다 — 핸들을 남기지 않는다", () => {
      const path = newDbPath();
      const raw = openRaw(path);
      raw.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
      raw
        .prepare("INSERT INTO meta (key, value) VALUES ('store_version', ?)")
        .run(String(SQLITE_STORE_VERSION));

      expect(() => createSqliteSessionStore({ path, readOnly: true })).toThrow(
        /녹화된 External 세션이 없습니다/,
      );
      // SQLite 원문이 새어 나가면 사용자는 우리 어휘가 아닌 문장을 읽는다.
      expect(() => createSqliteSessionStore({ path, readOnly: true })).not.toThrow(/no such table/);
    });

    it("store version 이 다르면 다시 녹화하라고 말한다 — '세션이 없다' 와 다른 원인이다", () => {
      const path = recorded();
      const raw = openRaw(path);
      raw
        .prepare("UPDATE meta SET value = ? WHERE key = 'store_version'")
        .run(String(SQLITE_STORE_VERSION + 1));

      expect(() => createSqliteSessionStore({ path, readOnly: true })).toThrow(
        /지원하지 않는 store version/,
      );
    });

    it("읽기 전용 저장소에 녹화를 요청하면 SQLite 문장이 아니라 우리 문장으로 거부한다", () => {
      const path = recorded();
      const store = open2({ path, readOnly: true });

      expect(() => store.createSession("s2")).toThrow(/읽기 전용으로 연 세션 저장소에/);
      expect(() => store.finish("s1", "completed")).toThrow(/읽기 전용으로 연 세션 저장소에/);
      // SQLite 원문이 그대로 새어 나가면 사용자는 우리 어휘가 아닌 문장을 읽는다.
      expect(() => store.createSession("s2")).not.toThrow(/readonly database/);
    });

    it("경로 없이 읽기 전용을 켜는 것은 부른 쪽의 실수로 지목한다", () => {
      expect(() => createSqliteSessionStore({ readOnly: true })).toThrow(/파일 경로가 필요합니다/);
    });
  });
});
