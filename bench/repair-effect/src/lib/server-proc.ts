import { type ChildProcess, spawn } from "node:child_process";
import { BENCH_ROOT, PORT, TSX_BIN } from "./paths.ts";

const READY_MARKER = "MCP Conformance Test Server running on";
const START_TIMEOUT_MS = 20000; // tsx 가 76KB 파일을 첫 변환하는 시간에 여유를 둔 값이다.
const STOP_GRACE_MS = 3000;

export interface RunningServer {
  readonly url: string;
  stop(): Promise<void>;
}

/** 서버가 기동 시간 안에 준비되지 않았거나 그 전에 죽었을 때 던진다. */
export class ServerStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerStartError";
  }
}

function lastLines(text: string, n: number): string {
  return text.split("\n").slice(-n).join("\n");
}

/**
 * TSX_BIN 으로 serverFile 을 띄운다. cwd 를 BENCH_ROOT 로 두는 이유는 서버 파일이 work/
 * 아래 어디에 있든 node_modules 를 위로 올라가며 찾게 하기 위해서다.
 */
export function startServer(serverFile: string): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(TSX_BIN, [serverFile], {
      cwd: BENCH_ROOT,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const cleanupListeners = () => {
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("exit", onExit);
      clearTimeout(timer);
    };

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanupListeners();
      reject(new ServerStartError(`${message}\n--- stderr(최근 20줄) ---\n${lastLines(stderr, 20)}`));
    };

    const onStdout = (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (!settled && stdout.includes(READY_MARKER)) {
        settled = true;
        cleanupListeners();
        resolve({
          url: `http://localhost:${PORT}/mcp`,
          stop: () => stopServer(child),
        });
      }
    };

    const onStderr = (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      fail(`서버 프로세스가 준비 신호 전에 종료됨 (code=${code}, signal=${signal})`);
    };

    const timer = setTimeout(() => {
      fail(`서버가 ${START_TIMEOUT_MS}ms 안에 준비되지 않음`);
      if (!child.killed) child.kill("SIGKILL");
    }, START_TIMEOUT_MS);

    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("exit", onExit);
    child.once("error", (err) => fail(`서버 프로세스 실행 실패: ${err.message}`));
  });
}

function stopServer(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }

    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(killTimer);
      resolve();
    };

    child.once("exit", finish);

    const killTimer = setTimeout(() => {
      if (!child.killed && child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, STOP_GRACE_MS);

    child.kill("SIGTERM");
  });
}
