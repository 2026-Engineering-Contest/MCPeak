import { spawn } from "node:child_process";
import { join } from "node:path";
import { MODEL, WORK_DIR } from "./paths.ts";
import type { FaultId } from "./faults.ts";

const AGENT_TIMEOUT_MS = 900000;
// 10000ms 는 claude 가 SIGTERM 뒤 정리할 여유이고, 넘기면 무인 80회 실행이 한 건에
// 묶이지 않도록 강제 종료한다.
const SIGKILL_GRACE_MS = 10000;

export const AGENT_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep"] as const;

/**
 * --restricted: 코드 실행 도구 제거, 사용자·프로젝트·로컬 설정 파일(훅, 플러그인) 무시,
 *   파일 도구를 작업 디렉터리 안으로 제한. 에이전트가 conformance·mcpeak 을 돌리거나
 *   사용자 훅에 오염되는 것을 막는다.
 * --strict-mcp-config + 빈 mcp-config: MCP 서버를 하나도 싣지 않는다.
 * --permission-mode acceptEdits: 사람 없이 편집을 승인한다.
 * stream-json + verbose: 첫 줄의 init 이벤트로 canary 가 격리를 확인하고,
 *   마지막 result 이벤트에서 토큰 사용량을 읽는다.
 */
export function AGENT_ARGS(prompt: string): string[] {
  return [
    "-p", prompt,
    "--restricted",
    "--tools", AGENT_TOOLS.join(","),
    "--strict-mcp-config",
    "--mcp-config", '{"mcpServers":{}}',
    "--permission-mode", "acceptEdits",
    "--model", MODEL,
    "--output-format", "stream-json",
    "--verbose",
    "--no-session-persistence",
  ];
}

export interface AgentRun {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly lines: readonly unknown[];
  readonly init: Record<string, unknown> | null;
  readonly result: Record<string, unknown> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * `claude` 를 AGENT_ARGS(prompt) 로 cwd=workDir 에서 실행한다. stdin 은 닫아 비대화형으로
 * 강제한다. stdout 을 줄 단위로 JSON 파싱해 lines 에 모으고(파싱 실패 줄은 문자열 그대로),
 * type==="system"&&subtype==="init" 인 첫 객체를 init, type==="result" 인 마지막 객체를
 * result 로 둔다. 상한 시간을 넘기면 SIGTERM 을 보내고 timedOut: true 로 반환한다.
 * SIGTERM 뒤 SIGKILL_GRACE_MS 안에 종료하지 않으면 SIGKILL 로 강제 종료해 절대 멈춰
 * 있지 않게 한다.
 */
export function runAgent(input: { workDir: string; prompt: string }): Promise<AgentRun> {
  const { workDir, prompt } = input;
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const child = spawn("claude", AGENT_ARGS(prompt), {
      cwd: workDir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    let settled = false;
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // SIGTERM 으로 정리할 시간을 준 뒤에도 살아 있으면 SIGKILL 로 강제 종료한다.
      // exit 이벤트가 오면 아래에서 clearTimeout 으로 취소되므로, 여기까지 오는 건
      // 프로세스가 실제로 멈추지 않은 경우뿐이다.
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, SIGKILL_GRACE_MS);
    }, AGENT_TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    // stderr 는 버린다. 진단에 필요한 모든 정보는 stdout 의 stream-json 에 담긴다.
    child.stderr?.on("data", () => {});

    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer !== null) clearTimeout(killTimer);

      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const lines: unknown[] = [];
      let init: Record<string, unknown> | null = null;
      let result: Record<string, unknown> | null = null;

      for (const rawLine of stdout.split("\n")) {
        if (rawLine.trim() === "") continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawLine);
        } catch {
          lines.push(rawLine);
          continue;
        }
        lines.push(parsed);

        if (isRecord(parsed)) {
          if (init === null && parsed.type === "system" && parsed.subtype === "init") {
            init = parsed;
          }
          if (parsed.type === "result") {
            result = parsed;
          }
        }
      }

      resolve({
        exitCode,
        timedOut,
        durationMs: Date.now() - startedAt,
        lines,
        init,
        result,
      });
    };

    child.once("exit", (code) => {
      finish(code);
    });

    child.once("error", () => {
      finish(null);
    });
  });
}

/** faultId/condition/attempt 에 해당하는 실행 산출물 디렉터리. */
export function runDir(faultId: FaultId, condition: "plain" | "diagnosed", attempt: number): string {
  return join(WORK_DIR, "runs", faultId, condition, String(attempt));
}

/**
 * result 이벤트에서 토큰 사용량을 읽는다. result.usage.input_tokens /
 * result.usage.output_tokens 가 숫자가 아니면 null 이다.
 */
export function readUsage(
  result: Record<string, unknown> | null,
): { inputTokens: number | null; outputTokens: number | null } {
  const usage = result && isRecord(result.usage) ? result.usage : null;
  const inputTokens = usage && typeof usage.input_tokens === "number" ? usage.input_tokens : null;
  const outputTokens = usage && typeof usage.output_tokens === "number" ? usage.output_tokens : null;
  return { inputTokens, outputTokens };
}
