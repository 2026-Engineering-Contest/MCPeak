// 원본 preload 와 같은 기록 + 반례용 추가 기록:
//  - node:http: 헤더 시각(t1, 원본과 같음)과 본문 끝 시각(tEnd), 실제 바이트
//  - 서버 쪽 stdin 수신 / stdout 응답 쓰기 시각과 그 사이 CPU 사용량
import { appendFileSync } from "node:fs";
import dc from "node:diagnostics_channel";
const out = process.env.PERF_LOG;
const log = (o) => { if (out) appendFileSync(out, JSON.stringify({ pid: process.pid, ...o }) + "\n"); };
const now = () => performance.timeOrigin + performance.now();
const cap = (s, n = 4000) => (typeof s === "string" ? s.slice(0, n) : s);
const orig = globalThis.fetch;
if (typeof orig === "function") {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    const method = String(init?.method ?? (input && typeof input === "object" && "method" in input ? input.method : null) ?? "GET").toUpperCase();
    const reqBody = typeof init?.body === "string" ? cap(init.body) : init?.body ? "[non-string body]" : null;
    const t0 = now();
    try {
      const res = await orig(input, init);
      const tH = now();
      let text = null; let bytes = null;
      try { const c = res.clone(); text = await c.text(); bytes = Buffer.byteLength(text); text = cap(text, 200000); } catch {}
      const t1 = now();
      log({ via: "fetch", method, url, reqBody, status: res.status, bytes, resBody: text, t0, tH, t1, redirected: res.redirected, finalUrl: res.url });
      return res;
    } catch (e) { log({ via: "fetch", method, url, error: String(e).slice(0, 200), t0, t1: now() }); throw e; }
  };
}
const seen = new WeakMap();
dc.subscribe("http.client.request.start", ({ request }) => { seen.set(request, now()); });
dc.subscribe("http.client.response.finish", ({ request, response }) => {
  const t0 = seen.get(request); if (t0 === undefined) return; const t1 = now();
  let n = 0; response.on("data", (b) => { n += b.length; });
  response.once("end", () => log({ via: "node:http", method: request.method, url: `${request.protocol}//${request.host}${request.path}`, status: response.statusCode, bytes: Number(response.headers?.["content-length"] ?? NaN) || null, realBytes: n, t0, t1, tEnd: now() }));
});
const useen = new WeakMap();
dc.subscribe("undici:request:create", ({ request }) => { useen.set(request, now()); });
dc.subscribe("undici:request:trailers", ({ request }) => {
  const t0 = useen.get(request); if (t0 === undefined) return;
  log({ via: "undici", method: request.method, url: `${request.origin}${request.path}`, t0, t1: now() });
});
// 서버 쪽 경계
let cpu0 = null, rx = null;
const em = process.stdin.emit.bind(process.stdin);
process.stdin.emit = (ev, b, ...a) => { if (ev === "data") { const s = String(b); if (s.includes('"tools/call"')) { rx = now(); cpu0 = process.cpuUsage(); log({ via: "srv", ev: "rx", t: rx }); } } return em(ev, b, ...a); };
const w = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...a) => { const s = String(chunk); if (rx && s.includes('"content"')) { const c = process.cpuUsage(cpu0); log({ via: "srv", ev: "tx", t: now(), span: now() - rx, cpuMs: (c.user + c.system) / 1000, bytes: s.length }); rx = null; } return w(chunk, ...a); };
// 추가: CPU 를 구간별로 나눈다. (a) 요청 수신~마지막 본문 끝 = 네트워크 구간 CPU, (b) 마지막 본문 끝~응답 쓰기 = 핸들러 후처리 CPU
// 그리고 JSON.parse 누적 시간(호출당)을 잰다.
let lastEndCpu = null, lastEndT = null, parseMs = 0, parseN = 0;
const P = JSON.parse; JSON.parse = function (...a) { const t = performance.now(); try { return P.apply(this, a); } finally { const d = performance.now() - t; if (d > 0.5) { parseMs += d; parseN++; } } };
dc.subscribe("http.client.response.finish", ({ response }) => { response.once("end", () => { lastEndCpu = process.cpuUsage(); lastEndT = now(); }); });
const w2 = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...a) => { const s = String(chunk); if (s.includes('"content"') && lastEndCpu) { const c = process.cpuUsage(lastEndCpu); log({ via: "srv", ev: "post", postWallMs: now() - lastEndT, postCpuMs: (c.user + c.system) / 1000, parseMs, parseN }); lastEndCpu = null; parseMs = 0; parseN = 0; } return w2(chunk, ...a); };
