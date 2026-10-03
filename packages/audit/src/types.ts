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
  | "flow"
  | "behavior"
  | "network";

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
  | { readonly kind: "server"; readonly path: "" }
  /**
   * 격리 안의 호출 하나에 붙는 발견의 위치. 호출이 아닌 단계(start·list·shutdown)의 관측은
   * `{ kind: "server", path: "" }` 에 붙이고 evidence 둘째 칸에 단계 이름을 적는다.
   */
  | {
      readonly kind: "call";
      readonly toolIndex: number;
      readonly toolName: string;
      readonly callId: string;
      readonly path: "";
    };

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

/** 격리 실행의 단계. 관측은 시각이 아니라 이 순서로 호출에 붙는다(§3.2). */
export type SandboxPhase =
  | { readonly kind: "start" }
  | { readonly kind: "list" }
  | {
      readonly kind: "call";
      readonly toolIndex: number;
      readonly toolName: string;
      readonly callId: string;
    }
  | { readonly kind: "shutdown" };

/** 시스템 콜 관측 하나. PID 와 시각은 싣지 않는다(§4). 경로는 컨테이너 안 절대 경로다(상대 경로는 cwd 로 푼다. §3.4). */
export type SyscallEvent =
  | {
      readonly kind: "open";
      readonly phase: SandboxPhase;
      readonly path: string;
      /** O_WRONLY·O_RDWR·O_CREAT·O_TRUNC·O_APPEND 중 하나라도 있으면 true. */
      readonly write: boolean;
      /** 반환값이 0 이상이면 ok, EACCES·EPERM·EROFS 면 denied, ENOENT·ENOTDIR 면 missing, 그 밖은 error. */
      readonly result: "ok" | "denied" | "missing" | "error";
    }
  | {
      readonly kind: "exec";
      readonly phase: SandboxPhase;
      readonly path: string;
      readonly argv: readonly string[];
      readonly result: "ok" | "error";
    }
  | {
      /** 지우기·옮기기. rename 은 사건 둘(rename-from, rename-to)이 된다. */
      readonly kind: "alter";
      readonly phase: SandboxPhase;
      readonly path: string;
      readonly via: "unlink" | "rmdir" | "rename-from" | "rename-to";
      readonly result: "ok" | "denied" | "missing" | "error";
    }
  | {
      readonly kind: "connect";
      readonly phase: SandboxPhase;
      readonly family: "inet" | "inet6" | "unix";
      /** inet·inet6 는 IP 문자열, unix 는 소켓 경로. 게이트웨이 주소는 "<gateway>" 로 바뀌어 온다. */
      readonly address: string;
      /** unix 면 0. */
      readonly port: number;
    };

/** 게이트웨이가 본 요청 하나. 필드의 정규화(헤더 이름 소문자·정렬, 본문 상한)는 §3.7 이 정한다. */
export interface ObservedRequest {
  readonly phase: SandboxPhase;
  readonly scheme: "http" | "https";
  readonly host: string;
  readonly port: number;
  readonly method: string;
  /** 쿼리 문자열 포함. */
  readonly path: string;
  readonly headers: ReadonlyArray<readonly [name: string, value: string]>;
  /** 본문 바이트의 base64. 상한을 넘으면 앞부분만 싣고 bodyTruncated 가 true 다. */
  readonly bodyBase64: string;
  readonly bodyTruncated: boolean;
  /**
   * live 는 실제 전달, replay-hit 은 세션 파일로 답함, replay-miss 는 세션 파일에 없어 답하지 못함,
   * blocked 는 상류가 내부 주소로 풀려 전달하지 않음(§3.7).
   */
  readonly served: "live" | "replay-hit" | "replay-miss" | "blocked";
}

export interface Observation {
  readonly events: readonly SyscallEvent[];
  readonly requests: readonly ObservedRequest[];
  /** TLS 악수가 우리 인증서 거부로 끝난 접속. 인증서 고정의 흔적이다. */
  readonly tlsRejections: ReadonlyArray<{ readonly phase: SandboxPhase; readonly host: string }>;
  /** 게이트웨이 DNS 가 받은 질의 이름. 직접 IP 접속 판정의 대조 재료다. */
  readonly dnsNames: ReadonlyArray<{ readonly phase: SandboxPhase; readonly name: string }>;
  /** mark 사이에 시스템 콜 기록의 누적 줄 수가 줄었다. 서버가 기록을 건드린 것이다(§3.4). */
  readonly traceShrank: boolean;
  /** 읽지 못한 관측원. 비어 있지 않으면 audit() 이 skipped 로 옮긴다(§4). 조용한 "발견 0" 을 막는다. */
  readonly gaps: ReadonlyArray<{ readonly source: "trace" | "gateway"; readonly reason: string }>;
  /** parseTrace 가 해석하지 못한 줄 수의 합. 백엔드는 언제나 채운다(없으면 0). */
  readonly unparsedLines?: number;
}

/** 격리 안에서 도구 하나에 보낼 호출 하나(§3.3). */
export interface PlannedCall {
  readonly callId: string;
  readonly args: Readonly<Record<string, unknown>>;
}

