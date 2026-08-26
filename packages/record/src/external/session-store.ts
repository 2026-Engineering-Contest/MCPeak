import { externalError } from "./errors.js";
import type { NormalizedExternalRequest, StoredExternalOutcome } from "./protocol.js";
import * as message from "./store-messages.js";

export type SessionStatus = "running" | "completed" | "failed";
export type InteractionStatus = "incomplete" | "complete";

/**
 * 녹화를 시작한 실행의 재료(ADR-0085). 재생은 서버를 실제로 띄우고 스위트를 실제로 돌리는데,
 * 그 둘이 세션 밖에 있었다 — 재생하려는 사용자가 매번 서버와 스위트를 다시 지목해야 했던
 * 것이 이 타입이 생긴 이유다. 녹화 시점에 함께 저장해 두면 재생은 세션 파일 하나로 시작할
 * 수 있다.
 */
export interface SessionOrigin {
  /** 실행 파일 하나. CLI `--command` 에 그대로 실린다. */
  readonly command: string;
  /** CLI `--arg` 로 하나씩 실릴 값들. 순서가 의미를 가지므로 배열 그대로 담는다. */
  readonly args: readonly string[];
  /** 녹화를 시작한 실행이 돌린 스위트 경로. */
  readonly suitePath: string;
}

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
  /**
   * 녹화를 시작한 실행의 서버 명령·스위트(ADR-0085). **없을 수 있다** — store version 1 에
   * 녹화된 세션에는 이 정보가 저장된 적이 없다. 추측해 채우지 않는다(`outOfScope` 의
   * "undefined 는 0 이 아니라 못 셌음" 과 같은 정책).
   */
  readonly origin?: SessionOrigin;
}

/**
 * 세션 안에서 **서로 다른** URL 의 개수다(ADR-0062). 값은 담지 않는다 — 진단이 새 유출 경로가
 * 되지 않게 하는 형식적 보장이다.
 */
export interface BodyUrlCounts {
  /** 그 요청의 pathname 을 그대로 되돌려 담은 URL. 확실한 갈래다. */
  readonly echoed: number;
  /** 되돌아온 경로는 아니지만 URL 로 해석되는 문자열. 약한 신호다. */
  readonly other: number;
  /**
   * 지문 개수 상한에 걸려 일부를 세지 못했다는 표시. 참이면 위 개수는 **최소값**이다 —
   * 화면에는 "N건" 이 아니라 "N건 이상" 으로 나가야 한다.
   */
  readonly truncated: boolean;
}

export interface RecordSessionSummary {
  readonly mode: "record";
  readonly sessionId: string;
  readonly status: SessionStatus;
  readonly interactionCount: number;
  readonly consumedCount: 0;
  readonly unusedCount: 0;
  /**
   * **Store 는 채우지 않는다.** 세션 전체에서 중복을 제거해야 나오는 값이라 interaction 하나만
   * 보는 Store 의 일이 아니고, 애초에 저장하지도 않는다(ADR-0062). 이 필드를 채우는 것은
   * Engine 이며, 그래서 `RecordEngineSummary` 는 이것을 필수로 좁힌다 — 녹화 경로를 거쳐
   * 나온 요약에는 항상 있다.
   */
  readonly bodyUrls?: BodyUrlCounts;
}

/**
 * 재생 원본에서 찾지 못한 호출 하나. 사용자에게 보일 진단이라 `display` 필드만 담는다
 * (ADR-0053 — 마스킹된 쪽이라 그대로 보여도 안전하다). `matchKey` 는 앞 12자만 — 세션 안에서
 * 구분하기에는 이만큼이면 되고, 전체 64자는 한 줄을 삼킨다.
 */
export interface ReplayMissDetail {
  readonly method: string;
  readonly url: string;
  readonly occurrence: number;
  readonly matchKeyPrefix: string;
}

