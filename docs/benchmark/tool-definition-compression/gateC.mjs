import { readFileSync } from "node:fs";

const SERVERS = ["notion", "mongodb", "firecrawl", "desktop-commander", "chrome-devtools"];
const tok = (s) =>
  (s ?? "")
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-z0-9가-힣]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1);
function bm25Index(docs) {
  // docs: [{id, text}]
  const N = docs.length,
    df = new Map(),
    tf = [],
    len = [];
  for (const d of docs) {
    const ws = tok(d.text);
    len.push(ws.length);
    const m = new Map();
    for (const w of ws) m.set(w, (m.get(w) ?? 0) + 1);
    tf.push(m);
    for (const w of m.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  }
  const avg = len.reduce((a, b) => a + b, 0) / N,
    k1 = 1.2,
    b = 0.75;
  return (q) =>
    docs
      .map((d, i) => {
        let s = 0;
        for (const w of tok(q)) {
          const f = tf[i].get(w);
          if (!f) continue;
          const idf = Math.log(1 + (N - df.get(w) + 0.5) / (df.get(w) + 0.5));
          s += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * len[i]) / avg));
        }
        return { id: d.id, s };
      })
      .sort((x, y) => y.s - x.s);
}
// 질의: 도구 이름을 단어로 푼 것 (사용자 의도의 근사). 색인: 이름 + 설명 (+ 인자 이름·설명: Anthropic 문서 기준)
const indexText = (t) =>
  [
    t.name,
    t.description ?? "",
    ...Object.entries(t.inputSchema?.properties ?? {}).map(
      ([k, v]) => `${k} ${v?.description ?? ""}`,
    ),
  ].join(" ");
const rows = [];
for (const n of SERVERS) {
  for (const stage of ["orig", "stage1", "stage2"]) {
    const tools =
      stage === "orig"
        ? JSON.parse(readFileSync(`lists/${n}.json`, "utf8")).tools
        : JSON.parse(readFileSync(`out/${n}.${stage}.json`, "utf8")).tools;
    const search = bm25Index(tools.map((t) => ({ id: t.name, text: indexText(t) })));
    let rankSum = 0,
      top1 = 0,
      collateral = 0;
    for (const t of tools) {
      const q = tok(t.name.replace(/^API-/, "").replace(/^firecrawl_/, "")).join(" ");
      const r = search(q);
      const rank = r.findIndex((x) => x.id === t.name) + 1;
      rankSum += rank;
      if (rank === 1) top1++;
      collateral += r.slice(0, 5).filter((x) => x.s > 0 && x.id !== t.name).length; // 상위 5 안에 함께 걸리는 형제 수
    }
    rows.push({
      server: n,
      stage,
      "top1 적중": `${top1}/${tools.length}`,
      "평균 순위": (rankSum / tools.length).toFixed(2),
      "검색당 동반 형제(상위5)": (collateral / tools.length).toFixed(2),
    });
  }
}
console.table(rows);
