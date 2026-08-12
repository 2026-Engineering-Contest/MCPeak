import type { TestCaseSpec, TestSuiteSpec } from "@ohmymcp/runner";
import { validateMcpSuite } from "@ohmymcp/runner";
import type {
  ApplyAuthoringChangesResult,
  AuthoringCandidateBinding,
  AuthoringChange,
  AuthoringDiffPreview,
  AuthoringDraft,
  AuthoringExecutionSnapshot,
  AuthoringSessionView,
  CaseProvenance,
  FinalizeAuthoringResult,
  GenerateReviewApproval,
  LocalCandidateReviewOptions,
  LocalCandidateReviewResult,
  PublicProviderValidationIssue,
  SanitizedAuthoringCandidate,
} from "./authoring-types.js";
import type { BaselineGenerationResult } from "./baseline.js";
import { deepFreeze, sha256 } from "./canonical.js";
import { redactAuthoringSuite } from "./redaction.js";

type SessionState = {
  baseline: AuthoringDraft;
  approved: AuthoringDraft;
  working?: SanitizedAuthoringCandidate;
};
const sessions = new WeakMap<AuthoringSessionView, SessionState>();
const candidates = new WeakMap<
  SanitizedAuthoringCandidate,
  {
    suite: TestSuiteSpec;
    providerId?: "codex" | "claude";
    /** 이 candidate를 검토할 때 호출자가 준 도구 목록. 적용 단계 allowlist의 근거다. */
    tools: readonly { readonly name: string }[];
  }
>();
const diffs = new WeakMap<AuthoringDiffPreview, SanitizedAuthoringCandidate>();
const snapshots = new WeakMap<AuthoringExecutionSnapshot, TestSuiteSpec>();
const binding = () => deepFreeze({} as AuthoringCandidateBinding);
const issues = (input: unknown): readonly PublicProviderValidationIssue[] => {
  const result = validateMcpSuite(input);
  return result.valid
    ? []
    : result.issues.map(({ code, path, message, hint }) => ({ code, path, message, hint }));
};
const cloneFreeze = <T>(value: T): T => deepFreeze(structuredClone(value));
function draft(
  suite: TestSuiteSpec,
  revision: number,
  baselineFingerprint: string,
  provenance: readonly CaseProvenance[],
): AuthoringDraft {
  const frozenSuite = cloneFreeze(suite);
  return deepFreeze({
    revision,
    suite: frozenSuite,
    suiteFingerprint: sha256(frozenSuite),
    baselineFingerprint,
    provenance: cloneFreeze(provenance),
  });
}
function state(session: AuthoringSessionView): SessionState | undefined {
  return sessions.get(session);
}
function knownTools(
  suite: TestSuiteSpec,
  tools: readonly { readonly name: string }[],
): readonly PublicProviderValidationIssue[] {
  const names = new Set(tools.map((tool) => tool.name));
  const invalid: PublicProviderValidationIssue[] = [];
  suite.cases.forEach((item, index) => {
    if (item.operation.type === "callTool" && !names.has(item.operation.tool))
      invalid.push({
        code: "INVALID_VALUE",
        path: `cases[${index}].operation.tool`,
        message: "허용되지 않은 MCP 도구를 사용했습니다.",
        hint: "전달된 도구 목록의 이름만 사용하세요.",
      });
  });
  return invalid;
}
function candidateFor(options: LocalCandidateReviewOptions): LocalCandidateReviewResult {
  const current = state(options.session);
  if (current === undefined) return { status: "invalid", issues: [] };
  if (options.questions !== undefined)
    return {
      status: "questions",
      questions: cloneFreeze(
        options.questions.filter((item) => typeof item === "string" && /\S/.test(item)),
      ),
    };
  const validation = issues(options.candidate);
  if (validation.length > 0) return { status: "invalid", issues: validation };
  const value = options.candidate as TestSuiteSpec;
  if (
    value.id !== current.approved.suite.id ||
    value.schemaVersion !== current.approved.suite.schemaVersion
  )
    return {
      status: "invalid",
      issues: [
        {
          code: "INVALID_VALUE",
          path: "id",
          message: "session suite identity가 일치하지 않습니다.",
          hint: "새 session을 만들거나 현재 suite identity를 유지하세요.",
        },
      ],
    };
  const toolIssues = knownTools(value, options.tools);
  if (toolIssues.length > 0) return { status: "invalid", issues: toolIssues };
  const redacted = redactAuthoringSuite(value, {
    ...options.redaction,
    sensitiveValues: options.sensitiveValues ?? options.redaction?.sensitiveValues,
  });
  const frozenSuite = cloneFreeze(redacted.suite);
  const preview = deepFreeze({
    result: { status: "candidate" as const, suite: frozenSuite, questions: [] },
    byteLength: Buffer.byteLength(JSON.stringify(frozenSuite)),
    redactedPaths: cloneFreeze(redacted.redactedPaths),
    executable: redacted.redactedPaths.length === 0,
    requiresApproval: true as const,
    fingerprint: sha256(frozenSuite),
    binding: binding(),
  });
  candidates.set(preview, {
    suite: frozenSuite,
    providerId: options.providerId,
    tools: cloneFreeze(options.tools.map((tool) => ({ name: tool.name }))),
  });
  current.working = preview;
  return { status: "preview", preview };
}

