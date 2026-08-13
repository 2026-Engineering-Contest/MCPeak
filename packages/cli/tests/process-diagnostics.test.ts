import { describe, expect, it } from "vitest";
import {
  isAbnormalExit,
  type ProcessDiagnosticsInput,
  renderProcessDiagnostics,
} from "../src/process-diagnostics.js";

/** 지정하지 않은 필드는 정상값으로 채운다. 각 테스트가 관심 있는 필드만 적게 한다. */
const input = (overrides: Partial<ProcessDiagnosticsInput> = {}): ProcessDiagnosticsInput => ({
  stderr: "",
  stderrTruncated: false,
  exitCode: 0,
  signal: null,
  ...overrides,
});

/** 본문(4칸 들여쓴 stderr 줄)만 뽑는다. 헤더 3줄과 끝의 빈 조각을 뺀다. */
const bodyLines = (rendered: string): readonly string[] => rendered.split("\n").slice(3, -1);

const manyLines = (count: number): string =>
  `${Array.from({ length: count }, (_, index) => `line${index + 1}`).join("\n")}\n`;

describe("isAbnormalExit", () => {
  it("signal 이 있으면 참이다", () => {
    expect(isAbnormalExit(input({ exitCode: null, signal: "SIGSEGV" }))).toBe(true);
  });

  it("우리가 보내는 종료 시그널은 비정상이 아니다", () => {
    // core 의 lifecycle 이 stdin EOF 뒤 유예를 두고 보내는 시그널이다. 멀쩡한 서버도 받는다.
    for (const signal of ["SIGTERM", "SIGKILL"])
      expect(isAbnormalExit(input({ exitCode: null, signal }))).toBe(false);
  });

  it("우리가 보내지 않는 시그널은 비정상이다", () => {
    for (const signal of ["SIGSEGV", "SIGABRT", "SIGBUS"])
      expect(isAbnormalExit(input({ exitCode: null, signal }))).toBe(true);
  });

  it("exitCode 가 0 이 아니면 참이다", () => {
    expect(isAbnormalExit(input({ exitCode: 1, signal: null }))).toBe(true);
  });

  it("exitCode 가 0 이면 거짓이다", () => {
    expect(isAbnormalExit(input({ exitCode: 0, signal: null }))).toBe(false);
  });

  it("아직 종료하지 않았으면 거짓이다", () => {
    expect(isAbnormalExit(input({ exitCode: null, signal: null }))).toBe(false);
  });
});

