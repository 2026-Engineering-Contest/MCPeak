#!/usr/bin/env node
import { parsePort, startupLine, USAGE, wantsHelp } from "./cli-args.js";
import { startDashboardServer } from "./index.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (wantsHelp(argv)) {
    process.stdout.write(USAGE);
    return;
  }
  const parsed = parsePort(argv);
  if (typeof parsed !== "number") {
    process.stderr.write(`오류 [DASHBOARD_BAD_PORT]: ${parsed.error}\n`);
    process.exitCode = 1;
    return;
  }
  const root = process.cwd();
  try {
    const server = await startDashboardServer({ port: parsed, root });
    process.stdout.write(startupLine(server.port, root));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `오류 [DASHBOARD_LISTEN_FAILED]: 포트 ${parsed} 에서 서버를 띄우지 못했습니다. 원인: ${reason}\n해결: 다른 포트를 \`--port\` 로 지정하거나, 그 포트를 쓰는 프로세스를 종료하세요.\n`,
    );
    process.exitCode = 1;
  }
}

void main();
