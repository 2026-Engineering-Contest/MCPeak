import { STATUS_CODES } from "node:http";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OperationFailureKind } from "./client.js";
import { createHttpDiagnosticsSnapshot, type McpHttpDiagnostics } from "./diagnostics.js";
import { MCP_CLIENT_ERROR_DETAILS, McpClientError, type McpClientErrorCode } from "./errors.js";
import type { ResolvedHttpConnectOptions } from "./options.js";

/**
 * 결정론성 정책(설계 §6). SDK 기본값(2회 재시도, 1000ms에서 1.5배씩 증가)을 그대로 두면
 * 같은 서버 중단이 실행마다 다른 시각·다른 오류로 관측된다. 끊긴 연결을 조용히 되살리는 것보다
 * 끊겼다고 즉시 말하는 쪽이 테스트 도구에 옳다.
 * 나머지 세 값도 고정하는 이유는 StreamableHTTPReconnectionOptions가 네 필드 모두 필수라서다.
 */
const RECONNECTION_OPTIONS = {
  maxRetries: 0,
  initialReconnectionDelay: 1_000,
  maxReconnectionDelay: 1_000,
  reconnectionDelayGrowFactor: 1,
} as const;

/** 서버 응답 본문이 아니라 상태 코드로만 정하는 고정 표. 결정론적이고 비밀값이 섞이지 않는다. */
function statusTextOf(status: number | null): string | null {
  if (status === null) return null;
  return STATUS_CODES[status] ?? null;
}

function isRequestTimeout(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause.code === -32001 || cause.code === "RequestTimeout")
  );
}

/** SDK 오류를 우리 코드로 옮긴다. 설계 §8.3 의 6단계이며 위에서 걸리면 아래는 보지 않는다. */
export function mapConnectFailure(cause: unknown): {
  code: McpClientErrorCode;
  status: number | null;
} {
  if (cause instanceof UnauthorizedError) return { code: "HTTP_UNAUTHORIZED", status: 401 };
  if (cause instanceof StreamableHTTPError) {
    // -1 은 응답 Content-Type 이 JSON 도 SSE 도 아닐 때만 SDK 가 쓰는 값이다. HTTP 상태가 아니다.
    if (cause.code === -1) return { code: "HTTP_RESPONSE_INVALID", status: null };
    if (cause.code === 401 || cause.code === 403) {
      return { code: "HTTP_UNAUTHORIZED", status: cause.code };
    }
    return { code: "HTTP_STATUS_ERROR", status: cause.code ?? null };
  }
  if (isRequestTimeout(cause)) return { code: "HTTP_HANDSHAKE_TIMEOUT", status: null };
  // fetch 의 TypeError(ECONNREFUSED · DNS 실패 · TLS 실패)가 여기로 온다.
  return { code: "HTTP_CONNECT_FAILED", status: null };
}

/**
 * HTTP 연결 하나의 상태를 들고 있다. 프로세스 수명주기 코드를 한 줄도 재사용하지 않는다.
 * 죽일 프로세스가 없으므로 `forceClose` 도 두지 않는다(설계 §9).
 */
export class HttpConnectionState {
  readonly #url: string;
  readonly #transport: StreamableHTTPClientTransport;
  #status: number | null = null;
  #closed = false;

  constructor(options: ResolvedHttpConnectOptions) {
    this.#url = options.url;
    this.#transport = new StreamableHTTPClientTransport(new URL(options.url), {
      // 헤더는 여기까지만 간다. 진단에도 오류 메시지에도 싣지 않는다(설계 §11).
      requestInit: { headers: { ...options.headers } },
      reconnectionOptions: { ...RECONNECTION_OPTIONS },
    });
  }

  get transport(): StreamableHTTPClientTransport {
    return this.#transport;
  }

  /** 서버가 세션을 발급하지 않는 stateless 서버면 null 이다. */
  get sessionId(): string | null {
    return this.#transport.sessionId ?? null;
  }

  getDiagnostics(): { readonly transport: "http" } & McpHttpDiagnostics {
    return createHttpDiagnosticsSnapshot(
      this.#url,
      this.#status,
      statusTextOf(this.#status),
      this.sessionId,
    );
  }

  /** 연결 · handshake 실패를 우리 오류로 옮긴다. 서버 응답 본문은 cause 에만 남는다. */
  toConnectError(cause: unknown): McpClientError {
    if (cause instanceof McpClientError) return cause;
    const { code, status } = mapConnectFailure(cause);
    this.#status = status;
    return new McpClientError({
      code,
      phase: MCP_CLIENT_ERROR_DETAILS[code].phase,
      diagnostics: this.getDiagnostics(),
      cause,
    });
  }

  /** 404 여도 세션 ID 를 받은 적이 없으면 세션 상실이 아니라 잘못된 경로다(설계 §8.3). */
  operationFailureKind(cause: unknown): OperationFailureKind {
    if (cause instanceof StreamableHTTPError && cause.code !== undefined && cause.code >= 0) {
      this.#status = cause.code;
    }
    if (cause instanceof StreamableHTTPError && cause.code === 404 && this.sessionId !== null) {
      return "httpSession";
    }
    return undefined;
  }

  /** 설계 §9 의 종료 정책. 멱등이며 세션 종료 실패는 삼킨다. */
  async close(closeSdk: () => Promise<void>): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#transport.sessionId !== undefined) {
      try {
        await this.#transport.terminateSession();
      } catch {
        // 서버가 405 를 돌려주는 것은 스펙상 허용된 동작이다. 종료를 실패로 만들 이유가 없다.
      }
    }
    try {
      await closeSdk();
    } catch (cause) {
      throw new McpClientError({
        code: "CLOSE_FAILED",
        phase: "close",
        diagnostics: this.getDiagnostics(),
        cause,
      });
    }
  }

  /** 연결 실패 뒤 정리. 여기서 난 오류가 원래 실패 원인을 덮으면 안 된다. */
  async abort(): Promise<void> {
    this.#closed = true;
    try {
      await this.#transport.close();
    } catch {
      // 연결도 못 한 transport 를 닫다 난 오류는 사용자에게 알릴 것이 없다.
    }
  }
}
