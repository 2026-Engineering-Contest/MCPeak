import type { ToolDef } from "@ohmymcp/core";
import { MCP_SUITE_JSON_SCHEMA } from "@ohmymcp/runner";
import { describe, expect, it } from "vitest";
import {
  AUTHORING_OUTPUT_SCHEMA,
  applyAuthoringChanges,
  createAuthoringDiff,
  createAuthoringSession,
  createBaselineSuite,
  DEFAULT_MAX_RESULT_BYTES,
  dispatchAuthoringRequest,
  prepareAuthoringRequest,
  validateAuthoringProviderResult,
} from "../src/index.js";

const tools: ToolDef[] = [
  { name: "weather", inputSchema: { type: "object", properties: { city: { type: "string" } } } },
];
const suite = () => createBaselineSuite(tools, { suiteId: "weather", suiteName: "날씨" }).suite;
const options = () => ({
  mode: "initial" as const,
  instruction: "도와줘",
  baseline: suite(),
  candidate: { ...suite(), name: "변조" },
  tools,
  providerId: "codex" as const,
  model: "test",
});

describe("authoring request", () => {
  it("initial 요청은 baseline을 candidate로 고정한다", () => {
    const preview = prepareAuthoringRequest(options());
    expect(preview.request.candidate).toEqual(preview.request.baseline);
    expect(Object.isFrozen(preview.request)).toBe(true);
    expect(preview.request.candidate).not.toBe(options().candidate);
  });
  it("revise 요청은 working candidate와 새 instruction만 보낸다", () => {
    const base = suite();
    const candidate = structuredClone(base);
    candidate.name = "현재";
    const preview = prepareAuthoringRequest({
      ...options(),
      mode: "revise",
      instruction: "새 피드백",
      candidate,
    });
    expect(Object.keys(preview.request).sort()).toEqual([
      "baseline",
      "candidate",
      "instruction",
      "mode",
      "tools",
    ]);
    expect(preview.request).toMatchObject({ instruction: "새 피드백", candidate });
  });
  it("prompt와 tool schema 비밀값을 전송 전에 제거한다", () => {
    const preview = prepareAuthoringRequest({
      ...options(),
      instruction: "token-secret",
      tools: [
        { name: "weather", inputSchema: { token: "token-secret", nested: { password: "x" } } },
      ],
      redaction: { sensitiveValues: ["token-secret"] },
    });
    expect(JSON.stringify(preview)).not.toContain("token-secret");
    expect(JSON.stringify(preview)).toContain("[REDACTED]");
  });
  it("비 JSON inputSchema를 redaction과 binding 전에 거절한다", () => {
    const sparse = Array<unknown>(2);
    sparse[1] = 1;
    for (const schema of [
      new Date(),
      { x: undefined },
      { x: NaN },
      { x: Infinity },
      sparse,
      { x: () => 1 },
      { x: 1n },
      { x: Symbol("x") },
    ])
      expect(() =>
        prepareAuthoringRequest({
          ...options(),
          tools: [{ name: "weather", inputSchema: schema }],
        }),
      ).toThrow();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() =>
      prepareAuthoringRequest({ ...options(), tools: [{ name: "weather", inputSchema: cycle }] }),
    ).toThrow();
  });
  it("prompt tools request와 result 옵션 상한을 동기 검증한다", () => {
    expect(() =>
      prepareAuthoringRequest({ ...options(), instruction: "x".repeat(65_537) }),
    ).toThrow();
    expect(() => prepareAuthoringRequest({ ...options(), providerTimeoutMs: 0 })).toThrow();
    expect(
      prepareAuthoringRequest({ ...options(), providerTimeoutMs: 600_000 }).providerTimeoutMs,
    ).toBe(600_000);
  });
  it("request 승인 뒤 visible payload나 fingerprint 변조를 거절한다", async () => {
    const preview = prepareAuthoringRequest(options());
    let calls = 0;
    const provider = {
      id: "codex" as const,
      author: async () => {
        calls += 1;
        return { status: "questions", questions: ["호출하면 안 됩니다."] };
      },
    };
    const approval = { approved: true, fingerprint: preview.fingerprint };
    const alteredPayload = {
      ...preview,
      request: { ...preview.request, instruction: "변조된 지시" },
    };
    const alteredFingerprint = { ...preview, fingerprint: "0".repeat(64) };

    await expect(
      dispatchAuthoringRequest({ provider, preview: alteredPayload, approval }),
    ).resolves.toEqual({
      status: "approvalInvalidated",
    });
    await expect(
      dispatchAuthoringRequest({ provider, preview: alteredFingerprint, approval }),
    ).resolves.toEqual({ status: "approvalInvalidated" });
    expect(calls).toBe(0);
  });
  it("dispatch candidate를 session diff와 승인 적용으로 연결한다", async () => {
    const baseline = createBaselineSuite(tools, { suiteId: "weather", suiteName: "날씨" });
    const session = createAuthoringSession(baseline);
    const preview = prepareAuthoringRequest({
      ...options(),
      baseline: baseline.suite,
      candidate: baseline.suite,
    });
    const candidate = structuredClone(baseline.suite);
    candidate.cases.push({
      id: "weather-error",
      name: "오류",
      operation: { type: "callTool", tool: "weather", input: { city: "Unknown" } },
      assertions: [{ type: "isError", expected: true }],
    });
    const provider = {
      id: "codex" as const,
      author: async () => ({
        status: "candidate",
        suite: candidate,
        summary: "ok",
        warnings: [],
        questions: [],
      }),
    };

    const result = await dispatchAuthoringRequest({
      provider,
      preview,
      approval: { approved: true, fingerprint: preview.fingerprint },
      session,
    });
    if (result.status !== "preview") throw new Error("candidate preview가 필요합니다.");
    const diff = createAuthoringDiff({ session, candidate: result.preview });
    const applied = applyAuthoringChanges({
      session,
      preview: diff,
      selectedChangeIds: diff.changes.map((change) => change.id),
      approval: { approved: true, fingerprint: diff.candidateFingerprint },
    });
    expect(applied).toMatchObject({ applied: true, draft: { revision: 1 } });
  });
  it("dispatch bridge에도 caller redaction 정책을 적용한다", async () => {
    const callerSecret = "bridge-secret";
    const baseline = createBaselineSuite(tools, { suiteId: "weather", suiteName: "날씨" });
    const session = createAuthoringSession(baseline);
    const preview = prepareAuthoringRequest({
      ...options(),
      baseline: baseline.suite,
      candidate: baseline.suite,
      redaction: { sensitiveValues: [callerSecret] },
    });
    const candidate = structuredClone(baseline.suite);
    const firstCase = candidate.cases[0];
    if (firstCase?.operation.type !== "callTool") throw new Error("callTool case가 필요합니다.");
    firstCase.operation.input.city = callerSecret;
    const result = await dispatchAuthoringRequest({
      provider: {
        id: "codex",
        author: async () => ({
          status: "candidate",
          suite: candidate,
          summary: "ok",
          warnings: [],
          questions: [],
        }),
      },
      preview,
      approval: { approved: true, fingerprint: preview.fingerprint },
      session,
    });

    expect(result).toMatchObject({ status: "preview", preview: { executable: false } });
    if (result.status !== "preview") throw new Error("candidate preview가 필요합니다.");
    const diff = createAuthoringDiff({ session, candidate: result.preview });
    expect(
      applyAuthoringChanges({
        session,
        preview: diff,
        selectedChangeIds: diff.changes.map((change) => change.id),
        approval: { approved: true, fingerprint: diff.candidateFingerprint },
      }),
    ).toMatchObject({ applied: false, reason: "redactionRequired" });
  });
  it("Runner Schema를 수정하지 않고 authoring output Schema를 만든다", () => {
    expect(MCP_SUITE_JSON_SCHEMA).toEqual(MCP_SUITE_JSON_SCHEMA);
    expect(Object.isFrozen(MCP_SUITE_JSON_SCHEMA)).toBe(true);
    expect(AUTHORING_OUTPUT_SCHEMA).toMatchObject({
      additionalProperties: false,
      $defs: { suite: { type: "object" } },
    });
  });
  it("candidate provider 결과를 전체 문맥으로 검증한다", () => {
    const preview = prepareAuthoringRequest(options());
    const result = validateAuthoringProviderResult(
      { status: "candidate", suite: suite(), summary: "ok", warnings: [], questions: [] },
      preview,
    );
    expect(result.status).toBe("preview");
    const bad = structuredClone(suite());
    const firstCase = bad.cases[0];
    if (firstCase === undefined) throw new Error("baseline case가 필요합니다.");
    firstCase.operation = { type: "callTool", tool: "missing", input: {} };
    expect(
      validateAuthoringProviderResult(
        { status: "candidate", suite: bad, summary: "ok", warnings: [], questions: [] },
        preview,
      ).status,
    ).toBe("invalid");
  });
  it("questions 결과는 candidate를 만들지 않는다", () => {
    const result = validateAuthoringProviderResult(
      { status: "questions", questions: ["도시는?"] },
      prepareAuthoringRequest(options()),
    );
    expect(result).toEqual({ status: "questions", questions: ["도시는?"] });
  });
  it("provider 결과의 비밀과 크기를 UI 전에 다시 제한한다", () => {
    const candidate = structuredClone(suite());
    const firstCase = candidate.cases[0];
    if (firstCase?.operation.type !== "callTool") throw new Error("callTool case가 필요합니다.");
    firstCase.operation.input.password = "secret";
    const preview = prepareAuthoringRequest(options());
    const result = validateAuthoringProviderResult(
      { status: "candidate", suite: candidate, summary: "ok", warnings: [], questions: [] },
      preview,
    );
    expect(result).toMatchObject({ status: "preview", preview: { executable: false } });
    expect(
      validateAuthoringProviderResult("x".repeat(DEFAULT_MAX_RESULT_BYTES + 1), preview).status,
    ).toBe("resultLimitExceeded");
  });
  it("caller redaction 정책을 provider 결과에도 적용한다", () => {
    const callerSecret = "caller-secret";
    const preview = prepareAuthoringRequest({
      ...options(),
      redaction: { sensitiveKeys: ["customerCredential"], sensitiveValues: [callerSecret] },
    });
    const candidate = structuredClone(suite());
    const firstCase = candidate.cases[0];
    if (firstCase?.operation.type !== "callTool") throw new Error("callTool case가 필요합니다.");
    firstCase.operation.input.customerCredential = callerSecret;
    const result = validateAuthoringProviderResult(
      { status: "candidate", suite: candidate, summary: "ok", warnings: [], questions: [] },
      preview,
    );

    expect(result).toMatchObject({ status: "preview", preview: { executable: false } });
    expect(JSON.stringify(result)).not.toContain(callerSecret);
    if (result.status !== "preview") throw new Error("candidate preview가 필요합니다.");
    expect(result.preview.fingerprint).not.toContain(callerSecret);
  });
  it("provider summary와 questions의 caller secret을 공개 preview에서 제거한다", () => {
    const callerSecret = "metadata-secret";
    const preview = prepareAuthoringRequest({
      ...options(),
      redaction: { sensitiveKeys: ["customerCredential"], sensitiveValues: [callerSecret] },
    });
    const candidate = structuredClone(suite());
    const result = validateAuthoringProviderResult(
      {
        status: "candidate",
        suite: candidate,
        summary: `summary ${callerSecret}`,
        warnings: [],
        questions: [`customerCredential=${callerSecret}`],
      },
      preview,
    );
    expect(result).toMatchObject({ status: "preview" });
    expect(JSON.stringify(result)).not.toContain(callerSecret);
    const questions = validateAuthoringProviderResult(
      { status: "questions", questions: [`customerCredential=${callerSecret}`] },
      preview,
    );
    expect(JSON.stringify(questions)).not.toContain(callerSecret);
  });
  it("invalid provider issue에 raw key와 value를 넣지 않는다", () => {
    const result = validateAuthoringProviderResult(
      {
        status: "candidate",
        suite: { secretKey: "RAW_SENTINEL" },
        summary: "ok",
        warnings: [],
        questions: [],
      },
      prepareAuthoringRequest(options()),
    );
    expect(JSON.stringify(result)).not.toContain("RAW_SENTINEL");
    expect(JSON.stringify(result)).not.toContain("secretKey");
  });
});