describe("renderProcessDiagnostics", () => {
  it("maxLines 가 0 이면 빈 문자열을 반환한다", () => {
    const rendered = renderProcessDiagnostics(
      input({ stderr: "boom\n", exitCode: 1, stderrTruncated: true }),
      { maxLines: 0 },
    );
    expect(rendered).toBe("");
  });

  it("종료 코드와 시그널을 한 줄에 적는다", () => {
    const rendered = renderProcessDiagnostics(input({ exitCode: 1, signal: null, stderr: "" }), {
      maxLines: 20,
    });
    expect(rendered).toBe(
      "서버 프로세스 진단\n  종료 코드: 1  시그널: 없음\n  stderr: (비어 있음)\n",
    );
  });

  it("null 종료 코드를 '없음'으로 적는다", () => {
    const rendered = renderProcessDiagnostics(input({ exitCode: null, signal: "SIGSEGV" }), {
      maxLines: 20,
    });
    expect(rendered.split("\n")[1]).toBe("  종료 코드: 없음  시그널: SIGSEGV");
  });

  it("stderr 가 비면 한 줄로 끝낸다", () => {
    const rendered = renderProcessDiagnostics(input({ exitCode: 1, stderr: "" }), {
      maxLines: 20,
    });
    expect(rendered).toBe(
      "서버 프로세스 진단\n  종료 코드: 1  시그널: 없음\n  stderr: (비어 있음)\n",
    );
    expect(rendered).not.toContain("마지막");
  });

  it("줄 수가 제한 이하면 전체로 표시한다", () => {
    const rendered = renderProcessDiagnostics(input({ stderr: manyLines(3), exitCode: 1 }), {
      maxLines: 20,
    });
    expect(rendered).toContain("  stderr (전체):\n");
    expect(bodyLines(rendered)).toEqual(["    line1", "    line2", "    line3"]);
  });

  it("제한을 넘으면 마지막 N줄만 남기고 버린 줄 수를 적는다", () => {
    const rendered = renderProcessDiagnostics(input({ stderr: manyLines(25), exitCode: 1 }), {
      maxLines: 20,
    });
    expect(rendered).toContain("  stderr (마지막 20줄, 위로 5줄 더 있음):\n");
    const body = bodyLines(rendered);
    expect(body).toHaveLength(20);
    expect(body[0]).toBe("    line6");
    expect(body[19]).toBe("    line25");
  });

  it("수집 상한 잘림을 헤더에 적는다", () => {
    const rendered = renderProcessDiagnostics(
      input({ stderr: manyLines(3), stderrTruncated: true, exitCode: 1 }),
      { maxLines: 20 },
    );
    expect(rendered).toContain("  stderr (수집된 전체, 앞부분이 수집 상한으로 잘렸습니다):\n");
  });

  it("두 잘림이 동시에 발생하면 둘 다 적는다", () => {
    const rendered = renderProcessDiagnostics(
      input({ stderr: manyLines(25), stderrTruncated: true, exitCode: 1 }),
      { maxLines: 20 },
    );
    expect(rendered).toContain(
      "  stderr (마지막 20줄, 위로 5줄 더 있음, 앞부분이 수집 상한으로 잘렸습니다):\n",
    );
  });

  it("끝의 개행으로 생기는 빈 줄을 만들지 않는다", () => {
    const rendered = renderProcessDiagnostics(input({ stderr: "a\nb\n", exitCode: 1 }), {
      maxLines: 20,
    });
    expect(bodyLines(rendered)).toEqual(["    a", "    b"]);
  });

  it("중간의 빈 줄은 유지한다", () => {
    const rendered = renderProcessDiagnostics(input({ stderr: "a\n\nb\n", exitCode: 1 }), {
      maxLines: 20,
    });
    expect(bodyLines(rendered)).toEqual(["    a", "    ", "    b"]);
  });

  it("CRLF 를 줄 구분으로 처리한다", () => {
    const rendered = renderProcessDiagnostics(input({ stderr: "a\r\nb\r\n", exitCode: 1 }), {
      maxLines: 20,
    });
    expect(bodyLines(rendered)).toEqual(["    a", "    b"]);
    expect(rendered).not.toContain("\r");
    expect(rendered).not.toContain("\\u000d");
  });

  it("ANSI escape 를 이스케이프한다", () => {
    const rendered = renderProcessDiagnostics(
      input({ stderr: "\u001b[31mred\u001b[0m", exitCode: 1 }),
      { maxLines: 20 },
    );
    expect(rendered).toContain("\\u001b");
    expect(rendered).not.toContain("\u001b");
  });

  it("C1 제어 문자를 이스케이프한다", () => {
    const rendered = renderProcessDiagnostics(input({ stderr: "\u009b1m", exitCode: 1 }), {
      maxLines: 20,
    });
    expect(rendered).toContain("\\u009b");
    expect(rendered).not.toContain("\u009b");
  });

  it("U+2028 과 U+2029 를 이스케이프한다", () => {
    const rendered = renderProcessDiagnostics(input({ stderr: "a\u2028b\u2029c", exitCode: 1 }), {
      maxLines: 20,
    });
    expect(rendered).toContain("\\u2028");
    expect(rendered).toContain("\\u2029");
    expect(rendered).not.toContain("\u2028");
    expect(rendered).not.toContain("\u2029");
  });

  it("개행은 이스케이프하지 않는다", () => {
    const rendered = renderProcessDiagnostics(input({ stderr: "a\nb", exitCode: 1 }), {
      maxLines: 20,
    });
    expect(rendered).not.toContain("\\u000a");
    expect(bodyLines(rendered)).toEqual(["    a", "    b"]);
  });

  it("긴 줄을 잘라 생략 표시를 붙인다", () => {
    const rendered = renderProcessDiagnostics(input({ stderr: `${"x".repeat(1200)}\n` }), {
      maxLines: 20,
    });
    const body = bodyLines(rendered);
    expect(body).toHaveLength(1);
    expect(body[0]).toBe(`    ${"x".repeat(1000)} …(200자 생략)`);
  });

  it("상한 이하의 줄은 그대로 둔다", () => {
    const rendered = renderProcessDiagnostics(input({ stderr: `${"x".repeat(1000)}\n` }), {
      maxLines: 20,
    });
    expect(bodyLines(rendered)[0]).toBe(`    ${"x".repeat(1000)}`);
    expect(rendered).not.toContain("생략");
  });

  it("항상 개행으로 끝난다", () => {
    const cases: readonly ProcessDiagnosticsInput[] = [
      input({ exitCode: 1 }),
      input({ stderr: "a\nb\n", exitCode: 1 }),
      input({ stderr: "a", exitCode: null, signal: "SIGSEGV" }),
      input({ stderr: manyLines(25), stderrTruncated: true, exitCode: 1 }),
    ];
    for (const diagnostics of cases) {
      const rendered = renderProcessDiagnostics(diagnostics, { maxLines: 20 });
      expect(rendered).not.toBe("");
      expect(rendered.endsWith("\n")).toBe(true);
    }
  });
});
