import { externalError } from "./errors.js";
import type { NormalizedExternalRequest, StoredExternalOutcome } from "./protocol.js";

export type SessionStatus = "running" | "completed" | "failed";
export type InteractionStatus = "incomplete" | "complete";

export interface ReserveInteractionInput {
  readonly sessionId: string;
  readonly request: NormalizedExternalRequest;
}

export interface InteractionReservation {
  readonly interactionId: string;
  readonly ordinal: number;
  readonly occurrence: number;
  readonly recordedAt: string;
}

export interface CompleteInteractionInput {
  readonly sessionId: string;
  readonly interactionId: string;
  readonly outcome: StoredExternalOutcome;
}

export interface LookupInteractionInput {
  readonly sourceSessionId: string;
  readonly protocol: NormalizedExternalRequest["protocol"];
  readonly matchKey: string;
  readonly occurrence: number;
}

export interface StoredInteraction extends InteractionReservation {
  readonly status: InteractionStatus;
  readonly request: NormalizedExternalRequest;
  readonly outcome?: StoredExternalOutcome;
}

export interface SessionSnapshot {
  readonly sessionId: string;
  readonly status: SessionStatus;
  readonly interactions: readonly StoredInteraction[];
}

export interface RecordSessionSummary {
  readonly mode: "record";
  readonly sessionId: string;
  readonly status: SessionStatus;
  readonly interactionCount: number;
  readonly consumedCount: 0;
  readonly unusedCount: 0;
}

export interface ReplaySessionSummary {
  readonly mode: "replay";
  readonly sourceSessionId: string;
  readonly status: "completed" | "failed";
  readonly interactionCount: number;
  readonly consumedCount: number;
  readonly unusedCount: number;
}

export type SessionSummary = RecordSessionSummary | ReplaySessionSummary;

export interface SessionStore {
  createSession(sessionId: string): void;
  reserve(input: ReserveInteractionInput): InteractionReservation;
  complete(input: CompleteInteractionInput): void;
  lookup(input: LookupInteractionInput): StoredInteraction | undefined;
  finish(sessionId: string, status: "completed" | "failed"): RecordSessionSummary;
  read(sessionId: string): SessionSnapshot | undefined;
}

interface MutableInteraction {
  interactionId: string;
  ordinal: number;
  occurrence: number;
  recordedAt: string;
  status: InteractionStatus;
  request: NormalizedExternalRequest;
  outcome?: StoredExternalOutcome;
}

interface MutableSession {
  sessionId: string;
  status: SessionStatus;
  interactions: MutableInteraction[];
}

const interactionSnapshot = (value: MutableInteraction): StoredInteraction =>
  Object.freeze({
    interactionId: value.interactionId,
    ordinal: value.ordinal,
    occurrence: value.occurrence,
    recordedAt: value.recordedAt,
    status: value.status,
    request: value.request,
    ...(value.outcome === undefined ? {} : { outcome: value.outcome }),
  });

const sessionSnapshot = (value: MutableSession): SessionSnapshot =>
  Object.freeze({
    sessionId: value.sessionId,
    status: value.status,
    interactions: Object.freeze(value.interactions.map(interactionSnapshot)),
  });

