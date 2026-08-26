import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createSqliteSessionStore } from "@mcpeak/record/external";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSessions } from "../src/server/files.js";

/**
 * 녹화본 목록. 세션 파일은 SQLite 라 확장자로 거를 수 없다 — `--record-session <path>` 가
 * 임의 경로를 받기 때문이다. 그래서 이 목록이 지켜야 하는 것은 두 가지다: **우리 세션을
 * 빠짐없이 담는 것**과, **우리 것이 아닌 파일에 아무 짓도 하지 않는 것**.
 *
 * 판정 자체는 `loadSession`(record)이 한다. 여기서 단언하는 것은 그 판정을 어떻게 쓰는지다.
 */

/** 상호작용 하나를 만들 재료. 타입은 record 가 공개하지 않으므로 리터럴로 넘긴다. */
const request = (matchKey: string) => ({
  protocol: "http" as const,
  interactionSchemaVersion: 1 as const,
  matchKey,
  display: {
    method: "GET",
    url: `https://example.com/${matchKey}`,
    headers: {},
    body: { kind: "none" as const },
  },
});

const outcome = () => ({
  kind: "response" as const,
  status: 200,
  statusText: "OK",
  headers: [["content-type", "application/json"]] as const,
  url: "https://example.com/a",
  body: { ok: true },
});

/**
 * 세션 파일 하나를 만든다. **닫아야 Windows 에서 지울 수 있다.**
 * `finish` 를 부르지 않으면 `running` 인 채로 남는다 — 녹화가 끊긴 실행의 모양이다.
 */
function writeSession(
  path: string,
  options: {
    readonly matchKeys?: readonly string[];
    readonly finish?: "completed" | "failed";
    readonly origin?: { command: string; args: readonly string[]; suitePath: string };
  } = {},
): void {
  const store = createSqliteSessionStore({ path });
  store.createSession("default", options.origin);
  for (const key of options.matchKeys ?? ["a"]) {
    const reservation = store.reserve({ sessionId: "default", request: request(key) });
    store.complete({
      sessionId: "default",
      interactionId: reservation.interactionId,
      outcome: outcome(),
    });
  }
  if (options.finish !== undefined) store.finish("default", options.finish);
  store.close();
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mcpeak-dashboard-sessions-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("listSessions", () => {
  it("녹화한 세션을 담는다", async () => {
    writeSession(join(root, "weather.db"), { matchKeys: ["a", "b"], finish: "completed" });

    const sessions = await listSessions(root);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      path: "weather.db",
      status: "completed",
      interactionCount: 2,
    });
  });

  /**
   * ADR-0069. **가장 먼저** 녹화된 시각이다 — 세션이 언제 시작됐는지가 낡음의 기준이라
   * 마지막이 아니라 첫 번째다. 나이나 임계값은 계산하지 않는다(지금 시각을 읽으면 결정론이 깨진다).
   */
  it("recordedAt 은 가장 먼저 녹화된 상호작용의 시각이다", async () => {
    const path = join(root, "weather.db");
    writeSession(path, { matchKeys: ["a", "b", "c"], finish: "completed" });

    const [session] = await listSessions(root);

    const db = new DatabaseSync(path, { readOnly: true });
    const first = db
      .prepare("SELECT recorded_at FROM interactions ORDER BY ordinal LIMIT 1")
      .get() as { recorded_at: string };
    db.close();

    expect(session?.recordedAt).toBe(first.recorded_at);
  });

  /** ADR-0085. 세션에 저장된 녹화 출처가 목록에 실려야 원클릭 재생이 성립한다. */
  it("세션에 저장된 출처를 그대로 싣는다", async () => {
    writeSession(join(root, "weather.db"), {
      finish: "completed",
      origin: { command: "node", args: ["server.mjs"], suitePath: "weather.suite.json" },
    });

    const [session] = await listSessions(root);

    expect(session?.origin).toEqual({
      command: "node",
      args: ["server.mjs"],
      suitePath: "weather.suite.json",
    });
  });

  it("출처 없이 녹화된 세션에는 origin 필드가 없다", async () => {
    writeSession(join(root, "plain.db"), { finish: "completed" });

    const [session] = await listSessions(root);

    expect(session?.origin).toBeUndefined();
  });

  /** 없는 것을 지금 시각이나 빈 문자열로 채우지 않는다(ADR-0069). */
  it("상호작용이 없는 세션은 recordedAt 이 없다", async () => {
    writeSession(join(root, "empty.db"), { matchKeys: [], finish: "completed" });

    const [session] = await listSessions(root);

    expect(session?.interactionCount).toBe(0);
    expect(session?.recordedAt).toBeUndefined();
  });

  /**
   * 녹화가 끊긴 세션은 재생이 거절된다(`REPLAY_SOURCE_INVALID`). 목록에서 빼면 사용자는
   * 파일이 있는데 왜 안 보이는지 알 수 없다 — 담되 상태로 가른다.
   */
  it("녹화가 끝나지 않은 세션도 담되 status 로 가른다", async () => {
    writeSession(join(root, "running.db"), { matchKeys: ["a"] });
    writeSession(join(root, "failed.db"), { matchKeys: ["a"], finish: "failed" });

    const sessions = await listSessions(root);

    expect(sessions.map((session) => [session.path, session.status])).toEqual([
      ["failed.db", "failed"],
      ["running.db", "running"],
    ]);
  });

  it("우리 세션이 아닌 SQLite 파일은 담지 않는다", async () => {
    const path = join(root, "other.db");
    const db = new DatabaseSync(path);
    db.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)");
    db.close();

    await expect(listSessions(root)).resolves.toEqual([]);
  });

  it("SQLite 가 아닌 파일은 담지 않는다", async () => {
    await writeFile(join(root, "suite.json"), JSON.stringify({ id: "x" }), "utf8");
    await writeFile(join(root, "notes.txt"), "세션이 아니다", "utf8");

    await expect(listSessions(root)).resolves.toEqual([]);
  });

  it("node_modules · .git · dist 아래는 보지 않는다", async () => {
    for (const directory of ["node_modules", ".git", "dist"]) {
      await mkdir(join(root, directory), { recursive: true });
      writeSession(join(root, directory, "hidden.db"), { finish: "completed" });
    }
    writeSession(join(root, "visible.db"), { finish: "completed" });

    const sessions = await listSessions(root);

    expect(sessions.map((session) => session.path)).toEqual(["visible.db"]);
  });

  it("하위 디렉터리의 세션도 담고 경로는 `/` 로 잇는다", async () => {
    await mkdir(join(root, "tmp", "sessions"), { recursive: true });
    writeSession(join(root, "tmp", "sessions", "weather.db"), { finish: "completed" });

    const sessions = await listSessions(root);

    expect(sessions.map((session) => session.path)).toEqual(["tmp/sessions/weather.db"]);
  });

  it("경로 순으로 정렬한다", async () => {
    writeSession(join(root, "b.db"), { finish: "completed" });
    writeSession(join(root, "a.db"), { finish: "completed" });

    const sessions = await listSessions(root);

    expect(sessions.map((session) => session.path)).toEqual(["a.db", "b.db"]);
  });
});
