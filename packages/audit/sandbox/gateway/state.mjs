// @ts-check
import { createRecorder, createReplayer, SESSION_SCHEMA_VERSION } from "./session.mjs";

/**
 * @typedef {import("../../src/types.js").ObservedRequest} ObservedRequest
 * @typedef {import("../../src/types.js").SandboxPhase} SandboxPhase
 * @typedef {"live" | "record" | "replay"} GatewayMode
 * @typedef {ReturnType<typeof createState>} GatewayState
 */

/**
 * 게이트웨이 한 개의 상태. 전부 메모리에 있고 프로세스와 함께 사라진다.
 * @param {GatewayMode} mode
 */
export function createState(mode) {
  /** @type {Set<() => void>} */
  const idleWaiters = new Set();
  return {
    mode,
    /** 지금 단계. 요청·이름 질의·인증서 거부 기록에 받은 시점의 값이 붙는다. */
    phase: /** @type {SandboxPhase} */ ({ kind: "start" }),
    /** 받았지만 아직 응답이 끝나지 않은 요청 수. */
    inflight: 0,
    requests: /** @type {ObservedRequest[]} */ ([]),
    tlsRejections: /** @type {Array<{ phase: SandboxPhase, host: string }>} */ ([]),
    dnsNames: /** @type {Array<{ phase: SandboxPhase, name: string }>} */ ([]),
    secrets: /** @type {Array<import("./session.mjs").Secret>} */ ([]),
    recorder: createRecorder(),
    /** replay 로 시작했는데 아직 세션을 받지 못했으면 빈 세션이다. 모든 요청이 replay-miss 가 된다. */
    replayer: createReplayer({ schemaVersion: SESSION_SCHEMA_VERSION, entries: [] }),
    /** 진행 중 요청이 0 이 됐다. */
    notifyIdle() {
      for (const wake of [...idleWaiters]) wake();
    },
    /**
     * 진행 중 요청이 0 이 되면 바로, 아니면 `limitMs` 뒤에 끝난다.
     * @param {number} limitMs
     * @returns {Promise<void>}
     */
    waitIdle(limitMs) {
      if (this.inflight === 0) return Promise.resolve();
      return new Promise((resolve) => {
        const wake = () => {
          clearTimeout(timer);
          idleWaiters.delete(wake);
          resolve();
        };
        const timer = setTimeout(wake, limitMs);
        idleWaiters.add(wake);
      });
    },
  };
}
