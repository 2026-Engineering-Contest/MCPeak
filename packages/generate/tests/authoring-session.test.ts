import type { ToolDef } from "@ohmymcp/core";
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
    expect(changes[2]).toMatchObject({
      caseId: "echo-success",
      approvedIndex: 1,
      after: { name: "echo 수정" },
    });
    expect(changes[3]).toMatchObject({ caseId: "weather-error", candidateIndex: 1 });
    expect(changes[4]).toMatchObject({
      before: ["weather-success", "echo-success"],
      after: ["echo-success", "weather-error"],
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
      "echo-success",
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
    const review = reviewLocalAuthoringCandidate({ session, candidate: candidate(session), tools });
    if (review.status !== "preview") throw new Error("preview");
    const diff = createAuthoringDiff({ session, candidate: review.preview });
    expect(
      applyAuthoringChanges({
        session,
        preview: diff,
        selectedChangeIds: ["unknown"],
        approval: approve(diff.candidateFingerprint),
      }),
    ).toMatchObject({ applied: false, reason: "unknownChange" });
    expect(
      applyAuthoringChanges({
        session,
        preview: diff,
        selectedChangeIds: ["change-001", "change-001"],
        approval: approve(diff.candidateFingerprint),
      }),
    ).toMatchObject({ applied: false, reason: "unknownChange" });
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
});
