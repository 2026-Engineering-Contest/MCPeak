import { describe, expect, it } from "vitest";
import { classifyConnectionLoss } from "../src/connection-loss.js";

/**
 * core 의 `McpClientError` 모양만 흉내 낸다. 클래스를 import 하지 않는 것 자체가 이 판정이
 * `instanceof` 에 기대지 않는다는 증명이다. 러너가 받는 client 는 core 가 만든 것일 수도,
 * record 의 재생 client 나 목일 수도 있어 클래스 정체가 다르다.
 */
const coreError = (code: unknown, diagnostics?: unknown): unknown =>
  Object.assign(new Error("MCP error -32000: Connection closed"), {
    code,
    phase: "process",
    ...(diagnostics === undefined ? {} : { diagnostics }),
  });

const stdioDiagnostics = (exitCode: unknown, signal: unknown) => ({
  transport: "stdio",
  stderr: "치명적: 내부 상태가 깨졌습니다 (일부러 낸 오류)",
  stderrTruncated: false,
  exitCode,
  signal,
});

const httpDiagnostics = {
  transport: "http",
  url: "http://127.0.0.1:8080/mcp",
  status: 404,
  statusText: "Not Found",
  sessionId: "s-1",
};

describe("classifyConnectionLoss", () => {
  it("PROCESS_EXITED 를 종료 코드와 함께 옮긴다", () => {
    expect(classifyConnectionLoss(coreError("PROCESS_EXITED", stdioDiagnostics(42, null)))).toEqual(
      {
        cause: "processExited",
        exitCode: 42,
      },
    );
  });

  it("시그널로 죽었으면 exitCode 키를 만들지 않는다", () => {
    const loss = classifyConnectionLoss(
      coreError("PROCESS_EXITED", stdioDiagnostics(null, "SIGKILL")),
    );

    expect(loss).toEqual({ cause: "processExited", signal: "SIGKILL" });
    expect(Object.keys(loss ?? {})).not.toContain("exitCode");
  });

  it("종료 코드도 시그널도 관측 못 했으면 사유만 남는다", () => {
    const loss = classifyConnectionLoss(coreError("PROCESS_EXITED", stdioDiagnostics(null, null)));

    expect(Object.keys(loss ?? {})).toEqual(["cause"]);
  });

  it("TRANSPORT_FAILED 와 HTTP_SESSION_LOST 도 각 사유로 옮긴다", () => {
    expect(classifyConnectionLoss(coreError("TRANSPORT_FAILED"))).toEqual({
      cause: "transportFailed",
    });
    expect(classifyConnectionLoss(coreError("HTTP_SESSION_LOST", httpDiagnostics))).toEqual({
      cause: "httpSessionLost",
    });
  });

  it("http 진단에서는 종료 코드 자리를 만들지 않는다", () => {
    const loss = classifyConnectionLoss(coreError("HTTP_SESSION_LOST", httpDiagnostics));

    expect(Object.keys(loss ?? {})).toEqual(["cause"]);
  });

  it("transport 태그가 없는 진단은 stdio 로 본다", () => {
    // core 의 tagDiagnostics 와 같은 판단이다. 다른 패키지의 test double 이 진단을
    // McpProcessDiagnostics 로 선언해 태그를 지우고 넘기는 경우가 있다.
    const loss = classifyConnectionLoss(
      coreError("PROCESS_EXITED", {
        stderr: "",
        stderrTruncated: false,
        exitCode: 7,
        signal: null,
      }),
    );

    expect(loss).toEqual({ cause: "processExited", exitCode: 7 });
  });

  it("서버가 살아 있는 실패 코드는 판정하지 않는다", () => {
    expect(classifyConnectionLoss(coreError("OPERATION_FAILED"))).toBeUndefined();
    expect(classifyConnectionLoss(coreError("INVALID_TOOL_ARGUMENTS"))).toBeUndefined();
    expect(classifyConnectionLoss(coreError("PAGINATION_CURSOR_REPEATED"))).toBeUndefined();
  });

  it("Object.prototype 의 이름은 사유가 아니다", () => {
    // 코드 문자열은 우리가 만든 값이 아니다. 사유 표를 프로토타입 있는 객체로 두면
    // 'toString' 같은 코드가 함수를 사유로 물고 들어온다.
    expect(classifyConnectionLoss(coreError("toString"))).toBeUndefined();
    expect(classifyConnectionLoss(coreError("constructor"))).toBeUndefined();
    expect(classifyConnectionLoss(coreError("__proto__"))).toBeUndefined();
  });

  it("코드가 문자열이 아니면 판정하지 않는다", () => {
    expect(classifyConnectionLoss(coreError(42))).toBeUndefined();
    expect(classifyConnectionLoss(new Error("nope"))).toBeUndefined();
  });

  it("오류 모양이 아닌 값은 판정하지 않는다", () => {
    expect(classifyConnectionLoss(null)).toBeUndefined();
    expect(classifyConnectionLoss(undefined)).toBeUndefined();
    expect(classifyConnectionLoss("PROCESS_EXITED")).toBeUndefined();
  });

  it("진단 값의 타입이 어긋나면 그 필드만 버린다", () => {
    // 보고서를 다시 읽어 온 경로에서는 어떤 값이든 올 수 있다. 사유까지 버리면
    // 멈춰야 할 실행이 계속된다.
    const loss = classifyConnectionLoss(coreError("PROCESS_EXITED", stdioDiagnostics("42", 9)));

    expect(loss).toEqual({ cause: "processExited" });
  });

  it("정수가 아닌 종료 코드와 빈 시그널은 싣지 않는다", () => {
    expect(classifyConnectionLoss(coreError("PROCESS_EXITED", stdioDiagnostics(1.5, "")))).toEqual({
      cause: "processExited",
    });
  });

  it("진단이 아예 없어도 사유는 남는다", () => {
    expect(classifyConnectionLoss(coreError("PROCESS_EXITED"))).toEqual({
      cause: "processExited",
    });
  });
});
