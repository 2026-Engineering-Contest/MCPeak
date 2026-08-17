import { describe, expect, it } from "vitest";
import type { McpToolContext } from "../src/authoring-request.js";
import { prepareDiagnosisRequest, validateDiagnosisResult } from "../src/diagnosis-request.js";
import type { DiagnosisCause, DiagnosisFailure } from "../src/diagnosis-schema.js";
import { MAX_CAUSE_CHARS } from "../src/diagnosis-schema.js";

const TOOLS: readonly McpToolContext[] = [
  {
    name: "get_weather",
    inputSchema: { type: "object", properties: { city: { type: "string" } } },
  },
];

function failure(id: string): DiagnosisFailure {
  return {
    caseId: id,
    caseName: `케이스 ${id}`,
    tool: "get_weather",
    diagnostics: [{ code: "FIELD_MISSING", message: "'temp' 필드가 없습니다." }],
  };
}

function cause(overrides: Partial<DiagnosisCause> = {}): DiagnosisCause {
  return {
    caseId: "case-1",
    summary: "도시 존재 검사가 프로토타입 속성을 통과시킨다",
    location: "get_weather 핸들러",
    evidence: "city='toString' 입력에 isError:false",
    target: "server",
    ...overrides,
  };
}

function preview(options: { specApproved?: boolean; caseIds?: readonly string[] } = {}) {
  return prepareDiagnosisRequest({
    specApproved: options.specApproved ?? true,
    suite: { id: "suite-1", name: "weather" },
    failures: (options.caseIds ?? ["case-1"]).map((id) => failure(id)),
    tools: TOOLS,
    providerId: "codex",
    model: "gpt-5-codex",
  });
}

function diagnosis(causes: readonly DiagnosisCause[]) {
  return { status: "diagnosis", causes, shortfall: "" };
}

const discarded = (
  overrides: Partial<{
    unknownCase: number;
    specTarget: number;
    unsureCauses: number;
  }> = {},
) => ({ unknownCase: 0, specTarget: 0, unsureCauses: 0, ...overrides });

