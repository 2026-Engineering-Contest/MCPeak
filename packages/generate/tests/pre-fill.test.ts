import type { ToolDef } from "@ohmymcp/core";
import type { TestSuiteSpec } from "@ohmymcp/runner";
import { describe, expect, it, vi } from "vitest";
import { createBaselineSuite } from "../src/baseline.js";
import type { PreFillProvider } from "../src/pre-fill.js";
import {
  dispatchPreFillRequest,
  preparePreFillRequest,
  previewPreFillRequest,
  validatePreFillResult,
} from "../src/pre-fill.js";
import { analyzeToolProvenance } from "../src/provenance.js";

/**
 * 근거 없는 값을 가진 툴. `timezone` 은 제약 키워드가 없어 placeholder 이고,
 * `unit` 은 enum 이 있어 declared 다. 실측의 `mcp-server-time` 이 이 모양이었다.
 */
const needsHelp: ToolDef = {
  name: "needs-help",
  description: "시각을 돌려준다",
  inputSchema: {
    type: "object",
    required: ["timezone", "unit", "count"],
    properties: {
      timezone: { type: "string", description: "IANA 타임존 이름" },
      unit: { type: "string", enum: ["c", "f"] },
      count: { type: "integer", minimum: 1, maximum: 10 },
    },
  },
};

/** 전 필드가 근거 있는 값인 툴. */
const allDeclared: ToolDef = {
  name: "all-declared",
  inputSchema: {
    type: "object",
    required: ["url"],
    properties: { url: { type: "string", format: "uri" } },
  },
};

const baselineOf = (tools: readonly ToolDef[]) =>
  createBaselineSuite([...tools], { suiteId: "s", suiteName: "s" });

const requestFor = (tools: readonly ToolDef[]) => {
  const result = baselineOf(tools);
  return preparePreFillRequest({
    tools,
    provenance: result.provenance,
    baseline: result.suite,
  });
};

describe("preparePreFillRequest", () => {
  it("전 필드 declared 인 툴만 있으면 null 이다", () => {
    expect(requestFor([allDeclared])).toBeNull();
  });

  it("needsAssist 인 툴만 요청에 싣는다", () => {
    const request = requestFor([allDeclared, needsHelp]);
    expect(request?.tools.map((tool) => tool.name)).toEqual(["needs-help"]);
  });

  it("정상 경로 케이스만 싣는다", () => {
    const request = requestFor([needsHelp]);
    expect(request?.cases).toHaveLength(1);
    expect(request?.cases[0]?.caseId).toBe("needs-help-success");
    expect(request?.cases[0]?.tool).toBe("needs-help");
  });

  it("근거 없는 필드만 assistFields 에 담는다", () => {
    // unit 은 enum, count 는 범위 제약이라 근거가 있다. timezone 만 남는다.
    expect(requestFor([needsHelp])?.cases[0]?.assistFields).toEqual(["timezone"]);
  });

  it("baseline 이 넣은 값을 그대로 싣는다", () => {
    expect(requestFor([needsHelp])?.cases[0]?.input).toEqual({
      timezone: "example",
      unit: "c",
      count: 1,
    });
  });

  it("caseId 허용 값이 요청 스키마에 박힌다", () => {
    // PR #131 재발 방지. 요청에 규칙을 두지 않으면 provider 가 지킬 수 없다.
    expect(requestFor([needsHelp])?.outputSchema).toMatchObject({
      properties: {
        proposals: {
          items: {
            properties: {
              caseId: { enum: expect.arrayContaining(["needs-help-success"]) },
            },
          },
        },
      },
    });
  });

  it("툴 선언을 요청에 싣는다", () => {
    const tool = requestFor([needsHelp])?.tools[0];
    expect(tool?.description).toBe("시각을 돌려준다");
    expect(tool?.inputSchema).toMatchObject({ type: "object" });
  });

  it("잘린 것이 없으면 omitted 가 0 이다", () => {
    expect(requestFor([needsHelp])?.omitted).toEqual({ tools: 0 });
  });

  it("같은 입력이면 같은 요청이 나온다", () => {
    expect(JSON.stringify(requestFor([needsHelp]))).toBe(JSON.stringify(requestFor([needsHelp])));
  });
});

