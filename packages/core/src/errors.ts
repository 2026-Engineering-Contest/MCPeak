import { type McpDiagnostics, type McpDiagnosticsInput, tagDiagnostics } from "./diagnostics.js";

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
  | "FORCE_CLOSE_TIMEOUT"
  | "HTTP_CONNECT_FAILED"
  | "HTTP_STATUS_ERROR"
  | "HTTP_UNAUTHORIZED"
  | "HTTP_RESPONSE_INVALID"
  | "HTTP_HANDSHAKE_TIMEOUT"
  | "HTTP_SESSION_LOST";

export type McpClientErrorPhase =
  | "spawn"
  | "connect"
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
      hint: "서버 stderr에 나온 오류를 수정한 뒤 다시 실행하세요.",
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
    HTTP_CONNECT_FAILED: {
      phase: "connect",
      message: "MCP 서버 URL 에 연결하지 못했습니다.",
      hint: "서버가 떠 있는지, url 의 host 와 port 가 맞는지 확인하세요.",
    },
    HTTP_STATUS_ERROR: {
      phase: "connect",
      message: "MCP 엔드포인트가 오류 상태 코드를 반환했습니다.",
      hint: "status 와 경로를 확인하세요. Streamable HTTP 엔드포인트는 보통 `/mcp` 입니다.",
    },
    HTTP_UNAUTHORIZED: {
      phase: "connect",
      message: "MCP 엔드포인트가 인증을 요구합니다.",
      hint: "headers 옵션으로 토큰을 전달하세요. OAuth 자동 흐름은 아직 지원하지 않습니다.",
    },
    HTTP_RESPONSE_INVALID: {
      phase: "connect",
      message: "MCP 엔드포인트가 JSON 도 SSE 도 아닌 응답을 반환했습니다.",
      hint: "url 이 MCP 엔드포인트인지 확인하세요. 프록시나 로그인 페이지가 HTML 을 돌려주는 경우가 흔합니다.",
    },
    HTTP_HANDSHAKE_TIMEOUT: {
      phase: "handshake",
      message: "제한 시간 안에 MCP 초기화를 마치지 못했습니다.",
      hint: "서버가 Streamable HTTP MCP 인지와 connectTimeoutMs 를 확인하세요.",
    },
    HTTP_SESSION_LOST: {
      phase: "transport",
      message: "서버가 이 연결의 세션을 더 이상 알지 못합니다.",
      hint: "서버 재시작이나 세션 만료 여부를 확인하세요. 재연결은 지원하지 않으므로 다시 connect 하세요.",
    },
  });

export class McpClientError extends Error {
  override readonly name = "McpClientError";
  readonly code: McpClientErrorCode;
  readonly phase: McpClientErrorPhase;
  readonly hint: string;
  readonly diagnostics: McpDiagnostics;
  override readonly cause?: unknown;
  readonly #json: Readonly<Record<string, unknown>>;

  constructor(options: {
    code: McpClientErrorCode;
    phase: McpClientErrorPhase;
    diagnostics: McpDiagnosticsInput;
    cause?: unknown;
  }) {
    const detail = MCP_CLIENT_ERROR_DETAILS[options.code];
    super(detail.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = options.code;
    this.phase = options.phase;
    this.hint = detail.hint;
    const diagnostics: McpDiagnostics = Object.freeze(tagDiagnostics(options.diagnostics));
    this.diagnostics = diagnostics;
    this.cause = options.cause;
    const common = {
      name: this.name,
      code: this.code,
      phase: this.phase,
      message: this.message,
      hint: this.hint,
      transport: diagnostics.transport,
    };
    this.#json = Object.freeze(
      diagnostics.transport === "http"
        ? {
            ...common,
            url: diagnostics.url,
            status: diagnostics.status,
            statusText: diagnostics.statusText,
            sessionId: diagnostics.sessionId,
          }
        : {
            ...common,
            exitCode: diagnostics.exitCode,
            signal: diagnostics.signal,
            stderrTruncated: diagnostics.stderrTruncated,
          },
    );
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return this.#json;
  }
}