describe("validateDiagnosisResult", () => {
  it("스키마 모양이 아니면 schemaMismatch 다", () => {
    const target = preview();
    expect(
      validateDiagnosisResult({ status: "diagnosi", causes: [], shortfall: "" }, target),
    ).toEqual({ status: "schemaMismatch" });
    expect(
      validateDiagnosisResult({ status: "diagnosis", causes: {}, shortfall: "" }, target),
    ).toEqual({ status: "schemaMismatch" });
    const missingField = { caseId: "case-1", summary: "x", location: "y", target: "server" };
    expect(
      validateDiagnosisResult(
        { status: "diagnosis", causes: [missingField], shortfall: "" },
        target,
      ),
    ).toEqual({ status: "schemaMismatch" });
    expect(validateDiagnosisResult({ status: "diagnosis", causes: [] }, target)).toEqual({
      status: "schemaMismatch",
    });
    expect(validateDiagnosisResult(null, target)).toEqual({ status: "schemaMismatch" });
  });

  it("diagnosis 인데 유효 항목이 0개면 unsure 로 접힌다", () => {
    const validation = validateDiagnosisResult(diagnosis([]), preview());
    expect(validation).toEqual({
      status: "ok",
      result: { status: "unsure", shortfall: "", discarded: discarded() },
    });
  });

  it("unsure 인데 causes 가 있으면 causes 를 버린다", () => {
    const validation = validateDiagnosisResult(
      { status: "unsure", causes: [cause()], shortfall: "서버 로그가 없습니다." },
      preview(),
    );
    expect(validation).toEqual({
      status: "ok",
      result: {
        status: "unsure",
        shortfall: "서버 로그가 없습니다.",
        discarded: discarded({ unsureCauses: 1 }),
      },
    });
  });

  it("요청에 없는 caseId 항목이 unknownCase 로 집계된다", () => {
    const validation = validateDiagnosisResult(
      diagnosis([cause(), cause({ caseId: "지어낸-케이스" })]),
      preview(),
    );
    expect(validation).toEqual({
      status: "ok",
      result: {
        status: "diagnosis",
        causes: [cause()],
        discarded: discarded({ unknownCase: 1 }),
      },
    });
  });

  it('specApproved 가 true 면 target: "spec" 항목이 버려진다', () => {
    const validation = validateDiagnosisResult(
      diagnosis([cause({ target: "spec" })]),
      preview({ specApproved: true }),
    );
    expect(validation).toEqual({
      status: "ok",
      result: {
        status: "unsure",
        shortfall: "",
        discarded: discarded({ specTarget: 1 }),
      },
    });
  });

  it('specApproved 가 false 면 target: "spec" 항목이 통과한다', () => {
    const validation = validateDiagnosisResult(
      diagnosis([cause({ target: "spec" })]),
      preview({ specApproved: false }),
    );
    expect(validation).toEqual({
      status: "ok",
      result: {
        status: "diagnosis",
        causes: [cause({ target: "spec" })],
        discarded: discarded(),
      },
    });
  });

  it("여러 폐기 사유를 각각 세고 한 항목을 중복 집계하지 않는다", () => {
    const validation = validateDiagnosisResult(
      diagnosis([
        cause(),
        cause({ caseId: "지어낸-서버-케이스" }),
        cause({ caseId: "지어낸-명세-케이스", target: "spec" }),
        cause({ target: "spec" }),
      ]),
      preview({ specApproved: true }),
    );
    expect(validation).toEqual({
      status: "ok",
      result: {
        status: "diagnosis",
        causes: [cause()],
        discarded: discarded({ unknownCase: 2, specTarget: 1 }),
      },
    });
  });

  it("MAX_CAUSE_CHARS 를 넘는 문자열이 잘리고 문자 중간이 끊기지 않는다", () => {
    // 서로게이트 쌍(이모지)으로 경계를 만든다. 코드 유닛으로 자르면 반쪽이 남는다.
    const long = "🌦".repeat(MAX_CAUSE_CHARS + 10);
    const validation = validateDiagnosisResult(
      diagnosis([cause({ summary: long, location: long, evidence: long })]),
      preview(),
    );
    if (validation.status !== "ok" || validation.result.status !== "diagnosis")
      throw new Error("진단 결과가 아니다");
    const item = validation.result.causes[0] as DiagnosisCause;
    for (const text of [item.summary, item.location, item.evidence]) {
      expect([...text]).toHaveLength(MAX_CAUSE_CHARS);
      expect(text).not.toContain("�");
      expect([...text].every((char) => char === "🌦")).toBe(true);
    }
  });

  it("항목 순서가 요청의 failures 순서를 따른다", () => {
    const target = preview({ caseIds: ["case-1", "case-2", "case-3"] });
    const validation = validateDiagnosisResult(
      diagnosis([cause({ caseId: "case-3" }), cause({ caseId: "case-2" }), cause()]),
      target,
    );
    if (validation.status !== "ok" || validation.result.status !== "diagnosis")
      throw new Error("진단 결과가 아니다");
    expect(validation.result.causes.map((item) => item.caseId)).toEqual([
      "case-1",
      "case-2",
      "case-3",
    ]);
  });

  it("같은 caseId 항목이 여럿이면 응답 안 상대 순서가 유지된다", () => {
    const target = preview({ caseIds: ["case-1", "case-2"] });
    const validation = validateDiagnosisResult(
      diagnosis([
        cause({ caseId: "case-2", summary: "두 번째 케이스" }),
        cause({ caseId: "case-1", summary: "먼저 온 것" }),
        cause({ caseId: "case-1", summary: "나중에 온 것" }),
      ]),
      target,
    );
    if (validation.status !== "ok" || validation.result.status !== "diagnosis")
      throw new Error("진단 결과가 아니다");
    expect(validation.result.causes.map((item) => item.summary)).toEqual([
      "먼저 온 것",
      "나중에 온 것",
      "두 번째 케이스",
    ]);
  });
});
