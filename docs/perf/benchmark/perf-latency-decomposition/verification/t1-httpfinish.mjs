// 로컬 서버: 헤더 즉시, 본문은 600ms 뒤. http.client.response.finish 가 언제 오는지 본다.
import http from "node:http";
import dc from "node:diagnostics_channel";
const now = () => performance.timeOrigin + performance.now();
const srv = http.createServer((req, res) => { res.writeHead(200, {"content-type":"text/plain"}); res.write("a"); setTimeout(() => res.end("b".repeat(1000)), 600); });
await new Promise(r => srv.listen(0, r));
const port = srv.address().port;
let t0; dc.subscribe("http.client.request.start", () => { t0 = now(); });
dc.subscribe("http.client.response.finish", () => console.log("response.finish  +", (now()-t0).toFixed(0), "ms"));
const r = http.get(`http://127.0.0.1:${port}/`, (res) => { console.log("headers cb       +", (now()-t0).toFixed(0)); res.on("data",()=>{}); res.on("end", () => { console.log("body end         +", (now()-t0).toFixed(0)); srv.close(); }); });
