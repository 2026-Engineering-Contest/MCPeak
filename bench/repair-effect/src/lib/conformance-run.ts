import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFORMANCE_BIN } from "./paths.ts";
import {
  type Check,
  type ScenarioOutcome,
  type ScenarioTable,
  parseServerScenarios,
  scoreChecks,
  sortTable,
} from "./scenario-score.ts";

const SCENARIO_TIMEOUT_MS = 60000;

function execFileWithTimeout(
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    let timedOut = false;
    // 콜백은 프로세스가 닫힌 뒤에 온다. 타임아웃으로 죽인 경우도 여기서만 resolve 하므로,
    // 호출자가 임시 디렉터리를 지우거나 다음 시나리오를 띄울 때 이 프로세스는 이미 없다.
    const child = execFile(bin, args, { cwd, maxBuffer: 1024 * 1024 * 64 }, (error) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ code: null, timedOut: true });
        return;
      }
      // 종료 코드는 판정에 쓰지 않는다. checks.json 만 본다.
      const code = error && "code" in error && typeof error.code === "number" ? error.code : 0;
      resolve({ code, timedOut: false });
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
  });
}

/** cwd 아래 results/**\/checks.json 파일 경로를 모두 찾는다. */
async function findChecksFiles(cwd: string): Promise<string[]> {
  const resultsDir = join(cwd, "results");
  let entries: string[];
  try {
    entries = await readdir(resultsDir, { recursive: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith("checks.json"))
    .map((entry) => join(resultsDir, entry));
}

async function readAllChecks(cwd: string): Promise<Check[]> {
  const files = await findChecksFiles(cwd);
  const checks: Check[] = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const parsed = JSON.parse(text) as Check[];
    checks.push(...parsed);
  }
  return checks;
}

export async function runScenario(
  url: string,
  scenario: string,
): Promise<{ outcome: ScenarioOutcome; checks: Check[] }> {
  const cwd = await mkdtemp(join(tmpdir(), "mcpeak-conf-"));
  try {
    const { timedOut } = await execFileWithTimeout(
      CONFORMANCE_BIN,
      ["server", "--url", url, "--scenario", scenario, "-o", "results"],
      cwd,
      SCENARIO_TIMEOUT_MS,
    );
    if (timedOut) {
      return { outcome: "fail", checks: [] };
    }
    const checks = await readAllChecks(cwd);
    return { outcome: scoreChecks(checks), checks };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

export async function runConformance(
  url: string,
  scenarios: readonly string[],
): Promise<ScenarioTable> {
  const sorted = [...scenarios].sort();
  const table: Record<string, ScenarioOutcome> = {};
  for (const scenario of sorted) {
    const { outcome } = await runScenario(url, scenario);
    table[scenario] = outcome;
  }
  return sortTable(table);
}

export async function listServerScenarios(): Promise<string[]> {
  const { stdout } = await execFileAsync(CONFORMANCE_BIN, ["list"]);
  return parseServerScenarios(stdout);
}

function execFileAsync(bin: string, args: string[]): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 1024 * 1024 * 16 }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout });
    });
  });
}
