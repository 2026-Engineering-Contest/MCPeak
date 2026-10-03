import { type ChildProcess, spawn } from "node:child_process";
import { connect } from "node:net";
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
 * tsx 는 실제 서버를 자식 node 프로세스로 띄우고 SIGTERM 은 넘기지만 SIGKILL 은 넘기지 못한다.
 * child.kill 만 쓰면 tsx 만 죽고 서버가 포트를 쥔 채 남는다. 그래서 detached 로 띄운 뒤
 * 프로세스 그룹(-pid) 전체에 신호를 보낸다.
 */
function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // 그룹이 이미 없다.
  }
}

/**
 * spawn 전에 포트가 비어 있는지 확인한다. everything-server 의 listen 콜백은 bind 오류를
 * 보지 않고 준비 신호를 찍으므로, 남은 서버가 있으면 그 서버를 새 대상의 이름으로 채점하게
 * 된다. 결과가 엉뚱한 이름으로 기록되는 것을 막으려면 여기서 멈춰야 한다.
 */
function assertPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = connect(port, "127.0.0.1");
    sock.once("connect", () => {
      sock.destroy();
      reject(
        new ServerStartError(
          `포트 ${port} 를 이미 다른 프로세스가 점유 중이다. 이전 벤치마크 실행이 남긴 서버가 있는지 확인한다: lsof -i :${port}`,
        ),
      );
    });
    sock.once("error", () => resolve());
  });
}

/**
 * TSX_BIN 으로 serverFile 을 띄운다. cwd 를 BENCH_ROOT 로 두는 이유는 서버 파일이 work/
 * 아래 어디에 있든 node_modules 를 위로 올라가며 찾게 하기 위해서다.
 */
export async function startServer(serverFile: string): Promise<RunningServer> {
  await assertPortFree(PORT);

  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(TSX_BIN, [serverFile], {
      cwd: BENCH_ROOT,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true, // killGroup 이 프로세스 그룹 단위로 종료하기 위해서다.
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
      killGroup(child, "SIGKILL");
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
      if (child.exitCode === null) {
        killGroup(child, "SIGKILL");
      }
    }, STOP_GRACE_MS);

    killGroup(child, "SIGTERM");
  });
}
