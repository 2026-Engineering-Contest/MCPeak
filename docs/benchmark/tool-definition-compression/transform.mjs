import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { toks, toolToks } from "./tok.mjs";

const SERVERS = ["notion", "mongodb", "firecrawl", "desktop-commander", "chrome-devtools"];
mkdirSync("out", { recursive: true });

// ---------- 1단계: 무손실 정규화 (검증 의미 불변) ----------
const clone = (x) => JSON.parse(JSON.stringify(x));
function normalize(s, isRoot = false, propName = null) {
  if (Array.isArray(s)) return s.map((x) => normalize(x));
  if (!s || typeof s !== "object") return s;
  const o = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "$schema" || k === "$id" || k === "$comment") continue; // 메타, 검증 무관
    if (k === "title") continue; // 주석 키워드, 검증 무관
    if (k === "additionalProperties" && v === true) continue; // 기본값과 동일
    if (k === "required" && Array.isArray(v) && v.length === 0) continue; // 빈 required
    if (k === "properties" && v && Object.keys(v).length === 0 && s.additionalProperties !== false)
      continue;
    if (k === "properties") {
      const p = {};
      for (const [pk, pv] of Object.entries(v)) p[pk] = normalize(pv, false, pk);
      o[k] = p;
      continue;
    }
    if (k === "$defs" || k === "definitions") {
      const p = {};
      for (const [pk, pv] of Object.entries(v)) p[pk] = normalize(pv);
      o[k] = p;
      continue;
    }
    o[k] = normalize(v);
  }
  return o;
}
function stage1(tool) {
  const t = clone(tool);
  t.inputSchema = normalize(t.inputSchema, true);
  if (
    t.inputSchema.description &&
    t.description &&
    t.inputSchema.description.trim() === t.description.trim()
  )
    delete t.inputSchema.description;
  return t;
}

// ---------- 2단계: 규칙 기반 재작성 (설명 문자열만, 스키마 제약 불변) ----------
const URL_RE = /\s*\(?\bhttps?:\/\/[^\s)]+\)?/g;
const EXAMPLE_RE = /\s*(?:\bExamples?|\be\.g\.|\bFor example|\bExample usage)[:.][\s\S]*$/i;
function shortenDesc(d, propName) {
  if (typeof d !== "string") return d;
  const s = d.replace(URL_RE, "").replace(EXAMPLE_RE, "").replace(/\s+/g, " ").trim();
  // 이름을 그대로 되풀이하는 설명 제거 ("database" -> "Database name")
  if (propName) {
    const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
    const words = s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .split(" ")
      .filter(Boolean);
    if (words.length <= 3 && norm(s).includes(norm(propName))) return undefined;
  }
  return s.length ? s : undefined;
}
function rewriteSchemaDescs(s, propName = null) {
  if (Array.isArray(s)) return s.map((x) => rewriteSchemaDescs(x));
  if (!s || typeof s !== "object") return s;
  const o = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "description") {
      const d = shortenDesc(v, propName);
      if (d !== undefined) o[k] = d;
      continue;
    }
    if (k === "properties" || k === "$defs" || k === "definitions") {
      const p = {};
      for (const [pk, pv] of Object.entries(v))
        p[pk] = rewriteSchemaDescs(pv, k === "properties" ? pk : null);
      o[k] = p;
      continue;
    }
    o[k] = rewriteSchemaDescs(v);
  }
  return o;
}
// 서버 내 여러 도구 설명에 반복되는 문장을 instructions 로 승격
function extractBoilerplate(tools) {
  const sentences = new Map();
  const split = (d) =>
    (d ?? "")
      .split(/(?<=[.!?])\s+|\n+/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 40);
  for (const t of tools)
    for (const s of new Set(split(t.description))) sentences.set(s, (sentences.get(s) ?? 0) + 1);
  const shared = new Set(
    [...sentences]
      .filter(([, c]) => c >= Math.max(3, Math.ceil(tools.length * 0.25)))
      .map(([s]) => s),
  );
  return shared;
}
function stage2(tool, shared) {
  const t = stage1(tool);
  let d = t.description ?? "";
  for (const s of shared) d = d.split(s).join(" ");
  d = d
    .replace(URL_RE, "")
    .replace(/\s*(?:\bExamples?|\bExample usage)[:.][\s\S]*$/i, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
  t.description = d;
  t.inputSchema = rewriteSchemaDescs(t.inputSchema);
  return t;
}

const report = [];
for (const n of SERVERS) {
  const d = JSON.parse(readFileSync(`lists/${n}.json`, "utf8"));
  const shared = extractBoilerplate(d.tools);
  const s1 = d.tools.map(stage1),
    s2 = d.tools.map((t) => stage2(t, shared));
  const sum = (ts) => ts.reduce((a, t) => a + toolToks(t), 0);
  const instr = [...shared].join(" ");
  const base = sum(d.tools),
    t1 = sum(s1),
    t2 = sum(s2) + toks(instr);
  writeFileSync(`out/${n}.stage1.json`, JSON.stringify({ ...d, tools: s1 }, null, 2));
  writeFileSync(
    `out/${n}.stage2.json`,
    JSON.stringify(
      { ...d, instructions: [d.instructions ?? "", instr].join("\n").trim(), tools: s2 },
      null,
      2,
    ),
  );
  report.push({
    server: n,
    tools: d.tools.length,
    base,
    stage1: t1,
    "s1 %": ((1 - t1 / base) * 100).toFixed(1),
    stage2: t2,
    "s2 %": ((1 - t2 / base) * 100).toFixed(1),
    boilerplate: shared.size,
  });
}
console.table(report);
writeFileSync("out/report-tokens.json", JSON.stringify(report, null, 2));