/** 격리 홈의 파일 하나(§3.5). path 는 홈 기준 POSIX 상대 경로다. */
export interface HomeFile {
  readonly path: string;
  readonly content: string;
  readonly mode: number;
  /** 있으면 이 파일이 파일 카나리이고, 값은 content 안에 들어 있는 카나리 문자열이다. */
  readonly canary?: string;
}

export interface HomePlan {
  readonly hostname: string;
  readonly files: readonly HomeFile[];
}

/** 나가는 요청과 대조할 카나리 하나. name 은 env 이름 또는 "~/" 로 시작하는 홈 경로다. */
export interface CanaryValue {
  readonly origin: "env" | "file";
  readonly name: string;
  readonly value: string;
}

export type SandboxNetworkMode = "live" | "record" | "replay";

export type SandboxUnavailableCode =
  | "docker-missing"
  | "daemon-down"
  | "unsupported-command"
  | "image-build-failed"
  | "start-failed";

export interface SandboxUnavailable {
  readonly code: SandboxUnavailableCode;
  /**
   * unsupported-command 면 명령의 basename, image-build-failed·start-failed 면 docker 오류 첫 줄.
   * 그 밖은 "". 컨테이너·네트워크 이름과 임시 경로는 백엔드가 "<container>"·"<network>"·"<tmp>" 로
   * 바꿔서 넣는다(§4).
   */
  readonly detail: string;
}

export interface SandboxOptions {
  /** 격리가 실제로 켜졌을 때의 호출 정책. AuditOptions.probe 는 격리가 안 켜졌을 때의 정책이다(§3.1). */
  readonly probe: ProbePolicy;
  /** 컨테이너에 읽기 전용으로 보일 호스트 디렉터리. 절대 경로(§3.1). */
  readonly mountRoot: string;
  /** 서버의 작업 디렉터리. mountRoot 안의 절대 경로이고 컨테이너에서도 같은 경로다. */
  readonly cwd: string;
  readonly session?: { readonly mode: "record" | "replay"; readonly path: string };
  readonly allowHosts: readonly string[];
  readonly compareHost: boolean;
  /** CLI 가 읽어 넘기는 선언 출처(§3.6). audit 는 파일을 직접 읽지 않는다. */
  readonly declarationTexts: ReadonlyArray<{
    readonly source: "readme" | "package.json";
    readonly text: string;
  }>;
}

export interface RequestSummary {
  readonly host: string;
  readonly port: number;
  readonly method: string;
  readonly path: string;
  readonly count: number;
  readonly declared: boolean;
}

export type SandboxReport =
  | { readonly status: "unavailable"; readonly reason: SandboxUnavailable }
  | {
      readonly status: "ran";
      readonly backend: string;
      /** 이미지 태그(내용 해시). 이미지 ID 가 아니다. */
      readonly image: string;
      readonly network: SandboxNetworkMode;
      readonly compareHost: boolean;
      /** 격리 안에서 보낸 tools/call 의 수. */
      readonly callCount: number;
      /** 정렬된 선언 목적지(§3.6). */
      readonly declaredHosts: readonly string[];
      /** (host, port, method, path) 순으로 정렬하고 같은 것은 count 로 접는다(§4). */
      readonly requests: readonly RequestSummary[];
    };

export interface AuditOptions {
  readonly target: AuditTarget;
  readonly probe: ProbePolicy;
  /** 기준 파일 경로. 없으면 surface 가족을 건너뛴다. */
  readonly baselinePath?: string;
  readonly updateBaseline: boolean;
  /** 있으면 격리 실행을 요청한 것이다. 백엔드가 없거나 쓸 수 없으면 단계 1 경로로 돈다. */
  readonly sandbox?: SandboxOptions;
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
  /** 실제로 쓴 정책. 격리가 켜졌으면 `sandbox.probe`, 아니면 `options.probe` 다. */
  readonly probe: ProbePolicy;
  /** 호출한 도구 이름(정렬). */
  readonly probedTools: readonly string[];
  /** `--sandbox` 를 준 실행에만 있다. 없는 출력은 단계 1 과 바이트 단위로 같다. */
  readonly sandbox?: SandboxReport;
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
  /**
   * 필드 단위 비교 재료. 각 필드 정규화 직렬화의 sha256 hex 이고, 없는 필드는 "" 다.
   * `hints` 는 주석 완화(readOnlyHint true→false 등) 판정용 원값이다. 없는 기준 파일은 필드를 모른다고 본다.
   */
  readonly fields?: {
    readonly title: string;
    readonly description: string;
    readonly inputSchema: string;
    readonly outputSchema: string;
    readonly annotations: string;
    readonly hints: {
      readonly readOnlyHint?: boolean;
      readonly destructiveHint?: boolean;
      readonly openWorldHint?: boolean;
    };
  };
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

export type AuditErrorCode =
  | "CONNECT_FAILED"
  | "BASELINE_UNREADABLE"
  | "BASELINE_SERVER_MISMATCH"
  | "SANDBOX_CLEANUP_FAILED"
  | "SANDBOX_SESSION_UNREADABLE";

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
