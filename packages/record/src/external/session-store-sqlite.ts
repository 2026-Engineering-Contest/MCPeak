import { DatabaseSync } from "node:sqlite";
import { externalError } from "./errors.js";
import type { NormalizedExternalRequest, StoredExternalOutcome } from "./protocol.js";
import type {
  InteractionReservation,
  RecordSessionSummary,
  SessionOrigin,
  SessionSnapshot,
  SessionStatus,
  SessionStore,
  StoredInteraction,
} from "./session-store.js";
import * as message from "./store-messages.js";

/**
 * 영속 `SessionStore`. 같은 계약(`session-store-contract.test.ts`)을 메모리 구현과 공유한다.
 *
 * **부모만 이 파일을 연다**(ADR-0052). 자식 Adapter 는 DB 경로도 라이브러리도 알지 못하고,
 * loopback Coordinator 로만 말한다. 그래서 여기서 `node:sqlite` 를 import 해도 자식의
 * 런타임 요구사항은 늘지 않는다.
 *
 * `node:sqlite` 는 Node 22.13 부터 플래그 없이 쓸 수 있고, 저장소의 최소 버전은 22.18 이다
 * (ADR-0054). Node 22.x 는 실행마다 `ExperimentalWarning` 을 stderr 에 찍을 수 있는데, 이
 * 모듈은 **프로세스 전역 warning 설정을 건드리지 않는다** — 라이브러리가 호출자의 전역
 * 상태를 바꾸면 안 되고, ADR-0054 도 전체 listener 제거를 금지했다. 표시 정책은 CLI 배선
 * (단계 C-2)에서 정한다.
 */

/**
 * 물리 스키마 버전. 칼럼이나 인덱스가 바뀌면 올리고 마이그레이션을 붙인다.
 *
 * v2: `sessions` 에 녹화 출처 칼럼(command·args_json·suite_path)을 더한다(ADR-0085).
 */
export const SQLITE_STORE_VERSION = 2;

/**
 * 읽을 수 있는 버전들. **쓰기는 항상 현재 버전이지만 읽기는 v1 세션도 그대로 받는다** —
 * 버전을 올렸다고 기존 녹화가 전부 "우리 세션이 아니다" 가 되면, 사용자는 아무 잘못 없이
 * 재녹화를 강요당한다. 재녹화는 실제 네트워크를 다시 부르는 일이고, 외부 API 가 그 사이
 * 바뀌었다면 같은 녹화를 다시 뜰 수도 없다. v1 세션은 출처(origin)만 없이 읽힌다.
 */
const READABLE_STORE_VERSIONS = new Set(["1", String(SQLITE_STORE_VERSION)]);

