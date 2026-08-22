import { describe, expect, it } from "vitest";
import {
  MCP_CLIENT_ERROR_DETAILS,
  McpClientError,
  type McpClientErrorCode,
} from "../src/errors.js";

const diagnostics = Object.freeze({
  stderr: "stderr-secret",
  stderrTruncated: true,
  exitCode: 9,
  signal: "SIGTERM" as NodeJS.Signals,
});

const httpDiagnostics = Object.freeze({
  transport: "http" as const,
  url: "http://127.0.0.1/mcp?token=query-secret",
  status: 401,
  statusText: "Unauthorized",
  sessionId: null,
});

const HTTP_CODES = [
  "HTTP_CONNECT_FAILED",
  "HTTP_STATUS_ERROR",
  "HTTP_UNAUTHORIZED",
  "HTTP_RESPONSE_INVALID",
  "HTTP_HANDSHAKE_TIMEOUT",
  "HTTP_SESSION_LOST",
] as const satisfies readonly McpClientErrorCode[];

describe("McpClientError", () => {
  it("오류 code별 message, hint와 phase가 고정된다", () => {
    for (const [code, detail] of Object.entries(MCP_CLIENT_ERROR_DETAILS) as [
      McpClientErrorCode,
      (typeof MCP_CLIENT_ERROR_DETAILS)[McpClientErrorCode],
    ][]) {
      const error = new McpClientError({ code, phase: detail.phase, diagnostics });
      expect(error.message).toBe(detail.message);
      expect(error.hint).toBe(detail.hint);
      expect(error.phase).toBe(detail.phase);
      expect(error.message.length).toBeGreaterThan(0);
      expect(error.hint.length).toBeGreaterThan(0);
    }
  });

  it("오류 message와 JSON은 비밀값을 제외한다", () => {
    const secret = "command-secret args-secret env-secret cwd-secret stderr-secret cause-secret";
    const error = new McpClientError({
      code: "TRANSPORT_FAILED",
      phase: "transport",
      diagnostics,
      cause: new Error(secret),
    });
    expect(error.phase).toBe("transport");
    expect(error.message).not.toContain("stderr-secret");
    expect(error.hint).not.toContain("stderr-secret");
    const json = error.toJSON();
    expect(Object.isFrozen(json)).toBe(true);
    expect(json).toEqual({
      name: "McpClientError",
      code: "TRANSPORT_FAILED",
      phase: "transport",
      message: error.message,
      hint: error.hint,
      transport: "stdio",
      exitCode: 9,
      signal: "SIGTERM",
      stderrTruncated: true,
    });
    expect(JSON.stringify(error)).not.toContain("secret");
  });

  it("PROCESS_EXITED hint는 stderr가 있으면 그 오류를 수정하도록 안내한다", () => {
    const error = new McpClientError({ code: "PROCESS_EXITED", phase: "process", diagnostics });

    expect(error.hint).toBe("서버 stderr에 나온 오류를 수정한 뒤 다시 실행하세요.");
    expect(error.hint).not.toContain("exit code, signal, bounded stderr를 확인하세요.");
  });

  it("PROCESS_EXITED hint는 stderr가 비면 종료 코드를 안내한다", () => {
    const error = new McpClientError({
      code: "PROCESS_EXITED",
      phase: "process",
      diagnostics: { ...diagnostics, stderr: "", exitCode: 9, signal: null },
    });

    expect(error.hint).toBe(
      "서버 stderr가 비어 있습니다. 종료 코드 9의 원인을 확인한 뒤 다시 실행하세요.",
    );
  });

  it("PROCESS_EXITED hint는 stderr와 종료 코드가 없으면 시그널을 안내한다", () => {
    const error = new McpClientError({
      code: "PROCESS_EXITED",
      phase: "process",
      diagnostics: { ...diagnostics, stderr: "", exitCode: null, signal: "SIGTERM" },
    });

    expect(error.hint).toBe(
      "서버 stderr가 비어 있습니다. 시그널 SIGTERM의 원인을 확인한 뒤 다시 실행하세요.",
    );
  });

  it("PROCESS_EXITED hint는 종료 정보를 알 수 없으면 일반 원인 확인을 안내한다", () => {
    const error = new McpClientError({
      code: "PROCESS_EXITED",
      phase: "process",
      diagnostics: { ...diagnostics, stderr: "", exitCode: null, signal: null },
    });

    expect(error.hint).toBe(
      "서버 stderr가 비어 있습니다. 서버 종료 원인을 확인한 뒤 다시 실행하세요.",
    );
  });
});

