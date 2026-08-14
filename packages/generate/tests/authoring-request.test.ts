import type { ToolDef } from "@ohmymcp/core";
import {
  DEFAULT_SENSITIVE_KEYS,
  describeSpecFinding,
  MCP_SUITE_JSON_SCHEMA,
  REDACTED,
} from "@ohmymcp/runner";
import { describe, expect, it, vi } from "vitest";
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

/**
 * provider 가 providerSuite 를 그대로 돌려주는 dispatch 를 한 번 돌린다.
 *
 * `withSession` 이 없으면 결과는 provider 경로 candidate(validateAuthoringProviderResult) 다.
 * `withSession: true` 면 dispatch 가 reviewLocalAuthoringCandidate 로 빠져 **세션 경로**를 탄다.
 * 두 경로는 검사에 쓰는 도구 목록을 각자 고르므로 회귀도 따로 고정해야 한다.
 *
 * baseline 은 별도 목록으로 만들 수 있다. createBaselineSuite 가 additionalProperties 를
 * 거부하는데 UNDECLARED_FIELD 는 그 키워드가 정확히 false 일 때만 나기 때문이다.
 */
const dispatchWithProviderSuite = async (input: {
  tools: ToolDef[];
  baselineTools?: ToolDef[];
  providerSuite: unknown;
  redaction?: { sensitiveValues?: readonly string[] };
  withSession?: boolean;
  /** 요청 준비 **뒤** 호출자가 원본 tools 를 손대는 상황을 흉내낸다. 결정론성 회귀용이다. */
  mutateToolsAfterPrepare?: (tools: ToolDef[]) => void;
}) => {
  const baseline = createBaselineSuite(input.baselineTools ?? input.tools, {
    suiteId: "weather",
    suiteName: "날씨",
  });
  const base = baseline.suite;
  const preview = prepareAuthoringRequest({
    ...options(),
    baseline: base,
    candidate: base,
    tools: input.tools,
    ...(input.redaction === undefined ? {} : { redaction: input.redaction }),
  });
  input.mutateToolsAfterPrepare?.(input.tools);
  return dispatchAuthoringRequest({
    provider: {
      id: "codex" as const,
      author: async () => ({
        status: "candidate",
        suite: input.providerSuite,
        summary: "요약",
        questions: [],
        warnings: [],
      }),
    },
    preview,
    approval: { approved: true, fingerprint: preview.fingerprint },
    // 같은 baseline 으로 만든 세션이어야 suite identity 대조를 통과한다.
    ...(input.withSession === true ? { session: createAuthoringSession(baseline) } : {}),
  });
};

/** baseline suite 를 그대로 돌려주는 provider 응답. 위반이 하나도 없는 대조군이다. */
const cleanProviderSuite = () =>
  createBaselineSuite(tools, { suiteId: "weather", suiteName: "날씨" }).suite;

/**
 * 손대지 않은 provider candidate 의 지문.
 *
 * 이 상수가 고정하는 것은 **specFindings 가 지문에 들어가지 않는다는 계약**이다. 대조 결과를
 * candidate 에 실어도 지문이 그대로여야 한다.
 *
 * 2026-08-15 에 값이 한 번 갈렸다. baseline 정책이 v2 로 올라 툴당 케이스가 정상 1개에서
 * 정상 1개 + 위반 N개로 늘었기 때문이다(ADR-0022). suite 내용이 바뀌었으니 지문이 바뀌는 것이
 * 정상이다. 위 계약이 깨진 것이 아니다. 값은 손으로 계산하지 않고 실제 실행 결과를 넣었다.
 */