/**
 * `interaction` 은 protocol 별 세부를 **불투명 JSON 칼럼**으로 담는다(ADR-0052).
 *
 * HTTP 전용 필드(method·url·헤더)를 공통 칼럼으로 올리면 두 번째 protocol 어댑터가
 * 들어올 때 스키마 마이그레이션이 필요해진다. 조회에 실제로 쓰는 것은
 * `(session_id, protocol, match_key, occurrence)` 넷뿐이라 그것만 칼럼으로 둔다.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  status     TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  -- 녹화 출처(ADR-0085). NULL 이면 출처 없이 녹화된 세션이다(v1 파일 포함).
  -- NOT NULL 을 걸지 않는 것은 v1 파일을 ALTER 로 올릴 때 기존 행이 채울 값이 없어서다.
  command    TEXT,
  args_json  TEXT,
  suite_path TEXT
);

CREATE TABLE IF NOT EXISTS interactions (
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

-- Replay 의 유일한 조회 경로다. UNIQUE 인 이유는 같은 자리에 두 건이 생기면 어느 쪽을
-- 돌려줄지가 실행 순서에 달리기 때문이다 — 결정론성이 깨지는 자리라 DB 가 막는다.
CREATE UNIQUE INDEX IF NOT EXISTS interactions_lookup
  ON interactions (session_id, protocol, match_key, occurrence);

-- read() 가 기록 순서대로 돌려주기 위한 것.
CREATE INDEX IF NOT EXISTS interactions_ordinal
  ON interactions (session_id, ordinal);
`;

interface InteractionRow {
  readonly interaction_id: string;
  readonly ordinal: number;
  readonly occurrence: number;
  readonly recorded_at: string;
  readonly status: "incomplete" | "complete";
  readonly request_json: string;
  readonly outcome_json: string | null;
}

const toInteraction = (row: InteractionRow): StoredInteraction =>
  Object.freeze({
    interactionId: row.interaction_id,
    ordinal: row.ordinal,
    occurrence: row.occurrence,
    recordedAt: row.recorded_at,
    status: row.status,
    request: Object.freeze(JSON.parse(row.request_json) as NormalizedExternalRequest),
    ...(row.outcome_json === null
      ? {}
      : { outcome: Object.freeze(JSON.parse(row.outcome_json) as StoredExternalOutcome) }),
  });

export interface SqliteSessionStoreOptions {
  /** DB 파일 경로. 생략하면 프로세스 수명만큼 사는 인메모리 DB 다. */
  readonly path?: string;
  /**
   * 재생처럼 **읽기만 하는** 경로에서 켠다. 켜면 DB 를 읽기 전용으로 열고 DDL·`meta` INSERT
   * 를 돌리지 않는다 — **주어진 파일을 만들지도 고치지도 않는다.**
   *
   * 끄면(기본) 지금까지처럼 없는 경로에 파일을 만들고 스키마를 심는다. 녹화의 동작이다.
   *
   * 이 구분이 필요한 이유는 껐을 때의 부작용이 재생에서 결함이 되기 때문이다. 재생은 읽기인데
   * 스키마를 무조건 심으면 (1) 읽기 전용(chmod 444) 세션은 `attempt to write a readonly
   * database` 로 한 건도 재생되지 않고, (2) 0바이트 파일을 넘기면 **실패한 실행이 사용자
   * 파일을 빈 세션 DB 로 덮어쓴다.** 실패한 실행이 사용자 파일을 바꾸지 않는 것이 기준이다.
   */
  readonly readOnly?: boolean;
}

/** 읽기 전용으로 열 때 "이 파일이 우리 세션인가" 를 판정한 결과. */
type ReadOnlyProbe = "ok" | "not-a-session" | "version-mismatch";

/**
 * `loadSession` 과 같은 판정을 쓴다 — 열 이름이 같아도 다른 version 의 파일은 우리 세션이
 * 아니다. 다만 답은 다르게 쓴다. `loadSession` 은 판별기라 `null` 이지만, 여기는 사용자가
 * **이 파일로 재생하겠다고 지목한** 자리라 왜 안 되는지를 말해야 한다.
 */
const probeSessionFile = (db: DatabaseSync): ReadOnlyProbe => {
  let version: { value: string } | undefined;
  try {
    version = db.prepare("SELECT value FROM meta WHERE key = 'store_version'").get() as
      | { value: string }
      | undefined;
  } catch {
    // `meta` 테이블이 없다. SQLite 이긴 하나 우리가 만든 파일이 아니다.
    return "not-a-session";
  }
  if (version === undefined) return "not-a-session";
  return READABLE_STORE_VERSIONS.has(version.value) ? "ok" : "version-mismatch";
};

/** 스냅샷용 출처 행 → `SessionOrigin`. 셋 중 하나라도 온전하지 않으면 없다고 말한다. */
interface OriginRow {
  readonly command: string | null;
  readonly args_json: string | null;
  readonly suite_path: string | null;
}

const toOrigin = (row: OriginRow | undefined): SessionOrigin | undefined => {
  if (row === undefined || row.command === null || row.suite_path === null) return undefined;
  if (row.command === "" || row.suite_path === "") return undefined;
  let args: unknown;
  try {
    args = JSON.parse(row.args_json ?? "[]");
  } catch {
    // 깨진 값으로 절반짜리 출처를 만들지 않는다. 출처가 틀리면 재생은 엉뚱한 서버를 띄운다.
    return undefined;
  }
  if (!Array.isArray(args) || !args.every((item) => typeof item === "string")) return undefined;
  return Object.freeze({
    command: row.command,
    args: Object.freeze(args),
    suitePath: row.suite_path,
  });
};