export interface ReplaySessionSummary {
  readonly mode: "replay";
  readonly sourceSessionId: string;
  readonly status: "completed" | "failed";
  readonly interactionCount: number;
  readonly consumedCount: number;
  readonly unusedCount: number;
  /**
   * 이번 실행에서 원본에 없어 실패한 호출들. **MCP 오류 채널을 거치지 않은 원본이다** — 그
   * 채널은 `runner` 가 테스트 대상 서버의 텍스트로 취급해 이스케이프·잘라내므로, 우리 자신의
   * 진단이 거기 실리면 서버 텍스트와 똑같이 망가진다(#259). CLI 는 이 목록을 별도 블록으로
   * 그대로 보여준다.
   */
  readonly misses: readonly ReplayMissDetail[];
  /**
   * 원본에서 **가장 먼저** 녹화된 시각(ISO 8601, UTC). 원본이 비었으면 없다.
   *
   * **나이가 아니라 시각인 것이 요점이다**(ADR-0069). 나이("12일 전")나 임계값 경고를 내려면
   * 지금 시각을 읽어야 하고, 그러면 같은 세션의 같은 재생이 날마다 다른 바이트를 낸다 —
   * 이 저장소가 결정론을 핵심 가치로 두고 대시보드 e2e 가 SSE 바이트 동일을 단언하는 자리다.
   * 시각은 저장된 값이라 언제 읽어도 같다. 낡았는지 판정하는 것은 사람의 몫으로 남긴다.
   */
  readonly recordedAt?: string;
  /**
   * 이 실행에서 어댑터 **범위 밖으로 나간** HTTP 호출 수(ADR-0068). `node:http`·`node:https`
   * 와 그 위의 라이브러리를 센다 — 재생 중에도 실제 네트워크로 나가는 호출들이다.
   *
   * **`undefined` 는 0 이 아니라 "못 셌음" 이다.** 자식이 강제 종료돼 보고 훅이 못 뛰었거나
   * 관측을 설치하지 못한 경우다. 둘을 같게 다루면 "안 나갔다" 고 단정하게 되는데, 이 필드가
   * 생긴 이유가 바로 그 단정을 없애는 것이다. Store 는 이 값을 모른다 — Coordinator 가
   * 자식의 보고를 읽어 요약에 얹는다.
   */
  readonly outOfScope?: number;
}

export type SessionSummary = RecordSessionSummary | ReplaySessionSummary;

export interface SessionStore {
  /**
   * `origin` 은 선택이다(ADR-0085). 넘기면 세션과 함께 저장돼 `read()`·`loadSession` 의
   * 스냅샷에 실린다. 안 넘기면 스냅샷의 `origin` 도 없다 — 빈 객체로 채우지 않는다.
   */
  createSession(sessionId: string, origin?: SessionOrigin): void;
  reserve(input: ReserveInteractionInput): InteractionReservation;
  complete(input: CompleteInteractionInput): void;
  lookup(input: LookupInteractionInput): StoredInteraction | undefined;
  finish(sessionId: string, status: "completed" | "failed"): RecordSessionSummary;
  read(sessionId: string): SessionSnapshot | undefined;
  /**
   * 저장 자원을 놓는다. 부모가 세션을 다 쓰고 마지막에 부른다(ADR-0052 의 명시적 수명주기).
   *
   * 메모리 구현에는 놓을 것이 없지만 계약에 둔다. 없으면 파일 기반 구현이 핸들을 붙든 채
   * 남고, 호출자가 "이 Store 는 닫아야 하나" 를 알려면 구현 종류를 알아야 한다 — 갈아 끼울
   * 수 있다는 계약의 취지가 거기서 깨진다. **여러 번 불러도 안전해야 한다.**
   */
  close(): void;
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
  origin?: SessionOrigin;
}

