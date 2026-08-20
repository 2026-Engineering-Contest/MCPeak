import type {
  RunnerRedactionOptions,
  SpecFindingsResult,
  SuiteValidationIssue,
  TestCaseSpec,
  TestSuiteSpec,
} from "@mcpeak/runner";

/**
 * 승인 화면이 읽는 비차단 진단. 두 검사를 병합하지 않고 따로 담는다. 병합하면 두 검사 사이의
 * 정렬 정책을 새로 정해야 하고 totalFindings 둘을 어떻게 합칠지가 애매해진다. 나누면 각 검사의
 * 기존 정렬과 totalFindings 가 뜻을 그대로 유지한다.
 *
 * 지문(fingerprint) 계산 대상이 아니다. 계산에 넣으면 승인된 지문이 전부 어긋난다.
 */
export interface CandidateSpecFindings {
  readonly inputContract: SpecFindingsResult;
  readonly assertionSubstance: SpecFindingsResult;
}

/**
 * 케이스가 어디서 왔는가.
 *
 * `schemaBaselinePreFilled` 는 규칙 baseline 이 만든 케이스에 AI 사전보완 값이 채택된 것이다.
 * `schemaBaseline` 과 나누는 이유는 그 케이스의 입력이 더는 규칙만으로 재현되지 않기 때문이다.
 * 같은 것으로 적으면 "같은 서버 선언이면 같은 값이 나온다" 가 기록 위에서 거짓이 된다.
 * `ai` 와도 나눈다. 그쪽은 AI 가 케이스 자체를 만든 것이고 이쪽은 값 하나만 바뀐 것이다.
 */
export type TestCaseOrigin = "schemaBaseline" | "schemaBaselinePreFilled" | "ai" | "user";
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
    /**
     * provider가 보고한 요약과 경고. 로컬 검토 경로(reviewLocalAuthoringCandidate)는 provider
     * 응답 없이 candidate를 만들므로 두 필드가 없다. 그래서 optional이다.
     */
    readonly summary?: string;
    readonly warnings?: readonly string[];
  };
  readonly byteLength: number;
  readonly redactedPaths: readonly string[];
  readonly executable: boolean;
  readonly requiresApproval: true;
  readonly fingerprint: string;
  /**
   * 값 치환 이전 객체로 돌린 비차단 진단. result 안에 두지 않는다. fingerprint 가 result 의
   * suite 로 계산되므로 안에 넣으면 이미 승인된 지문이 전부 어긋난다.
   */
  readonly specFindings: CandidateSpecFindings;
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
  /**
   * 서버가 선언한 도구 목록. 입력 계약 대조에 inputSchema 가 필요해 optional 로 열어 뒀다.
   * 없으면 그 도구는 SCHEMA_NOT_ANALYZABLE 하나만 나고 다른 검사를 건너뛴다. 기존 호출자가
   * 이름만 넘기던 계약은 그대로 유효하다.
   */
  readonly tools: readonly {
    readonly name: string;
    readonly description?: string;
    readonly inputSchema?: unknown;
  }[];
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