describe("validatePreFillResult", () => {
  const request = requestFor([needsHelp]);
  if (request === null) throw new Error("요청이 만들어져야 한다");
  const caseId = "needs-help-success";

  it("정상 제안을 받는다", () => {
    const result = validatePreFillResult(
      { proposals: [{ caseId, field: "timezone", value: "Asia/Seoul" }] },
      request,
    );
    expect(result.accepted).toEqual([{ caseId, field: "timezone", value: "Asia/Seoul" }]);
    expect(result.discarded).toHaveLength(0);
  });

  it("요청 enum 밖 caseId 는 사유와 함께 버린다", () => {
    const result = validatePreFillResult(
      { proposals: [{ caseId: "a,b,c", field: "timezone", value: "Asia/Seoul" }] },
      request,
    );
    expect(result.accepted).toHaveLength(0);
    expect(result.discarded[0]?.reason).toContain("요청에 없는 케이스");
  });

  it("declared 필드를 가리키면 버린다", () => {
    const result = validatePreFillResult(
      { proposals: [{ caseId, field: "unit", value: "f" }] },
      request,
    );
    expect(result.accepted).toHaveLength(0);
    expect(result.discarded[0]?.reason).toContain("근거 있는 값");
    expect(result.discarded[0]?.field).toBe("unit");
  });

  it("선언을 어기는 값은 버린다", () => {
    const result = validatePreFillResult(
      { proposals: [{ caseId, field: "timezone", value: 0 }] },
      request,
    );
    expect(result.accepted).toHaveLength(0);
    expect(result.discarded[0]?.reason).toContain("서버 선언");
  });

  it("그 케이스에 없는 필드는 버린다", () => {
    const result = validatePreFillResult(
      { proposals: [{ caseId, field: "nope", value: 1 }] },
      request,
    );
    expect(result.discarded[0]?.reason).toContain("없는 필드");
  });

  it("응답이 배열이 아니면 전부 버리고 죽지 않는다", () => {
    expect(() => validatePreFillResult({ proposals: "nope" }, request)).not.toThrow();
    expect(validatePreFillResult({ proposals: "nope" }, request).accepted).toHaveLength(0);
  });

  it("응답이 객체가 아니어도 죽지 않는다", () => {
    expect(validatePreFillResult(null, request)).toEqual({ accepted: [], discarded: [] });
  });

  it("모양이 어긋난 항목은 사유와 함께 버린다", () => {
    const result = validatePreFillResult({ proposals: [{ caseId }] }, request);
    expect(result.discarded[0]?.reason).toContain("모양");
  });

  it("버린 항목마다 caseId 와 field 를 남긴다", () => {
    const result = validatePreFillResult(
      { proposals: [{ caseId, field: "unit", value: "f" }] },
      request,
    );
    expect(result.discarded[0]).toMatchObject({ caseId, field: "unit" });
  });

  it("여러 제안의 순서가 요청 케이스 순서를 따른다", () => {
    const two = requestFor([needsHelp, { ...needsHelp, name: "needs-help-2" }]);
    if (two === null) throw new Error("요청이 만들어져야 한다");
    const ids = two.cases.map((item) => item.caseId);
    const result = validatePreFillResult(
      {
        proposals: [
          { caseId: ids[1], field: "timezone", value: "UTC" },
          { caseId: ids[0], field: "timezone", value: "Asia/Seoul" },
        ],
      },
      two,
    );
    expect(result.accepted.map((item) => item.caseId)).toEqual(ids);
  });
});

