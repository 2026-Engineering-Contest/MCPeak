// 외부 HTTP 호출 관측 프리로드. globalThis.fetch 를 감싸고, undici·node:http 는 diagnostics_channel 로 본다.
import { appendFileSync } from "node:fs";
import dc from "node:diagnostics_channel";
const out = process.env.PERF_LOG;
const log = (o) => { if (out) appendFileSync(out, JSON.stringify({ pid: process.pid, ...o }) + "\n"); };
const cap = (s, n = 4000) => (typeof s === "string" ? s.slice(0, n) : s);
const orig = globalThis.fetch;
if (typeof orig === "function") {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    const method = String(init?.method ?? (input && typeof input === "object" && "method" in input ? input.method : null) ?? "GET").toUpperCase();
    const reqBody = typeof init?.body === "string" ? cap(init.body) : init?.body ? "[non-string body]" : null;
    const t0 = performance.timeOrigin + performance.now();
    try {
      const res = await orig(input, init);
      let text = null; let bytes = null;
      try { const c = res.clone(); text = await c.text(); bytes = Buffer.byteLength(text); text = cap(text, 200000); } catch {}
      const t1 = performance.timeOrigin + performance.now(); // 본문까지 받은 시각
      log({ via: "fetch", method, url, reqBody, status: res.status, bytes, resBody: text, t0, t1 });
      return res;
    } catch (e) {
      log({ via: "fetch", method, url, reqBody, error: String(e).slice(0, 200), t0, t1: performance.timeOrigin + performance.now() });
      throw e;
    }
  };
}
// fetch 를 거치지 않는 node:http(s) 호출. 시작만 잡히면 "범위 밖" 으로 센다.
const seen = new WeakMap();
dc.subscribe("http.client.request.start", ({ request }) => {
  seen.set(request, performance.timeOrigin + performance.now());
});
dc.subscribe("http.client.response.finish", ({ request, response }) => {
  const t0 = seen.get(request); if (t0 === undefined) return;
  log({ via: "node:http", method: request.method, url: `${request.protocol}//${request.host}${request.path}`, status: response.statusCode, bytes: Number(response.headers?.["content-length"] ?? NaN) || null, t0, t1: performance.timeOrigin + performance.now() });
});
const useen = new WeakMap();
dc.subscribe("undici:request:create", ({ request }) => { useen.set(request, performance.timeOrigin + performance.now()); });
dc.subscribe("undici:request:trailers", ({ request }) => {
  const t0 = useen.get(request); if (t0 === undefined) return;
  log({ via: "undici", method: request.method, url: `${request.origin}${request.path}`, t0, t1: performance.timeOrigin + performance.now() });
});
