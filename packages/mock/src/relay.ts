#!/usr/bin/env node
/**
 * `mcpeak-relay --port 7400 -- node ./server.mjs` — stdio MCP 서버를 Streamable HTTP 로 중계한다.
 *
 * 앞이 HTTP, 뒤가 stdio 다. **뒤 서버는 stdio 만 받는다** — 진짜 서버가 이미 HTTP 면 AI 를
 * 거기 직접 붙이면 되므로 중계기가 필요 없다.
 *
 * **stdout 에 아무것도 쓰지 않는다.** 기록은 전부 stderr 다. 4 단계 대시보드가 이 채널을
 * 읽는다.
 */
import { startRelay } from "./relay-server.js";

const usage = [
  "사용법: mcpeak-relay [--port <번호>] [--json] -- <명령> [인자...]",
  "  --port 0 (기본) 이면 빈 포트를 자동으로 받습니다.",
  "  --json 을 주면 기록을 한 줄 JSON 으로 냅니다.",
  "  -- 뒤는 중계할 stdio MCP 서버의 실행 명령입니다.",
].join("\n");

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

interface Parsed {
  port: number;
  json: boolean;
  command: string;
  args: string[];
}

export function parseArgs(argv: readonly string[]): Parsed {
  let port = 0;
  let json = false;
  let index = 0;
  for (; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      index += 1;
      break;
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--port") {
      const value = argv[index + 1];
      const parsed = Number(value);
      if (value === undefined || !Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        fail(`→ --port 에는 0~65535 의 정수가 필요합니다. 받은 값: ${value ?? "(없음)"}\n${usage}`);
      }
      port = parsed;
      index += 1;
      continue;
    }
    fail(`→ 모르는 인자입니다: ${token}\n${usage}`);
  }
  const rest = argv.slice(index);
  const command = rest[0];
  if (command === undefined) {
    fail(`→ 중계할 서버의 실행 명령이 필요합니다. -- 뒤에 적으세요.\n${usage}`);
  }
  return { port, json, command, args: rest.slice(1) };
}

export async function main(argv: readonly string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stderr.write(`${usage}\n`);
    return;
  }
  const { port, json, command, args } = parseArgs(argv);

  const handle = await startRelay({
    port,
    command,
    args,
    log: (line) => process.stderr.write(`${line}\n`),
    json,
  });

  // --port 0 이면 받은 포트를 알려 줄 채널이 이 줄뿐이다. 4 단계 대시보드도 이 줄로 URL 을 안다.
  process.stderr.write(
    json
      ? `${JSON.stringify({ dir: "up", port: handle.port, url: handle.url })}\n`
      : `→ 중계기 대기 중 ${handle.url}\n`,
  );

  // `handle.close()` 자체도 멱등이지만(Task 5) 이 가드는 따로 둔다. 여기서 막는 것은
  // 두 번째 닫기가 아니라 **두 번째 `process.exit(0)`** 이다 — SIGINT 와 SIGTERM 이
  // 잇달아 오면 첫 닫기가 끝나기 전에 두 번째 핸들러가 붙는다.
  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    handle
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        fail(
          `→ 중계기를 닫는 중 오류가 났습니다.\n→ ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// top-level await 를 쓰지 않는다 — 빌드가 cjs 도 함께 내는데 그쪽에서 지원되지 않는다.
// src/stdio.ts · packages/cli/src/cli.ts 도 같은 이유로 이 형태다.
main(process.argv.slice(2)).catch((error: unknown) => {
  fail(
    `→ 중계기를 띄우지 못했습니다.\n→ ${error instanceof Error ? error.message : String(error)}`,
  );
});
