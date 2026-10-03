/** 리포트·기준 파일 형식 버전. 필드를 더하거나 뜻을 바꾸면 올린다. */
export const AUDIT_SCHEMA_VERSION = 1 as const;

export type Severity = "high" | "medium" | "low" | "info";

export type RuleFamily =
  | "desc"
  | "schema"
  | "launch"
  | "protocol"
  | "surface"
  | "secret"
  | "result"
  | "flow";

/** `<family>/<name>` 형식. 규칙 목록은 각 가족 모듈의 `RULES` 상수가 정본이다. */
export type RuleId = `${RuleFamily}/${string}`;

export type Location =
  | {
      readonly kind: "tool";
      readonly toolIndex: number;
      readonly toolName: string;
      readonly path: string;
    }
  | { readonly kind: "prompt"; readonly name: string; readonly path: string }
  | { readonly kind: "resource"; readonly uri: string; readonly path: string }
  | { readonly kind: "instructions"; readonly path: "" }
  | { readonly kind: "launch"; readonly path: string }
  | { readonly kind: "protocol"; readonly path: "" }
  | { readonly kind: "surface"; readonly path: "" }
  | {
      readonly kind: "result";
      readonly toolIndex: number;
      readonly toolName: string;
      readonly path: string;
    }
  | { readonly kind: "server"; readonly path: "" };

export interface Finding {
  readonly ruleId: RuleId;
  readonly severity: Severity;
  readonly location: Location;
  /** 사람용 한 줄. "→ " 없이. 렌더러가 붙인다. */
  readonly message: string;
  /** 고치는 법 한 줄. "해결: " 없이. */
  readonly fix: string;
  /** 근거. 걸린 문자열 조각(최대 80자, 앞뒤 "…"), 정규화 단계 이름, 도구 이름 목록 등. 값은 비밀을 담지 않는다. */
  readonly evidence: readonly string[];
}

/** 규칙 하나의 정적 설명. 리포트의 "검사한 규칙" 절과 문서 생성에 쓴다. */
export interface RuleInfo {
  readonly id: RuleId;
  readonly family: RuleFamily;
  readonly defaultSeverity: Severity;
  /** 한 줄 설명. 한국어. */
  readonly summary: string;
}

/** 정규화 단계 이름. evidence 에 들어간다. */
export type TextForm = "raw" | "folded" | "base64" | "hex" | "rot13";

/** 수집된 문자열 하나. 규칙은 이것을 받는다. */
export interface CollectedString {
  readonly location: Location;
  readonly raw: string;
  /** 키 이름이면 true. 값이면 false. */
  readonly isKey: boolean;
}

export type ProbePolicy = "readonly" | "none" | "all";

export interface AuditTarget {
  /** stdio 면 command·args, http 면 url. launch 규칙이 본다. */
  readonly kind: "stdio" | "http";
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  /** 사용자가 실제 값을 넘기기로 한 env 이름. 카나리에서 빠지고 env-echo 대상이 된다. */
  readonly forwardedEnvNames: readonly string[];
  /** 사용자가 --header-env 로 넘긴 헤더 이름. protocol/unauthenticated 가 본다. */
  readonly headerNames: readonly string[];
}

export interface AuditOptions {
  readonly target: AuditTarget;
  readonly probe: ProbePolicy;
  /** 기준 파일 경로. 없으면 surface 가족을 건너뛴다. */
  readonly baselinePath?: string;
  readonly updateBaseline: boolean;
}

export interface ServerSummary {
  readonly name: string;
  readonly version: string;
  readonly toolCount: number;
  readonly promptCount: number;
  readonly resourceCount: number;
  readonly hasInstructions: boolean;
  readonly capabilityKeys: readonly string[];
}

/** 어떤 검사가 왜 돌지 않았는지. 조용한 통과를 막는 장치다. */
export interface Skipped {
  readonly family: RuleFamily;
  readonly reason: string;
}

export interface AuditReport {
  readonly schemaVersion: typeof AUDIT_SCHEMA_VERSION;
  readonly generator: { readonly name: "@mcpeak/audit"; readonly version: string };
  readonly server: ServerSummary;
  readonly probe: ProbePolicy;
  /** 호출한 도구 이름(정렬). */
  readonly probedTools: readonly string[];
  readonly findings: readonly Finding[];
  readonly skipped: readonly Skipped[];
  /** 심각도별 개수. flow 는 세지 않는다. */
  readonly counts: {
    readonly high: number;
    readonly medium: number;
    readonly low: number;
    readonly info: number;
  };
  /** §3.8 */
  readonly exitCode: 0 | 2;
}

export interface BaselineTool {
  readonly name: string;
  readonly hash: string;
}

export interface AuditBaseline {
  readonly schemaVersion: typeof AUDIT_SCHEMA_VERSION;
  readonly server: { readonly name: string; readonly version: string };
  readonly tools: readonly BaselineTool[];
  readonly surfaceHash: string;
  readonly launch?: {
    readonly command: string;
    readonly args: readonly string[];
    readonly package?: {
      readonly manager: "npm" | "pypi";
      readonly name: string;
      readonly version?: string;
    };
  };
}

export type AuditErrorCode = "CONNECT_FAILED" | "BASELINE_UNREADABLE" | "BASELINE_SERVER_MISMATCH";

export class AuditError extends Error {
  constructor(
    readonly code: AuditErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuditError";
  }
}

/** tools/list 의 원시 객체. core 의 `RawTool` 과 같은 꼴이다(§5.3). */
export type RawTool = Record<string, unknown> & { readonly name: string };
