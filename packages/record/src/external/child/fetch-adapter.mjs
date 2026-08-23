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
 * 지문 집합들을 wire 형태(배열)로 합친다. `Set` 은 `JSON.stringify` 가 `{}` 로 만들어 조용히
 * 사라지므로 여기서 반드시 배열로 바꾼다. 중복 제거는 부모가 세션 전체에서 하므로 여기서는
 * 이어 붙이기만 한다.
 */
const wire = (...found) => ({
  echoed: found.flatMap((one) => [...one.echoed]),
  other: found.flatMap((one) => [...one.other]),
});

export function installFetchAdapter(options) {
  if (globalThis[INSTALLATION] === true) return;
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== "function") throw new Error("global fetch is unavailable");
  const client = createCoordinatorClient(options);

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const normalized = await normalizeHttpRequest(request);
    if (options.mode === "replay") {
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

    const reservation = await client.begin(normalized);
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
