#!/usr/bin/env node
/**
 * `mcpeak-mock <definition.json>` — 목 MCP 서버를 stdio 로 띄운다.
 *
 * `core.connect({ command, args })` 가 이 프로세스에 붙는다. 즉 우리 도구로
 * 목 서버를 검증하는 경로다 (CONTRIBUTING §6).
 *
 *   mcpeak test suite.json --command mcpeak-mock --arg weather.mock.json
 *
 * **stdout 에 아무것도 쓰지 않는다.** stdio 트랜스포트가 그 채널로 JSON-RPC 를
 * 주고받으므로, 안내나 오류는 전부 stderr 로 보낸다.
 */
import { readFileSync } from "node:fs";
import { assertMockDefinition, serveStdio } from "./index.js";

const usage = [
  "사용법: mcpeak-mock <definition.json>",
  '  definition.json 형식: { "tools": [...], "responses": [{ "tool": ..., "result": ... }] }',
  "  responses 의 args 를 생략하면 인자를 가리지 않습니다.",
].join("\n");

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

export async function main(argv: readonly string[]): Promise<void> {
  const [path] = argv;
  if (path === undefined || path === "--help" || path === "-h") {
    if (path === undefined) fail(`→ 목 정의 파일 경로가 필요합니다.\n${usage}`);
    process.stderr.write(`${usage}\n`);
    return;
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    fail(
      [
        `→ 목 정의 파일을 읽을 수 없습니다: ${path}`,
        `→ ${error instanceof Error ? error.message : String(error)}`,
      ].join("\n"),
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(
      [
        `→ 목 정의 파일이 올바른 JSON 이 아닙니다: ${path}`,
        `→ ${error instanceof Error ? error.message : String(error)}`,
      ].join("\n"),
    );
  }

  try {
    assertMockDefinition(parsed, path);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  await serveStdio(parsed);
}

// top-level await 를 쓰지 않는다 — 빌드가 cjs 도 함께 내는데 그쪽에서 지원되지 않는다.
// packages/cli/src/cli.ts 도 같은 이유로 이 형태다.
main(process.argv.slice(2)).catch((error: unknown) => {
  fail(
    `→ 목 서버를 띄우지 못했습니다.\n→ ${error instanceof Error ? error.message : String(error)}`,
  );
});
