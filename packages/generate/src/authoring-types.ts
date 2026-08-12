import type {
  RunnerRedactionOptions,
  SuiteValidationIssue,
  TestCaseSpec,
  TestSuiteSpec,
} from "@ohmymcp/runner";

export type TestCaseOrigin = "schemaBaseline" | "ai" | "user";
export interface CaseProvenance {
  readonly caseId: string;
  readonly origin: TestCaseOrigin;
  readonly providerId?: "codex" | "claude";
  readonly firstRevision: number;
  readonly lastRevision: number;
}
export interface AuthoringDraft {
  readonly revision: number;
  readonly suite: TestSuiteSpec;
  readonly suiteFingerprint: string;
  readonly baselineFingerprint: string;
  readonly provenance: readonly CaseProvenance[];
}
export interface SanitizedAuthoringCandidate {
  readonly result: {
    readonly status: "candidate";
    readonly suite: TestSuiteSpec;
    readonly questions: readonly string[];
  };
  readonly byteLength: number;
  readonly redactedPaths: readonly string[];
  readonly executable: boolean;
  readonly requiresApproval: true;
  readonly fingerprint: string;
  readonly binding: AuthoringCandidateBinding;
}
export interface AuthoringSessionView {
  readonly baseline: AuthoringDraft;
  readonly approvedDraft: AuthoringDraft;
  readonly workingCandidate?: SanitizedAuthoringCandidate;
}
declare const candidateBrand: unique symbol;
export interface AuthoringCandidateBinding {
  readonly [candidateBrand]: true;
}
declare const snapshotBrand: unique symbol;
export interface AuthoringExecutionSnapshot {
  readonly [snapshotBrand]: true;
  readonly fingerprint: string;
}
export interface GenerateReviewApproval {
  readonly approved: boolean;
  readonly fingerprint: string;
}
export type PublicProviderValidationIssue = Pick<
  SuiteValidationIssue,
  "code" | "path" | "message" | "hint"
>;
export type AuthoringChange =
  | {
      readonly id: string;
      readonly type: "suiteMetadata";
      readonly before: { readonly name: string; readonly defaultTimeoutMs?: number };
      readonly after: { readonly name: string; readonly defaultTimeoutMs?: number };
    }
  | {
      readonly id: string;
      readonly type: "addCase";
      readonly caseId: string;
      readonly candidateIndex: number;
      readonly case: TestCaseSpec;
    }
  | {
      readonly id: string;
      readonly type: "replaceCase";
      readonly caseId: string;
      readonly approvedIndex: number;
      readonly before: TestCaseSpec;
      readonly after: TestCaseSpec;
    }
  | {
      readonly id: string;
      readonly type: "removeCase";
      readonly caseId: string;
      readonly approvedIndex: number;
      readonly case: TestCaseSpec;
    }
  | {
      readonly id: string;
      readonly type: "caseOrder";
      readonly before: readonly string[];
      readonly after: readonly string[];
    };
export interface AuthoringDiffPreview {
  readonly changes: readonly AuthoringChange[];
  readonly candidate: TestSuiteSpec;
  readonly candidateFingerprint: string;
  readonly requiresApproval: true;
  readonly binding: AuthoringCandidateBinding;
}
export type LocalCandidateReviewResult =
  | { readonly status: "preview"; readonly preview: SanitizedAuthoringCandidate }
  | { readonly status: "questions"; readonly questions: readonly string[] }
  | { readonly status: "invalid"; readonly issues: readonly PublicProviderValidationIssue[] };
export interface LocalCandidateReviewOptions {
  readonly session: AuthoringSessionView;
  readonly candidate?: unknown;
  readonly questions?: readonly string[];
  readonly tools: readonly { readonly name: string }[];
  readonly providerId?: "codex" | "claude";
  readonly sensitiveValues?: readonly string[];
  readonly redaction?: RunnerRedactionOptions;
}
export type ApplyAuthoringChangesResult =
  | { readonly applied: true; readonly draft: AuthoringDraft }
  | {
      readonly applied: false;
      readonly reason:
        | "notApproved"
        | "approvalInvalidated"
        | "unknownChange"
        | "incompatibleSelection"
        | "invalid"
        | "redactionRequired";
      readonly issues?: readonly PublicProviderValidationIssue[];
    };
export type FinalizeAuthoringResult =
  | { readonly finalized: true; readonly snapshot: AuthoringExecutionSnapshot }
  | {
      readonly finalized: false;
      readonly reason: "notApproved" | "approvalInvalidated" | "invalid" | "redactionRequired";
      readonly issues?: readonly PublicProviderValidationIssue[];
    };
