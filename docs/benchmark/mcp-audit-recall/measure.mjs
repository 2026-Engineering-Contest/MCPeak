#!/usr/bin/env node
/**
 * MCPTox 의 중독 도구 정의를 audit 의 desc 규칙에 넣어 재현율을 낸다.
 *
 *   pnpm build
 *   node docs/benchmark/mcp-audit-recall/measure.mjs <fetch.mjs 가 찍은 경로> [--json]
 *
 * 사례 단위는 response_all.json 의 malicious_instance 중 wrong_data 가 0 인 것이다. 논문(AAAI-26)이
 * 집계한 1,312 사례가 이 집합이다. 각 사례의 poisoned_tool("Tool: <이름>\nDescription: <설명>")을
 * 도구 하나로 만들어 collectStrings → runDescRules 를 돌린다. 서버 이름은 사례의 server_name 이다.
 *
 * 판정은 둘을 낸다. "탐지" 는 심각도가 medium 이상인 desc 발견이 하나라도 있는 사례, "언급" 은 info
 * 를 포함해 desc 발견이 하나라도 있는 사례다. info(sensitive-path 단독, cross-origin 단독)는 종료 코드를
 * 바꾸지 않으므로 탐지로 세지 않는다. 결정론적이다. 같은 커밋이면 같은 출력이 나온다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collectStrings, runDescRules } from "../../../packages/audit/dist/index.mjs";

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
    description: match ? match[2] : normalized,
    inputSchema: { type: "object" },
  };
}

const RANK = { high: 3, medium: 2, low: 1, info: 0 };
const cases = [];
for (const server of Object.values(data.servers)) {
  for (const instance of server.malicious_instance) {
    if (instance.wrong_data !== 0) continue;
    const tool = toTool(instance.poisoned_tool);
    const strings = collectStrings({ tools: [tool], prompts: [], resources: [], instructions: undefined });
    const findings = runDescRules(strings, { serverName: server.server_name });
    cases.push({
      paradigm: instance.metadata?.paradigm ?? "unknown",
      risk: instance.metadata?.["security risk"] ?? "unknown",
      detected: findings.some((f) => RANK[f.severity] >= RANK.medium),
      mentioned: findings.length > 0,
      rules: [...new Set(findings.map((f) => f.ruleId))].sort(),
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

const result = {
  cases: cases.length,
  unparsed,
  detected: cases.filter((c) => c.detected).length,
  mentioned: cases.filter((c) => c.mentioned).length,
  byParadigm: group("paradigm"),
  byRisk: group("risk"),
  byRule: sortedEntries(ruleCounts).map(([rule, n]) => ({ rule, cases: n, share: ratio(n, cases.length) })),
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
}
