// 안전 프로필: 1단계(무손실) + 2단계(중복 문장 승격·잡음 제거) + 2b(공통 파라미터 승격)
import { readFileSync, writeFileSync } from "node:fs";
import { toks, toolToks } from "./tok.mjs";

const SERVERS = process.argv.slice(2);
const clone = (x) => JSON.parse(JSON.stringify(x));
function normalize(s) {
  if (Array.isArray(s)) return s.map(normalize);
  if (!s || typeof s !== "object") return s;
  const o = {};
  for (const [k, v] of Object.entries(s)) {
    if (["$schema", "$id", "$comment", "title"].includes(k)) continue;
    if (k === "additionalProperties" && v === true) continue;
    if (k === "required" && Array.isArray(v) && v.length === 0) continue;
    if (k === "properties" && v && Object.keys(v).length === 0 && s.additionalProperties !== false)
      continue;
    if (["properties", "$defs", "definitions"].includes(k)) {
      const p = {};
      for (const [pk, pv] of Object.entries(v)) p[pk] = normalize(pv);
      o[k] = p;
      continue;
    }
    o[k] = normalize(v);
  }
  return o;
}
const URL_RE = /\s*\(?\bhttps?:\/\/[^\s)]+\)?/g,
  EX_RE = /\s*(?:\bExamples?|\bExample usage)[:.][\s\S]*$/i;
const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
function cleanParamDesc(d, name) {
  if (typeof d !== "string") return d;
  const s = d.replace(URL_RE, "").replace(EX_RE, "").replace(/\s+/g, " ").trim();
  const words = s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(" ")
    .filter(Boolean);
  if (name && words.length <= 3 && norm(s).includes(norm(name))) return undefined;
  return s || undefined;
}
function rewriteDescs(s, name = null) {
  if (Array.isArray(s)) return s.map((x) => rewriteDescs(x));
  if (!s || typeof s !== "object") return s;
  const o = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "description") {
      const d = cleanParamDesc(v, name);
      if (d !== undefined) o[k] = d;
      continue;
    }
    if (["properties", "$defs", "definitions"].includes(k)) {
      const p = {};
      for (const [pk, pv] of Object.entries(v))
        p[pk] = rewriteDescs(pv, k === "properties" ? pk : null);
      o[k] = p;
      continue;
    }
    o[k] = rewriteDescs(v);
  }
  return o;
}
const split = (d) =>
  (d ?? "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 40);
const rows = [];
for (const n of SERVERS) {
  const d = JSON.parse(readFileSync(`lists/${n}.json`, "utf8"));
  const cnt = new Map();
  for (const t of d.tools)
    for (const s of new Set(split(t.description))) cnt.set(s, (cnt.get(s) ?? 0) + 1);
  const shared = [...cnt]
    .filter(([, c]) => c >= Math.max(3, Math.ceil(d.tools.length * 0.25)))
    .map(([s]) => s);
  const tools = d.tools.map((t) => {
    const x = clone(t);
    x.inputSchema = rewriteDescs(normalize(x.inputSchema));
    if (
      x.inputSchema.description &&
      x.description &&
      x.inputSchema.description.trim() === x.description.trim()
    )
      delete x.inputSchema.description;
    let desc = x.description ?? "";
    for (const s of shared) desc = desc.split(s).join(" ");
    x.description = desc
      .replace(URL_RE, "")
      .replace(EX_RE, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim();
    return x;
  });
  const seen = new Map();
  for (const t of tools)
    for (const [k, v] of Object.entries(t.inputSchema?.properties ?? {}))
      if (typeof v?.description === "string" && v.description.length >= 20)
        seen.set(k + "\0" + v.description, (seen.get(k + "\0" + v.description) ?? 0) + 1);
  const common = new Map([...seen].filter(([, c]) => c >= 3).map(([k]) => k.split("\0")));
  for (const t of tools)
    for (const [k, v] of Object.entries(t.inputSchema?.properties ?? {}))
      if (common.get(k) === v?.description) delete v.description;
  const gl = common.size
    ? "Common parameters:\n" + [...common].map(([k, v]) => `- ${k}: ${v}`).join("\n")
    : "";
  const instructions = [d.instructions ?? "", shared.join(" "), gl].filter(Boolean).join("\n\n");
  writeFileSync(`out/${n}.safe.json`, JSON.stringify({ ...d, instructions, tools }, null, 2));
  const b = d.tools.reduce((a, t) => a + toolToks(t), 0),
    s =
      tools.reduce((a, t) => a + toolToks(t), 0) + toks(instructions) - toks(d.instructions ?? "");
  rows.push({
    server: n,
    tools: d.tools.length,
    원본: b,
    안전프로필: s,
    감소: ((1 - s / b) * 100).toFixed(1) + "%",
    승격문장: shared.length,
    공통파라미터: common.size,
  });
}
console.table(rows);
writeFileSync("out/safe-tokens.json", JSON.stringify(rows, null, 2));
