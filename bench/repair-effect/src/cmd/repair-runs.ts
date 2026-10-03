import { execFile } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { readUsage, runAgent, runDir } from "../lib/agent-run.ts";
import { FAULTS, variantFile } from "../lib/faults.ts";
import { diagnosisFor } from "../lib/mcpeak-run.ts";
import { buildPrompt } from "../lib/prompts.ts";

const execFileAsync = promisify(execFile);

const CONDITIONS = ["plain", "diagnosed"] as const;
type Condition = (typeof CONDITIONS)[number];

const VARIANT_NAME = "everything-server.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** 결과가 다르지 않으면 diff 는 exit 0, 다르면 exit 1 이다. 둘 다 정상 실행이다. */
async function writeDiff(originalFile: string, editedFile: string, outFile: string): Promise<void> {
  try {
    const { stdout } = await execFileAsync("diff", ["-u", originalFile, editedFile]);
    await writeFile(outFile, stdout, "utf8");
  } catch (error) {
    const withStdout = error as { code?: number; stdout?: string };
    if (typeof withStdout.stdout === "string") {
      await writeFile(outFile, withStdout.stdout, "utf8");
      return;
    }
    throw error;
  }
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds}s`;
}

interface Job {
  readonly attempt: number;
  readonly faultId: (typeof FAULTS)[number]["id"];
  readonly condition: Condition;
}

function buildJobs(): Job[] {
  const jobs: Job[] = [];
  for (let attempt = 1; attempt <= 5; attempt++) {
    for (const fault of FAULTS) {
      for (const condition of CONDITIONS) {
        jobs.push({ attempt, faultId: fault.id, condition });
      }
    }
  }
  return jobs;
}

async function runJob(job: Job): Promise<{ skipped: boolean; exitCode: number | null; durationMs: number }> {
  const dir = runDir(job.faultId, job.condition, job.attempt);
  const doneFile = join(dir, "done.json");

  if (await exists(doneFile)) {
    return { skipped: true, exitCode: null, durationMs: 0 };
  }

  // done.json 이 없다는 건 이전 시도가 중간에 끊겼다는 뜻이다. 낡은 산출물을 지우고 새로 만든다.
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const tempDir = await mkdtemp(join(tmpdir(), "mcpeak-repair-"));
  try {
    const sourceVariant = variantFile(job.faultId);
    const tempVariant = join(tempDir, VARIANT_NAME);
    await copyFile(sourceVariant, tempVariant);

    const diagnosis = job.condition === "diagnosed" ? await diagnosisFor(job.faultId) : null;
    const prompt = buildPrompt(job.condition, diagnosis);

    const run = await runAgent({ workDir: tempDir, prompt });

    const editedVariant = join(tempDir, VARIANT_NAME);
    const editedExists = await exists(editedVariant);
    if (editedExists) {
      await copyFile(editedVariant, join(dir, VARIANT_NAME));
      await writeDiff(sourceVariant, join(dir, VARIANT_NAME), join(dir, "diff.patch"));
    }
    // editedExists 가 false 면 에이전트가 파일을 지웠다는 뜻이다. everything-server.ts 도
    // diff.patch 도 만들지 않고 그대로 둔다(채점에서 serverDown 으로 잡힌다).

    const streamLines = run.lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line)));
    await writeFile(join(dir, "stream.jsonl"), `${streamLines.join("\n")}\n`, "utf8");

    const usage = readUsage(run.result);
    const done = {
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      durationMs: run.durationMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    };
    // done.json 은 완료 표지이므로 반드시 다른 파일보다 뒤에 쓴다.
    await writeFile(doneFile, `${JSON.stringify(done, null, 2)}\n`, "utf8");

    return { skipped: false, exitCode: run.exitCode, durationMs: run.durationMs };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const jobs = buildJobs();

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const index = i + 1;
    const label = `[${index}/${jobs.length}] ${job.faultId} ${job.condition} #${job.attempt}`;

    const outcome = await runJob(job);
    if (outcome.skipped) {
      console.log(`${label} skip`);
      continue;
    }
    console.log(`${label} exit=${outcome.exitCode} ${formatDuration(outcome.durationMs)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