describe("HTTP 오류 code", () => {
  it("신규 6종의 phase와 hint가 설계와 일치한다", () => {
    const expected: Record<(typeof HTTP_CODES)[number], { phase: string; hint: string }> = {
      HTTP_CONNECT_FAILED: {
        phase: "connect",
        hint: "서버가 떠 있는지, url 의 host 와 port 가 맞는지 확인하세요.",
      },
      HTTP_STATUS_ERROR: {
        phase: "connect",
        hint: "status 와 경로를 확인하세요. Streamable HTTP 엔드포인트는 보통 `/mcp` 입니다.",
      },
      HTTP_UNAUTHORIZED: {
        phase: "connect",
        hint: "headers 옵션으로 토큰을 전달하세요. OAuth 자동 흐름은 아직 지원하지 않습니다.",
      },
      HTTP_RESPONSE_INVALID: {
        phase: "connect",
        hint: "url 이 MCP 엔드포인트인지 확인하세요. 프록시나 로그인 페이지가 HTML 을 돌려주는 경우가 흔합니다.",
      },
      HTTP_HANDSHAKE_TIMEOUT: {
        phase: "handshake",
        hint: "서버가 Streamable HTTP MCP 인지와 connectTimeoutMs 를 확인하세요.",
      },
      HTTP_SESSION_LOST: {
        phase: "transport",
        hint: "서버 재시작이나 세션 만료 여부를 확인하세요. 재연결은 지원하지 않으므로 다시 connect 하세요.",
      },
    };
    for (const code of HTTP_CODES) {
      const detail = MCP_CLIENT_ERROR_DETAILS[code];
      expect(detail.phase).toBe(expected[code].phase);
      expect(detail.hint).toBe(expected[code].hint);
    }
  });

  it("신규 6종의 message는 stdio 어휘를 쓰지 않는다", () => {
    for (const code of HTTP_CODES) {
      const message = MCP_CLIENT_ERROR_DETAILS[code].message;
      for (const forbidden of ["stdio", "stdout", "process", "exit"]) {
        expect(message).not.toContain(forbidden);
      }
    }
  });

  it("HTTP 진단 오류의 JSON은 URL과 상태를 담고 process field를 담지 않는다", () => {
    const error = new McpClientError({
      code: "HTTP_UNAUTHORIZED",
      phase: "connect",
      diagnostics: httpDiagnostics,
      cause: new Error("header-secret"),
    });
    const json = error.toJSON();
    expect(Object.keys(json)).toEqual([
      "name",
      "code",
      "phase",
      "message",
      "hint",
      "transport",
      "url",
      "status",
      "statusText",
      "sessionId",
    ]);
    expect(json).toEqual({
      name: "McpClientError",
      code: "HTTP_UNAUTHORIZED",
      phase: "connect",
      message: error.message,
      hint: error.hint,
      transport: "http",
      url: "http://127.0.0.1/mcp?token=query-secret",
      status: 401,
      statusText: "Unauthorized",
      sessionId: null,
    });
  });

  it("stdio 진단 오류의 JSON key 집합은 transport만 늘어난다", () => {
    const error = new McpClientError({
      code: "HANDSHAKE_TIMEOUT",
      phase: "handshake",
      diagnostics,
    });
    expect(error.diagnostics).toEqual({ transport: "stdio", ...diagnostics });
    expect(Object.keys(error.toJSON())).toEqual([
      "name",
      "code",
      "phase",
      "message",
      "hint",
      "transport",
      "exitCode",
      "signal",
      "stderrTruncated",
    ]);
  });

  it("HTTP 오류의 JSON에 header 값이 실리지 않는다", () => {
    const error = new McpClientError({
      code: "HTTP_STATUS_ERROR",
      phase: "connect",
      diagnostics: httpDiagnostics,
      cause: new Error("Bearer header-secret"),
    });
    expect(JSON.stringify(error.toJSON())).not.toContain("header-secret");
  });

  it("같은 HTTP 실패를 두 번 만들면 JSON이 byte 단위로 같다", () => {
    const create = () =>
      new McpClientError({
        code: "HTTP_CONNECT_FAILED",
        phase: "connect",
        diagnostics: { ...httpDiagnostics, status: null, statusText: null },
      });
    expect(JSON.stringify(create().toJSON())).toBe(JSON.stringify(create().toJSON()));
  });
});
