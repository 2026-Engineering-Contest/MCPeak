import { externalError } from "./errors.js";
import type { NormalizedExternalRequest, StoredExternalOutcome } from "./protocol.js";
import type {
  InteractionReservation,
  ReplayMissDetail,
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
  // **두 실패를 가른다.** 세션이 아예 없는 것과 있는데 미완료인 것은 사용자가 할 일이 정반대다
  // — 앞은 경로를 고치거나 녹화를 하는 것이고, 뒤는 녹화를 다시 뜨는 것이다. 한 문장으로
  // 합쳐 두었더니 오타 친 사람에게 "다시 녹화하라" 고 말했다(#260).
  //
  // 세션 id 는 문장에 넣지 않는다. CLI 는 파일 하나를 세션 하나로 쓰며 id 를 `"default"` 로
  // 고정하는데, 사용자는 그 이름을 준 적이 없어 화면에서 무엇을 가리키는지 알 수 없다.
  // 사용자가 아는 식별자는 **경로**이고 그것은 호출자만 안다.
  if (source === undefined)
    externalError("SESSION_NOT_FOUND", "세션 파일에 녹화된 External 세션이 없습니다.");
  if (source.status !== "completed")
    externalError(
      "REPLAY_SOURCE_INVALID",
      "녹화가 완료되지 않은 세션입니다. 녹화 실행이 실패했을 수 있습니다.",
    );
  const cursors = new Map<string, number>();
  let consumedCount = 0;
  // MCP 오류 채널로 던지는 메시지와 별개로 쌓는다. 그 채널은 `runner` 가 테스트 대상 서버의
  // 텍스트로 취급해 이스케이프·200자 절단을 걸어, 우리 자신의 진단이 실려도 서버 텍스트와
  // 똑같이 망가진다(#259). `finish()` 의 요약에 실어 CLI 가 별도 채널로 그대로 보여준다.
  const misses: ReplayMissDetail[] = [];

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
      if (interaction?.outcome === undefined) {
        // `display` 는 마스킹된 쪽이라 그대로 보여도 안전하다(ADR-0053). matchKey 는 앞
        // 12자만 — 전체는 64자라 한 줄을 삼키는데, 세션 안에서 구분하기에는 이만큼이면 된다.
        // 만든 자리에서 바로 얼린다 — 소비자가 `summary.misses[0].url` 을 고치면 같은 참조인
        // 내부 `misses` 도 함께 바뀌어 이후 조회가 오염된 값을 돌려준다.
        misses.push(
          Object.freeze({
            method: request.display.method,
            url: request.display.url,
            occurrence,
            matchKeyPrefix: request.matchKey.slice(0, 12),
          }),
        );
        // 어떤 호출이 빠졌는지 말하지 않으면 사용자는 서버 코드를 뒤져 가며 짐작해야 한다.
        // 이 메시지는 MCP 오류로 나가 테스트 대상 서버가 relay 하는 방식에 달렸으므로,
        // 위 `misses` 가 진단의 정본이고 이 문구는 그 채널이 살아있을 때의 보너스일 뿐이다.
        externalError(
          "REPLAY_MISS",
          `저장된 외부 응답을 찾지 못했습니다. 실제 네트워크는 호출하지 않았습니다.\n` +
            `  ${request.display.method} ${request.display.url}\n` +
            `  occurrence ${occurrence} · matchKey ${request.matchKey.slice(0, 12)}…\n` +
            "→ 이 호출이 녹화된 뒤에 추가되었거나, 요청이 녹화 때와 달라져 다른 matchKey가 되었습니다.\n" +
            "→ 녹화를 다시 하거나, 요청이 실행마다 달라지는 값을 담고 있는지 확인하세요.",
        );
      }
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
        misses: Object.freeze(misses.slice()),
      });
    },
  };
}
