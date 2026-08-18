import type { ToolDef } from "@ohmymcp-hsu/core";
import type { TestCaseSpec, TestSuiteSpec } from "@ohmymcp-hsu/runner";
import { checkAssertionSubstance, checkInputContract, validateMcpSuite } from "@ohmymcp-hsu/runner";
import type {
  ApplyAuthoringChangesResult,
  AuthoringCandidateBinding,
  AuthoringChange,
  AuthoringDiffPreview,
  AuthoringDraft,
  AuthoringExecutionSnapshot,
  AuthoringSessionView,
  CandidateSpecFindings,
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
import { redactAuthoringSuite, sanitizeRedactable } from "./redaction.js";

/**
 * finding 한 건과 그 코드. `SpecFindingsResult` 에서 뽑아 쓴다. `runner` 에서 새 심볼을
 * 가져오면 ADR-0009 의 승인 목록을 넓혀야 하는데, 이미 승인된 타입에서 파생되는 것이라
 * 새 의존이 아니다.
 */
type SpecFinding = CandidateSpecFindings["inputContract"]["findings"][number];
type SpecFindingCode = SpecFinding["code"];

/**
 * 코드의 `expected` · `actual` · `suggestion` 이 **값**을 담는지. `Record` 라서 `runner` 가
 * 코드를 늘리면 여기서 타입 오류가 난다. 배열로 두면 값을 담는 새 코드가 조용히 치환을
 * 빠져나가고, 그것은 치환해서 감춘 값이 화면에 뜨는 결과가 된다.
 *
 * 값을 담는 것은 `ENUM_MISMATCH` 하나다. `expected` 는 서버가 선언한 enum 값 목록,
 * `actual` 은 명세에 적힌 입력 값, `suggestion` 은 그 목록에서 고른 문자열이다. 나머지는
 * 전부 툴 이름·필드 이름·타입 이름이라 치환 대상이 아니다. 이름까지 가리면 무엇을 고쳐야
 * 하는지가 사라져 문장이 쓸모를 잃는다. `path` 도 같은 이유로 건드리지 않는다.
 */
const CARRIES_VALUE: Readonly<Record<SpecFindingCode, boolean>> = {
  TOOL_NOT_DECLARED: false,
  SCHEMA_NOT_ANALYZABLE: false,
  REQUIRED_MISSING: false,
  UNDECLARED_FIELD: false,
  TYPE_MISMATCH: false,
  ENUM_MISMATCH: true,
  REJECTION_WITHOUT_VIOLATION: false,
  // actual 이 명세에 적힌 입력 값이라 ENUM_MISMATCH 와 같은 범주다. expected 는 서버가 선언한
  // 범위라 감출 것이 없으나, 치환 단위가 finding 하나이므로 함께 지나간다. 숫자 경계는
  // sanitizeRedactable 의 대상이 아니라 문장이 그대로 남는다.
  RANGE_MISMATCH: true,
  VACUOUS_MIN_LENGTH: false,
  VACUOUS_MIN_ITEMS: false,
};

/** 치환 옵션. `redactAuthoringSuite` 에 넘기는 것과 같은 값을 그대로 쓴다. */
type RedactionOptions = Parameters<typeof redactAuthoringSuite>[1];

/**
 * finding 의 값 필드를 치환한다. 검사 자체는 값 치환 **이전** 객체로 해야 `TYPE_MISMATCH` ·
 * `ENUM_MISMATCH` 거짓 양성이 안 난다(ADR-0018). 그런데 그 결과를 그대로 candidate 에 실으면
 * 치환해서 감춘 값이 승인 화면의 경고 문장으로 되살아난다. 검사와 표시 사이에서 한 번 걸러
 * 둘을 모두 만족시킨다.
 *
 * 치환 정책을 새로 만들지 않는다. `redactAuthoringSuite` 가 쓰는 것과 같은
 * `sanitizeRedactable` 을 부르므로 `sensitiveValues` 와 `DEFAULT_SENSITIVE_KEYS` 가 그대로
 * 적용된다. 두 후보 경로(로컬 · provider)가 이 함수 하나를 공유한다.
 */
export function redactSpecFindings(
  result: CandidateSpecFindings["inputContract"],
  options: RedactionOptions,
): CandidateSpecFindings["inputContract"] {
  const value = (input: SpecFinding["actual"]): SpecFinding["actual"] =>
    input === undefined ? undefined : (sanitizeRedactable(input, options) as SpecFinding["actual"]);
  return {
    findings: result.findings.map((finding) => {
      if (!CARRIES_VALUE[finding.code]) return finding;
      // 키가 없던 것을 만들지 않는다. 소비자가 존재 여부로 분기한다(input-contract.ts 의
      // withSuggestion 과 같은 계약이다).
      return {
        ...finding,
        ...(finding.expected === undefined ? {} : { expected: value(finding.expected) }),
        ...(finding.actual === undefined ? {} : { actual: value(finding.actual) }),
        ...(finding.suggestion === undefined
          ? {}
          : { suggestion: String(sanitizeRedactable(finding.suggestion, options)) }),
      };
    }),
    totalFindings: result.totalFindings,
  };
}

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
  // 검사는 값 치환 이전 객체로 한다. 치환 후에 하면 숫자 필드가 '[REDACTED]' 문자열이 되어
  // TYPE_MISMATCH 거짓 양성이 난다. 설계 문서 §3.
  // value 는 여기서 이미 validateMcpSuite · identity · 툴 allowlist 를 통과했다. 그 앞으로
  // 옮기면 검증 안 된 객체가 검사 안으로 들어가 던진다.
  const contractTools: ToolDef[] = options.tools.map((tool) => ({
    name: tool.name,
    inputSchema: tool.inputSchema,
  }));
  // suite 치환과 finding 치환이 같은 옵션을 써야 한다. 두 벌로 두면 한쪽만 고쳐져 조용히
  // 어긋난다.
  const redaction = {
    ...options.redaction,
    sensitiveValues: options.sensitiveValues ?? options.redaction?.sensitiveValues,
  };
  // 검사는 치환 이전 객체로 하고(ADR-0018), 결과를 싣기 직전에 값 필드만 치환한다.
  const specFindings = deepFreeze({
    inputContract: redactSpecFindings(
      checkInputContract({ suite: value, tools: contractTools }),
      redaction,
    ),
    assertionSubstance: redactSpecFindings(checkAssertionSubstance(value), redaction),
  });
  const redacted = redactAuthoringSuite(value, redaction);
  const frozenSuite = cloneFreeze(redacted.suite);
  const preview = deepFreeze({
    result: { status: "candidate" as const, suite: frozenSuite, questions: [] },
    byteLength: Buffer.byteLength(JSON.stringify(frozenSuite)),
    redactedPaths: cloneFreeze(redacted.redactedPaths),
    executable: redacted.redactedPaths.length === 0,
    requiresApproval: true as const,
    fingerprint: sha256(frozenSuite),
    specFindings,
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
export function createAuthoringSession(
  baseline: BaselineGenerationResult,
  options?: {
    /**
     * AI 사전보완 값을 채택한 케이스의 id. 그 케이스만 origin 이
     * `schemaBaselinePreFilled` 가 된다.
     *
     * `baseline.suite` 는 이미 채택 값이 반영된 것을 넘긴다. 여기서 값을 바꾸지 않는다.
     * 채택 판정은 실제 서버가 하고(ADR-0025) 이 함수는 그 결과를 기록만 한다.
     */
    readonly preFilledCaseIds?: readonly string[];
  },
): AuthoringSessionView {
  const preFilled = new Set(options?.preFilledCaseIds ?? []);
  const base = draft(
    baseline.suite,
    0,
    // 사전보완을 해도 이 값은 그대로다. 이것은 "어느 규칙 baseline 에서 나왔나" 이고,
    // 같은 서버 선언을 다시 돌리면 여전히 같은 값이 나온다.
    baseline.baselineFingerprint,
    baseline.suite.cases.map((item) => ({
      caseId: item.id,
      origin: preFilled.has(item.id)
        ? ("schemaBaselinePreFilled" as const)
        : ("schemaBaseline" as const),
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