/** baseline에서 revision 0의 불변 검토 session을 만든다. */
export function createAuthoringSession(baseline: BaselineGenerationResult): AuthoringSessionView {
  const base = draft(
    baseline.suite,
    0,
    baseline.baselineFingerprint,
    baseline.suite.cases.map((item) => ({
      caseId: item.id,
      origin: "schemaBaseline" as const,
      firstRevision: 0,
      lastRevision: 0,
    })),
  );
  let view!: AuthoringSessionView;
  view = Object.freeze({
    get baseline() {
      return base;
    },
    get approvedDraft() {
      const current = sessions.get(view);
      if (current === undefined) throw new TypeError("등록되지 않은 authoring session입니다.");
      return current.approved;
    },
    get workingCandidate() {
      const current = sessions.get(view);
      if (current === undefined) throw new TypeError("등록되지 않은 authoring session입니다.");
      return current.working;
    },
  });
  sessions.set(view, { baseline: base, approved: base });
  return view;
}
export function reviewLocalAuthoringCandidate(
  options: LocalCandidateReviewOptions,
): LocalCandidateReviewResult {
  return candidateFor(options);
}
export function createAuthoringDiff(options: {
  session: AuthoringSessionView;
  candidate: SanitizedAuthoringCandidate;
}): AuthoringDiffPreview {
  const current = state(options.session);
  const stored = candidates.get(options.candidate);
  if (current === undefined || stored === undefined)
    throw new TypeError("등록되지 않은 authoring candidate입니다.");
  const before = current.approved.suite;
  const after = stored.suite;
  const changes: AuthoringChange[] = [];
  let number = 1;
  const id = () => `change-${String(number++).padStart(3, "0")}`;
  if (before.name !== after.name || before.defaultTimeoutMs !== after.defaultTimeoutMs)
    changes.push({
      id: id(),
      type: "suiteMetadata",
      before: { name: before.name, defaultTimeoutMs: before.defaultTimeoutMs },
      after: { name: after.name, defaultTimeoutMs: after.defaultTimeoutMs },
    });
  const afterById = new Map(after.cases.map((item) => [item.id, item]));
  const beforeById = new Map(before.cases.map((item) => [item.id, item]));
  before.cases.forEach((item, approvedIndex) => {
    if (!afterById.has(item.id))
      changes.push({ id: id(), type: "removeCase", caseId: item.id, approvedIndex, case: item });
  });
  before.cases.forEach((item, approvedIndex) => {
    const replacement = afterById.get(item.id);
    if (replacement !== undefined && sha256(item) !== sha256(replacement))
      changes.push({
        id: id(),
        type: "replaceCase",
        caseId: item.id,
        approvedIndex,
        before: item,
        after: replacement,
      });
  });
  after.cases.forEach((item, candidateIndex) => {
    if (!beforeById.has(item.id))
      changes.push({ id: id(), type: "addCase", caseId: item.id, candidateIndex, case: item });
  });
  const beforeOrder = before.cases.map((item) => item.id);
  const afterOrder = after.cases.map((item) => item.id);
  if (sha256(beforeOrder) !== sha256(afterOrder))
    changes.push({ id: id(), type: "caseOrder", before: beforeOrder, after: afterOrder });
  const preview = deepFreeze({
    changes: cloneFreeze(changes),
    candidate: cloneFreeze(after),
    candidateFingerprint: options.candidate.fingerprint,
    requiresApproval: true as const,
    binding: options.candidate.binding,
  });
  diffs.set(preview, options.candidate);
  return preview;
}
export function applyAuthoringChanges(options: {
  session: AuthoringSessionView;
  preview: AuthoringDiffPreview;
  selectedChangeIds: readonly string[];
  approval: GenerateReviewApproval;
}): ApplyAuthoringChangesResult {
  const current = state(options.session);
  const candidate = diffs.get(options.preview);
  if (
    current === undefined ||
    candidate === undefined ||
    options.preview.candidateFingerprint !== candidate.fingerprint
  )
    return { applied: false, reason: "approvalInvalidated" };
  if (!options.approval.approved) return { applied: false, reason: "notApproved" };
  if (options.approval.fingerprint !== options.preview.candidateFingerprint)
    return { applied: false, reason: "approvalInvalidated" };
  if (!candidate.executable) return { applied: false, reason: "redactionRequired" };
  const ids = new Set(options.selectedChangeIds);
  if (
    ids.size !== options.selectedChangeIds.length ||
    [...ids].some((item) => !options.preview.changes.some((change) => change.id === item))
  )
    return { applied: false, reason: "unknownChange" };
  const selected = options.preview.changes.filter((change) => ids.has(change.id));
  const next = structuredClone(current.approved.suite);
  for (const change of selected) {
    if (change.type === "suiteMetadata") {
      next.name = change.after.name;
      next.defaultTimeoutMs = change.after.defaultTimeoutMs;
    }
  }
  for (const change of selected)
    if (change.type === "removeCase")
      next.cases = next.cases.filter((item) => item.id !== change.caseId);
  for (const change of selected)
    if (change.type === "replaceCase") {
      const index = next.cases.findIndex((item) => item.id === change.caseId);
      if (index >= 0) next.cases[index] = structuredClone(change.after);
    }
  for (const change of selected)
    if (change.type === "addCase")
      next.cases.splice(
        Math.min(change.candidateIndex, next.cases.length),
        0,
        structuredClone(change.case),
      );
  const order = selected.find((change) => change.type === "caseOrder");
  if (order?.type === "caseOrder") {
    const existing = new Set(next.cases.map((item) => item.id));
    if (existing.size !== order.after.length || order.after.some((item) => !existing.has(item)))
      return { applied: false, reason: "incompatibleSelection" };
    const byId = new Map(next.cases.map((item) => [item.id, item]));
    const ordered = order.after.map((caseId) => byId.get(caseId));
    if (ordered.some((item) => item === undefined))
      return { applied: false, reason: "incompatibleSelection" };
    next.cases = ordered as TestCaseSpec[];
  }
  const validation = issues(next);
  if (validation.length > 0) return { applied: false, reason: "invalid", issues: validation };
  const stored = candidates.get(candidate);
  if (stored === undefined) return { applied: false, reason: "approvalInvalidated" };
  // allowlist는 검사 대상 suite가 아니라 호출자가 준 도구 목록에서 온다.
  // 대상 자신에서 만들면 검사가 항상 통과하는 죽은 코드가 된다.
  const toolIssues = knownTools(next, stored.tools);
  if (toolIssues.length > 0) return { applied: false, reason: "invalid", issues: toolIssues };
  const revision = current.approved.revision + 1;
  const changed = new Set(
    selected
      .filter((item) => item.type === "addCase" || item.type === "replaceCase")
      .map((item) => item.caseId),
  );
  const provenance = next.cases.map((item) => {
    const old = current.approved.provenance.find((entry) => entry.caseId === item.id);
    return changed.has(item.id)
      ? {
          caseId: item.id,
          origin: stored.providerId === undefined ? ("user" as const) : ("ai" as const),
          ...(stored.providerId === undefined ? {} : { providerId: stored.providerId }),
          firstRevision: old?.firstRevision ?? revision,
          lastRevision: revision,
        }
      : (old ?? {
          caseId: item.id,
          origin: "user" as const,
          firstRevision: revision,
          lastRevision: revision,
        });
  });
  const approved = draft(next, revision, current.approved.baselineFingerprint, provenance);
  current.approved = approved;
  current.working = candidate;
  return { applied: true, draft: approved };
}
export function finalizeAuthoringDraft(options: {
  session: AuthoringSessionView;
  approval: GenerateReviewApproval;
}): FinalizeAuthoringResult {
  const current = state(options.session);
  if (current === undefined || !options.approval.approved)
    return { finalized: false, reason: "notApproved" };
  if (options.approval.fingerprint !== current.approved.suiteFingerprint)
    return { finalized: false, reason: "approvalInvalidated" };
  const validation = issues(current.approved.suite);
  if (validation.length > 0) return { finalized: false, reason: "invalid", issues: validation };
  const snapshot = deepFreeze({
    fingerprint: current.approved.suiteFingerprint,
  } as AuthoringExecutionSnapshot);
  snapshots.set(snapshot, current.approved.suite);
  return { finalized: true, snapshot };
}
export function getAuthoringExecutionSuite(snapshot: AuthoringExecutionSnapshot): TestSuiteSpec {
  const suite = snapshots.get(snapshot);
  if (suite === undefined) throw new TypeError("등록되지 않은 execution snapshot입니다.");
  return suite;
}
