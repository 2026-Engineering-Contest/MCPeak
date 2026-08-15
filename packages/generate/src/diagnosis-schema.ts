import type { McpToolContext } from "./authoring-request.js";
import type { JsonValue } from "./schema.js";

export interface DiagnosisDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly expected?: JsonValue;
  readonly actual?: JsonValue;
  readonly notes?: readonly string[];
}

export interface DiagnosisFailure {
  readonly caseId: string;
  readonly caseName: string;
  readonly tool?: string;
  readonly input?: Readonly<Record<string, JsonValue>>;
  readonly approvedAs?: "passed" | "serverDefect";
  readonly diagnostics: readonly DiagnosisDiagnostic[];
}

export interface DiagnosisProcessDiagnostics {
  readonly stderr: string;
  readonly stderrTruncated: boolean;
  readonly exitCode: number | null;
  readonly signal: string | null;
}

export interface DiagnosisRequest {
  /** 명세가 오라클 자격을 가지는가. 프롬프트 역할 문장이 이 값으로 갈린다. 설계서 §5.4. */
  readonly specApproved: boolean;
  readonly suite: { readonly id: string; readonly name: string };
  readonly failures: readonly DiagnosisFailure[];
  readonly processDiagnostics?: DiagnosisProcessDiagnostics;
  readonly tools: readonly McpToolContext[];
}

export interface DiagnosisCause {
  readonly caseId: string;
  readonly summary: string;
  readonly location: string;
  readonly evidence: string;
  readonly target: "server" | "spec";
}

export type DiagnosisResult =
  | {
      readonly status: "diagnosis";
      readonly causes: readonly DiagnosisCause[];
      /** 검증에서 버린 항목 수. 화면이 이 값을 표시한다. 설계서 §5.6. */
      readonly discarded: number;
    }
  | { readonly status: "unsure"; readonly shortfall: string; readonly discarded: number };

export interface ServerDiagnosisProvider {
  readonly id: "codex" | "claude";
  readonly model?: string;
  diagnose(
    request: DiagnosisRequest,
    options: { signal?: AbortSignal; timeoutMs: number },
  ): Promise<unknown>;
}

/** 원인 항목 문자열 상한. 한 항목이 터미널 한 화면을 밀어내지 않게 한다. 설계서 §5.6-5. */
export const MAX_CAUSE_CHARS = 500;

const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
};

/**
 * provider(Codex/Claude) 전송 전용 진단 출력 스키마.
 * ADR-0007 제약을 지킨다: 최상위 oneOf·anyOf·not 없음, $ref/$defs 없음, 재귀 없음,
 * nullable 없음. 문자열 제약은 pattern 만 쓴다(minLength/minItems 는 CLI별 지원이 불확실).
 */
export const DIAGNOSIS_PROVIDER_SCHEMA = freeze({
  type: "object",
  additionalProperties: false,
  required: ["status", "causes", "shortfall"],
  properties: {
    status: { enum: ["diagnosis", "unsure"] },
    causes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["caseId", "summary", "location", "evidence", "target"],
        properties: {
          caseId: { type: "string", pattern: "\\S" },
          summary: { type: "string", pattern: "\\S" },
          location: { type: "string" },
          evidence: { type: "string" },
          target: { enum: ["server", "spec"] },
        },
      },
    },
    // status 가 unsure 일 때만 채운다. 아니면 빈 문자열.
    shortfall: { type: "string" },
  },
});
