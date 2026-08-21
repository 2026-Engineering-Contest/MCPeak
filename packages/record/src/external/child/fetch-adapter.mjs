import {
  encodeHttpResponse,
  encodeHttpThrow,
  normalizeHttpRequest,
  restoreHttpOutcome,
} from "../runtime.mjs";
import { createCoordinatorClient } from "./coordinator-client.mjs";

const INSTALLATION = Symbol.for("mcpeak.external.fetch-adapter");

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

    const reservation = await client.begin(normalized);
    let response;
    try {
      response = await originalFetch.call(globalThis, request);
    } catch (error) {
      await client.complete(reservation.interactionId, encodeHttpThrow(error));
      throw error;
    }
    const outcome = await encodeHttpResponse(response.clone());
    await client.complete(reservation.interactionId, outcome);
    return response;
  };
  Object.defineProperty(globalThis, INSTALLATION, { value: true });
}
