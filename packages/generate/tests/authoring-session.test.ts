import type { ToolDef } from "@ohmymcp-hsu/core";
import { describeSpecFinding, REDACTED } from "@ohmymcp-hsu/runner";
import { describe, expect, it } from "vitest";
import {
  applyAuthoringChanges,
  createAuthoringDiff,
  createAuthoringSession,
  createBaselineSuite,
  finalizeAuthoringDraft,
  getAuthoringExecutionSuite,
  reviewLocalAuthoringCandidate,
} from "../src/index.js";

const tools: ToolDef[] = [
  {
    name: "weather",
    inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  },
  {
    name: "echo",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
];
const baseline = () => createBaselineSuite(tools, { suiteId: "weather", suiteName: "날씨" });
const candidate = (session = createAuthoringSession(baseline())) =>
  structuredClone(session.approvedDraft.suite);
const approve = (fingerprint: string) => ({ approved: true as const, fingerprint });

/**
 * 손대지 않은 baseline candidate 의 지문.
 *
 * 이 상수가 고정하는 것은 **specFindings 가 지문에 들어가지 않는다는 계약**이다. 대조 결과를
 * candidate 에 실어도 지문이 그대로여야 한다. 그렇지 않으면 이미 승인된 지문이 전부 어긋난다.
 *
 * 2026-08-15 에 값이 한 번 갈렸다. baseline 정책이 v2 로 올라 툴당 케이스가 정상 1개에서
 * 정상 1개 + 위반 N개로 늘었기 때문이다(ADR-0022). suite 내용이 바뀌었으니 지문이 바뀌는 것이
 * 정상이다. 위 계약이 깨진 것이 아니다. 값은 손으로 계산하지 않고 실제 실행 결과를 넣었다.
 */
const KNOWN_CLEAN_FINGERPRINT = "5eb8858d23345e8f821025adf3ba01d701171c9c723cd6fb0590a1b196598abe";

/**
 * baseline 생성용 도구 목록. createBaselineSuite 가 지원하는 키워드만 쓴다. type 없는 필드와
 * additionalProperties 를 거부하므로 enum 옆에 type 을 적고 additionalProperties 는 뺀다.
 */
const weatherBaselineTools: ToolDef[] = [
  {
    name: "get_weather",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string" }, units: { type: "string", enum: ["c", "f"] } },
      required: ["city"],
    },
  },
];

/**
 * 입력 계약 대조에 넘기는 도구 목록. baseline 용과 같은 스키마에 additionalProperties 만 더했다.
 * UNDECLARED_FIELD 는 additionalProperties 가 정확히 false 일 때만 나기 때문이다(설계 문서 §5.3).
 * baseline 생성기가 지원하는 키워드 부분집합이 대조 검사보다 좁아서 목록을 둘로 나눈다.
 */
const weatherTools: ToolDef[] = [
  {
    name: "get_weather",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string" }, units: { type: "string", enum: ["c", "f"] } },
      required: ["city"],
      additionalProperties: false,
    },
  },
];

/**
 * toolList 로 baseline 세션을 만들고, 그 승인 suite 의 case 를 testCase 하나로 갈아끼운
 * candidate 를 함께 돌려준다. suite identity(id · schemaVersion)는 그대로 유지된다.
 */
const sessionWithCase = (toolList: ToolDef[], testCase: unknown) => {
  const session = createAuthoringSession(
    createBaselineSuite(toolList, { suiteId: "weather", suiteName: "날씨" }),
  );
  const next = candidate(session);
  next.cases = [testCase as (typeof next.cases)[number]];
  return { session, next };
};

