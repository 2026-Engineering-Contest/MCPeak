import { access, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { MCPEAK_CLI, RESULTS_DIR } from "./paths.ts";
import type { FaultId } from "./faults.ts";

const MCPEAK_TIMEOUT_MS = 900000;

export interface McpeakResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * mcpeak CLI 를 `node MCPEAK_CLI ...args` 로 띄운다. stdin 은 닫아 두어 비대화형으로
 * 강제한다. 상한 시간을 넘기면 SIGTERM 을 보내고 exitCode null 로 반환한다.
 * 종료 코드가 0 이 아니어도 던지지 않는다. 호출부가 exit-codes.json 에 그대로 기록한다.
 */
export function runMcpeak(args: readonly string[], cwd: string): Promise<McpeakResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [MCPEAK_CLI, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
    }, MCPEAK_TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr });
    });

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stderr += `\n${String(error)}`;
      resolve({ exitCode: null, stdout, stderr });
    });
  });
}

/** id 에 해당하는 파일럿 산출물 디렉터리. "original" 은 원본 참조 서버용이다. */
export function pilotDir(id: FaultId | "original"): string {
  return join(RESULTS_DIR, "pilot", id);
}

/**
 * diagnosis.txt 내용을 읽는다. 파일이 없으면 null 이다(번들이 없어 repair 를
 * 건너뛴 경우와 같은 뜻이다: 실패를 찾지 못했다).
 */
export async function diagnosisFor(id: FaultId): Promise<string | null> {
  const file = join(pilotDir(id), "diagnosis.txt");
  try {
    await access(file);
  } catch {
    return null;
  }
  return readFile(file, "utf8");
}
