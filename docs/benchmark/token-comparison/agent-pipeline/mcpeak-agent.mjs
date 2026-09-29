#!/usr/bin/env node
// 실험용: 생성 → 실행 → 자리값 보완 → 재실행 → 보고서를 명령 하나로 한다.
// 사용: node mcpeak-agent.mjs [--report report.md] -- <server command...>
// 기존 @mcpeak/cli 를 자식 프로세스로 부르는 래퍼다. 패키지 코드는 건드리지 않는다.
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import {
  buildClassifyPrompt,
  buildFixtures,
  classifyDeterministic,
  parseClassifyResponse,
  summarize,
  writeReport,
} from "./lib.mjs";

const argv = process.argv.slice(2);
const dash = argv.indexOf("--");
if (dash < 0 || dash === argv.length - 1) {
  console.error("사용: node mcpeak-agent.mjs [--report report.md] -- <server command...>");
  process.exit(2);
}
const serverCmd = argv.slice(dash + 1);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && i < dash ? argv[i + 1] : dflt;
};
const reportPath = opt("--report", "report.md");
const suitePath = "server.suite.json";
const fixturesPath = "mcpeak.fixtures.json";
const MCPEAK = ["npx", "-y", "@mcpeak/cli@latest"];

function run(cmd, args, input) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CLAUDECODE: undefined, CLAUDE_CODE_ENTRYPOINT: undefined },
  });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function generate() {
  const args = [
    ...MCPEAK.slice(1),
    "generate",
    "--out",
    suitePath,
    "--baseline-only",
    "--force",
    "--",
    ...serverCmd,
  ];
  const r = run(MCPEAK[0], args);
  if (!existsSync(suitePath)) {
    console.error(r.out + r.err);
    process.exit(1);
  }
  const warnings = (r.out + r.err)
    .split("\n")
    .filter((l) => /만 실행했습니다|건너뛰|가리키지 않습니다/.test(l))
    .map((l) => l.trim());
  return { warnings };
}

function runSuite() {
  const r = run(MCPEAK[0], [...MCPEAK.slice(1), "test", suitePath, "--json", "--", ...serverCmd]);
  const start = r.out.indexOf("{");
  if (start < 0) {
    console.error(r.out + r.err);
    process.exit(1);
  }
  try {
    return JSON.parse(r.out.slice(start));
  } catch {
    console.error(`test --json 출력을 해석하지 못했습니다.\n${r.out}${r.err}`);
    process.exit(1);
  }
}

// failed: 응답을 해석하지 못한 호출. 토큰을 썼어도 usage 를 못 읽으므로 횟수로만 남긴다.
const llm = { calls: 0, failed: 0, input_tokens: 0, output_tokens: 0, cost: 0 };
function askLlm(prompt) {
  const empty = new URL("./empty-mcp.json", import.meta.url).pathname;
  // 에이전트와 같은 모델을 쓴다. 기본 모델(Opus)로 나가면 호출당 비용이 4배라 회계가 어긋난다.
  const model = process.env.MCPEAK_AGENT_MODEL ?? "sonnet";
  const r = run("claude", [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--max-turns",
    "1",
    "--model",
    model,
    "--system-prompt",
    "너는 JSON 한 줄로만 답하는 분류기다.",
    "--tools",
    "",
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--mcp-config",
    empty,
    "--disable-slash-commands",
  ]);
  let j;
  llm.calls++;
  try {
    j = JSON.parse(r.out);
  } catch {
    llm.failed++;
    return { kind: "defect", reason: "분류기 호출 실패" };
  }
  llm.input_tokens +=
    (j.usage?.input_tokens ?? 0) +
    (j.usage?.cache_creation_input_tokens ?? 0) +
    (j.usage?.cache_read_input_tokens ?? 0);
  llm.output_tokens += j.usage?.output_tokens ?? 0;
  llm.cost += j.total_cost_usd ?? 0;
  return parseClassifyResponse(j.result ?? "");
}

// 1회차
let { warnings } = generate();
let report = runSuite();
let classified = new Map(report.cases.map((c) => [c.spec.id, classifyDeterministic(c)]));

// 자리값 후보만 좁은 LLM 에 묻는다
const placeholders = [];
for (const c of report.cases) {
  const cls = classified.get(c.spec.id);
  if (cls.kind !== "ask") continue;
  const op = c.spec.operation;
  const ans = askLlm(buildClassifyPrompt({ tool: op.tool, input: op.input, notes: cls.notes }));
  if (ans.kind === "placeholder")
    placeholders.push({ tool: op.tool, field: ans.field, value: ans.value });
  classified.set(c.spec.id, ans.kind === "placeholder" ? { kind: "placeholder" } : ans);
}

// 픽스처가 나오면 한 번만 재생성·재실행
let fixtures = null;
if (placeholders.length > 0) {
  fixtures = buildFixtures(placeholders);
  writeFileSync(fixturesPath, `${JSON.stringify(fixtures, null, 2)}\n`);
  ({ warnings } = generate());
  report = runSuite();
  classified = new Map(report.cases.map((c) => [c.spec.id, classifyDeterministic(c)]));
  // 재실행 뒤에도 ask 로 남은 정상 케이스는 결함으로 본다 (재시도 상한 1회)
  for (const [id, cls] of classified)
    if (cls.kind === "ask")
      classified.set(id, { kind: "defect", reason: "픽스처 적용 뒤에도 허용 입력을 거절" });
}

writeFileSync(reportPath, writeReport({ report, classified, warnings, fixtures, suitePath }));
writeFileSync("agent-usage.json", `${JSON.stringify(llm)}\n`);
console.log(summarize({ report, classified, fixtures, llm }));