export function createMemorySessionStore(): SessionStore {
  const sessions = new Map<string, MutableSession>();

  const requiredSession = (sessionId: string): MutableSession => {
    const session = sessions.get(sessionId);
    if (session === undefined)
      externalError("SESSION_NOT_FOUND", `External session '${sessionId}'을 찾지 못했습니다.`);
    return session;
  };

  return {
    createSession(sessionId) {
      if (sessionId.length === 0) externalError("REQUEST_INVALID", "sessionId가 비어 있습니다.");
      if (sessions.has(sessionId))
        externalError(
          "SESSION_ALREADY_EXISTS",
          `External session '${sessionId}'이 이미 존재합니다. 기존 세션을 덮어쓰지 않습니다.`,
        );
      sessions.set(sessionId, { sessionId, status: "running", interactions: [] });
    },

    reserve({ sessionId, request }) {
      const session = requiredSession(sessionId);
      if (session.status !== "running")
        externalError(
          "SESSION_NOT_RUNNING",
          `External session '${sessionId}'이 실행 중이 아닙니다.`,
        );
      const sameKey = session.interactions.filter(
        (interaction) =>
          interaction.request.protocol === request.protocol &&
          interaction.request.matchKey === request.matchKey,
      );
      if (sameKey.some((interaction) => interaction.status === "incomplete"))
        externalError(
          "CONCURRENT_MATCH",
          "같은 외부 요청의 동시 호출은 현재 지원하지 않습니다. 앞 호출이 끝난 뒤 다시 시도하세요.",
        );
      const ordinal = session.interactions.length;
      const reservation = Object.freeze({
        interactionId: `${sessionId}:${ordinal}`,
        ordinal,
        occurrence: sameKey.length,
        recordedAt: new Date().toISOString(),
      });
      session.interactions.push({ ...reservation, status: "incomplete", request });
      return reservation;
    },

    complete({ sessionId, interactionId, outcome }) {
      const session = requiredSession(sessionId);
      if (session.status !== "running")
        externalError(
          "SESSION_NOT_RUNNING",
          `External session '${sessionId}'이 실행 중이 아닙니다.`,
        );
      const interaction = session.interactions.find((item) => item.interactionId === interactionId);
      if (interaction === undefined)
        externalError("INTERACTION_NOT_FOUND", "완료할 External interaction을 찾지 못했습니다.");
      if (interaction.status === "complete")
        externalError("INTERACTION_ALREADY_COMPLETE", "External interaction이 이미 완료됐습니다.");
      interaction.status = "complete";
      interaction.outcome = outcome;
    },

    lookup({ sourceSessionId, protocol, matchKey, occurrence }) {
      const session = requiredSession(sourceSessionId);
      if (session.status !== "completed")
        externalError(
          "REPLAY_SOURCE_INVALID",
          `External session '${sourceSessionId}'은 완료된 Replay 원본이 아닙니다.`,
        );
      const interaction = session.interactions.find(
        (item) =>
          item.status === "complete" &&
          item.request.protocol === protocol &&
          item.request.matchKey === matchKey &&
          item.occurrence === occurrence,
      );
      return interaction === undefined ? undefined : interactionSnapshot(interaction);
    },

    finish(sessionId, status) {
      const session = requiredSession(sessionId);
      if (session.status !== "running") {
        return Object.freeze({
          mode: "record",
          sessionId,
          status: session.status,
          interactionCount: session.interactions.length,
          consumedCount: 0,
          unusedCount: 0,
        });
      }
      const incomplete = session.interactions.filter((item) => item.status === "incomplete");
      if (status === "completed" && incomplete.length > 0) {
        session.status = "failed";
        // 어떤 호출이 걸렸는지 말해 주지 않으면 사용자는 서버 코드 전체를 뒤져야 한다.
        // 지원하지 않는 응답(비-JSON·redirect)에서 이 경로로 오는 것이 가장 흔하다.
        // `display` 는 마스킹된 쪽이라 그대로 내보내도 안전하다(ADR-0053).
        const listed = incomplete
          .slice(0, 3)
          .map((item) => `  - ${item.request.display.method} ${item.request.display.url}`)
          .join("\n");
        const rest = incomplete.length > 3 ? `\n  ... 외 ${incomplete.length - 3}건` : "";
        externalError(
          "INCOMPLETE_SESSION",
          `External session '${sessionId}'에 완료되지 않은 외부 호출이 ${incomplete.length}건 있습니다.\n` +
            `${listed}${rest}\n` +
            "→ 지원하지 않는 응답(비-JSON·redirect)을 받으면 그 호출은 저장하지 않고 세션을 실패로 둡니다.\n" +
            "→ 해당 endpoint가 JSON을 돌려주는지 확인하거나, 그 호출을 녹화 범위에서 빼세요.",
        );
      }
      session.status = status;
      return Object.freeze({
        mode: "record",
        sessionId,
        status: session.status,
        interactionCount: session.interactions.length,
        consumedCount: 0,
        unusedCount: 0,
      });
    },

    read(sessionId) {
      const session = sessions.get(sessionId);
      return session === undefined ? undefined : sessionSnapshot(session);
    },
  };
}
