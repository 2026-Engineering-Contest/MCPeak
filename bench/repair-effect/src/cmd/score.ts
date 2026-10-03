import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runDir } from "../lib/agent-run.ts";
import type { Condition, RunRecord } from "../lib/aggregate.ts";
import { runConformance } from "../lib/conformance-run.ts";
import { FAULTS, type FaultId } from "../lib/faults.ts";
import { judgeRepair } from "../lib/judge.ts";
import { RESULTS_DIR } from "../lib/paths.ts";
import type { ScenarioTable } from "../lib/scenario-score.ts";
import { ServerStartError, startServer } from "../lib/server-proc.ts";

const VARIANT_NAME = "everything-server.ts";
const REPAIR_CONDITIONS: readonly Condition[] = ["plain", "diagnosed"];

interface Baseline {
  readonly passing: readonly string[];
}

interface VariantResult {
  readonly table: ScenarioTable;
  readonly targetFailed: boolean;
  readonly collateral: readonly string[];
}

interface Done {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly durationMs: number | null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readBaseline(): Promise<Baseline> {
  const text = await readFile(join(RESULTS_DIR, "baseline.json"), "utf8");
  return JSON.parse(text) as Baseline;
}

async function readVariants(): Promise<Record<FaultId, VariantResult>> {
  const text = await readFile(join(RESULTS_DIR, "variants.json"), "utf8");
  return JSON.parse(text) as Record<FaultId, VariantResult>;
}

/**
 * plain·diagnosed 80회(변형 8개 × 조건 2개 × 5회) 각각의 runDir 에 done.json 이
 * 있는지 먼저 전부 확인한다. done.json 이 없다는 건 repair-runs 가 중간에 끊긴
 * 미완료 실행이라는 뜻이고, 이를 정상 실행으로 채점하면(예: serverDown 으로 잘못
 * 채점) 숫자가 조용히 틀어진다. 서버를 하나도 띄우기 전에 검사해 미완료가 있으면
 * 아무것도 쓰지 않고 바로 던진다.
 */
async function findIncompleteRunDirs(): Promise<string[]> {
  const missing: string[] = [];
  for (const fault of FAULTS) {
    for (const condition of REPAIR_CONDITIONS as readonly ("plain" | "diagnosed")[]) {
      for (let attempt = 1; attempt <= 5; attempt++) {
        const dir = runDir(fault.id, condition, attempt);
        if (!(await exists(join(dir, "done.json")))) {
          missing.push(dir);
        }
      }
    }
  }
  return missing;
}

async function readDone(dir: string): Promise<Done> {
  const doneFile = join(dir, "done.json");
  if (!(await exists(doneFile))) {
    return { inputTokens: null, outputTokens: null, durationMs: null };
  }
  const text = await readFile(doneFile, "utf8");
  return JSON.parse(text) as Done;
}

/**
 * 조건 defect 는 다시 실행하지 않는다. verify-variants 가 이미 만들어 둔 판정표를 그대로 쓴다.
 */
function defectRecord(
  faultId: FaultId,
  target: string,
  baselinePassing: readonly string[],
  variant: VariantResult,
): RunRecord {
  const judged = judgeRepair({ baselinePassing, target, table: variant.table });
  return {
    faultId,
    condition: "defect",
    attempt: 1,
    verdict: judged.verdict,
    passCount: judged.passCount,
    regressed: judged.regressed,
    inputTokens: null,
    outputTokens: null,
    durationMs: null,
  };
}

/**
 * 조건 plain·diagnosed 는 runDir 아래 저장된 수리된 서버를 띄워 채점한다.
 * 수리된 서버 파일이 없으면(에이전트가 파일을 지운 경우) 띄우지 않고 바로 serverDown 으로
 * 채점한다. ServerStartError 도 마찬가지로 table 을 null 로 둔다.
 */
async function repairRecord(
  faultId: FaultId,
  condition: "plain" | "diagnosed",
  attempt: number,
  target: string,
  baselinePassing: readonly string[],
): Promise<RunRecord> {
  const dir = runDir(faultId, condition, attempt);
  const serverFile = join(dir, VARIANT_NAME);

  let table: ScenarioTable | null = null;
  if (await exists(serverFile)) {
    try {
      const server = await startServer(serverFile);
      try {
        table = await runConformance(server.url, baselinePassing);
      } finally {
        await server.stop();
      }
    } catch (error) {
      if (error instanceof ServerStartError) {
        table = null;
      } else {
        throw error;
      }
    }
  }

  const done = await readDone(dir);
  const judged = judgeRepair({ baselinePassing, target, table });

  return {
    faultId,
    condition,
    attempt,
    verdict: judged.verdict,
    passCount: judged.passCount,
    regressed: judged.regressed,
    inputTokens: done.inputTokens,
    outputTokens: done.outputTokens,
    durationMs: done.durationMs,
  };
}

async function main(): Promise<void> {
  const incomplete = await findIncompleteRunDirs();
  if (incomplete.length > 0) {
    throw new Error(
      [
        "다음 실행 디렉터리에 done.json 이 없다. pnpm repair-runs 를 먼저 완료해야 한다.",
        ...incomplete,
      ].join("\n"),
    );
  }

  const [baseline, variants] = await Promise.all([readBaseline(), readVariants()]);
  const baselinePassing = [...baseline.passing].sort();

  const records: RunRecord[] = [];

  for (const fault of FAULTS) {
    const variant = variants[fault.id];
    if (variant === undefined) {
      throw new Error(`variants.json 에 ${fault.id} 가 없다. pnpm verify-variants 를 다시 실행해야 한다.`);
    }
    records.push(defectRecord(fault.id, fault.target, baselinePassing, variant));

    for (const condition of REPAIR_CONDITIONS as readonly ("plain" | "diagnosed")[]) {
      for (let attempt = 1; attempt <= 5; attempt++) {
        const record = await repairRecord(fault.id, condition, attempt, fault.target, baselinePassing);
        records.push(record);
        console.log(`${fault.id}/${condition}/${attempt} verdict=${record.verdict}`);
      }
    }
  }

  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(join(RESULTS_DIR, "runs.json"), `${JSON.stringify(records, null, 2)}\n`, "utf8");
  console.log(`results/runs.json 에 ${records.length}건 기록`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
