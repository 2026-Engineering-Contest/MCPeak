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

/** 검증에서 버린 원인 후보 수. 각 후보는 먼저 걸린 사유 하나에만 집계한다. */
export interface DiagnosisDiscarded {
  /** 요청에 담긴 실패 목록에 없는 caseId 를 가리킨 후보. */
  readonly unknownCase: number;
  /** 승인된 명세를 고치라고 한 후보. */
  readonly specTarget: number;
  /** status: unsure 와 함께 와서 사용할 수 없었던 후보. */
  readonly unsureCauses: number;
}

export type DiagnosisResult =
  | {
      readonly status: "diagnosis";
      readonly causes: readonly DiagnosisCause[];
      /** 검증에서 버린 항목의 사유별 개수. 화면이 이 값을 표시한다. 설계서 §5.6. */
      readonly discarded: DiagnosisDiscarded;
    }
  | {
      readonly status: "unsure";
      readonly shortfall: string;
      readonly discarded: DiagnosisDiscarded;
    };

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

/**
 * 요청에 담긴 실패 caseId 를 순서대로 모은다. 중복은 한 번만 남긴다.
 * 정렬하지 않는다. 요청 순서가 곧 명세의 cases 순서이고, 다시 정렬하면 같은 입력에서
 * 스키마 바이트가 흔들린다.
 */
function caseIdsOf(request: DiagnosisRequest): readonly string[] {
  // 비어 있거나 공백뿐인 caseId 는 enum 에 넣지 않는다. 넣으면 고정 스키마의 `pattern: "\\S"`
  // 가 막던 값이 오히려 "정상 값" 으로 승격되고, provider 가 그 값을 돌려주면 어느 실패를
  // 가리키는지 알 수 없는 항목이 통과한다.
  return [
    ...new Set(request.failures.map((failure) => failure.caseId).filter((id) => /\S/.test(id))),
  ];
}

/**
 * 고정 스키마와 요청별 스키마를 함께 표현하는 타입.
 *
 * `caseId` 는 두 모양이다. 실패 목록이 있으면 `enum` 이고 없으면 `pattern` 이다.
 * `typeof DIAGNOSIS_PROVIDER_SCHEMA` 로 단언하면 `pattern` 이 항상 있는 것처럼 보여 실제 구조와
 * 어긋난다. 읽는 쪽이 없는 키를 있다고 믿게 만들지 않는다.
 */
export type DiagnosisProviderSchema = {
  readonly type: "object";
  readonly additionalProperties: false;
  readonly required: readonly string[];
  readonly properties: {
    readonly status: { readonly enum: readonly string[] };
    readonly causes: {
      readonly type: "array";
      readonly items: {
        readonly type: "object";
        readonly additionalProperties: false;
        readonly required: readonly string[];
        readonly properties: {
          readonly caseId:
            | { readonly type: "string"; readonly pattern: string }
            | { readonly enum: readonly string[] };
          readonly summary: { readonly type: "string"; readonly pattern: string };
          readonly location: { readonly type: "string" };
          readonly evidence: { readonly type: "string" };
          readonly target: { readonly enum: readonly string[] };
        };
      };
    };
    readonly shortfall: { readonly type: "string" };
  };
};

/**
 * 요청별 진단 출력 스키마. `caseId` 에 그 요청의 실패 목록을 `enum` 으로 박는다.
 *
 * 고정 스키마는 `caseId` 를 `pattern: "\\S"` 로만 제약했다. 그래서 provider 가 여러 케이스를
 * 콤마로 이어 붙인 문자열을 하나의 `caseId` 로 보내는 일이 실제로 있었고, 검증(§5.6-3)이 그
 * 항목을 버려 근거가 충분한 답이 통째로 `unsure` 로 접혔다. 지킬 수 없는 계약을 놓고 어겼다고
 * 버린 셈이라, 요청 단계에서 **무엇이 유효한 값인지 알려주는** 쪽으로 고친다.
 *
 * ADR-0007 제약은 그대로다. 최상위 조합자 없음, `$ref`/`$defs` 없음, 재귀 없음,
 * `minLength`·`minItems` 없음. `enum` 은 고정 스키마도 이미 쓰는 키워드다.
 * 결과는 고정 스키마와 같이 동결한다.
 */
export function buildDiagnosisProviderSchema(request: DiagnosisRequest): DiagnosisProviderSchema {
  const caseIds = caseIdsOf(request);
  // 실패가 하나도 없는 요청은 조립 단계에서 걸러진다. 그래도 빈 enum 을 만들지는 않는다.
  // 빈 enum 은 어떤 값도 만족시킬 수 없어 provider 가 무엇을 보내든 스키마 위반이 된다.
  const caseId = caseIds.length === 0 ? { type: "string", pattern: "\\S" } : { enum: [...caseIds] };
  return freeze({
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
            caseId,
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
  }) as DiagnosisProviderSchema;
}

/** 프롬프트가 쓰는 허용 caseId 목록. 스키마와 같은 순서·같은 집합이어야 한다. */
export function diagnosisCaseIds(request: DiagnosisRequest): readonly string[] {
  return caseIdsOf(request);
}