const openReadOnly = (path: string): DatabaseSync => {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch {
    // 없는 경로이거나 열 수 없는 파일이다. **읽기 전용이라 이 실패가 파일을 만들지 않는다** —
    // 기본 모드로 열었다면 여기서 빈 DB 가 생겼다.
    externalError(
      "SESSION_NOT_FOUND",
      "세션 파일을 열지 못했습니다. 경로가 없거나 읽을 수 없습니다.",
    );
  }
  const probe = probeSessionFile(db);
  if (probe === "ok") return db;
  db.close();
  if (probe === "version-mismatch")
    externalError(
      "SCHEMA_VERSION_UNSUPPORTED",
      `이 세션 파일은 지원하지 않는 store version 입니다(현재 ${SQLITE_STORE_VERSION}).\n` +
        "→ 이 버전의 mcpeak 으로 다시 녹화하세요.",
    );
  externalError(
    "SESSION_NOT_FOUND",
    "이 파일에는 녹화된 External 세션이 없습니다.\n" +
      "→ 녹화할 때 지정한 세션 파일 경로가 맞는지 확인하세요.",
  );
};

export function createSqliteSessionStore(options: SqliteSessionStoreOptions = {}): SessionStore {
  const readOnly = options.readOnly === true;
  // 인메모리 DB 를 읽기 전용으로 여는 것은 빈 DB 를 읽겠다는 말이라 항상 실패한다. 그
  // 실패를 SQLite 문장으로 받지 않고 여기서 부른 쪽의 실수로 지목한다.
  if (readOnly && options.path === undefined)
    externalError("REQUEST_INVALID", "읽기 전용 세션 저장소에는 파일 경로가 필요합니다.");

  const db = readOnly
    ? openReadOnly(options.path as string)
    : new DatabaseSync(options.path ?? ":memory:");
  if (!readOnly) {
    // 외래 키는 기본이 꺼져 있다. 세션을 지우면 interaction 이 남는 것을 DB 가 막게 한다.
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(SCHEMA);
    db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('store_version', ?)").run(
      String(SQLITE_STORE_VERSION),
    );
  }

  /**
   * 읽기 전용 저장소에 쓰기를 요청한 자리. SQLite 에 맡기면 `attempt to write a readonly
   * database` 가 그대로 사용자에게 나가는데, 그것은 우리 어휘가 아니고 무엇을 잘못했는지도
   * 말하지 않는다. 부른 쪽의 실수를 여기서 지목한다.
   */
  const rejectWrite = (what: string): never =>
    externalError(
      "REQUEST_INVALID",
      `읽기 전용으로 연 세션 저장소에 ${what}을 요청했습니다.\n` +
        "→ 녹화하려면 읽기 전용이 아닌 저장소로 여세요.",
    );

  /**
   * 문장 준비를 감싼다. **`meta.store_version` 만으로는 우리 파일임을 다 말하지 못하기
   * 때문이다** — 그 행 하나만 든 파일도 판정을 통과하고, 그러면 여기서 `no such table:
   * sessions` 라는 SQLite 원문이 사용자에게 그대로 나가고 DB 핸들도 열린 채 남는다.
   *
   * 준비가 실패한다는 것은 우리 스키마가 아니라는 뜻이다. 읽기 전용은 **우리가 만들지 않은
   * 파일을 받는 자리**라 그 판정을 여기서 내려야 한다. 쓰기 모드는 바로 위에서 DDL 을 심었으니
   * 준비가 실패하면 그것은 우리 결함이고, 삼키지 않고 그대로 올린다.
   */
  const prepared = <T>(build: () => T): T => {
    try {
      return build();
    } catch (error) {
      if (db.isOpen) db.close();
      if (!readOnly) throw error;
      externalError(
        "SESSION_NOT_FOUND",
        "이 파일에는 녹화된 External 세션이 없습니다.\n" +
          "→ 녹화할 때 지정한 세션 파일 경로가 맞는지 확인하세요.",
      );
    }
  };

  /**
   * 이 파일에 저장된 store version. 새 파일은 현재 버전이고, v1 파일을 쓰기 모드로 열면
   * "1" 로 남는다 — **여는 것만으로는 파일을 올리지 않는다.** 녹화를 거절하는 경로(#290,
   * `SESSION_ALREADY_EXISTS`)가 사용자 파일을 바꾸면 안 되기 때문이다. 올리는 것은 실제로
   * 세션을 만드는 순간(`createSession`)이다.
   */
  let fileVersion =
    (
      prepared(() => db.prepare("SELECT value FROM meta WHERE key = 'store_version'").get()) as
        | { value: string }
        | undefined
    )?.value ?? String(SQLITE_STORE_VERSION);

  /**
   * `insertSession` 은 `statements` 에 없다. v1 파일에서는 v2 칼럼을 실은 INSERT 가 **prepare
   * 단계에서** 실패해, 읽기만 하려던 재생까지 여기 걸려 죽는다. 세션 생성은 파일당 한 번이라
   * 그때 준비해도 비용이 없다.
   */
  const statements = prepared(() => ({
    findSession: db.prepare("SELECT status FROM sessions WHERE session_id = ?"),
    setStatus: db.prepare("UPDATE sessions SET status = ? WHERE session_id = ?"),
    countAll: db.prepare("SELECT COUNT(*) AS n FROM interactions WHERE session_id = ?"),
    sameKey: db.prepare(
      `SELECT COUNT(*) AS n, SUM(status = 'incomplete') AS pending
         FROM interactions
        WHERE session_id = ? AND protocol = ? AND match_key = ?`,
    ),
    insertInteraction: db.prepare(
      `INSERT INTO interactions
         (session_id, interaction_id, ordinal, occurrence, recorded_at, status, protocol, match_key, request_json)
       VALUES (?, ?, ?, ?, ?, 'incomplete', ?, ?, ?)`,
    ),
    findInteraction: db.prepare(
      "SELECT status FROM interactions WHERE session_id = ? AND interaction_id = ?",
    ),
    completeInteraction: db.prepare(
      `UPDATE interactions SET status = 'complete', outcome_json = ?
        WHERE session_id = ? AND interaction_id = ?`,
    ),
    lookup: db.prepare(
      `SELECT * FROM interactions
        WHERE session_id = ? AND protocol = ? AND match_key = ? AND occurrence = ?
          AND status = 'complete'`,
    ),
    listIncomplete: db.prepare(
      `SELECT * FROM interactions
        WHERE session_id = ? AND status = 'incomplete' ORDER BY ordinal`,
    ),
    listAll: db.prepare("SELECT * FROM interactions WHERE session_id = ? ORDER BY ordinal"),
  }));

  const sessionStatus = (sessionId: string): SessionStatus | undefined => {
    const row = statements.findSession.get(sessionId) as { status: SessionStatus } | undefined;
    return row?.status;
  };

  const requiredStatus = (sessionId: string): SessionStatus => {
    const status = sessionStatus(sessionId);
    if (status === undefined)
      externalError("SESSION_NOT_FOUND", message.sessionNotFound(sessionId));
    return status;
  };

  const summary = (sessionId: string, status: SessionStatus): RecordSessionSummary => {
    const { n } = statements.countAll.get(sessionId) as { n: number };
    return Object.freeze({
      mode: "record",
      sessionId,
      status,
      interactionCount: n,
      consumedCount: 0,
      unusedCount: 0,
    });
  };

  /** v1 파일을 현재 버전으로 올린다. 기존 행의 새 칼럼은 NULL(출처 없음)로 남는다. */
  const migrateToCurrentVersion = (): void => {
    db.exec(
      `ALTER TABLE sessions ADD COLUMN command TEXT;
       ALTER TABLE sessions ADD COLUMN args_json TEXT;
       ALTER TABLE sessions ADD COLUMN suite_path TEXT;`,
    );
    db.prepare("UPDATE meta SET value = ? WHERE key = 'store_version'").run(
      String(SQLITE_STORE_VERSION),
    );
    fileVersion = String(SQLITE_STORE_VERSION);
  };

  return {
    createSession(sessionId, origin) {
      if (readOnly) rejectWrite("세션 생성");
      if (sessionId.length === 0) externalError("REQUEST_INVALID", "sessionId가 비어 있습니다.");
      if (sessionStatus(sessionId) !== undefined)
        externalError("SESSION_ALREADY_EXISTS", message.sessionAlreadyExists(sessionId));
      // 거절 검사를 다 통과한 뒤에야 올린다 — 여기부터는 어차피 이 파일에 녹화를 쓴다.
      if (fileVersion !== String(SQLITE_STORE_VERSION)) migrateToCurrentVersion();
      db.prepare(
        `INSERT INTO sessions (session_id, status, command, args_json, suite_path)
         VALUES (?, 'running', ?, ?, ?)`,
      ).run(
        sessionId,
        origin?.command ?? null,
        origin === undefined ? null : JSON.stringify(origin.args),
        origin?.suitePath ?? null,
      );
    },

    reserve({ sessionId, request }) {
      if (readOnly) rejectWrite("외부 호출 기록");
      if (requiredStatus(sessionId) !== "running")
        externalError("SESSION_NOT_RUNNING", message.sessionNotRunning(sessionId));

      const same = statements.sameKey.get(sessionId, request.protocol, request.matchKey) as {
        n: number;
        pending: number | null;
      };
      if ((same.pending ?? 0) > 0) externalError("CONCURRENT_MATCH", message.concurrentMatch);

      const { n: ordinal } = statements.countAll.get(sessionId) as { n: number };
      const reservation: InteractionReservation = Object.freeze({
        interactionId: `${sessionId}:${ordinal}`,
        ordinal,
        occurrence: same.n,
        recordedAt: new Date().toISOString(),
      });
      statements.insertInteraction.run(
        sessionId,
        reservation.interactionId,
        reservation.ordinal,
        reservation.occurrence,
        reservation.recordedAt,
        request.protocol,
        request.matchKey,
        JSON.stringify(request),
      );
      return reservation;
    },

    complete({ sessionId, interactionId, outcome }) {
      if (readOnly) rejectWrite("외부 호출 결과 저장");
      if (requiredStatus(sessionId) !== "running")
        externalError("SESSION_NOT_RUNNING", message.sessionNotRunning(sessionId));
      const row = statements.findInteraction.get(sessionId, interactionId) as
        | { status: "incomplete" | "complete" }
        | undefined;
      if (row === undefined) externalError("INTERACTION_NOT_FOUND", message.interactionNotFound);
      if (row.status === "complete")
        externalError("INTERACTION_ALREADY_COMPLETE", message.interactionAlreadyComplete);
      statements.completeInteraction.run(JSON.stringify(outcome), sessionId, interactionId);
    },

    lookup({ sourceSessionId, protocol, matchKey, occurrence }) {
      if (requiredStatus(sourceSessionId) !== "completed")
        externalError("REPLAY_SOURCE_INVALID", message.replaySourceInvalid(sourceSessionId));
      const row = statements.lookup.get(sourceSessionId, protocol, matchKey, occurrence) as
        | InteractionRow
        | undefined;
      return row === undefined ? undefined : toInteraction(row);
    },

    finish(sessionId, status) {
      if (readOnly) rejectWrite("세션 종료 기록");
      const current = requiredStatus(sessionId);
      // 이미 끝난 세션은 요청한 status 를 무시하고 기존 상태를 그대로 돌려준다. 되살리면
      // 저장된 녹화의 의미가 사후에 바뀐다.
      if (current !== "running") return summary(sessionId, current);

      if (status === "completed") {
        const incomplete = (
          statements.listIncomplete.all(sessionId) as unknown as InteractionRow[]
        ).map(toInteraction);
        if (incomplete.length > 0) {
          statements.setStatus.run("failed", sessionId);
          externalError("INCOMPLETE_SESSION", message.incompleteSession(sessionId, incomplete));
        }
      }
      statements.setStatus.run(status, sessionId);
      return summary(sessionId, status);
    },

    read(sessionId) {
      const status = sessionStatus(sessionId);
      if (status === undefined) return undefined;
      const rows = statements.listAll.all(sessionId) as unknown as InteractionRow[];
      // v1 파일에는 출처 칼럼이 없다. 조회 자체를 버전으로 갈라야 `no such column` 이 안 난다.
      const origin =
        fileVersion === String(SQLITE_STORE_VERSION)
          ? toOrigin(
              db
                .prepare("SELECT command, args_json, suite_path FROM sessions WHERE session_id = ?")
                .get(sessionId) as OriginRow | undefined,
            )
          : undefined;
      return Object.freeze<SessionSnapshot>({
        sessionId,
        status,
        interactions: Object.freeze(rows.map(toInteraction)),
        ...(origin === undefined ? {} : { origin }),
      });
    },

    close() {
      // 두 번 닫는 것은 오류가 아니다. 부모가 정상 경로와 실패 경로 양쪽에서 닫으려 할 때
      // 호출자가 "이미 닫혔나" 를 추적하게 만들면, 그 추적을 빠뜨린 쪽에서 파일 핸들이 샌다.
      if (!db.isOpen) return;
      db.close();
    },
  };
}

