import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runConformance, listServerScenarios } from "../lib/conformance-run.ts";
import { RESULTS_DIR, SERVER_FILE } from "../lib/paths.ts";
import type { ScenarioTable } from "../lib/scenario-score.ts";
import { startServer } from "../lib/server-proc.ts";

/** 원본 서버로 conformance 전체 시나리오를 한 번 돌려 표를 얻는다. */
async function runOnce(scenarios: readonly string[]): Promise<ScenarioTable> {
  const server = await startServer(SERVER_FILE);
  try {
    return await runConformance(server.url, scenarios);
  } finally {
    await server.stop();
  }
}

function tablesEqual(a: ScenarioTable, b: ScenarioTable): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

async function main(): Promise<void> {
  const scenarios = await listServerScenarios();

  const runs: ScenarioTable[] = [];
  runs.push(await runOnce(scenarios));
  runs.push(await runOnce(scenarios));

  const [first, second] = runs as [ScenarioTable, ScenarioTable];
  const stable = tablesEqual(first, second);
  const passing = Object.keys(first)
    .filter((key) => first[key] === "pass" && second[key] === "pass")
    .sort();

  const result = { runs, stable, passing };

  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(join(RESULTS_DIR, "baseline.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log(`전체 시나리오 수: ${scenarios.length}`);
  console.log(`두 번 모두 통과한 시나리오 수: ${passing.length}`);
  console.log(`stable: ${stable}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