describe("authoring session", () => {
  it("baseline으로 revision 0 authoring session을 만든다", () => {
    const source = baseline();
    const session = createAuthoringSession(source);
    expect(session.baseline.suite).toEqual(source.suite);
    expect(session.approvedDraft.suite).toEqual(source.suite);
    expect(session.workingCandidate).toBeUndefined();
    expect(session.approvedDraft.revision).toBe(0);
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(session.approvedDraft.suite.cases)).toBe(true);
  });

  it("candidate와 질문은 승인 revision을 바꾸지 않는다", () => {
    const session = createAuthoringSession(baseline());
    expect(
      reviewLocalAuthoringCandidate({ session, candidate: candidate(session), tools }),
    ).toMatchObject({ status: "preview" });
    expect(session.approvedDraft.revision).toBe(0);
    expect(
      reviewLocalAuthoringCandidate({ session, questions: ["어떤 도시를 사용할까요?"], tools }),
    ).toEqual({ status: "questions", questions: ["어떤 도시를 사용할까요?"] });
    expect(session.approvedDraft.revision).toBe(0);
  });

  it("승인 draft 기준으로 고정 순서 diff를 만든다", () => {
    const session = createAuthoringSession(baseline());
    const next = candidate(session);
    next.name = "개선된 날씨";
    next.cases.splice(0, 1);
    const echo = next.cases[0];
    if (echo === undefined) throw new Error("echo case가 필요합니다.");
    echo.name = "echo 수정";
    next.cases.push({
      id: "weather-error",
      name: "오류",
      operation: { type: "callTool", tool: "weather", input: { city: "Unknown" } },
      assertions: [{ type: "isError", expected: true }],
    });
    const review = reviewLocalAuthoringCandidate({ session, candidate: next, tools });
    if (review.status !== "preview") throw new Error("candidate preview가 필요합니다.");
    const changes = createAuthoringDiff({ session, candidate: review.preview }).changes;
    expect(changes.map((change) => `${change.id}:${change.type}`)).toEqual([
      "change-001:suiteMetadata",
      "change-002:removeCase",
      "change-003:replaceCase",
      "change-004:addCase",
      "change-005:caseOrder",
    ]);
    expect(changes[1]).toMatchObject({ caseId: "weather-success", approvedIndex: 0 });
    // splice 로 첫 케이스를 지웠으므로 이름을 고친 next.cases[0] 은 승인본의 두 번째 케이스다.
    // baseline 정책 v2 에서 그것은 weather-missing-city 다.
    expect(changes[2]).toMatchObject({
      caseId: "weather-missing-city",
      approvedIndex: 1,
      after: { name: "echo 수정" },
    });
    expect(changes[3]).toMatchObject({ caseId: "weather-error", candidateIndex: 5 });
    expect(changes[4]).toMatchObject({
      before: [
        "weather-success",
        "weather-missing-city",
        "weather-type-city",
        "echo-success",
        "echo-missing-text",
        "echo-type-text",
      ],
      after: [
        "weather-missing-city",
        "weather-type-city",
        "echo-success",
        "echo-missing-text",
        "echo-type-text",
        "weather-error",
      ],
    });
  });

  it("baseline case 누락을 명시적인 remove로 표시한다", () => {
    const session = createAuthoringSession(baseline());
    const next = candidate(session);
    next.cases.shift();
    const review = reviewLocalAuthoringCandidate({ session, candidate: next, tools });
    if (review.status !== "preview") throw new Error("candidate preview가 필요합니다.");
    expect(createAuthoringDiff({ session, candidate: review.preview }).changes).toContainEqual(
      expect.objectContaining({
        type: "removeCase",
        caseId: "weather-success",
        case: session.approvedDraft.suite.cases[0],
      }),
    );
  });

  it("선택한 변경만 적용해 revision을 한 번 증가시킨다", () => {
    const session = createAuthoringSession(baseline());
    const next = candidate(session);
    next.cases.push({
      id: "weather-error",
      name: "오류",
      operation: { type: "callTool", tool: "weather", input: { city: "Unknown" } },
      assertions: [{ type: "isError", expected: true }],
    });
    const review = reviewLocalAuthoringCandidate({
      session,
      candidate: next,
      tools,
      providerId: "codex",
    });
    if (review.status !== "preview") throw new Error("candidate preview가 필요합니다.");
    const diff = createAuthoringDiff({ session, candidate: review.preview });
    const add = diff.changes.find((change) => change.type === "addCase");
    if (add === undefined) throw new Error("add change가 필요합니다.");
    const result = applyAuthoringChanges({
      session,
      preview: diff,
      selectedChangeIds: [add.id],
      approval: approve(diff.candidateFingerprint),
    });
    expect(result).toMatchObject({ applied: true, draft: { revision: 1 } });
    if (!result.applied) throw new Error("적용되어야 합니다.");
    expect(result.draft.suite.cases.map((item) => item.id)).toEqual([
      "weather-success",
      "weather-missing-city",
      "weather-type-city",
      "echo-success",
      "echo-missing-text",
      "echo-type-text",
      "weather-error",
    ]);
    expect(result.draft.provenance).toContainEqual(
      expect.objectContaining({
        caseId: "weather-error",
        origin: "ai",
        providerId: "codex",
        firstRevision: 1,
        lastRevision: 1,
      }),
    );
    expect(Object.isFrozen(result.draft)).toBe(true);
  });

  it("호환되지 않는 order 선택을 원자적으로 거절한다", () => {
    const session = createAuthoringSession(baseline());
    const before = session.approvedDraft;
    const next = candidate(session);
    next.cases.push({
      id: "weather-error",
      name: "오류",
      operation: { type: "callTool", tool: "weather", input: { city: "Unknown" } },
      assertions: [{ type: "isError", expected: true }],
    });
    next.cases.reverse();
    const review = reviewLocalAuthoringCandidate({ session, candidate: next, tools });
    if (review.status !== "preview") throw new Error("preview");
    const diff = createAuthoringDiff({ session, candidate: review.preview });
    const order = diff.changes.find((change) => change.type === "caseOrder");
    if (order === undefined) throw new Error("order change가 필요합니다.");
    expect(
      applyAuthoringChanges({
        session,
        preview: diff,
        selectedChangeIds: [order.id],
        approval: approve(diff.candidateFingerprint),
      }),
    ).toMatchObject({ applied: false, reason: "incompatibleSelection" });
    expect(session.approvedDraft).toBe(before);
  });

  it("unknown change와 중복 selected ID를 거절한다", () => {
    const session = createAuthoringSession(baseline());
    const next = candidate(session);
    next.cases.push({
      id: "weather-error",
      name: "오류",
      operation: { type: "callTool", tool: "weather", input: { city: "Unknown" } },
      assertions: [{ type: "isError", expected: true }],
    });
    const review = reviewLocalAuthoringCandidate({ session, candidate: next, tools });
    if (review.status !== "preview") throw new Error("preview");
    const diff = createAuthoringDiff({ session, candidate: review.preview });
    const existing = diff.changes[0];
    if (existing === undefined) throw new Error("적어도 하나의 change가 필요합니다.");
    expect(
      applyAuthoringChanges({
        session,
        preview: diff,
        selectedChangeIds: ["unknown"],
        approval: approve(diff.candidateFingerprint),
      }),
    ).toMatchObject({ applied: false, reason: "unknownChange" });
    // 존재하는 change ID를 두 번 넘겨야 중복 검사 자체가 검증된다.
    expect(
      applyAuthoringChanges({
        session,
        preview: diff,
        selectedChangeIds: [existing.id, existing.id],
        approval: approve(diff.candidateFingerprint),
      }),
    ).toMatchObject({ applied: false, reason: "unknownChange" });
  });
  it("적용 결과가 세션에 전달된 도구 목록 밖의 도구를 남기면 거절한다", () => {
    const session = createAuthoringSession(baseline());
    // 서버가 echo 도구를 더는 제공하지 않는 상황. candidate는 echo case를 지웠지만
    // 사용자가 그 삭제를 선택하지 않으면 승인본에 echo case가 그대로 남는다.
    const next = candidate(session);
    // baseline 정책 v2 는 echo 툴에 정상 1개와 위반 2개를 만든다. 하나만 지우면 남은 케이스가
    // 선언되지 않은 툴을 부르게 되어 candidate 자체가 invalid 로 막힌다. 이 테스트가 보려는 것은
    // 그 앞이 아니라 "삭제를 선택하지 않은 승인본" 이므로 echo 케이스를 전부 지운다.
    next.cases = next.cases.filter(
      (item) => item.operation.type !== "callTool" || item.operation.tool !== "echo",
    );
    const review = reviewLocalAuthoringCandidate({
      session,
      candidate: next,
      tools: [tools[0] as ToolDef],
    });
    if (review.status !== "preview") throw new Error("preview");
    const diff = createAuthoringDiff({ session, candidate: review.preview });
    const result = applyAuthoringChanges({
      session,
      preview: diff,
      selectedChangeIds: [],
      approval: approve(diff.candidateFingerprint),
    });
    expect(result).toMatchObject({ applied: false, reason: "invalid" });
    if (result.applied) throw new Error("거절되어야 합니다.");
    // 승인본에 남은 echo 케이스는 v2 에서 셋이고 인덱스 3~5 다.
    expect(result.issues?.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "cases[3].operation.tool",
        "cases[4].operation.tool",
        "cases[5].operation.tool",
      ]),
    );
    expect(session.approvedDraft.revision).toBe(0);
  });

  it("suite identity와 unknown tool candidate를 거절한다", () => {
    const session = createAuthoringSession(baseline());
    const wrong = candidate(session);
    wrong.id = "other";
    expect(reviewLocalAuthoringCandidate({ session, candidate: wrong, tools })).toMatchObject({
      status: "invalid",
    });
    const unknown = candidate(session);
    const first = unknown.cases[0];
    if (first === undefined) throw new Error("weather case가 필요합니다.");
    (first.operation as { tool: string }).tool = "missing";
    expect(reviewLocalAuthoringCandidate({ session, candidate: unknown, tools })).toMatchObject({
      status: "invalid",
    });
    expect(session.approvedDraft.revision).toBe(0);
  });

  it("민감 입력이 redaction된 candidate는 적용하지 않는다", () => {
    const session = createAuthoringSession(baseline());
    const next = candidate(session);
    const first = next.cases[0];
    if (first === undefined) throw new Error("weather case가 필요합니다.");
    (first.operation as { input: Record<string, string> }).input = {
      password: "RAW_SENTINEL",
      city: "also-secret",
    };
    const review = reviewLocalAuthoringCandidate({
      session,
      candidate: next,
      tools,
      sensitiveValues: ["also-secret"],
    });
    if (review.status !== "preview") throw new Error("preview");
    expect(JSON.stringify(review.preview)).not.toContain("RAW_SENTINEL");
    expect(review.preview.executable).toBe(false);
    const diff = createAuthoringDiff({ session, candidate: review.preview });
    expect(
      applyAuthoringChanges({
        session,
        preview: diff,
        selectedChangeIds: diff.changes.map((item) => item.id),
        approval: approve(diff.candidateFingerprint),
      }),
    ).toMatchObject({ applied: false, reason: "redactionRequired" });
  });

  it("직접 편집도 같은 검증과 diff 경계를 사용한다", () => {
    const session = createAuthoringSession(baseline());
    const valid = candidate(session);
    valid.name = "직접 편집";
    expect(reviewLocalAuthoringCandidate({ session, candidate: valid, tools })).toMatchObject({
      status: "preview",
    });
    expect(
      reviewLocalAuthoringCandidate({ session, candidate: { ...valid, cases: [] }, tools }),
    ).toMatchObject({ status: "invalid", issues: expect.any(Array) });
  });

  it("오타·enum 위반·항상 참인 단언을 specFindings 로 보고한다", () => {
    const { session, next } = sessionWithCase(weatherBaselineTools, {
      id: "seoul-weather",
      name: "서울 날씨",
      operation: {
        type: "callTool",
        tool: "get_weather",
        input: { citi: "Seoul", units: "celsius" },
      },
      assertions: [{ type: "bodyMatchesSchema", schema: { type: "string", minLength: 0 } }],
    });
    const result = reviewLocalAuthoringCandidate({
      session,
      candidate: next,
      tools: weatherTools,
    });
    if (result.status !== "preview") throw new Error(`preview 가 아니다: ${result.status}`);
    expect(result.preview.specFindings.inputContract.findings.map((f) => f.code)).toEqual([
      "REQUIRED_MISSING",
      "UNDECLARED_FIELD",
      "ENUM_MISMATCH",
    ]);
    expect(result.preview.specFindings.assertionSubstance.findings.map((f) => f.code)).toEqual([
      "VACUOUS_MIN_LENGTH",
    ]);
  });

  it("치환된 민감 필드 때문에 TYPE_MISMATCH 가 나지 않는다", () => {
    // 이 테스트가 '검사를 치환 이전에 돌린다'는 설계의 유일한 근거다. 치환 이후로 옮기면
    // token 값이 '[REDACTED]' 문자열이 되어 number 선언과 어긋나 거짓 양성이 난다.
    const authTools: ToolDef[] = [
      {
        name: "auth",
        inputSchema: {
          type: "object",
          properties: { token: { type: "number" } },
          required: ["token"],
        },
      },
    ];
    const { session, next } = sessionWithCase(authTools, {
      id: "auth-case",
      name: "인증",
      operation: { type: "callTool", tool: "auth", input: { token: 12345 } },
      assertions: [{ type: "bodyMatchesSchema", schema: { type: "string", minLength: 1 } }],
    });
    const result = reviewLocalAuthoringCandidate({ session, candidate: next, tools: authTools });
    if (result.status !== "preview") throw new Error(`preview 가 아니다: ${result.status}`);
    expect(result.preview.specFindings.inputContract.findings).toEqual([]);
    // 치환이 실제로 일어났음을 함께 고정한다. 안 일어나면 이 회귀 테스트가 아무것도 안 지킨다.
    expect(result.preview.redactedPaths).toEqual(["cases[0].operation.input"]);
  });

  it("specFindings 는 fingerprint 를 바꾸지 않는다", () => {
    // 승인 지문 계약이 깨지지 않는 것을 고정한다. 상수는 T2 구현 이전 값이다.
    const session = createAuthoringSession(baseline());
    const result = reviewLocalAuthoringCandidate({ session, candidate: candidate(session), tools });
    if (result.status !== "preview") throw new Error(`preview 가 아니다: ${result.status}`);
    expect(result.preview.fingerprint).toBe(KNOWN_CLEAN_FINGERPRINT);
  });

  it("승인 fingerprint가 같은 draft만 execution snapshot으로 만든다", () => {
    const session = createAuthoringSession(baseline());
    expect(
      finalizeAuthoringDraft({
        session,
        approval: { approved: false, fingerprint: session.approvedDraft.suiteFingerprint },
      }),
    ).toMatchObject({ finalized: false, reason: "notApproved" });
    expect(finalizeAuthoringDraft({ session, approval: approve("wrong") })).toMatchObject({
      finalized: false,
      reason: "approvalInvalidated",
    });
    const finalized = finalizeAuthoringDraft({
      session,
      approval: approve(session.approvedDraft.suiteFingerprint),
    });
    expect(finalized).toMatchObject({ finalized: true });
    if (!finalized.finalized) throw new Error("snapshot");
    expect(Object.isFrozen(getAuthoringExecutionSuite(finalized.snapshot))).toBe(true);
    expect(() =>
      getAuthoringExecutionSuite({
        fingerprint: finalized.snapshot.fingerprint,
      } as typeof finalized.snapshot),
    ).toThrow();
  });

  it("로컬 경로의 specFindings 에 민감 값 원문이 남지 않는다", async () => {
    // 검사는 치환 이전 객체로 해야 거짓 양성이 안 나지만(ADR-0018), 그 결과를 그대로 실으면
    // 치환해서 감춘 값이 승인 화면의 경고 문장으로 되살아난다. provider 경로와 같은 함수로
    // 거른다.
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
    const { session, next } = sessionWithCase(leakyTools, {
      id: "units-case",
      name: "단위",
      operation: { type: "callTool", tool: "get_weather", input: { units: "secret-unit" } },
      assertions: [{ type: "bodyMatchesSchema", schema: { type: "string", minLength: 1 } }],
    });
    const result = reviewLocalAuthoringCandidate({
      session,
      candidate: next,
      tools: leakyTools,
      sensitiveValues: ["c", "secret-unit"],
    });
    if (result.status !== "preview") throw new Error(`preview 가 아니다: ${result.status}`);
    const finding = result.preview.specFindings.inputContract.findings[0];
    if (finding === undefined) throw new Error("ENUM_MISMATCH finding 이 필요합니다.");
    expect(finding.code).toBe("ENUM_MISMATCH");
    // 값 필드는 치환된다. expected 는 서버가 선언한 enum 목록이라 그 안의 'c' 도 샌다.
    expect(finding.expected).toEqual([REDACTED, "f"]);
    expect(finding.actual).toBe(REDACTED);
    // 이름은 치환하지 않는다. 무엇을 고쳐야 하는지가 사라지면 문장이 쓸모를 잃는다.
    expect(finding.path).toBe("input.units");
    expect(JSON.stringify(result.preview)).not.toContain("secret-unit");
    expect(describeSpecFinding(finding)).not.toContain("secret-unit");
  });
});
