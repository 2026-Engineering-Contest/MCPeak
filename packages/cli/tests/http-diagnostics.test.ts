import { describe, expect, it } from "vitest";
import {
  hasHttpDiagnosticContent,
  httpDiagnostics,
  renderHttpDiagnostics,
} from "../src/http-diagnostics.js";
import { processDiagnostics } from "../src/process-diagnostics.js";

/** core 의 `createHttpDiagnosticsSnapshot` 이 만드는 모양. */
const httpSnapshot = {
  transport: "http" as const,
  url: "https://mcp.example.com/v1",
  status: 503,
  statusText: "Service Unavailable",
  sessionId: "sess-1",
};

/** core 의 `createDiagnosticsSnapshot` 이 만드는 모양. */
const stdioSnapshot = {
  transport: "stdio" as const,
  stderr: "boom\n",
  stderrTruncated: false,
  exitCode: 1,
  signal: null,
};

describe("두 진단 가드가 서로를 배제한다", () => {
  /**
   * 이 두 케이스가 이 모듈이 존재하는 이유다. 한쪽 가드가 다른 transport 의 값을 통과시키면
   * 화면이 없는 프로세스의 종료 코드를 말하거나, 있는 HTTP 상태를 안 말한다.
   */
  it("httpDiagnostics 는 stdio 진단을 받지 않는다", () => {
    expect(httpDiagnostics(stdioSnapshot)).toBeUndefined();
  });
  it("processDiagnostics 는 HTTP 진단을 받지 않는다", () => {
    expect(processDiagnostics(httpSnapshot)).toBeUndefined();
  });
  it("httpDiagnostics 는 제 모양을 통과시킨다", () => {
    expect(httpDiagnostics(httpSnapshot)).toEqual(httpSnapshot);
  });
  it.each([
    ["url 이 없다", { status: 200, statusText: null, sessionId: null }],
    ["url 이 빈 문자열이다", { url: "", status: null, statusText: null, sessionId: null }],
    [
      "status 가 숫자도 null 도 아니다",
      { url: "u", status: "503", statusText: null, sessionId: null },
    ],
    [
      "statusText 가 문자열도 null 도 아니다",
      { url: "u", status: 1, statusText: 1, sessionId: null },
    ],
    ["sessionId 필드가 없다", { url: "u", status: null, statusText: null }],
  ])("%s 면 받지 않는다", (_name, value) => {
    expect(httpDiagnostics(value)).toBeUndefined();
  });
});

describe("hasHttpDiagnosticContent", () => {
  /**
   * core 는 상태 코드를 실패 경로에서만 채운다(`HttpConnectionState`). 성공한 실행은 끝까지
   * null 이므로, 이 판정이 없으면 초록불 뒤에 매번 빈 진단 블록이 붙는다.
   */
  it("상태 코드가 없으면 내용이 없다고 본다", () => {
    expect(hasHttpDiagnosticContent({ ...httpSnapshot, status: null, statusText: null })).toBe(
      false,
    );
  });
  it("상태 코드가 있으면 내용이 있다고 본다", () => {
    expect(hasHttpDiagnosticContent(httpSnapshot)).toBe(true);
  });
});

describe("renderHttpDiagnostics", () => {
  it("엔드포인트·상태·세션 ID 를 싣는다", () => {
    expect(renderHttpDiagnostics(httpSnapshot)).toBe(
      "원격 서버 진단\n" +
        "  엔드포인트: https://mcp.example.com/v1\n" +
        "  HTTP 상태: 503 Service Unavailable\n" +
        "  세션 ID: sess-1\n",
    );
  });

  /**
   * stdio 의 `종료 코드: 없음` 은 "아직 안 죽었다" 지만, HTTP 에서 상태 코드가 없는 것은
   * **응답에 닿지 못했다** 는 뜻이다. 같은 문구를 쓰면 읽는 사람이 200 을 받았다고 읽는다.
   */
  it("상태 코드가 없으면 '(없음)' 이 아니라 닿지 못했다고 말한다", () => {
    const block = renderHttpDiagnostics({ ...httpSnapshot, status: null, statusText: null });
    expect(block).toContain("HTTP 상태: 응답에 닿지 못했습니다");
    expect(block).not.toContain("(없음)");
  });

  it("세션을 발급하지 않는 서버는 stateless 라고 적는다", () => {
    expect(renderHttpDiagnostics({ ...httpSnapshot, sessionId: null })).toContain(
      "세션 ID: 발급하지 않음 (stateless)",
    );
  });

  it("statusText 가 없으면 상태 코드만 적는다", () => {
    expect(renderHttpDiagnostics({ ...httpSnapshot, status: 599, statusText: null })).toContain(
      "HTTP 상태: 599\n",
    );
  });

  /**
   * URL 은 사용자가 준 값이고 세션 ID 는 서버가 준 값이다. 둘 다 우리 문장에 그대로 섞이므로
   * 터미널 제어 문자가 지나가면 안 된다.
   */
  it("제어 문자를 이스케이프한다", () => {
    const block = renderHttpDiagnostics({
      ...httpSnapshot,
      url: "https://x/[2J",
      sessionId: "a\nb",
    });
    expect(block).toContain("\\u001b[2J");
    expect(block).toContain("a\\u000ab");
    expect(block.split("\n")).toHaveLength(5);
  });

  it("지나치게 긴 값을 자르고 생략한 길이를 알린다", () => {
    const block = renderHttpDiagnostics({ ...httpSnapshot, sessionId: "x".repeat(1200) });
    expect(block).toContain("…(200자 생략)");
  });
});
