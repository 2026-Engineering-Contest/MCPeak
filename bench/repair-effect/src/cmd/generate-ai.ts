import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { applyFault, FAULTS, type FaultId, variantFile } from "../lib/faults.ts";
import { pilotDir } from "../lib/mcpeak-run.ts";
import { MCPEAK_CLI, MODEL, SERVER_FILE } from "../lib/paths.ts";
import { ServerStartError, startServer } from "../lib/server-proc.ts";

type TargetId = FaultId | "original";

const VALID_IDS: readonly TargetId[] = ["original", ...FAULTS.map((f) => f.id)];

function isValidId(value: string | undefined): value is TargetId {
  return value !== undefined && (VALID_IDS as readonly string[]).includes(value);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** id 에 해당하는 서버 파일. "original" 은 원본, 나머지는 결함 변형이다. */
async function resolveServerFile(id: TargetId): Promise<string> {
  if (id === "original") return SERVER_FILE;
  const fault = FAULTS.find((f) => f.id === id);
  if (!fault) throw new Error(`알 수 없는 결함 id: ${id}`);
  const file = variantFile(fault.id);
  // pilot.ts 와 같은 이유로, 없으면 여기서도 만든다.
  if (!(await exists(file))) {
    const originalSource = await readFile(SERVER_FILE, "utf8");
    const variantSource = applyFault(originalSource, fault);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, variantSource, "utf8");
  }
  return file;
}

/**
 * MCPEAK_CLI 의 generate 를 stdio 상속으로 실행한다. AI 생성은 사람이 직접 보고 승인하는
 * 대화형 화면이 필요하기 때문에, 파이프로 가로채지 않고 터미널을 그대로 넘긴다.
 */
function runInteractiveGenerate(args: readonly string[], cwd: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MCPEAK_CLI, ...args], {
      cwd,
      stdio: "inherit",
    });
    child.once("exit", (code) => resolve(code));
    child.once("error", (error) => reject(error));
  });
}

async function main(): Promise<void> {
  const rawId = process.argv[2];

  if (!isValidId(rawId)) {
    console.error(`사용법: pnpm generate-ai <id>\n사용 가능한 id: ${VALID_IDS.join(", ")}`);
    process.exitCode = 2;
    return;
  }

  const id = rawId;
  const serverFile = await resolveServerFile(id);

  let server: Awaited<ReturnType<typeof startServer>>;
  try {
    server = await startServer(serverFile);
  } catch (error) {
    if (error instanceof ServerStartError) {
      console.error(`${id}: 서버 기동 실패\n${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  // 승인 화면 도중 Ctrl+C 로 끊길 수 있다. 이때도 서버를 반드시 끄고 나가야
  // 포트 3931 이 다음 실행을 막지 않는다. 신호 핸들러가 직접 종료하므로,
  // 정상 경로의 finally 에서는 이 핸들러를 먼저 떼어 내 이중 종료를 막는다.
  let signalHandled = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (signalHandled) return;
    signalHandled = true;
    const exitCode = signal === "SIGINT" ? 130 : 143;
    server
      .stop()
      .catch(() => {})
      .finally(() => {
        process.exit(exitCode);
      });
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    const dir = pilotDir(id);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    const suiteFile = join(dir, "suite.json");
    const tmpCwd = await mkdtemp(join(tmpdir(), "mcpeak-generate-ai-"));

    let exitCode: number | null;
    try {
      exitCode = await runInteractiveGenerate(
        [
          "generate",
          "--out",
          suiteFile,
          "--url",
          server.url,
          "--provider",
          "claude",
          "--model",
          MODEL,
          "--force",
        ],
        tmpCwd,
      );
    } finally {
      await rm(tmpCwd, { recursive: true, force: true });
    }

    const suiteExists = await exists(suiteFile);
    console.log(
      suiteExists
        ? `${id}: suite.json 생성 완료 (${suiteFile})`
        : `${id}: suite.json 이 생성되지 않았다`,
    );

    process.exitCode = exitCode ?? 1;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await server.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
