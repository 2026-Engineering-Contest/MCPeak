#!/usr/bin/env node
/**
 * MCPTox 의 중독 도구 정의를 audit 의 정적 규칙에 넣어 재현율과 오탐을 낸다.
 *
 *   pnpm build
 *   node docs/benchmark/mcp-audit-recall/measure.mjs <fetch.mjs 가 찍은 경로> [--json]
 *
 * 사례 단위는 response_all.json 의 malicious_instance 중 wrong_data 가 0 인 것이다. 논문(AAAI-26)이
 * 집계한 1,312 사례가 이 집합이다. 각 사례의 poisoned_tool("Tool: <이름>\nDescription: <설명>")을
 * 그 서버의 정상 도구 목록(clean_system_promot 에서 읽는다)에 더해 서버 하나로 만든다. 문형 규칙
 * (`runDescRules`)은 중독 도구의 문자열에, 점수 규칙(`runSteeringRules`, `desc/steering`)은 서버 전체
 * 도구 목록에 돌리고 중독 도구에 붙은 발견만 센다.
 *
 * 세 가지를 낸다. (1) 원본 사례의 탐지율과 패러다임·위험 유형·규칙별 표, (2) variants.mjs 의 변형별
 * 탐지 수, (3) MCPTox 가 싣고 있는 정상 도구 정의에서의 오탐. "탐지" 는 심각도 medium 이상인 발견이
 * 하나라도 있는 사례다. 결정론적이다. 같은 커밋이면 같은 출력이 나온다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collectStrings, runDescRules, runSteeringRules } from "../../../packages/audit/dist/index.mjs";
import { applyVariant, VARIANTS } from "./variants.mjs";

const args = process.argv.slice(2);
const dir = args.find((arg) => !arg.startsWith("--"));
if (dir === undefined) {
  console.error("→ MCPTox 경로가 필요합니다.");
  console.error("해결: node docs/benchmark/mcp-audit-recall/fetch.mjs 가 찍은 마지막 줄을 넘기세요.");
  process.exit(1);
}
const data = JSON.parse(readFileSync(join(dir, "response_all.json"), "utf8"));

/**
 * "Tool: <이름>\nDescription: <설명>[\nArguments: …]" 을 도구로 만든다. 사례의 절반가량은 줄바꿈이
 * 실제 개행이 아니라 글자 그대로의 "\\n" 이라 먼저 개행으로 바꾼다. 뒤따르는 "Arguments:" 목록은 인자
 * 설명이지 도구 설명이 아니라서 잘라 낸다. 형식이 다르면 전체를 설명으로 본다(그런 사례는 세어 출력한다).
 */
let unparsed = 0;
function toTool(text) {
  const normalized = text.replaceAll("\\n", "\n");
  const match = /^Tool:\s*(.*)\r?\nDescription:\s*([\s\S]*?)(?:\r?\nArguments:[\s\S]*)?$/.exec(normalized);
  if (match === null) unparsed += 1;
  return {
    name: match ? match[1].trim() : "poisoned_tool",
    description: match ? match[2].trim() : normalized,
    inputSchema: { type: "object" },
  };
}

/** clean_system_promot 의 "Tool: … Description: … Arguments: - 이름: 설명" 묶음을 도구 목록으로 읽는다. */
function toCleanTools(prompt) {
  const tools = [];
  const block = /Tool:\s*(.*)\r?\nDescription:\s*([\s\S]*?)\r?\nArguments:([\s\S]*?)(?=\n\s*\n+Tool:|\n\s*\n\s*\n|$)/g;
  for (const match of prompt.replaceAll("\\n", "\n").matchAll(block)) {
    const properties = {};
    for (const arg of match[3].matchAll(/^- ([\w.-]+): (.*?)(?: \(required\))?$/gm)) properties[arg[1]] = { type: "string" };
    tools.push({ name: match[1].trim(), description: match[2].trim(), inputSchema: { type: "object", properties } });
  }
  return tools;
}

/** 목록에는 있는데 정의를 읽지 못한 도구는 이름만 가진 자리로 넣는다. 다른 도구 이름 대조에만 쓰인다. */
function withStubs(tools, names) {
  const known = new Set(tools.map((tool) => tool.name));
  const stubs = names.filter((name) => !known.has(name)).map((name) => ({ name, description: "", inputSchema: { type: "object", properties: { _: {} } } }));
  return [...tools, ...stubs];
}

const RANK = { high: 3, medium: 2, low: 1, info: 0 };

/** 서버 목록 안의 도구 하나에 대한 판정. */
function judge(tool, tools, serverName, toolNames) {
  const strings = collectStrings({ tools: [tool], prompts: [], resources: [], instructions: undefined });
  const desc = runDescRules(strings, { serverName });
  const all = withStubs(tools, toolNames);
  const index = all.indexOf(tool);
  const steering = runSteeringRules(all, { serverName }).filter((f) => f.location.kind === "tool" && f.location.toolIndex === index);
  return {
    pattern: desc.some((f) => RANK[f.severity] >= RANK.medium),
    steeringMedium: steering.some((f) => f.severity === "medium"),
    steeringLow: steering.length > 0,
    findings: [...desc, ...steering],
  };
}

