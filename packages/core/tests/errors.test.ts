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
      exitCode: 9,
      signal: "SIGTERM",
      stderrTruncated: true,
    });
    expect(JSON.stringify(error)).not.toContain("secret");
  });
});