describe("previewPreFillRequest · dispatchPreFillRequest", () => {
  const request = requestFor([needsHelp]);
  if (request === null) throw new Error("요청이 만들어져야 한다");
  const caseId = "needs-help-success";
  const preview = () =>
    previewPreFillRequest({ request, providerId: "codex", model: "gpt-5-codex" });
  const approvedOf = (view: ReturnType<typeof preview>) => ({
    approved: true,
    fingerprint: view.fingerprint,
  });
  const provider = (impl: () => Promise<unknown>): PreFillProvider => ({
    id: "codex",
    model: "gpt-5-codex",
    preFill: impl,
  });

  it("preview 가 전송 재료를 그대로 싣는다", () => {
    const view = preview();
    expect(view.providerId).toBe("codex");
    expect(view.model).toBe("gpt-5-codex");
    expect(view.byteLength).toBeGreaterThan(0);
    expect(view.requiresApproval).toBe(true);
    expect(view.request).toBe(request);
  });

  it("같은 요청이면 같은 지문이다", () => {
    expect(preview().fingerprint).toBe(preview().fingerprint);
  });

  it("승인하지 않으면 provider 를 안 부른다", async () => {
    const called = vi.fn(async () => ({ proposals: [] }));
    const result = await dispatchPreFillRequest({
      provider: provider(called),
      preview: preview(),
      approval: { approved: false, fingerprint: "" },
    });
    expect(result.status).toBe("notApproved");
    expect(called).not.toHaveBeenCalled();
  });

  it("지문이 다르면 전송하지 않는다", async () => {
    const called = vi.fn(async () => ({ proposals: [] }));
    const result = await dispatchPreFillRequest({
      provider: provider(called),
      preview: preview(),
      approval: { approved: true, fingerprint: "다른-지문" },
    });
    expect(result.status).toBe("approvalInvalidated");
    expect(called).not.toHaveBeenCalled();
  });

  it("승인한 요청은 전송하고 검증한 결과를 돌려준다", async () => {
    const view = preview();
    const result = await dispatchPreFillRequest({
      provider: provider(async () => ({
        proposals: [{ caseId, field: "timezone", value: "Asia/Seoul" }],
      })),
      preview: view,
      approval: approvedOf(view),
    });
    expect(result).toMatchObject({
      status: "proposals",
      result: { accepted: [{ caseId, field: "timezone", value: "Asia/Seoul" }] },
    });
  });

  it("provider 가 죽으면 사유를 담아 돌려주고 던지지 않는다", async () => {
    const view = preview();
    const result = await dispatchPreFillRequest({
      provider: provider(async () => {
        throw new Error("boom");
      }),
      preview: view,
      approval: approvedOf(view),
    });
    expect(result.status).toBe("providerFailed");
  });

  it("응답이 상한을 넘으면 자르지 않고 거절한다", async () => {
    const view = previewPreFillRequest({
      request,
      providerId: "codex",
      model: "gpt-5-codex",
      maxResultBytes: 16,
    });
    const result = await dispatchPreFillRequest({
      provider: provider(async () => ({
        proposals: [{ caseId, field: "timezone", value: "x".repeat(500) }],
      })),
      preview: view,
      approval: approvedOf(view),
    });
    expect(result.status).toBe("resultLimitExceeded");
  });

  it("provider 모델이 승인 화면과 다르면 전송하지 않는다", async () => {
    const view = preview();
    const result = await dispatchPreFillRequest({
      provider: { id: "codex", model: "다른-모델", preFill: async () => ({ proposals: [] }) },
      preview: view,
      approval: approvedOf(view),
    });
    expect(result.status).toBe("approvalInvalidated");
  });
});

describe("provenance 와의 정합", () => {
  it("needsAssist 가 false 인 툴은 요청 대상이 아니다", () => {
    expect(analyzeToolProvenance(allDeclared).needsAssist).toBe(false);
    expect(requestFor([allDeclared])).toBeNull();
  });

  it("baseline 케이스가 없는 툴은 대상이 아니다", () => {
    const empty: TestSuiteSpec = { schemaVersion: 1, id: "s", name: "s", cases: [] };
    expect(
      preparePreFillRequest({
        tools: [needsHelp],
        provenance: [analyzeToolProvenance(needsHelp)],
        baseline: empty,
      }),
    ).toBeNull();
  });
});