/**
 * 세션 파일을 **읽기 전용**으로 열어 스냅샷을 준다. 세션 파일이 아니면 `null`.
 *
 * `Store` 가 아니라 **판별기**다. 호출자(대시보드)는 프로젝트를 훑으며 파일마다 "이게
 * 세션인가" 를 묻는다. 그 자리에서는 아닌 파일이 정상 입력이므로 **던지지 않고 `null` 을
 * 준다** — 훑는 쪽이 파일마다 try/catch 를 두르지 않아도 되게 하는 것이 이 계약의 목적이다.
 *
 * `readOnly: true` 가 핵심이다. 기본 모드로 열면 없는 경로에 **빈 DB 를 만들고 스키마까지
 * 심는다.** 그러면 프로젝트를 훑는 것만으로 사용자 저장소에 쓰레기 파일이 깔린다. 읽기
 * 전용으로 열면 없는 파일에서 그 자리에 실패하고 아무것도 만들지 않는다.
 *
 * 열리기는 했지만 내용이 세션이 아닌 경우(테이블 없음·다른 스키마·본문 손상)도 `null` 이다.
 * 판별기의 답은 "읽을 수 있는 세션인가" 하나뿐이고, 그 이유는 호출자가 쓸 데가 없다.
 */
export function loadSession(path: string): SessionSnapshot | null {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch {
    // 없는 경로이거나 열 수 없는 파일이다.
    return null;
  }
  try {
    // 열 이름이 같아도 다른 version 의 파일은 우리 세션이 아니다. 열 때 심은 `meta.store_version`
    // 이 **읽을 수 있는 버전**일 때만 읽는다 — meta 가 없거나 모르는 값이면 "읽을 수 있는
    // 세션" 이 아니다. v1 은 출처만 없이 읽힌다(ADR-0085).
    const version = db.prepare("SELECT value FROM meta WHERE key = 'store_version'").get() as
      | { value: string }
      | undefined;
    if (version === undefined || !READABLE_STORE_VERSIONS.has(version.value)) return null;
    const hasOriginColumns = version.value === String(SQLITE_STORE_VERSION);
    // 세션 파일 하나에 세션 하나다(CLI 의 `SESSION_ID`). 그래도 `ORDER BY` 를 붙이는 것은
    // 여러 건이 들어 있는 파일에서 **어느 것을 고를지가 실행마다 달라지지 않게** 하려는 것이다.
    // 출처 칼럼은 v2 에만 있으므로 SELECT 자체를 버전으로 가른다.
    const session = db
      .prepare(
        hasOriginColumns
          ? `SELECT session_id, status, command, args_json, suite_path
               FROM sessions ORDER BY session_id LIMIT 1`
          : "SELECT session_id, status FROM sessions ORDER BY session_id LIMIT 1",
      )
      .get() as ({ session_id: string; status: SessionStatus } & Partial<OriginRow>) | undefined;
    if (session === undefined) return null;
    const origin = hasOriginColumns
      ? toOrigin({
          command: session.command ?? null,
          args_json: session.args_json ?? null,
          suite_path: session.suite_path ?? null,
        })
      : undefined;
    const rows = db
      .prepare(
        `SELECT interaction_id, ordinal, occurrence, recorded_at, status, request_json, outcome_json
           FROM interactions
          WHERE session_id = ?
          ORDER BY ordinal`,
      )
      .all(session.session_id) as unknown as InteractionRow[];
    return Object.freeze<SessionSnapshot>({
      sessionId: session.session_id,
      status: session.status,
      interactions: Object.freeze(rows.map(toInteraction)),
      ...(origin === undefined ? {} : { origin }),
    });
  } catch {
    // SQLite 는 맞지만 우리 스키마가 아니거나 본문이 깨졌다.
    return null;
  } finally {
    if (db.isOpen) db.close();
  }
}
