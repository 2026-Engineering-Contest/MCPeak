import { describe, expect, it } from "vitest";
import {
  DIAGNOSIS_PROVIDER_SCHEMA,
  type DiagnosisRequestPreview,
  dispatchDiagnosisRequest,
  MAX_CAUSE_CHARS,
  type McpToolContext,
  prepareDiagnosisRequest,
  type ServerDiagnosisProvider,
} from "../src/index.js";

const TOOLS: readonly McpToolContext[] = [
  {
    name: "get_weather",
    inputSchema: { type: "object", properties: { city: { type: "string" } } },
  },
];

function preview(): DiagnosisRequestPreview {
  return prepareDiagnosisRequest({
    specApproved: true,
    suite: { id: "suite-1", name: "weather" },
    failures: [
      {
        caseId: "case-1",
        caseName: "케이스 1",
        tool: "get_weather",
        diagnostics: [{ code: "FIELD_MISSING", message: "'temp' 필드가 없습니다." }],
      },
    ],
    tools: TOOLS,
    providerId: "codex",
    model: "m",
  });
}

const PAYLOAD = {
  status: "diagnosis",
  causes: [
    {
      caseId: "case-1",
      summary: "도시 존재 검사가 프로토타입 속성을 통과시킨다",
      location: "get_weather 핸들러",
      evidence: "city='toString' 입력에 isError:false",
      target: "server",
    },
  ],
  shortfall: "",
};

function provider(
  value: unknown,
  overrides: Partial<Pick<ServerDiagnosisProvider, "id" | "model">> = {},
) {
  const calls: unknown[] = [];
  const instance: ServerDiagnosisProvider = {
    id: overrides.id ?? "codex",
    model: overrides.model ?? "m",
    async diagnose(request, options) {
      calls.push({ request, options });
      if (value instanceof Error) throw value;
      return value;
    },
  };
  return { calls, provider: instance };
}

function failing(error: unknown) {
  const calls: unknown[] = [];
  const instance: ServerDiagnosisProvider = {
    id: "codex",
    model: "m",
    async diagnose(request, options) {
      calls.push({ request, options });
      throw error;
    },
  };
  return { calls, provider: instance };
}

describe("dispatchDiagnosisRequest", () => {
  it("approved 가 거짓이면 provider 를 안 부르고 notApproved 다", async () => {
    const target = preview();
    const p = provider(PAYLOAD);
    const result = await dispatchDiagnosisRequest({
      provider: p.provider,
      preview: target,
      approval: { approved: false, fingerprint: target.fingerprint },
    });
    expect(result).toEqual({ status: "notApproved" });
    expect(p.calls).toHaveLength(0);
  });

  it("지문이 다르면 approvalInvalidated 다", async () => {
    const target = preview();
    const p = provider(PAYLOAD);
    const result = await dispatchDiagnosisRequest({
      provider: p.provider,
      preview: target,
      approval: { approved: true, fingerprint: "다른-지문" },
    });
    expect(result).toEqual({ status: "approvalInvalidated" });
    expect(p.calls).toHaveLength(0);
  });

  it("provider model 이 preview 와 다르면 approvalInvalidated 다", async () => {
    const target = preview();
    const p = provider(PAYLOAD, { model: "다른-모델" });
    const result = await dispatchDiagnosisRequest({
      provider: p.provider,
      preview: target,
      approval: { approved: true, fingerprint: target.fingerprint },
    });
    expect(result).toEqual({ status: "approvalInvalidated" });
    expect(p.calls).toHaveLength(0);
  });

  it("provider 가 던지면 providerFailed 이고 failure 에 raw 문자열이 없다", async () => {
    const target = preview();
    const error = Object.assign(new Error("provider 요청을 완료하지 못했습니다."), {
      code: "nonZeroExit",
      exitCode: 1,
      reason: "unknownModel",
      stderr: { captured: true, truncated: false },
      stdout: "UNTRUSTED_MARKER 원시 출력",
    });
    const p = failing(error);
    const result = await dispatchDiagnosisRequest({
      provider: p.provider,
      preview: target,
      approval: { approved: true, fingerprint: target.fingerprint },
    });
    expect(result).toMatchObject({
      status: "providerFailed",
      failure: {
        providerId: "codex",
        code: "nonZeroExit",
        exitCode: 1,
        reason: "unknownModel",
        stderr: { captured: true, truncated: false },
      },
    });
    expect(JSON.stringify(result)).not.toContain("UNTRUSTED_MARKER");
    expect(JSON.stringify(result)).not.toContain("stdout");
  });

  it("응답이 스키마에 안 맞으면 invalid 다", async () => {
    const target = preview();
    const p = provider({ status: "diagnosi", causes: [], shortfall: "" });
    const result = await dispatchDiagnosisRequest({
      provider: p.provider,
      preview: target,
      approval: { approved: true, fingerprint: target.fingerprint },
    });
    expect(result).toEqual({ status: "invalid" });
    expect(p.calls).toHaveLength(1);
  });

  it("정상 응답이 diagnosis 로 나온다", async () => {
    const target = preview();
    const p = provider(PAYLOAD);
    const result = await dispatchDiagnosisRequest({
      provider: p.provider,
      preview: target,
      approval: { approved: true, fingerprint: target.fingerprint },
    });
    expect(result).toEqual({
      status: "diagnosis",
      result: {
        status: "diagnosis",
        causes: PAYLOAD.causes,
        discarded: { unknownCase: 0, specTarget: 0, unsureCauses: 0 },
      },
    });
    // 나가는 것은 preview 가 아니라 준비 시점에 잠근 요청이다.
    expect((p.calls[0] as { request: unknown }).request).toEqual(target.request);
    expect((p.calls[0] as { options: { timeoutMs: number } }).options.timeoutMs).toBe(
      target.providerTimeoutMs,
    );
  });

  it("응답이 maxResultBytes 를 넘으면 resultLimitExceeded 다", async () => {
    const target = prepareDiagnosisRequest({
      specApproved: true,
      suite: { id: "suite-1", name: "weather" },
      failures: [
        {
          caseId: "case-1",
          caseName: "케이스 1",
          diagnostics: [{ code: "FIELD_MISSING", message: "'temp' 필드가 없습니다." }],
        },
      ],
      tools: TOOLS,
      providerId: "codex",
      model: "m",
      // 호출자가 정한 상한이 실제로 강제되는지 본다. 저장만 하고 안 쓰면 옵션이 거짓말이 된다.
      maxResultBytes: 16,
    });
    const p = provider(PAYLOAD);
    const result = await dispatchDiagnosisRequest({
      provider: p.provider,
      preview: target,
      approval: { approved: true, fingerprint: target.fingerprint },
    });
    expect(result).toEqual({ status: "resultLimitExceeded" });
    expect(p.calls).toHaveLength(1);
  });

  it("응답이 maxResultBytes 안이면 diagnosis 로 나온다", async () => {
    const target = preview();
    const p = provider(PAYLOAD);
    const result = await dispatchDiagnosisRequest({
      provider: p.provider,
      preview: target,
      approval: { approved: true, fingerprint: target.fingerprint },
    });
    expect(result.status).toBe("diagnosis");
  });

  it("index 가 진단 통로의 계약을 전부 내보낸다", () => {
    expect(typeof MAX_CAUSE_CHARS).toBe("number");
    expect(Object.keys(DIAGNOSIS_PROVIDER_SCHEMA)).toContain("properties");
  });
});
