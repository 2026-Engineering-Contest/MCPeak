// runner 전용 계측 프리로드. 하네스와 독립. 핸들러 사본에 넣은 __mark 와, node:http 요청의
// 헤더 수신 시각·본문 끝 시각을 같은 시계(performance.timeOrigin+now)로 남긴다.
import { appendFileSync } from "node:fs";
import dc from "node:diagnostics_channel";
const out = process.env.MARK_LOG;
const now = () => performance.timeOrigin + performance.now();
const w = (o) => { if (out) appendFileSync(out, JSON.stringify(o) + "\n"); };
globalThis.__mark = (label, extra) => { const c = process.cpuUsage(); w({ k: "mark", label, t: now(), cpu: (c.user + c.system) / 1000, ...(extra ?? {}) }); };
const st = new WeakMap();
dc.subscribe("http.client.request.start", ({ request }) => st.set(request, now()));
dc.subscribe("http.client.response.finish", ({ request, response }) => {
  const t0 = st.get(request); const th = now();
  const url = `${request.protocol}//${request.host}${request.path}`;
  response.on("end", () => w({ k: "http", url, status: response.statusCode, t0, th, te: now() }));
});
w({ k: "boot", pid: process.pid, ppid: process.ppid, argv: process.argv.slice(1).join(" ").slice(0, 200), t: now() });
dc.subscribe("http.client.request.start", ({ request }) => w({ k: "reqstart", pid: process.pid, url: `${request.protocol}//${request.host}${request.path}`.slice(0, 120), t: now() }));
dc.subscribe("undici:request:create", ({ request }) => w({ k: "undici", pid: process.pid, url: `${request.origin}${request.path}`.slice(0, 120), t: now() }));

// HTTP/2 클라이언트 스트림 (Node 24 진단 채널)
const h2 = new WeakMap();
dc.subscribe("http2.client.stream.created", ({ stream, headers }) => h2.set(stream, { t0: now(), url: `${headers?.[":scheme"]}://${headers?.[":authority"]}${headers?.[":path"]}`.slice(0, 120) }));
dc.subscribe("http2.client.stream.finish", ({ stream }) => { const s = h2.get(stream); if (s) w({ k: "h2", pid: process.pid, ...s, tf: now() }); });
dc.subscribe("http2.client.stream.close", ({ stream }) => { const s = h2.get(stream); if (s) w({ k: "h2close", pid: process.pid, ...s, tc: now() }); });