const KNOWN_PROVIDER_FINGERPRINT =
  "54c9288ac9c17b57efc18c5bb2c1819052d79ecfdc0980895d5a4f81e54ec7d3";

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
  it("provider 안전 failure code와 진단만 보존한다", async () => {
    const preview = prepareAuthoringRequest(options());
    for (const [code, exitCode, stderr] of [
      ["timedOut", undefined, undefined],
      ["cancelled", undefined, undefined],
      ["providerUnavailable", undefined, undefined],
      ["nonZeroExit", 7, { captured: true, truncated: true }],
      ["outputLimitExceeded", undefined, { captured: false, truncated: false }],
    ] as const) {
      const rawError = Object.assign(new Error("RAW_MESSAGE_SENTINEL"), {
        code,
        exitCode,
        stderr,
        stdout: "RAW_STDOUT_SENTINEL",
        stack: "RAW_STACK_SENTINEL",
      });
      const result = await dispatchAuthoringRequest({
        provider: { id: "codex", author: async () => Promise.reject(rawError) },
        preview,
        approval: { approved: true, fingerprint: preview.fingerprint },
      });
      expect(result).toMatchObject({
        status: "providerFailed",
        failure: {
          providerId: "codex",
          code,
          timeoutMs: preview.providerTimeoutMs,
          exitCode,
          stderr,
        },
      });
      expect(JSON.stringify(result)).not.toContain("RAW_");
    }
  });
  it("PublicProviderFailure가 reason을 그대로 전달한다", async () => {
    const preview = prepareAuthoringRequest(options());
    const rawError = Object.assign(new Error("boom"), {
      code: "nonZeroExit",
      exitCode: 1,
      reason: "unknownModel",
    });
    await expect(
      dispatchAuthoringRequest({
        provider: { id: "codex", author: async () => Promise.reject(rawError) },
        preview,
        approval: { approved: true, fingerprint: preview.fingerprint },
      }),
    ).resolves.toMatchObject({
      status: "providerFailed",
      failure: { code: "nonZeroExit", reason: "unknownModel" },
    });
  });
  it("enum 밖의 reason 값은 버린다", async () => {
    const preview = prepareAuthoringRequest(options());
    const rawError = Object.assign(new Error("boom"), {
      code: "nonZeroExit",
      exitCode: 1,
      reason: "arbitraryString",
    });
    const result = await dispatchAuthoringRequest({
      provider: { id: "codex", author: async () => Promise.reject(rawError) },
      preview,
      approval: { approved: true, fingerprint: preview.fingerprint },
    });
    if (result.status !== "providerFailed") throw new Error("providerFailed가 필요합니다.");
    expect(result.failure.reason).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("arbitraryString");
  });
  it("기존 stderr {captured, truncated} 모양이 그대로다", async () => {
    const preview = prepareAuthoringRequest(options());
    const rawError = Object.assign(new Error("boom"), {
      code: "nonZeroExit",
      exitCode: 1,
      reason: "rateLimited",
      stderr: { captured: true, truncated: true },
    });
    const result = await dispatchAuthoringRequest({
      provider: { id: "codex", author: async () => Promise.reject(rawError) },
      preview,
      approval: { approved: true, fingerprint: preview.fingerprint },
    });
    expect(result).toEqual({
      status: "providerFailed",
      failure: {
        providerId: "codex",
        code: "nonZeroExit",
        timeoutMs: preview.providerTimeoutMs,
        exitCode: 1,
        reason: "rateLimited",
        stderr: { captured: true, truncated: true },
      },
    });
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
  it("Runner Schema를 수정하지 않고 authoring output Schema를 만든다", async () => {
    // 자기 자신과 비교하면 어떤 회귀도 못 잡는다. generate를 거치지 않은 새 모듈 인스턴스를
    // 따로 띄워 그것과 비교해야 원본 불변을 실제로 검증한다.
    vi.resetModules();
    const pristine = await import("@ohmymcp/runner");
    expect(MCP_SUITE_JSON_SCHEMA).toEqual(pristine.MCP_SUITE_JSON_SCHEMA);
    expect(Object.keys(MCP_SUITE_JSON_SCHEMA)).toEqual(
      expect.arrayContaining(["$schema", "$id", "$defs"]),
    );
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
  it("questions 응답에 suite가 함께 오면 거절한다", () => {
    const result = validateAuthoringProviderResult(
      { status: "questions", questions: ["q"], suite: {} },
      prepareAuthoringRequest(options()),
    );
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") throw new Error("invalid 결과가 필요합니다.");
    expect(result.issues[0]?.path).toBe("status");
  });
  it("questions 응답에 summary가 함께 오면 거절한다", () => {
    const result = validateAuthoringProviderResult(
      { status: "questions", questions: ["q"], summary: "s" },
      prepareAuthoringRequest(options()),
    );
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") throw new Error("invalid 결과가 필요합니다.");
    expect(result.issues[0]?.path).toBe("status");
  });
  it("provider schema를 통과해도 허용되지 않은 툴 이름이면 로컬 validator가 거절한다", () => {
    const bad = structuredClone(suite());
    const firstCase = bad.cases[0];
    if (firstCase === undefined) throw new Error("baseline case가 필요합니다.");
    firstCase.operation = { type: "callTool", tool: "unknown-tool", input: {} };
    const result = validateAuthoringProviderResult(
      { status: "candidate", suite: bad, summary: "ok", warnings: [], questions: [] },
      prepareAuthoringRequest(options()),
    );
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") throw new Error("invalid 결과가 필요합니다.");
    expect(result.issues.some((issue) => issue.path === "suite.cases[0].operation.tool")).toBe(
      true,
    );
  });
  it("provider schema를 통과해도 suite id가 다르면 거절한다", () => {
    const bad = { ...structuredClone(suite()), id: "other-suite" };
    const result = validateAuthoringProviderResult(
      { status: "candidate", suite: bad, summary: "ok", warnings: [], questions: [] },
      prepareAuthoringRequest(options()),
    );
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") throw new Error("invalid 결과가 필요합니다.");
    expect(result.issues.some((issue) => issue.path === "suite.id")).toBe(true);
  });
  it("operation이 없는 case가 와도 예외 없이 invalid로 떨어진다", () => {
    const bad = structuredClone(suite()) as unknown as { cases: unknown[] };
    bad.cases[0] = { id: "weather-success", name: "이름만 있는 case" };
    const preview = prepareAuthoringRequest(options());
    let result: ReturnType<typeof validateAuthoringProviderResult>;
    expect(() => {
      result = validateAuthoringProviderResult(
        { status: "candidate", suite: bad, summary: "ok", warnings: [], questions: [] },
        preview,
      );
    }).not.toThrow();
    // biome-ignore lint/style/noNonNullAssertion: 위 콜백이 반드시 대입한다.
    expect(result!.status).toBe("invalid");
  });
  it("provider warnings를 redaction과 상한을 적용해 전달한다", () => {
    const callerSecret = "warning-secret";
    const preview = prepareAuthoringRequest({
      ...options(),
      redaction: { sensitiveValues: [callerSecret] },
    });
    const result = validateAuthoringProviderResult(
      {
        status: "candidate",
        suite: suite(),
        summary: "ok",
        warnings: [`leak ${callerSecret}`, "두 번째 경고", 42, "  "],
        questions: [],
      },
      preview,
    );
    if (result.status !== "preview") throw new Error("candidate preview가 필요합니다.");
    expect(result.preview.result.warnings).toEqual(["leak [REDACTED]", "두 번째 경고"]);
    expect(result.preview.result.summary).toBe("ok");
    expect(JSON.stringify(result)).not.toContain(callerSecret);
  });
  it("provider warnings 개수를 상한으로 자른다", () => {
    const preview = prepareAuthoringRequest(options());
    const result = validateAuthoringProviderResult(
      {
        status: "candidate",
        suite: suite(),
        summary: "ok",
        warnings: Array.from({ length: 200 }, (_, index) => `경고 ${index}`),
        questions: [],
      },
      preview,
    );
    if (result.status !== "preview") throw new Error("candidate preview가 필요합니다.");
    expect(result.preview.result.warnings).toHaveLength(100);
  });
  it("camelCase 민감 키도 정규화해 가린다", () => {
    const preview = prepareAuthoringRequest({
      ...options(),
      tools: [
        {
          name: "weather",
          inputSchema: { accessToken: "at", "refresh-token": "rt", clientSecret: "cs" },
        },
      ],
    });
    const serialized = JSON.stringify(preview.request.tools);
    expect(serialized).not.toContain('"at"');
    expect(serialized).not.toContain('"rt"');
    expect(serialized).not.toContain('"cs"');
  });
  it("DEFAULT_SENSITIVE_KEYS는 전부 정규화된 형태다", () => {
    for (const key of DEFAULT_SENSITIVE_KEYS)
      expect(key).toBe(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
  });
  it("계약 식별자는 값 기반 redaction에서 제외한다", () => {
    const preview = prepareAuthoringRequest({
      ...options(),
      // suite id, case id, 툴 이름과 같은 문자열을 비밀값으로 선언한 상황.
      redaction: { sensitiveValues: ["weather", "weather-success", "weather-generated"] },
    });
    expect(preview.request.baseline.id).toBe("weather");
    expect(preview.request.baseline.cases[0]?.id).toBe("weather-success");
    expect(preview.request.candidate.id).toBe("weather");
    expect(preview.request.tools[0]?.name).toBe("weather");
    const operation = preview.request.baseline.cases[0]?.operation;
    if (operation?.type !== "callTool") throw new Error("callTool case가 필요합니다.");
    expect(operation.tool).toBe("weather");
    expect(operation.type).toBe("callTool");
  });
  it("같은 문자열이 operation.input 안에 있으면 여전히 가린다", () => {
    const preview = prepareAuthoringRequest({
      ...options(),
      baseline: (() => {
        const base = structuredClone(suite());
        const first = base.cases[0];
        if (first?.operation.type !== "callTool") throw new Error("callTool case가 필요합니다.");
        first.operation.input.city = "weather";
        return base;
      })(),
      redaction: { sensitiveValues: ["weather"] },
    });
    expect(preview.request.baseline.id).toBe("weather");
    const operation = preview.request.baseline.cases[0]?.operation;
    if (operation?.type !== "callTool") throw new Error("callTool case가 필요합니다.");
    expect(operation.input.city).toBe("[REDACTED]");
  });
  it("계약 식별자를 비밀값으로 선언해도 provider 결과 검증이 통과한다", () => {
    const preview = prepareAuthoringRequest({
      ...options(),
      redaction: { sensitiveValues: ["weather", "weather-success"] },
    });
    const result = validateAuthoringProviderResult(
      { status: "candidate", suite: suite(), summary: "ok", warnings: [], questions: [] },
      preview,
    );
    expect(result.status).toBe("preview");
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

  it("provider 후보에도 specFindings 가 붙는다", async () => {
    const contractTools: ToolDef[] = [
      {
        name: "get_weather",
        inputSchema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
          additionalProperties: false,
        },
      },
    ];
    const baselineTools: ToolDef[] = [
      {
        name: "get_weather",
        inputSchema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    ];
    const base = createBaselineSuite(baselineTools, {
      suiteId: "weather",
      suiteName: "날씨",
    }).suite;
    const result = await dispatchWithProviderSuite({
      tools: contractTools,
      baselineTools,
      providerSuite: {
        ...base,
        cases: [
          {
            id: "seoul-weather",
            name: "서울 날씨",
            operation: { type: "callTool", tool: "get_weather", input: { citi: "Seoul" } },
            assertions: [{ type: "bodyMatchesSchema", schema: { type: "string", minLength: 1 } }],
          },
        ],
      },
    });
    if (result.status !== "preview") throw new Error(`preview 가 아니다: ${result.status}`);
    expect(result.preview.specFindings.inputContract.findings.map((f) => f.code)).toEqual([
      "REQUIRED_MISSING",
      "UNDECLARED_FIELD",
    ]);
  });

  it("enum 값이 민감 값과 같아도 ENUM_MISMATCH 가 나지 않는다", async () => {
    // 검사에 치환된 tools 를 쓰면 선언 enum 이 '[REDACTED]' 가 되어 정상 입력이 위반으로 뒤집힌다.
    const unitsTools: ToolDef[] = [
      {
        name: "get_weather",
        inputSchema: {
          type: "object",
          properties: { units: { type: "string", enum: ["c", "f"] } },
          required: ["units"],
        },
      },
    ];
    const base = createBaselineSuite(unitsTools, { suiteId: "weather", suiteName: "날씨" }).suite;
    const result = await dispatchWithProviderSuite({
      redaction: { sensitiveValues: ["c"] },
      tools: unitsTools,
      providerSuite: {
        ...base,
        cases: [
          {
            id: "units-case",
            name: "단위",
            // 민감 값으로 지정한 'c' 를 그대로 입력에 쓴다. 치환된 도구 목록으로 대조하면
            // 선언 enum 이 ["[REDACTED]", "f"] 가 되어 이 정상 입력이 위반으로 뒤집힌다.
            // 'f' 를 쓰면 치환 여부와 무관하게 enum 에 남아 있어 회귀를 못 잡는다.
            operation: { type: "callTool", tool: "get_weather", input: { units: "c" } },
            assertions: [{ type: "bodyMatchesSchema", schema: { type: "string", minLength: 1 } }],
          },
        ],
      },
    });
    if (result.status !== "preview") throw new Error(`preview 가 아니다: ${result.status}`);
    expect(result.preview.specFindings.inputContract.findings).toEqual([]);
  });

  it("session 을 넘긴 경로에서도 ENUM_MISMATCH 가 나지 않는다", async () => {
    // 위 테스트의 세션 경로 변형이다. session 이 있으면 dispatch 가
    // reviewLocalAuthoringCandidate 로 빠지고 검사에 쓸 도구 목록을 그쪽에서 다시 고른다.
    // 거기에 치환 사본(state.tools)을 넘기면 선언 enum 이 '[REDACTED]' 가 되어 정상 입력이
    // 위반으로 뒤집힌다. 두 경로가 각자 목록을 고르므로 회귀도 두 벌로 고정한다.
    const unitsTools: ToolDef[] = [
      {
        name: "get_weather",
        inputSchema: {
          type: "object",
          properties: { units: { type: "string", enum: ["c", "f"] } },
          required: ["units"],
        },
      },
    ];
    const base = createBaselineSuite(unitsTools, { suiteId: "weather", suiteName: "날씨" }).suite;
    const result = await dispatchWithProviderSuite({
      withSession: true,
      redaction: { sensitiveValues: ["c"] },
      tools: unitsTools,
      providerSuite: {
        ...base,
        cases: [
          {
            id: "units-case",
            name: "단위",
            // 민감 값으로 지정한 'c' 를 그대로 입력에 쓴다. 치환된 도구 목록으로 대조하면
            // 선언 enum 이 ["[REDACTED]", "f"] 가 되어 이 정상 입력이 위반으로 뒤집힌다.
            // 'f' 를 쓰면 치환 여부와 무관하게 enum 에 남아 있어 회귀를 못 잡는다.
            operation: { type: "callTool", tool: "get_weather", input: { units: "c" } },
            assertions: [{ type: "bodyMatchesSchema", schema: { type: "string", minLength: 1 } }],
          },
        ],
      },
    });
    if (result.status !== "preview") throw new Error(`preview 가 아니다: ${result.status}`);
    expect(result.preview.specFindings.inputContract.findings).toEqual([]);
  });

  it("specFindings 는 provider candidate 의 fingerprint 를 바꾸지 않는다", async () => {
    const before = await dispatchWithProviderSuite({
      tools,
      providerSuite: cleanProviderSuite(),
    });
    if (before.status !== "preview") throw new Error("preview 가 아니다");
    expect(before.preview.fingerprint).toBe(KNOWN_PROVIDER_FINGERPRINT);
  });

  /**
   * enum 불일치를 일으키면서 민감 값을 양쪽(선언 enum · 입력)에 심는 도구 목록.
   * 'c' 는 서버가 선언한 enum 안에 있고 'secret-unit' 은 명세가 쓴 입력 값이다.
   * ENUM_MISMATCH 는 expected 에 enum 목록 전체를, actual 에 입력 값을 담으므로 둘 다 샌다.
   */
  const leakyTools: ToolDef[] = [
    {
      name: "get_weather",
      inputSchema: {
        type: "object",
        properties: { units: { type: "string", enum: ["c", "f"] } },
        required: ["units"],
      },
    },
  ];
  const leakySuite = () => {
    const base = createBaselineSuite(leakyTools, { suiteId: "weather", suiteName: "날씨" }).suite;
    return {
      ...base,
      cases: [
        {
          id: "units-case",
          name: "단위",
          operation: { type: "callTool", tool: "get_weather", input: { units: "secret-unit" } },
          assertions: [{ type: "bodyMatchesSchema", schema: { type: "string", minLength: 1 } }],
        },
      ],
    };
  };

  it("provider 경로의 specFindings 에 민감 값 원문이 남지 않는다", async () => {
    // 검사는 치환 이전 객체로 해야 거짓 양성이 안 나지만(ADR-0018), 그 결과를 그대로 실으면
    // 치환해서 감춘 값이 승인 화면의 경고 문장으로 되살아난다.
    const result = await dispatchWithProviderSuite({
      redaction: { sensitiveValues: ["c", "secret-unit"] },
      tools: leakyTools,
      providerSuite: leakySuite(),
    });
    if (result.status !== "preview") throw new Error(`preview 가 아니다: ${result.status}`);
    const finding = result.preview.specFindings.inputContract.findings[0];
    if (finding === undefined) throw new Error("ENUM_MISMATCH finding 이 필요합니다.");
    expect(finding.code).toBe("ENUM_MISMATCH");
    // 값 필드는 치환된다.
    expect(finding.expected).toEqual([REDACTED, "f"]);
    expect(finding.actual).toBe(REDACTED);
    // 이름은 치환하지 않는다. 무엇을 고쳐야 하는지가 사라지면 문장이 쓸모를 잃는다.
    expect(finding.path).toBe("input.units");
    // preview 전체 어디에도 원문이 없다.
    expect(JSON.stringify(result.preview)).not.toContain("secret-unit");
    // 사람이 읽는 문장에도 없다.
    expect(describeSpecFinding(finding)).not.toContain("secret-unit");
  });

  it("세션 경로의 specFindings 에도 민감 값 원문이 남지 않는다", async () => {
    const result = await dispatchWithProviderSuite({
      withSession: true,
      redaction: { sensitiveValues: ["c", "secret-unit"] },
      tools: leakyTools,
      providerSuite: leakySuite(),
    });
    if (result.status !== "preview") throw new Error(`preview 가 아니다: ${result.status}`);
    const finding = result.preview.specFindings.inputContract.findings[0];
    if (finding === undefined) throw new Error("ENUM_MISMATCH finding 이 필요합니다.");
    expect(finding.code).toBe("ENUM_MISMATCH");
    expect(finding.expected).toEqual([REDACTED, "f"]);
    expect(finding.actual).toBe(REDACTED);
    expect(JSON.stringify(result.preview)).not.toContain("secret-unit");
    expect(describeSpecFinding(finding)).not.toContain("secret-unit");
  });

  it("요청 준비 뒤 호출자가 tools 를 바꿔도 검사 결과가 그대로다", async () => {
    // unredactedTools 를 참조로 들면 여기서 결과가 뒤집힌다. 요청 지문은 치환된 request 만
    // 고정하므로 이 변화를 못 잡는다. 결정론성이 이 프로젝트의 핵심 가치다.
    const mutable: ToolDef[] = [
      {
        name: "get_weather",
        inputSchema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    ];
    const base = createBaselineSuite(mutable, { suiteId: "weather", suiteName: "날씨" }).suite;
    const result = await dispatchWithProviderSuite({
      tools: mutable,
      providerSuite: {
        ...base,
        cases: [
          {
            id: "seoul-weather",
            name: "서울 날씨",
            operation: { type: "callTool", tool: "get_weather", input: { citi: "서울" } },
            assertions: [{ type: "bodyMatchesSchema", schema: { type: "string", minLength: 1 } }],
          },
        ],
      },
      mutateToolsAfterPrepare: (current) => {
        // 오타를 정답으로 만드는 변형이다. 참조를 들고 있으면 REQUIRED_MISSING 이 사라진다.
        const schema = current[0]?.inputSchema as {
          properties: Record<string, unknown>;
          required: string[];
        };
        schema.required = ["citi"];
        schema.properties.citi = { type: "string" };
        current.push({ name: "나중에 끼워 넣은 도구", inputSchema: { type: "object" } });
      },
    });
    if (result.status !== "preview") throw new Error(`preview 가 아니다: ${result.status}`);
    expect(result.preview.specFindings.inputContract.findings.map((f) => f.code)).toEqual([
      "REQUIRED_MISSING",
    ]);
  });
});
