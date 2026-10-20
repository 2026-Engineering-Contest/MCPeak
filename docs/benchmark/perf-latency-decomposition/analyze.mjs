// 사용: node analyze.mjs out/*.json
import { readFileSync } from "node:fs";
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const union = (iv) => { const s = iv.slice().sort((a, b) => a[0] - b[0]); let tot = 0, cur = null; for (const [a, b] of s) { if (!cur || a > cur[1]) { if (cur) tot += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b); } if (cur) tot += cur[1] - cur[0]; return tot; };
const vals = (body) => { const out = new Set(); if (!body) return out; let j; try { j = JSON.parse(body); } catch { for (const m of String(body).matchAll(/[A-Za-z0-9_\-]{8,}/g)) out.add(m[0]); return out; }
  const walk = (v) => { if (v === null || v === undefined) return; if (typeof v === "object") { for (const k of Object.keys(v)) walk(v[k]); } else { const s = String(v); if (s.length >= 4 && !/^(true|false|null)$/.test(s)) out.add(s); } };
  walk(j); return out; };
const rows = [];
for (const f of process.argv.slice(2)) {
  const d = JSON.parse(readFileSync(f, "utf8"));
  let ext = d.external.filter((e) => e.t0 && e.t1);
  // fetch 는 내부적으로 undici 를 쓴다. 같은 URL 로 fetch 구간 안에 들어오는 undici 항목은 같은 요청이다.
  const fetches = ext.filter((e) => e.via === "fetch");
  ext = ext.filter((e) => e.via !== "undici" || !fetches.some((f) => f.url === e.url && e.t0 >= f.t0 - 50 && e.t1 <= f.t1 + 300));
  const byTool = {};
  for (const c of d.calls) {
    const inWin = ext.filter((e) => e.t0 >= c.t0 - 2 && e.t1 <= c.t1 + 2).sort((a, b) => a.t0 - b.t0);
    const extWait = union(inWin.map((e) => [e.t0, e.t1]));
    // 순차 독립: 앞 요청이 끝난 뒤 시작했고, 앞 응답들의 값이 뒤 요청 URL·본문에 하나도 없음
    // 직전 요청에 의존(seqDep) / 직전과는 독립이나 더 앞 요청에 의존(fanout) / 전부 독립(seqIndep) / 본문을 못 봐 판별 불가(seqUnknown)
    let seqIndep = 0, seqDep = 0, fanout = 0, seqUnknown = 0, parallel = 0;
    for (let i = 1; i < inWin.length; i++) {
      const cur = inWin[i]; const prev = inWin.slice(0, i);
      const startedAfterAll = prev.every((p) => p.t1 <= cur.t0 + 1);
      if (!startedAfterAll) { parallel++; continue; }
      if (prev.some((p) => p.resBody === undefined || p.resBody === null)) { seqUnknown++; continue; }
      const hay = (cur.url ?? "") + " " + (cur.reqBody ?? "");
      const depOn = (p) => [...vals(p.resBody)].some((v) => hay.includes(v));
      if (depOn(prev[prev.length - 1])) seqDep++; else if (prev.some(depOn)) fanout++; else seqIndep++;
    }
    const keyOf = (e) => `${e.method} ${e.url} ${e.reqBody ?? ""}`;
    const t = (byTool[c.tool] ??= { ms: [], ext: [], compute: [], n: 0, extCount: [], seqIndep: 0, seqDep: 0, fanout: 0, seqUnknown: 0, parallel: 0, keys: [], keyByInput: [], dupWithin: 0, bytes: [], err: 0, viaFetch: 0, viaOther: 0 });
    t.n++; t.ms.push(c.ms); t.ext.push(extWait); t.compute.push(Math.max(0, c.ms - extWait)); t.extCount.push(inWin.length);
    t.seqIndep += seqIndep; t.seqDep += seqDep; t.fanout += fanout; t.seqUnknown += seqUnknown; t.parallel += parallel; t.keys.push(...inWin.map(keyOf)); t.keyByInput.push(...inWin.map((e) => [keyOf(e), JSON.stringify(c.input)]));
    { const seen = new Set(); for (const e of inWin) { const k = keyOf(e); if (seen.has(k)) t.dupWithin++; seen.add(k); } } t.bytes.push(c.resultBytes);
    if (c.isError || c.err) t.err++;
    for (const e of inWin) (e.via === "fetch" ? t.viaFetch++ : t.viaOther++);
  }
  for (const [tool, t] of Object.entries(byTool)) {
    const inputsByKey = {}; for (const [k, inp] of t.keyByInput) (inputsByKey[k] ??= new Set()).add(inp);
    const dupAcross = Object.values(inputsByKey).filter((s) => s.size > 1).length;
    rows.push({ server: d.name, tool, calls: t.n, err: t.err, p50: Math.round(pct(t.ms, 0.5)), p95: Math.round(pct(t.ms, 0.95)),
      extWait50: Math.round(pct(t.ext, 0.5)), compute50: Math.round(pct(t.compute, 0.5)), extPerCall: Math.round(pct(t.extCount, 0.5)),
      seqIndep: t.seqIndep, seqDep: t.seqDep, fanout: t.fanout, seqUnk: t.seqUnknown, par: t.parallel, dupWithin: t.dupWithin, sameReqDiffInput: dupAcross, bytes50: Math.round(pct(t.bytes, 0.5)), fetch: t.viaFetch, other: t.viaOther, cold: Math.round(d.coldStartMs) });
  }
}
console.table(rows);
