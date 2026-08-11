import type { McpProcessDiagnostics } from "./diagnostics.js";

export type McpClientErrorCode =
  | "PROCESS_START_FAILED"
  | "HANDSHAKE_TIMEOUT"
  | "HANDSHAKE_FAILED"
  | "PROCESS_EXITED"
  | "TRANSPORT_FAILED"
  | "OPERATION_FAILED"
  | "INVALID_TOOL_ARGUMENTS"
  | "PAGINATION_CURSOR_REPEATED"
  | "CLOSE_FAILED"
  | "FORCE_CLOSE_FAILED"
  | "FORCE_CLOSE_TIMEOUT";

export type McpClientErrorPhase =
  | "spawn"
  | "handshake"
  | "process"
  | "transport"
  | "listTools"
  | "callTool"
  | "close"
  | "forceClose";

type ErrorDetail = Readonly<{ phase: McpClientErrorPhase; message: string; hint: string }>;

export const MCP_CLIENT_ERROR_DETAILS: Readonly<Record<McpClientErrorCode, ErrorDetail>> =
  Object.freeze({
    PROCESS_START_FAILED: {
      phase: "spawn",
      message: "MCP 서버 프로세스를 시작하지 못했습니다.",
      hint: "command 실행 가능 여부와 cwd를 확인하세요.",
    },
    HANDSHAKE_TIMEOUT: {
      phase: "handshake",
      message: "제한 시간 안에 MCP 초기화를 마치지 못했습니다.",
      hint: "서버가 stdio MCP인지와 timeout을 확인하세요.",
    },
    HANDSHAKE_FAILED: {
      phase: "handshake",
      message: "MCP 초기화 응답 또는 protocol 협상에 실패했습니다.",
      hint: "서버 stderr와 SDK 호환성을 확인하세요.",
    },
    PROCESS_EXITED: {
      phase: "process",
      message: "요청 완료 전 MCP 서버가 종료되었습니다.",
      hint: "exit code, signal, bounded stderr를 확인하세요.",
    },
    TRANSPORT_FAILED: {
      phase: "transport",
      message: "stdio framing 또는 stream 오류가 발생했습니다.",
      hint: "stdout에 MCP 외 텍스트를 쓰는지 확인하세요.",
    },
    OPERATION_FAILED: {
      phase: "callTool",
      message: "MCP 작업이 protocol 오류로 거절되었습니다.",
      hint: "요청한 tool과 서버 기능 및 진단을 확인하세요.",
    },
    INVALID_TOOL_ARGUMENTS: {
      phase: "callTool",
      message: "callTool 인자가 JSON object가 아닙니다.",
      hint: "object 입력과 JSON 값만 사용하세요.",
    },
    PAGINATION_CURSOR_REPEATED: {
      phase: "listTools",
      message: "tools/list cursor가 반복되었습니다.",
      hint: "서버 pagination 구현을 확인하세요.",
    },
    CLOSE_FAILED: {
      phase: "close",
      message: "정상 종료 과정에 실패했습니다.",
      hint: "진단을 확인한 뒤 force close 결과를 확인하세요.",
    },
    FORCE_CLOSE_FAILED: {
      phase: "forceClose",
      message: "강제 종료 시스템 호출에 실패했습니다.",
      hint: "권한과 process 상태를 확인하세요.",
    },
    FORCE_CLOSE_TIMEOUT: {
      phase: "forceClose",
      message: "SIGKILL 뒤 close event가 상한 안에 오지 않았습니다.",
      hint: "process 잔존 여부와 운영체제 상태를 확인하세요.",
    },
  });

export class McpClientError extends Error {
  override readonly name = "McpClientError";
  readonly code: McpClientErrorCode;
  readonly phase: McpClientErrorPhase;
  readonly hint: string;
  readonly diagnostics: McpProcessDiagnostics;
  override readonly cause?: unknown;
  readonly #json: Readonly<Record<string, unknown>>;

  constructor(options: {
    code: McpClientErrorCode;
    phase: McpClientErrorPhase;
    diagnostics: McpProcessDiagnostics;
    cause?: unknown;
  }) {
    const detail = MCP_CLIENT_ERROR_DETAILS[options.code];
    super(detail.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = options.code;
    this.phase = options.phase;
    this.hint = detail.hint;
    this.diagnostics = Object.freeze({ ...options.diagnostics });
    this.cause = options.cause;
    this.#json = Object.freeze({
      name: this.name,
      code: this.code,
      phase: this.phase,
      message: this.message,
      hint: this.hint,
      exitCode: this.diagnostics.exitCode,
      signal: this.diagnostics.signal,
      stderrTruncated: this.diagnostics.stderrTruncated,
    });
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return this.#json;
  }
}
