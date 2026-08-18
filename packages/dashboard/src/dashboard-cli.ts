#!/usr/bin/env node
import { startDashboardServer } from "./index.js";

const DEFAULT_PORT = 7357;

/**
 * `--port <번호>` 만 받는다. 값이 없거나 포트 범위를 벗어나면 그 자리에서 끊는다.
 * 브라우저 자동 오픈은 하지 않는다. URL 을 찍고 사용자가 연다.
 */
export function parsePort(argv: readonly string[]): number | { readonly error: string } {
  const index = argv.indexOf("--port");
  if (index === -1) return DEFAULT_PORT;
  const raw = argv[index + 1];
  if (raw === undefined) {
    return {
      error: "`--port` 뒤에 포트 번호가 없습니다.\n해결: `--port 7357` 처럼 번호를 붙이세요.",
    };
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return {
      error: `\`--port\` 값이 포트 번호가 아닙니다: ${raw}\n해결: 0 이상 65535 이하의 정수를 주세요(0 이면 빈 포트를 자동으로 고릅니다).`,
    };
  }
  return port;
}

async function main(): Promise<void> {
  const parsed = parsePort(process.argv.slice(2));
  if (typeof parsed !== "number") {
    process.stderr.write(`오류 [DASHBOARD_BAD_PORT]: ${parsed.error}\n`);
    process.exitCode = 1;
    return;
  }
  try {
    const server = await startDashboardServer({ port: parsed, root: process.cwd() });
    process.stdout.write(`대시보드: http://localhost:${server.port}\n`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `오류 [DASHBOARD_LISTEN_FAILED]: 포트 ${parsed} 에서 서버를 띄우지 못했습니다. 원인: ${reason}\n해결: 다른 포트를 \`--port\` 로 지정하거나, 그 포트를 쓰는 프로세스를 종료하세요.\n`,
    );
    process.exitCode = 1;
  }
}

void main();
