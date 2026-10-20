// packages/perf/src/types.ts
export const PERF_SCHEMA_VERSION = 1 as const;

/** 측정할 호출 하나. CLI 가 명세에서 뽑는다. perf 는 명세 형식을 모른다. */
export interface PerfCall {
  readonly caseId: string;
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly timeoutMs: number;
}

export interface PerfPlan {
  /** 명세 순서. */
  readonly calls: readonly PerfCall[];
  readonly repeat: number;
  readonly intervalMs: number;
}

export type TraceVia = "fetch" | "node:http" | "http2" | "undici";

/** 자식 프리로드가 쓰는 한 줄. 시각은 epoch 밀리초(소수). */
export type TraceEntry =
  | {
      readonly kind: "hello";
      readonly pid: number;
      readonly ppid: number;
      readonly node: string;
      readonly t: number;
    }
  | {
      readonly kind: "start";
      readonly pid: number;
      readonly seq: number;
      readonly via: TraceVia;
      readonly method: string;
      readonly url: string;
      /** §4.3 이 고른 헤더만. 이름은 소문자. */
      readonly requestHeaders?: Readonly<Record<string, string>>;
      readonly requestBody?: string;
      readonly requestBodyUnknown?: true;
      /** undici 항목이 fetch 래퍼 안에서 생겼으면 그 fetch 의 seq. */
      readonly parentFetch?: number;
      readonly t0: number;
    }
  | {
      readonly kind: "end";
      readonly pid: number;
      readonly seq: number;
      readonly status?: number;
      readonly finalUrl?: string;
      readonly responseHeaders?: { readonly location?: string };
      readonly responseBody?: string;
      readonly responseBodyTruncated?: true;
      readonly bytes?: number;
      readonly tHeaders?: number;
      readonly tEnd: number;
      /** false 면 tEnd 가 본문 끝이 아니라 close·오류 시각이다. */
      readonly bodyEnd: boolean;
      readonly error?: string;
    };

/** start 와 end 를 합친 요청 하나. end 가 없으면 끝 필드가 없다. */
export type ObservedRequest = Omit<Extract<TraceEntry, { kind: "start" }>, "kind"> &
  Partial<Omit<Extract<TraceEntry, { kind: "end" }>, "kind" | "pid" | "seq">>;

export type CallOutcome = "ok" | "isError" | "empty" | "threw" | "skipped" | "missingTool";

/** 부모가 잰 호출 하나. skipped·missingTool 은 t0 === t1 이고 호출하지 않았다. */
export interface PerfMeasurement {
  readonly caseId: string;
  readonly tool: string;
  readonly iteration: number;
  readonly t0: number;
  readonly t1: number;
  readonly outcome: CallOutcome;
  /** threw 일 때만. §5.4 규칙을 거친 문장. */
  readonly detail?: string;
  /** threw 가 타임아웃이었으면 true. 측정 중단의 근거다(§3.2 5항). */
  readonly timedOut?: true;
}

export interface Percentiles {
  readonly p50: number;
  readonly p95: number;
  readonly min: number;
  readonly max: number;
}

export interface RequestSummary {
  /** "{METHOD} {displayUrl}". */
  readonly display: string;
  readonly via: TraceVia;
  /** ok 반복 전체에서 본 횟수. */
  readonly count: number;
  readonly durationP50: number;
}

export interface CaseResult {
  readonly id: string;
  readonly tool: string;
  /** ok 반복 수. */
  readonly n: number;
  /** 여섯 키가 모두 있다. */
  readonly outcomes: Readonly<Record<CallOutcome, number>>;
  /** 첫 threw 의 detail. */
  readonly firstError?: string;
  /** n 이 0 이면 없다. */
  readonly total?: Percentiles;
  /** n 이 0 이거나 observation 이 none 이면 아래 여섯은 없다. */
  readonly external?: Percentiles;
  readonly inside?: Percentiles;
  readonly requests?: Percentiles;
  readonly maxConcurrency?: number;
  readonly externalLowerBound?: boolean;
  readonly afterResponse?: number;
  /** observation 이 none 이면 0, 0, 0. */
  readonly dependency: {
    readonly dependent: number;
    readonly independent: number;
    readonly unknown: number;
  };
  /** display 사전순. observation 이 none 이면 빈 배열. */
  readonly requestSummaries: readonly RequestSummary[];
}

export type PerfRuleId = "perf/sequential-independent" | "perf/repeated-request";

export interface PerfFinding {
  readonly ruleId: PerfRuleId;
  readonly caseIds: readonly string[];
  readonly tools: readonly string[];
  /** 사람용 줄들. "→ " 없이. 렌더러가 붙인다. */
  readonly lines: readonly string[];
  readonly evidence: {
    readonly observed: number;
    readonly of: number;
    readonly requests: readonly string[];
    readonly savingUpperBoundMs?: number;
  };
}

export interface BaselineComparison {
  readonly path: string;
  readonly settingsMismatch: boolean;
  /** §7.3 의 줄 순서 그대로. "→ " 없이. */
  readonly lines: readonly string[];
  readonly regressedCaseIds: readonly string[];
}

export interface PerfReport {
  readonly schemaVersion: typeof PERF_SCHEMA_VERSION;
  readonly generator: { readonly name: "@mcpeak/perf"; readonly version: string };
  readonly server: { readonly command: string; readonly toolCount: number };
  readonly settings: {
    readonly repeat: number;
    readonly intervalMs: number;
    readonly caseCount: number;
    readonly observation: "preload" | "none";
  };
  readonly coldStart: { readonly connectMs: number; readonly listToolsMs: number };
  /** 명세 순서. */
  readonly cases: readonly CaseResult[];
  /** §6.3 순서. observation 이 none 이면 빈 배열. */
  readonly findings: readonly PerfFinding[];
  /** unknown 때문에 발동하지 못한 케이스 수(§6.2). */
  readonly undecidedCases: number;
  /** 타임아웃으로 측정을 끝냈으면 그 호출. 첫 timedOut 측정의 caseId 와 plan 의 timeoutMs. 아니면 null. */
  readonly aborted: { readonly caseId: string; readonly timeoutMs: number } | null;
  readonly baseline?: BaselineComparison;
  readonly exitCode: 0 | 2;
}

export interface PerfBaseline {
  readonly schemaVersion: typeof PERF_SCHEMA_VERSION;
  readonly generator: { readonly name: "@mcpeak/perf"; readonly version: string };
  readonly settings: { readonly repeat: number; readonly intervalMs: number };
  /** 케이스 id 사전순. ok 반복이 0 인 케이스는 넣지 않는다. 수치는 소수 첫째 자리 반올림. */
  readonly cases: readonly {
    readonly id: string;
    readonly tool: string;
    readonly n: number;
    readonly insideP50: number;
    readonly externalP50: number;
    readonly totalP50: number;
    readonly requestsP50: number;
  }[];
}
