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
import { parseArgs, usage } from "./relay-args.js";
import { resolveEnv } from "./relay-env.js";
import { startRelay } from "./relay-server.js";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

export async function main(argv: readonly string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stderr.write(`${usage}\n`);
    return;
  }
  // 파서는 프로세스를 죽이지 않는다. 실패시키는 것은 여기다 — 그래야 문안에 유닛
  // 테스트를 걸 수 있다(`tests/relay-args.test.ts`).
  const parsed = parseArgs(argv);
  if (!parsed.ok) fail(parsed.message);
  const { port, json, envNames, command, args } = parsed.value;

  // 값은 여기서, 부모 환경에서 읽는다. argv 에 값을 싣지 않는 것이 이 옵션의 존재 이유다
  // (ADR-0097·ADR-0102). 읽기를 주입하는 형태라 테스트는 `process.env` 없이 볼 수 있다.
  const env = resolveEnv(envNames, (name) => process.env[name]);
  if (!env.ok) fail(env.message);

  const handle = await startRelay({
    port,
    command,
    args,
    log: (line) => process.stderr.write(`${line}\n`),
    json,
    env: env.value,
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
