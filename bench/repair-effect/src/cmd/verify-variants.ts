import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { applyFault, FAULTS, variantFile } from "../lib/faults.ts";
import { runConformance } from "../lib/conformance-run.ts";
import { RESULTS_DIR, SERVER_FILE } from "../lib/paths.ts";
import type { ScenarioTable } from "../lib/scenario-score.ts";
import { ServerStartError, startServer } from "../lib/server-proc.ts";

interface VariantResult {
  readonly table: ScenarioTable;
  readonly targetFailed: boolean;
  readonly collateral: string[];
}

interface Baseline {
  readonly passing: readonly string[];
}

async function readBaseline(): Promise<Baseline> {
  const text = await readFile(join(RESULTS_DIR, "baseline.json"), "utf8");
  return JSON.parse(text) as Baseline;
}

async function writeVariantFile(id: (typeof FAULTS)[number]["id"], source: string): Promise<string> {
  const file = variantFile(id);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, source, "utf8");
  return file;
}

async function main(): Promise<void> {
  const baseline = await readBaseline();
  const scenarios = [...baseline.passing].sort();
  const originalSource = await readFile(SERVER_FILE, "utf8");

  const results: Record<string, VariantResult> = {};

  for (const fault of FAULTS) {
    const variantSource = applyFault(originalSource, fault);
    const file = await writeVariantFile(fault.id, variantSource);

    let result: VariantResult;
    try {
      const server = await startServer(file);
      try {
        const table = await runConformance(server.url, scenarios);
        const targetFailed = table[fault.target] === "fail";
        const collateral = scenarios
          .filter((scenario) => scenario !== fault.target && table[scenario] === "fail")
          .sort();
        result = { table, targetFailed, collateral };
      } finally {
        await server.stop();
      }
    } catch (error) {
      if (error instanceof ServerStartError) {
        result = { table: {}, targetFailed: false, collateral: ["<server-down>"] };
      } else {
        throw error;
      }
    }

    results[fault.id] = result;
    console.log(`${fault.id} 목표실패=${result.targetFailed} 부수피해=${result.collateral.length}`);
  }

  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(join(RESULTS_DIR, "variants.json"), `${JSON.stringify(results, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
