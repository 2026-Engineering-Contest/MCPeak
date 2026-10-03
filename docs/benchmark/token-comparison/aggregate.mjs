// runs/**/trial-*/summary.json 을 모아 조건별 표와 중앙값을 찍는다. 결함 행 수는 report.md 에서 센다.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = `${process.env.MCPEAK_BENCH_RUNS ?? `${process.env.HOME}/.mcpeak-bench/runs`}/`;
const rows = [];
for (const s of readdirSync(root))
  for (const c of readdirSync(join(root, s))) {
    const dir = join(root, s, c);
    const logs = join(dir, "logs");
    if (!existsSync(logs)) continue;
    for (const t of readdirSync(logs).filter((d) => d.startsWith("trial-"))) {
      const f = join(logs, t, "summary.json");
      if (!existsSync(f)) continue;
      const r = JSON.parse(readFileSync(f, "utf8"));
      // 보고서가 없는 회차는 실패한 실행이다. 표본에 넣으면 결함 0행으로 집계가 왜곡된다.
      if (r.report_exists === false) {
        console.error(`제외: ${s}/${c}/${t} (report.md 없음)`);
        continue;
      }
      const rep = existsSync(join(dir, t, "report.md"))
        ? readFileSync(join(dir, t, "report.md"), "utf8")
        : "";
      const sec = rep.split("## 결함")[1]?.split("## 검증하지")[0] ?? "";
      r.defectRows = (sec.match(/^\| \d+ \|/gm) ?? []).length;
      rows.push(r);
    }
  }
const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const only = process.argv[2]; // 예: "s1:3,4,5" 형태로 회차를 제한
const filt = only
  ? Object.fromEntries(
      only.split(";").map((p) => {
        const [s, ts] = p.split(":");
        return [s, ts.split(",")];
      }),
    )
  : null;
const sel = rows.filter((r) => !filt || filt[r.scenario]?.includes(String(r.trial)));
console.log(
  "| 시나리오 | 조건 | 회차 | 턴 | 소요(초) | 비용($) | 출력 토큰 | 캐시 생성 | 캐시 읽기 | 결함 행 |",
);
console.log("|---|---|---|---|---|---|---|---|---|---|");
for (const r of sel.sort(
  (a, b) =>
    a.scenario.localeCompare(b.scenario) ||
    a.condition.localeCompare(b.condition) ||
    a.trial - b.trial,
))
  console.log(
    `| ${r.scenario} | ${r.condition} | ${r.trial} | ${r.num_turns} | ${Math.round(r.duration_ms / 1000)} | ${r.total_cost_usd.toFixed(3)} | ${r.output_tokens.toLocaleString()} | ${r.cache_creation_input_tokens.toLocaleString()} | ${r.cache_read_input_tokens.toLocaleString()} | ${r.defectRows} |`,
  );
console.log("\n중앙값");
console.log("| 시나리오 | 조건 | n | 턴 | 소요(초) | 비용($) | 출력 토큰 |");
console.log("|---|---|---|---|---|---|---|");
const groups = {};
for (const r of sel) {
  const key = `${r.scenario}|${r.condition}`;
  groups[key] ??= [];
  groups[key].push(r);
}
for (const [k, g] of Object.entries(groups).sort()) {
  const [s, c] = k.split("|");
  console.log(
    `| ${s} | ${c} | ${g.length} | ${med(g.map((r) => r.num_turns))} | ${Math.round(med(g.map((r) => r.duration_ms)) / 1000)} | ${med(g.map((r) => r.total_cost_usd)).toFixed(3)} | ${Math.round(med(g.map((r) => r.output_tokens))).toLocaleString()} |`,
  );
}
