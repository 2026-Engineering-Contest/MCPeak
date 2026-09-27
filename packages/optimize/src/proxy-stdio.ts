#!/usr/bin/env node
/**
 * `mcpeak-optimize-proxy <overlay.json> (-- <executable> [args...] | --url <URL>)`
 *
 * 오버레이를 `tools/list` 로 내보내고 `tools/call` 은 원본 서버로 그대로 전달하는 stdio MCP
 * 서버를 띄운다(계획서 §6). MCP 클라이언트 설정에서 원본 서버 명령 자리에 이 명령을 넣는다.
 *
 * **stdout 에 아무것도 쓰지 않는다.** stdio 트랜스포트가 그 채널로 JSON-RPC 를 주고받으므로,
 * 안내나 오류는 전부 stderr 로 보낸다(`mock/src/stdio.ts` 와 같은 규율).
 */
import type { ConnectOptions, StdioConnectOptions } from "@mcpeak/core";
import { exitAfterWrite, overlayUnreadableMessage, readOverlayFile, startProxy } from "./proxy.js";
import { OptimizeError, type OptimizeOverlay } from "./types.js";

const usage = [
  "사용법: mcpeak-optimize-proxy <overlay.json> (-- <executable> [args...] | --url <URL>)",
  "  overlay.json 은 mcpeak optimize --out 으로 만든 파일입니다.",
  "  tools/list 는 오버레이로 답하고, tools/call 은 원본 서버에 이름과 인자 그대로 전달합니다.",
].join("\n");

type Parsed =
  | { readonly kind: "help" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "run"; readonly overlayPath: string; readonly upstream: ConnectOptions };

export function parseArgs(argv: readonly string[]): Parsed {
  const [overlayPath, flag, ...rest] = argv;
  if (overlayPath === "--help" || overlayPath === "-h") return { kind: "help" };
  if (overlayPath === undefined || overlayPath.startsWith("--")) {
    return { kind: "error", message: `→ 오버레이 파일 경로가 필요합니다.\n${usage}` };
  }
  if (flag === "--") {
    const [command, ...args] = rest;
    if (command === undefined) {
      return { kind: "error", message: `→ -- 뒤에 원본 서버 명령이 없습니다.\n${usage}` };
    }
    return { kind: "run", overlayPath, upstream: stdioUpstream(command, args) };
  }
  if (flag === "--url") {
    const [url, ...extra] = rest;
    if (url === undefined) {
      return { kind: "error", message: `→ --url 뒤에 원본 서버 URL 이 없습니다.\n${usage}` };
    }
    if (extra.length > 0) {
      return {
        kind: "error",
        message: `→ --url 과 함께 쓸 수 없는 인자입니다: ${extra.join(" ")}\n${usage}`,
      };
    }
    return { kind: "run", overlayPath, upstream: { url } };
  }
  if (flag === undefined) {
    return {
      kind: "error",
      message: `→ 원본 서버가 필요합니다. -- 뒤에 서버 명령을 쓰거나 --url 을 주세요.\n${usage}`,
    };
  }
  return { kind: "error", message: `→ 알 수 없는 인자입니다: ${flag}\n${usage}` };
}

/**
 * 프록시 자신의 환경 변수를 상류에 그대로 넘긴다. MCP 클라이언트는 설정의 `env` 를 이 프록시
 * 프로세스에 싣는데, 그것은 원래 원본 서버에 주려던 값이다(API 키 등). core 는 기본으로 SDK
 * 허용 목록만 넘기므로, 여기서 넘기지 않으면 프록시를 끼우는 순간 상류가 키를 잃는다.
 */
function stdioUpstream(command: string, args: readonly string[]): StdioConnectOptions {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return { command, args, env };
}

export async function main(argv: readonly string[]): Promise<void> {
  const parsed = parseArgs(argv);
  if (parsed.kind === "help") {
    process.stderr.write(`${usage}\n`);
    return;
  }
  if (parsed.kind === "error") {
    exitAfterWrite(1, parsed.message);
    return;
  }

  let overlay: OptimizeOverlay;
  try {
    overlay = readOverlayFile(parsed.overlayPath);
  } catch (error) {
    exitAfterWrite(
      1,
      overlayUnreadableMessage(
        parsed.overlayPath,
        error instanceof Error ? error.message : String(error),
        parsed.upstream,
      ),
    );
    return;
  }

  try {
    await startProxy({ overlay, upstream: parsed.upstream }, { overlayPath: parsed.overlayPath });
  } catch (error) {
    // 시작 실패 문장(§7.3)은 이미 완성돼 있다. 앞에 다른 줄을 붙이지 않는다.
    if (error instanceof OptimizeError) exitAfterWrite(1, error.message);
    else throw error;
  }
}

// top-level await 를 쓰지 않는다. 빌드가 cjs 도 함께 내는데 그쪽에서 지원되지 않는다.
// mock/src/stdio.ts 도 같은 이유로 이 형태다.
main(process.argv.slice(2)).catch((error: unknown) => {
  exitAfterWrite(
    1,
    `→ 프록시를 띄우지 못했습니다.\n→ ${error instanceof Error ? error.message : String(error)}`,
  );
});
