import { externalError } from "./errors.js";
import type { NormalizedExternalRequest, StoredExternalOutcome } from "./protocol.js";
import type {
  InteractionReservation,
  ReplaySessionSummary,
  SessionStore,
  SessionSummary,
  StoredInteraction,
} from "./session-store.js";

export interface CompleteRecordInput {
  readonly interactionId: string;
  readonly outcome: StoredExternalOutcome;
}

export interface RecordEngine {
  readonly mode: "record";
  begin(request: NormalizedExternalRequest): InteractionReservation;
  complete(input: CompleteRecordInput): void;
  finish(status: "completed" | "failed"): SessionSummary;
}

export interface ReplayEngine {
  readonly mode: "replay";
  lookup(request: NormalizedExternalRequest): StoredInteraction & {
    readonly outcome: StoredExternalOutcome;
  };
  finish(status: "completed" | "failed"): ReplaySessionSummary;
}

export type ExternalEngine = RecordEngine | ReplayEngine;

export function createRecordEngine(options: {
  readonly sessionId: string;
  readonly store: SessionStore;
}): RecordEngine {
  options.store.createSession(options.sessionId);
  return {
    mode: "record",
    begin: (request) => options.store.reserve({ sessionId: options.sessionId, request }),
    complete: ({ interactionId, outcome }) =>
      options.store.complete({ sessionId: options.sessionId, interactionId, outcome }),
    finish: (status) => options.store.finish(options.sessionId, status),
  };
}

export function createReplayEngine(options: {
  readonly sourceSessionId: string;
  readonly store: SessionStore;
}): ReplayEngine {
  const source = options.store.read(options.sourceSessionId);
  if (source === undefined || source.status !== "completed")
    externalError(
      "REPLAY_SOURCE_INVALID",
      `External session '${options.sourceSessionId}'은 완료된 Replay 원본이 아닙니다.`,
    );
  const cursors = new Map<string, number>();
  let consumedCount = 0;

  return {
    mode: "replay",
    lookup(request) {
      const cursorKey = `${request.protocol}\0${request.matchKey}`;
      const occurrence = cursors.get(cursorKey) ?? 0;
      const interaction = options.store.lookup({
        sourceSessionId: options.sourceSessionId,
        protocol: request.protocol,
        matchKey: request.matchKey,
        occurrence,
      });
      if (interaction?.outcome === undefined)
        externalError(
          "REPLAY_MISS",
          `저장된 외부 응답을 찾지 못했습니다 (occurrence ${occurrence}). 실제 네트워크는 호출하지 않았습니다.`,
        );
      cursors.set(cursorKey, occurrence + 1);
      consumedCount += 1;
      return { ...interaction, outcome: interaction.outcome };
    },
    finish(status) {
      return Object.freeze({
        mode: "replay",
        sourceSessionId: options.sourceSessionId,
        status,
        interactionCount: source.interactions.length,
        consumedCount,
        unusedCount: Math.max(0, source.interactions.length - consumedCount),
      });
    },
  };
}
