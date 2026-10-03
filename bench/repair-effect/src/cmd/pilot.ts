import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { applyFault, FAULTS, type FaultId, variantFile } from "../lib/faults.ts";
import { pilotDir, runMcpeak } from "../lib/mcpeak-run.ts";
import { MODEL, SERVER_FILE } from "../lib/paths.ts";
import { ServerStartError, startServer } from "../lib/server-proc.ts";

type TargetId = FaultId | "original";

interface ExitCodes {
  generate: number | null;
  test: number | null;
  repair: number | null;
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
  // verify-variants 가 이미 만들어 뒀을 수 있지만, 없으면 여기서도 만든다.
  if (!(await exists(file))) {
    const originalSource = await readFile(SERVER_FILE, "utf8");
    const variantSource = applyFault(originalSource, fault);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, variantSource, "utf8");
  }
  return file;
}

async function runTarget(id: TargetId, options: { existingSuite: boolean }): Promise<void> {
  const dir = pilotDir(id);
  const exitCodesFile = join(dir, "exit-codes.json");
  const suiteFile = join(dir, "suite.json");

  if (await exists(exitCodesFile)) {
    console.log(`${id} 는 이미 완료되어 건너뜀`);
    return;
  }

  if (options.existingSuite) {
    // AI 생성 재시도: suite.json 은 사람이 이미 만들어 뒀다. 그것만 남기고
    // 나머지(낡은 bundle.json 등)는 지운 뒤 generate 를 건너뛴다.
    if (!(await exists(suiteFile))) {
      console.log(`${id}: suite.json 이 없어 건너뜀`);
      await mkdir(dir, { recursive: true });
      const exitCodes: ExitCodes = { generate: null, test: null, repair: null };
      await writeFile(exitCodesFile, `${JSON.stringify(exitCodes, null, 2)}\n`, "utf8");
      return;
    }
    // suite.json 은 사람이 대화형으로 승인한 작업 결과다. 순간이라도 디스크에서
    // 사라지면 안 되므로, 지우고 다시 쓰는 대신 그것만 남기고 나머지 항목을 지운다.
    const entries = await readdir(dir);
    for (const entry of entries) {
      if (entry === "suite.json") continue;
      await rm(join(dir, entry), { recursive: true, force: true });
    }
  } else {
    // 재실행 대비: exit-codes.json 이 없다는 건 이전 시도가 중간에 끊겼다는 뜻이다.
    // 그 디렉터리에 낡은 bundle.json 이 남아 있으면, 이번 test 가 실패 0건이어도
    // "번들 없음 = 실패 없음" 판정이 낡은 파일 때문에 틀어진다. 통째로 비우고 새로 만든다.
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
  }

  const exitCodes: ExitCodes = { generate: null, test: null, repair: null };
  const serverFile = await resolveServerFile(id);

  let server: Awaited<ReturnType<typeof startServer>>;
  try {
    server = await startServer(serverFile);
  } catch (error) {
    if (error instanceof ServerStartError) {
      console.error(`${id}: 서버 기동 실패, 건너뜀\n${error.message}`);
      await writeFile(exitCodesFile, `${JSON.stringify(exitCodes, null, 2)}\n`, "utf8");
      return;
    }
    throw error;
  }

  // 여기 도달했다면 server 는 위 try 에서 반드시 대입됐다(에러면 catch 가 return/throw 로
  // 빠진다). finally 에서 undefined 에 stop() 을 부를 가능성이 타입상으로도 없다.
  try {
    const bundleFile = join(dir, "bundle.json");

    if (!options.existingSuite) {
      const generateResult = await runMcpeak(
        ["generate", "--out", suiteFile, "--url", server.url, "--baseline-only", "--force"],
        dir,
      );
      exitCodes.generate = generateResult.exitCode;

      if (!(await exists(suiteFile))) {
        console.log(`${id}: generate 가 suite.json 을 만들지 못해 건너뜀`);
        await writeFile(exitCodesFile, `${JSON.stringify(exitCodes, null, 2)}\n`, "utf8");
        return;
      }
    }

    const testResult = await runMcpeak(
      ["test", suiteFile, "--url", server.url, "--repair-bundle", bundleFile],
      dir,
    );
    exitCodes.test = testResult.exitCode;
    await writeFile(join(dir, "test.txt"), testResult.stdout + testResult.stderr, "utf8");

    if (!(await exists(bundleFile))) {
      console.log(`${id}: 실패가 없어 번들이 생성되지 않음, repair 건너뜀`);
      await writeFile(exitCodesFile, `${JSON.stringify(exitCodes, null, 2)}\n`, "utf8");
      return;
    }

    const repairResult = await runMcpeak(
      ["repair", bundleFile, "--provider", "claude", "--model", MODEL, "--yes"],
      dir,
    );
    exitCodes.repair = repairResult.exitCode;
    await writeFile(join(dir, "diagnosis.txt"), repairResult.stdout, "utf8");
    await writeFile(join(dir, "repair-stderr.txt"), repairResult.stderr, "utf8");

    await writeFile(exitCodesFile, `${JSON.stringify(exitCodes, null, 2)}\n`, "utf8");
    console.log(`${id} 완료: generate=${exitCodes.generate} test=${exitCodes.test} repair=${exitCodes.repair}`);
  } finally {
    await server.stop();
  }
}

async function main(): Promise<void> {
  const existingSuite = process.argv.includes("--existing-suite");
  const targets: TargetId[] = ["original", ...FAULTS.map((f) => f.id)];
  for (const id of targets) {
    await runTarget(id, { existingSuite });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