/**
 * 저장할 값을 **복사한 뒤 얼린다.** 양쪽이 각각 다른 문제를 막는다.
 *
 * **복사**는 호출자를 지킨다. 넘겨받은 객체를 그대로 얼리면 호출자 쪽에서도 불변이 되어,
 * 그 객체를 다시 쓰려던 코드가 `TypeError` 로 죽는다. SQLite 구현은 넣을 때 직렬화하므로
 * 호출자 객체가 멀쩡한데, 메모리만 얼리면 **저장 매체에 따라 동작이 갈린다** — 계약이
 * 없애려는 것이 정확히 그 차이다.
 *
 * **얼리기**는 저장본을 지킨다. 스냅샷은 최상위만 얼리고 `request`·`outcome` 은 참조를 그대로
 * 넘기므로, 얼려 두지 않으면 `snapshot.request.display.method = "DELETE"` 한 줄로 저장본이
 * 바뀐다. 그러면 이미 계산된 matchKey 와 저장된 `match` 가 어긋나고 Replay 가 기록과 다른
 * 것을 돌려준다.
 *
 * 읽을 때가 아니라 **쓸 때** 하는 이유는 `read` 가 반복 호출되기 때문이다. 넣을 때 한 번이면
 * 끝나고, 저장된 뒤 이 값들이 바뀔 일도 없다 — `status` 와 `outcome` 교체는 바깥 wrapper 에서
 * 일어난다.
 */
const freezeDeep = (value: unknown): void => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    freezeDeep((value as Record<string, unknown>)[key]);
  }
};

const storedCopy = <T>(value: T): T => {
  const copy = structuredClone(value);
  freezeDeep(copy);
  return copy;
};

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
    ...(value.origin === undefined ? {} : { origin: value.origin }),
  });

export function createMemorySessionStore(): SessionStore {
  const sessions = new Map<string, MutableSession>();

  const requiredSession = (sessionId: string): MutableSession => {
    const session = sessions.get(sessionId);
    if (session === undefined)
      externalError("SESSION_NOT_FOUND", message.sessionNotFound(sessionId));
    return session;
  };

  return {
    createSession(sessionId, origin) {
      if (sessionId.length === 0) externalError("REQUEST_INVALID", "sessionId가 비어 있습니다.");
      if (sessions.has(sessionId))
        externalError("SESSION_ALREADY_EXISTS", message.sessionAlreadyExists(sessionId));
      sessions.set(sessionId, {
        sessionId,
        status: "running",
        interactions: [],
        // `request` 와 같은 이유로 복사해 얼린다 — 호출자가 배열을 재사용해도 저장본이 안 바뀐다.
        ...(origin === undefined ? {} : { origin: storedCopy(origin) }),
      });
    },

    reserve({ sessionId, request }) {
      const session = requiredSession(sessionId);
      if (session.status !== "running")
        externalError("SESSION_NOT_RUNNING", message.sessionNotRunning(sessionId));
      const sameKey = session.interactions.filter(
        (interaction) =>
          interaction.request.protocol === request.protocol &&
          interaction.request.matchKey === request.matchKey,
      );
      if (sameKey.some((interaction) => interaction.status === "incomplete"))
        externalError("CONCURRENT_MATCH", message.concurrentMatch);
      const ordinal = session.interactions.length;
      const reservation = Object.freeze({
        interactionId: `${sessionId}:${ordinal}`,
        ordinal,
        occurrence: sameKey.length,
        recordedAt: new Date().toISOString(),
      });
      session.interactions.push({
        ...reservation,
        status: "incomplete",
        request: storedCopy(request),
      });
      return reservation;
    },

    complete({ sessionId, interactionId, outcome }) {
      const session = requiredSession(sessionId);
      if (session.status !== "running")
        externalError("SESSION_NOT_RUNNING", message.sessionNotRunning(sessionId));
      const interaction = session.interactions.find((item) => item.interactionId === interactionId);
      if (interaction === undefined)
        externalError("INTERACTION_NOT_FOUND", message.interactionNotFound);
      if (interaction.status === "complete")
        externalError("INTERACTION_ALREADY_COMPLETE", message.interactionAlreadyComplete);
      interaction.status = "complete";
      interaction.outcome = storedCopy(outcome);
    },

    lookup({ sourceSessionId, protocol, matchKey, occurrence }) {
      const session = requiredSession(sourceSessionId);
      if (session.status !== "completed")
        externalError("REPLAY_SOURCE_INVALID", message.replaySourceInvalid(sourceSessionId));
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
        externalError("INCOMPLETE_SESSION", message.incompleteSession(sessionId, incomplete));
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

    close() {
      // 메모리 구현은 놓을 자원이 없다. 계약을 맞추기 위한 no-op 이다.
    },
  };
}