const servers = Object.values(data.servers).map((server) => ({
  name: server.server_name,
  toolNames: server.tool_names,
  clean: toCleanTools(server.clean_system_promot),
  instances: server.malicious_instance.filter((instance) => instance.wrong_data === 0),
}));

// ── (1) 원본 ──
const cases = [];
for (const server of servers) {
  for (const instance of server.instances) {
    const poisoned = toTool(instance.poisoned_tool);
    const verdict = judge(poisoned, [...server.clean, poisoned], server.name, server.toolNames);
    cases.push({
      server,
      poisoned,
      paradigm: instance.metadata?.paradigm ?? "unknown",
      risk: instance.metadata?.["security risk"] ?? "unknown",
      detected: verdict.findings.some((f) => RANK[f.severity] >= RANK.medium),
      mentioned: verdict.findings.length > 0,
      rules: [...new Set(verdict.findings.map((f) => f.ruleId))].sort(),
    });
  }
}

const ratio = (n, d) => (d === 0 ? "0.0%" : `${((100 * n) / d).toFixed(1)}%`);
const sortedEntries = (map) => [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

function group(key) {
  const map = new Map();
  for (const c of cases) {
    const entry = map.get(c[key]) ?? { total: 0, detected: 0 };
    entry.total += 1;
    if (c.detected) entry.detected += 1;
    map.set(c[key], entry);
  }
  return sortedEntries(map).map(([name, v]) => ({ name, ...v, recall: ratio(v.detected, v.total) }));
}

const ruleCounts = new Map();
for (const c of cases) for (const rule of c.rules) ruleCounts.set(rule, (ruleCounts.get(rule) ?? 0) + 1);

// ── (2) 변형 ──
const variants = VARIANTS.map((variant) => {
  const row = { name: variant.name, pattern: 0, steeringMedium: 0, steeringLow: 0, detected: 0 };
  for (const c of cases) {
    const { tool, tools } = applyVariant(c.poisoned, c.server.clean, variant);
    const verdict = judge(tool, tools, c.server.name, c.server.toolNames);
    if (verdict.pattern) row.pattern += 1;
    if (verdict.steeringMedium) row.steeringMedium += 1;
    if (verdict.steeringLow) row.steeringLow += 1;
    if (verdict.pattern || verdict.steeringMedium) row.detected += 1;
  }
  return row;
});

// ── (3) 정상 정의 오탐 ──
const clean = { servers: servers.length, tools: 0, pattern: 0, steeringMedium: 0, steeringLow: 0, flagged: [] };
for (const server of servers) {
  for (const tool of server.clean) {
    clean.tools += 1;
    const verdict = judge(tool, server.clean, server.name, server.toolNames);
    if (verdict.pattern) clean.pattern += 1;
    if (verdict.steeringMedium) clean.steeringMedium += 1;
    else if (verdict.steeringLow) clean.steeringLow += 1;
    if (verdict.steeringLow) clean.flagged.push(`${server.name}/${tool.name}`);
  }
}
clean.flagged.sort();

const result = {
  cases: cases.length,
  unparsed,
  detected: cases.filter((c) => c.detected).length,
  mentioned: cases.filter((c) => c.mentioned).length,
  byParadigm: group("paradigm"),
  byRisk: group("risk"),
  byRule: sortedEntries(ruleCounts).map(([rule, n]) => ({ rule, cases: n, share: ratio(n, cases.length) })),
  variants,
  clean,
};

if (args.includes("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`사례 ${result.cases}건 (형식을 못 읽어 전체를 설명으로 본 사례 ${result.unparsed}건)`);
  console.log(`탐지(medium 이상) ${result.detected}건, ${ratio(result.detected, result.cases)}`);
  console.log(`언급(info 포함) ${result.mentioned}건, ${ratio(result.mentioned, result.cases)}`);
  console.log("\n| 패러다임 | 사례 | 탐지 | 재현율 |\n|---|---:|---:|---:|");
  for (const g of result.byParadigm) console.log(`| ${g.name} | ${g.total} | ${g.detected} | ${g.recall} |`);
  console.log("\n| 위험 유형 | 사례 | 탐지 | 재현율 |\n|---|---:|---:|---:|");
  for (const g of result.byRisk) console.log(`| ${g.name} | ${g.total} | ${g.detected} | ${g.recall} |`);
  console.log("\n| 규칙 | 걸린 사례 | 비율 |\n|---|---:|---:|");
  for (const r of result.byRule) console.log(`| \`${r.rule}\` | ${r.cases} | ${r.share} |`);
  console.log("\n| 변형 | 문형 규칙(medium 이상) | 점수 규칙 medium | 점수 규칙 low 이상 | 탐지(문형 또는 점수 medium) | 재현율 |\n|---|---:|---:|---:|---:|---:|");
  for (const v of result.variants) console.log(`| ${v.name} | ${v.pattern} | ${v.steeringMedium} | ${v.steeringLow} | ${v.detected} | ${ratio(v.detected, result.cases)} |`);
  console.log(`\n정상 정의: 서버 ${clean.servers}개, 도구 ${clean.tools}개`);
  console.log(`문형 규칙 medium 이상 ${clean.pattern}건, 점수 규칙 medium ${clean.steeringMedium}건, 점수 규칙 low ${clean.steeringLow}건`);
  console.log(`점수 규칙이 잡은 정상 도구: ${clean.flagged.join(", ")}`);
}
