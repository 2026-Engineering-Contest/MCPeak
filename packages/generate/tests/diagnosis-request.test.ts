import { createHash } from "node:crypto";
import { canonicalJson, DEFAULT_SENSITIVE_KEYS, REDACTED } from "@ohmymcp-hsu/runner";
import { describe, expect, it } from "vitest";
import type { McpToolContext } from "../src/authoring-request.js";
import {
  DEFAULT_MAX_REPAIR_CASES,
  MAX_REPAIR_STDERR_BYTES,
  prepareDiagnosisRequest,
} from "../src/diagnosis-request.js";
import type { DiagnosisFailure } from "../src/diagnosis-schema.js";

const TOOLS: readonly McpToolContext[] = [
  {
    name: "get_weather",
    inputSchema: { type: "object", properties: { city: { type: "string" } } },
  },
];

function failure(index: number, extra: Partial<DiagnosisFailure> = {}): DiagnosisFailure {
  return {
    caseId: `case-${index}`,
    caseName: `케이스 ${index}`,
    tool: "get_weather",
    input: { city: "서울" },
    diagnostics: [{ code: "FIELD_MISSING", message: "'temp' 필드가 없습니다." }],
    ...extra,
  };
}

function prepare(options: Partial<Parameters<typeof prepareDiagnosisRequest>[0]> = {}) {
  return prepareDiagnosisRequest({
    specApproved: true,
    suite: { id: "suite-1", name: "weather" },
    failures: [failure(1)],
    tools: TOOLS,
    providerId: "codex",
    model: "gpt-5-codex",
    ...options,
  });
}

describe("prepareDiagnosisRequest", () => {
  it("같은 입력으로 두 번 조립한 요청의 직렬화가 동일하다", () => {
    const first = prepare({
      processDiagnostics: {
        stderr: "boom\n",
        stderrTruncated: false,
        exitCode: 1,
        signal: null,
      },
    });
    const second = prepare({
      processDiagnostics: {
        stderr: "boom\n",
        stderrTruncated: false,
        exitCode: 1,
        signal: null,
      },
    });
    expect(JSON.stringify(first.request)).toBe(JSON.stringify(second.request));
    expect(first.fingerprint).toBe(second.fingerprint);
  });

  it("실패가 maxCases 를 넘으면 앞에서부터 남고 omitted.failures 에 뺀 수가 담긴다", () => {
    const failures = [1, 2, 3, 4, 5].map((index) => failure(index));
    const preview = prepare({ failures, maxCases: 2 });
    expect(preview.request.failures.map((item) => item.caseId)).toEqual(["case-1", "case-2"]);
    expect(preview.omitted.failures).toBe(3);
  });

  it("maxCases 기본값은 DEFAULT_MAX_REPAIR_CASES 다", () => {
    const failures = Array.from({ length: DEFAULT_MAX_REPAIR_CASES + 3 }, (_, index) =>
      failure(index),
    );
    const preview = prepare({ failures });
    expect(preview.request.failures).toHaveLength(DEFAULT_MAX_REPAIR_CASES);
    expect(preview.omitted.failures).toBe(3);
  });

  it("stderr 가 상한을 넘으면 뒤에서부터 남는다", () => {
    const stderr = `${"a".repeat(MAX_REPAIR_STDERR_BYTES)}TAIL`;
    const preview = prepare({
      processDiagnostics: { stderr, stderrTruncated: false, exitCode: 1, signal: null },
    });
    const sent = preview.request.processDiagnostics;
    expect(sent).toBeDefined();
    expect(stderr.endsWith(sent?.stderr ?? "")).toBe(true);
    expect(sent?.stderr.endsWith("TAIL")).toBe(true);
    expect(Buffer.byteLength(sent?.stderr ?? "", "utf8")).toBeLessThanOrEqual(
      MAX_REPAIR_STDERR_BYTES,
    );
    expect(sent?.stderrTruncated).toBe(true);
    expect(preview.omitted.stderrBytes).toBe(4);
  });

  it("stderr 절단이 UTF-8 문자 중간을 끊지 않는다", () => {
    // 한글 한 글자는 UTF-8 로 3바이트다. 상한이 문자 경계와 어긋나도록 앞을 1바이트 채운다.
    const stderr = `a${"가".repeat(MAX_REPAIR_STDERR_BYTES)}`;
    const preview = prepare({
      processDiagnostics: { stderr, stderrTruncated: false, exitCode: 1, signal: null },
    });
    const sent = preview.request.processDiagnostics?.stderr ?? "";
    expect(sent).not.toContain("�");
    expect([...sent].every((char) => char === "가")).toBe(true);
    expect(stderr.endsWith(sent)).toBe(true);
    expect(Buffer.byteLength(sent, "utf8")).toBeLessThanOrEqual(MAX_REPAIR_STDERR_BYTES);
  });

  it("includeStderr 가 false 면 processDiagnostics 키가 없다", () => {
    const preview = prepare({
      includeStderr: false,
      processDiagnostics: { stderr: "boom", stderrTruncated: false, exitCode: 1, signal: null },
    });
    expect("processDiagnostics" in preview.request).toBe(false);
  });

  it("민감 키가 든 input 이 치환돼 나간다", () => {
    const key = [...DEFAULT_SENSITIVE_KEYS][0] as string;
    const preview = prepare({
      failures: [failure(1, { input: { city: "서울", [key]: "s3cret" } })],
    });
    const input = preview.request.failures[0]?.input as Record<string, unknown>;
    expect(input[key]).toBe(REDACTED);
    expect(input.city).toBe("서울");
  });

  it("stderr 는 치환되지 않는다", () => {
    const preview = prepare({
      redaction: { sensitiveValues: ["s3cret"] },
      failures: [failure(1, { input: { token: "s3cret" } })],
      processDiagnostics: {
        stderr: "Authorization: s3cret",
        stderrTruncated: false,
        exitCode: 1,
        signal: null,
      },
    });
    expect(preview.request.processDiagnostics?.stderr).toBe("Authorization: s3cret");
  });

  it("요청 전체가 MAX_REQUEST_BYTES 를 넘으면 던진다", () => {
    const huge = failure(1, {
      diagnostics: [{ code: "BIG", message: "x".repeat(300_000) }],
    });
    expect(() => prepare({ failures: [huge] })).toThrow(RangeError);
  });

  it("specApproved 값이 request 에 그대로 실린다", () => {
    expect(prepare({ specApproved: true }).request.specApproved).toBe(true);
    expect(prepare({ specApproved: false }).request.specApproved).toBe(false);
  });

  it("fingerprint 가 sha256(canonicalJson(request)) 와 같다", () => {
    const preview = prepare();
    const expected = createHash("sha256").update(canonicalJson(preview.request)).digest("hex");
    expect(preview.fingerprint).toBe(expected);
  });
});
