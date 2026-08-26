import { externalError } from "./errors.js";
import type {
  BodyUrlFingerprints,
  NormalizedExternalRequest,
  StoredExternalOutcome,
} from "./protocol.js";
import type {
  BodyUrlCounts,
  InteractionReservation,
  RecordSessionSummary,
  ReplayMissDetail,
  ReplaySessionSummary,
  SessionOrigin,
  SessionStore,
  StoredInteraction,
} from "./session-store.js";

export interface CompleteRecordInput {
  readonly interactionId: string;
  readonly outcome: StoredExternalOutcome;
  /** ADR-0062. 자식이 body 에서 찾은 URL 지문. 저장하지 않고 세기만 한다. */
  readonly bodyUrls?: BodyUrlFingerprints;
}

/**
 * Engine 이 낸 녹화 요약. `bodyUrls` 를 **필수로 좁힌다** — Store 계약에서는 선택 필드지만
 * (Store 가 채우지 않으므로), 녹화 경로를 거쳐 나온 요약에는 Engine 이 항상 채운다.
 */
export interface RecordEngineSummary extends RecordSessionSummary {
  readonly bodyUrls: BodyUrlCounts;
}

export interface RecordEngine {
  readonly mode: "record";
  begin(request: NormalizedExternalRequest): InteractionReservation;
  complete(input: CompleteRecordInput): void;
  finish(status: "completed" | "failed"): RecordEngineSummary;
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
  /** 녹화를 시작한 실행의 서버 명령·스위트(ADR-0085). 넘기면 세션과 함께 저장된다. */
  readonly origin?: SessionOrigin;
}): RecordEngine {
  options.store.createSession(options.sessionId, options.origin);
  // ADR-0062. 지문만 쌓는다 — 세션 전체에서 중복을 제거해야 "서로 다른 URL 의 개수" 가 되고,
  // 그 집계는 interaction 하나만 보는 Store 가 할 수 없다. 저장소에는 쓰지 않는다.
  const echoed = new Set<string>();
  const other = new Set<string>();
  let truncated = false;
  return {
    mode: "record",
    begin: (request) => options.store.reserve({ sessionId: options.sessionId, request }),
    complete: ({ interactionId, outcome, bodyUrls }) => {
      // **저장을 먼저 성공시키고 그 뒤에 센다.** 순서를 뒤집으면 `INTERACTION_NOT_FOUND` 나
      // `INTERACTION_ALREADY_COMPLETE` 로 거절된 interaction 의 지문이 집계에 남아, 세션에
      // 없는 URL 을 있다고 말하게 된다.
      options.store.complete({ sessionId: options.sessionId, interactionId, outcome });
      if (bodyUrls === undefined) return;
      for (const digest of bodyUrls.echoed) echoed.add(digest);
      for (const digest of bodyUrls.other) other.add(digest);
      if (bodyUrls.truncated === true) truncated = true;
    },
    finish: (status) => {
      const summary = options.store.finish(options.sessionId, status);
      return Object.freeze({
        ...summary,
        bodyUrls: Object.freeze({
          truncated,
          echoed: echoed.size,
          // **합집합으로 판정한다.** 같은 URL 이 어떤 interaction 에서는 그 요청 경로와 맞고
          // 다른 interaction 에서는 안 맞을 수 있다. 먼저 본 쪽을 쓰면 interaction 순서에
          // 따라 숫자가 달라져 결정론성이 깨진다 — 한 번이라도 되돌아온 경로였으면 그쪽으로
          // 세고, 한 지문은 정확히 한 갈래에만 센다(ADR-0062).
          other: [...other].filter((digest) => !echoed.has(digest)).length,
        }),
      });
    },
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
      // `interactions` 는 `ordinal` 순이고 `recordedAt` 은 reserve 시점에 찍히므로, 첫 항목이
      // 가장 먼저 녹화된 것이다. **지금 시각을 읽지 않는다** — 나이 계산은 이 요약의 일이
      // 아니고, 애초에 아무도 할 일이 아니다(ADR-0069).
      const first = source.interactions[0];
      return Object.freeze({
        mode: "replay",
        sourceSessionId: options.sourceSessionId,
        status,
        interactionCount: source.interactions.length,
        consumedCount,
        unusedCount: Math.max(0, source.interactions.length - consumedCount),
        ...(first === undefined ? {} : { recordedAt: first.recordedAt }),
        misses: Object.freeze(misses.slice()),
      });
    },
  };
}
