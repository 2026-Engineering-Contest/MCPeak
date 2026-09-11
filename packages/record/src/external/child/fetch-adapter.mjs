import { MAX_BODY_URL_FINGERPRINTS } from "../../shared/limits.mjs";
import {
  bodyUrlFingerprints,
  encodeHttpResponse,
  encodeHttpThrow,
  normalizeHttpRequest,
  restoreHttpOutcome,
} from "../runtime.mjs";
import { createCoordinatorClient } from "./coordinator-client.mjs";

const INSTALLATION = Symbol.for("mcpeak.external.fetch-adapter");

/**
 * 지문 집합들을 wire 형태(배열)로 합친다.
 *
 * `Set` 은 `JSON.stringify` 가 `{}` 로 만들어 **조용히 사라지므로** 여기서 반드시 배열로
 * 바꾼다. 그대로 실으면 지문이 없어져 개수가 늘 0 이 되고, 그 실패는 아무 데도 안 남는다.
 *
 * **개수 상한을 여기서 건다.** 1 MiB 를 통과하는 정상 body 가 고유 URL 을 5만 개 가까이 담을
 * 수 있어(실측), 전부 실으면 Coordinator payload 상한을 넘겨 **정상 녹화가 실패한다.**
 * `echoed` 를 먼저 채우는 것은 그쪽이 확실한 갈래라 사용자가 먼저 봐야 할 것이기 때문이다.
 */
const wire = (...found) => {
  const echoed = new Set(found.flatMap((one) => [...one.echoed]));
  const other = new Set(found.flatMap((one) => [...one.other]));
  const kept = { echoed: [...echoed], other: [] };
  for (const digest of other) {
    if (kept.echoed.length + kept.other.length >= MAX_BODY_URL_FINGERPRINTS) break;
    kept.other.push(digest);
  }
  // `echoed` 만으로 상한을 넘길 수도 있다. 그때도 잘라야 payload 가 상한 안에 든다.
  if (kept.echoed.length > MAX_BODY_URL_FINGERPRINTS)
    kept.echoed = kept.echoed.slice(0, MAX_BODY_URL_FINGERPRINTS);
  const dropped = echoed.size + other.size - (kept.echoed.length + kept.other.length);
  return dropped === 0 ? kept : { ...kept, truncated: true };
};

export function installFetchAdapter(options) {
  if (globalThis[INSTALLATION] === true) return;
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== "function") throw new Error("global fetch is unavailable");
  const client = createCoordinatorClient(options);

  /**
   * 설정 소비는 정확히 한 번이고, 첫 호출의 **동기 구간**에서 일어난다. `await` 뒤로 미루면
   * 그 사이에 서버가 띄운 자식이 설정을 물려받아 같은 세션에 끼어든다.
   */
  let consumed = false;
  const consumeOnce = () => {
    if (consumed) return;
    consumed = true;
    options.onFirstCall();
  };

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    consumeOnce();
    const normalized = await normalizeHttpRequest(request);
    if (options.mode === "replay") {
      // 기록자가 아니면 여기서 `WRITER_CONFLICT` 로 던진다. **원래 fetch 로 넘기지 않는다** —
      // 재생의 계약은 실제 네트워크를 부르지 않는 것이고, 그 계약은 프로세스마다 달라지지
      // 않는다(설계 §4.2).
      const hit = await client.lookup(normalized);
      return restoreHttpOutcome(hit.outcome);
    }

    // ADR-0062. **정확한** pathname 은 자식 안에서만 산다 — 되돌아온 경로 판정의 기준이고,
    // 부모로 나가는 것은 이 값이 아니라 지문뿐이다.
    const requestPathname = new URL(request.url).pathname;
    // 요청 body 도 훑는다. ADR-0062 「결정」 2번의 문장은 응답 기준으로 적혔지만, 콜백 URL 을
    // 담아 보내는 등록 요청처럼 요청 body 로도 같은 값이 나간다 — 「탐지 규칙」의 훑는 범위가
    // body 일반이라 둘 다 본다.
    const findings = bodyUrlFingerprints(
      normalized.display.body.kind === "json" ? normalized.display.body.value : null,
      requestPathname,
    );

    let reservation;
    try {
      reservation = await client.begin(normalized);
    } catch (error) {
      // **기록자 경합만 삼킨다.** 다른 오류는 그대로 올린다 — Coordinator 가 죽었거나
      // payload 가 상한을 넘은 것은 사용자가 알아야 하는 실패다.
      //
      // 이 호출은 녹화되지 않는다. 지금도 녹화되지 않았다(설정이 이 프로세스까지 오지 않았다).
      // 달라지는 것은 부모가 거절을 세어 화면에 적을 수 있다는 것뿐이다. 던져서 서버를 죽이는
      // 것은 진단을 위해 멀쩡한 실행을 깨는 것이라 하지 않는다.
      if (error?.code !== "WRITER_CONFLICT") throw error;
      return originalFetch.call(globalThis, request);
    }

    let response;
    try {
      response = await originalFetch.call(globalThis, request);
    } catch (error) {
      // 던진 호출에는 응답 body 가 없다. 요청 쪽에서 찾은 것만 보낸다.
      await client.complete(reservation.interactionId, encodeHttpThrow(error), wire(findings));
      throw error;
    }
    const outcome = await encodeHttpResponse(response.clone());
    await client.complete(
      reservation.interactionId,
      outcome,
      wire(findings, bodyUrlFingerprints(outcome.body, requestPathname)),
    );
    return response;
  };
  Object.defineProperty(globalThis, INSTALLATION, { value: true });
}
